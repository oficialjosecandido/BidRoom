const Stripe = require('stripe');

/**
 * Returns the active Stripe secret key based on STRIPE_MODE env var.
 *   STRIPE_MODE=test  → STRIPE_SECRET_KEY_TEST  (fallback: STRIPE_SECRET_KEY)
 *   STRIPE_MODE=live  → STRIPE_SECRET_KEY_LIVE  (fallback: STRIPE_SECRET_KEY)
 *   (unset)           → STRIPE_SECRET_KEY  (legacy, unchanged behaviour)
 *
 * To switch modes in any environment, just change STRIPE_MODE — no code deploy needed.
 */
function getStripeKey() {
  const mode = process.env.STRIPE_MODE;
  if (mode === 'live') return process.env.STRIPE_SECRET_KEY_LIVE || process.env.STRIPE_SECRET_KEY;
  if (mode === 'test') return process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY;
  return process.env.STRIPE_SECRET_KEY; // legacy fallback
}

/** Lazy Stripe client — returns null if no key is configured. */
function getStripe() {
  const key = getStripeKey();
  return key ? new Stripe(key) : null;
}

/** True when running against the Stripe test environment. */
function isStripeTestMode() {
  const key = getStripeKey();
  return !key || key.startsWith('sk_test_');
}

module.exports = { getStripe, isStripeTestMode, getStripeKey };
