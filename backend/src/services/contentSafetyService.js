const ContentSafetyClient = require('@azure-rest/ai-content-safety').default;
const { AzureKeyCredential } = require('@azure/core-auth');

// Image severity thresholds (0–6 scale, even numbers only)
const BLOCK_THRESHOLD = 4;
const FLAG_THRESHOLD = 2;

// Text severity thresholds — stricter than images
// Sexual >= 2 catches adult services listings; Violence >= 2 catches weapons/threats
const TEXT_THRESHOLDS = { Violence: 2, Sexual: 2, Hate: 2, SelfHarm: 2 };

const BLOCKLIST_NAME = 'bidroom-prohibited';

let client = null;

function getClient() {
  if (client) return client;
  const endpoint = process.env.AZURE_CONTENT_SAFETY_ENDPOINT;
  const key = process.env.AZURE_CONTENT_SAFETY_KEY;
  if (!endpoint || !key) return null;
  client = ContentSafetyClient(endpoint, new AzureKeyCredential(key));
  return client;
}

/**
 * Scan an image buffer for content policy violations.
 * @param {Buffer} imageBuffer
 * @returns {Promise<{ safe: boolean, flagged: boolean, categories: object, blocked: boolean }>}
 *   - safe: true if no threshold exceeded
 *   - flagged: true if severity is in the review range (2–3) but not blocked
 *   - blocked: true if severity >= BLOCK_THRESHOLD
 *   - categories: raw severity per category from Azure
 */
async function scanImage(imageBuffer) {
  const c = getClient();

  // If not configured, skip scan and allow through
  if (!c) {
    return { safe: true, flagged: false, blocked: false, categories: {}, skipped: true };
  }

  const response = await c.path('/image:analyze').post({
    body: {
      image: { content: imageBuffer.toString('base64') },
      categories: ['Sexual', 'Violence', 'Hate', 'SelfHarm'],
      outputType: 'FourSeverityLevels'
    }
  });

  if (response.status !== '200') {
    throw new Error(`Azure Content Safety error: ${response.status}`);
  }

  const analysis = response.body.categoriesAnalysis;
  const categories = {};
  for (const item of analysis) {
    categories[item.category] = item.severity;
  }

  const maxSeverity = Math.max(...Object.values(categories));
  const blocked = maxSeverity >= BLOCK_THRESHOLD;
  const flagged = !blocked && maxSeverity >= FLAG_THRESHOLD;

  return { safe: !blocked && !flagged, flagged, blocked, categories };
}

/**
 * Scan multiple image buffers. Rejects immediately if any is blocked.
 * @param {Buffer[]} buffers
 * @returns {Promise<{ allSafe: boolean, anyFlagged: boolean, results: object[] }>}
 */
async function scanImages(buffers) {
  const results = await Promise.all(buffers.map(buf => scanImage(buf)));
  const blocked = results.find(r => r.blocked);
  if (blocked) {
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
  const c = getClient();
  if (!c) return { blocked: false, reason: null, skipped: true };

  const text = `${title || ''}. ${description || ''}`.slice(0, 10000);

  const response = await c.path('/text:analyze').post({
    body: {
      text,
      categories: ['Violence', 'Sexual', 'Hate', 'SelfHarm'],
      blocklistNames: [BLOCKLIST_NAME],
      haltOnBlocklistHit: true,
      outputType: 'FourSeverityLevels'
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

/**
 * Blocklist management helpers (used by admin endpoints).
 */
async function getBlocklistItems() {
  const c = getClient();
  if (!c) return [];
  const response = await c.path('/text/blocklists/{blocklistName}/blocklistItems', BLOCKLIST_NAME).get();
  if (response.status !== '200') throw new Error(`Azure blocklist get error: ${response.status}`);
  return response.body.value || [];
}

async function addBlocklistItem(text) {
  const c = getClient();
  if (!c) throw new Error('Azure Content Safety not configured');
  const response = await c.path('/text/blocklists/{blocklistName}/blocklistItems:add', BLOCKLIST_NAME).post({
    body: { blocklistItems: [{ text: text.trim().slice(0, 128) }] }
  });
  if (response.status !== '200') throw new Error(`Azure blocklist add error: ${response.status}`);
  return response.body.addedOrUpdatedItems?.[0] || null;
}

async function removeBlocklistItem(itemId) {
  const c = getClient();
  if (!c) throw new Error('Azure Content Safety not configured');
  const response = await c.path('/text/blocklists/{blocklistName}/blocklistItems:remove', BLOCKLIST_NAME).post({
    body: { blocklistItemIds: [itemId] }
  });
  if (response.status !== '204') throw new Error(`Azure blocklist remove error: ${response.status}`);
}

async function ensureBlocklistExists() {
  const c = getClient();
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
