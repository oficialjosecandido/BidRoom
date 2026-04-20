const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const { getTrustBadges } = require('../services/reputationService');
const { getReviewScoresForUser } = require('../services/reviewService');
const { sendPasswordReset } = require('../services/emailService');
const admin = require('../config/firebaseAdmin');

// FRONTEND_URL must be set via environment variable in production (Azure App Service → Configuration).
// Falls back to localhost for local development ONLY.
const CONFIGURED_FRONTEND_URL = process.env.FRONTEND_URL;
if (!CONFIGURED_FRONTEND_URL || CONFIGURED_FRONTEND_URL.includes('localhost')) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[Auth] WARNING: FRONTEND_URL is not set or points to localhost in production. Password reset links will be broken. Set FRONTEND_URL in Azure App Service Configuration.');
  }
}

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

    // Extract the oobCode and build a link pointing to our own reset page.
    // Derive the frontend base URL from:
    // 1. FRONTEND_URL env var (required in production — set in Azure App Service Configuration)
    // 2. The request's Origin header (the browser that triggered the reset is on the right domain)
    // 3. Fallback to localhost for local dev
    const parsed = new URL(firebaseLink);
    const oobCode = parsed.searchParams.get('oobCode');
    const requestOrigin = req.headers['origin'] || req.headers['referer']?.replace(/\/[^/]*$/, '') || null;
    const frontendBase = (CONFIGURED_FRONTEND_URL && !CONFIGURED_FRONTEND_URL.includes('localhost'))
      ? CONFIGURED_FRONTEND_URL.replace(/\/$/, '')
      : (requestOrigin && !requestOrigin.includes('localhost') ? requestOrigin.replace(/\/$/, '') : (CONFIGURED_FRONTEND_URL || 'http://localhost:4200').replace(/\/$/, ''));
    const resetUrl = `${frontendBase}/auth/reset-password?oobCode=${encodeURIComponent(oobCode)}`;

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
