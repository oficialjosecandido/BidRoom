const express = require('express');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const Customer = require('../models/Customer');
const User = require('../models/User');
const { getReviewScoresForUser } = require('../services/reviewService');
const { appendModerationAudit } = require('../services/moderationAuditService');
const { getClientIp } = require('../middleware/bidRateLimiter');

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

    // Resolve User by uid for review scores, Stripe Connect status, and account status
    const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
    const dbUser = await User.findOne({ uid }).select(
      '_id stripeConnectOnboarded accountStatus sellerClassification professionalVerificationStatus ' +
      'professionalLegalName professionalTradeName professionalAddressLine1 professionalAddressLine2 ' +
      'professionalCity professionalRegion professionalPostalCode professionalCountry professionalContactPhone ' +
      'professionalContactEmail professionalVatId professionalSubmittedAt professionalVerifiedAt ' +
      'professionalVerifiedByEmail professionalRejectionNote'
    ).lean();
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

      // In test/dev mode auto-mark as onboarded so manual Stripe setup isn't required
      if (isTestMode && !dbUser.stripeConnectOnboarded) {
        await User.updateOne({ uid }, { $set: { stripeConnectOnboarded: true } });
      }
    }

    const stripeConnectOnboarded = isTestMode ? true : !!(dbUser?.stripeConnectOnboarded);

    const sellerCompliance = dbUser
      ? {
          sellerClassification: dbUser.sellerClassification || 'private',
          professionalVerificationStatus: dbUser.professionalVerificationStatus || 'none',
          professionalLegalName: dbUser.professionalLegalName,
          professionalTradeName: dbUser.professionalTradeName,
          professionalAddressLine1: dbUser.professionalAddressLine1,
          professionalAddressLine2: dbUser.professionalAddressLine2,
          professionalCity: dbUser.professionalCity,
          professionalRegion: dbUser.professionalRegion,
          professionalPostalCode: dbUser.professionalPostalCode,
          professionalCountry: dbUser.professionalCountry,
          professionalContactPhone: dbUser.professionalContactPhone,
          professionalContactEmail: dbUser.professionalContactEmail,
          professionalVatId: dbUser.professionalVatId,
          professionalSubmittedAt: dbUser.professionalSubmittedAt,
          professionalVerifiedAt: dbUser.professionalVerifiedAt,
          professionalVerifiedByEmail: dbUser.professionalVerifiedByEmail,
          professionalRejectionNote: dbUser.professionalRejectionNote
        }
      : null;

    res.json({
      user: {
        _id: customer._id,
        uid: customer.uid,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        emailVerified: !!emailVerified,
        isActive: dbUser?.accountStatus !== 'suspended' && dbUser?.accountStatus !== 'closed',
        accountStatus: dbUser?.accountStatus || 'active',
        lastLogin: customer.lastLogin,
        createdAt: customer.createdAt
      },
      balance: customer.balance ?? 0,
      reviewCount: customer.reviewCount ?? 0,
      language: customer.language || 'en',
      buyerScore,
      sellerScore,
      buyerReviewCount,
      sellerReviewCount,
      stripeConnectOnboarded,
      sellerCompliance
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
 * PATCH /api/customers/seller-compliance
 * DSA: seller classification (private vs professional) and trader identity for professionals.
 */
router.patch('/seller-compliance', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const { uid } = req.user;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const classification = body.sellerClassification;
    if (!['private', 'professional'].includes(classification)) {
      return res.status(400).json({ error: 'Invalid sellerClassification', message: 'Must be "private" or "professional".' });
    }

    const user = await User.findOne({ uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const prevClass = user.sellerClassification || 'private';
    const prevStatus = user.professionalVerificationStatus || 'none';

    if (classification === 'private') {
      user.sellerClassification = 'private';
      user.professionalVerificationStatus = 'none';
      user.professionalLegalName = null;
      user.professionalTradeName = null;
      user.professionalAddressLine1 = null;
      user.professionalAddressLine2 = null;
      user.professionalCity = null;
      user.professionalRegion = null;
      user.professionalPostalCode = null;
      user.professionalCountry = null;
      user.professionalContactPhone = null;
      user.professionalContactEmail = null;
      user.professionalVatId = null;
      user.professionalSubmittedAt = null;
      user.professionalVerifiedAt = null;
      user.professionalVerifiedByEmail = null;
      user.professionalRejectionNote = null;
    } else {
      const take = (k, max) => {
        const v = body[k];
        if (v == null || String(v).trim() === '') return null;
        const s = String(v).trim();
        return s.length > max ? null : s;
      };

      const legalName = take('professionalLegalName', 300);
      const line1 = take('professionalAddressLine1', 300);
      const city = take('professionalCity', 120);
      const region = take('professionalRegion', 120);
      const postal = take('professionalPostalCode', 32);
      const countryRaw = take('professionalCountry', 2);
      const phone = take('professionalContactPhone', 40);
      const bizEmail = take('professionalContactEmail', 254);
      const vat = take('professionalVatId', 64);

      if (!legalName || !line1 || !city || !region || !postal || !countryRaw || !phone || !bizEmail || !vat) {
        return res.status(400).json({
          error: 'Missing or invalid fields',
          message:
            'Professional sellers must provide: professionalLegalName, professionalAddressLine1, professionalCity, professionalRegion, professionalPostalCode, professionalCountry (ISO-2), professionalContactPhone, professionalContactEmail, professionalVatId. Optional: professionalTradeName, professionalAddressLine2.'
        });
      }
      const country = countryRaw.toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) {
        return res.status(400).json({ error: 'Invalid country', message: 'professionalCountry must be a 2-letter ISO code.' });
      }

      const tradeName = body.professionalTradeName != null ? String(body.professionalTradeName).trim().slice(0, 300) : '';
      const line2 = body.professionalAddressLine2 != null ? String(body.professionalAddressLine2).trim().slice(0, 300) : '';

      const wasVerified = prevStatus === 'verified' && prevClass === 'professional';
      const samePayload =
        wasVerified &&
        (user.professionalLegalName || '') === legalName &&
        (user.professionalTradeName || '') === tradeName &&
        (user.professionalAddressLine1 || '') === line1 &&
        (user.professionalAddressLine2 || '') === line2 &&
        (user.professionalCity || '') === city &&
        (user.professionalRegion || '') === region &&
        (user.professionalPostalCode || '') === postal &&
        (user.professionalCountry || '') === country &&
        (user.professionalContactPhone || '') === phone &&
        (user.professionalContactEmail || '') === bizEmail.toLowerCase() &&
        (user.professionalVatId || '') === vat;

      user.sellerClassification = 'professional';
      user.professionalLegalName = legalName;
      user.professionalTradeName = tradeName || null;
      user.professionalAddressLine1 = line1;
      user.professionalAddressLine2 = line2 || null;
      user.professionalCity = city;
      user.professionalRegion = region;
      user.professionalPostalCode = postal;
      user.professionalCountry = country;
      user.professionalContactPhone = phone;
      user.professionalContactEmail = bizEmail.toLowerCase();
      user.professionalVatId = vat;
      user.professionalSubmittedAt = new Date();

      if (!wasVerified || !samePayload) {
        user.professionalVerificationStatus = 'pending';
        user.professionalVerifiedAt = null;
        user.professionalVerifiedByEmail = null;
        user.professionalRejectionNote = null;
      }
    }

    await user.save();

    await appendModerationAudit({
      subjectUserId: user._id,
      actionType: 'seller_compliance_updated',
      performedByEmail: req.user.email || null,
      metadata: {
        sellerClassification: user.sellerClassification,
        professionalVerificationStatus: user.professionalVerificationStatus,
        previousClassification: prevClass,
        previousVerificationStatus: prevStatus
      },
      ip: getClientIp(req)
    });

    res.json({
      sellerClassification: user.sellerClassification,
      professionalVerificationStatus: user.professionalVerificationStatus,
      professionalSubmittedAt: user.professionalSubmittedAt,
      message: classification === 'professional'
        ? 'Trader details saved. Your profile will show as pending until the platform verifies your information.'
        : 'You are now registered as a private (non-trader) seller.'
    });
  } catch (error) {
    console.error('Error updating seller compliance:', error);
    res.status(500).json({ error: 'Failed to update seller compliance', message: error.message });
  }
});

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
