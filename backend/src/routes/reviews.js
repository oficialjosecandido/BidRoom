const express = require('express');
const Review = require('../models/Review');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { getReviewScoresForUser, getReviewScoresForUsers } = require('../services/reviewService');
const { checkReviewFraud, recordSuccessfulTransaction, recalculateReputation, getTrustBadges, isPrivateRoomEligible } = require('../services/reputationService');

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

/** Transaction statuses where reviews are allowed */
const REVIEWABLE_STATUSES = ['delivered', 'completed'];

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
            roleForReview
          });
        }
      }
    }

    // Fallback: listings with winner (no transaction yet, e.g. legacy)
    if (pending.length === 0) {
      const asSeller = await Listing.find({
        seller: user._id,
        winner: { $exists: true, $ne: null }
      })
        .select('_id title slug winner')
        .populate('winner', 'firstName lastName')
        .lean();
      const asBuyer = await Listing.find({ winner: user._id })
        .select('_id title slug seller')
        .populate('seller', 'firstName lastName')
        .lean();

      for (const listing of asSeller) {
        if (!listing.winner || listing.winner._id.toString() === user._id.toString()) continue;
        const existing = await Review.findOne({
          listing: listing._id,
          reviewer: user._id,
          reviewee: listing.winner._id
        });
        if (!existing) {
          pending.push({
            listingId: listing._id,
            listingTitle: listing.title,
            listingSlug: listing.slug,
            otherPartyId: listing.winner._id,
            otherPartyName: `${listing.winner.firstName || ''} ${listing.winner.lastName || ''}`.trim() || 'Buyer',
            myRole: 'seller',
            theirRole: 'buyer',
            roleForReview: 'as_buyer'
          });
        }
      }
      for (const listing of asBuyer) {
        if (!listing.seller) continue;
        const existing = await Review.findOne({
          listing: listing._id,
          reviewer: user._id,
          reviewee: listing.seller._id
        });
        if (!existing) {
          pending.push({
            listingId: listing._id,
            listingTitle: listing.title,
            listingSlug: listing.slug,
            otherPartyId: listing.seller._id,
            otherPartyName: `${listing.seller.firstName || ''} ${listing.seller.lastName || ''}`.trim() || 'Seller',
            myRole: 'buyer',
            theirRole: 'seller',
            roleForReview: 'as_seller'
          });
        }
      }
    }

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
 * Body: { listingId, toUserId, role: 'as_buyer' | 'as_seller', score: 1-10, description? }
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
    if (Number.isNaN(scoreNum) || scoreNum < 1 || scoreNum > 10) {
      return res.status(400).json({
        error: 'Invalid score',
        message: 'score must be between 1 and 10'
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
      const okStatuses = ['delivered', 'completed'];
      const ts = transaction.transactionStatus || transaction.status;
      if (!okStatuses.includes(ts)) {
        return res.status(400).json({
          error: 'Transaction not reviewable',
          message: 'The transaction must be delivered or completed before leaving a review'
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
      description: description && String(description).trim().slice(0, 2000) || null
    });
    await review.save();

    // Fraud detection: flag suspicious reviews for admin review
    checkReviewFraud(review).catch(err => console.error('Review fraud check:', err.message));

    // Recalculate reputation for reviewee
    recalculateReputation(toUserId).catch(err => console.error('Reputation recalc:', err.message));

    // Auto-complete transaction when both buyer and seller have reviewed
    const [buyerReviewed, sellerReviewed] = await Promise.all([
      Review.exists({ listing: listingId, role: 'as_seller' }),
      Review.exists({ listing: listingId, role: 'as_buyer' })
    ]);
    if (buyerReviewed && sellerReviewed) {
      const tx = await Transaction.findOne({ listing: listingId })
        .populate('seller', '_id')
        .populate('buyer', '_id');
      if (tx && ['paid', 'shipped', 'delivered'].includes(tx.transactionStatus || tx.status || '')) {
        tx.transactionStatus = 'completed';
        await tx.save();
        const buyerId = tx.buyer?._id?.toString?.() || tx.buyer?.toString?.();
        const sellerId = tx.seller?._id?.toString?.() || tx.seller?.toString?.();
        if (buyerId && sellerId) {
          recordSuccessfulTransaction(buyerId, sellerId).catch(err => console.error('Record successful tx:', err.message));
        }
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

module.exports = router;
