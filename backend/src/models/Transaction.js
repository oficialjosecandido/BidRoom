const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true
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
  /** Set for auction (highest-bid) transactions */
  winnerBid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bid',
    required: false,
    default: null
  },
  /** Set for best-offer transactions when an offer is accepted */
  winnerOffer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Offer',
    required: false,
    default: null
  },
  /** Final price (winning bid amount) */
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  /** Payment window: buyer must pay by this time (T+24h from creation) */
  paymentDeadline: {
    type: Date,
    default: null
  },

  // ── Airwallex payment fields ──────────────────────────────────────────────
  /** Airwallex PaymentIntent ID */
  airwallexPaymentIntentId: { type: String, trim: true, default: null, sparse: true },
  /** Airwallex client_secret used by the frontend Elements */
  airwallexClientSecret: { type: String, trim: true, default: null },
  /** Airwallex transfer ID (platform commission split) */
  airwallexTransferId: { type: String, trim: true, default: null },
  /** Airwallex payout ID to seller */
  airwallexPayoutId: { type: String, trim: true, default: null },
  /** Airwallex refund ID (dispute) */
  airwallexRefundId: { type: String, trim: true, default: null },

  // ── Escrow ────────────────────────────────────────────────────────────────
  /** pending_inspection (T+3 hold after delivery) | released | refunded */
  escrowStatus: { type: String, enum: ['pending_inspection', 'released', 'refunded'], default: null },
  /** When the escrow window expires and payout can be triggered */
  escrowReleasesAt: { type: Date, default: null },

  // ── Financials ───────────────────────────────────────────────────────────
  /** BidRoom platform fee (2% of amount) */
  bidRoomFeeAmount: { type: Number, default: null, min: 0 },
  /** Total charged to buyer including BidRoom fee and shipping */
  buyerTotalPaid: { type: Number, default: null, min: 0 },
  /** Final payout to seller after fees */
  sellerPayoutAmount: { type: Number, default: null, min: 0 },

  // ── Shipping ─────────────────────────────────────────────────────────────
  shippingAmount: { type: Number, default: null, min: 0 },
  shippingCarrier: { type: String, trim: true, default: null },
  shippingService: { type: String, trim: true, default: null },
  shippingRateId: { type: String, trim: true, default: null },
  shippingCalculatedAt: { type: Date, default: null },
  shippingDeliveryDays: { type: Number, default: null },
  buyerDeliveryAddress: {
    street1: { type: String, trim: true, default: null },
    city: { type: String, trim: true, default: null },
    state: { type: String, trim: true, default: null },
    postalCode: { type: String, trim: true, default: null },
    country: { type: String, trim: true, default: 'US' }
  },
  sellerProofOfDeliveryUrl: { type: String, trim: true, default: null },
  handlingDeadline: { type: Date, default: null },

  // ── Status ───────────────────────────────────────────────────────────────
  transactionStatus: {
    type: String,
    // authorized = pre-auth hold placed on buyer's card (manual capture, 14-day window)
    enum: ['pending_payment', 'authorized', 'paid', 'shipped', 'delivered', 'under_dispute', 'completed', 'cancelled'],
    default: 'pending_payment',
    index: true
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'authorized', 'paid'],
    default: 'pending',
    index: true
  },
  sendingStatus: {
    type: String,
    enum: ['pending', 'shipped', 'delivered'],
    default: 'pending',
    index: true
  },
  /** @deprecated Use transactionStatus */
  status: {
    type: String,
    enum: ['pending_payment', 'authorized', 'paid', 'shipped', 'delivered', 'under_dispute', 'completed', 'cancelled'],
    default: null
  },

  /** When the pre-auth hold was confirmed (payment_intent.requires_capture webhook) */
  authorizedAt: { type: Date, default: null },
  /** When the hold expires — Airwallex pre-auth window (typically 14 days) */
  intentExpiresAt: { type: Date, default: null },
  /** When the PaymentIntent was captured (buyer clicked "Got the items") */
  capturedAt: { type: Date, default: null },
  /** When the 24h expiry warning was sent to buyer (prevents duplicate notifications) */
  holdExpiryWarningSentAt: { type: Date, default: null },

  paidAt: { type: Date, default: null },
  shippedAt: { type: Date, default: null },
  trackingNumber: { type: String, trim: true, default: null },
  trackingCarrier: { type: String, trim: true, default: null },
  notes: { type: String, trim: true, default: null },

  // ── Disputes ─────────────────────────────────────────────────────────────
  disputeOpen: { type: Boolean, default: false, index: true },
  disputeOpenedAt: { type: Date, default: null },
  disputeOpenedBy: { type: String, enum: ['buyer', 'seller'], default: null },
  disputeReason: { type: String, trim: true, default: null },
  disputeExplanation: { type: String, trim: true, maxlength: 5000, default: null },
  disputeBuyerMediaUrls: { type: [String], default: [] },
  disputeSellerCounterMediaUrls: { type: [String], default: [] },
  disputeAdminVerdict: { type: String, enum: ['buyer_refund', 'seller_payout', 'partial_refund'], default: null },
  disputeRefundAmount: { type: Number, min: 0, default: null },
  disputeRuledAt: { type: Date, default: null },
  disputeAdminNotes: { type: String, trim: true, maxlength: 2000, default: null }
}, {
  timestamps: true
});

transactionSchema.index({ seller: 1, updatedAt: -1 });
transactionSchema.index({ buyer: 1, updatedAt: -1 });
transactionSchema.index({ listing: 1 }, { unique: true });

module.exports = mongoose.model('Transaction', transactionSchema);
