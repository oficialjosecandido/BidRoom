const ContentSafetyClient = require('@azure-rest/ai-content-safety').default;
const { AzureKeyCredential } = require('@azure/core-auth');
const FormData = require('form-data');
const fetch = require('node-fetch');

// ---------------------------------------------------------------------------
// Azure Content Safety — image severity thresholds (0–6 scale, even numbers)
// ---------------------------------------------------------------------------
const BLOCK_THRESHOLD = 4;
const FLAG_THRESHOLD  = 2;

// Text severity thresholds — stricter than images
// Sexual >= 2 catches adult services listings; Violence >= 2 catches weapons/threats
const TEXT_THRESHOLDS = { Violence: 2, Sexual: 2, Hate: 2, SelfHarm: 2 };

const BLOCKLIST_NAME = 'bidroom-prohibited';

// ---------------------------------------------------------------------------
// Sightengine — score thresholds (0–1 scale)
// Docs: https://sightengine.com/docs
//   nudity-2.0: .sexual_activity, .sexual_display, .erotica, .very_suggestive
//   gore:       .prob
//   weapon:     (root-level) .weapon
//   recreational_drug: .prob
// ---------------------------------------------------------------------------
const SE_BLOCK_SEXUAL  = 0.70;  // explicit sexual content → block
const SE_BLOCK_GORE    = 0.70;  // gore / graphic violence → block
const SE_FLAG_SEXUAL   = 0.40;  // suggestive but not explicit → flag
const SE_FLAG_GORE     = 0.40;  // mild gore → flag
const SE_FLAG_WEAPON   = 0.80;  // firearms / knives (marketplace context: flag, not block)
const SE_FLAG_DRUG     = 0.80;  // drug paraphernalia → flag

// ---------------------------------------------------------------------------
// Azure client (lazily initialised)
// ---------------------------------------------------------------------------
let azureClient = null;

function getAzureClient() {
  if (azureClient) return azureClient;
  const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key      = process.env.AZURE_CONTENT_SAFETY_KEY;
  if (!endpoint || !key) return null;
  azureClient = ContentSafetyClient(endpoint, new AzureKeyCredential(key));
  return azureClient;
}

function isSightengineConfigured() {
  return !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);
}

// ---------------------------------------------------------------------------
// Sightengine scan — used as fallback when Azure is not configured
// ---------------------------------------------------------------------------
/**
 * Send an image buffer to the Sightengine REST API and interpret the scores.
 *
 * Returns the same shape as scanImageAzure() so callers are provider-agnostic:
 *   { safe, flagged, blocked, categories, provider }
 *
 * Returns null if Sightengine credentials are not set (caller falls through).
 */
async function scanImageSightengine(imageBuffer) {
  if (!isSightengineConfigured()) return null;

  const form = new FormData();
  // Sightengine accepts the image as a multipart file field called "media"
  form.append('media', imageBuffer, {
    filename: 'upload.jpg',
    contentType: 'image/jpeg'
  });
  form.append('models', 'nudity-2.0,gore,weapon,recreational_drug');
  form.append('api_user',   process.env.SIGHTENGINE_API_USER);
  form.append('api_secret', process.env.SIGHTENGINE_API_SECRET);

  const response = await fetch('https://api.sightengine.com/1.0/check.json', {
    method:  'POST',
    body:    form,
    headers: form.getHeaders(),
    timeout: 10000   // 10 s — don't block uploads indefinitely
  });

  if (!response.ok) {
    throw new Error(`Sightengine API returned ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== 'success') {
    throw new Error(`Sightengine error: ${data.error?.message || 'unknown'}`);
  }

  // ── Score extraction ────────────────────────────────────────────────────
  const nudity  = data.nudity || {};
  const gore    = data.gore   || {};

  // Explicit sexual content (any of these alone is enough to block)
  const explicitScore = Math.max(
    nudity.sexual_activity || 0,
    nudity.sexual_display  || 0,
    nudity.erotica         || 0
  );
  // Suggestive but not explicit
  const suggestiveScore = Math.max(
    nudity.very_suggestive || 0,
    nudity.suggestive      || 0
  );
  const goreScore   = gore.prob  || 0;
  const weaponScore = typeof data.weapon === 'number' ? data.weapon : (data.weapon?.prob || 0);
  const drugScore   = data.recreational_drug?.prob || 0;

  // ── Decision logic ──────────────────────────────────────────────────────
  const blocked = explicitScore >= SE_BLOCK_SEXUAL || goreScore >= SE_BLOCK_GORE;
  const flagged = !blocked && (
    explicitScore   >= SE_FLAG_SEXUAL  ||
    suggestiveScore >= 0.65            ||   // very suggestive on a marketplace
    goreScore       >= SE_FLAG_GORE    ||
    weaponScore     >= SE_FLAG_WEAPON  ||
    drugScore       >= SE_FLAG_DRUG
  );

  return {
    safe: !blocked && !flagged,
    flagged,
    blocked,
    categories: {
      explicit:    explicitScore,
      suggestive:  suggestiveScore,
      gore:        goreScore,
      weapon:      weaponScore,
      drug:        drugScore
    },
    provider: 'sightengine'
  };
}

// ---------------------------------------------------------------------------
// Azure scan (extracted for clarity)
// ---------------------------------------------------------------------------
async function scanImageAzure(imageBuffer) {
  const c = getAzureClient();
  if (!c) return null;  // not configured

  const response = await c.path('/image:analyze').post({
    body: {
      image:      { content: imageBuffer.toString('base64') },
      categories: ['Sexual', 'Violence', 'Hate', 'SelfHarm'],
      outputType: 'FourSeverityLevels'
    }
  });

  if (response.status !== '200') {
    throw new Error(`Azure Content Safety error: ${response.status}`);
  }

  const analysis  = response.body.categoriesAnalysis;
  const categories = {};
  for (const item of analysis) {
    categories[item.category] = item.severity;
  }

  const maxSeverity = Math.max(...Object.values(categories));
  const blocked = maxSeverity >= BLOCK_THRESHOLD;
  const flagged = !blocked && maxSeverity >= FLAG_THRESHOLD;

  return { safe: !blocked && !flagged, flagged, blocked, categories, provider: 'azure' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan a single image buffer for content policy violations.
 *
 * Provider chain (first configured wins):
 *   1. Azure Content Safety  (AZURE_CONTENT_SAFETY_ENDPOINT + AZURE_CONTENT_SAFETY_KEY)
 *   2. Sightengine           (SIGHTENGINE_API_USER + SIGHTENGINE_API_SECRET)
 *   3. No provider configured → log a warning and mark as skipped (allow through)
 *
 * @param {Buffer} imageBuffer
 * @returns {Promise<{
 *   safe: boolean,
 *   flagged: boolean,
 *   blocked: boolean,
 *   categories: object,
 *   provider: string,
 *   skipped?: boolean
 * }>}
 */
async function scanImage(imageBuffer) {
  // 1 — Try Azure
  const azureResult = await scanImageAzure(imageBuffer);
  if (azureResult !== null) return azureResult;

  // 2 — Try Sightengine
  const seResult = await scanImageSightengine(imageBuffer);
  if (seResult !== null) return seResult;

  // 3 — No provider configured
  if (!process.env._CONTENT_SAFETY_WARNED) {
    // Emit once per process so production logs are not flooded
    process.env._CONTENT_SAFETY_WARNED = '1';
    console.warn(
      '[ContentSafety] WARNING: No image scan provider is configured. ' +
      'Images are being allowed through without moderation. ' +
      'Set AZURE_CONTENT_SAFETY_ENDPOINT + AZURE_CONTENT_SAFETY_KEY ' +
      'or SIGHTENGINE_API_USER + SIGHTENGINE_API_SECRET in your environment.'
    );
  }
  return { safe: true, flagged: false, blocked: false, categories: {}, provider: 'none', skipped: true };
}

/**
 * Scan multiple image buffers. Stops and returns blocked=true as soon as any
 * image exceeds the block threshold (fail-fast for the batch).
 *
 * @param {Buffer[]} buffers
 * @returns {Promise<{ allSafe: boolean, anyFlagged: boolean, blocked: boolean, results: object[] }>}
 */
async function scanImages(buffers) {
  const results = await Promise.all(buffers.map(buf => scanImage(buf)));
  const blockedResult = results.find(r => r.blocked);
  if (blockedResult) {
    return { allSafe: false, anyFlagged: false, blocked: true, results };
  }
  const anyFlagged = results.some(r => r.flagged);
  return { allSafe: !anyFlagged, anyFlagged, blocked: false, results };
}

/**
 * Scan listing text (title + description) for policy violations using Azure AI Content Safety.
 * Checks AI categories (Violence, Sexual, Hate, SelfHarm) and the bidroom-prohibited blocklist.
 * Gracefully skips if Azure Content Safety is not configured.
 *
 * @param {string} title
 * @param {string} description
 * @returns {Promise<{ blocked: boolean, reason: string|null, skipped: boolean }>}
 */
async function scanListingText(title, description) {
  const c = getAzureClient();
  if (!c) return { blocked: false, reason: null, skipped: true };

  const text = `${title || ''}. ${description || ''}`.slice(0, 10000);

  const response = await c.path('/text:analyze').post({
    body: {
      text,
      categories:       ['Violence', 'Sexual', 'Hate', 'SelfHarm'],
      blocklistNames:   [BLOCKLIST_NAME],
      haltOnBlocklistHit: true,
      outputType:       'FourSeverityLevels'
    }
  });

  if (response.status !== '200') {
    throw new Error(`Azure Content Safety text error: ${response.status}`);
  }

  const body = response.body;

  if (body.blocklistsMatch?.length > 0) {
    const term = body.blocklistsMatch[0].blocklistItemText;
    return { blocked: true, reason: `Prohibited item: "${term}"`, skipped: false };
  }

  for (const cat of (body.categoriesAnalysis || [])) {
    const threshold = TEXT_THRESHOLDS[cat.category] ?? 4;
    if (cat.severity >= threshold) {
      return { blocked: true, reason: `Content flagged: ${cat.category} (severity ${cat.severity})`, skipped: false };
    }
  }

  return { blocked: false, reason: null, skipped: false };
}

// ---------------------------------------------------------------------------
// Blocklist management helpers (used by admin endpoints)
// ---------------------------------------------------------------------------
async function getBlocklistItems() {
  const c = getAzureClient();
  if (!c) return [];
  const response = await c.path('/text/blocklists/{blocklistName}/blocklistItems', BLOCKLIST_NAME).get();
  if (response.status !== '200') throw new Error(`Azure blocklist get error: ${response.status}`);
  return response.body.value || [];
}

async function addBlocklistItem(text) {
  const c = getAzureClient();
  if (!c) throw new Error('Azure Content Safety not configured');
  const response = await c.path('/text/blocklists/{blocklistName}/blocklistItems:add', BLOCKLIST_NAME).post({
    body: { blocklistItems: [{ text: text.trim().slice(0, 128) }] }
  });
  if (response.status !== '200') throw new Error(`Azure blocklist add error: ${response.status}`);
  return response.body.addedOrUpdatedItems?.[0] || null;
}

async function removeBlocklistItem(itemId) {
  const c = getAzureClient();
  if (!c) throw new Error('Azure Content Safety not configured');
  const response = await c.path('/text/blocklists/{blocklistName}/blocklistItems:remove', BLOCKLIST_NAME).post({
    body: { blocklistItemIds: [itemId] }
  });
  if (response.status !== '204') throw new Error(`Azure blocklist remove error: ${response.status}`);
}

async function ensureBlocklistExists() {
  const c = getAzureClient();
  if (!c) return;
  await c.path('/text/blocklists/{blocklistName}', BLOCKLIST_NAME).patch({
    contentType: 'application/merge-patch+json',
    body: { description: 'BidRoom prohibited listing terms' }
  });
}

module.exports = {
  scanImage,
  scanImages,
  scanListingText,
  getBlocklistItems,
  addBlocklistItem,
  removeBlocklistItem,
  ensureBlocklistExists,
  BLOCKLIST_NAME
};
