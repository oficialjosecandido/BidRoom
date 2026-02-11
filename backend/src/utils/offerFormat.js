/**
 * Format offer for socket emit (matches API shape for frontend in-place update)
 */
function formatOfferForSocket(offer, opts = {}) {
  const offerer = offer.offerer;
  const name = offerer
    ? `${offerer.firstName || ''} ${offerer.lastName || ''}`.trim() || 'Anonymous'
    : (offer.offererEmail ? offer.offererEmail.split('@')[0] : 'Anonymous');
  const initials = offerer
    ? `${(offerer.firstName || '').charAt(0)}${(offerer.lastName || '').charAt(0)}` || 'A'
    : (offer.offererEmail ? offer.offererEmail.charAt(0).toUpperCase() : 'A');
  const listingId = (offer.listing && offer.listing.toString) ? offer.listing.toString() : String(offer.listing);
  const offererId = offerer && offerer._id ? ((offerer._id.toString && offerer._id.toString()) || String(offerer._id)) : null;
  return {
    _id: (offer._id && offer._id.toString) ? offer._id.toString() : String(offer._id),
    listing: listingId,
    offerer: offerer ? { _id: offererId, firstName: offerer.firstName, lastName: offerer.lastName, email: offerer.email } : null,
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
