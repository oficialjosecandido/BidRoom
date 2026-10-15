/**
 * Drops the old unique (listing, participant) index if still present, then
 * syncs GiveawayEntry indexes so one person can hold several entries
 * (rate-limited to once per hour in giveawayService).
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://…" node src/scripts/syncGiveawayEntryIndexes.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const GiveawayEntry = require('../models/GiveawayEntry');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI environment variable is not set');

  await mongoose.connect(uri);
  console.log(`Connected to database: ${mongoose.connection.name}`);

  const indexes = await GiveawayEntry.collection.indexes();
  for (const idx of indexes) {
    const key = idx.key || {};
    const keys = Object.keys(key);
    // Old one-entry-per-person unique: { listing: 1, participant: 1 }
    if (
      idx.unique
      && keys.length === 2
      && key.listing === 1
      && key.participant === 1
    ) {
      await GiveawayEntry.collection.dropIndex(idx.name);
      console.log(`Dropped legacy unique index: ${idx.name}`);
    }
  }

  await GiveawayEntry.syncIndexes();
  console.log('Synced GiveawayEntry indexes:');
  for (const idx of await GiveawayEntry.collection.indexes()) {
    console.log(`  ${idx.name}`, idx.key, idx.unique ? '(unique)' : '');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
