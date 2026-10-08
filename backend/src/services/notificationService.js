const Notification = require('../models/Notification');
const Customer = require('../models/Customer');
const NotificationPreferences = require('../models/NotificationPreferences');
const Follow = require('../models/Follow');
const CategoryFollow = require('../models/CategoryFollow');
const Watchlist = require('../models/Watchlist');
const Listing = require('../models/Listing');
const { reviewNotificationCopy } = require('./listingReviewMessages');
const { giveawayNotificationCopy, formatEntry, resolveLanguage } = require('./giveawayMessages');
const { transactionReviewPromptCopy } = require('./transactionReviewMessages');
const { sendEmail } = require('./emailService');
const { renderEmailTemplate } = require('./templateEngine');
const { publicBaseUrl } = require('../utils/publicUrls');
const logger = require('../utils/logger');

/**
 * A stand-in for data that is not on file, as a key rather than as text.
 *
 * The English literals ("your listing", "the item") used to be dropped
 * straight into the message, so a Portuguese reader whose listing title was
 * missing got one English phrase mid-sentence. Marking it `{ t: key }` lets
 * the client translate the stand-in along with everything else.
 */
function standIn(name) {
  return { t: `notifications.standIn.${name}` };
}

/**
 * Money, formatted once. Every notifier wrote `€${(x || 0).toFixed(2)}` by
 * hand; as a parameter it is the client that decides where the symbol goes.
 */
function euros(amount) {
  return Number(amount || 0).toFixed(2);
}

/**
 * The shipping line of an auction-ended notification, as a parameter.
 *
 * A money amount is already the same in every language and passes through as
 * text; every other option was an English word ('Free', 'Meet in Person')
 * built by formatShippingForPricing, and those words survived into all four
 * languages. Those become a key instead.
 */
function shippingParam(shippingOption, shippingCost = 0) {
  const label = (name) => ({ t: `notifications.shipping.${name}` });
  if (shippingOption === 'free') return label('free');
  if (shippingOption === 'local-pickup') return label('localPickup');
  if (shippingOption === 'calculated') return label('calculated');
  if (shippingOption === 'flat-rate') {
    const cost = Number(shippingCost) || 0;
    return cost > 0 ? `€${cost.toFixed(2)}` : label('free');
  }
  return label('unknown');
}

/** How a manual payment was handed over. Anything unrecognised passes through. */
const PAYMENT_METHODS = new Set(['in_person', 'bank_transfer', 'mbway']);
function paymentMethodParam(method) {
  return PAYMENT_METHODS.has(method)
    ? { t: `notifications.paymentMethod.${method}` }
    : String(method || '');
}

/** How long ago the transaction closed. Anything unrecognised passes through. */
const MILESTONES = new Set(['24h', '48h', '7d']);
function milestoneParam(milestone) {
  return MILESTONES.has(milestone)
    ? { t: `notifications.milestone.${milestone}` }
    : String(milestone || '');
}

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
 * | Proposal accepted         | /dashboard/transactions         |
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
    const user = await Customer.findById(userMongoId).select('uid').lean();
    if (user?.uid) {
      io.to(`user:${user.uid}`).emit('new-notification');
    }
  } catch (err) {
    logger.error('Failed to emit new-notification:', err);
  }
}

/**
 * Emit 'new-notification' and 'private-room-invitation' to the invited bidder's personal socket room.
 * Single DB lookup for both events.
 * @param {object} io - Socket.io instance
 * @param {string} userMongoId - Mongo User _id
 * @param {{ listingId: string, listingTitle: string }} payload
 */
async function emitPrivateRoomInvitationToUser(io, userMongoId, { listingId, listingTitle }) {
  if (!io || !userMongoId) return;
  try {
    const user = await Customer.findById(userMongoId).select('uid').lean();
    if (user?.uid) {
      const room = `user:${user.uid}`;
      io.to(room).emit('new-notification');
      io.to(room).emit('private-room-invitation', { listingId, listingTitle });
    }
  } catch (err) {
    logger.error('Failed to emit private-room-invitation:', err);
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
 * @param {string} [options.i18nKey] - Catalogue key the client renders from (e.g. 'notifications.newBid'). `title`/`message` become the English fallback.
 * @param {object} [options.i18nParams] - Values to interpolate; `{ t: 'key' }` marks a value that is itself translated.
 * @returns {Promise<Notification|null>}
 */
async function createNotification({ userId, title, message, type = 'system', link = null, referenceId = null, eventType = null, i18nKey = null, i18nParams = null }) {
  try {
    if (eventType) {
      const prefs = await NotificationPreferences.findOne({ user: userId })
        .select(`globalEmailUnsubscribed ${eventType}`)
        .lean();
      if (prefs?.globalEmailUnsubscribed) return null;
      if (prefs && prefs[eventType] && prefs[eventType].inApp === false) return null;
    }

    const notification = new Notification({
      user: userId,
      title,
      message,
      type,
      link: link || null,
      referenceId: referenceId || null,
      i18nKey: i18nKey || null,
      i18nParams: i18nKey ? (i18nParams || {}) : null,
      status: 'unread',
      issuedAt: new Date()
    });
    await notification.save();
    return notification;
  } catch (err) {
    logger.error('Failed to create notification:', err);
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
    message: `${bidderName} placed a bid of €${(bidAmount || 0).toFixed(2)} on "${listingTitle || 'your listing'}"`,
    i18nKey: 'notifications.newBid',
    i18nParams: { bidderName: bidderName || standIn('someone'), amount: euros(bidAmount), listingTitle: listingTitle || standIn('yourListing') },
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
    message: `Your bid of €${prev} on "${listingTitle || 'this auction'}" was exceeded. Current high bid: €${next}.`,
    i18nKey: 'notifications.bidderOutbid',
    i18nParams: { previousBid: prev, currentBid: next, listingTitle: listingTitle || standIn('thisAuction') },
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
    message: `${offererName} made an offer of €${(offerAmount || 0).toFixed(2)} on "${listingTitle || 'your listing'}"`,
    i18nKey: 'notifications.newProposal',
    i18nParams: { offererName: offererName || standIn('someone'), amount: euros(offerAmount), listingTitle: listingTitle || standIn('yourListing') },
    type: 'proposal',
    link,
    referenceId: listingId
  });
}

/** Proposal accepted - notify buyer to complete payment in Transactions */
async function notifyProposalAccepted({ listingSlug, listingTitle, offerAmount, buyerUserId }) {
  return createNotification({
    userId: buyerUserId,
    title: 'Offer accepted — complete payment',
    message: `Your offer of €${(offerAmount || 0).toFixed(2)} on "${listingTitle || 'the item'}" was accepted. Open Transactions to complete payment.`,
    i18nKey: 'notifications.proposalAccepted',
    i18nParams: { amount: euros(offerAmount), listingTitle: listingTitle || standIn('theItem') },
    type: 'transaction',
    link: '/dashboard/transactions',
    referenceId: listingSlug || null
  });
}

/** Proposal declined - notify buyer */
async function notifyProposalDeclined({ listingSlug, listingTitle, offerAmount, buyerUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}?tab=offers` : null;
  return createNotification({
    userId: buyerUserId,
    title: 'Proposal declined',
    message: `Your offer of €${(offerAmount || 0).toFixed(2)} on "${listingTitle || 'the item'}" was declined.`,
    i18nKey: 'notifications.proposalDeclined',
    i18nParams: { amount: euros(offerAmount), listingTitle: listingTitle || standIn('theItem') },
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
    message: `Your offer of €${(offerAmount || 0).toFixed(2)} on "${listingTitle || 'the item'}" has been received.`,
    i18nKey: 'notifications.offerPlaced',
    i18nParams: { amount: euros(offerAmount), listingTitle: listingTitle || standIn('theItem') },
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
    message: `Your offer of €${(previousOffer || 0).toFixed(2)} on "${listingTitle || 'the item'}" was exceeded. Someone offered €${(newOffer || 0).toFixed(2)}.`,
    i18nKey: 'notifications.offerOutbid',
    i18nParams: { previousOffer: euros(previousOffer), newOffer: euros(newOffer), listingTitle: listingTitle || standIn('theItem') },
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
    i18nKey: 'notifications.bestOfferEnded',
    i18nParams: { listingTitle: listingTitle || standIn('theItem'), offerCount },
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
    i18nKey: 'notifications.listingRemoved',
    i18nParams: { listingTitle: listingTitle || standIn('yourListing') },
    type: 'listing',
    link: '/dashboard/seller',
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
    i18nKey: 'notifications.listingRequiresChanges',
    i18nParams: { listingTitle: listingTitle || standIn('yourListing') },
    type: 'listing',
    link,
    referenceId: listingSlug
  });
}

/**
 * Manual review outcome — notify the seller in their own language.
 *
 * The seller's language is read here rather than passed in so every caller
 * cannot get it wrong independently; callers only know the listing.
 */
async function notifyListingReviewed({ listingSlug, listingTitle, sellerUserId, decision, reason = null }) {
  const seller = await Customer.findById(sellerUserId).select('language').lean();
  const { title, message } = reviewNotificationCopy(
    decision,
    seller?.language,
    listingTitle || listingSlug || '',
    reason
  );

  // Approved goes to the live listing; rejected goes to the dashboard, which is
  // the only place a cancelled listing is still reachable.
  const link = decision === 'approved' && listingSlug
    ? `/listing/${listingSlug}`
    : '/dashboard/seller';

  return createNotification({
    userId: sellerUserId,
    title,
    message,
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
    i18nKey: 'notifications.itemAddedToWatchlist',
    i18nParams: { watcherName: watcherName || standIn('someone'), listingTitle: listingTitle || standIn('yourListing') },
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
    i18nKey: 'notifications.privateRoomInvitation',
    i18nParams: { listingTitle: listingTitle || standIn('anAuction') },
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
    i18nKey: 'notifications.privateRoomAccepted',
    i18nParams: { bidderName: bidderName || standIn('aBidder'), listingTitle: listingTitle || standIn('yourListing') },
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
    i18nKey: 'notifications.privateRoomDeclined',
    i18nParams: { bidderName: bidderName || standIn('aBidder'), listingTitle: listingTitle || standIn('yourListing') },
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
    i18nKey: 'notifications.privateRoomClosedNoAcceptance',
    i18nParams: { listingTitle: listingTitle || standIn('yourListing') },
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
    i18nKey: 'notifications.privateRoomClosedNoAcceptance',
    i18nParams: { listingTitle: listingTitle || standIn('theAuction') },
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
    i18nKey: 'notifications.sellerLeftRoomSeller',
    i18nParams: { listingTitle: listingTitle || standIn('yourListing') },
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
    i18nKey: 'notifications.sellerLeftRoomBuyers',
    i18nParams: { listingTitle: listingTitle || standIn('theAuction') },
    type: 'private_room',
    link,
    referenceId: listingSlug
  });
}

/** Room cancelled by seller - notify bidders */
async function notifyRoomCancelled({ listingSlug, listingTitle, bidderUserId }) {
  const link = listingSlug ? `/listing/${listingSlug}` : '/dashboard/buyer';
  return createNotification({
    userId: bidderUserId,
    title: 'Private room cancelled',
    message: `The private room for "${listingTitle || 'the auction'}" was cancelled by the seller.`,
    i18nKey: 'notifications.roomCancelled',
    i18nParams: { listingTitle: listingTitle || standIn('theAuction') },
    type: 'private_room',
    link,
    referenceId: listingSlug
  });
}

/** Item marked as shipped - notify buyer */
async function notifyItemMarkedShipped({ transactionId, listingTitle, buyerUserId }) {
  const link = transactionId
    ? `/dashboard/buyer?tab=transactions#transaction-${transactionId}`
    : '/dashboard/buyer?tab=transactions';
  return createNotification({
    userId: buyerUserId,
    title: 'Item shipped',
    message: `"${listingTitle || 'Your item'}" has been marked as shipped.`,
    i18nKey: 'notifications.itemShipped',
    i18nParams: { listingTitle: listingTitle || standIn('yourItem') },
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

/** Tracking number provided - notify buyer */
async function notifyTrackingProvided({ transactionId, listingTitle, buyerUserId }) {
  const link = transactionId
    ? `/dashboard/buyer?tab=transactions#transaction-${transactionId}`
    : '/dashboard/buyer?tab=transactions';
  return createNotification({
    userId: buyerUserId,
    title: 'Tracking number added',
    message: `A tracking number was added for "${listingTitle || 'your item'}".`,
    i18nKey: 'notifications.trackingProvided',
    i18nParams: { listingTitle: listingTitle || standIn('yourItem') },
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

/** Item marked as delivered - notify buyer */
async function notifyItemMarkedDelivered({ transactionId, listingTitle, buyerUserId }) {
  const link = transactionId
    ? `/dashboard/buyer?tab=transactions#transaction-${transactionId}`
    : '/dashboard/buyer?tab=transactions';
  return createNotification({
    userId: buyerUserId,
    title: 'Item delivered',
    message: `"${listingTitle || 'Your item'}" has been marked as delivered.`,
    i18nKey: 'notifications.itemDelivered',
    i18nParams: { listingTitle: listingTitle || standIn('yourItem') },
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

/** Shipping deadline started - notify seller */
async function notifyShippingDeadlineStarted({ transactionId, listingTitle, sellerUserId }) {
  const link = transactionId
    ? `/dashboard/seller?tab=transactions#transaction-${transactionId}`
    : '/dashboard/seller?tab=transactions';
  return createNotification({
    userId: sellerUserId,
    title: 'Shipping deadline started',
    message: `Ship "${listingTitle || 'the item'}" by the handling deadline.`,
    i18nKey: 'notifications.shippingDeadlineStarted',
    i18nParams: { listingTitle: listingTitle || standIn('theItem') },
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

/** Shipping deadline approaching - notify seller */
async function notifyShippingDeadlineApproaching({ transactionId, listingTitle, sellerUserId }) {
  const link = transactionId
    ? `/dashboard/seller?tab=transactions#transaction-${transactionId}`
    : '/dashboard/seller?tab=transactions';
  return createNotification({
    userId: sellerUserId,
    title: 'Shipping deadline soon',
    message: `The shipping deadline for "${listingTitle || 'the item'}" is approaching.`,
    i18nKey: 'notifications.shippingDeadlineApproaching',
    i18nParams: { listingTitle: listingTitle || standIn('theItem') },
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

async function notifySellerShippingFinalTwoDays({ transactionId, listingTitle, sellerUserId }) {
  const link = transactionId
    ? `/dashboard/seller?tab=transactions#transaction-${transactionId}`
    : '/dashboard/seller?tab=transactions';
  return createNotification({
    userId: sellerUserId,
    title: 'Ship soon — 2 days left',
    message: `You have 2 business days left to ship "${listingTitle || 'this order'}" or it will be cancelled and the buyer refunded.`,
    i18nKey: 'notifications.shippingFinalTwoDays',
    i18nParams: { listingTitle: listingTitle || standIn('thisOrder') },
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

async function notifyBuyerOrderCancelledNoShipment({ transactionId, listingTitle, buyerUserId }) {
  const link = transactionId
    ? `/dashboard/buyer?tab=transactions#transaction-${transactionId}`
    : '/dashboard/buyer?tab=transactions';
  return createNotification({
    userId: buyerUserId,
    title: 'Order cancelled — refund issued',
    message: `Your order for "${listingTitle || 'the item'}" was cancelled because the seller did not ship in time. You have been refunded in full.`,
    i18nKey: 'notifications.orderCancelledNoShipmentBuyer',
    i18nParams: { listingTitle: listingTitle || standIn('theItem') },
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

async function notifySellerOrderCancelledNoShipment({ transactionId, listingTitle, sellerUserId }) {
  const link = transactionId
    ? `/dashboard/seller?tab=transactions#transaction-${transactionId}`
    : '/dashboard/seller?tab=transactions';
  return createNotification({
    userId: sellerUserId,
    title: 'Order cancelled — did not ship in time',
    message: `The order for "${listingTitle || 'your sale'}" was cancelled automatically because you did not ship within the required timeframe. The buyer has been refunded.`,
    i18nKey: 'notifications.orderCancelledNoShipmentSeller',
    i18nParams: { listingTitle: listingTitle || standIn('yourSale') },
    type: 'shipping',
    link,
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
    i18nKey: 'notifications.buyerConfirmedReceipt',
    i18nParams: { buyerName: buyerName || standIn('theBuyer'), listingTitle: listingTitle || standIn('theItem') },
    type: 'shipping',
    link,
    referenceId: transactionId
  });
}

/** Ask buyer to confirm receipt of a shipped item */
async function notifyBuyerConfirmReceiptReminder({ transactionId, listingTitle, buyerUserId }) {
  const link = transactionId
    ? `/dashboard/buyer?tab=transactions#transaction-${transactionId}`
    : '/dashboard/buyer?tab=transactions';
  return createNotification({
    userId: buyerUserId,
    title: 'Confirm you received your item',
    message: `Has "${listingTitle || 'your item'}" arrived? Confirm receipt so the seller can be paid.`,
    i18nKey: 'notifications.confirmReceiptReminder',
    i18nParams: { listingTitle: listingTitle || standIn('yourItem') },
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
    i18nKey: 'notifications.disputeOpened',
    i18nParams: { openerName: openerName || standIn('aParty'), listingTitle: listingTitle || standIn('theTransaction') },
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
    i18nKey: 'notifications.evidenceSubmitted',
    i18nParams: { listingTitle: listingTitle || standIn('theTransaction') },
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
    i18nKey: 'notifications.disputeDecision',
    i18nParams: { listingTitle: listingTitle || standIn('theTransaction'), verdict },
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
    i18nKey: reason ? 'notifications.strikeAppliedWithReason' : 'notifications.strikeApplied',
    i18nParams: reason ? { reason } : {},
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
    i18nKey: 'notifications.accountRestricted',
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
    i18nKey: 'notifications.accountSuspended',
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
    i18nKey: 'notifications.accountReactivated',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'reactivation'
  });
}

/** Content-policy restriction lifted early by an admin */
async function notifyContentRestrictionLifted({ userId }) {
  return createNotification({
    userId,
    title: 'Restriction lifted',
    message: 'Your content policy restriction has been lifted by our team. You can create and edit listings again.',
    i18nKey: 'notifications.contentRestrictionLifted',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'content-restriction-lifted'
  });
}

/** Seller accepted payment — notify buyer */
async function notifyBuyerSellerAccepted({ transactionId, listingTitle, buyerUserId }) {
  const link = transactionId
    ? `/dashboard/buyer?tab=transactions#transaction-${transactionId}`
    : '/dashboard/buyer?tab=transactions';
  return createNotification({
    userId: buyerUserId,
    title: 'Seller accepted your payment',
    message: `The seller has accepted your payment for "${listingTitle || 'the item'}". They will prepare and ship your order soon.`,
    i18nKey: 'notifications.sellerAcceptedPayment',
    i18nParams: { listingTitle: listingTitle || standIn('theItem') },
    type: 'transaction',
    link,
    referenceId: transactionId
  });
}

/**
 * Buyer paid — notify seller.
 *
 * shipTo carries the buyer's delivery address on one line. It belongs here and
 * not only on the transaction page: a seller who could not find the address
 * anywhere in the notification opened a support ticket to ask where to ship.
 */
async function notifySellerPaymentReceived({ transactionId, listingTitle, buyerName, shipTo, sellerUserId }) {
  const link = transactionId
    ? `/dashboard/seller?tab=transactions#transaction-${transactionId}`
    : '/dashboard/seller?tab=transactions';
  const who = buyerName || 'A buyer';
  const shipLine = shipTo ? ` Ship to ${who}, ${shipTo}.` : '';
  return createNotification({
    userId: sellerUserId,
    title: 'Payment received',
    message: `${who} paid for "${listingTitle || 'your listing'}". Prepare and ship the order.${shipLine}`,
    // The address sentence is a whole clause with its own word order, so
    // whether there is an address picks the key rather than appending text.
    i18nKey: shipTo ? 'notifications.paymentReceivedWithAddress' : 'notifications.paymentReceived',
    i18nParams: {
      buyerName: buyerName || standIn('aBuyer'),
      listingTitle: listingTitle || standIn('yourListing'),
      ...(shipTo ? { shipTo } : {})
    },
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
    message: `Your listing "${listingTitle || 'the item'}" has a qualifying offer of €${(offerAmount || 0).toFixed(2)}. Connect your Stripe account in Settings → Payments to accept it.`,
    i18nKey: 'notifications.stripeRequiredForOffer',
    i18nParams: { listingTitle: listingTitle || standIn('theItem'), amount: euros(offerAmount) },
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
    i18nKey: 'notifications.accountClosed',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'account_closed'
  });
}

/** User's restriction-appeal was approved by an admin */
async function notifyAppealApproved({ userId }) {
  return createNotification({
    userId,
    title: 'Appeal approved',
    message: 'Your appeal has been reviewed and your account restriction has been lifted. You can create and edit listings again.',
    i18nKey: 'notifications.appealApproved',
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'appeal_approved'
  });
}

/** User's restriction-appeal was rejected by an admin */
async function notifyAppealRejected({ userId, adminResponse }) {
  return createNotification({
    userId,
    title: 'Appeal reviewed',
    message: adminResponse
      ? `Your appeal was reviewed: ${adminResponse}`
      : 'Your appeal was reviewed and the restriction remains in place. If you have questions, please contact support.',
    i18nKey: adminResponse ? 'notifications.appealRejected' : 'notifications.appealRejectedNoResponse',
    i18nParams: adminResponse ? { adminResponse } : {},
    type: 'account',
    link: '/dashboard/my-account',
    referenceId: 'appeal_rejected'
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
    return cost > 0 ? `€${cost.toFixed(2)}` : 'Free';
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
  const link = '/dashboard/seller?tab=transactions';
  const amount = Number(winningAmount) || 0;
  const bidRoomFee = amount * (Number(commissionRate) || 0);
  const shippingDisplay = formatShippingForPricing(shippingOption, shippingCost);

  let message = `${winnerName || 'A bidder'} won "${listingTitle || 'your listing'}" with a bid of €${amount.toFixed(2)}.`;
  message += ` Pricing: Final price €${amount.toFixed(2)}; BidRoom fee €${bidRoomFee.toFixed(2)}; Shipping (buyer pays): ${shippingDisplay}.`;

  return createNotification({
    userId: sellerUserId,
    title: 'Auction ended – winner selected',
    message,
    i18nKey: 'notifications.winnerSelected',
    i18nParams: {
      winnerName: winnerName || standIn('aBidder'),
      listingTitle: listingTitle || standIn('yourListing'),
      amount: amount.toFixed(2),
      fee: bidRoomFee.toFixed(2),
      shipping: shippingParam(shippingOption, shippingCost)
    },
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
  const link = '/dashboard/buyer?tab=transactions';
  const amount = Number(winningAmount) || 0;
  const shippingDisplay = formatShippingForPricing(shippingOption, shippingCost);

  let message = `Congratulations! You won "${listingTitle || 'the listing'}" with your bid of €${amount.toFixed(2)}.`;
  message += ` Pricing: Item €${amount.toFixed(2)}; Shipping: ${shippingDisplay}.`;
  message += ' Complete payment to proceed.';

  return createNotification({
    userId: buyerUserId,
    title: 'You won the auction!',
    message,
    i18nKey: 'notifications.auctionWon',
    i18nParams: {
      listingTitle: listingTitle || standIn('theListing'),
      amount: amount.toFixed(2),
      shipping: shippingParam(shippingOption, shippingCost)
    },
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
    i18nKey: deviceInfo ? 'notifications.loginNewDevice' : 'notifications.loginNewDeviceUnknown',
    i18nParams: deviceInfo ? { deviceInfo } : {},
    type: 'security',
    link: '/dashboard/my-account',
    referenceId: 'login'
  });
}

/**
 * Notify both buyer and seller to leave a review after a transaction completes.
 * Each party gets role-specific copy in their own language, naming the listing.
 * @param {{ buyerId, sellerId, listingTitle?, listingId?, transactionId, io }}
 */
async function notifyReviewPrompt({ buyerId, sellerId, listingTitle, listingId, transactionId, io }) {
  let resolvedTitle = String(listingTitle || '').trim();
  if (!resolvedTitle && listingId) {
    const listing = await Listing.findById(listingId).select('title').lean();
    resolvedTitle = listing?.title || '';
  }

  const ids = [buyerId, sellerId].filter(Boolean).map(id => id.toString?.() || String(id));
  const people = ids.length
    ? await Customer.find({ _id: { $in: ids } }).select('_id language').lean()
    : [];
  const languageById = new Map(people.map(p => [String(p._id), p.language]));

  const link = transactionId
    ? `/dashboard/transactions#transaction-${transactionId}`
    : '/dashboard/transactions';

  const jobs = [];
  if (buyerId) {
    const { title, message } = transactionReviewPromptCopy(
      'buyer',
      languageById.get(String(buyerId)),
      resolvedTitle
    );
    jobs.push(createNotification({
      userId: buyerId,
      title,
      message,
      type: 'review',
      link,
      referenceId: transactionId
    }));
  }
  if (sellerId) {
    const { title, message } = transactionReviewPromptCopy(
      'seller',
      languageById.get(String(sellerId)),
      resolvedTitle
    );
    jobs.push(createNotification({
      userId: sellerId,
      title,
      message,
      type: 'review',
      link,
      referenceId: transactionId
    }));
  }

  await Promise.allSettled(jobs);

  if (io) {
    await Promise.allSettled(
      [buyerId, sellerId].filter(Boolean).map(id => emitNewNotificationToUser(io, id))
    );
  }
}

/** Private-room payment deadline approaching — warn buyer 1h before expiry */
async function notifyBuyerPaymentDeadlineWarning({ buyerId, listingTitle, listingSlug, deadlineAt }) {
  const link = `/dashboard/buyer?tab=transactions`;
  return createNotification({
    userId: buyerId,
    title: 'Payment deadline approaching',
    message: `You have less than 1 hour to complete payment for "${listingTitle || 'the item'}". Failure to pay will result in a reputation penalty.`,
    i18nKey: 'notifications.paymentDeadlineWarning',
    i18nParams: { listingTitle: listingTitle || standIn('theItem') },
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
    warning: `Your payment window for "${listingTitle || 'the item'}" expired. A ${penaltyPoints}-point reputation penalty was applied, a 2/5 BidRoom review was added to your profile, and the listing has been automatically relisted.`,
    final_warning: `Payment expired for "${listingTitle || 'the item'}". A ${penaltyPoints}-point penalty and a 2/5 BidRoom review were applied. This is your 2nd non-payment — one more will result in a permanent account ban.`,
    ban: `Payment expired for "${listingTitle || 'the item'}". This is your 3rd non-payment. Your account has been suspended.`
  };
  // The three levels are different sentences, not one with a number in it:
  // the second names the consequence of a third, the third says it happened.
  const keys = {
    warning: 'notifications.nonPaymentWarning',
    final_warning: 'notifications.nonPaymentFinalWarning',
    ban: 'notifications.nonPaymentBan'
  };
  await createNotification({
    userId: buyerId,
    title: 'Payment deadline expired',
    message: messages[warningLevel],
    i18nKey: keys[warningLevel],
    i18nParams: { listingTitle: listingTitle || standIn('theItem'), penaltyPoints },
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
    : `The winning bidder for "${listingTitle}" did not pay. Your listing has been automatically relisted with the same conditions.`;
  await createNotification({
    userId: sellerId,
    title: 'Buyer did not pay',
    message,
    i18nKey: hasSecondBidder
      ? 'notifications.buyerNonPaymentSecondBidder'
      : 'notifications.buyerNonPaymentRelisted',
    i18nParams: { listingTitle: listingTitle || standIn('yourListing') },
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
    i18nKey: 'notifications.secondChance',
    i18nParams: { listingTitle: listingTitle || standIn('theItem'), hours: paymentDeadlineHours },
    type: 'transaction',
    link,
    eventType: 'second_chance_offer'
  });
  if (io) await emitNewNotificationToUser(io, buyerId);
}

/** Damage claim opened — notify seller */
async function notifyDamageClaimOpened({ sellerId, buyerName, listingTitle, shippingType, transactionId, io }) {
  const link = transactionId
    ? `/dashboard/seller?tab=transactions#transaction-${transactionId}`
    : '/dashboard/seller?tab=transactions';
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
    // Who files the carrier claim is the whole point of the message, so the
    // shipping type picks the key rather than a clause inside one.
    i18nKey: isExternal
      ? 'notifications.damageClaimOpenedExternal'
      : 'notifications.damageClaimOpenedPlatform',
    i18nParams: {
      buyerName: buyerName || standIn('aBuyer'),
      listingTitle: listingTitle || standIn('anItem')
    },
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
    i18nKey: approved ? 'notifications.damageClaimApproved' : 'notifications.damageClaimUpdate',
    i18nParams: { listingTitle: listingTitle || standIn('theItem') },
    type: 'dispute',
    link,
    referenceId: transactionId,
    eventType: 'damage_claim_resolved'
  });

  if (io) await emitNewNotificationToUser(io, buyerId);
}

async function notifyCategoryFollowersNewListing({ category, listingTitle, listingSlug, sellerUserId, io }) {
  try {
    if (!category) return;
    const followers = await CategoryFollow.find({ category: category.toLowerCase(), muted: { $ne: true } }).lean();
    if (!followers.length) return;

    const title = 'New listing in a category you follow';
    const message = listingTitle || 'Check it out now';
    const i18nParams = { listingTitle: listingTitle || standIn('newListingGeneric') };
    const link = listingSlug ? `/listing/${listingSlug}` : '/listing/list';

    await Promise.allSettled(
      followers.map(async (f) => {
        if (sellerUserId && f.user.toString() === sellerUserId.toString()) return;
        await createNotification({
          userId: f.user,
          title,
          message,
          i18nKey: 'notifications.categoryFollowNewListing',
          i18nParams,
          type: 'follow',
          link,
          referenceId: listingSlug || null,
          eventType: 'new_listing_in_followed_category'
        });
        if (io) await emitNewNotificationToUser(io, f.user.toString());
      })
    );
  } catch (err) {
    logger.error('notifyCategoryFollowersNewListing error:', err.message);
  }
}

async function notifySimilarItemWatchers({ category, startingPrice, listingTitle, listingSlug, newListingId, sellerUserId, io }) {
  try {
    if (!category) return;

    // Find listings in the same category within ±50% price range
    const minPrice = startingPrice * 0.5;
    const maxPrice = startingPrice * 1.5;
    const similarListings = await Listing.find({
      _id: { $ne: newListingId },
      category: category.toLowerCase(),
      startingPrice: { $gte: minPrice, $lte: maxPrice },
      status: { $in: ['active', 'ended'] }
    }).select('_id').lean();

    if (!similarListings.length) return;
    const similarIds = similarListings.map(l => l._id);

    // Find users who have any of those similar listings in their watchlist
    const watchlistEntries = await Watchlist.find({ listing: { $in: similarIds } })
      .select('user listing')
      .lean();

    // Deduplicate by user
    const notifiedUsers = new Set();
    await Promise.allSettled(
      watchlistEntries.map(async (entry) => {
        const uid = entry.user.toString();
        if (notifiedUsers.has(uid)) return;
        if (sellerUserId && uid === sellerUserId.toString()) return;
        notifiedUsers.add(uid);

        await createNotification({
          userId: entry.user,
          title: 'Similar item to one you\'re watching',
          message: listingTitle || 'A similar item just went live',
          i18nKey: 'notifications.similarItem',
          i18nParams: { listingTitle: listingTitle || standIn('similarItemGeneric') },
          type: 'watchlist',
          link: listingSlug ? `/listing/${listingSlug}` : '/',
          referenceId: listingSlug || null,
          eventType: 'similar_item_available'
        });
        if (io) await emitNewNotificationToUser(io, uid);
      })
    );
  } catch (err) {
    logger.error('notifySimilarItemWatchers error:', err.message);
  }
}

async function notifyWatchlistersAuctionEnding({ listingId, listingTitle, listingSlug, isGiveaway = false, io }) {
  try {
    const refId = `ending-soon:${listingId}`;
    const watchers = await Watchlist.find({ listing: listingId }).select('user').lean();
    if (!watchers.length) return;

    await Promise.allSettled(
      watchers.map(async (w) => {
        // Deduplicate: skip if we already sent this ending-soon notification
        const existing = await Notification.findOne({
          user: w.user,
          referenceId: refId,
          issuedAt: { $gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }
        }).lean();
        if (existing) return;

        await createNotification({
          userId: w.user,
          // A giveaway "ending" means the last chance to enter, not the last
          // chance to bid — telling a watcher to hurry and bid on something
          // free would send them looking for a button that is not there.
          title: isGiveaway ? 'Last chance to enter' : 'Auction ending soon',
          message: listingTitle || (isGiveaway
            ? 'A giveaway in your watchlist closes to entries in less than an hour'
            : 'An item in your watchlist is ending in less than an hour'),
          i18nKey: isGiveaway ? 'notifications.giveawayLastChance' : 'notifications.auctionEndingSoon',
          i18nParams: {
            listingTitle: listingTitle || standIn(isGiveaway ? 'giveawayEndingGeneric' : 'endingSoonGeneric')
          },
          type: 'watchlist',
          link: listingSlug ? `/listing/${listingSlug}` : '/',
          referenceId: refId,
          eventType: 'watchlist_auction_ending'
        });
        if (io) await emitNewNotificationToUser(io, w.user.toString());
      })
    );
  } catch (err) {
    logger.error('notifyWatchlistersAuctionEnding error:', err.message);
  }
}

async function notifyFollowersNewListing({ sellerId, sellerFirstName, listingTitle, listingSlug, io }) {
  try {
    const followers = await Follow.find({ following: sellerId, muted: false }).lean();
    if (!followers.length) return;

    const title = sellerFirstName
      ? `${sellerFirstName} published a new listing`
      : 'New listing from a seller you follow';
    const message = listingTitle || 'Check it out now';
    // The seller's name is in the title, so with no name on file the title is
    // a different sentence rather than one with a hole in it.
    const i18nKey = sellerFirstName
      ? 'notifications.followedSellerNewListing'
      : 'notifications.followedSellerNewListingAnon';
    const i18nParams = {
      listingTitle: listingTitle || standIn('newListingGeneric'),
      ...(sellerFirstName ? { sellerFirstName } : {})
    };
    const link = listingSlug ? `/listing/${listingSlug}` : '/';

    await Promise.allSettled(
      followers.map(async (f) => {
        await createNotification({
          userId: f.follower,
          title,
          message,
          i18nKey,
          i18nParams,
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
    logger.error('notifyFollowersNewListing error:', err.message);
  }
}

/**
 * Notify a private seller that their activity has exceeded DSA Article 29 thresholds.
 * Sends in-app notification. Email is handled separately by the scheduler (needs volume/count context).
 */
async function notifyDsaWarning({ userId, annualSalesEur, annualTransactionCount, io }) {
  const sales = annualSalesEur != null ? Math.round(annualSalesEur).toLocaleString() : null;
  const salesFormatted = sales != null ? `€${sales}` : null;
  const parts = [];
  if (salesFormatted) parts.push(`${salesFormatted} in sales`);
  if (annualTransactionCount != null) parts.push(`${annualTransactionCount} transactions`);
  const context = parts.length ? ` (${parts.join(', ')} this year)` : '';

  // The figures used to be joined into one English clause before being
  // dropped into the sentence, which put "in sales, N transactions this year"
  // inside an otherwise translated message. Which figures are on file picks
  // the key instead, so each variant is a whole sentence in each language.
  const hasSales = sales != null;
  const hasCount = annualTransactionCount != null;
  const i18nKey = hasSales && hasCount
    ? 'notifications.dsaWarningSalesAndCount'
    : hasSales
      ? 'notifications.dsaWarningSales'
      : hasCount
        ? 'notifications.dsaWarningCount'
        : 'notifications.dsaWarning';

  return createNotification({
    userId,
    type: 'account',
    title: 'Seller status review required',
    message: `Your selling activity${context} may qualify as professional selling under EU DSA regulations. Please confirm your seller status in your dashboard.`,
    i18nKey,
    i18nParams: {
      ...(hasSales ? { sales } : {}),
      ...(hasCount ? { count: annualTransactionCount } : {})
    },
    link: '/dashboard/home',
    io
  });
}

/**
 * Notify a seller that their account has been internally flagged as suspected_professional
 * after ignoring the initial DSA warning beyond the grace period.
 */
async function notifyDsaSuspectedProfessional({ userId, io }) {
  return createNotification({
    userId,
    type: 'account',
    title: 'Seller account flagged for review',
    message: 'Your account has been flagged for platform review. Your selling activity exceeds thresholds for private sellers under EU DSA regulations. Action is required to continue selling.',
    i18nKey: 'notifications.dsaSuspectedProfessional',
    link: '/dashboard/home',
    io
  });
}

/**
 * Send a review reminder to whichever party (or both) has not yet reviewed.
 * milestone: '24h' | '48h' | '7d'
 */
async function notifyReviewReminder({ buyerId, sellerId, listingTitle, transactionId, milestone, buyerHasReviewed, sellerHasReviewed, io }) {
  const milestoneLabel = { '24h': '24 hours', '48h': '48 hours', '7d': '1 week' }[milestone] ?? milestone;
  const title = 'Don\'t forget to leave a review';
  const message = `It's been ${milestoneLabel} since your transaction for "${listingTitle || 'an item'}". Share your experience — reviews help the community.`;
  const i18nParams = {
    milestone: milestoneParam(milestone),
    listingTitle: listingTitle || standIn('anItem')
  };
  const link = '/dashboard/transactions';

  const targets = [];
  if (!buyerHasReviewed)  targets.push(buyerId);
  if (!sellerHasReviewed) targets.push(sellerId);

  if (targets.length === 0) return;

  await Promise.allSettled(
    targets.map(uid => createNotification({
      userId: uid,
      title,
      message,
      i18nKey: 'notifications.reviewReminder',
      i18nParams,
      type: 'review',
      link,
      referenceId: transactionId
    }))
  );

  if (io) {
    await Promise.allSettled(targets.map(uid => emitNewNotificationToUser(io, uid)));
  }
}

async function notifySellerManualPaymentSent({ sellerId, buyerName, listingTitle, method, io }) {
  const methodLabels = {
    in_person: 'in person',
    bank_transfer: 'bank transfer',
    mbway: 'MB WAY',
  };
  const methodLabel = methodLabels[method] || method;
  const title = 'Buyer marked the payment as sent';
  const message = `${buyerName} marked the payment for "${listingTitle}" as sent by ${methodLabel}. Confirm once you have received it.`;
  const link = '/dashboard/buyer?tab=transactions';
  await createNotification({
    userId: sellerId,
    title,
    message,
    i18nKey: 'notifications.manualPaymentSent',
    i18nParams: {
      buyerName: buyerName || standIn('aBuyer'),
      listingTitle: listingTitle || standIn('yourListing'),
      method: paymentMethodParam(method)
    },
    type: 'transaction',
    link
  });
  if (io) emitNewNotificationToUser(io, sellerId).catch(() => {});
}

async function notifyPayoutSetupReminder({ sellerId, io }) {
  const title   = 'Set up your payout account';
  const message = 'You have active listings but no bank account set up yet. Set one up so you can be paid for your sales.';
  const link    = '/dashboard/settings?tab=payout';

  await createNotification({
    userId: sellerId,
    title,
    message,
    i18nKey: 'notifications.payoutSetupReminder',
    type: 'account',
    link
  });
  if (io) emitNewNotificationToUser(io, sellerId).catch(() => {});
}

/**
 * Confirm a giveaway entry, in the participant's own language: in-app and by
 * email. The email is the copy they keep — the number they will check against
 * the draw — so it is sent as a transactional message, not marketing.
 *
 * Never throws: a mail-server hiccup must not undo an entry that already
 * succeeded. Failures are logged.
 */
async function notifyGiveawayEntered({ listingId, listingSlug, listingTitle, participantUserId, entryNumber, io }) {
  const [participant, listing] = await Promise.all([
    Customer.findById(participantUserId).select('language firstName email').lean(),
    listingId
      ? Listing.findById(listingId).select('slug title titlePt titleEn titleEs titleFr').lean()
      : Promise.resolve(null)
  ]);

  const language = resolveLanguage(participant?.language);
  const localized = { pt: 'titlePt', en: 'titleEn', es: 'titleEs', fr: 'titleFr' }[language];
  const titleText = (listing && (listing[localized] || listing.title)) || listingTitle || '';
  const slug = listing?.slug || listingSlug || '';

  const { title, message } = giveawayNotificationCopy('entered', language, titleText, entryNumber);

  const notification = await createNotification({
    userId: participantUserId,
    title,
    message,
    type: 'listing',
    link: slug ? `/listing/${slug}` : null,
    referenceId: slug || null
  });
  if (io) emitNewNotificationToUser(io, String(participantUserId)).catch(() => {});

  if (participant?.email && slug) {
    try {
      const { subject, html } = renderEmailTemplate('giveawayEntered', language, {
        firstName: escapeEmailHtml(participant.firstName || ''),
        listingTitle: escapeEmailHtml(titleText),
        listingTitlePlain: String(titleText).replace(/[\r\n]+/g, ' '),
        entryNumber: formatEntry(entryNumber),
        listingUrl: escapeEmailHtml(`${publicBaseUrl()}/listing/${encodeURIComponent(slug)}`)
      });
      await sendEmail(participant.email, subject, html);
    } catch (err) {
      logger.error('[Giveaway] Entry email failed:', err.message);
    }
  } else if (!participant?.email) {
    logger.warn('[Giveaway] Entry email not sent: participant has no email', { participantUserId: String(participantUserId) });
  }

  return notification;
}

/** Tell the winner. */
async function notifyGiveawayWinner({ listingSlug, listingTitle, winnerUserId, entryNumber, io }) {
  const winner = await Customer.findById(winnerUserId).select('language').lean();
  const { title, message } = giveawayNotificationCopy('won', winner?.language, listingTitle || '', entryNumber);

  const notification = await createNotification({
    userId: winnerUserId,
    title,
    message,
    type: 'listing',
    link: listingSlug ? `/listing/${listingSlug}` : '/dashboard',
    referenceId: listingSlug || null
  });
  if (io) emitNewNotificationToUser(io, String(winnerUserId)).catch(() => {});
  return notification;
}

function escapeEmailHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Email the winner, in their language, and record when it went out.
 *
 * Sent regardless of notification preferences: this is not marketing, it is
 * the one message that tells someone they have a prize to collect, and the
 * rules promise it. The in-app notification alone is easy to miss for anyone
 * who entered once and never came back.
 *
 * Never throws. Returns { sent, emailedAt } so the caller can tell the admin
 * whether it worked — a draw is not undone because the mail server hiccupped;
 * Nexus offers to send it again instead.
 */
async function emailGiveawayWinner({ listingId, winnerUserId, entryNumber, totalEntries }) {
  try {
    const [listing, winner] = await Promise.all([
      Listing.findById(listingId).select('slug title titlePt titleEn titleEs titleFr').lean(),
      Customer.findById(winnerUserId).select('firstName email language').lean()
    ]);
    if (!listing || !winner?.email) {
      logger.warn('[Giveaway] Winner email not sent: listing or winner email missing', { listingId: String(listingId) });
      return { sent: false, emailedAt: null };
    }

    const language = resolveLanguage(winner.language);
    const localized = { pt: 'titlePt', en: 'titleEn', es: 'titleEs', fr: 'titleFr' }[language];
    const title = listing[localized] || listing.title || '';

    const { subject, html } = renderEmailTemplate('giveawayWon', language, {
      firstName: escapeEmailHtml(winner.firstName || ''),
      listingTitle: escapeEmailHtml(title),
      // Subject only: a mail header, where entities would show up literally.
      listingTitlePlain: title.replace(/[\r\n]+/g, ' '),
      entryNumber: formatEntry(entryNumber),
      totalEntries: Number(totalEntries) || 0,
      listingUrl: escapeEmailHtml(`${publicBaseUrl()}/listing/${encodeURIComponent(listing.slug)}`)
    });

    await sendEmail(winner.email, subject, html);

    const emailedAt = new Date();
    await Listing.updateOne({ _id: listing._id }, { $set: { 'giveaway.winnerEmailedAt': emailedAt } });
    return { sent: true, emailedAt };
  } catch (err) {
    logger.error('[Giveaway] Winner email failed:', err.message);
    return { sent: false, emailedAt: null };
  }
}

/**
 * Tell everyone who entered and did not win what the result was.
 *
 * "The winner is announced" is one of the four promises made on the entry
 * button, and an announcement only the winner sees is not an announcement.
 * Everyone who took part is told which number came out, so they can check it
 * against their own.
 */
async function notifyGiveawayResultToEntrants({ listingSlug, listingTitle, participantIds, winnerEntry, winnerUserId, io }) {
  try {
    const others = (participantIds || []).filter(id => String(id) !== String(winnerUserId));
    if (!others.length) return;

    const people = await Customer.find({ _id: { $in: others } }).select('language').lean();
    const languageById = new Map(people.map(p => [String(p._id), p.language]));

    await Promise.allSettled(
      others.map(async (id) => {
        const { title, message } = giveawayNotificationCopy(
          'notWon',
          languageById.get(String(id)),
          listingTitle || '',
          winnerEntry
        );
        await createNotification({
          userId: id,
          title,
          message,
          type: 'listing',
          link: listingSlug ? `/listing/${listingSlug}` : null,
          referenceId: listingSlug || null
        });
        if (io) await emitNewNotificationToUser(io, String(id));
      })
    );
  } catch (err) {
    logger.error('notifyGiveawayResultToEntrants error:', err.message);
  }
}

module.exports = {
  createNotification,
  shouldSendEmail,
  checkAndSetOutbidDebounce,
  emitPrivateRoomInvitationToUser,
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
  notifyListingReviewed,
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
  notifyBuyerOrderCancelledNoShipment,
  notifySellerOrderCancelledNoShipment,
  notifyBuyerConfirmedReceipt,
  notifyBuyerConfirmReceiptReminder,
  notifyDisputeOpened,
  notifyEvidenceSubmitted,
  notifyDisputeDecisionIssued,
  notifyStrikeApplied,
  notifyAccountRestricted,
  notifyAccountSuspended,
  notifyAccountReactivated,
  notifyContentRestrictionLifted,
  notifyAccountClosed,
  notifyAppealApproved,
  notifyAppealRejected,
  notifyLoginFromNewDevice,
  notifySellerWinnerSelected,
  notifyBuyerAuctionWon,
  notifySellerStripeRequiredForOffer,
  notifySellerPaymentReceived,
  notifyBuyerSellerAccepted,
  notifyReviewPrompt,
  notifyReviewReminder,
  notifyBuyerPaymentDeadlineWarning,
  notifyBuyerNonPayment,
  notifySellerBuyerNonPayment,
  notifySecondBidderSecondChance,
  notifyDamageClaimOpened,
  notifyDamageClaimResolved,
  notifyFollowersNewListing,
  notifyCategoryFollowersNewListing,
  notifySimilarItemWatchers,
  notifyWatchlistersAuctionEnding,
  emitNewNotificationToUser,
  notifyDsaWarning,
  notifyDsaSuspectedProfessional,
  notifyPayoutSetupReminder,
  notifySellerManualPaymentSent,
  notifyGiveawayEntered,
  notifyGiveawayWinner,
  emailGiveawayWinner,
  notifyGiveawayResultToEntrants,
  // Exported for the handful of createNotification calls that live outside
  // this file (support replies, reports, the auto-release scheduler) so they
  // name a stand-in the same way the notifiers here do.
  standIn
};
