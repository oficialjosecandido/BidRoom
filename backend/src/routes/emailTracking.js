const express = require('express');
const EmailDelivery = require('../models/EmailDelivery');
const { PIXEL } = require('../services/emailTrackingService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Open-tracking pixel. Public and unauthenticated by necessity — it is fetched
 * by the recipient's mail client, which carries no session.
 *
 * The response is a valid GIF no matter what happens: an unknown or malformed
 * token, or a database failure, must never render a broken image in someone's
 * inbox. The token is opaque and grants nothing beyond marking one delivery
 * as opened.
 */
router.get('/open.gif', async (req, res) => {
  // Never cache — a cached pixel makes later opens invisible, and an
  // intermediary caching it for one recipient could attribute another's open.
  res.set({
    'Content-Type': 'image/gif',
    'Content-Length': String(PIXEL.length),
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    Expires: '0'
  });

  const token = String(req.query.t || '');
  if (/^[a-f0-9]{32}$/.test(token)) {
    try {
      const now = new Date();
      // Pipeline update so first-open and repeat-open are one round trip:
      // openedAt is only written when it is still unset.
      await EmailDelivery.updateOne({ trackingToken: token }, [
        {
          $set: {
            openedAt: { $ifNull: ['$openedAt', now] },
            lastOpenedAt: now,
            openCount: { $add: [{ $ifNull: ['$openCount', 0] }, 1] }
          }
        }
      ]);
    } catch (err) {
      logger.error('GET /api/email-track/open.gif error:', err);
    }
  }

  res.end(PIXEL);
});

module.exports = router;
