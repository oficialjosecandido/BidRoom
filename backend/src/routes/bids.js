const express = require('express');
const Bid = require('../models/Bid');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { sendFirstBidNotification } = require('../services/auctionNotificationService');
const { getReviewScoresForUsers } = require('../services/reviewService');

const router = express.Router();

// GET /api/bids/listing/:listingId - Get all bids for a listing
router.get('/listing/:listingId', async (req, res) => {
  try {
    const { sort = 'desc' } = req.query; // 'desc' for newest first, 'asc' for oldest first

    const sortOrder = sort === 'asc' ? 1 : -1;

    const bids = await Bid.find({ listing: req.params.listingId })
      .populate('bidder', 'firstName lastName email emailVerified hasDeposit')
      .sort({ createdAt: sortOrder })
      .lean();

    // Get buyer review scores for all bidders (authenticated users only)
    const bidderIds = bids.filter((b) => b.bidder && b.bidder._id).map((b) => b.bidder._id.toString());
    const scoreMap = bidderIds.length > 0 ? await getReviewScoresForUsers(bidderIds) : {};

    // Format bids for frontend
    const formattedBids = bids.map(bid => {
      const bidderId = bid.bidder && bid.bidder._id ? bid.bidder._id.toString() : null;
      const scores = bidderId ? scoreMap[bidderId] : null;
      return {
        ...bid,
        bidderName: bid.bidder
          ? `${bid.bidder.firstName} ${bid.bidder.lastName}`
          : (bid.bidderEmail ? bid.bidderEmail.split('@')[0] : 'Anonymous'),
        bidderInitials: bid.bidder
          ? `${bid.bidder.firstName.charAt(0)}${bid.bidder.lastName.charAt(0)}`
          : (bid.bidderEmail ? bid.bidderEmail.charAt(0).toUpperCase() : 'A'),
        bidderEmail: bid.bidderEmail || (bid.bidder ? bid.bidder.email : null),
        isAuthenticated: !!bid.bidder,
        bidderVerified: bid.bidder ? (bid.bidder.emailVerified || false) : false,
        bidderHasDeposit: bid.bidder ? (bid.bidder.hasDeposit || false) : false,
        bidderFirstName: bid.bidder ? bid.bidder.firstName : null,
        bidderLastName: bid.bidder ? bid.bidder.lastName : null,
        buyerScore: scores ? scores.buyerScore : null,
        buyerReviewCount: scores ? scores.buyerReviewCount : 0
      };
    });

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

    // Count unique bidders: authenticated users by user ID, unauthenticated by email
    const uniqueBidderIds = new Set();
    const uniqueEmails = new Set();
    
    bids.forEach(bid => {
      if (bid.bidder) {
        uniqueBidderIds.add(bid.bidder.toString());
      } else if (bid.bidderEmail) {
        uniqueEmails.add(bid.bidderEmail.toLowerCase());
      }
    });

    const stats = {
      totalBids: bids.length,
      uniqueBidders: uniqueBidderIds.size + uniqueEmails.size,
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

// POST /api/bids - Create a new bid (authentication optional, but email required if not authenticated)
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { listingId, amount, maxBid, bidType = 'manual', notes, email } = req.body;

    if (!listingId || !amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'listingId and amount are required'
      });
    }

    let user = null;
    let bidderEmail = null;

    // Handle authenticated user
    if (req.isAuthenticated && req.user) {
      // Require email verification for authenticated users
      if (!req.user.emailVerified) {
        return res.status(403).json({
          error: 'Email verification required',
          message: 'Please verify your email address before placing a bid. Check your inbox for the verification email.'
        });
      }
      
      // Find or create user in database from Firebase UID
      user = await User.findOne({ uid: req.user.uid });
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
      } else {
        // Update email verification status if changed
        if (req.user.emailVerified !== undefined && user.emailVerified !== req.user.emailVerified) {
          user.emailVerified = req.user.emailVerified;
          await user.save();
        }
      }
    } else {
      // Handle unauthenticated user - email is required
      if (!email) {
        return res.status(400).json({
          error: 'Email required',
          message: 'Please provide your email address to place a bid'
        });
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          error: 'Invalid email',
          message: 'Please provide a valid email address'
        });
      }

      bidderEmail = email.toLowerCase().trim();
    }

    // Get the listing (populate seller for own-listing check, platinum bidder invitations if they exist)
    const listing = await Listing.findById(listingId)
      .populate('seller', '_id email')
      .populate('platinumBidderInvitations.bidder', '_id');
    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found'
      });
    }

    // Block seller from bidding on their own listing
    if (user && listing.seller && listing.seller._id.toString() === user._id.toString()) {
      return res.status(403).json({
        error: 'Cannot bid on your own listing',
        message: 'You cannot place a bid on your own listing.'
      });
    }
    if (!user && bidderEmail && listing.seller && listing.seller.email) {
      if (listing.seller.email.toLowerCase() === bidderEmail.toLowerCase()) {
        return res.status(403).json({
          error: 'Cannot bid on your own listing',
          message: 'The email you entered is the seller\'s email for this item. You cannot bid on your own listing. Use a different email to place a bid as a guest, or log in with another account.'
        });
      }
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
    const isPrivateRoom = listing.privateRoomStatus === 'active' || listing.privateRoomStatus === 'eligible';
    
      if (isPrivateRoom) {
      // Private Room logic: check if still active/eligible
      // Note: Invitation acceptance is no longer required - platinum bidders can bid immediately
      if (listing.privateRoomStatus === 'active') {
        // Private Room is active - check if it has ended
        if (!listing.privateRoomEndDate || now > listing.privateRoomEndDate) {
          return res.status(400).json({
            error: 'Private Room ended',
            message: 'The Private Room has closed'
          });
        }
      }
      
      // Check if user is a platinum bidder (only authenticated users can participate in Private Room)
      if (!user) {
        return res.status(403).json({
          error: 'Authentication required',
          message: 'You must be logged in to participate in the Private Room'
        });
      }

      // Check if user is in the platinum bidders list
      const isInPlatinumBidders = listing.platinumBidders && listing.platinumBidders.some(
        pbId => pbId.toString() === user._id.toString()
      );
      
      if (!isInPlatinumBidders) {
        return res.status(403).json({
          error: 'Not eligible',
          message: 'Only Platinum Bidders can participate in the Private Room'
        });
      }

      // Note: Invitation acceptance is no longer required - platinum bidders can bid immediately
      
      // Extend Private Room deadline by 30 seconds with each bid (soft closing)
      const extendByMs = 30 * 1000; // 30 seconds
      
      // If status is 'eligible' and this is the first bid, activate the room
      if (listing.privateRoomStatus === 'eligible') {
        listing.privateRoomStatus = 'active';
        listing.status = 'active'; // Ensure listing is active
        // Set initial end date if not set (24 hours from now, or extend from current)
        if (!listing.privateRoomEndDate) {
          listing.privateRoomEndDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
        }
      }
      
      // Extend the deadline by 30 seconds with each bid
      const currentEndDate = listing.privateRoomEndDate || new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const newEndDate = new Date(Math.max(currentEndDate.getTime(), now.getTime()) + extendByMs);
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

    // Check if this is the user's first bid on this listing (BEFORE creating the bid)
    const previousBidsQuery = {
      listing: listingId
    };
    
    if (user) {
      previousBidsQuery.bidder = user._id;
    } else if (bidderEmail) {
      previousBidsQuery.bidderEmail = bidderEmail.toLowerCase();
      previousBidsQuery.bidder = null;
    }
    
    const previousBidsCount = await Bid.countDocuments(previousBidsQuery);
    const isFirstBid = previousBidsCount === 0;

    // Create the bid
    const bid = new Bid({
      listing: listingId,
      bidder: user ? user._id : null,
      bidderEmail: bidderEmail || null,
      amount: amount,
      maxBid: maxBid || amount,
      bidType: bidType,
      notes: notes || null
    });

    await bid.save();

    // Update listing with new current price and bid count
    listing.currentPrice = amount;
    listing.bidCount = await Bid.countDocuments({ listing: listingId });
    
    // Track unique bidders for Private Room trigger (only for authenticated users)
    if (user) {
      if (!listing.uniqueBidders) {
        listing.uniqueBidders = [];
      }
      if (!listing.uniqueBidders.some(id => id.toString() === user._id.toString())) {
        listing.uniqueBidders.push(user._id);
      }
    }
    
    // Check if reserve price is met (seller must sell if met or exceeded)
    let reserveMet = false;
    if (listing.reservePrice && amount >= listing.reservePrice) {
      reserveMet = true;
      // Reserve price is met - seller is committed to sell
    }

    await listing.save();

    // Populate bid for response
    const populatedBid = await Bid.findById(bid._id)
      .populate('bidder', 'firstName lastName email emailVerified hasDeposit')
      .lean();

    // Send first bid notification (non-blocking, don't fail if email fails)
    if (isFirstBid) {
      let bidderEmailForNotification = bidderEmail;
      let bidderNameForNotification = bidderEmail ? bidderEmail.split('@')[0] : 'Guest Bidder';
      
      if (populatedBid.bidder) {
        bidderEmailForNotification = populatedBid.bidder.email;
        bidderNameForNotification = `${populatedBid.bidder.firstName} ${populatedBid.bidder.lastName}`;
      }

      // Send notification asynchronously (don't wait)
      sendFirstBidNotification(listing, populatedBid, bidderEmailForNotification, bidderNameForNotification)
        .catch(err => {
          console.error('Failed to send first bid notification:', err);
        });
    }

    // Format bid response for both authenticated and unauthenticated bidders
    const formattedBid = {
      ...populatedBid,
      bidderName: populatedBid.bidder
        ? `${populatedBid.bidder.firstName} ${populatedBid.bidder.lastName}`
        : (populatedBid.bidderEmail ? populatedBid.bidderEmail.split('@')[0] : 'Anonymous'),
      bidderInitials: populatedBid.bidder
        ? `${populatedBid.bidder.firstName.charAt(0)}${populatedBid.bidder.lastName.charAt(0)}`
        : (populatedBid.bidderEmail ? populatedBid.bidderEmail.charAt(0).toUpperCase() : 'A'),
      bidderEmail: populatedBid.bidderEmail || (populatedBid.bidder ? populatedBid.bidder.email : null),
      // Add verification and deposit info for authenticated bidders
      isAuthenticated: !!populatedBid.bidder,
      bidderVerified: populatedBid.bidder ? (populatedBid.bidder.emailVerified || false) : false,
      bidderHasDeposit: populatedBid.bidder ? (populatedBid.bidder.hasDeposit || false) : false,
      bidderFirstName: populatedBid.bidder ? populatedBid.bidder.firstName : null,
      bidderLastName: populatedBid.bidder ? populatedBid.bidder.lastName : null
    };

    // Get Socket.io instance and Redis service from app
    const io = req.app.get('io');
    const redisService = req.app.get('redisService');

    // Cache current bid information in Redis
    const cacheData = {
      currentPrice: listing.currentPrice,
      bidCount: listing.bidCount,
      latestBid: formattedBid,
      listingId: listingId.toString(),
      timestamp: new Date().toISOString()
    };
    await redisService.cacheListingBid(listingId.toString(), cacheData);

    // Cache listing stats
    const stats = {
      totalBids: listing.bidCount,
      currentPrice: listing.currentPrice,
      uniqueBidders: listing.uniqueBidders?.length || 0,
      updatedAt: new Date().toISOString()
    };
    await redisService.cacheListingStats(listingId.toString(), stats);

    // Emit real-time bid update via Socket.io to all clients watching this listing
    if (io) {
      io.to(`listing:${listingId}`).emit('new-bid', {
        bid: formattedBid,
        listingId: listingId.toString(),
        currentPrice: listing.currentPrice,
        bidCount: listing.bidCount,
        updatedAt: new Date().toISOString()
      });

      // Also emit listing update with current price and bid count
      io.to(`listing:${listingId}`).emit('listing-update', {
        listingId: listingId.toString(),
        currentPrice: listing.currentPrice,
        bidCount: listing.bidCount,
        updatedAt: new Date().toISOString()
      });
    }

    res.status(201).json(formattedBid);
  } catch (error) {
    console.error('Error creating bid:', error);
    res.status(400).json({
      error: 'Failed to create bid',
      message: error.message
    });
  }
});

module.exports = router;

