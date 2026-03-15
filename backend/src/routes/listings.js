const express = require('express');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Bid = require('../models/Bid');
const Offer = require('../models/Offer');
const Watchlist = require('../models/Watchlist');
const { authenticateToken, optionalAuth, requireActiveAccount } = require('../middleware/auth');
const { handleWinnerSelection, handleAuctionEnd } = require('../services/auctionNotificationService');
const { getReviewScoresForUser } = require('../services/reviewService');
const { logAuctionCreated } = require('../services/bestOfferLogger');

const router = express.Router();

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
      status = 'active',
      search,
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
    
    if (minPrice || maxPrice) {
      query.currentPrice = {};
      if (minPrice) query.currentPrice.$gte = parseFloat(minPrice);
      if (maxPrice) query.currentPrice.$lte = parseFloat(maxPrice);
    }
    
    if (minBids) {
      query.bidCount = { $gte: parseInt(minBids) };
    }
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
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
      default:
        sortObj = { endDate: 1 };
    }

    // For featured listings, prioritize them
    if (sort === 'deadline') {
      sortObj = { isFeatured: -1, endDate: 1 };
    }

    const listings = await Listing.find(query)
      .populate('seller', 'firstName lastName email')
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
      message: error.message
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
      .populate('seller', 'firstName lastName email')
      .lean();

    // If not found by slug, try to find listings without slugs and generate them
    // This handles cases where listings were created before slug was added
    if (!listing) {
      // Try to find all listings without slugs
      const listingsWithoutSlugs = await Listing.find({ 
        slug: { $exists: false } 
      }).populate('seller', 'firstName lastName email').lean();

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
          .populate('seller', 'firstName lastName email')
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
          .populate('seller', 'firstName lastName email')
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
          .populate('seller', 'firstName lastName email')
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

    res.json({
      ...listing,
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
      message: error.message
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
      message: error.message
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
        .populate('seller', 'firstName lastName email')
        .populate('platinumBidderInvitations.bidder', '_id')
        .lean();
    } else {
      listing = await Listing.findOne({ slug: req.params.id })
        .populate('seller', 'firstName lastName email')
        .populate('platinumBidderInvitations.bidder', '_id')
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
          .populate('seller', 'firstName lastName email')
          .populate('platinumBidderInvitations.bidder', '_id')
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
          if (!invitation) {
            isPlatinumBidder = true;
          } else if (invitation.status === 'accepted') {
            isPlatinumBidder = true;
          } else if (invitation.status === 'declined') {
            isPlatinumBidder = false;
          } else if (listing.platinumBidderAcceptanceDeadline && new Date() > new Date(listing.platinumBidderAcceptanceDeadline)) {
            isPlatinumBidder = false;
          } else {
            invitationPending = true;
          }
        }
        response.currentUserPlatinumStatus = { isPlatinumBidder, invitationPending };
      }
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error fetching listing:', error);
    res.status(500).json({
      error: 'Failed to fetch listing',
      message: error.message
    });
  }
});

// POST /api/listings - Create a new listing (requires authentication)
router.post('/', authenticateToken, requireActiveAccount, async (req, res) => {
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
      shippingCost,
      shippingOption,
      packageSize,
      shippingOriginPostalCode,
      shippingOriginCity,
      shippingOriginCountry,
      handlingTime,
      returnPolicy,
      specifications,
      images = []
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
    if (!duration) {
      return res.status(400).json({ error: 'Listing duration is required' });
    }
    if (!shippingOption) {
      return res.status(400).json({ error: 'Shipping option is required' });
    }
    if (!handlingTime) {
      return res.status(400).json({ error: 'Handling time is required' });
    }
    if (!returnPolicy) {
      return res.status(400).json({ error: 'Return policy is required' });
    }
    // Note: Image upload will be handled separately. For now, allow empty images array.
    // Frontend should upload images first, then send URLs in the images array.

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

    // Prepare listing data
    const listingData = {
      title: title.trim(),
      description: description.trim(),
      category: category.toLowerCase().replace(/\s+/g, '-'), // Normalize category
      subCategory: subCategory.trim(),
      condition,
      auctionFormat: (listingFormat === 'best-offer') ? 'best-offer' : 'highest-bid',
      durationSlot: duration,
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
      shippingCost: shippingCost ? parseFloat(shippingCost) : 0,
      shippingOption,
      packageSize: shippingOption === 'calculated' ? (packageSize || null) : null,
      shippingOriginPostalCode: shippingOption === 'calculated' ? (shippingOriginPostalCode || null) : null,
      shippingOriginCity: shippingOption === 'calculated' ? (shippingOriginCity || null) : null,
      shippingOriginCountry: shippingOption === 'calculated' ? (shippingOriginCountry || 'US') : null,
      handlingTime: parseInt(handlingTime),
      returnPolicy,
      specifications: specifications || [],
      images: Array.isArray(images) && images.length > 0 ? images : ['https://via.placeholder.com/400x300?text=No+Image'], // Temporary placeholder until image upload is implemented
      seller: user._id,
      status: 'active' // Create as active listing
    };

    // Calculate end date based on duration slot
    const durations = {
      '5 minutes': 5 * 60 * 1000,
      '2 hours': 2 * 60 * 60 * 1000,
      '24 hours': 24 * 60 * 60 * 1000,
      '3 days': 3 * 24 * 60 * 60 * 1000,
      '7 days': 7 * 24 * 60 * 60 * 1000
    };
    const durationMs = durations[duration] || durations['7 days'];
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

    // Populate and return the listing
    const populatedListing = await Listing.findById(listing._id)
      .populate('seller', 'firstName lastName email')
      .lean();

    if (populatedListing.auctionFormat === 'best-offer') {
      logAuctionCreated(populatedListing);
    }

    const timeRemaining = new Listing(populatedListing).getTimeRemaining();

    res.status(201).json({
      ...populatedListing,
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
      message: error.message
    });
  }
});

// POST /api/listings/:id/buy-now - Buy now (instantly closes auction)
router.post('/:id/buy-now', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    // Find or create user
    let user = await User.findOne({ uid: req.user.uid });
    if (!user) {
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
    }

    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    if (!listing.buyNowPrice) {
      return res.status(400).json({
        error: 'Buy Now not available',
        message: 'This listing does not have a Buy Now price'
      });
    }

    if (listing.status !== 'active') {
      return res.status(400).json({
        error: 'Listing not active',
        message: 'This listing is no longer active'
      });
    }

    // Close the auction
    listing.status = 'ended';
    listing.currentPrice = listing.buyNowPrice;
    listing.endDate = new Date();

    await listing.save();

    res.json({
      success: true,
      message: 'Purchase successful',
      listing: listing,
      price: listing.buyNowPrice
    });
  } catch (error) {
    console.error('Error processing buy now:', error);
    res.status(400).json({
      error: 'Failed to process Buy Now',
      message: error.message
    });
  }
});

// POST /api/listings/:id/choose-winner - Seller chooses a winner
router.post('/:id/choose-winner', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('seller', 'uid email');

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
      .populate('seller', 'firstName lastName email')
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
      message: error.message
    });
  }
});

// POST /api/listings/:id/reopen - Seller reopens an ended auction with no bids (extends by 7 days)
router.post('/:id/reopen', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('seller', 'uid');

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
      .populate('seller', 'firstName lastName email')
      .lean();

    res.json({
      message: 'Auction reopened for 7 days',
      listing: updatedListing
    });
  } catch (error) {
    console.error('Error reopening listing:', error);
    res.status(400).json({
      error: 'Failed to reopen auction',
      message: error.message
    });
  }
});

// GET /api/listings/:id/bids - Get all bids for a listing (for seller to choose winner)
router.get('/:id/bids', authenticateToken, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('seller', 'uid');

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
      message: error.message
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
        watchlistCount: watchlistByListing[listing._id.toString()] ?? 0
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
      message: error.message
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
      .populate('seller', 'firstName lastName')
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
      message: error.message
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
      .populate('seller', 'firstName lastName')
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
      message: error.message
    });
  }
});

module.exports = router;

