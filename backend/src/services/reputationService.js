/**
 * Reputation Service: score calculation, trust badges, fraud detection.
 *
 * Negative reviews are classified as one of two patterns before a penalty is applied:
 *
 * ── Isolated Incident (II) ────────────────────────────────────────────────────
 *   ALL of the following must be true:
 *   • ≤ 3 negative ratings within the last 30 transactions
 *   • No negative ratings in the 60–90-day lookback window
 *   • Current reputation score ≥ II_MIN_REPUTATION (80 / "4 stars")
 *   Impact: small score decrease; fast recovery through positive future ratings.
 *
 * ── Recurring Pattern (RP) ────────────────────────────────────────────────────
 *   ANY one of the following is sufficient:
 *   • ≥ 2 negative ratings within the last 5 transactions
 *   • ≥ 5 negative ratings within a 90-day window
 *   • Current reputation score already below II_MIN_REPUTATION
 *   Impact: larger penalty per negative review; score naturally drops below
 *   PRIVATE_ROOM_MIN_REPUTATION, restricting access to Private Rooms.
 */

const User = require('../models/User');
const Review = require('../models/Review');
const Transaction = require('../models/Transaction');
const ReviewFlag = require('../models/ReviewFlag');

// ── Score bounds ───────────────────────────────────────────────────────────────
const REPUTATION_MAX = 100;
const REPUTATION_MIN = 0;

// ── Review classification ──────────────────────────────────────────────────────
const LOW_SCORE_THRESHOLD = 2;       // Review score ≤ 2 counts as negative (1–5 scale)
const ISOLATED_MAX_IN_30_TX = 3;     // Max negatives in last 30 tx → Isolated Incident
const RECURRING_MIN_IN_5_TX = 2;     // ≥ 2 negatives in last 5 tx → Recurring Pattern
const RECURRING_MIN_IN_90_DAYS = 5;  // ≥ 5 negatives in 90-day window → Recurring Pattern
const II_MIN_REPUTATION = 80;        // Score must be ≥ 80 ("4 stars") for II classification

// ── Penalties & recovery ───────────────────────────────────────────────────────
const DISPUTE_LOSS_PENALTY = 25;
const ISOLATED_LOW_REVIEW_PENALTY = 5;   // Per negative review — Isolated Incident
const RECURRING_LOW_REVIEW_PENALTY = 20; // Per negative review — Recurring Pattern
const SUCCESSFUL_TX_RECOVERY = 2;        // Points per successful transaction
const MAX_RECOVERY = 20;                 // Recovery cap

// ── Access control ─────────────────────────────────────────────────────────────
const PRIVATE_ROOM_MIN_REPUTATION = 60; // Score must be ≥ 60 for Private Room access
const PRE_AUTHORIZED_MIN_BALANCE = 100;

// ── Auto-suspension ────────────────────────────────────────────────────────────
const AUTO_SUSPEND_MIN_REVIEWS = 20;     // Minimum seller reviews before auto-suspend kicks in
const AUTO_SUSPEND_AVG_THRESHOLD = 3;    // Average score (1–5) below which seller is suspended

/**
 * Classify a user's current negative review pattern.
 *
 * Returns:
 *   classification: 'recurring' | 'isolated' | 'none'
 *   negatives: { inLast5Tx, inLast30Tx, ninetyDays }
 */
async function classifyNegativePattern(userId, currentScore) {
  const now = new Date();
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo  = new Date(now - 60 * 24 * 60 * 60 * 1000);

  // Fetch last 5 and last 30 transactions for this user
  const [last5Tx, last30Tx] = await Promise.all([
    Transaction.find({ $or: [{ buyer: userId }, { seller: userId }] })
      .sort({ createdAt: -1 }).limit(5).select('listing').lean(),
    Transaction.find({ $or: [{ buyer: userId }, { seller: userId }] })
      .sort({ createdAt: -1 }).limit(30).select('listing').lean()
  ]);

  const last5ListingIds  = last5Tx.map(t => t.listing);
  const last30ListingIds = last30Tx.map(t => t.listing);

  const [negativesIn5Tx, negativesIn30Tx, negativesIn90Days, negativesIn60to90Days] =
    await Promise.all([
      Review.countDocuments({
        reviewee: userId,
        listing: { $in: last5ListingIds },
        score: { $lte: LOW_SCORE_THRESHOLD }
      }),
      Review.countDocuments({
        reviewee: userId,
        listing: { $in: last30ListingIds },
        score: { $lte: LOW_SCORE_THRESHOLD }
      }),
      Review.countDocuments({
        reviewee: userId,
        score: { $lte: LOW_SCORE_THRESHOLD },
        createdAt: { $gte: ninetyDaysAgo }
      }),
      // 60–90-day window: used to verify no prior negatives for II
      Review.countDocuments({
        reviewee: userId,
        score: { $lte: LOW_SCORE_THRESHOLD },
        createdAt: { $gte: ninetyDaysAgo, $lt: sixtyDaysAgo }
      })
    ]);

  const negatives = { inLast5Tx: negativesIn5Tx, inLast30Tx: negativesIn30Tx, ninetyDays: negativesIn90Days };

  // No negatives at all → nothing to classify
  if (negativesIn90Days === 0 && negativesIn30Tx === 0) {
    return { classification: 'none', negatives };
  }

  // ── Recurring Pattern: any one condition is sufficient ─────────────────────
  const isRecurring =
    negativesIn5Tx >= RECURRING_MIN_IN_5_TX ||
    negativesIn90Days >= RECURRING_MIN_IN_90_DAYS ||
    currentScore < II_MIN_REPUTATION;

  if (isRecurring) {
    return { classification: 'recurring', negatives };
  }

  // ── Isolated Incident: all conditions must hold ────────────────────────────
  const isIsolated =
    negativesIn30Tx <= ISOLATED_MAX_IN_30_TX &&
    negativesIn60to90Days === 0 &&
    currentScore >= II_MIN_REPUTATION;

  if (isIsolated) {
    return { classification: 'isolated', negatives };
  }

  return { classification: 'none', negatives };
}

/**
 * Recalculate reputation for a user based on reviews, disputes, and successful transactions.
 */
async function recalculateReputation(userId) {
  const user = await User.findById(userId);
  if (!user) return null;

  const currentScore = user.reputationScore ?? REPUTATION_MAX;
  let score = REPUTATION_MAX;

  // 1. Dispute losses — significant penalty regardless of pattern
  score -= (user.disputeLossCount || 0) * DISPUTE_LOSS_PENALTY;

  // 2. Classify and penalise negative reviews
  const { classification, negatives } = await classifyNegativePattern(userId, currentScore);

  if (classification === 'recurring') {
    // Penalise every negative in the 90-day window
    score -= negatives.ninetyDays * RECURRING_LOW_REVIEW_PENALTY;
  } else if (classification === 'isolated') {
    // Smaller per-review penalty for the negatives in the last 30 transactions
    score -= negatives.inLast30Tx * ISOLATED_LOW_REVIEW_PENALTY;
  }

  // 3. Recovery from successful transactions (capped)
  const recovery = Math.min((user.successfulTransactionCount || 0) * SUCCESSFUL_TX_RECOVERY, MAX_RECOVERY);
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
 * Increment successful transaction count for both parties and trigger recovery recalculation.
 */
async function recordSuccessfulTransaction(buyerUserId, sellerUserId) {
  await User.findByIdAndUpdate(buyerUserId, { $inc: { successfulTransactionCount: 1 } });
  await User.findByIdAndUpdate(sellerUserId, { $inc: { successfulTransactionCount: 1 } });
  await recalculateReputation(buyerUserId);
  await recalculateReputation(sellerUserId);
}

/**
 * Check for suspicious review patterns and create ReviewFlag records if warranted.
 * All independent heuristic queries run in parallel for low latency.
 */
async function checkReviewFraud(review) {
  const flags = [];
  const tx = await Transaction.findOne({ listing: review.listing }).lean();
  if (!tx) return flags;

  const completedAt = tx.completedAt || tx.updatedAt || tx.createdAt;
  const reviewCreated = review.createdAt || new Date();
  const minutesSinceCompletion = (reviewCreated - completedAt) / (60 * 1000);

  // Rapid submission: review within 2 minutes of completion
  if (minutesSinceCompletion < 2) {
    flags.push({ reason: 'rapid_submission', metadata: { minutesSinceCompletion } });
  }

  // Extreme score (1 or 5) with no description
  if ((review.score === 1 || review.score === 5) && !review.description?.trim()) {
    flags.push({ reason: 'extreme_score', metadata: { score: review.score } });
  }

  const otherRole = review.role === 'as_buyer' ? 'as_seller' : 'as_buyer';
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [otherReview, pairReviewCount, ipClusterCount] = await Promise.all([
    Review.findOne({ listing: review.listing, role: otherRole, reviewee: review.reviewer }).lean(),
    Review.countDocuments({
      reviewer: review.reviewer,
      reviewee: review.reviewee,
      createdAt: { $gte: ninetyDaysAgo }
    }),
    review.reviewerIp
      ? Review.countDocuments({
          reviewee: review.reviewee,
          reviewerIp: review.reviewerIp,
          score: { $gte: 4 },
          createdAt: { $gte: thirtyDaysAgo }
        })
      : Promise.resolve(0)
  ]);

  if (otherReview && otherReview.score <= LOW_SCORE_THRESHOLD && review.score <= LOW_SCORE_THRESHOLD) {
    flags.push({ reason: 'retaliation', metadata: { otherScore: otherReview.score } });
  }
  if (pairReviewCount >= 4) {
    flags.push({ reason: 'duplicate_pattern', metadata: { pairReviewCount, windowDays: 90 } });
  }
  if (review.reviewerIp && ipClusterCount >= 3) {
    flags.push({
      reason: 'ip_cluster',
      metadata: { reviewerIp: review.reviewerIp, clusteredPositiveReviews: ipClusterCount, windowDays: 30 }
    });
  }

  if (flags.length === 0) return flags;

  await Promise.all(
    flags.map(f =>
      ReviewFlag.create({ review: review._id, reason: f.reason, metadata: f.metadata, status: 'pending' })
        .catch(err => console.error('ReviewFlag create:', err.message))
    )
  );
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

  const reputation = user.reputationScore ?? REPUTATION_MAX;
  if (reputation >= PRIVATE_ROOM_MIN_REPUTATION && (user.disputeLossCount || 0) === 0) {
    badges.push({ id: 'private_room_eligible', label: 'Private Room Eligible', description: 'Eligible for exclusive private auctions' });
  }

  return badges;
}

/**
 * Check if user is eligible for Private Room access.
 * Recurring Pattern users naturally fall below this threshold from the larger penalty.
 */
function isPrivateRoomEligible(user) {
  if (!user) return false;
  const score = user.reputationScore ?? REPUTATION_MAX;
  const disputeLosses = user.disputeLossCount || 0;
  return score >= PRIVATE_ROOM_MIN_REPUTATION && disputeLosses === 0;
}

module.exports = {
  classifyNegativePattern,
  recalculateReputation,
  applyDisputeVerdictImpact,
  recordSuccessfulTransaction,
  checkReviewFraud,
  getTrustBadges,
  isPrivateRoomEligible,
  PRIVATE_ROOM_MIN_REPUTATION,
  II_MIN_REPUTATION,
  LOW_SCORE_THRESHOLD,
  REPUTATION_MAX,
  REPUTATION_MIN,
  AUTO_SUSPEND_MIN_REVIEWS,
  AUTO_SUSPEND_AVG_THRESHOLD
};
