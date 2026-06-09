const mongoose = require('mongoose');

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
    unique: true,
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
  /** Count of private-room payment windows missed (used for repeat-offender enforcement) */
  nonPaymentCount: {
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
  /** Seller payout IBAN (normalized, no spaces). Set on Connect onboarding submit. */
  sellerPayoutIban: {
    type: String,
    default: null,
    trim: true
  },
  sellerPayoutIbanUpdatedAt: {
    type: Date,
    default: null
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
  emailUnsubscribeToken: { type: String, default: null, sparse: true, index: true },
  // ─── DSA / trader transparency (seller classification) ───────────────────
  /** `private` = non-trader; `professional` = trader — extra identity fields required */
  sellerClassification: {
    type: String,
    enum: ['private', 'professional'],
    default: 'private',
    index: true
  },
  /** Admin verification of professional trader details */
  professionalVerificationStatus: {
    type: String,
    enum: ['none', 'pending', 'verified', 'rejected'],
    default: 'none',
    index: true
  },
  professionalLegalName: { type: String, trim: true, maxlength: 300, default: null },
  professionalTradeName: { type: String, trim: true, maxlength: 300, default: null },
  professionalAddressLine1: { type: String, trim: true, maxlength: 300, default: null },
  professionalAddressLine2: { type: String, trim: true, maxlength: 300, default: null },
  professionalCity: { type: String, trim: true, maxlength: 120, default: null },
  professionalRegion: { type: String, trim: true, maxlength: 120, default: null },
  professionalPostalCode: { type: String, trim: true, maxlength: 32, default: null },
  professionalCountry: { type: String, trim: true, maxlength: 2, uppercase: true, default: null },
  professionalContactPhone: { type: String, trim: true, maxlength: 40, default: null },
  /** Business contact email shown to buyers (may match account email) */
  professionalContactEmail: { type: String, trim: true, maxlength: 254, lowercase: true, default: null },
  /** VAT / tax identification number */
  professionalVatId: { type: String, trim: true, maxlength: 64, default: null },
  professionalSubmittedAt: { type: Date, default: null },
  professionalVerifiedAt: { type: Date, default: null },
  professionalVerifiedByEmail: { type: String, trim: true, default: null },
  professionalRejectionNote: { type: String, trim: true, maxlength: 1000, default: null },
  // ─── Identity verification (KYC) ─────────────────────────────────────────
  kycStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected'],
    default: 'none',
    index: true
  },
  kycVerifiedAt: { type: Date, default: null },
  kycStripeSessionId: { type: String, default: null },
  kycRejectionReason: { type: String, default: null },
  kycSubmittedAt: { type: Date, default: null },

  // ─── Buyer payment methods (Tier 3 trust & dispute compensation) ─────────
  stripeCustomerId: { type: String, default: null, trim: true, sparse: true },
  /** Denormalised default PM — kept in sync with savedPaymentMethods for legacy reads */
  savedPaymentMethodId: { type: String, default: null, trim: true },
  savedPaymentMethodBrand: { type: String, default: null, trim: true },
  savedPaymentMethodLast4: { type: String, default: null, trim: true },
  savedPaymentMethodExpiry: { type: String, default: null, trim: true },
  savedPaymentMethods: [{
    stripePaymentMethodId: { type: String, required: true, trim: true },
    brand: { type: String, default: 'unknown', trim: true },
    last4: { type: String, default: null, trim: true },
    expiry: { type: String, default: null, trim: true },
    isDefault: { type: Boolean, default: false },
    addedAt: { type: Date, default: Date.now },
  }],

  // ─── DSA Article 29 compliance monitoring ────────────────────────────────
  /** When the platform first issued a DSA threshold-exceeded warning to this seller */
  dsaWarningIssuedAt: { type: Date, default: null, index: true },
  /** When the seller acknowledged the warning via the dashboard banner */
  dsaWarningAcknowledgedAt: { type: Date, default: null },
  /** Seller's declared response: stay private or switch to professional */
  dsaWarningResponse: {
    type: String,
    enum: ['remain_private', 'switch_professional', null],
    default: null
  },
  /** Flagged internally when seller exceeds thresholds and refuses to switch after grace period */
  suspectedProfessional: { type: Boolean, default: false, index: true },
  /** Whether listing creation is restricted pending DSA compliance resolution */
  dsaListingRestricted: { type: Boolean, default: false, index: true },

  /** Public profile slug derived from firstName+lastName, used in profile URLs (/seller/:slug) */
  slug: {
    type: String,
    unique: true,
    sparse: true,
    index: true,
    lowercase: true,
    trim: true
  },

  // ─── Deferred suspension ─────────────────────────────────────────────────
  /** True when a suspension has been queued but not yet applied (user has active auction) */
  suspensionPending: { type: Boolean, default: false, index: true },
  suspensionPendingMeta: {
    reason: { type: String, default: null },
    triggeredBy: { type: String, default: null },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    queuedAt: { type: Date, default: null }
  }
}, {
  timestamps: true,
  collection: 'customers'
});

function buildSlugBase(firstName, lastName) {
  return ((firstName || '') + (lastName || ''))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') || 'user';
}

async function generateUniqueSlug(base, excludeId = null) {
  let candidate = base;
  let i = 2;
  const query = excludeId ? { slug: candidate, _id: { $ne: excludeId } } : { slug: candidate };
  while (await Customer.exists({ ...query, slug: candidate })) {
    candidate = `${base}${i++}`;
  }
  return candidate;
}

customerSchema.pre('save', async function (next) {
  if (!this.slug && this.firstName && this.lastName) {
    const base = buildSlugBase(this.firstName, this.lastName);
    this.slug = await generateUniqueSlug(base, this._id);
  }
  next();
});

// Virtual: buyer trust tier (computed, never stored)
customerSchema.virtual('buyerTrustTier').get(function () {
  if (this.kycStatus === 'approved' && this.savedPaymentMethodId) return 3;
  if (this.kycStatus === 'approved') return 2;
  if (this.emailVerified) return 1;
  return 0;
});

const Customer = mongoose.model('Customer', customerSchema);

Customer.buildSlugBase = buildSlugBase;
Customer.generateUniqueSlug = generateUniqueSlug;

module.exports = Customer;
