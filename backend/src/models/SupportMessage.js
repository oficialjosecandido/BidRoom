const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportConversation', required: true, index: true },
  senderType:   { type: String, enum: ['customer', 'agent', 'system'], required: true },
  senderUid:    { type: String, default: null },
  senderName:   { type: String, default: '' },
  body:         { type: String, required: true, maxlength: 5000 },
  readByRecipient: { type: Boolean, default: false },
  systemEventType: { type: String, default: null },
}, { timestamps: true });

supportMessageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
