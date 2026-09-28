jest.mock('../src/models/Customer', () => ({
  findOne: jest.fn(),
  create: jest.fn()
}));

const { resolveGuestSeller, assertSellerMayPublish, isStubUid, GuestSellerError } =
  require('../src/services/guestSellerService');
const Customer = require('../src/models/Customer');

/** Customer.findOne(...).select(...) resolving to `doc`. */
const found = doc => ({ select: async () => doc });

beforeEach(() => {
  jest.clearAllMocks();
  Customer.findOne.mockReturnValue(found(null));
  Customer.create.mockImplementation(async doc => ({ _id: 'new-id', ...doc }));
});

describe('assertSellerMayPublish', () => {
  it('lets an ordinary account through', () => {
    expect(() => assertSellerMayPublish({ accountStatus: 'active' })).not.toThrow();
    expect(() => assertSellerMayPublish({})).not.toThrow();
  });

  // The whole point of this function: the guest form must not be a way around a
  // restriction that applies to the account behind the email.
  it('refuses a suspended account', () => {
    expect(() => assertSellerMayPublish({ accountStatus: 'suspended' }))
      .toThrow(expect.objectContaining({ statusCode: 403, code: 'account_suspended' }));
  });

  it('refuses a closed account', () => {
    expect(() => assertSellerMayPublish({ accountStatus: 'closed' }))
      .toThrow(expect.objectContaining({ statusCode: 403, code: 'account_closed' }));
  });

  it('refuses an account inside a content restriction, and allows one past it', () => {
    const future = new Date(Date.now() + 86400000);
    const past = new Date(Date.now() - 86400000);
    expect(() => assertSellerMayPublish({ contentRestrictedUntil: future }))
      .toThrow(expect.objectContaining({ code: 'account_content_restricted' }));
    expect(() => assertSellerMayPublish({ contentRestrictedUntil: past })).not.toThrow();
  });

  it('refuses an account with an open dispute', () => {
    expect(() => assertSellerMayPublish({ activeDisputeTransactionIds: ['t1'] }))
      .toThrow(expect.objectContaining({ code: 'account_dispute_restricted' }));
    expect(() => assertSellerMayPublish({ activeDisputeTransactionIds: [] })).not.toThrow();
  });

  it('refuses an account under a DSA listing restriction', () => {
    expect(() => assertSellerMayPublish({ dsaListingRestricted: true }))
      .toThrow(expect.objectContaining({ code: 'account_dsa_restricted' }));
  });
});

describe('resolveGuestSeller', () => {
  it('rejects an invalid or oversized email before touching the database', async () => {
    for (const email of ['', '   ', 'nope', 'a@b', 'a@b.c', '@b.co', 'a b@c.co', null, undefined]) {
      await expect(resolveGuestSeller({ email, name: 'Ana Silva' }))
        .rejects.toThrow(expect.objectContaining({ code: 'email_invalid' }));
    }
    await expect(resolveGuestSeller({ email: `${'a'.repeat(250)}@b.com`, name: 'Ana' }))
      .rejects.toThrow(expect.objectContaining({ code: 'email_invalid' }));
    expect(Customer.findOne).not.toHaveBeenCalled();
  });

  it('provisions a stub account for a new email', async () => {
    const { seller, sellerCreated, hasAccount } = await resolveGuestSeller({
      email: 'Ana.Silva@Example.COM',
      name: 'Ana Silva'
    });
    expect(sellerCreated).toBe(true);
    expect(hasAccount).toBe(false);
    const created = Customer.create.mock.calls[0][0];
    expect(created.email).toBe('ana.silva@example.com'); // normalised
    expect(created.uid).toMatch(/^guest-[a-f0-9]{32}$/);
    expect(created.emailVerified).toBe(false);
    expect(seller._id).toBe('new-id');
  });

  it('never derives the name from the email address', async () => {
    // firstName is published on the listing page. For most people the local part
    // of their address is their actual name, so deriving it would put the address
    // back in public one field over from where it was removed.
    await resolveGuestSeller({ email: 'ana.silva@example.com', name: 'Zé Costa' });
    const created = Customer.create.mock.calls[0][0];
    expect(created.firstName).toBe('Zé');
    expect(created.lastName).toBe('Costa');
    expect(created.firstName).not.toMatch(/ana/i);
    expect(created.lastName).not.toMatch(/silva/i);
  });

  it('requires a name for a brand-new seller', async () => {
    for (const name of ['', '   ', null, undefined]) {
      await expect(resolveGuestSeller({ email: 'new@example.com', name }))
        .rejects.toThrow(expect.objectContaining({ code: 'name_required' }));
    }
    expect(Customer.create).not.toHaveBeenCalled();
  });

  it('stands in for a missing surname rather than refusing a one-word name', async () => {
    await resolveGuestSeller({ email: 'new@example.com', name: 'Madonna' });
    expect(Customer.create.mock.calls[0][0]).toMatchObject({
      firstName: 'Madonna',
      lastName: 'Seller'
    });
  });

  it('keeps a very long name inside the model limits', async () => {
    // maxlength is 50 on both fields, so an over-long name must be trimmed here
    // rather than surfacing as a Mongoose ValidationError at create time.
    await resolveGuestSeller({ email: 'new@example.com', name: `${'a'.repeat(80)} ${'b'.repeat(80)}` });
    const created = Customer.create.mock.calls[0][0];
    expect(created.firstName.length).toBeGreaterThan(0);
    expect(created.firstName.length).toBeLessThanOrEqual(50);
    expect(created.lastName.length).toBeGreaterThan(0);
    expect(created.lastName.length).toBeLessThanOrEqual(50);
  });

  it('collapses whitespace so a padded name is not stored as typed', async () => {
    await resolveGuestSeller({ email: 'new@example.com', name: '   Ana    Maria   Silva  ' });
    expect(Customer.create.mock.calls[0][0]).toMatchObject({
      firstName: 'Ana',
      lastName: 'Maria Silva'
    });
  });

  it('attaches to an existing account instead of creating a second one', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'existing', uid: 'firebase-uid-1', accountStatus: 'active' }));
    const { seller, sellerCreated, hasAccount } = await resolveGuestSeller({
      email: 'known@example.com',
      name: 'Someone Else'
    });
    expect(sellerCreated).toBe(false);
    expect(hasAccount).toBe(true);
    expect(seller._id).toBe('existing');
    expect(Customer.create).not.toHaveBeenCalled();
  });

  it('does not let the submitted name rename an existing account', async () => {
    const existing = { _id: 'existing', uid: 'firebase-uid-1', firstName: 'Ana', lastName: 'Silva' };
    Customer.findOne.mockReturnValue(found(existing));
    await resolveGuestSeller({ email: 'known@example.com', name: 'Impostor Name' });
    expect(existing.firstName).toBe('Ana');
    expect(existing.lastName).toBe('Silva');
  });

  it('refuses when the email belongs to a restricted account', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'x', uid: 'u', accountStatus: 'suspended' }));
    await expect(resolveGuestSeller({ email: 'banned@example.com', name: 'Ana' }))
      .rejects.toThrow(expect.objectContaining({ statusCode: 403 }));
    expect(Customer.create).not.toHaveBeenCalled();
  });

  it('reports a stub account as not yet claimed', async () => {
    Customer.findOne.mockReturnValue(found({
      _id: 'stub',
      uid: `nexus-${'a'.repeat(32)}`,
      accountStatus: 'active'
    }));
    const { hasAccount } = await resolveGuestSeller({ email: 'stub@example.com', name: 'Ana' });
    expect(hasAccount).toBe(false);
  });

  it('throws GuestSellerError, so routes can map it to a status code', async () => {
    await expect(resolveGuestSeller({ email: 'bad', name: 'Ana' })).rejects.toBeInstanceOf(GuestSellerError);
  });
});

describe('isStubUid', () => {
  it('recognises provisioned accounts and nothing else', () => {
    expect(isStubUid(`guest-${'a'.repeat(32)}`)).toBe(true);
    expect(isStubUid(`nexus-${'f'.repeat(32)}`)).toBe(true);
    expect(isStubUid('firebase-abc123')).toBe(false);
    expect(isStubUid('guest-tooshort')).toBe(false);
    expect(isStubUid('')).toBe(false);
    expect(isStubUid(null)).toBe(false);
    expect(isStubUid(undefined)).toBe(false);
  });
});
