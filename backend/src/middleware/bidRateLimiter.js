/**
 * Per-user/IP bid rate limiter.
 * Express-rate-limit runs before auth so we can't key by user ID there.
 * This middleware runs inside the bid route, after auth, and enforces tighter per-user limits.
 *
 * Limits:
 *   Authenticated users: 6 bids per 60 seconds
 *   Guest (IP only):     3 bids per 60 seconds
 */

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_AUTH = 6;
const MAX_GUEST = 3;

// Map<key, { count, resetAt }>
const store = new Map();

// Purge expired entries every 5 minutes to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000).unref();

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Call inside the bid route handler (after auth resolves req.user).
 * @param {object} req - Express request (req.user populated by auth middleware)
 * @returns {{ allowed: boolean, remaining: number, resetAt: number }}
 */
function checkBidRateLimit(req) {
  const uid  = req.user?.uid;
  const ip   = getClientIp(req);
  const key  = uid ? `u:${uid}` : `ip:${ip}`;
  const max  = uid ? MAX_AUTH : MAX_GUEST;
  const now  = Date.now();

  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    store.set(key, entry);
  }

  entry.count++;
  const allowed = entry.count <= max;
  return { allowed, remaining: Math.max(0, max - entry.count), resetAt: entry.resetAt };
}

module.exports = { checkBidRateLimit, getClientIp };
