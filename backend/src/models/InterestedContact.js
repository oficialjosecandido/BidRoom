const mongoose = require('mongoose');

/**
 * Manually curated list of "interested" email addresses (not platform customers)
 * that admins can target with newsletter campaigns.
 */
const interestedContactSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true
  },
  name: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('InterestedContact', interestedContactSchema);
