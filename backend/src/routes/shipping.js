/**
 * Shipping Routes
 *
 * POST /api/shipping/rates      – Calculate carrier rates for a 'calculated' shipping transaction
 * POST /api/shipping/lock-rate  – Lock the buyer's chosen rate on a transaction before checkout
 */

const express = require('express');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { calculateRates } = require('../services/shippingCalculationService');

const LOG_PREFIX = '[Shipping]';
const router = express.Router();

router.use(authenticateToken);

/**
 * POST /api/shipping/rates
 * Calculate available carrier rates for a transaction.
 *
 * Body: { transactionId, destination: { street1, city, state, postalCode, country } }
 * Returns: { rates: [...], origin: { postalCode, country } }
 *
 * Checkout must be blocked if this returns an error (spec rule).
 */
router.post('/rates', requireActiveAccount, async (req, res) => {
  const { transactionId, destination } = req.body || {};

  if (!transactionId || !destination) {
    return res.status(400).json({ error: 'transactionId and destination are required' });
  }
  const { street1, city, state, postalCode } = destination;
  if (!street1 || !city || !state || !postalCode) {
    return res.status(400).json({
      error: 'Incomplete destination',
      message: 'Shipping cannot be calculated for this delivery address. Please provide street, city, state, and postal code.'
    });
  }

  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const transaction = await Transaction.findById(transactionId)
      .populate('listing', 'shippingOption packageSize shippingOriginPostalCode shippingOriginCity shippingOriginCountry')
      .populate('buyer', '_id');

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.buyer._id.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Only the buyer can calculate shipping rates' });
    }

    const listing = transaction.listing;
    if (listing.shippingOption !== 'calculated') {
      return res.status(400).json({ error: 'This transaction does not use calculated shipping' });
    }
    if (!listing.packageSize) {
      return res.status(400).json({
        error: 'Missing package info',
        message: 'Shipping cannot be calculated for this delivery address. Please update shipping details or try again later.'
      });
    }
    if (!listing.shippingOriginPostalCode) {
      return res.status(400).json({
        error: 'Missing origin',
        message: 'Shipping cannot be calculated for this delivery address. Please update shipping details or try again later.'
      });
    }

    const origin = {
      postalCode: listing.shippingOriginPostalCode,
      city: listing.shippingOriginCity || '',
      country: listing.shippingOriginCountry || 'US'
    };

    let rates;
    try {
      rates = await calculateRates({ origin, destination, packageSize: listing.packageSize });
    } catch (err) {
      console.error(`${LOG_PREFIX} calculateRates error:`, err.message);
      if (err.code === 'TIMEOUT') {
        return res.status(503).json({
          error: 'Carrier timeout',
          message: 'Shipping cannot be calculated at this time. Please try again later.'
        });
      }
      return res.status(503).json({
        error: 'Rate calculation failed',
        message: 'Shipping cannot be calculated for this delivery address. Please update shipping details or try again later.'
      });
    }

    if (!rates || rates.length === 0) {
      return res.status(422).json({
        error: 'No rates available',
        message: 'Shipping cannot be calculated for this delivery address. No carrier supports this route.'
      });
    }

    return res.json({
      rates,
      origin: { postalCode: origin.postalCode, country: origin.country }
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} /rates error:`, err.message);
    res.status(500).json({ error: 'Failed to calculate shipping rates', message: err.message });
  }
});

/**
 * POST /api/shipping/lock-rate
 * Lock the buyer's chosen shipping rate on a transaction before checkout.
 * Once locked, the rate is included in the Stripe Checkout session total.
 *
 * Body: { transactionId, rateId, carrier, service, rate, deliveryDays, destination }
 * Returns: { success, shippingAmount, carrier, service, deliveryDays }
 */
router.post('/lock-rate', requireActiveAccount, async (req, res) => {
  const { transactionId, rateId, carrier, service, rate, deliveryDays, destination } = req.body || {};

  if (!transactionId || !rateId || !carrier || !service || rate == null) {
    return res.status(400).json({ error: 'transactionId, rateId, carrier, service, and rate are required' });
  }
  if (typeof rate !== 'number' || rate < 0) {
    return res.status(400).json({ error: 'rate must be a non-negative number' });
  }

  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const transaction = await Transaction.findById(transactionId)
      .populate('listing', 'shippingOption')
      .populate('buyer', '_id');

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.buyer._id.toString() !== user._id.toString()) {
      return res.status(403).json({ error: 'Only the buyer can lock a shipping rate' });
    }

    const ts = transaction.transactionStatus ?? transaction.status;
    if (ts !== 'pending_payment') {
      return res.status(400).json({ error: 'Cannot change shipping rate after payment is initiated' });
    }

    transaction.shippingAmount = parseFloat(rate);
    transaction.shippingCarrier = carrier;
    transaction.shippingService = service;
    transaction.shippingRateId = rateId;
    transaction.shippingCalculatedAt = new Date();
    transaction.shippingDeliveryDays = deliveryDays ?? null;

    if (destination) {
      transaction.buyerDeliveryAddress = {
        street1: destination.street1 || null,
        city: destination.city || null,
        state: destination.state || null,
        postalCode: destination.postalCode || null,
        country: destination.country || 'US'
      };
    }

    await transaction.save();
    console.log(`${LOG_PREFIX} Rate locked txn=${transactionId} ${carrier} ${service} $${rate}`);

    return res.json({
      success: true,
      shippingAmount: transaction.shippingAmount,
      carrier: transaction.shippingCarrier,
      service: transaction.shippingService,
      deliveryDays: transaction.shippingDeliveryDays
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} /lock-rate error:`, err.message);
    res.status(500).json({ error: 'Failed to lock shipping rate', message: err.message });
  }
});

module.exports = router;
