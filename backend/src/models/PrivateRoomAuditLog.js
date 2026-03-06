const mongoose = require('mongoose');

/**
 * Audit log for private room events (seller left, no acceptances, etc.)
 * Used for compliance and debugging.
 */
const privateRoomAuditLogSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true
  },
  event: {
    type: String,
    enum: ['seller_left', 'no_acceptances', 'time_expired'],
    required: true,
    index: true
  },
  /** Mongo User _id of seller (for seller_left) */
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  /** Firebase UID of seller (for seller_left) */
  sellerUid: {
    type: String,
    default: null
  },
  /** Count of bids in the private room at time of closure (for audit) */
  bidCountAtClosure: {
    type: Number,
    default: 0
  },
  /** Highest bid amount at closure (for audit) */
  highestBidAtClosure: {
    type: Number,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

privateRoomAuditLogSchema.index({ listing: 1, createdAt: -1 });
privateRoomAuditLogSchema.index({ event: 1, createdAt: -1 });

const PrivateRoomAuditLog = mongoose.model('PrivateRoomAuditLog', privateRoomAuditLogSchema);
module.exports = PrivateRoomAuditLog;
