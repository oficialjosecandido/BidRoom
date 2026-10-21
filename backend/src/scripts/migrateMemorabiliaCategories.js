require('dotenv').config();
const connectDB = require('../config/database');
const Listing = require('../models/Listing');
const { CATEGORY_IDS } = require('../config/categories');

/**
 * Three subcategories changed parent when the catalogue was expanded:
 * memorabilia used to be lumped under collectibles, and now lives with the
 * category it belongs to.
 *
 * subCategory is a free String, not an enum, so nothing in Mongo rejects the
 * old pairing — a listing simply keeps claiming a subcategory its category no
 * longer offers, which makes it unreachable from the category filter and makes
 * the add-listing form blank the field on the next edit. Hence this script.
 *
 * Dry run by default; pass --apply to write.
 */
const MOVES = [
  { subCategory: 'Sports Memorabilia', from: 'collectibles', to: 'sports' },
  { subCategory: 'Music Memorabilia', from: 'collectibles', to: 'music-film' },
  { subCategory: 'Movie Memorabilia', from: 'collectibles', to: 'music-film' },
];

const run = async () => {
  const apply = process.argv.includes('--apply');

  try {
    await connectDB();
    console.log(apply ? '▶ APPLY mode\n' : '▶ DRY RUN — nothing is written, pass --apply to commit\n');

    let total = 0;

    for (const { subCategory, from, to } of MOVES) {
      const filter = { category: from, subCategory };
      const count = await Listing.countDocuments(filter);
      total += count;

      if (!count) {
        console.log(`   ${subCategory}: nothing to move`);
        continue;
      }

      console.log(`   ${subCategory}: ${count} listing(s) ${from} → ${to}`);

      if (apply) {
        const res = await Listing.updateMany(filter, { $set: { category: to } });
        console.log(`     updated ${res.modifiedCount}`);
      }
    }

    // Anything else holding a category that no longer exists would be invisible
    // in the browse filters, so report it rather than guess at a new home.
    const orphans = await Listing.distinct('category', { category: { $nin: CATEGORY_IDS } });
    if (orphans.length) {
      console.log(`\n⚠️  categories not in CATEGORY_IDS, needing a manual decision: ${orphans.join(', ')}`);
    }

    console.log(`\n✅ ${apply ? 'Migration complete' : 'Dry run complete'} — ${total} listing(s) affected`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

run();
