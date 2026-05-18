/**
 * One-off migration: generate slugs for all existing users who don't have one.
 * Run once: node src/scripts/backfillUserSlugs.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const users = await User.find({ slug: { $in: [null, undefined, ''] } })
    .select('_id firstName lastName slug')
    .lean();

  console.log(`Found ${users.length} users without a slug`);

  let updated = 0;
  for (const u of users) {
    const base = User.buildSlugBase(u.firstName, u.lastName);
    const slug = await User.generateUniqueSlug(base, u._id);
    await User.updateOne({ _id: u._id }, { $set: { slug } });
    console.log(`  ${u.firstName} ${u.lastName} → ${slug}`);
    updated++;
  }

  console.log(`\nDone. Updated ${updated} users.`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
