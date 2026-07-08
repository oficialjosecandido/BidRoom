const express = require('express');
const { getRates } = require('../services/exchangeRateService');

const router = express.Router();

/**
 * GET /api/exchange-rates
 * Public — returns EUR-based indicative rates for display currency.
 * Cached server-side 24h; browsers may cache 1h.
 */
router.get('/', async (req, res) => {
  try {
    const rates = await getRates();
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(rates);
  } catch (e) {
    res.status(500).json({ base: 'EUR', rates: {}, unavailable: true });
  }
});

module.exports = router;
