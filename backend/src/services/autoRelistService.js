/**
 * Auto-relist scheduler: when a listing has autoRelist: true and ends unsold,
 * automatically create a fresh listing copy with the same settings.
 * Capped at MAX_AUTO_RELISTS attempts (tracked via relistCount).
 */

const Listing = require('../models/Listing');
const { notifyFollowersNewListing } = require('./notificationService');

const MAX_AUTO_RELISTS = 3;

const DURATION_MS = {
  '5 minutes': 5 * 60 * 1000,
  '1 hour': 60 * 60 * 1000,
  '2 hours': 2 * 60 * 60 * 1000,
  '7 hours': 7 * 60 * 60 * 1000,
  '24 hours': 24 * 60 * 60 * 1000,
  '3 days': 3 * 24 * 60 * 60 * 1000,
  '7 days': 7 * 24 * 60 * 60 * 1000,
};

function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function processAutoRelists(io = null) {
  const eligible = await Listing.find({
    status: 'ended',
    winner: null,
    autoRelist: true,
    relistedAt: null,
  }).populate('seller', 'firstName lastName _id');

  for (const listing of eligible) {
    try {
      if ((listing.relistCount || 0) >= MAX_AUTO_RELISTS) {
        await Listing.updateOne({ _id: listing._id }, { $set: { autoRelist: false } });
        console.log(`⏹  Auto-relist cap reached for listing ${listing._id}, disabled.`);
        continue;
      }

      const durationMs = DURATION_MS[listing.durationSlot] || DURATION_MS['7 days'];
      const newEndDate = new Date(Date.now() + durationMs);

      const baseSlug = generateSlug(listing.title);
      let slug = baseSlug;
      while (await Listing.exists({ slug })) {
        slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      }

      const newListing = await Listing.create({
        title: listing.title,
        description: listing.description,
        category: listing.category,
        subCategory: listing.subCategory,
        images: listing.images,
        slug,
        startingPrice: listing.startingPrice,
        currentPrice: listing.startingPrice,
        reservePrice: listing.reservePrice,
        bidIncrement: listing.bidIncrement,
        auctionFormat: listing.auctionFormat,
        durationSlot: listing.durationSlot,
        condition: listing.condition,
        location: listing.location,
        locationCity: listing.locationCity,
        locationCountry: listing.locationCountry,
        shippingOption: listing.shippingOption,
        shippingCost: listing.shippingCost,
        packageSize: listing.packageSize,
        shippingOriginPostalCode: listing.shippingOriginPostalCode,
        shippingOriginCity: listing.shippingOriginCity,
        shippingOriginCountry: listing.shippingOriginCountry,
        handlingTime: listing.handlingTime,
        returnPolicy: listing.returnPolicy,
        specifications: listing.specifications,
        minimumOfferPrice: listing.minimumOfferPrice,
        seller: listing.seller._id,
        status: 'active',
        startDate: new Date(),
        endDate: newEndDate,
        autoRelist: true,
        relistCount: (listing.relistCount || 0) + 1,
        relistOf: listing._id,
      });

      await Listing.updateOne({ _id: listing._id }, { $set: { relistedAt: new Date() } });

      console.log(`✅ Auto-relisted: ${listing._id} → ${newListing._id} (attempt ${newListing.relistCount})`);

      notifyFollowersNewListing({
        sellerId: listing.seller._id,
        sellerFirstName: listing.seller.firstName,
        listingTitle: newListing.title,
        listingSlug: slug,
        io
      }).catch(() => {});
    } catch (err) {
      console.error(`❌ Auto-relist failed for listing ${listing._id}:`, err.message);
    }
  }
}

module.exports = { processAutoRelists };
