const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');

const router = express.Router();

// GET /api/auth/me - minimal auth (Firebase token payload)
router.get('/me', authenticateToken, async (req, res) => {
  return res.json({ user: req.user });
});

// GET /api/auth/customer - customer profile for dashboard (DB user + balance, review count)
router.get('/customer', authenticateToken, async (req, res) => {
  try {
    let dbUser = await User.findOne({ uid: req.user.uid })
      .select('_id uid email firstName lastName emailVerified isActive hasDeposit depositAmount lastLogin createdAt')
      .lean();

    if (!dbUser) {
      const nameParts = (req.user.name || '').split(' ').filter(Boolean);
      const firstName = nameParts[0] || 'User';
      const lastName = nameParts.slice(1).join(' ') || 'User';
      const newUser = new User({
        uid: req.user.uid,
        email: req.user.email || '',
        firstName,
        lastName,
        isActive: true,
        emailVerified: req.user.emailVerified ?? false
      });
      await newUser.save();
      dbUser = await User.findById(newUser._id)
        .select('_id uid email firstName lastName emailVerified isActive hasDeposit depositAmount lastLogin createdAt')
        .lean();
    } else {
      await User.updateOne({ uid: req.user.uid }, { lastLogin: new Date() });
    }

    res.json({
      user: dbUser,
      balance: dbUser.depositAmount ?? 0,
      reviewCount: 0
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({
      error: 'Failed to load customer information',
      message: error.message
    });
  }
});

module.exports = router;
