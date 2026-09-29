jest.mock('../src/models/Customer', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  updateOne: jest.fn(),
  create: jest.fn()
}));

const {
  claimAccountByEmail,
  resolveCustomerForToken,
  handleAccountClaimError,
  AccountClaimError
} = require('../src/services/accountClaimService');
const Customer = require('../src/models/Customer');

/**
 * A Customer.findOne(...) result resolving to `doc` whether it is awaited
 * directly or has .select() called on it first.
 */
const found = doc => ({
  select: async () => doc,
  then: (onOk, onErr) => Promise.resolve(doc).then(onOk, onErr)
});

const STUB_UID = `guest-${'a'.repeat(32)}`;
const NEXUS_UID = `nexus-${'b'.repeat(32)}`;

beforeEach(() => {
  jest.clearAllMocks();
  Customer.findOne.mockReturnValue(found(null));
  Customer.updateOne.mockResolvedValue({ modifiedCount: 1 });
  Customer.findById.mockImplementation(async id => ({ _id: id }));
  Customer.create.mockImplementation(async doc => ({ _id: 'created-id', ...doc }));
});

describe('claimAccountByEmail', () => {
  it('reports nothing to claim when no account holds the email', async () => {
    const res = await claimAccountByEmail({ uid: 'firebase-1', email: 'new@example.com', emailVerified: true });
    expect(res.status).toBe('none');
    expect(Customer.updateOne).not.toHaveBeenCalled();
  });

  it('does nothing without a uid or an email', async () => {
    expect((await claimAccountByEmail({ uid: '', email: 'a@b.com' })).status).toBe('none');
    expect((await claimAccountByEmail({ uid: 'firebase-1', email: '' })).status).toBe('none');
    expect(Customer.findOne).not.toHaveBeenCalled();
  });

  it('normalises the email before looking it up', async () => {
    await claimAccountByEmail({ uid: 'firebase-1', email: '  Ana.Silva@Example.COM ', emailVerified: true });
    expect(Customer.findOne).toHaveBeenCalledWith({ email: 'ana.silva@example.com' });
  });

  // The flow the whole feature rests on: a guest publishes a listing, then signs
  // up with the same address and finds that listing in their dashboard.
  it('rebinds a guest stub to the new Firebase uid', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'stub-id', uid: STUB_UID, firstName: 'Ana', lastName: 'Silva' }));

    const res = await claimAccountByEmail({
      uid: 'firebase-new',
      email: 'ana@example.com',
      emailVerified: true,
      firstName: 'Anabela',
      lastName: 'Costa'
    });

    expect(res.status).toBe('claimed');
    const [filter, update] = Customer.updateOne.mock.calls[0];
    // Guarded by the old uid: two concurrent claims cannot both win.
    expect(filter).toEqual({ _id: 'stub-id', uid: STUB_UID });
    expect(update.$set.uid).toBe('firebase-new');
    expect(update.$set.emailVerified).toBe(true);
  });

  it('claims a Nexus-provisioned stub the same way', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'stub-id', uid: NEXUS_UID, firstName: 'Ana', lastName: 'Silva' }));
    const res = await claimAccountByEmail({ uid: 'firebase-new', email: 'ana@example.com', emailVerified: true });
    expect(res.status).toBe('claimed');
    expect(Customer.updateOne).toHaveBeenCalled();
  });

  it('never changes the _id, which is what makes the listings follow', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'stub-id', uid: STUB_UID }));
    await claimAccountByEmail({ uid: 'firebase-new', email: 'ana@example.com', emailVerified: true });
    expect(Customer.updateOne.mock.calls[0][1].$set).not.toHaveProperty('_id');
    expect(Customer.findById).toHaveBeenCalledWith('stub-id');
  });

  // Guard 1. Rebinding a real account's uid hands the account, its balance and
  // its history to anyone who can get Firebase to mint a token for the address.
  it('refuses to adopt a real account held under another uid', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'real-id', uid: 'firebase-owner' }));
    const res = await claimAccountByEmail({
      uid: 'firebase-attacker',
      email: 'victim@example.com',
      emailVerified: true
    });
    expect(res.status).toBe('conflict');
    expect(Customer.updateOne).not.toHaveBeenCalled();
  });

  // Guard 2. A guest listing is published with no email confirmation, so the
  // address on the stub is unproven — anyone could have typed it in.
  it('refuses to adopt a stub for an unverified token', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'stub-id', uid: STUB_UID }));
    for (const emailVerified of [false, undefined, null, 'true', 1]) {
      const res = await claimAccountByEmail({ uid: 'firebase-new', email: 'ana@example.com', emailVerified });
      expect(res.status).toBe('verification_required');
    }
    expect(Customer.updateOne).not.toHaveBeenCalled();
  });

  it('is a no-op when the account is already bound to this uid', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'mine', uid: 'firebase-1' }));
    const res = await claimAccountByEmail({ uid: 'firebase-1', email: 'ana@example.com', emailVerified: true });
    expect(res.status).toBe('claimed');
    expect(res.customer._id).toBe('mine');
    expect(Customer.updateOne).not.toHaveBeenCalled();
  });

  // The stub's name is already printed on a live listing as the seller's, so a
  // Firebase display name must not replace it.
  it('keeps the name the listing was published under', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'stub-id', uid: STUB_UID, firstName: 'Ana', lastName: 'Silva' }));
    await claimAccountByEmail({
      uid: 'firebase-new',
      email: 'ana@example.com',
      emailVerified: true,
      firstName: 'Impostor',
      lastName: 'Name'
    });
    const { $set } = Customer.updateOne.mock.calls[0][1];
    expect($set).not.toHaveProperty('firstName');
    expect($set).not.toHaveProperty('lastName');
  });

  it('fills a missing name from the Firebase profile', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'stub-id', uid: NEXUS_UID, firstName: '', lastName: null }));
    await claimAccountByEmail({
      uid: 'firebase-new',
      email: 'ana@example.com',
      emailVerified: true,
      firstName: 'Ana',
      lastName: 'Silva'
    });
    expect(Customer.updateOne.mock.calls[0][1].$set).toMatchObject({ firstName: 'Ana', lastName: 'Silva' });
  });

  it('does not overwrite a stored name with a null one', async () => {
    Customer.findOne.mockReturnValue(found({ _id: 'stub-id', uid: NEXUS_UID, firstName: '', lastName: '' }));
    await claimAccountByEmail({
      uid: 'firebase-new',
      email: 'ana@example.com',
      emailVerified: true,
      firstName: null,
      lastName: null
    });
    const { $set } = Customer.updateOne.mock.calls[0][1];
    expect($set).not.toHaveProperty('firstName');
    expect($set).not.toHaveProperty('lastName');
  });
});

describe('resolveCustomerForToken', () => {
  /** uid lookup → `byUid`, email lookup → `byEmail`. */
  const lookups = (byUid, byEmail) =>
    Customer.findOne.mockImplementation(q => found('uid' in q ? byUid : byEmail));

  it('returns the account already bound to the uid without touching anything else', async () => {
    lookups({ _id: 'mine', uid: 'firebase-1' }, null);
    const user = await resolveCustomerForToken({ uid: 'firebase-1', email: 'a@b.com' });
    expect(user._id).toBe('mine');
    expect(Customer.create).not.toHaveBeenCalled();
    expect(Customer.updateOne).not.toHaveBeenCalled();
  });

  it('creates an account when nothing holds the uid or the email', async () => {
    lookups(null, null);
    const user = await resolveCustomerForToken({
      uid: 'firebase-1',
      email: 'new@example.com',
      name: 'Ana Silva',
      emailVerified: true
    });
    expect(user._id).toBe('created-id');
    expect(Customer.create.mock.calls[0][0]).toMatchObject({
      uid: 'firebase-1',
      email: 'new@example.com',
      firstName: 'Ana',
      lastName: 'Silva',
      emailVerified: true
    });
  });

  it('falls back to the placeholder name only when creating', async () => {
    lookups(null, null);
    await resolveCustomerForToken({ uid: 'firebase-1', email: 'new@example.com', name: '' });
    expect(Customer.create.mock.calls[0][0]).toMatchObject({ firstName: 'User', lastName: 'User' });
  });

  // The whole point of this refactor: every one of these call sites used to
  // `new Customer(...)` straight into the unique index on email.
  it('adopts a guest stub instead of colliding with it', async () => {
    lookups(null, { _id: 'stub-id', uid: STUB_UID, firstName: 'Ana', lastName: 'Silva' });
    const user = await resolveCustomerForToken({
      uid: 'firebase-new',
      email: 'ana@example.com',
      emailVerified: true
    });
    expect(user._id).toBe('stub-id');
    expect(Customer.create).not.toHaveBeenCalled();
  });

  it('throws 409 rather than adopting a real account', async () => {
    lookups(null, { _id: 'real-id', uid: 'firebase-owner' });
    await expect(resolveCustomerForToken({
      uid: 'firebase-attacker',
      email: 'victim@example.com',
      emailVerified: true
    })).rejects.toThrow(expect.objectContaining({ statusCode: 409, code: 'account_email_conflict' }));
    expect(Customer.create).not.toHaveBeenCalled();
  });

  it('throws 403 when the claimant has not verified the address', async () => {
    lookups(null, { _id: 'stub-id', uid: STUB_UID });
    await expect(resolveCustomerForToken({
      uid: 'firebase-new',
      email: 'ana@example.com',
      emailVerified: false
    })).rejects.toThrow(expect.objectContaining({ statusCode: 403, code: 'email_verification_required' }));
  });

  it('recovers when a concurrent request created the account first', async () => {
    let created = false;
    Customer.findOne.mockImplementation(q =>
      found('uid' in q && created ? { _id: 'raced-id', uid: q.uid } : null));
    Customer.create.mockImplementation(async () => {
      created = true;
      throw Object.assign(new Error('dup'), { code: 11000 });
    });
    const user = await resolveCustomerForToken({ uid: 'firebase-1', email: 'a@b.com' });
    expect(user._id).toBe('raced-id');
  });

  it('rethrows a duplicate error it cannot explain', async () => {
    lookups(null, null);
    Customer.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 }));
    await expect(resolveCustomerForToken({ uid: 'firebase-1', email: 'a@b.com' }))
      .rejects.toThrow('dup');
  });
});

describe('handleAccountClaimError', () => {
  const mockRes = () => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    return res;
  };

  it('answers a claim error with its own status and code', () => {
    const res = mockRes();
    expect(handleAccountClaimError(res, new AccountClaimError('nope', 409, 'account_email_conflict'))).toBe(true);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: 'account_email_conflict', message: 'nope' });
  });

  // Routes call this first inside catch; anything else must fall through to the
  // handler's own error path rather than being swallowed as a 409.
  it('leaves any other error to the caller', () => {
    const res = mockRes();
    expect(handleAccountClaimError(res, new Error('boom'))).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
  });
});
