/**
 * Fraud detection for bid submissions.
 *
 * Checks (in order, all non-blocking on errors):
 *  1. Bot pattern  — bidder placed 4+ bids in the last 30 seconds on this listing
 *  2. Shill bid    — bidder's IP or fingerprint matches the seller's known signals
 *  3. Multi-account — same IP or fingerprint is known to belong to another user
 *
 * Outcomes per check:
 *  - 'allow'   → no action, proceed normally
 *  - 'flag'    → bid is saved but marked isFlagged; FraudEvent logged
 *  - 'block'   → bid is rejected; FraudEvent logged
 */

const Bid       = require('../models/Bid');
const Customer = require('../models/Customer');
const FraudEvent = require('../models/FraudEvent');
const logger = require('../utils/logger');

// Score increments applied to user.fraudScore
const SCORE_DELTA = { bot_pattern: 15, shill_bid_high: 40, shill_bid_medium: 20, multi_account: 25 };
const MAX_SCORE = 100;

/** Persist a FraudEvent; never throws. */
async function logFraudEvent(data) {
  try {
    await FraudEvent.create(data);
  } catch (err) {
    logger.error('FraudEvent log error (non-fatal):', err.message);
  }
}

/** Raise user.fraudScore and set isFraudSuspect if threshold exceeded; never throws. */
async function raiseFraudScore(userId, delta) {
  if (!userId) return;
  try {
    const user = await Customer.findById(userId);
    if (!user) return;
    user.fraudScore = Math.min(MAX_SCORE, (user.fraudScore || 0) + delta);
    if (user.fraudScore >= 60) user.isFraudSuspect = true;
    await user.save();
  } catch (err) {
    logger.error('raiseFraudScore error (non-fatal):', err.message);
  }
}

/**
 * Update user's known IPs and fingerprints (last-seen tracking).
 * Call this when a bid is allowed through.
 */
async function updateUserSignals(userId, ip, fingerprint) {
  if (!userId) return;
  try {
    const now = new Date();
    const user = await Customer.findById(userId);
    if (!user) return;

    // Update knownIPs (cap at 20)
    if (ip && ip !== 'unknown') {
      const existing = user.knownIPs.find(e => e.ip === ip);
      if (existing) {
        existing.lastSeen = now;
      } else {
        user.knownIPs.unshift({ ip, lastSeen: now });
        if (user.knownIPs.length > 20) user.knownIPs = user.knownIPs.slice(0, 20);
      }
    }

    // Update knownFingerprints (cap at 10)
    if (fingerprint) {
      const existing = user.knownFingerprints.find(e => e.fingerprint === fingerprint);
      if (existing) {
        existing.lastSeen = now;
      } else {
        user.knownFingerprints.unshift({ fingerprint, lastSeen: now });
        if (user.knownFingerprints.length > 10) user.knownFingerprints = user.knownFingerprints.slice(0, 10);
      }
    }

    await user.save();
  } catch (err) {
    logger.error('updateUserSignals error (non-fatal):', err.message);
  }
}

/**
 * Check 1: Bot pattern detection.
 * Flags if the bidder placed 4+ bids on this listing in the last 30 seconds.
 *
 * @returns {{ outcome: 'allow'|'flag'|'block', reason: string|null }}
 */
async function detectBotPattern(bidderId, listingId, ip) {
  if (!bidderId) return { outcome: 'allow', reason: null };
  try {
    const windowMs = 30 * 1000;
    const since = new Date(Date.now() - windowMs);
    const recentCount = await Bid.countDocuments({
      bidder: bidderId,
      listing: listingId,
      createdAt: { $gte: since }
    });

    if (recentCount >= 4) {
      await logFraudEvent({
        type: 'bot_pattern',
        severity: recentCount >= 8 ? 'high' : 'medium',
        userId: bidderId,
        listingId,
        ipAddress: ip,
        details: { recentBidCount: recentCount, windowSeconds: 30 }
      });
      await raiseFraudScore(bidderId, SCORE_DELTA.bot_pattern);
      return { outcome: 'block', reason: 'Bidding too fast. Please wait before placing another bid.' };
    }
    return { outcome: 'allow', reason: null };
  } catch (err) {
    logger.error('detectBotPattern error (non-fatal):', err.message);
    return { outcome: 'allow', reason: null };
  }
}

/**
 * Check 2: Shill bidding detection.
 * Compares bidder's IP/fingerprint against seller's known signals.
 *
 * @returns {{ outcome: 'allow'|'flag'|'block', reason: string|null, flags: string[] }}
 */
async function detectShillBidding(bidderId, sellerId, listingId, ip, fingerprint) {
  if (!bidderId || !sellerId) return { outcome: 'allow', reason: null, flags: [] };
  if (bidderId.toString() === sellerId.toString()) return { outcome: 'allow', reason: null, flags: [] }; // handled elsewhere

  try {
    const seller = await Customer.findById(sellerId).select('knownIPs knownFingerprints').lean();
    if (!seller) return { outcome: 'allow', reason: null, flags: [] };

    const sellerIPs = (seller.knownIPs || []).map(e => e.ip);
    const sellerFingerprints = (seller.knownFingerprints || []).map(e => e.fingerprint);

    const ipMatch          = ip && ip !== 'unknown' && sellerIPs.includes(ip);
    const fingerprintMatch = fingerprint && sellerFingerprints.includes(fingerprint);

    if (!ipMatch && !fingerprintMatch) return { outcome: 'allow', reason: null, flags: [] };

    const confidence = (ipMatch && fingerprintMatch) ? 'high' : 'medium';
    const flags = ['shill_bid_suspected'];

    await logFraudEvent({
      type: 'shill_bid',
      severity: confidence === 'high' ? 'critical' : 'high',
      userId: bidderId,
      targetUserId: sellerId,
      listingId,
      ipAddress: ip,
      deviceFingerprint: fingerprint,
      details: { ipMatch, fingerprintMatch, confidence }
    });

    const delta = confidence === 'high' ? SCORE_DELTA.shill_bid_high : SCORE_DELTA.shill_bid_medium;
    await raiseFraudScore(bidderId, delta);

    if (confidence === 'high') {
      return { outcome: 'block', reason: 'This bid could not be placed due to a policy violation.', flags };
    }
    // Medium confidence: allow but flag for admin review
    return { outcome: 'flag', reason: null, flags };
  } catch (err) {
    logger.error('detectShillBidding error (non-fatal):', err.message);
    return { outcome: 'allow', reason: null, flags: [] };
  }
}

/**
 * Check 3: Multi-account detection.
 * Looks for other user accounts sharing the same IP or fingerprint.
 *
 * @returns {{ outcome: 'allow'|'flag', flags: string[] }}
 */
async function detectMultiAccount(bidderId, ip, fingerprint) {
  if (!bidderId) return { outcome: 'allow', flags: [] };
  if (!ip && !fingerprint) return { outcome: 'allow', flags: [] };

  try {
    const query = { _id: { $ne: bidderId }, $or: [] };
    if (ip && ip !== 'unknown') query.$or.push({ 'knownIPs.ip': ip });
    if (fingerprint) query.$or.push({ 'knownFingerprints.fingerprint': fingerprint });
    if (query.$or.length === 0) return { outcome: 'allow', flags: [] };

    const sharedAccounts = await Customer.countDocuments(query);
    if (sharedAccounts === 0) return { outcome: 'allow', flags: [] };

    await logFraudEvent({
      type: 'multi_account',
      severity: sharedAccounts >= 3 ? 'high' : 'medium',
      userId: bidderId,
      ipAddress: ip,
      deviceFingerprint: fingerprint,
      details: { sharedAccountCount: sharedAccounts }
    });
    await raiseFraudScore(bidderId, SCORE_DELTA.multi_account);

    return { outcome: 'flag', flags: ['multi_account_suspected'] };
  } catch (err) {
    logger.error('detectMultiAccount error (non-fatal):', err.message);
    return { outcome: 'allow', flags: [] };
  }
}

/**
 * Run all fraud checks for an incoming bid.
 *
 * @param {{ bidderId, sellerId, listingId, ip, fingerprint }} params
 * @returns {{ blocked: boolean, reason: string|null, fraudFlags: string[] }}
 */
async function runFraudChecks({ bidderId, sellerId, listingId, ip, fingerprint }) {
  const allFlags = [];

  // 1. Bot pattern
  const bot = await detectBotPattern(bidderId, listingId, ip);
  if (bot.outcome === 'block') return { blocked: true, reason: bot.reason, fraudFlags: ['bot_pattern'] };

  // 2. Shill bidding
  const shill = await detectShillBidding(bidderId, sellerId, listingId, ip, fingerprint);
  if (shill.outcome === 'block') return { blocked: true, reason: shill.reason, fraudFlags: shill.flags };
  if (shill.flags.length) allFlags.push(...shill.flags);

  // 3. Multi-account (flag only, never block outright)
  const multi = await detectMultiAccount(bidderId, ip, fingerprint);
  if (multi.flags.length) allFlags.push(...multi.flags);

  return { blocked: false, reason: null, fraudFlags: allFlags };
}

module.exports = { runFraudChecks, updateUserSignals };
