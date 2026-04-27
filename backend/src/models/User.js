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
  }],
  /** Number of content policy violations (sharing contact info in listings/messages) */
  contentViolationCount: {
    type: Number,
    default: 0,
    min: 0
  },
  /** Temporary restriction end date from content violations; null if not restricted */
  contentRestrictedUntil: {
    type: Date,
    default: null
  },
  /** Known IP addresses seen from this account (last 20, most recent first) */
  knownIPs: {
    type: [{ ip: String, lastSeen: Date }],
    default: []
  },
  /** Known device fingerprints seen from this account (last 10) */
  knownFingerprints: {
    type: [{ fingerprint: String, lastSeen: Date }],
    default: []
  },
  /** Fraud risk score 0–100; raised by fraud events, decays over time */
  fraudScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  /** Whether this account is flagged as a fraud suspect requiring admin review */
  isFraudSuspect: {
    type: Boolean,
    default: false,
    index: true
  },
  /** Brute-force login protection */
  loginFailedAttempts: { type: Number, default: 0 },
  loginLockedUntil: { type: Date, default: null },
  /** Opaque token used to unsubscribe from all emails without login (generated on first use) */
  emailUnsubscribeToken: { type: String, default: null, sparse: true, index: true }
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Indexes are automatically created for unique fields

const User = mongoose.model('User', userSchema);

module.exports = User;
