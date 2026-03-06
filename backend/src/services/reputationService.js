/**
 * Reputation Service: score calculation, trust badges, fraud detection.
 * - Isolated incident: minor penalty, fast recovery
 * - Recurring pattern: higher penalty, affects Private Room eligibility
 * - Recovery: successful transactions improve score over time
 */

const User = require('../models/User');
const Review = require('../models/Review');
const Transaction = require('../models/Transaction');
const ReviewFlag = require('../models/ReviewFlag');

const REPUTATION_MAX = 100;
const REPUTATION_MIN = 0;
const LOW_SCORE_THRESHOLD = 4; // Score <= 4 is "negative"
const RECURRING_THRESHOLD = 2; // 2+ low reviews in last 10 = recurring
const PRIVATE_ROOM_MIN_REPUTATION = 60;
const PRE_AUTHORIZED_MIN_BALANCE = 100;
const DISPUTE_LOSS_PENALTY = 25; // Per dispute loss
const ISOLATED_LOW_REVIEW_PENALTY = 5;
const RECURRING_LOW_REVIEW_PENALTY = 15;
const SUCCESSFUL_TX_RECOVERY = 2; // Points per successful transaction (capped)

/**
 * Recalculate reputation for a user based on reviews, disputes, and successful transactions.
 */
async function recalculateReputation(userId) {
  const user = await User.findById(userId);
  if (!user) return null;

  let score = REPUTATION_MAX;
  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  // 1. Dispute losses (fraud / at-fault) - significant penalty
  const disputeLosses = user.disputeLossCount || 0;
  score -= disputeLosses * DISPUTE_LOSS_PENALTY;

  // 2. Low reviews received (as reviewee) - check isolated vs recurring
  const lowReviews = await Review.find({
    reviewee: userId,
    score: { $lte: LOW_SCORE_THRESHOLD },
    createdAt: { $gte: sixMonthsAgo }
  }).lean();

  const lowCount = lowReviews.length;
  if (lowCount >= RECURRING_THRESHOLD) {
    score -= RECURRING_LOW_REVIEW_PENALTY * lowCount;
  } else if (lowCount === 1) {
    score -= ISOLATED_LOW_REVIEW_PENALTY;
  }

  // 3. Recovery from successful transactions
  const successfulTx = user.successfulTransactionCount || 0;
  const recovery = Math.min(successfulTx * SUCCESSFUL_TX_RECOVERY, 20);
  score += recovery;

  score = Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, Math.round(score)));

  user.reputationScore = score;
  user.reputationUpdatedAt = new Date();
  await user.save();

  return score;
}

/**
 * Apply dispute verdict impact: increment disputeLossCount for the party ruled against.
 */
async function applyDisputeVerdictImpact(verdict, buyerUserId, sellerUserId) {
  if (verdict === 'buyer_refund') {
    await User.findByIdAndUpdate(sellerUserId, { $inc: { disputeLossCount: 1 } });
  } else if (verdict === 'seller_payout') {
    await User.findByIdAndUpdate(buyerUserId, { $inc: { disputeLossCount: 1 } });
  } else if (verdict === 'partial_refund') {
    await User.findByIdAndUpdate(buyerUserId, { $inc: { disputeLossCount: 1 } });
    await User.findByIdAndUpdate(sellerUserId, { $inc: { disputeLossCount: 1 } });
  }
  await recalculateReputation(buyerUserId);
  await recalculateReputation(sellerUserId);
}

/**
 * Increment successful transaction count for both parties (call when transaction completes with both reviews).
 */
async function recordSuccessfulTransaction(buyerUserId, sellerUserId) {
  await User.findByIdAndUpdate(buyerUserId, { $inc: { successfulTransactionCount: 1 } });
  await User.findByIdAndUpdate(sellerUserId, { $inc: { successfulTransactionCount: 1 } });
  await recalculateReputation(buyerUserId);
  await recalculateReputation(sellerUserId);
}

/**
 * Check for suspicious review patterns and create ReviewFlag if needed.
 */
async function checkReviewFraud(review) {
  const flags = [];
  const tx = await Transaction.findOne({ listing: review.listing }).lean();
  if (!tx) return flags;

  const completedAt = tx.updatedAt || tx.createdAt;
  const reviewCreated = review.createdAt || new Date();
  const minutesSinceCompletion = (reviewCreated - completedAt) / (60 * 1000);

  // Rapid submission: review within 2 minutes of completion
  if (minutesSinceCompletion < 2) {
    flags.push({ reason: 'rapid_submission', metadata: { minutesSinceCompletion } });
  }

  // Extreme score (1 or 10) with no description
  if ((review.score === 1 || review.score === 10) && !review.description?.trim()) {
    flags.push({ reason: 'extreme_score', metadata: { score: review.score } });
  }

  // Retaliation: check if other party also left low score
  const otherRole = review.role === 'as_buyer' ? 'as_seller' : 'as_buyer';
  const otherReview = await Review.findOne({
    listing: review.listing,
    role: otherRole,
    reviewee: review.reviewer
  }).lean();
  if (otherReview && otherReview.score <= LOW_SCORE_THRESHOLD && review.score <= LOW_SCORE_THRESHOLD) {
    flags.push({ reason: 'retaliation', metadata: { otherScore: otherReview.score } });
  }

  for (const f of flags) {
    await ReviewFlag.create({
      review: review._id,
      reason: f.reason,
      metadata: f.metadata,
      status: 'pending'
    });
  }
  return flags;
}

/**
 * Get trust badges for a user.
 */
async function getTrustBadges(user) {
  if (!user) return [];
  const badges = [];

  if (user.hasDeposit) {
    badges.push({ id: 'verified_funds', label: 'Verified Funds', description: 'Has completed deposit verification' });
  }
  if ((user.depositAmount || 0) >= PRE_AUTHORIZED_MIN_BALANCE) {
    badges.push({ id: 'pre_authorized', label: 'Pre-authorized', description: 'Pre-authorized for faster checkout' });
  }

  const reputation = user.reputationScore ?? 100;
  if (reputation >= PRIVATE_ROOM_MIN_REPUTATION && (user.disputeLossCount || 0) === 0) {
    badges.push({ id: 'private_room_eligible', label: 'Private Room Eligible', description: 'Eligible for exclusive private auctions' });
  }

  return badges;
}

/**
 * Check if user is eligible for Private Room (reputation + no recent dispute loss).
 */
function isPrivateRoomEligible(user) {
  if (!user) return false;
  const score = user.reputationScore ?? 100;
  const disputeLosses = user.disputeLossCount || 0;
  return score >= PRIVATE_ROOM_MIN_REPUTATION && disputeLosses === 0;
}

module.exports = {
  recalculateReputation,
  applyDisputeVerdictImpact,
  recordSuccessfulTransaction,
  checkReviewFraud,
  getTrustBadges,
  isPrivateRoomEligible,
  PRIVATE_ROOM_MIN_REPUTATION,
  REPUTATION_MAX,
  REPUTATION_MIN
};
