const mongoose = require('mongoose');

const watchlistSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true
  },
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true
  }
}, {
  timestamps: true
});

// One entry per user per listing
watchlistSchema.index({ user: 1, listing: 1 }, { unique: true });

const Watchlist = mongoose.model('Watchlist', watchlistSchema);

module.exports = Watchlist;
