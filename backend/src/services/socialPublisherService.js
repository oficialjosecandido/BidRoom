/**
 * Publishing listings to the BidRoom Facebook Page and Instagram account.
 *
 * Three callers: the Nexus approval, which posts automatically in the background
 * (publishApprovedListing); the Facebook and Instagram buttons on a listing in
 * Nexus (requestPublish); and scripts/post-listing.js, which posts by hand. All
 * compose and send through the functions below, so a manual repost looks
 * exactly like the automatic one.
 *
 * listing.socialPosts.<platform> holds one platform's state: `status` is
 * publishing → published | failed, and the post details stay from the last
 * success.
 *
 * The accounts are the real public ones — there is no test version of them.
 * Whatever reaches postToFacebook/postToInstagram is seen by followers.
 */

const Listing = require('../models/Listing');
const { publicBaseUrl } = require('../utils/publicUrls');
const logger = require('../utils/logger');

/** API limit: a carousel takes between 2 and 10 items. */
const IG_CAROUSEL_MAX = 10;
const EXCERPT_MAX = 180;
const REQUEST_TIMEOUT_MS = 30000;

/** Read on every call so scripts that load dotenv after requiring this still work. */
function metaConfig() {
  const version = (process.env.META_GRAPH_VERSION || 'v21.0').trim();
  return {
    graph: `https://graph.facebook.com/${version}`,
    pageId: (process.env.FB_PAGE_ID || '').trim(),
    pageToken: (process.env.FB_PAGE_ACCESS_TOKEN || '').trim(),
    igUserId: (process.env.IG_USER_ID || '').trim()
  };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * fetch + json, retrying network failures.
 *
 * A carousel is dozens of calls in a row and a single dropped connection
 * ("fetch failed") would lose all of it. Only network errors are retried: a
 * Graph API response, even an error one, goes back to the caller.
 *
 * Calls that make something public (feed post, media_publish) pass attempts=1.
 * A request that timed out may still have gone through, and retrying it would
 * post the listing twice.
 */
async function graphFetch(url, init = {}, attempts = 4) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      return await res.json();
    } catch (err) {
      if (i >= attempts) throw err;
      await sleep(1000 * i);
    }
  }
}

function graphPost(url, body, attempts) {
  return graphFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, attempts);
}

const euro = n => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n || 0);

/**
 * Portuguese excerpt, always.
 *
 * The accounts are Portuguese, so the post is in PT even when the listing was
 * written in another language — descriptionPt then holds the original, which
 * is better than nothing. Cut at a sentence end when possible, so it never
 * stops mid-word.
 */
function buildExcerpt(listing) {
  const raw = String(listing.descriptionPt || listing.description || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return null;
  if (raw.length <= EXCERPT_MAX) return raw;

  const cut = raw.slice(0, EXCERPT_MAX);
  const sentenceEnd = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (sentenceEnd > EXCERPT_MAX * 0.5) return cut.slice(0, sentenceEnd + 1);

  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : EXCERPT_MAX).trim()}…`;
}

function listingUrl(listing) {
  return `${publicBaseUrl()}/listing/${listing.slug}`;
}

/** The post text — what shows up in the feed. */
function buildMessage(listing) {
  const url = listingUrl(listing);
  const title = listing.titlePt || listing.title;
  const ends = new Date(listing.endDate).toLocaleString('pt-PT', {
    timeZone: 'Europe/Lisbon',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  // A giveaway has no price and no bids. The post says what the listing says
  // next to the button: it is free, an account is enough, the winner is drawn.
  if (listing.saleFormat === 'giveaway') {
    const giveawayLines = [`🎁 PASSATEMPO — ${title}`];
    const giveawayExcerpt = buildExcerpt(listing);
    if (giveawayExcerpt) giveawayLines.push('', giveawayExcerpt);
    giveawayLines.push(
      '',
      'Participação 100% gratuita — não é necessária qualquer compra.',
      'Basta ter conta na BidRoom e carregar em "Participar".',
      'O vencedor é sorteado aleatoriamente e anunciado na página do passatempo.',
      `Participações até: ${ends}`,
      '',
      `Participa e lê o regulamento em ${url}`,
      '',
      '#BidRoom #passatempo #Portugal'
    );
    return giveawayLines.join('\n');
  }

  const lines = [`🔨 ${title}`];

  const excerpt = buildExcerpt(listing);
  if (excerpt) lines.push('', excerpt);

  lines.push('', `Licitação atual: ${euro(listing.currentPrice)}`);
  if (listing.buyNowPrice) lines.push(`Compra já: ${euro(listing.buyNowPrice)}`);
  lines.push(`Termina: ${ends}`);
  lines.push('', `Licita em ${url}`);
  lines.push('', '#BidRoom #leiloes #Portugal');

  return lines.join('\n');
}

/**
 * Images Instagram can fetch. Listings created without photos carry a
 * via.placeholder.com "No Image" URL, which must never end up on the feed.
 */
function publishableImages(listing) {
  return (listing.images || [])
    .filter(url => /^https:\/\//i.test(url) && !/placeholder\.com/i.test(url));
}

async function postToFacebook(listing, message) {
  const { graph, pageId, pageToken } = metaConfig();
  if (!pageId || !pageToken) throw new Error('Facebook — FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN is not set.');

  // Link post: Facebook takes the image and title from the OG tags the backend
  // serves for /listing/:slug, so the image is not uploaded.
  const data = await graphPost(`${graph}/${pageId}/feed`, {
    message,
    link: listingUrl(listing),
    access_token: pageToken
  }, 1);
  if (data.error) throw new Error(`Facebook — ${data.error.message}`);

  return { postId: data.id };
}

/** Waits for a media container to be FINISHED; throws with the reason otherwise. */
async function waitForContainer(containerId, attempts = 12, delayMs = 2500) {
  const { graph, pageToken } = metaConfig();

  for (let i = 0; i < attempts; i++) {
    const url = new URL(`${graph}/${containerId}`);
    url.searchParams.set('fields', 'status_code,status');
    url.searchParams.set('access_token', pageToken);

    const { status_code: code, status, error } = await graphFetch(url);
    if (error) throw new Error(`Instagram — ${error.message}`);
    if (code === 'FINISHED') return;
    if (code === 'ERROR') throw new Error(`Instagram — container failed: ${status || 'no detail'}`);
    await sleep(delayMs);
  }
  throw new Error('Instagram — container was not ready in time.');
}

async function createIgContainer(payload) {
  const { graph, pageToken, igUserId } = metaConfig();
  const data = await graphPost(`${graph}/${igUserId}/media`, { ...payload, access_token: pageToken });
  if (data.error) throw new Error(`Instagram — ${data.error.message}`);
  return data.id;
}

/**
 * Builds a carousel: one container per image (is_carousel_item), then a parent
 * that groups them and carries the caption.
 *
 * Every child must be FINISHED before the parent is created — otherwise the API
 * accepts the parent and fails at publish time.
 *
 * Children are created one at a time on purpose. In parallel each gets an id
 * and reaches FINISHED, but the published carousel comes out with fewer items
 * than requested and no error anywhere. In series it comes out complete.
 */
async function createCarousel(images, caption, onImageReady) {
  const childIds = [];
  for (const [i, url] of images.entries()) {
    const id = await createIgContainer({ image_url: url, is_carousel_item: true });
    await waitForContainer(id);
    childIds.push(id);
    onImageReady(i + 1, images.length);
  }

  return createIgContainer({
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption
  });
}

/**
 * Reads the published post back and counts its images.
 *
 * The API drops carousel items without returning an error, so the number sent
 * proves nothing — only what is published counts.
 */
async function readPublished(mediaId) {
  const { graph, pageToken } = metaConfig();
  const url = new URL(`${graph}/${mediaId}`);
  url.searchParams.set('fields', 'media_type,permalink,children{id}');
  url.searchParams.set('access_token', pageToken);

  const media = await graphFetch(url).catch(err => ({ error: { message: err.message } }));
  if (media.error) return { permalink: null, imageCount: null };

  return {
    permalink: media.permalink || null,
    imageCount: media.media_type === 'CAROUSEL_ALBUM' ? (media.children?.data || []).length : 1
  };
}

/**
 * Posts to Instagram. Returns the media id, permalink, and how many images were
 * sent vs. actually published (null when the read-back failed).
 */
async function postToInstagram(listing, message, { onImageReady = () => {} } = {}) {
  const { graph, pageToken, igUserId } = metaConfig();
  if (!igUserId) throw new Error('Instagram — IG_USER_ID is not set.');

  const images = publishableImages(listing);
  if (images.length === 0) throw new Error('Instagram — no image with a public https URL.');

  const selected = images.slice(0, IG_CAROUSEL_MAX);

  // A carousel needs at least two items; with one image the post must be a
  // plain one or the API rejects it.
  const parentId = selected.length >= 2
    ? await createCarousel(selected, message, onImageReady)
    : await createIgContainer({ image_url: selected[0], caption: message });

  // Containers are processed asynchronously: publishing before FINISHED returns
  // "Media ID is not available".
  await waitForContainer(parentId);

  const posted = await graphPost(`${graph}/${igUserId}/media_publish`, {
    creation_id: parentId,
    access_token: pageToken
  }, 1);
  if (posted.error) throw new Error(`Instagram — ${posted.error.message}`);

  const { permalink, imageCount } = await readPublished(posted.id);
  return { mediaId: posted.id, permalink, imagesSent: selected.length, imageCount };
}

/**
 * Asks Facebook to read the listing page's OG tags again.
 *
 * Facebook caches a link's preview. After a photo or title was changed in
 * Nexus, a new post would otherwise show what the page looked like the first
 * time it was shared. Best effort: a failed refresh still lets the post go out.
 */
async function refreshLinkPreview(listing) {
  const { graph, pageToken } = metaConfig();
  try {
    const data = await graphPost(`${graph}/`, { id: listingUrl(listing), scrape: true, access_token: pageToken }, 2);
    if (data?.error) logger.warn(`[social] Facebook preview refresh for ${listing.slug}: ${data.error.message}`);
  } catch (err) {
    logger.warn(`[social] Facebook preview refresh for ${listing.slug}: ${err.message}`);
  }
}

/** Database name from a Mongo URI, or null when the URI cannot be read. */
function databaseName(uri) {
  try {
    return new URL(String(uri).replace(/^mongodb(\+srv)?:/, 'https:')).pathname.slice(1) || null;
  } catch {
    return null;
  }
}

/**
 * The database name when it looks like a non-production one, else null.
 *
 * Local .env points at bidroom-dev while the social accounts are the real
 * ones; without this a test listing reaches followers as if it were real.
 */
function nonProductionDatabase() {
  const db = databaseName(process.env.MONGO_URI);
  return db && /dev|test|staging|local/i.test(db) ? db : null;
}

const PLATFORMS = ['facebook', 'instagram'];

/**
 * A publish still marked "publishing" after this long was cut short — the
 * process restarted mid-post — and may be started again.
 */
const STALE_PUBLISH_MS = 15 * 60 * 1000;

/** Why this process cannot post to `platform` at all, or null when it can. */
function platformBlocker(platform) {
  const { pageId, pageToken, igUserId } = metaConfig();
  // Instagram is published with the Page token too.
  if (!pageId || !pageToken) return 'FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN is not set';
  if (platform === 'instagram' && !igUserId) return 'IG_USER_ID is not set';

  const db = nonProductionDatabase();
  if (db && process.env.SOCIAL_ALLOW_DEV_DATA !== 'true') {
    return `database "${db}" is not production and the social accounts are the real ones`;
  }
  return null;
}

/**
 * Why this process must not post automatically on approval, or null when it may.
 * Unlike a publish from Nexus, SOCIAL_ALLOW_DEV_DATA does not lift the database
 * check: nobody is there to decide that a development listing should go out.
 */
function autopostBlocker() {
  if (process.env.SOCIAL_AUTOPOST !== 'true') return 'SOCIAL_AUTOPOST is not "true"';

  const { pageId, pageToken } = metaConfig();
  if (!pageId || !pageToken) return 'FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN is not set';

  const db = nonProductionDatabase();
  if (db) return `database "${db}" is not production and the social accounts are the real ones`;

  return null;
}

/** A refused publish request; `code` is what Nexus reacts to. */
class SocialPublishError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

/**
 * Marks `platform` as being published, atomically, and returns the listing as
 * it is now — or null when the listing may not be published right now.
 *
 * The update only matches a listing that is live and not already publishing on
 * that platform, so a double click, two admins, or the approval racing a manual
 * publish cannot post twice. Beyond that:
 *   auto   — only a platform never attempted (a failure waits for an admin);
 *   manual — also a failed one, but not one already published;
 *   repost — also one already published.
 * Previous post details stay in place until the new post succeeds.
 */
function claimPlatform(listingId, platform, { mode, requestedBy, startedAt }) {
  const key = `socialPosts.${platform}`;
  const filter = {
    _id: listingId,
    status: 'active',
    endDate: { $gt: startedAt },
    $or: [
      { [`${key}.status`]: { $ne: 'publishing' } },
      { [`${key}.startedAt`]: { $lt: new Date(startedAt.getTime() - STALE_PUBLISH_MS) } }
    ]
  };
  if (mode === 'auto') filter[`${key}.status`] = null;
  if (mode === 'manual') filter[`${key}.postedAt`] = null;

  return Listing.findOneAndUpdate(
    filter,
    {
      $set: {
        [`${key}.status`]: 'publishing',
        [`${key}.startedAt`]: startedAt,
        [`${key}.requestedBy`]: requestedBy,
        [`${key}.error`]: null
      }
    },
    { new: true }
  ).lean();
}

/**
 * Saves how a publish ended. Only touches the attempt that `startedAt` claimed,
 * so a slow post that was given up on cannot overwrite a newer one. Never throws.
 */
function recordOutcome(listingId, platform, startedAt, fields) {
  const key = `socialPosts.${platform}`;
  const $set = Object.fromEntries(Object.entries(fields).map(([k, v]) => [`${key}.${k}`, v]));
  return Listing.updateOne({ _id: listingId, [`${key}.startedAt`]: startedAt }, { $set })
    .catch(err => logger.error(`[social] could not record ${platform} outcome for ${listingId}:`, err.message));
}

/** Posts a claimed listing to one platform and records the outcome. Never throws. */
async function runPlatform(listing, platform, startedAt) {
  const message = buildMessage(listing);
  try {
    if (platform === 'facebook') {
      await refreshLinkPreview(listing);
      const { postId } = await postToFacebook(listing, message);
      logger.info(`[social] Facebook post ${postId} for ${listing.slug}`);
      await recordOutcome(listing._id, platform, startedAt, {
        status: 'published', postId, postedAt: new Date(), error: null
      });
    } else {
      const { mediaId, permalink, imagesSent, imageCount } = await postToInstagram(listing, message);
      const partial = imageCount !== null && imageCount < imagesSent;
      logger[partial ? 'warn' : 'info'](
        `[social] Instagram post ${permalink || mediaId} for ${listing.slug} (${imageCount ?? '?'}/${imagesSent} images)`
      );
      await recordOutcome(listing._id, platform, startedAt, {
        status: 'published', mediaId, permalink, imagesSent, imageCount, postedAt: new Date(), error: null
      });
    }
  } catch (err) {
    logger.error(`[social] ${platform} failed for ${listing.slug}:`, err.message);
    await recordOutcome(listing._id, platform, startedAt, { status: 'failed', error: err.message });
  }
}

/**
 * Posts a just-approved listing to Facebook and Instagram.
 *
 * Runs after the approval response has gone out — an Instagram carousel takes
 * tens of seconds, and a Meta failure must never undo or delay an approval.
 * Every outcome, success or error, is saved under listing.socialPosts so Nexus
 * can show what went out and offer to try again.
 *
 * Each platform is claimed on its own (see claimPlatform) and at most once: a
 * platform that failed is left for an admin to publish from Nexus.
 */
async function publishApprovedListing(listingId) {
  const blocker = autopostBlocker();
  if (blocker) {
    logger.info(`[social] auto-post skipped for listing ${listingId}: ${blocker}`);
    return;
  }

  await Promise.all(PLATFORMS.map(async platform => {
    const platformBlock = platformBlocker(platform);
    if (platformBlock) {
      logger.info(`[social] auto-post to ${platform} skipped for listing ${listingId}: ${platformBlock}`);
      return;
    }

    const startedAt = new Date();
    const listing = await claimPlatform(listingId, platform, { mode: 'auto', requestedBy: 'auto', startedAt });
    if (!listing) {
      logger.info(`[social] listing ${listingId} not posted to ${platform}: already posted, not active, or already ended`);
      return;
    }
    await runPlatform(listing, platform, startedAt);
  }));
}

/** Fire-and-forget wrapper for request handlers. */
function schedulePublishApprovedListing(listingId) {
  setImmediate(() => {
    publishApprovedListing(listingId)
      .catch(err => logger.error(`[social] auto-post crashed for listing ${listingId}:`, err.message));
  });
}

/** A platform's saved state, with a publish that never finished shown as failed. */
function effectiveState(state, now = Date.now()) {
  if (!state?.status) return null;
  if (state.status === 'publishing' && new Date(state.startedAt).getTime() < now - STALE_PUBLISH_MS) {
    return { ...state, status: 'failed', error: 'Interrupted before it finished (the server restarted). Try again.' };
  }
  return state;
}

/** Why the listing itself cannot go out right now, or null. */
function listingBlocker(listing, now = new Date()) {
  if (listing.status !== 'active') return `The listing is ${listing.status.replace('_', ' ')} — only live listings are published.`;
  if (new Date(listing.endDate) <= now) return 'The listing has already ended.';
  return null;
}

const OVERVIEW_SELECT =
  'title titlePt description descriptionPt slug saleFormat currentPrice buyNowPrice endDate images status +socialPosts';

/** What Nexus shows in a listing's social media card. */
async function getSocialOverview(listingId) {
  const listing = await Listing.findById(listingId).select(OVERVIEW_SELECT).lean();
  if (!listing) throw new SocialPublishError(404, 'not_found', 'Listing not found.');

  const images = publishableImages(listing);
  const blockedListing = listingBlocker(listing);
  const platforms = {};
  for (const platform of PLATFORMS) {
    let reason = platformBlocker(platform) || blockedListing;
    if (!reason && platform === 'instagram' && images.length === 0) {
      reason = 'Instagram needs at least one photo.';
    }
    platforms[platform] = { available: !reason, reason, state: effectiveState(listing.socialPosts?.[platform]) };
  }

  return {
    caption: buildMessage(listing),
    link: listingUrl(listing),
    imageCount: images.length,
    instagramMaxImages: IG_CAROUSEL_MAX,
    autopost: { enabled: !autopostBlocker(), reason: autopostBlocker() },
    platforms
  };
}

/**
 * Publishes a listing to one platform on an admin's request, in the background.
 *
 * Resolves as soon as the platform is claimed; the post itself takes up to a
 * minute and its outcome lands in listing.socialPosts, which Nexus polls.
 * Throws SocialPublishError when the request is refused — notably
 * `already_posted`, which Nexus answers by asking before sending `repost`.
 */
async function requestPublish(listingId, platform, { repost = false, requestedBy = null } = {}) {
  if (!PLATFORMS.includes(platform)) {
    throw new SocialPublishError(400, 'invalid_platform', `Unknown platform "${platform}".`);
  }

  const blocker = platformBlocker(platform);
  if (blocker) throw new SocialPublishError(503, 'not_configured', `Publishing to ${platform} is unavailable: ${blocker}.`);

  const current = await Listing.findById(listingId).select(OVERVIEW_SELECT).lean();
  if (!current) throw new SocialPublishError(404, 'not_found', 'Listing not found.');

  const blockedListing = listingBlocker(current);
  if (blockedListing) throw new SocialPublishError(409, 'not_publishable', blockedListing);
  if (platform === 'instagram' && publishableImages(current).length === 0) {
    throw new SocialPublishError(409, 'no_images', 'Instagram needs at least one photo.');
  }

  const startedAt = new Date();
  const listing = await claimPlatform(listingId, platform, {
    mode: repost ? 'repost' : 'manual',
    requestedBy,
    startedAt
  });

  if (!listing) {
    // Read again: the listing may have changed between the checks and the claim.
    const now = await Listing.findById(listingId).select(OVERVIEW_SELECT).lean();
    const state = effectiveState(now?.socialPosts?.[platform]);
    if (!now) throw new SocialPublishError(404, 'not_found', 'Listing not found.');
    const nowBlocked = listingBlocker(now);
    if (nowBlocked) throw new SocialPublishError(409, 'not_publishable', nowBlocked);
    if (state?.status === 'publishing') {
      throw new SocialPublishError(409, 'in_progress', `Already being published to ${platform}.`);
    }
    throw new SocialPublishError(409, 'already_posted', `This listing was already published to ${platform}.`);
  }

  setImmediate(() => {
    runPlatform(listing, platform, startedAt)
      .catch(err => logger.error(`[social] ${platform} publish crashed for listing ${listingId}:`, err.message));
  });

  return { status: 'publishing', startedAt };
}

module.exports = {
  IG_CAROUSEL_MAX,
  PLATFORMS,
  STALE_PUBLISH_MS,
  SocialPublishError,
  buildExcerpt,
  buildMessage,
  publishableImages,
  postToFacebook,
  postToInstagram,
  nonProductionDatabase,
  platformBlocker,
  autopostBlocker,
  publishApprovedListing,
  schedulePublishApprovedListing,
  getSocialOverview,
  requestPublish
};
