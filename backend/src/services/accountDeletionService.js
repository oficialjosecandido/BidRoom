/**
 * Self-service account closure (RGPD Art. 17).
 *
 * Closes the account when the user has no open marketplace obligations,
 * cancels their live listings, anonymises profile fields, and disables Firebase login.
 * Fiscal records (completed transactions) are retained.
 */

const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const admin = require('../config/firebaseAdmin');
const { closeUser } = require('./accountStatusService');
const logger = require('../utils/logger');

const OPEN_TX_STATUSES = [
  'pending_payment',
  'awaiting_seller_acceptance',
  'paid',
  'shipped',
  'delivered',
  'under_dispute'
];

class AccountDeletionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AccountDeletionError';
    this.code = code;
    this.status = status;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.userId - Customer Mongo _id
 * @param {string} opts.uid - Firebase uid
 * @param {object|null} opts.io
 */
async function deleteOwnAccount({ userId, uid, io = null }) {
  const user = await Customer.findById(userId);
  if (!user) throw new AccountDeletionError('not_found', 'User not found.', 404);
  if (user.accountStatus === 'closed') {
    throw new AccountDeletionError('already_closed', 'Account is already closed.', 400);
  }

  const openTxCount = await Transaction.countDocuments({
    $or: [{ buyer: userId }, { seller: userId }],
    transactionStatus: { $in: OPEN_TX_STATUSES }
  });
  if (openTxCount > 0) {
    throw new AccountDeletionError(
      'open_transactions',
      'You still have open purchases or sales. Finish or cancel them before deleting your account.',
      409
    );
  }

  if (Array.isArray(user.activeDisputeTransactionIds) && user.activeDisputeTransactionIds.length > 0) {
    throw new AccountDeletionError(
      'open_disputes',
      'You have an open dispute. It must be resolved before the account can be deleted.',
      409
    );
  }

  // Pull live inventory offline so the closed seller no longer appears in search.
  await Listing.updateMany(
    { seller: userId, status: { $in: ['draft', 'active', 'pending_review'] } },
    { $set: { status: 'cancelled' } }
  );

  const closed = await closeUser(
    userId,
    { reason: 'user_requested_deletion', triggeredBy: 'user' },
    io
  );
  if (!closed.updated && closed.reason !== 'already_closed') {
    throw new AccountDeletionError('close_failed', 'Could not close the account.', 500);
  }

  // Anonymise after closeUser so audit/notify still see the real identity.
  const tombstoneEmail = `deleted-${userId}@deleted.bidroom.local`;
  await Customer.updateOne(
    { _id: userId },
    {
      $set: {
        email: tombstoneEmail,
        firstName: 'Deleted',
        lastName: 'User',
        phone: null,
        deliveryAddress: null,
        cookieConsent: null,
        professionalLegalName: null,
        professionalTradeName: null,
        professionalAddressLine1: null,
        professionalAddressLine2: null,
        professionalCity: null,
        professionalRegion: null,
        professionalPostalCode: null,
        professionalContactPhone: null,
        professionalContactEmail: null,
        professionalVatId: null,
        sellerPaymentConfig: {}
      }
    }
  );

  if (uid && admin.apps.length) {
    try {
      await admin.auth().updateUser(uid, { disabled: true });
      await admin.auth().revokeRefreshTokens(uid);
    } catch (err) {
      // Account is already closed in our DB — log and continue so the user is not stuck.
      logger.error(`Firebase disable failed for ${uid} during account deletion:`, err.message || err);
    }
  }

  logger.info(`Account self-deleted: customer=${userId} uid=${uid || 'n/a'}`);
  return { ok: true };
}

module.exports = { deleteOwnAccount, AccountDeletionError };
