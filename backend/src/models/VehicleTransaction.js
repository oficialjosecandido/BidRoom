'use strict';

const mongoose = require('mongoose');

const vehicleTransactionSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true, unique: true, index: true },
  buyer:   { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  seller:  { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },

  agreedPrice: { type: Number, required: true, min: 0 },

  // ── Caução do comprador (pré-autorização) ────────────────────────────────
  deposit: {
    amount:                { type: Number, default: 100 },
    stripePaymentIntentId: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'authorized', 'requires_action', 'released', 'captured', 'expired', 'failed'],
      default: 'pending',
    },
    authorizedAt:  { type: Date, default: null },
    resolvedAt:    { type: Date, default: null },
    /** clientSecret returned when 3DS/SCA is required — stored so frontend can retrieve it */
    clientSecret:  { type: String, default: null },
  },

  // ── Success fee do vendedor (cobrança normal) ────────────────────────────
  sellerFee: {
    amount:                { type: Number, default: 100 },
    stripePaymentIntentId: { type: String, default: null },
    status: { type: String, enum: ['pending', 'paid', 'requires_action', 'failed'], default: 'pending' },
    paidAt: { type: Date, default: null },
    clientSecret: { type: String, default: null },
  },

  // ── Confirmação de conclusão (assimétrica — Regra 1) ─────────────────────
  completion: {
    buyerConfirmed:       { type: Boolean, default: false },
    sellerConfirmed:      { type: Boolean, default: false },
    buyerConfirmedAt:     { type: Date, default: null },
    sellerConfirmedAt:    { type: Date, default: null },
    /** Moment when the 48h countdown started (first party confirmed) */
    firstConfirmationAt:  { type: Date, default: null },
    /** IMT registration proof uploaded by buyer (fallback trigger for completion) */
    registrationProofUrl: { type: String, default: null },
    registrationProofUploadedAt: { type: Date, default: null },
    /** Active contestation of the other party's completion claim (Option A: just a flag for admin review) */
    contested:    { type: Boolean, default: false },
    contestedBy:  { type: String, enum: ['buyer', 'seller'], default: null },
    contestReason:{ type: String, trim: true, default: null },
    contestedAt:  { type: Date, default: null },
  },

  // ── Estado global ────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: [
      'awaiting_setup',       // waiting for deposit + fee (12h window)
      'in_progress',          // both setup done; parties handle the deal offline
      'awaiting_confirmation',// one party confirmed; 48h window for the other
      'completed',            // deal done → deposit released
      'failed',               // deal didn't complete → deposit captured
      'cancelled',            // setup failed (deposit or fee not completed in 12h)
    ],
    default: 'awaiting_setup',
    index: true,
  },

  /** Breakdown of why setup failed or deal failed */
  failureReason: { type: String, default: null },

  // ── Prazos ──────────────────────────────────────────────────────────────
  /** Buyer must authorize deposit + seller must pay fee within 12h of auction close */
  setupDeadline: { type: Date, required: true },
  /** Parties must confirm deal completion within this window (3 business days) */
  transactionDeadline: { type: Date, required: true },
  /** Derived: firstConfirmationAt + 48h — auto-complete if no contestation by then */
  confirmationDeadline: { type: Date, default: null },

  // ── Notificações de prazo (idempotência) ────────────────────────────────
  setupReminderSentAt:       { type: Date, default: null },
  dealReminderSentAt:        { type: Date, default: null },
  confirmReminderSentAt:     { type: Date, default: null },
  partiesIntroducedAt:       { type: Date, default: null },

}, { timestamps: true });

vehicleTransactionSchema.index({ status: 1, setupDeadline: 1 });
vehicleTransactionSchema.index({ status: 1, transactionDeadline: 1 });
vehicleTransactionSchema.index({ status: 1, confirmationDeadline: 1 });

module.exports = mongoose.model('VehicleTransaction', vehicleTransactionSchema);
