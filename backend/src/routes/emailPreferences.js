const express = require('express');
const rateLimit = require('express-rate-limit');
const NotificationPreferences = require('../models/NotificationPreferences');
const { findByToken } = require('../services/emailPreferencesService');
const logger = require('../utils/logger');

const router = express.Router();

const LANGUAGES = ['pt', 'en', 'es', 'fr'];
const VALID_TYPES = ['customer', 'interested'];

const preferencesLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Please try again later.' }
});

function parseTokenAndType(req) {
  const token = req.query?.token || req.body?.token;
  const type = req.query?.type || req.body?.type;
  if (!token || typeof token !== 'string') return { error: 'Invalid link.' };
  if (!VALID_TYPES.includes(type)) return { error: 'Invalid link.' };
  return { token, type };
}

/** GET /api/email-preferences?token=&type= (public) — current language + subscription state */
router.get('/', preferencesLimiter, async (req, res) => {
  const { token, type, error } = parseTokenAndType(req);
  if (error) return res.status(400).json({ error });
  try {
    const doc = await findByToken(type, token);
    if (!doc) return res.status(404).json({ error: 'Link not recognised.' });

    let unsubscribed = false;
    if (type === 'customer') {
      const prefs = await NotificationPreferences.findOne({ user: doc._id }, 'globalEmailUnsubscribed').lean();
      unsubscribed = !!prefs?.globalEmailUnsubscribed;
    } else {
      unsubscribed = !!doc.unsubscribed;
    }

    res.json({ email: doc.email, language: doc.language || 'en', unsubscribed });
  } catch (err) {
    logger.error('GET /api/email-preferences error:', err);
    res.status(500).json({ error: 'Failed to load preferences.' });
  }
});

/** POST /api/email-preferences/unsubscribe (public) */
router.post('/unsubscribe', preferencesLimiter, async (req, res) => {
  const { token, type, error } = parseTokenAndType(req);
  if (error) return res.status(400).json({ error });
  try {
    const doc = await findByToken(type, token);
    if (!doc) return res.status(404).json({ error: 'Link not recognised.' });

    if (type === 'customer') {
      await NotificationPreferences.findOneAndUpdate(
        { user: doc._id },
        { $set: { globalEmailUnsubscribed: true } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    } else {
      doc.unsubscribed = true;
      await doc.save();
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /api/email-preferences/unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe.' });
  }
});

/** POST /api/email-preferences/resubscribe (public) */
router.post('/resubscribe', preferencesLimiter, async (req, res) => {
  const { token, type, error } = parseTokenAndType(req);
  if (error) return res.status(400).json({ error });
  try {
    const doc = await findByToken(type, token);
    if (!doc) return res.status(404).json({ error: 'Link not recognised.' });

    if (type === 'customer') {
      await NotificationPreferences.findOneAndUpdate(
        { user: doc._id },
        { $set: { globalEmailUnsubscribed: false } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    } else {
      doc.unsubscribed = false;
      await doc.save();
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('POST /api/email-preferences/resubscribe error:', err);
    res.status(500).json({ error: 'Failed to resubscribe.' });
  }
});

/** POST /api/email-preferences/language (public) */
router.post('/language', preferencesLimiter, async (req, res) => {
  const { token, type, error } = parseTokenAndType(req);
  if (error) return res.status(400).json({ error });
  const language = req.body?.language;
  if (!LANGUAGES.includes(language)) return res.status(400).json({ error: 'Invalid language.' });
  try {
    const doc = await findByToken(type, token);
    if (!doc) return res.status(404).json({ error: 'Link not recognised.' });

    doc.language = language;
    await doc.save();

    res.json({ ok: true, language });
  } catch (err) {
    logger.error('POST /api/email-preferences/language error:', err);
    res.status(500).json({ error: 'Failed to update language.' });
  }
});

module.exports = router;
