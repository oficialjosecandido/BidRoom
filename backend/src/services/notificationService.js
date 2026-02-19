const Notification = require('../models/Notification');
const User = require('../models/User');

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

module.exports = {
  createNotification,
  notifyNewProposal,
  notifyNewBid,
  emitNewNotificationToUser
};
