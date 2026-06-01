const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Notification = require('../models/Notification');
const User = require('../models/User');
const NotificationPreferences = require('../models/NotificationPreferences');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const unsubscribeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Please try again later.' }
});

/** GET /api/notifications - List notifications for the current user (newest first) */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const skip = parseInt(req.query.skip, 10) || 0;
    const status = req.query.status; // optional: 'unread' | 'read'

    const query = { user: user._id };
    if (status && ['unread', 'read'].includes(status)) {
      query.status = status;
    }

    const [notifications, total] = await Promise.all([
      Notification.find(query)
        .sort({ issuedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query)
    ]);

    const unreadCount = await Notification.countDocuments({
      user: user._id,
      status: 'unread'
    });

    res.json({
      notifications,
      total,
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({
      error: 'Failed to fetch notifications',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/** GET /api/notifications/unread-count - Get unread count for badge (optional ?types=bid,shipping) */
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const query = { user: user._id, status: 'unread' };
    const typesParam = req.query.types;
    if (typesParam) {
      const types = String(typesParam)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length) query.type = { $in: types };
    }

    const count = await Notification.countDocuments(query);

    res.json({ unreadCount: count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      error: 'Failed to fetch unread count',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/** PATCH /api/notifications/read-all - Mark all notifications as read (must be before /:id/read) */
router.patch('/read-all', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const query = { user: user._id, status: 'unread' };
    const typesParam = req.query.types;
    if (typesParam) {
      const types = String(typesParam)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (types.length) query.type = { $in: types };
    }

    const result = await Notification.updateMany(
      query,
      { status: 'read', readAt: new Date() }
    );

    res.json({ modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      error: 'Failed to mark notifications as read',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/** PATCH /api/notifications/:id/read - Mark a single notification as read */
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: user._id },
      { status: 'read', readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json(notification);
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({
      error: 'Failed to mark notification as read',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

const PREF_EVENT_KEYS = [
  'outbid', 'auctionEndingSoon', 'auctionWon',
  'offerReceived', 'offerAccepted', 'dispatch',
  'paymentReceived', 'newBid', 'disputeUpdate'
];

/** GET /api/notifications/preferences - Load notification preferences for current user */
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    let prefs = await NotificationPreferences.findOne({ user: user._id }).lean();
    if (!prefs) {
      // Return defaults without persisting — preferences are created on first PATCH
      const defaults = { globalEmailUnsubscribed: false };
      for (const key of PREF_EVENT_KEYS) {
        defaults[key] = { email: true, push: true, inApp: true };
      }
      return res.json(defaults);
    }
    res.json(prefs);
  } catch (err) {
    console.error('GET /preferences error:', err);
    res.status(500).json({ error: 'Failed to load preferences' });
  }
});

/** PATCH /api/notifications/preferences - Save notification preferences for current user */
router.patch('/preferences', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const update = {};
    if (typeof req.body.globalEmailUnsubscribed === 'boolean') {
      update.globalEmailUnsubscribed = req.body.globalEmailUnsubscribed;
    }
    for (const key of PREF_EVENT_KEYS) {
      if (req.body[key] && typeof req.body[key] === 'object') {
        const { email, push, inApp } = req.body[key];
        update[key] = {};
        if (typeof email === 'boolean') update[key].email = email;
        if (typeof push === 'boolean') update[key].push = push;
        if (typeof inApp === 'boolean') update[key].inApp = inApp;
      }
    }

    const prefs = await NotificationPreferences.findOneAndUpdate(
      { user: user._id },
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    res.json(prefs);
  } catch (err) {
    console.error('PATCH /preferences error:', err);
    res.status(500).json({ error: 'Failed to save preferences' });
  }
});

/**
 * GET /api/notifications/unsubscribe?token=xxx (public)
 * One-click global email unsubscribe without login. Token is generated lazily on first email send.
 */
router.get('/unsubscribe', unsubscribeLimiter, async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Invalid unsubscribe link' });
  }
  try {
    const user = await User.findOne({ emailUnsubscribeToken: token }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'Unsubscribe link not recognised' });

    await NotificationPreferences.findOneAndUpdate(
      { user: user._id },
      { $set: { globalEmailUnsubscribed: true } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('GET /unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to process unsubscribe request' });
  }
});

module.exports = router;
