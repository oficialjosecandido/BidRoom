const mongoose = require('mongoose');

/**
 * Manually curated list of "interested" email addresses (not platform customers)
 * that admins can target with newsletter campaigns.
 */
const interestedContactSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    trim: true
  },
  /** Preferred email language: en, pt, es, fr — determines which campaign variant they receive. */
  language: {
    type: String,
    enum: ['en', 'pt', 'es', 'fr'],
    default: 'en'
  },
  /** Opted out of all campaign emails via the self-service unsubscribe link */
  unsubscribed: {
    type: Boolean,
    default: false
  },
  /** Opaque token used to unsubscribe/change language without login (generated on first use) */
  emailUnsubscribeToken: { type: String, default: null, sparse: true, index: true }
}, {
  timestamps: true
});

module.exports = mongoose.model('InterestedContact', interestedContactSchema);
