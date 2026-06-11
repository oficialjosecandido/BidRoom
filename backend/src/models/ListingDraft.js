const mongoose = require('mongoose');

/**
 * In-progress "add listing" data per seller. Not a published Listing — avoids strict Listing validation.
 */
const listingDraftSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    unique: true,
    index: true
  },
  /** Snapshot: form fields + imageUrls (already uploaded to storage). */
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ListingDraft', listingDraftSchema);
