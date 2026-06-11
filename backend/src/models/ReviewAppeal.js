const mongoose = require('mongoose');

/**
 * ReviewAppeal - created when either party disputes a review.
 * One open appeal per (review, appellant).
 */
const reviewAppealSchema = new mongoose.Schema({
  review: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review',
    required: true,
    index: true
  },
  appellant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  reason: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  details: {
    type: String,
    default: null,
    trim: true,
    maxlength: 3000
  },
  status: {
    type: String,
    enum: ['pending', 'rejected', 'accepted'],
    default: 'pending',
    index: true
  },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String, default: null },
  adminNotes: { type: String, trim: true, maxlength: 1000, default: null }
}, {
  timestamps: true,
  collection: 'reviewappeals'
});

reviewAppealSchema.index({ review: 1, appellant: 1, status: 1 });

// Race-safe guard: at most one pending appeal per (review, appellant).
reviewAppealSchema.index(
  { review: 1, appellant: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'unique_pending_appeal_per_appellant'
  }
);

module.exports = mongoose.model('ReviewAppeal', reviewAppealSchema);
