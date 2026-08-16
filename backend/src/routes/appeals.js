'use strict';

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const AccountAppeal = require('../models/AccountAppeal');
const { appendModerationAudit } = require('../services/moderationAuditService');
const { notifyAppealApproved, notifyAppealRejected, notifyContentRestrictionLifted } = require('../services/notificationService');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../utils/logger');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function requireAdmin(req, res, next) {
  if (!req.user?.claims?.admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// ─── User routes ─────────────────────────────────────────────────────────────

/**
 * POST /api/appeals
 * Submit an appeal against an active content restriction or suspension.
 * Does NOT require requireActiveAccount — the user IS restricted, that's the point.
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isContentRestricted = !!(user.contentRestrictedUntil && user.contentRestrictedUntil > new Date());
    const isSuspended = user.accountStatus === 'suspended';

    if (!isContentRestricted && !isSuspended) {
      return res.status(400).json({ error: 'No active restriction', message: 'Your account has no active restriction to appeal.' });
    }

    const existing = await AccountAppeal.findOne({ user: user._id, status: 'pending' });
    if (existing) {
      return res.status(409).json({ error: 'Appeal already pending', message: 'You already have a pending appeal. Our team will review it shortly.', appeal: existing });
    }

    const { message } = req.body;
    if (!message || String(message).trim().length < 10) {
      return res.status(400).json({ error: 'Message too short', message: 'Please explain your situation (at least 10 characters).' });
    }

    const appeal = await AccountAppeal.create({
      user: user._id,
      restrictionType: isSuspended ? 'suspended' : 'content_restriction',
      restrictedUntil: user.contentRestrictedUntil || null,
      message: String(message).trim().slice(0, 2000),
    });

    await appendModerationAudit({
      subjectUserId: user._id,
      actionType: 'appeal_submitted',
      metadata: { restrictionType: appeal.restrictionType }
    }).catch(() => {});

    res.status(201).json({ success: true, appeal });
  } catch (error) {
    logger.error('Error submitting appeal:', error);
    res.status(500).json({ error: 'Failed to submit appeal', message: error.message });
  }
});

/**
 * GET /api/appeals/mine
 * Returns the most recent appeal for the current user.
 */
router.get('/mine', authenticateToken, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid }).select('_id contentRestrictedUntil accountStatus').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const appeal = await AccountAppeal.findOne({ user: user._id }).sort({ createdAt: -1 }).lean();
    const isRestricted = !!(user.contentRestrictedUntil && user.contentRestrictedUntil > new Date()) || user.accountStatus === 'suspended';

    res.json({
      appeal: appeal || null,
      isRestricted,
      contentRestrictedUntil: user.contentRestrictedUntil || null,
      accountStatus: user.accountStatus || 'active'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load appeal', message: error.message });
  }
});

// ─── Admin routes ─────────────────────────────────────────────────────────────

/**
 * GET /api/appeals/admin
 * List appeals (default: pending).
 */
router.get('/admin', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status = 'pending', page = '1', limit = '25' } = req.query;
    const filter = status === 'all' ? {} : { status };
    const total = await AccountAppeal.countDocuments(filter);
    const appeals = await AccountAppeal.find(filter)
      .populate('user', 'firstName lastName email accountStatus contentViolationCount contentRestrictedUntil')
      .sort({ createdAt: 1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .lean();
    res.json({ appeals, total, page: Number(page) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load appeals', message: error.message });
  }
});

/**
 * PATCH /api/appeals/admin/:id
 * Admin approves or rejects an appeal.
 */
router.patch('/admin/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid appeal ID' });

    const { decision, adminResponse = '' } = req.body;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Invalid decision', message: 'decision must be "approved" or "rejected"' });
    }

    const appeal = await AccountAppeal.findById(req.params.id).populate('user');
    if (!appeal) return res.status(404).json({ error: 'Appeal not found' });
    if (appeal.status !== 'pending') return res.status(400).json({ error: 'Appeal already reviewed' });

    appeal.status      = decision;
    appeal.adminResponse = String(adminResponse).trim();
    appeal.reviewedByEmail = req.user.email || null;
    appeal.reviewedAt  = new Date();
    await appeal.save();

    if (decision === 'approved') {
      // Lift the content restriction if it is still active
      const user = await Customer.findById(appeal.user._id);
      if (user?.contentRestrictedUntil && user.contentRestrictedUntil > new Date()) {
        user.contentRestrictedUntil = null;
        await user.save();
      }

      await appendModerationAudit({
        subjectUserId: appeal.user._id,
        actionType: 'content_restriction_unlocked',
        performedByEmail: req.user.email || null,
        metadata: { source: 'appeal', appealId: appeal._id }
      }).catch(() => {});

      await notifyAppealApproved({ userId: appeal.user._id }).catch(err => logger.error('Notify appeal approved:', err.message));
    } else {
      await notifyAppealRejected({ userId: appeal.user._id, adminResponse: appeal.adminResponse }).catch(err => logger.error('Notify appeal rejected:', err.message));
    }

    res.json({ success: true, appeal });
  } catch (error) {
    logger.error('Error reviewing appeal:', error);
    res.status(500).json({ error: 'Failed to review appeal', message: error.message });
  }
});

module.exports = router;
