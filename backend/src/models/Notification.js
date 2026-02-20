const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  message: {
    type: String,
    required: true,
    maxlength: 500
  },
  /** Short title for list display (e.g. "New proposal") */
  title: {
    type: String,
    required: true,
    maxlength: 120
  },
  /** Type of notification for grouping/filtering */
  type: {
    type: String,
    required: true,
    enum: ['proposal', 'bid', 'auction_ended', 'transaction', 'dispute', 'review', 'listing', 'watchlist', 'private_room', 'shipping', 'account', 'security', 'system'],
    default: 'system',
    index: true
  },
  /** Link to navigate when clicked (e.g. "/listing/slug?tab=offers") */
  link: {
    type: String,
    default: null,
    maxlength: 500
  },
  /** Reference to related entity for deduplication (e.g. offerId, listingId) */
  referenceId: {
    type: String,
    default: null,
    index: true
  },
  status: {
    type: String,
    enum: ['unread', 'read'],
    default: 'unread',
    index: true
  },
  issuedAt: {
    type: Date,
    default: () => new Date(),
    index: true
  },
  readAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

notificationSchema.index({ user: 1, issuedAt: -1 });
notificationSchema.index({ user: 1, status: 1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
