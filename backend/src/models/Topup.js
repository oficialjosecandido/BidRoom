const mongoose = require('mongoose');

/**
 * Topup - record of each balance top-up (Stripe payment).
 * Stored in "topups" collection. One document per successful payment.
 */
const topupSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  stripeSessionId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    trim: true
  },
  currency: {
    type: String,
    default: 'eur',
    trim: true
  }
}, {
  timestamps: true,
  collection: 'topups'
});

// List user's topups by most recent first
topupSchema.index({ uid: 1, createdAt: -1 });

const Topup = mongoose.model('Topup', topupSchema);

module.exports = Topup;
