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
const { sendEmail } = require('./emailService');
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
    // Only check active private sellers
    const privateSellers = await Customer.find({
      sellerClassification: 'private',
      accountStatus: 'active'
    }).select('_id uid email firstName dsaWarningIssuedAt dsaWarningAcknowledgedAt dsaWarningResponse suspectedProfessional dsaListingRestricted').lean();

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

async function sendDsaWarningEmail(seller, stats) {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
  const salesFormatted = `€${Math.round(stats.totalSalesEur).toLocaleString()}`;
  const subject = 'Action required: your seller status on BidRoom';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
      <h2 style="color: #7A4F84;">Seller status review required</h2>
      <p>Hi ${seller.firstName || 'there'},</p>
      <p>
        Your selling activity on BidRoom has reached thresholds that may qualify as
        <strong>professional selling</strong> under EU DSA (Digital Services Act) regulations:
      </p>
      <ul>
        <li>Annual sales: <strong>${salesFormatted}</strong> (threshold: €${SALES_THRESHOLD_EUR.toLocaleString()})</li>
        <li>Annual transactions: <strong>${stats.txCount}</strong> (threshold: ${TX_COUNT_THRESHOLD})</li>
      </ul>
      <p>
        Under Article 29 of the EU DSA, platforms are required to ask sellers who exceed these
        thresholds to self-declare whether they are acting as a trader.
      </p>
      <p>
        <strong>Please visit your dashboard to confirm your seller status.</strong>
        You have <strong>${GRACE_PERIOD_DAYS} days</strong> to respond before your account is flagged for platform review.
      </p>
      <div style="margin: 24px 0;">
        <a href="${frontendUrl}/dashboard/home"
           style="background: #7A4F84; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">
          Review my seller status
        </a>
      </div>
      <p style="font-size: 13px; color: #666;">
        If you believe this is an error or have questions, please contact support.
      </p>
      <p style="font-size: 12px; color: #999;">
        This notification is required under EU Regulation 2022/2065 (Digital Services Act), Article 29.
      </p>
    </div>
  `;
  await sendEmail(seller.email, subject, html);
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
