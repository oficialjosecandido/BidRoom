/**
 * Tests for the per-user bid rate limiter.
 *
 * These tests force the in-memory branch by stubbing the redis service to
 * `isConnected = false`. The Redis branch is exercised by the real bid route
 * in integration tests once those are wired up.
 */

jest.mock('../src/services/redis.service', () => ({
  isConnected: false,
  client: null,
}));

const { checkBidRateLimit, getClientIp } = require('../src/middleware/bidRateLimiter');

const buildReq = (overrides = {}) => ({
  user: undefined,
  headers: {},
  socket: { remoteAddress: '127.0.0.1' },
  ...overrides,
});

describe('checkBidRateLimit (in-memory fallback)', () => {
  it('uses 6/min for authenticated users', async () => {
    const req = buildReq({ user: { uid: 'user-A' } });
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = await checkBidRateLimit(req);
      expect(last.allowed).toBe(true);
    }
    last = await checkBidRateLimit(req);
    expect(last.allowed).toBe(false);
    expect(last.remaining).toBe(0);
    expect(last.resetAt).toBeGreaterThan(Date.now());
  });

  it('uses 3/min for guests keyed by IP', async () => {
    const req = buildReq({
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    for (let i = 0; i < 3; i += 1) {
      const res = await checkBidRateLimit(req);
      expect(res.allowed).toBe(true);
    }
    const blocked = await checkBidRateLimit(req);
    expect(blocked.allowed).toBe(false);
  });

  it('separates counters per user uid', async () => {
    const a = buildReq({ user: { uid: 'split-A' } });
    const b = buildReq({ user: { uid: 'split-B' } });
    for (let i = 0; i < 6; i += 1) await checkBidRateLimit(a);
    const aBlocked = await checkBidRateLimit(a);
    const bFresh = await checkBidRateLimit(b);
    expect(aBlocked.allowed).toBe(false);
    expect(bFresh.allowed).toBe(true);
  });
});

describe('getClientIp', () => {
  it('prefers the first x-forwarded-for entry', () => {
    const ip = getClientIp(buildReq({
      headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
    }));
    expect(ip).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip then socket', () => {
    expect(getClientIp(buildReq({ headers: { 'x-real-ip': '5.5.5.5' } }))).toBe('5.5.5.5');
    expect(getClientIp(buildReq())).toBe('127.0.0.1');
  });
});
