/**
 * Strips MongoDB operators out of request input.
 *
 * Express parses bracket notation into objects, so `?status[$ne]=active`
 * arrives as `{ $ne: 'active' }`. Mongoose casts values but does not object to
 * a query operator where a string was expected, so a handler that does
 * `query.status = status` hands that straight to the driver. On this API that
 * reads out listings in `draft` and `pending_review` — the ones deliberately
 * held back from the public until a reviewer approves them.
 *
 * Keys are the only thing touched. A key is dropped when it starts with `$`
 * (an operator) or contains a `.` (addresses a nested field, e.g.
 * `seller.isAdmin`). Values are left exactly as sent, because a description
 * that mentions `$500` is not an attack.
 *
 * `__proto__`, `constructor` and `prototype` go too: `JSON.parse` makes them
 * own properties rather than touching the prototype, but anything downstream
 * that spreads or `Object.assign`s the body would then pollute it.
 *
 * Objects are mutated in place rather than reassigned — `req.query` is a
 * getter in Express 5, so `req.query = clean` would throw there.
 */
const logger = require('../utils/logger');

const FORBIDDEN_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 8;

function isForbiddenKey(key) {
  return key.startsWith('$') || key.includes('.') || FORBIDDEN_NAMES.has(key);
}

function isWalkable(value, depth) {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return false;
  // Buffers, Dates and streams carry no user-supplied keys worth walking.
  return !Buffer.isBuffer(value) && !(value instanceof Date);
}

/**
 * Removes forbidden keys from `value` and its descendants, collecting the
 * removed paths for the log line. Returns how many keys it removed.
 */
function scrub(value, depth, path, removed) {
  if (!isWalkable(value, depth)) return 0;

  if (Array.isArray(value)) {
    let count = 0;
    // Elements are left in place even when emptied: deleting one would shift
    // every index after it, and an array is never a scalar filter anyway.
    for (let i = 0; i < value.length; i++) {
      count += scrub(value[i], depth + 1, `${path}[${i}]`, removed);
    }
    return count;
  }

  let count = 0;
  for (const key of Object.keys(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isForbiddenKey(key)) {
      delete value[key];
      removed.push(childPath);
      count++;
      continue;
    }
    const child = value[key];
    const removedBelow = scrub(child, depth + 1, childPath, removed);
    count += removedBelow;
    // `?status[$ne]=active` would otherwise leave `status` as `{}`, which a
    // handler assigns into a filter and Mongoose rejects as a cast error — a
    // 500 instead of a catalogue. Dropping the husk lets the route's own
    // default apply, which is what an absent parameter means.
    if (removedBelow > 0 && isPlainEmptyObject(child)) {
      delete value[key];
    }
  }
  return count;
}

function isPlainEmptyObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !Buffer.isBuffer(value) &&
    !(value instanceof Date) &&
    Object.keys(value).length === 0
  );
}

function sanitizeMongo(req, res, next) {
  const removed = [];
  for (const source of ['query', 'body', 'params']) {
    scrub(req[source], 0, source, removed);
  }

  if (removed.length > 0) {
    // Not an error for the caller: the request continues without the operator.
    // Logged because a legitimate client never sends these, so every line here
    // is either someone probing or a bug in our own frontend.
    logger.warn('Stripped Mongo operators from request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl?.split('?')[0] || req.path,
      ip: req.ip,
      removed: removed.slice(0, 20),
    });
  }

  next();
}

module.exports = { sanitizeMongo, isForbiddenKey };
