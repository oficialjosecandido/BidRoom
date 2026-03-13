const express = require('express');
const Stripe = require('stripe');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const { sendEmail } = require('../services/emailService');

const LOG_PREFIX = '[Connect]';
const BIDROOMFEE_RATE = 0.02; // 2%
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

const router = express.Router();

router.use(authenticateToken);

/**
 * POST /api/connect/onboard
 * Creates (or retrieves) a Stripe Express account for the seller and returns the onboarding URL.
 */
router.post('/onboard', requireActiveAccount, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: 'Payments not configured' });
  }
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let accountId = user.stripeConnectAccountId;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email: user.email,
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { uid: user.uid }
      });
      accountId = account.id;
      user.stripeConnectAccountId = accountId;
      await user.save();
      console.log(`${LOG_PREFIX} Created Express account ${accountId} for uid=${user.uid?.slice(0, 8)}...`);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${FRONTEND_URL}/dashboard/my-account?stripe_onboard=refresh`,
      return_url: `${FRONTEND_URL}/dashboard/my-account?stripe_onboard=complete`,
      type: 'account_onboarding'
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    console.error(`${LOG_PREFIX} Onboard error:`, err.message);
    res.status(500).json({ error: 'Failed to create onboarding link', message: err.message });
  }
});

/**
 * GET /api/connect/account-status
 * Returns the seller's Stripe Connect account status.
 */
router.get('/account-status', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.json({ connected: false, onboarded: false });
  }
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('stripeConnectAccountId stripeConnectOnboarded');
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (!user.stripeConnectAccountId) {
      return res.json({ connected: false, onboarded: false });
    }

    // Retrieve fresh status from Stripe to keep local record in sync
    const account = await stripe.accounts.retrieve(user.stripeConnectAccountId);
    const onboarded = !!(account.details_submitted && account.charges_enabled);

    if (onboarded !== user.stripeConnectOnboarded) {
      user.stripeConnectOnboarded = onboarded;
      await user.save();
    }

    res.json({
      connected: true,
      onboarded,
      accountId: user.stripeConnectAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled
    });
  } catch (err) {
    console.error(`${LOG_PREFIX} Account status error:`, err.message);
    res.status(500).json({ error: 'Failed to retrieve account status', message: err.message });
  }
});

/**
 * POST /api/connect/create-checkout-session
 * Buyer initiates payment for a transaction.
 * Body: { transactionId }
 * Returns: { url } – Stripe Checkout URL
 */
router.post('/create-checkout-session', requireActiveAccount, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  try {
    const buyer = await User.findOne({ uid: req.user.uid });
    if (!buyer) return res.status(404).json({ error: 'User not found' });

    const { transactionId } = req.body;
    if (!transactionId) return res.status(400).json({ error: 'transactionId is required' });

    const transaction = await Transaction.findById(transactionId)
      .populate('listing', 'title commissionRate shippingCost shippingOption packageSize shippingOriginPostalCode shippingOriginCity shippingOriginCountry')
      .populate('seller', 'firstName lastName email stripeConnectAccountId stripeConnectOnboarded')
      .populate('buyer', '_id');

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    if (transaction.buyer._id.toString() !== buyer._id.toString()) {
      return res.status(403).json({ error: 'You are not the buyer for this transaction' });
    }

    const ts = transaction.transactionStatus ?? transaction.status;
    if (ts !== 'pending_payment') {
      return res.status(400).json({ error: 'This transaction does not require payment', message: `Status is: ${ts}` });
    }

    if (transaction.stripeCheckoutSessionId) {
      return res.status(400).json({ error: 'A Stripe checkout session already exists for this transaction' });
    }

    const seller = transaction.seller;
    if (!seller.stripeConnectAccountId || !seller.stripeConnectOnboarded) {
      return res.status(400).json({
        error: 'Seller not ready',
        message: 'The seller has not yet connected their Stripe account. Please contact the seller.'
      });
    }

    const itemAmount = transaction.amount; // dollars
    const listing = transaction.listing;

    // Shipping amount
    const shippingOpt = listing?.shippingOption || 'flat-rate';
    let shippingAmount = 0;
    if (shippingOpt === 'flat-rate') {
      shippingAmount = listing?.shippingCost ?? 0;
    } else if (shippingOpt === 'calculated') {
      if (transaction.shippingAmount == null) {
        return res.status(400).json({
          error: 'Shipping not selected',
          message: 'Please select a shipping method before proceeding to payment.'
        });
      }
      shippingAmount = transaction.shippingAmount;
    }
    // free / local-pickup = 0

    // BidRoom fee: 2% of item price, charged ON TOP (buyer pays it)
    const bidRoomFee = Math.round(itemAmount * BIDROOMFEE_RATE * 100) / 100;

    // Buyer total
    const buyerTotal = itemAmount + bidRoomFee + shippingAmount;

    // Stripe amounts in cents
    const itemCents = Math.round(itemAmount * 100);
    const bidRoomFeeCents = Math.round(bidRoomFee * 100);
    const shippingCents = Math.round(shippingAmount * 100);
    const buyerTotalCents = itemCents + bidRoomFeeCents + shippingCents;

    const lineItems = [
      {
        price_data: {
          currency: 'usd',
          product_data: { name: listing?.title || 'Auction item' },
          unit_amount: itemCents
        },
        quantity: 1
      },
      {
        price_data: {
          currency: 'usd',
          product_data: { name: 'BidRoom platform fee (2%)' },
          unit_amount: bidRoomFeeCents
        },
        quantity: 1
      }
    ];

    if (shippingCents > 0) {
      const shippingLabel = transaction.shippingCarrier && transaction.shippingService
        ? `Shipping – ${transaction.shippingCarrier} ${transaction.shippingService}`
        : 'Shipping';
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: shippingLabel },
          unit_amount: shippingCents
        },
        quantity: 1
      });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      payment_intent_data: {
        application_fee_amount: bidRoomFeeCents,
        transfer_data: { destination: seller.stripeConnectAccountId },
        metadata: {
          transactionId: transaction._id.toString(),
          buyerUid: buyer.uid,
          sellerAccountId: seller.stripeConnectAccountId
        }
      },
      success_url: `${FRONTEND_URL}/dashboard/transactions?stripe_payment=success&session_id={CHECKOUT_SESSION_ID}&transaction_id=${transaction._id}`,
      cancel_url: `${FRONTEND_URL}/dashboard/transactions?stripe_payment=cancelled&transaction_id=${transaction._id}`,
      metadata: {
        transactionId: transaction._id.toString(),
        buyerUid: buyer.uid
      }
    });

    // Store session ID on transaction
    transaction.stripeCheckoutSessionId = session.id;
    transaction.bidRoomFeeAmount = bidRoomFee;
    transaction.buyerTotalPaid = buyerTotal;
    await transaction.save();

    console.log(`${LOG_PREFIX} Checkout session created session_id=${session.id} transaction=${transaction._id} amount=$${buyerTotal}`);
    res.json({ url: session.url });
  } catch (err) {
    console.error(`${LOG_PREFIX} Create checkout session error:`, err.message);
    res.status(500).json({ error: 'Failed to create checkout session', message: err.message });
  }
});

/**
 * POST /api/connect/confirm-payment
 * Called by frontend after successful Stripe Checkout redirect.
 * Body: { sessionId, transactionId }
 * Updates transaction to awaiting_seller_acceptance if payment confirmed.
 */
router.post('/confirm-payment', requireActiveAccount, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  try {
    const buyer = await User.findOne({ uid: req.user.uid });
    if (!buyer) return res.status(404).json({ error: 'User not found' });

    const { sessionId, transactionId } = req.body;
    if (!sessionId || !transactionId) {
      return res.status(400).json({ error: 'sessionId and transactionId are required' });
    }

    const transaction = await Transaction.findById(transactionId)
      .populate('listing', 'title commissionRate shippingCost shippingOption handlingTime')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', '_id');

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    if (transaction.buyer._id.toString() !== buyer._id.toString()) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Idempotency: already confirmed
    const ts = transaction.transactionStatus ?? transaction.status;
    if (ts !== 'pending_payment') {
      const updated = await Transaction.findById(transactionId)
        .populate('listing', 'title slug images status commissionRate shippingCost shippingOption')
        .populate('seller', 'firstName lastName email')
        .populate('buyer', 'firstName lastName email')
        .lean();
      return res.json(updated);
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent.latest_charge.balance_transaction']
    });

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed', message: 'Stripe session is not paid yet.' });
    }

    if (session.metadata?.buyerUid !== buyer.uid) {
      return res.status(403).json({ error: 'Forbidden', message: 'Session does not belong to you.' });
    }

    // Extract Stripe processing fee from balance transaction
    const balanceTx = session.payment_intent?.latest_charge?.balance_transaction;
    const stripeFeeAmount = balanceTx ? balanceTx.fee / 100 : null;

    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

    // Set handling deadline
    const listing = await Listing.findById(transaction.listing).select('handlingTime').lean();
    const days = (listing?.handlingTime) ? Math.max(1, listing.handlingTime) : 3;
    const handlingDeadline = new Date();
    handlingDeadline.setDate(handlingDeadline.getDate() + days);

    // Seller payout = amount - BidRoom fee - Stripe fee
    const bidRoomFee = transaction.bidRoomFeeAmount ?? (transaction.amount * BIDROOMFEE_RATE);
    const sellerPayout = stripeFeeAmount !== null
      ? transaction.amount - bidRoomFee - stripeFeeAmount
      : transaction.amount - bidRoomFee;

    transaction.stripePaymentIntentId = paymentIntentId;
    transaction.stripeFeeAmount = stripeFeeAmount;
    transaction.sellerPayoutAmount = Math.max(0, sellerPayout);
    transaction.transactionStatus = 'awaiting_seller_acceptance';
    transaction.paymentStatus = 'paid';
    transaction.paidAt = new Date();
    transaction.handlingDeadline = handlingDeadline;
    const deadlinePa = new Date();
    deadlinePa.setDate(deadlinePa.getDate() + 5);
    transaction.paymentAcceptanceDeadline = deadlinePa;
    await transaction.save();

    await sendPaymentReceivedEmail(transaction);

    console.log(`${LOG_PREFIX} Payment confirmed transaction=${transactionId} pi=${paymentIntentId}`);

    const updated = await Transaction.findById(transactionId)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    res.json(updated);
  } catch (err) {
    console.error(`${LOG_PREFIX} Confirm payment error:`, err.message);
    res.status(500).json({ error: 'Failed to confirm payment', message: err.message });
  }
});

/**
 * Stripe Connect webhook handler.
 * Handles payment_intent.succeeded and account.updated events.
 */
function connectWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  const stripe = getStripe();

  if (!stripe) return res.status(503).send('Stripe not configured');
  if (!webhookSecret) {
    console.warn(`${LOG_PREFIX} STRIPE_CONNECT_WEBHOOK_SECRET not set — skipping signature verification`);
    return res.json({ received: true });
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
    handleCheckoutCompleted(session, stripe).catch(err =>
      console.error(`${LOG_PREFIX} Webhook handleCheckoutCompleted error:`, err.message)
    );
  }

  if (event.type === 'account.updated') {
    const account = event.data.object;
    handleAccountUpdated(account).catch(err =>
      console.error(`${LOG_PREFIX} Webhook handleAccountUpdated error:`, err.message)
    );
  }

  res.json({ received: true });
}

async function handleCheckoutCompleted(session, stripe) {
  const transactionId = session.metadata?.transactionId;
  if (!transactionId) return;

  const transaction = await Transaction.findById(transactionId)
    .populate('listing', 'handlingTime')
    .populate('seller', 'firstName lastName email')
    .populate('buyer', 'firstName lastName email');
  if (!transaction) return;

  const ts = transaction.transactionStatus ?? transaction.status;
  if (ts !== 'pending_payment') return; // Already processed

  const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ['payment_intent.latest_charge.balance_transaction']
  });

  const balanceTx = expandedSession.payment_intent?.latest_charge?.balance_transaction;
  const stripeFeeAmount = balanceTx ? balanceTx.fee / 100 : null;
  const paymentIntentId = typeof expandedSession.payment_intent === 'string'
    ? expandedSession.payment_intent
    : expandedSession.payment_intent?.id;

  const days = (transaction.listing?.handlingTime) ? Math.max(1, transaction.listing.handlingTime) : 3;
  const handlingDeadline = new Date();
  handlingDeadline.setDate(handlingDeadline.getDate() + days);

  const bidRoomFee = transaction.bidRoomFeeAmount ?? (transaction.amount * BIDROOMFEE_RATE);
  const sellerPayout = stripeFeeAmount !== null
    ? transaction.amount - bidRoomFee - stripeFeeAmount
    : transaction.amount - bidRoomFee;

  transaction.stripePaymentIntentId = paymentIntentId;
  transaction.stripeFeeAmount = stripeFeeAmount;
  transaction.sellerPayoutAmount = Math.max(0, sellerPayout);
  transaction.transactionStatus = 'awaiting_seller_acceptance';
  transaction.paymentStatus = 'paid';
  transaction.paidAt = new Date();
  transaction.handlingDeadline = handlingDeadline;
  const deadlinePa = new Date();
  deadlinePa.setDate(deadlinePa.getDate() + 5);
  transaction.paymentAcceptanceDeadline = deadlinePa;
  await transaction.save();

  await sendPaymentReceivedEmail(transaction);
  console.log(`${LOG_PREFIX} Webhook: transaction ${transactionId} marked awaiting_seller_acceptance`);
}

async function handleAccountUpdated(account) {
  if (!account.metadata?.uid) return;
  const onboarded = !!(account.details_submitted && account.charges_enabled);
  await User.updateOne({ uid: account.metadata.uid }, { stripeConnectOnboarded: onboarded });
  console.log(`${LOG_PREFIX} Account updated uid=${account.metadata.uid?.slice(0, 8)} onboarded=${onboarded}`);
}

async function sendPaymentReceivedEmail(transaction) {
  const seller = transaction.seller;
  const listing = transaction.listing;
  if (!seller?.email) return;

  const subject = 'Payment received for your listing – prepare to ship';
  const buyerName = [transaction.buyer?.firstName, transaction.buyer?.lastName].filter(Boolean).join(' ') || 'A buyer';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #7A4F84 0%, #9b6ba8 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0;">Payment received!</h1>
      </div>
      <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
        <p>Hi ${seller.firstName || 'Seller'},</p>
        <p><strong>${buyerName}</strong> has paid for your listing <strong>${listing?.title || 'your item'}</strong>.</p>
        <p>Please confirm you are ready to ship and mark the item as shipped once dispatched.</p>
        <p>Your payout of <strong>$${(transaction.sellerPayoutAmount ?? transaction.amount).toFixed(2)}</strong> will be sent to your Stripe account after shipping is confirmed.</p>
        <p>Best regards,<br>The BidRoom Team</p>
      </div>
    </div>
  `;
  try {
    await sendEmail(seller.email, subject, html);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to send payment received email:`, err.message);
  }
}

module.exports = { router, connectWebhookHandler };
