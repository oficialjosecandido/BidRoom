const express = require('express');
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const { authenticateToken, optionalAuth, requireActiveAccount } = require('../middleware/auth');
const { enterGiveaway, getEntryState, getPublicState, GiveawayError } = require('../services/giveawayService');
const { notifyGiveawayEntered } = require('../services/notificationService');
const logger = require('../utils/logger');

const router = express.Router();

/** Turns a GiveawayError into its response; anything else is a real 500. */
function sendGiveawayError(res, err, context) {
  if (err instanceof GiveawayError) {
    return res.status(err.statusCode).json({ error: err.code, message: err.message, ...err.details });
  }
  logger.error(`${context}:`, err);
  return res.status(500).json({
    error: 'Giveaway request failed',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
}

/** The signed-in user's Customer record, or null if they have none yet. */
async function loadParticipant(req) {
  return Customer.findOne({ uid: req.user.uid }).select('_id').lean();
}

/**
 * POST /api/giveaways/:id/enter
 *
 * Enter a giveaway. Free, one entry per person, and nothing about the account
 * — what it has bought, what it is worth — changes the odds. Being signed in
 * is the only requirement, and that is only so the same person cannot enter
 * twice and so there is somebody to contact if they win.
 */
router.post('/:id/enter', authenticateToken, requireActiveAccount, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid giveaway ID' });
  }
  try {
    const participant = await loadParticipant(req);
    if (!participant) {
      return res.status(403).json({
        error: 'account_required',
        message: 'Finish setting up your account before entering a giveaway.'
      });
    }

    const { entryNumber, alreadyEntered } = await enterGiveaway({
      listingId: req.params.id,
      participant
    });

    // Only a new entrant is told; re-confirming an entry somebody already has
    // would be a notification about nothing.
    if (!alreadyEntered) {
      notifyGiveawayEntered({
        listingId: req.params.id,
        participantUserId: participant._id,
        entryNumber,
        io: req.app.get('io')
      }).catch((err) => logger.error('[Giveaway] Entry notification failed:', err.message));
    }

    return res.json({ success: true, entered: true, entryNumber, alreadyEntered });
  } catch (err) {
    return sendGiveawayError(res, err, 'POST /api/giveaways/:id/enter');
  }
});

/**
 * GET /api/giveaways/:id
 *
 * Public. The entry count, whether entries are open, and — once drawn — the
 * winning number and the winner's public name. This is the announcement the
 * rules promise, so it must work for someone who is not signed in. A signed-in
 * viewer also gets their own entry, saving the page a second request.
 */
router.get('/:id', optionalAuth, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid giveaway ID' });
  }
  try {
    const participant = req.user ? await loadParticipant(req) : null;
    const state = await getPublicState({
      listingId: req.params.id,
      participantId: participant?._id || null
    });
    return res.json(state);
  } catch (err) {
    return sendGiveawayError(res, err, 'GET /api/giveaways/:id');
  }
});

/**
 * GET /api/giveaways/:id/my-entry
 * Whether the signed-in user is in, the number they hold, and the total.
 */
router.get('/:id/my-entry', authenticateToken, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ error: 'Invalid giveaway ID' });
  }
  try {
    const participant = await loadParticipant(req);
    const state = await getEntryState({
      listingId: req.params.id,
      participantId: participant?._id || null
    });
    return res.json(state);
  } catch (err) {
    return sendGiveawayError(res, err, 'GET /api/giveaways/:id/my-entry');
  }
});

module.exports = router;
