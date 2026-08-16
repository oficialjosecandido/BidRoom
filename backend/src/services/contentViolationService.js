const Customer = require('../models/Customer');
const { appendModerationAudit } = require('./moderationAuditService');
const { suspendUser } = require('./accountStatusService');
const logger = require('../utils/logger');

const VIOLATION_MESSAGES = {
  contact_info: {
    1: 'Your submission was blocked: it contains personal contact information (phone number, email, or external link). Sharing contact details outside the platform is not allowed. This is your first warning.',
    2: 'Your submission was blocked again for containing contact information. This is your final warning. Further violations will result in a temporary account restriction.',
    3: 'Your account has been temporarily restricted for 3 days due to repeated attempts to share contact information outside the platform.',
    4: 'Your account has been temporarily restricted for 7 days. This is your last warning before a permanent suspension.',
    5: 'Your account has been permanently suspended due to repeated violations of our contact information policy.'
  },
  offensive_language: {
    1: 'Your submission was blocked: it contains offensive or abusive language that violates our community guidelines. This is your first warning.',
    2: 'Your submission was blocked again for containing offensive language. This is your final warning. Further violations will result in a temporary account restriction.',
    3: 'Your account has been temporarily restricted for 3 days due to repeated use of offensive or abusive language.',
    4: 'Your account has been temporarily restricted for 7 days. This is your last warning before a permanent suspension.',
    5: 'Your account has been permanently suspended due to repeated use of offensive or abusive language.'
  },
  inappropriate_image: {
    1: 'Your image was blocked: it contains content (nudity, sexual material, or graphic violence) that violates our platform policies. This is your first warning.',
    2: 'Another image upload was blocked for containing inappropriate content. This is your final warning. Further violations will result in a temporary account restriction.',
    3: 'Your account has been temporarily restricted for 3 days due to repeated attempts to upload inappropriate images.',
    4: 'Your account has been temporarily restricted for 7 days. This is your last warning before a permanent suspension.',
    5: 'Your account has been permanently suspended due to repeated uploads of inappropriate content.'
  }
};

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
 * @param {'contact_info'|'offensive_language'} [violationType='contact_info']
 * @returns {{ action: 'warning'|'temp_restricted'|'suspended', message: string, restrictedUntil?: Date }}
 */
async function recordViolation(user, violationType = 'contact_info') {
  user.contentViolationCount = (user.contentViolationCount || 0) + 1;
  const count = user.contentViolationCount;
  const msgs = VIOLATION_MESSAGES[violationType] || VIOLATION_MESSAGES.contact_info;

  let action;
  let message;
  let restrictedUntil = null;

  if (count === 1) {
    action = 'warning';
    message = msgs[1];
  } else if (count === 2) {
    action = 'warning';
    message = msgs[2];
  } else if (count === 3) {
    action = 'temp_restricted';
    restrictedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
    user.contentRestrictedUntil = restrictedUntil;
    message = msgs[3];
  } else if (count === 4) {
    action = 'temp_restricted';
    restrictedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    user.contentRestrictedUntil = restrictedUntil;
    message = msgs[4];
  } else {
    action = 'suspended';
    message = msgs[5];
  }

  await user.save();
  await appendModerationAudit({
    subjectUserId: user._id,
    actionType: 'content_violation',
    metadata: { action, violationCount: count, restrictedUntil: restrictedUntil || null }
  });

  // Route 5th+ violation through suspendUser so deferral logic applies if user has an active auction
  if (action === 'suspended') {
    await suspendUser(user._id.toString(), {
      reason: 'content_violation_5th_plus',
      triggeredBy: 'system'
    }).catch(err => logger.error('Content violation suspend error:', err.message));
  }

  return { action, message, restrictedUntil };
}

module.exports = { recordViolation };
