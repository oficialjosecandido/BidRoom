/**
 * Migration script: backfill imageManifest for existing Listing documents.
 *
 * Run once after deploying the image purge system:
 *   node src/scripts/backfillImageBlobNames.js
 *
 * Safe to re-run — skips listings that already have imageManifest populated.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Require after connect so models register cleanly
  const Listing = require('../models/Listing');
  const Transaction = require('../models/Transaction');
  const { extractBlobName } = require('../shared/schemas/imageSchema');

  const RETENTION_DAYS = {
    COMPLETED_TRANSACTION: 10 * 365,
    ENDED_NO_TRANSACTION: 90,
    CANCELLED: 30
  };

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  // Find all listings with images but no manifest
  const cursor = Listing.find({
    images: { $exists: true, $not: { $size: 0 } },
    imageManifest: { $size: 0 }
  }).select('_id status images endDate updatedAt').cursor();

  let processed = 0;
  let errors = 0;

  for await (const listing of cursor) {
    try {
      let purgeAfter = null;

      if (listing.status === 'ended') {
        const hasTx = await Transaction.exists({
          listing: listing._id,
          transactionStatus: 'completed'
        });
        const base = listing.endDate || listing.updatedAt || new Date();
        purgeAfter = hasTx
          ? addDays(base, RETENTION_DAYS.COMPLETED_TRANSACTION)
          : addDays(base, RETENTION_DAYS.ENDED_NO_TRANSACTION);
      } else if (listing.status === 'cancelled') {
        const base = listing.updatedAt || new Date();
        purgeAfter = addDays(base, RETENTION_DAYS.CANCELLED);
      }
      // active/draft listings get null purgeAfter — will be set when they end

      const manifest = (listing.images || []).map(url => ({
        url,
        blobName: extractBlobName(url),
        uploadedAt: listing.updatedAt || new Date(),
        purgeAfter,
        purged: false,
        purgedAt: null
      }));

      await Listing.updateOne({ _id: listing._id }, { $set: { imageManifest: manifest } });
      processed++;

      if (processed % 100 === 0) {
        console.log(`  Processed ${processed} listings...`);
      }
    } catch (err) {
      console.error(`  Error for listing ${listing._id}:`, err.message);
      errors++;
    }
  }

  console.log(`\nDone — ${processed} listings backfilled, ${errors} errors`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
