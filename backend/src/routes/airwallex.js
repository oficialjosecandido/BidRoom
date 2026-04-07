/**
 * Airwallex routes
 *
 * POST /api/airwallex/onboard            — create/fetch connected account for seller
 * GET  /api/airwallex/kyc-token          — get embedded KYC token for seller
 * POST /api/airwallex/payment-intent     — create PaymentIntent (pre-auth / manual capture)
 * POST /api/airwallex/capture/:txId      — buyer confirms receipt → capture funds
 * POST /api/airwallex/webhook            — Airwallex event webhook
 *
 * Payment flow:
 *   createPaymentIntent → pre-auth holds funds (14-day window)
 *   webhook requires_capture → transactionStatus = 'authorized'
 *   seller ships → transactionStatus = 'shipped'
 *   buyer confirms receipt → capture → transactionStatus = 'delivered'
 *   T+3 cron → escrow released → transactionStatus = 'completed'
 *
 * Fee structure (4% total platform revenue):
 *   Buyer pays:  itemPrice + 2% buyer_fee + shipping  = buyerTotal
 *   Seller gets: itemPrice - 2% seller_fee            = sellerAmount
 *   Platform:    buyer_fee + seller_fee               = totalFee
 */

const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const {
  createConnectedAccount,
  getConnectedAccount,
  createKycClientSecret,
  createPaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  getPaymentIntent,
  createRefund,
  verifyWebhookSignature
} = require('../services/airwallexService');
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../services/templateEngine');
const { emitNewNotificationToUser } = require('../services/notificationService');

const router = express.Router();

// Platform fee rates
const BUYER_FEE_RATE  = 0.02; // 2% added on top of item price
const SELLER_FEE_RATE = 0.02; // 2% deducted from item price

// ── Seller onboarding ─────────────────────────────────────────────────────────

/**
 * POST /api/airwallex/onboard
 * Creates (or returns existing) Airwallex connected account for the authenticated seller.
 * Response: { accountId, kycStatus, onboarded }
 */
router.post('/onboard', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.airwallexAccountId) {
      try {
        const account = await getConnectedAccount(user.airwallexAccountId);
        const kycStatus = account.status === 'ACTIVE' ? 'approved' : user.airwallexKycStatus;
        if (kycStatus !== user.airwallexKycStatus || (kycStatus === 'approved' && !user.airwallexOnboarded)) {
          user.airwallexKycStatus = kycStatus;
          user.airwallexOnboarded = kycStatus === 'approved';
          await user.save();
        }
      } catch (_) { /* use cached data if API temporarily unavailable */ }
      return res.json({
        accountId: user.airwallexAccountId,
        kycStatus: user.airwallexKycStatus,
        onboarded: user.airwallexOnboarded
      });
    }

    const account = await createConnectedAccount({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    });

    user.airwallexAccountId = account.id;
    user.airwallexKycStatus = 'pending';
    user.airwallexOnboarded = false;
    await user.save();

    res.json({ accountId: account.id, kycStatus: 'pending', onboarded: false });
  } catch (err) {
    console.error('[Airwallex] onboard error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create Airwallex account', message: err.message });
  }
});

/**
 * GET /api/airwallex/kyc-token
 * Returns a short-lived token the frontend uses to mount the embedded KYC widget.
 */
router.get('/kyc-token', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('airwallexAccountId airwallexOnboarded');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.airwallexAccountId) {
      return res.status(400).json({ error: 'No Airwallex account. Call /onboard first.' });
    }
    if (user.airwallexOnboarded) return res.json({ alreadyOnboarded: true });
    const data = await createKycClientSecret(user.airwallexAccountId);
    res.json({ token: data.token, expiresAt: data.expires_at });
  } catch (err) {
    console.error('[Airwallex] kyc-token error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to generate KYC token', message: err.message });
  }
});

// ── Payment ───────────────────────────────────────────────────────────────────

/**
 * POST /api/airwallex/payment-intent
 * Body: { transactionId }
 *
 * Creates a manual-capture PaymentIntent (14-day pre-auth hold).
 * Funds are NOT moved until the buyer confirms receipt.
 *
 * Fee breakdown stored on the transaction:
 *   buyerFeeAmount   = itemPrice * 2%
 *   sellerFeeAmount  = itemPrice * 2%
 *   totalFeeAmount   = buyerFee + sellerFee  (platform revenue)
 *   buyerTotalPaid   = itemPrice + buyerFee + shipping
 *   sellerPayoutAmount = itemPrice - sellerFee
 */
router.post('/payment-intent', authenticateToken, async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId) return res.status(400).json({ error: 'transactionId required' });

    const tx = await Transaction.findById(transactionId)
      .populate('seller', 'airwallexAccountId airwallexOnboarded firstName lastName')
      .populate('listing', 'title');

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    if (tx.buyer.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the buyer can initiate payment' });
    }
    if (tx.transactionStatus !== 'pending_payment') {
      return res.status(400).json({ error: `Transaction already in state: ${tx.transactionStatus}` });
    }

    // Reuse existing intent if already created (idempotent)
    if (tx.airwallexPaymentIntentId && tx.airwallexClientSecret) {
      return res.json({
        intentId: tx.airwallexPaymentIntentId,
        clientSecret: tx.airwallexClientSecret,
        buyerFeeAmount: tx.bidRoomFeeAmount,
        buyerTotalPaid: tx.buyerTotalPaid
      });
    }

    const itemPrice     = tx.amount;
    const shippingAmt   = tx.shippingAmount || 0;
    const buyerFee      = round2(itemPrice * BUYER_FEE_RATE);
    const sellerFee     = round2(itemPrice * SELLER_FEE_RATE);
    const totalFee      = round2(buyerFee + sellerFee);
    const sellerPayout  = round2(itemPrice - sellerFee);
    const buyerTotal    = round2(itemPrice + buyerFee + shippingAmt);

    const intent = await createPaymentIntent({
      buyerTotal,
      sellerAmount: sellerPayout,
      totalFeeAmount: totalFee,
      currency: 'USD',
      sellerAccountId: tx.seller?.airwallexAccountId || null,
      transactionId: tx._id.toString(),
      listingTitle: tx.listing?.title
    });

    await Transaction.findByIdAndUpdate(tx._id, {
      $set: {
        airwallexPaymentIntentId: intent.id,
        airwallexClientSecret: intent.client_secret,
        bidRoomFeeAmount: totalFee,      // total platform fee (4%)
        sellerPayoutAmount: sellerPayout,
        buyerTotalPaid: buyerTotal
      }
    }, { runValidators: false });

    res.json({
      intentId: intent.id,
      clientSecret: intent.client_secret,
      buyerFeeAmount: buyerFee,
      sellerFeeAmount: sellerFee,
      buyerTotalPaid: buyerTotal
    });
  } catch (err) {
    console.error('[Airwallex] payment-intent error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment intent', message: err.message });
  }
});

/**
 * POST /api/airwallex/capture/:transactionId
 * Buyer confirms receipt ("Got the items") → capture the pre-auth hold.
 *
 * Airwallex will:
 *   - Move funds from "authorized" to "succeeded"
 *   - Execute the split_amount: route sellerPayoutAmount to seller's connected account
 *   - BidRoom platform fee remains in master wallet
 *
 * After capture the escrow T+3 window begins (seller cannot withdraw for 3 days).
 */
router.post('/capture/:transactionId', authenticateToken, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.transactionId)
      .populate('buyer', '_id uid email firstName')
      .populate('seller', '_id uid email firstName')
      .populate('listing', 'title');

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    if (tx.buyer._id.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Only the buyer can confirm receipt' });
    }

    const allowedStatuses = ['authorized', 'shipped'];
    if (!allowedStatuses.includes(tx.transactionStatus)) {
      return res.status(400).json({
        error: `Cannot capture in state: ${tx.transactionStatus}`,
        message: 'Transaction must be authorized or shipped for receipt confirmation.'
      });
    }

    if (!tx.airwallexPaymentIntentId) {
      return res.status(400).json({ error: 'No payment intent associated with this transaction' });
    }

    // Capture — funds move, split executes
    await capturePaymentIntent(tx.airwallexPaymentIntentId, tx.buyerTotalPaid);

    const capturedAt = new Date();
    const escrowReleasesAt = new Date(capturedAt.getTime() + 3 * 24 * 60 * 60 * 1000); // T+3

    await Transaction.findByIdAndUpdate(tx._id, {
      $set: {
        transactionStatus: 'delivered',
        paymentStatus: 'paid',
        capturedAt,
        paidAt: capturedAt,
        escrowStatus: 'pending_inspection',
        escrowReleasesAt
      }
    }, { runValidators: false });

    const io = req.app.get('io');
    if (io) {
      const sellerUid = tx.seller?.uid;
      if (sellerUid) {
        io.to(`user:${sellerUid}`).emit('transaction-updated', { transactionId: tx._id });
        emitNewNotificationToUser(io, tx.seller._id.toString()).catch(() => {});
      }
    }

    // Email seller — funds are being processed
    try {
      const tpl = renderEmailTemplate('airwallexPaymentConfirmed', 'en', {
        recipientName: tx.seller?.firstName || 'Seller',
        listingTitle: tx.listing?.title || 'your item',
        role: 'seller'
      });
      if (tpl && tx.seller?.email) {
        await sendEmail(tx.seller.email, tpl.subject, tpl.html).catch(() => {});
      }
    } catch (_) {}

    res.json({ success: true, escrowReleasesAt });
  } catch (err) {
    console.error('[Airwallex] capture error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to capture payment', message: err.message });
  }
});

// ── Webhook ───────────────────────────────────────────────────────────────────

/**
 * POST /api/airwallex/webhook
 * Raw body attached as req.rawBody by index.js.
 *
 * Subscribed events:
 *   payment_intent.requires_capture  → pre-auth success, status = 'authorized'
 *   payment_intent.captured          → capture success, status updated by /capture route
 *   payment_intent.expired           → 14-day hold expired without capture — alert admin
 *   payment_intent.cancelled         → void / cancellation
 *   account.updated                  → seller KYC status change
 *   refund.succeeded                 → refund confirmed
 */
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-signature'];

  if (!verifyWebhookSignature(req.rawBody, signature)) {
    console.warn('[Airwallex] Webhook signature mismatch');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(req.rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { name: eventName, data } = event;
  console.log(`[Airwallex] Webhook received: ${eventName}`);

  try {
    switch (eventName) {
      case 'payment_intent.requires_capture':
        await handleRequiresCapture(data, req.app.get('io'));
        break;
      case 'payment_intent.captured':
        // The /capture route already updates the DB; this is a confirmation log
        await handleCaptured(data);
        break;
      case 'payment_intent.expired':
        await handleIntentExpired(data, req.app.get('io'));
        break;
      case 'payment_intent.cancelled':
        await handlePaymentCancelled(data);
        break;
      case 'account.updated':
        await handleAccountUpdated(data);
        break;
      case 'refund.succeeded':
        await handleRefundSucceeded(data);
        break;
    }
  } catch (handlerErr) {
    // Log but return 200 — prevents Airwallex from retrying indefinitely
    console.error(`[Airwallex] Handler error (${eventName}):`, handlerErr.message);
  }

  res.json({ received: true });
});

// ── Webhook handlers ──────────────────────────────────────────────────────────

/**
 * payment_intent.requires_capture
 * Pre-auth hold placed successfully. Move transaction to 'authorized'.
 * `data.next_action.capture_before` gives the expiry (typically 14 days from now).
 */
async function handleRequiresCapture(data, io) {
  const intentId = data?.id;
  if (!intentId) return;

  const tx = await Transaction.findOne({ airwallexPaymentIntentId: intentId })
    .populate('buyer', 'uid email firstName')
    .populate('seller', 'email firstName')
    .populate('listing', 'title');

  if (!tx) {
    console.warn(`[Airwallex] requires_capture — no tx for intentId=${intentId}`);
    return;
  }
  if (tx.transactionStatus !== 'pending_payment') return;

  // capture_before from Airwallex tells us the hard deadline
  const captureBefore = data?.next_action?.capture_before
    ? new Date(data.next_action.capture_before)
    : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  await Transaction.findByIdAndUpdate(tx._id, {
    $set: {
      transactionStatus: 'authorized',
      paymentStatus: 'authorized',
      authorizedAt: new Date(),
      intentExpiresAt: captureBefore
    }
  }, { runValidators: false });

  console.log(`[Airwallex] Pre-auth confirmed txId=${tx._id} expiresAt=${captureBefore.toISOString()}`);

  // Notify seller they can prepare to ship
  if (io && tx.seller?.uid) {
    io.to(`user:${tx.seller.uid}`).emit('transaction-updated', { transactionId: tx._id });
  }

  // Email buyer + seller
  try {
    const listingTitle = tx.listing?.title || 'your item';
    if (tx.buyer?.email) {
      const tpl = renderEmailTemplate('airwallexPaymentConfirmed', 'en', {
        recipientName: tx.buyer.firstName,
        listingTitle,
        role: 'buyer'
      });
      if (tpl) await sendEmail(tx.buyer.email, tpl.subject, tpl.html).catch(() => {});
    }
    if (tx.seller?.email) {
      const tpl = renderEmailTemplate('airwallexPaymentConfirmed', 'en', {
        recipientName: tx.seller.firstName,
        listingTitle,
        role: 'seller'
      });
      if (tpl) await sendEmail(tx.seller.email, tpl.subject, tpl.html).catch(() => {});
    }
  } catch (_) {}
}

/**
 * payment_intent.captured
 * Confirmation that capture succeeded (may fire after our /capture route has already updated DB).
 */
async function handleCaptured(data) {
  const intentId = data?.id;
  if (!intentId) return;
  // Idempotent: only update if not already delivered/completed
  await Transaction.findOneAndUpdate(
    {
      airwallexPaymentIntentId: intentId,
      transactionStatus: { $in: ['authorized', 'shipped'] }
    },
    {
      $set: {
        transactionStatus: 'delivered',
        paymentStatus: 'paid',
        capturedAt: new Date(),
        paidAt: new Date(),
        escrowStatus: 'pending_inspection',
        escrowReleasesAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      }
    },
    { runValidators: false }
  );
}

/**
 * payment_intent.expired
 * The 14-day authorization window closed without capture.
 * We must re-authorize or alert admin — funds are released back to the buyer's card.
 */
async function handleIntentExpired(data, io) {
  const intentId = data?.id;
  if (!intentId) return;

  const tx = await Transaction.findOneAndUpdate(
    { airwallexPaymentIntentId: intentId, transactionStatus: { $in: ['authorized', 'shipped'] } },
    { $set: { transactionStatus: 'pending_payment', paymentStatus: 'pending', authorizedAt: null, intentExpiresAt: null } },
    { new: true, runValidators: false }
  ).populate('buyer', 'uid email firstName').populate('seller', 'email firstName').populate('listing', 'title');

  if (!tx) return;

  console.warn(`[Airwallex] HOLD EXPIRED — txId=${tx._id} buyer must re-authorize`);

  // Notify admin via console + notification; notify buyer to re-authorize
  try {
    const { notifyUser } = require('../services/notificationService');
    await notifyUser?.({
      userId: tx.buyer?._id?.toString(),
      title: 'Payment re-authorization required',
      message: `Your payment hold for "${tx.listing?.title || 'your item'}" has expired. Please re-authorize to continue your purchase.`,
      type: 'payment_expired',
      listingSlug: tx.listing?.slug
    }).catch(() => {});
  } catch (_) {}

  if (io && tx.buyer?.uid) {
    io.to(`user:${tx.buyer.uid}`).emit('transaction-updated', { transactionId: tx._id });
  }
}

/**
 * payment_intent.cancelled
 * Void / cancellation (buyer abandoned or admin voided hold).
 */
async function handlePaymentCancelled(data) {
  const intentId = data?.id;
  if (!intentId) return;
  await Transaction.findOneAndUpdate(
    { airwallexPaymentIntentId: intentId, transactionStatus: { $in: ['pending_payment', 'authorized'] } },
    { $set: { transactionStatus: 'cancelled' } },
    { runValidators: false }
  );
}

/**
 * account.updated
 * Seller KYC status change from Airwallex.
 */
async function handleAccountUpdated(data) {
  const accountId = data?.id;
  if (!accountId) return;
  const isApproved = data?.status === 'ACTIVE';
  const kycStatus = isApproved ? 'approved'
    : data?.status === 'IN_REVIEW' ? 'in_review'
    : 'failed';

  await User.findOneAndUpdate(
    { airwallexAccountId: accountId },
    { $set: { airwallexKycStatus: kycStatus, airwallexOnboarded: isApproved } },
    { runValidators: false }
  );
}

/**
 * refund.succeeded
 * Refund confirmed — store refund ID on transaction.
 */
async function handleRefundSucceeded(data) {
  const intentId = data?.payment_intent_id;
  const refundId = data?.id;
  if (!intentId || !refundId) return;
  await Transaction.findOneAndUpdate(
    { airwallexPaymentIntentId: intentId },
    { $set: { airwallexRefundId: refundId, escrowStatus: 'refunded' } },
    { runValidators: false }
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = router;
