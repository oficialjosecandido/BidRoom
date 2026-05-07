const express = require('express');
const Stripe = require('stripe');
const mongoose = require('mongoose');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const ReviewFlag = require('../models/ReviewFlag');
const Review = require('../models/Review');
const ReviewAppeal = require('../models/ReviewAppeal');
const Report = require('../models/Report');
const ModerationAuditLog = require('../models/ModerationAuditLog');
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../services/templateEngine');
const { notifyDisputeDecisionIssued, notifyDamageClaimResolved, emitNewNotificationToUser } = require('../services/notificationService');
const DamageClaim = require('../models/DamageClaim');
const { applyDisputeAccountOutcome } = require('../services/accountStatusService');
const { applyDisputeVerdictImpact } = require('../services/reputationService');
const { appendModerationAudit } = require('../services/moderationAuditService');

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

const router = express.Router();

if (!process.env.ADMIN_EMAILS) {
  // Fail hard in production; warn loudly in development so developers notice immediately.
  const msg = 'ADMIN_EMAILS environment variable is not set. Admin routes will be disabled.';
  if (process.env.NODE_ENV === 'production') {
    throw new Error(msg);
  }
  console.error(`\n❌ SECURITY: ${msg}\n`);
}

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Admin middleware - checks if user is an admin
const requireAdmin = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!ADMIN_EMAILS.includes(req.user.email?.toLowerCase())) {
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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

// Get all auctions for admin
router.get('/auctions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [auctions, total] = await Promise.all([
      Listing.find({})
        .populate('seller', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Listing.countDocuments({})
    ]);

    res.json({ auctions, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching auctions:', error);
    res.status(500).json({
      error: 'Failed to fetch auctions',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Get single auction by ID for admin
router.get('/auctions/:id', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

// Create private auction room for a listing
router.post('/auctions/:id/private-room', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
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

    if (!platinumBidderIds.every(id => isValidObjectId(id))) {
      return res.status(400).json({ error: 'Invalid input', message: 'One or more bidder IDs are invalid' });
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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/admin/disputes/:transactionId
 * Get full dispute details for a transaction.
 */
router.get('/disputes/:transactionId', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.transactionId)) return res.status(400).json({ error: 'Invalid transaction ID' });
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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
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
    transaction.completedAt = transaction.completedAt || new Date();
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

    // Issue Stripe refund when verdict favours the buyer
    if (resolvedRefundAmount > 0 && transaction.stripePaymentIntentId) {
      try {
        const stripe = getStripe();
        if (stripe) {
          const refund = await stripe.refunds.create({
            payment_intent: transaction.stripePaymentIntentId,
            amount: Math.round(resolvedRefundAmount * 100), // cents
            reason: 'fraudulent',
            metadata: {
              transactionId: transaction._id.toString(),
              verdict,
              adminNotes: adminNotes || ''
            }
          });
          await Transaction.findByIdAndUpdate(transaction._id, { $set: { stripeRefundId: refund.id } }, { runValidators: false });
          console.log(`[Admin] Stripe refund issued refundId=${refund.id} amount=${resolvedRefundAmount} transaction=${transaction._id}`);
        }
      } catch (refundErr) {
        // Log but don't fail the ruling — admin can retry the Stripe refund manually
        console.error(`[Admin] Stripe refund failed transaction=${transaction._id}:`, refundErr.message);
      }
    }

    // Send refund emails to buyer and seller
    if (resolvedRefundAmount > 0) {
      try {
        const [buyerUser, sellerUser] = await Promise.all([
          User.findById(transaction.buyer).select('firstName lastName email').lean(),
          User.findById(transaction.seller).select('firstName lastName email').lean()
        ]);
        const listingForEmail = await Listing.findById(transaction.listing).select('title').lean();
        const listingTitle = listingForEmail?.title || 'your listing';
        const refundAmountFormatted = `$${resolvedRefundAmount.toFixed(2)}`;

        if (buyerUser?.email) {
          const buyerEmail = renderEmailTemplate('disputeRefundBuyer', 'en', {
            buyerName: `${buyerUser.firstName} ${buyerUser.lastName}`.trim(),
            listingTitle,
            refundAmount: refundAmountFormatted
          });
          await sendEmail(buyerUser.email, buyerEmail.subject, buyerEmail.html).catch(err =>
            console.error('[Admin] Failed to send dispute refund buyer email:', err.message)
          );
        }

        if (sellerUser?.email) {
          const sellerEmail = renderEmailTemplate('disputeRefundSeller', 'en', {
            sellerName: `${sellerUser.firstName} ${sellerUser.lastName}`.trim(),
            listingTitle,
            refundAmount: refundAmountFormatted
          });
          await sendEmail(sellerUser.email, sellerEmail.subject, sellerEmail.html).catch(err =>
            console.error('[Admin] Failed to send dispute refund seller email:', err.message)
          );
        }
      } catch (emailErr) {
        console.error('[Admin] Failed to send dispute refund emails:', emailErr.message);
      }
    }

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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/admin/reviews/flagged
 * List reviews flagged for potential fraud/abuse (pending admin review).
 */
router.get('/reviews/flagged', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [flags, total] = await Promise.all([
      ReviewFlag.find({ status: 'pending' })
        .populate('review')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReviewFlag.countDocuments({ status: 'pending' })
    ]);
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
    res.json({ flags: withReviewDetails, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching flagged reviews:', error);
    res.status(500).json({ error: 'Failed to fetch flagged reviews', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/reviews/flags/:id
 * Resolve a review flag: dismissed | confirmed_fake.
 * Body: { status, adminNotes? }
 */
router.patch('/reviews/flags/:id', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid flag ID' });
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
    res.status(500).json({ error: 'Failed to resolve flag', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * GET /api/admin/reviews/appeals
 * Admin queue for pending review appeals.
 */
router.get('/reviews/appeals', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const [appeals, total] = await Promise.all([
      ReviewAppeal.find({ status: 'pending' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReviewAppeal.countDocuments({ status: 'pending' })
    ]);
    const withDetails = await Promise.all(
      appeals.map(async (a) => {
        const [review, appellant] = await Promise.all([
          Review.findById(a.review).lean(),
          User.findById(a.appellant).select('firstName lastName email').lean()
        ]);
        let listing = null;
        let reviewer = null;
        let reviewee = null;
        if (review) {
          [listing, reviewer, reviewee] = await Promise.all([
            Listing.findById(review.listing).select('title slug').lean(),
            User.findById(review.reviewer).select('firstName lastName email').lean(),
            User.findById(review.reviewee).select('firstName lastName email').lean()
          ]);
        }
        return { ...a, review, appellant, listing, reviewer, reviewee };
      })
    );
    res.json({ appeals: withDetails, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching review appeals:', error);
    res.status(500).json({ error: 'Failed to fetch review appeals', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/reviews/appeals/:id
 * Resolve an appeal: accepted | rejected.
 * Body: { status, adminNotes? }
 */
router.patch('/reviews/appeals/:id', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid appeal ID' });
  try {
    const { status, adminNotes } = req.body;
    if (!status || !['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'status must be accepted or rejected'
      });
    }
    const appeal = await ReviewAppeal.findById(req.params.id);
    if (!appeal) return res.status(404).json({ error: 'Appeal not found' });
    if (appeal.status !== 'pending') {
      return res.status(400).json({ error: 'Already resolved', message: 'This appeal has already been resolved.' });
    }
    appeal.status = status;
    appeal.resolvedAt = new Date();
    appeal.resolvedBy = req.user?.email || 'admin';
    if (adminNotes != null) appeal.adminNotes = String(adminNotes).trim() || null;
    await appeal.save();
    res.json({ success: true, appeal });
  } catch (error) {
    console.error('Error resolving review appeal:', error);
    res.status(500).json({ error: 'Failed to resolve appeal', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

// Close private room and end auction
router.post('/auctions/:id/close-private-room', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
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
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

// GET /api/admin/reports — list reports (filterable by status, reportType)
router.get('/reports', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, reportType, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (reportType) filter.reportType = reportType;

    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('reportedBy', 'firstName lastName email')
      .lean();

    const total = await Report.countDocuments(filter);

    return res.json({ reports, total });
  } catch (err) {
    console.error('GET /api/admin/reports error:', err);
    return res.status(500).json({ error: 'Failed to fetch reports.' });
  }
});

// PATCH /api/admin/reports/:id — update report status
router.patch('/reports/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const VALID_STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed'];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const update = { status };
    if (adminNotes !== undefined) update.adminNotes = adminNotes;
    if (status === 'resolved' || status === 'dismissed') {
      update.resolvedBy = req.user._id;
      update.resolvedAt = new Date();
    }

    const report = await Report.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!report) return res.status(404).json({ error: 'Report not found.' });

    return res.json({ report });
  } catch (err) {
    console.error('PATCH /api/admin/reports error:', err);
    return res.status(500).json({ error: 'Failed to update report.' });
  }
});

/**
 * GET /api/admin/moderation-audit — DSA traceability (internal / lawful authority support)
 * Query: subjectUserId (optional), actionType (optional), limit (default 100, max 500)
 */
router.get('/moderation-audit', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const q = {};
    if (req.query.subjectUserId && isValidObjectId(req.query.subjectUserId)) {
      q.subjectUserId = req.query.subjectUserId;
    }
    if (req.query.actionType && String(req.query.actionType).length < 80) {
      q.actionType = String(req.query.actionType).trim();
    }
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const entries = await ModerationAuditLog.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ entries, total: entries.length });
  } catch (err) {
    console.error('GET /api/admin/moderation-audit error:', err);
    return res.status(500).json({ error: 'Failed to fetch moderation audit log.' });
  }
});

/**
 * POST /api/admin/seller-verifications/:userId
 * DSA: verify or reject professional (trader) identity submitted by the seller.
 * Body: { status: "verified" | "rejected", note?: string } (note used when rejected)
 */
router.post('/seller-verifications/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const { status, note } = req.body || {};
    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status', message: 'status must be "verified" or "rejected".' });
    }
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.sellerClassification !== 'professional') {
      return res.status(400).json({ error: 'Not a professional seller', message: 'This user is not registered as a professional (trader) seller.' });
    }

    if (status === 'verified') {
      user.professionalVerificationStatus = 'verified';
      user.professionalVerifiedAt = new Date();
      user.professionalVerifiedByEmail = (req.user.email || '').trim() || null;
      user.professionalRejectionNote = null;
    } else {
      user.professionalVerificationStatus = 'rejected';
      user.professionalVerifiedAt = null;
      user.professionalVerifiedByEmail = null;
      user.professionalRejectionNote = note != null ? String(note).trim().slice(0, 1000) : null;
    }
    await user.save();

    await appendModerationAudit({
      subjectUserId: user._id,
      actionType: 'seller_professional_verification',
      performedByEmail: req.user.email || null,
      metadata: { decision: status, rejectionNote: user.professionalRejectionNote }
    });

    return res.json({
      professionalVerificationStatus: user.professionalVerificationStatus,
      professionalVerifiedAt: user.professionalVerifiedAt,
      message: status === 'verified' ? 'Seller trader identity marked as verified.' : 'Seller trader identity rejected.'
    });
  } catch (err) {
    console.error('POST /api/admin/seller-verifications error:', err);
    return res.status(500).json({ error: 'Failed to update seller verification.' });
  }
});

// ── Damage Claims ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/damage-claims
 * List all damage claims, most recent first.
 * Query: status (optional filter), page (default 1)
 */
router.get('/damage-claims', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const PAGE_SIZE = 20;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [claims, total] = await Promise.all([
      DamageClaim.find(filter)
        .populate('buyer', 'firstName lastName email')
        .populate('seller', 'firstName lastName email')
        .populate('listing', 'title slug category')
        .populate('transaction', 'amount shippingRateId deliveredAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      DamageClaim.countDocuments(filter)
    ]);

    return res.json({ claims, total, page, pages: Math.ceil(total / PAGE_SIZE) });
  } catch (err) {
    console.error('GET /api/admin/damage-claims error:', err);
    return res.status(500).json({ error: 'Failed to load damage claims.' });
  }
});

/**
 * GET /api/admin/damage-claims/:id
 * Get a single damage claim with full detail.
 */
router.get('/damage-claims/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID.' });

    const claim = await DamageClaim.findById(req.params.id)
      .populate('buyer', 'firstName lastName email')
      .populate('seller', 'firstName lastName email')
      .populate('listing', 'title slug category images')
      .populate('transaction', 'amount buyerTotalPaid shippingRateId deliveredAt shippingCarrier trackingNumber')
      .lean();

    if (!claim) return res.status(404).json({ error: 'Claim not found.' });
    return res.json({ claim });
  } catch (err) {
    console.error('GET /api/admin/damage-claims/:id error:', err);
    return res.status(500).json({ error: 'Failed to load claim.' });
  }
});

/**
 * PATCH /api/admin/damage-claims/:id
 * Update a damage claim (status, packaging compliance, notes, carrier claim, refund amounts).
 * Body (all optional):
 *   status, packagingCompliant, adminNotes, carrierClaimReference,
 *   carrierClaimFiledAt, refundAmount, sellerCompensationAmount
 */
router.patch('/damage-claims/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID.' });

    const VALID_STATUSES = [
      'pending_review', 'approved_refund', 'packaging_rejected',
      'carrier_claim_filed', 'resolved', 'closed'
    ];

    const {
      status, packagingCompliant, adminNotes, carrierClaimReference,
      carrierClaimFiledAt, refundAmount, sellerCompensationAmount
    } = req.body;

    const claim = await DamageClaim.findById(req.params.id)
      .populate('listing', 'title')
      .populate('transaction', '_id');

    if (!claim) return res.status(404).json({ error: 'Claim not found.' });

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      claim.status = status;
      if (status === 'carrier_claim_filed' && carrierClaimReference) {
        claim.carrierClaimFiledAt = carrierClaimFiledAt ? new Date(carrierClaimFiledAt) : new Date();
      }
      if (status === 'approved_refund' || status === 'resolved') {
        if (!claim.refundedAt && refundAmount !== undefined) claim.refundedAt = new Date();
      }
      if (status === 'resolved') {
        claim.resolvedAt = claim.resolvedAt ?? new Date();
        if (sellerCompensationAmount !== undefined && !claim.sellerCompensatedAt) {
          claim.sellerCompensatedAt = new Date();
        }
      }
    }

    if (packagingCompliant !== undefined) claim.packagingCompliant = packagingCompliant;
    if (adminNotes !== undefined) claim.adminNotes = adminNotes;
    if (carrierClaimReference !== undefined) claim.carrierClaimReference = carrierClaimReference;
    if (carrierClaimFiledAt !== undefined) claim.carrierClaimFiledAt = new Date(carrierClaimFiledAt);
    if (refundAmount !== undefined) claim.refundAmount = refundAmount;
    if (sellerCompensationAmount !== undefined) claim.sellerCompensationAmount = sellerCompensationAmount;

    await claim.save();

    // Notify buyer if claim moved to a resolved/decision state
    const notifyStatuses = ['approved_refund', 'packaging_rejected', 'resolved', 'closed'];
    if (status && notifyStatuses.includes(status)) {
      const io = req.app.get('io');
      setImmediate(async () => {
        try {
          await notifyDamageClaimResolved({
            buyerId: claim.buyer,
            listingTitle: claim.listing?.title,
            status: claim.status,
            transactionId: claim.transaction?._id ?? claim.transaction,
            io
          });
        } catch (e) {
          console.error('notifyDamageClaimResolved error:', e.message);
        }
      });
    }

    const updated = await DamageClaim.findById(claim._id)
      .populate('buyer', 'firstName lastName email')
      .populate('seller', 'firstName lastName email')
      .populate('listing', 'title slug category')
      .lean();

    return res.json({ claim: updated });
  } catch (err) {
    console.error('PATCH /api/admin/damage-claims/:id error:', err);
    return res.status(500).json({ error: 'Failed to update claim.' });
  }
});

module.exports = router;

