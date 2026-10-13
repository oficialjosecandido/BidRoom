describe('kycRules', () => {
  const load = () => {
    jest.resetModules();
    return require('../src/config/kycRules');
  };

  afterEach(() => {
    delete process.env.KYC_THRESHOLD_EUR;
  });

  it('defaults to 5000, the figure the routes were written around', () => {
    delete process.env.KYC_THRESHOLD_EUR;
    expect(load().KYC_THRESHOLD_EUR).toBe(5000);
  });

  it('quotes euros, which is the only currency BidRoom prices anything in', () => {
    // The three messages this replaces all said "$5,000". Nobody decided to
    // quote dollars; the literal was copied between two routes and the user was
    // told the right amount in the wrong currency.
    delete process.env.KYC_THRESHOLD_EUR;
    const label = load().kycThresholdLabel();
    expect(label).toContain('€');
    expect(label).not.toContain('$');
    // pt-PT groups with a no-break space, matching the vehicle ceiling message.
    expect(label).toBe('€5 000');
  });

  it('groups the thousands, which the pt-PT default does not do at four digits', () => {
    // Left to the locale default this read "€5000" beside the car cap's
    // "€20 000" — the same kind of amount formatted two ways.
    delete process.env.KYC_THRESHOLD_EUR;
    expect(load().kycThresholdLabel()).not.toBe('€5000');
  });

  it('can be moved by environment, because the threshold is a legal judgement', () => {
    process.env.KYC_THRESHOLD_EUR = '3000';
    const rules = load();
    expect(rules.KYC_THRESHOLD_EUR).toBe(3000);
    expect(rules.kycThresholdLabel()).toContain('3');
  });

  it('ignores a value that is not a usable amount', () => {
    for (const bad of ['', 'lots', '0', '-100', 'NaN']) {
      process.env.KYC_THRESHOLD_EUR = bad;
      expect(load().KYC_THRESHOLD_EUR).toBe(5000);
    }
  });
});
