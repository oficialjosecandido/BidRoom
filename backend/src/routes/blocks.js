const express = require('express');
const Block = require('../models/Block');
const Customer = require('../models/Customer');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');

const router = express.Router();

// POST /api/blocks/:userId — block a user
router.post('/:userId', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const blocker = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!blocker) return res.status(404).json({ error: 'User not found' });

    const blockedUser = await Customer.findById(req.params.userId).select('_id').lean();
    if (!blockedUser) return res.status(404).json({ error: 'Target user not found' });

    if (blocker._id.toString() === blockedUser._id.toString()) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    await Block.findOneAndUpdate(
      { blocker: blocker._id, blocked: blockedUser._id },
      { blocker: blocker._id, blocked: blockedUser._id },
      { upsert: true, new: true }
    );

    res.json({ blocked: true, userId: req.params.userId });
  } catch (err) {
    if (err.code === 11000) return res.json({ blocked: true, userId: req.params.userId });
    console.error('Error blocking user:', err);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// DELETE /api/blocks/:userId — unblock a user
router.delete('/:userId', authenticateToken, async (req, res) => {
  try {
    const blocker = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!blocker) return res.status(404).json({ error: 'User not found' });

    await Block.deleteOne({ blocker: blocker._id, blocked: req.params.userId });
    res.json({ blocked: false, userId: req.params.userId });
  } catch (err) {
    console.error('Error unblocking user:', err);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// GET /api/blocks/status/:userId — check if current user has blocked this user
router.get('/status/:userId', authenticateToken, async (req, res) => {
  try {
    const blocker = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!blocker) return res.json({ blocked: false });

    const entry = await Block.findOne({ blocker: blocker._id, blocked: req.params.userId }).lean();
    res.json({ blocked: !!entry, userId: req.params.userId });
  } catch (err) {
    console.error('Error checking block status:', err);
    res.json({ blocked: false });
  }
});

// GET /api/blocks — list all users the current user has blocked
router.get('/', authenticateToken, async (req, res) => {
  try {
    const blocker = await Customer.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!blocker) return res.json({ blocked: [] });

    const entries = await Block.find({ blocker: blocker._id })
      .populate('blocked', 'firstName lastName slug _id')
      .lean();

    res.json({
      blocked: entries.map(e => ({
        _id: e.blocked._id,
        firstName: e.blocked.firstName,
        lastName: e.blocked.lastName,
        slug: e.blocked.slug || null
      }))
    });
  } catch (err) {
    console.error('Error fetching blocked users:', err);
    res.status(500).json({ error: 'Failed to fetch blocked users' });
  }
});

module.exports = router;
