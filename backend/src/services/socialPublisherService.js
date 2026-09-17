/**
 * Publishing listings to the BidRoom Facebook Page and Instagram account.
 *
 * Two callers: the Nexus approval, which posts automatically in the background
 * (publishApprovedListing), and scripts/post-listing.js, which posts by hand.
 * Both compose and send through the functions below, so a manual repost looks
 * exactly like the automatic one.
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

/** Why this process must not post automatically, or null when it may. */
function autopostBlocker() {
  if (process.env.SOCIAL_AUTOPOST !== 'true') return 'SOCIAL_AUTOPOST is not "true"';

  const { pageId, pageToken } = metaConfig();
  if (!pageId || !pageToken) return 'FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN is not set';

  const db = nonProductionDatabase();
  if (db) return `database "${db}" is not production and the social accounts are the real ones`;

  return null;
}

/** Records one platform's outcome on the listing. Never throws. */
function recordOutcome(listingId, platform, fields) {
  return Listing.updateOne(
    { _id: listingId },
    { $set: { [`socialPosts.${platform}`]: fields } }
  ).catch(err => logger.error(`[social] could not record ${platform} outcome for ${listingId}:`, err.message));
}

/**
 * Posts a just-approved listing to Facebook and Instagram.
 *
 * Runs after the approval response has gone out — an Instagram carousel takes
 * tens of seconds, and a Meta failure must never undo or delay an approval.
 * Every outcome, success or error, is saved under listing.socialPosts so Nexus
 * and scripts can tell what went out.
 *
 * At most once per listing: the claim is an atomic update on socialPosts.claimedAt,
 * so a double-submitted approval or a second instance cannot post twice.
 * A failed platform is not retried automatically — repost it with
 * `node scripts/post-listing.js --slug=<slug> --post --instagram-only`.
 */
async function publishApprovedListing(listingId) {
  const blocker = autopostBlocker();
  if (blocker) {
    logger.info(`[social] auto-post skipped for listing ${listingId}: ${blocker}`);
    return;
  }

  const listing = await Listing.findOneAndUpdate(
    { _id: listingId, status: 'active', endDate: { $gt: new Date() }, 'socialPosts.claimedAt': null },
    { $set: { 'socialPosts.claimedAt': new Date() } },
    { new: true }
  ).lean();

  if (!listing) {
    logger.info(`[social] listing ${listingId} not posted: already posted, not active, or already ended`);
    return;
  }

  const message = buildMessage(listing);

  const facebook = postToFacebook(listing, message)
    .then(({ postId }) => {
      logger.info(`[social] Facebook post ${postId} for ${listing.slug}`);
      return recordOutcome(listing._id, 'facebook', { postId, postedAt: new Date(), error: null });
    })
    .catch(err => {
      logger.error(`[social] Facebook failed for ${listing.slug}:`, err.message);
      return recordOutcome(listing._id, 'facebook', { postId: null, postedAt: null, error: err.message });
    });

  const instagram = postToInstagram(listing, message)
    .then(({ mediaId, permalink, imagesSent, imageCount }) => {
      const partial = imageCount !== null && imageCount < imagesSent;
      logger[partial ? 'warn' : 'info'](
        `[social] Instagram post ${permalink || mediaId} for ${listing.slug} (${imageCount ?? '?'}/${imagesSent} images)`
      );
      return recordOutcome(listing._id, 'instagram', {
        mediaId, permalink, imagesSent, imageCount, postedAt: new Date(), error: null
      });
    })
    .catch(err => {
      logger.error(`[social] Instagram failed for ${listing.slug}:`, err.message);
      return recordOutcome(listing._id, 'instagram', { mediaId: null, postedAt: null, error: err.message });
    });

  await Promise.all([facebook, instagram]);
}

/** Fire-and-forget wrapper for request handlers. */
function schedulePublishApprovedListing(listingId) {
  setImmediate(() => {
    publishApprovedListing(listingId)
      .catch(err => logger.error(`[social] auto-post crashed for listing ${listingId}:`, err.message));
  });
}

module.exports = {
  IG_CAROUSEL_MAX,
  buildExcerpt,
  buildMessage,
  publishableImages,
  postToFacebook,
  postToInstagram,
  nonProductionDatabase,
  autopostBlocker,
  publishApprovedListing,
  schedulePublishApprovedListing
};
