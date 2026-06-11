/** Maximum processing fee charged to the buyer at checkout (EUR). */
export const MAX_BUYER_FEE_EUR = 500;

const STRIPE_PERCENT = 0.029;
const STRIPE_FIXED_EUR = 0.3;

/** Estimated Stripe processing fee (EUR) for item + shipping subtotal, capped at €500. */
export function estimateBuyerProcessingFeeEuros(subtotalEuros: number): number {
  const subtotal = Math.max(0, subtotalEuros || 0);
  const raw = subtotal * STRIPE_PERCENT + STRIPE_FIXED_EUR;
  return Math.min(raw, MAX_BUYER_FEE_EUR);
}
