/**
 * One word for how a listing sells, and the rules that follow from it.
 *
 * `sellingMode` is 'bidding' | 'offers'. The spec that unified the two made
 * them exclusive — a listing is one or the other, never both — and three
 * separate pieces of code enforce that: the normaliser below, the invariants
 * the model applies on every save, and the refusals the buy-now route returns.
 *
 * They live here rather than inside routes/listings.js and models/Listing.js
 * because each one is a pure function of a listing, the tests run with no
 * database (see jest.config.js), and a guard nobody can call is a guard nobody
 * can check. routes/listings.js and models/Listing.js now call these.
 */

const SELLING_MODES = new Set(['bidding', 'offers']);

/**
 * The spellings a client may still be sending.
 *
 * Accepted because a browser holding the previous bundle keeps posting them
 * until it reloads, and a shared or bookmarked search URL carries
 * `?auctionFormat=best-offer` indefinitely.
 */
const LEGACY_SELLING_MODES = {
  'highest-bid': 'bidding',
  'auction': 'bidding',
  'best-offer': 'offers'
};

/**
 * The first recognisable mode among the candidates, or null.
 *
 * Returns null — rather than a default — for anything unrecognised, so a caller
 * can tell "not specified" from a value.
 *
 * 'giveaway' is not a selling mode and never was: it belongs to `saleFormat`,
 * which says whether there is a price at all. It is rejected here so it cannot
 * be mistaken for one.
 */
function normalizeSellingMode(...candidates) {
  for (const raw of candidates) {
    if (raw == null) continue;
    const value = String(raw).trim();
    if (SELLING_MODES.has(value)) return value;
    if (LEGACY_SELLING_MODES[value]) return LEGACY_SELLING_MODES[value];
  }
  return null;
}

/**
 * Commission rate, and the fields the mode forbids, applied in place.
 *
 * Called from the pre-save hook, so it runs on every write no matter which
 * route made it. Mutates and returns the document.
 *
 * `buyNowPrice` is the dangerous one to leave standing on an offers listing:
 * the buy-now route used to check only that a price existed, never the mode, so
 * an offers listing carrying one let a buyer close the sale outright and skip
 * the seller's accept/decline entirely. Cleared here as well as refused there —
 * the invariant holds in the data, not only at one entry point.
 *
 * Giveaways are skipped whole: there is no price, so there is no commission.
 */
function applySellingModeInvariants(listing) {
  if (!listing || listing.saleFormat === 'giveaway') return listing;

  if (listing.sellingMode === 'bidding') {
    // A Private Room is the premium outcome, and it is priced as one.
    listing.commissionRate = listing.allowPrivateRoom ? 0.06 : 0.035;
  } else if (listing.sellingMode === 'offers') {
    listing.commissionRate = 0.035;
    listing.allowPrivateRoom = false;
    listing.buyNowPrice = null;
  }

  return listing;
}

/**
 * Why Buy Now is unavailable on this listing, or null when it is available.
 *
 * Returns `{ status, error, message }` so the route is one line and the reasons
 * — and their order, which decides which one the caller is told about — are
 * testable without a database or an HTTP server. Shaped after
 * `scheduleBlock` in utils/listingSchedule.js, which the same route already
 * uses this way.
 *
 * Does not cover whether the buyer is the seller: that needs the viewer, not
 * just the listing, and stays in the route.
 */
function buyNowBlock(listing) {
  if (!listing) return null;

  // Buy Now is a way of ending a competition early, so it only means anything
  // where there is one. In offers mode the seller decides who buys; letting a
  // price close the sale here would take that decision away from them.
  if (listing.sellingMode !== 'bidding') {
    return {
      status: 400,
      error: 'Buy Now not available',
      message: 'This listing takes offers. Send the seller an offer instead.'
    };
  }

  if (!listing.buyNowPrice) {
    return {
      status: 400,
      error: 'Buy Now not available',
      message: 'This listing does not have a Buy Now price.'
    };
  }

  if (listing.status !== 'active') {
    return {
      status: 400,
      error: 'Listing not active',
      message: 'This listing is no longer available.'
    };
  }

  // A live Private Room is not interruptible from outside it.
  //
  // A bidding listing may carry both a Buy Now price and allowPrivateRoom —
  // the invariants above only clear them for offers mode — and while a room is
  // running the listing still reads status 'active' with winner null, which is
  // everything this route used to check. So anyone holding the listing URL
  // could close the auction out from under the invited bidders mid-room,
  // voiding bids already placed and the 6% room commission with them. Same
  // class of bug as the sellingMode check above: the condition the route tested
  // was not the condition that mattered.
  if (listing.privateRoomStatus === 'active' || listing.privateRoomStatus === 'invited') {
    return {
      status: 409,
      error: 'Private Room in progress',
      message: 'This listing is in a Private Room right now. Buy Now is unavailable until it closes.'
    };
  }

  return null;
}

module.exports = {
  SELLING_MODES,
  LEGACY_SELLING_MODES,
  normalizeSellingMode,
  applySellingModeInvariants,
  buyNowBlock
};
