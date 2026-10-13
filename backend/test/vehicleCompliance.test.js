const {
  VEHICLE_CATEGORY,
  VehicleComplianceError,
  assertVehicleListingAllowed
} = require('../src/services/vehicleComplianceService');
const rules = require('../src/config/vehicleRules');

const CAP = rules.MAX_VEHICLE_VALUE_EUR;

/**
 * A seller who has cleared checks 1 to 3, so a test can reach the value
 * ceiling, which is check 5. Declared deliberately, private, KYC approved.
 */
const compliantSeller = (over = {}) => ({
  sellerClassification: 'private',
  sellerClassificationDeclaredAt: new Date('2026-01-01T00:00:00.000Z'),
  kycStatus: 'approved',
  ...over
});

const vehicle = (listingData = {}, seller = compliantSeller()) => ({
  category: VEHICLE_CATEGORY,
  seller,
  vehicleAmlDeclaration: true,
  ...listingData
});

/** The code the frontend routes on, or null if the listing was allowed. */
function refusal(args) {
  try {
    assertVehicleListingAllowed(args);
    return null;
  } catch (err) {
    if (!(err instanceof VehicleComplianceError)) throw err;
    return err;
  }
}

describe('assertVehicleListingAllowed — the value ceiling', () => {
  it('allows a car priced at the ceiling and refuses one a euro over', () => {
    // Read from the config rather than hardcoded: every number in
    // config/vehicleRules.js is pending legal review and expected to move.
    expect(refusal(vehicle({ startingPrice: CAP }))).toBeNull();
    expect(refusal(vehicle({ startingPrice: CAP + 1 }))).toMatchObject({
      code: 'vehicle_value_cap_exceeded',
      statusCode: 400
    });
  });

  it('applies to every price the seller sets, and to the highest of them', () => {
    // minimumOfferPrice is in the list because offers mode has no starting
    // bid: without it a vehicle declared a value of 0 and cleared any ceiling.
    expect(rules.VALUE_CAP_APPLIES_TO).toEqual(['startingPrice', 'buyNowPrice', 'minimumOfferPrice']);

    for (const field of rules.VALUE_CAP_APPLIES_TO) {
      expect(refusal(vehicle({ [field]: CAP + 1 }))).toMatchObject({
        code: 'vehicle_value_cap_exceeded'
      });
    }

    // One cheap field does not rescue an expensive one.
    expect(refusal(vehicle({ startingPrice: 1, buyNowPrice: CAP + 1 }))).toMatchObject({
      code: 'vehicle_value_cap_exceeded'
    });
  });

  it('reports the ceiling and the declared value so the seller can act on it', () => {
    const err = refusal(vehicle({ startingPrice: 1, buyNowPrice: CAP * 2 }));
    expect(err.details).toEqual({ maxValue: CAP, declaredValue: CAP * 2 });
    expect(err.message).toContain('€');
  });

  it('does not cap what the bidding reaches, only what the seller set', () => {
    // Laundering needs an agreed price; a competitive auction produces one the
    // market decided. currentPrice is deliberately not in VALUE_CAP_APPLIES_TO.
    expect(rules.VALUE_CAP_APPLIES_TO).not.toContain('currentPrice');
    expect(refusal(vehicle({ startingPrice: 100, currentPrice: CAP * 10 }))).toBeNull();
  });

  it('ignores a listing with no prices at all rather than treating it as zero-value', () => {
    expect(refusal(vehicle())).toBeNull();
  });
});

describe('assertVehicleListingAllowed — the gates before the ceiling', () => {
  it('returns silently for anything that is not a vehicle', () => {
    // Callers invoke it unconditionally, so a watch priced above the car
    // ceiling, listed by a seller with no KYC, must pass untouched.
    expect(refusal({
      category: 'watches',
      seller: { kycStatus: 'none' },
      startingPrice: CAP * 100
    })).toBeNull();
  });

  it('requires the classification to have been answered, not defaulted', () => {
    // `private` is the schema default, so the timestamp is the only proof the
    // seller was ever asked the question.
    expect(refusal(vehicle({ startingPrice: 1000 }, {
      sellerClassification: 'private',
      kycStatus: 'approved'
    }))).toMatchObject({ code: 'vehicle_declaration_required', statusCode: 403 });

    // Having filled in the trader form counts as the same proof, so sellers who
    // declared before the timestamp field existed are not asked again.
    expect(refusal(vehicle({ startingPrice: 1000 }, {
      sellerClassification: 'private',
      professionalSubmittedAt: new Date('2026-01-01T00:00:00.000Z'),
      kycStatus: 'approved'
    }))).toBeNull();
  });

  it('requires a trader to carry the details the warranty depends on', () => {
    const err = refusal(vehicle({ startingPrice: 1000 }, compliantSeller({
      sellerClassification: 'professional',
      professionalLegalName: 'Garagem Exemplo Lda'
    })));
    expect(err).toMatchObject({ code: 'vehicle_professional_details_required', statusCode: 403 });
    expect(err.details.missing).toEqual(['professionalVatId']);
  });

  it('requires verified identity at any price, not only above the KYC threshold', () => {
    expect(refusal(vehicle({ startingPrice: 1 }, compliantSeller({ kycStatus: 'pending' }))))
      .toMatchObject({ code: 'vehicle_kyc_required', statusCode: 403 });
  });

  it('requires the traceable-payment declaration, since BidRoom never sees the money', () => {
    expect(refusal({ ...vehicle({ startingPrice: 1000 }), vehicleAmlDeclaration: false }))
      .toMatchObject({ code: 'vehicle_aml_terms_required', statusCode: 400 });
    expect(refusal({ ...vehicle({ startingPrice: 1000 }), vehicleAmlDeclaration: 'yes' }))
      .toMatchObject({ code: 'vehicle_aml_terms_required' });
  });

  it('refuses on the first failure, so the seller is sent to one screen at a time', () => {
    expect(refusal(vehicle({ startingPrice: CAP + 1 }, { sellerClassification: 'private' })))
      .toMatchObject({ code: 'vehicle_declaration_required' });
  });
});
