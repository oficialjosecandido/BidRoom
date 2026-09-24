/**
 * A seller hit "You can only create new accounts if you've signed up for
 * Connect…" in production and, following the link in it, tried to register
 * their own Stripe platform. Stripe writes these errors for whoever holds the
 * platform keys; they are ours to read, never the seller's.
 */
jest.mock('../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn()
}));
// Production as it actually is: NODE_ENV=production on a Stripe *test* key.
// Gating the detail on test mode alone would therefore expose it to real
// sellers, which is the whole thing this file guards against.
jest.mock('../src/utils/stripe.util', () => ({
  getStripe: () => null,
  getStripeKey: () => 'sk_test_xxx',
  isStripeTestMode: () => true
}));

const logger = require('../src/utils/logger');
const { _test } = require('../src/routes/connect');
const {
  isConnectNotEnabledError, handlePlatformSetupError, canExposeStripeDetail,
  isSellerDataError, serviceAgreementForCountry
} = _test;

const REAL_NODE_ENV = process.env.NODE_ENV;
beforeAll(() => { process.env.NODE_ENV = 'production'; });
afterAll(() => { process.env.NODE_ENV = REAL_NODE_ENV; });

/** The verbatim production error, as Stripe sent it. */
const CONNECT_DISABLED = Object.assign(new Error(
  "You can only create new accounts if you've signed up for Connect, which you can do at " +
  "https://dashboard.stripe.com/connect. Alternatively, you can enable Connect using the Stripe MCP " +
  "(search for 'EnableConnect' using the stripe_api_search tool) or use the Stripe CLI to run " +
  "'stripe tools search enable_connect'"
), { type: 'StripeInvalidRequestError' });

/**
 * The second production failure on the same form, once the IP bug was fixed.
 * The recipient agreement is for paying out across a border; the platform and
 * the seller were both in PT. Stripe sends it with no `param`.
 */
const SERVICE_AGREEMENT = Object.assign(new Error(
  'The recipient ToS agreement is not supported for platforms in PT creating accounts in PT. ' +
  'See https://stripe.com/docs/connect/cross-border-payouts for more details.'
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

describe('canExposeStripeDetail', () => {
  it('stays shut in production even on a Stripe test key', () => {
    expect(canExposeStripeDetail()).toBe(false);
  });

  it('opens outside production, where a developer needs to read it', () => {
    process.env.NODE_ENV = 'development';
    try {
      expect(canExposeStripeDetail()).toBe(true);
    } finally {
      process.env.NODE_ENV = 'production';
    }
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

  it('answers the wrong-service-agreement error as ours', () => {
    const res = mockRes();

    expect(handlePlatformSetupError(res, SERVICE_AGREEMENT)).toBe(true);
    expect(res.statusCode).toBe(503);
    // The seller saw this verbatim in production and read it as their mistake.
    const said = JSON.stringify(res.body);
    expect(said).not.toContain('recipient ToS');
    expect(said).not.toContain('cross-border-payouts');
    expect(res.body.message).toContain('on our side');

    const logged = logger.error.mock.calls.map(args => args.join(' ')).join('\n');
    expect(logged).toContain('WRONG SERVICE AGREEMENT');
  });
});

describe('serviceAgreementForCountry', () => {
  it('signs the full agreement at home — the recipient one is refused there', () => {
    expect(serviceAgreementForCountry('PT', 'PT')).toBe('full');
  });

  it('keeps the recipient agreement for an EEA seller abroad', () => {
    expect(serviceAgreementForCountry('ES', 'PT')).toBe('recipient');
    expect(serviceAgreementForCountry('DE', 'PT')).toBe('recipient');
  });

  it('falls back to full outside the EEA list', () => {
    expect(serviceAgreementForCountry('US', 'PT')).toBe('full');
  });

  it('still answers when the platform country could not be read', () => {
    // Stripe was unreachable; better a defined answer than a crash mid-form.
    expect(serviceAgreementForCountry('ES', null)).toBe('recipient');
    expect(serviceAgreementForCountry('US', null)).toBe('full');
  });
});

describe('isSellerDataError', () => {
  it('recognises a complaint about a field the seller filled', () => {
    expect(isSellerDataError({ param: 'external_account' })).toBe(true);
    expect(isSellerDataError({ param: 'individual[dob][year]' })).toBe(true);
  });

  it('does not treat a platform parameter as the seller’s doing', () => {
    expect(isSellerDataError({ param: 'tos_acceptance[service_agreement]' })).toBe(false);
    expect(isSellerDataError({ param: 'controller[requirement_collection]' })).toBe(false);
    // No param at all is the shape the PT/PT failure arrived in.
    expect(isSellerDataError(SERVICE_AGREEMENT)).toBe(false);
    expect(isSellerDataError(null)).toBe(false);
  });
});
