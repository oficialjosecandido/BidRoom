const express = require('express');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/listings - Get all active listings with filtering and sorting
router.get('/', async (req, res) => {
  try {
    const {
      category,
      sort = 'deadline', // deadline, newest, highest, lowest, bids
      minPrice,
      maxPrice,
      minBids,
      listingType,
      status = 'active',
      search,
      limit = 50,
      skip = 0
    } = req.query;

    // Build query
    const query = {};
    
    if (status) {
      query.status = status;
    }
    
    if (category) {
      query.category = category;
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
      .limit(parseInt(limit))
      .skip(parseInt(skip))
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

    res.json({
      listings: listingsWithTimeRemaining,
      total,
      limit: parseInt(limit),
      skip: parseInt(skip)
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

// GET /api/listings/slug/:slug - Get a single listing by slug
router.get('/slug/:slug', async (req, res) => {
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
    
    res.json({
      ...listing,
      timeRemaining,
      endingSoon: timeRemaining.ended ? false : (timeRemaining.days === 0 && timeRemaining.hours <= 24)
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
    const totalBidders = await Listing.distinct('seller').then(users => users.length);
    const activeListings = await Listing.countDocuments({ status: 'active' });
    
    // Calculate total value traded (sum of currentPrice for all active listings)
    const valueResult = await Listing.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, totalValue: { $sum: '$currentPrice' } } }
    ]);
    
    const totalValueTraded = valueResult.length > 0 ? valueResult[0].totalValue : 0;

    res.json({
      totalBidders,
      activeListings,
      totalValueTraded: Math.round(totalValueTraded)
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
router.get('/:id', async (req, res) => {
  try {
    // Check if it's a valid ObjectId, otherwise treat as slug
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(req.params.id);
    
    let listing;
    if (isObjectId) {
      listing = await Listing.findById(req.params.id)
        .populate('seller', 'firstName lastName email')
        .lean();
    } else {
      // Treat as slug
      listing = await Listing.findOne({ slug: req.params.id })
        .populate('seller', 'firstName lastName email')
        .lean();
    }

    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found'
      });
    }

    const timeRemaining = new Listing(listing).getTimeRemaining();
    
    res.json({
      ...listing,
      timeRemaining,
      endingSoon: timeRemaining.ended ? false : (timeRemaining.days === 0 && timeRemaining.hours <= 24)
    });
  } catch (error) {
    console.error('Error fetching listing:', error);
    res.status(500).json({
      error: 'Failed to fetch listing',
      message: error.message
    });
  }
});

// POST /api/listings - Create a new listing (requires authentication)
router.post('/', authenticateToken, async (req, res) => {
  try {
    // Find or create user in database from Firebase UID
    let user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      // If user doesn't exist, create one
      user = new User({
        uid: req.user.uid,
        email: req.user.email,
        firstName: req.user.name?.split(' ')[0] || 'User',
        lastName: req.user.name?.split(' ').slice(1).join(' ') || '',
        isActive: true
      });
      await user.save();
    }

    const listingData = {
      ...req.body,
      seller: user._id,
      currentPrice: req.body.startingPrice || req.body.currentPrice
    };

    const listing = new Listing(listingData);
    await listing.save();

    const populatedListing = await Listing.findById(listing._id)
      .populate('seller', 'firstName lastName email')
      .lean();

    const timeRemaining = new Listing(populatedListing).getTimeRemaining();

    res.status(201).json({
      ...populatedListing,
      timeRemaining,
      endingSoon: timeRemaining.ended ? false : (timeRemaining.days === 0 && timeRemaining.hours <= 24)
    });
  } catch (error) {
    console.error('Error creating listing:', error);
    res.status(400).json({
      error: 'Failed to create listing',
      message: error.message
    });
  }
});

// POST /api/listings/:id/buy-now - Buy now (instantly closes auction)
router.post('/:id/buy-now', authenticateToken, async (req, res) => {
  try {
    // Find or create user
    let user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      user = new User({
        uid: req.user.uid,
        email: req.user.email,
        firstName: req.user.name?.split(' ')[0] || 'User',
        lastName: req.user.name?.split(' ').slice(1).join(' ') || '',
        isActive: true
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

module.exports = router;

