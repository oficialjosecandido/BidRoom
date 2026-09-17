/**
 * AML monitoring for vehicle auctions (Lei 83/2017).
 *
 * BidRoom never touches the money for a car — the auction sets the price and
 * introduces the parties, the payment happens between them, off-platform. That
 * keeps the direct exposure small, but the platform still sees the pattern that
 * a launderer leaves behind, and seeing it without recording it is worse than
 * not looking.
 *
 * Two rules, both intentionally observational:
 *
 *   - Nothing here ever blocks a listing, a bid or a sale. Every one of these
 *     patterns has an innocent explanation — a dealer's buyer, a collector, a
 *     new account that happens to be selling a good car — and an automatic
 *     block would punish the honest majority for a suspicion no algorithm can
 *     settle. What the law asks for is that the platform notices and reviews.
 *   - Nothing here ever throws. A monitoring failure must never be the reason a
 *     seller cannot list or an auction cannot close.
 *
 * Two flags from the spec are deliberately not implemented here:
 *
 *   - `priceAnomaly` (a car listed far below market value) needs a market-value
 *     estimate for the make/model/year, and BidRoom has no valuation source.
 *     Comparing against other BidRoom listings would just compare a handful of
 *     cars to each other. Left out rather than shipped as a flag that fires at
 *     random; revisit if a valuation feed is ever added.
 *   - `relatedParties` (buyer and seller are the same person or connected) is
 *     already covered, and better, by fraudDetectionService's `shill_bid` and
 *     `multi_account` checks, which run on every bid with IP and device
 *     signals this service does not have.
 */

const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const FraudEvent = require('../models/FraudEvent');
const rules = require('../config/vehicleRules');
const { VEHICLE_CATEGORY } = require('./vehicleComplianceService');
const logger = require('../utils/logger');

/** Days back from now, as a Date. */
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Record a flag unless the same one is already open for this user.
 *
 * Re-flagging on every repeat would bury the queue under duplicates of one
 * account, and the reviewer's job is the account, not the individual listing.
 */
async function flagOnce({ type, severity, userId, listingId, details }) {
  const open = await FraudEvent.findOne({ type, userId, resolved: false })
    .select('_id')
    .lean();
  if (open) return null;

  return FraudEvent.create({ type, severity, userId, listingId, details });
}

/**
 * A new account listing a vehicle priced near the ceiling.
 *
 * Neither half is suspicious alone — everyone's account is new once, and cars
 * are expensive. Together they are the shape of someone who arrived to move a
 * specific amount of money, so the pair is worth a look.
 */
async function checkNewSellerHighValue(seller, listing) {
  try {
    if (listing.category !== VEHICLE_CATEGORY) return null;

    const { accountAgeDays, nearCapRatio } = rules.NEW_SELLER_HIGH_VALUE;
    const createdAt = seller.createdAt ? new Date(seller.createdAt) : null;
    if (!createdAt || createdAt <= daysAgo(accountAgeDays)) return null;

    const threshold = rules.MAX_VEHICLE_VALUE_EUR * nearCapRatio;
    const value = Math.max(Number(listing.startingPrice) || 0, Number(listing.buyNowPrice) || 0);
    if (value < threshold) return null;

    return await flagOnce({
      type: 'aml_new_seller_high_value',
      severity: 'medium',
      userId: seller._id,
      listingId: listing._id,
      details: {
        listingValueEur: value,
        highValueThresholdEur: threshold,
        accountAgeDays: Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000)),
        note: 'New account listing a vehicle near the value ceiling.'
      }
    });
  } catch (err) {
    logger.error('[aml] new-seller-high-value check failed:', err.message);
    return null;
  }
}

/**
 * A buyer winning several vehicle auctions in a short window.
 *
 * Buying car after car in a month is how value gets layered across assets that
 * are easy to resell. A dealer restocking looks identical from here, which is
 * exactly why this goes to a human instead of to an automatic block — and why
 * the reviewer's likely outcome is to ask the buyer to declare as professional.
 */
async function checkRepeatWinner(listing) {
  try {
    if (listing.category !== VEHICLE_CATEGORY) return null;

    const winnerId = listing.winner?._id || listing.winner;
    if (!winnerId) return null;

    const { windowDays, threshold } = rules.REPEAT_WINNER;
    const wins = await Listing.countDocuments({
      winner: winnerId,
      category: VEHICLE_CATEGORY,
      endDate: { $gte: daysAgo(windowDays) }
    });
    if (wins < threshold) return null;

    return await flagOnce({
      type: 'aml_repeat_winner',
      severity: 'high',
      userId: winnerId,
      listingId: listing._id,
      details: {
        vehiclesWon: wins,
        windowDays,
        threshold,
        note: 'Repeated vehicle auction wins in a short window (possible layering).'
      }
    });
  } catch (err) {
    logger.error('[aml] repeat-winner check failed:', err.message);
    return null;
  }
}

/**
 * Entry point for the scheduler: called after a vehicle auction closes.
 *
 * Takes an id rather than a document because the winner is set while the
 * auction is being closed, so the caller's copy is stale by the time we run.
 */
async function onAuctionEnded(listingId) {
  try {
    const listing = await Listing.findById(listingId)
      .select('_id category winner endDate')
      .lean();
    if (!listing || listing.category !== VEHICLE_CATEGORY) return null;
    return await checkRepeatWinner(listing);
  } catch (err) {
    logger.error('[aml] auction-ended check failed:', err.message);
    return null;
  }
}

/**
 * Entry point for listing creation. Runs the seller-side checks together so the
 * route has one call to make, and awaits nothing the seller is waiting on.
 */
async function onVehicleListingCreated(seller, listing) {
  try {
    const full = seller.createdAt ? seller : await Customer.findById(seller._id).lean();
    if (!full) return;
    await checkNewSellerHighValue(full, listing);
  } catch (err) {
    logger.error('[aml] listing-created checks failed:', err.message);
  }
}

module.exports = {
  onAuctionEnded,
  onVehicleListingCreated,
  checkNewSellerHighValue,
  checkRepeatWinner
};
