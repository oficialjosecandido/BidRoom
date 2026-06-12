const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true
    // index omitted: schema.index({ listing: 1 }, { unique: true }) below covers it
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
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
  /** Payment window: buyer must pay and seller should add bank details by this time (T+24h from creation) */
  paymentDeadline: {
    type: Date,
    default: null
  },
  /** Stripe Connect payment fields */
  stripeCheckoutSessionId: { type: String, trim: true, default: null, sparse: true },
  stripePaymentIntentId: { type: String, trim: true, default: null, sparse: true },
  /** BidRoom platform fee charged to buyer (2% of amount, in dollars) */
  bidRoomFeeAmount: { type: Number, default: null, min: 0 },
  /** Stripe processing fee deducted from seller payout (retrieved from Stripe BalanceTx, in dollars) */
  stripeFeeAmount: { type: Number, default: null, min: 0 },
  /** Total charged to buyer including BidRoom fee and shipping (in dollars) */
  buyerTotalPaid: { type: Number, default: null, min: 0 },
  /** Final payout to seller (amount - bidRoomFee - stripeFee, in dollars) */
  sellerPayoutAmount: { type: Number, default: null, min: 0 },
  /** Locked shipping cost for 'calculated' shipping (in dollars); set before checkout */
  shippingAmount: { type: Number, default: null, min: 0 },
  /** Carrier name for locked rate (e.g. 'USPS', 'UPS', 'FedEx') */
  shippingCarrier: { type: String, trim: true, default: null },
  /** Service level for locked rate (e.g. 'Priority Mail', 'Ground') */
  shippingService: { type: String, trim: true, default: null },
  /** EasyPost rate ID for the locked rate */
  shippingRateId: { type: String, trim: true, default: null },
  /** When the shipping rate was calculated/locked */
  shippingCalculatedAt: { type: Date, default: null },
  /** Estimated delivery days for the selected rate */
  shippingDeliveryDays: { type: Number, default: null },
  /** Buyer delivery address captured for calculated shipping */
  buyerDeliveryAddress: {
    street1: { type: String, trim: true, default: null },
    city: { type: String, trim: true, default: null },
    state: { type: String, trim: true, default: null },
    postalCode: { type: String, trim: true, default: null },
    country: { type: String, trim: true, default: 'US' }
  },
  /** Seller: optional proof of delivery (e.g. shipping receipt URL) when marking shipped */
  sellerProofOfDeliveryUrl: { type: String, trim: true, default: null },
  /**
   * Legacy handling deadline. Now mirrors shipByBusinessDeadline for backward compat.
   * Set by applyShippingDeadlinesFromPaidAt() when buyer payment is confirmed.
   */
  handlingDeadline: {
    type: Date,
    default: null
  },

  // ── Shipping Deadline Enforcement (5-business-day rule) ────────────
  /**
   * End of the 5th business day (Mon–Fri, UTC) after paidAt.
   * If the seller hasn't marked "shipped" by this time, the scheduler
   * auto-cancels the order and issues a full Stripe refund.
   * Computed by applyShippingDeadlinesFromPaidAt() in shippingDeadlines.js.
   */
  shipByBusinessDeadline: { type: Date, default: null },
  /**
   * Timestamp when the day-3 midpoint warning was sent to the seller.
   * Used by the scheduler to avoid sending duplicate warnings (idempotency).
   */
  shippingMidpointWarningSentAt: { type: Date, default: null },
  /**
   * Populated by the scheduler when the order is auto-cancelled for
   * non-shipment. Distinguishes auto-cancels from other cancel reasons.
   */
  shippingAutoCancelledAt: { type: Date, default: null },
  /** Overall transaction state */
  transactionStatus: {
    type: String,
    enum: ['pending_payment', 'awaiting_seller_acceptance', 'paid', 'shipped', 'delivered', 'under_dispute', 'completed', 'cancelled'],
    default: 'pending_payment',
    index: true
  },
  /** Whether the buyer has paid */
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid'],
    default: 'pending',
    index: true
  },
  /** Shipping state */
  sendingStatus: {
    type: String,
    enum: ['pending', 'shipped', 'delivered'],
    default: 'pending',
    index: true
  },
  /** @deprecated Use transactionStatus. Kept for backward compatibility with existing documents. */
  status: {
    type: String,
    enum: ['pending_payment', 'awaiting_seller_acceptance', 'paid', 'shipped', 'delivered', 'under_dispute', 'completed', 'cancelled'],
    default: null
  },
  /** Deadline for seller to accept payment (5 days from when buyer marks as paid) */
  paymentAcceptanceDeadline: { type: Date, default: null },
  paidAt: {
    type: Date,
    default: null
  },
  shippedAt: {
    type: Date,
    default: null
  },
  /** Computed when seller marks shipped: shippedAt + shippingDeliveryDays (or seller-provided days) */
  estimatedDeliveryDate: { type: Date, default: null },
  /** When buyer confirmed receipt */
  deliveredAt: { type: Date, default: null },
  /**
   * 5 days after estimatedDeliveryDate (or 14 days after shippedAt if no estimate).
   * Scheduler auto-completes the transaction if buyer hasn't confirmed by this time.
   */
  autoReleaseAt: { type: Date, default: null },
  /** Set by the scheduler when auto-release executes (idempotency guard). */
  autoReleaseExecutedAt: { type: Date, default: null },
  /** Return request (buyer, within 7 days of deliveredAt) */
  returnRequestedAt: { type: Date, default: null },
  returnReason: { type: String, trim: true, default: null },
  returnPhotoUrls: { type: [String], default: [] },
  returnStatus: {
    type: String,
    enum: ['pending_seller_response', 'accepted_by_seller', 'rejected_by_seller', 'platform_mediated'],
    default: null
  },
  /** 48 hours after returnRequestedAt — seller must respond before platform mediates */
  returnSellerDeadline: { type: Date, default: null },
  /** Explicit completion timestamp used for the 30-day review window */
  completedAt: {
    type: Date,
    default: null
  },
  /** Review reminder milestones already sent ('24h' | '48h' | '7d'). Prevents duplicates. */
  reviewRemindersSent: {
    type: [String],
    default: []
  },
  trackingNumber: {
    type: String,
    trim: true,
    default: null
  },
  trackingCarrier: {
    type: String,
    trim: true,
    default: null
  },
  notes: {
    type: String,
    trim: true,
    default: null
  },
  /** Payment method the buyer used: 'stripe' | 'in_person' | 'bank_transfer' | 'mbway' */
  paymentMethod: {
    type: String,
    enum: ['stripe', 'in_person', 'bank_transfer', 'mbway'],
    default: null
  },
  /** True when this transaction originated from a private room (affects payment window and non-payment rules) */
  isPrivateRoom: { type: Boolean, default: false, index: true },
  /** Why this transaction was cancelled (non_payment | seller_cancelled | auto_cancelled_no_shipment | ...) */
  cancellationReason: {
    type: String,
    enum: ['non_payment', 'seller_cancelled', 'auto_cancelled_no_shipment', 'other'],
    default: null
  },
  /** When a private-room winner fails to pay, the transaction is re-assigned to this buyer. Stores the original buyer's _id. */
  originalBuyerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
  /** When the buyer was re-assigned to a second-chance bidder */
  secondChanceAssignedAt: { type: Date, default: null },
  /** Whether a non-payment scheduler run has already processed this transaction (idempotency guard) */
  nonPaymentProcessedAt: { type: Date, default: null },
  /** Whether a warning notification has been sent to the buyer approaching the payment deadline */
  paymentDeadlineWarningSentAt: { type: Date, default: null },
  /** Whether a no-second-bidder notification was sent to the seller */
  noSecondBidderNotifiedAt: { type: Date, default: null },
  /** Whether a dispute has been opened for this transaction (visible to both parties) */
  disputeOpen: {
    type: Boolean,
    default: false,
    index: true
  },
  /** When the dispute was opened */
  disputeOpenedAt: { type: Date, default: null },
  /** Who opened the dispute: 'buyer' | 'seller' */
  disputeOpenedBy: { type: String, enum: ['buyer', 'seller'], default: null },
  /** Reason category code (item_not_as_described, damaged_in_transit, missing_parts, counterfeit, other) or legacy free text */
  disputeReason: { type: String, trim: true, default: null },
  /** Detailed explanation from the buyer */
  disputeExplanation: { type: String, trim: true, maxlength: 5000, default: null },
  /** Buyer's evidence: at least 3 photos OR 1 video */
  disputeBuyerMediaUrls: { type: [String], default: [] },
  /** Seller's counter-evidence (photos/docs) */
  disputeSellerCounterMediaUrls: { type: [String], default: [] },
  /** Admin verdict: buyer_refund | seller_payout | partial_refund */
  disputeAdminVerdict: { type: String, enum: ['buyer_refund', 'seller_payout', 'partial_refund'], default: null },
  /** Refund amount (for buyer_refund or partial_refund) */
  disputeRefundAmount: { type: Number, min: 0, default: null },
  /** Stripe refund ID returned after issuing a dispute refund via the API */
  stripeRefundId: { type: String, trim: true, default: null },
  /** When the admin issued the ruling */
  disputeRuledAt: { type: Date, default: null },
  /** Admin notes (internal) */
  disputeAdminNotes: { type: String, trim: true, maxlength: 2000, default: null },
  /** Stripe PaymentIntent ID for buyer compensation charge (seller_payout verdict, Tier 3 buyer) */
  disputeCompensationChargeId: { type: String, trim: true, default: null }
}, {
  timestamps: true
});

transactionSchema.index({ seller: 1, updatedAt: -1 });
transactionSchema.index({ buyer: 1, updatedAt: -1 });
transactionSchema.index({ listing: 1 }, { unique: true }); // One transaction per listing

// Covers the scheduler query: status + paidAt + shippingAutoCancelledAt
transactionSchema.index(
  { transactionStatus: 1, paidAt: 1, shippingAutoCancelledAt: 1 },
  { partialFilterExpression: { paidAt: { $type: 'date' } } }
);

module.exports = mongoose.model('Transaction', transactionSchema);
