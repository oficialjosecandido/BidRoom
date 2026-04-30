const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const User = require('../models/User');
const { getTrustBadges } = require('../services/reputationService');
const { getReviewScoresForUser } = require('../services/reviewService');
const { sendPasswordReset } = require('../services/emailService');
const admin = require('../config/firebaseAdmin');

// Per-email rate limiting for sensitive auth operations.
// Keyed by normalised email; entries expire after the window.
const _emailRateLimits = new Map();

function checkEmailRateLimit(email, maxAttempts, windowMs) {
  const now = Date.now();
  const key = email.toLowerCase().trim();
  let entry = _emailRateLimits.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }
  entry.count += 1;
  _emailRateLimits.set(key, entry);
  return entry.count > maxAttempts; // true = rate limited
}

// Clean up stale entries every 30 minutes to prevent memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of _emailRateLimits.entries()) {
    if (entry.resetAt <= now) _emailRateLimits.delete(key);
  }
}, 30 * 60 * 1000);

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

  // Max 3 reset requests per email per hour to prevent inbox flooding.
  if (checkEmailRateLimit(email, 3, 60 * 60 * 1000)) {
    return res.json({ success: true }); // Silently succeed to avoid enumeration
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

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * POST /api/auth/login-failure (public)
 * Called by the frontend when Firebase returns a wrong-password / user-not-found error.
 * Increments the failed-attempt counter for the account and locks it after 5 failures.
 * Rate-limited at the IP level by express-rate-limit in index.js.
 */
router.post('/login-failure', async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Prevent malicious actors from triggering arbitrary lockouts via rapid calls.
  if (checkEmailRateLimit(email, 20, 15 * 60 * 1000)) {
    return res.json({ locked: false }); // Silently absorb excess calls
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase().trim() })
      .select('loginFailedAttempts loginLockedUntil');
    if (!user) {
      // Security: don't reveal whether this email is registered
      return res.json({ locked: false });
    }

    const attempts = (user.loginFailedAttempts || 0) + 1;
    const locked = attempts >= LOGIN_MAX_ATTEMPTS;
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          loginFailedAttempts: attempts,
          loginLockedUntil: locked ? new Date(Date.now() + LOGIN_LOCKOUT_MS) : null
        }
      }
    );

    return res.json({
      locked,
      attemptsRemaining: Math.max(0, LOGIN_MAX_ATTEMPTS - attempts),
      retryAfterMs: locked ? LOGIN_LOCKOUT_MS : null
    });
  } catch (err) {
    console.error('[Auth] login-failure error:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

module.exports = router;
