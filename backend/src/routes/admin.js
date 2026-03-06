const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const ReviewFlag = require('../models/ReviewFlag');
const Review = require('../models/Review');
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../services/templateEngine');
const { notifyDisputeDecisionIssued, emitNewNotificationToUser } = require('../services/notificationService');
const { applyDisputeAccountOutcome } = require('../services/accountStatusService');
const { applyDisputeVerdictImpact } = require('../services/reputationService');

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

    // Set platinum bidders (no acceptance required - room is active immediately)
    listing.platinumBidders = platinumBidderIds;
    listing.platinumBidderInvitedAt = new Date();

    const now = new Date();
    const privateRoomEndDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

    listing.privateRoomStatus = 'active';
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

    // Send notification emails to all platinum bidders (no accept/decline - they can join immediately)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;

    for (const bidder of validBidders) {
      try {
        const emailData = {
          bidderName: `${bidder.firstName} ${bidder.lastName}`,
          listingTitle: listing.title,
          listingUrl,
          currentPrice: listing.currentPrice,
          endDate: privateRoomEndDate.toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        };

        let emailContent;
        try {
          emailContent = renderEmailTemplate('platinumBidderInvitation', 'en', emailData);
        } catch (templateError) {
          emailContent = {
            subject: `🎯 You're in the Private Auction Room: ${listing.title}`,
            html: `
              <h2>Private Auction Room</h2>
              <p>Hello ${bidder.firstName},</p>
              <p>You have been selected as a Platinum Bidder for the private auction room of:</p>
              <h3>${listing.title}</h3>
              <p><strong>Current Price:</strong> $${listing.currentPrice.toFixed(2)}</p>
              <p><strong>Private Room Ends:</strong> ${emailData.endDate}</p>
              <p>You can place bids now. Each bid extends the deadline by 30 seconds.</p>
              <p><a href="${listingUrl}">Join the Private Room</a></p>
            `
          };
        }

        await sendEmail(bidder.email, emailContent.subject, emailContent.html);
        console.log(`📧 Notification sent to ${bidder.email}`);
      } catch (emailError) {
        console.error(`Failed to send notification to ${bidder.email}:`, emailError);
      }
    }

    // Emit socket event if available
    const io = req.app.get('io');
    if (io) {
      io.to(`listing:${listingId}`).emit('listing-update', {
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

/**
 * GET /api/admin/disputes
 * List all open disputes, sorted by time since opened (oldest first for prioritization).
 */
router.get('/disputes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const disputes = await Transaction.find({
      disputeOpen: true,
      disputeAdminVerdict: null
    })
      .populate('listing', 'title slug images')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .sort({ disputeOpenedAt: 1 })
      .lean();

    const withAge = disputes.map((d) => {
      const openedAt = d.disputeOpenedAt ? new Date(d.disputeOpenedAt) : null;
      const ageMs = openedAt ? Date.now() - openedAt.getTime() : 0;
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      const ageDays = Math.floor(ageHours / 24);
      return {
        ...d,
        disputeAgeHours: ageHours,
        disputeAgeDays: ageDays
      };
    });

    res.json({ disputes: withAge });
  } catch (error) {
    console.error('Error fetching disputes:', error);
    res.status(500).json({
      error: 'Failed to fetch disputes',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/disputes/:transactionId
 * Get full dispute details for a transaction.
 */
router.get('/disputes/:transactionId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('listing', 'title slug images description')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (!transaction.disputeOpen) {
      return res.status(400).json({ error: 'Not a dispute', message: 'This transaction does not have an open dispute.' });
    }

    res.json(transaction);
  } catch (error) {
    console.error('Error fetching dispute:', error);
    res.status(500).json({
      error: 'Failed to fetch dispute',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/disputes/:transactionId/ruling
 * Issue final ruling: buyer_refund | seller_payout | partial_refund.
 * Body: { verdict, refundAmount?, adminNotes }
 */
router.post('/disputes/:transactionId/ruling', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { verdict, refundAmount, adminNotes, accountOutcome } = req.body;

    const validVerdicts = ['buyer_refund', 'seller_payout', 'partial_refund'];
    if (!verdict || !validVerdicts.includes(verdict)) {
      return res.status(400).json({
        error: 'Invalid verdict',
        message: 'Verdict must be one of: buyer_refund, seller_payout, partial_refund'
      });
    }

    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('seller', '_id')
      .populate('buyer', '_id');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (!transaction.disputeOpen || transaction.disputeAdminVerdict) {
      return res.status(400).json({
        error: 'Invalid state',
        message: 'No open dispute or dispute has already been ruled on.'
      });
    }

    let resolvedRefundAmount = null;
    if (verdict === 'buyer_refund') {
      resolvedRefundAmount = transaction.amount;
    } else if (verdict === 'partial_refund') {
      const amt = typeof refundAmount === 'number' ? refundAmount : parseFloat(refundAmount);
      if (Number.isNaN(amt) || amt < 0 || amt > transaction.amount) {
        return res.status(400).json({
          error: 'Invalid refund amount',
          message: `Refund amount must be between 0 and ${transaction.amount}`
        });
      }
      resolvedRefundAmount = amt;
    }

    transaction.disputeAdminVerdict = verdict;
    transaction.disputeRefundAmount = resolvedRefundAmount;
    transaction.disputeRuledAt = new Date();
    if (adminNotes != null) transaction.disputeAdminNotes = String(adminNotes).trim() || null;
    transaction.transactionStatus = 'completed';
    transaction.disputeOpen = false;
    await transaction.save();

    const listing = await Listing.findById(transaction.listing).select('title').lean();
    const listingTitle = listing?.title || 'the transaction';
    const sellerUserId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
    const buyerUserId = transaction.buyer?._id?.toString?.() || transaction.buyer?.toString?.();
    if (sellerUserId) {
      notifyDisputeDecisionIssued({ transactionId: transaction._id.toString(), listingTitle, verdict, userId: sellerUserId })
        .catch(err => console.error('Failed to create dispute decision notification:', err));
    }
    if (buyerUserId) {
      notifyDisputeDecisionIssued({ transactionId: transaction._id.toString(), listingTitle, verdict, userId: buyerUserId })
        .catch(err => console.error('Failed to create dispute decision notification:', err));
    }
    const io = req.app.get('io');
    if (io) {
      if (sellerUserId) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
      if (buyerUserId) emitNewNotificationToUser(io, buyerUserId).catch(() => {});
    }

    // Apply account outcome: reactivate both, reactivate one and close the other, or close both
    const validAccountOutcomes = ['reactivate_both', 'reactivate_buyer_close_seller', 'reactivate_seller_close_buyer', 'close_both'];
    if (accountOutcome && validAccountOutcomes.includes(accountOutcome) && buyerUserId && sellerUserId) {
      await applyDisputeAccountOutcome(accountOutcome, buyerUserId, sellerUserId, transaction._id, io);
    }

    // Reputation impact: increment disputeLossCount for party ruled against
    applyDisputeVerdictImpact(verdict, buyerUserId, sellerUserId).catch(err =>
      console.error('Dispute verdict reputation impact:', err.message)
    );

    /** TODO: Financial adjustments - deduct from seller balance or charge card when buyer_refund/partial_refund */
    /** TODO: Reputation score adjustment based on verdict (e.g. negative for seller on buyer_refund) */

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    res.json({
      success: true,
      message: 'Dispute ruling applied successfully',
      transaction: updated
    });
  } catch (error) {
    console.error('Error issuing dispute ruling:', error);
    res.status(500).json({
      error: 'Failed to issue ruling',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/reviews/flagged
 * List reviews flagged for potential fraud/abuse (pending admin review).
 */
router.get('/reviews/flagged', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const flags = await ReviewFlag.find({ status: 'pending' })
      .populate('review')
      .sort({ createdAt: -1 })
      .lean();
    const withReviewDetails = await Promise.all(
      flags.map(async (f) => {
        const r = f.review;
        if (!r) return { ...f, reviewer: null, reviewee: null, listing: null };
        const [reviewer, reviewee, listing] = await Promise.all([
          User.findById(r.reviewer).select('firstName lastName email').lean(),
          User.findById(r.reviewee).select('firstName lastName email').lean(),
          Listing.findById(r.listing).select('title slug').lean()
        ]);
        return { ...f, reviewer, reviewee, listing };
      })
    );
    res.json({ flags: withReviewDetails });
  } catch (error) {
    console.error('Error fetching flagged reviews:', error);
    res.status(500).json({ error: 'Failed to fetch flagged reviews', message: error.message });
  }
});

/**
 * PATCH /api/admin/reviews/flags/:id
 * Resolve a review flag: dismissed | confirmed_fake.
 * Body: { status, adminNotes? }
 */
router.patch('/reviews/flags/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    if (!status || !['dismissed', 'confirmed_fake'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'status must be dismissed or confirmed_fake'
      });
    }
    const flag = await ReviewFlag.findById(req.params.id);
    if (!flag) return res.status(404).json({ error: 'Flag not found' });
    if (flag.status !== 'pending') {
      return res.status(400).json({ error: 'Already resolved', message: 'This flag has already been resolved.' });
    }
    flag.status = status;
    flag.resolvedAt = new Date();
    flag.resolvedBy = req.user?.email || 'admin';
    if (adminNotes != null) flag.adminNotes = String(adminNotes).trim() || null;
    await flag.save();
    res.json({ success: true, flag });
  } catch (error) {
    console.error('Error resolving review flag:', error);
    res.status(500).json({ error: 'Failed to resolve flag', message: error.message });
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
      io.to(`listing:${listingId}`).emit('listing-update', {
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

