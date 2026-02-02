const admin = require('firebase-admin');

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

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);

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
      // User is authenticated - verify token and attach user
      try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
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
        // Invalid token - treat as unauthenticated
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

module.exports = {
  authenticateToken,
  optionalAuth
};
