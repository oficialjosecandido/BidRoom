/**
 * Account status service: suspend, reactivate, close accounts.
 * Used when disputes open (suspend both) and when admin rules (reactivate/close).
 * Logs all changes to AccountStatusAuditLog and sends notifications.
 */

const User = require('../models/User');
const AccountStatusAuditLog = require('../models/AccountStatusAuditLog');
const { notifyAccountSuspended, notifyAccountReactivated, notifyAccountClosed, emitNewNotificationToUser } = require('./notificationService');

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
 * Apply account outcome from admin dispute ruling.
 * @param {string} accountOutcome - 'reactivate_both' | 'reactivate_buyer_close_seller' | 'reactivate_seller_close_buyer' | 'close_both'
 */
async function applyDisputeAccountOutcome(accountOutcome, buyerUserId, sellerUserId, transactionId, io = null) {
  const meta = { reason: 'dispute_ruling', transactionId, triggeredBy: 'admin' };

  switch (accountOutcome) {
    case 'reactivate_both':
      await Promise.all([
        reactivateUser(buyerUserId, meta, io),
        reactivateUser(sellerUserId, meta, io)
      ]);
      break;
    case 'reactivate_buyer_close_seller':
      await Promise.all([
        reactivateUser(buyerUserId, meta, io),
        closeUser(sellerUserId, meta, io)
      ]);
      break;
    case 'reactivate_seller_close_buyer':
      await Promise.all([
        reactivateUser(sellerUserId, meta, io),
        closeUser(buyerUserId, meta, io)
      ]);
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
  applyDisputeAccountOutcome
};
