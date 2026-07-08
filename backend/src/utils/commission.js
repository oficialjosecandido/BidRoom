/** Fallback commission rate — matches the one in connect.js. */
const BIDROOMFEE_RATE = 0.035;

/**
 * Resolves the effective commission rate for a payout.
 *
 * The founding-seller waiver is evaluated here, at payout time, not at listing
 * creation. This ensures that simultaneous auctions resolve fairly: the order in
 * which they close determines which ones are "free", and only completed sales
 * (not failed ones) consume a waiver slot.
 *
 * @param {object} listing  - Mongoose listing doc (needs .commissionRate)
 * @param {object} seller   - Mongoose seller doc (needs .completedSalesCount, .foundingSellerWaiver)
 * @returns {{ effectiveFeeRate: number, waiverApplied: boolean }}
 */
function resolveCommissionRate(listing, seller) {
  const fullRate = listing?.commissionRate ?? BIDROOMFEE_RATE;

  const waiver = seller?.foundingSellerWaiver;
  if (waiver?.active && (seller.completedSalesCount ?? 0) < (waiver.freeSalesCap ?? 5)) {
    return { effectiveFeeRate: 0, waiverApplied: true };
  }
  return { effectiveFeeRate: fullRate, waiverApplied: false };
}

module.exports = { resolveCommissionRate, BIDROOMFEE_RATE };
