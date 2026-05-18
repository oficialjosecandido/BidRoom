const mongoose = require('mongoose');

/**
 * Append-only audit trail for moderation and DSA-relevant seller actions.
 * Supports internal review and lawful authority requests.
 */
const moderationAuditLogSchema = new mongoose.Schema({
  subjectUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  actionType: {
    type: String,
    required: true,
    maxlength: 80,
    index: true
  },
  /** Admin user id when action is manual; null for automated/system */
  performedByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  performedByEmail: {
    type: String,
    trim: true,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ip: { type: String, trim: true, default: null }
}, {
  timestamps: true
});

moderationAuditLogSchema.index({ createdAt: -1 });
moderationAuditLogSchema.index({ actionType: 1, createdAt: -1 });

module.exports = mongoose.model('ModerationAuditLog', moderationAuditLogSchema);
