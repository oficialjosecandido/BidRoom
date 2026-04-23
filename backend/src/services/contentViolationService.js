const User = require('../models/User');

/**
 * Records a content violation for a user and escalates penalties.
 *
 * Escalation ladder:
 *   1st violation  → warning (content blocked, action denied)
 *   2nd violation  → final warning
 *   3rd violation  → 3-day temporary restriction
 *   4th violation  → 7-day temporary restriction
 *   5th+ violation → permanent suspension
 *
 * @param {object} user - Mongoose User document
 * @returns {{ action: 'warning'|'temp_restricted'|'suspended', message: string, restrictedUntil?: Date }}
 */
async function recordViolation(user) {
  user.contentViolationCount = (user.contentViolationCount || 0) + 1;
  const count = user.contentViolationCount;

  let action;
  let message;
  let restrictedUntil = null;

  if (count === 1) {
    action = 'warning';
    message = 'Your submission was blocked: it contains personal contact information (phone number, email, or external link). Sharing contact details outside the platform is not allowed. This is your first warning.';
  } else if (count === 2) {
    action = 'warning';
    message = 'Your submission was blocked again for containing contact information. This is your final warning. Further violations will result in a temporary account restriction.';
  } else if (count === 3) {
    action = 'temp_restricted';
    restrictedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    user.contentRestrictedUntil = restrictedUntil;
    message = 'Your account has been temporarily restricted for 3 days due to repeated attempts to share contact information outside the platform.';
  } else if (count === 4) {
    action = 'temp_restricted';
    restrictedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    user.contentRestrictedUntil = restrictedUntil;
    message = 'Your account has been temporarily restricted for 7 days. This is your last warning before a permanent suspension.';
  } else {
    action = 'suspended';
    user.accountStatus = 'suspended';
    message = 'Your account has been permanently suspended due to repeated violations of our contact information policy.';
  }

  await user.save();
  return { action, message, restrictedUntil };
}

module.exports = { recordViolation };
