const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken } = require('../middleware/auth');
const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const User = require('../models/User');

const router = express.Router();

// Get bidders for a listing (for seller to select Platinum Bidders)
router.get('/listings/:id/bidders', authenticateToken, async (req, res) => {
  try {
    const listingId = req.params.id;
    const listing = await Listing.findById(listingId).populate('seller');
    
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Verify the user is the seller
    if (listing.seller._id.toString() !== req.user.uid) {
      // Find user by Firebase UID
      const user = await User.findOne({ uid: req.user.uid });
      if (!user || listing.seller._id.toString() !== user._id.toString()) {
        return res.status(403).json({ error: 'Forbidden', message: 'Only the seller can view bidders' });
      }
    }

    // Get all bids for this listing
    const bids = await Bid.find({ listing: listingId })
      .populate('bidder', 'firstName lastName email emailVerified hasDeposit')
      .sort({ createdAt: -1 });

    // Get unique bidders (both authenticated and unauthenticated)
    const uniqueBidders = new Map();
    
    bids.forEach(bid => {
      if (bid.bidder) {
        // Authenticated bidder
        const bidderId = bid.bidder._id.toString();
        if (!uniqueBidders.has(bidderId)) {
          uniqueBidders.set(bidderId, {
            _id: bid.bidder._id,
            firstName: bid.bidder.firstName,
            lastName: bid.bidder.lastName,
            email: bid.bidder.email,
            emailVerified: bid.bidder.emailVerified,
            hasDeposit: bid.bidder.hasDeposit,
            isAuthenticated: true,
            bidCount: 0,
            highestBid: 0,
            firstBidDate: bid.createdAt,
            lastBidDate: bid.createdAt
          });
        }
        const bidder = uniqueBidders.get(bidderId);
        bidder.bidCount++;
        bidder.highestBid = Math.max(bidder.highestBid, bid.amount);
        if (bid.createdAt < bidder.firstBidDate) {
          bidder.firstBidDate = bid.createdAt;
        }
        if (bid.createdAt > bidder.lastBidDate) {
          bidder.lastBidDate = bid.createdAt;
        }
      } else if (bid.bidderEmail) {
        // Unauthenticated bidder (by email)
        if (!uniqueBidders.has(bid.bidderEmail)) {
          uniqueBidders.set(bid.bidderEmail, {
            email: bid.bidderEmail,
            isAuthenticated: false,
            bidCount: 0,
            highestBid: 0,
            firstBidDate: bid.createdAt,
            lastBidDate: bid.createdAt
          });
        }
        const bidder = uniqueBidders.get(bid.bidderEmail);
        bidder.bidCount++;
        bidder.highestBid = Math.max(bidder.highestBid, bid.amount);
        if (bid.createdAt < bidder.firstBidDate) {
          bidder.firstBidDate = bid.createdAt;
        }
        if (bid.createdAt > bidder.lastBidDate) {
          bidder.lastBidDate = bid.createdAt;
        }
      }
    });

    const biddersList = Array.from(uniqueBidders.values()).sort((a, b) => b.highestBid - a.highestBid);

    res.json({
      listingId: listing._id,
      bidders: biddersList,
      currentPlatinumBidders: listing.platinumBidders || []
    });
  } catch (error) {
    console.error('Error fetching bidders:', error);
    res.status(500).json({ 
      error: 'Failed to fetch bidders',
      message: error.message 
    });
  }
});

// Select Platinum Bidders (up to 5)
router.post('/listings/:id/platinum-bidders', authenticateToken, async (req, res) => {
  try {
    const listingId = req.params.id;
    const { bidderIds } = req.body; // Array of user IDs or emails

    if (!Array.isArray(bidderIds) || bidderIds.length === 0) {
      return res.status(400).json({ error: 'Bidder IDs are required' });
    }

    if (bidderIds.length > 5) {
      return res.status(400).json({ error: 'Maximum 5 Platinum Bidders allowed' });
    }

    const listing = await Listing.findById(listingId).populate('seller');
    
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Verify the user is the seller
    const user = await User.findOne({ uid: req.user.uid });
    if (!user || listing.seller._id.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the seller can select Platinum Bidders' });
    }

    // Check if listing is still active
    if (listing.status !== 'active') {
      return res.status(400).json({ error: 'Can only select Platinum Bidders for active listings' });
    }

    // Validate bidder IDs (can be ObjectId for authenticated users or email for unauthenticated)
    const validBidderIds = [];
    for (const bidderId of bidderIds) {
      // Check if it's a valid ObjectId (authenticated user)
      if (mongoose.Types.ObjectId.isValid(bidderId)) {
        const bidder = await User.findById(bidderId);
        if (bidder) {
          validBidderIds.push(bidder._id);
        }
      } else {
        // It's an email (unauthenticated bidder) - we'll store it differently
        // For now, we'll only support authenticated users as Platinum Bidders
        return res.status(400).json({ 
          error: 'Invalid bidder', 
          message: 'Only authenticated users can be selected as Platinum Bidders' 
        });
      }
    }

    // Check if any of the selected bidders have actually bid on this listing
    const bids = await Bid.find({ 
      listing: listingId,
      bidder: { $in: validBidderIds }
    });

    if (bids.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid selection', 
        message: 'Selected bidders must have placed bids on this listing' 
      });
    }

    // Update listing with Platinum Bidders
    listing.platinumBidders = validBidderIds;
    listing.platinumBidderInvitedAt = new Date();
    await listing.save();

    // TODO: Send notifications to selected Platinum Bidders

    res.json({
      success: true,
      message: 'Platinum Bidders selected successfully',
      platinumBidders: validBidderIds,
      listing: {
        id: listing._id,
        platinumBidders: listing.platinumBidders,
        platinumBidderInvitedAt: listing.platinumBidderInvitedAt
      }
    });
  } catch (error) {
    console.error('Error selecting Platinum Bidders:', error);
    res.status(500).json({ 
      error: 'Failed to select Platinum Bidders',
      message: error.message 
    });
  }
});

// Accept platinum bidder invitation (public endpoint - uses token)
router.post('/invitation/accept', async (req, res) => {
  try {
    const { token, listingId } = req.body;

    if (!token || !listingId) {
      return res.status(400).json({ 
        error: 'Invalid request',
        message: 'Token and listing ID are required' 
      });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Find the invitation
    const invitation = listing.platinumBidderInvitations.find(
      inv => inv.invitationToken === token && inv.status === 'pending'
    );

    if (!invitation) {
      return res.status(404).json({ 
        error: 'Invalid invitation',
        message: 'Invitation not found or already processed' 
      });
    }

    // Update invitation status
    invitation.status = 'accepted';
    invitation.acceptedAt = new Date();

    await listing.save();

    // Emit socket event if available
    const io = req.app.get('io');
    if (io) {
      io.to(`listing:${listingId}`).emit('listing-updated', {
        listingId: listing._id.toString(),
        privateRoomStatus: listing.privateRoomStatus
      });
    }

    res.json({
      success: true,
      message: 'Invitation accepted successfully',
      privateRoomStatus: listing.privateRoomStatus
    });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    res.status(500).json({ 
      error: 'Failed to accept invitation',
      message: error.message 
    });
  }
});

// Decline platinum bidder invitation (public endpoint - uses token)
router.post('/invitation/decline', async (req, res) => {
  try {
    const { token, listingId } = req.body;

    if (!token || !listingId) {
      return res.status(400).json({ 
        error: 'Invalid request',
        message: 'Token and listing ID are required' 
      });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Find the invitation
    const invitation = listing.platinumBidderInvitations.find(
      inv => inv.invitationToken === token && inv.status === 'pending'
    );

    if (!invitation) {
      return res.status(404).json({ 
        error: 'Invalid invitation',
        message: 'Invitation not found or already processed' 
      });
    }

    // Update invitation status
    invitation.status = 'declined';

    // Remove bidder from platinum bidders list
    listing.platinumBidders = listing.platinumBidders.filter(
      pb => pb.toString() !== invitation.bidder.toString()
    );

    // Note: Private room activation happens after acceptance window expires (handled by scheduler)
    // We just save the decline status here

    await listing.save();

    res.json({
      success: true,
      message: 'Invitation declined'
    });
  } catch (error) {
    console.error('Error declining invitation:', error);
    res.status(500).json({ 
      error: 'Failed to decline invitation',
      message: error.message 
    });
  }
});

// Check if current user is a platinum bidder for a listing
router.get('/listings/:id/check-platinum', authenticateToken, async (req, res) => {
  try {
    const listingId = req.params.id;
    const listing = await Listing.findById(listingId)
      .select('platinumBidders platinumBidderInvitations');
    
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Find user by Firebase UID
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.json({ isPlatinumBidder: false });
    }

    // Check if user is in platinum bidders
    const isInPlatinumBidders = listing.platinumBidders.some(
      pbId => pbId.toString() === user._id.toString()
    );

    if (!isInPlatinumBidders) {
      return res.json({ isPlatinumBidder: false });
    }

    // If invitations exist, check if user has accepted their invitation
    if (listing.platinumBidderInvitations && listing.platinumBidderInvitations.length > 0) {
      const invitation = listing.platinumBidderInvitations.find(
        inv => inv.bidder.toString() === user._id.toString()
      );
      
      if (invitation && invitation.status !== 'accepted') {
        return res.json({ 
          isPlatinumBidder: false,
          needsAcceptance: true,
          invitationStatus: invitation.status 
        });
      }
    }

    res.json({ isPlatinumBidder: true });
  } catch (error) {
    console.error('Error checking platinum bidder status:', error);
    res.status(500).json({ 
      error: 'Failed to check platinum bidder status',
      message: error.message 
    });
  }
});

module.exports = router;
