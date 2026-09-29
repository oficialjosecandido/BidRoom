const Customer = require('../models/Customer');
const { isStubUid } = require('./guestSellerService');
const logger = require('../utils/logger');

/**
 * Claiming a provisioned account.
 *
 * Two flows create a Customer before the person has ever signed in: Nexus can
 * enter a seller by email, and a visitor can publish a listing without an
 * account. Both leave a document with a synthetic uid (`nexus-…` / `guest-…`)
 * holding the email, and `Customer.email` is unique — so when that person does
 * sign up, creating a second document is impossible. The document has to be
 * adopted instead.
 *
 * Adoption is what makes a guest's listing appear in their dashboard: every
 * query keys off `Customer._id`, which does not change. Only `uid` is rebound.
 *
 * Two rules keep this from being an account-takeover:
 *
 *  1. Only a *stub* uid is ever adopted. Rebinding a real account's uid would
 *     mean anyone who gets Firebase to mint a token for that address inherits
 *     the account, its balance and its history.
 *  2. The token's email must be verified. A guest listing is published without
 *     any email confirmation, so the address on it is unproven — requiring
 *     verification here is what proves the claimant owns the mailbox, rather
 *     than merely knowing an address someone else typed into the form.
 */

/**
 * @returns {Promise<{status: 'claimed'|'none'|'verification_required'|'conflict', customer?: object}>}
 *   claimed              – stub adopted; `customer` is the fresh document
 *   none                 – nothing holds this email; the caller should create
 *   verification_required – a stub holds it, but this token's email is unverified
 *   conflict             – a real account holds it under a different uid
 */
async function claimAccountByEmail({ uid, email, emailVerified, firstName, lastName }) {
  const normalised = String(email || '').toLowerCase().trim();
  if (!uid || !normalised) return { status: 'none' };

  const existing = await Customer.findOne({ email: normalised }).select('_id uid firstName lastName');
  if (!existing) return { status: 'none' };
  if (existing.uid === uid) return { status: 'claimed', customer: await Customer.findById(existing._id) };

  if (!isStubUid(existing.uid)) {
    // A real account already holds this address under a different Firebase uid.
    // Silently rebinding it is how accounts get stolen, so refuse and let a
    // human look: the legitimate version of this (a deleted and recreated
    // Firebase user) is rare enough to be worth a support ticket.
    logger.warn(`[accountClaim] refused: ${normalised} is held by a non-stub account`);
    return { status: 'conflict' };
  }

  if (emailVerified !== true) return { status: 'verification_required' };

  const update = { uid, emailVerified: true, lastLogin: new Date() };
  // The stub's name is already printed on a live listing as the seller's name,
  // so it wins. Firebase's display name only fills a gap.
  if (!existing.firstName && firstName) update.firstName = firstName;
  if (!existing.lastName && lastName) update.lastName = lastName;

  await Customer.updateOne({ _id: existing._id, uid: existing.uid }, { $set: update });
  const customer = await Customer.findById(existing._id);
  logger.info(`[accountClaim] ${normalised} claimed a provisioned account`);
  return { status: 'claimed', customer };
}

class AccountClaimError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'AccountClaimError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * The single find-or-provision path for a verified Firebase token.
 *
 * Half a dozen handlers used to carry their own copy of this ("find by uid, else
 * new Customer(...)"), and every copy was wrong in its own way: some threw E11000
 * against a stub holding the email, one adopted *any* email match and defaulted
 * `emailVerified` to true. Route handlers call this instead.
 *
 * @throws {AccountClaimError} 409 when a real account holds the email under
 *   another uid, 403 when a stub holds it but the token is unverified.
 */
async function resolveCustomerForToken(tokenUser) {
  const { uid, email, name, emailVerified } = tokenUser || {};
  const existing = await Customer.findOne({ uid });
  if (existing) return existing;

  const nameParts = String(name || '').split(' ').filter(Boolean);
  // Null, not 'User': these also refresh an existing profile, and a placeholder
  // must never overwrite a real name — least of all a claimed seller's, which is
  // printed on their live listings.
  const firstName = nameParts[0] || null;
  const lastName = nameParts.slice(1).join(' ') || null;

  const claim = await claimAccountByEmail({ uid, email, emailVerified, firstName, lastName });
  if (claim.status === 'conflict') {
    throw new AccountClaimError(
      'This email is already registered to another account. Please contact support.',
      409,
      'account_email_conflict'
    );
  }
  if (claim.status === 'verification_required') {
    throw new AccountClaimError(
      'Confirm your email address to finish setting up your account.',
      403,
      'email_verification_required'
    );
  }
  if (claim.status === 'claimed') return claim.customer;

  try {
    return await Customer.create({
      uid,
      email: email || '',
      firstName: firstName || 'User',
      lastName: lastName || 'User',
      isActive: true,
      emailVerified: emailVerified ?? false
    });
  } catch (err) {
    // A concurrent first request from the same person won the race.
    if (err.code === 11000) {
      const raced = await Customer.findOne({ uid });
      if (raced) return raced;
    }
    throw err;
  }
}

/**
 * Map an AccountClaimError onto the response. Call it first inside a route's
 * catch; returns false for anything else, which the catch should handle as before.
 */
function handleAccountClaimError(res, err) {
  if (!(err instanceof AccountClaimError)) return false;
  res.status(err.statusCode).json({ error: err.code, message: err.message });
  return true;
}

module.exports = {
  claimAccountByEmail,
  resolveCustomerForToken,
  handleAccountClaimError,
  AccountClaimError
};
