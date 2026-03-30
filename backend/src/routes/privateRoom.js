const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const User = require('../models/User');
const { sendPlatinumBidderInvitations, sendPrivateRoomNotInvitedToBidders, handleSellerLeftPrivateRoom } = require('../services/auctionNotificationService');
const { notifyPrivateRoomInvitation, notifyPrivateRoomAccepted, notifyPrivateRoomDeclined, emitNewNotificationToUser } = require('../services/notificationService');
const { isPrivateRoomEligible } = require('../services/reputationService');
const { getReviewScoresForUsers } = require('../services/reviewService');

const router = express.Router();
const ACCEPTANCE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes to accept; after that the room starts automatically

/** Viewers join `private-room:${id}`; bidding clients also join `listing:${id}`. Emit to both so live updates reach everyone. */
function emitToListingAndPrivateRoom(io, listingId, event, payload) {
  if (!io) return;
  const id = listingId.toString();
  io.to(`listing:${id}`).emit(event, payload);
  io.to(`private-room:${id}`).emit(event, payload);
}

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

    // Get all bids for this listing (include reputation for Private Room eligibility)
    const bids = await Bid.find({ listing: listingId })
      .populate('bidder', 'firstName lastName email emailVerified hasDeposit reputationScore disputeLossCount')
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
            reputationScore: bid.bidder.reputationScore ?? 100,
            privateRoomEligible: isPrivateRoomEligible(bid.bidder),
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

    let biddersList = Array.from(uniqueBidders.values()).sort((a, b) => b.highestBid - a.highestBid);

    // Add reputation and Private Room eligibility for authenticated bidders
    const bidderUserIds = biddersList.filter(b => b._id).map(b => b._id.toString());
    const [reputationMap, scoreMap] = bidderUserIds.length > 0
      ? await Promise.all([
          User.find({ _id: { $in: bidderUserIds } }).select('reputationScore disputeLossCount depositAmount hasDeposit').lean().then(users => {
            const m = {};
            users.forEach(u => { m[u._id.toString()] = u; });
            return m;
          }),
          getReviewScoresForUsers(bidderUserIds)
        ])
      : [{}, {}];

    biddersList = biddersList.map(b => {
      const u = b._id ? reputationMap[b._id.toString()] : null;
      const eligible = u ? isPrivateRoomEligible(u) : false;
      return { ...b, reputationScore: u?.reputationScore ?? 100, privateRoomEligible: eligible };
    });

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
router.post('/listings/:id/platinum-bidders', authenticateToken, requireActiveAccount, async (req, res) => {
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
          message: 'The 15-minute window to create the private room has passed. You can no longer create a private room for this listing.'
        });
      }
    }

    const validBidderIds = [];
    const ineligibleBidders = [];
    for (const bidderId of bidderIds) {
      if (mongoose.Types.ObjectId.isValid(bidderId)) {
        const bidder = await User.findById(bidderId)
          .select('firstName lastName reputationScore disputeLossCount');
        if (bidder) {
          if (!isPrivateRoomEligible(bidder)) {
            ineligibleBidders.push(`${bidder.firstName} ${bidder.lastName}`);
          } else {
            validBidderIds.push(bidder._id);
          }
        }
      } else {
        return res.status(400).json({
          error: 'Invalid bidder',
          message: 'Only authenticated users can be selected as Platinum Bidders'
        });
      }
    }
    if (ineligibleBidders.length > 0) {
      return res.status(400).json({
        error: 'Ineligible bidders',
        message: `The following bidders are not eligible for Private Rooms (reputation or dispute history): ${ineligibleBidders.join(', ')}. Only users with a reputation score of 60+ and no dispute losses can participate.`
      });
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
    const platinumBidderAcceptanceDeadline = new Date(now.getTime() + ACCEPTANCE_WINDOW_MS);

    const platinumBidderInvitations = validBidderIds.map((bidderId) => ({
      bidder: bidderId,
      status: 'pending',
      invitedAt: now,
      invitationToken: crypto.randomBytes(16).toString('hex')
    }));

    // Room stays 'invited' until 15 min pass; scheduler will set 'active' and privateRoomEndDate then
    await Listing.findByIdAndUpdate(listingId, {
      $set: {
        platinumBidders: validBidderIds,
        platinumBidderInvitations,
        platinumBidderInvitedAt: now,
        platinumBidderAcceptanceDeadline,
        status: 'active',
        privateRoomStatus: 'invited',
        winnerSelectionDeadline: null
      }
    }, { runValidators: false });

    const updatedListing = await Listing.findById(listingId)
      .populate('seller')
      .populate('platinumBidderInvitations.bidder', 'email firstName lastName');
    if (!updatedListing) return res.status(500).json({ error: 'Listing not found after update' });

    await sendPlatinumBidderInvitations(updatedListing, req.headers['origin'] || null);
    await sendPrivateRoomNotInvitedToBidders(updatedListing, validBidderIds);

    const io = req.app.get('io');
    const listingSlug = updatedListing.slug || null;
    const listingTitle = updatedListing.title || 'an auction';
    for (const bidderId of validBidderIds) {
      const bidderUserId = bidderId.toString?.() || bidderId;
      notifyPrivateRoomInvitation({ listingId, listingSlug, listingTitle, bidderUserId }).catch(err =>
        console.error('Failed to create private room invitation notification:', err)
      );
      if (io) emitNewNotificationToUser(io, bidderUserId).catch(() => {});
    }

    res.json({
      success: true,
      message: 'Platinum Bidders selected successfully. Invitations and notifications have been sent.',
      platinumBidders: validBidderIds,
      listing: {
        id: updatedListing._id,
        status: updatedListing.status,
        privateRoomStatus: updatedListing.privateRoomStatus,
        platinumBidders: updatedListing.platinumBidders,
        platinumBidderInvitedAt: updatedListing.platinumBidderInvitedAt,
        platinumBidderAcceptanceDeadline: updatedListing.platinumBidderAcceptanceDeadline
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

// Start private room now (seller only, bypass 15-minute acceptance window)
router.post('/listings/:id/start-now', authenticateToken, async (req, res) => {
  try {
    const listingId = req.params.id;
    const listing = await Listing.findById(listingId).populate('seller');

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user || listing.seller._id.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the seller can start the room' });
    }

    if (listing.privateRoomStatus !== 'invited') {
      return res.status(400).json({
        error: 'Cannot start',
        message: 'The room can only be started when it is in the invitation phase. It may already be active or ended.'
      });
    }

    const now = new Date();
    const PRIVATE_ROOM_EXTEND_MS = 60 * 1000; // 60 seconds per bid
    const roomEndDate = new Date(now.getTime() + PRIVATE_ROOM_EXTEND_MS);

    await Listing.findByIdAndUpdate(listingId, {
      $set: {
        status: 'active',
        privateRoomStatus: 'active',
        privateRoomEndDate: roomEndDate,
        privateRoomLastBidTime: now,
        endDate: roomEndDate
      }
    }, { runValidators: false });

    const io = req.app.get('io');
    emitToListingAndPrivateRoom(io, listingId, 'listing-update', {
      listingId: listingId.toString(),
      status: 'active',
      privateRoomStatus: 'active',
      privateRoomEndDate: roomEndDate.toISOString(),
      endDate: roomEndDate.toISOString(),
      currentPrice: listing.currentPrice,
      bidCount: listing.bidCount || 0
    });

    const updated = await Listing.findById(listingId).populate('seller', 'firstName lastName email');
    res.json({
      success: true,
      message: 'Private room started',
      listing: {
        id: updated._id,
        status: updated.status,
        privateRoomStatus: updated.privateRoomStatus,
        privateRoomEndDate: updated.privateRoomEndDate,
        endDate: updated.endDate
      }
    });
  } catch (error) {
    console.error('Error starting private room:', error);
    res.status(500).json({
      error: 'Failed to start room',
      message: error.message
    });
  }
});

// Seller leaves private room – closes room, notifies buyers, logs for audit
router.post('/listings/:id/seller-leave', authenticateToken, async (req, res) => {
  try {
    const listingId = req.params.id;
    const listing = await Listing.findById(listingId).populate('seller');

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user || listing.seller._id.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden', message: 'Only the seller can leave the private room' });
    }

    if (listing.privateRoomStatus !== 'active' && listing.privateRoomStatus !== 'invited') {
      return res.status(400).json({
        error: 'Room not active',
        message: 'The private room is not in a state that can be closed by leaving. It may have already ended.'
      });
    }

    const io = req.app.get('io');
    const result = await handleSellerLeftPrivateRoom(listingId, req.user.uid, io);

    if (!result.processed) {
      return res.status(400).json({
        error: 'Cannot close',
        message: 'The private room could not be closed. It may have already ended.'
      });
    }

    res.json({
      success: true,
      message: 'You have left the private room. The auction has been closed and all participants have been notified.'
    });
  } catch (error) {
    console.error('Error in seller-leave:', error);
    res.status(500).json({
      error: 'Failed to leave private room',
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
    const listing = await Listing.findById(listingId)
      .populate('seller', '_id')
      .populate('platinumBidderInvitations.bidder', 'firstName lastName');
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
    const deadline = listing.platinumBidderAcceptanceDeadline ? new Date(listing.platinumBidderAcceptanceDeadline) : null;
    if (deadline && now >= deadline) {
      return res.status(400).json({
        error: 'Invitation expired',
        message: 'This invitation has expired. The 15-minute acceptance window has closed.',
        expiredAt: deadline.toISOString()
      });
    }
    const invIndex = listing.platinumBidderInvitations.findIndex(inv => inv.invitationToken === token);
    listing.platinumBidderInvitations[invIndex].status = 'accepted';
    listing.platinumBidderInvitations[invIndex].acceptedAt = now;
    await listing.save();

    const sellerUserId = listing.seller?._id?.toString?.() || listing.seller?.toString?.();
    const bidder = invitation.bidder;
    const bidderName = bidder ? `${bidder.firstName || ''} ${bidder.lastName || ''}`.trim() : 'A bidder';
    const io = req.app.get('io');

    // If all invitations are now accepted, compress the acceptance deadline to 1 minute
    const allInvitations = listing.platinumBidderInvitations || [];
    const pendingAfter = allInvitations.filter(inv => inv.status === 'pending').length;
    if (pendingAfter === 0 && allInvitations.length > 0) {
      const acceleratedDeadline = new Date(Date.now() + 60 * 1000);
      await Listing.findByIdAndUpdate(
        listingId,
        { $set: { platinumBidderAcceptanceDeadline: acceleratedDeadline } },
        { runValidators: false }
      );
      emitToListingAndPrivateRoom(io, listingId, 'listing-update', {
        listingId: listingId.toString(),
        platinumBidderAcceptanceDeadline: acceleratedDeadline.toISOString(),
        allAccepted: true
      });
    }

    if (sellerUserId) {
      notifyPrivateRoomAccepted({
        listingSlug: listing.slug || null,
        listingTitle: listing.title || 'your listing',
        bidderName,
        sellerUserId
      }).catch(err => console.error('Failed to create private room accepted notification:', err));
      if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
    }
    // Emit to everyone in the private room so the poker table updates live
    emitToListingAndPrivateRoom(io, listingId, 'invitation-accepted', {
      listingId: listingId.toString(),
      bidderId: bidder?._id?.toString?.() || null,
      bidderName,
      bidderFirstName: bidder?.firstName || '',
      bidderLastName: bidder?.lastName || ''
    });
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
    const listing = await Listing.findById(listingId)
      .populate('seller', '_id')
      .populate('platinumBidderInvitations.bidder', 'firstName lastName');
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

    const io = req.app.get('io');
    const declinedBidderId = invitation.bidder?._id?.toString?.() || invitation.bidder?.toString?.() || null;
    emitToListingAndPrivateRoom(io, listingId, 'invitation-declined', {
      listingId: listingId.toString(),
      bidderId: declinedBidderId
    });

    const sellerUserId = listing.seller?._id?.toString?.() || listing.seller?.toString?.();
    const bidder = invitation.bidder;
    const bidderName = bidder ? `${bidder.firstName || ''} ${bidder.lastName || ''}`.trim() : 'A bidder';
    if (sellerUserId) {
      notifyPrivateRoomDeclined({
        listingSlug: listing.slug || null,
        listingTitle: listing.title || 'your listing',
        bidderName,
        sellerUserId
      }).catch(err => console.error('Failed to create private room declined notification:', err));
      if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
    }
    return res.json({ success: true, message: 'Invitation declined.', listingId });
  } catch (error) {
    console.error('Error declining invitation:', error);
    res.status(500).json({ error: 'Failed to decline invitation', message: error.message });
  }
});

module.exports = router;
