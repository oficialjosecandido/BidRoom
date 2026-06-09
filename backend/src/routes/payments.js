const express = require('express');
const Stripe = require('stripe');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const Customer = require('../models/Customer');
const Topup = require('../models/Topup');
const User = require('../models/User');
const { sendEmail } = require('../services/emailService');

const features = require('../config/features');
const { getStripe } = require('../utils/stripe.util');
const {
  formatMethodsResponse,
  loadUserForPaymentMethods,
  attachPaymentMethodToUser,
  setDefaultPaymentMethod,
  removePaymentMethod,
  confirmSetupIntent,
} = require('../services/paymentMethodService');
const LOG_PREFIX = '[Payments]';

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

const MIN_AMOUNT_DOLLARS = 5;
const MAX_AMOUNT_DOLLARS = 50000;

/**
 * POST /api/payments/create-checkout-session
 * Body: { amountDollars: number } (minimum 5, any amount allowed)
 * Returns: { url: string } - Stripe Checkout URL
 */
router.post('/create-checkout-session', authenticateToken, requireActiveAccount, async (req, res) => {
  if (!features.membershipTiers) {
    return res.status(403).json({ error: 'Feature disabled', message: 'Balance top-ups are not available.' });
  }
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return res.status(503).json({
        error: 'Payments are not configured',
        message: 'STRIPE_SECRET_KEY is not set.'
      });
    }

    const { amountDollars } = req.body;
    const amount = Number(amountDollars);
    if (Number.isNaN(amount) || amount < MIN_AMOUNT_DOLLARS || amount > MAX_AMOUNT_DOLLARS) {
      return res.status(400).json({
        error: 'Invalid amount',
        message: `Amount must be between $${MIN_AMOUNT_DOLLARS} and $${MAX_AMOUNT_DOLLARS}.`
      });
    }

    const amountCents = Math.round(amount * 100);
    if (amountCents < 500) {
      return res.status(400).json({
        error: 'Invalid amount',
        message: 'Minimum amount is $5.00.'
      });
    }
    const uid = req.user.uid;

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'BidRoom – Add balance',
              description: `Add $${amount.toFixed(2)} to your balance to secure your membership.`,
              images: []
            },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      mode: 'payment',
      success_url: `${FRONTEND_URL}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/dashboard?payment=cancelled`,
      metadata: {
        uid,
        amountDollars: String(amount)
      }
    });

    console.log(`${LOG_PREFIX} Checkout session created session_id=${session.id} amount=$${amount} uid=${uid?.slice(0, 8)}...`);
    res.json({ url: session.url });
  } catch (err) {
    console.error(`${LOG_PREFIX} Create checkout session error:`, err.message);
    res.status(500).json({
      error: 'Failed to create checkout session',
      message: err.message || 'Unknown error'
    });
  }
});

/**
 * POST /api/payments/confirm-session
 * Body: { session_id: string }
 * After Stripe Checkout success, frontend calls this with the session_id from the URL.
 * Backend retrieves the session from Stripe, verifies payment, credits balance (idempotent), and sends confirmation email.
 */
router.post('/confirm-session', authenticateToken, async (req, res) => {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({
        error: 'Payments are not configured',
        message: 'STRIPE_SECRET_KEY is not set.'
      });
    }

    const { session_id: sessionId } = req.body;
    if (!sessionId || typeof sessionId !== 'string') {
      console.log(`${LOG_PREFIX} confirm-session called without session_id`);
      return res.status(400).json({
        error: 'Missing session_id',
        message: 'Please provide the checkout session_id from the success URL.'
      });
    }

    console.log(`${LOG_PREFIX} confirm-session called session_id=${sessionId} uid=${req.user.uid?.slice(0, 8)}...`);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log(`${LOG_PREFIX} Session retrieved payment_status=${session.payment_status} metadata.uid=${session.metadata?.uid?.slice(0, 8)}...`);

    if (session.payment_status !== 'paid') {
      console.log(`${LOG_PREFIX} confirm-session rejected: payment not paid`);
      return res.status(400).json({
        error: 'Payment not completed',
        message: 'This session is not paid yet.'
      });
    }

    const uid = session.metadata?.uid;
    if (uid !== req.user.uid) {
      console.log(`${LOG_PREFIX} confirm-session rejected: uid mismatch`);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'This session does not belong to you.'
      });
    }

    await creditBalanceForSession(session);
    console.log(`${LOG_PREFIX} confirm-session completed for session_id=${sessionId}`);

    res.json({ success: true, message: 'Balance updated.' });
  } catch (err) {
    console.error(`${LOG_PREFIX} Confirm session error:`, err.message);
    res.status(500).json({
      error: 'Failed to confirm payment',
      message: err.message || 'Unknown error'
    });
  }
});

/**
 * GET /api/payments/topups
 * Returns the authenticated user's top-up history (most recent first).
 */
router.get('/topups', authenticateToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const topups = await Topup.find({ uid })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('amount currency createdAt stripeSessionId')
      .lean();
    res.json({ topups });
  } catch (err) {
    console.error(`${LOG_PREFIX} Get topups error:`, err.message);
    res.status(500).json({
      error: 'Failed to load top-up history',
      message: err.message || 'Unknown error'
    });
  }
});

/**
 * POST /api/payments/setup-intent
 * Creates a Stripe SetupIntent so the buyer can save a card for off-session dispute charges.
 * Returns { clientSecret, customerId }.
 */
router.post('/setup-intent', authenticateToken, requireActiveAccount, async (req, res) => {
  const PREFIX = '[SetupIntent]';
  try {
    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

    const user = await User.findOne({ uid: req.user.uid }).select('stripeCustomerId email firstName lastName');
    if (!user) return res.status(404).json({ error: 'User not found' });

    let customerId = user.stripeCustomerId;

    // Helper: create a fresh Stripe customer on the current account
    const createCustomer = async () => {
      const customer = await stripe.customers.create({
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        metadata: { uid: req.user.uid },
      });
      await User.findOneAndUpdate({ uid: req.user.uid }, { stripeCustomerId: customer.id });
      console.log(`${PREFIX} Created Stripe Customer ${customer.id} for uid=${req.user.uid?.slice(0, 8)}...`);
      return customer.id;
    };

    if (!customerId) {
      customerId = await createCustomer();
    }

    let setupIntent;
    try {
      setupIntent = await stripe.setupIntents.create({
        customer: customerId,
        usage: 'off_session',
        payment_method_types: ['card'],
        metadata: { uid: req.user.uid },
      });
    } catch (siErr) {
      // Stored customer belongs to a different Stripe account (e.g. after key rotation).
      // Create a fresh customer on the current account and retry once.
      if (siErr.code === 'resource_missing' || siErr.type === 'invalid_request_error') {
        console.warn(`${PREFIX} Stored customer ${customerId} invalid — creating new one and retrying`);
        customerId = await createCustomer();
        setupIntent = await stripe.setupIntents.create({
          customer: customerId,
          usage: 'off_session',
          payment_method_types: ['card'],
          metadata: { uid: req.user.uid },
        });
      } else {
        throw siErr;
      }
    }

    res.json({ clientSecret: setupIntent.client_secret, customerId });
  } catch (err) {
    console.error('[SetupIntent] Error:', err.message);
    res.status(500).json({ error: 'Failed to create setup intent' });
  }
});

/**
 * GET /api/payments/payment-method
 * Returns all saved cards and current trust tier.
 */
router.get('/payment-method', authenticateToken, async (req, res) => {
  try {
    const user = await loadUserForPaymentMethods(req.user.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isModified('savedPaymentMethods')) await user.save();
    res.json(formatMethodsResponse(user));
  } catch (err) {
    console.error('[GetPaymentMethod] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch payment method' });
  }
});

/**
 * POST /api/payments/payment-method/confirm
 * Body: { setupIntentId: string }
 * Persists a card immediately after Stripe confirmCardSetup (no webhook wait).
 */
router.post('/payment-method/confirm', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const { setupIntentId } = req.body;
    if (!setupIntentId || typeof setupIntentId !== 'string') {
      return res.status(400).json({ error: 'setupIntentId is required' });
    }
    const result = await confirmSetupIntent(req.user.uid, setupIntentId);
    res.json(result);
  } catch (err) {
    if (err.code === 'FORBIDDEN') return res.status(403).json({ error: err.message });
    if (err.code === 'SETUP_INCOMPLETE') return res.status(400).json({ error: err.message });
    console.error('[ConfirmPaymentMethod] Error:', err.message);
    res.status(500).json({ error: 'Failed to save payment method' });
  }
});

/**
 * PATCH /api/payments/payment-method/:paymentMethodId/default
 */
router.patch('/payment-method/:paymentMethodId/default', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const result = await setDefaultPaymentMethod(req.user.uid, req.params.paymentMethodId);
    res.json(result);
  } catch (err) {
    if (err.message === 'Payment method not found') return res.status(404).json({ error: err.message });
    console.error('[SetDefaultPaymentMethod] Error:', err.message);
    res.status(500).json({ error: 'Failed to update default payment method' });
  }
});

/**
 * DELETE /api/payments/payment-method/:paymentMethodId
 * Cannot remove default or the only remaining method. Blocked during active disputes.
 */
router.delete('/payment-method/:paymentMethodId', authenticateToken, requireActiveAccount, async (req, res) => {
  const PREFIX = '[DeletePaymentMethod]';
  try {
    const buyer = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!buyer) return res.status(404).json({ error: 'User not found' });

    const Transaction = require('../models/Transaction');
    const activeDispute = await Transaction.findOne({
      buyer: buyer._id,
      disputeOpen: true,
      disputeAdminVerdict: null,
    }).lean();
    if (activeDispute) {
      return res.status(409).json({
        error: 'Active dispute',
        message: 'Cannot remove payment method while a dispute is pending.',
      });
    }

    const result = await removePaymentMethod(req.user.uid, req.params.paymentMethodId);
    console.log(`${PREFIX} Detached PM ${req.params.paymentMethodId} for uid=${req.user.uid?.slice(0, 8)}...`);
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.code === 'DEFAULT_PAYMENT_METHOD') {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    if (err.code === 'ONLY_PAYMENT_METHOD') {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    if (err.message === 'Payment method not found') return res.status(404).json({ error: err.message });
    console.error('[DeletePaymentMethod] Error:', err.message);
    res.status(500).json({ error: 'Failed to remove payment method' });
  }
});

/**
 * Send payment confirmation email after balance is credited.
 */
async function sendPaymentConfirmationEmail(toEmail, firstName, amountDollars) {
  const amountStr = `$${Number(amountDollars).toFixed(2)}`;
  const subject = 'Payment received – your BidRoom balance has been updated';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #7A4F84 0%, #9b6ba8 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0;">Payment confirmed</h1>
      </div>
      <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
        <p>Hi ${firstName},</p>
        <p>We've received your payment of <strong>${amountStr}</strong>. Your balance has been updated and is ready to use for auctions and offers.</p>
        <p>Thank you for using BidRoom.</p>
        <p>Best regards,<br>The BidRoom Team</p>
      </div>
    </div>
  `;
  try {
    await sendEmail(toEmail, subject, html);
    console.log(`${LOG_PREFIX} Confirmation email sent to ${toEmail} amount=${amountStr}`);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to send payment confirmation email to ${toEmail}:`, err.message);
    if (err.message && err.message.includes('535')) {
      console.warn(`${LOG_PREFIX} Gmail SMTP auth failed: set EMAIL_USER and EMAIL_PASSWORD (use a Gmail App Password) in your environment.`);
    }
  }
}

/**
 * Credit customer balance for a Stripe checkout session (idempotent).
 * Called from webhook and from confirm-session. Sends confirmation email.
 */
async function creditBalanceForSession(session) {
  const sessionId = session.id;
  const uid = session.metadata?.uid;
  const amountDollars = Number(session.metadata?.amountDollars) || (session.amount_total / 100);

  console.log(`${LOG_PREFIX} creditBalanceForSession session_id=${sessionId} uid=${uid?.slice(0, 8)}... amount=$${amountDollars}`);

  if (!sessionId || !uid || amountDollars <= 0) {
    console.log(`${LOG_PREFIX} creditBalanceForSession skipped: missing sessionId/uid or invalid amount`);
    return;
  }

  const customer = await Customer.findOne({ uid });
  if (!customer) {
    console.log(`${LOG_PREFIX} creditBalanceForSession skipped: no customer found for uid=${uid?.slice(0, 8)}...`);
    return;
  }
  if ((customer.creditedStripeSessionIds || []).includes(sessionId)) {
    console.log(`${LOG_PREFIX} creditBalanceForSession skipped: session_id=${sessionId} already credited (idempotent)`);
    return;
  }

  await Customer.updateOne(
    { uid },
    {
      $inc: { balance: amountDollars },
      $push: { creditedStripeSessionIds: sessionId }
    }
  );

  try {
    await Topup.create({
      uid,
      amount: amountDollars,
      stripeSessionId: sessionId,
      currency: 'usd'
    });
  } catch (err) {
    if (err.code === 11000) {
      console.log(`${LOG_PREFIX} Topup already recorded for session_id=${sessionId} (duplicate)`);
    } else {
      console.error(`${LOG_PREFIX} Failed to save topup record:`, err.message);
    }
  }

  console.log(`${LOG_PREFIX} Balance credited +$${amountDollars} for uid=${uid?.slice(0, 8)}... new balance would be ~$${(customer.balance || 0) + amountDollars}`);

  await sendPaymentConfirmationEmail(customer.email, customer.firstName, amountDollars);
}

/**
 * Webhook handler for Stripe (must be used with express.raw() for body).
 * Usage in index.js: app.use('/api/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
 */
function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn(`${LOG_PREFIX} Webhook received but STRIPE_WEBHOOK_SECRET not set`);
    return res.status(503).send('Webhook not configured');
  }
  const stripe = getStripe();
  if (!stripe) {
    console.warn(`${LOG_PREFIX} Webhook received but Stripe not configured`);
    return res.status(503).send('Stripe not configured');
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error(`${LOG_PREFIX} Webhook signature verification failed:`, err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  console.log(`${LOG_PREFIX} Webhook received type=${event.type} id=${event.id}`);
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log(`${LOG_PREFIX} Webhook checkout.session.completed session_id=${session.id}`);
    creditBalanceForSession(session).catch((err) =>
      console.error(`${LOG_PREFIX} Webhook: failed to credit balance:`, err.message)
    );
  }
  if (event.type === 'setup_intent.succeeded') {
    handleSetupIntentSucceeded(event.data.object).catch(err =>
      console.error(`${LOG_PREFIX} setup_intent.succeeded error:`, err.message)
    );
  }
  res.json({ received: true });
}

async function handleSetupIntentSucceeded(setupIntent) {
  const uid = setupIntent.metadata?.uid;
  if (!uid) {
    console.warn('[SetupIntent Webhook] No uid in metadata — skipping');
    return;
  }
  const pmId = setupIntent.payment_method;
  if (!pmId) return;

  try {
    await attachPaymentMethodToUser(uid, pmId);
    console.log(`[SetupIntent Webhook] ✅ PM saved uid=${uid?.slice(0, 8)}... pm=${pmId}`);
  } catch (err) {
    console.error('[SetupIntent Webhook] Failed to save PM:', err.message);
  }
}

module.exports = { router, creditBalanceForSession, stripeWebhookHandler, handleSetupIntentSucceeded };
