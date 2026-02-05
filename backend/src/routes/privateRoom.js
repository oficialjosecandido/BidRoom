const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const User = require('../models/User');
const { sendPlatinumBidderInvitations, sendPrivateRoomNotInvitedToBidders } = require('../services/auctionNotificationService');

const router = express.Router();
const ACCEPTANCE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes to accept or lose seat

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

// Select Platinum Bidders (2–5). Allowed when listing is active (pre-end) or when ended + private room eligible.
router.post('/listings/:id/platinum-bidders', authenticateToken, async (req, res) => {
  try {
    const listingId = req.params.id;
    const { bidderIds } = req.body; // Array of user IDs (authenticated only)

    if (!Array.isArray(bidderIds) || bidderIds.length === 0) {
      return res.status(400).json({ error: 'Bidder IDs are required' });
    }

    if (bidderIds.length < 2) {
      return res.status(400).json({ error: 'At least 2 bidders must be selected for the private room' });
    }

    if (bidderIds.length > 5) {
      return res.status(400).json({ error: 'Maximum 5 Platinum Bidders allowed' });
    }

    const listing = await Listing.findById(listingId).populate('seller');
    
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user || listing.seller._id.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the seller can select Platinum Bidders' });
    }

    // Allow when: (1) listing active, or (2) listing ended and private room eligible and within 1h deadline
    const canSelect = listing.status === 'active' || (listing.status === 'ended' && listing.privateRoomStatus === 'eligible');
    if (!canSelect) {
      return res.status(400).json({
        error: 'Cannot select guests now',
        message: listing.status === 'ended'
          ? 'Private room is not available for this listing (either not enabled or deadline passed).'
          : 'Can only select Platinum Bidders when the listing is active or when the auction has ended and private room is eligible.'
      });
    }
    if (listing.status === 'ended' && listing.privateRoomStatus === 'eligible' && listing.winnerSelectionDeadline) {
      if (new Date() > new Date(listing.winnerSelectionDeadline)) {
        return res.status(400).json({
          error: 'Deadline passed',
          message: 'The 1 hour window to create the private room has passed. You can no longer create a private room for this listing.'
        });
      }
    }

    const validBidderIds = [];
    for (const bidderId of bidderIds) {
      if (mongoose.Types.ObjectId.isValid(bidderId)) {
        const bidder = await User.findById(bidderId);
        if (bidder) validBidderIds.push(bidder._id);
      } else {
        return res.status(400).json({
          error: 'Invalid bidder',
          message: 'Only authenticated users can be selected as Platinum Bidders'
        });
      }
    }

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

    const now = new Date();
    // Private room ends 60 seconds after last bid; seller starts it, so first end is 60s from now
    const PRIVATE_ROOM_EXTEND_MS = 60 * 1000;
    const privateRoomEndDate = new Date(now.getTime() + PRIVATE_ROOM_EXTEND_MS);
    const platinumBidderAcceptanceDeadline = new Date(now.getTime() + ACCEPTANCE_WINDOW_MS);

    const platinumBidderInvitations = validBidderIds.map((bidderId) => ({
      bidder: bidderId,
      status: 'pending',
      invitedAt: now,
      invitationToken: crypto.randomBytes(16).toString('hex')
    }));

    await Listing.findByIdAndUpdate(listingId, {
      $set: {
        platinumBidders: validBidderIds,
        platinumBidderInvitations,
        platinumBidderInvitedAt: now,
        platinumBidderAcceptanceDeadline,
        status: 'active',
        privateRoomStatus: 'active',
        privateRoomEndDate,
        privateRoomLastBidTime: now,
        endDate: privateRoomEndDate,
        winnerSelectionDeadline: null
      }
    }, { runValidators: false });

    const updatedListing = await Listing.findById(listingId)
      .populate('seller')
      .populate('platinumBidderInvitations.bidder', 'email firstName lastName');
    if (!updatedListing) return res.status(500).json({ error: 'Listing not found after update' });

    await sendPlatinumBidderInvitations(updatedListing);
    await sendPrivateRoomNotInvitedToBidders(updatedListing, validBidderIds);

    res.json({
      success: true,
      message: 'Platinum Bidders selected successfully. Invitations and notifications have been sent.',
      platinumBidders: validBidderIds,
      listing: {
        id: updatedListing._id,
        status: updatedListing.status,
        privateRoomStatus: updatedListing.privateRoomStatus,
        privateRoomEndDate: updatedListing.privateRoomEndDate,
        platinumBidders: updatedListing.platinumBidders,
        platinumBidderInvitedAt: updatedListing.platinumBidderInvitedAt
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

// Check if current user is a platinum bidder for a listing (must have accepted invitation within 30 min)
router.get('/listings/:id/check-platinum', authenticateToken, async (req, res) => {
  try {
    const listingId = req.params.id;
    const listing = await Listing.findById(listingId)
      .select('platinumBidders platinumBidderInvitations platinumBidderAcceptanceDeadline')
      .populate('platinumBidderInvitations.bidder', '_id');
    
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.json({ isPlatinumBidder: false });
    }

    const isInPlatinumBidders = listing.platinumBidders && listing.platinumBidders.some(
      pbId => pbId.toString() === user._id.toString()
    );
    if (!isInPlatinumBidders) {
      return res.json({ isPlatinumBidder: false });
    }

    const now = new Date();
    const invitations = listing.platinumBidderInvitations || [];
    const invitation = invitations.find(
      inv => inv.bidder && inv.bidder._id.toString() === user._id.toString()
    );

    if (!invitation) {
      return res.json({ isPlatinumBidder: true });
    }
    if (invitation.status === 'accepted') {
      return res.json({ isPlatinumBidder: true });
    }
    if (invitation.status === 'declined') {
      return res.json({ isPlatinumBidder: false });
    }
    if (listing.platinumBidderAcceptanceDeadline && now > new Date(listing.platinumBidderAcceptanceDeadline)) {
      return res.json({ isPlatinumBidder: false });
    }
    return res.json({ isPlatinumBidder: false, invitationPending: true });
  } catch (error) {
    console.error('Error checking platinum bidder status:', error);
    res.status(500).json({ 
      error: 'Failed to check platinum bidder status',
      message: error.message 
    });
  }
});

// Accept private room invitation (link in email; no auth required)
router.post('/invitation/accept', async (req, res) => {
  try {
    const { token, listingId } = req.body || {};
    if (!token || !listingId) {
      return res.status(400).json({ error: 'Missing token or listingId', message: 'Invalid invitation link.' });
    }
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found', message: 'This invitation is no longer valid.' });
    }
    const invitation = (listing.platinumBidderInvitations || []).find(
      inv => inv.invitationToken === token
    );
    if (!invitation) {
      return res.status(400).json({ error: 'Invalid token', message: 'This invitation link is invalid or has already been used.' });
    }
    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: 'Already processed', message: 'This invitation has already been accepted or declined.' });
    }
    const now = new Date();
    if (listing.platinumBidderAcceptanceDeadline && now > new Date(listing.platinumBidderAcceptanceDeadline)) {
      return res.status(400).json({ error: 'Deadline passed', message: 'The 30 minute window to accept has passed. You have lost your seat in this private room.' });
    }
    const invIndex = listing.platinumBidderInvitations.findIndex(inv => inv.invitationToken === token);
    listing.platinumBidderInvitations[invIndex].status = 'accepted';
    listing.platinumBidderInvitations[invIndex].acceptedAt = now;
    await listing.save();
    return res.json({ success: true, message: 'Invitation accepted. You can now place bids in the private room.', listingId });
  } catch (error) {
    console.error('Error accepting invitation:', error);
    res.status(500).json({ error: 'Failed to accept invitation', message: error.message });
  }
});

// Decline private room invitation
router.post('/invitation/decline', async (req, res) => {
  try {
    const { token, listingId } = req.body || {};
    if (!token || !listingId) {
      return res.status(400).json({ error: 'Missing token or listingId', message: 'Invalid invitation link.' });
    }
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found', message: 'This invitation is no longer valid.' });
    }
    const invitation = (listing.platinumBidderInvitations || []).find(
      inv => inv.invitationToken === token
    );
    if (!invitation) {
      return res.status(400).json({ error: 'Invalid token', message: 'This invitation link is invalid or has already been used.' });
    }
    if (invitation.status !== 'pending') {
      return res.status(200).json({ success: true, message: 'Invitation was already processed.' });
    }
    const invIndex = listing.platinumBidderInvitations.findIndex(inv => inv.invitationToken === token);
    listing.platinumBidderInvitations[invIndex].status = 'declined';
    await listing.save();
    return res.json({ success: true, message: 'Invitation declined.', listingId });
  } catch (error) {
    console.error('Error declining invitation:', error);
    res.status(500).json({ error: 'Failed to decline invitation', message: error.message });
  }
});

module.exports = router;
