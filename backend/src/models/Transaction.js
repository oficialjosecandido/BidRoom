const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true
    // index omitted: schema.index({ listing: 1 }, { unique: true }) below covers it
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  winnerBid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bid',
    required: true
  },
  /** Final price (winning bid amount) */
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  /** Overall transaction state */
  transactionStatus: {
    type: String,
    enum: ['pending_payment', 'paid', 'shipped', 'delivered', 'completed', 'cancelled'],
    default: 'pending_payment',
    index: true
  },
  /** Whether the buyer has paid */
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid'],
    default: 'pending',
    index: true
  },
  /** Shipping state */
  sendingStatus: {
    type: String,
    enum: ['pending', 'shipped', 'delivered'],
    default: 'pending',
    index: true
  },
  /** @deprecated Use transactionStatus. Kept for backward compatibility with existing documents. */
  status: {
    type: String,
    enum: ['pending_payment', 'paid', 'shipped', 'delivered', 'completed', 'cancelled'],
    default: null
  },
  paidAt: {
    type: Date,
    default: null
  },
  shippedAt: {
    type: Date,
    default: null
  },
  trackingNumber: {
    type: String,
    trim: true,
    default: null
  },
  trackingCarrier: {
    type: String,
    trim: true,
    default: null
  },
  notes: {
    type: String,
    trim: true,
    default: null
  }
}, {
  timestamps: true
});

transactionSchema.index({ seller: 1, updatedAt: -1 });
transactionSchema.index({ buyer: 1, updatedAt: -1 });
transactionSchema.index({ listing: 1 }, { unique: true }); // One transaction per listing

module.exports = mongoose.model('Transaction', transactionSchema);
