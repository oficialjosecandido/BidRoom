/** Maximum processing fee charged to the buyer at checkout (EUR). */
const MAX_BUYER_FEE_EUR = 500;

/** Stripe estimate: 2.9% + €0.30 (passed through to buyer, capped). */
const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED_EUR = 0.3;

/**
 * Estimated Stripe processing fee in euros for a subtotal (item + shipping).
 * Never exceeds MAX_BUYER_FEE_EUR.
 */
function estimateBuyerProcessingFeeEuros(subtotalEuros) {
  const subtotal = Math.max(0, Number(subtotalEuros) || 0);
  const raw = subtotal * STRIPE_PERCENT + STRIPE_FIXED_EUR;
  return Math.min(raw, MAX_BUYER_FEE_EUR);
}

/** Same as estimateBuyerProcessingFeeEuros but returns integer cents. */
function estimateBuyerProcessingFeeCents(subtotalCents) {
  const euros = estimateBuyerProcessingFeeEuros((Number(subtotalCents) || 0) / 100);
  return Math.round(euros * 100);
}

module.exports = {
  MAX_BUYER_FEE_EUR,
  STRIPE_PERCENT,
  STRIPE_FIXED_EUR,
  estimateBuyerProcessingFeeEuros,
  estimateBuyerProcessingFeeCents,
};
