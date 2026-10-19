const mongoose = require('mongoose');

const supportAttachmentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  contentType: { type: String, default: 'image/jpeg' },
}, { _id: false });

const supportMessageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportConversation', required: true, index: true },
  senderType:   { type: String, enum: ['customer', 'agent', 'system'], required: true },
  senderUid:    { type: String, default: null },
  senderName:   { type: String, default: '' },
  // Empty allowed when the agent attaches images (image-only replies).
  body:         { type: String, default: '', maxlength: 5000 },
  attachments:  { type: [supportAttachmentSchema], default: [] },
  readByRecipient: { type: Boolean, default: false },
  systemEventType: { type: String, default: null },
}, { timestamps: true });

supportMessageSchema.index({ conversation: 1, createdAt: 1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
