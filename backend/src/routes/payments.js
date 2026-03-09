const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const stripeService = require('../services/stripeService');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const User = require('../models/User');

// ============================================================
// SELLER: Stripe Connect Account Management
// ============================================================

/**
 * POST /api/payments/connect/account
 * Create a Stripe Express connected account for the authenticated seller.
 */
router.post('/connect/account', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.stripeAccountId) {
      // Already has an account — return existing status
      const account = await stripeService.getConnectedAccount(user.stripeAccountId);
      return res.json({
        accountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        alreadyExists: true
      });
    }

    // Create new connected account
    const account = await stripeService.createConnectedAccount(
      user.email,
      user.firstName,
      user.lastName
    );

    // Save account ID to user
    user.stripeAccountId = account.id;
    await user.save();

    res.status(201).json({
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      alreadyExists: false
    });
  } catch (error) {
    console.error('Create connected account error:', error);
    res.status(500).json({ error: 'Failed to create Stripe account', message: error.message });
  }
});

/**
 * POST /api/payments/connect/account-link
 * Generate an onboarding link for the seller's Stripe connected account.
 */
router.post('/connect/account-link', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.stripeAccountId) {
      return res.status(400).json({ error: 'No Stripe account found. Create one first.' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const refreshUrl = `${frontendUrl}/dashboard/payments?setup=refresh`;
    const returnUrl = `${frontendUrl}/dashboard/payments?setup=complete`;

    const accountLink = await stripeService.createAccountLink(
      user.stripeAccountId,
      refreshUrl,
      returnUrl
    );

    res.json({ url: accountLink.url, expiresAt: accountLink.expires_at });
  } catch (error) {
    console.error('Create account link error:', error);
    res.status(500).json({ error: 'Failed to create onboarding link', message: error.message });
  }
});

/**
 * GET /api/payments/connect/status
 * Get the seller's Stripe Connect account status.
 */
router.get('/connect/status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.stripeAccountId) {
      return res.json({ connected: false, accountId: null });
    }

    const account = await stripeService.getConnectedAccount(user.stripeAccountId);
    res.json({
      connected: true,
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted
    });
  } catch (error) {
    console.error('Get connect status error:', error);
    res.status(500).json({ error: 'Failed to retrieve account status', message: error.message });
  }
});

// ============================================================
// BUYER: Payment Intent
// ============================================================

/**
 * POST /api/payments/create-payment-intent
 * Create a Payment Intent for a buyer who won an auction.
 * Body: { listingId }
 */
router.post('/create-payment-intent', authenticateToken, async (req, res) => {
  try {
    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ error: 'listingId is required' });

    const buyer = await User.findOne({ uid: req.user.uid });
    if (!buyer) return res.status(404).json({ error: 'User not found' });

    const listing = await Listing.findById(listingId).populate('seller winner');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Verify the authenticated user is the winner
    if (!listing.winner || listing.winner._id.toString() !== buyer._id.toString()) {
      return res.status(403).json({ error: 'You are not the winner of this auction' });
    }

    if (listing.status !== 'ended') {
      return res.status(400).json({ error: 'Auction has not ended yet' });
    }

    // Check for existing pending/processing transaction
    const existingTransaction = await Transaction.findOne({
      listing: listing._id,
      buyer: buyer._id,
      status: { $in: ['pending', 'processing', 'completed'] }
    });

    if (existingTransaction && existingTransaction.status === 'completed') {
      return res.status(400).json({ error: 'Payment already completed for this auction' });
    }

    // Get seller's Stripe account
    const seller = await User.findById(listing.seller._id || listing.seller);
    const sellerStripeAccountId = seller?.stripeAccountId || null;

    const itemPrice = listing.currentPrice;
    const { paymentIntent, fees, clientSecret } = await stripeService.createPaymentIntent(
      itemPrice,
      sellerStripeAccountId,
      {
        listingId: listing._id.toString(),
        listingTitle: listing.title,
        buyerId: buyer._id.toString(),
        sellerId: seller._id.toString()
      }
    );

    // Create or update transaction record
    let transaction;
    if (existingTransaction) {
      existingTransaction.stripePaymentIntentId = paymentIntent.id;
      existingTransaction.status = 'pending';
      existingTransaction.paymentInitiatedAt = new Date();
      transaction = await existingTransaction.save();
    } else {
      transaction = await Transaction.create({
        listing: listing._id,
        buyer: buyer._id,
        seller: seller._id,
        itemPrice: fees.itemPrice,
        bidRoomFee: fees.bidRoomFee,
        bidRoomFeeRate: fees.bidRoomFeeRate,
        stripeFee: fees.stripeFee,
        stripeFeeRate: fees.stripeFeeRate,
        stripeFixedFee: fees.stripeFixedFee,
        totalChargedToBuyer: fees.totalChargedToBuyer,
        stripeAmountInCents: fees.stripeAmountInCents,
        applicationFeeInCents: fees.applicationFeeInCents,
        sellerPayout: fees.sellerPayout,
        stripePaymentIntentId: paymentIntent.id,
        sellerStripeAccountId,
        status: 'pending',
        paymentInitiatedAt: new Date()
      });
    }

    res.json({
      clientSecret,
      transactionId: transaction._id,
      fees,
      stripePublicKey: process.env.STRIPE_PUBLIC_KEY
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent', message: error.message });
  }
});

// ============================================================
// TRANSACTIONS: List and Detail
// ============================================================

/**
 * GET /api/payments/transactions
 * Get all transactions for the authenticated user (as buyer or seller).
 * Query: ?role=buyer|seller&status=pending|completed|...
 */
router.get('/transactions', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { role, status, limit = 20, skip = 0 } = req.query;
    const query = {};

    if (role === 'buyer') {
      query.buyer = user._id;
    } else if (role === 'seller') {
      query.seller = user._id;
    } else {
      query.$or = [{ buyer: user._id }, { seller: user._id }];
    }

    if (status) {
      query.status = status;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .populate('listing', 'title slug images currentPrice')
        .populate('buyer', 'firstName lastName email')
        .populate('seller', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip))
        .lean(),
      Transaction.countDocuments(query)
    ]);

    res.json({ transactions, total, limit: parseInt(limit), skip: parseInt(skip) });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ error: 'Failed to retrieve transactions', message: error.message });
  }
});

/**
 * GET /api/payments/transactions/:id
 * Get a specific transaction (invoice) by ID.
 */
router.get('/transactions/:id', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const transaction = await Transaction.findById(req.params.id)
      .populate('listing', 'title slug images currentPrice category condition shippingOption shippingCost')
      .populate('buyer', 'firstName lastName email')
      .populate('seller', 'firstName lastName email')
      .lean();

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    // Only buyer or seller can view the transaction
    const isBuyer = transaction.buyer._id.toString() === user._id.toString();
    const isSeller = transaction.seller._id.toString() === user._id.toString();
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ transaction, role: isBuyer ? 'buyer' : 'seller' });
  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({ error: 'Failed to retrieve transaction', message: error.message });
  }
});

// ============================================================
// FEES: Preview fee calculation
// ============================================================

/**
 * GET /api/payments/fees?amount=100
 * Preview fee breakdown for a given amount.
 */
router.get('/fees', async (req, res) => {
  try {
    const amount = parseFloat(req.query.amount);
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required' });
    }
    const fees = stripeService.calculateFees(amount);
    res.json(fees);
  } catch (error) {
    res.status(500).json({ error: 'Failed to calculate fees', message: error.message });
  }
});

// ============================================================
// WEBHOOK: Stripe events
// ============================================================

/**
 * POST /api/payments/webhook
 * Handle Stripe webhook events.
 * NOTE: This route needs raw body — add express.raw middleware before parsing JSON.
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      event = stripeService.constructWebhookEvent(req.body, sig, webhookSecret);
    } else {
      // In development without webhook secret, parse body directly
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        const transaction = await Transaction.findOne({
          stripePaymentIntentId: paymentIntent.id
        });
        if (transaction) {
          transaction.status = 'completed';
          transaction.stripeChargeId = paymentIntent.latest_charge;
          transaction.paidAt = new Date();
          transaction.stripeEvents.push({
            eventId: event.id,
            eventType: event.type
          });
          await transaction.save();
          console.log(`✅ Payment succeeded for transaction ${transaction._id}`);
        }
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        const transaction = await Transaction.findOne({
          stripePaymentIntentId: paymentIntent.id
        });
        if (transaction) {
          transaction.status = 'failed';
          transaction.stripeEvents.push({
            eventId: event.id,
            eventType: event.type
          });
          await transaction.save();
          console.log(`❌ Payment failed for transaction ${transaction._id}`);
        }
        break;
      }

      case 'charge.dispute.created': {
        const dispute = event.data.object;
        const transaction = await Transaction.findOne({
          stripeChargeId: dispute.charge
        });
        if (transaction) {
          transaction.status = 'disputed';
          transaction.stripeEvents.push({
            eventId: event.id,
            eventType: event.type
          });
          await transaction.save();
        }
        break;
      }

      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
  } catch (err) {
    console.error('Error processing webhook event:', err.message);
  }

  res.json({ received: true });
});

module.exports = router;
