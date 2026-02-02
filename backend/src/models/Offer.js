const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true
  },
  offerer: {
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
  message: {
    type: String,
    maxlength: 1000,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'withdrawn', 'expired'],
    default: 'pending',
    index: true
  },
  expiresAt: {
    type: Date,
    default: null,
    index: true
  },
  sellerResponse: {
    type: String,
    default: null,
    maxlength: 500
  },
  respondedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Indexes for common queries
offerSchema.index({ listing: 1, createdAt: -1 }); // For listing offer history
offerSchema.index({ offerer: 1, createdAt: -1 }); // For user offer history
offerSchema.index({ listing: 1, status: 1 }); // For finding active offers
offerSchema.index({ status: 1, expiresAt: 1 }); // For finding expired offers

// Virtual for offerer display name
offerSchema.virtual('offererName').get(function() {
  if (this.populated('offerer')) {
    return `${this.offerer.firstName} ${this.offerer.lastName}`;
  }
  return 'Anonymous';
});

// Auto-expire offers after 7 days if not responded to
offerSchema.pre('save', function(next) {
  if (!this.expiresAt && this.status === 'pending') {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    this.expiresAt = expiresAt;
  }
  next();
});

const Offer = mongoose.model('Offer', offerSchema);

module.exports = Offer;

