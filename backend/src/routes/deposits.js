'use strict';

const express = require('express');
const Transaction = require('../models/Transaction');
const Customer = require('../models/Customer');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const { getStripe } = require('../utils/stripe.util');

const router = express.Router();

/** Amount in cents for the vehicle deposit */
const DEPOSIT_AMOUNT_CENTS = 10_000; // €100
const DEPOSIT_CURRENCY = 'eur';

function customerId(c) {
  return (c._id || c).toString();
}

/**
 * GET /:txId — get deposit status for a transaction.
 * Accessible to buyer or seller of that transaction.
 */
router.get('/:txId', authenticateToken, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.txId).lean();
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const callerId = req.user.customerId || req.user.uid;
    const buyerId = customerId(tx.buyer);
    const sellerId = customerId(tx.seller);
    if (callerId !== buyerId && callerId !== sellerId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({
      depositRequired: tx.depositRequired ?? false,
      depositStatus: tx.depositStatus ?? 'pending',
      depositDeadline: tx.depositDeadline ?? null,
      depositAuthorizedAt: tx.depositAuthorizedAt ?? null,
      depositCapturedAt: tx.depositCapturedAt ?? null,
      depositReleasedAt: tx.depositReleasedAt ?? null,
    });
  } catch (err) {
    console.error('[deposits] GET error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:txId/authorize — create (or retrieve) a Stripe PaymentIntent for the deposit.
 * Buyer only. Returns clientSecret for frontend Stripe.js confirmation.
 * If buyer has no saved card, also returns requiresPaymentMethod: true.
 */
router.post('/:txId/authorize', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Payment service unavailable' });

    const tx = await Transaction.findById(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const callerId = req.user.customerId || req.user.uid;
    if (customerId(tx.buyer) !== callerId) {
      return res.status(403).json({ error: 'Only the buyer can authorize the deposit' });
    }

    if (!tx.depositRequired) {
      return res.status(400).json({ error: 'No deposit required for this transaction' });
    }
    if (tx.depositStatus === 'authorized') {
      return res.status(400).json({ error: 'Deposit already authorized' });
    }
    if (tx.depositStatus === 'released' || tx.depositStatus === 'captured') {
      return res.status(400).json({ error: 'Deposit already settled' });
    }

    // Reuse existing PI if already created but not yet confirmed
    if (tx.depositPaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(tx.depositPaymentIntentId);
      if (pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation' || pi.status === 'requires_action') {
        const buyer = await Customer.findById(tx.buyer).lean();
        const defaultPm = buyer?.savedPaymentMethods?.find(pm => pm.isDefault) ?? buyer?.savedPaymentMethods?.[0] ?? null;
        return res.json({
          clientSecret: pi.client_secret,
          requiresPaymentMethod: !defaultPm,
          savedCard: defaultPm ? { brand: defaultPm.brand, last4: defaultPm.last4, expiry: defaultPm.expiry } : null,
        });
      }
    }

    const buyer = await Customer.findById(tx.buyer).lean();
    const defaultPm = buyer?.savedPaymentMethods?.find(pm => pm.isDefault) ?? buyer?.savedPaymentMethods?.[0] ?? null;

    const piParams = {
      amount: DEPOSIT_AMOUNT_CENTS,
      currency: DEPOSIT_CURRENCY,
      capture_method: 'manual',
      description: `Caução veículo — transação ${tx._id}`,
      metadata: {
        transactionId: tx._id.toString(),
        type: 'vehicle_deposit',
      },
    };

    if (buyer?.stripeCustomerId) {
      piParams.customer = buyer.stripeCustomerId;
    }
    if (defaultPm?.stripePaymentMethodId) {
      piParams.payment_method = defaultPm.stripePaymentMethodId;
    }

    const pi = await stripe.paymentIntents.create(piParams);

    tx.depositPaymentIntentId = pi.id;
    await tx.save();

    return res.json({
      clientSecret: pi.client_secret,
      requiresPaymentMethod: !defaultPm,
      savedCard: defaultPm ? { brand: defaultPm.brand, last4: defaultPm.last4, expiry: defaultPm.expiry } : null,
    });
  } catch (err) {
    console.error('[deposits] authorize error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:txId/confirm — called by frontend after Stripe.js confirms the payment.
 * Marks deposit as authorized in our database.
 */
router.post('/:txId/confirm', authenticateToken, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Payment service unavailable' });

    const tx = await Transaction.findById(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const callerId = req.user.customerId || req.user.uid;
    if (customerId(tx.buyer) !== callerId) {
      return res.status(403).json({ error: 'Only the buyer can confirm the deposit' });
    }

    if (!tx.depositPaymentIntentId) {
      return res.status(400).json({ error: 'No deposit payment intent found; call /authorize first' });
    }

    const pi = await stripe.paymentIntents.retrieve(tx.depositPaymentIntentId);
    if (pi.status !== 'requires_capture') {
      return res.status(400).json({ error: `Deposit not yet authorized by Stripe (status: ${pi.status})` });
    }

    tx.depositStatus = 'authorized';
    tx.depositAuthorizedAt = new Date();
    await tx.save();

    res.json({ success: true, depositStatus: 'authorized', depositDeadline: tx.depositDeadline });
  } catch (err) {
    console.error('[deposits] confirm error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /:txId/release — cancel the deposit hold (deal completed successfully within 3 days).
 * Seller only (triggered when seller marks transaction complete / confirms deal).
 * Also callable by admin.
 */
router.post('/:txId/release', authenticateToken, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Payment service unavailable' });

    const tx = await Transaction.findById(req.params.txId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const callerId = req.user.customerId || req.user.uid;
    const isSeller = customerId(tx.seller) === callerId;
    const isAdmin = req.user.isAdmin === true;
    if (!isSeller && !isAdmin) {
      return res.status(403).json({ error: 'Only the seller or an admin can release the deposit' });
    }

    if (tx.depositStatus !== 'authorized') {
      return res.status(400).json({ error: `Cannot release deposit in status: ${tx.depositStatus}` });
    }

    await stripe.paymentIntents.cancel(tx.depositPaymentIntentId);

    tx.depositStatus = 'released';
    tx.depositReleasedAt = new Date();
    await tx.save();

    res.json({ success: true, depositStatus: 'released' });
  } catch (err) {
    console.error('[deposits] release error', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
