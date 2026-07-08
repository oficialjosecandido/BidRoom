const logger = require('../utils/logger');
const redisService = require('./redis.service');

const CACHE_KEY = 'exchange_rates:eur';
const CACHE_LAST_KEY = 'exchange_rates:eur:last';
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24h — indicative display rates
const SUPPORTED = ['GBP', 'USD', 'BRL'];

/**
 * Returns EUR-based indicative rates: { base:'EUR', rates:{ GBP, USD, BRL }, fetchedAt }.
 * Cached in Redis 24h. Falls back to last-known value on API failure.
 */
async function getRates() {
  const cached = await redisService.get(CACHE_KEY);
  if (cached) return cached;

  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=EUR&to=${SUPPORTED.join(',')}`);
    if (!res.ok) throw new Error(`Frankfurter returned ${res.status}`);
    const data = await res.json();

    const payload = {
      base: 'EUR',
      rates: data.rates,
      fetchedAt: new Date().toISOString(),
    };

    await redisService.set(CACHE_KEY, payload, CACHE_TTL_SECONDS);
    await redisService.set(CACHE_LAST_KEY, payload); // permanent fallback, no TTL
    return payload;
  } catch (e) {
    logger.error('Exchange rate fetch failed', { error: e.message });

    const stale = await redisService.get(CACHE_LAST_KEY);
    if (stale) return stale;

    return { base: 'EUR', rates: {}, fetchedAt: null, unavailable: true };
  }
}

module.exports = { getRates, SUPPORTED };
