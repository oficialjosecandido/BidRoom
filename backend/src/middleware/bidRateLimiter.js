/**
 * Per-user/IP bid rate limiter.
 *
 * Express-rate-limit runs before auth so we can't key by user ID there.
 * This middleware runs inside the bid route, after auth, and enforces tighter
 * per-user limits.
 *
 * Limits:
 *   Authenticated users: 6 bids per 60 seconds
 *   Guest (IP only):     3 bids per 60 seconds
 *
 * Storage:
 *   - Redis when available (shared across all server instances — the only
 *     correct option behind a horizontal scaler).
 *   - In-memory Map as fallback for local dev / single-instance deploys.
 */

const redisService = require('../services/redis.service');
const logger = require('../utils/logger');

const WINDOW_MS = 60 * 1000;
const WINDOW_SECONDS = WINDOW_MS / 1000;
const MAX_AUTH = 6;
const MAX_GUEST = 3;

// In-memory fallback. Map<key, { count, resetAt }>.
const memoryStore = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (entry.resetAt <= now) memoryStore.delete(key);
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

function isRedisReady() {
  return Boolean(redisService.isConnected && redisService.client);
}

async function incrementInRedis(key, max) {
  const now = Date.now();
  const redisKey = `bidlimit:${key}`;
  try {
    // Atomic INCR + EXPIRE pipeline. EXPIRE only sets when missing (NX) so we
    // don't keep resetting the TTL on every bid.
    const pipeline = redisService.client.multi();
    pipeline.incr(redisKey);
    pipeline.expire(redisKey, WINDOW_SECONDS, 'NX');
    pipeline.pttl(redisKey);
    const results = await pipeline.exec();
    if (!results) throw new Error('redis pipeline returned no results');
    // ioredis exec result: [[err, value], ...]
    const count = Number(results[0][1]) || 0;
    let pttl = Number(results[2][1]);
    if (!Number.isFinite(pttl) || pttl < 0) pttl = WINDOW_MS;
    return {
      allowed: count <= max,
      remaining: Math.max(0, max - count),
      resetAt: now + pttl,
    };
  } catch (err) {
    logger.warn('bidRateLimiter Redis failed, falling back to memory', { error: err.message });
    return null;
  }
}

function incrementInMemory(key, max) {
  const now = Date.now();
  let entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    memoryStore.set(key, entry);
  }
  entry.count += 1;
  return {
    allowed: entry.count <= max,
    remaining: Math.max(0, max - entry.count),
    resetAt: entry.resetAt,
  };
}

/**
 * Call inside the bid route handler (after auth resolves req.user).
 * @param {object} req Express request (req.user populated by auth middleware).
 * @returns {Promise<{ allowed: boolean, remaining: number, resetAt: number }>}
 */
async function checkBidRateLimit(req) {
  const uid = req.user?.uid;
  const ip = getClientIp(req);
  const key = uid ? `u:${uid}` : `ip:${ip}`;
  const max = uid ? MAX_AUTH : MAX_GUEST;

  if (isRedisReady()) {
    const result = await incrementInRedis(key, max);
    if (result) return result;
  }
  return incrementInMemory(key, max);
}

module.exports = { checkBidRateLimit, getClientIp };
