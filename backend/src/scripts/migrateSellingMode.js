/**
 * Migration: `auctionFormat` -> `sellingMode` on listings.
 *
 *   highest-bid -> bidding
 *   best-offer  -> offers
 *
 * Run: node -r dotenv/config src/scripts/migrateSellingMode.js
 *      node -r dotenv/config src/scripts/migrateSellingMode.js --dry-run
 *
 * Idempotent: it only touches documents that still carry the old field, so
 * running it twice is a no-op, and it can be run again after a deploy to catch
 * anything written in between.
 *
 * Deliberately uses the raw collection rather than the Listing model. The model
 * no longer declares `auctionFormat`, so Mongoose's strict mode would filter it
 * out of both the query and the `$unset` — the migration would report success
 * having changed nothing.
 *
 * Why there is no transitional alias: a Mongoose virtual does not exist in the
 * database, so it cannot appear in a query filter and is stripped by `.lean()`.
 * Ten call sites read the field exactly those two ways, and every one of them
 * would have returned an empty set or `undefined` without raising anything. The
 * rename is therefore atomic, and this script is the other half of it.
 */
require('../config/database');
const mongoose = require('mongoose');

const MODE_BY_FORMAT = {
  'highest-bid': 'bidding',
  'best-offer': 'offers'
};

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  // The driver is only usable once the connection is actually open; without
  // this the first command races the handshake on a cold start.
  await mongoose.connection.asPromise();
  const listings = mongoose.connection.collection('listings');

  const stale = await listings.countDocuments({ auctionFormat: { $exists: true } });
  const alreadyDone = await listings.countDocuments({ sellingMode: { $exists: true } });
  console.log(`${stale} listing(s) still on auctionFormat; ${alreadyDone} already on sellingMode`);

  if (dryRun) {
    for (const [format, mode] of Object.entries(MODE_BY_FORMAT)) {
      const n = await listings.countDocuments({ auctionFormat: format });
      console.log(`  would set sellingMode='${mode}' on ${n} listing(s) (${format})`);
    }
    const odd = await listings.countDocuments({
      auctionFormat: { $exists: true, $nin: Object.keys(MODE_BY_FORMAT) }
    });
    console.log(`  ${odd} listing(s) with an unrecognised auctionFormat would default to 'bidding'`);
    console.log('dry run — nothing written');
    return;
  }

  let migrated = 0;
  for (const [format, mode] of Object.entries(MODE_BY_FORMAT)) {
    const res = await listings.updateMany(
      { auctionFormat: format },
      { $set: { sellingMode: mode }, $unset: { auctionFormat: '' } }
    );
    console.log(`  ${format} -> ${mode}: ${res.modifiedCount}`);
    migrated += res.modifiedCount;
  }

  // A document with neither field, or with a value never in the enum, would
  // fail validation on its next save. The schema default is bidding, so that is
  // what it gets — stated here rather than left to the schema, because a
  // document that is never saved again would otherwise keep no mode at all.
  const fallback = await listings.updateMany(
    { sellingMode: { $exists: false } },
    { $set: { sellingMode: 'bidding' }, $unset: { auctionFormat: '' } }
  );
  if (fallback.modifiedCount) {
    console.log(`  no recognisable format -> bidding: ${fallback.modifiedCount}`);
    migrated += fallback.modifiedCount;
  }

  // The old field was indexed. Mongo keeps that index after the field is gone,
  // where it costs writes and nothing else.
  const indexes = await listings.indexes();
  const orphan = indexes.find((i) => i.name === 'auctionFormat_1');
  if (orphan) {
    await listings.dropIndex('auctionFormat_1');
    console.log('  dropped orphaned index auctionFormat_1');
  }

  const remaining = await listings.countDocuments({ auctionFormat: { $exists: true } });
  console.log(`\nmigrated ${migrated} listing(s); ${remaining} still carrying auctionFormat`);
  if (remaining > 0) {
    throw new Error('some listings still carry auctionFormat — investigate before deploying');
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
