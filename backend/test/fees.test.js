const {
  MAX_BUYER_FEE_EUR,
  buyerServiceFeeEuros,
  buyerServiceFeeCents,
} = require('../src/utils/fees');

describe('fees', () => {
  it('prices the service fee below the cap for typical orders', () => {
    expect(buyerServiceFeeEuros(100)).toBeCloseTo(3.2, 2);
    expect(buyerServiceFeeEuros(12000)).toBeCloseTo(348.3, 1);
  });

  it('caps the buyer service fee at €500', () => {
    expect(buyerServiceFeeEuros(20000)).toBe(MAX_BUYER_FEE_EUR);
    expect(buyerServiceFeeEuros(100000)).toBe(MAX_BUYER_FEE_EUR);
  });

  it('returns cents consistently', () => {
    expect(buyerServiceFeeCents(2000000)).toBe(50000);
  });

  // The live €211.25 charge: €200 item + €5 shipping → €6.25 fee.
  it('matches the fee charged on the first live order', () => {
    expect(buyerServiceFeeCents(20500)).toBe(625);
  });
});
