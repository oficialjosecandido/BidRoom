const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken } = require('../middleware/auth');
const Report = require('../models/Report');
const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const { createNotification } = require('../services/notificationService');

const router = express.Router();

const VALID_REASONS = ['fraud_scam', 'offensive_content', 'prohibited_item', 'spam', 'off_platform_transaction', 'other'];

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

// POST /api/reports — submit a report
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { reportType, targetId, reason, description } = req.body;

    if (!['listing', 'user'].includes(reportType)) {
      return res.status(400).json({ error: 'Invalid reportType. Must be "listing" or "user".' });
    }
    if (!isValidObjectId(targetId)) {
      return res.status(400).json({ error: 'Invalid targetId.' });
    }
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason.' });
    }

    // Verify target exists
    if (reportType === 'listing') {
      const listing = await Listing.findById(targetId).select('_id seller').lean();
      if (!listing) return res.status(404).json({ error: 'Listing not found.' });
      if (listing.seller?.toString() === req.user._id.toString()) {
        return res.status(400).json({ error: 'You cannot report your own listing.' });
      }
    } else {
      const target = await Customer.findById(targetId).select('_id').lean();
      if (!target) return res.status(404).json({ error: 'User not found.' });
      if (targetId === req.user._id.toString()) {
        return res.status(400).json({ error: 'You cannot report yourself.' });
      }
    }

    const report = await Report.create({
      reportType,
      targetId,
      reportedBy: req.user._id,
      reason,
      description: description?.trim() || null
    });

    // In-app confirmation notification to reporter
    await createNotification({
      userId: req.user._id,
      title: 'Report received',
      message: `Your report has been received and is under review. We will take action if a violation is found.`,
      type: 'system'
    });

    return res.status(201).json({ message: 'Report submitted successfully.', reportId: report._id });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'You have already reported this item.' });
    }
    console.error('POST /api/reports error:', err);
    return res.status(500).json({ error: 'Failed to submit report.' });
  }
});

module.exports = router;
