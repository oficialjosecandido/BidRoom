const mongoose = require('mongoose');

/**
 * Lightweight page-view events for listing detail impressions (seller analytics).
 */
const listingPageViewSchema = new mongoose.Schema(
  {
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

listingPageViewSchema.index({ seller: 1, createdAt: -1 });
listingPageViewSchema.index({ listing: 1, createdAt: -1 });

module.exports = mongoose.model('ListingPageView', listingPageViewSchema);
