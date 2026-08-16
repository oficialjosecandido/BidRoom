'use strict';

/**
 * Payout Setup Reminder Scheduler
 *
 * Runs daily. Finds sellers with at least one active listing who have not yet
 * configured their Stripe payout account. Sends them a daily in-app notification
 * with a link to the settings page.
 *
 * Idempotency: tracked via Customer.payoutReminderLastSentAt — won't re-send
 * within 23 hours.
 */

const Listing  = require('../models/Listing');
const Customer = require('../models/Customer');
const { notifyPayoutSetupReminder } = require('./notificationService');
const logger = require('../utils/logger');

const LOG_PREFIX  = '[PayoutReminder]';
const BATCH_LIMIT = 500;
const MIN_INTERVAL_MS = 23 * 60 * 60 * 1000; // 23h — prevents double-send on restarts

let _timer = null;

function startPayoutSetupReminderScheduler(intervalHours = 24, io = null) {
  if (_timer) return;
  const ms = intervalHours * 60 * 60 * 1000;
  // First run 5 minutes after startup.
  setTimeout(() => run(io).catch(e => logger.error(LOG_PREFIX, 'startup:', e.message)), 5 * 60 * 1000);
  _timer = setInterval(() => run(io).catch(e => logger.error(LOG_PREFIX, 'interval:', e.message)), ms);
  logger.info(`${LOG_PREFIX} Scheduler started (every ${intervalHours}h).`);
}

function stopPayoutSetupReminderScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function run(io) {
  // Find sellers with at least one active listing.
  const sellerIds = await Listing.distinct('seller', { status: 'active' });
  if (sellerIds.length === 0) return;

  const cutoff = new Date(Date.now() - MIN_INTERVAL_MS);

  // Sellers who have active listings, haven't onboarded Stripe, and haven't been reminded recently.
  const sellers = await Customer.find({
    _id: { $in: sellerIds },
    stripeConnectOnboarded: { $ne: true },
    $or: [
      { payoutReminderLastSentAt: null },
      { payoutReminderLastSentAt: { $lt: cutoff } }
    ]
  })
    .select('_id')
    .limit(BATCH_LIMIT)
    .lean();

  if (sellers.length === 0) return;

  let sent = 0;
  for (const seller of sellers) {
    try {
      await notifyPayoutSetupReminder({ sellerId: seller._id.toString(), io });
      await Customer.updateOne({ _id: seller._id }, { payoutReminderLastSentAt: new Date() });
      sent++;
    } catch (err) {
      logger.error(`${LOG_PREFIX} Failed to notify seller ${seller._id}:`, err.message);
    }
  }

  if (sent > 0) {
    logger.info(`${LOG_PREFIX} Sent ${sent} payout setup reminder(s).`);
  }
}

module.exports = { startPayoutSetupReminderScheduler, stopPayoutSetupReminderScheduler };
