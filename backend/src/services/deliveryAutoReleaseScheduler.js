/**
 * Delivery Auto-Release Scheduler
 *
 * Runs every 15 minutes. Handles two enforcement stages:
 *
 * 1. AUTO-COMPLETE (Story 6.2)
 *    When a shipped transaction's autoReleaseAt has passed and the buyer has not
 *    confirmed delivery, the transaction is automatically completed. This releases
 *    payment to the seller and closes the order.
 *
 * 2. RETURN MEDIATION (Story 6.3)
 *    When a buyer files a return request, the seller has 48 hours to respond.
 *    If returnSellerDeadline passes with returnStatus still 'pending_seller_response',
 *    the scheduler marks the return as 'platform_mediated' — BidRoom's team will
 *    step in to resolve the dispute.
 */

const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const { emitNewNotificationToUser, createNotification } = require('./notificationService');
const { sendEmail } = require('./emailService');
const { wrapBidRoomEmail, emailInfoBox, transactionUrl } = require('../utils/bidroomEmailLayout');
const { checkAndApplyPendingSuspensions } = require('./accountStatusService');

const LOG_PREFIX = '[DeliveryRelease]';
const BATCH_LIMIT = 200;

let _timer = null;

function startDeliveryAutoReleaseScheduler(intervalMinutes = 15, io = null) {
  if (_timer) return;
  const ms = intervalMinutes * 60 * 1000;
  setTimeout(() => runDeliveryChecks(io).catch(e => console.error(LOG_PREFIX, 'startup:', e.message)), 12000);
  _timer = setInterval(() => {
    runDeliveryChecks(io).catch(e => console.error(LOG_PREFIX, e.message));
  }, ms);
  console.log(`${LOG_PREFIX} Started — every ${intervalMinutes} min`);
}

function stopDeliveryAutoReleaseScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

async function runDeliveryChecks(io) {
  await Promise.all([
    processAutoReleases(io),
    processReturnMediations(io)
  ]);
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
    .populate('seller', '_id uid email firstName')
    .populate('buyer', '_id uid email firstName')
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
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      const txLink = `${frontendUrl}/dashboard/transactions`;

      const buyerId = tx.buyer?._id?.toString?.() || tx.buyer?.toString?.();
      const sellerId = tx.seller?._id?.toString?.() || tx.seller?.toString?.();

      if (updatedTx !== null && sellerId) {
        Customer.findByIdAndUpdate(sellerId, { $inc: { completedSalesCount: 1 } })
          .catch(err => console.error('[Waiver] Failed to increment completedSalesCount:', err.message));
      }

      if (buyerId) {
        await createNotification({
          userId: buyerId,
          title: 'Payment auto-released to seller',
          message: `Your order for "${listingTitle}" was automatically completed. Payment has been released to the seller.`,
          type: 'transaction',
          link: txLink,
          referenceId: tx._id.toString()
        }).catch(() => {});

        const buyerEmail = tx.buyer?.email;
        if (buyerEmail) {
          const bodyHtml = `
            <p style="margin:0 0 16px;">Hi ${tx.buyer?.firstName || 'there'},</p>
            <p style="margin:0 0 16px;">Your order for <strong>${listingTitle}</strong> was automatically completed.</p>
            ${emailInfoBox('Payment was released to the seller. Contact BidRoom support if you have an issue with this order.')}`;
          const html = wrapBidRoomEmail({
            title: 'Order completed automatically',
            bodyHtml,
            ctaUrl: transactionUrl(tx._id?.toString?.()),
            ctaLabel: 'View transaction'
          });
          await sendEmail(buyerEmail, `Order completed — "${listingTitle}"`, html).catch(() => {});
        }
        if (io) emitNewNotificationToUser(io, buyerId).catch(() => {});
      }

      if (sellerId) {
        await createNotification({
          userId: sellerId,
          title: 'Payment auto-released',
          message: `Your order for "${listingTitle}" was automatically completed. Payment has been released to you.`,
          type: 'transaction',
          link: txLink,
          referenceId: tx._id.toString()
        }).catch(() => {});

        const sellerEmail = tx.seller?.email;
        if (sellerEmail) {
          const bodyHtml = `
            <p style="margin:0 0 16px;">Hi ${tx.seller?.firstName || 'there'},</p>
            <p style="margin:0 0 16px;">The order for <strong>${listingTitle}</strong> was automatically completed and your payment has been released.</p>`;
          const html = wrapBidRoomEmail({
            title: 'Payment released',
            bodyHtml,
            ctaUrl: transactionUrl(tx._id?.toString?.()),
            ctaLabel: 'View transaction'
          });
          await sendEmail(sellerEmail, `Payment released — "${listingTitle}"`, html).catch(() => {});
        }
        if (io) emitNewNotificationToUser(io, sellerId).catch(() => {});
      }

      // Transaction is now terminal — apply any pending suspensions for either party.
      checkAndApplyPendingSuspensions([buyerId, sellerId].filter(Boolean), io)
        .catch(err => console.error(`${LOG_PREFIX} Pending suspension check failed tx=${tx._id}:`, err.message));

      console.log(`${LOG_PREFIX} Auto-released tx=${tx._id}`);
    } catch (e) {
      console.error(`${LOG_PREFIX} Auto-release error tx=${tx._id}:`, e.message);
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
    .populate('seller', '_id uid email firstName')
    .populate('buyer', '_id uid email firstName')
    .lean();

  for (const tx of candidates) {
    try {
      await Transaction.findByIdAndUpdate(tx._id, {
        $set: { returnStatus: 'platform_mediated' }
      }, { runValidators: false });

      const listingTitle = tx.listing?.title || 'the item';
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      const txLink = `${frontendUrl}/dashboard/transactions`;
      const buyerId = tx.buyer?._id?.toString?.() || tx.buyer?.toString?.();
      const sellerId = tx.seller?._id?.toString?.() || tx.seller?.toString?.();

      if (buyerId) {
        await createNotification({
          userId: buyerId,
          title: 'Return request escalated',
          message: `The seller did not respond to your return request for "${listingTitle}". BidRoom will now mediate.`,
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
          type: 'dispute',
          link: txLink,
          referenceId: tx._id.toString()
        }).catch(() => {});
        if (io) emitNewNotificationToUser(io, sellerId).catch(() => {});
      }

      console.log(`${LOG_PREFIX} Return auto-mediated tx=${tx._id}`);
    } catch (e) {
      console.error(`${LOG_PREFIX} Return mediation error tx=${tx._id}:`, e.message);
    }
  }
}

module.exports = { startDeliveryAutoReleaseScheduler, stopDeliveryAutoReleaseScheduler, runDeliveryChecks };
