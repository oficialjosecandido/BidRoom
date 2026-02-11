/**
 * Migration: Convert existing reviews from rating (1-5) / comment to score (1-10) / description.
 * Run: node -r dotenv/config src/scripts/migrateReviewsToScore.js
 */
require('../config/database');
const Review = require('../models/Review');

async function run() {
  const reviews = await Review.find({ $or: [{ score: { $exists: false } }, { score: null }] }).lean();
  console.log(`Found ${reviews.length} reviews to migrate`);
  let updated = 0;
  for (const r of reviews) {
    const rating = r.rating;
    if (rating == null) continue;
    const score = Math.min(10, Math.max(1, Math.round(rating * 2))); // 1-5 -> 2,4,6,8,10
    await Review.updateOne(
      { _id: r._id },
      { $set: { score, description: r.comment || r.description || null }, $unset: { rating: '', comment: '' } }
    );
    updated++;
  }
  console.log(`Migrated ${updated} reviews`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
