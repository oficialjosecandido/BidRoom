const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { getReviewScoresForUser } = require('../services/reviewService');

const router = express.Router();

/**
 * GET /api/customers/profile
 * Returns the authenticated customer's profile from the customers collection.
 * Creates a customer document if one doesn't exist (from Firebase token).
 * Includes buyer and seller review scores (from User/reviews).
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { uid, email, name, emailVerified } = req.user;
    const nameParts = (name || '').split(' ').filter(Boolean);
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || 'User';

    let customer = await Customer.findOne({ uid }).lean();

    if (!customer) {
      customer = await Customer.create({
        uid,
        email: email || '',
        firstName,
        lastName,
        balance: 0,
        reviewCount: 0,
        lastLogin: new Date()
      });
      customer = customer.toObject ? customer.toObject() : customer;
    } else {
      await Customer.updateOne(
        { uid },
        {
          $set: {
            email: email || customer.email,
            firstName: firstName || customer.firstName,
            lastName: lastName || customer.lastName,
            lastLogin: new Date()
          }
        }
      );
      customer = await Customer.findOne({ uid }).lean();
    }

    // Resolve User by uid for review scores (buyer/seller scores are per User)
    const dbUser = await User.findOne({ uid }).select('_id').lean();
    let buyerScore = null;
    let sellerScore = null;
    let buyerReviewCount = 0;
    let sellerReviewCount = 0;
    if (dbUser) {
      const scores = await getReviewScoresForUser(dbUser._id);
      buyerScore = scores.buyerScore;
      sellerScore = scores.sellerScore;
      buyerReviewCount = scores.buyerReviewCount;
      sellerReviewCount = scores.sellerReviewCount;
    }

    res.json({
      user: {
        _id: customer._id,
        uid: customer.uid,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        emailVerified: !!emailVerified,
        isActive: true,
        lastLogin: customer.lastLogin,
        createdAt: customer.createdAt
      },
      balance: customer.balance ?? 0,
      reviewCount: customer.reviewCount ?? 0,
      language: customer.language || 'en',
      buyerScore,
      sellerScore,
      buyerReviewCount,
      sellerReviewCount
    });
  } catch (error) {
    console.error('Error fetching customer profile:', error);
    res.status(500).json({
      error: 'Failed to load customer information',
      message: error.message
    });
  }
});

/**
 * PATCH /api/customers/language
 * Update the authenticated user's preferred language.
 */
router.patch('/language', authenticateToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const { language } = req.body;
    const allowed = ['en', 'pt', 'es', 'fr'];
    if (!allowed.includes(language)) {
      return res.status(400).json({ error: 'Invalid language code' });
    }
    await Customer.updateOne({ uid }, { $set: { language } });
    res.json({ language });
  } catch (error) {
    console.error('Error updating language:', error);
    res.status(500).json({ error: 'Failed to update language' });
  }
});

module.exports = router;
