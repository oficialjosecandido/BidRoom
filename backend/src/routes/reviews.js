const express = require('express');
const Review = require('../models/Review');
const ReviewFlag = require('../models/ReviewFlag');
const ReviewAppeal = require('../models/ReviewAppeal');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { getReviewScoresForUser } = require('../services/reviewService');
const { checkReviewFraud, recalculateReputation, getTrustBadges, isPrivateRoomEligible, classifyNegativePattern } = require('../services/reputationService');
const { scanForAbusiveContent } = require('../utils/contentFilter');

const router = express.Router();

/**
 * GET /api/reviews/reputation/:userId
 * Public: get reputation score, trust badges, and review scores for a user.
 */
router.get('/reputation/:userId', async (req, res) => {
  try {
    const user = await User.findById(req.params.userId)
      .select('reputationScore disputeLossCount successfulTransactionCount hasDeposit depositAmount')
      .lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const [scores, badges, { classification }] = await Promise.all([
      getReviewScoresForUser(req.params.userId),
      getTrustBadges(user),
      classifyNegativePattern(req.params.userId, user.reputationScore ?? 100)
    ]);
    res.json({
      reputationScore: user.reputationScore ?? 100,
      privateRoomEligible: isPrivateRoomEligible(user),
      patternClassification: classification, // 'none' | 'isolated' | 'recurring'
      badges,
      ...scores
    });
  } catch (error) {
    console.error('Error fetching reputation:', error);
    res.status(500).json({ error: 'Failed to fetch reputation', message: error.message });
  }
});

/**
 * GET /api/reviews/scores/:userId
 * Public: get buyer and seller review scores for a user (by User _id).
 */
router.get('/scores/:userId', async (req, res) => {
  try {
    const scores = await getReviewScoresForUser(req.params.userId);
    res.json(scores);
  } catch (error) {
    console.error('Error fetching review scores:', error);
    res.status(500).json({
      error: 'Failed to fetch review scores',
      message: error.message
    });
  }
});

/** Reviews are only allowed after completion and within 30 days */
const REVIEWABLE_STATUSES = ['completed'];
const REVIEW_WINDOW_DAYS = 30;
const REVIEW_WINDOW_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * GET /api/reviews/pending
 * Returns items where the current user can leave a review (buyer/seller and haven't reviewed yet).
 * Uses Transactions as primary source; falls back to Listing.winner for legacy auction-only cases.
 */
router.get('/pending', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.json({ pending: [] });
    }

    const pending = [];
    const seen = new Set(); // listingId to avoid duplicates

    // Primary: Use transactions (covers auction + best-offer)
    const txList = await Transaction.find({
      $or: [{ seller: user._id }, { buyer: user._id }],
      transactionStatus: { $in: REVIEWABLE_STATUSES }
    })
      .populate('listing', 'title slug')
      .populate('seller', 'firstName lastName')
      .populate('buyer', 'firstName lastName')
      .lean();

    for (const t of txList) {
      const lid = (t.listing && t.listing._id ? t.listing._id : t.listing)?.toString();
      if (!lid) continue;

      const amSeller = t.seller?._id?.toString() === user._id.toString();
      const otherParty = amSeller ? t.buyer : t.seller;
      if (!otherParty) continue;

      const otherId = otherParty._id?.toString() || otherParty.toString();
      const roleForReview = amSeller ? 'as_buyer' : 'as_seller'; // I review them as buyer/seller
      const completedAt = t.completedAt ? new Date(t.completedAt) : (t.updatedAt ? new Date(t.updatedAt) : null);
      if (!completedAt) continue;
      const reviewDeadline = new Date(completedAt.getTime() + REVIEW_WINDOW_MS);
      if (reviewDeadline < new Date()) continue;

      const existing = await Review.findOne({
        listing: t.listing._id,
        reviewer: user._id,
        reviewee: otherId
      });
      if (!existing) {
        const key = `${lid}-${otherId}`;
        if (!seen.has(key)) {
          seen.add(key);
          pending.push({
            listingId: t.listing._id,
            listingTitle: t.listing?.title || 'Item',
            listingSlug: t.listing?.slug || '',
            transactionId: t._id,
            otherPartyId: otherId,
            otherPartyName: `${otherParty.firstName || ''} ${otherParty.lastName || ''}`.trim() || (amSeller ? 'Buyer' : 'Seller'),
            myRole: amSeller ? 'seller' : 'buyer',
            theirRole: amSeller ? 'buyer' : 'seller',
            roleForReview,
            completedAt,
            reviewDeadline
          });
        }
      }
    }

    // No listing-only fallback: reviews are strictly transaction-based and completion-gated.

    res.json({ pending });
  } catch (error) {
    console.error('Error fetching pending reviews:', error);
    res.status(500).json({
      error: 'Failed to fetch pending reviews',
      message: error.message
    });
  }
});

/**
 * POST /api/reviews
 * Create a review (after a completed transaction).
 * Body: { listingId, toUserId, role: 'as_buyer' | 'as_seller', score: 1-5, description? }
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { listingId, toUserId, role, score, rating, description } = req.body;
    const scoreVal = score != null ? score : rating; // support legacy 'rating' param

    if (!listingId || !toUserId || !role || scoreVal == null) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'listingId, toUserId, role and score are required'
      });
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

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(403).json({
        error: 'User not found',
        message: 'Please complete your profile first'
      });
    }

    const toId = toUserId.toString();

    // Prefer Transaction for validation (covers auction + best-offer)
    const transaction = await Transaction.findOne({ listing: listingId }).lean();
    let sellerId, buyerId;
    if (transaction) {
      sellerId = (transaction.seller && transaction.seller._id ? transaction.seller._id : transaction.seller)?.toString();
      buyerId = (transaction.buyer && transaction.buyer._id ? transaction.buyer._id : transaction.buyer)?.toString();
      const okStatuses = ['completed'];
      const ts = transaction.transactionStatus || transaction.status;
      if (ts === 'cancelled') {
        return res.status(400).json({
          error: 'Cancelled transaction',
          message: 'Reviews are not allowed for cancelled transactions'
        });
      }
      if (!okStatuses.includes(ts)) {
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
    } else {
      const listing = await Listing.findById(listingId).select('seller winner').lean();
      if (!listing) {
        return res.status(404).json({ error: 'Listing not found' });
      }
      sellerId = listing.seller?.toString();
      buyerId = listing.winner?.toString();
      if (!sellerId || !buyerId) {
        return res.status(400).json({
          error: 'Not a completed transaction',
          message: 'This listing does not have a selected winner yet'
        });
      }
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
    });
    if (existing) {
      return res.status(409).json({
        error: 'Already reviewed',
        message: 'You have already left a review for this user for this listing'
      });
    }

    const review = new Review({
      listing: listingId,
      reviewer: user._id,
      reviewee: toUserId,
      role,
      score: scoreNum,
      description: description && String(description).trim().slice(0, 2000) || null,
      transactionCompletedAt: transaction?.completedAt || null,
      reviewerIp: req.ip || req.headers['x-forwarded-for']?.toString()?.split(',')?.[0]?.trim() || null,
      reviewerUserAgent: req.get('user-agent') || null
    });
    await review.save();

    // Automated moderation: profanity/hate speech detection
    const abuse = scanForAbusiveContent(review.description || '');
    if (abuse.found) {
      await ReviewFlag.create({
        review: review._id,
        reason: 'profanity_hate_speech',
        metadata: { categories: abuse.categories, matches: abuse.matches },
        status: 'pending'
      });
    }

    // Fraud detection: flag suspicious reviews for admin review
    checkReviewFraud(review).catch(err => console.error('Review fraud check:', err.message));

    // Recalculate reputation for reviewee
    recalculateReputation(toUserId).catch(err => console.error('Reputation recalc:', err.message));

    // Automatic threshold protection: suspend low-rated sellers (<3.0 after 20 seller reviews)
    if (role === 'as_seller') {
      const sellerStats = await Review.aggregate([
        { $match: { reviewee: toUserId, role: 'as_seller' } },
        { $group: { _id: '$reviewee', avg: { $avg: '$score' }, count: { $sum: 1 } } }
      ]);
      if (sellerStats[0] && sellerStats[0].count >= 20 && sellerStats[0].avg < 3) {
        await User.findByIdAndUpdate(toUserId, {
          $set: {
            accountStatus: 'suspended',
            isActive: false
          }
        });
      }
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
    console.error('Error creating review:', error);
    res.status(500).json({
      error: 'Failed to create review',
      message: error.message
    });
  }
});

/**
 * POST /api/reviews/:id/flag
 * User flagging mechanism for abusive/untrustworthy reviews.
 * Body: { reason, details? }
 */
router.post('/:id/flag', authenticateToken, async (req, res) => {
  try {
    const { reason, details } = req.body;
    const review = await Review.findById(req.params.id).lean();
    if (!review) return res.status(404).json({ error: 'Review not found' });
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const normalized = String(reason || '').trim().toLowerCase();
    const allowed = new Set(['abusive', 'spam', 'fake', 'retaliation', 'other']);
    const label = allowed.has(normalized) ? normalized : 'other';

    const existing = await ReviewFlag.findOne({
      review: review._id,
      reason: 'user_report',
      'metadata.reportedBy': user._id.toString(),
      status: 'pending'
    }).lean();
    if (existing) {
      return res.status(409).json({ error: 'Already flagged', message: 'You already flagged this review.' });
    }

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
    res.status(201).json({ success: true, flagId: flag._id });
  } catch (error) {
    console.error('Error flagging review:', error);
    res.status(500).json({ error: 'Failed to flag review', message: error.message });
  }
});

/**
 * POST /api/reviews/:id/appeals
 * Appeal process for sellers/buyers disputing a review.
 * Body: { reason, details? }
 */
router.post('/:id/appeals', authenticateToken, async (req, res) => {
  try {
    const { reason, details } = req.body;
    if (!reason || String(reason).trim().length < 5) {
      return res.status(400).json({ error: 'Invalid reason', message: 'Appeal reason must be at least 5 characters.' });
    }
    const review = await Review.findById(req.params.id).lean();
    if (!review) return res.status(404).json({ error: 'Review not found' });
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isParty =
      review.reviewer?.toString?.() === user._id.toString() ||
      review.reviewee?.toString?.() === user._id.toString();
    if (!isParty) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only transaction parties can appeal this review.' });
    }

    const existing = await ReviewAppeal.findOne({
      review: review._id,
      appellant: user._id,
      status: 'pending'
    }).lean();
    if (existing) {
      return res.status(409).json({ error: 'Appeal already open', message: 'You already have a pending appeal for this review.' });
    }

    const appeal = await ReviewAppeal.create({
      review: review._id,
      appellant: user._id,
      reason: String(reason).trim().slice(0, 500),
      details: details ? String(details).trim().slice(0, 3000) : null
    });

    res.status(201).json({ success: true, appealId: appeal._id });
  } catch (error) {
    console.error('Error creating review appeal:', error);
    res.status(500).json({ error: 'Failed to create appeal', message: error.message });
  }
});

/**
 * GET /api/reviews/appeals/mine
 * List appeals created by the authenticated user.
 */
router.get('/appeals/mine', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    const appeals = await ReviewAppeal.find({ appellant: user._id })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ appeals });
  } catch (error) {
    console.error('Error fetching my appeals:', error);
    res.status(500).json({ error: 'Failed to fetch appeals', message: error.message });
  }
});

module.exports = router;
