const mongoose = require('mongoose');

/**
 * One row per recipient per send. Two things depend on it:
 *
 *  - "how many emails has this contact received" on the contacts list, and
 *  - open tracking: each row carries a random token embedded in a 1x1 pixel,
 *    so an open can be attributed to a specific person and counted once.
 *
 * The token is random rather than the document id — the pixel URL is public,
 * and sequential ObjectIds would let anyone enumerate other people's opens.
 */
const emailDeliverySchema = new mongoose.Schema(
  {
    campaign: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EmailCampaign',
      required: true,
      index: true
    },

    recipientType: { type: String, enum: ['customer', 'interested'], required: true },

    /** Customer or InterestedContact id. Null only if the address had no record. */
    recipient: { type: mongoose.Schema.Types.ObjectId, default: null },

    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    language: { type: String, enum: ['en', 'pt', 'es', 'fr'], default: 'en' },

    status: { type: String, enum: ['sent', 'failed'], required: true },
    /** Provider/SMTP message for a failed send, for debugging a bad address. */
    error: { type: String, default: null },

    trackingToken: { type: String, required: true, unique: true, index: true },

    /** First open. Kept separate from lastOpenedAt so "unique opens" is a
     *  simple count of rows where this is set. */
    openedAt: { type: Date, default: null },
    lastOpenedAt: { type: Date, default: null },
    openCount: { type: Number, default: 0 }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

// "Emails received by this contact", the contacts-list column.
emailDeliverySchema.index({ recipientType: 1, recipient: 1, status: 1 });
// Fallback lookup for contacts whose id was not resolved at send time.
emailDeliverySchema.index({ email: 1, status: 1 });
// Per-campaign open rollups.
emailDeliverySchema.index({ campaign: 1, status: 1 });

module.exports = mongoose.model('EmailDelivery', emailDeliverySchema);
