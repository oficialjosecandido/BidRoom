/**
 * The single place where an Offer becomes something a client is allowed to see.
 *
 * Like formatBidPublic, this is an allowlist. It used to return
 * `email: offerer.email` unconditionally, and the HTTP list gated the email
 * behind an isSeller check while this — the socket payload, broadcast to
 * everyone in the `listing:` room — did not. A guest's address also leaked
 * through the display name, which was the local part of their email.
 *
 * No branch returns an email address. Buyer contact details live in Nexus.
 */
const { bidderKey } = require('./bidFormat');

function formatOfferForSocket(offer, opts = {}) {
  const offerer = offer.offerer;
  const listingId = (offer.listing && offer.listing.toString) ? offer.listing.toString() : String(offer.listing);
  const offererId = offerer && offerer._id ? ((offerer._id.toString && offerer._id.toString()) || String(offerer._id)) : null;

  const name = offerer
    ? `${offerer.firstName || ''} ${offerer.lastName || ''}`.trim() || 'Guest'
    : 'Guest';
  const initials = offerer
    ? (`${(offerer.firstName || '').charAt(0)}${(offerer.lastName || '').charAt(0)}`.toUpperCase() || 'G')
    : 'G';

  return {
    _id: (offer._id && offer._id.toString) ? offer._id.toString() : String(offer._id),
    listing: listingId,
    // Pseudonym so the UI can group a guest's offers without identifying them.
    offererKey: bidderKey({ bidder: offerer, bidderEmail: offer.offererEmail }, listingId),
    offerer: offerer ? { _id: offererId, firstName: offerer.firstName, lastName: offerer.lastName } : null,
    amount: offer.amount,
    message: offer.message || null,
    status: offer.status,
    respondedAt: offer.respondedAt ? (offer.respondedAt.toISOString ? offer.respondedAt.toISOString() : String(offer.respondedAt)) : null,
    sellerResponse: offer.sellerResponse || null,
    offererName: name,
    offererInitials: initials,
    offererVerified: opts.offererVerified ?? !!offerer?.emailVerified,
    offererTier: opts.offererTier ?? null,
    createdAt: offer.createdAt ? (offer.createdAt.toISOString ? offer.createdAt.toISOString() : String(offer.createdAt)) : null,
    updatedAt: offer.updatedAt ? (offer.updatedAt.toISOString ? offer.updatedAt.toISOString() : String(offer.updatedAt)) : null
  };
}

module.exports = { formatOfferForSocket };
