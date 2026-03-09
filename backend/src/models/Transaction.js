const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Reference to the auction listing
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true
  },
  // Buyer (winner)
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Seller
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  // Invoice number (auto-generated)
  invoiceNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // Currency
  currency: {
    type: String,
    default: 'usd',
    lowercase: true
  },
  // Amounts (all in decimal, e.g. 100.00 = $100.00)
  itemPrice: {
    type: Number,
    required: true,
    min: 0
  },
  // BidRoom fee (2% of item price, charged to buyer)
  bidRoomFee: {
    type: Number,
    required: true,
    min: 0
  },
  bidRoomFeeRate: {
    type: Number,
    default: 0.02 // 2%
  },
  // Stripe processing fee (passed through to buyer for transparency)
  stripeFee: {
    type: Number,
    required: true,
    min: 0
  },
  stripeFeeRate: {
    type: Number,
    default: 0.029 // 2.9%
  },
  stripeFixedFee: {
    type: Number,
    default: 0.30 // $0.30
  },
  // Total charged to buyer = itemPrice + bidRoomFee + stripeFee
  totalChargedToBuyer: {
    type: Number,
    required: true,
    min: 0
  },
  // Amount in cents sent to Stripe (Stripe requires integer cents)
  stripeAmountInCents: {
    type: Number,
    required: true
  },
  // BidRoom application fee in cents
  applicationFeeInCents: {
    type: Number,
    required: true
  },
  // Estimated seller payout (after Stripe fee and BidRoom fee)
  sellerPayout: {
    type: Number,
    required: true
  },
  // Stripe identifiers
  stripePaymentIntentId: {
    type: String,
    default: null,
    index: true,
    sparse: true
  },
  stripeChargeId: {
    type: String,
    default: null,
    sparse: true
  },
  stripeTransferId: {
    type: String,
    default: null,
    sparse: true
  },
  // Seller's Stripe Connected Account ID
  sellerStripeAccountId: {
    type: String,
    default: null
  },
  // Payment status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'disputed'],
    default: 'pending',
    index: true
  },
  // Payment timestamps
  paymentInitiatedAt: {
    type: Date,
    default: null
  },
  paidAt: {
    type: Date,
    default: null
  },
  releasedAt: {
    type: Date,
    default: null
  },
  // Stripe webhook events received
  stripeEvents: [{
    eventId: String,
    eventType: String,
    receivedAt: { type: Date, default: Date.now }
  }],
  // Notes / metadata
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Generate invoice number before saving
transactionSchema.pre('save', async function(next) {
  if (!this.invoiceNumber) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    // Count existing transactions this month for sequential numbering
    const count = await this.constructor.countDocuments({
      createdAt: {
        $gte: new Date(year, now.getMonth(), 1),
        $lt: new Date(year, now.getMonth() + 1, 1)
      }
    });
    this.invoiceNumber = `BR-${year}${month}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
