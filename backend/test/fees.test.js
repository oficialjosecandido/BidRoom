const {
  MAX_BUYER_FEE_EUR,
  estimateBuyerProcessingFeeEuros,
  estimateBuyerProcessingFeeCents,
} = require('../src/utils/fees');

describe('fees', () => {
  it('estimates Stripe fee below cap for typical orders', () => {
    expect(estimateBuyerProcessingFeeEuros(100)).toBeCloseTo(3.2, 2);
    expect(estimateBuyerProcessingFeeEuros(12000)).toBeCloseTo(348.3, 1);
  });

  it('caps buyer processing fee at €500', () => {
    expect(estimateBuyerProcessingFeeEuros(20000)).toBe(MAX_BUYER_FEE_EUR);
    expect(estimateBuyerProcessingFeeEuros(100000)).toBe(MAX_BUYER_FEE_EUR);
  });

  it('returns cents consistently', () => {
    expect(estimateBuyerProcessingFeeCents(2000000)).toBe(50000);
  });
});
