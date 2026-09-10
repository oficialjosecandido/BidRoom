const mongoose = require('mongoose');

/**
 * One row per admin email send — a newsletter campaign to an audience, or a
 * one-off personalized email. Written after the send completes so the admin
 * Emails page can show a history instead of the send being fire-and-forget.
 *
 * The per-recipient rows live in EmailDelivery and carry the open tracking.
 */
const emailCampaignSchema = new mongoose.Schema(
  {
    /** newsletter = multi-language blast; the other two go to a single person. */
    kind: {
      type: String,
      enum: ['newsletter', 'personalized', 'draft-reminder'],
      required: true,
      index: true
    },

    /** Audience selector used for a newsletter; null for one-off sends. */
    audience: {
      type: String,
      enum: ['all_contacts', 'all_users', 'interested', null],
      default: null
    },

    /** Human-readable label for the history list — the Portuguese subject for a
     *  newsletter, the actual subject for a one-off. */
    subject: { type: String, required: true, trim: true },

    /** Full per-language payload of a newsletter ({ pt: {subject, html}, … }),
     *  kept so a campaign can be reviewed or reused later. */
    content: { type: mongoose.Schema.Types.Mixed, default: null },

    /**
     * ISO week and year, computed at send time. Stored rather than derived on
     * read so a campaign keeps the week it was actually sent in, and so the
     * history can be grouped without recomputing dates on every request.
     */
    isoWeek: { type: Number, required: true },
    isoYear: { type: Number, required: true },

    totalRecipients: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },

    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
    sentByEmail: { type: String, default: null, trim: true }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

emailCampaignSchema.index({ createdAt: -1 });
emailCampaignSchema.index({ isoYear: -1, isoWeek: -1 });

module.exports = mongoose.model('EmailCampaign', emailCampaignSchema);
