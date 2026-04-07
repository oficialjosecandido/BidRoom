/**
 * Escrow Expiry Scheduler
 *
 * Runs on a configurable interval (default: every 60 minutes).
 * Handles two concerns:
 *
 * 1. PRE-AUTH EXPIRY WARNING (14-day hold)
 *    Detects transactions with status='authorized' whose intentExpiresAt is
 *    within 24 hours. Notifies the buyer to confirm receipt before the hold
 *    lapses, and alerts admin.
 *
 * 2. ESCROW RELEASE (T+3 after capture)
 *    Detects transactions with escrowStatus='pending_inspection' whose
 *    escrowReleasesAt has passed. Marks them as escrowStatus='released'
 *    and advances transactionStatus to 'completed'.
 *    (Actual Airwallex payout to seller is governed by Airwallex's own
 *    payout schedule; this step just updates our DB and notifies parties.)
 */

const Transaction = require('../models/Transaction');

let _schedulerTimer = null;

/**
 * Start the scheduler.
 * @param {number}  intervalMinutes  How often to run (default 60)
 * @param {object}  io               Socket.io server instance (optional)
 */
function startScheduler(intervalMinutes = 60, io = null) {
  if (_schedulerTimer) return; // already running
  const ms = intervalMinutes * 60 * 1000;

  // Run once immediately on startup (after a short delay so DB is ready)
  setTimeout(() => runChecks(io).catch(e => console.error('[EscrowScheduler] startup run error:', e.message)), 5000);

  _schedulerTimer = setInterval(() => {
    runChecks(io).catch(e => console.error('[EscrowScheduler] interval run error:', e.message));
  }, ms);

  console.log(`[EscrowScheduler] Started — checking every ${intervalMinutes} min`);
}

function stopScheduler() {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer);
    _schedulerTimer = null;
  }
}

async function runChecks(io) {
  const now = new Date();
  await Promise.all([
    checkPreAuthExpiryWarnings(now, io),
    releaseMaturedEscrows(now, io)
  ]);
}

// ── 1. Pre-auth expiry warnings ───────────────────────────────────────────────

/**
 * Find authorized transactions expiring within the next 24 hours.
 * Send a notification to the buyer asking them to confirm receipt.
 * If expiry has already passed (webhook missed), reset status back to pending_payment.
 */
async function checkPreAuthExpiryWarnings(now, io) {
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const expiringSoon = await Transaction.find({
    transactionStatus: { $in: ['authorized', 'shipped'] },
    intentExpiresAt: { $ne: null, $lte: in24h },
    // Only notify once; we use a flag to avoid repeat sends
    holdExpiryWarningsentAt: null
  })
    .populate('buyer', '_id uid email firstName')
    .populate('listing', 'title slug')
    .lean();

  for (const tx of expiringSoon) {
    const isAlreadyExpired = tx.intentExpiresAt <= now;

    if (isAlreadyExpired) {
      // Hold already lapsed — Airwallex webhook should have fired, but handle defensively
      await Transaction.findByIdAndUpdate(tx._id, {
        $set: {
          transactionStatus: 'pending_payment',
          paymentStatus: 'pending',
          authorizedAt: null,
          intentExpiresAt: null,
          airwallexPaymentIntentId: null,
          airwallexClientSecret: null
        }
      }, { runValidators: false });

      console.warn(`[EscrowScheduler] Hold expired for txId=${tx._id} — reset to pending_payment`);
    } else {
      // Warn buyer to confirm receipt before the hold lapses
      try {
        const hoursLeft = Math.round((tx.intentExpiresAt - now) / (60 * 60 * 1000));
        await notifyBuyer(tx, hoursLeft, io);

        // Mark warning sent to avoid duplicate notifications
        await Transaction.findByIdAndUpdate(tx._id, {
          $set: { holdExpiryWarningSentAt: now }
        }, { runValidators: false });
      } catch (e) {
        console.error(`[EscrowScheduler] Warning notification error txId=${tx._id}:`, e.message);
      }
    }
  }

  if (expiringSoon.length > 0) {
    console.log(`[EscrowScheduler] Pre-auth expiry: ${expiringSoon.length} transaction(s) processed`);
  }
}

async function notifyBuyer(tx, hoursLeft, io) {
  const { notifyUser, emitNewNotificationToUser } = require('./notificationService');
  const userId = tx.buyer?._id?.toString();
  if (!userId) return;

  const title = hoursLeft <= 4
    ? `⚠️ Urgent: Confirm receipt within ${hoursLeft}h`
    : `Reminder: Confirm receipt within ${hoursLeft}h`;

  const message = `Your payment hold for "${tx.listing?.title || 'your item'}" expires in ~${hoursLeft} hours. ` +
    `Please confirm receipt on your dashboard so the seller can be paid.`;

  await notifyUser?.({ userId, title, message, type: 'hold_expiry_warning', listingSlug: tx.listing?.slug })
    .catch(() => {});

  if (io && tx.buyer?.uid) {
    emitNewNotificationToUser(io, userId).catch(() => {});
  }
}

// ── 2. Escrow release (T+3 after capture) ────────────────────────────────────

/**
 * Find transactions where escrowReleasesAt has passed and escrowStatus is still
 * 'pending_inspection'. Mark them released and complete the transaction.
 */
async function releaseMaturedEscrows(now, io) {
  const matured = await Transaction.find({
    escrowStatus: 'pending_inspection',
    escrowReleasesAt: { $ne: null, $lte: now },
    transactionStatus: { $in: ['delivered', 'shipped', 'paid'] }
  })
    .populate('seller', '_id uid email firstName')
    .populate('buyer', '_id uid email firstName')
    .populate('listing', 'title slug')
    .lean();

  for (const tx of matured) {
    try {
      await Transaction.findByIdAndUpdate(tx._id, {
        $set: {
          escrowStatus: 'released',
          transactionStatus: 'completed'
        }
      }, { runValidators: false });

      console.log(`[EscrowScheduler] Escrow released txId=${tx._id}`);

      // Notify seller their funds are on the way
      if (tx.seller?._id) {
        const { notifyUser, emitNewNotificationToUser } = require('./notificationService');
        await notifyUser?.({
          userId: tx.seller._id.toString(),
          title: 'Payout on the way!',
          message: `The escrow hold for "${tx.listing?.title || 'your sale'}" has been released. Your payout will arrive according to your Airwallex payout schedule.`,
          type: 'escrow_released',
          listingSlug: tx.listing?.slug
        }).catch(() => {});

        if (io && tx.seller.uid) {
          emitNewNotificationToUser(io, tx.seller._id.toString()).catch(() => {});
        }
      }

      // Update buyer too
      if (io && tx.buyer?.uid) {
        io.to(`user:${tx.buyer.uid}`).emit('transaction-updated', { transactionId: tx._id });
      }
    } catch (e) {
      console.error(`[EscrowScheduler] Release error txId=${tx._id}:`, e.message);
    }
  }

  if (matured.length > 0) {
    console.log(`[EscrowScheduler] Escrow released: ${matured.length} transaction(s)`);
  }
}

module.exports = { startScheduler, stopScheduler, runChecks };
