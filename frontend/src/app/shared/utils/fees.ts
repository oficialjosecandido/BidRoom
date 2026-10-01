/**
 * BidRoom's service fee, charged to the buyer on top of item + shipping.
 * Must stay in step with backend/src/utils/fees.js, which is what actually
 * prices the checkout — this copy only powers the seller's fee forecast.
 */

/** Maximum service fee charged to the buyer at checkout (EUR). */
export const MAX_BUYER_FEE_EUR = 500;

const SERVICE_FEE_PERCENT = 0.029;
const SERVICE_FEE_FIXED_EUR = 0.3;

/** Buyer service fee (EUR) for an item + shipping subtotal, capped at €500. */
export function buyerServiceFeeEuros(subtotalEuros: number): number {
  const subtotal = Math.max(0, subtotalEuros || 0);
  const raw = subtotal * SERVICE_FEE_PERCENT + SERVICE_FEE_FIXED_EUR;
  return Math.min(raw, MAX_BUYER_FEE_EUR);
}
