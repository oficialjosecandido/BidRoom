/**
 * Shipping Deadline Enforcement Scheduler
 *
 * Runs on a configurable interval (default: every 15 minutes).
 * Implements two enforcement stages for orders that have been paid but not yet shipped:
 *
 * 1. MIDPOINT WARNING (business day 3)
 *    After the 3rd business day since payment, if the seller has not shipped,
 *    they receive an in-app notification + email warning that 2 business days
 *    remain before the order is automatically cancelled.
 *    A flag (shippingMidpointWarningSentAt) prevents duplicate warnings.
 *
 * 2. AUTO-CANCELLATION + REFUND (business day 5)
 *    After the 5th business day, if shipment is still not confirmed:
 *    - A full Stripe refund is issued (with reverse_transfer + refund_application_fee
 *      where supported; falls back to a plain refund otherwise).
 *    - The transaction status is set to 'cancelled'.
 *    - Both buyer (refund notification) and seller (failure notification) are
 *      notified via in-app + email.
 *
 * Business days = Mon–Fri in UTC. Weekends are skipped. See businessDays.js.
 */

const Stripe = require('stripe');
const Transaction = require('../models/Transaction');
const {
  resolveShipByDeadline,
  midpointWarningThreshold
} = require('./shippingDeadlines');
const {
  notifySellerShippingFinalTwoDays,
  notifyBuyerOrderCancelledNoShipment,
  notifySellerOrderCancelledNoShipment,
  emitNewNotificationToUser
} = require('./notificationService');
const { sendEmail } = require('./emailService');

const LOG_PREFIX = '[ShippingDeadline]';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

let _timer = null;

/**
 * Start the shipping deadline scheduler.
 * @param {number} intervalMinutes  How often to run (default 15)
 * @param {object} io               Socket.io server instance (optional, for real-time pushes)
 */
function startScheduler(intervalMinutes = 15, io = null) {
  if (_timer) return;
  const ms = intervalMinutes * 60 * 1000;
  setTimeout(() => runChecks(io).catch(e => console.error(LOG_PREFIX, 'startup:', e.message)), 8000);
  _timer = setInterval(() => {
    runChecks(io).catch(e => console.error(LOG_PREFIX, e.message));
  }, ms);
  console.log(`${LOG_PREFIX} Started — every ${intervalMinutes} min`);
}

function stopScheduler() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

async function runChecks(io) {
  const stripe = getStripe();
  const now = new Date();
  await Promise.all([
    processMidpointWarnings(now, io),
    processAutoCancellations(now, stripe, io)
  ]);
}

/**
 * Stage 1: Midpoint warning — 3 business days have elapsed without shipment.
 * Sends seller an in-app notification + email, marks the warning as sent.
 */
async function processMidpointWarnings(now, io) {
  const candidates = await Transaction.find({
    transactionStatus: { $in: ['awaiting_seller_acceptance', 'paid'] },
    sendingStatus: 'pending',
    shippingMidpointWarningSentAt: null,
    paidAt: { $ne: null },
    shippingAutoCancelledAt: null
  })
    .populate('listing', 'title slug')
    .populate('seller', '_id uid email firstName')
    .lean();

  for (const tx of candidates) {
    const threshold = midpointWarningThreshold(tx);
    if (!threshold || now <= threshold) continue;

    try {
      await Transaction.findByIdAndUpdate(tx._id, {
        $set: { shippingMidpointWarningSentAt: now }
      }, { runValidators: false });

      const sellerId = tx.seller?._id?.toString?.() || tx.seller?.toString?.();
      const listingTitle = tx.listing?.title || 'the item';
      if (sellerId) {
        await notifySellerShippingFinalTwoDays({
          transactionId: tx._id.toString(),
          listingTitle,
          sellerUserId: sellerId
        }).catch(() => {});

        const sellerEmail = tx.seller?.email;
        const sellerName = tx.seller?.firstName || 'there';
        if (sellerEmail) {
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
          const txLink = `${frontendUrl}/dashboard/transactions`;
          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #7A4F84 0%, #9b6ba8 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0;">Shipping reminder</h1>
              </div>
              <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
                <p>Hi ${sellerName},</p>
                <p>You have <strong>2 business days</strong> left to ship <strong>${listingTitle}</strong> or the order will be automatically cancelled and the buyer refunded.</p>
                <p>Please mark the item as shipped and add tracking information in your dashboard.</p>
                <p style="text-align: center; margin: 24px 0;">
                  <a href="${txLink}" style="background: #7A4F84; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">Go to Transactions</a>
                </p>
                <p>Best regards,<br>The BidRoom Team</p>
              </div>
            </div>`;
          await sendEmail(sellerEmail, `Action required: ship "${listingTitle}" within 2 days`, html).catch(() => {});
        }
        if (io) emitNewNotificationToUser(io, sellerId).catch(() => {});
      }
      console.log(`${LOG_PREFIX} Midpoint warning tx=${tx._id}`);
    } catch (e) {
      console.error(`${LOG_PREFIX} Midpoint warning error tx=${tx._id}:`, e.message);
    }
  }
}

/**
 * Stage 2: Auto-cancellation — 5 business days have elapsed without shipment.
 * Issues a full Stripe refund, cancels the transaction, and notifies both parties.
 */
async function processAutoCancellations(now, stripe, io) {
  if (!stripe) {
    return;
  }

  const candidates = await Transaction.find({
    transactionStatus: { $in: ['awaiting_seller_acceptance', 'paid'] },
    sendingStatus: 'pending',
    paidAt: { $ne: null },
    shippingAutoCancelledAt: null,
    stripePaymentIntentId: { $ne: null }
  })
    .populate('listing', 'title slug')
    .populate('seller', '_id uid email firstName')
    .populate('buyer', '_id uid email firstName')
    .lean();

  for (const tx of candidates) {
    const deadline = resolveShipByDeadline(tx);
    if (!deadline || now <= deadline) continue;

    try {
      // Attempt full refund with reverse_transfer (claws back seller's portion)
      // and refund_application_fee (returns the platform fee).
      // If the account doesn't support these flags (e.g. no transfer was created),
      // fall back to a plain refund.
      let refund;
      try {
        refund = await stripe.refunds.create({
          payment_intent: tx.stripePaymentIntentId,
          reverse_transfer: true,
          refund_application_fee: true
        });
      } catch (re) {
        try {
          refund = await stripe.refunds.create({
            payment_intent: tx.stripePaymentIntentId
          });
        } catch (re2) {
          console.error(`${LOG_PREFIX} Refund failed tx=${tx._id}:`, re.message, re2.message);
          continue;
        }
      }

      await Transaction.findByIdAndUpdate(tx._id, {
        $set: {
          transactionStatus: 'cancelled',
          shippingAutoCancelledAt: now,
          stripeRefundId: refund.id
        }
      }, { runValidators: false });

      const listingTitle = tx.listing?.title || 'the item';
      const buyerId = tx.buyer?._id?.toString?.() || tx.buyer?.toString?.();
      const sellerId = tx.seller?._id?.toString?.() || tx.seller?.toString?.();
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
      const txLink = `${frontendUrl}/dashboard/transactions`;

      if (buyerId) {
        await notifyBuyerOrderCancelledNoShipment({
          transactionId: tx._id.toString(),
          listingTitle,
          buyerUserId: buyerId
        }).catch(() => {});

        const buyerEmail = tx.buyer?.email;
        const buyerName = tx.buyer?.firstName || 'there';
        if (buyerEmail) {
          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #7A4F84 0%, #9b6ba8 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0;">Order cancelled — refund issued</h1>
              </div>
              <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
                <p>Hi ${buyerName},</p>
                <p>Your order for <strong>${listingTitle}</strong> was cancelled because the seller did not ship within the required 5 business-day timeframe.</p>
                <p>A full refund has been issued to your original payment method. It may take 5–10 business days to appear on your statement.</p>
                <p style="text-align: center; margin: 24px 0;">
                  <a href="${txLink}" style="background: #7A4F84; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Transactions</a>
                </p>
                <p>Best regards,<br>The BidRoom Team</p>
              </div>
            </div>`;
          await sendEmail(buyerEmail, `Order cancelled — refund for "${listingTitle}"`, html).catch(() => {});
        }
        if (io) emitNewNotificationToUser(io, buyerId).catch(() => {});
      }

      if (sellerId) {
        await notifySellerOrderCancelledNoShipment({
          transactionId: tx._id.toString(),
          listingTitle,
          sellerUserId: sellerId
        }).catch(() => {});

        const sellerEmail = tx.seller?.email;
        const sellerName = tx.seller?.firstName || 'there';
        if (sellerEmail) {
          const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #7A4F84 0%, #9b6ba8 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0;">Order cancelled — failed to ship</h1>
              </div>
              <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
                <p>Hi ${sellerName},</p>
                <p>The order for <strong>${listingTitle}</strong> was cancelled automatically because shipment was not confirmed within the required 5 business-day window.</p>
                <p>The buyer has been refunded in full. Please ensure future orders are shipped promptly to avoid cancellations.</p>
                <p style="text-align: center; margin: 24px 0;">
                  <a href="${txLink}" style="background: #7A4F84; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Transactions</a>
                </p>
                <p>Best regards,<br>The BidRoom Team</p>
              </div>
            </div>`;
          await sendEmail(sellerEmail, `Order cancelled — "${listingTitle}"`, html).catch(() => {});
        }
        if (io) emitNewNotificationToUser(io, sellerId).catch(() => {});
      }

      console.log(`${LOG_PREFIX} Auto-cancelled tx=${tx._id} refund=${refund.id}`);
    } catch (e) {
      console.error(`${LOG_PREFIX} Auto-cancel error tx=${tx._id}:`, e.message);
    }
  }
}

module.exports = { startScheduler, stopScheduler, runChecks };
