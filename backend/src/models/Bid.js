const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true
    // index omitted: compound indexes below (listing+createdAt, listing+amount) cover listing queries
  },
  bidder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Optional for unauthenticated bids
    index: true,
    default: null
  },
  bidderEmail: {
    type: String,
    required: false,
    lowercase: true,
    trim: true,
    default: null,
    validate: {
      validator: function(email) {
        // If email is provided, validate it
        if (email && email.trim() !== '') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return emailRegex.test(email);
        }
        return true;
      },
      message: 'Valid email format required if provided'
    }
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
  notes: {
    type: String,
    maxlength: 500,
    default: null
  },
  /** Whether to notify this bidder when outbid: email + in-app (registered users). Default true. */
  notifyWhenOutbid: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Indexes for common queries
bidSchema.index({ listing: 1, createdAt: -1 }); // For listing bid history
bidSchema.index({ bidder: 1, createdAt: -1 }); // For user bid history
bidSchema.index({ listing: 1, amount: -1 }); // For finding highest bid

// Virtual for bidder display name
bidSchema.virtual('bidderName').get(function() {
  if (this.populated('bidder')) {
    return `${this.bidder.firstName} ${this.bidder.lastName}`;
  }
  return 'Anonymous';
});

// Pre-save validation: ensure either bidder or bidderEmail is provided
bidSchema.pre('save', function(next) {
  if (!this.bidder && !this.bidderEmail) {
    return next(new Error('Either bidder (authenticated user) or bidderEmail (unauthenticated user) must be provided'));
  }
  next();
});

const Bid = mongoose.model('Bid', bidSchema);

module.exports = Bid;

