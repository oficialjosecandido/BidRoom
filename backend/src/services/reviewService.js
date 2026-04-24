const mongoose = require('mongoose');
const Review = require('../models/Review');

/**
 * Get review scores (average rating and count) for one or more users.
 * Returns: { [userId]: { buyerScore, buyerReviewCount, sellerScore, sellerReviewCount } }
 * Scores are rounded to 1 decimal; missing users get null scores / 0 counts.
 */
async function getReviewScoresForUsers(userIds) {
  if (!userIds || userIds.length === 0) {
    return {};
  }
  const ids = [...new Set(userIds.map((id) => id && id.toString()).filter(Boolean))];
  if (ids.length === 0) return {};

  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const aggregates = await Review.aggregate([
    { $match: { reviewee: { $in: objectIds } } },
    {
      $group: {
        _id: { reviewee: '$reviewee', role: '$role' },
        avgRating: {
          $avg: {
            $let: {
              vars: { raw: { $ifNull: ['$score', '$rating'] } },
              in: {
                $cond: [{ $gt: ['$$raw', 5] }, { $divide: ['$$raw', 2] }, '$$raw']
              }
            }
          }
        },
        count: { $sum: 1 }
      }
    }
  ]);

  const result = {};
  ids.forEach((id) => {
    result[id] = {
      buyerScore: null,
      buyerReviewCount: 0,
      sellerScore: null,
      sellerReviewCount: 0
    };
  });

  aggregates.forEach((row) => {
    const revieweeId = (row._id.reviewee && row._id.reviewee.toString) ? row._id.reviewee.toString() : String(row._id.reviewee);
    if (!result[revieweeId]) result[revieweeId] = { buyerScore: null, buyerReviewCount: 0, sellerScore: null, sellerReviewCount: 0 };
    if (row._id.role === 'as_buyer') {
      result[revieweeId].buyerScore = Math.round(row.avgRating * 10) / 10;
      result[revieweeId].buyerReviewCount = row.count;
    } else {
      result[revieweeId].sellerScore = Math.round(row.avgRating * 10) / 10;
      result[revieweeId].sellerReviewCount = row.count;
    }
  });

  return result;
}

/**
 * Get review scores for a single user (convenience).
 */
async function getReviewScoresForUser(userId) {
  const map = await getReviewScoresForUsers([userId]);
  return map[userId?.toString()] || { buyerScore: null, buyerReviewCount: 0, sellerScore: null, sellerReviewCount: 0 };
}

module.exports = {
  getReviewScoresForUsers,
  getReviewScoresForUser
};
