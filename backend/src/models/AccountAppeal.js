const mongoose = require('mongoose');

const accountAppealSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  /** The reason the account is restricted — stored for context. */
  restrictionType: {
    type: String,
    enum: ['content_restriction', 'suspended', 'other'],
    default: 'content_restriction'
  },
  /** Date when the restriction expires/applied — stored from the user record at submission time. */
  restrictedUntil: { type: Date, default: null },
  /** The seller's explanation / appeal message. */
  message: { type: String, required: true, maxlength: 2000 },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  adminResponse: { type: String, default: '' },
  reviewedByEmail: { type: String, default: null },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

// Only one pending appeal per user at a time
accountAppealSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model('AccountAppeal', accountAppealSchema);
