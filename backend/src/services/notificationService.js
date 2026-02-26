const Notification = require('../models/Notification');
const User = require('../models/User');

/**
 * Notification link (returnUrl) mapping – each notification type navigates to the most relevant page:
 *
 * | Notification type           | Link destination                |
 * |----------------------------|---------------------------------|
 * | New bid received           | /listing/:slug?tab=bids        |
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
 * @returns {Promise<Notification|null>}
 */
async function createNotification({ userId, title, message, type = 'system', link = null, referenceId = null }) {
  try {
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

/** Buyer confirmed receipt - notify seller */
async function notifyBuyerConfirmedReceipt({ transactionId, listingTitle, buyerName, sellerUserId }) {
  return createNotification({
    userId: sellerUserId,
    title: 'Buyer confirmed receipt',
    message: `${buyerName || 'The buyer'} confirmed receipt of "${listingTitle || 'the item'}".`,
    type: 'shipping',
    link: `/dashboard/transactions`,
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

/**
 * Format shipping for pricing overview.
 * @param {string} shippingOption - flat-rate | calculated | local-pickup | free
 * @param {number} shippingCost - dollar amount (used for flat-rate)
 * @returns {string}
 */
function formatShippingForPricing(shippingOption, shippingCost = 0) {
  if (!shippingOption) return '—';
  if (shippingOption === 'free') return 'Free';
  if (shippingOption === 'local-pickup') return 'Local pickup';
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
  commissionRate = 0.005,
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

module.exports = {
  createNotification,
  notifyNewProposal,
  notifyNewBid,
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
  notifyRoomCancelled,
  notifyItemMarkedShipped,
  notifyTrackingProvided,
  notifyItemMarkedDelivered,
  notifyShippingDeadlineStarted,
  notifyShippingDeadlineApproaching,
  notifyBuyerConfirmedReceipt,
  notifyDisputeOpened,
  notifyEvidenceSubmitted,
  notifyDisputeDecisionIssued,
  notifyStrikeApplied,
  notifyAccountRestricted,
  notifyAccountSuspended,
  notifyAccountReactivated,
  notifyLoginFromNewDevice,
  notifySellerWinnerSelected,
  notifyBuyerAuctionWon,
  emitNewNotificationToUser
};
