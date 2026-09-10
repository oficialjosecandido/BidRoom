const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../utils/roles');
const Customer = require('../models/Customer');
const NotificationPreferences = require('../models/NotificationPreferences');
const InterestedContact = require('../models/InterestedContact');
const ListingDraft = require('../models/ListingDraft');
const EmailCampaign = require('../models/EmailCampaign');
const EmailDelivery = require('../models/EmailDelivery');
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../services/templateEngine');
const { appendPreferencesFooter } = require('../services/emailPreferencesService');
const { newTrackingToken, injectTrackingPixel } = require('../services/emailTrackingService');
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

/**
 * ISO-8601 week number and week-year for a date.
 *
 * ISO weeks start on Monday and belong to the year containing their Thursday,
 * which is why the week-year is returned alongside: 1 Jan can fall in week 52
 * of the previous year, and 31 Dec in week 1 of the next.
 */
function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Shift to the Thursday of this week (getUTCDay: Sunday = 0 → treat as 7).
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { isoWeek, isoYear };
}

/**
 * Records a send and returns the campaign document.
 *
 * `deliveries` are the per-recipient rows built during the send — they carry
 * the tracking tokens that were embedded in each message, so they must be
 * written even when the send failed (a failed row is how a bad address shows
 * up later).
 */
async function recordCampaign({ kind, audience, subject, content, deliveries, admin }) {
  const now = new Date();
  const { isoWeek, isoYear } = isoWeekOf(now);
  const sentCount = deliveries.filter(d => d.status === 'sent').length;

  const campaign = await EmailCampaign.create({
    kind,
    audience: audience || null,
    subject,
    content: content || null,
    isoWeek,
    isoYear,
    totalRecipients: deliveries.length,
    sentCount,
    failedCount: deliveries.length - sentCount,
    sentBy: admin?.id || admin?._id || null,
    sentByEmail: admin?.email || null
  });

  if (deliveries.length > 0) {
    await EmailDelivery.insertMany(
      deliveries.map(d => ({ ...d, campaign: campaign._id })),
      { ordered: false }
    );
  }

  return campaign;
}

/**
 * Sends one tracked message to one person and records it as its own campaign,
 * so a personalized email shows up in the same history as a newsletter.
 * Throws if the send fails — the caller decides the HTTP response.
 */
async function sendTrackedSingle({ kind, subject, html, recipient, admin }) {
  const language = recipient.language || 'en';
  const token = newTrackingToken();
  const withFooter = await appendPreferencesFooter(html, {
    type: recipient.type,
    id: recipient.id,
    language
  });

  let error = null;
  try {
    await sendEmail(recipient.email, subject, injectTrackingPixel(withFooter, token));
  } catch (err) {
    error = String(err?.message || err).slice(0, 500);
  }

  await recordCampaign({
    kind,
    audience: null,
    subject,
    content: null,
    admin,
    deliveries: [{
      recipientType: recipient.type,
      recipient: recipient.id || null,
      email: recipient.email,
      language,
      status: error ? 'failed' : 'sent',
      trackingToken: token,
      ...(error ? { error } : {})
    }]
  });

  if (error) throw new Error(error);
}

/**
 * content: { pt: {subject, html}, en: {...}, es: {...}, fr: {...} } — picks the
 * recipient's language, falls back to en.
 *
 * Each message gets its own tracking token, so an open can be attributed to a
 * specific recipient rather than only counted in aggregate.
 */
async function sendInBatches(recipients, content) {
  const deliveries = [];
  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += SEND_BATCH_SIZE) {
    const batch = recipients.slice(i, i + SEND_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async r => {
      const variant = content[r.language] || content.en;
      const token = newTrackingToken();
      const withFooter = await appendPreferencesFooter(variant.html, { type: r.type, id: r.id, language: r.language });
      await sendEmail(r.email, variant.subject, injectTrackingPixel(withFooter, token));
      return token;
    }));

    results.forEach((result, idx) => {
      const r = batch[idx];
      const base = {
        recipientType: r.type,
        recipient: r.id || null,
        email: r.email,
        language: r.language
      };
      if (result.status === 'fulfilled') {
        sent++;
        deliveries.push({ ...base, status: 'sent', trackingToken: result.value });
      } else {
        failed++;
        // The token was generated inside the failed task and is unrecoverable
        // here; a fresh one keeps the unique index satisfied and is never used.
        deliveries.push({
          ...base,
          status: 'failed',
          trackingToken: newTrackingToken(),
          error: String(result.reason?.message || result.reason || 'Unknown error').slice(0, 500)
        });
      }
    });
  }

  return { total: recipients.length, sent, failed, deliveries };
}

// ---- Unified contacts list (customers + interested) ----

router.get('/contacts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [customers, interested, unsubscribedPrefs, deliveryStats] = await Promise.all([
      Customer.find(
        { accountStatus: { $ne: 'closed' } },
        'firstName lastName email language createdAt'
      ).lean(),
      InterestedContact.find({}).sort('-createdAt').lean(),
      NotificationPreferences.find({ globalEmailUnsubscribed: true }, 'user').lean(),
      // Rolled up by address rather than by contact id: a person can exist both
      // as an interested contact and, later, as a customer, and the address is
      // what the two have in common.
      EmailDelivery.aggregate([
        { $match: { status: 'sent' } },
        {
          $group: {
            _id: '$email',
            received: { $sum: 1 },
            opened: { $sum: { $cond: [{ $ne: ['$openedAt', null] }, 1, 0] } },
            lastSentAt: { $max: '$createdAt' }
          }
        }
      ])
    ]);

    const statsByEmail = new Map(deliveryStats.map(s => [String(s._id || '').toLowerCase(), s]));
    const statsFor = email => {
      const s = statsByEmail.get(String(email || '').toLowerCase());
      return {
        emailsReceived: s?.received || 0,
        emailsOpened: s?.opened || 0,
        lastEmailAt: s?.lastSentAt || null
      };
    };

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
        createdAt: c.createdAt,
        ...statsFor(c.email)
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
        createdAt: c.createdAt,
        ...statsFor(c.email)
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

    const { deliveries, ...result } = await sendInBatches(recipients, content);

    const campaign = await recordCampaign({
      kind: 'newsletter',
      audience,
      subject: content.pt?.subject || content.en?.subject || '(sem assunto)',
      content,
      deliveries,
      admin: req.user
    });

    logger.info(`[AdminEmails] Campaign sent by ${req.user?.email}: ${result.sent}/${result.total} ok (audience=${audience})`);
    res.json({ ...result, campaignId: campaign._id });
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

    await sendTrackedSingle({
      kind: 'draft-reminder',
      subject,
      html,
      recipient: {
        type: 'customer',
        id: draft.seller._id,
        email: draft.seller.email,
        language: draft.seller.language || 'en'
      },
      admin: req.user
    });
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

    await sendTrackedSingle({
      kind: 'personalized',
      subject,
      html,
      recipient: {
        type: 'customer',
        id: customer._id,
        email: customer.email,
        language: customer.language || 'en'
      },
      admin: req.user
    });
    res.json({ ok: true, sentTo: customer.email });
  } catch (err) {
    logger.error('POST /api/admin/emails/customers/:customerId/send error:', err);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

// ---- Sent history ----

/**
 * One row per send, newest first, with the open rollup joined in.
 *
 * Opens are counted live from EmailDelivery rather than denormalised onto the
 * campaign — they keep arriving for days after a send, and a stored counter
 * would need the pixel endpoint to write twice on every hit.
 */
router.get('/campaigns', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

    const [campaigns, total] = await Promise.all([
      EmailCampaign.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      EmailCampaign.countDocuments({})
    ]);

    const openStats = campaigns.length
      ? await EmailDelivery.aggregate([
          { $match: { campaign: { $in: campaigns.map(c => c._id) }, status: 'sent' } },
          {
            $group: {
              _id: '$campaign',
              opened: { $sum: { $cond: [{ $ne: ['$openedAt', null] }, 1, 0] } },
              totalOpens: { $sum: '$openCount' }
            }
          }
        ])
      : [];
    const openByCampaign = new Map(openStats.map(s => [String(s._id), s]));

    res.json({
      total,
      campaigns: campaigns.map(c => {
        const stats = openByCampaign.get(String(c._id));
        const opened = stats?.opened || 0;
        return {
          _id: c._id,
          kind: c.kind,
          audience: c.audience,
          subject: c.subject,
          isoWeek: c.isoWeek,
          isoYear: c.isoYear,
          // "S30/2026" — the label the history list is read by.
          weekLabel: `S${String(c.isoWeek).padStart(2, '0')}/${c.isoYear}`,
          sentAt: c.createdAt,
          sentByEmail: c.sentByEmail,
          totalRecipients: c.totalRecipients,
          sentCount: c.sentCount,
          failedCount: c.failedCount,
          openedCount: opened,
          totalOpens: stats?.totalOpens || 0,
          openRate: c.sentCount > 0 ? Math.round((opened / c.sentCount) * 100) : 0
        };
      })
    });
  } catch (err) {
    logger.error('GET /api/admin/emails/campaigns error:', err);
    res.status(500).json({ error: 'Failed to load campaign history.' });
  }
});

/** Per-recipient detail for one send: who got it and who opened it. */
router.get('/campaigns/:id/deliveries', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid campaign ID.' });

    const deliveries = await EmailDelivery.find(
      { campaign: req.params.id },
      // trackingToken is deliberately excluded: it is a capability to mark an
      // open, and nothing in the admin UI needs it.
      'email recipientType language status error openedAt lastOpenedAt openCount createdAt'
    )
      .sort({ openedAt: -1, email: 1 })
      .lean();

    res.json({ deliveries });
  } catch (err) {
    logger.error('GET /api/admin/emails/campaigns/:id/deliveries error:', err);
    res.status(500).json({ error: 'Failed to load campaign deliveries.' });
  }
});

module.exports = router;
