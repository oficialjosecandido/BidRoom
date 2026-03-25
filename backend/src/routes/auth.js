const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const { getTrustBadges } = require('../services/reputationService');
const { getReviewScoresForUser } = require('../services/reviewService');
const { sendPasswordReset } = require('../services/emailService');
const admin = require('../config/firebaseAdmin');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';

const router = express.Router();

// GET /api/auth/me - minimal auth (Firebase token payload)
router.get('/me', authenticateToken, async (req, res) => {
  return res.json({ user: req.user });
});

// GET /api/auth/customer - customer profile for dashboard (DB user + balance, reputation, badges)
router.get('/customer', authenticateToken, async (req, res) => {
  try {
    const selectFields = '_id uid email firstName lastName emailVerified isActive accountStatus hasDeposit depositAmount reputationScore disputeLossCount successfulTransactionCount lastLogin createdAt';
    let dbUser = await User.findOne({ uid: req.user.uid })
      .select(selectFields)
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
        .select(selectFields)
        .lean();
    } else {
      await User.updateOne({ uid: req.user.uid }, { lastLogin: new Date() });
    }

    const [badges, reviewScores] = await Promise.all([
      getTrustBadges(dbUser),
      getReviewScoresForUser(dbUser._id)
    ]);

    res.json({
      user: dbUser,
      balance: dbUser.depositAmount ?? 0,
      reviewCount: (reviewScores.buyerReviewCount || 0) + (reviewScores.sellerReviewCount || 0),
      badges,
      reputationScore: dbUser.reputationScore ?? 100
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({
      error: 'Failed to load customer information',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/forgot-password (public)
 * Generates a Firebase password reset link and sends it via the custom email service.
 */
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Generate reset link via Firebase Admin (keeps password stored in Firebase)
    const firebaseLink = await admin.auth().generatePasswordResetLink(email.toLowerCase().trim());

    // Extract the oobCode and build a link pointing to our own reset page
    const parsed = new URL(firebaseLink);
    const oobCode = parsed.searchParams.get('oobCode');
    const resetUrl = `${FRONTEND_URL}/auth/reset-password?oobCode=${encodeURIComponent(oobCode)}`;

    // Look up first name for personalisation (best-effort)
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('firstName').lean();

    await sendPasswordReset(email.toLowerCase().trim(), user?.firstName || 'there', resetUrl);

    console.log(`[Auth] Password reset email sent to ${email}`);
    res.json({ success: true });
  } catch (err) {
    if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-email') {
      // Security: don't reveal whether this email is registered
      return res.json({ success: true });
    }
    console.error('[Auth] Forgot password error:', err.message);
    res.status(500).json({ error: 'Failed to send reset email. Please try again.' });
  }
});

module.exports = router;
