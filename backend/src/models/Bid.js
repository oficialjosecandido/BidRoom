const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true
  },
  bidder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  bidType: {
    type: String,
    enum: ['manual', 'proxy', 'auto'],
    default: 'manual'
  },
  maxBid: {
    type: Number,
    default: null,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'outbid', 'winning', 'cancelled'],
    default: 'active',
    index: true
  },
  isWinning: {
    type: Boolean,
    default: false,
    index: true
  },
  notes: {
    type: String,
    maxlength: 500,
    default: null
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Indexes for common queries
bidSchema.index({ listing: 1, createdAt: -1 }); // For listing bid history
bidSchema.index({ bidder: 1, createdAt: -1 }); // For user bid history
bidSchema.index({ listing: 1, isWinning: 1 }); // For finding winning bids
bidSchema.index({ listing: 1, amount: -1 }); // For finding highest bid

// Virtual for bidder display name
bidSchema.virtual('bidderName').get(function() {
  if (this.populated('bidder')) {
    return `${this.bidder.firstName} ${this.bidder.lastName}`;
  }
  return 'Anonymous';
});

const Bid = mongoose.model('Bid', bidSchema);

module.exports = Bid;

