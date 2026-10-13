/**
 * What a seller may no longer change once a listing is live.
 *
 * Two different locks, and the difference matters:
 *
 *   Once anyone has bid or made an offer, nothing is editable at all — people
 *   acted on the listing as it was described. That check needs the bid and
 *   offer counts, so it stays in the route.
 *
 *   Before that, while the listing is live but nobody has engaged, most of it
 *   is still editable and this set is not. These are the fields that decide
 *   what is being sold and how, so changing one would make the listing a
 *   different listing under the same URL — and under the same watchlist
 *   entries, notifications and search results.
 *
 * Here rather than inside routes/listings.js because the set *is* the contract:
 * a field missing from it is editable, silently, and the only way to notice is
 * to read the list. A test can read it.
 */

const CRITICAL_FIELDS = new Set([
  // What the item is.
  'title', 'titlePt', 'category', 'subCategory',

  // How it sells. `sellingMode` is the unified word; `auctionFormat` is the
  // legacy spelling a stale bundle may still post, and is locked too so the old
  // name cannot be used to get around the new one. `allowPrivateRoom` goes with
  // them because it sets the commission rate (6% against 3.5%) and decides
  // whether invitations will be sent at all.
  'sellingMode', 'auctionFormat', 'allowPrivateRoom',

  // When it ends, and what it is worth right now. `currentPrice` is the live
  // figure bidders are reacting to; the seller's own floor prices stay editable
  // while nobody has engaged, which is deliberate.
  'durationSlot', 'endDate', 'currentPrice'
]);

/**
 * The locked fields this request body is trying to change, in the order the
 * caller sent them. Empty array means the edit is allowed through.
 *
 * Presence is what counts, not the value: a body that re-sends `sellingMode`
 * unchanged is still refused. Being lenient would mean reading the current
 * document and comparing every field, and a form that always posts its whole
 * state would then be able to change one of these by accident.
 */
function lockedFieldsAttempted(body) {
  if (!body || typeof body !== 'object') return [];
  return Object.keys(body).filter(key => CRITICAL_FIELDS.has(key));
}

module.exports = { CRITICAL_FIELDS, lockedFieldsAttempted };
