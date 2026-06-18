const mongoose = require('mongoose');

const supportConversationSchema = new mongoose.Schema({
  customer:    { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  customerUid: { type: String, required: true, index: true },
  status: {
    type: String,
    enum: ['open', 'pending_customer', 'pending_agent', 'resolved', 'closed'],
    default: 'open',
    index: true,
  },
  category: {
    type: String,
    enum: ['payment', 'shipping', 'dispute', 'account', 'listing', 'other'],
    default: 'other',
  },
  relatedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  relatedListing:     { type: mongoose.Schema.Types.ObjectId, ref: 'Listing',      default: null },
  assignedAgent:    { type: String, default: null },
  subject:          { type: String, maxlength: 200, default: '' },
  lastMessageAt:    { type: Date, default: Date.now, index: true },
  lastMessageBy:    { type: String, enum: ['customer', 'agent', 'system'], default: 'customer' },
  unreadByAgent:    { type: Number, default: 0 },
  unreadByCustomer: { type: Number, default: 0 },
  resolvedAt: { type: Date, default: null },
  closedAt:   { type: Date, default: null },
}, { timestamps: true });

supportConversationSchema.index({ status: 1, lastMessageAt: -1 });

module.exports = mongoose.model('SupportConversation', supportConversationSchema);
