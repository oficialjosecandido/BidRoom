const mongoose = require('mongoose');
const { Schema } = mongoose;

const fraudEventSchema = new Schema({
  type: {
    type: String,
    // The last three are vehicle compliance rather than bidding fraud, but they
    // want exactly what this model already provides — a typed, severity-graded
    // entry an admin works through and marks resolved — so they live here
    // instead of in a second, parallel review queue.
    enum: [
      'rate_limit', 'bot_pattern', 'shill_bid', 'multi_account', 'velocity',
      'undeclared_professional', 'aml_repeat_winner', 'aml_new_seller_high_value'
    ],
    required: true,
    index: true
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium',
    index: true
  },
  /** The user who triggered the event (bidder) */
  userId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
  /** The other party (e.g. seller in a shill-bid event) */
  targetUserId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  listingId: { type: Schema.Types.ObjectId, ref: 'Listing', default: null },
  bidId: { type: Schema.Types.ObjectId, ref: 'Bid', default: null },
  ipAddress: { type: String, default: null },
  deviceFingerprint: { type: String, default: null },
  /** Structured details explaining why the event was triggered */
  details: { type: Schema.Types.Mixed, default: {} },
  /** Whether an admin has reviewed and resolved this event */
  resolved: { type: Boolean, default: false, index: true },
  /**
   * Who closed it, when, and why.
   *
   * The compliance flags are a defence: if a regulator asks whether BidRoom
   * noticed a pattern, "resolved: true" answers nothing on its own. These
   * record that a named person looked and what they concluded.
   */
  resolvedAt: { type: Date, default: null },
  resolvedByEmail: { type: String, trim: true, default: null },
  resolutionNote: { type: String, trim: true, maxlength: 2000, default: null }
}, { timestamps: true });

fraudEventSchema.index({ createdAt: -1 });
fraudEventSchema.index({ type: 1, resolved: 1, createdAt: -1 });

module.exports = mongoose.model('FraudEvent', fraudEventSchema);
