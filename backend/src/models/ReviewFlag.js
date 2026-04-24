const mongoose = require('mongoose');

/**
 * ReviewFlag - flags suspicious/fake reviews for admin review.
 * Created by automated detection; resolved by admin.
 */
const reviewFlagSchema = new mongoose.Schema({
  review: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review',
    required: true,
    index: true
  },
  /** Reason: auto and user/admin moderation reasons */
  reason: {
    type: String,
    required: true,
    enum: [
      'extreme_score',
      'rapid_submission',
      'retaliation',
      'multiple_low_scores',
      'profanity_hate_speech',
      'duplicate_pattern',
      'ip_cluster',
      'user_report',
      'other'
    ],
    index: true
  },
  /** Auto-detection metadata (e.g. { score: 1, submittedWithinMinutes: 2 }) */
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  /** pending | dismissed | confirmed_fake */
  status: {
    type: String,
    enum: ['pending', 'dismissed', 'confirmed_fake'],
    default: 'pending',
    index: true
  },
  resolvedAt: { type: Date, default: null },
  resolvedBy: { type: String, default: null },
  adminNotes: { type: String, trim: true, maxlength: 1000, default: null }
}, {
  timestamps: true,
  collection: 'reviewflags'
});

reviewFlagSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ReviewFlag', reviewFlagSchema);
