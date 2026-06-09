const mongoose = require('mongoose');

const followSchema = new mongoose.Schema(
  {
    follower: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    following: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    muted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

followSchema.index({ follower: 1, following: 1 }, { unique: true });
followSchema.index({ following: 1, muted: 1 });

module.exports = mongoose.model('Follow', followSchema);
