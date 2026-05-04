const mongoose = require('mongoose');

/**
 * DamageClaim — created when a buyer reports an item damaged in transit.
 *
 * shippingType is derived at claim-creation time:
 *   'platform_label'    — shippingRateId was set (EasyPost-coordinated); BidRoom files the carrier claim.
 *   'external_shipping' — seller managed shipping independently; seller is claim owner.
 *
 * Status flow (platform_label):
 *   pending_review → approved_refund | packaging_rejected → carrier_claim_filed → resolved
 *
 * Status flow (external_shipping):
 *   pending_review → closed  (platform mediates only; outcome handled between parties)
 */
const damageClaimSchema = new mongoose.Schema({
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true,
    unique: true
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true
  },
  /** Derived from transaction.shippingRateId at claim creation time */
  shippingType: {
    type: String,
    enum: ['platform_label', 'external_shipping'],
    required: true
  },
  status: {
    type: String,
    enum: [
      'pending_review',
      'approved_refund',
      'packaging_rejected',
      'carrier_claim_filed',
      'resolved',
      'closed'
    ],
    default: 'pending_review',
    index: true
  },
  /** Buyer's photos of the damaged item (min 1 required) */
  damagePhotoUrls: {
    type: [String],
    required: true,
    validate: {
      validator: (v) => Array.isArray(v) && v.length >= 1,
      message: 'At least one damage photo is required.'
    }
  },
  /** Buyer's photos of the packaging (min 1 required) */
  packagingPhotoUrls: {
    type: [String],
    required: true,
    validate: {
      validator: (v) => Array.isArray(v) && v.length >= 1,
      message: 'At least one packaging photo is required.'
    }
  },
  /** Buyer's description of the damage */
  description: {
    type: String,
    trim: true,
    maxlength: 3000,
    default: null
  },
  /** Set by admin after reviewing packaging photos. null = not yet reviewed. */
  packagingCompliant: {
    type: Boolean,
    default: null
  },
  /** Internal admin notes */
  adminNotes: {
    type: String,
    trim: true,
    maxlength: 3000,
    default: null
  },
  /** Carrier claim reference number once filed with the carrier */
  carrierClaimReference: {
    type: String,
    trim: true,
    default: null
  },
  carrierClaimFiledAt: { type: Date, default: null },
  /** Refund amount issued to buyer (in dollars) */
  refundAmount: { type: Number, min: 0, default: null },
  refundedAt: { type: Date, default: null },
  /** Compensation paid back to seller (platform absorbs if packaging non-compliant) */
  sellerCompensationAmount: { type: Number, min: 0, default: null },
  sellerCompensatedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null }
}, {
  timestamps: true,
  collection: 'damage_claims'
});

damageClaimSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('DamageClaim', damageClaimSchema);
