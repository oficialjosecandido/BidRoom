const ContentSafetyClient = require('@azure-rest/ai-content-safety').default;
const { AzureKeyCredential } = require('@azure/core-auth');

// Severity thresholds (0–6 scale, even numbers only: 0, 2, 4, 6)
// Block: severity >= 4 on Sexual or Violence
// Flag for review: severity >= 2 on Sexual or Violence
const BLOCK_THRESHOLD = 4;
const FLAG_THRESHOLD = 2;

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

module.exports = { scanImage, scanImages };
