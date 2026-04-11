const admin = require('firebase-admin');
const User = require('../models/User');

const AUTH_VERIFY_TIMEOUT_MS = 15000;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message || 'Timeout')), ms)
    )
  ]);
}

const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const idToken = authHeader && authHeader.split(' ')[1]; // Bearer <Firebase ID Token>

    if (!idToken) {
      return res.status(401).json({
        error: 'Access token required',
        message: 'Please provide a valid Firebase ID token'
      });
    }

    // Verify Firebase ID token (with timeout to avoid hanging)
    const decodedToken = await withTimeout(
      admin.auth().verifyIdToken(idToken),
      AUTH_VERIFY_TIMEOUT_MS,
      'Auth timeout'
    );

    // Attach decoded token to request
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name || null,
      picture: decodedToken.picture || null,
      provider: decodedToken.firebase?.sign_in_provider || null,
      claims: decodedToken
    };

    // Optionally enforce verified emails only
    if (!req.user.emailVerified) {
      return res.status(403).json({
        error: 'Email not verified',
        message: 'Please verify your email address before accessing this resource'
      });
    }

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    if (error.message === 'Auth timeout') {
      return res.status(503).json({
        error: 'Authentication timeout',
        message: 'Token verification took too long. Please try again.'
      });
    }
    return res.status(401).json({
      error: 'Invalid token',
      message: 'The provided Firebase token is invalid or expired'
    });
  }
};

// Optional authentication - allows unauthenticated requests but validates email if provided
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const idToken = authHeader && authHeader.split(' ')[1];

    if (idToken) {
      // User is authenticated - verify token and attach user (with timeout to avoid hanging)
      try {
        const decodedToken = await withTimeout(
          admin.auth().verifyIdToken(idToken),
          AUTH_VERIFY_TIMEOUT_MS,
          'Auth timeout'
        );
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          emailVerified: decodedToken.email_verified,
          name: decodedToken.name || null,
          picture: decodedToken.picture || null,
          provider: decodedToken.firebase?.sign_in_provider || null,
          claims: decodedToken
        };
        req.isAuthenticated = true;
      } catch (error) {
        // Timeout or invalid token - treat as unauthenticated or fail fast
        if (error.message === 'Auth timeout') {
          console.error('Optional auth: token verification timeout');
          return res.status(503).json({
            error: 'Authentication timeout',
            message: 'Token verification took too long. Please try again.'
          });
        }
        req.isAuthenticated = false;
        req.user = null;
      }
    } else {
      // No token - unauthenticated user
      req.isAuthenticated = false;
      req.user = null;
    }

    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    // Continue as unauthenticated on error
    req.isAuthenticated = false;
    req.user = null;
    next();
  }
};

/**
 * Require user to have an active account (not suspended or closed).
 * Use after authenticateToken. Returns 403 if account is suspended or closed.
 */
const requireActiveAccount = async (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  if (!req.user?.uid) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Authentication required.' });
  }
  try {
    const dbUser = await User.findOne({ uid: req.user.uid }).select('accountStatus').lean();
    if (!dbUser) {
      // No DB record yet — user is authenticated but hasn't been persisted.
      // They cannot be suspended, so let the route handler proceed (it will create the record).
      return next();
    }
    const status = dbUser.accountStatus || 'active';
    if (status === 'suspended') {
      return res.status(403).json({
        error: 'Account suspended',
        message: 'Your account has been suspended while a dispute is under review. You cannot create listings, place bids, or complete transactions until the case is resolved.'
      });
    }
    if (status === 'closed') {
      return res.status(403).json({
        error: 'Account closed',
        message: 'Your account has been permanently closed.'
      });
    }
    next();
  } catch (error) {
    console.error('requireActiveAccount error:', error);
    res.status(500).json({ error: 'Failed to verify account status', message: error.message });
  }
};

/**
 * Same as requireActiveAccount but only runs when user is authenticated.
 * Use after optionalAuth for routes that allow both guest and authenticated users (e.g. bids, offers).
 */
const requireActiveAccountIfAuthenticated = async (req, res, next) => {
  if (!req.user || !req.isAuthenticated) return next();
  return requireActiveAccount(req, res, next);
};

module.exports = {
  authenticateToken,
  optionalAuth,
  requireActiveAccount,
  requireActiveAccountIfAuthenticated
};
