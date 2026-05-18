const mongoose = require('mongoose');

/**
 * Customer - profile and account info for dashboard.
 * Stored in "customers" collection. Linked to Firebase/auth by uid.
 */
const customerSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  reviewCount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastLogin: {
    type: Date,
    default: null
  },
  /** Stripe checkout session IDs already credited (idempotency for webhook + confirm-session). */
  creditedStripeSessionIds: {
    type: [String],
    default: []
  },
  /** Preferred UI language: en, pt, es, fr */
  language: {
    type: String,
    enum: ['en', 'pt', 'es', 'fr'],
    default: 'en'
  },
  /** UI theme: light, dark, or follow OS (system). Synced across devices when set while logged in. */
  theme: {
    type: String,
    enum: ['light', 'dark', 'system'],
    required: false
  }
}, {
  timestamps: true,
  collection: 'customers'
});

const Customer = mongoose.model('Customer', customerSchema);

module.exports = Customer;
