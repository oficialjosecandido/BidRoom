const express = require('express');
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const Review = require('../models/Review');
const Transaction = require('../models/Transaction');
const Follow = require('../models/Follow');
const { authenticateToken } = require('../middleware/auth');
const { isAdminEmail } = require('../utils/roles');
const { validate, z } = require('../middleware/validate');
const { objectIdOrSlug } = require('../validators/common');
const logger = require('../utils/logger');

const router = express.Router();

const profileParamsSchema = z.object({
  params: z.object({ id: objectIdOrSlug }),
});

const reviewsSchema = z.object({
  params: z.object({ id: objectIdOrSlug }),
  query: z
    .object({
      role: z.enum(['as_seller', 'as_buyer']).optional(),
      sort: z.enum(['recent', 'highest', 'lowest']).optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1),
    })
    .partial({ role: true, sort: true, page: true }),
});

/**
 * GET /api/users/me/waiver-status
 * Authenticated — returns the seller's founding-seller waiver state for UI display.
 */
router.get('/me/waiver-status', authenticateToken, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid })
      .select('completedSalesCount foundingSellerWaiver')
      .lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const cap    = user.foundingSellerWaiver?.freeSalesCap ?? 5;
    const used   = user.completedSalesCount ?? 0;
    const active = user.foundingSellerWaiver?.active ?? true;

    res.json({
      active,
      freeSalesCap:       cap,
      completedSales:     used,
      freeSalesRemaining: active ? Math.max(0, cap - used) : 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch waiver status' });
  }
});

/**
 * GET /api/users/me/roles
 * Authenticated — returns the current user's role flags.
 *
 * This is what the frontend uses to decide whether to show admin UI / hit
 * admin endpoints. The admin email list is never sent to the browser; we
 * simply return booleans derived from it server-side.
 */
router.get('/me/roles', authenticateToken, async (req, res) => {
  const email = req.user?.email || null;
  res.json({
    email,
    uid: req.user?.uid || null,
    isAdmin: isAdminEmail(email),
    isAuthenticated: true,
  });
});

function isValidObjectId(v) {
  return mongoose.Types.ObjectId.isValid(v) && /^[a-f\d]{24}$/i.test(v);
}

/** Resolve a route param that can be a 24-char ObjectId OR a slug. Returns the User lean doc or null. */
async function resolveUser(idOrSlug, select) {
  if (isValidObjectId(idOrSlug)) {
    return Customer.findById(idOrSlug).select(select).lean();
  }
  return Customer.findOne({ slug: idOrSlug }).select(select).lean();
}

/**
 * GET /api/users/:id/profile
 * Public — reputation, activity stats, active listings.
 */
router.get('/:id/profile', validate(profileParamsSchema), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await resolveUser(id, 'firstName lastName slug createdAt isActive lastLogin');

    if (!user || !user.isActive) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const oid = new mongoose.Types.ObjectId(user._id);

    const [sellerAgg, buyerAgg, soldCount, boughtCount, followersCount, activeListings] =
      await Promise.all([
        Review.aggregate([
          { $match: { reviewee: oid, role: 'as_seller' } },
          { $group: { _id: null, avg: { $avg: '$score' }, count: { $sum: 1 } } }
        ]),
        Review.aggregate([
          { $match: { reviewee: oid, role: 'as_buyer' } },
          { $group: { _id: null, avg: { $avg: '$score' }, count: { $sum: 1 } } }
        ]),
        Transaction.countDocuments({ seller: oid, status: 'completed' }),
        Transaction.countDocuments({ buyer: oid, status: 'completed' }),
        Follow.countDocuments({ following: oid }),
        Listing.find({ seller: user._id, status: 'active' })
          .select('_id slug title images currentPrice startingPrice bidCount endDate auctionFormat')
          .sort({ endDate: 1 })
          .limit(20)
          .lean()
      ]);

    const sellerScore = sellerAgg[0] ? Math.round(sellerAgg[0].avg * 10) / 10 : null;
    const sellerReviewCount = sellerAgg[0]?.count ?? 0;
    const buyerScore = buyerAgg[0] ? Math.round(buyerAgg[0].avg * 10) / 10 : null;
    const buyerReviewCount = buyerAgg[0]?.count ?? 0;

    return res.json({
      _id: user._id,
      slug: user.slug || null,
      firstName: user.firstName,
      lastName: user.lastName,
      memberSince: user.createdAt,
      lastActive: user.lastLogin,
      sellerScore,
      sellerReviewCount,
      buyerScore,
      buyerReviewCount,
      soldCount,
      boughtCount,
      followersCount,
      activeListings
    });
  } catch (err) {
    logger.error('GET /api/users/:id/profile error:', err);
    return res.status(500).json({ error: 'Failed to load profile.' });
  }
});

/**
 * GET /api/users/:id/reviews
 * Public — paginated reviews received by a user.
 * Query params:
 *   role:  'as_seller' | 'as_buyer' | (omit = all)
 *   sort:  'recent' (default) | 'highest' | 'lowest'
 *   page:  number (default 1)
 * Returns: score, tags, role, isAutoGenerated, createdAt, reviewer (first name + last initial)
 * NOTE: description is always omitted — it is private by design.
 */
router.get('/:id/reviews', validate(reviewsSchema), async (req, res) => {
  try {
    const { id } = req.params;

    const user = await resolveUser(id, '_id');
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const PAGE_SIZE = 10;
    const page = Math.max(1, req.query.page || 1);
    const skip = (page - 1) * PAGE_SIZE;

    const match = { reviewee: new mongoose.Types.ObjectId(user._id) };
    if (req.query.role) {
      match.role = req.query.role;
    }

    const sortMap = { highest: { score: -1 }, lowest: { score: 1 } };
    const sort = sortMap[req.query.sort] ?? { createdAt: -1 };

    const [reviews, total] = await Promise.all([
      Review.find(match)
        .select('score tags role isAutoGenerated createdAt reviewer')
        .sort(sort)
        .skip(skip)
        .limit(PAGE_SIZE)
        .populate('reviewer', 'firstName lastName')
        .lean(),
      Review.countDocuments(match)
    ]);

    const sanitized = reviews.map((r) => ({
      _id: r._id,
      score: r.score,
      tags: r.tags ?? [],
      role: r.role,
      isAutoGenerated: r.isAutoGenerated,
      createdAt: r.createdAt,
      reviewer: r.reviewer
        ? {
            firstName: r.reviewer.firstName,
            lastInitial: r.reviewer.lastName ? r.reviewer.lastName.charAt(0) : ''
          }
        : null
    }));

    return res.json({
      reviews: sanitized,
      total,
      page,
      pages: Math.ceil(total / PAGE_SIZE)
    });
  } catch (err) {
    logger.error('GET /api/users/:id/reviews error:', err);
    return res.status(500).json({ error: 'Failed to load reviews.' });
  }
});

module.exports = router;
