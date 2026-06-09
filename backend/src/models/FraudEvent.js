const mongoose = require('mongoose');
const { Schema } = mongoose;

const fraudEventSchema = new Schema({
  type: {
    type: String,
    enum: ['rate_limit', 'bot_pattern', 'shill_bid', 'multi_account', 'velocity'],
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
  resolved: { type: Boolean, default: false, index: true }
}, { timestamps: true });

fraudEventSchema.index({ createdAt: -1 });
fraudEventSchema.index({ type: 1, resolved: 1, createdAt: -1 });

module.exports = mongoose.model('FraudEvent', fraudEventSchema);
