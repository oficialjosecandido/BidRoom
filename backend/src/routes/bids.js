const express = require('express');
const Bid = require('../models/Bid');
const Listing = require('../models/Listing');
const User = require('../models/User');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { sendFirstBidNotification, sendOutbidNotification } = require('../services/auctionNotificationService');
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
    const { listingId, amount, maxBid, bidType = 'manual', notes, email, notifyWhenOutbid } = req.body;

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

    // Get the listing (populate seller for own-listing check, platinum bidder invitations for acceptance check)
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
    const isPrivateRoom = listing.privateRoomStatus === 'active' || listing.privateRoomStatus === 'eligible' || listing.privateRoomStatus === 'invited';

    if (isPrivateRoom) {
      // Room not started yet: invitees have 15 min to accept, then room starts automatically
      if (listing.privateRoomStatus === 'invited') {
        return res.status(400).json({
          error: 'Room not started',
          message: 'The private room has not started yet. It will start automatically after the 15 minute acceptance window.'
        });
      }

      // Private Room logic: check if still active/eligible
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

      const isInPlatinumBidders = listing.platinumBidders && listing.platinumBidders.some(
        pbId => pbId.toString() === user._id.toString()
      );
      if (!isInPlatinumBidders) {
        return res.status(403).json({
          error: 'Not eligible',
          message: 'Only Platinum Bidders can participate in the Private Room'
        });
      }

      const invitations = listing.platinumBidderInvitations || [];
      const invitation = invitations.find(
        inv => inv.bidder && inv.bidder._id.toString() === user._id.toString()
      );
      if (invitation) {
        if (invitation.status !== 'accepted') {
          const now = new Date();
          if (listing.platinumBidderAcceptanceDeadline && now > new Date(listing.platinumBidderAcceptanceDeadline)) {
            return res.status(403).json({
              error: 'Seat lost',
              message: 'The 15 minute window to accept the invitation has passed. You can no longer place bids in this private room.'
            });
          }
          return res.status(403).json({
            error: 'Accept invitation first',
            message: 'You must accept your private room invitation (link in your email) before you can place bids.'
          });
        }
      }
      // Private room ends 60 seconds after last bid (each bid extends by 60s)
      const PRIVATE_ROOM_EXTEND_MS = 60 * 1000; // 60 seconds

      // If status is 'eligible' and this is the first bid, activate the room
      if (listing.privateRoomStatus === 'eligible') {
        listing.privateRoomStatus = 'active';
        listing.status = 'active'; // Ensure listing is active
        if (!listing.privateRoomEndDate) {
          listing.privateRoomEndDate = new Date(now.getTime() + PRIVATE_ROOM_EXTEND_MS);
        }
      }

      // Extend the deadline to 60 seconds from now with each bid
      const newEndDate = new Date(now.getTime() + PRIVATE_ROOM_EXTEND_MS);
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

    const preferNotifyOutbid = typeof notifyWhenOutbid === 'boolean' ? notifyWhenOutbid : true;

    // Previous high bid amount (before this bid) - used to find who to notify as outbid
    const previousHighAmount = listing.currentPrice != null ? listing.currentPrice : (listing.startingPrice || 0);

    // Create the bid
    const bid = new Bid({
      listing: listingId,
      bidder: user ? user._id : null,
      bidderEmail: bidderEmail || null,
      amount: amount,
      maxBid: maxBid || amount,
      bidType: bidType,
      notes: notes || null,
      notifyWhenOutbid: preferNotifyOutbid
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

    // Send outbid notifications to previous high bidder(s) who opted in (non-blocking)
    if (previousHighAmount > 0 && amount > previousHighAmount) {
      const currentBidderId = user ? user._id.toString() : null;
      const currentBidderEmail = (bidderEmail || '').toLowerCase();

      const previousHighBids = await Bid.find({
        listing: listingId,
        amount: previousHighAmount,
        _id: { $ne: bid._id }
      })
        .populate('bidder', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .lean();

      const notifiedEmails = new Set();
      for (const prevBid of previousHighBids) {
        let outbidEmail = null;
        let outbidName = 'Bidder';
        if (prevBid.bidder && prevBid.bidder.email) {
          if (prevBid.bidder._id.toString() === currentBidderId) continue;
          outbidEmail = prevBid.bidder.email.toLowerCase();
          outbidName = `${prevBid.bidder.firstName} ${prevBid.bidder.lastName}`;
        } else if (prevBid.bidderEmail) {
          if (prevBid.bidderEmail.toLowerCase() === currentBidderEmail) continue;
          outbidEmail = prevBid.bidderEmail.toLowerCase();
          outbidName = prevBid.bidderEmail.split('@')[0];
        }
        if (!outbidEmail || notifiedEmails.has(outbidEmail)) continue;

        const latestBidByOutbidder = await Bid.findOne({
          listing: listingId,
          $or: [
            prevBid.bidder ? { bidder: prevBid.bidder._id } : { bidder: null, bidderEmail: prevBid.bidderEmail }
          ]
        })
          .sort({ createdAt: -1 })
          .select('notifyWhenOutbid')
          .lean();
        if (latestBidByOutbidder && latestBidByOutbidder.notifyWhenOutbid === false) continue;

        notifiedEmails.add(outbidEmail);
        sendOutbidNotification(
          listing,
          outbidEmail,
          outbidName,
          previousHighAmount,
          amount
        ).catch(err => console.error('Failed to send outbid notification:', err));
      }
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

// PATCH /api/bids/preference - Update outbid notification preference for a listing (authenticated bidders only)
router.patch('/preference', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { listingId, notifyWhenOutbid } = req.body;
    if (!listingId) {
      return res.status(400).json({
        error: 'Missing listingId',
        message: 'listingId is required'
      });
    }
    if (typeof notifyWhenOutbid !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid preference',
        message: 'notifyWhenOutbid must be true or false'
      });
    }

    const result = await Bid.updateMany(
      { listing: listingId, bidder: user._id },
      { $set: { notifyWhenOutbid } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        error: 'No bids found',
        message: 'You have not placed any bids on this listing'
      });
    }

    res.json({
      listingId,
      notifyWhenOutbid,
      updated: result.modifiedCount
    });
  } catch (error) {
    console.error('Error updating bid preference:', error);
    res.status(500).json({
      error: 'Failed to update preference',
      message: error.message
    });
  }
});

module.exports = router;

