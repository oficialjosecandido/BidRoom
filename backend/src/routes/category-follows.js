const express = require('express');
const CategoryFollow = require('../models/CategoryFollow');
const User = require('../models/User');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');

const router = express.Router();

// POST /api/category-follows/:category — follow a category
router.post('/:category', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const category = req.params.category.trim().toLowerCase();
    if (!category) return res.status(400).json({ error: 'Category is required' });

    await CategoryFollow.findOneAndUpdate(
      { user: user._id, category },
      { user: user._id, category },
      { upsert: true, new: true }
    );
    res.json({ following: true, category });
  } catch (err) {
    if (err.code === 11000) return res.json({ following: true });
    console.error('Error following category:', err);
    res.status(500).json({ error: 'Failed to follow category' });
  }
});

// DELETE /api/category-follows/:category — unfollow a category
router.delete('/:category', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const category = req.params.category.trim().toLowerCase();
    await CategoryFollow.deleteOne({ user: user._id, category });
    res.json({ following: false, category });
  } catch (err) {
    console.error('Error unfollowing category:', err);
    res.status(500).json({ error: 'Failed to unfollow category' });
  }
});

// GET /api/category-follows/status/:category — check follow status
router.get('/status/:category', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.json({ following: false });

    const category = req.params.category.trim().toLowerCase();
    const entry = await CategoryFollow.findOne({ user: user._id, category }).lean();
    res.json({ following: !!entry, category });
  } catch (err) {
    console.error('Error checking category follow status:', err);
    res.json({ following: false });
  }
});

// GET /api/category-follows — list all categories the current user follows
router.get('/', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.json({ categories: [] });

    const entries = await CategoryFollow.find({ user: user._id }).select('category muted').lean();
    res.json({ categories: entries.map(e => ({ category: e.category, muted: e.muted })) });
  } catch (err) {
    console.error('Error fetching followed categories:', err);
    res.status(500).json({ error: 'Failed to fetch followed categories' });
  }
});

// PATCH /api/category-follows/:category/mute — toggle mute for a followed category
router.patch('/:category/mute', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('_id').lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { muted } = req.body;
    if (typeof muted !== 'boolean') {
      return res.status(400).json({ error: 'muted must be a boolean' });
    }

    const category = req.params.category.trim().toLowerCase();
    const entry = await CategoryFollow.findOneAndUpdate(
      { user: user._id, category },
      { muted },
      { new: true }
    );

    if (!entry) return res.status(404).json({ error: 'Category not followed' });
    res.json({ following: true, category, muted: entry.muted });
  } catch (err) {
    console.error('Error updating category mute:', err);
    res.status(500).json({ error: 'Failed to update notification preference' });
  }
});

module.exports = router;
