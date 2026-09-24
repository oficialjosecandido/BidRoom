/**
 * Guards the two allowlists that stand between the database and the public API.
 *
 * These tests are deliberately strict about the *exact* set of keys returned.
 * That is the point: the bug they exist to prevent was a `...bid` spread, where
 * every field added to the schema became public without anyone deciding to
 * publish it. If you add a field to a serializer, this test fails and you have
 * to come here and say so on purpose.
 */
const { formatBidPublic, bidderKey } = require('../src/utils/bidFormat');
const { formatOfferForSocket } = require('../src/utils/offerFormat');

const LISTING_ID = '68d0000000000000000000aa';

/** A bid carrying everything the model can hold, including the fields that must never ship. */
function sensitiveBid(overrides = {}) {
  return {
    _id: '68d0000000000000000000b1',
    listing: LISTING_ID,
    amount: 250,
    bidType: 'proxy',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    updatedAt: new Date('2026-09-01T10:00:00.000Z'),
    // Must never reach a client:
    bidderEmail: 'comprador@example.com',
    maxBid: 900,
    notes: 'internal note',
    ipAddress: '203.0.113.7',
    deviceFingerprint: 'fp-abc123',
    fraudFlags: ['velocity'],
    isFlagged: true,
    notifyWhenOutbid: true,
    bidder: {
      _id: '68d0000000000000000000c1',
      firstName: 'Ana',
      lastName: 'Silva',
      email: 'ana.silva@example.com',
      emailVerified: true,
      kycStatus: 'approved',
      savedPaymentMethodId: 'pm_123',
      reputationScore: 72,
      uid: 'firebase-uid-1',
      phone: '+351912345678'
    },
    ...overrides
  };
}

/** Every string anywhere in the payload, however deeply nested. */
function allStrings(value, acc = []) {
  if (typeof value === 'string') acc.push(value);
  else if (Array.isArray(value)) value.forEach((v) => allStrings(v, acc));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => allStrings(v, acc));
  return acc;
}

const EMAIL_SHAPED = /[^\s@]+@[^\s@]+\.[^\s@]+/;

describe('formatBidPublic', () => {
  it('returns exactly the allowlisted keys', () => {
    expect(Object.keys(formatBidPublic(sensitiveBid())).sort()).toEqual([
      '_id',
      'amount',
      'bidType',
      'bidderFirstName',
      'bidderId',
      'bidderInitials',
      'bidderKey',
      'bidderLastName',
      'bidderName',
      'bidderVerified',
      'buyerReviewCount',
      'buyerScore',
      'buyerTrustTier',
      'createdAt',
      'isAuthenticated',
      'listing',
      'reputationScore'
    ]);
  });

  it('never emits an email address, for a registered bidder or a guest', () => {
    for (const bid of [sensitiveBid(), sensitiveBid({ bidder: null })]) {
      const strings = allStrings(formatBidPublic(bid));
      expect(strings.find((s) => EMAIL_SHAPED.test(s))).toBeUndefined();
    }
  });

  it('never emits maxBid, notes, or the fraud/IP fields', () => {
    const out = formatBidPublic(sensitiveBid());
    for (const key of ['maxBid', 'notes', 'ipAddress', 'deviceFingerprint', 'fraudFlags', 'isFlagged', 'bidderEmail', 'bidder', 'uid']) {
      expect(out).not.toHaveProperty(key);
    }
  });

  it('does not build a guest display name out of their email local part', () => {
    const out = formatBidPublic(sensitiveBid({ bidder: null }));
    expect(out.bidderName).toBe('Guest Bidder');
    expect(out.bidderInitials).toBe('G');
    expect(out.bidderId).toBeNull();
    expect(out.isAuthenticated).toBe(false);
  });

  it('keeps the public reputation signals the UI needs', () => {
    const out = formatBidPublic(sensitiveBid(), { buyerTrustTier: 3, buyerScore: 4.5, buyerReviewCount: 8 });
    expect(out).toMatchObject({
      amount: 250,
      bidderName: 'Ana Silva',
      bidderInitials: 'AS',
      bidderVerified: true,
      reputationScore: 72,
      buyerTrustTier: 3,
      buyerScore: 4.5,
      buyerReviewCount: 8
    });
  });

  it('returns null for a missing bid rather than an empty object', () => {
    expect(formatBidPublic(null)).toBeNull();
  });
});

describe('bidderKey', () => {
  it('is stable for the same guest on the same listing', () => {
    const a = bidderKey({ bidderEmail: 'Guest@Example.com' }, LISTING_ID);
    const b = bidderKey({ bidderEmail: ' guest@example.com ' }, LISTING_ID);
    expect(a).toBe(b);
    expect(a).toHaveLength(32);
  });

  it('is not linkable across listings', () => {
    const here = bidderKey({ bidderEmail: 'guest@example.com' }, LISTING_ID);
    const there = bidderKey({ bidderEmail: 'guest@example.com' }, '68d0000000000000000000ff');
    expect(here).not.toBe(there);
  });

  it('separates two different people on the same listing', () => {
    expect(bidderKey({ bidderEmail: 'a@example.com' }, LISTING_ID))
      .not.toBe(bidderKey({ bidderEmail: 'b@example.com' }, LISTING_ID));
  });

  it('is not a plain hash of the email (the salt has to matter)', () => {
    const crypto = require('crypto');
    const plain = crypto.createHash('sha256').update('guest@example.com').digest('hex').slice(0, 32);
    expect(bidderKey({ bidderEmail: 'guest@example.com' }, LISTING_ID)).not.toBe(plain);
  });

  it('is null when there is nothing to key on', () => {
    expect(bidderKey({}, LISTING_ID)).toBeNull();
  });
});

describe('formatOfferForSocket', () => {
  function sensitiveOffer(overrides = {}) {
    return {
      _id: '68d0000000000000000000d1',
      listing: LISTING_ID,
      amount: 500,
      message: 'Interessado',
      status: 'pending',
      createdAt: new Date('2026-09-02T10:00:00.000Z'),
      updatedAt: new Date('2026-09-02T10:00:00.000Z'),
      respondedAt: null,
      sellerResponse: null,
      offererEmail: 'proponente@example.com',
      offererIp: '203.0.113.9',
      offerer: {
        _id: '68d0000000000000000000e1',
        firstName: 'Bruno',
        lastName: 'Costa',
        email: 'bruno.costa@example.com',
        emailVerified: true,
        phone: '+351911111111'
      },
      ...overrides
    };
  }

  it('returns exactly the allowlisted keys', () => {
    expect(Object.keys(formatOfferForSocket(sensitiveOffer())).sort()).toEqual([
      '_id',
      'amount',
      'createdAt',
      'listing',
      'message',
      'offerer',
      'offererInitials',
      'offererKey',
      'offererName',
      'offererTier',
      'offererVerified',
      'respondedAt',
      'sellerResponse',
      'status',
      'updatedAt'
    ]);
  });

  it('reduces the nested offerer to name and id, with no email', () => {
    const out = formatOfferForSocket(sensitiveOffer());
    expect(Object.keys(out.offerer).sort()).toEqual(['_id', 'firstName', 'lastName']);
  });

  it('never emits an email address, for a registered offerer or a guest', () => {
    for (const offer of [sensitiveOffer(), sensitiveOffer({ offerer: null })]) {
      const strings = allStrings(formatOfferForSocket(offer));
      expect(strings.find((s) => EMAIL_SHAPED.test(s))).toBeUndefined();
    }
  });

  it('does not build a guest display name out of their email local part', () => {
    const out = formatOfferForSocket(sensitiveOffer({ offerer: null }));
    expect(out.offererName).toBe('Guest');
    expect(out.offererInitials).toBe('G');
    expect(out.offerer).toBeNull();
    expect(out.offererKey).toEqual(expect.any(String));
  });
});
