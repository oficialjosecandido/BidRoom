/**
 * A seller hit "You can only create new accounts if you've signed up for
 * Connect…" in production and, following the link in it, tried to register
 * their own Stripe platform. Stripe writes these errors for whoever holds the
 * platform keys; they are ours to read, never the seller's.
 */
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
// Production is what matters here: in test mode the developer is deliberately
// handed the dashboard link and Stripe's own wording.
jest.mock('../src/utils/stripe.util', () => ({
  getStripe: () => null,
  getStripeKey: () => 'sk_live_xxx',
  isStripeTestMode: () => false
}));

const logger = require('../src/utils/logger');
const { _test } = require('../src/routes/connect');
const { isConnectNotEnabledError, handlePlatformSetupError } = _test;

/** The verbatim production error, as Stripe sent it. */
const CONNECT_DISABLED = Object.assign(new Error(
  "You can only create new accounts if you've signed up for Connect, which you can do at " +
  "https://dashboard.stripe.com/connect. Alternatively, you can enable Connect using the Stripe MCP " +
  "(search for 'EnableConnect' using the stripe_api_search tool) or use the Stripe CLI to run " +
  "'stripe tools search enable_connect'"
), { type: 'StripeInvalidRequestError' });

function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('isConnectNotEnabledError', () => {
  it('recognises the production error', () => {
    expect(isConnectNotEnabledError(CONNECT_DISABLED)).toBe(true);
  });

  it('does not claim a seller data problem as a platform one', () => {
    const badIban = Object.assign(new Error('The bank account number provided is invalid.'), {
      type: 'StripeInvalidRequestError'
    });
    expect(isConnectNotEnabledError(badIban)).toBe(false);
    expect(isConnectNotEnabledError(null)).toBe(false);
  });
});

describe('handlePlatformSetupError', () => {
  it('answers the Connect-disabled error itself', () => {
    const res = mockRes();
    expect(handlePlatformSetupError(res, CONNECT_DISABLED)).toBe(true);
    expect(res.statusCode).toBe(503);
  });

  it('never repeats Stripe’s operator-facing text to the seller', () => {
    const res = mockRes();
    handlePlatformSetupError(res, CONNECT_DISABLED);

    const said = JSON.stringify(res.body);
    expect(said).not.toContain('dashboard.stripe.com');
    expect(said).not.toContain('signed up for Connect');
    expect(said).not.toContain('stripe_api_search');
    // And it says whose fault it is, so nobody goes looking at their own data.
    expect(res.body.message).toContain('on our side');
  });

  it('logs what an admin has to do about it', () => {
    handlePlatformSetupError(mockRes(), CONNECT_DISABLED);

    const logged = logger.error.mock.calls.map(args => args.join(' ')).join('\n');
    expect(logged).toContain('CONNECT NOT ENABLED');
    expect(logged).toContain('dashboard.stripe.com');
  });

  it('answers a platform-profile failure the same way', () => {
    const err = Object.assign(
      new Error('Please complete your platform-profile to continue.'),
      { type: 'StripeInvalidRequestError' }
    );
    const res = mockRes();

    expect(handlePlatformSetupError(res, err)).toBe(true);
    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('platform-profile');
  });

  it('leaves a genuine seller-data error to the caller', () => {
    const badIban = Object.assign(new Error('The bank account number provided is invalid.'), {
      type: 'StripeInvalidRequestError'
    });
    const res = mockRes();

    expect(handlePlatformSetupError(res, badIban)).toBe(false);
    expect(res.statusCode).toBeNull();
  });
});
