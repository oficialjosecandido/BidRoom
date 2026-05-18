/**
 * Business-Day Utilities
 *
 * Defines "business day" as Monday–Friday in UTC (no public-holiday calendar).
 * Used by the shipping deadline feature to compute:
 *   - Day 3 midpoint warning threshold
 *   - Day 5 ship-by deadline (auto-cancel if not shipped)
 *
 * Counting rules (example: anchor = Wednesday):
 *   Day 1 = Wednesday (first business day on or after the anchor)
 *   Day 2 = Thursday
 *   Day 3 = Friday      ← midpoint warning fires after this day ends
 *   Day 4 = Monday       (weekend skipped)
 *   Day 5 = Tuesday      ← auto-cancel fires after this day ends
 *
 * If the anchor falls on a weekend (Sat/Sun), day 1 rolls to the following Monday.
 *
 * All deadlines are set to the END of the target day: 23:59:59.999 UTC.
 */

/**
 * @param {Date} d
 * @returns {boolean} true if d falls on Saturday (6) or Sunday (0) in UTC
 */
function isUtcWeekend(d) {
  const w = d.getUTCDay();
  return w === 0 || w === 6;
}

/**
 * Return 23:59:59.999 UTC on the first weekday on or after the given calendar date.
 * If the date is Sat/Sun, advances to the following Monday.
 * @param {number} year
 * @param {number} monthZeroBased  0 = January
 * @param {number} date            Day of month
 * @returns {Date}
 */
function utcEndOfFirstBusinessDayOnOrAfter(year, monthZeroBased, date) {
  const cur = new Date(Date.UTC(year, monthZeroBased, date, 23, 59, 59, 999));
  while (isUtcWeekend(cur)) {
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return cur;
}

/**
 * Compute the end-of-day (23:59:59.999 UTC) for the n-th business day
 * counting from the anchor date (inclusive: the anchor's weekday = day 1).
 *
 * @param {Date|string|number} anchor  The starting point (e.g. paidAt)
 * @param {number} n                   Target business day (1-based). Use 3 for
 *                                     midpoint warning, 5 for ship-by deadline.
 * @returns {Date}
 *
 * @example
 *   // anchor = Friday 2026-04-10
 *   endOfNthBusinessDayFromAnchor('2026-04-10T15:00:00Z', 3)
 *   // → Tuesday 2026-04-14 23:59:59.999 UTC  (Fri→Mon→Tue)
 *
 *   endOfNthBusinessDayFromAnchor('2026-04-10T15:00:00Z', 5)
 *   // → Thursday 2026-04-16 23:59:59.999 UTC
 */
function endOfNthBusinessDayFromAnchor(anchor, n) {
  const a = anchor instanceof Date ? anchor : new Date(anchor);
  let cur = utcEndOfFirstBusinessDayOnOrAfter(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  let counted = 1;
  while (counted < n) {
    do {
      cur.setUTCDate(cur.getUTCDate() + 1);
      cur.setUTCHours(23, 59, 59, 999);
    } while (isUtcWeekend(cur));
    counted++;
  }
  return new Date(cur.getTime());
}

module.exports = {
  isUtcWeekend,
  endOfNthBusinessDayFromAnchor
};
