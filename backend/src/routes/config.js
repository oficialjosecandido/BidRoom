const express = require('express');
const features = require('../config/features');
const vehicleRules = require('../config/vehicleRules');

const router = express.Router();

/**
 * GET /api/config
 * Returns public feature flags so the frontend can gate UI accordingly.
 * No authentication required — flags are not sensitive.
 *
 * `vehicles` carries the value ceiling so the seller sees the limit while
 * typing a price, instead of discovering it when the submit is refused. Only
 * the ceiling is published — the detection thresholds stay server-side, since
 * telling people exactly what trips a flag tells them how to stay under it.
 */
router.get('/', (req, res) => {
  res.json({
    features,
    vehicles: { maxValueEur: vehicleRules.MAX_VEHICLE_VALUE_EUR }
  });
});

module.exports = router;
