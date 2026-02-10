/**
 * Delete proof-of-payment files from Azure Storage 30 days after the transaction was marked paid.
 * Run daily (e.g. from index.js setInterval).
 */

const Transaction = require('../models/Transaction');
const azureStorageService = require('./azureStorage.service');

const DAYS_TO_RETAIN = 30;

async function runCleanup() {
  const baseUrl = azureStorageService.getContainerBaseUrl();
  if (!baseUrl) {
    return; // Azure not configured
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DAYS_TO_RETAIN);

  const transactions = await Transaction.find({
    paidAt: { $lte: cutoff },
    buyerProofOfPaymentUrl: { $nin: [null, ''] }
  }).lean();

  let deleted = 0;
  for (const t of transactions) {
    const url = t.buyerProofOfPaymentUrl;
    if (!url || !url.startsWith(baseUrl)) continue;

    try {
      await azureStorageService.deleteImage(url);
      await Transaction.updateOne(
        { _id: t._id },
        { $set: { buyerProofOfPaymentUrl: null } }
      );
      deleted++;
    } catch (err) {
      console.error('Proof-of-payment cleanup: failed for transaction', t._id, err.message);
    }
  }

  if (deleted > 0) {
    console.log(`[ProofOfPaymentCleanup] Deleted ${deleted} file(s) older than ${DAYS_TO_RETAIN} days.`);
  }
}

module.exports = { runCleanup };
