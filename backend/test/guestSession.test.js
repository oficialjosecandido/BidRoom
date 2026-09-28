const { issueGuestSession, verifyGuestSession, GUEST_SESSION_TTL_MS } = require('../src/utils/guestSession');

describe('issueGuestSession', () => {
  it('issues a ticket that verifies back to the same id', () => {
    const { token, jti, expiresAt } = issueGuestSession();
    expect(verifyGuestSession(token)).toMatchObject({ jti });
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('never reuses an id, so quota cannot be shared between visitors', () => {
    const ids = new Set(Array.from({ length: 50 }, () => issueGuestSession().jti));
    expect(ids.size).toBe(50);
  });

  it('carries no identity — only a random id and an expiry', () => {
    const { token } = issueGuestSession();
    const [version, jti, expiresAt] = token.split('.');
    expect(version).toBe('g1');
    expect(jti).toMatch(/^[a-f0-9]{32}$/);
    expect(Number(expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe('verifyGuestSession', () => {
  it('rejects a tampered signature', () => {
    const { token } = issueGuestSession();
    const parts = token.split('.');
    parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith('A') ? 'B' : 'A');
    expect(verifyGuestSession(parts.join('.'))).toBeNull();
  });

  it('rejects an extended expiry — the signature covers it', () => {
    const { token } = issueGuestSession();
    const parts = token.split('.');
    parts[2] = String(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
    expect(verifyGuestSession(parts.join('.'))).toBeNull();
  });

  it('rejects a swapped id — the signature covers that too', () => {
    const { token } = issueGuestSession();
    const other = issueGuestSession();
    const parts = token.split('.');
    parts[1] = other.jti;
    expect(verifyGuestSession(parts.join('.'))).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const issuedAt = Date.now() - GUEST_SESSION_TTL_MS - 1000;
    const { token } = issueGuestSession(issuedAt);
    expect(verifyGuestSession(token)).toBeNull();
  });

  it('accepts a ticket that is still inside its window', () => {
    const issuedAt = Date.now() - GUEST_SESSION_TTL_MS + 60 * 1000;
    const { token, jti } = issueGuestSession(issuedAt);
    expect(verifyGuestSession(token)).toMatchObject({ jti });
  });

  it('rejects an unknown version, so old tickets fail closed', () => {
    const { token } = issueGuestSession();
    expect(verifyGuestSession(token.replace(/^g1\./, 'g0.'))).toBeNull();
  });

  it('rejects junk without throwing', () => {
    for (const bad of ['', 'x', 'a.b.c', 'a.b.c.d.e', null, undefined, 42, {}, [], 'g1...', 'g1.zz.1.sig']) {
      expect(verifyGuestSession(bad)).toBeNull();
    }
  });

  it('rejects an oversized token instead of hashing it', () => {
    expect(verifyGuestSession('g1.' + 'a'.repeat(1000))).toBeNull();
  });
});
