const express = require('express');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const { getStripe, isStripeTestMode } = require('../utils/stripe.util');
const { publicClientIp } = require('../utils/clientIp');
const { normalizePhoneE164 } = require('../utils/phoneE164');
const Customer = require('../models/Customer');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const { sendEmail } = require('../services/emailService');
const { notifySellerPaymentReceived, emitNewNotificationToUser } = require('../services/notificationService');
const { applyShippingDeadlinesFromPaidAt } = require('../services/shippingDeadlines');
const {
  wrapBidRoomEmail,
  emailInfoBox,
  emailPayoutBox,
  transactionUrl
} = require('../utils/bidroomEmailLayout');
const { attachPaymentMethodToUser } = require('../services/paymentMethodService');

const LOG_PREFIX = '[Connect]';
const logger = require('../utils/logger');
const { estimateBuyerProcessingFeeCents } = require('../utils/fees');
const { resolveCommissionRate } = require('../utils/commission');
/** Fallback rate when listing.commissionRate is missing (edge case for old data). */
const BIDROOMFEE_RATE = 0.035; // 3.5% standard rate (was incorrectly 0.04)
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';
/** Stripe rejects localhost for business_profile.url — use a public https origin in dev. */
const STRIPE_BUSINESS_URL_FALLBACK = 'https://www.bidroom.pt';

async function ensureStripeCustomer(stripe, buyer) {
  if (buyer.stripeCustomerId) return buyer.stripeCustomerId;
  const customer = await stripe.customers.create({
    email: buyer.email,
    name: [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') || undefined,
    metadata: { uid: buyer.uid },
  });
  await Customer.findOneAndUpdate({ uid: buyer.uid }, { stripeCustomerId: customer.id });
  buyer.stripeCustomerId = customer.id;
  return customer.id;
}

async function autoSavePaymentMethodIfNew(buyerUid, session) {
  try {
    const buyer = await Customer.findOne({ uid: buyerUid })
      .select('savedPaymentMethods savedPaymentMethodId').lean();
    if (!buyer) return;
    if ((buyer.savedPaymentMethods?.length ?? 0) > 0 || buyer.savedPaymentMethodId) return;

    const pi = session.payment_intent;
    const pmId = (typeof pi === 'object' && pi !== null) ? pi.payment_method : null;
    if (!pmId || typeof pmId !== 'string') return;

    await attachPaymentMethodToUser(buyerUid, pmId, { setAsDefault: true });
    logger.info(`${LOG_PREFIX} Auto-saved PM ${pmId} as default for buyer uid=${buyerUid?.slice(0, 8)}...`);
  } catch (err) {
    logger.warn(`${LOG_PREFIX} Auto-save PM failed (non-critical):`, err.message);
  }
}

/** Stripe payments are verified automatically — seller can ship without a manual accept step. */
function markTransactionStripePaid(transaction) {
  transaction.transactionStatus = 'paid';
  transaction.paymentStatus = 'paid';
  transaction.paidAt = transaction.paidAt || new Date();
  applyShippingDeadlinesFromPaidAt(transaction);
  transaction.paymentAcceptanceDeadline = null;
}

function stripeBusinessProfileUrl() {
  const candidates = [
    process.env.STRIPE_BUSINESS_URL,
    process.env.FRONTEND_URL_PROD,
    process.env.FRONTEND_URL
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && !url.hostname.includes('localhost')) {
        return url.origin;
      }
    } catch (_) {
      // ignore invalid URL
    }
  }
  return STRIPE_BUSINESS_URL_FALLBACK;
}

/** Connected account was created under a different Stripe platform key (or was deleted). */
function isOrphanedConnectAccountError(err) {
  if (!err || err.type !== 'StripePermissionError') return false;
  const msg = String(err.message || '');
  return (
    msg.includes('does not have access to account') ||
    msg.includes('account does not exist') ||
    msg.includes('Application access may have been revoked')
  );
}

async function clearStaleConnectAccount(user) {
  const staleId = user.stripeConnectAccountId;
  if (!staleId) return;
  logger.warn(`${LOG_PREFIX} Clearing stale Connect account ${staleId} for uid=${user.uid?.slice(0, 8)}...`);
  user.stripeConnectAccountId = null;
  user.stripeConnectOnboarded = false;
  await user.save();
}

/** Returns a usable account id, or null after clearing a stale record. */
async function resolveConnectAccountId(stripe, user) {
  const accountId = user.stripeConnectAccountId;
  if (!accountId) return null;
  try {
    await stripe.accounts.retrieve(accountId);
    return accountId;
  } catch (err) {
    if (isOrphanedConnectAccountError(err)) {
      await clearStaleConnectAccount(user);
      return null;
    }
    throw err;
  }
}

/**
 * The seller's public IP for Stripe's tos_acceptance record, or null.
 *
 * Detection lives in utils/clientIp so that the rate limiters and the fraud
 * log agree with this on what an address is — they did not, and this copy was
 * the one that got it wrong.
 */
function getClientIp(req) {
  // Locally there is no public IP to find, and Stripe accepts a loopback
  // address. Gated on NODE_ENV rather than on the Stripe mode: production
  // runs on a Stripe *test* key, so keying off the mode would file
  // 127.0.0.1 as the address where a real seller accepted the terms.
  if (process.env.NODE_ENV !== 'production' && isStripeTestMode()) {
    return '127.0.0.1';
  }
  return publicClientIp(req);
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

/** EU/EEA sellers abroad use the recipient service agreement (immutable once set). */
const RECIPIENT_SERVICE_AGREEMENT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO',
  'SK', 'SI', 'ES', 'SE', 'GB', 'NO', 'CH', 'IS', 'LI'
]);

/**
 * The merchant category every BidRoom seller trades under.
 *
 * Stripe requires an MCC on a connected account and lists it as past_due until
 * it has one — a live account sat at "Pending verification" for exactly this,
 * with nothing actually under verification. Sellers here are private
 * individuals reselling watches, jewellery, clothing and cars, which is what
 * 5931 (Used Merchandise and Secondhand Stores) describes. It is the platform's
 * answer, not the seller's: they are never asked, because the marketplace is
 * what determines the category.
 *
 * Overridable because Stripe uses the MCC for risk classification, and a change
 * there should not wait on a deploy.
 */
const SELLER_MCC = String(process.env.STRIPE_SELLER_MCC || '5931');

/**
 * The seller's phone in E.164, which Stripe also lists as past_due without.
 *
 * Nobody was ever asked for one on the payout form, so this prefers what the
 * seller just typed, then falls back to a number they gave for some other
 * purpose: MBWay first, since that is bound to a personal number, then the
 * trader contact phone. Returns null when nothing resolves, and the caller
 * asks rather than sending Stripe a number nobody confirmed.
 */
function resolveSellerPhone(user, typed, country) {
  const candidates = [
    typed,
    user?.sellerPayoutPhone,
    user?.sellerPaymentConfig?.mbway?.phone,
    user?.professionalContactPhone
  ];
  for (const candidate of candidates) {
    const phone = normalizePhoneE164(candidate, country);
    if (phone) return phone;
  }
  return null;
}

/** Used only when Stripe cannot be asked — see getPlatformCountry. */
function platformCountryFallback() {
  return String(process.env.STRIPE_PLATFORM_COUNTRY || 'PT').toUpperCase();
}

/** @type {Promise<string> | null} */
let platformCountryPromise = null;

/**
 * The country of the platform's own Stripe account, cached for the process.
 *
 * Read from Stripe rather than configured, because a wrong answer here is only
 * discovered when a seller is already stuck at the form, and the value changes
 * only if the platform account itself moves. A failed lookup falls back rather
 * than failing onboarding, and is not cached so the next seller retries it.
 */
function getPlatformCountry(stripe) {
  if (!platformCountryPromise) {
    platformCountryPromise = stripe.accounts.retrieve()
      .then((acct) => String(acct.country || '').toUpperCase() || platformCountryFallback())
      .catch((err) => {
        logger.warn(`${LOG_PREFIX} could not read the platform country: ${err.message}`);
        platformCountryPromise = null;
        return platformCountryFallback();
      });
  }
  return platformCountryPromise;
}

/**
 * Which Stripe service agreement a new connected account signs.
 *
 * The recipient agreement exists for cross-border payouts — a platform in one
 * country paying out to an account in another. Stripe refuses it outright when
 * both are in the same country ("The recipient ToS agreement is not supported
 * for platforms in PT creating accounts in PT"), which is the ordinary case
 * here, so a seller at home signs the full agreement.
 *
 * The choice is immutable once the account exists, so it has to be right the
 * first time; there is no fixing it afterwards on the same account.
 */
function serviceAgreementForCountry(country, platformCountry) {
  if (platformCountry && country === platformCountry) return 'full';
  return RECIPIENT_SERVICE_AGREEMENT_COUNTRIES.has(country) ? 'recipient' : 'full';
}

function isPlatformProfileError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes('platform-profile') ||
    msg.includes('collecting requirements for connected accounts')
  );
}

/**
 * The wrong service agreement was asked for — a decision the platform makes on
 * the seller's behalf, so it is worth naming in the log rather than logging it
 * as an unexplained 400.
 */
function isServiceAgreementError(err) {
  const msg = String(err?.message || '');
  return msg.includes('recipient ToS agreement') || msg.includes('service_agreement');
}

/**
 * Whether Stripe is complaining about something the seller actually typed.
 *
 * Stripe answers both bad seller input and platform misconfiguration with
 * StripeInvalidRequestError, and only the first kind is worth repeating to the
 * seller — "Invalid IBAN" helps them, "not supported for platforms in PT"
 * sends them looking for a mistake they did not make. `param` is what tells
 * the two apart: it names the field, and these are the fields the form owns.
 */
const SELLER_SUPPLIED_PARAMS = /^(individual|external_account|bank_account|business_profile|country|email)\b/;

function isSellerDataError(err) {
  return SELLER_SUPPLIED_PARAMS.test(String(err?.param || ''));
}

/**
 * Connect is not switched on for the platform's Stripe account at all.
 *
 * Stripe words this one for whoever holds the platform keys — "you can only
 * create new accounts if you've signed up for Connect", with a link to the
 * platform dashboard. Shown to a seller it reads as an instruction to go and
 * register their own Stripe platform, which is why it must never reach them.
 */
function isConnectNotEnabledError(err) {
  const msg = String(err?.message || '');
  return (
    msg.includes("signed up for Connect") ||
    msg.includes('enable Connect') ||
    msg.includes('enable_connect')
  );
}

function connectPlatformProfileUrl() {
  const base = isStripeTestMode()
    ? 'https://dashboard.stripe.com/test/settings/connect/platform-profile'
    : 'https://dashboard.stripe.com/settings/connect/platform-profile';
  return base;
}

function connectSignupUrl() {
  return isStripeTestMode()
    ? 'https://dashboard.stripe.com/test/connect/overview'
    : 'https://dashboard.stripe.com/connect/overview';
}

/**
 * Whether Stripe's own words may travel back in the response body.
 *
 * Test mode alone is not enough to decide this: production currently runs on
 * a Stripe *test* key, so isStripeTestMode() is true there too, and gating on
 * it alone hands real sellers the operator-facing text this whole path exists
 * to keep from them. NODE_ENV is what actually separates the two.
 */
function canExposeStripeDetail() {
  return isStripeTestMode() && process.env.NODE_ENV !== 'production';
}

/**
 * The reply to a seller when payouts are down for a reason only the platform
 * can fix.
 *
 * Every one of these is our configuration, never the seller's data, so the
 * seller is told it is on us and the actionable detail goes to the log — the
 * raw Stripe text is addressed to the platform operator and misdirects anyone
 * else who reads it.
 */
function platformSetupResponse(res, err, { error, message, dashboardUrl }) {
  return res.status(503).json({
    error,
    message,
    ...(dashboardUrl && canExposeStripeDetail() && { dashboardUrl }),
    ...(canExposeStripeDetail() && { debug: err.message })
  });
}

const PAYOUTS_UNAVAILABLE_MESSAGE =
  'Payout account setup is temporarily unavailable — this is a configuration issue on our side, ' +
  'not with your details. Our team has been notified. Please try again later or contact support.';

/**
 * Classifies a Stripe failure during seller onboarding. Returns true when it
 * was answered as a platform problem, so the caller can stop.
 */
function handlePlatformSetupError(res, err) {
  if (isConnectNotEnabledError(err)) {
    logger.error(
      `${LOG_PREFIX} CONNECT NOT ENABLED on the platform Stripe account — no seller can set up ` +
      `payouts until Connect is enabled at ${connectSignupUrl()}. Stripe said: ${err.message}`
    );
    platformSetupResponse(res, err, {
      error: 'Stripe Connect not enabled',
      message: PAYOUTS_UNAVAILABLE_MESSAGE,
      dashboardUrl: connectSignupUrl()
    });
    return true;
  }

  if (err.type === 'StripePermissionError' && !isOrphanedConnectAccountError(err)) {
    platformSetupResponse(res, err, {
      error: 'Stripe Connect not configured',
      message: PAYOUTS_UNAVAILABLE_MESSAGE
    });
    return true;
  }

  if (err.type === 'StripeInvalidRequestError' && isPlatformProfileError(err)) {
    platformSetupResponse(res, err, {
      error: 'Stripe Connect platform setup incomplete',
      message: PAYOUTS_UNAVAILABLE_MESSAGE,
      dashboardUrl: connectPlatformProfileUrl()
    });
    return true;
  }

  if (err.type === 'StripeInvalidRequestError' && isServiceAgreementError(err)) {
    logger.error(
      `${LOG_PREFIX} WRONG SERVICE AGREEMENT for a new connected account — the recipient ` +
      `agreement only applies when the seller's country differs from the platform's. ` +
      `Stripe said: ${err.message}`
    );
    platformSetupResponse(res, err, {
      error: 'Stripe Connect platform setup incomplete',
      message: PAYOUTS_UNAVAILABLE_MESSAGE
    });
    return true;
  }

  return false;
}

function connectSettingsPath() {
  return `${FRONTEND_URL.replace(/\/$/, '')}/dashboard/settings`;
}

/** Persist seller IBAN on User (and Customer) before Stripe calls. */
async function persistSellerPayoutIban(user, ibanClean) {
  if (!user || !ibanClean) return;
  const now = new Date();
  user.sellerPayoutIban = ibanClean;
  user.sellerPayoutIbanUpdatedAt = now;
  await user.save();

  if (!user.uid) return;
  await Customer.findOneAndUpdate(
    { uid: user.uid },
    {
      $set: {
        sellerPayoutIban: ibanClean,
        sellerPayoutIbanUpdatedAt: now,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      },
      $setOnInsert: {
        uid: user.uid,
        balance: 0,
        reviewCount: 0
      }
    },
    { upsert: true }
  );
}

/** Express account — Stripe collects KYC via hosted onboarding (no platform-profile ack required). */
function buildExpressAccountCreatePayload(user, country = 'PT') {
  return {
    type: 'express',
    country,
    email: user.email,
    business_type: 'individual',
    business_profile: {
      // Sent here too so Stripe's hosted onboarding does not ask the seller to
      // classify a business they do not think of themselves as having.
      mcc: SELLER_MCC,
      url: stripeBusinessProfileUrl(),
      product_description: 'Online marketplace seller on BidRoom'
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    metadata: { uid: user.uid }
  };
}

/** Payload for a new API-onboarded connected account (platform collects KYC). */
function buildConnectAccountCreatePayload(user, country, kyc, tosTimestamp, ip, platformCountry) {
  return {
    controller: {
      losses: { payments: 'application' },
      fees: { payer: 'application' },
      stripe_dashboard: { type: 'none' },
      requirement_collection: 'application'
    },
    country,
    email: user.email,
    business_type: 'individual',
    business_profile: {
      mcc: SELLER_MCC,
      url: stripeBusinessProfileUrl(),
      product_description: 'Online marketplace seller on BidRoom'
    },
    individual: {
      first_name: user.firstName,
      last_name: user.lastName,
      email: user.email,
      phone: kyc.phone,
      dob: { day: kyc.dobDay, month: kyc.dobMonth, year: kyc.dobYear },
      address: {
        line1: kyc.addressLine1,
        city: kyc.addressCity,
        postal_code: kyc.addressPostal,
        country
      }
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true }
    },
    tos_acceptance: {
      date: tosTimestamp,
      // Omitted rather than sent empty when the proxy chain hid the seller:
      // Stripe accepts an acceptance with only a date, but answers a missing
      // or malformed ip with "Invalid IP address", which reads to the seller
      // as a problem with what they typed.
      ...(ip && { ip }),
      service_agreement: serviceAgreementForCountry(country, platformCountry)
    },
    metadata: { uid: user.uid }
  };
}

/**
 * POST /api/connect/onboarding-link
 * Returns a Stripe-hosted onboarding URL (Express). Stripe collects seller KYC.
 * Body (optional): { country } — ISO country for new accounts (default PT).
 */
router.post('/onboarding-link', requireActiveAccount, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  const country = String(req.body?.country || 'PT').toUpperCase();

  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let accountId = await resolveConnectAccountId(stripe, user);

    if (!accountId) {
      const account = await stripe.accounts.create(buildExpressAccountCreatePayload(user, country));
      accountId = account.id;
      user.stripeConnectAccountId = accountId;
      user.stripeConnectOnboarded = false;
      await user.save();
      logger.info(`${LOG_PREFIX} Created Express account ${accountId} for uid=${user.uid?.slice(0, 8)}...`);
    }

    const settingsUrl = connectSettingsPath();
    const linkType = user.stripeConnectOnboarded ? 'account_update' : 'account_onboarding';
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${settingsUrl}?connect=refresh`,
      return_url: `${settingsUrl}?connect=return`,
      type: linkType
    });

    logger.info(`${LOG_PREFIX} Onboarding link created uid=${user.uid?.slice(0, 8)} accountId=${accountId} type=${linkType}`);
    res.json({ url: link.url, accountId });
  } catch (err) {
    logger.error(`${LOG_PREFIX} Onboarding link error type=${err.type} message=${err.message}`);
    if (handlePlatformSetupError(res, err)) return;
    res.status(500).json({
      error: 'Failed to start payout setup',
      message: PAYOUTS_UNAVAILABLE_MESSAGE,
      ...(canExposeStripeDetail() && { debug: `type=${err.type} ${err.message}` })
    });
  }
});

/**
 * POST /api/connect/submit-onboarding
 * @deprecated Prefer POST /onboarding-link (Stripe-hosted). Kept for legacy clients.
 * Creates (or updates) a Stripe Custom account for the seller using their KYC data.
 * Body: { dobDay, dobMonth, dobYear, addressLine1, addressCity, addressPostal, addressCountry, iban, tosAccepted }
 */
router.post('/submit-onboarding', requireActiveAccount, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  const {
    dobDay, dobMonth, dobYear,
    addressLine1, addressCity, addressPostal, addressCountry,
    iban, tosAccepted, phone: typedPhone
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
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Stripe holds the account past_due without a phone, which shows in the
    // dashboard as "Pending verification" forever rather than as a question.
    // Asked here, before anything is written, so a seller who has to supply it
    // is not left with a half-saved submission.
    const phone = resolveSellerPhone(user, typedPhone, country);
    if (!phone) {
      return res.status(400).json({
        error: 'Phone number is required',
        field: 'phone',
        message: 'Stripe requires a contact phone number to verify your payout account.'
      });
    }

    await persistSellerPayoutIban(user, ibanClean);
    if (user.sellerPayoutPhone !== phone) {
      user.sellerPayoutPhone = phone;
      await user.save();
    }

    let accountId = await resolveConnectAccountId(stripe, user);
    let recreatedAccount = false;

    if (!accountId) {
      // Create new connected account — platform collects KYC; seller never visits Stripe
      const platformCountry = await getPlatformCountry(stripe);
      const account = await stripe.accounts.create(buildConnectAccountCreatePayload(
        user,
        country,
        {
          dobDay: dobDayInt,
          dobMonth: dobMonthInt,
          dobYear: dobYearInt,
          addressLine1: String(addressLine1),
          addressCity: String(addressCity),
          addressPostal: String(addressPostal),
          phone
        },
        tosTimestamp,
        ip,
        platformCountry
      ));
      accountId = account.id;
      user.stripeConnectAccountId = accountId;
      await user.save();
      recreatedAccount = true;
      logger.info(`${LOG_PREFIX} Created Custom account ${accountId} for uid=${user.uid?.slice(0, 8)}...`);
    } else {
      // Update existing account with fresh KYC details.
      // mcc and phone are resent here and not only on create: the accounts that
      // already exist are precisely the ones stuck past_due on them, and they
      // are never created again.
      await stripe.accounts.update(accountId, {
        business_profile: { mcc: SELLER_MCC },
        individual: {
          phone,
          dob: { day: dobDayInt, month: dobMonthInt, year: dobYearInt },
          address: {
            line1: String(addressLine1),
            city: String(addressCity),
            postal_code: String(addressPostal),
            country
          }
        },
        tos_acceptance: { date: tosTimestamp, ...(ip && { ip }) }
      });
      logger.info(`${LOG_PREFIX} Updated Custom account ${accountId} for uid=${user.uid?.slice(0, 8)}...`);
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
    const isTestMode = isStripeTestMode();
    if (isTestMode) {
      await stripe.accounts.update(accountId, {
        individual: {
          dob: { day: 1, month: 1, year: 1901 },
          id_number: '000000000'
        }
      });
      logger.info(`${LOG_PREFIX} Test mode: applied magic DOB + id_number bypass for accountId=${accountId}`);
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

    logger.info(`${LOG_PREFIX} Onboarding submitted uid=${user.uid?.slice(0, 8)} accountId=${accountId} onboarded=${onboarded}`);
    res.json({ onboarded, requiresVerification: !onboarded, accountId, recreatedAccount });
  } catch (err) {
    logger.error(`${LOG_PREFIX} Submit onboarding error type=${err.type} message=${err.message}`);
    // Our configuration, not the seller's data — answered before anything is
    // blamed on what they typed.
    if (handlePlatformSetupError(res, err)) return;
    if (err.type === 'StripeInvalidRequestError') {
      // Only a complaint about a field the seller filled is repeated to them.
      // Anything else is our configuration wearing a 400, and is answered as
      // ours — the detail is already in the log line above.
      if (isSellerDataError(err)) {
        return res.status(400).json({ error: 'Invalid payment details', message: err.message });
      }
      return platformSetupResponse(res, err, {
        error: 'Payout account setup failed',
        message: PAYOUTS_UNAVAILABLE_MESSAGE
      });
    }
    res.status(500).json({
      error: 'Failed to set up payout account',
      message: PAYOUTS_UNAVAILABLE_MESSAGE,
      ...(canExposeStripeDetail() && { debug: `type=${err.type} ${err.message}` })
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

  const isTestMode = isStripeTestMode();
  if (!isTestMode) {
    return res.status(403).json({ error: 'Only available in test mode' });
  }

  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const accountId = await resolveConnectAccountId(stripe, user);
    if (!accountId) {
      return res.status(400).json({ error: 'No Stripe account found. Complete the payout setup form first.' });
    }

    // Magic DOB 1901-01-01 triggers immediate charges_enabled in Stripe test mode
    await stripe.accounts.update(accountId, {
      individual: {
        dob: { day: 1, month: 1, year: 1901 },
        id_number: '000000000'
      }
    });

    const account = await stripe.accounts.retrieve(accountId);
    // Trust details_submitted in test mode — charges_enabled can still lag even after magic values
    const onboarded = !!(account.details_submitted);
    user.stripeConnectOnboarded = true; // force true in test mode
    await user.save();

    logger.info(`${LOG_PREFIX} Test activate uid=${user.uid?.slice(0, 8)} charges_enabled=${account.charges_enabled} details_submitted=${account.details_submitted}`);
    res.json({ onboarded: true, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled });
  } catch (err) {
    logger.error(`${LOG_PREFIX} Test activate error:`, err.message);
    if (isOrphanedConnectAccountError(err)) {
      return res.status(400).json({
        error: 'Payout account not found',
        message: 'Your previous payout account is no longer linked. Please submit the setup form again.'
      });
    }
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
    const user = await Customer.findOne({ uid: req.user.uid })
      .select('stripeConnectAccountId stripeConnectOnboarded sellerPayoutPhone sellerPaymentConfig.mbway.phone professionalContactPhone');
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Lets the payout form ask for a phone only when we have none to send.
    // The country is unknown until the seller picks one, so this reports
    // whether any candidate is usable for the countries we pay out to; a
    // national-format number still resolves once the form supplies one.
    const phoneOnFile = !!resolveSellerPhone(user, null, platformCountryFallback());

    const accountId = await resolveConnectAccountId(stripe, user);
    if (!accountId) {
      return res.json({ connected: false, onboarded: false, phoneOnFile });
    }

    // Retrieve fresh status from Stripe to keep local record in sync
    const account = await stripe.accounts.retrieve(accountId);
    const isTestMode = isStripeTestMode();
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
    // Deduplicated: Stripe reports one error per failed field, so a single
    // identity check that comes back "insufficient records" arrives as eight
    // copies of the same sentence — one for each name, dob and address part.
    // Repeating it eight times tells the seller nothing the first did not.
    const errors = account.requirements?.errors ?? [];
    const requirementErrors = [...new Set(errors.map(e => e.reason || e.code).filter(Boolean))];

    res.json({
      connected: true,
      onboarded,
      accountId,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      phoneOnFile,
      requirementErrors: requirementErrors.length ? requirementErrors : undefined
    });
  } catch (err) {
    logger.error(`${LOG_PREFIX} Account status error:`, err.message);
    if (isOrphanedConnectAccountError(err)) {
      const user = await Customer.findOne({ uid: req.user.uid }).select('stripeConnectAccountId stripeConnectOnboarded');
      if (user) await clearStaleConnectAccount(user);
      return res.json({ connected: false, onboarded: false });
    }
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
    const buyer = await Customer.findOne({ uid: req.user.uid });
    if (!buyer) return res.status(404).json({ error: 'User not found' });

    // Best-effort: ensure the buyer has a Stripe customer so the PM can be saved after payment.
    let stripeCustomerId = null;
    try {
      stripeCustomerId = await ensureStripeCustomer(stripe, buyer);
    } catch (custErr) {
      logger.warn(`${LOG_PREFIX} Could not ensure Stripe customer (non-critical):`, custErr.message);
    }

    const { transactionId } = req.body;
    if (!transactionId) return res.status(400).json({ error: 'transactionId is required' });

    const transaction = await Transaction.findById(transactionId)
      .populate('listing', 'title commissionRate shippingCost shippingOption packageSize shippingOriginPostalCode shippingOriginCity shippingOriginCountry')
      .populate('seller', 'firstName lastName email stripeConnectAccountId stripeConnectOnboarded completedSalesCount foundingSellerWaiver')
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
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(transaction.stripeCheckoutSessionId);

        if (existingSession.status === 'open') {
          if (existingSession.url) {
            logger.info(`${LOG_PREFIX} Reusing open checkout session session_id=${existingSession.id} transaction=${transaction._id}`);
            return res.json({ url: existingSession.url });
          }
          try {
            await stripe.checkout.sessions.expire(transaction.stripeCheckoutSessionId);
          } catch (expireErr) {
            logger.warn(`${LOG_PREFIX} Could not expire open session without url:`, expireErr.message);
          }
          transaction.stripeCheckoutSessionId = null;
          await transaction.save();
        } else if (existingSession.payment_status === 'paid') {
          return res.status(409).json({
            error: 'Payment already completed',
            message: 'Your payment was already processed. Refresh the page to see the updated status.',
            sessionId: existingSession.id
          });
        } else {
          // Expired or otherwise unusable — allow a fresh checkout session below.
          transaction.stripeCheckoutSessionId = null;
          await transaction.save();
        }
      } catch (retrieveErr) {
        if (retrieveErr.code === 'resource_missing') {
          transaction.stripeCheckoutSessionId = null;
          await transaction.save();
        } else {
          throw retrieveErr;
        }
      }
    }

    const seller = transaction.seller;
    const isTestMode = isStripeTestMode();
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
    // Stripe processing fee: ~2.9% + €0.30 — passed through to BUYER as "Processing fee" line item
    // Founding-seller waiver: effectiveFeeRate is 0 for the first N successful sales (checked at payout time).
    const { effectiveFeeRate, waiverApplied } = resolveCommissionRate(listing, transaction.seller);
    if (listing?.commissionRate == null) {
      logger.warn(`${LOG_PREFIX} commissionRate missing on listing ${listing?._id}, using fallback`);
    }
    if (waiverApplied) {
      logger.info(`${LOG_PREFIX} Founding-seller waiver applied: seller=${transaction.seller?._id} completedSales=${transaction.seller?.completedSalesCount ?? 0}`);
    }
    const itemCents    = Math.round(itemAmount * 100);
    const shippingCents = Math.round(shippingAmount * 100);

    const bidRoomFeeCents = Math.round(itemCents * effectiveFeeRate);

    // Estimate Stripe's processing fee on the item+shipping subtotal.
    // Actual fee will differ slightly (Stripe charges on the final total including this estimate),
    // but the error is a few cents at most and is absorbed by the platform.
    const stripeFeeEstimateCents = estimateBuyerProcessingFeeCents(itemCents + shippingCents);

    // Buyer total: item + shipping + Stripe fee estimate
    const buyerTotalCents = itemCents + shippingCents + stripeFeeEstimateCents;

    // Stripe payments are not available above €10,000
    const STRIPE_LIMIT_CENTS = 1_000_000;
    if (buyerTotalCents > STRIPE_LIMIT_CENTS) {
      return res.status(400).json({
        error: 'stripe_limit_exceeded',
        message: 'Pagamentos via Stripe não estão disponíveis para valores acima de €10.000. Por favor, utiliza um método de pagamento alternativo.',
        limitAmount: 10000
      });
    }

    // Seller receives: item - BidRoom fee + shipping
    const sellerTransferCents = itemCents - bidRoomFeeCents + shippingCents;

    const lineItems = [
      {
        price_data: {
          currency: 'eur',
          product_data: { name: listing?.title || 'Auction item' },
          unit_amount: itemCents
        },
        quantity: 1
      },
      {
        price_data: {
          currency: 'eur',
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
          currency: 'eur',
          product_data: { name: shippingLabel },
          unit_amount: shippingCents
        },
        quantity: 1
      });
    }

    // payment_intent_data: use explicit transfer_data.amount so the seller receives
    // exactly item*(1-commissionRate)+shipping, regardless of the Stripe fee estimate rounding.
    // In test mode, if the account doesn't have transfers capability active yet, skip
    // transfer_data to avoid a "stripe_balance.stripe_transfers feature" error.
    const paymentIntentData = {
      setup_future_usage: 'off_session',
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
      logger.info(`${LOG_PREFIX} Test mode: skipping transfer_data — seller account not fully capable (transfers not active)`);
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      payment_intent_data: paymentIntentData,
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      success_url: `${FRONTEND_URL}/dashboard/transactions?stripe_payment=success&session_id={CHECKOUT_SESSION_ID}&transaction_id=${transaction._id}`,
      cancel_url: `${FRONTEND_URL}/dashboard/transactions?stripe_payment=cancelled&transaction_id=${transaction._id}`,
      metadata: {
        transactionId: transaction._id.toString(),
        buyerUid: buyer.uid
      }
    });

    // Store fee breakdown on transaction before save
    transaction.stripeCheckoutSessionId = session.id;
    transaction.bidRoomFeeAmount   = bidRoomFeeCents   / 100;
    transaction.sellerPayoutAmount = sellerTransferCents / 100;
    transaction.buyerTotalPaid     = buyerTotalCents    / 100;
    transaction.commissionWaived   = waiverApplied;
    await transaction.save();

    logger.info(`${LOG_PREFIX} Checkout session created session_id=${session.id} transaction=${transaction._id} amount=$${(buyerTotalCents / 100).toFixed(2)}`);
    res.json({ url: session.url });
  } catch (err) {
    logger.error(`${LOG_PREFIX} Create checkout session error:`, err.message);
    res.status(500).json({ error: 'Failed to create checkout session', message: err.message });
  }
});

/**
 * POST /api/connect/confirm-payment
 * Called by frontend after successful Stripe Checkout redirect.
 * Body: { sessionId, transactionId }
 * Updates transaction to paid if payment confirmed (Stripe — no manual seller acceptance).
 */
router.post('/confirm-payment', requireActiveAccount, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });

  try {
    const buyer = await Customer.findOne({ uid: req.user.uid });
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
    markTransactionStripePaid(transaction);
    await transaction.save();

    autoSavePaymentMethodIfNew(buyer.uid, session).catch(() => {});

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
      }).catch(err => logger.error(`${LOG_PREFIX} Failed to create seller payment notification:`, err));
      const io = req.app.get('io');
      if (io) emitNewNotificationToUser(io, sellerMongoId).catch(() => {});
    }

    logger.info(`${LOG_PREFIX} Payment confirmed transaction=${transactionId} pi=${paymentIntentId} status=paid`);

    const updated = await Transaction.findById(transactionId)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    res.json(updated);
  } catch (err) {
    logger.error(`${LOG_PREFIX} Confirm payment error:`, err.message);
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
    logger.error(`${LOG_PREFIX} Webhook secrets not configured — rejecting event`);
    return res.status(500).json({ error: 'Webhook verification unavailable' });
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
    logger.error(`${LOG_PREFIX} Webhook signature verification failed against all configured secrets`);
    return res.status(400).send('Webhook Error: signature verification failed');
  }

  logger.info(`${LOG_PREFIX} Webhook received type=${event.type} id=${event.id}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const io = req.app.get('io');
    handleCheckoutCompleted(session, stripe, io).catch(err =>
      logger.error(`${LOG_PREFIX} Webhook handleCheckoutCompleted error:`, err.message)
    );
  }

  if (event.type === 'account.updated') {
    const account = event.data.object;
    handleAccountUpdated(account).catch(err =>
      logger.error(`${LOG_PREFIX} Webhook handleAccountUpdated error:`, err.message)
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
  markTransactionStripePaid(transaction);
  await transaction.save();

  autoSavePaymentMethodIfNew(session.metadata?.buyerUid, expandedSession).catch(() => {});

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
    }).catch(err => logger.error(`${LOG_PREFIX} Failed to create seller payment notification:`, err));
    if (io) emitNewNotificationToUser(io, sellerMongoId).catch(() => {});
  }

  logger.info(`${LOG_PREFIX} Webhook: transaction ${transactionId} marked paid`);
}

async function handleAccountUpdated(account) {
  if (!account.metadata?.uid) return;
  const uid = account.metadata.uid;
  const onboarded = !!(account.details_submitted && account.charges_enabled);

  const user = await Customer.findOne({ uid }).select('firstName email stripeConnectOnboarded');
  if (!user) return;

  const wasOnboarded = user.stripeConnectOnboarded;
  user.stripeConnectOnboarded = onboarded;
  await user.save();

  logger.info(`${LOG_PREFIX} Account updated uid=${uid?.slice(0, 8)} onboarded=${onboarded}`);

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
    logger.info(`${LOG_PREFIX} Sent account verified email to uid=${user.uid?.slice(0, 8)}`);
  } catch (err) {
    logger.error(`${LOG_PREFIX} Failed to send account verified email:`, err.message);
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
    logger.info(`${LOG_PREFIX} Sent verification failed email to uid=${user.uid?.slice(0, 8)}`);
  } catch (err) {
    logger.error(`${LOG_PREFIX} Failed to send verification failed email:`, err.message);
  }
}

async function sendPaymentReceivedEmail(transaction) {
  const seller = transaction.seller;
  const listing = transaction.listing;
  if (!seller?.email) return;

  const subject = 'Payment received — prepare your shipment';
  const buyerName = [transaction.buyer?.firstName, transaction.buyer?.lastName].filter(Boolean).join(' ') || 'A buyer';
  const listingTitle = listing?.title || 'your item';
  const payout = (transaction.sellerPayoutAmount ?? (transaction.amount * (1 - (listing?.commissionRate ?? BIDROOMFEE_RATE)))).toFixed(2);
  const txId = transaction._id?.toString?.() || transaction._id;

  const bodyHtml = `
    <p style="margin:0 0 16px;">Hi ${seller.firstName || 'Seller'},</p>
    <p style="margin:0 0 16px;"><strong>${buyerName}</strong> paid for <strong>${listingTitle}</strong>. Payment is secured via Stripe.</p>
    ${emailInfoBox('When you dispatch the order, mark it as <strong>shipped</strong> in your dashboard. Tracking and proof of postage are optional.')}
    ${emailPayoutBox(`$${payout}`)}
    <p style="margin:0;color:#64748b;font-size:14px;">Your payout (sale price minus BidRoom fees) is released after the buyer completes the transaction.</p>`;

  const html = wrapBidRoomEmail({
    title: 'Payment received',
    bodyHtml,
    ctaUrl: transactionUrl(txId),
    ctaLabel: 'Manage shipment'
  });

  try {
    await sendEmail(seller.email, subject, html);
  } catch (err) {
    logger.error(`${LOG_PREFIX} Failed to send payment received email:`, err.message);
  }
}

module.exports = {
  router,
  connectWebhookHandler,
  // Exported for tests: classifying a platform misconfiguration correctly is
  // what keeps Stripe's operator-facing text away from sellers.
  _test: {
    isConnectNotEnabledError,
    isPlatformProfileError,
    isServiceAgreementError,
    isSellerDataError,
    handlePlatformSetupError,
    canExposeStripeDetail,
    serviceAgreementForCountry,
    resolveSellerPhone,
    buildConnectAccountCreatePayload,
    buildExpressAccountCreatePayload,
    SELLER_MCC
  }
};
