/**
 * Legal thresholds for vehicle listings, in one place.
 *
 * Every number here is a legal judgement call, not a product one, and none of
 * them has been confirmed by a lawyer yet. They live together so that the
 * review before launch is a single file to read, and so that changing one is a
 * config change rather than a hunt through the routes.
 *
 * The model: BidRoom runs the auction and introduces the parties, but the car
 * itself is paid for and handed over off-platform. BidRoom never touches the
 * money for the vehicle, which is what keeps the direct AML exposure small —
 * these rules exist to keep it small.
 */

/** Read a positive number from the environment, falling back to the default. */
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

module.exports = {
  /**
   * Ceiling on what a vehicle may be listed for, in euros.
   *
   * High-value cars are the known money-laundering vehicle, so excluding them
   * removes the risky tail in one move. €20.000 is a pragmatic starting point:
   * it keeps ordinary used cars and drops the luxury bracket. Start low, raise
   * it later once a lawyer has drawn the line — the point is that a documented
   * ceiling exists.
   *
   * PENDING LEGAL REVIEW.
   */
  MAX_VEHICLE_VALUE_EUR: envNumber('MAX_VEHICLE_VALUE_EUR', 20000),

  /**
   * The ceiling applies to the prices the seller sets, not to the price the
   * auction reaches.
   *
   * Laundering needs an *agreed* price; a competitive auction produces one the
   * market decided, which is a safeguard in itself. Capping the final bid would
   * mean cutting genuine auctions short for no AML gain. (This is "Option A" in
   * the spec, and the reason the alternative was rejected.)
   */
  VALUE_CAP_APPLIES_TO: ['startingPrice', 'buyNowPrice'],

  /**
   * How many vehicles someone may list as a private seller in a rolling year
   * before they are flagged as a possible undeclared trader.
   *
   * Declaring yourself private while trading professionally dodges the consumer
   * warranty owed under DL 84/2021, and leaves BidRoom facilitating that. The
   * flag does not block anyone — where "professional in fact" begins is a legal
   * question — it puts the account in front of a human.
   *
   * PENDING LEGAL REVIEW.
   */
  PRIVATE_SELLER_VEHICLE_THRESHOLD: envNumber('PRIVATE_SELLER_VEHICLE_THRESHOLD', 4),

  /**
   * A buyer winning this many vehicle auctions inside the window is flagged.
   * Repeated high-value purchases in a short period is a classic layering
   * pattern. Again: flag for review, never an automatic block.
   *
   * PENDING LEGAL REVIEW.
   */
  REPEAT_WINNER: { windowDays: 30, threshold: 3 },

  /**
   * A brand-new account listing a vehicle priced near the ceiling is the shape
   * of someone testing the limit. `nearCapRatio` is the fraction of the ceiling
   * above which "high value" starts.
   */
  NEW_SELLER_HIGH_VALUE: { accountAgeDays: 30, nearCapRatio: 0.75 }
};
