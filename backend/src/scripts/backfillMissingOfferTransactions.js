/**
 * Backfill Transaction docs for accepted Best Offers that never got one.
 *
 * Usage (from backend/):
 *   node src/scripts/backfillMissingOfferTransactions.js
 *   node src/scripts/backfillMissingOfferTransactions.js --dry-run
 *
 * Requires MONGO_URI in backend/.env (use prod URI carefully).
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { healMissingOfferTransactions } = require('../services/transactionService');
const Offer = require('../models/Offer');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGO_URI not set');

  await mongoose.connect(uri);
  console.log(`Connected to ${mongoose.connection.name}${dryRun ? ' (dry-run)' : ''}`);

  const accepted = await Offer.find({ status: 'accepted', offerer: { $ne: null } })
    .select('_id listing amount')
    .lean();
  const listingIds = [...new Set(accepted.map((o) => o.listing.toString()))];
  const existing = await Transaction.find({ listing: { $in: listingIds } }).select('listing').lean();
  const hasTx = new Set(existing.map((t) => t.listing.toString()));
  const missing = accepted.filter((o) => !hasTx.has(o.listing.toString()));

  console.log(`Accepted offers: ${accepted.length}`);
  console.log(`Missing transactions: ${missing.length}`);
  for (const o of missing) {
    console.log(`  - offer ${o._id} listing ${o.listing} amount ${o.amount}`);
  }

  if (dryRun || missing.length === 0) {
    await mongoose.disconnect();
    return;
  }

  const created = await healMissingOfferTransactions({ notify: true });
  console.log(`Created ${created.length} transaction(s)`);
  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error(err);
  console.error(err);
  process.exit(1);
});
