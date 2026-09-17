const mongoose = require('mongoose');

/**
 * One person's entry in one giveaway.
 *
 * Entry is free and can never be paid for — that is what keeps a giveaway a
 * promotional contest rather than a lottery, so there is deliberately nothing
 * in this document that could record a payment, a purchase, or a weighting.
 * Every entry is worth exactly one chance, and the schema is what guarantees
 * it: one document per person per giveaway, one number each.
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

/**
 * One entry per person per giveaway.
 *
 * This is the fairness guarantee, enforced by the database rather than by the
 * route: even a client that replays the request cannot buy itself a second
 * chance. The route's friendly "you are already entered" response is only a
 * nicer way of saying what this index would say anyway.
 */
giveawayEntrySchema.index({ listing: 1, participant: 1 }, { unique: true });

/** Ordered listing for the admin view, and the lookup the draw does. */
giveawayEntrySchema.index({ listing: 1, entryNumber: 1 }, { unique: true });

module.exports = mongoose.model('GiveawayEntry', giveawayEntrySchema);
