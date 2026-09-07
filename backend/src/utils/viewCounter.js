const crypto = require('crypto');
const redisService = require('../services/redis.service');
const Listing = require('../models/Listing');

const BOT_UA_PATTERN = /bot|crawler|spider|facebookexternalhit|slurp|bingpreview|whatsapp/i;

function hashViewer(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress || 'unknown';
  const ua = req.headers['user-agent'] || '';
  return crypto.createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 24);
}

// Increments Listing.viewCount if this viewer hasn't seen this listing recently.
// Caller is responsible for excluding the seller's own views.
async function recordViewIfNew(listingId, req) {
  const ua = req.headers['user-agent'] || '';
  if (BOT_UA_PATTERN.test(ua)) return;

  const viewerKey = req.user?.uid ? `u:${req.user.uid}` : `a:${hashViewer(req)}`;
  const isNew = await redisService.recordListingView(String(listingId), viewerKey);
  if (!isNew) return;

  await Listing.updateOne({ _id: listingId }, { $inc: { viewCount: 1 } });
}

module.exports = { recordViewIfNew };
