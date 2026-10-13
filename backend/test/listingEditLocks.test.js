const { CRITICAL_FIELDS, lockedFieldsAttempted } = require('../src/utils/listingEditLocks');

describe('CRITICAL_FIELDS — the contract', () => {
  it('locks the selling mode once the listing is live', () => {
    // The spec made the two modes exclusive, which only means anything if the
    // mode cannot be swapped under a live listing.
    expect(CRITICAL_FIELDS.has('sellingMode')).toBe(true);

    // And the legacy spelling with it, or the old name would be a way around
    // the new one for any client still posting it.
    expect(CRITICAL_FIELDS.has('auctionFormat')).toBe(true);
  });

  it('locks allowPrivateRoom, because it sets the commission rate', () => {
    // 6% with a room against 3.5% without. A seller who could flip this after
    // going live could take the room off a listing that was priced with it.
    expect(CRITICAL_FIELDS.has('allowPrivateRoom')).toBe(true);
  });

  it('locks what the item is and when it ends', () => {
    for (const field of ['title', 'titlePt', 'category', 'subCategory', 'durationSlot', 'endDate', 'currentPrice']) {
      expect(CRITICAL_FIELDS.has(field)).toBe(true);
    }
  });

  it('leaves the seller their own floor prices while nobody has engaged', () => {
    // Deliberate: before the first bid or offer a seller may still correct what
    // they are asking. The pre-save invariants are what stop buyNowPrice from
    // meaning anything on an offers listing — see utils/sellingMode.js.
    for (const field of ['startingPrice', 'buyNowPrice', 'minimumOfferPrice', 'description', 'shippingCost']) {
      expect(CRITICAL_FIELDS.has(field)).toBe(false);
    }
  });
});

describe('lockedFieldsAttempted', () => {
  it('names every locked field in the body, and only those', () => {
    expect(lockedFieldsAttempted({ description: 'new text', shippingCost: 5 })).toEqual([]);
    expect(lockedFieldsAttempted({ description: 'new text', sellingMode: 'offers' })).toEqual(['sellingMode']);
    expect(lockedFieldsAttempted({ sellingMode: 'offers', allowPrivateRoom: true, title: 'x' }))
      .toEqual(['sellingMode', 'allowPrivateRoom', 'title']);
  });

  it('refuses a locked field that is being re-sent unchanged', () => {
    // Presence, not difference. Being lenient here would mean a form that
    // always posts its whole state could change one of these by accident.
    expect(lockedFieldsAttempted({ sellingMode: 'bidding' })).toEqual(['sellingMode']);
    expect(lockedFieldsAttempted({ allowPrivateRoom: false })).toEqual(['allowPrivateRoom']);
    // Even explicitly null or undefined — the key is the attempt.
    expect(lockedFieldsAttempted({ endDate: null })).toEqual(['endDate']);
    expect(lockedFieldsAttempted({ endDate: undefined })).toEqual(['endDate']);
  });

  it('survives a body that is not an object', () => {
    expect(lockedFieldsAttempted(null)).toEqual([]);
    expect(lockedFieldsAttempted(undefined)).toEqual([]);
    expect(lockedFieldsAttempted('sellingMode')).toEqual([]);
  });
});
