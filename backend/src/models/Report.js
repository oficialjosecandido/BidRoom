const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reportType: {
    type: String,
    enum: ['listing', 'user'],
    required: true,
    index: true
  },
  targetId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  reason: {
    type: String,
    enum: ['fraud_scam', 'offensive_content', 'prohibited_item', 'spam', 'off_platform_transaction', 'other'],
    required: true
  },
  description: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'reviewed', 'resolved', 'dismissed'],
    default: 'pending',
    index: true
  },
  adminNotes: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: null
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null
  },
  resolvedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// One report per user per target
reportSchema.index({ reportedBy: 1, reportType: 1, targetId: 1 }, { unique: true });

const Report = mongoose.model('Report', reportSchema);

module.exports = Report;
