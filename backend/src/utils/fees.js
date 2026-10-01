/**
 * BidRoom's service fee, charged to the buyer on top of item + shipping.
 *
 * This used to be presented as a pass-through of Stripe's processing cost, and
 * the rate below is where that came from: 2.9% + €0.30 is Stripe's US card rate.
 * Stripe actually charges 1.5% + €0.25 on EEA consumer cards, so on a €200 order
 * this collects €6.25 against a real cost of €3.42 — the difference is BidRoom's
 * margin, not a cost being recovered. It is priced and named as a service fee
 * for that reason; calling it a processing fee was not true.
 *
 * Non-EEA cards do cost more (up to ~3.25% + €0.25), so the rate is not absurd
 * as a blended price — it is simply a price, and belongs under a price's name.
 */

/** Maximum service fee charged to the buyer at checkout (EUR). */
const MAX_BUYER_FEE_EUR = 500;

const SERVICE_FEE_PERCENT = 0.029;
const SERVICE_FEE_FIXED_EUR = 0.3;

/**
 * Buyer service fee in euros for a subtotal (item + shipping).
 * Never exceeds MAX_BUYER_FEE_EUR.
 */
function buyerServiceFeeEuros(subtotalEuros) {
  const subtotal = Math.max(0, Number(subtotalEuros) || 0);
  const raw = subtotal * SERVICE_FEE_PERCENT + SERVICE_FEE_FIXED_EUR;
  return Math.min(raw, MAX_BUYER_FEE_EUR);
}

/** Same as buyerServiceFeeEuros but returns integer cents. */
function buyerServiceFeeCents(subtotalCents) {
  const euros = buyerServiceFeeEuros((Number(subtotalCents) || 0) / 100);
  return Math.round(euros * 100);
}

module.exports = {
  MAX_BUYER_FEE_EUR,
  SERVICE_FEE_PERCENT,
  SERVICE_FEE_FIXED_EUR,
  buyerServiceFeeEuros,
  buyerServiceFeeCents,
};
