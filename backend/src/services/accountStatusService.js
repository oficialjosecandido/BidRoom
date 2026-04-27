/**
 * Account status service: suspend, reactivate, close accounts.
 * Used when disputes open (suspend both) and when admin rules (reactivate/close).
 * Logs all changes to AccountStatusAuditLog and sends notifications.
 */

const User = require('../models/User');
const AccountStatusAuditLog = require('../models/AccountStatusAuditLog');
const { notifyAccountSuspended, notifyAccountReactivated, notifyAccountClosed, emitNewNotificationToUser } = require('./notificationService');
const Listing = require('../models/Listing');

const ACCOUNT_STATUS = { ACTIVE: 'active', SUSPENDED: 'suspended', CLOSED: 'closed' };

/**
 * Suspend a user (e.g. when dispute opens).
 * @param {string} userId - Mongo User _id
 * @param {object} metadata - { reason, transactionId, triggeredBy }
 * @param {object} io - Socket.io instance (optional)
 */
async function suspendUser(userId, metadata = {}, io = null) {
  const user = await User.findById(userId);
  if (!user) return { updated: false, reason: 'user_not_found' };
  if (user.accountStatus === ACCOUNT_STATUS.SUSPENDED) return { updated: false, reason: 'already_suspended' };
  if (user.accountStatus === ACCOUNT_STATUS.CLOSED) return { updated: false, reason: 'account_closed' };

  const previousStatus = user.accountStatus || ACCOUNT_STATUS.ACTIVE;
  user.accountStatus = ACCOUNT_STATUS.SUSPENDED;
  user.isActive = false;
  await user.save();

  await AccountStatusAuditLog.create({
    user: userId,
    previousStatus,
    newStatus: ACCOUNT_STATUS.SUSPENDED,
    reason: metadata.reason || 'dispute_opened',
    transactionId: metadata.transactionId || null,
    metadata: { triggeredBy: metadata.triggeredBy || 'system' }
  });

  await notifyAccountSuspended({ userId }).catch(err => console.error('Notify suspend:', err.message));
  if (io && user.uid) emitNewNotificationToUser(io, userId).catch(() => {});

  // End all active listings for this seller so buyers cannot bid on a suspended account's items
  Listing.updateMany(
    { seller: userId, status: 'active' },
    { $set: { status: 'ended', endDate: new Date() } }
  ).catch(err => console.error('Failed to end suspended seller listings:', err.message));

  return { updated: true };
}

/**
 * Reactivate a user (admin ruling: reactivate both or one party).
 */
async function reactivateUser(userId, metadata = {}, io = null) {
  const user = await User.findById(userId);
  if (!user) return { updated: false, reason: 'user_not_found' };
  if (user.accountStatus === ACCOUNT_STATUS.ACTIVE) return { updated: false, reason: 'already_active' };
  if (user.accountStatus === ACCOUNT_STATUS.CLOSED) return { updated: false, reason: 'account_closed' };

  const previousStatus = user.accountStatus || ACCOUNT_STATUS.SUSPENDED;
  user.accountStatus = ACCOUNT_STATUS.ACTIVE;
  user.isActive = true;
  await user.save();

  await AccountStatusAuditLog.create({
    user: userId,
    previousStatus,
    newStatus: ACCOUNT_STATUS.ACTIVE,
    reason: metadata.reason || 'dispute_resolved',
    transactionId: metadata.transactionId || null,
    metadata: { triggeredBy: metadata.triggeredBy || 'admin' }
  });

  await notifyAccountReactivated({ userId }).catch(err => console.error('Notify reactivate:', err.message));
  if (io && user.uid) emitNewNotificationToUser(io, userId).catch(() => {});

  return { updated: true };
}

/**
 * Permanently close a user account.
 */
async function closeUser(userId, metadata = {}, io = null) {
  const user = await User.findById(userId);
  if (!user) return { updated: false, reason: 'user_not_found' };
  if (user.accountStatus === ACCOUNT_STATUS.CLOSED) return { updated: false, reason: 'already_closed' };

  const previousStatus = user.accountStatus || ACCOUNT_STATUS.SUSPENDED;
  user.accountStatus = ACCOUNT_STATUS.CLOSED;
  user.isActive = false;
  await user.save();

  await AccountStatusAuditLog.create({
    user: userId,
    previousStatus,
    newStatus: ACCOUNT_STATUS.CLOSED,
    reason: metadata.reason || 'dispute_resolution',
    transactionId: metadata.transactionId || null,
    metadata: { triggeredBy: metadata.triggeredBy || 'admin' }
  });

  await notifyAccountClosed({ userId }).catch(err => console.error('Notify closed:', err.message));
  if (io && user.uid) emitNewNotificationToUser(io, userId).catch(() => {});

  return { updated: true };
}

/**
 * Suspend both buyer and seller when a dispute is opened.
 * @deprecated Use restrictBothPartiesForDispute for scoped restrictions instead.
 */
async function suspendBothPartiesForDispute(transactionId, buyerUserId, sellerUserId, io = null) {
  const meta = { reason: 'dispute_opened', transactionId, triggeredBy: 'system' };
  const [buyerResult, sellerResult] = await Promise.all([
    suspendUser(buyerUserId, meta, io),
    suspendUser(sellerUserId, meta, io)
  ]);
  return { buyer: buyerResult, seller: sellerResult };
}

/**
 * Add a dispute transaction ID to a user's activeDisputeTransactionIds, restricting them from
 * initiating new marketplace actions (bids, listings, offers) without touching accountStatus.
 * Existing transactions are unaffected.
 * @param {string} userId - Mongo User _id
 * @param {string|ObjectId} transactionId
 */
async function restrictUserForDispute(userId, transactionId) {
  await User.updateOne(
    { _id: userId },
    { $addToSet: { activeDisputeTransactionIds: transactionId } }
  );
}

/**
 * Remove a dispute transaction ID from a user's activeDisputeTransactionIds.
 * When the array becomes empty the scoped restriction is lifted automatically.
 * @param {string} userId - Mongo User _id
 * @param {string|ObjectId} transactionId
 */
async function unrestrictUserForDispute(userId, transactionId) {
  await User.updateOne(
    { _id: userId },
    { $pull: { activeDisputeTransactionIds: transactionId } }
  );
}

/**
 * Apply scoped new-action restrictions to both buyer and seller when a dispute is opened.
 * Does NOT suspend accounts — existing transactions continue normally.
 * Sends suspension-equivalent notifications and logs the event.
 */
async function restrictBothPartiesForDispute(transactionId, buyerUserId, sellerUserId, io = null) {
  await Promise.all([
    restrictUserForDispute(buyerUserId, transactionId),
    restrictUserForDispute(sellerUserId, transactionId)
  ]);

  // Log and notify both parties (audit log uses 'suspended' status; actual accountStatus unchanged)
  const meta = { reason: 'dispute_opened', transactionId, triggeredBy: 'system' };
  const previousStatus = ACCOUNT_STATUS.ACTIVE;
  await Promise.all([
    AccountStatusAuditLog.create({
      user: buyerUserId,
      previousStatus,
      newStatus: ACCOUNT_STATUS.SUSPENDED,
      reason: 'dispute_opened_scoped_restriction',
      transactionId: transactionId || null,
      metadata: { triggeredBy: 'system', note: 'Scoped restriction: new actions blocked, existing transactions unaffected' }
    }).catch(err => console.error('Audit log buyer restrict:', err.message)),
    AccountStatusAuditLog.create({
      user: sellerUserId,
      previousStatus,
      newStatus: ACCOUNT_STATUS.SUSPENDED,
      reason: 'dispute_opened_scoped_restriction',
      transactionId: transactionId || null,
      metadata: { triggeredBy: 'system', note: 'Scoped restriction: new actions blocked, existing transactions unaffected' }
    }).catch(err => console.error('Audit log seller restrict:', err.message))
  ]);

  await Promise.all([
    notifyAccountSuspended({ userId: buyerUserId }).catch(err => console.error('Notify buyer restrict:', err.message)),
    notifyAccountSuspended({ userId: sellerUserId }).catch(err => console.error('Notify seller restrict:', err.message))
  ]);

  if (io) {
    const [buyer, seller] = await Promise.all([
      User.findById(buyerUserId).select('uid').lean(),
      User.findById(sellerUserId).select('uid').lean()
    ]);
    if (buyer?.uid) emitNewNotificationToUser(io, buyerUserId).catch(() => {});
    if (seller?.uid) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
  }

  return { buyer: { updated: true }, seller: { updated: true } };
}

/**
 * Apply account outcome from admin dispute ruling.
 * Always lifts the scoped dispute restriction for this transaction regardless of outcome.
 * @param {string} accountOutcome - 'reactivate_both' | 'reactivate_buyer_close_seller' | 'reactivate_seller_close_buyer' | 'close_both'
 */
async function applyDisputeAccountOutcome(accountOutcome, buyerUserId, sellerUserId, transactionId, io = null) {
  const meta = { reason: 'dispute_ruling', transactionId, triggeredBy: 'admin' };

  // Always remove the scoped restriction for this dispute, regardless of outcome
  await Promise.all([
    unrestrictUserForDispute(buyerUserId, transactionId),
    unrestrictUserForDispute(sellerUserId, transactionId)
  ]);

  switch (accountOutcome) {
    case 'reactivate_both':
      // Dispute restrictions already lifted above; no further accountStatus change needed
      // (accountStatus was never changed to suspended, so reactivateUser would be a no-op anyway)
      break;
    case 'reactivate_buyer_close_seller':
      await closeUser(sellerUserId, meta, io);
      break;
    case 'reactivate_seller_close_buyer':
      await closeUser(buyerUserId, meta, io);
      break;
    case 'close_both':
      await Promise.all([
        closeUser(buyerUserId, meta, io),
        closeUser(sellerUserId, meta, io)
      ]);
      break;
    default:
      throw new Error(`Invalid accountOutcome: ${accountOutcome}`);
  }
}

module.exports = {
  ACCOUNT_STATUS,
  suspendUser,
  reactivateUser,
  closeUser,
  suspendBothPartiesForDispute,
  restrictUserForDispute,
  unrestrictUserForDispute,
  restrictBothPartiesForDispute,
  applyDisputeAccountOutcome
};
