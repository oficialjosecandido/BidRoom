const mongoose = require('mongoose');

/**
 * Review - one user reviewing another after a completed transaction.
 * role: 'as_buyer' = reviewee is being reviewed in their role as buyer (so reviewer was seller)
 *       'as_seller' = reviewee is being reviewed in their role as seller (so reviewer was buyer)
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
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comment: {
    type: String,
    maxlength: 1000,
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
