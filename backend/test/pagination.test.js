const { parsePageParams, pageMeta } = require('../src/utils/pagination');

const OPTS = { defaultLimit: 50, maxLimit: 100 };

describe('parsePageParams', () => {
  it('paginates a request that asks for nothing — the point of "mandatory"', () => {
    expect(parsePageParams({}, OPTS)).toEqual({ limit: 50, offset: 0 });
    expect(parsePageParams(undefined, OPTS)).toEqual({ limit: 50, offset: 0 });
  });

  it('honours a limit below the cap', () => {
    expect(parsePageParams({ limit: '10' }, OPTS).limit).toBe(10);
  });

  it('clamps to the cap instead of rejecting, whatever is asked for', () => {
    // Silently clamping beats a 400: an error would tell a scraper which number
    // to try next.
    for (const limit of ['101', '1000', '100000', '9999999999']) {
      expect(parsePageParams({ limit }, OPTS).limit).toBe(100);
    }
  });

  it('falls back to the default for junk, negatives and zero', () => {
    for (const limit of ['all', '', 'NaN', '-1', '0', 'Infinity', '1e9abc', null, undefined, {}]) {
      const { limit: parsed } = parsePageParams({ limit }, OPTS);
      expect(parsed).toBeGreaterThan(0);
      expect(parsed).toBeLessThanOrEqual(100);
    }
    expect(parsePageParams({ limit: 'all' }, OPTS).limit).toBe(50);
    expect(parsePageParams({ limit: '-5' }, OPTS).limit).toBe(50);
  });

  it('never exceeds the cap even when the default is set above it', () => {
    expect(parsePageParams({}, { defaultLimit: 500, maxLimit: 100 }).limit).toBe(100);
  });

  it('reads offset, ignoring negatives', () => {
    expect(parsePageParams({ offset: '50' }, OPTS).offset).toBe(50);
    expect(parsePageParams({ offset: '-10' }, OPTS).offset).toBe(0);
    expect(parsePageParams({ offset: 'x' }, OPTS).offset).toBe(0);
  });

  it('accepts page as a convenience, and lets offset win when both are sent', () => {
    expect(parsePageParams({ page: '3' }, OPTS).offset).toBe(100);
    expect(parsePageParams({ page: '1' }, OPTS).offset).toBe(0);
    expect(parsePageParams({ page: '0' }, OPTS).offset).toBe(0);
    expect(parsePageParams({ page: '3', offset: '7' }, OPTS).offset).toBe(7);
  });

  it('derives page offsets from the clamped limit, not the requested one', () => {
    // ?limit=1000&page=2 must not skip 1000 rows.
    expect(parsePageParams({ limit: '1000', page: '2' }, OPTS)).toEqual({ limit: 100, offset: 100 });
  });

  it('refuses to be built without an explicit default and cap', () => {
    expect(() => parsePageParams({}, {})).toThrow(/defaultLimit and maxLimit/);
    expect(() => parsePageParams({}, { defaultLimit: 10 })).toThrow(/defaultLimit and maxLimit/);
  });
});

describe('pageMeta', () => {
  it('reports hasMore while rows remain', () => {
    expect(pageMeta({ total: 120, limit: 50, offset: 0 })).toEqual({
      total: 120, limit: 50, offset: 0, hasMore: true
    });
    expect(pageMeta({ total: 120, limit: 50, offset: 50 }).hasMore).toBe(true);
  });

  it('reports hasMore false on the last page and on an exact fit', () => {
    expect(pageMeta({ total: 120, limit: 50, offset: 100 }).hasMore).toBe(false);
    expect(pageMeta({ total: 100, limit: 50, offset: 50 }).hasMore).toBe(false);
    expect(pageMeta({ total: 0, limit: 50, offset: 0 }).hasMore).toBe(false);
  });
});
