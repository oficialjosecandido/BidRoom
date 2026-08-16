const express = require('express');
const mongoose = require('mongoose');
const DamageClaim = require('../models/DamageClaim');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const {
  notifyDamageClaimOpened,
  notifyDamageClaimResolved,
  emitNewNotificationToUser
} = require('../services/notificationService');
const { getPackagingRequirements } = require('../config/packagingPolicy');
const logger = require('../utils/logger');

const router = express.Router();
router.use(authenticateToken);

/** Claim window: 48 hours after delivery confirmation */
const CLAIM_WINDOW_MS = 48 * 60 * 60 * 1000;

function isValidObjectId(v) {
  return mongoose.Types.ObjectId.isValid(v);
}

/**
 * POST /api/damage-claims
 * Buyer opens a damage-in-transit claim.
 * Body: { transactionId, damagePhotoUrls: string[], packagingPhotoUrls: string[], description?: string }
 */
router.post('/', requireActiveAccount, async (req, res) => {
  try {
    const { transactionId, damagePhotoUrls, packagingPhotoUrls, description } = req.body;

    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ error: 'Invalid transactionId.' });
    }

    if (!Array.isArray(damagePhotoUrls) || damagePhotoUrls.length < 1) {
      return res.status(400).json({ error: 'At least one damage photo is required.' });
    }

    if (!Array.isArray(packagingPhotoUrls) || packagingPhotoUrls.length < 1) {
      return res.status(400).json({ error: 'At least one packaging photo is required.' });
    }

    const dbUser = await Customer.findOne({ uid: req.user.uid }).lean();
    if (!dbUser) return res.status(404).json({ error: 'User not found.' });

    const transaction = await Transaction.findById(transactionId)
      .populate('listing', 'title slug category')
      .lean();

    if (!transaction) return res.status(404).json({ error: 'Transaction not found.' });

    // Must be the buyer
    if (String(transaction.buyer) !== String(dbUser._id)) {
      return res.status(403).json({ error: 'Only the buyer can open a damage claim.' });
    }

    // Transaction must have been delivered
    if (!transaction.deliveredAt) {
      return res.status(400).json({ error: 'The item has not been marked as delivered yet.' });
    }

    // Must be within the 48-hour window
    const elapsed = Date.now() - new Date(transaction.deliveredAt).getTime();
    if (elapsed > CLAIM_WINDOW_MS) {
      return res.status(400).json({
        error: 'Claim window expired.',
        message: 'Damage claims must be opened within 48 hours of delivery confirmation.'
      });
    }

    // Only one claim per transaction
    const existing = await DamageClaim.findOne({ transaction: transactionId }).lean();
    if (existing) {
      return res.status(409).json({ error: 'A damage claim already exists for this transaction.' });
    }

    // Determine shipping type from whether the shipment was coordinated via EasyPost
    const shippingType = transaction.shippingRateId ? 'platform_label' : 'external_shipping';

    const claim = new DamageClaim({
      transaction: transactionId,
      buyer: dbUser._id,
      seller: transaction.seller,
      listing: transaction.listing._id,
      shippingType,
      damagePhotoUrls,
      packagingPhotoUrls,
      description: description?.trim() || null
    });

    await claim.save();

    // Notify seller (fire-and-forget)
    const io = req.app.get('io');
    setImmediate(async () => {
      try {
        const listingTitle = transaction.listing?.title ?? 'the item';
        await notifyDamageClaimOpened({
          sellerId: transaction.seller,
          buyerName: `${dbUser.firstName} ${dbUser.lastName}`,
          listingTitle,
          shippingType,
          transactionId,
          io
        });
      } catch (e) {
        logger.error('notifyDamageClaimOpened error:', e.message);
      }
    });

    // Include packaging policy in response
    const packagingPolicy = getPackagingRequirements(transaction.listing?.category);

    return res.status(201).json({ claim, packagingPolicy });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: Object.values(err.errors).map(e => e.message).join(', ') });
    }
    logger.error('POST /api/damage-claims error:', err);
    return res.status(500).json({ error: 'Failed to open damage claim.' });
  }
});

/**
 * GET /api/damage-claims/transaction/:transactionId
 * Returns the damage claim for a transaction (buyer or seller).
 */
router.get('/transaction/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    if (!isValidObjectId(transactionId)) return res.status(400).json({ error: 'Invalid transactionId.' });

    const dbUser = await Customer.findOne({ uid: req.user.uid }).lean();
    if (!dbUser) return res.status(404).json({ error: 'User not found.' });

    const claim = await DamageClaim.findOne({ transaction: transactionId })
      .populate('listing', 'title slug category')
      .lean();

    if (!claim) return res.status(404).json({ error: 'No damage claim found.' });

    // Only buyer or seller can read their own claim
    const isBuyer = String(claim.buyer) === String(dbUser._id);
    const isSeller = String(claim.seller) === String(dbUser._id);
    if (!isBuyer && !isSeller) return res.status(403).json({ error: 'Access denied.' });

    // Omit admin-internal notes from non-admin response
    const { adminNotes: _adminNotes, ...publicClaim } = claim;

    return res.json({ claim: publicClaim });
  } catch (err) {
    logger.error('GET /api/damage-claims/transaction/:id error:', err);
    return res.status(500).json({ error: 'Failed to load damage claim.' });
  }
});

/**
 * GET /api/damage-claims/:id
 * Returns a specific damage claim by its own ID (buyer or seller).
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid claim ID.' });

    const dbUser = await Customer.findOne({ uid: req.user.uid }).lean();
    if (!dbUser) return res.status(404).json({ error: 'User not found.' });

    const claim = await DamageClaim.findById(id)
      .populate('listing', 'title slug category')
      .lean();

    if (!claim) return res.status(404).json({ error: 'Claim not found.' });

    const isBuyer = String(claim.buyer) === String(dbUser._id);
    const isSeller = String(claim.seller) === String(dbUser._id);
    if (!isBuyer && !isSeller) return res.status(403).json({ error: 'Access denied.' });

    const { adminNotes: _adminNotes, ...publicClaim } = claim;
    return res.json({ claim: publicClaim });
  } catch (err) {
    logger.error('GET /api/damage-claims/:id error:', err);
    return res.status(500).json({ error: 'Failed to load damage claim.' });
  }
});

module.exports = router;
