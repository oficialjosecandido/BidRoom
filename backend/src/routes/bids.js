const express = require('express');
const Bid = require('../models/Bid');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/bids/listing/:listingId - Get all bids for a listing
router.get('/listing/:listingId', async (req, res) => {
  try {
    const { sort = 'desc' } = req.query; // 'desc' for newest first, 'asc' for oldest first

    const sortOrder = sort === 'asc' ? 1 : -1;

    const bids = await Bid.find({ listing: req.params.listingId })
      .populate('bidder', 'firstName lastName email')
      .sort({ createdAt: sortOrder })
      .lean();

    // Format bids for frontend
    const formattedBids = bids.map(bid => ({
      ...bid,
      bidderName: bid.bidder 
        ? `${bid.bidder.firstName} ${bid.bidder.lastName}`
        : 'Anonymous',
      bidderInitials: bid.bidder
        ? `${bid.bidder.firstName.charAt(0)}${bid.bidder.lastName.charAt(0)}`
        : 'A'
    }));

    res.json({
      bids: formattedBids,
      total: formattedBids.length
    });
  } catch (error) {
    console.error('Error fetching bids:', error);
    res.status(500).json({
      error: 'Failed to fetch bids',
      message: error.message
    });
  }
});

// GET /api/bids/listing/:listingId/stats - Get bid statistics for a listing
router.get('/listing/:listingId/stats', async (req, res) => {
  try {
    const bids = await Bid.find({ listing: req.params.listingId });

    const stats = {
      totalBids: bids.length,
      uniqueBidders: new Set(bids.map(b => b.bidder.toString())).size,
      highestBid: bids.length > 0 ? Math.max(...bids.map(b => b.amount)) : 0,
      averageBid: bids.length > 0 
        ? bids.reduce((sum, b) => sum + b.amount, 0) / bids.length 
        : 0
    };

    res.json(stats);
  } catch (error) {
    console.error('Error fetching bid stats:', error);
    res.status(500).json({
      error: 'Failed to fetch bid statistics',
      message: error.message
    });
  }
});

// POST /api/bids - Create a new bid (requires authentication)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { listingId, amount, maxBid, bidType = 'manual', notes } = req.body;

    if (!listingId || !amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'listingId and amount are required'
      });
    }

    // Find or create user in database from Firebase UID
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

    // Get the listing
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found'
      });
    }

    // Check auction format
    if (listing.auctionFormat === 'best-offer') {
      return res.status(400).json({
        error: 'Wrong auction format',
        message: 'This listing uses Best Offer format. Please submit an offer instead.'
      });
    }

    // Check if listing is still active
    if (listing.status !== 'active') {
      return res.status(400).json({
        error: 'Listing not active',
        message: 'This auction is no longer accepting bids'
      });
    }

    // Check if auction has ended (for main auction)
    const now = new Date();
    const isPrivateRoom = listing.privateRoomStatus === 'active';
    
    if (isPrivateRoom) {
      // Private Room logic: check if still active
      if (!listing.privateRoomEndDate || now > listing.privateRoomEndDate) {
        return res.status(400).json({
          error: 'Private Room ended',
          message: 'The Private Room has closed'
        });
      }
      
      // Check if user is in top 5 bidders
      const topBidders = await listing.getTop5Bidders();
      const isInTop5 = topBidders.some(tb => tb.bidder._id.toString() === user._id.toString());
      
      if (!isInTop5) {
        return res.status(403).json({
          error: 'Not eligible',
          message: 'Only the top 5 bidders can participate in the Private Room'
        });
      }
      
      // Extend Private Room deadline by 1 minute with each bid
      const newEndDate = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes from now
      listing.privateRoomEndDate = newEndDate;
      listing.privateRoomLastBidTime = now;
    } else {
      // Main auction logic
      if (now > listing.endDate) {
        // Check if Private Room should be triggered
        const eligible = await listing.checkPrivateRoomEligibility();
        if (eligible && listing.allowPrivateRoom) {
          // Trigger Private Room
          listing.privateRoomStatus = 'active';
          listing.privateRoomEndDate = new Date(now.getTime() + 2 * 60 * 1000); // Start with 2 minutes
          listing.privateRoomLastBidTime = now;
        } else {
          return res.status(400).json({
            error: 'Auction ended',
            message: 'This auction has already ended'
          });
        }
      }
    }

    // Validate bid amount
    const minBid = isPrivateRoom 
      ? listing.currentPrice + listing.bidIncrement // Same increment in Private Room
      : listing.currentPrice + listing.bidIncrement;
      
    if (amount < minBid) {
      return res.status(400).json({
        error: 'Bid too low',
        message: `Minimum bid is $${minBid.toFixed(2)}`
      });
    }

    // Create the bid
    const bid = new Bid({
      listing: listingId,
      bidder: user._id,
      amount: amount,
      maxBid: maxBid || amount,
      bidType: bidType,
      notes: notes || null,
      status: 'active',
      isWinning: true // Will be updated if outbid
    });

    await bid.save();

    // Update listing with new current price and bid count
    listing.currentPrice = amount;
    listing.bidCount = await Bid.countDocuments({ listing: listingId });
    
    // Track unique bidders for Private Room trigger
    if (!listing.uniqueBidders) {
      listing.uniqueBidders = [];
    }
    if (!listing.uniqueBidders.some(id => id.toString() === user._id.toString())) {
      listing.uniqueBidders.push(user._id);
    }
    
    // Check if reserve price is met (seller must sell if met or exceeded)
    let reserveMet = false;
    if (listing.reservePrice && amount >= listing.reservePrice) {
      reserveMet = true;
      // Reserve price is met - seller is committed to sell
    }
    
    // Update previous winning bids to outbid
    await Bid.updateMany(
      { 
        listing: listingId, 
        isWinning: true, 
        _id: { $ne: bid._id } 
      },
      { 
        status: 'outbid',
        isWinning: false 
      }
    );

    await listing.save();

    // Populate bid for response
    const populatedBid = await Bid.findById(bid._id)
      .populate('bidder', 'firstName lastName email')
      .lean();

    res.status(201).json({
      ...populatedBid,
      bidderName: `${populatedBid.bidder.firstName} ${populatedBid.bidder.lastName}`,
      bidderInitials: `${populatedBid.bidder.firstName.charAt(0)}${populatedBid.bidder.lastName.charAt(0)}`
    });
  } catch (error) {
    console.error('Error creating bid:', error);
    res.status(400).json({
      error: 'Failed to create bid',
      message: error.message
    });
  }
});

module.exports = router;

