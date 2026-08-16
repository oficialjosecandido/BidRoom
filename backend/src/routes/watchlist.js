const express = require('express');
const Watchlist = require('../models/Watchlist');
const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const { authenticateToken } = require('../middleware/auth');
const { notifyItemAddedToWatchlist, emitNewNotificationToUser } = require('../services/notificationService');
const logger = require('../utils/logger');

const router = express.Router();

// All watchlist routes require authentication
router.use(authenticateToken);

// POST /api/watchlist - Add listing to watchlist
router.post('/', async (req, res) => {
  try {
    const { listingId } = req.body;
    if (!listingId) {
      return res.status(400).json({ error: 'listingId is required' });
    }

    let user = await Customer.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found. Please complete your profile.' });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const existing = await Watchlist.findOne({ user: user._id, listing: listingId });
    if (existing) {
      return res.json({ success: true, message: 'Already in watchlist', inWatchlist: true });
    }

    await Watchlist.create({ user: user._id, listing: listingId });
    const sellerUserId = listing.seller?.toString?.();
    if (sellerUserId && sellerUserId !== user._id.toString()) {
      const watcherName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email?.split('@')[0] || 'Someone';
      notifyItemAddedToWatchlist({
        listingSlug: listing.slug || null,
        listingTitle: listing.title || 'your listing',
        watcherName,
        sellerUserId
      }).catch(err => logger.error('Failed to create watchlist notification:', err));
      const io = req.app.get('io');
      if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
    }
    res.status(201).json({ success: true, message: 'Added to watchlist', inWatchlist: true });
  } catch (error) {
    if (error.code === 11000) {
      return res.json({ success: true, message: 'Already in watchlist', inWatchlist: true });
    }
    logger.error('Error adding to watchlist:', error);
    res.status(500).json({ error: 'Failed to add to watchlist', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

// DELETE /api/watchlist/:listingId - Remove listing from watchlist
router.delete('/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const result = await Watchlist.findOneAndDelete({ user: user._id, listing: listingId });
    if (!result) {
      return res.status(404).json({ error: 'Not in watchlist' });
    }
    res.json({ success: true, message: 'Removed from watchlist', inWatchlist: false });
  } catch (error) {
    logger.error('Error removing from watchlist:', error);
    res.status(500).json({ error: 'Failed to remove from watchlist', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

// GET /api/watchlist - Get current user's watchlist (listings)
router.get('/', async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const items = await Watchlist.find({ user: user._id })
      .populate({
        path: 'listing',
        populate: { path: 'seller', select: 'firstName lastName' }
      })
      .sort({ createdAt: -1 })
      .lean();

    const listings = items
      .filter((item) => item.listing != null)
      .map((item) => ({
        ...item.listing,
        addedAt: item.createdAt
      }));

    res.json({ watchlist: listings, total: listings.length });
  } catch (error) {
    logger.error('Error fetching watchlist:', error);
    res.status(500).json({ error: 'Failed to fetch watchlist', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

// GET /api/watchlist/check/:listingId - Check if listing is in current user's watchlist
router.get('/check/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) {
      return res.json({ inWatchlist: false });
    }

    const entry = await Watchlist.findOne({ user: user._id, listing: listingId });
    res.json({ inWatchlist: !!entry });
  } catch (error) {
    logger.error('Error checking watchlist:', error);
    res.json({ inWatchlist: false });
  }
});

module.exports = router;
