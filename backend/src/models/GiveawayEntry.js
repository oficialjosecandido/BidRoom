const mongoose = require('mongoose');

/**
 * One entry in one giveaway.
 *
 * Entry is free and can never be paid for — that is what keeps a giveaway a
 * promotional contest rather than a lottery, so there is deliberately nothing
 * in this document that could record a payment, a purchase, or a weighting.
 * Every entry is worth exactly one chance.
 *
 * The same person may hold several entries (each is one chance in the draw),
 * but not more often than once per hour — that rate limit lives in
 * giveawayService, not in a unique index, so a second entry after the cooldown
 * is a new document with a new serial number.
 *
 * The entry is also the participant's receipt. `entryNumber` is shown to them
 * and announced publicly when the draw happens, so it is how they can check
 * for themselves that the number drawn was a real one and whether it was
 * theirs.
 */
const giveawayEntrySchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true
  },
  participant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  /**
   * The sequential serial number issued to this entry (1, 2, 3, …).
   *
   * Allocated from Listing.giveaway.entryCount with an atomic $inc, so it is
   * unique within a giveaway even under simultaneous entries.
   */
  entryNumber: {
    type: Number,
    required: true,
    min: 1
  }
}, { timestamps: true });

/** Latest entry per person (cooldown check) and Nexus listing of a person's numbers. */
giveawayEntrySchema.index({ listing: 1, participant: 1, createdAt: -1 });

/** Ordered listing for the admin view, and the lookup the draw does. */
giveawayEntrySchema.index({ listing: 1, entryNumber: 1 }, { unique: true });

module.exports = mongoose.model('GiveawayEntry', giveawayEntrySchema);
