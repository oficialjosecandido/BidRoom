/**
 * Airwallex service — token auth + core API wrappers.
 *
 * Auth model: client_id + api_key → 30-min bearer token cached in memory.
 *
 * Payment flow (manual capture / 14-day hold):
 *   1. createPaymentIntent()       → pre-auth hold placed on buyer's card
 *   2. webhook requires_capture    → status = authorized, funds held up to 14 days
 *   3. buyer clicks "Got items"    → capturePaymentIntent() → funds move
 *   4. webhook captured            → trigger seller transfer (T+3 escrow)
 *
 * Docs: https://www.airwallex.com/docs/api
 */

const axios = require('axios');
const crypto = require('crypto');

const ENV = process.env.AIRWALLEX_ENV || 'demo'; // 'demo' | 'production'
const BASE_URL = ENV === 'production'
  ? 'https://api.airwallex.com'
  : 'https://api-demo.airwallex.com';

let _token = null;
let _tokenExpiresAt = 0;

// ── Auth ─────────────────────────────────────────────────────────────────────

async function getToken() {
  const now = Date.now();
  if (_token && now < _tokenExpiresAt - 60_000) return _token;

  const res = await axios.post(
    `${BASE_URL}/api/v1/authentication/login`,
    {},
    {
      headers: {
        'x-client-id': process.env.AIRWALLEX_CLIENT_ID,
        'x-api-key': process.env.AIRWALLEX_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );

  _token = res.data.token;
  _tokenExpiresAt = res.data.expires_at
    ? new Date(res.data.expires_at).getTime()
    : now + 29 * 60 * 1000;

  return _token;
}

async function authHeaders() {
  const token = await getToken();
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── Connected Accounts (seller onboarding) ────────────────────────────────────

async function createConnectedAccount({ email, firstName, lastName }) {
  const headers = await authHeaders();
  const res = await axios.post(
    `${BASE_URL}/api/v1/accounts/create`,
    {
      request_id: `acct-${email}-${Date.now()}`,
      account_details: {
        business_name: `${firstName} ${lastName}`
      },
      primary_contact: { email, first_name: firstName, last_name: lastName }
    },
    { headers }
  );
  return res.data;
}

async function getConnectedAccount(accountId) {
  const headers = await authHeaders();
  const res = await axios.get(`${BASE_URL}/api/v1/accounts/${accountId}`, { headers });
  return res.data;
}

async function createKycClientSecret(accountId) {
  const headers = await authHeaders();
  const res = await axios.post(
    `${BASE_URL}/api/v1/accounts/${accountId}/onboarding_tokens`,
    {},
    { headers }
  );
  return res.data; // { token, expires_at }
}

// ── Payment Intents (manual capture / pre-auth) ───────────────────────────────

/**
 * Create a PaymentIntent with manual capture (14-day pre-auth hold).
 *
 * Fee structure:
 *   - buyer pays:  amount + 2% buyer fee + shipping  (buyerTotal)
 *   - seller gets: amount - 2% seller fee            (sellerAmount)
 *   - platform:    2% + 2% = 4% of amount            (totalFee)
 *
 * The `split_amount` field tells Airwallex to route `sellerAmount` to the
 * seller's connected account upon capture. The remainder stays in BidRoom's
 * master wallet as platform revenue.
 *
 * @param {object} opts
 * @param {number} opts.buyerTotal       Total charged to buyer (USD): amount + buyerFee + shipping
 * @param {number} opts.sellerAmount     Net to seller after seller-side fee (USD)
 * @param {number} opts.totalFeeAmount   Total platform fee (buyerFee + sellerFee, USD)
 * @param {string} opts.currency         e.g. 'USD'
 * @param {string} opts.sellerAccountId  Airwallex connected account ID
 * @param {string} opts.transactionId    MongoDB Transaction._id
 * @param {string} opts.listingTitle     For descriptor / metadata
 */
async function createPaymentIntent({
  buyerTotal,
  sellerAmount,
  totalFeeAmount,
  currency = 'USD',
  sellerAccountId,
  transactionId,
  listingTitle
}) {
  const headers = await authHeaders();
  const amountCents = Math.round(buyerTotal * 100);

  const body = {
    amount: amountCents,
    currency,
    merchant_order_id: transactionId,
    descriptor: `BidRoom: ${(listingTitle || 'Item').substring(0, 40)}`,
    // Manual capture = pre-auth hold; funds not moved until capturePaymentIntent() is called
    capture_method: 'manual',
    // Signals extended hold to card networks (up to 14 days for e-commerce)
    authorization_type: 'pre_auth',
    metadata: {
      transactionId,
      totalFeeAmount: String(totalFeeAmount),
      sellerAmount: String(sellerAmount),
      sellerAccountId: sellerAccountId || ''
    },
    // Split: routes sellerAmount to seller's connected account at capture time
    split_amount: sellerAccountId
      ? {
          amount: Math.round(sellerAmount * 100),
          currency,
          to_account_id: sellerAccountId
        }
      : undefined
  };

  const res = await axios.post(
    `${BASE_URL}/api/v1/pa/payment_intents/create`,
    body,
    { headers }
  );
  return res.data; // { id, client_secret, status, next_action, ... }
}

/**
 * Capture a previously authorized PaymentIntent.
 * Call this when buyer confirms receipt ("Got the items").
 *
 * Airwallex automatically executes the split_amount defined at creation time,
 * routing sellerAmount to the seller's connected account.
 *
 * @param {string} intentId   Airwallex PaymentIntent ID
 * @param {number} amount     Amount to capture (USD); must equal original authorized amount
 */
async function capturePaymentIntent(intentId, amount) {
  const headers = await authHeaders();
  const res = await axios.post(
    `${BASE_URL}/api/v1/pa/payment_intents/${intentId}/capture`,
    { amount: Math.round(amount * 100) },
    { headers }
  );
  return res.data; // { id, status: 'SUCCEEDED', ... }
}

/**
 * Retrieve a PaymentIntent by ID.
 */
async function getPaymentIntent(intentId) {
  const headers = await authHeaders();
  const res = await axios.get(
    `${BASE_URL}/api/v1/pa/payment_intents/${intentId}`,
    { headers }
  );
  return res.data;
}

// ── Refunds ───────────────────────────────────────────────────────────────────

/**
 * Issue a refund against a captured PaymentIntent.
 * For authorized-but-not-captured intents, use cancelPaymentIntent() instead.
 *
 * @param {string} intentId  Airwallex PaymentIntent ID
 * @param {number} amount    Amount to refund (USD)
 * @param {string} reason    'fraudulent' | 'duplicate' | 'requested_by_customer'
 */
async function createRefund(intentId, amount, reason = 'requested_by_customer') {
  const headers = await authHeaders();
  const res = await axios.post(
    `${BASE_URL}/api/v1/pa/refunds/create`,
    {
      payment_intent_id: intentId,
      amount: Math.round(amount * 100),
      reason,
      request_id: `refund-${intentId}-${Date.now()}`
    },
    { headers }
  );
  return res.data;
}

/**
 * Cancel an authorized-but-not-yet-captured PaymentIntent (void the hold).
 * Use this when a dispute is resolved in favour of the buyer before capture.
 *
 * @param {string} intentId  Airwallex PaymentIntent ID
 */
async function cancelPaymentIntent(intentId) {
  const headers = await authHeaders();
  const res = await axios.post(
    `${BASE_URL}/api/v1/pa/payment_intents/${intentId}/cancel`,
    {},
    { headers }
  );
  return res.data;
}

// ── Webhook signature verification ───────────────────────────────────────────

/**
 * Verify an Airwallex webhook HMAC-SHA256 signature.
 * Header: x-signature
 */
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.AIRWALLEX_WEBHOOK_SECRET;
  if (!secret) return true; // skip in dev if not configured
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signature || '', 'hex')
    );
  } catch {
    return false;
  }
}

module.exports = {
  getToken,
  createConnectedAccount,
  getConnectedAccount,
  createKycClientSecret,
  createPaymentIntent,
  capturePaymentIntent,
  cancelPaymentIntent,
  getPaymentIntent,
  createRefund,
  verifyWebhookSignature
};
