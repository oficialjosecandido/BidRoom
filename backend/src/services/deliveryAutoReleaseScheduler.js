/**
 * Delivery Auto-Release Scheduler
 *
 * Runs every 15 minutes. Handles three enforcement stages:
 *
 * 1. CONFIRM-RECEIPT REMINDERS
 *    While an order is still shipped, remind the buyer to confirm receipt:
 *    - on_delivery: on/after estimatedDeliveryDate (or 7 days after shippedAt
 *      when there is no estimate)
 *    - pre_release: 2 days before autoReleaseAt
 *
 * 2. AUTO-COMPLETE (Story 6.2)
 *    When a shipped transaction's autoReleaseAt has passed and the buyer has not
 *    confirmed delivery, the transaction is automatically completed. This releases
 *    payment to the seller and closes the order.
 *
 * 3. RETURN MEDIATION (Story 6.3)
 *    When a buyer files a return request, the seller has 48 hours to respond.
 *    If returnSellerDeadline passes with returnStatus still 'pending_seller_response',
 *    the scheduler marks the return as 'platform_mediated' — BidRoom's team will
 *    step in to resolve the dispute.
 */

const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const {
  emitNewNotificationToUser,
  createNotification,
  notifyBuyerConfirmReceiptReminder,
  standIn
} = require('./notificationService');
const { sendLocalizedEmail, formatEmailDate, emailLabel } = require('./localizedEmail');
const { escapeHtml, transactionUrl } = require('../utils/bidroomEmailLayout');
const { checkAndApplyPendingSuspensions } = require('./accountStatusService');
const logger = require('../utils/logger');

const LOG_PREFIX = '[DeliveryRelease]';
const BATCH_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Without an estimated delivery date, ask the buyer after this many days in transit. */
const NO_ESTIMATE_REMINDER_DAYS = 7;
/** Second nudge this many days before auto-release. */
const PRE_RELEASE_REMINDER_DAYS = 2;

let _timer = null;

function startDeliveryAutoReleaseScheduler(intervalMinutes = 15, io = null) {
  if (_timer) return;
  const ms = intervalMinutes * 60 * 1000;
  setTimeout(() => runDeliveryChecks(io).catch(e => logger.error(LOG_PREFIX, 'startup:', e.message)), 12000);
  _timer = setInterval(() => {
    runDeliveryChecks(io).catch(e => logger.error(LOG_PREFIX, e.message));
  }, ms);
  logger.info(`${LOG_PREFIX} Started — every ${intervalMinutes} min`);
}

function stopDeliveryAutoReleaseScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

async function runDeliveryChecks(io) {
  await Promise.all([
    processReceiptConfirmReminders(io),
    processAutoReleases(io),
    processReturnMediations(io)
  ]);
}

/**
 * When the package should have arrived (or is about to auto-complete), email +
 * notify the buyer to confirm receipt so payout is not held up / auto-released
 * without them acting.
 */
async function processReceiptConfirmReminders(io) {
  const now = new Date();
  const nowMs = now.getTime();

  const candidates = await Transaction.find({
    transactionStatus: 'shipped',
    shippedAt: { $ne: null },
    autoReleaseAt: { $gt: now },
    $or: [
      { receiptRemindersSent: { $exists: false } },
      { receiptRemindersSent: { $nin: ['on_delivery', 'pre_release'] } },
      { receiptRemindersSent: { $size: 0 } },
      { receiptRemindersSent: { $size: 1 } }
    ]
  })
    .sort({ shippedAt: 1 })
    .limit(BATCH_LIMIT)
    .populate('listing', 'title slug')
    .populate('buyer', '_id uid email firstName language')
    .lean();

  for (const tx of candidates) {
    try {
      const alreadySent = new Set(tx.receiptRemindersSent || []);
      const dueKeys = [];

      const onDeliveryAt = tx.estimatedDeliveryDate
        ? new Date(tx.estimatedDeliveryDate)
        : new Date(new Date(tx.shippedAt).getTime() + NO_ESTIMATE_REMINDER_DAYS * DAY_MS);

      if (!alreadySent.has('on_delivery') && nowMs >= onDeliveryAt.getTime()) {
        dueKeys.push('on_delivery');
      }

      const preReleaseDue = !!(
        tx.autoReleaseAt &&
        !alreadySent.has('pre_release') &&
        nowMs >= new Date(tx.autoReleaseAt).getTime() - PRE_RELEASE_REMINDER_DAYS * DAY_MS
      );
      if (preReleaseDue) dueKeys.push('pre_release');

      if (dueKeys.length === 0) continue;

      // One email per tick. If both milestones land together, use the delivery
      // copy and stamp both keys so we do not send a duplicate later.
      const isFinalReminder = dueKeys.includes('pre_release') && !dueKeys.includes('on_delivery');
      const buyerId = tx.buyer?._id?.toString?.() || tx.buyer?.toString?.();
      // Passed through as it is: the notifier supplies its own localized
      // stand-in when there is no title, and the email its own.
      const listingTitle = tx.listing?.title || '';

      if (buyerId) {
        await notifyBuyerConfirmReceiptReminder({
          transactionId: tx._id.toString(),
          listingTitle,
          buyerUserId: buyerId
        }).catch(() => {});

        if (tx.buyer?.email) {
          await sendLocalizedEmail(tx.buyer, 'confirmReceiptBuyer', {
            firstName: escapeHtml(tx.buyer.firstName),
            listingTitle: escapeHtml(tx.listing?.title || emailLabel('yourItem', tx.buyer)),
            autoReleaseDate: formatEmailDate(tx.autoReleaseAt, tx.buyer),
            isFinalReminder: isFinalReminder ? '1' : '',
            ctaUrl: transactionUrl(tx._id?.toString?.())
          });
        }
        if (io) emitNewNotificationToUser(io, buyerId).catch(() => {});
      }

      await Transaction.updateOne(
        { _id: tx._id },
        { $addToSet: { receiptRemindersSent: { $each: dueKeys } } }
      );

      logger.info(`${LOG_PREFIX} Receipt reminder (${dueKeys.join(',')}) tx=${tx._id}`);
    } catch (e) {
      logger.error(`${LOG_PREFIX} Receipt reminder error tx=${tx._id}:`, e.message);
    }
  }
}

/**
 * Auto-complete shipped transactions where the buyer hasn't confirmed within
 * the auto-release window (estimatedDeliveryDate + 5 days, or shippedAt + 14 days).
 */
async function processAutoReleases(io) {
  const now = new Date();

  const candidates = await Transaction.find({
    transactionStatus: 'shipped',
    autoReleaseAt: { $lte: now },
    autoReleaseExecutedAt: null
  })
    .sort({ autoReleaseAt: 1 })
    .limit(BATCH_LIMIT)
    .populate('listing', 'title slug')
    .populate('seller', '_id uid email firstName language')
    .populate('buyer', '_id uid email firstName language')
    .lean();

  for (const tx of candidates) {
    try {
      // Atomic: only set salesCountIncremented if not already set, so we can detect below whether we won the race.
      const updatedTx = await Transaction.findOneAndUpdate(
        { _id: tx._id, salesCountIncremented: { $ne: true } },
        {
          $set: {
            transactionStatus: 'completed',
            sendingStatus: 'delivered',
            completedAt: now,
            deliveredAt: now,
            autoReleaseExecutedAt: now,
            salesCountIncremented: true
          }
        },
        { runValidators: false }
      );
      // updatedTx is null when the filter didn't match (already incremented) — skip counter in that case.
      if (updatedTx === null) {
        // salesCountIncremented was already true; still need to set the other status fields.
        await Transaction.findByIdAndUpdate(tx._id, {
          $set: {
            transactionStatus: 'completed',
            sendingStatus: 'delivered',
            completedAt: now,
            deliveredAt: now,
            autoReleaseExecutedAt: now
          }
        }, { runValidators: false });
      }
      const listingTitle = tx.listing?.title || 'the item';
      // The same title as a parameter: a localized stand-in when the listing
      // has no title on file, instead of one English phrase mid-sentence.
      const titleParam = tx.listing?.title || standIn('theItem');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      const txLink = `${frontendUrl}/dashboard/transactions`;

      const buyerId = tx.buyer?._id?.toString?.() || tx.buyer?.toString?.();
      const sellerId = tx.seller?._id?.toString?.() || tx.seller?.toString?.();

      if (updatedTx !== null && sellerId) {
        Customer.findByIdAndUpdate(sellerId, { $inc: { completedSalesCount: 1 } })
          .catch(err => logger.error('[Waiver] Failed to increment completedSalesCount:', err.message));
      }

      if (buyerId) {
        await createNotification({
          userId: buyerId,
          title: 'Payment auto-released to seller',
          message: `Your order for "${listingTitle}" was automatically completed. Payment has been released to the seller.`,
          i18nKey: 'notifications.payoutAutoReleasedBuyer',
          i18nParams: { listingTitle: titleParam },
          type: 'transaction',
          link: txLink,
          referenceId: tx._id.toString()
        }).catch(() => {});

        if (tx.buyer?.email) {
          await sendLocalizedEmail(tx.buyer, 'orderCompletedBuyer', {
            firstName: escapeHtml(tx.buyer.firstName),
            listingTitle: escapeHtml(tx.listing?.title || emailLabel('yourItem', tx.buyer)),
            ctaUrl: transactionUrl(tx._id?.toString?.())
          });
        }
        if (io) emitNewNotificationToUser(io, buyerId).catch(() => {});
      }

      if (sellerId) {
        await createNotification({
          userId: sellerId,
          title: 'Payment auto-released',
          message: `Your order for "${listingTitle}" was automatically completed. Payment has been released to you.`,
          i18nKey: 'notifications.payoutAutoReleasedSeller',
          i18nParams: { listingTitle: titleParam },
          type: 'transaction',
          link: txLink,
          referenceId: tx._id.toString()
        }).catch(() => {});

        if (tx.seller?.email) {
          await sendLocalizedEmail(tx.seller, 'payoutReleasedSeller', {
            sellerFirstName: escapeHtml(tx.seller.firstName),
            listingTitle: escapeHtml(tx.listing?.title || emailLabel('yourItem', tx.seller)),
            // No figure is to hand on this path, so the template's payout box
            // and label collapse to nothing rather than printing "undefined".
            payoutBox: '',
            payoutLabel: '',
            ctaUrl: transactionUrl(tx._id?.toString?.())
          });
        }
        if (io) emitNewNotificationToUser(io, sellerId).catch(() => {});
      }

      // Transaction is now terminal — apply any pending suspensions for either party.
      checkAndApplyPendingSuspensions([buyerId, sellerId].filter(Boolean), io)
        .catch(err => logger.error(`${LOG_PREFIX} Pending suspension check failed tx=${tx._id}:`, err.message));

      logger.info(`${LOG_PREFIX} Auto-released tx=${tx._id}`);
    } catch (e) {
      logger.error(`${LOG_PREFIX} Auto-release error tx=${tx._id}:`, e.message);
    }
  }
}

/**
 * Escalate return requests where the seller did not respond within 48 hours.
 * Marks returnStatus as 'platform_mediated' so the BidRoom team steps in.
 */
async function processReturnMediations(io) {
  const now = new Date();

  const candidates = await Transaction.find({
    transactionStatus: 'under_dispute',
    returnStatus: 'pending_seller_response',
    returnSellerDeadline: { $lte: now }
  })
    .sort({ returnSellerDeadline: 1 })
    .limit(BATCH_LIMIT)
    .populate('listing', 'title slug')
    .populate('seller', '_id uid email firstName language')
    .populate('buyer', '_id uid email firstName language')
    .lean();

  for (const tx of candidates) {
    try {
      await Transaction.findByIdAndUpdate(tx._id, {
        $set: { returnStatus: 'platform_mediated' }
      }, { runValidators: false });

      const listingTitle = tx.listing?.title || 'the item';
      // The same title as a parameter: a localized stand-in when the listing
      // has no title on file, instead of one English phrase mid-sentence.
      const titleParam = tx.listing?.title || standIn('theItem');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      const txLink = `${frontendUrl}/dashboard/transactions`;
      const buyerId = tx.buyer?._id?.toString?.() || tx.buyer?.toString?.();
      const sellerId = tx.seller?._id?.toString?.() || tx.seller?.toString?.();

      if (buyerId) {
        await createNotification({
          userId: buyerId,
          title: 'Return request escalated',
          message: `The seller did not respond to your return request for "${listingTitle}". BidRoom will now mediate.`,
          i18nKey: 'notifications.returnEscalatedBuyer',
          i18nParams: { listingTitle: titleParam },
          type: 'dispute',
          link: txLink,
          referenceId: tx._id.toString()
        }).catch(() => {});
        if (io) emitNewNotificationToUser(io, buyerId).catch(() => {});
      }

      if (sellerId) {
        await createNotification({
          userId: sellerId,
          title: 'Return request escalated to platform',
          message: `You did not respond to the return request for "${listingTitle}" in time. BidRoom will now mediate.`,
          i18nKey: 'notifications.returnEscalatedSeller',
          i18nParams: { listingTitle: titleParam },
          type: 'dispute',
          link: txLink,
          referenceId: tx._id.toString()
        }).catch(() => {});
        if (io) emitNewNotificationToUser(io, sellerId).catch(() => {});
      }

      logger.info(`${LOG_PREFIX} Return auto-mediated tx=${tx._id}`);
    } catch (e) {
      logger.error(`${LOG_PREFIX} Return mediation error tx=${tx._id}:`, e.message);
    }
  }
}

module.exports = { startDeliveryAutoReleaseScheduler, stopDeliveryAutoReleaseScheduler, runDeliveryChecks };
