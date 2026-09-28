/**
 * Anonymous draft sessions for guest listing creation.
 *
 * A visitor builds the listing before telling us who they are — the email is only
 * asked for at the very end. But the images have to be uploaded while the form is
 * being filled, and an upload endpoint open to the world is free file storage for
 * anyone who finds it. So the form opens by asking for a short-lived signed
 * ticket that carries no identity at all, only a random id, and uploads spend
 * quota against that id.
 *
 * Deliberately not a JWT and not a Mongo document: there is nothing to look up
 * and nothing to revoke — the signature and the expiry are the whole contract.
 * Keeping it stateless also means a flood of issued tickets costs us no storage.
 */

const crypto = require('crypto');

const SECRET =
  process.env.GUEST_SESSION_SECRET || process.env.JWT_SECRET || 'bidroom-guest-session-salt';

/** Long enough to write a listing without losing uploads, short enough to bound abuse. */
const TTL_MS = 2 * 60 * 60 * 1000;

/** Bumped if the payload shape ever changes, so old tickets fail closed. */
const VERSION = 'g1';

function sign(body) {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
}

/** Issue a ticket for a visitor who has just opened the listing form. */
function issueGuestSession(now = Date.now()) {
  const jti = crypto.randomBytes(16).toString('hex');
  const expiresAt = now + TTL_MS;
  const body = `${VERSION}.${jti}.${expiresAt}`;
  return {
    token: `${body}.${sign(body)}`,
    jti,
    expiresAt: new Date(expiresAt).toISOString()
  };
}

/**
 * Verify a ticket. Returns `{ jti, expiresAt }` or null — never throws and never
 * explains which part failed, so a caller cannot probe the format.
 */
function verifyGuestSession(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 512) return null;

  const parts = token.split('.');
  if (parts.length !== 4) return null;

  const [version, jti, expiresAtRaw, providedSig] = parts;
  if (version !== VERSION) return null;
  if (!/^[a-f0-9]{32}$/.test(jti)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return null;

  const expectedSig = sign(`${version}.${jti}.${expiresAtRaw}`);
  // Compare as buffers of equal length; timingSafeEqual throws on a mismatch.
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return { jti, expiresAt };
}

module.exports = { issueGuestSession, verifyGuestSession, GUEST_SESSION_TTL_MS: TTL_MS };
