const mongoose = require('mongoose');

/**
 * Review - one user reviewing another after a completed transaction.
 * reviewer: User who wrote the review
 * reviewee: User being reviewed (the "reviewed" party)
 * role: 'as_buyer' = reviewee is being reviewed as buyer (reviewer was seller)
 *       'as_seller' = reviewee is being reviewed as seller (reviewer was buyer)
 * score: 1-10 (visible to all; used for aggregations)
 * description: optional text (private - never returned to other users)
 */
const reviewSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true
  },
  reviewer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  reviewee: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  role: {
    type: String,
    enum: ['as_buyer', 'as_seller'],
    required: true,
    index: true
  },
  /** Score 1-10 (visible publicly) */
  score: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
    index: true
  },
  /** Review description text (private - never exposed to other users) */
  description: {
    type: String,
    maxlength: 2000,
    default: null,
    trim: true
  }
}, {
  timestamps: true,
  collection: 'reviews'
});

// One review per (listing, reviewer, reviewee) - seller reviews buyer once, buyer reviews seller once
reviewSchema.index({ listing: 1, reviewer: 1, reviewee: 1 }, { unique: true });
reviewSchema.index({ reviewee: 1, role: 1 }); // For aggregating scores by reviewee

const Review = mongoose.model('Review', reviewSchema);

module.exports = Review;
