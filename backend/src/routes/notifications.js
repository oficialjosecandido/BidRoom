const express = require('express');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

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
      message: error.message
    });
  }
});

/** GET /api/notifications/unread-count - Get unread count for badge */
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const count = await Notification.countDocuments({
      user: user._id,
      status: 'unread'
    });

    res.json({ unreadCount: count });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.status(500).json({
      error: 'Failed to fetch unread count',
      message: error.message
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

    const result = await Notification.updateMany(
      { user: user._id, status: 'unread' },
      { status: 'read', readAt: new Date() }
    );

    res.json({ modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({
      error: 'Failed to mark notifications as read',
      message: error.message
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
      message: error.message
    });
  }
});

module.exports = router;
