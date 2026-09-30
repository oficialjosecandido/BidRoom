/**
 * Keep Listing.currentPrice / Listing.bidCount in sync for Best Offer listings.
 * Cards and browse APIs read those fields; Offer docs alone are not enough.
 */

const mongoose = require('mongoose');
const Offer = require('../models/Offer');
const Listing = require('../models/Listing');

function toObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id;
  return new mongoose.Types.ObjectId(String(id));
}

/**
 * Highest pending/accepted offer + count of those offers.
 * Rejected / withdrawn / expired do not count toward the live summary.
 */
async function getOfferStatsForListings(listingIds) {
  if (!listingIds?.length) return {};
  const ids = listingIds.map(toObjectId);
  const rows = await Offer.aggregate([
    { $match: { listing: { $in: ids }, status: { $in: ['pending', 'accepted'] } } },
    {
      $group: {
        _id: '$listing',
        highestOffer: { $max: '$amount' },
        offerCount: { $sum: 1 }
      }
    }
  ]);
  return Object.fromEntries(
    rows.map((r) => [r._id.toString(), { highestOffer: r.highestOffer, offerCount: r.offerCount }])
  );
}

/**
 * Persist offer summary onto the listing so list cards stay correct.
 * No-op when the listing is not best-offer.
 */
async function syncListingOfferStats(listingId) {
  const id = toObjectId(listingId);
  const listing = await Listing.findById(id).select('auctionFormat').lean();
  if (!listing || listing.auctionFormat !== 'best-offer') {
    return null;
  }

  const stats = (await getOfferStatsForListings([id]))[id.toString()] || {
    highestOffer: null,
    offerCount: 0
  };

  await Listing.updateOne(
    { _id: id },
    {
      $set: {
        bidCount: stats.offerCount,
        // 0 ⇒ list UI shows "No offers yet"; otherwise the live highest offer.
        currentPrice: stats.highestOffer ?? 0
      }
    }
  );

  return stats;
}

module.exports = {
  getOfferStatsForListings,
  syncListingOfferStats
};
