/**
 * Resolving the seller behind a guest listing.
 *
 * The visitor gives us a name and an email at the end of the form, and nothing
 * else. Two cases:
 *
 *  - The email already belongs to an account. Then this is that person — or
 *    someone typing their address — and the listing is attached to that account.
 *    Every restriction the account carries applies here too: without that, the
 *    guest form is a way around a suspension, a dispute hold or a DSA block.
 *
 *  - The email is new. We provision a stub account, the same shape Nexus already
 *    uses to list on behalf of a seller who has not signed up yet (see
 *    adminListingService.resolveOrCreateSeller). Its uid is synthetic, so the
 *    record cannot be logged into until the real person signs up with that
 *    address and claims it.
 *
 * The name is taken from what the visitor typed and never derived from the email.
 * `firstName` is published on the listing page, and for most people the local
 * part of an address is their actual name — deriving it would leak the address
 * one field over from where we just removed it.
 */

const crypto = require('crypto');
const Customer = require('../models/Customer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Thrown for conditions the route should turn into a 4xx rather than a 500. */
class GuestSellerError extends Error {
  constructor(message, statusCode = 400, code = 'guest_seller_invalid') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Split whatever the visitor typed into the model's required two fields. */
function splitName(raw) {
  const cleaned = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  if (!cleaned) return null;
  const parts = cleaned.split(' ');
  const firstName = parts[0].slice(0, 50);
  // lastName is required on the model. A single-word name is normal, so stand in
  // rather than refuse; nothing downstream reads it as a real surname.
  const lastName = (parts.slice(1).join(' ') || 'Seller').slice(0, 50);
  return { firstName, lastName };
}

/**
 * Refuse the listing if this address belongs to an account that is not allowed to
 * publish. Mirrors requireActiveAccount + requireNoDisputeRestriction, which
 * cannot run as middleware here because the email only arrives in the body.
 */
function assertSellerMayPublish(seller) {
  const status = seller.accountStatus || 'active';
  if (status === 'suspended') {
    throw new GuestSellerError(
      'This email belongs to an account that is temporarily restricted while a dispute is reviewed.',
      403,
      'account_suspended'
    );
  }
  if (status === 'closed') {
    throw new GuestSellerError(
      'This email belongs to an account that has been permanently closed.',
      403,
      'account_closed'
    );
  }
  if (seller.contentRestrictedUntil && new Date(seller.contentRestrictedUntil) > new Date()) {
    throw new GuestSellerError(
      'This email belongs to an account that is temporarily restricted from creating listings.',
      403,
      'account_content_restricted'
    );
  }
  if (Array.isArray(seller.activeDisputeTransactionIds) && seller.activeDisputeTransactionIds.length > 0) {
    throw new GuestSellerError(
      'This email belongs to an account with a dispute under review and cannot publish new listings.',
      403,
      'account_dispute_restricted'
    );
  }
  if (seller.dsaListingRestricted) {
    throw new GuestSellerError(
      'This email belongs to an account restricted from new listings pending a compliance review.',
      403,
      'account_dsa_restricted'
    );
  }
}

const RESTRICTION_SELECT =
  '_id email firstName lastName uid accountStatus contentRestrictedUntil activeDisputeTransactionIds ' +
  'dsaListingRestricted sellerClassification professionalVerificationStatus kycStatus language';

/**
 * @param {{ email: string, name: string }} input
 * @returns {Promise<{ seller: import('mongoose').Document, sellerCreated: boolean, hasAccount: boolean }>}
 */
async function resolveGuestSeller({ email, name }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !EMAIL_RE.test(cleanEmail) || cleanEmail.length > 254) {
    throw new GuestSellerError('A valid email address is required to publish the listing.', 400, 'email_invalid');
  }

  const existing = await Customer.findOne({ email: cleanEmail }).select(RESTRICTION_SELECT);
  if (existing) {
    assertSellerMayPublish(existing);
    // An existing account keeps the name it already has: a visitor typing
    // somebody else's address must not be able to rename their account.
    return { seller: existing, sellerCreated: false, hasAccount: !isStubUid(existing.uid) };
  }

  const parsed = splitName(name);
  if (!parsed) {
    throw new GuestSellerError('A name is required to publish the listing.', 400, 'name_required');
  }

  const created = await Customer.create({
    uid: `guest-${crypto.randomBytes(16).toString('hex')}`,
    email: cleanEmail,
    firstName: parsed.firstName,
    lastName: parsed.lastName,
    emailVerified: false,
    language: 'pt',
    balance: 0,
    reviewCount: 0
  });

  return { seller: created, sellerCreated: true, hasAccount: false };
}

/** True for accounts provisioned for someone who has not signed up yet. */
function isStubUid(uid) {
  return /^(guest|nexus)-[a-f0-9]{32}$/.test(String(uid || ''));
}

module.exports = { resolveGuestSeller, assertSellerMayPublish, isStubUid, GuestSellerError, EMAIL_RE };
