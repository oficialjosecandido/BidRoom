/**
 * Centralised express rate-limiter factory.
 *
 * Backed by Redis when REDIS_HOST is set (shared counters across all server
 * instances, the only correct option behind a horizontal scaler).
 * Falls back to the default in-memory store otherwise — fine for local dev and
 * for solo deployments without Redis.
 *
 * Uses a dedicated ioredis client for the rate-limit store so limiters can be
 * created at module load time (before redisService.connect() runs). ioredis
 * queues commands until the connection is ready, avoiding the
 * "Redis client not initialised" race on boot.
 */
const Redis = require('ioredis');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');

/** @type {import('ioredis').Redis | null} */
let rateLimitRedisClient = null;

function getRateLimitRedisClient() {
  if (!process.env.REDIS_HOST) return null;
  if (rateLimitRedisClient) return rateLimitRedisClient;

  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  rateLimitRedisClient = new Redis({
    host: process.env.REDIS_HOST,
    port,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: port === 6380 ? {} : undefined,
    lazyConnect: false,
    // rate-limit-redis may pipeline; null avoids ioredis throwing on retry.
    maxRetriesPerRequest: null,
    enableOfflineQueue: true,
  });

  rateLimitRedisClient.on('error', (err) => {
    logger.warn('Rate-limit Redis client error', { error: err.message });
  });

  return rateLimitRedisClient;
}

function buildStore(name) {
  if (!process.env.REDIS_HOST) {
    return null;
  }

  const client = getRateLimitRedisClient();
  if (!client) return null;

  try {
    // eslint-disable-next-line global-require
    const { default: RedisStore } = require('rate-limit-redis');
    return new RedisStore({
      prefix: name ? `rl:${name}:` : 'rl:',
      sendCommand: (...args) => client.call(...args),
    });
  } catch (err) {
    logger.warn('rate-limit-redis not available — falling back to in-memory store', {
      error: err.message,
    });
    return null;
  }
}

/**
 * Build a rate limiter with sensible defaults. Pass any of the standard
 * `express-rate-limit` options to override.
 *
 * @param {Object} opts
 * @param {number} opts.windowMs    Time window in milliseconds.
 * @param {number} opts.max         Max requests per window per IP.
 * @param {string} [opts.name]      Optional name used in logs / Redis key prefix.
 * @param {string} [opts.message]   Friendly message returned in the body.
 */
function createLimiter({ windowMs, max, name, message, ...rest } = {}) {
  if (!windowMs || !max) {
    throw new Error('createLimiter: windowMs and max are required');
  }

  const store = buildStore(name);

  if (!store && process.env.REDIS_HOST) {
    logger.info('Rate limiter using in-memory store (Redis store unavailable)', { name });
  } else if (!process.env.REDIS_HOST) {
    logger.debug('Rate limiter using in-memory store (REDIS_HOST not set)', { name });
  }

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store: store || undefined,
    message: {
      error: 'Too many requests',
      message: message || 'Too many requests. Please slow down.',
    },
    ...rest,
  });
}

/** Graceful shutdown helper (optional — call from SIGTERM handler if needed). */
function disconnectRateLimitRedis() {
  if (rateLimitRedisClient) {
    rateLimitRedisClient.disconnect();
    rateLimitRedisClient = null;
  }
}

module.exports = { createLimiter, disconnectRateLimitRedis };
