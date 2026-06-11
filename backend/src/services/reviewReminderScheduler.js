/**
 * Review Reminder Scheduler
 *
 * Runs every 30 minutes. For transactions completed in the last 30 days,
 * sends in-app notifications to whichever party has not yet reviewed at
 * three milestones after completedAt: 24h, 48h, and 7 days.
 *
 * Each milestone is sent only once per transaction (tracked in reviewRemindersSent).
 * Notifications are sent only to parties that have not yet reviewed.
 */

'use strict';

const Transaction = require('../models/Transaction');
const Review      = require('../models/Review');
const { notifyReviewReminder } = require('./notificationService');

const LOG_PREFIX = '[ReviewReminder]';
const BATCH_LIMIT = 200;

const MILESTONES = [
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: '48h', ms: 48 * 60 * 60 * 1000 },
  { key: '7d',  ms:  7 * 24 * 60 * 60 * 1000 },
];

// Ignore transactions completed more than 30 days ago (review window expired).
const REVIEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

let _timer = null;

function startReviewReminderScheduler(intervalMinutes = 30, io = null) {
  if (_timer) return;
  const ms = intervalMinutes * 60 * 1000;
  // First run 3 minutes after startup so the DB is fully warmed up.
  setTimeout(() => run(io).catch(e => console.error(LOG_PREFIX, 'startup:', e.message)), 3 * 60 * 1000);
  _timer = setInterval(() => run(io).catch(e => console.error(LOG_PREFIX, 'interval:', e.message)), ms);
  console.log(`${LOG_PREFIX} Scheduler started (every ${intervalMinutes}min).`);
}

function stopReviewReminderScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

async function run(io) {
  const now      = Date.now();
  const earliest = new Date(now - REVIEW_WINDOW_MS);

  // Load completed transactions within the review window that still have
  // at least one reminder milestone to send.
  const transactions = await Transaction.find({
    transactionStatus: 'completed',
    completedAt: { $gte: earliest, $lte: new Date(now - MILESTONES[0].ms) }
  })
    .select('_id listing seller buyer completedAt reviewRemindersSent')
    .populate('listing', 'title')
    .limit(BATCH_LIMIT)
    .lean();

  if (transactions.length === 0) return;

  // Batch-load all reviews for these listings to avoid N+1 queries.
  const listingIds = [...new Set(transactions.map(t => (t.listing?._id || t.listing)?.toString()).filter(Boolean))];
  const existingReviews = await Review.find({ listing: { $in: listingIds } })
    .select('listing reviewer role')
    .lean();

  // Build sets: listingId → Set of reviewer IDs who already reviewed
  const reviewedByListing = {};
  for (const r of existingReviews) {
    const lid = r.listing?.toString();
    if (!lid) continue;
    if (!reviewedByListing[lid]) reviewedByListing[lid] = new Set();
    reviewedByListing[lid].add(r.reviewer?.toString());
  }

  let sent = 0;

  for (const tx of transactions) {
    const completedMs = new Date(tx.completedAt).getTime();
    const elapsed     = now - completedMs;
    const alreadySent = new Set(tx.reviewRemindersSent || []);

    const lid         = (tx.listing?._id || tx.listing)?.toString();
    const reviewed    = reviewedByListing[lid] || new Set();
    const buyerId     = tx.buyer?.toString();
    const sellerId    = tx.seller?.toString();

    const buyerHasReviewed  = !!buyerId  && reviewed.has(buyerId);
    const sellerHasReviewed = !!sellerId && reviewed.has(sellerId);

    // Both reviewed — nothing to do.
    if (buyerHasReviewed && sellerHasReviewed) continue;

    const milestonesDue = MILESTONES.filter(m => elapsed >= m.ms && !alreadySent.has(m.key));
    if (milestonesDue.length === 0) continue;

    for (const milestone of milestonesDue) {
      try {
        await notifyReviewReminder({
          buyerId,
          sellerId,
          listingTitle: tx.listing?.title || null,
          transactionId: tx._id.toString(),
          milestone: milestone.key,
          buyerHasReviewed,
          sellerHasReviewed,
          io
        });

        await Transaction.updateOne(
          { _id: tx._id },
          { $addToSet: { reviewRemindersSent: milestone.key } }
        );

        sent++;
      } catch (err) {
        console.error(`${LOG_PREFIX} Failed to send ${milestone.key} reminder for tx ${tx._id}:`, err.message);
      }
    }
  }

  if (sent > 0) {
    console.log(`${LOG_PREFIX} Sent ${sent} review reminder notification(s).`);
  }
}

module.exports = { startReviewReminderScheduler, stopReviewReminderScheduler };
