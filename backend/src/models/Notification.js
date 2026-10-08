const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  /**
   * English rendering of the notification, kept for two reasons: every
   * notification written before localization existed has only this, and
   * anything server-side that reads a notification back (push, digests) has
   * no i18n catalogue to resolve a key against.
   *
   * It is a fallback, not the source of truth — see `i18nKey`.
   */
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
  /**
   * The i18n key the client renders this notification from, without the
   * `.title`/`.message` suffix (e.g. `notifications.newBid`).
   *
   * Notifications are localized when they are READ, not when they are
   * written: a notification list is live UI that the same person re-reads,
   * so it has to follow them when they change language. (An email is the
   * opposite — a snapshot in an inbox — which is why emails are rendered in
   * the recipient's language at send time instead.) Storing the key also
   * keeps the fan-out notifiers free of a per-recipient language lookup.
   *
   * Null on notifications written before this existed; the client then falls
   * back to `title`/`message`.
   */
  i18nKey: {
    type: String,
    default: null,
    maxlength: 120
  },
  /**
   * Values to interpolate into the localized strings, by placeholder name.
   *
   * A value of the shape `{ t: 'some.key' }` is itself a key to translate,
   * which is how a stand-in for missing data ("your listing") reaches the
   * reader in their own language instead of in English.
   */
  i18nParams: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  /** Type of notification for grouping/filtering */
  type: {
    type: String,
    required: true,
    enum: ['proposal', 'bid', 'auction_ended', 'transaction', 'dispute', 'review', 'listing', 'watchlist', 'follow', 'private_room', 'shipping', 'account', 'security', 'system'],
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
