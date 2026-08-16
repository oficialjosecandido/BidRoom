const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Review = require('../models/Review');
const ReviewFlag = require('../models/ReviewFlag');
const ReviewAppeal = require('../models/ReviewAppeal');
const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const { authenticateToken } = require('../middleware/auth');
const { getReviewScoresForUser } = require('../services/reviewService');
const {
  checkReviewFraud,
  recalculateReputation,
  getTrustBadges,
  isPrivateRoomEligible,
  AUTO_SUSPEND_MIN_REVIEWS,
  AUTO_SUSPEND_AVG_THRESHOLD
} = require('../services/reputationService');
const { suspendUser, ACCOUNT_STATUS } = require('../services/accountStatusService');
const { scanForAbusiveContent } = require('../utils/contentFilter');
const logger = require('../utils/logger');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';

/**
 * Build a 500-response payload that does not leak internal error details in production.
 * In development the underlying message is included to ease debugging.
 */
function serverError(error, fallbackMessage) {
  return {
    error: fallbackMessage,
    message: isProd ? fallbackMessage : (error?.message || fallbackMessage)
  };
}

/**
 * Validate that a value is a well-formed Mongo ObjectId.
 * Rejects operator objects (e.g. {"$ne": null}), arrays, and malformed strings,
 * which closes the NoSQL operator-injection vector for these endpoints.
 */
function isValidObjectId(value) {
  if (value == null) return false;
  if (typeof value !== 'string' && !(value instanceof mongoose.Types.ObjectId)) return false;
  return mongoose.isValidObjectId(value);
}

/**
 * Hash a reviewer IP with a server-side secret before persistence.
 * - Avoids storing raw PII (GDPR data-minimisation).
 * - Equality-preserving: same input + secret always produces the same digest,
 *   so the IP-cluster heuristic continues to work without modification.
 */
const IP_HASH_SECRET = process.env.REVIEW_IP_HASH_SECRET || process.env.JWT_SECRET || 'bidroom-review-ip-salt';
function hashReviewerIp(ip) {
  if (!ip || typeof ip !== 'string') return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  return crypto.createHmac('sha256', IP_HASH_SECRET).update(trimmed).digest('hex');
}

/**
 * GET /api/reviews/reputation/:userId
 * Public: get reputation score, trust badges, and review scores for a user.
 * Note: internal pattern classification is intentionally NOT exposed here to avoid
 * leaking enforcement signals to adversaries.
 */
router.get('/reputation/:userId', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const user = await Customer.findById(req.params.userId)
      .select('reputationScore disputeLossCount successfulTransactionCount hasDeposit depositAmount')
      .lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const [scores, badges] = await Promise.all([
      getReviewScoresForUser(req.params.userId),
      getTrustBadges(user)
    ]);
    res.json({
      reputationScore: user.reputationScore ?? 100,
      privateRoomEligible: isPrivateRoomEligible(user),
      badges,
      ...scores
    });
  } catch (error) {
    logger.error('Error fetching reputation:', error);
    res.status(500).json(serverError(error, 'Failed to fetch reputation'));
  }
});

/**
 * GET /api/reviews/scores/:userId
 * Public: get buyer and seller review scores for a user (by User _id).
 */
router.get('/scores/:userId', async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const scores = await getReviewScoresForUser(req.params.userId);
    res.json(scores);
  } catch (error) {
    logger.error('Error fetching review scores:', error);
    res.status(500).json(serverError(error, 'Failed to fetch review scores'));
  }
});

/** Reviews are only allowed after completion and within 30 days */
const REVIEWABLE_STATUSES = ['completed', 'cancelled'];
const REVIEW_WINDOW_DAYS = 30;
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const ALLOWED_TAGS = [
  'fast_payment', 'fast_shipping', 'item_as_described', 'great_packaging',
  'good_communication', 'smooth_transaction', 'trustworthy',
  'slow_payment', 'slow_shipping', 'not_as_described', 'poor_communication'
];

/**
 * GET /api/reviews/pending
 * Returns items where the current user can leave a review.
 * Reviews are strictly transaction-based and only available within the 30-day window
 * after the transaction reaches the `completed` status.
 */
router.get('/pending', authenticateToken, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) {
      return res.json({ pending: [] });
    }

    // Single batched query: fetch all reviewable transactions where the user is buyer or seller
    const txList = await Transaction.find({
      $or: [{ seller: user._id }, { buyer: user._id }],
      transactionStatus: { $in: REVIEWABLE_STATUSES }
    })
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate('listing', 'title slug')
      .populate('seller', 'firstName lastName')
      .populate('buyer', 'firstName lastName')
      .lean();

    if (txList.length === 0) {
      return res.json({ pending: [] });
    }

    // Single batched query for existing reviews — avoids N+1 inside the loop
    const listingIds = [...new Set(txList.map((t) => t.listing?._id?.toString()).filter(Boolean))];
    const existingReviews = await Review.find({
      listing: { $in: listingIds },
      reviewer: user._id
    }).select('listing reviewee').lean();
    const existingKeys = new Set(
      existingReviews.map((r) => `${r.listing.toString()}-${r.reviewee.toString()}`)
    );

    const pending = [];
    const now = new Date();
    for (const t of txList) {
      const lid = t.listing?._id?.toString();
      if (!lid) continue;

      const amSeller = t.seller?._id?.toString() === user._id.toString();
      const otherParty = amSeller ? t.buyer : t.seller;
      if (!otherParty) continue;

      const otherId = otherParty._id?.toString();
      if (!otherId) continue;

      const completedAt = t.completedAt ? new Date(t.completedAt) : (t.updatedAt ? new Date(t.updatedAt) : null);
      if (!completedAt) continue;
      const reviewDeadline = new Date(completedAt.getTime() + REVIEW_WINDOW_MS);
      if (reviewDeadline < now) continue;

      if (existingKeys.has(`${lid}-${otherId}`)) continue;

      pending.push({
        listingId: t.listing._id,
        listingTitle: t.listing?.title || 'Item',
        listingSlug: t.listing?.slug || '',
        transactionId: t._id,
        otherPartyId: otherId,
        otherPartyName: `${otherParty.firstName || ''} ${otherParty.lastName || ''}`.trim() || (amSeller ? 'Buyer' : 'Seller'),
        myRole: amSeller ? 'seller' : 'buyer',
        theirRole: amSeller ? 'buyer' : 'seller',
        roleForReview: amSeller ? 'as_buyer' : 'as_seller',
        completedAt,
        reviewDeadline
      });
    }

    res.json({ pending });
  } catch (error) {
    logger.error('Error fetching pending reviews:', error);
    res.status(500).json(serverError(error, 'Failed to fetch pending reviews'));
  }
});

/**
 * GET /api/reviews/mine
 * Returns reviews written by the current user AND reviews received by them.
 */
router.get('/mine', authenticateToken, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [written, received] = await Promise.all([
      Review.find({ reviewer: user._id })
        .sort({ createdAt: -1 })
        .populate('reviewee', 'firstName lastName slug')
        .populate('listing', 'title slug images')
        .limit(200)
        .lean(),
      Review.find({ reviewee: user._id })
        .sort({ createdAt: -1 })
        .populate('reviewer', 'firstName lastName slug')
        .populate('listing', 'title slug images')
        .limit(200)
        .lean()
    ]);

    const sanitizedReceived = received.map(({ description: _d, reviewerIp: _ip, reviewerUserAgent: _ua, ...r }) => r);

    res.json({ written, received: sanitizedReceived });
  } catch (error) {
    logger.error('Error fetching my reviews:', error);
    res.status(500).json(serverError(error, 'Failed to fetch reviews'));
  }
});

/**
 * GET /api/reviews/appeals/mine
 * List appeals created by the authenticated user.
 */
router.get('/appeals/mine', authenticateToken, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const appeals = await ReviewAppeal.find({ appellant: user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ appeals });
  } catch (error) {
    logger.error('Error fetching my appeals:', error);
    res.status(500).json(serverError(error, 'Failed to fetch appeals'));
  }
});

/**
 * After a new review is saved, decide whether the seller should be auto-suspended
 * for sustained low ratings (< AUTO_SUSPEND_AVG_THRESHOLD across ≥ AUTO_SUSPEND_MIN_REVIEWS).
 *
 * Uses the standard accountStatusService so the action is audit-logged and notifies
 * the affected user — same plumbing as manual admin suspensions.
 */
async function maybeAutoSuspendSeller(sellerId, io) {
  try {
    const stats = await Review.aggregate([
      { $match: { reviewee: new mongoose.Types.ObjectId(sellerId), role: 'as_seller' } },
      { $group: { _id: '$reviewee', avg: { $avg: '$score' }, count: { $sum: 1 } } }
    ]);
    const row = stats[0];
    if (!row || row.count < AUTO_SUSPEND_MIN_REVIEWS || row.avg >= AUTO_SUSPEND_AVG_THRESHOLD) {
      return;
    }
    const seller = await Customer.findById(sellerId).select('accountStatus').lean();
    if (!seller || seller.accountStatus === ACCOUNT_STATUS.SUSPENDED || seller.accountStatus === ACCOUNT_STATUS.CLOSED) {
      return;
    }
    await suspendUser(
      sellerId,
      {
        reason: 'auto_low_rating',
        triggeredBy: 'system',
      },
      io
    );
    logger.info(`[Reviews] Auto-suspended seller ${sellerId} (avg=${row.avg.toFixed(2)}, count=${row.count})`);
  } catch (err) {
    logger.error('Auto-suspend check failed:', err.message);
  }
}

/**
 * POST /api/reviews
 * Create a review (after a completed transaction).
 * Body: { listingId, toUserId, role: 'as_buyer' | 'as_seller', score: 1-5, description? }
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { listingId, toUserId, role, score, rating, description, tags } = req.body;
    const scoreVal = score != null ? score : rating; // support legacy 'rating' param

    if (!listingId || !toUserId || !role || scoreVal == null) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'listingId, toUserId, role and score are required'
      });
    }
    if (!isValidObjectId(listingId) || !isValidObjectId(toUserId)) {
      return res.status(400).json({ error: 'Invalid id', message: 'listingId and toUserId must be valid ObjectIds' });
    }
    if (!['as_buyer', 'as_seller'].includes(role)) {
      return res.status(400).json({
        error: 'Invalid role',
        message: 'role must be as_buyer or as_seller'
      });
    }
    const scoreNum = parseInt(scoreVal, 10);
    if (Number.isNaN(scoreNum) || scoreNum < 1 || scoreNum > 5) {
      return res.status(400).json({
        error: 'Invalid score',
        message: 'score must be between 1 and 5'
      });
    }

    const user = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) {
      return res.status(403).json({
        error: 'User not found',
        message: 'Please complete your profile first'
      });
    }

    const toId = toUserId.toString();

    // Reviews are strictly transaction-based and completion-gated. No legacy listing fallback.
    const transaction = await Transaction.findOne({ listing: listingId }).lean();
    if (!transaction) {
      return res.status(400).json({
        error: 'No transaction',
        message: 'A completed transaction is required to leave a review for this listing'
      });
    }

    const sellerId = (transaction.seller && transaction.seller._id ? transaction.seller._id : transaction.seller)?.toString();
    const buyerId = (transaction.buyer && transaction.buyer._id ? transaction.buyer._id : transaction.buyer)?.toString();
    const ts = transaction.transactionStatus || transaction.status;
    if (ts === 'cancelled') {
      return res.status(400).json({
        error: 'Cancelled transaction',
        message: 'Reviews are not allowed for cancelled transactions'
      });
    }
    if (!REVIEWABLE_STATUSES.includes(ts)) {
      return res.status(400).json({
        error: 'Transaction not reviewable',
        message: 'The transaction must be completed before leaving a review'
      });
    }
    const completedAt = transaction.completedAt ? new Date(transaction.completedAt) : (transaction.updatedAt ? new Date(transaction.updatedAt) : null);
    if (!completedAt) {
      return res.status(400).json({
        error: 'Transaction not reviewable',
        message: 'Completion date missing. Please contact support.'
      });
    }
    const reviewDeadline = new Date(completedAt.getTime() + REVIEW_WINDOW_MS);
    if (reviewDeadline < new Date()) {
      return res.status(400).json({
        error: 'Review window expired',
        message: `Reviews can be submitted only within ${REVIEW_WINDOW_DAYS} days of completion`
      });
    }

    const isSeller = sellerId === user._id.toString();
    const isBuyer = buyerId === user._id.toString();
    if (!isSeller && !isBuyer) {
      return res.status(403).json({
        error: 'Not a party to this transaction',
        message: 'Only the buyer or seller can leave a review for this listing'
      });
    }
    if (isSeller && toId !== buyerId) {
      return res.status(400).json({
        error: 'Invalid reviewee',
        message: 'You can only review the buyer for this listing'
      });
    }
    if (isBuyer && toId !== sellerId) {
      return res.status(400).json({
        error: 'Invalid reviewee',
        message: 'You can only review the seller for this listing'
      });
    }

    const existing = await Review.findOne({
      listing: listingId,
      reviewer: user._id,
      reviewee: toUserId
    }).select('_id').lean();
    if (existing) {
      return res.status(409).json({
        error: 'Already reviewed',
        message: 'You have already left a review for this user for this listing'
      });
    }

    const sanitizedTags = Array.isArray(tags)
      ? tags.filter(t => ALLOWED_TAGS.includes(t)).slice(0, 5)
      : [];

    const review = new Review({
      listing: listingId,
      reviewer: user._id,
      reviewee: toUserId,
      role,
      score: scoreNum,
      description: (description && String(description).trim().slice(0, 2000)) || null,
      tags: sanitizedTags,
      transactionCompletedAt: completedAt,
      reviewerIp: hashReviewerIp(req.ip),
      reviewerUserAgent: (req.get('user-agent') || '').slice(0, 500) || null
    });

    try {
      await review.save();
    } catch (saveErr) {
      // Concurrent submissions can race past the application-level existence check
      // and only fail at the unique index — translate that to a clean 409 instead of 500.
      if (saveErr && saveErr.code === 11000) {
        return res.status(409).json({
          error: 'Already reviewed',
          message: 'You have already left a review for this user for this listing'
        });
      }
      throw saveErr;
    }

    // Automated moderation: profanity/hate speech detection (fire-and-forget; non-blocking)
    const abuse = scanForAbusiveContent(review.description || '');
    if (abuse.found) {
      ReviewFlag.create({
        review: review._id,
        reason: 'profanity_hate_speech',
        metadata: { categories: abuse.categories, matches: abuse.matches },
        status: 'pending'
      }).catch(err => logger.error('Profanity flag create:', err.message));
    }

    // Async post-write side-effects: errors here must never break the user-facing response.
    checkReviewFraud(review).catch(err => logger.error('Review fraud check:', err.message));
    recalculateReputation(toUserId).catch(err => logger.error('Reputation recalc:', err.message));

    // Auto-suspend evaluation runs only when a seller is reviewed (role === 'as_seller'
    // means the reviewee was acting as seller). Goes through accountStatusService so it
    // gets a proper audit-log entry + notification, mirroring manual admin suspensions.
    if (role === 'as_seller') {
      const io = req.app.get('io');
      maybeAutoSuspendSeller(toUserId, io);
    }

    // Response: score only (never expose description to other users; reviewer sees their own on create)
    res.status(201).json({
      _id: review._id,
      listing: review.listing,
      reviewee: review.reviewee,
      role: review.role,
      score: review.score,
      createdAt: review.createdAt
    });
  } catch (error) {
    logger.error('Error creating review:', error);
    res.status(500).json(serverError(error, 'Failed to create review'));
  }
});

/**
 * POST /api/reviews/:id/flag
 * User flagging mechanism for abusive/untrustworthy reviews.
 * Body: { reason, details? }
 */
router.post('/:id/flag', authenticateToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid review id' });
    }
    const { reason, details } = req.body;
    const review = await Review.findById(req.params.id).select('_id').lean();
    if (!review) return res.status(404).json({ error: 'Review not found' });
    const user = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const normalized = String(reason || '').trim().toLowerCase();
    const allowed = new Set(['abusive', 'spam', 'fake', 'retaliation', 'other']);
    const label = allowed.has(normalized) ? normalized : 'other';

    try {
      const flag = await ReviewFlag.create({
        review: review._id,
        reason: 'user_report',
        metadata: {
          userReason: label,
          details: details ? String(details).trim().slice(0, 1000) : null,
          reportedBy: user._id.toString()
        },
        status: 'pending'
      });
      return res.status(201).json({ success: true, flagId: flag._id });
    } catch (createErr) {
      // Partial unique index on (review, reason='user_report', metadata.reportedBy, status='pending')
      // prevents the same user from filing multiple pending reports on the same review.
      if (createErr && createErr.code === 11000) {
        return res.status(409).json({ error: 'Already flagged', message: 'You already flagged this review.' });
      }
      throw createErr;
    }
  } catch (error) {
    logger.error('Error flagging review:', error);
    res.status(500).json(serverError(error, 'Failed to flag review'));
  }
});

/**
 * POST /api/reviews/:id/appeals
 * Appeal process for sellers/buyers disputing a review.
 * Body: { reason, details? }
 */
router.post('/:id/appeals', authenticateToken, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid review id' });
    }
    const { reason, details } = req.body;
    if (!reason || String(reason).trim().length < 5) {
      return res.status(400).json({ error: 'Invalid reason', message: 'Appeal reason must be at least 5 characters.' });
    }
    const review = await Review.findById(req.params.id).select('reviewer reviewee').lean();
    if (!review) return res.status(404).json({ error: 'Review not found' });
    const user = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isParty =
      review.reviewer?.toString?.() === user._id.toString() ||
      review.reviewee?.toString?.() === user._id.toString();
    if (!isParty) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only transaction parties can appeal this review.' });
    }

    try {
      const appeal = await ReviewAppeal.create({
        review: review._id,
        appellant: user._id,
        reason: String(reason).trim().slice(0, 500),
        details: details ? String(details).trim().slice(0, 3000) : null
      });
      return res.status(201).json({ success: true, appealId: appeal._id });
    } catch (createErr) {
      // Partial unique index on (review, appellant, status='pending') ensures only one
      // open appeal per (review, user) — translate the duplicate-key error into a clean 409.
      if (createErr && createErr.code === 11000) {
        return res.status(409).json({ error: 'Appeal already open', message: 'You already have a pending appeal for this review.' });
      }
      throw createErr;
    }
  } catch (error) {
    logger.error('Error creating review appeal:', error);
    res.status(500).json(serverError(error, 'Failed to create appeal'));
  }
});

module.exports = router;
