/**
 * KYC (Know Your Customer) routes — identity verification via Stripe Identity.
 * High-value listings (>= KYC_THRESHOLD) require approved KYC before bidding or listing.
 *
 * Env vars used:
 *   STRIPE_SECRET_KEY          — existing Stripe key (must have Identity product enabled)
 *   STRIPE_IDENTITY_WEBHOOK_SECRET — webhook signing secret for identity events
 *   FRONTEND_URL               — base URL for redirect after verification
 */

const express = require('express');
const Customer = require('../models/Customer');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const { getStripe } = require('../utils/stripe.util');

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

// ── GET /api/kyc/status ───────────────────────────────────────────────────────
// Returns the current user's KYC status (public-safe fields only).
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid })
      .select('kycStatus kycVerifiedAt kycRejectionReason kycSubmittedAt')
      .lean();

    if (!user) return res.json({ kycStatus: 'none', kycVerifiedAt: null, kycRejectionReason: null });

    res.json({
      kycStatus: user.kycStatus || 'none',
      kycVerifiedAt: user.kycVerifiedAt || null,
      kycRejectionReason: user.kycRejectionReason || null,
      kycSubmittedAt: user.kycSubmittedAt || null,
    });
  } catch (err) {
    console.error('GET /kyc/status error:', err);
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

// ── POST /api/kyc/session ─────────────────────────────────────────────────────
// Creates a Stripe Identity verification session for the authenticated user.
// If the user already has a pending session, returns a new one (Stripe handles idempotency).
router.post('/session', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: 'Identity verification is not configured', message: 'STRIPE_SECRET_KEY is not set.' });
    }

    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.kycStatus === 'approved') {
      return res.status(409).json({ error: 'Already verified', message: 'Your identity has already been verified.' });
    }

    const session = await stripe.identity.verificationSessions.create({
      type: 'document',
      metadata: { userId: user._id.toString(), userEmail: user.email },
      options: {
        document: {
          require_live_capture: true,
          require_matching_selfie: true,
        },
      },
      return_url: `${FRONTEND_URL}/dashboard?kyc_return=1`,
    });

    // Mark user as pending and store session ID
    await Customer.updateOne(
      { _id: user._id },
      { $set: { kycStatus: 'pending', kycStripeSessionId: session.id, kycSubmittedAt: new Date() } }
    );

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('POST /kyc/session error:', err);
    res.status(500).json({ error: 'Failed to create verification session', message: err.message });
  }
});

// ── POST /api/kyc/webhook ─────────────────────────────────────────────────────
// Stripe Identity webhook handler. Must receive raw body (registered before express.json() in index.js).
async function kycWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_IDENTITY_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('[KYC Webhook] STRIPE_IDENTITY_WEBHOOK_SECRET not set — skipping signature verification');
    // In dev/test you might skip verification; in production this is required
    return processKycWebhookEvent(req.body.toString(), res);
  }

  let event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[KYC Webhook] Signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature invalid' });
  }

  await processKycWebhookEvent(JSON.stringify(event), res, event);
}

async function processKycWebhookEvent(rawBody, res, event) {
  try {
    if (!event) event = JSON.parse(rawBody);
    const session = event.data?.object;
    if (!session?.metadata?.userId) return res.json({ received: true });

    const userId = session.metadata.userId;

    switch (event.type) {
      case 'identity.verification_session.verified':
        await Customer.updateOne(
          { _id: userId },
          { $set: { kycStatus: 'approved', kycVerifiedAt: new Date(), kycRejectionReason: null } }
        );
        console.log(`[KYC] ✅ User ${userId} identity verified`);
        break;

      case 'identity.verification_session.requires_input': {
        const error = session.last_error;
        const reason = error?.code || error?.reason || 'verification_failed';
        await Customer.updateOne(
          { _id: userId },
          { $set: { kycStatus: 'rejected', kycRejectionReason: reason } }
        );
        console.log(`[KYC] ❌ User ${userId} verification failed: ${reason}`);
        break;
      }

      case 'identity.verification_session.canceled':
        await Customer.updateOne(
          { _id: userId, kycStatus: 'pending' },
          { $set: { kycStatus: 'none', kycStripeSessionId: null } }
        );
        break;

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('[KYC Webhook] Processing error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = { router, kycWebhookHandler };
