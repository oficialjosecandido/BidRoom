const {
  normalizeSellingMode,
  applySellingModeInvariants,
  buyNowBlock
} = require('../src/utils/sellingMode');

/** A bidding listing with everything Buy Now needs. */
const buyable = (over = {}) => ({
  sellingMode: 'bidding',
  buyNowPrice: 500,
  status: 'active',
  privateRoomStatus: 'none',
  ...over
});

describe('normalizeSellingMode', () => {
  it('passes the two canonical modes through', () => {
    expect(normalizeSellingMode('bidding')).toBe('bidding');
    expect(normalizeSellingMode('offers')).toBe('offers');
  });

  it('maps every legacy spelling a stale bundle or bookmarked URL still sends', () => {
    expect(normalizeSellingMode('highest-bid')).toBe('bidding');
    expect(normalizeSellingMode('auction')).toBe('bidding');
    expect(normalizeSellingMode('best-offer')).toBe('offers');
    // `?auctionFormat=best-offer` lives forever in shared links.
    expect(normalizeSellingMode('  best-offer  ')).toBe('offers');
  });

  it('returns null rather than a default for anything unrecognised', () => {
    // The caller has to be able to tell "not specified" from a value, which is
    // why this is null and not 'bidding'.
    expect(normalizeSellingMode(undefined)).toBeNull();
    expect(normalizeSellingMode(null)).toBeNull();
    expect(normalizeSellingMode('')).toBeNull();
    expect(normalizeSellingMode('BIDDING')).toBeNull();
    expect(normalizeSellingMode('whatever')).toBeNull();
  });

  it('refuses giveaway, which is a saleFormat and never was a selling mode', () => {
    expect(normalizeSellingMode('giveaway')).toBeNull();
  });

  it('takes the first recognisable candidate and skips the empty ones', () => {
    expect(normalizeSellingMode(null, undefined, 'auction')).toBe('bidding');
    expect(normalizeSellingMode('offers', 'auction')).toBe('offers');
    // An unrecognised first candidate does not stop the search.
    expect(normalizeSellingMode('giveaway', 'best-offer')).toBe('offers');
  });
});

describe('applySellingModeInvariants', () => {
  it('prices a Private Room at 6% and a plain auction at 3.5%', () => {
    expect(applySellingModeInvariants({ sellingMode: 'bidding', allowPrivateRoom: true }).commissionRate).toBe(0.06);
    expect(applySellingModeInvariants({ sellingMode: 'bidding', allowPrivateRoom: false }).commissionRate).toBe(0.035);
    expect(applySellingModeInvariants({ sellingMode: 'bidding' }).commissionRate).toBe(0.035);
  });

  it('strips the bidding-only fields off an offers listing', () => {
    // The client is free to post these; the listing may not keep them. This is
    // the half of the exclusivity rule that lives in the data rather than at an
    // entry point.
    const listing = applySellingModeInvariants({
      sellingMode: 'offers',
      allowPrivateRoom: true,
      buyNowPrice: 500
    });
    expect(listing).toMatchObject({
      commissionRate: 0.035,
      allowPrivateRoom: false,
      buyNowPrice: null
    });
  });

  it('leaves a bidding listing its Buy Now price', () => {
    expect(applySellingModeInvariants(buyable()).buyNowPrice).toBe(500);
  });

  it('leaves a giveaway alone — no price, so no commission', () => {
    const giveaway = applySellingModeInvariants({
      saleFormat: 'giveaway',
      sellingMode: 'offers',
      allowPrivateRoom: true,
      buyNowPrice: 500
    });
    expect(giveaway.commissionRate).toBeUndefined();
    expect(giveaway.allowPrivateRoom).toBe(true);
    expect(giveaway.buyNowPrice).toBe(500);
  });

  it('mutates in place, because the pre-save hook calls it on the document', () => {
    const doc = { sellingMode: 'offers', buyNowPrice: 500 };
    expect(applySellingModeInvariants(doc)).toBe(doc);
    expect(doc.buyNowPrice).toBeNull();
  });

  it('survives a missing listing', () => {
    expect(applySellingModeInvariants(null)).toBeNull();
    expect(applySellingModeInvariants(undefined)).toBeUndefined();
  });
});

describe('buyNowBlock', () => {
  it('allows Buy Now on an active bidding listing that has a price', () => {
    expect(buyNowBlock(buyable())).toBeNull();
    expect(buyNowBlock(buyable({ privateRoomStatus: undefined }))).toBeNull();
    // A room that has already finished is no obstacle.
    expect(buyNowBlock(buyable({ privateRoomStatus: 'closed' }))).toBeNull();
  });

  it('refuses an offers listing, whatever price it is carrying', () => {
    // The route used to check the price alone, so any offers listing that had
    // ever carried a Buy Now price was buyable outright, skipping the seller's
    // accept/decline entirely.
    expect(buyNowBlock({ ...buyable(), sellingMode: 'offers' })).toMatchObject({
      status: 400,
      error: 'Buy Now not available'
    });
  });

  it('refuses a bidding listing with no Buy Now price', () => {
    expect(buyNowBlock(buyable({ buyNowPrice: null }))).toMatchObject({ status: 400 });
    expect(buyNowBlock(buyable({ buyNowPrice: 0 }))).toMatchObject({ status: 400 });
  });

  it('refuses a listing that is no longer active', () => {
    expect(buyNowBlock(buyable({ status: 'ended' }))).toMatchObject({
      status: 400,
      error: 'Listing not active'
    });
    expect(buyNowBlock(buyable({ status: 'draft' }))).toMatchObject({ status: 400 });
  });

  it('refuses with 409 while a Private Room is running or invited', () => {
    // The defect this closes: a room leaves the listing at status 'active' with
    // winner null, which was everything the route checked, so anyone holding
    // the URL could close the auction out from under the invited bidders and
    // void the bids already placed.
    for (const privateRoomStatus of ['active', 'invited']) {
      expect(buyNowBlock(buyable({ privateRoomStatus }))).toMatchObject({
        status: 409,
        error: 'Private Room in progress'
      });
    }
  });

  it('reports the mode before the room, so the message matches the real reason', () => {
    // Order decides which refusal the caller is told about. An offers listing
    // cannot have a room at all, so if one ever appears the mode is the thing
    // that is wrong.
    expect(buyNowBlock({ ...buyable(), sellingMode: 'offers', privateRoomStatus: 'active' }))
      .toMatchObject({ status: 400, error: 'Buy Now not available' });
  });

  it('always answers with a status, an error and a message', () => {
    const refusals = [
      { ...buyable(), sellingMode: 'offers' },
      buyable({ buyNowPrice: null }),
      buyable({ status: 'ended' }),
      buyable({ privateRoomStatus: 'active' })
    ].map(buyNowBlock);

    for (const refusal of refusals) {
      expect(Object.keys(refusal).sort()).toEqual(['error', 'message', 'status']);
      expect(typeof refusal.message).toBe('string');
      expect(refusal.message.length).toBeGreaterThan(0);
    }
  });

  it('survives a missing listing', () => {
    expect(buyNowBlock(null)).toBeNull();
  });
});

describe('the two halves of the exclusivity rule agree', () => {
  it('no offers listing that has been through the invariants can pass buyNowBlock', () => {
    // This is the guarantee, and it has to hold from either direction: the
    // model clears the price, and the route refuses the mode. Either one alone
    // would be a single point of failure.
    const stored = applySellingModeInvariants({
      sellingMode: 'offers',
      status: 'active',
      allowPrivateRoom: true,
      buyNowPrice: 500
    });

    expect(stored.buyNowPrice).toBeNull();
    expect(buyNowBlock(stored)).not.toBeNull();

    // And even if a write slipped a price back in, the mode check still holds.
    expect(buyNowBlock({ ...stored, buyNowPrice: 500 })).not.toBeNull();
  });

  it('never clears the Private Room on a bidding listing, which is why the 409 is needed', () => {
    // The coexistence the 409 exists for: a bidding listing legitimately holds
    // both a Buy Now price and allowPrivateRoom after the invariants run, so
    // the room has to be checked separately at the point of sale.
    const stored = applySellingModeInvariants(buyable({ allowPrivateRoom: true }));
    expect(stored).toMatchObject({ allowPrivateRoom: true, buyNowPrice: 500, commissionRate: 0.06 });
    expect(buyNowBlock(stored)).toBeNull();
    expect(buyNowBlock({ ...stored, privateRoomStatus: 'active' })).toMatchObject({ status: 409 });
  });
});
