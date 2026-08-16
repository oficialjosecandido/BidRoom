const express = require('express');
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const { authenticateToken, optionalAuth, requireActiveAccountIfAuthenticated, requireNoDisputeRestrictionIfAuthenticated } = require('../middleware/auth');
const { createTransactionForAcceptedOffer } = require('../services/transactionService');
const {
  logOfferReceived,
  logMultipleOffers,
  logSellerAcceptedWinner
} = require('../services/bestOfferLogger');

const Block = require('../models/Block');
const { scanForAbusiveContent } = require('../utils/contentFilter');
const { recordViolation } = require('../services/contentViolationService');
const { appendModerationAudit } = require('../services/moderationAuditService');
const features = require('../config/features');
const router = express.Router();

// Membership tier thresholds (balance >= amount). Order high to low for tier resolution.
const TIER_THRESHOLDS = [
  { name: 'Platinum', amount: 1000 },
  { name: 'Gold', amount: 100 },
  { name: 'Silver', amount: 25 },
  { name: 'Bronze', amount: 10 }
];

function tierFromBalance(balance) {
  if (balance == null) return null;
  const t = TIER_THRESHOLDS.find(tier => balance >= tier.amount);
  return t ? t.name : null;
}

const { formatOfferForSocket } = require('../utils/offerFormat');
const {
  notifyNewProposal,
  notifyOfferPlaced,
  notifyOfferOutbid,
  notifyProposalAccepted,
  notifyProposalDeclined,
  emitNewNotificationToUser
} = require('../services/notificationService');
const {
  sendOfferPlacedEmail,
  sendOfferOutbidEmail
} = require('../services/auctionNotificationService');
const { sendEmail } = require('../services/emailService');
const { wrapBidRoomEmail, emailSuccessBox, emailAmountCard } = require('../utils/bidroomEmailLayout');
const logger = require('../utils/logger');

// GET /api/offers/listing/:listingId - Get all offers for a listing
router.get('/listing/:listingId', optionalAuth, async (req, res) => {
  try {
    const offers = await Offer.find({ listing: req.params.listingId })
      .populate('offerer', 'firstName lastName email emailVerified uid')
      .sort({ createdAt: -1 })
      .lean();

    // Determine if the requester is the listing's seller (entitled to see full emails)
    const listing = await Listing.findById(req.params.listingId).select('seller').lean();
    const requestingUid = req.user?.uid || null;
    const sellerUser = listing?.seller ? await Customer.findById(listing.seller).select('uid').lean() : null;
    const isSeller = requestingUid && sellerUser && requestingUid === sellerUser.uid;

    const uids = [...new Set(offers.map(o => o.offerer?.uid).filter(Boolean))];
    const customers = uids.length
      ? await Customer.find({ uid: { $in: uids } }).select('uid balance').lean()
      : [];
    const balanceByUid = customers.reduce((acc, c) => { acc[c.uid] = c.balance ?? 0; return acc; }, {});

    const formattedOffers = offers.map(offer => {
      const offerer = offer.offerer;
      const uid = offerer?.uid;
      const balance = uid != null ? balanceByUid[uid] : null;
      const offererTier = features.membershipTiers ? tierFromBalance(balance) : null;
      const offererVerified = !!offerer?.emailVerified;
      const name = offerer
        ? `${offerer.firstName} ${offerer.lastName}`
        : (offer.offererEmail ? offer.offererEmail.split('@')[0] : 'Anonymous');
      const initials = offerer
        ? `${offerer.firstName.charAt(0)}${offerer.lastName.charAt(0)}`
        : (offer.offererEmail ? offer.offererEmail.charAt(0).toUpperCase() : 'A');
      return {
        ...offer,
        // Expose email only to the seller; strip it for everyone else
        offerer: offerer ? { _id: offerer._id, firstName: offerer.firstName, lastName: offerer.lastName, email: isSeller ? offerer.email : null } : null,
        offererEmail: isSeller ? (offer.offererEmail || null) : null,
        offererName: name,
        offererInitials: initials,
        offererVerified,
        offererTier: offererTier || null
      };
    });

    res.json({
      offers: formattedOffers,
      total: formattedOffers.length
    });
  } catch (error) {
    logger.error('Error fetching offers:', error);
    res.status(500).json({
      error: 'Failed to fetch offers',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

const OFFER_CREATE_TIMEOUT_MS = 20000;

async function createOffer(req, res) {
  const { listingId, amount, message, email } = req.body;
    if (!listingId || !amount) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'listingId and amount are required'
      });
    }

    let user = null;
    let offererEmail = null;

    if (req.isAuthenticated && req.user) {
      // Find or create user
      user = await Customer.findOne({ uid: req.user.uid });
      if (!user) {
        const nameParts = req.user.name?.split(' ') || [];
        const firstName = nameParts[0] || 'User';
        const lastName = nameParts.slice(1).join(' ') || 'User';
        user = new Customer({
          uid: req.user.uid,
          email: req.user.email,
          firstName,
          lastName,
          isActive: true,
          emailVerified: req.user.emailVerified || false
        });
        await user.save();
      } else {
        if (req.user.emailVerified !== undefined && user.emailVerified !== req.user.emailVerified) {
          user.emailVerified = req.user.emailVerified;
          await user.save();
        }
      }
    } else {
      // Guest: email required
      if (!email || typeof email !== 'string' || !email.trim()) {
        return res.status(400).json({
          error: 'Email required',
          message: 'Please provide your email address to make an offer'
        });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({
          error: 'Invalid email',
          message: 'Please provide a valid email address'
        });
      }
      offererEmail = email.toLowerCase().trim();
    }

    // Get the listing (populate seller for email check and logs)
    const listing = await Listing.findById(listingId).populate('seller', 'firstName lastName email');
    if (!listing) {
      return res.status(404).json({
        error: 'Listing not found'
      });
    }

    // Block seller from making an offer on their own listing
    if (user && listing.seller && listing.seller._id.toString() === user._id.toString()) {
      return res.status(403).json({
        error: 'Cannot offer on your own listing',
        message: 'You cannot make an offer on your own listing.'
      });
    }
    if (offererEmail && listing.seller?.email && listing.seller.email.toLowerCase() === offererEmail) {
      return res.status(403).json({
        error: 'Cannot offer on your own listing',
        message: 'You cannot make an offer on your own listing.'
      });
    }

    // Block check — reject if the seller has blocked this user
    if (user && listing.seller?._id) {
      const isBlocked = await Block.exists({ blocker: listing.seller._id, blocked: user._id });
      if (isBlocked) {
        return res.status(403).json({
          error: 'Blocked',
          message: 'You are not allowed to make offers on this listing.'
        });
      }
    }

    // Verify it's a Best Offer listing
    if (listing.auctionFormat !== 'best-offer') {
      return res.status(400).json({
        error: 'Wrong auction format',
        message: 'This listing does not accept offers. Please place a bid instead.'
      });
    }

    // Check if listing is active
    if (listing.status !== 'active') {
      return res.status(400).json({
        error: 'Listing not active',
        message: 'This listing is no longer accepting offers'
      });
    }

    // Offers below minimum are allowed; seller is not obliged to accept (buyer sees indication in UI)
    // Each submission always creates a new offer — buyers may place multiple offers.

    // Abusive language check on offer message (authenticated users only)
    if (user && message && typeof message === 'string' && message.trim()) {
      const abuseCheck = scanForAbusiveContent(message);
      if (abuseCheck.found) {
        if (abuseCheck.severity === 'high') {
          const violation = await recordViolation(user, 'offensive_language');
          return res.status(400).json({ error: 'Content policy violation', message: violation.message, violationAction: violation.action });
        }
        if (abuseCheck.severity === 'medium') {
          return res.status(400).json({
            error: 'Content policy violation',
            message: 'Your message contains offensive or abusive language. Please revise it before submitting your offer.'
          });
        }
        // low: log for review, allow through
        appendModerationAudit({
          subjectUserId: user._id,
          actionType: 'abusive_content_flagged',
          metadata: { context: 'offer_message', severity: 'low', categories: abuseCheck.categories, matches: abuseCheck.matches, listingId }
        }).catch(() => {});
      }
    }

    // Create new offer
    const offer = new Offer({
      listing: listingId,
      offerer: user ? user._id : null,
      offererEmail: offererEmail || null,
      amount,
      message: message || null,
      status: 'pending'
    });

    await offer.save();

    const populatedOffer = await Offer.findById(offer._id)
      .populate('offerer', 'firstName lastName email emailVerified')
      .lean();
    const bidderDetails = populatedOffer.offerer
      ? { id: populatedOffer.offerer._id, email: populatedOffer.offerer.email, name: `${populatedOffer.offerer.firstName || ''} ${populatedOffer.offerer.lastName || ''}`.trim() }
      : { guestEmail: populatedOffer.offererEmail };
    logOfferReceived(populatedOffer, bidderDetails);

    const offerCount = await Offer.countDocuments({ listing: listingId });
    if (offerCount > 1) {
      const allForListing = await Offer.find({ listing: listingId }).populate('offerer', 'firstName lastName email').lean();
      const offersDetail = allForListing.map(o => ({
        offerId: o._id,
        amount: o.amount,
        status: o.status,
        bidder: o.offerer ? { id: o.offerer._id, email: o.offerer.email, name: `${o.offerer.firstName || ''} ${o.offerer.lastName || ''}`.trim() } : { guestEmail: o.offererEmail }
      }));
      logMultipleOffers(listingId, offerCount, offersDetail);
    }

    const name = populatedOffer.offerer
      ? `${populatedOffer.offerer.firstName} ${populatedOffer.offerer.lastName}`
      : (populatedOffer.offererEmail ? populatedOffer.offererEmail.split('@')[0] : 'Anonymous');
    const initials = populatedOffer.offerer
      ? `${populatedOffer.offerer.firstName.charAt(0)}${populatedOffer.offerer.lastName.charAt(0)}`
      : (populatedOffer.offererEmail ? populatedOffer.offererEmail.charAt(0).toUpperCase() : 'A');

    const io = req.app.get('io');
    const confirmEmail = populatedOffer.offerer?.email || populatedOffer.offererEmail;
    const confirmUserId = populatedOffer.offerer?._id?.toString?.();
    if (confirmUserId) {
      notifyOfferPlaced({ listingSlug: listing.slug, listingTitle: listing.title, offerAmount: amount, offererUserId: confirmUserId })
        .catch(err => logger.error('Failed offer confirmation notification:', err));
      if (io) emitNewNotificationToUser(io, confirmUserId).catch(() => {});
    }
    if (confirmEmail) {
      sendOfferPlacedEmail(listing, confirmEmail, name, amount).catch(err => logger.error('Failed offer confirmation email:', err));
    }
    // Fetch other buyers' pending offers (exclude same buyer to avoid self-outbid notifications)
    const otherBuyerFilter = user
      ? { offerer: { $ne: user._id } }
      : { offererEmail: { $ne: offererEmail } };
    const otherOffers = await Offer.find({ listing: listingId, status: 'pending', _id: { $ne: offer._id }, ...otherBuyerFilter })
      .populate('offerer', 'firstName lastName email')
      .lean();
    const prevHigh = otherOffers.length ? Math.max(...otherOffers.map(o => o.amount)) : 0;
    if (amount > prevHigh && prevHigh > 0) {
      const notified = new Set();
      for (const o of otherOffers.filter(x => x.amount === prevHigh)) {
        const e = o.offerer?.email?.toLowerCase() || o.offererEmail?.toLowerCase();
        const u = o.offerer?._id?.toString?.();
        if (!e || notified.has(e) || e === (confirmEmail || '').toLowerCase()) continue;
        notified.add(e);
        if (u) {
          notifyOfferOutbid({ listingSlug: listing.slug, listingTitle: listing.title, previousOffer: prevHigh, newOffer: amount, offererUserId: u })
            .catch(err => logger.error('Failed offer outbid notification:', err));
          if (io) emitNewNotificationToUser(io, u).catch(() => {});
        }
        sendOfferOutbidEmail(listing, e, o.offerer ? `${o.offerer.firstName} ${o.offerer.lastName}` : o.offererEmail?.split('@')[0], prevHigh, amount)
          .catch(err => logger.error('Failed offer outbid email:', err));
      }
    }
    if (io) {
      io.to(`listing:${listingId}`).emit('new-offer', {
        listingId,
        offer: formatOfferForSocket(populatedOffer)
      });
    }
    const sellerUserId = listing.seller?._id?.toString?.() || listing.seller?.toString?.();
    if (sellerUserId) {
      notifyNewProposal({
        listingId,
        listingSlug: listing.slug || null,
        listingTitle: listing.title || 'Your listing',
        offerAmount: amount,
        offererName: name,
        sellerUserId
      }).catch(err => logger.error('Failed to create proposal notification:', err));
      if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
    }

    res.status(201).json({
      ...populatedOffer,
      offererName: name,
      offererInitials: initials
    });
}

// POST /api/offers - Create a new offer (auth optional; guests must provide email)
router.post('/', optionalAuth, requireActiveAccountIfAuthenticated, requireNoDisputeRestrictionIfAuthenticated, (req, res) => {
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({
        error: 'Request timeout',
        message: 'Offer creation took too long. Please try again.'
      });
    }
  }, OFFER_CREATE_TIMEOUT_MS);
  res.once('finish', () => clearTimeout(timeoutId));
  createOffer(req, res).catch((err) => {
    logger.error('Error creating offer:', err);
    if (!res.headersSent) {
      res.status(400).json({
        error: 'Failed to create offer',
        message: err.message
      });
    }
  });
});

// PATCH /api/offers/:offerId/accept - Seller accepts an offer
router.patch('/:offerId/accept', authenticateToken, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.offerId)
      .populate('listing')
      .populate('offerer', 'firstName lastName email');

    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    // Verify user is the seller
    const user = await Customer.findOne({ uid: req.user.uid });
    if (offer.listing.seller.toString() !== user._id.toString()) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Only the seller can accept offers'
      });
    }

    if (offer.status !== 'pending') {
      return res.status(400).json({
        error: 'Invalid offer status',
        message: 'Only pending offers can be accepted'
      });
    }

    // Block acceptance if seller has not connected Stripe (skip check in test/dev mode)
    const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
    if (!isTestMode && (!user.stripeConnectAccountId || !user.stripeConnectOnboarded)) {
      return res.status(400).json({
        error: 'Stripe not connected',
        message: 'You must connect your Stripe account before accepting offers. Go to Dashboard → Settings → Payments to complete setup.'
      });
    }

    // Accept the offer
    offer.status = 'accepted';
    offer.respondedAt = new Date();
    offer.sellerResponse = req.body.message || 'Offer accepted';
    
    // Close the listing
    offer.listing.status = 'ended';
    offer.listing.currentPrice = offer.amount;
    
    // Reject all other pending offers
    await Offer.updateMany(
      {
        listing: offer.listing._id,
        _id: { $ne: offer._id },
        status: 'pending'
      },
      {
        status: 'rejected',
        respondedAt: new Date()
      }
    );

    await Promise.all([offer.save(), offer.listing.save()]);

    const sellerDetails = { id: user._id, email: user.email, name: `${user.firstName || ''} ${user.lastName || ''}`.trim() };
    const allOffers = await Offer.find({ listing: offer.listing._id }).select('_id amount status offerer offererEmail').lean();
    const allOffersSummary = {
      total: allOffers.length,
      byStatus: allOffers.reduce((acc, o) => { acc[o.status] = (acc[o.status] || 0) + 1; return acc; }, {}),
      offers: allOffers.map(o => ({ offerId: o._id, amount: o.amount, status: o.status, bidder: o.offerer ? o.offerer.toString() : o.offererEmail || 'guest' }))
    };
    logSellerAcceptedWinner(offer, sellerDetails, allOffersSummary);

    const io = req.app.get('io');
    if (offer.offerer) {
      createTransactionForAcceptedOffer(offer.listing._id.toString(), offer._id.toString()).catch(err =>
        logger.error('Transaction create for accepted offer:', err.message)
      );
      // Notify buyer that proposal was accepted
      const buyerUserId = offer.offerer._id?.toString?.() || offer.offerer?.toString?.();
      const listing = offer.listing;
      if (buyerUserId) {
        notifyProposalAccepted({
          listingSlug: listing.slug || null,
          listingTitle: listing.title || 'the item',
          offerAmount: offer.amount,
          buyerUserId
        }).catch(err => logger.error('Failed to create proposal-accepted notification:', err));
        if (io) emitNewNotificationToUser(io, buyerUserId).catch(() => {});

        // Email to buyer
        const buyerEmail = offer.offerer?.email;
        if (buyerEmail) {
          const buyerFirstName = offer.offerer?.firstName || 'there';
          const amountStr = `$${Number(offer.amount).toFixed(2)}`;
          const listingTitle = listing.title || 'your item';
          const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
          const txLink = `${frontendUrl}/dashboard/transactions`;
          const html = wrapBidRoomEmail({
            title: 'Your offer was accepted!',
            preheader: `The seller accepted your offer of ${amountStr} for ${listingTitle}.`,
            bodyHtml: `
              <p style="margin:0 0 16px;">Hi <strong>${buyerFirstName}</strong>,</p>
              ${emailSuccessBox(
                'Great news — your offer was accepted',
                `<p style="margin:0 0 12px;">The seller accepted your offer for this listing.</p>${emailAmountCard(amountStr, listingTitle)}`
              )}
              <p style="margin:16px 0 0;color:#334155;font-size:14px;line-height:1.55;">A transaction has been created. Please complete payment to proceed.</p>
            `,
            ctaUrl: txLink,
            ctaLabel: 'View transaction'
          });
          sendEmail(buyerEmail, `Your offer on "${listingTitle}" was accepted`, html)
            .catch(err => logger.error('Failed to send offer-accepted email:', err.message));
        }
      }
    }
    if (io) {
      const listingId = offer.listing._id.toString();
      const populated = await Offer.findById(offer._id).populate('offerer', 'firstName lastName email emailVerified').lean();
      io.to(`listing:${listingId}`).emit('offer-update', {
        listingId,
        offer: formatOfferForSocket(populated),
        listingStatus: 'ended'
      });
    }

    const offererName = offer.offerer
      ? `${offer.offerer.firstName} ${offer.offerer.lastName}`
      : (offer.offererEmail ? offer.offererEmail.split('@')[0] : 'Guest');

    res.json({
      ...offer.toObject(),
      offererName
    });
  } catch (error) {
    logger.error('Error accepting offer:', error);
    res.status(400).json({
      error: 'Failed to accept offer',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// PATCH /api/offers/:offerId/reject - Seller rejects an offer
router.patch('/:offerId/reject', authenticateToken, async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.offerId).populate('listing');

    if (!offer) {
      return res.status(404).json({ error: 'Offer not found' });
    }

    const user = await Customer.findOne({ uid: req.user.uid });
    if (offer.listing.seller.toString() !== user._id.toString()) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Only the seller can reject offers'
      });
    }

    // Enforce minimum-price rule: seller cannot decline the last qualifying offer
    const minimumOfferPrice = offer.listing.minimumOfferPrice ?? 0;
    if (minimumOfferPrice > 0 && offer.amount >= minimumOfferPrice) {
      const otherQualifyingOffers = await Offer.countDocuments({
        listing: offer.listing._id,
        _id: { $ne: offer._id },
        status: 'pending',
        amount: { $gte: minimumOfferPrice }
      });
      if (otherQualifyingOffers === 0) {
        return res.status(400).json({
          error: 'Cannot decline last qualifying offer',
          message: `This offer meets the minimum price. You must accept at least one offer that meets the minimum.`
        });
      }
    }

    offer.status = 'rejected';
    offer.respondedAt = new Date();
    offer.sellerResponse = req.body.message || 'Offer rejected';

    await offer.save();

    // If exactly one qualifying offer remains after this rejection → auto-accept it
    if (minimumOfferPrice > 0) {
      const remainingQualifying = await Offer.find({
        listing: offer.listing._id,
        status: 'pending',
        amount: { $gte: minimumOfferPrice }
      }).populate('listing').populate('offerer', 'firstName lastName email');

      if (remainingQualifying.length === 1) {
        // Check if seller has Stripe before auto-accepting (skip in test/dev mode)
        const sellerStripeReady = isTestMode || !!(user.stripeConnectAccountId && user.stripeConnectOnboarded);

        if (!sellerStripeReady) {
          // Notify seller to connect Stripe; do not auto-accept
          const { notifySellerStripeRequiredForOffer, emitNewNotificationToUser } = require('../services/notificationService');
          const io = req.app.get('io');
          notifySellerStripeRequiredForOffer({
            listingSlug: offer.listing.slug || null,
            listingTitle: offer.listing.title || 'Your listing',
            offerAmount: remainingQualifying[0].amount,
            sellerUserId: user._id.toString()
          }).catch(err => logger.error('Failed Stripe-required notification:', err));
          if (io) emitNewNotificationToUser(io, user._id.toString()).catch(() => {});
          return res.json({ ...offer.toObject(), stripeRequired: true });
        }

        const autoOffer = remainingQualifying[0];
        autoOffer.status = 'accepted';
        autoOffer.respondedAt = new Date();
        autoOffer.sellerResponse = 'Offer automatically accepted (only qualifying offer remaining)';
        autoOffer.listing.status = 'ended';
        autoOffer.listing.currentPrice = autoOffer.amount;

        await Offer.updateMany(
          { listing: offer.listing._id, _id: { $ne: autoOffer._id }, status: 'pending' },
          { status: 'rejected', respondedAt: new Date() }
        );

        await Promise.all([autoOffer.save(), autoOffer.listing.save()]);

        if (autoOffer.offerer) {
          createTransactionForAcceptedOffer(offer.listing._id.toString(), autoOffer._id.toString())
            .catch(err => logger.error('Transaction create for auto-accepted offer:', err.message));
        }

        const io = req.app.get('io');
        if (io) {
          const listingId = offer.listing._id.toString();
          const { formatOfferForSocket } = require('../utils/offerFormat');
          const populated = await Offer.findById(autoOffer._id).populate('offerer', 'firstName lastName email emailVerified').lean();
          io.to(`listing:${listingId}`).emit('offer-update', {
            listingId,
            offer: formatOfferForSocket(populated),
            listingStatus: 'ended'
          });
        }

        return res.json({ ...offer.toObject(), autoAccepted: true });
      }
    }

    const io = req.app.get('io');
    if (offer.offerer) {
      const buyerUserId = offer.offerer._id?.toString?.() || offer.offerer?.toString?.();
      const listing = offer.listing;
      if (buyerUserId) {
        notifyProposalDeclined({
          listingSlug: listing.slug || null,
          listingTitle: listing.title || 'the item',
          offerAmount: offer.amount,
          buyerUserId
        }).catch(err => logger.error('Failed to create proposal-declined notification:', err));
        if (io) emitNewNotificationToUser(io, buyerUserId).catch(() => {});
      }
    }
    if (io) {
      const listingId = offer.listing._id.toString();
      const populated = await Offer.findById(offer._id).populate('offerer', 'firstName lastName email emailVerified').lean();
      io.to(`listing:${listingId}`).emit('offer-update', {
        listingId,
        offer: formatOfferForSocket(populated),
        listingStatus: null
      });
    }

    res.json(offer);
  } catch (error) {
    logger.error('Error rejecting offer:', error);
    res.status(400).json({
      error: 'Failed to reject offer',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;

