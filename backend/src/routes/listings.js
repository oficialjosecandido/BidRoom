const express = require('express');
const mongoose = require('mongoose');
const Listing = require('../models/Listing');
const ListingDraft = require('../models/ListingDraft');
const ListingPageView = require('../models/ListingPageView');
const User = require('../models/User');
const Bid = require('../models/Bid');
const Offer = require('../models/Offer');
const Transaction = require('../models/Transaction');
const Follow = require('../models/Follow');
const Watchlist = require('../models/Watchlist');
const { authenticateToken, optionalAuth, requireActiveAccount, requireNoDisputeRestriction } = require('../middleware/auth');
const { handleWinnerSelection, handleAuctionEnd } = require('../services/auctionNotificationService');
const { notifyFollowersNewListing, notifyCategoryFollowersNewListing, notifySimilarItemWatchers } = require('../services/notificationService');
const { getReviewScoresForUser } = require('../services/reviewService');
const { logAuctionCreated } = require('../services/bestOfferLogger');
const { scanTexts, scanTextsForProhibitedContent, scanForAbusiveContent } = require('../utils/contentFilter');
const { appendModerationAudit } = require('../services/moderationAuditService');
const { scanListingText } = require('../services/contentSafetyService');
const { recordViolation } = require('../services/contentViolationService');
const { createTransactionForBuyNow } = require('../services/transactionService');

const router = express.Router();

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Populated seller fields for public listing APIs (DSA trader transparency). */
const SELLER_DSA_PUBLIC_SELECT =
  'firstName lastName slug email uid sellerClassification professionalVerificationStatus ' +
  'professionalLegalName professionalTradeName professionalAddressLine1 professionalAddressLine2 ' +
  'professionalCity professionalRegion professionalPostalCode professionalCountry professionalContactPhone ' +
  'professionalContactEmail professionalVatId';

/** Strip professional PII until admin verification (buyers still see classification + status). */
function sanitizeSellerForPublic(seller) {
  if (!seller || typeof seller !== 'object') return seller;
  const out = { ...seller };
  const cls = out.sellerClassification || 'private';
  const st = out.professionalVerificationStatus || 'none';
  if (cls !== 'professional' || st !== 'verified') {
    delete out.professionalLegalName;
    delete out.professionalTradeName;
    delete out.professionalAddressLine1;
    delete out.professionalAddressLine2;
    delete out.professionalCity;
    delete out.professionalRegion;
    delete out.professionalPostalCode;
    delete out.professionalCountry;
    delete out.professionalContactPhone;
    delete out.professionalContactEmail;
    delete out.professionalVatId;
  }
  return out;
}

function queueListingDetailView(req, listingLean) {
  setImmediate(async () => {
    try {
      if (!listingLean || listingLean.status === 'draft') return;
      const sellerId = listingLean.seller && (listingLean.seller._id || listingLean.seller);
      if (!sellerId) return;
      if (req.user?.uid) {
        let viewer = await User.findOne({ uid: req.user.uid }).select('_id').lean();
        if (!viewer && req.user.email) {
          viewer = await User.findOne({ email: String(req.user.email).toLowerCase().trim() })
            .select('_id')
            .lean();
        }
        if (viewer && String(viewer._id) === String(sellerId)) return;
      }
      await ListingPageView.create({ listing: listingLean._id, seller: sellerId });
    } catch (_) {
      // Listing views are non-critical
    }
  });
}

// GET /api/listings - Get all active listings with filtering and sorting
router.get('/', async (req, res) => {
  try {
    const {
      category,
      subCategory,
      sort = 'deadline', // deadline, newest, highest, lowest, bids
      minPrice,
      maxPrice,
      minBids,
      listingType,
      isFeatured,
      status = 'active',
      search,
      condition,
      shipping,
      locationCity,
      locationCountry,
      limit = 20,
      skip,
      page
    } = req.query;

    const pageSize = Math.min(parseInt(limit) || 20, 100);
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const skipNum = skip !== undefined ? parseInt(skip) : (pageNum - 1) * pageSize;

    // Build query
    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (category) {
      query.category = category;
    }

    if (subCategory) {
      query.subCategory = subCategory;
    }
    
    if (listingType) {
      query.listingType = listingType;
    }

    if (isFeatured === 'true') {
      query.isFeatured = true;
    }

    if (minPrice || maxPrice) {
      query.currentPrice = {};
      if (minPrice) query.currentPrice.$gte = parseFloat(minPrice);
      if (maxPrice) query.currentPrice.$lte = parseFloat(maxPrice);
    }
    
    if (minBids) {
      query.bidCount = { $gte: parseInt(minBids) };
    }
    
    if (search) {
      const escapedSearch = escapeRegex(String(search).trim().slice(0, 200));
      query.$or = [
        { title: { $regex: escapedSearch, $options: 'i' } },
        { description: { $regex: escapedSearch, $options: 'i' } }
      ];
    }

    if (condition) {
      const conditionMap = {
        'new': 'New',
        'like-new': 'Used - Excellent',
        'very-good': 'Used - Very Good',
        'good': 'Used - Good',
        'fair': 'Used - Fair',
        'for-parts': 'For Parts or Not Working'
      };
      const selectedConditions = condition.split(',').map(c => conditionMap[c.trim()]).filter(Boolean);
      if (selectedConditions.length > 0) {
        query.condition = { $in: selectedConditions };
      }
    }

    if (shipping) {
      const directOptions = new Set(['flat-rate', 'calculated', 'local-pickup', 'free']);
      const legacyShippingMap = {
        worldwide: ['flat-rate', 'calculated', 'free'],
        regional: ['calculated'],
        'local-pickup': ['local-pickup']
      };
      const selectedShipping = shipping.split(',').map(s => s.trim()).filter(Boolean);
      const shippingOptions = [...new Set(selectedShipping.flatMap(s =>
        (directOptions.has(s) ? [s] : legacyShippingMap[s]) || []
      ))];
      if (shippingOptions.length > 0) {
        query.shippingOption = { $in: shippingOptions };
      }
    }

    const locationClauses = [];
    if (locationCity && String(locationCity).trim()) {
      const esc = escapeRegex(String(locationCity).trim());
      locationClauses.push({
        $or: [
          { locationCity: { $regex: esc, $options: 'i' } },
          { location: { $regex: esc, $options: 'i' } }
        ]
      });
    }
    if (locationCountry && String(locationCountry).trim()) {
      const code = String(locationCountry).trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) {
        locationClauses.push({ locationCountry: code });
      }
    }
    if (locationClauses.length) {
      query.$and = [...(query.$and || []), ...locationClauses];
    }

    // Build sort object
    let sortObj = {};
    switch (sort) {
      case 'deadline':
        sortObj = { endDate: 1 }; // Ending soonest first
        break;
      case 'newest':
        sortObj = { createdAt: -1 };
        break;
      case 'highest':
        sortObj = { currentPrice: -1 };
        break;
      case 'lowest':
        sortObj = { currentPrice: 1 };
        break;
      case 'bids':
        sortObj = { bidCount: -1 };
        break;
      case 'recent-end':
        sortObj = { endDate: -1 }; // Most recently ended first (closed auctions)
        break;
      default:
        sortObj = { endDate: 1 };
    }

    // For featured listings, prioritize them (live listings only)
    if (sort === 'deadline') {
      sortObj = { isFeatured: -1, endDate: 1 };
    }

    const listings = await Listing.find(query)
      .populate('seller', SELLER_DSA_PUBLIC_SELECT)
      .sort(sortObj)
      .limit(pageSize)
      .skip(skipNum)
      .lean();

    // Helper function to generate slug from title
    function generateSlug(title) {
      return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
    }

    // Calculate time remaining for each listing and ensure slug exists
    const listingsWithTimeRemaining = listings.map(listing => {
      // Generate slug if it doesn't exist (for backward compatibility)
      if (!listing.slug && listing.title) {
        let baseSlug = generateSlug(listing.title);
        let slug = baseSlug;
        let counter = 1;
        // Check for uniqueness (basic check, not perfect but better than nothing)
        const similarSlugs = listings.filter(l => l.slug && l.slug.startsWith(baseSlug));
        if (similarSlugs.length > 0) {
          slug = `${baseSlug}-${similarSlugs.length + counter}`;
        }
        listing.slug = slug;
      }
      
      const timeRemaining = new Listing(listing).getTimeRemaining();
      return {
        ...listing,
        seller: sanitizeSellerForPublic(listing.seller),
        timeRemaining,
        endingSoon: timeRemaining.ended ? false : (timeRemaining.days === 0 && timeRemaining.hours <= 24)
      };
    });

    const total = await Listing.countDocuments(query);

    const totalPages = Math.ceil(total / pageSize);
    res.json({
      listings: listingsWithTimeRemaining,
      total,
      limit: pageSize,
      skip: skipNum,
      page: pageNum,
      totalPages
    });
  } catch (error) {
    console.error('Error fetching listings:', error);
    res.status(500).json({
      error: 'Failed to fetch listings',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Helper function to generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// GET /api/listings/slug/:slug - Get a single listing by slug (optionalAuth for inWatchlist)
router.get('/slug/:slug', optionalAuth, async (req, res) => {
  try {
    let listing = await Listing.findOne({ slug: req.params.slug })
      .populate('seller', SELLER_DSA_PUBLIC_SELECT)
      .lean();

    // If not found by slug, try to find listings without slugs and generate them
    // This handles cases where listings were created before slug was added
    if (!listing) {
      // Try to find all listings without slugs
      const listingsWithoutSlugs = await Listing.find({ 
        slug: { $exists: false } 
      }).populate('seller', SELLER_DSA_PUBLIC_SELECT).lean();

      // Generate slugs for listings that don't have them
      for (const listItem of listingsWithoutSlugs) {
        if (listItem.title) {
          let baseSlug = generateSlug(listItem.title);
          let slug = baseSlug;
          let counter = 1;
          
          // Ensure uniqueness
          while (await Listing.findOne({ slug, _id: { $ne: listItem._id } })) {
            slug = `${baseSlug}-${counter}`;
            counter++;
          }
          
          // Update the listing with the slug
          await Listing.findByIdAndUpdate(listItem._id, { slug });
          
          // Check if this is the one we're looking for
          if (slug === req.params.slug) {
            listItem.slug = slug;
            listing = listItem;
            break;
          }
        }
      }
    }

    // If still not found, try searching by title pattern (for backward compatibility)
    // This helps when someone accesses a listing using the expected slug format
    if (!listing) {
      // Convert slug back to potential title patterns
      const slugWords = req.params.slug.split('-');
      const possibleTitles = [
        slugWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        slugWords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-'),
        slugWords.join(' '),
        slugWords.map(w => w.toUpperCase()).join(' ')
      ];

      // Try to find listing by matching title patterns
      for (const possibleTitle of possibleTitles) {
        const potentialListing = await Listing.findOne({
          title: { $regex: possibleTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
          $or: [
            { slug: { $exists: false } },
            { slug: null },
            { slug: '' }
          ]
        })
          .populate('seller', SELLER_DSA_PUBLIC_SELECT)
          .lean();

        if (potentialListing) {
          // Generate slug and save it
          let baseSlug = generateSlug(potentialListing.title);
          let slug = baseSlug;
          let counter = 1;
          
          while (await Listing.findOne({ slug, _id: { $ne: potentialListing._id } })) {
            slug = `${baseSlug}-${counter}`;
            counter++;
          }
          
          await Listing.findByIdAndUpdate(potentialListing._id, { slug });
          potentialListing.slug = slug;
          listing = potentialListing;
          break;
        }
      }
    }

    // If still not found, try by ID (for backward compatibility)
    if (!listing) {
      const isObjectId = /^[0-9a-fA-F]{24}$/.test(req.params.slug);
      if (isObjectId) {
        listing = await Listing.findById(req.params.slug)
          .populate('seller', SELLER_DSA_PUBLIC_SELECT)
          .lean();
      }
    }

    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found',
        slug: req.params.slug
      });
    }

    // Lazy finalize: if auction has ended by time but scheduler hasn't run yet, process it now
    // (ensures normal auctions auto-select highest bidder so seller never sees "Select winner")
    const now = new Date();
    if (
      listing.status === 'active' &&
      listing.auctionFormat === 'highest-bid' &&
      listing.endDate && new Date(listing.endDate) <= now &&
      !['active', 'invited'].includes(listing.privateRoomStatus || '')
    ) {
      try {
        await handleAuctionEnd(listing._id, null);
        listing = await Listing.findOne({ _id: listing._id })
          .populate('seller', SELLER_DSA_PUBLIC_SELECT)
          .lean();
      } catch (err) {
        console.error('Lazy finalize auction on fetch:', err.message);
      }
    }

    // Ensure slug exists (generate if missing)
    if (!listing.slug && listing.title) {
      let baseSlug = generateSlug(listing.title);
      let slug = baseSlug;
      let counter = 1;
      
      // Ensure uniqueness
      while (await Listing.findOne({ slug, _id: { $ne: listing._id } })) {
        slug = `${baseSlug}-${counter}`;
        counter++;
      }
      
      // Update the listing with the slug
      await Listing.findByIdAndUpdate(listing._id, { slug });
      listing.slug = slug;
    }

    const timeRemaining = new Listing(listing).getTimeRemaining();

    // Watchlist count (for sellers) and inWatchlist (for authenticated users)
    const [watchlistCount, inWatchlist] = await Promise.all([
      Watchlist.countDocuments({ listing: listing._id }),
      req.user ? (async () => {
        const user = await User.findOne({ uid: req.user.uid });
        if (!user) return false;
        const entry = await Watchlist.findOne({ user: user._id, listing: listing._id });
        return !!entry;
      })() : Promise.resolve(false)
    ]);

    // Seller review score (as seller) for listing details
    let sellerScore = null;
    let sellerReviewCount = 0;
    const sellerId = listing.seller && (listing.seller._id || listing.seller);
    if (sellerId) {
      const scores = await getReviewScoresForUser(sellerId);
      sellerScore = scores.sellerScore;
      sellerReviewCount = scores.sellerReviewCount;
    }

    queueListingDetailView(req, listing);

    res.json({
      ...listing,
      seller: sanitizeSellerForPublic(listing.seller),
      status: listing.status,
      allowPrivateRoom: listing.allowPrivateRoom,
      privateRoomStatus: listing.privateRoomStatus,
      privateRoomEndDate: listing.privateRoomEndDate,
      timeRemaining,
      endingSoon: timeRemaining.ended ? false : (timeRemaining.days === 0 && timeRemaining.hours <= 24),
      watchlistCount,
      inWatchlist: !!inWatchlist,
      sellerScore,
      sellerReviewCount
    });
  } catch (error) {
    console.error('Error fetching listing:', error);
    res.status(500).json({
      error: 'Failed to fetch listing',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/listings/stats/overview - Get aggregated stats
// IMPORTANT: This route must come BEFORE /:id route to avoid route conflicts
router.get('/stats/overview', async (req, res) => {
  try {
    // Optimize: Use aggregate pipeline to get all stats in one query
    const statsResult = await Listing.aggregate([
      {
        $group: {
          _id: null,
          totalBidders: { $addToSet: '$seller' }, // Get unique sellers
          activeListings: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          totalValueTraded: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'active'] },
                { $ifNull: ['$currentPrice', 0] },
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          totalBidders: { $size: '$totalBidders' },
          activeListings: 1,
          totalValueTraded: 1
        }
      }
    ]);

    // If no listings exist, return zeros
    const stats = statsResult.length > 0 ? statsResult[0] : {
      totalBidders: 0,
      activeListings: 0,
      totalValueTraded: 0
    };

    res.json({
      totalBidders: stats.totalBidders || 0,
      activeListings: stats.activeListings || 0,
      totalValueTraded: Math.round(stats.totalValueTraded || 0)
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      error: 'Failed to fetch stats',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// ─── Listing drafts (in-progress add-listing), one per seller ───────────────
// Must be registered BEFORE `/:id` so paths are not captured as ids.

router.get('/drafts/current', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const doc = await ListingDraft.findOne({ seller: user._id }).lean();
    if (!doc) return res.json({ draft: null });
    return res.json({
      draft: {
        payload: doc.payload || {},
        updatedAt: doc.updatedAt
      }
    });
  } catch (error) {
    console.error('Error loading listing draft:', error);
    res.status(500).json({ error: 'Failed to load draft', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

router.put('/drafts/current', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const payload = body.payload != null ? body.payload : body;
    if (payload == null || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid payload', message: 'Expected a JSON object.' });
    }
    const doc = await ListingDraft.findOneAndUpdate(
      { seller: user._id },
      { seller: user._id, payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return res.json({ ok: true, updatedAt: doc.updatedAt });
  } catch (error) {
    console.error('Error saving listing draft:', error);
    res.status(500).json({ error: 'Failed to save draft', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

router.delete('/drafts/current', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    await ListingDraft.deleteOne({ seller: user._id });
    return res.status(204).send();
  } catch (error) {
    console.error('Error deleting listing draft:', error);
    res.status(500).json({ error: 'Failed to delete draft', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

// GET /api/listings/seller/analytics — seller performance (must be registered before `/:id`)
router.get('/seller/analytics', authenticateToken, async (req, res) => {
  try {
    let user = await User.findOne({ uid: req.user.uid });
    if (!user && req.user.email) {
      user = await User.findOne({ email: String(req.user.email).toLowerCase().trim() });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const presetRaw = String(req.query.preset || '30d').toLowerCase();
    const now = new Date();
    let fromDate;
    let toDate = new Date(now);

    if (presetRaw === '7d') {
      fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 7);
    } else if (presetRaw === '30d') {
      fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 30);
    } else if (presetRaw === 'custom') {
      const rawFrom = req.query.from ? new Date(String(req.query.from)) : null;
      const rawTo = req.query.to ? new Date(String(req.query.to)) : null;
      if (!rawFrom || Number.isNaN(rawFrom.getTime())) {
        return res.status(400).json({ error: 'Custom range requires valid `from` (ISO date).' });
      }
      fromDate = rawFrom;
      toDate =
        rawTo && !Number.isNaN(rawTo.getTime())
          ? rawTo
          : now;
    } else {
      return res.status(400).json({
        error: 'Invalid preset',
        validPresets: ['7d', '30d', 'custom']
      });
    }

    if (toDate > now) {
      toDate = now;
    }
    if (fromDate > toDate) {
      return res.status(400).json({ error: '`from` must be before `to`' });
    }

    const maxMs = 366 * 24 * 60 * 60 * 1000;
    if (toDate.getTime() - fromDate.getTime() > maxMs) {
      return res.status(400).json({ error: 'Date range cannot exceed one year.' });
    }

    const ALLOWED_CAT = ['electronics', 'home-garden', 'art', 'collectibles', 'jewelry'];
    const categoryRaw = req.query.category ? String(req.query.category).trim() : '';
    const listingIdRaw = req.query.listingId ? String(req.query.listingId).trim() : '';

    const listingMatch = {
      seller: user._id,
      status: { $ne: 'draft' }
    };
    if (categoryRaw && ALLOWED_CAT.includes(categoryRaw)) {
      listingMatch.category = categoryRaw;
    }
    if (listingIdRaw) {
      if (!mongoose.Types.ObjectId.isValid(listingIdRaw)) {
        return res.status(400).json({ error: 'Invalid listingId' });
      }
      listingMatch._id = new mongoose.Types.ObjectId(listingIdRaw);
    }

    if (listingIdRaw) {
      const ownedOne = await Listing.findOne(listingMatch).select('_id').lean();
      if (!ownedOne) {
        return res.status(404).json({ error: 'Listing not found' });
      }
    }

    const listingDocs = await Listing.find(listingMatch)
      .select('_id title slug status category auctionFormat bidCount')
      .sort({ createdAt: -1 })
      .lean();
    const listingIds = listingDocs.map((l) => l._id);

    const followersTotalPromise = Follow.countDocuments({ following: user._id });
    const followersNewPromise = Follow.countDocuments({
      following: user._id,
      createdAt: { $gte: fromDate, $lte: toDate }
    });

    if (listingIds.length === 0) {
      const [followersTotal, followersNew] = await Promise.all([followersTotalPromise, followersNewPromise]);
      return res.json({
        preset: presetRaw,
        range: { from: fromDate.toISOString(), to: toDate.toISOString() },
        filters: { category: categoryRaw || null, listingId: listingIdRaw || null },
        overview: {
          totalViews: 0,
          totalBidsAndOffers: 0,
          salesInRange: 0,
          listingsCount: 0,
          followersTotal,
          followersNewInRange: followersNew,
          conversionPercent: null
        },
        listingCounts: { active: 0, ended: 0, cancelled: 0, sold: 0, totalPublished: 0 },
        listings: []
      });
    }

    const [followersTotal, followersNew, statusBuckets, viewsAgg, bidAgg, offerAgg, soldEverIds] =
      await Promise.all([
        followersTotalPromise,
        followersNewPromise,
        Listing.aggregate([
          { $match: listingMatch },
          {
            $group: {
              _id: '$status',
              c: { $sum: 1 }
            }
          }
        ]),
        ListingPageView.aggregate([
          {
            $match: {
              seller: user._id,
              listing: { $in: listingIds },
              createdAt: { $gte: fromDate, $lte: toDate }
            }
          },
          { $group: { _id: '$listing', n: { $sum: 1 } } }
        ]),
        Bid.aggregate([
          {
            $match: {
              listing: { $in: listingIds },
              createdAt: { $gte: fromDate, $lte: toDate }
            }
          },
          { $group: { _id: '$listing', n: { $sum: 1 } } }
        ]),
        Offer.aggregate([
          {
            $match: {
              listing: { $in: listingIds },
              createdAt: { $gte: fromDate, $lte: toDate }
            }
          },
          { $group: { _id: '$listing', n: { $sum: 1 } } }
        ]),
        Transaction.distinct('listing', {
          seller: user._id,
          listing: { $in: listingIds },
          transactionStatus: { $ne: 'cancelled' }
        })
      ]);

    const viewByListing = Object.fromEntries(viewsAgg.map((row) => [row._id.toString(), row.n]));
    const bidByListing = Object.fromEntries(bidAgg.map((row) => [row._id.toString(), row.n]));
    const offerByListing = Object.fromEntries(offerAgg.map((row) => [row._id.toString(), row.n]));

    const soldSetEver = new Set(soldEverIds.map((id) => id.toString()));

    const soldPeriodIds = await Transaction.distinct('listing', {
      seller: user._id,
      listing: { $in: listingIds },
      transactionStatus: { $ne: 'cancelled' },
      $or: [
        {
          completedAt: { $gte: fromDate, $lte: toDate }
        },
        {
          paidAt: { $gte: fromDate, $lte: toDate }
        }
      ]
    });
    const salesInRangeCount = soldPeriodIds.length;

    let active = 0;
    let ended = 0;
    let cancelled = 0;
    for (const row of statusBuckets) {
      if (row._id === 'active') active = row.c;
      else if (row._id === 'ended') ended = row.c;
      else if (row._id === 'cancelled') cancelled = row.c;
    }

    const totalPublished = listingDocs.length;

    let soldListed = 0;
    let totalViews = 0;
    let totalBetting = 0;

    const soldPeriodSet = new Set(soldPeriodIds.map((id) => id.toString()));

    const rows = listingDocs.map((l) => {
      const id = l._id.toString();
      const views = viewByListing[id] ?? 0;
      const bids = bidByListing[id] ?? 0;
      const offers = offerByListing[id] ?? 0;
      const bidEvents = bids + offers;
      const isSold = soldSetEver.has(id);
      if (isSold) soldListed += 1;
      totalViews += views;
      totalBetting += bidEvents;

      return {
        listingId: id,
        title: l.title,
        slug: l.slug,
        status: l.status,
        category: l.category,
        auctionFormat: l.auctionFormat,
        cumulativeBidCount: l.bidCount ?? 0,
        viewsInRange: views,
        bidEventsInRange: bidEvents,
        soldListing: isSold,
        saleActivityInRange: soldPeriodSet.has(id)
      };
    });

    const conversionPercent =
      totalPublished > 0
        ? Math.round((salesInRangeCount / totalPublished) * 1000) / 10
        : null;

    return res.json({
      preset: presetRaw,
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      filters: { category: categoryRaw || null, listingId: listingIdRaw || null },
      overview: {
        totalViews,
        totalBidsAndOffers: totalBetting,
        salesInRange: salesInRangeCount,
        listingsCount: totalPublished,
        followersTotal,
        followersNewInRange: followersNew,
        conversionPercent
      },
      listingCounts: {
        active,
        ended,
        cancelled,
        sold: soldListed,
        totalPublished
      },
      listings: rows
    });
  } catch (error) {
    console.error('Error fetching seller analytics:', error);
    res.status(500).json({
      error: 'Failed to fetch analytics',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/listings/:id - Get a single listing by ID (for backward compatibility)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    // Check if it's a valid ObjectId, otherwise treat as slug
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(req.params.id);
    
    let listing;
    if (isObjectId) {
      listing = await Listing.findById(req.params.id)
        .populate('seller', SELLER_DSA_PUBLIC_SELECT)
        .populate('platinumBidderInvitations.bidder', '_id firstName lastName')
        .lean();
    } else {
      listing = await Listing.findOne({ slug: req.params.id })
        .populate('seller', SELLER_DSA_PUBLIC_SELECT)
        .populate('platinumBidderInvitations.bidder', '_id firstName lastName')
        .lean();
    }

    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found'
      });
    }

    // Lazy finalize: if auction has ended by time but scheduler hasn't run yet, process it now
    const now = new Date();
    if (
      listing.status === 'active' &&
      listing.auctionFormat === 'highest-bid' &&
      listing.endDate && new Date(listing.endDate) <= now &&
      !['active', 'invited'].includes(listing.privateRoomStatus || '')
    ) {
      try {
        await handleAuctionEnd(listing._id, null);
        listing = await Listing.findOne({ _id: listing._id })
          .populate('seller', SELLER_DSA_PUBLIC_SELECT)
          .populate('platinumBidderInvitations.bidder', '_id firstName lastName')
          .lean();
      } catch (err) {
        console.error('Lazy finalize auction on fetch:', err.message);
      }
    }

    const timeRemaining = new Listing(listing).getTimeRemaining();
    const response = {
      ...listing,
      timeRemaining,
      endingSoon: timeRemaining.ended ? false : (timeRemaining.days === 0 && timeRemaining.hours <= 24)
    };

    // Include platinum bidder invitation status (name + acceptance) for the poker table view
    if (listing.platinumBidderInvitations && listing.platinumBidderInvitations.length > 0) {
      response.platinumBidderStatus = listing.platinumBidderInvitations
        .filter(inv => inv.bidder)
        .map(inv => ({
          bidder: {
            _id: inv.bidder._id,
            firstName: inv.bidder.firstName || '',
            lastName: inv.bidder.lastName || ''
          },
          status: inv.status,
          invitedAt: inv.invitedAt,
          acceptedAt: inv.acceptedAt || null
        }));
    }

    // When authenticated, include platinum bidder status for current user (replaces check-platinum endpoint)
    if (req.isAuthenticated && req.user) {
      let user = await User.findOne({ uid: req.user.uid });
      if (!user && req.user.email) {
        user = await User.findOne({ email: req.user.email.toLowerCase().trim() });
      }
      if (user) {
        const isInPlatinumBidders = listing.platinumBidders && listing.platinumBidders.some(
          pbId => pbId.toString() === user._id.toString()
        );
        let isPlatinumBidder = false;
        let invitationPending = false;
        if (isInPlatinumBidders) {
          const invitations = listing.platinumBidderInvitations || [];
          const invitation = invitations.find(
            inv => inv.bidder && inv.bidder._id.toString() === user._id.toString()
          );
          if (invitation?.status === 'accepted') {
            isPlatinumBidder = true;
          } else if (!invitation || invitation.status === 'declined') {
            isPlatinumBidder = false;
          } else if (listing.platinumBidderAcceptanceDeadline && new Date() > new Date(listing.platinumBidderAcceptanceDeadline)) {
            isPlatinumBidder = false;
          } else {
            // invitation exists and is pending — show accept prompt
            invitationPending = true;
          }
        }
        response.currentUserPlatinumStatus = { isPlatinumBidder, invitationPending };
      }
    }

    response.seller = sanitizeSellerForPublic(response.seller);

    queueListingDetailView(req, listing);

    res.json(response);
  } catch (error) {
    console.error('Error fetching listing:', error);
    res.status(500).json({
      error: 'Failed to fetch listing',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/listings - Create a new listing (requires authentication)
router.post('/', authenticateToken, requireActiveAccount, requireNoDisputeRestriction, async (req, res) => {
  try {
    // Find or create user in database from Firebase UID
    let user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      // If user doesn't exist, create one
      // Parse name from Firebase user
      const nameParts = req.user.name?.split(' ') || [];
      const firstName = nameParts[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || 'User'; // Use 'User' as default if no lastName
      
      user = new User({
        uid: req.user.uid,
        email: req.user.email,
        firstName: firstName,
        lastName: lastName,
        isActive: true,
        emailVerified: req.user.emailVerified || false
      });
      await user.save();
    } else {
      // Update email verification status if changed
      if (req.user.emailVerified !== undefined && user.emailVerified !== req.user.emailVerified) {
        user.emailVerified = req.user.emailVerified;
        await user.save();
      }
    }

    // Track seller's IP and fingerprint for shill-bid detection
    const { updateUserSignals: trackSellerSignals } = require('../services/fraudDetectionService');
    const { getClientIp: getSellerIp } = require('../middleware/bidRateLimiter');
    trackSellerSignals(user._id, getSellerIp(req), req.headers['x-device-fingerprint'] || null).catch(() => {});

    if (user.dsaListingRestricted) {
      return res.status(403).json({
        error: 'Listing creation restricted',
        message: 'Your account has been restricted from creating new listings pending DSA compliance review. Please visit your dashboard to confirm your seller status.'
      });
    }

    const sellerClass = user.sellerClassification || 'private';
    if (sellerClass === 'professional') {
      const vs = user.professionalVerificationStatus || 'none';
      if (vs !== 'verified') {
        return res.status(403).json({
          error: 'Trader verification required',
          message:
            'Professional sellers must submit trader identity details and be verified by the platform before publishing listings. Complete this under Dashboard → Settings (Seller / DSA).'
        });
      }
    }

    // Extract and validate required fields
    const {
      title,
      description,
      category,
      subCategory,
      condition,
      listingFormat,
      duration,
      startingPrice,
      reservePrice,
      buyNowPrice,
      minimumOfferPrice,
      allowPrivateRoom,
      commissionRate,
      location,
      locationCity,
      locationCountry,
      shippingCost,
      shippingOption,
      packageSize,
      shippingOriginPostalCode,
      shippingOriginCity,
      shippingOriginCountry,
      returnPolicy,
      specifications,
      images = [],
      itemMode,
      quantity,
      bundleItems
    } = req.body;

    // Validate required fields
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!description || description.trim().length < 50) {
      return res.status(400).json({ error: 'Description must be at least 50 characters' });
    }
    if (!category) {
      return res.status(400).json({ error: 'Category is required' });
    }
    if (!subCategory) {
      return res.status(400).json({ error: 'Sub-category is required' });
    }
    if (!condition) {
      return res.status(400).json({ error: 'Item condition is required' });
    }
    if (duration === undefined || duration === null || duration === '') {
      return res.status(400).json({ error: 'Listing duration is required' });
    }
    // Normalize duration: frontend may send hours (number) or label (string)
    const validSlots = ['5 minutes', '1 hour', '2 hours', '7 hours', '24 hours', '3 days', '7 days'];
    let durationSlot = duration;
    if (typeof duration === 'number') {
      // Map legacy hours to slot: 5min≈0.083, 1h=1, 2h=2, 7h=7, 24h=24, 3d=72, 7d=168
      const h = duration;
      if (h <= 0.1) durationSlot = '5 minutes';
      else if (h <= 1.5) durationSlot = '1 hour';
      else if (h <= 4) durationSlot = '2 hours';
      else if (h <= 15) durationSlot = '7 hours';
      else if (h <= 48) durationSlot = '24 hours';
      else if (h <= 120) durationSlot = '3 days';
      else durationSlot = '7 days';
    }
    if (!validSlots.includes(durationSlot)) {
      return res.status(400).json({ error: 'Invalid duration. Must be one of: ' + validSlots.join(', ') });
    }
    if (!shippingOption) {
      return res.status(400).json({ error: 'Shipping option is required' });
    }
    if (!returnPolicy) {
      return res.status(400).json({ error: 'Return policy is required' });
    }
    // Note: Image upload will be handled separately. For now, allow empty images array.
    // Frontend should upload images first, then send URLs in the images array.

    // KYC check for high-value listings
    const KYC_THRESHOLD = 5000;
    const listingPrice = parseFloat(startingPrice) || 0;
    if (listingPrice >= KYC_THRESHOLD) {
      const kycStatus = user.kycStatus || 'none';
      if (kycStatus !== 'approved') {
        return res.status(403).json({
          error: 'kyc_required',
          message: 'Identity verification is required to list items valued at $5,000 or more.',
          kycStatus
        });
      }
    }

    // Validate format-specific fields
    const isAuction = listingFormat === 'highest-bid' || listingFormat === 'auction';
    if (isAuction) {
      if (!startingPrice || startingPrice <= 0) {
        return res.status(400).json({ error: 'Starting bid is required for auction format' });
      }
      if (reservePrice != null && reservePrice !== '' && parseFloat(reservePrice) > 0) {
        const startNum = parseFloat(startingPrice);
        const reserveNum = parseFloat(reservePrice);
        if (reserveNum < startNum) {
          return res.status(400).json({ error: 'Reserve price must be at least the starting bid' });
        }
      }
      if (buyNowPrice && buyNowPrice <= startingPrice) {
        return res.status(400).json({ error: 'Buy Now price must be higher than Starting Bid' });
      }
    }

    // Validate shipping cost for flat-rate
    if (shippingOption === 'flat-rate' && (!shippingCost || shippingCost < 0)) {
      return res.status(400).json({ error: 'Shipping cost is required for flat-rate shipping' });
    }
    // Validate calculated shipping fields
    if (shippingOption === 'calculated') {
      if (!packageSize || !['small', 'medium', 'large'].includes(packageSize)) {
        return res.status(400).json({ error: 'Package size is required for calculated shipping (small, medium, or large)' });
      }
      if (!shippingOriginPostalCode) {
        return res.status(400).json({ error: 'Shipping origin postal code is required for calculated shipping' });
      }
    }

    // Prohibited item check — runs before anything else
    const prohibitedCheck = scanTextsForProhibitedContent([title, description || '']);
    if (prohibitedCheck.prohibited) {
      return res.status(400).json({
        error: 'Prohibited item',
        message: `This listing contains content that is not permitted on BidRoom (${prohibitedCheck.category}). If you believe this is a mistake, please contact support.`,
        category: prohibitedCheck.category
      });
    }

    // Azure AI Content Safety text scan (blocklist + AI categories — complementary to local regex)
    try {
      const aiScan = await scanListingText(title, description || '');
      if (aiScan.blocked) {
        return res.status(400).json({
          error: 'Content policy violation',
          message: `Your listing was rejected: ${aiScan.reason}. If you believe this is a mistake, please contact support.`
        });
      }
    } catch (aiErr) {
      console.error('Azure Content Safety text scan error (non-blocking):', aiErr.message);
    }

    // Abusive language check on title + description
    const abuseCheck = scanForAbusiveContent(`${title} ${description || ''}`);
    if (abuseCheck.found) {
      if (abuseCheck.severity === 'high') {
        const fullUserForAbuse = await User.findById(user._id);
        const violation = await recordViolation(fullUserForAbuse, 'offensive_language');
        return res.status(400).json({ error: 'Content policy violation', message: violation.message, violationAction: violation.action });
      }
      if (abuseCheck.severity === 'medium') {
        return res.status(400).json({
          error: 'Content policy violation',
          message: 'Your listing contains offensive or abusive language that is not allowed on BidRoom. Please revise your content before submitting.'
        });
      }
      // low: allow through but log for admin review (fire-and-forget)
      appendModerationAudit({
        subjectUserId: user._id,
        actionType: 'abusive_content_flagged',
        metadata: { context: 'listing_create', severity: 'low', categories: abuseCheck.categories, matches: abuseCheck.matches, title }
      }).catch(() => {});
    }

    // Duplicate listing check — same seller, same title, active or draft
    const existingListing = await Listing.findOne({
      seller: user._id,
      status: { $in: ['active', 'draft'] },
      title: { $regex: new RegExp(`^${escapeRegex(title.trim())}$`, 'i') }
    }).select('_id slug').lean();
    if (existingListing) {
      return res.status(409).json({
        error: 'Duplicate listing',
        message: 'You already have an active or draft listing with this title. Please edit the existing listing or choose a different title.',
        existingListingId: existingListing._id
      });
    }

    // Scan for contact info in user-provided text fields
    const specTexts = (specifications || []).map(s => `${s.key || ''} ${s.value || ''}`);
    const contentScan = scanTexts([title, description, ...specTexts]);
    if (contentScan.found) {
      const fullUser = await User.findById(user._id);
      const violation = await recordViolation(fullUser);
      return res.status(400).json({
        error: 'Content policy violation',
        message: violation.message,
        violationAction: violation.action
      });
    }

    // Prepare listing data
    const listingData = {
      title: title.trim(),
      description: description.trim(),
      category: category.toLowerCase().replace(/\s+/g, '-'), // Normalize category
      subCategory: subCategory.trim(),
      condition,
      auctionFormat: (listingFormat === 'best-offer') ? 'best-offer' : 'highest-bid',
      durationSlot,
      startingPrice: isAuction ? parseFloat(startingPrice) : 0,
      currentPrice: isAuction ? parseFloat(startingPrice) : 0,
      reservePrice: isAuction
        ? (reservePrice && parseFloat(reservePrice) > 0 ? parseFloat(reservePrice) : undefined)
        : (reservePrice ? parseFloat(reservePrice) : undefined),
      buyNowPrice: buyNowPrice ? parseFloat(buyNowPrice) : undefined,
      minimumOfferPrice: minimumOfferPrice ? parseFloat(minimumOfferPrice) : undefined,
      allowPrivateRoom: allowPrivateRoom === true || allowPrivateRoom === 'true',
      commissionRate: commissionRate ? parseFloat(commissionRate) / 100 : undefined, // Convert percentage to decimal
      location: location || undefined,
      locationCity: locationCity && String(locationCity).trim() ? String(locationCity).trim() : undefined,
      locationCountry:
        locationCountry && /^[A-Za-z]{2}$/.test(String(locationCountry).trim())
          ? String(locationCountry).trim().toUpperCase()
          : undefined,
      shippingCost: shippingCost ? parseFloat(shippingCost) : 0,
      shippingOption,
      packageSize: shippingOption === 'calculated' ? (packageSize || null) : null,
      shippingOriginPostalCode: shippingOption === 'calculated' ? (shippingOriginPostalCode || null) : null,
      shippingOriginCity: shippingOption === 'calculated' ? (shippingOriginCity || null) : null,
      shippingOriginCountry: shippingOption === 'calculated' ? (shippingOriginCountry || 'US') : null,
      handlingTime: 5,
      returnPolicy,
      specifications: specifications || [],
      images: Array.isArray(images) && images.length > 0 ? images : ['https://via.placeholder.com/400x300?text=No+Image'],
      itemMode: ['bundle', 'multi_quantity'].includes(itemMode) ? itemMode : 'single',
      quantity: itemMode === 'multi_quantity' ? Math.max(1, Math.min(999, parseInt(quantity) || 1)) : 1,
      bundleItems: itemMode === 'bundle' && Array.isArray(bundleItems)
        ? bundleItems.slice(0, 50).map(b => ({ title: String(b.title || '').trim().slice(0, 100), description: String(b.description || '').trim().slice(0, 500) })).filter(b => b.title)
        : [],
      seller: user._id,
      status: 'active'
    };

    // Calculate end date based on duration slot
    const durations = {
      '5 minutes': 5 * 60 * 1000,
      '1 hour': 1 * 60 * 60 * 1000,
      '2 hours': 2 * 60 * 60 * 1000,
      '7 hours': 7 * 60 * 60 * 1000,
      '24 hours': 24 * 60 * 60 * 1000,
      '3 days': 3 * 24 * 60 * 60 * 1000,
      '7 days': 7 * 24 * 60 * 60 * 1000
    };
    const durationMs = durations[durationSlot] || durations['7 days'];
    listingData.startDate = new Date();
    listingData.endDate = new Date(listingData.startDate.getTime() + durationMs);

    // Generate slug from title
    function generateSlug(title) {
      return title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
        .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
    }

    let baseSlug = generateSlug(listingData.title);
    // Fallback if slug is empty (e.g., title contains only special characters)
    if (!baseSlug || baseSlug.length === 0) {
      baseSlug = 'listing-' + Date.now();
    }
    let slug = baseSlug;
    let counter = 1;

    // Ensure uniqueness by appending counter if needed
    while (await Listing.findOne({ slug })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    listingData.slug = slug;

    // Create the listing
    const listing = new Listing(listingData);
    await listing.save();

    // Notify followers / category followers / similar-item watchers (fire-and-forget)
    setImmediate(() => {
      const io = req.app.get('io');
      notifyFollowersNewListing({
        sellerId: req.user._id,
        sellerFirstName: req.user.firstName,
        listingTitle: listing.title,
        listingSlug: listingData.slug,
        io
      });
      notifyCategoryFollowersNewListing({
        category: listingData.category,
        listingTitle: listing.title,
        listingSlug: listingData.slug,
        sellerUserId: req.user._id,
        io
      });
      notifySimilarItemWatchers({
        category: listingData.category,
        startingPrice: listing.startingPrice,
        listingTitle: listing.title,
        listingSlug: listingData.slug,
        newListingId: listing._id,
        sellerUserId: req.user._id,
        io
      });
    });

    // Populate and return the listing
    const populatedListing = await Listing.findById(listing._id)
      .populate('seller', SELLER_DSA_PUBLIC_SELECT)
      .lean();

    if (populatedListing.auctionFormat === 'best-offer') {
      logAuctionCreated(populatedListing);
    }

    const timeRemaining = new Listing(populatedListing).getTimeRemaining();

    res.status(201).json({
      ...populatedListing,
      seller: sanitizeSellerForPublic(populatedListing.seller),
      timeRemaining,
      endingSoon: timeRemaining.ended ? false : (timeRemaining.days === 0 && timeRemaining.hours <= 24)
    });
  } catch (error) {
    console.error('Error creating listing:', error);
    
    // Handle Mongoose validation errors
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        error: 'Validation failed',
        message: errors.join(', ')
      });
    }

    res.status(400).json({
      error: 'Failed to create listing',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * Fields that may NEVER be changed once a listing is live (active).
 * Locked regardless of bid count to prevent price manipulation.
 */
const CRITICAL_FIELDS = new Set([
  'title', 'category', 'subCategory', 'startingPrice', 'currentPrice',
  'auctionFormat', 'durationSlot', 'endDate', 'buyNowPrice',
  'reservePrice', 'minimumOfferPrice', 'allowPrivateRoom'
]);

// PATCH /api/listings/:id - Edit a listing (state-based edit locks)
router.patch('/:id', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    if (!listing.seller.equals(user._id)) {
      return res.status(403).json({ error: 'Forbidden', message: 'You do not own this listing.' });
    }

    // Determine edit permissions based on auction state
    const isDraft  = listing.status === 'draft';
    const isLive   = listing.status === 'active';
    const hasBids  = listing.bidCount > 0;

    if (isLive && hasBids) {
      return res.status(403).json({
        error: 'Listing locked',
        message: 'This listing cannot be edited because bids have already been placed.'
      });
    }

    if (!isDraft && !isLive) {
      return res.status(400).json({ error: 'Only draft or active listings can be edited.' });
    }

    // For live listings with no bids, block changes to critical fields
    const body = req.body;
    if (isLive && !hasBids) {
      const attempted = Object.keys(body).filter(k => CRITICAL_FIELDS.has(k));
      if (attempted.length > 0) {
        return res.status(400).json({
          error: 'Field locked',
          message: `The following fields cannot be changed on a live listing: ${attempted.join(', ')}.`
        });
      }
    }

    // Allowed fields for non-draft edits (excludes all critical fields)
    const EDITABLE_FIELDS = [
      'description', 'condition', 'specifications',
      'location', 'locationCity', 'locationCountry',
      'shippingOption', 'shippingCost', 'packageSize',
      'shippingOriginPostalCode', 'shippingOriginCity', 'shippingOriginCountry',
      'returnPolicy', 'handlingTime', 'images'
    ];

    const allowedKeys = isDraft ? Object.keys(body) : EDITABLE_FIELDS;
    const updates = {};
    for (const key of allowedKeys) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update.' });
    }

    // Scan user-provided text for contact info
    const textFields = [
      updates.title || '',
      updates.description || '',
      ...((updates.specifications || []).map(s => `${s.key || ''} ${s.value || ''}`))
    ].filter(Boolean);

    if (textFields.length > 0) {
      const contentScan = scanTexts(textFields);
      if (contentScan.found) {
        const fullUser = await User.findById(user._id);
        const violation = await recordViolation(fullUser);
        return res.status(400).json({
          error: 'Content policy violation',
          message: violation.message,
          violationAction: violation.action
        });
      }

      try {
        const aiScanUpdate = await scanListingText(updates.title || '', updates.description || '');
        if (aiScanUpdate.blocked) {
          return res.status(400).json({
            error: 'Content policy violation',
            message: `Your listing was rejected: ${aiScanUpdate.reason}. If you believe this is a mistake, please contact support.`
          });
        }
      } catch (aiErr) {
        console.error('Azure Content Safety text scan error (non-blocking):', aiErr.message);
      }

      const abuseCheckUpdate = scanForAbusiveContent(textFields.join(' '));
      if (abuseCheckUpdate.found) {
        if (abuseCheckUpdate.severity === 'high') {
          const fullUser = await User.findById(user._id);
          const violation = await recordViolation(fullUser, 'offensive_language');
          return res.status(400).json({ error: 'Content policy violation', message: violation.message, violationAction: violation.action });
        }
        if (abuseCheckUpdate.severity === 'medium') {
          return res.status(400).json({
            error: 'Content policy violation',
            message: 'Your listing contains offensive or abusive language that is not allowed on BidRoom. Please revise your content before saving.'
          });
        }
        appendModerationAudit({
          subjectUserId: user._id,
          actionType: 'abusive_content_flagged',
          metadata: { context: 'listing_update', severity: 'low', categories: abuseCheckUpdate.categories, matches: abuseCheckUpdate.matches, listingId: listing._id }
        }).catch(() => {});
      }
    }

    // Apply updates
    Object.assign(listing, updates);
    await listing.save();

    const updated = await Listing.findById(listing._id)
      .populate('seller', SELLER_DSA_PUBLIC_SELECT)
      .lean();

    return res.json({ listing: updated, message: 'Listing updated successfully.' });
  } catch (error) {
    console.error('Error updating listing:', error);
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ error: 'Validation failed', message: errors.join(', ') });
    }
    res.status(500).json({ error: 'Failed to update listing', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

// POST /api/listings/:id/buy-now - Buy now (instantly closes auction and creates transaction)
router.post('/:id/buy-now', authenticateToken, requireActiveAccount, requireNoDisputeRestriction, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_DSA_PUBLIC_SELECT);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    if (!listing.buyNowPrice) {
      return res.status(400).json({
        error: 'Buy Now not available',
        message: 'This listing does not have a Buy Now price.'
      });
    }

    if (listing.status !== 'active') {
      return res.status(400).json({
        error: 'Listing not active',
        message: 'This listing is no longer available.'
      });
    }

    // Seller cannot buy their own listing
    if (listing.seller._id.toString() === user._id.toString()) {
      return res.status(400).json({
        error: 'Not allowed',
        message: 'You cannot buy your own listing.'
      });
    }

    const now = new Date();

    // Atomic close: condition { status:'active', winner: null } ensures only one
    // concurrent Buy Now (or simultaneous offer-accept) can win this write.
    const closed = await Listing.findOneAndUpdate(
      { _id: listing._id, status: 'active', winner: null },
      {
        $set: {
          status: 'ended',
          currentPrice: listing.buyNowPrice,
          endDate: now,
          winner: user._id,
          winnerSelectedAt: now,
          winnerBid: null
        }
      },
      { new: false, runValidators: false }
    );
    if (!closed) {
      return res.status(409).json({
        error: 'Already purchased',
        message: 'This item was just purchased by another buyer. Please browse other listings.'
      });
    }

    // Create the payment transaction
    const transaction = await createTransactionForBuyNow(listing._id, user._id);

    // In-app + email notifications (non-blocking)
    try {
      const { notifySellerWinnerSelected, notifyBuyerAuctionWon, emitNewNotificationToUser } = require('../services/notificationService');
      const io = req.app.get('io');
      const sellerUserId = listing.seller._id.toString();
      const buyerUserId = user._id.toString();
      const buyerName = `${user.firstName} ${user.lastName}`.trim();

      notifySellerWinnerSelected({
        listingSlug: listing.slug,
        listingTitle: listing.title,
        winnerName: buyerName,
        winningAmount: listing.buyNowPrice,
        commissionRate: listing.commissionRate ?? 0.035,
        shippingCost: listing.shippingCost ?? 0,
        shippingOption: listing.shippingOption ?? 'flat-rate',
        sellerUserId
      }).catch(err => console.error('Buy-now seller notification:', err.message));

      notifyBuyerAuctionWon({
        listingSlug: listing.slug,
        listingTitle: listing.title,
        winningAmount: listing.buyNowPrice,
        shippingCost: listing.shippingCost ?? 0,
        shippingOption: listing.shippingOption ?? 'flat-rate',
        buyerUserId
      }).catch(err => console.error('Buy-now buyer notification:', err.message));

      if (io) {
        emitNewNotificationToUser(io, sellerUserId).catch(() => {});
        emitNewNotificationToUser(io, buyerUserId).catch(() => {});
      }
    } catch (notifErr) {
      console.error('Buy-now notification error (non-fatal):', notifErr.message);
    }

    res.json({
      success: true,
      message: 'Purchase successful. Proceed to payment.',
      price: listing.buyNowPrice,
      transactionId: transaction?._id || null
    });
  } catch (error) {
    console.error('Error processing buy now:', error);
    res.status(500).json({
      error: 'Failed to process Buy Now',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/listings/:id/choose-winner - Seller chooses a winner
router.post('/:id/choose-winner', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_DSA_PUBLIC_SELECT);

    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found'
      });
    }

    // Verify user is the seller
    const user = await User.findOne({ uid: req.user.uid });
    if (!user || listing.seller._id.toString() !== user._id.toString()) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Only the seller can choose a winner'
      });
    }

    // Verify listing has ended
    if (listing.status !== 'ended') {
      return res.status(400).json({
        error: 'Listing not ended',
        message: 'The auction must be ended before choosing a winner'
      });
    }

    // Verify winner hasn't been selected yet
    if (listing.winner) {
      return res.status(400).json({
        error: 'Winner already selected',
        message: 'A winner has already been selected for this auction'
      });
    }

    // Private room listings: winner is chosen only via the private room (create room, then room runs and winner is automatic). No manual select winner.
    if (listing.allowPrivateRoom && listing.status === 'ended') {
      return res.status(400).json({
        error: 'Private room enabled',
        message: 'This listing has private room enabled. Create a private room and invite bidders instead of selecting a winner manually.'
      });
    }

    const { winnerBidId } = req.body;

    if (!winnerBidId) {
      return res.status(400).json({
        error: 'Missing winner bid ID',
        message: 'Please provide the winnerBidId'
      });
    }

    // Verify the bid exists and belongs to this listing
    let winnerBid = await Bid.findById(winnerBidId).populate('bidder', 'emailVerified');
    if (!winnerBid || winnerBid.listing.toString() !== listing._id.toString()) {
      return res.status(404).json({
        error: 'Invalid bid',
        message: 'The specified bid does not exist or does not belong to this listing'
      });
    }

    // Only registered (authenticated) bidders can be selected as winner
    if (!winnerBid.bidder) {
      return res.status(400).json({
        error: 'Guest bid cannot be selected',
        message: 'Only bids from registered accounts can be selected as the winning bid. The bidder must be logged in and have a verified account.'
      });
    }

    // Only verified accounts can be selected as winner
    if (!winnerBid.bidder.emailVerified) {
      return res.status(400).json({
        error: 'Unverified bidder',
        message: 'The selected bidder must have a verified account to be chosen as the winner.'
      });
    }

    // Handle winner selection (sends notification)
    const io = req.app.get('io');
    await handleWinnerSelection(listing._id, winnerBidId, io);

    // Reload listing to get updated data
    const updatedListing = await Listing.findById(listing._id)
      .populate('seller', SELLER_DSA_PUBLIC_SELECT)
      .populate('winner', 'firstName lastName email')
      .populate('winnerBid')
      .lean();

    res.json({
      message: 'Winner selected successfully',
      listing: updatedListing
    });
  } catch (error) {
    console.error('Error choosing winner:', error);
    res.status(400).json({
      error: 'Failed to choose winner',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/listings/:id/reopen - Seller reopens an ended auction with no bids (extends by 7 days)
router.post('/:id/reopen', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_DSA_PUBLIC_SELECT);

    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found'
      });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user || listing.seller._id.toString() !== user._id.toString()) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Only the seller can reopen this listing'
      });
    }

    if (listing.status !== 'ended') {
      return res.status(400).json({
        error: 'Listing not ended',
        message: 'Only ended auctions can be reopened'
      });
    }

    if (listing.winner) {
      return res.status(400).json({
        error: 'Winner already selected',
        message: 'Cannot reopen an auction after a winner has been selected'
      });
    }

    const bidCount = await Bid.countDocuments({ listing: listing._id });
    if (bidCount > 0) {
      return res.status(400).json({
        error: 'Auction has bids',
        message: 'Only auctions with no bids can be reopened'
      });
    }

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const newEndDate = new Date(Date.now() + sevenDaysMs);

    await Listing.findByIdAndUpdate(listing._id, {
      $set: {
        status: 'active',
        endDate: newEndDate,
        winnerSelectionDeadline: null
      }
    });

    const updatedListing = await Listing.findById(listing._id)
      .populate('seller', SELLER_DSA_PUBLIC_SELECT)
      .lean();

    res.json({
      message: 'Auction reopened for 7 days',
      listing: updatedListing
    });
  } catch (error) {
    console.error('Error reopening listing:', error);
    res.status(400).json({
      error: 'Failed to reopen auction',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/listings/:id/relist
 * One-click relist for any unsold auction (no bids, reserve not met, or non-payment).
 * Creates a NEW listing preserving title/description/images; seller can override price/duration.
 * Body (all optional): { startingPrice, reservePrice, durationSlot, autoRelist }
 */
const RELIST_DURATION_MS = {
  '5 minutes': 5 * 60 * 1000,
  '1 hour': 60 * 60 * 1000,
  '2 hours': 2 * 60 * 60 * 1000,
  '7 hours': 7 * 60 * 60 * 1000,
  '24 hours': 24 * 60 * 60 * 1000,
  '3 days': 3 * 24 * 60 * 60 * 1000,
  '7 days': 7 * 24 * 60 * 60 * 1000,
};

router.post('/:id/relist', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const user = await User.findOne({ uid: req.user.uid });
    if (!user || String(listing.seller) !== String(user._id)) {
      return res.status(403).json({ error: 'Only the seller can relist this item' });
    }

    if (listing.status !== 'ended') {
      return res.status(400).json({ error: 'Only ended listings can be relisted' });
    }

    if (listing.winner) {
      return res.status(400).json({ error: 'Cannot relist a successfully sold listing' });
    }

    if (listing.relistedAt) {
      return res.status(409).json({ error: 'This listing has already been relisted', message: 'Each ended listing can only be relisted once' });
    }

    const { startingPrice, reservePrice, durationSlot, autoRelist } = req.body;

    const newStartingPrice = startingPrice != null ? parseFloat(startingPrice) : listing.startingPrice;
    if (isNaN(newStartingPrice) || newStartingPrice < 0) {
      return res.status(400).json({ error: 'Invalid starting price' });
    }

    const newReservePrice = reservePrice != null
      ? (parseFloat(reservePrice) > 0 ? parseFloat(reservePrice) : null)
      : listing.reservePrice;

    const newDurationSlot = durationSlot || listing.durationSlot || '7 days';
    const durationMs = RELIST_DURATION_MS[newDurationSlot] || RELIST_DURATION_MS['7 days'];
    const newEndDate = new Date(Date.now() + durationMs);

    // Generate unique slug (append random suffix until unique)
    const baseSlug = generateSlug(listing.title);
    let slug = baseSlug;
    while (await Listing.exists({ slug })) {
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const newListing = new Listing({
      title: listing.title,
      description: listing.description,
      category: listing.category,
      subCategory: listing.subCategory,
      images: listing.images,
      slug,
      startingPrice: newStartingPrice,
      currentPrice: newStartingPrice,
      reservePrice: newReservePrice,
      bidIncrement: listing.bidIncrement,
      auctionFormat: listing.auctionFormat,
      durationSlot: newDurationSlot,
      condition: listing.condition,
      location: listing.location,
      locationCity: listing.locationCity,
      locationCountry: listing.locationCountry,
      shippingOption: listing.shippingOption,
      shippingCost: listing.shippingCost,
      packageSize: listing.packageSize,
      shippingOriginPostalCode: listing.shippingOriginPostalCode,
      shippingOriginCity: listing.shippingOriginCity,
      shippingOriginCountry: listing.shippingOriginCountry,
      handlingTime: listing.handlingTime,
      returnPolicy: listing.returnPolicy,
      specifications: listing.specifications,
      minimumOfferPrice: listing.minimumOfferPrice,
      itemMode: listing.itemMode || 'single',
      quantity: listing.quantity || 1,
      bundleItems: listing.bundleItems || [],
      seller: listing.seller,
      status: 'active',
      startDate: new Date(),
      endDate: newEndDate,
      autoRelist: autoRelist === true,
      relistCount: (listing.relistCount || 0) + 1,
      relistOf: listing._id,
    });

    await newListing.save();

    // Mark source as relisted so it cannot be relisted again
    await Listing.updateOne({ _id: listing._id }, { $set: { relistedAt: new Date() } });

    setImmediate(() => {
      const io = req.app.get('io');
      notifyFollowersNewListing({
        sellerId: user._id,
        sellerFirstName: user.firstName,
        listingTitle: newListing.title,
        listingSlug: slug,
        io
      }).catch(() => {});
      notifyCategoryFollowersNewListing({
        category: newListing.category,
        listingTitle: newListing.title,
        listingSlug: slug,
        sellerUserId: user._id,
        io
      });
      notifySimilarItemWatchers({
        category: newListing.category,
        startingPrice: newListing.startingPrice,
        listingTitle: newListing.title,
        listingSlug: slug,
        newListingId: newListing._id,
        sellerUserId: user._id,
        io
      });
    });

    const populated = await Listing.findById(newListing._id).populate('seller', SELLER_DSA_PUBLIC_SELECT).lean();
    return res.status(201).json({ message: 'Listing relisted successfully', listing: populated });
  } catch (err) {
    console.error('POST /listings/:id/relist error:', err);
    return res.status(500).json({ error: 'Failed to relist listing' });
  }
});

// GET /api/listings/:id/bids - Get all bids for a listing (for seller to choose winner)
router.get('/:id/bids', authenticateToken, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_DSA_PUBLIC_SELECT);

    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found'
      });
    }

    // Verify user is the seller
    const user = await User.findOne({ uid: req.user.uid });
    if (!user || listing.seller._id.toString() !== user._id.toString()) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Only the seller can view bids for winner selection'
      });
    }

    // Get all bids sorted by amount (highest first)
    const bids = await Bid.find({ listing: listing._id })
      .populate('bidder', 'firstName lastName email emailVerified hasDeposit')
      .sort({ amount: -1, createdAt: -1 })
      .lean();

    // Format bids
    const formattedBids = bids.map(bid => ({
      ...bid,
      bidderName: bid.bidder
        ? `${bid.bidder.firstName} ${bid.bidder.lastName}`
        : (bid.bidderEmail ? bid.bidderEmail.split('@')[0] : 'Anonymous'),
      bidderEmail: bid.bidderEmail || (bid.bidder ? bid.bidder.email : null),
      isAuthenticated: !!bid.bidder,
      bidderVerified: bid.bidder ? (bid.bidder.emailVerified || false) : false,
      bidderHasDeposit: bid.bidder ? (bid.bidder.hasDeposit || false) : false
    }));

    res.json({
      bids: formattedBids,
      total: formattedBids.length,
      listing: {
        _id: listing._id,
        title: listing.title,
        status: listing.status,
        currentPrice: listing.currentPrice,
        winner: listing.winner,
        winnerSelectedAt: listing.winnerSelectedAt
      }
    });
  } catch (error) {
    console.error('Error fetching bids for winner selection:', error);
    res.status(500).json({
      error: 'Failed to fetch bids',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/listings/seller/my-listings - Get all listings for the authenticated seller
router.get('/seller/my-listings', authenticateToken, async (req, res) => {
  try {
    let user = await User.findOne({ uid: req.user.uid });

    if (!user && req.user.email) {
      const email = req.user.email.toLowerCase().trim();
      user = await User.findOne({ email });
      if (user) {
        await User.updateOne(
          { _id: user._id },
          { $set: { uid: req.user.uid, emailVerified: req.user.emailVerified ?? true } }
        );
        user = await User.findById(user._id);
      }
    }

    if (!user) {
      const nameParts = (req.user.name || '').split(' ').filter(Boolean);
      const firstName = nameParts[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || 'User';
      user = new User({
        uid: req.user.uid,
        email: req.user.email || '',
        firstName,
        lastName,
        isActive: true,
        emailVerified: req.user.emailVerified ?? false
      });
      try {
        await user.save();
      } catch (err) {
        if (err.code === 11000 && req.user.email) {
          user = await User.findOne({ email: (req.user.email || '').toLowerCase().trim() });
          if (user) {
            await User.updateOne(
              { _id: user._id },
              { $set: { uid: req.user.uid, emailVerified: req.user.emailVerified ?? true } }
            );
            user = await User.findById(user._id);
          }
        } else {
          throw err;
        }
      }
    }

    const listings = await Listing.find({ seller: user._id })
      .populate('platinumBidders', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    // Watchlist counts per listing (one aggregation for all seller's listings)
    const listingIds = listings.map((l) => l._id);
    const watchlistCounts = await Watchlist.aggregate([
      { $match: { listing: { $in: listingIds } } },
      { $group: { _id: '$listing', count: { $sum: 1 } } }
    ]);
    const watchlistByListing = Object.fromEntries(
      watchlistCounts.map((row) => [row._id.toString(), row.count])
    );

    // Highest offer per best-offer listing (regardless of acceptance status)
    const offerAgg = await Offer.aggregate([
      { $match: { listing: { $in: listingIds }, status: { $in: ['pending', 'accepted'] } } },
      { $group: { _id: '$listing', highestOffer: { $max: '$amount' } } }
    ]);
    const highestOfferByListing = Object.fromEntries(
      offerAgg.map((row) => [row._id.toString(), row.highestOffer])
    );

    // Enhance listings with platinum bidder invitation status and watchlist count
    const enhancedListings = listings.map((listing) => {
      const listingObj = listing.toObject ? listing.toObject() : listing;

      // Get invitation status for each platinum bidder
      const platinumBidderStatus = [];
      if (listingObj.platinumBidderInvitations && listingObj.platinumBidderInvitations.length > 0) {
        listingObj.platinumBidderInvitations.forEach((invitation) => {
          const bidder = listingObj.platinumBidders?.find((pb) =>
            pb._id.toString() === invitation.bidder.toString()
          );

          if (bidder) {
            platinumBidderStatus.push({
              bidder: {
                _id: bidder._id,
                firstName: bidder.firstName,
                lastName: bidder.lastName,
                email: bidder.email
              },
              status: invitation.status,
              invitedAt: invitation.invitedAt,
              acceptedAt: invitation.acceptedAt
            });
          }
        });
      }

      return {
        ...listingObj,
        platinumBidderStatus,
        watchlistCount: watchlistByListing[listing._id.toString()] ?? 0,
        highestOfferAmount: highestOfferByListing[listing._id.toString()] ?? null
      };
    });

    res.json({
      listings: enhancedListings,
      total: enhancedListings.length
    });
  } catch (error) {
    console.error('Error fetching seller listings:', error);
    res.status(500).json({
      error: 'Failed to fetch listings',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/listings/bidder/my-auctions - Listings where the current user has placed at least one bid
router.get('/bidder/my-auctions', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const myBids = await Bid.find({ bidder: user._id })
      .select('listing amount createdAt notifyWhenOutbid')
      .sort({ amount: -1 })
      .lean();

    const listingIds = [...new Set(myBids.map((b) => b.listing.toString()))];
    if (listingIds.length === 0) {
      return res.json({ listings: [], total: 0 });
    }

    const listings = await Listing.find({ _id: { $in: listingIds } })
      .populate('seller', SELLER_DSA_PUBLIC_SELECT)
      .sort({ endDate: -1 })
      .lean();

    const myHighestByListing = {};
    const latestBidByListing = {}; // notifyWhenOutbid from each user's latest bid per listing (by createdAt)
    for (const b of myBids) {
      const id = b.listing.toString();
      if (myHighestByListing[id] == null || b.amount > myHighestByListing[id].amount) {
        myHighestByListing[id] = { amount: b.amount, createdAt: b.createdAt };
      }
    }
    const myBidsByCreated = await Bid.find({ bidder: user._id })
      .select('listing notifyWhenOutbid createdAt')
      .sort({ createdAt: -1 })
      .lean();
    for (const b of myBidsByCreated) {
      const id = b.listing.toString();
      if (latestBidByListing[id] == null) {
        latestBidByListing[id] = { notifyWhenOutbid: b.notifyWhenOutbid !== false };
      }
    }

    const enhanced = listings.map((listing) => {
      const id = listing._id.toString();
      const myBid = myHighestByListing[id];
      const latest = latestBidByListing[id];
      return {
        ...listing,
        seller: sanitizeSellerForPublic(listing.seller),
        myHighestBid: myBid?.amount ?? null,
        myLastBidAt: myBid?.createdAt ?? null,
        notifyWhenOutbid: latest?.notifyWhenOutbid ?? true
      };
    });

    res.json({ listings: enhanced, total: enhanced.length });
  } catch (error) {
    console.error('Error fetching bidder auctions:', error);
    res.status(500).json({
      error: 'Failed to fetch your auctions',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// GET /api/listings/bidder/my-bets - Listings with all bets (bids + offers) per listing, for My Bets tab
router.get('/bidder/my-bets', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [myBids, myOffers] = await Promise.all([
      Bid.find({ bidder: user._id }).select('listing amount createdAt notifyWhenOutbid status').sort({ createdAt: -1 }).lean(),
      Offer.find({ offerer: user._id }).select('listing amount createdAt status').sort({ createdAt: -1 }).lean()
    ]);

    const listingMap = new Map(); // listingId -> { listing, bets: [], type, notifyWhenOutbid }

    for (const b of myBids) {
      const id = b.listing.toString();
      if (!listingMap.has(id)) {
        listingMap.set(id, { type: 'bid', bets: [], notifyWhenOutbid: b.notifyWhenOutbid !== false });
      }
      const entry = listingMap.get(id);
      entry.bets.push({ _id: b._id, amount: b.amount, createdAt: b.createdAt, type: 'bid', status: b.status });
      if (entry.notifyWhenOutbid === true && b.notifyWhenOutbid === false) entry.notifyWhenOutbid = false;
    }

    for (const o of myOffers) {
      const id = o.listing.toString();
      if (!listingMap.has(id)) {
        listingMap.set(id, { type: 'offer', bets: [], notifyWhenOutbid: true });
      }
      const entry = listingMap.get(id);
      if (entry.type === 'bid') entry.type = 'mixed';
      entry.bets.push({ _id: o._id, amount: o.amount, createdAt: o.createdAt, type: 'offer', status: o.status });
    }

    const listingIds = [...listingMap.keys()];
    if (listingIds.length === 0) {
      return res.json({ listings: [], total: 0 });
    }

    const listings = await Listing.find({ _id: { $in: listingIds } })
      .populate('seller', SELLER_DSA_PUBLIC_SELECT)
      .sort({ endDate: -1 })
      .lean();

    const enhanced = listings.map((listing) => {
      const id = listing._id.toString();
      const entry = listingMap.get(id) || { type: 'bid', bets: [], lastBid: null };
      const bets = entry.bets;
      const myHighest = bets.length ? Math.max(...bets.map(x => x.amount)) : null;
      const notifyWhenOutbid = entry.lastBid && typeof entry.lastBid.notifyWhenOutbid === 'boolean'
        ? entry.lastBid.notifyWhenOutbid
        : true;
      const isWinner = listing.winner?.toString?.() === user._id.toString() ||
        (listing.auctionFormat === 'best-offer' && bets.some(x => x.type === 'offer' && x.status === 'accepted'));
      return {
        ...listing,
        seller: sanitizeSellerForPublic(listing.seller),
        type: entry.type,
        bets,
        myHighestBid: myHighest,
        notifyWhenOutbid,
        isWinner
      };
    });

    res.json({ listings: enhanced, total: enhanced.length });
  } catch (error) {
    console.error('Error fetching bidder bets:', error);
    res.status(500).json({
      error: 'Failed to fetch your bets',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

