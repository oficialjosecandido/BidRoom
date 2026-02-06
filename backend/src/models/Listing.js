const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 80
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  description: {
    type: String,
    required: true,
    maxlength: 5000
  },
  category: {
    type: String,
    required: true,
    enum: ['electronics', 'art-collectibles', 'jewelry', 'home-garden', 'watches', 'fashion', 'sports', 'books', 'other'],
    index: true
  },
  subCategory: {
    type: String,
    required: true,
    trim: true
  },
  images: {
    type: [String],
    default: []
  },
  startingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  currentPrice: {
    type: Number,
    required: true,
    min: 0
  },
  reservePrice: {
    type: Number,
    default: null,
    min: 0
  },
  bidIncrement: {
    type: Number,
    default: 1,
    min: 0.01
  },
  bidCount: {
    type: Number,
    default: 0,
    min: 0
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  endDate: {
    type: Date,
    required: true,
    index: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  status: {
    type: String,
    enum: ['draft', 'active', 'ended', 'cancelled'],
    default: 'active',
    index: true
  },
  // Trust and Promotion features
  isFeatured: {
    type: Boolean,
    default: false,
    index: true
  },
  isVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  verificationDetails: {
    type: String,
    default: null
  },
  // Listing type for filtering
  listingType: {
    type: String,
    enum: ['Promoted', 'Verified', 'Standard'],
    default: 'Standard',
    index: true
  },
  condition: {
    type: String,
    enum: ['New', 'Used - Excellent', 'Used - Very Good', 'Used - Good', 'Used - Fair', 'For Parts or Not Working'],
    required: true
  },
  location: {
    type: String,
    default: null
  },
  shippingCost: {
    type: Number,
    default: 0,
    min: 0
  },
  shippingOption: {
    type: String,
    enum: ['flat-rate', 'calculated', 'local-pickup', 'free'],
    required: true
  },
  handlingTime: {
    type: Number,
    required: true,
    min: 1,
    max: 30 // Max 30 business days
  },
  returnPolicy: {
    type: String,
    enum: ['30-days', '14-days', 'no-returns', 'custom'],
    required: true
  },
  specifications: [{
    key: {
      type: String,
      required: true,
      trim: true
    },
    value: {
      type: String,
      required: true,
      trim: true
    }
  }],
  // Auction format and mechanics
  auctionFormat: {
    type: String,
    enum: ['highest-bid', 'best-offer'],
    default: 'highest-bid',
    index: true
  },
  // Duration slot (fixed auction lengths)
  durationSlot: {
    type: String,
    enum: ['5 minutes', '2 hours', '24 hours', '3 days', '7 days'],
    default: '7 days',
    required: true
  },
  // Buy Now Price (closes auction instantly if paid)
  buyNowPrice: {
    type: Number,
    default: null,
    min: 0
  },
  // Commission settings
  allowPrivateRoom: {
    type: Boolean,
    default: false
  },
  commissionRate: {
    type: Number,
    default: 0.005, // 0.5% default
    min: 0,
    max: 1
  },
  // Private Room state
  privateRoomStatus: {
    type: String,
    enum: ['not-triggered', 'eligible', 'invited', 'active', 'ended'],
    default: 'not-triggered'
  },
  privateRoomEndDate: {
    type: Date,
    default: null
  },
  privateRoomLastBidTime: {
    type: Date,
    default: null
  },
  // Platinum Bidders (up to 5 selected by seller)
  platinumBidders: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: []
  }],
  platinumBidderInvitedAt: {
    type: Date,
    default: null
  },
  // Acceptance window deadline (5 minutes after auction ends)
  platinumBidderAcceptanceDeadline: {
    type: Date,
    default: null
  },
  // Track invitation status for each platinum bidder
  platinumBidderInvitations: [{
    bidder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      default: 'pending'
    },
    invitedAt: {
      type: Date,
      default: Date.now
    },
    acceptedAt: {
      type: Date,
      default: null
    },
    invitationToken: {
      type: String,
      default: null
      // No longer used (acceptance flow removed); kept for backwards compatibility
    }
  }],
  // Best Offer specific fields
  minimumOfferPrice: {
    type: Number,
    default: null,
    min: 0
  },
  // Renewal tracking for listings >7 days
  lastRenewalDate: {
    type: Date,
    default: null
  },
  renewalRequired: {
    type: Boolean,
    default: false
  },
  // Tracking unique bidders for Private Room trigger
  uniqueBidders: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  // Winner selection
  winner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  winnerBid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bid',
    default: null
  },
  winnerSelectedAt: {
    type: Date,
    default: null
  },
  winnerSelectionDeadline: {
    type: Date,
    default: null // Set to 24 hours after auction ends
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Helper function to generate slug from title
function generateSlug(title) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

// Indexes for common queries (slug and isVerified already have index: true in schema)
listingSchema.index({ status: 1, endDate: 1 }); // For active listings sorted by deadline
listingSchema.index({ category: 1, status: 1 });
listingSchema.index({ isFeatured: -1, createdAt: -1 }); // For featured listings
listingSchema.index({ currentPrice: 1, bidCount: 1 }); // For sorting

// Virtual for checking if auction is ending soon (within 24 hours)
listingSchema.virtual('endingSoon').get(function() {
  const now = new Date();
  const hoursUntilEnd = (this.endDate - now) / (1000 * 60 * 60);
  return hoursUntilEnd > 0 && hoursUntilEnd <= 24;
});

// Method to calculate time remaining
listingSchema.methods.getTimeRemaining = function() {
  const now = new Date();
  const remaining = this.endDate - now;
  
  if (remaining <= 0) {
    return { ended: true, days: 0, hours: 0, minutes: 0 };
  }
  
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  
  return { ended: false, days, hours, minutes, totalMs: remaining };
};

// Method to calculate end date from duration slot
listingSchema.methods.calculateEndDate = function(startDate) {
  const start = startDate || this.startDate || new Date();
  const durations = {
    '5 minutes': 5 * 60 * 1000,
    '2 hours': 2 * 60 * 60 * 1000,
    '24 hours': 24 * 60 * 60 * 1000,
    '3 days': 3 * 24 * 60 * 60 * 1000,
    '7 days': 7 * 24 * 60 * 60 * 1000
  };
  
  const duration = durations[this.durationSlot] || durations['7 days'];
  return new Date(start.getTime() + duration);
};

// Method to check if Private Room should be triggered
listingSchema.methods.checkPrivateRoomEligibility = async function() {
  if (this.auctionFormat !== 'highest-bid' || !this.allowPrivateRoom) {
    return false;
  }
  
  // Need at least 15 unique bidders
  const uniqueBiddersCount = this.uniqueBidders?.length || 0;
  return uniqueBiddersCount >= 15;
};

// Method to get Top 5 bidders for Private Room
listingSchema.methods.getTop5Bidders = async function() {
  const Bid = require('./Bid');
  const User = require('./User');
  
  // Get unique bidders with their highest bid amounts
  const bids = await Bid.aggregate([
    { $match: { listing: this._id } },
    {
      $group: {
        _id: '$bidder',
        maxBid: { $max: '$amount' },
        lastBidDate: { $max: '$createdAt' }
      }
    },
    { $sort: { maxBid: -1, lastBidDate: -1 } },
    { $limit: 5 }
  ]);
  
  // Populate bidders and get reputation scores (placeholder for now)
  const topBidders = await Promise.all(
    bids.map(async (bid) => {
      const user = await User.findById(bid._id).lean();
      return {
        bidder: user,
        maxBid: bid.maxBid,
        reputationScore: 0 // TODO: Add reputation system
      };
    })
  );
  
  return topBidders;
};

// Generate slug before saving if not provided
listingSchema.pre('save', async function(next) {
  // Generate slug from title if not provided
  if (!this.slug && this.title) {
    let baseSlug = generateSlug(this.title);
    let slug = baseSlug;
    let counter = 1;

    // Ensure uniqueness by appending counter if needed
    while (await this.constructor.findOne({ slug, _id: { $ne: this._id } })) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }
    this.slug = slug;
  }

  // Set end date from duration slot if not set
  if (this.durationSlot && !this.endDate) {
    this.endDate = this.calculateEndDate();
  }

  // Calculate commission rate based on Private Room setting
  if (this.auctionFormat === 'highest-bid') {
    this.commissionRate = this.allowPrivateRoom ? 0.02 : 0.005; // 2.0% or 0.5%
  } else if (this.auctionFormat === 'best-offer') {
    this.commissionRate = 0.005; // Always 0.5% for Best Offer
  }

  // Check if renewal is required (for listings >7 days)
  if (this.durationSlot === '7 days' || this.durationSlot === '3 days') {
    const daysSinceStart = (new Date() - this.startDate) / (1000 * 60 * 60 * 24);
    if (daysSinceStart > 7) {
      this.renewalRequired = true;
    }
  }

  // Update listingType based on flags
  if (this.isFeatured) {
    this.listingType = 'Promoted';
  } else if (this.isVerified) {
    this.listingType = 'Verified';
  } else {
    this.listingType = 'Standard';
  }
  next();
});

const Listing = mongoose.model('Listing', listingSchema);

module.exports = Listing;

