const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const Customer = require('../models/Customer');

const router = express.Router();

/**
 * GET /api/customers/profile
 * Returns the authenticated customer's profile from the customers collection.
 * Creates a customer document if one doesn't exist (from Firebase token).
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
      reviewCount: customer.reviewCount ?? 0
    });
  } catch (error) {
    console.error('Error fetching customer profile:', error);
    res.status(500).json({
      error: 'Failed to load customer information',
      message: error.message
    });
  }
});

module.exports = router;
