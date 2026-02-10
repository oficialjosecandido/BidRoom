const express = require('express');
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Customer = require('../models/Customer');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { createTransactionForAcceptedOffer } = require('../services/transactionService');
const {
  logOfferReceived,
  logMultipleOffers,
  logSellerAcceptedWinner
} = require('../services/bestOfferLogger');

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

// GET /api/offers/listing/:listingId - Get all offers for a listing
router.get('/listing/:listingId', async (req, res) => {
  try {
    const offers = await Offer.find({ listing: req.params.listingId })
      .populate('offerer', 'firstName lastName email emailVerified uid')
      .sort({ createdAt: -1 })
      .lean();

    const uids = [...new Set(offers.map(o => o.offerer?.uid).filter(Boolean))];
    const customers = uids.length
      ? await Customer.find({ uid: { $in: uids } }).select('uid balance').lean()
      : [];
    const balanceByUid = customers.reduce((acc, c) => { acc[c.uid] = c.balance ?? 0; return acc; }, {});

    const formattedOffers = offers.map(offer => {
      const offerer = offer.offerer;
      const uid = offerer?.uid;
      const balance = uid != null ? balanceByUid[uid] : null;
      const offererTier = tierFromBalance(balance);
      const offererVerified = !!offerer?.emailVerified;
      const name = offerer
        ? `${offerer.firstName} ${offerer.lastName}`
        : (offer.offererEmail ? offer.offererEmail.split('@')[0] : 'Anonymous');
      const initials = offerer
        ? `${offerer.firstName.charAt(0)}${offerer.lastName.charAt(0)}`
        : (offer.offererEmail ? offer.offererEmail.charAt(0).toUpperCase() : 'A');
      return {
        ...offer,
        offerer: offerer ? { _id: offerer._id, firstName: offerer.firstName, lastName: offerer.lastName, email: offerer.email } : null,
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
    console.error('Error fetching offers:', error);
    res.status(500).json({
      error: 'Failed to fetch offers',
      message: error.message
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
      user = await User.findOne({ uid: req.user.uid });
      if (!user) {
        const nameParts = req.user.name?.split(' ') || [];
        const firstName = nameParts[0] || 'User';
        const lastName = nameParts.slice(1).join(' ') || 'User';
        user = new User({
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

    // Check if offerer already has a pending offer (by user id or guest email)
    const existingQuery = { listing: listingId, status: 'pending' };
    if (user) {
      existingQuery.offerer = user._id;
    } else {
      existingQuery.offerer = null;
      existingQuery.offererEmail = offererEmail;
    }
    const existingOffer = await Offer.findOne(existingQuery);

    if (existingOffer) {
      existingOffer.amount = amount;
      existingOffer.message = message || null;
      await existingOffer.save();

      const populatedOffer = await Offer.findById(existingOffer._id)
        .populate('offerer', 'firstName lastName email')
        .lean();
      const name = populatedOffer.offerer
        ? `${populatedOffer.offerer.firstName} ${populatedOffer.offerer.lastName}`
        : (populatedOffer.offererEmail ? populatedOffer.offererEmail.split('@')[0] : 'Anonymous');
      const initials = populatedOffer.offerer
        ? `${populatedOffer.offerer.firstName.charAt(0)}${populatedOffer.offerer.lastName.charAt(0)}`
        : (populatedOffer.offererEmail ? populatedOffer.offererEmail.charAt(0).toUpperCase() : 'A');

      const bidderDetails = populatedOffer.offerer
        ? { id: populatedOffer.offerer._id, email: populatedOffer.offerer.email, name: `${populatedOffer.offerer.firstName || ''} ${populatedOffer.offerer.lastName || ''}`.trim() }
        : { guestEmail: populatedOffer.offererEmail };
      logOfferReceived(populatedOffer, bidderDetails);

      return res.json({
        ...populatedOffer,
        offererName: name,
        offererInitials: initials
      });
    }

    // Defensive: must have either authenticated user or guest email (when no existing offer)
    if (!user && !offererEmail) {
      return res.status(400).json({
        error: 'Identification required',
        message: 'Please log in or provide your email address to make an offer.'
      });
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

    const offerCount = await Offer.countDocuments({ listing: listingId });
    const populatedOffer = await Offer.findById(offer._id)
      .populate('offerer', 'firstName lastName email')
      .lean();
    const bidderDetails = populatedOffer.offerer
      ? { id: populatedOffer.offerer._id, email: populatedOffer.offerer.email, name: `${populatedOffer.offerer.firstName || ''} ${populatedOffer.offerer.lastName || ''}`.trim() }
      : { guestEmail: populatedOffer.offererEmail };
    logOfferReceived(populatedOffer, bidderDetails);

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

    res.status(201).json({
      ...populatedOffer,
      offererName: name,
      offererInitials: initials
    });
}

// POST /api/offers - Create a new offer (auth optional; guests must provide email)
router.post('/', optionalAuth, (req, res) => {
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
    console.error('Error creating offer:', err);
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
    const user = await User.findOne({ uid: req.user.uid });
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

    if (offer.offerer) {
      createTransactionForAcceptedOffer(offer.listing._id.toString(), offer._id.toString()).catch(err =>
        console.error('Transaction create for accepted offer:', err.message)
      );
    }

    const offererName = offer.offerer
      ? `${offer.offerer.firstName} ${offer.offerer.lastName}`
      : (offer.offererEmail ? offer.offererEmail.split('@')[0] : 'Guest');

    res.json({
      ...offer.toObject(),
      offererName
    });
  } catch (error) {
    console.error('Error accepting offer:', error);
    res.status(400).json({
      error: 'Failed to accept offer',
      message: error.message
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

    const user = await User.findOne({ uid: req.user.uid });
    if (offer.listing.seller.toString() !== user._id.toString()) {
      return res.status(403).json({
        error: 'Unauthorized',
        message: 'Only the seller can reject offers'
      });
    }

    offer.status = 'rejected';
    offer.respondedAt = new Date();
    offer.sellerResponse = req.body.message || 'Offer rejected';

    await offer.save();

    res.json(offer);
  } catch (error) {
    console.error('Error rejecting offer:', error);
    res.status(400).json({
      error: 'Failed to reject offer',
      message: error.message
    });
  }
});

module.exports = router;

