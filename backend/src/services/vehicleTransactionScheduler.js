'use strict';

const VehicleTransaction = require('../models/VehicleTransaction');
const { cancelTransaction, failTransaction, completeTransaction } = require('./vehicleTransactionService');
const logger = require('../utils/logger');

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1 h

async function runVehicleTransactionScheduler() {
  const now = new Date();
  logger.info('[vehicleScheduler] tick', { now });

  // ── 1. Setup failure: awaiting_setup past setupDeadline ──────────────────
  const setupFailed = await VehicleTransaction.find({
    status: 'awaiting_setup',
    setupDeadline: { $lte: now },
  }).lean();

  for (const vt of setupFailed) {
    logger.info(`[vehicleScheduler] setup timeout → cancel ${vt._id}`);
    await cancelTransaction(vt._id.toString(), 'setup_deadline_expired').catch(e =>
      logger.error('[vehicleScheduler] cancelTransaction error', { id: vt._id, error: e.message })
    );
  }

  // ── 2. Deal deadline: in_progress or awaiting_confirmation past transactionDeadline ──
  const dealExpired = await VehicleTransaction.find({
    status: { $in: ['in_progress', 'awaiting_confirmation'] },
    transactionDeadline: { $lte: now },
    $or: [
      { 'completion.buyerConfirmed': false },
      { 'completion.sellerConfirmed': false },
    ],
  }).lean();

  for (const vt of dealExpired) {
    logger.info(`[vehicleScheduler] deal deadline → fail ${vt._id}`);
    await failTransaction(vt._id.toString(), 'transaction_deadline_expired').catch(e =>
      logger.error('[vehicleScheduler] failTransaction error', { id: vt._id, error: e.message })
    );
  }

  // ── 3. Auto-complete: awaiting_confirmation past confirmationDeadline (no contestation) ──
  const confirmExpired = await VehicleTransaction.find({
    status: 'awaiting_confirmation',
    confirmationDeadline: { $lte: now },
    'completion.contested': { $ne: true },
    // transactionDeadline still in future (or we'd have caught it above)
    transactionDeadline: { $gt: now },
  }).lean();

  for (const vt of confirmExpired) {
    logger.info(`[vehicleScheduler] confirmation silence → auto-complete ${vt._id}`);
    await completeTransaction(vt._id.toString()).catch(e =>
      logger.error('[vehicleScheduler] completeTransaction error', { id: vt._id, error: e.message })
    );
  }

  logger.info('[vehicleScheduler] done', {
    setupFailed: setupFailed.length,
    dealExpired: dealExpired.length,
    confirmExpired: confirmExpired.length,
  });
}

function startVehicleTransactionScheduler() {
  runVehicleTransactionScheduler().catch(e =>
    logger.error('[vehicleScheduler] initial tick error', { error: e.message })
  );
  return setInterval(() => {
    runVehicleTransactionScheduler().catch(e =>
      logger.error('[vehicleScheduler] tick error', { error: e.message })
    );
  }, TICK_INTERVAL_MS);
}

module.exports = { startVehicleTransactionScheduler, runVehicleTransactionScheduler };
