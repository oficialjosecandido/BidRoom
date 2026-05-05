const express = require('express');
const mongoose = require('mongoose');
const Follow = require('../models/Follow');
const User = require('../models/User');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');

const router = express.Router();

// POST /api/follows/:sellerId — follow a seller
router.post('/:sellerId', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const followerId = req.user._id;
    const { sellerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ error: 'Invalid seller ID' });
    }

    if (String(followerId) === sellerId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    await Follow.findOneAndUpdate(
      { follower: followerId, following: sellerId },
      { follower: followerId, following: sellerId, muted: false },
      { upsert: true, new: true }
    );

    res.json({ following: true, muted: false });
  } catch (error) {
    if (error.code === 11000) {
      return res.json({ following: true });
    }
    console.error('Error following seller:', error);
    res.status(500).json({ error: 'Failed to follow seller' });
  }
});

// DELETE /api/follows/:sellerId — unfollow a seller
router.delete('/:sellerId', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const followerId = req.user._id;
    const { sellerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ error: 'Invalid seller ID' });
    }

    await Follow.deleteOne({ follower: followerId, following: sellerId });
    res.json({ following: false });
  } catch (error) {
    console.error('Error unfollowing seller:', error);
    res.status(500).json({ error: 'Failed to unfollow seller' });
  }
});

// PATCH /api/follows/:sellerId/mute — toggle mute for a followed seller
router.patch('/:sellerId/mute', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const followerId = req.user._id;
    const { sellerId } = req.params;
    const { muted } = req.body;

    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ error: 'Invalid seller ID' });
    }

    if (typeof muted !== 'boolean') {
      return res.status(400).json({ error: 'muted must be a boolean' });
    }

    const follow = await Follow.findOneAndUpdate(
      { follower: followerId, following: sellerId },
      { muted },
      { new: true }
    );

    if (!follow) {
      return res.status(404).json({ error: 'Not following this seller' });
    }

    res.json({ following: true, muted: follow.muted });
  } catch (error) {
    console.error('Error toggling mute:', error);
    res.status(500).json({ error: 'Failed to update mute setting' });
  }
});

// GET /api/follows/status/:sellerId — check follow status
router.get('/status/:sellerId', authenticateToken, async (req, res) => {
  try {
    const followerId = req.user._id;
    const { sellerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ error: 'Invalid seller ID' });
    }

    const follow = await Follow.findOne({ follower: followerId, following: sellerId }).lean();

    if (!follow) {
      return res.json({ following: false, muted: false });
    }

    res.json({ following: true, muted: follow.muted });
  } catch (error) {
    console.error('Error getting follow status:', error);
    res.status(500).json({ error: 'Failed to get follow status' });
  }
});

// GET /api/follows/following — list all sellers the current user follows
router.get('/following', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.json({ following: [] });

    const entries = await Follow.find({ follower: user._id })
      .populate('following', 'firstName lastName _id')
      .lean();

    const following = entries.map(e => ({
      _id: e.following._id,
      firstName: e.following.firstName,
      lastName: e.following.lastName,
      muted: e.muted
    }));

    res.json({ following });
  } catch (err) {
    console.error('Error fetching following list:', err);
    res.status(500).json({ error: 'Failed to fetch following list' });
  }
});

module.exports = router;
