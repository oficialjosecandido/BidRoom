const { sanitizeMongo } = require('../src/middleware/sanitizeMongo');

function buildReq(overrides = {}) {
  return {
    method: 'GET',
    originalUrl: '/api/listings',
    path: '/api/listings',
    ip: '203.0.113.1',
    id: 'req-1',
    query: {},
    body: {},
    params: {},
    ...overrides,
  };
}

describe('sanitizeMongo middleware', () => {
  // Every strip logs a warning; the suite asserts behaviour, not the log line.
  let warnSpy;
  beforeAll(() => { warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterAll(() => warnSpy.mockRestore());

  it('strips operator keys from the query and still calls next', () => {
    const req = buildReq({ query: { status: { $ne: 'active' } } });
    const next = jest.fn();

    sanitizeMongo(req, {}, next);

    // The husk goes too, so the route's own default applies rather than `{}`
    // reaching a filter and failing the cast.
    expect(req.query).toEqual({});
    expect(next).toHaveBeenCalled();
  });

  it('keeps sibling parameters when one is stripped', () => {
    const req = buildReq({ query: { status: { $ne: 'active' }, category: 'art', page: '2' } });

    sanitizeMongo(req, {}, jest.fn());

    expect(req.query).toEqual({ category: 'art', page: '2' });
  });

  it('leaves ordinary values untouched, including a $ inside a value', () => {
    const req = buildReq({
      query: { search: 'camera for $500', category: 'photography' },
      body: { description: 'Worth $1.000 — $$$' },
    });

    sanitizeMongo(req, {}, jest.fn());

    expect(req.query).toEqual({ search: 'camera for $500', category: 'photography' });
    expect(req.body).toEqual({ description: 'Worth $1.000 — $$$' });
  });

  it('strips dotted keys, which address a nested field', () => {
    const req = buildReq({ body: { 'seller.isAdmin': true, title: 'Lote 3' } });

    sanitizeMongo(req, {}, jest.fn());

    expect(req.body).toEqual({ title: 'Lote 3' });
  });

  it('strips operators nested inside objects and arrays', () => {
    const req = buildReq({
      body: { filter: { price: { $gt: 0 } }, items: [{ $where: 'x' }, { name: 'ok' }] },
    });

    sanitizeMongo(req, {}, jest.fn());

    // `filter.price` emptied, so price and then filter are dropped as husks.
    expect(req.body.filter).toBeUndefined();
    // Array elements stay in place: deleting one would shift every later index.
    expect(req.body.items).toEqual([{}, { name: 'ok' }]);
  });

  it('keeps an object that still has legitimate keys after stripping', () => {
    const req = buildReq({ body: { filter: { $where: 'x', category: 'art' } } });

    sanitizeMongo(req, {}, jest.fn());

    expect(req.body.filter).toEqual({ category: 'art' });
  });

  it('strips prototype-pollution keys', () => {
    const req = buildReq({ body: JSON.parse('{"__proto__":{"isAdmin":true},"name":"x"}') });

    sanitizeMongo(req, {}, jest.fn());

    expect(Object.keys(req.body)).toEqual(['name']);
    expect({}.isAdmin).toBeUndefined();
  });

  it('sanitizes params as well as query and body', () => {
    const req = buildReq({ params: { id: { $ne: null } } });

    sanitizeMongo(req, {}, jest.fn());

    expect(req.params.id).toBeUndefined();
  });

  it('mutates in place rather than reassigning, so an Express 5 getter survives', () => {
    const query = { status: { $ne: 'active' } };
    const req = buildReq();
    Object.defineProperty(req, 'query', { get: () => query });

    expect(() => sanitizeMongo(req, {}, jest.fn())).not.toThrow();
    expect(query.status).toBeUndefined();
  });

  it('tolerates a missing or non-object body', () => {
    const next = jest.fn();

    sanitizeMongo(buildReq({ body: undefined, query: undefined, params: undefined }), {}, next);
    sanitizeMongo(buildReq({ body: Buffer.from('raw') }), {}, next);
    sanitizeMongo(buildReq({ body: 'a string' }), {}, next);

    expect(next).toHaveBeenCalledTimes(3);
  });
});
