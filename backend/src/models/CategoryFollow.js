const mongoose = require('mongoose');

const categoryFollowSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    category: { type: String, required: true, trim: true }
  },
  { timestamps: true }
);

categoryFollowSchema.index({ user: 1, category: 1 }, { unique: true });
categoryFollowSchema.index({ category: 1 });

module.exports = mongoose.model('CategoryFollow', categoryFollowSchema);
