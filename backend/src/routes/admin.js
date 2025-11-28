const express = require('express');
const crypto = require('crypto');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../services/templateEngine');

const router = express.Router();

const ADMIN_EMAIL = 'josevcandido@gmail.com';

// Admin middleware - checks if user is the admin
const requireAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Check if user email matches admin email
  if (req.user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }
  
  next();
};

// Get platform statistics
router.get('/statistics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    // Get total registered users (excluding soft-deleted or inactive if needed)
    const totalUsers = await User.countDocuments({ isActive: true });

    // Get total auctions (all statuses except draft)
    const totalAuctions = await Listing.countDocuments({ 
      status: { $in: ['active', 'ended', 'cancelled'] } 
    });

    // Get active auctions (status = 'active' and endDate > now)
    const now = new Date();
    const activeAuctions = await Listing.countDocuments({
      status: 'active',
      endDate: { $gt: now }
    });

    res.json({
      totalUsers,
      totalAuctions,
      activeAuctions
    });
  } catch (error) {
    console.error('Error fetching admin statistics:', error);
    res.status(500).json({ 
      error: 'Failed to fetch statistics',
      message: error.message 
    });
  }
});

// Get all auctions for admin
router.get('/auctions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const auctions = await Listing.find({})
      .populate('seller', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .lean();

    res.json(auctions);
  } catch (error) {
    console.error('Error fetching auctions:', error);
    res.status(500).json({ 
      error: 'Failed to fetch auctions',
      message: error.message 
    });
  }
});

// Get single auction by ID for admin
router.get('/auctions/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const auction = await Listing.findById(req.params.id)
      .populate('seller', 'firstName lastName email')
      .populate('platinumBidders', 'firstName lastName email')
      .lean();

    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    res.json(auction);
  } catch (error) {
    console.error('Error fetching auction:', error);
    res.status(500).json({ 
      error: 'Failed to fetch auction',
      message: error.message 
    });
  }
});

// Create private auction room for a listing
router.post('/auctions/:id/private-room', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const listingId = req.params.id;
    const { platinumBidderIds } = req.body;
    
    if (!platinumBidderIds || !Array.isArray(platinumBidderIds) || platinumBidderIds.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid input',
        message: 'Please select at least one Platinum Bidder' 
      });
    }

    if (platinumBidderIds.length > 5) {
      return res.status(400).json({ 
        error: 'Invalid input',
        message: 'You can select a maximum of 5 Platinum Bidders' 
      });
    }

    const listing = await Listing.findById(listingId).populate('seller', 'firstName lastName email');
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Check if private room already exists
    if (listing.privateRoomStatus === 'active') {
      return res.status(400).json({ 
        error: 'Private room already active',
        message: 'This listing already has an active private auction room' 
      });
    }

    // Validate that all selected bidders are valid users
    const validBidders = await User.find({ 
      _id: { $in: platinumBidderIds } 
    }).select('_id firstName lastName email emailVerified');
    
    if (validBidders.length !== platinumBidderIds.length) {
      return res.status(400).json({ 
        error: 'Invalid bidders',
        message: 'One or more selected bidders are invalid' 
      });
    }

    // Generate invitation tokens and create invitations
    const invitations = platinumBidderIds.map(bidderId => {
      const invitationToken = crypto.randomBytes(32).toString('hex');
      return {
        bidder: bidderId,
        status: 'pending',
        invitedAt: new Date(),
        invitationToken
      };
    });

    // Set platinum bidders and invitations
    listing.platinumBidders = platinumBidderIds;
    listing.platinumBidderInvitations = invitations;
    listing.platinumBidderInvitedAt = new Date();

    // Set private room status to 'eligible' (will become 'active' after acceptance window)
    // Note: If auction hasn't ended yet, invitations will be sent but private room won't start until auction ends
    // The 5-minute acceptance window starts when the auction ends
    const now = new Date();
    const privateRoomEndDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

    listing.privateRoomStatus = 'eligible';
    listing.privateRoomEndDate = privateRoomEndDate;
    listing.privateRoomLastBidTime = null;
    
    // Only update endDate if auction hasn't ended yet
    if (listing.status === 'active' && listing.endDate > now) {
      // Auction still active - extend it
      listing.endDate = privateRoomEndDate;
    }
    
    // If auction was ended/cancelled, reactivate it for the private room
    if (listing.status === 'ended' || listing.status === 'cancelled') {
      listing.status = 'active';
    }

    await listing.save();

    // Send invitation emails to all selected bidders
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    
    for (const bidder of validBidders) {
      try {
        const invitation = invitations.find(inv => inv.bidder.toString() === bidder._id.toString());
        if (!invitation) continue;

        const acceptUrl = `${frontendUrl}/private-room/invitation/accept?token=${invitation.invitationToken}&listingId=${listingId}&action=accept`;
        const declineUrl = `${frontendUrl}/private-room/invitation/decline?token=${invitation.invitationToken}&listingId=${listingId}&action=decline`;

        const emailData = {
          bidderName: `${bidder.firstName} ${bidder.lastName}`,
          listingTitle: listing.title,
          listingUrl: `${frontendUrl}/listing/${listing.slug}`,
          acceptUrl,
          declineUrl,
          currentPrice: listing.currentPrice,
          endDate: privateRoomEndDate.toLocaleString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        };

        // Try to get email template (create if it doesn't exist)
        let emailContent;
        try {
          emailContent = renderEmailTemplate('platinumBidderInvitation', 'en', emailData);
        } catch (templateError) {
          // Fallback email if template doesn't exist
          emailContent = {
            subject: `🎯 You're Invited to a Private Auction Room: ${listing.title}`,
            html: `
              <h2>Private Auction Room Invitation</h2>
              <p>Hello ${bidder.firstName},</p>
              <p>You have been selected as a Platinum Bidder for the private auction room of:</p>
              <h3>${listing.title}</h3>
              <p><strong>Current Price:</strong> $${listing.currentPrice.toFixed(2)}</p>
              <p><strong>Private Room Ends:</strong> ${emailData.endDate}</p>
              <p>Only Platinum Bidders can place bids in this exclusive auction room. Each bid extends the deadline by 30 seconds.</p>
              <p><a href="${acceptUrl}">Accept Invitation</a> | <a href="${declineUrl}">Decline</a></p>
              <p>You must accept this invitation to participate in the private room.</p>
            `
          };
        }

        await sendEmail(bidder.email, emailContent.subject, emailContent.html);
        console.log(`📧 Invitation sent to ${bidder.email}`);
      } catch (emailError) {
        console.error(`Failed to send invitation to ${bidder.email}:`, emailError);
        // Continue with other invitations even if one fails
      }
    }

    // Emit socket event if available
    const io = req.app.get('io');
    if (io) {
      io.to(`listing:${listingId}`).emit('listing-updated', {
        listingId: listing._id.toString(),
        privateRoomStatus: listing.privateRoomStatus,
        privateRoomEndDate: listing.privateRoomEndDate,
        endDate: listing.endDate
      });
    }

    res.json({
      success: true,
      message: 'Private auction room created and invitations sent successfully',
      listing: {
        id: listing._id,
        privateRoomStatus: listing.privateRoomStatus,
        privateRoomEndDate: listing.privateRoomEndDate,
        endDate: listing.endDate
      },
      invitationsSent: validBidders.length
    });
  } catch (error) {
    console.error('Error creating private room:', error);
    res.status(500).json({ 
      error: 'Failed to create private room',
      message: error.message 
    });
  }
});

// Close private room and end auction
router.post('/auctions/:id/close-private-room', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const listingId = req.params.id;
    
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Check if private room is active or eligible
    if (listing.privateRoomStatus !== 'active' && listing.privateRoomStatus !== 'eligible') {
      return res.status(400).json({ 
        error: 'Invalid operation',
        message: 'Private room is not active or eligible to be closed' 
      });
    }

    // Check if auction is already ended
    if (listing.status === 'ended') {
      return res.status(400).json({ 
        error: 'Auction already ended',
        message: 'This auction has already been ended' 
      });
    }

    // Import auction notification service first to send notifications
    const auctionNotificationService = require('../services/auctionNotificationService');
    
    // Get highest bid before ending (needed for notifications)
    const Bid = require('../models/Bid');
    const highestBid = await Bid.findOne({ listing: listingId })
      .sort({ amount: -1 })
      .populate('bidder', 'firstName lastName email')
      .lean();

    // Close private room and end auction
    listing.privateRoomStatus = 'ended';
    listing.status = 'ended';
    const now = new Date();
    listing.endDate = now; // Set end date to now
    
    // Set winner selection deadline (24 hours from now)
    const deadline = new Date(now);
    deadline.setHours(deadline.getHours() + 24);
    listing.winnerSelectionDeadline = deadline;

    await listing.save();

    // Send auction end notifications
    try {
      if (highestBid) {
        await auctionNotificationService.sendAuctionClosedNotifications(listing, highestBid._id);
      } else {
        await auctionNotificationService.sendAuctionClosedNotifications(listing);
      }
      
      // Send notification to seller to choose winner
      await auctionNotificationService.sendChooseWinnerNotification(listing);
      
      console.log(`✅ Auction end notifications sent for listing: ${listingId}`);
    } catch (notificationError) {
      console.error('Error sending auction end notifications:', notificationError);
      // Don't fail the request if notifications fail
    }

    // Emit socket event if available
    const io = req.app.get('io');
    if (io) {
      io.to(`listing:${listingId}`).emit('listing-updated', {
        listingId: listing._id.toString(),
        privateRoomStatus: listing.privateRoomStatus,
        status: listing.status,
        endDate: listing.endDate
      });
    }

    res.json({
      success: true,
      message: 'Private room closed and auction ended successfully',
      listing: {
        id: listing._id,
        privateRoomStatus: listing.privateRoomStatus,
        status: listing.status,
        endDate: listing.endDate
      }
    });
  } catch (error) {
    console.error('Error closing private room and ending auction:', error);
    res.status(500).json({ 
      error: 'Failed to close private room and end auction',
      message: error.message 
    });
  }
});

module.exports = router;

