const express = require('express');
const Review = require('../models/Review');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { getReviewScoresForUser, getReviewScoresForUsers } = require('../services/reviewService');

const router = express.Router();

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

/**
 * GET /api/reviews/pending
 * Returns listings where the current user can leave a review (they were buyer or seller and haven't reviewed the other party yet).
 */
router.get('/pending', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.json({ pending: [] });
    }

    // Listings where I am seller and there is a winner (I can review the buyer)
    const asSeller = await Listing.find({
      seller: user._id,
      winner: { $exists: true, $ne: null }
    })
      .select('_id title slug winner winnerSelectedAt')
      .populate('winner', 'firstName lastName')
      .lean();

    // Listings where I am winner (I can review the seller)
    const asBuyer = await Listing.find({
      winner: user._id
    })
      .select('_id title slug seller winnerSelectedAt')
      .populate('seller', 'firstName lastName')
      .lean();

    const pending = [];

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
          roleForReview: 'as_buyer' // I review them as buyer
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
          roleForReview: 'as_seller' // I review them as seller
        });
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
 * Body: { listingId, toUserId, role: 'as_buyer' | 'as_seller', rating, comment? }
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { listingId, toUserId, role, rating, comment } = req.body;

    if (!listingId || !toUserId || !role || rating == null) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'listingId, toUserId, role and rating are required'
      });
    }
    if (!['as_buyer', 'as_seller'].includes(role)) {
      return res.status(400).json({
        error: 'Invalid role',
        message: 'role must be as_buyer or as_seller'
      });
    }
    const ratingNum = parseInt(rating, 10);
    if (ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({
        error: 'Invalid rating',
        message: 'rating must be between 1 and 5'
      });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(403).json({
        error: 'User not found',
        message: 'Please complete your profile first'
      });
    }

    const listing = await Listing.findById(listingId)
      .select('seller winner')
      .lean();
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    const sellerId = listing.seller && listing.seller.toString();
    const winnerId = listing.winner && listing.winner.toString();
    if (!sellerId || !winnerId) {
      return res.status(400).json({
        error: 'Not a completed transaction',
        message: 'This listing does not have a selected winner yet'
      });
    }

    const toId = toUserId.toString();
    // Current user must be either seller or winner, and toUserId must be the other party
    const isSeller = sellerId === user._id.toString();
    const isBuyer = winnerId === user._id.toString();
    if (!isSeller && !isBuyer) {
      return res.status(403).json({
        error: 'Not a party to this transaction',
        message: 'Only the buyer or seller can leave a review for this listing'
      });
    }
    if (isSeller && toId !== winnerId) {
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
      rating: ratingNum,
      comment: comment && String(comment).trim().slice(0, 1000) || null
    });
    await review.save();

    res.status(201).json({
      _id: review._id,
      listing: review.listing,
      reviewee: review.reviewee,
      role: review.role,
      rating: review.rating,
      comment: review.comment,
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
