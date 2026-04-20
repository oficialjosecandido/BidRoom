const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: false,
    unique: true,
    sparse: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
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
  isActive: {
    type: Boolean,
    default: true
  },
  /** Account status: active (normal), suspended (dispute open), closed (permanent) */
  accountStatus: {
    type: String,
    enum: ['active', 'suspended', 'closed'],
    default: 'active',
    index: true
  },
  emailVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  hasDeposit: {
    type: Boolean,
    default: false,
    index: true
  },
  depositAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastLogin: {
    type: Date,
    default: null
  },
  /** Reputation: 0-100, cached; recalculated on review/dispute */
  reputationScore: {
    type: Number,
    default: 100,
    min: 0,
    max: 100,
    index: true
  },
  /** Count of disputes where user was ruled against (fraud or at fault) */
  disputeLossCount: {
    type: Number,
    default: 0,
    min: 0
  },
  /** Count of completed transactions (successful, no dispute loss) */
  successfulTransactionCount: {
    type: Number,
    default: 0,
    min: 0
  },
  /** When reputation was last recalculated */
  reputationUpdatedAt: {
    type: Date,
    default: null
  },
  /** Stripe Connect Express account ID (acct_xxx); set when seller starts onboarding */
  stripeConnectAccountId: {
    type: String,
    default: null,
    sparse: true,
    index: true
  },
  /** Whether the seller has completed Stripe Connect onboarding (KYC + bank account) */
  stripeConnectOnboarded: {
    type: Boolean,
    default: false,
    index: true
  },
  /**
   * IDs of transactions with an open dispute that restrict this user from initiating NEW marketplace
   * actions (bidding, listing, making offers). Existing transactions are NOT affected.
   * Populated on dispute open; entries removed when each dispute is resolved by admin.
   */
  activeDisputeTransactionIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  }]
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Indexes are automatically created for unique fields

const User = mongoose.model('User', userSchema);

module.exports = User;
