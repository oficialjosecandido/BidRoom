const Notification = require('../models/Notification');
const User = require('../models/User');
const NotificationPreferences = require('../models/NotificationPreferences');
const Follow = require('../models/Follow');

// In-memory debounce: prevent outbid notification floods in high-activity auctions.
// Key: "userId:listingId", value: timestamp of last sent notification.
const _outbidDebounce = new Map();
const OUTBID_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

// Purge stale debounce entries every 5 minutes to prevent unbounded memory growth.
setInterval(() => {
  const cutoff = Date.now() - OUTBID_DEBOUNCE_MS;
  for (const [key, ts] of _outbidDebounce.entries()) {
    if (ts < cutoff) _outbidDebounce.delete(key);
  }
}, OUTBID_DEBOUNCE_MS).unref(); // .unref() so this timer doesn't keep the process alive

/**
 * Returns true if an outbid notification was already sent for this user+listing within the debounce window.
 * Side-effect: records the current timestamp so the next call within the window is debounced.
 */
function checkAndSetOutbidDebounce(userId, listingId) {
  const key = `${userId}:${listingId}`;
  const last = _outbidDebounce.get(key);
  if (last && Date.now() - last < OUTBID_DEBOUNCE_MS) return true; // debounced
  _outbidDebounce.set(key, Date.now());
  return false;
}

// Critical event types that are always sent regardless of user preferences.
const CRITICAL_EMAIL_EVENTS = new Set([
  'disputeUpdate', 'paymentReceived', 'auctionWon'
]);

/**
 * Returns true if the user has not globally unsubscribed from email and has email enabled for the event type.
 * Defaults to true when no preferences record exists.
 * @param {string} userId - Mongo User _id
 * @param {string} eventType - e.g. 'outbid', 'auctionWon', etc.
 */
async function shouldSendEmail(userId, eventType) {
  // Critical events (disputes, payments, auction wins) are always delivered.
  if (CRITICAL_EMAIL_EVENTS.has(eventType)) return true;

  try {
    const prefs = await NotificationPreferences.findOne({ user: userId })
      .select(`globalEmailUnsubscribed ${eventType}`)
      .lean();
    if (!prefs) return true;
    if (prefs.globalEmailUnsubscribed) return false;
    const eventPrefs = prefs[eventType];
    if (!eventPrefs) return true;
    return eventPrefs.email !== false;
  } catch {
    return true; // fail-open: don't block notifications on DB error
  }
}

/**
 * Notification link (returnUrl) mapping – each notification type navigates to the most relevant page:
 *
 * | Notification type           | Link destination                |
 * |----------------------------|---------------------------------|
 * | New bid received           | /listing/:slug?tab=bids        |
 * | Outbid (auction)          | /listing/:slug?tab=bids        |
 * | New proposal               | /listing/:slug?tab=offers       |
 * | Proposal accepted/declined| /listing/:slug?tab=offers       |
 * | Auction ended (seller)     | /dashboard/transactions         |
 * | Auction won (buyer)        | /dashboard/transactions         |
 * | Listing removed/changes   | /dashboard/my-listings or listing |
 * | Item added to watchlist    | /listing/:slug                 |
 * | Private room (invite)     | /private-room/auction/:id       |
 * | Private room (accepted/declined) | /listing/:slug          |
 * | Room cancelled             | /dashboard/my-auctions          |
 * | Shipping / delivery        | /dashboard/transactions         |
 * | Dispute                    | /dashboard/disputes             |
 * | Account / security         | /dashboard/my-account          |
 */

/**
 * Emit a real-time event to the user's socket room so their notification badge updates.
 * @param {object} io - Socket.io instance
 * @param {string} userMongoId - Mongo User _id (ObjectId string)
 */
async function emitNewNotificationToUser(io, userMongoId) {
  if (!io || !userMongoId) return;
  try {
    const user = await User.findById(userMongoId).select('uid').lean();
    if (user?.uid) {
      io.to(`user:${user.uid}`).emit('new-notification');
    }
  } catch (err) {
    console.error('Failed to emit new-notification:', err);
  }
}

/**
 * Create a notification for a user.
 * @param {Object} options
 * @param {string} options.userId - Mongo User _id
 * @param {string} options.title - Short title (e.g. "New proposal")
 * @param {string} options.message - Full message text
 * @param {string} [options.type='system'] - proposal | bid | auction_ended | transaction | dispute | review | system
 * @param {string} [options.link] - URL to navigate (e.g. /listing/slug?tab=offers)
 * @param {string} [options.referenceId] - Related entity ID for deduplication
 * @param {string} [options.eventType] - Preference key to check (e.g. 'outbid'). Skips creation if user disabled inApp.
 * @returns {Promise<Notification|null>}
 */
async function createNotification({ userId, title, message, type = 'system', link = null, referenceId = null, eventType = null }) {
  try {
    if (eventType) {
      const prefs = await NotificationPreferences.findOne({ user: userId })
        .select(`${eventType}`)
        .lean();
      if (prefs && prefs[eventType] && prefs[eventType].inApp === false) return null;
    }

    const notification = new Notification({
      user: userId,
      title,
      message,
      type,
      link: link || null,
      referenceId: referenceId || null,
      status: 'unread',
      issuedAt: new Date()
    });
    await notification.save();
    return notification;
  } catch (err) {
    console.error('Failed to create notification:', err);
    return null;
  }
}

/**
 * Create notification for seller when someone places a bid on their listing.
 */
async function notifyNewBid({ listingId, listingSlug, listingTitle, bidAmount, bidderName, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=bids` : null;
  return createNotification({
    userId: sellerUserId,
    title: 'New bid received',
    message: `${bidderName} placed a bid of $${(bidAmount || 0).toFixed(2)} on "${listingTitle || 'your listing'}"`,
    type: 'bid',
    link,
    referenceId: listingId
  });
}

/** Auction (highest-bid): previous high bidder was exceeded — in-app notification (email sent separately). */
async function notifyBidderOutbid({
  listingSlug,
  listingTitle,
  previousBidAmount,
  newBidAmount,
  bidderUserId,
  listingId
}) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=bids` : null;
  const prev = Number(previousBidAmount || 0).toFixed(2);
  const next = Number(newBidAmount || 0).toFixed(2);
  return createNotification({
    eventType: 'outbid',
    userId: bidderUserId,
    title: "You've been outbid",
    message: `Your bid of $${prev} on "${listingTitle || 'this auction'}" was exceeded. Current high bid: $${next}.`,
    type: 'bid',
    link,
    referenceId: listingId ? String(listingId) : listingSlug || null
  });
}

/**
 * Create notification for seller when a new proposal is received.
 */
async function notifyNewProposal({ listingId, listingSlug, listingTitle, offerAmount, offererName, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=offers` : null;
  return createNotification({
    userId: sellerUserId,
    title: 'New proposal',
    message: `${offererName} made an offer of $${(offerAmount || 0).toFixed(2)} on "${listingTitle || 'your listing'}"`,
    type: 'proposal',
    link,
    referenceId: listingId
  });
}

/** Proposal accepted - notify buyer */
async function notifyProposalAccepted({ listingSlug, listingTitle, offerAmount, buyerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=offers` : null;
  return createNotification({
    userId: buyerUserId,
    title: 'Proposal accepted',
    message: `Your offer of $${(offerAmount || 0).toFixed(2)} on "${listingTitle || 'the item'}" was accepted.`,
    type: 'proposal',
    link,
    referenceId: listingSlug
  });
}

/** Proposal declined - notify buyer */
async function notifyProposalDeclined({ listingSlug, listingTitle, offerAmount, buyerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=offers` : null;
  return createNotification({
    userId: buyerUserId,
    title: 'Proposal declined',
    message: `Your offer of $${(offerAmount || 0).toFixed(2)} on "${listingTitle || 'the item'}" was declined.`,
    type: 'proposal',
    link,
    referenceId: listingSlug
  });
}

/** Offer placed - confirm to offerer (best-offer auctions) */
async function notifyOfferPlaced({ listingSlug, listingTitle, offerAmount, offererUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=offers` : null;
  return createNotification({
    userId: offererUserId,
    title: 'Offer confirmed',
    message: `Your offer of $${(offerAmount || 0).toFixed(2)} on "${listingTitle || 'the item'}" has been received.`,
    type: 'proposal',
    link,
    referenceId: listingSlug
  });
}

/** Higher offer received - notify previous highest offerer (best-offer auctions) */
async function notifyOfferOutbid({ listingSlug, listingTitle, previousOffer, newOffer, offererUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=offers` : null;
  return createNotification({
    userId: offererUserId,
    title: 'Higher offer received',
    message: `Your offer of $${(previousOffer || 0).toFixed(2)} on "${listingTitle || 'the item'}" was exceeded. Someone offered $${(newOffer || 0).toFixed(2)}.`,
    type: 'proposal',
    link,
    referenceId: listingSlug
  });
}

/** Best-offer listing ended - notify seller to review/accept offers within 24h */
async function notifySellerBestOfferEnded({ listingSlug, listingTitle, offerCount, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=offers` : null;
  return createNotification({
    userId: sellerUserId,
    title: 'Listing ended',
    message: `Your best-offer listing "${listingTitle || 'the item'}" has ended with ${offerCount} offer(s). You have 24 hours to review and accept an offer.`,
    type: 'listing',
    link,
    referenceId: listingSlug
  });
}

/** Listing removed due to policy violation - notify seller */
async function notifyListingRemoved({ listingSlug, listingTitle, sellerUserId }) {
  return createNotification({
    userId: sellerUserId,
    title: 'Listing removed',
    message: `"${listingTitle || 'Your listing'}" was removed due to a policy violation.`,
    type: 'listing',
    link: '/dashboard/my-listings',
    referenceId: listingSlug
  });
}

/** Listing requires changes to be approved - notify seller */
async function notifyListingRequiresChanges({ listingSlug, listingTitle, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : '/dashboard/my-listings';
  return createNotification({
    userId: sellerUserId,
    title: 'Listing changes required',
    message: `"${listingTitle || 'Your listing'}" needs changes before it can be approved.`,
    type: 'listing',
    link,
    referenceId: listingSlug
  });
}

/** Item added to watchlist - notify seller */
async function notifyItemAddedToWatchlist({ listingSlug, listingTitle, watcherName, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : null;
  return createNotification({
    userId: sellerUserId,
    title: 'Item added to watchlist',
    message: `${watcherName || 'Someone'} added "${listingTitle || 'your listing'}" to their watchlist.`,
    type: 'watchlist',
    link,
    referenceId: listingSlug
  });
}

/** Invitation to private room received - notify bidder */
async function notifyPrivateRoomInvitation({ listingId, listingSlug, listingTitle, bidderUserId }) {
  const link = listingId ? `/private-room/auction/${listingId}` : null;
  return createNotification({
    userId: bidderUserId,
    title: 'Private room invitation',
    message: `You're invited to the private room for "${listingTitle || 'an auction'}". Accept within 15 minutes.`,
    type: 'private_room',
    link,
    referenceId: listingId
  });
}

/** Private room accepted - notify seller (a bidder accepted) */
async function notifyPrivateRoomAccepted({ listingSlug, listingTitle, bidderName, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : null;
  return createNotification({
    userId: sellerUserId,
    title: 'Private room accepted',
    message: `${bidderName || 'A bidder'} accepted your private room invitation for "${listingTitle || 'your listing'}".`,
    type: 'private_room',
    link,
    referenceId: listingSlug
  });
}

/** Private room declined - notify seller */
async function notifyPrivateRoomDeclined({ listingSlug, listingTitle, bidderName, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : null;
  return createNotification({
    userId: sellerUserId,
    title: 'Private room declined',
    message: `${bidderName || 'A bidder'} declined your private room invitation for "${listingTitle || 'your listing'}".`,
    type: 'private_room',
    link,
    referenceId: listingSlug
  });
}

/** Private room closed (no one accepted) - notify seller */
async function notifyPrivateRoomClosedNoAcceptanceSeller({ listingSlug, listingTitle, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : '/dashboard/my-auctions';
  return createNotification({
    userId: sellerUserId,
    title: 'Private room closed',
    message: `The private room for "${listingTitle || 'your listing'}" was closed because no invited bidders accepted within 15 minutes. The auction ended without a winner.`,
    type: 'private_room',
    link,
    referenceId: listingSlug
  });
}

/** Private room closed (no one accepted) - notify invited buyers */
async function notifyPrivateRoomClosedNoAcceptanceInvited({ listingSlug, listingTitle, bidderUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : '/dashboard/my-auctions';
  return createNotification({
    userId: bidderUserId,
    title: 'Private room closed',
    message: `The private room for "${listingTitle || 'the auction'}" was closed because no invited bidders accepted within 15 minutes. The auction ended without a winner.`,
    type: 'private_room',
    link,
    referenceId: listingSlug
  });
}

/** Private room closed (seller left) - notify seller */
async function notifySellerLeftPrivateRoomSeller({ listingSlug, listingTitle, sellerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : '/dashboard/my-listings';
  return createNotification({
    userId: sellerUserId,
    title: 'Private room closed',
    message: `The private room for "${listingTitle || 'your listing'}" was closed because you left. The auction ended without a winner.`,
    type: 'private_room',
    link,
    referenceId: listingSlug
  });
}

/** Private room closed (seller left) - notify buyers in the room */
async function notifySellerLeftPrivateRoomBuyers({ listingSlug, listingTitle, bidderUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : '/dashboard/my-auctions';
  return createNotification({
    userId: bidderUserId,
    title: 'Seller left the private room',
    message: `The seller has left the private room for "${listingTitle || 'the auction'}". The auction has been closed without a winner.`,
    type: 'private_room',
    link,
    referenceId: listingSlug
  });
}

/** Room cancelled by seller - notify bidders */
async function notifyRoomCancelled({ listingSlug, listingTitle, bidderUserId }) {
  return createNotification({
    userId: bidderUserId,
    title: 'Private room cancelled',
    message: `The private room for "${listingTitle || 'the auction'}" was cancelled by the seller.`,
    type: 'private_room',
    link: '/dashboard/my-auctions',
    referenceId: listingSlug
  });
}

/** Item marked as shipped - notify buyer */
async function notifyItemMarkedShipped({ transactionId, listingTitle, buyerUserId }) {
  return createNotification({
    userId: buyerUserId,
    title: 'Item shipped',
    message: `"${listingTitle || 'Your item'}" has been marked as shipped.`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/** Tracking number provided - notify buyer */
async function notifyTrackingProvided({ transactionId, listingTitle, buyerUserId }) {
  return createNotification({
    userId: buyerUserId,
    title: 'Tracking number added',
    message: `A tracking number was added for "${listingTitle || 'your item'}".`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/** Item marked as delivered - notify buyer */
async function notifyItemMarkedDelivered({ transactionId, listingTitle, buyerUserId }) {
  return createNotification({
    userId: buyerUserId,
    title: 'Item delivered',
    message: `"${listingTitle || 'Your item'}" has been marked as delivered.`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/** Shipping deadline started - notify seller */
async function notifyShippingDeadlineStarted({ transactionId, listingTitle, sellerUserId }) {
  return createNotification({
    userId: sellerUserId,
    title: 'Shipping deadline started',
    message: `Ship "${listingTitle || 'the item'}" by the handling deadline.`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/** Shipping deadline approaching - notify seller */
async function notifyShippingDeadlineApproaching({ transactionId, listingTitle, sellerUserId }) {
  return createNotification({
    userId: sellerUserId,
    title: 'Shipping deadline soon',
    message: `The shipping deadline for "${listingTitle || 'the item'}" is approaching.`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/**
 * Day 3 midpoint warning: seller has 2 business days left before auto-cancel.
 * @param {object} opts
 * @param {string} opts.transactionId
 * @param {string} opts.listingTitle   Title of the listing (for user context)
 * @param {string} opts.sellerUserId   Mongo _id of the seller
 */
async function notifySellerShippingFinalTwoDays({ transactionId, listingTitle, sellerUserId }) {
  return createNotification({
    userId: sellerUserId,
    title: 'Ship soon — 2 days left',
    message: `You have 2 business days left to ship "${listingTitle || 'this order'}" or it will be cancelled and the buyer refunded.`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/**
 * Buyer triggered "Remind seller to ship" action.
 * @param {object} opts
 * @param {string} opts.transactionId
 * @param {string} opts.listingTitle
 * @param {string} opts.sellerUserId
 */
async function notifySellerBuyerRemindedShip({ transactionId, listingTitle, sellerUserId }) {
  return createNotification({
    userId: sellerUserId,
    title: 'Buyer reminder: please ship',
    message: `The buyer asked you to ship "${listingTitle || 'their order'}" soon.`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/**
 * Auto-cancel notification to buyer: order cancelled + refund issued.
 * @param {object} opts
 * @param {string} opts.transactionId
 * @param {string} opts.listingTitle
 * @param {string} opts.buyerUserId
 */
async function notifyBuyerOrderCancelledNoShipment({ transactionId, listingTitle, buyerUserId }) {
  return createNotification({
    userId: buyerUserId,
    title: 'Order cancelled — refund issued',
    message: `Your order for "${listingTitle || 'the item'}" was cancelled because the seller did not ship in time. You have been refunded in full.`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/**
 * Auto-cancel notification to seller: failed to ship within deadline.
 * @param {object} opts
 * @param {string} opts.transactionId
 * @param {string} opts.listingTitle
 * @param {string} opts.sellerUserId
 */
async function notifySellerOrderCancelledNoShipment({ transactionId, listingTitle, sellerUserId }) {
  return createNotification({
    userId: sellerUserId,
    title: 'Order cancelled — did not ship in time',
    message: `The order for "${listingTitle || 'your sale'}" was cancelled automatically because you did not ship within the required timeframe. The buyer has been refunded.`,
    type: 'shipping',
    link: `/dashboard/transactions`,
    referenceId: transactionId
  });
}

/** Buyer confirmed receipt - notify seller */
async function notifyBuyerConfirmedReceipt({ transactionId, listingTitle, buyerName, sellerUserId }) {
  const link = transactionId
    ? `/dashboard/seller?tab=transactions#transaction-${transactionId}`
    : '/dashboard/seller?tab=transactions';
  return createNotification({
    userId: sellerUserId,
    title: 'Buyer confirmed receipt',
    message: `${buyerName || 'The buyer'} confirmed receipt of "${listingTitle || 'the item'}".`,
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

/** Dispute opened - notify other party */
async function notifyDisputeOpened({ transactionId, listingTitle, openerName, otherPartyUserId }) {
  const link = transactionId ? `/dashboard/disputes?open=${transactionId}` : '/dashboard/disputes';
  return createNotification({
    userId: otherPartyUserId,
    title: 'Dispute opened',
    message: `${openerName || 'A party'} opened a dispute for "${listingTitle || 'the transaction'}".`,
    type: 'dispute',
    link,
    referenceId: transactionId
  });
}

/** Evidence submitted - notify other party */
async function notifyEvidenceSubmitted({ transactionId, listingTitle, submitterRole, otherPartyUserId }) {
  const link = transactionId ? `/dashboard/disputes?open=${transactionId}` : '/dashboard/disputes';
  return createNotification({
    userId: otherPartyUserId,
    title: 'Evidence submitted',
    message: `New evidence was submitted for the dispute on "${listingTitle || 'the transaction'}".`,
    type: 'dispute',
    link,
    referenceId: transactionId
  });
}

/** Decision issued - notify both buyer and seller */
async function notifyDisputeDecisionIssued({ transactionId, listingTitle, verdict, userId }) {
  const link = transactionId ? `/dashboard/disputes?open=${transactionId}` : '/dashboard/disputes';
  return createNotification({
    userId,
    title: 'Dispute decision',
    message: `A decision has been issued for the dispute on "${listingTitle || 'the transaction'}": ${verdict}.`,
    type: 'dispute',
    link,
    referenceId: transactionId
  });
}

/** Account: strike applied */
async function notifyStrikeApplied({ userId, reason }) {
  return createNotification({
    userId,
    title: 'Strike applied',
    message: reason || 'A strike has been applied to your account.',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'strike'
  });
}

/** Account restricted */
async function notifyAccountRestricted({ userId }) {
  return createNotification({
    userId,
    title: 'Account restricted',
    message: 'Your account has been restricted.',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'restriction'
  });
}

/** Account suspended */
async function notifyAccountSuspended({ userId }) {
  return createNotification({
    userId,
    title: 'Account suspended',
    message: 'Your account has been suspended.',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'suspension'
  });
}

/** Account reactivated */
async function notifyAccountReactivated({ userId }) {
  return createNotification({
    userId,
    title: 'Account reactivated',
    message: 'Your account has been reactivated.',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'reactivation'
  });
}

/** Seller accepted payment — notify buyer */
async function notifyBuyerSellerAccepted({ transactionId, listingTitle, buyerUserId }) {
  return createNotification({
    userId: buyerUserId,
    title: 'Seller accepted your payment',
    message: `The seller has accepted your payment for "${listingTitle || 'the item'}". They will prepare and ship your order soon.`,
    type: 'transaction',
    link: '/dashboard/transactions',
    referenceId: transactionId
  });
}

/** Buyer paid — notify seller */
async function notifySellerPaymentReceived({ transactionId, listingTitle, buyerName, sellerUserId }) {
  const link = transactionId
    ? `/dashboard/seller?tab=transactions#transaction-${transactionId}`
    : '/dashboard/seller?tab=transactions';
  return createNotification({
    userId: sellerUserId,
    title: 'Payment received',
    message: `${buyerName || 'A buyer'} paid for "${listingTitle || 'your listing'}". Confirm acceptance and prepare to ship.`,
    type: 'transaction',
    link,
    referenceId: transactionId
  });
}

/** Seller must connect Stripe before a qualifying offer can be accepted */
async function notifySellerStripeRequiredForOffer({ listingSlug, listingTitle, offerAmount, sellerUserId }) {
  const link = '/dashboard/settings';
  return createNotification({
    userId: sellerUserId,
    title: 'Action required: Connect Stripe to accept offer',
    message: `Your listing "${listingTitle || 'the item'}" has a qualifying offer of $${(offerAmount || 0).toFixed(2)}. Connect your Stripe account in Settings → Payments to accept it.`,
    type: 'transaction',
    link,
    referenceId: listingSlug
  });
}

/** Account permanently closed */
async function notifyAccountClosed({ userId }) {
  return createNotification({
    userId,
    title: 'Account closed',
    message: 'Your account has been permanently closed.',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'account_closed'
  });
}

/**
 * Format shipping for pricing overview.
 * @param {string} shippingOption - flat-rate | calculated | local-pickup | free
 * @param {number} shippingCost - dollar amount (used for flat-rate)
 * @returns {string}
 */
function formatShippingForPricing(shippingOption, shippingCost = 0) {
  if (!shippingOption) return '—';
  if (shippingOption === 'free') return 'Free';
  if (shippingOption === 'local-pickup') return 'Meet in Person';
  if (shippingOption === 'flat-rate') {
    const cost = Number(shippingCost) || 0;
    return cost > 0 ? `$${cost.toFixed(2)}` : 'Free';
  }
  if (shippingOption === 'calculated') return 'Calculated at checkout';
  return '—';
}

/** Auction ended with winner - notify seller (link: transactions to manage sale) */
async function notifySellerWinnerSelected({
  listingSlug,
  listingTitle,
  winnerName,
  winningAmount,
  commissionRate = 0.035,
  shippingCost = 0,
  shippingOption = 'flat-rate',
  sellerUserId
}) {
  const link = '/dashboard/transactions';
  const amount = Number(winningAmount) || 0;
  const bidRoomFee = amount * (Number(commissionRate) || 0);
  const shippingDisplay = formatShippingForPricing(shippingOption, shippingCost);

  let message = `${winnerName || 'A bidder'} won "${listingTitle || 'your listing'}" with a bid of $${amount.toFixed(2)}.`;
  message += ` Pricing: Final price $${amount.toFixed(2)}; BidRoom fee $${bidRoomFee.toFixed(2)}; Shipping (buyer pays): ${shippingDisplay}.`;

  return createNotification({
    userId: sellerUserId,
    title: 'Auction ended – winner selected',
    message,
    type: 'auction_ended',
    link,
    referenceId: listingSlug
  });
}

/** Auction won - notify buyer (winner) */
async function notifyBuyerAuctionWon({
  listingSlug,
  listingTitle,
  winningAmount,
  shippingCost = 0,
  shippingOption = 'flat-rate',
  buyerUserId
}) {
  const link = '/dashboard/transactions';
  const amount = Number(winningAmount) || 0;
  const shippingDisplay = formatShippingForPricing(shippingOption, shippingCost);

  let message = `Congratulations! You won "${listingTitle || 'the listing'}" with your bid of $${amount.toFixed(2)}.`;
  message += ` Pricing: Item $${amount.toFixed(2)}; Shipping: ${shippingDisplay}.`;
  message += ' Complete payment to proceed.';

  return createNotification({
    userId: buyerUserId,
    title: 'You won the auction!',
    message,
    type: 'auction_ended',
    link,
    referenceId: listingSlug
  });
}

/** Security: login from new device */
async function notifyLoginFromNewDevice({ userId, deviceInfo }) {
  return createNotification({
    userId,
    title: 'Login from new device',
    message: deviceInfo || 'Your account was accessed from a new device.',
    type: 'security',
    link: '/dashboard/my-account',
    referenceId: 'login'
  });
}

/**
 * Notify both buyer and seller to leave a review after a transaction reaches a terminal state.
 * @param {{ buyerId, sellerId, listingTitle, transactionId, io }}
 */
async function notifyReviewPrompt({ buyerId, sellerId, listingTitle, transactionId, io }) {
  const title = 'Leave a review';
  const message = `How was your experience with "${listingTitle || 'this transaction'}"? Leave a review to help the community.`;
  const link = '/dashboard/home';

  await Promise.allSettled([
    createNotification({ userId: buyerId, title, message, type: 'review', link, referenceId: transactionId }),
    createNotification({ userId: sellerId, title, message, type: 'review', link, referenceId: transactionId })
  ]);

  if (io) {
    await Promise.allSettled([
      emitNewNotificationToUser(io, buyerId),
      emitNewNotificationToUser(io, sellerId)
    ]);
  }
}

/** Private-room payment deadline approaching — warn buyer 1h before expiry */
async function notifyBuyerPaymentDeadlineWarning({ buyerId, listingTitle, listingSlug, deadlineAt }) {
  const link = `/dashboard/buyer?tab=transactions`;
  return createNotification({
    userId: buyerId,
    title: 'Payment deadline approaching',
    message: `You have less than 1 hour to complete payment for "${listingTitle || 'the item'}". Failure to pay will result in a reputation penalty.`,
    type: 'transaction',
    link,
    eventType: 'payment_deadline_warning'
  });
}

/** Buyer failed to pay in 48h — notify buyer of penalty */
async function notifyBuyerNonPayment({ buyerId, listingTitle, penaltyPoints, nonPaymentCount, io }) {
  const link = `/dashboard/buyer?tab=transactions`;
  const warningLevel = nonPaymentCount >= 3 ? 'ban' : nonPaymentCount === 2 ? 'final_warning' : 'warning';
  const messages = {
    warning: `Your payment window for "${listingTitle || 'the item'}" expired. A reputation penalty of ${penaltyPoints} points has been applied.`,
    final_warning: `Payment expired for "${listingTitle || 'the item'}". This is your 2nd non-payment. One more will result in a permanent account ban.`,
    ban: `Payment expired for "${listingTitle || 'the item'}". This is your 3rd non-payment. Your account has been suspended.`
  };
  await createNotification({
    userId: buyerId,
    title: 'Payment deadline expired',
    message: messages[warningLevel],
    type: 'account',
    link,
    eventType: 'non_payment_penalty'
  });
  if (io) await emitNewNotificationToUser(io, buyerId);
}

/** Seller notified that buyer failed to pay — second chance bidder being offered */
async function notifySellerBuyerNonPayment({ sellerId, listingTitle, listingSlug, hasSecondBidder, io }) {
  const link = `/listing/${listingSlug}`;
  const message = hasSecondBidder
    ? `The winning bidder for "${listingTitle}" did not pay. We've automatically offered the item to the next highest bidder.`
    : `The winning bidder for "${listingTitle}" did not pay and there is no second bidder. You can relist the item or cancel.`;
  await createNotification({
    userId: sellerId,
    title: 'Buyer did not pay',
    message,
    type: 'transaction',
    link,
    eventType: 'buyer_non_payment'
  });
  if (io) await emitNewNotificationToUser(io, sellerId);
}

/** Second-chance bidder notified of their opportunity */
async function notifySecondBidderSecondChance({ buyerId, listingTitle, listingSlug, paymentDeadlineHours, io }) {
  const link = `/dashboard/buyer?tab=transactions`;
  await createNotification({
    userId: buyerId,
    title: 'Second chance to buy!',
    message: `The winner for "${listingTitle}" did not pay. As the next highest bidder, you have ${paymentDeadlineHours}h to complete payment.`,
    type: 'transaction',
    link,
    eventType: 'second_chance_offer'
  });
  if (io) await emitNewNotificationToUser(io, buyerId);
}

/** Damage claim opened — notify seller */
async function notifyDamageClaimOpened({ sellerId, buyerName, listingTitle, shippingType, transactionId, io }) {
  const link = `/dashboard/buyer?tab=transactions#transaction-${transactionId}`;
  const isExternal = shippingType === 'external_shipping';
  const title = isExternal
    ? 'Damage claim opened — your responsibility'
    : 'Buyer reported item damaged in transit';
  const message = isExternal
    ? `${buyerName || 'A buyer'} reported "${listingTitle || 'an item'}" damaged. As the shipper, you must file the carrier claim and resolve this.`
    : `${buyerName || 'A buyer'} reported "${listingTitle || 'an item'}" arrived damaged. BidRoom will handle the carrier claim.`;

  await createNotification({
    userId: sellerId,
    title,
    message,
    type: 'dispute',
    link,
    referenceId: transactionId,
    eventType: 'damage_claim_opened'
  });

  if (io) await emitNewNotificationToUser(io, sellerId);
}

/** Damage claim resolved — notify buyer */
async function notifyDamageClaimResolved({ buyerId, listingTitle, status, transactionId, io }) {
  const link = `/dashboard/buyer?tab=transactions#transaction-${transactionId}`;
  const approved = status === 'approved_refund' || status === 'resolved';
  const title = approved ? 'Damage claim approved' : 'Damage claim update';
  const message = approved
    ? `Your damage claim for "${listingTitle || 'the item'}" has been approved. A refund will be processed.`
    : `Your damage claim for "${listingTitle || 'the item'}" has been reviewed. Please check your transactions for details.`;

  await createNotification({
    userId: buyerId,
    title,
    message,
    type: 'dispute',
    link,
    referenceId: transactionId,
    eventType: 'damage_claim_resolved'
  });

  if (io) await emitNewNotificationToUser(io, buyerId);
}

async function notifyFollowersNewListing({ sellerId, sellerFirstName, listingTitle, listingSlug, io }) {
  try {
    const followers = await Follow.find({ following: sellerId, muted: false }).lean();
    if (!followers.length) return;

    const title = sellerFirstName
      ? `${sellerFirstName} published a new listing`
      : 'New listing from a seller you follow';
    const message = listingTitle || 'Check it out now';
    const link = listingSlug ? `/listing/${listingSlug}` : '/';

    await Promise.allSettled(
      followers.map(async (f) => {
        await createNotification({
          userId: f.follower,
          title,
          message,
          type: 'follow',
          link,
          referenceId: sellerId,
          eventType: 'new_listing_from_followed_seller'
        });
        if (io) {
          await emitNewNotificationToUser(io, f.follower);
        }
      })
    );
  } catch (err) {
    console.error('notifyFollowersNewListing error:', err.message);
  }
}

module.exports = {
  createNotification,
  shouldSendEmail,
  checkAndSetOutbidDebounce,
  notifyNewProposal,
  notifyNewBid,
  notifyBidderOutbid,
  notifyOfferPlaced,
  notifyOfferOutbid,
  notifyProposalAccepted,
  notifyProposalDeclined,
  notifySellerBestOfferEnded,
  notifyListingRemoved,
  notifyListingRequiresChanges,
  notifyItemAddedToWatchlist,
  notifyPrivateRoomInvitation,
  notifyPrivateRoomAccepted,
  notifyPrivateRoomDeclined,
  notifyPrivateRoomClosedNoAcceptanceSeller,
  notifyPrivateRoomClosedNoAcceptanceInvited,
  notifyRoomCancelled,
  notifyItemMarkedShipped,
  notifyTrackingProvided,
  notifyItemMarkedDelivered,
  notifyShippingDeadlineStarted,
  notifyShippingDeadlineApproaching,
  notifySellerShippingFinalTwoDays,
  notifySellerBuyerRemindedShip,
  notifyBuyerOrderCancelledNoShipment,
  notifySellerOrderCancelledNoShipment,
  notifyBuyerConfirmedReceipt,
  notifyDisputeOpened,
  notifyEvidenceSubmitted,
  notifyDisputeDecisionIssued,
  notifyStrikeApplied,
  notifyAccountRestricted,
  notifyAccountSuspended,
  notifyAccountReactivated,
  notifyAccountClosed,
  notifyLoginFromNewDevice,
  notifySellerWinnerSelected,
  notifyBuyerAuctionWon,
  notifySellerStripeRequiredForOffer,
  notifySellerPaymentReceived,
  notifyBuyerSellerAccepted,
  notifyReviewPrompt,
  notifyBuyerPaymentDeadlineWarning,
  notifyBuyerNonPayment,
  notifySellerBuyerNonPayment,
  notifySecondBidderSecondChance,
  notifyDamageClaimOpened,
  notifyDamageClaimResolved,
  notifyFollowersNewListing,
  emitNewNotificationToUser
};
