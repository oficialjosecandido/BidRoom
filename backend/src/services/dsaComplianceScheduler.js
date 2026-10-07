/**
 * DSA Compliance Scheduler — Article 29 seller threshold monitoring.
 *
 * Runs every 24 hours. For each private seller:
 *   1. Aggregates completed-transaction volume and count over the trailing 12 months.
 *   2. If either threshold is exceeded:
 *      a. First offence — issues a warning notification (in-app + email) and sets dsaWarningIssuedAt.
 *      b. After the 30-day grace period with no response — flags as suspectedProfessional and,
 *         if configured, restricts new listing creation.
 *
 * Thresholds (EU DSA Article 29 / CPC Regulation):
 *   - Annual sales volume > €2,000
 *   - Annual transaction count > 30
 *
 * Grace period: 30 days from first warning before flagging.
 */

const Customer = require('../models/Customer');
const Transaction = require('../models/Transaction');
const { sendLocalizedEmail, emailLabel, emailLocale } = require('./localizedEmail');
const { emailStepsList, escapeHtml } = require('../utils/bidroomEmailLayout');
const { notifyDsaWarning, notifyDsaSuspectedProfessional, emitNewNotificationToUser } = require('./notificationService');
const logger = require('../utils/logger');

const SALES_THRESHOLD_EUR = 2000;
const TX_COUNT_THRESHOLD = 30;
const GRACE_PERIOD_DAYS = 30;
const LOG_PREFIX = '[DSACompliance]';

let checkInterval = null;
let ioInstance = null;

async function checkDsaCompliance() {
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const graceCutoff = new Date(now.getTime() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  try {
    // Only check active private sellers.
    //
    // `language` is in the projection because this check emails the seller a
    // notice that starts a 30-day clock. Left out, the lean object carries no
    // language and the warning goes out in English to every seller.
    const privateSellers = await Customer.find({
      sellerClassification: 'private',
      accountStatus: 'active'
    }).select('_id uid email firstName language dsaWarningIssuedAt dsaWarningAcknowledgedAt dsaWarningResponse suspectedProfessional dsaListingRestricted').lean();

    if (!privateSellers.length) return;

    // Aggregate trailing-12-month sales for all private sellers in one query
    const sellerIds = privateSellers.map(u => u._id);
    const agg = await Transaction.aggregate([
      {
        $match: {
          seller: { $in: sellerIds },
          transactionStatus: 'completed',
          completedAt: { $gte: twelveMonthsAgo }
        }
      },
      {
        $group: {
          _id: '$seller',
          totalSalesEur: { $sum: '$amount' },
          txCount: { $sum: 1 }
        }
      }
    ]);

    const statsMap = {};
    for (const row of agg) {
      statsMap[row._id.toString()] = { totalSalesEur: row.totalSalesEur, txCount: row.txCount };
    }

    for (const seller of privateSellers) {
      const uid = seller._id.toString();
      const stats = statsMap[uid] || { totalSalesEur: 0, txCount: 0 };
      const exceeds = stats.totalSalesEur > SALES_THRESHOLD_EUR || stats.txCount > TX_COUNT_THRESHOLD;

      if (!exceeds) continue;

      const alreadyWarned = !!seller.dsaWarningIssuedAt;
      const acknowledged = !!seller.dsaWarningAcknowledgedAt;
      const gracePassed = alreadyWarned && new Date(seller.dsaWarningIssuedAt) < graceCutoff;
      const alreadyFlagged = seller.suspectedProfessional;

      if (!alreadyWarned) {
        // First time exceeding threshold — issue warning
        await Customer.updateOne({ _id: seller._id }, { $set: { dsaWarningIssuedAt: now } });
        await notifyDsaWarning({
          userId: uid,
          annualSalesEur: stats.totalSalesEur,
          annualTransactionCount: stats.txCount,
          io: ioInstance
        }).catch(err => logger.error(`${LOG_PREFIX} notify warning failed for ${uid}:`, err.message));
        if (ioInstance) emitNewNotificationToUser(ioInstance, uid).catch(() => {});

        // Send email
        await sendDsaWarningEmail(seller, stats).catch(err =>
          logger.error(`${LOG_PREFIX} email warning failed for ${seller.email}:`, err.message)
        );

        logger.info(`${LOG_PREFIX} Warning issued to seller ${uid} (€${Math.round(stats.totalSalesEur)}, ${stats.txCount} tx)`);

      } else if (gracePassed && !acknowledged && !alreadyFlagged) {
        // Grace period expired with no response — flag as suspected professional
        const updateFields = { suspectedProfessional: true };
        // Optionally restrict listing creation (uncomment to enforce):
        // updateFields.dsaListingRestricted = true;
        await Customer.updateOne({ _id: seller._id }, { $set: updateFields });

        await notifyDsaSuspectedProfessional({ userId: uid, io: ioInstance }).catch(err =>
          logger.error(`${LOG_PREFIX} notify flagged failed for ${uid}:`, err.message)
        );
        if (ioInstance) emitNewNotificationToUser(ioInstance, uid).catch(() => {});

        logger.info(`${LOG_PREFIX} Flagged seller ${uid} as suspected_professional after grace period`);
      }
    }
  } catch (err) {
    logger.error(`${LOG_PREFIX} Error during compliance check:`, err.message);
  }
}

/**
 * The Article 29 notice, written in the seller's own language.
 *
 * Amounts are formatted for that language too — a Portuguese reader parses
 * "€2.450" and an English one "€2,450", and the figure in a legal notice is the
 * part that must not be misread.
 */
async function sendDsaWarningEmail(seller, stats) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
  const locale = emailLocale(seller);
  const money = (value) => `€${Math.round(value).toLocaleString(locale)}`;
  const count = (value) => Number(value).toLocaleString(locale);

  const threshold = emailLabel('dsaThreshold', seller);
  const rows = [
    [emailLabel('dsaAnnualSales', seller), money(stats.totalSalesEur), money(SALES_THRESHOLD_EUR)],
    [emailLabel('dsaAnnualTransactions', seller), count(stats.txCount), count(TX_COUNT_THRESHOLD)]
  ];

  await sendLocalizedEmail(seller, 'dsaSellerStatusWarning', {
    firstName: escapeHtml(seller.firstName),
    statsBox: emailStepsList(rows.map(([label, value, limit]) =>
      `${label}: <strong style="color:#0f172a;">${value}</strong> (${threshold}: ${limit})`
    )),
    statsText: rows.map(([label, value, limit]) => `- ${label}: ${value} (${threshold}: ${limit})`).join('\n'),
    graceDays: GRACE_PERIOD_DAYS,
    ctaUrl: `${frontendUrl.replace(/\/$/, '')}/dashboard/home`
  });
}

function startDsaComplianceScheduler(intervalHours = 24, io = null) {
  if (checkInterval) return;
  ioInstance = io;

  // Stagger the first run by 5 minutes to avoid startup congestion
  setTimeout(() => {
    checkDsaCompliance();
    checkInterval = setInterval(checkDsaCompliance, intervalHours * 60 * 60 * 1000);
  }, 5 * 60 * 1000);

  logger.info(`⚖️  DSA compliance scheduler started (interval: every ${intervalHours}h)`);
}

function stopDsaComplianceScheduler() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

module.exports = { startDsaComplianceScheduler, stopDsaComplianceScheduler };
