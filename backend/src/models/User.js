const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  uid: {
    type: String,
    required: false,
    unique: true,
    sparse: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  isActive: {
    type: Boolean,
    default: true
  },
  emailVerified: {
    type: Boolean,
    default: false,
    index: true
  },
  hasDeposit: {
    type: Boolean,
    default: false,
    index: true
  },
  depositAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  lastLogin: {
    type: Date,
    default: null
  },
  // Stripe Connect
  stripeAccountId: {
    type: String,
    default: null,
    sparse: true,
    index: true
  },
  stripeAccountStatus: {
    type: String,
    enum: ['not_connected', 'pending', 'active'],
    default: 'not_connected'
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields
});

// Indexes are automatically created for unique fields

const User = mongoose.model('User', userSchema);

module.exports = User;
