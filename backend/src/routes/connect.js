const express = require('express');
const Stripe = require('stripe');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const { sendEmail } = require('../services/emailService');
const { notifySellerPaymentReceived, emitNewNotificationToUser } = require('../services/notificationService');
const { applyShippingDeadlinesFromPaidAt } = require('../services/shippingDeadlines');

const LOG_PREFIX = '[Connect]';
const BIDROOMFEE_RATE = 0.04; // 4% — charged to seller via transfer_data.amount
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

/**
 * Extract the real public client IP from the request.
 * Azure (and other proxies) may inject X-Forwarded-For with multiple IPs,
 * or the socket address may be an IPv6-mapped IPv4 (::ffff:x.x.x.x) or
 * a private/internal IP. Stripe requires a valid public IPv4 for tos_acceptance.
 */
function getClientIp(req) {
  const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');

  // In test mode Stripe accepts any IP — skip detection entirely to avoid
  // Azure internal IPs (100.x.x.x CGNAT range) slipping through as "public".
  if (isTestMode) {
    return '127.0.0.1';
  }

  const normalize = (raw) => {
    if (!raw) return null;
    const trimmed = raw.trim();
    // Convert IPv6-mapped IPv4 e.g. "::ffff:1.2.3.4" → "1.2.3.4"
    if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
    return trimmed;
  };

  const isPublic = (ip) => {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return false;
    // Private IPv4 ranges (RFC 1918)
    if (ip.startsWith('10.')) return false;
    if (ip.startsWith('192.168.')) return false;
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip)) return false;
    // CGNAT range (RFC 6598) — used by Azure App Service internally (100.64–100.127)
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return false;
    // Link-local (169.254.x.x)
    if (ip.startsWith('169.254.')) return false;
    // Valid IPv4
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return true;
    // Valid IPv6 (non-loopback, non-link-local, non-ULA)
    if (ip.includes(':') && !ip.startsWith('fe80') && !ip.startsWith('fc') && !ip.startsWith('fd')) return true;
    return false;
  };

  // Try each IP in X-Forwarded-For (leftmost = real client)
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    for (const raw of forwarded.split(',')) {
      const ip = normalize(raw);
      if (isPublic(ip)) return ip;
    }
  }

  // Try Express's req.ip (honours trust proxy setting)
  const expressIp = normalize(req.ip);
  if (isPublic(expressIp)) return expressIp;

  const socketIp = normalize(req.socket?.remoteAddress || req.connection?.remoteAddress);
  if (isPublic(socketIp)) return socketIp;

  return null;
}

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

const router = express.Router();

router.use(authenticateToken);

// Maps ISO 3166-1 alpha-2 country code → default payout currency
const COUNTRY_CURRENCY = {
  AT: 'eur', BE: 'eur', CY: 'eur', DE: 'eur', EE: 'eur', ES: 'eur',
  FI: 'eur', FR: 'eur', GR: 'eur', HR: 'eur', IE: 'eur', IT: 'eur',
  LT: 'eur', LU: 'eur', LV: 'eur', MT: 'eur', NL: 'eur', PT: 'eur',
  SI: 'eur', SK: 'eur', GB: 'gbp', US: 'usd', CA: 'cad', AU: 'aud',
  NZ: 'nzd', CH: 'chf', SE: 'sek', DK: 'dkk', NO: 'nok', PL: 'pln',
  CZ: 'czk', HU: 'huf', RO: 'ron', BG: 'bgn', MX: 'mxn', BR: 'brl',
  SG: 'sgd', HK: 'hkd', JP: 'jpy', IN: 'inr', ZA: 'zar'
};

/**
 * POST /api/connect/submit-onboarding
 * Creates (or updates) a Stripe Custom account for the seller using their KYC data.
 * Body: { dobDay, dobMonth, dobYear, addressLine1, addressCity, addressPostal, addressCountry, iban, tosAccepted }
 */
router.post('/submit-onboarding', requireActiveAccount, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  const {
    dobDay, dobMonth, dobYear,
    addressLine1, addressCity, addressPostal, addressCountry,
    iban, tosAccepted
  } = req.body;

  // Validate required fields
  if (!dobDay || !dobMonth || !dobYear) {
    return res.status(400).json({ error: 'Date of birth is required' });
  }
  if (!addressLine1 || !addressCity || !addressPostal || !addressCountry) {
    return res.status(400).json({ error: 'Full address is required' });
  }
  if (!iban) {
    return res.status(400).json({ error: 'IBAN is required' });
  }
  if (!tosAccepted) {
    return res.status(400).json({ error: 'You must accept the Terms of Service' });
  }

  const ibanClean = String(iban).replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(ibanClean) || ibanClean.length < 15) {
    return res.status(400).json({ error: 'Invalid IBAN format' });
  }

  const country = String(addressCountry).toUpperCase();
  const currency = COUNTRY_CURRENCY[country] || 'eur';
  const dobDayInt = parseInt(dobDay, 10);
  const dobMonthInt = parseInt(dobMonth, 10);
  const dobYearInt = parseInt(dobYear, 10);
  if (!dobDayInt || !dobMonthInt || !dobYearInt || dobYearInt < 1900 || dobYearInt > 2010) {
    return res.status(400).json({ error: 'Invalid date of birth' });
  }

  const ip = getClientIp(req);
  if (!ip) {
    return res.status(400).json({ error: 'Invalid IP address. Could not determine your public IP address. Please try again or contact support.' });
  }
  const tosTimestamp = Math.floor(Date.now() / 1000);

  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let accountId = user.stripeConnectAccountId;

    if (!accountId) {
      // Create new Stripe Custom account — seller never visits Stripe
      const account = await stripe.accounts.create({
        type: 'custom',
        country,
        email: user.email,
        business_type: 'individual',
        individual: {
          first_name: user.firstName,
          last_name: user.lastName,
          email: user.email,
          dob: { day: dobDayInt, month: dobMonthInt, year: dobYearInt },
          address: {
            line1: String(addressLine1),
            city: String(addressCity),
            postal_code: String(addressPostal),
            country
          }
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        tos_acceptance: { date: tosTimestamp, ip },
        metadata: { uid: user.uid }
      });
      accountId = account.id;
      user.stripeConnectAccountId = accountId;
      await user.save();
      console.log(`${LOG_PREFIX} Created Custom account ${accountId} for uid=${user.uid?.slice(0, 8)}...`);
    } else {
      // Update existing account with fresh KYC details
      await stripe.accounts.update(accountId, {
        individual: {
          dob: { day: dobDayInt, month: dobMonthInt, year: dobYearInt },
          address: {
            line1: String(addressLine1),
            city: String(addressCity),
            postal_code: String(addressPostal),
            country
          }
        },
        tos_acceptance: { date: tosTimestamp, ip }
      });
      console.log(`${LOG_PREFIX} Updated Custom account ${accountId} for uid=${user.uid?.slice(0, 8)}...`);
    }

    // Add/replace external bank account (IBAN)
    await stripe.accounts.createExternalAccount(accountId, {
      external_account: {
        object: 'bank_account',
        country,
        currency,
        account_holder_name: `${user.firstName} ${user.lastName}`,
        account_holder_type: 'individual',
        account_number: ibanClean,
        default_for_currency: true
      }
    });

    // In Stripe test mode, apply magic values so the account verifies synchronously:
    // - dob.year 1901 is Stripe's documented magic value that sets charges_enabled immediately
    // - id_number '000000000' bypasses identity verification
    const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
    if (isTestMode) {
      await stripe.accounts.update(accountId, {
        individual: {
          dob: { day: 1, month: 1, year: 1901 },
          id_number: '000000000'
        }
      });
      console.log(`${LOG_PREFIX} Test mode: applied magic DOB + id_number bypass for accountId=${accountId}`);
    }

    // Retrieve fresh status to determine if Stripe has already enabled charges
    const account = await stripe.accounts.retrieve(accountId);
    const onboarded = isTestMode
      ? !!(account.details_submitted) // in test mode trust details_submitted; charges_enabled may lag
      : !!(account.details_submitted && account.charges_enabled);
    if (user.stripeConnectOnboarded !== onboarded) {
      user.stripeConnectOnboarded = onboarded;
      await user.save();
    }

    console.log(`${LOG_PREFIX} Onboarding submitted uid=${user.uid?.slice(0, 8)} accountId=${accountId} onboarded=${onboarded}`);
    res.json({ onboarded, requiresVerification: !onboarded, accountId });
  } catch (err) {
    const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
    console.error(`${LOG_PREFIX} Submit onboarding error type=${err.type} message=${err.message}`);
    // Stripe Connect not enabled on the platform account
    if (err.type === 'StripePermissionError') {
      return res.status(503).json({
        error: 'Stripe Connect not configured',
        message: 'Payout account setup is temporarily unavailable. Our team has been notified. Please try again later or contact support.',
        ...(isTestMode && { debug: err.message })
      });
    }
    if (err.type === 'StripeInvalidRequestError') {
      return res.status(400).json({ error: 'Invalid payment details', message: err.message });
    }
    res.status(500).json({
      error: 'Failed to set up payout account',
      message: err.message,
      ...(isTestMode && { debug: `type=${err.type}` })
    });
  }
});

/**
 * POST /api/connect/test-activate
 * TEST MODE ONLY — applies Stripe's magic id_number to immediately enable charges on a pending account.
 * Safe to call on already-verified accounts (no-op).
 */
router.post('/test-activate', requireActiveAccount, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
  if (!isTestMode) {
    return res.status(403).json({ error: 'Only available in test mode' });
  }

  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.stripeConnectAccountId) {
      return res.status(400).json({ error: 'No Stripe account found. Complete the payout setup form first.' });
    }

    // Magic DOB 1901-01-01 triggers immediate charges_enabled in Stripe test mode
    await stripe.accounts.update(user.stripeConnectAccountId, {
      individual: {
        dob: { day: 1, month: 1, year: 1901 },
        id_number: '000000000'
      }
    });

    const account = await stripe.accounts.retrieve(user.stripeConnectAccountId);
    // Trust details_submitted in test mode — charges_enabled can still lag even after magic values
    const onboarded = !!(account.details_submitted);
    user.stripeConnectOnboarded = true; // force true in test mode
    await user.save();

    console.log(`${LOG_PREFIX} Test activate uid=${user.uid?.slice(0, 8)} charges_enabled=${account.charges_enabled} details_submitted=${account.details_submitted}`);
    res.json({ onboarded: true, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled });
  } catch (err) {
    console.error(`${LOG_PREFIX} Test activate error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/connect/account-status
 * Returns the seller's Stripe Connect account status.
 */
router.get('/account-status', async (req, res) => {
  if (process.env.SKIP_STRIPE_VALIDATION === 'true') {
    return res.json({ connected: true, onboarded: true, devBypass: true });
  }
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
    const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
    // In test mode, trust the DB value if it was force-set by test-activate;
    // only override with Stripe's live value if Stripe actually says charges_enabled.
    const stripeOnboarded = !!(account.details_submitted && account.charges_enabled);
    const onboarded = isTestMode
      ? (user.stripeConnectOnboarded || stripeOnboarded)
      : stripeOnboarded;

    if (onboarded !== user.stripeConnectOnboarded) {
      user.stripeConnectOnboarded = onboarded;
      await user.save();
    }

    // Surface any Stripe verification errors so the frontend can show them
    const errors = account.requirements?.errors ?? [];
    const requirementErrors = errors.map(e => e.reason || e.code).filter(Boolean);

    res.json({
      connected: true,
      onboarded,
      accountId: user.stripeConnectAccountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      requirementErrors: requirementErrors.length ? requirementErrors : undefined
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

    if (transaction.paymentDeadline && new Date(transaction.paymentDeadline) < new Date()) {
      return res.status(400).json({
        error: 'Payment deadline expired',
        message: 'The payment window for this transaction has expired. The transaction has been cancelled.'
      });
    }

    if (transaction.stripeCheckoutSessionId) {
      return res.status(400).json({ error: 'A Stripe checkout session already exists for this transaction' });
    }

    const seller = transaction.seller;
    const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
    const skipValidation = process.env.SKIP_STRIPE_VALIDATION === 'true';
    if (!skipValidation && (!seller.stripeConnectAccountId || (!seller.stripeConnectOnboarded && !isTestMode))) {
      return res.status(400).json({
        error: 'Seller not ready',
        message: 'The seller has not yet connected their Stripe account. Please contact the seller.'
      });
    }

    // In test mode, check if the Stripe account actually has transfers capability active.
    // If force-activated via DB only (magic DOB trick), transfers may still be pending on Stripe's side.
    let sellerAccountCapable = true;
    if (isTestMode && seller.stripeConnectAccountId) {
      try {
        const sellerAccount = await stripe.accounts.retrieve(seller.stripeConnectAccountId);
        sellerAccountCapable = sellerAccount.capabilities?.transfers === 'active';
      } catch (_) {
        sellerAccountCapable = false;
      }
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

    // === Fee model ===
    // BidRoom fee: per-listing commissionRate (set at listing creation) — deducted from SELLER payout
    // Stripe processing fee: ~2.9% + $0.30 — passed through to BUYER as "Processing fee" line item
    const effectiveFeeRate = listing?.commissionRate ?? BIDROOMFEE_RATE;
    const itemCents    = Math.round(itemAmount * 100);
    const shippingCents = Math.round(shippingAmount * 100);

    const bidRoomFeeCents = Math.round(itemCents * effectiveFeeRate);

    // Estimate Stripe's processing fee on the item+shipping subtotal.
    // Actual fee will differ slightly (Stripe charges on the final total including this estimate),
    // but the error is a few cents at most and is absorbed by the platform.
    const stripeFeeEstimateCents = Math.round((itemCents + shippingCents) * 0.029) + 30;

    // Buyer total: item + shipping + Stripe fee estimate
    const buyerTotalCents = itemCents + shippingCents + stripeFeeEstimateCents;

    // Seller receives: item - BidRoom fee + shipping
    const sellerTransferCents = itemCents - bidRoomFeeCents + shippingCents;

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
          product_data: { name: 'Processing fee' },
          unit_amount: stripeFeeEstimateCents
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

    // payment_intent_data: use explicit transfer_data.amount so the seller receives
    // exactly item*(1-0.04)+shipping, regardless of the Stripe fee estimate rounding.
    // In test mode, if the account doesn't have transfers capability active yet, skip
    // transfer_data to avoid a "stripe_balance.stripe_transfers feature" error.
    const paymentIntentData = {
      metadata: {
        transactionId: transaction._id.toString(),
        buyerUid: buyer.uid,
        sellerAccountId: seller.stripeConnectAccountId
      }
    };
    if (seller.stripeConnectAccountId && sellerAccountCapable) {
      paymentIntentData.transfer_data = {
        destination: seller.stripeConnectAccountId,
        amount: sellerTransferCents   // explicit: seller gets item*0.96 + shipping
      };
    } else if (isTestMode) {
      console.log(`${LOG_PREFIX} Test mode: skipping transfer_data — seller account not fully capable (transfers not active)`);
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      payment_intent_data: paymentIntentData,
      success_url: `${FRONTEND_URL}/dashboard/transactions?stripe_payment=success&session_id={CHECKOUT_SESSION_ID}&transaction_id=${transaction._id}`,
      cancel_url: `${FRONTEND_URL}/dashboard/transactions?stripe_payment=cancelled&transaction_id=${transaction._id}`,
      metadata: {
        transactionId: transaction._id.toString(),
        buyerUid: buyer.uid
      }
    });

    // Store fee breakdown on transaction before save
    transaction.stripeCheckoutSessionId = session.id;
    transaction.bidRoomFeeAmount  = bidRoomFeeCents  / 100;   // 4% from seller
    transaction.sellerPayoutAmount = sellerTransferCents / 100; // item*0.96 + shipping
    transaction.buyerTotalPaid    = buyerTotalCents   / 100;   // item + stripe_est + shipping
    await transaction.save();

    console.log(`${LOG_PREFIX} Checkout session created session_id=${session.id} transaction=${transaction._id} amount=$${(buyerTotalCents / 100).toFixed(2)}`);
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

    // Extract the actual Stripe processing fee for transparency (recorded but doesn't change seller payout —
    // buyer already covered it via the "Processing fee" line item at checkout creation time).
    const balanceTx = session.payment_intent?.latest_charge?.balance_transaction;
    const stripeFeeAmount = balanceTx ? balanceTx.fee / 100 : null;

    const paymentIntentId = typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id;

    // Seller payout was calculated and stored at checkout-session creation time.
    // Fall back to item*(1-rate) in case the transaction was created before this deploy.
    const sellerPayout = transaction.sellerPayoutAmount ?? (transaction.amount * (1 - (transaction.listing?.commissionRate ?? BIDROOMFEE_RATE)));

    transaction.stripePaymentIntentId = paymentIntentId;
    transaction.stripeFeeAmount = stripeFeeAmount;
    transaction.sellerPayoutAmount = Math.max(0, sellerPayout);
    transaction.transactionStatus = 'awaiting_seller_acceptance';
    transaction.paymentStatus = 'paid';
    transaction.paidAt = new Date();
    applyShippingDeadlinesFromPaidAt(transaction);
    const deadlinePa = new Date();
    deadlinePa.setDate(deadlinePa.getDate() + 5);
    transaction.paymentAcceptanceDeadline = deadlinePa;
    await transaction.save();

    await sendPaymentReceivedEmail(transaction);

    // In-app notification to seller
    const sellerMongoId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
    if (sellerMongoId) {
      const buyerName = [transaction.buyer?.firstName, transaction.buyer?.lastName].filter(Boolean).join(' ') || 'A buyer';
      notifySellerPaymentReceived({
        transactionId,
        listingTitle: transaction.listing?.title || 'your listing',
        buyerName,
        sellerUserId: sellerMongoId
      }).catch(err => console.error(`${LOG_PREFIX} Failed to create seller payment notification:`, err));
      const io = req.app.get('io');
      if (io) emitNewNotificationToUser(io, sellerMongoId).catch(() => {});
    }

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
  const stripe = getStripe();

  if (!stripe) return res.status(503).send('Stripe not configured');

  // Stripe API v2 requires two separate webhook destinations:
  //   STRIPE_CONNECT_WEBHOOK_SECRET       → "Your account" scope (checkout.session.completed)
  //   STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET → "Connected accounts" scope (account.updated)
  // Both point to this same endpoint. We try each secret until one validates.
  const secrets = [
    process.env.STRIPE_CONNECT_WEBHOOK_SECRET,
    process.env.STRIPE_CONNECT_ACCOUNT_WEBHOOK_SECRET
  ].filter(Boolean);

  if (secrets.length === 0) {
    console.warn(`${LOG_PREFIX} No webhook secrets configured — skipping signature verification`);
    return res.json({ received: true });
  }

  let event;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
      break;
    } catch (_) {
      // try next secret
    }
  }

  if (!event) {
    console.error(`${LOG_PREFIX} Webhook signature verification failed against all configured secrets`);
    return res.status(400).send('Webhook Error: signature verification failed');
  }

  console.log(`${LOG_PREFIX} Webhook received type=${event.type} id=${event.id}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const io = req.app.get('io');
    handleCheckoutCompleted(session, stripe, io).catch(err =>
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

async function handleCheckoutCompleted(session, stripe, io) {
  const transactionId = session.metadata?.transactionId;
  if (!transactionId) return;

  const transaction = await Transaction.findById(transactionId)
    .populate('listing', 'handlingTime commissionRate')
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

  // Seller payout was set at checkout creation; fall back for old transactions.
  const sellerPayout = transaction.sellerPayoutAmount ?? (transaction.amount * (1 - (transaction.listing?.commissionRate ?? BIDROOMFEE_RATE)));

  transaction.stripePaymentIntentId = paymentIntentId;
  transaction.stripeFeeAmount = stripeFeeAmount;
  transaction.sellerPayoutAmount = Math.max(0, sellerPayout);
  transaction.transactionStatus = 'awaiting_seller_acceptance';
  transaction.paymentStatus = 'paid';
  transaction.paidAt = new Date();
  applyShippingDeadlinesFromPaidAt(transaction);
  const deadlinePa = new Date();
  deadlinePa.setDate(deadlinePa.getDate() + 5);
  transaction.paymentAcceptanceDeadline = deadlinePa;
  await transaction.save();

  await sendPaymentReceivedEmail(transaction);

  // In-app notification to seller
  const sellerMongoId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
  if (sellerMongoId) {
    const buyerName = [transaction.buyer?.firstName, transaction.buyer?.lastName].filter(Boolean).join(' ') || 'A buyer';
    notifySellerPaymentReceived({
      transactionId,
      listingTitle: transaction.listing?.title || 'your listing',
      buyerName,
      sellerUserId: sellerMongoId
    }).catch(err => console.error(`${LOG_PREFIX} Failed to create seller payment notification:`, err));
    if (io) emitNewNotificationToUser(io, sellerMongoId).catch(() => {});
  }

  console.log(`${LOG_PREFIX} Webhook: transaction ${transactionId} marked awaiting_seller_acceptance`);
}

async function handleAccountUpdated(account) {
  if (!account.metadata?.uid) return;
  const uid = account.metadata.uid;
  const onboarded = !!(account.details_submitted && account.charges_enabled);

  const user = await User.findOne({ uid }).select('firstName email stripeConnectOnboarded');
  if (!user) return;

  const wasOnboarded = user.stripeConnectOnboarded;
  user.stripeConnectOnboarded = onboarded;
  await user.save();

  console.log(`${LOG_PREFIX} Account updated uid=${uid?.slice(0, 8)} onboarded=${onboarded}`);

  if (!wasOnboarded && onboarded) {
    // Account just got verified — notify the seller
    await sendAccountVerifiedEmail(user);
  } else if (!onboarded) {
    // Check for verification errors
    const errors = account.requirements?.errors ?? [];
    if (errors.length > 0) {
      await sendAccountVerificationFailedEmail(user, errors);
    }
  }
}

async function sendAccountVerifiedEmail(user) {
  const subject = 'Your payout account is verified ✓';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #7A4F84 0%, #9b6ba8 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0;">Payout account verified!</h1>
      </div>
      <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
        <p>Hi ${user.firstName || 'there'},</p>
        <p>Great news — your payout account has been verified by Stripe. You can now sell items on BidRoom and receive payments directly to your bank account.</p>
        <p>No further action is needed. Payouts are processed automatically after each successful transaction.</p>
        <p>Best regards,<br>The BidRoom Team</p>
      </div>
    </div>
  `;
  try {
    await sendEmail(user.email, subject, html);
    console.log(`${LOG_PREFIX} Sent account verified email to uid=${user.uid?.slice(0, 8)}`);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to send account verified email:`, err.message);
  }
}

async function sendAccountVerificationFailedEmail(user, errors) {
  const errorList = errors.map(e => `<li>${e.reason || e.code || 'Unknown issue'}</li>`).join('');
  const subject = 'Action needed: issue with your payout account';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #c0392b 0%, #e74c3c 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0;">Action required</h1>
      </div>
      <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
        <p>Hi ${user.firstName || 'there'},</p>
        <p>There was an issue verifying your payout account. Stripe flagged the following:</p>
        <ul style="color: #c0392b; margin: 16px 0; padding-left: 20px;">${errorList}</ul>
        <p>Please log in to BidRoom and update your payout account details to fix these issues.</p>
        <p>Best regards,<br>The BidRoom Team</p>
      </div>
    </div>
  `;
  try {
    await sendEmail(user.email, subject, html);
    console.log(`${LOG_PREFIX} Sent verification failed email to uid=${user.uid?.slice(0, 8)}`);
  } catch (err) {
    console.error(`${LOG_PREFIX} Failed to send verification failed email:`, err.message);
  }
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
        <p>Your payout of <strong>$${(transaction.sellerPayoutAmount ?? (transaction.amount * (1 - (listing?.commissionRate ?? BIDROOMFEE_RATE)))).toFixed(2)}</strong> (sale price minus the BidRoom platform fee) will be transferred to your bank account after the transaction is completed.</p>
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
