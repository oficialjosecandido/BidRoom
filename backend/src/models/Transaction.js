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
  /** Seller: optional proof of delivery (e.g. shipping receipt URL) when marking shipped */
  sellerProofOfDeliveryUrl: { type: String, trim: true, default: null },
  /** When seller must ship by (paidAt or payment deadline + listing handling time); used for Phase 2 */
  handlingDeadline: {
    type: Date,
    default: null
  },
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
  /** When the admin issued the ruling */
  disputeRuledAt: { type: Date, default: null },
  /** Admin notes (internal) */
  disputeAdminNotes: { type: String, trim: true, maxlength: 2000, default: null }
}, {
  timestamps: true
});

transactionSchema.index({ seller: 1, updatedAt: -1 });
transactionSchema.index({ buyer: 1, updatedAt: -1 });
transactionSchema.index({ listing: 1 }, { unique: true }); // One transaction per listing

module.exports = mongoose.model('Transaction', transactionSchema);
