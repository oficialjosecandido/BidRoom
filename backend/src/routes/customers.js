const express = require('express');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const Customer = require('../models/Customer');
const { getReviewScoresForUser } = require('../services/reviewService');
const { appendModerationAudit } = require('../services/moderationAuditService');
const { getClientIp } = require('../middleware/bidRateLimiter');

const router = express.Router();

/**
 * GET /api/customers/profile
 * Returns the authenticated customer's profile.
 * Creates the document if it doesn't exist yet (first login via Firebase).
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

    const isTestMode = process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_');
    if (isTestMode && !customer.stripeConnectOnboarded) {
      await Customer.updateOne({ uid }, { $set: { stripeConnectOnboarded: true } });
      customer.stripeConnectOnboarded = true;
    }

    const scores = await getReviewScoresForUser(customer._id);

    const sellerCompliance = {
      sellerClassification: customer.sellerClassification || 'private',
      professionalVerificationStatus: customer.professionalVerificationStatus || 'none',
      professionalLegalName: customer.professionalLegalName || null,
      professionalTradeName: customer.professionalTradeName || null,
      professionalAddressLine1: customer.professionalAddressLine1 || null,
      professionalAddressLine2: customer.professionalAddressLine2 || null,
      professionalCity: customer.professionalCity || null,
      professionalRegion: customer.professionalRegion || null,
      professionalPostalCode: customer.professionalPostalCode || null,
      professionalCountry: customer.professionalCountry || null,
      professionalContactPhone: customer.professionalContactPhone || null,
      professionalContactEmail: customer.professionalContactEmail || null,
      professionalVatId: customer.professionalVatId || null,
      professionalSubmittedAt: customer.professionalSubmittedAt || null,
      professionalVerifiedAt: customer.professionalVerifiedAt || null,
      professionalVerifiedByEmail: customer.professionalVerifiedByEmail || null,
      professionalRejectionNote: customer.professionalRejectionNote || null
    };

    res.json({
      user: {
        _id: customer._id,
        uid: customer.uid,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        emailVerified: !!emailVerified,
        isActive: customer.accountStatus !== 'suspended' && customer.accountStatus !== 'closed',
        accountStatus: customer.accountStatus || 'active',
        contentRestrictedUntil: customer.contentRestrictedUntil || null,
        lastLogin: customer.lastLogin,
        createdAt: customer.createdAt
      },
      balance: customer.balance ?? 0,
      reviewCount: customer.reviewCount ?? 0,
      language: customer.language || 'en',
      buyerScore: scores.buyerScore,
      sellerScore: scores.sellerScore,
      buyerReviewCount: scores.buyerReviewCount,
      sellerReviewCount: scores.sellerReviewCount,
      stripeConnectOnboarded: isTestMode ? true : !!(customer.stripeConnectOnboarded),
      sellerCompliance,
      dsaWarning: {
        warningIssuedAt: customer.dsaWarningIssuedAt || null,
        acknowledgedAt: customer.dsaWarningAcknowledgedAt || null,
        response: customer.dsaWarningResponse || null,
        suspectedProfessional: !!customer.suspectedProfessional,
        listingRestricted: !!customer.dsaListingRestricted
      },
      theme: customer.theme && ['light', 'dark', 'system'].includes(customer.theme) ? customer.theme : null,
      cookieConsent: customer.cookieConsent && ['all', 'essential'].includes(customer.cookieConsent) ? customer.cookieConsent : null
    });
  } catch (error) {
    console.error('Error fetching customer profile:', error);
    res.status(500).json({
      error: 'Failed to load customer information',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
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

    const customer = await Customer.findOne({ uid });
    if (!customer) {
      return res.status(404).json({ error: 'User not found' });
    }

    const prevClass = customer.sellerClassification || 'private';
    const prevStatus = customer.professionalVerificationStatus || 'none';

    if (classification === 'private') {
      customer.sellerClassification = 'private';
      customer.professionalVerificationStatus = 'none';
      customer.professionalLegalName = null;
      customer.professionalTradeName = null;
      customer.professionalAddressLine1 = null;
      customer.professionalAddressLine2 = null;
      customer.professionalCity = null;
      customer.professionalRegion = null;
      customer.professionalPostalCode = null;
      customer.professionalCountry = null;
      customer.professionalContactPhone = null;
      customer.professionalContactEmail = null;
      customer.professionalVatId = null;
      customer.professionalSubmittedAt = null;
      customer.professionalVerifiedAt = null;
      customer.professionalVerifiedByEmail = null;
      customer.professionalRejectionNote = null;
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
        (customer.professionalLegalName || '') === legalName &&
        (customer.professionalTradeName || '') === tradeName &&
        (customer.professionalAddressLine1 || '') === line1 &&
        (customer.professionalAddressLine2 || '') === line2 &&
        (customer.professionalCity || '') === city &&
        (customer.professionalRegion || '') === region &&
        (customer.professionalPostalCode || '') === postal &&
        (customer.professionalCountry || '') === country &&
        (customer.professionalContactPhone || '') === phone &&
        (customer.professionalContactEmail || '') === bizEmail.toLowerCase() &&
        (customer.professionalVatId || '') === vat;

      customer.sellerClassification = 'professional';
      customer.professionalLegalName = legalName;
      customer.professionalTradeName = tradeName || null;
      customer.professionalAddressLine1 = line1;
      customer.professionalAddressLine2 = line2 || null;
      customer.professionalCity = city;
      customer.professionalRegion = region;
      customer.professionalPostalCode = postal;
      customer.professionalCountry = country;
      customer.professionalContactPhone = phone;
      customer.professionalContactEmail = bizEmail.toLowerCase();
      customer.professionalVatId = vat;
      customer.professionalSubmittedAt = new Date();

      if (!wasVerified || !samePayload) {
        customer.professionalVerificationStatus = 'pending';
        customer.professionalVerifiedAt = null;
        customer.professionalVerifiedByEmail = null;
        customer.professionalRejectionNote = null;
      }
    }

    await customer.save();

    await appendModerationAudit({
      subjectUserId: customer._id,
      actionType: 'seller_compliance_updated',
      performedByEmail: req.user.email || null,
      metadata: {
        sellerClassification: customer.sellerClassification,
        professionalVerificationStatus: customer.professionalVerificationStatus,
        previousClassification: prevClass,
        previousVerificationStatus: prevStatus
      },
      ip: getClientIp(req)
    });

    res.json({
      sellerClassification: customer.sellerClassification,
      professionalVerificationStatus: customer.professionalVerificationStatus,
      professionalSubmittedAt: customer.professionalSubmittedAt,
      message: classification === 'professional'
        ? 'Trader details saved. Your profile will show as pending until the platform verifies your information.'
        : 'You are now registered as a private (non-trader) seller.'
    });
  } catch (error) {
    console.error('Error updating seller compliance:', error);
    res.status(500).json({ error: 'Failed to update seller compliance', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * PATCH /api/customers/theme
 * Persist UI theme preference (light / dark / system) for cross-device sync.
 */
router.patch('/theme', authenticateToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const { theme } = req.body || {};
    if (!['light', 'dark', 'system'].includes(theme)) {
      return res.status(400).json({ error: 'Invalid theme', message: 'theme must be "light", "dark", or "system".' });
    }
    await Customer.updateOne({ uid }, { $set: { theme } });
    res.json({ theme });
  } catch (error) {
    console.error('Error updating customer theme:', error);
    res.status(500).json({ error: 'Failed to update theme', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * PATCH /api/customers/cookie-consent
 * Persist cookie consent level (all / essential) for cross-device sync.
 */
router.patch('/cookie-consent', authenticateToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const { cookieConsent } = req.body || {};
    if (!['all', 'essential'].includes(cookieConsent)) {
      return res.status(400).json({ error: 'Invalid value', message: 'cookieConsent must be "all" or "essential".' });
    }
    await Customer.updateOne({ uid }, { $set: { cookieConsent } });
    res.json({ cookieConsent });
  } catch (error) {
    console.error('Error updating cookie consent:', error);
    res.status(500).json({ error: 'Failed to update cookie consent' });
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

/**
 * POST /api/customers/dsa-warning-response
 * Seller acknowledges the DSA threshold warning and declares their status:
 *   - 'remain_private'       : stays private but is flagged internally as suspected_professional
 *   - 'switch_professional'  : intends to submit trader details (verification handled via seller-compliance)
 */
router.post('/dsa-warning-response', authenticateToken, async (req, res) => {
  try {
    const { response } = req.body;
    if (!['remain_private', 'switch_professional'].includes(response)) {
      return res.status(400).json({ error: 'Invalid response. Use "remain_private" or "switch_professional".' });
    }

    const customer = await Customer.findOne({ uid: req.user.uid }).select(
      '_id dsaWarningIssuedAt dsaWarningAcknowledgedAt'
    );
    if (!customer) return res.status(404).json({ error: 'User not found.' });
    if (!customer.dsaWarningIssuedAt) {
      return res.status(400).json({ error: 'No active DSA warning for this account.' });
    }

    const now = new Date();
    const update = {
      dsaWarningAcknowledgedAt: now,
      dsaWarningResponse: response
    };
    if (response === 'remain_private') {
      update.suspectedProfessional = true;
    } else {
      update.suspectedProfessional = false;
      update.dsaListingRestricted = false;
    }

    await Customer.updateOne({ _id: customer._id }, { $set: update });
    return res.json({ ok: true, response });
  } catch (err) {
    console.error('POST /dsa-warning-response error:', err);
    res.status(500).json({ error: 'Failed to record DSA warning response.' });
  }
});

/**
 * GET /api/customers/payment-config
 * Returns the authenticated seller's payment configuration.
 */
router.get('/payment-config', authenticateToken, async (req, res) => {
  try {
    const customer = await Customer.findOne({ uid: req.user.uid }).select('sellerPaymentConfig').lean();
    if (!customer) return res.status(404).json({ error: 'User not found' });
    res.json({ paymentConfig: customer.sellerPaymentConfig ?? {} });
  } catch (err) {
    console.error('GET /payment-config error:', err);
    res.status(500).json({ error: 'Failed to fetch payment config' });
  }
});

/**
 * PUT /api/customers/payment-config
 * Updates the authenticated seller's payment configuration.
 * Body: { inPerson, bankTransfer: { enabled, iban, accountName }, mbway: { enabled, phone } }
 */
router.put('/payment-config', authenticateToken, async (req, res) => {
  try {
    const { inPerson, bankTransfer, mbway } = req.body;
    const $set = {};

    if (typeof inPerson === 'boolean') {
      $set['sellerPaymentConfig.inPerson'] = inPerson;
    }
    if (bankTransfer !== undefined && typeof bankTransfer === 'object') {
      if (typeof bankTransfer.enabled === 'boolean') {
        $set['sellerPaymentConfig.bankTransfer.enabled'] = bankTransfer.enabled;
      }
      if (typeof bankTransfer.iban === 'string') {
        $set['sellerPaymentConfig.bankTransfer.iban'] = bankTransfer.iban.replace(/\s/g, '').toUpperCase() || null;
      }
      if (typeof bankTransfer.accountName === 'string') {
        $set['sellerPaymentConfig.bankTransfer.accountName'] = bankTransfer.accountName.trim() || null;
      }
    }
    if (mbway !== undefined && typeof mbway === 'object') {
      if (typeof mbway.enabled === 'boolean') {
        $set['sellerPaymentConfig.mbway.enabled'] = mbway.enabled;
      }
      if (typeof mbway.phone === 'string') {
        $set['sellerPaymentConfig.mbway.phone'] = mbway.phone.trim() || null;
      }
    }

    const customer = await Customer.findOneAndUpdate(
      { uid: req.user.uid },
      { $set },
      { new: true }
    ).select('sellerPaymentConfig').lean();

    if (!customer) return res.status(404).json({ error: 'User not found' });
    res.json({ paymentConfig: customer.sellerPaymentConfig });
  } catch (err) {
    console.error('PUT /payment-config error:', err);
    res.status(500).json({ error: 'Failed to save payment config' });
  }
});

module.exports = router;
