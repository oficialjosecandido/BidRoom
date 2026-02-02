const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Minimal auth route relying on Firebase ID token
router.get('/me', authenticateToken, async (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
