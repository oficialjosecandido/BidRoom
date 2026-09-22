/**
 * Giveaways: free entry, one chance each, a random draw that can be audited.
 *
 * The whole feature rests on one legal fact: entry is free and no purchase can
 * ever improve anyone's odds. That is what makes this a promotional contest
 * rather than a lottery, and lotteries are not something a marketplace may run.
 * Every rule below exists to keep that true even under load, replay, or a
 * client that does not behave:
 *
 *   - one entry per person, enforced by a unique index rather than by a check;
 *   - serial numbers issued atomically, so two entrants can never share one;
 *   - the draw picks uniformly from the entries that actually exist;
 *   - the draw is recorded — when, by whom, which number — and can only happen
 *     once.
 *
 * Nothing here touches money, and nothing should ever be added that does.
 */

const crypto = require('crypto');
const Listing = require('../models/Listing');
const GiveawayEntry = require('../models/GiveawayEntry');
const { isScheduled } = require('../utils/listingSchedule');
const logger = require('../utils/logger');

/** Thrown for conditions the caller should turn into a 4xx rather than a 500. */
class GiveawayError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Entries run from the opening (which the seller can schedule) to endDate;
 * after that the giveaway is waiting to be drawn.
 */
function entriesAreOpen(listing) {
  const now = new Date();
  return listing.status === 'active'
    && !isScheduled(listing, now)
    && now <= new Date(listing.endDate);
}

/**
 * Enter a giveaway.
 *
 * Returns `{ entryNumber, alreadyEntered }`. Entering twice is not an error —
 * it returns the number the person already holds, because from their side
 * clicking again should show them their entry, not scold them.
 */
async function enterGiveaway({ listingId, participant }) {
  const listing = await Listing.findById(listingId)
    .select('saleFormat status startDate endDate seller giveaway slug title')
    .lean();

  if (!listing || listing.saleFormat !== 'giveaway') {
    throw new GiveawayError('giveaway_not_found', 'Giveaway not found.', 404);
  }
  if (listing.giveaway?.drawnAt) {
    throw new GiveawayError('giveaway_drawn', 'The winner of this giveaway has already been drawn.', 409);
  }
  if (!entriesAreOpen(listing)) {
    throw new GiveawayError('giveaway_closed', 'This giveaway is closed to new entries.', 400);
  }

  // The person running the giveaway cannot win it. Nothing in the draw would
  // stop them, which is exactly why it has to be stopped here: a contest whose
  // organiser is in the pool is not one anyone should trust.
  if (String(listing.seller) === String(participant._id)) {
    throw new GiveawayError('giveaway_own_listing', 'You cannot enter a giveaway you are running.', 403);
  }

  const existing = await GiveawayEntry.findOne({
    listing: listing._id,
    participant: participant._id
  }).select('entryNumber').lean();
  if (existing) {
    return { entryNumber: existing.entryNumber, alreadyEntered: true };
  }

  // Claim a serial number atomically. The value that comes back is this
  // entrant's and nobody else's, however many requests arrive at once.
  const claimed = await Listing.findOneAndUpdate(
    { _id: listing._id, saleFormat: 'giveaway', 'giveaway.drawnAt': null },
    { $inc: { 'giveaway.entryCount': 1 } },
    { new: true, projection: { 'giveaway.entryCount': 1 } }
  ).lean();
  if (!claimed) {
    throw new GiveawayError('giveaway_drawn', 'The winner of this giveaway has already been drawn.', 409);
  }
  const entryNumber = claimed.giveaway.entryCount;

  try {
    await GiveawayEntry.create({
      listing: listing._id,
      participant: participant._id,
      entryNumber
    });
  } catch (err) {
    if (err.code === 11000) {
      // The same person raced themselves (a double click, a retried request).
      // The number just claimed is abandoned rather than handed back: undoing
      // the $inc would re-issue a number a later entrant may already hold, and
      // a gap in the sequence is harmless because the draw reads the entries,
      // not the counter.
      const e = await GiveawayEntry.findOne({
        listing: listing._id,
        participant: participant._id
      }).select('entryNumber').lean();
      if (e) return { entryNumber: e.entryNumber, alreadyEntered: true };
    }
    throw err;
  }

  return { entryNumber, alreadyEntered: false };
}

/** This person's entry, plus how many people are in — both shown on the page. */
async function getEntryState({ listingId, participantId = null }) {
  const [entry, total] = await Promise.all([
    participantId
      ? GiveawayEntry.findOne({ listing: listingId, participant: participantId }).select('entryNumber').lean()
      : Promise.resolve(null),
    GiveawayEntry.countDocuments({ listing: listingId })
  ]);

  return {
    entered: !!entry,
    entryNumber: entry?.entryNumber ?? null,
    totalEntries: total
  };
}

/**
 * How the winner is named in public: first name and the initial of the last.
 *
 * The rules promise the winner is announced, and an announcement needs a name
 * — but the rest of the room does not need the whole of it. Anything more
 * identifying is for Nexus, where the prize is actually handed over.
 */
function publicWinnerName(customer) {
  if (!customer) return null;
  const first = String(customer.firstName || '').trim();
  const lastInitial = String(customer.lastName || '').trim().charAt(0);
  if (!first && !lastInitial) return null;
  return lastInitial ? `${first} ${lastInitial.toUpperCase()}.`.trim() : first;
}

/**
 * Everything the listing page needs to render a giveaway, for anyone: how many
 * have entered, whether entries are open, and — once drawn — the winning number
 * and the winner's public name. `participantId` adds the viewer's own entry.
 */
async function getPublicState({ listingId, participantId = null }) {
  const listing = await Listing.findById(listingId)
    .select('saleFormat status startDate endDate giveaway')
    .populate('giveaway.winner', 'firstName lastName')
    .lean();

  if (!listing || listing.saleFormat !== 'giveaway') {
    throw new GiveawayError('giveaway_not_found', 'Giveaway not found.', 404);
  }
  // Not yet approved: nothing to show, and nobody can enter.
  if (listing.status === 'pending_review' || listing.status === 'draft') {
    throw new GiveawayError('giveaway_not_found', 'Giveaway not found.', 404);
  }

  const entryState = await getEntryState({ listingId: listing._id, participantId });
  const drawn = !!listing.giveaway?.drawnAt;

  return {
    ...entryState,
    entriesOpen: !drawn && entriesAreOpen(listing),
    opensAt: isScheduled(listing) ? listing.startDate : null,
    endDate: listing.endDate,
    drawn,
    drawnAt: listing.giveaway?.drawnAt || null,
    winnerEntry: drawn ? listing.giveaway.winnerEntry : null,
    winnerName: drawn ? publicWinnerName(listing.giveaway.winner) : null,
    youWon: drawn && !!participantId && String(listing.giveaway.winner?._id || '') === String(participantId),
    drawVideo: drawn ? publicDrawVideo(listing.giveaway.drawVideo) : null
  };
}

// ─── Draw video ──────────────────────────────────────────────────────────────
//
// A recording of the draw goes on the public giveaway page, so whatever URL is
// stored here ends up in a <video>, an <iframe> or a link in front of every
// visitor. Only three sources are accepted, each reduced to a canonical form
// built from parts we extracted and checked — never the string as pasted:
//
//   - youtube:   an 11-character video id, embedded from youtube-nocookie.com;
//   - instagram: a post/reel shortcode, linked to rather than embedded (the
//                embed needs Instagram's script and its cookies);
//   - upload:    a file in our own blob container, under giveaway-videos/.
//                Any other Azure account's blob is refused, not just other hosts.

const DRAW_VIDEO_TYPES = ['upload', 'youtube', 'instagram'];
const DRAW_VIDEO_BLOB_PREFIX = 'giveaway-videos/';
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const INSTAGRAM_CODE = /^[A-Za-z0-9_-]{5,64}$/;
const UPLOAD_FILE = /^[a-z0-9][a-z0-9.-]{0,120}\.(mp4|m4v|mov|webm)$/i;

function youTubeVideoId(u) {
  if (u.hostname === 'youtu.be') return u.pathname.split('/')[1] || null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const [, kind, id] = u.pathname.split('/');
  return ['shorts', 'live', 'embed'].includes(kind) ? id || null : null;
}

/**
 * Validate a draw-video URL and reduce it to its canonical form.
 *
 * @param {string} rawUrl
 * @param {string|undefined} declaredType - optional; inferred from the host when absent
 * @param {string|null} uploadBaseUrl - where our draw videos live, ending in "/giveaway-videos/"
 * @returns {{type: string, url: string, videoId?: string}|null}
 */
function parseDrawVideoUrl(rawUrl, declaredType, uploadBaseUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return null;
  if (declaredType != null && !DRAW_VIDEO_TYPES.includes(declaredType)) return null;

  let u;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;

  const host = u.hostname.toLowerCase();
  const type = declaredType
    || (YOUTUBE_HOSTS.has(host) ? 'youtube' : INSTAGRAM_HOSTS.has(host) ? 'instagram' : 'upload');

  if (type === 'youtube') {
    if (!YOUTUBE_HOSTS.has(host)) return null;
    const videoId = youTubeVideoId(u);
    if (!videoId || !YOUTUBE_ID.test(videoId)) return null;
    return { type, url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
  }

  if (type === 'instagram') {
    if (!INSTAGRAM_HOSTS.has(host)) return null;
    const [, kind, code] = u.pathname.split('/');
    if (!['p', 'reel', 'reels', 'tv'].includes(kind) || !code || !INSTAGRAM_CODE.test(code)) return null;
    return { type, url: `https://www.instagram.com/${kind === 'reels' ? 'reel' : kind}/${code}/` };
  }

  // upload — our container's giveaway-videos/ folder only. new URL() has
  // already resolved any "..", and the file-name check below rejects "/".
  if (!uploadBaseUrl || !uploadBaseUrl.startsWith('https://') || !uploadBaseUrl.endsWith(`/${DRAW_VIDEO_BLOB_PREFIX}`)) {
    return null;
  }
  const bare = `${u.origin}${u.pathname}`;
  if (!bare.startsWith(uploadBaseUrl)) return null;
  const file = bare.slice(uploadBaseUrl.length);
  if (!UPLOAD_FILE.test(file)) return null;
  return { type, url: bare };
}

/** The video as the public page receives it: the stored URL plus, for YouTube, the id to embed. */
function publicDrawVideo(drawVideo) {
  if (!drawVideo?.url || !DRAW_VIDEO_TYPES.includes(drawVideo.type)) return null;
  const out = { type: drawVideo.type, url: drawVideo.url, publishedAt: drawVideo.publishedAt || null };
  if (drawVideo.type === 'youtube') {
    try {
      const videoId = youTubeVideoId(new URL(drawVideo.url));
      if (!videoId || !YOUTUBE_ID.test(videoId)) return null;
      out.videoId = videoId;
    } catch {
      return null;
    }
  }
  return out;
}

/**
 * Publish (or replace) the draw video. Only after the draw: a video published
 * before there is a result would be a video of something else.
 *
 * Returns the stored video and whatever it replaced, so the caller can audit
 * a replacement — swapping the recording is legitimate (a wrong link, a better
 * cut) but it should never happen silently.
 */
async function publishDrawVideo({ listingId, url, type, uploadBaseUrl }) {
  const listing = await Listing.findById(listingId).select('saleFormat slug giveaway.drawnAt giveaway.drawVideo').lean();
  if (!listing || listing.saleFormat !== 'giveaway') {
    throw new GiveawayError('giveaway_not_found', 'Giveaway not found.', 404);
  }
  if (!listing.giveaway?.drawnAt) {
    throw new GiveawayError('giveaway_not_drawn', 'Draw a winner before publishing the draw video.', 400);
  }

  const parsed = parseDrawVideoUrl(url, type || undefined, uploadBaseUrl);
  if (!parsed) {
    throw new GiveawayError(
      'giveaway_video_invalid_url',
      'Use an https link to a YouTube video, an Instagram post or reel, or a video uploaded here.',
      400
    );
  }

  const drawVideo = { url: parsed.url, type: parsed.type, publishedAt: new Date() };
  const updated = await Listing.findOneAndUpdate(
    { _id: listing._id, saleFormat: 'giveaway', 'giveaway.drawnAt': { $ne: null } },
    { $set: { 'giveaway.drawVideo': drawVideo } },
    { new: true, projection: { slug: 1, 'giveaway.drawVideo': 1 } }
  ).lean();
  if (!updated) throw new GiveawayError('giveaway_not_found', 'Giveaway not found.', 404);

  return {
    slug: updated.slug,
    drawVideo: updated.giveaway.drawVideo,
    previous: listing.giveaway?.drawVideo?.url ? listing.giveaway.drawVideo : null
  };
}

/** Take the draw video off the page. Returns what was removed (null if there was nothing). */
async function removeDrawVideo({ listingId }) {
  const before = await Listing.findOneAndUpdate(
    { _id: listingId, saleFormat: 'giveaway' },
    { $set: { 'giveaway.drawVideo': { url: null, type: null, publishedAt: null } } },
    { new: false, projection: { slug: 1, 'giveaway.drawVideo': 1 } }
  ).lean();
  if (!before) throw new GiveawayError('giveaway_not_found', 'Giveaway not found.', 404);
  return { slug: before.slug, removed: before.giveaway?.drawVideo?.url ? before.giveaway.drawVideo : null };
}

/**
 * Draw the winner.
 *
 * The number is picked with crypto.randomInt, not Math.random: the draw has to
 * be genuinely unpredictable, and a pseudo-random sequence an observer could
 * reproduce is not something a contested result could be defended with.
 *
 * It picks a position among the entries that exist rather than a number in
 * 1..entryCount, because the counter can legitimately skip a number when
 * somebody races their own request. Drawing from the counter could land on a
 * number nobody holds; drawing from the entries cannot, and every entry keeps
 * exactly the same chance.
 */
async function drawWinner({ listingId, adminEmail }) {
  const listing = await Listing.findById(listingId);

  if (!listing || listing.saleFormat !== 'giveaway') {
    throw new GiveawayError('giveaway_not_found', 'Giveaway not found.', 404);
  }
  if (listing.giveaway?.drawnAt) {
    throw new GiveawayError('giveaway_already_drawn', 'A winner has already been drawn for this giveaway.', 409, {
      winnerEntry: listing.giveaway.winnerEntry
    });
  }
  if (new Date() < new Date(listing.endDate)) {
    throw new GiveawayError('giveaway_still_open', 'This giveaway is still open. Wait until entries close to draw.', 400, {
      endDate: listing.endDate
    });
  }

  const total = await GiveawayEntry.countDocuments({ listing: listing._id });
  if (total < 1) {
    throw new GiveawayError('giveaway_no_entries', 'Nobody entered this giveaway, so there is nobody to draw.', 400);
  }

  const position = crypto.randomInt(0, total);
  const [winningEntry] = await GiveawayEntry.find({ listing: listing._id })
    .sort({ entryNumber: 1 })
    .skip(position)
    .limit(1)
    .populate('participant', 'firstName lastName email language');

  if (!winningEntry?.participant) {
    // The entry exists but its participant does not — a deleted account. Fail
    // loudly rather than silently redrawing: quietly picking again is exactly
    // what a rigged draw looks like from the outside.
    throw new GiveawayError(
      'giveaway_winner_unavailable',
      'The drawn entry belongs to an account that no longer exists. Review the entries before drawing again.',
      409,
      { position }
    );
  }

  // Only the first draw commits. Two admins pressing the button at the same
  // moment must not produce two winners, so the write is conditional on the
  // giveaway still being undrawn.
  const committed = await Listing.findOneAndUpdate(
    { _id: listing._id, 'giveaway.drawnAt': null },
    {
      $set: {
        'giveaway.drawnAt': new Date(),
        'giveaway.winnerEntry': winningEntry.entryNumber,
        'giveaway.winner': winningEntry.participant._id,
        'giveaway.drawnByEmail': adminEmail || null,
        status: 'ended'
      }
    },
    { new: true }
  ).lean();

  if (!committed) {
    const current = await Listing.findById(listing._id).select('giveaway').lean();
    throw new GiveawayError('giveaway_already_drawn', 'A winner has already been drawn for this giveaway.', 409, {
      winnerEntry: current?.giveaway?.winnerEntry ?? null
    });
  }

  logger.info(
    `[giveaway] ${listing.slug}: entry #${winningEntry.entryNumber} drawn from ${total} entries by ${adminEmail || 'admin'}`
  );

  return {
    listing: committed,
    winnerEntry: winningEntry.entryNumber,
    totalEntries: total,
    winner: winningEntry.participant
  };
}

/**
 * Close giveaways whose entry window has passed.
 *
 * Giveaways are deliberately kept out of the auction-end sweep: that path
 * resolves bids, picks a winner from them and emails the seller about how the
 * auction went, none of which means anything here. Closing is all that happens
 * automatically — the draw itself stays a deliberate human action.
 */
async function closeEndedGiveaways() {
  const result = await Listing.updateMany(
    { saleFormat: 'giveaway', status: 'active', endDate: { $lte: new Date() } },
    { $set: { status: 'ended' } }
  );
  if (result.modifiedCount > 0) {
    logger.info(`[giveaway] closed ${result.modifiedCount} giveaway(s) to new entries`);
  }
  return result.modifiedCount || 0;
}

module.exports = {
  GiveawayError,
  enterGiveaway,
  getEntryState,
  getPublicState,
  publicWinnerName,
  drawWinner,
  closeEndedGiveaways,
  DRAW_VIDEO_BLOB_PREFIX,
  parseDrawVideoUrl,
  publicDrawVideo,
  publishDrawVideo,
  removeDrawVideo
};
