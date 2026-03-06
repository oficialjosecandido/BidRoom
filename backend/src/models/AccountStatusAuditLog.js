const mongoose = require('mongoose');

/**
 * Audit log for account status changes (suspended, reactivated, closed).
 * Used for compliance and dispute resolution tracking.
 */
const accountStatusAuditLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  previousStatus: {
    type: String,
    enum: ['active', 'suspended', 'closed'],
    default: null
  },
  newStatus: {
    type: String,
    enum: ['active', 'suspended', 'closed'],
    required: true,
    index: true
  },
  /** Reason: dispute_opened, dispute_resolved_reactivate_both, etc. */
  reason: {
    type: String,
    required: true,
    index: true
  },
  /** Related transaction (for dispute-related changes) */
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  },
  /** Admin who performed the action (for ruling) */
  performedBy: {
    type: String,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

accountStatusAuditLogSchema.index({ user: 1, createdAt: -1 });
accountStatusAuditLogSchema.index({ reason: 1, createdAt: -1 });

const AccountStatusAuditLog = mongoose.model('AccountStatusAuditLog', accountStatusAuditLogSchema);
module.exports = AccountStatusAuditLog;
