const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../utils/roles');
const Customer = require('../models/Customer');
const NotificationPreferences = require('../models/NotificationPreferences');
const InterestedContact = require('../models/InterestedContact');
const ListingDraft = require('../models/ListingDraft');
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../services/templateEngine');
const { appendPreferencesFooter } = require('../services/emailPreferencesService');
const logger = require('../utils/logger');

const router = express.Router();

const TEST_EMAIL_RECIPIENT = 'josevcandido@gmail.com';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SEND_BATCH_SIZE = 10;
const CAMPAIGN_LANGUAGES = ['pt', 'en', 'es', 'fr'];

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function draftTitleFromPayload(payload) {
  return payload?.titlePt || payload?.titleEn || payload?.title || null;
}

/** Active customers, minus anyone who has globally unsubscribed from emails. Each recipient carries their language. */
async function getAllUsersRecipients() {
  const customers = await Customer.find({ accountStatus: 'active' }, '_id email language').lean();
  const unsubscribed = await NotificationPreferences.find(
    { globalEmailUnsubscribed: true },
    'user'
  ).lean();
  const unsubscribedIds = new Set(unsubscribed.map(p => String(p.user)));
  return customers
    .filter(c => !unsubscribedIds.has(String(c._id)))
    .map(c => ({ id: c._id, type: 'customer', email: c.email, language: c.language || 'en' }));
}

async function getInterestedRecipients() {
  const contacts = await InterestedContact.find({ unsubscribed: { $ne: true } }, 'email language').lean();
  return contacts.map(c => ({ id: c._id, type: 'interested', email: c.email, language: c.language || 'en' }));
}

/** Merged audience: customers + interested contacts, deduped by email (customer wins). */
async function getAllContactsRecipients() {
  const [customers, interested] = await Promise.all([getAllUsersRecipients(), getInterestedRecipients()]);
  const byEmail = new Map();
  for (const r of interested) {
    byEmail.set(String(r.email).toLowerCase(), r);
  }
  for (const r of customers) {
    byEmail.set(String(r.email).toLowerCase(), r);
  }
  return Array.from(byEmail.values());
}

async function resolveAudience(audience) {
  if (audience === 'all_users') return getAllUsersRecipients();
  if (audience === 'interested') return getInterestedRecipients();
  if (audience === 'all_contacts') return getAllContactsRecipients();
  return null;
}

/** content: { pt: {subject, html}, en: {...}, es: {...}, fr: {...} } — picks the recipient's language, falls back to en. */
async function sendInBatches(recipients, content) {
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async r => {
      const variant = content[r.language] || content.en;
      const html = await appendPreferencesFooter(variant.html, { type: r.type, id: r.id, language: r.language });
      return sendEmail(r.email, variant.subject, html);
    }));
    for (const result of results) {
      if (result.status === 'fulfilled') sent++;
      else failed++;
    }
  }
  return { total: recipients.length, sent, failed };
}

// ---- Unified contacts list (customers + interested) ----

router.get('/contacts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [customers, interested, unsubscribedPrefs] = await Promise.all([
      Customer.find(
        { accountStatus: { $ne: 'closed' } },
        'firstName lastName email language createdAt'
      ).lean(),
      InterestedContact.find({}).sort('-createdAt').lean(),
      NotificationPreferences.find({ globalEmailUnsubscribed: true }, 'user').lean()
    ]);

    const unsubscribedIds = new Set(unsubscribedPrefs.map(p => String(p.user)));
    const customerEmails = new Set(
      customers.map(c => String(c.email || '').toLowerCase()).filter(Boolean)
    );

    const contacts = [];

    for (const c of customers) {
      const name = `${c.firstName || ''} ${c.lastName || ''}`.trim();
      contacts.push({
        _id: c._id,
        type: 'customer',
        isCustomer: true,
        email: c.email,
        name: name || null,
        language: c.language || 'en',
        unsubscribed: unsubscribedIds.has(String(c._id)),
        createdAt: c.createdAt
      });
    }

    for (const c of interested) {
      const email = String(c.email || '').toLowerCase();
      // Skip interested rows already covered by a registered customer account.
      if (email && customerEmails.has(email)) continue;
      contacts.push({
        _id: c._id,
        type: 'interested',
        isCustomer: false,
        email: c.email,
        name: c.name || null,
        language: c.language || 'en',
        unsubscribed: !!c.unsubscribed,
        createdAt: c.createdAt
      });
    }

    contacts.sort((a, b) => {
      const ae = String(a.email || '').toLowerCase();
      const be = String(b.email || '').toLowerCase();
      return ae.localeCompare(be);
    });

    res.json({ contacts });
  } catch (err) {
    logger.error('GET /api/admin/emails/contacts error:', err);
    res.status(500).json({ error: 'Failed to load contacts.' });
  }
});

router.patch('/contacts/:type/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    if (!['customer', 'interested'].includes(type)) {
      return res.status(400).json({ error: 'Invalid contact type.' });
    }
    if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid ID.' });

    if (type === 'interested') {
      const update = {};
      if (req.body?.language !== undefined) {
        if (!CAMPAIGN_LANGUAGES.includes(req.body.language)) {
          return res.status(400).json({ error: 'Invalid language.' });
        }
        update.language = req.body.language;
      }
      if (typeof req.body?.unsubscribed === 'boolean') {
        update.unsubscribed = req.body.unsubscribed;
      }
      const contact = await InterestedContact.findByIdAndUpdate(id, update, { new: true }).lean();
      if (!contact) return res.status(404).json({ error: 'Contact not found.' });
      return res.json({
        contact: {
          _id: contact._id,
          type: 'interested',
          isCustomer: false,
          email: contact.email,
          name: contact.name || null,
          language: contact.language || 'en',
          unsubscribed: !!contact.unsubscribed,
          createdAt: contact.createdAt
        }
      });
    }

    // customer
    if (req.body?.language !== undefined) {
      if (!CAMPAIGN_LANGUAGES.includes(req.body.language)) {
        return res.status(400).json({ error: 'Invalid language.' });
      }
      const customer = await Customer.findByIdAndUpdate(
        id,
        { language: req.body.language },
        { new: true }
      ).lean();
      if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    } else {
      const exists = await Customer.exists({ _id: id });
      if (!exists) return res.status(404).json({ error: 'Customer not found.' });
    }

    if (typeof req.body?.unsubscribed === 'boolean') {
      await NotificationPreferences.findOneAndUpdate(
        { user: id },
        { $set: { globalEmailUnsubscribed: req.body.unsubscribed } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }

    const customer = await Customer.findById(id, 'firstName lastName email language createdAt').lean();
    const prefs = await NotificationPreferences.findOne({ user: id }, 'globalEmailUnsubscribed').lean();
    const name = `${customer.firstName || ''} ${customer.lastName || ''}`.trim();
    return res.json({
      contact: {
        _id: customer._id,
        type: 'customer',
        isCustomer: true,
        email: customer.email,
        name: name || null,
        language: customer.language || 'en',
        unsubscribed: !!prefs?.globalEmailUnsubscribed,
        createdAt: customer.createdAt
      }
    });
  } catch (err) {
    logger.error('PATCH /api/admin/emails/contacts/:type/:id error:', err);
    res.status(500).json({ error: 'Failed to update contact.' });
  }
});

// ---- Interested contacts list ----

router.get('/interested', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const contacts = await InterestedContact.find({}).sort('-createdAt').lean();
    res.json({ contacts });
  } catch (err) {
    logger.error('GET /api/admin/emails/interested error:', err);
    res.status(500).json({ error: 'Failed to load interested contacts.' });
  }
});

router.post('/interested', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = req.body?.name ? String(req.body.name).trim() : undefined;
    const language = req.body?.language;
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    if (language && !CAMPAIGN_LANGUAGES.includes(language)) {
      return res.status(400).json({ error: 'Invalid language.' });
    }
    const existing = await InterestedContact.findOne({ email }).lean();
    if (existing) {
      return res.status(409).json({ error: 'This email is already on the list.' });
    }
    const existingCustomer = await Customer.findOne({ email }, '_id').lean();
    if (existingCustomer) {
      return res.status(409).json({ error: 'This email already belongs to a registered customer. Find them in the contacts list.' });
    }
    const contact = await InterestedContact.create({ email, name, language });
    res.status(201).json({
      contact: {
        _id: contact._id,
        type: 'interested',
        isCustomer: false,
        email: contact.email,
        name: contact.name || null,
        language: contact.language || 'en',
        unsubscribed: !!contact.unsubscribed,
        createdAt: contact.createdAt
      }
    });
  } catch (err) {
    logger.error('POST /api/admin/emails/interested error:', err);
    res.status(500).json({ error: 'Failed to add contact.' });
  }
});

router.patch('/interested/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID.' });
    const update = {};
    if (req.body?.language !== undefined) {
      if (!CAMPAIGN_LANGUAGES.includes(req.body.language)) {
        return res.status(400).json({ error: 'Invalid language.' });
      }
      update.language = req.body.language;
    }
    if (req.body?.name !== undefined) {
      update.name = String(req.body.name).trim();
    }
    if (typeof req.body?.unsubscribed === 'boolean') {
      update.unsubscribed = req.body.unsubscribed;
    }
    const contact = await InterestedContact.findByIdAndUpdate(req.params.id, update, { new: true }).lean();
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    res.json({ contact });
  } catch (err) {
    logger.error('PATCH /api/admin/emails/interested/:id error:', err);
    res.status(500).json({ error: 'Failed to update contact.' });
  }
});

router.delete('/interested/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID.' });
    const deleted = await InterestedContact.findByIdAndDelete(req.params.id).lean();
    if (!deleted) return res.status(404).json({ error: 'Contact not found.' });
    res.json({ ok: true, deletedId: req.params.id });
  } catch (err) {
    logger.error('DELETE /api/admin/emails/interested/:id error:', err);
    res.status(500).json({ error: 'Failed to remove contact.' });
  }
});

// ---- Newsletter campaigns ----

router.get('/audience-count', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const recipients = await resolveAudience(req.query.audience);
    if (!recipients) return res.status(400).json({ error: 'Invalid audience.' });
    res.json({ count: recipients.length });
  } catch (err) {
    logger.error('GET /api/admin/emails/audience-count error:', err);
    res.status(500).json({ error: 'Failed to count audience.' });
  }
});

router.post('/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const subject = String(req.body?.subject || '').trim();
    const html = String(req.body?.html || '');
    const language = CAMPAIGN_LANGUAGES.includes(req.body?.language) ? req.body.language : 'pt';
    if (!subject || !html) return res.status(400).json({ error: 'Subject and HTML are required.' });

    // Prefer a real recipient record so the footer link works (unsubscribe / language).
    const testEmail = TEST_EMAIL_RECIPIENT.toLowerCase();
    let footerType = 'customer';
    let footerId = null;
    let footerLanguage = language;
    const customer = await Customer.findOne({ email: testEmail }, '_id language').lean();
    if (customer) {
      footerId = customer._id;
      footerLanguage = customer.language || language;
    } else {
      const contact = await InterestedContact.findOne({ email: testEmail }, '_id language').lean();
      if (contact) {
        footerType = 'interested';
        footerId = contact._id;
        footerLanguage = contact.language || language;
      }
    }

    const htmlWithFooter = await appendPreferencesFooter(html, {
      type: footerType,
      id: footerId,
      language: footerLanguage
    });
    await sendEmail(TEST_EMAIL_RECIPIENT, subject, htmlWithFooter);
    res.json({
      ok: true,
      to: TEST_EMAIL_RECIPIENT,
      preferencesLink: !!footerId
    });
  } catch (err) {
    logger.error('POST /api/admin/emails/test error:', err);
    res.status(500).json({ error: 'Failed to send test email.' });
  }
});

router.post('/send', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const audience = req.body?.audience;
    const content = req.body?.content || {};
    for (const lang of CAMPAIGN_LANGUAGES) {
      const variant = content[lang];
      if (!variant || !String(variant.subject || '').trim() || !String(variant.html || '').trim()) {
        return res.status(400).json({ error: `Missing subject/HTML for language "${lang}".` });
      }
    }

    const recipients = await resolveAudience(audience);
    if (!recipients) return res.status(400).json({ error: 'Invalid audience.' });
    if (recipients.length === 0) return res.status(400).json({ error: 'No recipients for this audience.' });

    const result = await sendInBatches(recipients, content);
    logger.info(`[AdminEmails] Campaign sent by ${req.user?.email}: ${result.sent}/${result.total} ok (audience=${audience})`);
    res.json(result);
  } catch (err) {
    logger.error('POST /api/admin/emails/send error:', err);
    res.status(500).json({ error: 'Failed to send campaign.' });
  }
});

// ---- Personalized: forgotten draft listings ----

router.get('/draft-reminders', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const drafts = await ListingDraft.find({
      $or: [
        { 'payload.titlePt': { $exists: true, $ne: '' } },
        { 'payload.titleEn': { $exists: true, $ne: '' } },
        { 'payload.title': { $exists: true, $ne: '' } }
      ]
    })
      .populate('seller', 'firstName lastName email language')
      .sort('-updatedAt')
      .limit(200)
      .lean();

    const frontendUrl = process.env.FRONTEND_URL || 'https://bidroom.pt';

    const rows = drafts
      .filter(d => d.seller?.email)
      .map(d => {
        const draftTitle = draftTitleFromPayload(d.payload);
        const language = d.seller.language || 'en';
        let previewSubject = '';
        let previewHtml = '';
        try {
          const rendered = renderEmailTemplate('draftReminder', language, {
            firstName: d.seller.firstName || 'there',
            draftTitle: draftTitle || '',
            resumeUrl: `${frontendUrl}/listing/add`
          });
          previewSubject = rendered.subject;
          previewHtml = rendered.html;
        } catch (renderErr) {
          logger.warn('[AdminEmails] Failed to render draftReminder preview:', renderErr.message);
        }
        return {
          _id: d._id,
          sellerId: d.seller._id,
          sellerName: `${d.seller.firstName || ''} ${d.seller.lastName || ''}`.trim(),
          sellerEmail: d.seller.email,
          draftTitle,
          updatedAt: d.updatedAt,
          draftReminderSent: !!d.draftReminderSent,
          previewSubject,
          previewHtml
        };
      });

    res.json({ drafts: rows });
  } catch (err) {
    logger.error('GET /api/admin/emails/draft-reminders error:', err);
    res.status(500).json({ error: 'Failed to load draft reminders.' });
  }
});

router.post('/draft-reminders/:draftId/send', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.draftId)) return res.status(400).json({ error: 'Invalid draft ID.' });
    const subject = String(req.body?.subject || '').trim();
    const html = String(req.body?.html || '');
    if (!subject || !html) return res.status(400).json({ error: 'Subject and HTML are required.' });

    const draft = await ListingDraft.findById(req.params.draftId).populate('seller', 'email language').lean();
    if (!draft) return res.status(404).json({ error: 'Draft not found.' });
    if (!draft.seller?.email) return res.status(400).json({ error: 'This draft has no seller email.' });

    const htmlWithFooter = await appendPreferencesFooter(html, {
      type: 'customer',
      id: draft.seller._id,
      language: draft.seller.language || 'en'
    });
    await sendEmail(draft.seller.email, subject, htmlWithFooter);
    await ListingDraft.updateOne({ _id: draft._id }, { draftReminderSent: true });

    res.json({ ok: true, sentTo: draft.seller.email });
  } catch (err) {
    logger.error('POST /api/admin/emails/draft-reminders/:draftId/send error:', err);
    res.status(500).json({ error: 'Failed to send reminder.' });
  }
});

// ---- Personalized: any customer ----

router.get('/customers/search', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ customers: [] });
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const customers = await Customer.find(
      { $or: [{ firstName: regex }, { lastName: regex }, { email: regex }] },
      'firstName lastName email language'
    )
      .limit(20)
      .lean();

    const prefs = await NotificationPreferences.find(
      { user: { $in: customers.map(c => c._id) }, globalEmailUnsubscribed: true },
      'user'
    ).lean();
    const unsubscribedIds = new Set(prefs.map(p => String(p.user)));

    res.json({
      customers: customers.map(c => ({ ...c, unsubscribed: unsubscribedIds.has(String(c._id)) }))
    });
  } catch (err) {
    logger.error('GET /api/admin/emails/customers/search error:', err);
    res.status(500).json({ error: 'Failed to search customers.' });
  }
});

router.patch('/customers/:customerId/preferences', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.customerId)) return res.status(400).json({ error: 'Invalid customer ID.' });

    if (req.body?.language !== undefined) {
      if (!CAMPAIGN_LANGUAGES.includes(req.body.language)) {
        return res.status(400).json({ error: 'Invalid language.' });
      }
      const customer = await Customer.findByIdAndUpdate(
        req.params.customerId,
        { language: req.body.language },
        { new: true }
      ).lean();
      if (!customer) return res.status(404).json({ error: 'Customer not found.' });
    } else {
      const exists = await Customer.exists({ _id: req.params.customerId });
      if (!exists) return res.status(404).json({ error: 'Customer not found.' });
    }

    if (typeof req.body?.unsubscribed === 'boolean') {
      await NotificationPreferences.findOneAndUpdate(
        { user: req.params.customerId },
        { $set: { globalEmailUnsubscribed: req.body.unsubscribed } },
        { upsert: true, setDefaultsOnInsert: true }
      );
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error('PATCH /api/admin/emails/customers/:customerId/preferences error:', err);
    res.status(500).json({ error: 'Failed to update preferences.' });
  }
});

router.post('/customers/:customerId/send', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.customerId)) return res.status(400).json({ error: 'Invalid customer ID.' });
    const subject = String(req.body?.subject || '').trim();
    const html = String(req.body?.html || '');
    if (!subject || !html) return res.status(400).json({ error: 'Subject and HTML are required.' });

    const customer = await Customer.findById(req.params.customerId, 'email language').lean();
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const htmlWithFooter = await appendPreferencesFooter(html, {
      type: 'customer',
      id: customer._id,
      language: customer.language || 'en'
    });
    await sendEmail(customer.email, subject, htmlWithFooter);
    res.json({ ok: true, sentTo: customer.email });
  } catch (err) {
    logger.error('POST /api/admin/emails/customers/:customerId/send error:', err);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

module.exports = router;
