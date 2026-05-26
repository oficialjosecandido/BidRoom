/**
 * Single source of truth for "who is an admin?".
 *
 * Reads the comma-separated ADMIN_EMAILS env var once at module load and
 * exposes helpers for both middleware and inline checks. Keeping this off the
 * frontend bundle means the admin list can be rotated without a redeploy and
 * is never exposed to regular users.
 */
const logger = require('./logger');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

if (ADMIN_EMAILS.length === 0) {
  const msg = 'ADMIN_EMAILS is empty — admin endpoints will reject everyone.';
  if (process.env.NODE_ENV === 'production') {
    // Don't throw at module load (that would crash the boot loop); just be loud.
    logger.error(msg);
  } else {
    logger.warn(msg);
  }
}

function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(String(email).toLowerCase());
}

/** Express middleware. Assumes `authenticateToken` already attached `req.user`. */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!isAdminEmail(req.user.email)) {
    return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
  }
  return next();
}

module.exports = {
  ADMIN_EMAILS,
  isAdminEmail,
  requireAdmin,
};
