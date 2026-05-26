const { z } = require('zod');
const { validate } = require('../src/middleware/validate');
const { objectId, paginationQuery } = require('../src/validators/common');

function buildRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('validate middleware', () => {
  it('returns 400 with field-level details when the body is invalid', () => {
    const schema = z.object({
      body: z.object({ amount: z.number().positive() }),
    });
    const req = { body: { amount: -1 }, query: {}, params: {}, originalUrl: '/x', method: 'POST' };
    const res = buildRes();
    const next = jest.fn();

    validate(schema)(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
    const body = res.json.mock.calls[0][0];
    expect(body.error).toBe('Validation failed');
    expect(body.details[0].path).toBe('body.amount');
  });

  it('coerces and replaces req.query with the parsed values', () => {
    const schema = z.object({ query: paginationQuery });
    const req = { body: {}, query: { page: '3', limit: '50' }, params: {} };
    const res = buildRes();
    const next = jest.fn();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.page).toBe(3);
    expect(req.query.limit).toBe(50);
  });

  it('validates params with the shared objectId helper', () => {
    const schema = z.object({ params: z.object({ id: objectId }) });
    const ok = { body: {}, query: {}, params: { id: '507f1f77bcf86cd799439011' } };
    const bad = { body: {}, query: {}, params: { id: 'not-an-id' } };
    const next = jest.fn();
    const res = buildRes();

    validate(schema)(ok, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    next.mockReset();
    res.status.mockClear();
    validate(schema)(bad, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
