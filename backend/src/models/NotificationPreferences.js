const mongoose = require('mongoose');

const channelSchema = {
  email: { type: Boolean, default: true },
  push: { type: Boolean, default: true },
  inApp: { type: Boolean, default: true }
};

const notificationPreferencesSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    unique: true,
    index: true
  },
  globalEmailUnsubscribed: { type: Boolean, default: false },
  outbid: { type: channelSchema, default: () => ({}) },
  auctionEndingSoon: { type: channelSchema, default: () => ({}) },
  auctionWon: { type: channelSchema, default: () => ({}) },
  offerReceived: { type: channelSchema, default: () => ({}) },
  offerAccepted: { type: channelSchema, default: () => ({}) },
  dispatch: { type: channelSchema, default: () => ({}) },
  paymentReceived: { type: channelSchema, default: () => ({}) },
  newBid: { type: channelSchema, default: () => ({}) },
  disputeUpdate: { type: channelSchema, default: () => ({}) }
}, { timestamps: true });

module.exports = mongoose.model('NotificationPreferences', notificationPreferencesSchema);
