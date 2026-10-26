/**
 * Helpers for turning query-string input into Mongo filter values.
 *
 * Express parses bracket notation, so a single parameter can arrive as a
 * string, an array (`?category[]=a&category[]=b`) or an object
 * (`?category[$ne]=x`). Assigning any of the last two into a filter is at best
 * a 500 on the Mongoose cast and at worst a query we did not write.
 */

/**
 * A query parameter as a trimmed string, or '' if it was anything else.
 * A browse filter is a single string or it is absent.
 */
function queryString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Statuses the public catalogue may ask for.
 *
 * `draft` and `pending_review` are the listings no reviewer has approved yet —
 * the point of the moderation queue is that they are not public — and
 * `cancelled` is a listing the seller pulled.
 */
const PUBLIC_BROWSE_STATUSES = ['active', 'ended'];

/**
 * The requested status if the public may see it, else 'active'.
 * Falls back rather than 400s, so a stale bookmark still shows a catalogue.
 */
function publicBrowseStatus(value) {
  const status = queryString(value);
  return PUBLIC_BROWSE_STATUSES.includes(status) ? status : 'active';
}

module.exports = { queryString, publicBrowseStatus, PUBLIC_BROWSE_STATUSES };
