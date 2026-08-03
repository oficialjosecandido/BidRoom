'use strict';

const Transaction = require('../models/Transaction');
const { getStripe } = require('../utils/stripe.util');
const logger = require('../utils/logger');

/**
 * Capture expired vehicle deposit holds.
 *
 * Finds transactions where:
 *   - depositRequired = true
 *   - depositStatus   = 'authorized'
 *   - depositDeadline < now (deal window elapsed without release)
 *
 * Captures the Stripe PaymentIntent so BidRoom retains the €100.
 */
async function runDepositCapture() {
  const stripe = getStripe();
  if (!stripe) return;

  const overdue = await Transaction.find({
    depositRequired: true,
    depositStatus: 'authorized',
    depositDeadline: { $lt: new Date() },
  }).lean();

  if (overdue.length === 0) return;
  logger.info(`[depositScheduler] ${overdue.length} deposit(s) to capture`);

  for (const tx of overdue) {
    try {
      await stripe.paymentIntents.capture(tx.depositPaymentIntentId);
      await Transaction.updateOne(
        { _id: tx._id, depositStatus: 'authorized' }, // idempotency guard
        { $set: { depositStatus: 'captured', depositCapturedAt: new Date() } }
      );
      logger.info(`[depositScheduler] Captured deposit for transaction ${tx._id}`);
    } catch (err) {
      logger.error(`[depositScheduler] Failed to capture deposit for ${tx._id}`, { error: err.message });
    }
  }
}

/**
 * Start the deposit capture scheduler.
 * @param {number} intervalMinutes – how often to run (default 30 min)
 */
function startDepositScheduler(intervalMinutes = 30) {
  const ms = intervalMinutes * 60 * 1000;
  // First run after 60s to let the server finish booting
  setTimeout(() => runDepositCapture().catch(e => logger.error('[depositScheduler] run error', { error: e.message })), 60_000);
  setInterval(() => runDepositCapture().catch(e => logger.error('[depositScheduler] run error', { error: e.message })), ms);
  logger.info(`[depositScheduler] started (every ${intervalMinutes}m)`);
}

module.exports = { startDepositScheduler, runDepositCapture };
