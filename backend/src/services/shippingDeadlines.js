/**
 * Shipping Deadline Helpers
 *
 * Centralises the business-day deadline logic used by:
 *   - connect.js         (sets deadlines when buyer pays)
 *   - transactions.js    (ensures deadlines on seller accept_payment)
 *   - shippingDeadlineScheduler.js (checks thresholds every 15 min)
 *
 * Timeline (anchored to paidAt):
 *   Day 1–3  → Seller should ship.
 *   Day 3    → MIDPOINT_BUSINESS_DAYS threshold. If not shipped, scheduler
 *              sends the seller a warning.
 *   Day 5    → SHIP_BUSINESS_DAYS threshold. If still not shipped, scheduler
 *              auto-cancels the order and refunds the buyer.
 */

const { endOfNthBusinessDayFromAnchor } = require('./businessDays');

/** Total business days the seller has to ship before auto-cancellation. */
const SHIP_BUSINESS_DAYS = 5;

/** Business day at which the midpoint warning fires (2 days remaining). */
const MIDPOINT_BUSINESS_DAYS = 3;

/**
 * Set shipByBusinessDeadline and handlingDeadline on a Mongoose transaction
 * document based on its paidAt date (5 business days, inclusive).
 * Called when payment is first confirmed.
 *
 * If paidAt is not yet set, it defaults to now().
 * Both fields are set to the same value so that legacy code reading
 * handlingDeadline sees the correct date.
 *
 * @param {import('mongoose').Document} tx  Transaction document (mutated in place)
 */
function applyShippingDeadlinesFromPaidAt(tx) {
  const anchor = tx.paidAt ? new Date(tx.paidAt) : new Date();
  if (!tx.paidAt) tx.paidAt = anchor;
  const shipBy = endOfNthBusinessDayFromAnchor(anchor, SHIP_BUSINESS_DAYS);
  tx.shipByBusinessDeadline = shipBy;
  tx.handlingDeadline = shipBy;
}

/**
 * Backfill for older transactions that were paid before this feature was deployed.
 * Only writes if shipByBusinessDeadline is not yet set and paidAt exists.
 *
 * @param {import('mongoose').Document} tx  Transaction document (mutated in place)
 */
function ensureShippingDeadlinesFromPaidAt(tx) {
  if (!tx.shipByBusinessDeadline && tx.paidAt) {
    applyShippingDeadlinesFromPaidAt(tx);
  }
}

/**
 * Resolve the effective ship-by deadline for a transaction.
 * Prefers the stored value; falls back to computing it from paidAt.
 *
 * @param {object} tx  Plain transaction object (from .lean() or Document)
 * @returns {Date|null}
 */
function resolveShipByDeadline(tx) {
  if (tx.shipByBusinessDeadline) return new Date(tx.shipByBusinessDeadline);
  if (tx.paidAt) return endOfNthBusinessDayFromAnchor(tx.paidAt, SHIP_BUSINESS_DAYS);
  return null;
}

/**
 * Compute the midpoint warning threshold (end of 3rd business day).
 * Once this date has passed and the seller has not shipped, the scheduler
 * sends a "2 days remaining" warning.
 *
 * @param {object} tx  Plain transaction object
 * @returns {Date|null}
 */
function midpointWarningThreshold(tx) {
  if (!tx.paidAt) return null;
  return endOfNthBusinessDayFromAnchor(tx.paidAt, MIDPOINT_BUSINESS_DAYS);
}

module.exports = {
  SHIP_BUSINESS_DAYS,
  MIDPOINT_BUSINESS_DAYS,
  applyShippingDeadlinesFromPaidAt,
  ensureShippingDeadlinesFromPaidAt,
  resolveShipByDeadline,
  midpointWarningThreshold
};
