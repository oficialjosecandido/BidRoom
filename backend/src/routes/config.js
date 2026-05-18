const express = require('express');
const features = require('../config/features');

const router = express.Router();

/**
 * GET /api/config
 * Returns public feature flags so the frontend can gate UI accordingly.
 * No authentication required — flags are not sensitive.
 */
router.get('/', (req, res) => {
  res.json({ features });
});

module.exports = router;
