/**
 * Mandatory pagination for public list endpoints.
 *
 * "Mandatory" is the whole point: a client that sends no parameters at all
 * still gets a page, not the collection. An endpoint that returns every row it
 * finds is a bulk-export endpoint whether or not anyone meant it to be one —
 * one request, the entire bid history of a listing, no session, no cost. The
 * allowlist in bidFormat.js decides *what* a row may say; this decides *how
 * many* rows a stranger may take per request.
 *
 * Callers state a default and a hard cap. The cap is not negotiable by query
 * string: ?limit=100000 yields the cap, not an error, because failing loudly
 * here would only tell a scraper which number to try next.
 */

/**
 * @param {object} query            req.query
 * @param {object} opts
 * @param {number} opts.defaultLimit  page size when the client asks for none
 * @param {number} opts.maxLimit      hard ceiling, whatever the client asks for
 * @returns {{ limit: number, offset: number }}
 */
function parsePageParams(query = {}, { defaultLimit, maxLimit }) {
  if (!defaultLimit || !maxLimit) {
    throw new Error('parsePageParams: defaultLimit and maxLimit are required');
  }

  const rawLimit = parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(rawLimit, maxLimit)
    : Math.min(defaultLimit, maxLimit);

  // `page` is accepted as a convenience; `offset` wins when both are sent.
  const rawOffset = parseInt(query.offset, 10);
  const rawPage = parseInt(query.page, 10);
  let offset = 0;
  if (Number.isFinite(rawOffset) && rawOffset > 0) {
    offset = rawOffset;
  } else if (Number.isFinite(rawPage) && rawPage > 1) {
    offset = (rawPage - 1) * limit;
  }

  return { limit, offset };
}

/**
 * The envelope every paginated endpoint returns, so clients can page without
 * guessing whether there is more.
 */
function pageMeta({ total, limit, offset }) {
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total
  };
}

module.exports = { parsePageParams, pageMeta };
