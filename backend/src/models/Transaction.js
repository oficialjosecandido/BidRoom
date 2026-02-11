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
  /** Seller bank details (for this transaction only); visible to buyer for transfer */
  sellerBankIban: { type: String, trim: true, default: null },
  sellerBankSwift: { type: String, trim: true, default: null },
  sellerBankAccountName: { type: String, trim: true, default: null },
  /** Buyer: optional proof of payment (e.g. receipt/screenshot URL) when marking paid */
  buyerProofOfPaymentUrl: { type: String, trim: true, default: null },
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
    enum: ['pending_payment', 'paid', 'shipped', 'delivered', 'completed', 'cancelled'],
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
    enum: ['pending_payment', 'paid', 'shipped', 'delivered', 'completed', 'cancelled'],
    default: null
  },
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
  /** Optional reason/description when opening a dispute */
  disputeReason: { type: String, trim: true, default: null }
}, {
  timestamps: true
});

transactionSchema.index({ seller: 1, updatedAt: -1 });
transactionSchema.index({ buyer: 1, updatedAt: -1 });
transactionSchema.index({ listing: 1 }, { unique: true }); // One transaction per listing

module.exports = mongoose.model('Transaction', transactionSchema);
