const ModerationAuditLog = require('../models/ModerationAuditLog');

/**
 * @param {object} params
 * @param {import('mongoose').Types.ObjectId|string} params.subjectUserId
 * @param {string} params.actionType
 * @param {import('mongoose').Types.ObjectId|string|null} [params.performedByUserId]
 * @param {string|null} [params.performedByEmail]
 * @param {object} [params.metadata]
 * @param {string|null} [params.ip]
 */
async function appendModerationAudit(params) {
  try {
    await ModerationAuditLog.create({
      subjectUserId: params.subjectUserId,
      actionType: params.actionType,
      performedByUserId: params.performedByUserId || null,
      performedByEmail: params.performedByEmail || null,
      metadata: params.metadata || {},
      ip: params.ip || null
    });
  } catch (e) {
    console.error('appendModerationAudit failed:', e.message);
  }
}

module.exports = { appendModerationAudit };
