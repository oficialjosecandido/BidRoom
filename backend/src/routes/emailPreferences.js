const express = require('express');
const rateLimit = require('express-rate-limit');
const NotificationPreferences = require('../models/NotificationPreferences');
const {
  findByToken,
  findByEmail,
  normalizeEmail
} = require('../services/emailPreferencesService');
const logger = require('../utils/logger');

const router = express.Router();

const LANGUAGES = ['pt', 'en', 'es', 'fr'];
const VALID_TYPES = ['customer', 'interested'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function parseEmailPair(req) {
  const email = normalizeEmail(req.body?.email);
  const emailConfirm = normalizeEmail(req.body?.emailConfirm);
  if (!EMAIL_REGEX.test(email)) return { error: 'Introduza um email válido.' };
  if (!emailConfirm) return { error: 'Repita o email para confirmar.' };
  if (email !== emailConfirm) return { error: 'Os emails não coincidem.' };
  return { email };
}

async function resolveRecipient(req) {
  const token = req.query?.token || req.body?.token;
  const type = req.query?.type || req.body?.type;
  if (token && type) {
    if (!VALID_TYPES.includes(type)) return { error: 'Invalid link.', status: 400 };
    const doc = await findByToken(type, token);
    if (!doc) return { error: 'Link not recognised.', status: 404 };
    return { type, doc };
  }

  const pair = parseEmailPair(req);
  if (pair.error) return { error: pair.error, status: 400 };
  const found = await findByEmail(pair.email);
  if (!found) return { error: 'Não encontrámos este email na nossa lista.', status: 404 };
  return found;
}

async function getUnsubscribedState(type, doc) {
  if (type === 'customer') {
    const prefs = await NotificationPreferences.findOne({ user: doc._id }, 'globalEmailUnsubscribed').lean();
    return !!prefs?.globalEmailUnsubscribed;
  }
  return !!doc.unsubscribed;
}

/** GET /api/email-preferences?token=&type= (public) — current language + subscription state */
router.get('/', preferencesLimiter, async (req, res) => {
  const { token, type, error } = parseTokenAndType(req);
  if (error) return res.status(400).json({ error });
  try {
    const doc = await findByToken(type, token);
    if (!doc) return res.status(404).json({ error: 'Link not recognised.' });

    const unsubscribed = await getUnsubscribedState(type, doc);
    res.json({ email: doc.email, language: doc.language || 'en', unsubscribed, type });
  } catch (err) {
    logger.error('GET /api/email-preferences error:', err);
    res.status(500).json({ error: 'Failed to load preferences.' });
  }
});

/** POST /api/email-preferences/lookup (public) — load prefs by email + confirmation */
router.post('/lookup', preferencesLimiter, async (req, res) => {
  const pair = parseEmailPair(req);
  if (pair.error) return res.status(400).json({ error: pair.error });
  try {
    const found = await findByEmail(pair.email);
    if (!found) return res.status(404).json({ error: 'Não encontrámos este email na nossa lista.' });

    const unsubscribed = await getUnsubscribedState(found.type, found.doc);
    res.json({
      email: found.doc.email,
      language: found.doc.language || 'en',
      unsubscribed,
      type: found.type
    });
  } catch (err) {
    logger.error('POST /api/email-preferences/lookup error:', err);
    res.status(500).json({ error: 'Failed to load preferences.' });
  }
});

/** POST /api/email-preferences/unsubscribe (public) — token or email+confirm */
router.post('/unsubscribe', preferencesLimiter, async (req, res) => {
  try {
    const resolved = await resolveRecipient(req);
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
    const { type, doc } = resolved;

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

/** POST /api/email-preferences/resubscribe (public) — token or email+confirm */
router.post('/resubscribe', preferencesLimiter, async (req, res) => {
  try {
    const resolved = await resolveRecipient(req);
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
    const { type, doc } = resolved;

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

/** POST /api/email-preferences/language (public) — token or email+confirm */
router.post('/language', preferencesLimiter, async (req, res) => {
  const language = req.body?.language;
  if (!LANGUAGES.includes(language)) return res.status(400).json({ error: 'Invalid language.' });
  try {
    const resolved = await resolveRecipient(req);
    if (resolved.error) return res.status(resolved.status || 400).json({ error: resolved.error });
    const { doc } = resolved;

    doc.language = language;
    await doc.save();

    res.json({ ok: true, language });
  } catch (err) {
    logger.error('POST /api/email-preferences/language error:', err);
    res.status(500).json({ error: 'Failed to update language.' });
  }
});

module.exports = router;
