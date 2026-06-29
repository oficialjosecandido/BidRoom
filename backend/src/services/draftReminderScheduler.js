'use strict';

const ListingDraft = require('../models/ListingDraft');
const { sendEmail }  = require('./emailService');
const { getEmailTemplate, getUserLanguage } = require('./emailTemplates');

const LOG_PREFIX  = '[DraftReminder]';
const BATCH_LIMIT = 100;
const DRAFT_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

let _timer = null;

function startDraftReminderScheduler(intervalMinutes = 60) {
  if (_timer) return;
  const ms = intervalMinutes * 60 * 1000;
  setTimeout(() => run().catch(e => console.error(LOG_PREFIX, 'startup:', e.message)), 5 * 60 * 1000);
  _timer = setInterval(() => run().catch(e => console.error(LOG_PREFIX, 'interval:', e.message)), ms);
  console.log(`${LOG_PREFIX} Scheduler started (every ${intervalMinutes}min).`);
}

function stopDraftReminderScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function run() {
  const cutoff = new Date(Date.now() - DRAFT_AGE_MS);

  const staleDrafts = await ListingDraft.find({
    updatedAt:          { $lte: cutoff },
    draftReminderSent:  { $ne: true },
    $or: [
      { 'payload.titlePt': { $exists: true, $ne: '' } },
      { 'payload.titleEn': { $exists: true, $ne: '' } },
      { 'payload.title':   { $exists: true, $ne: '' } },
    ],
  })
    .populate('seller', 'firstName email language')
    .limit(BATCH_LIMIT)
    .lean();

  if (!staleDrafts.length) return;
  console.log(`${LOG_PREFIX} Sending reminders for ${staleDrafts.length} stale draft(s).`);

  for (const draft of staleDrafts) {
    const seller = draft.seller;
    if (!seller?.email) continue;

    const draftTitle =
      draft.payload?.titlePt ||
      draft.payload?.titleEn ||
      draft.payload?.title ||
      null;

    const language = getUserLanguage(seller);
    const frontendUrl = process.env.FRONTEND_URL || 'https://bidroom.pt';

    try {
      const email = getEmailTemplate('draftReminder', language, {
        firstName:  seller.firstName || 'there',
        draftTitle: draftTitle || '',
        resumeUrl:  `${frontendUrl}/listing/add`,
      });
      await sendEmail(seller.email, email.subject, email.html);

      await ListingDraft.updateOne({ _id: draft._id }, { draftReminderSent: true });
      console.log(`${LOG_PREFIX} Sent to ${seller.email} (draft: ${draft._id})`);
    } catch (err) {
      console.error(`${LOG_PREFIX} Failed for draft ${draft._id}:`, err.message);
    }
  }
}

module.exports = { startDraftReminderScheduler, stopDraftReminderScheduler, run };
