const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  blobName: { type: String, default: null },
  uploadedAt: { type: Date, default: Date.now },
  purgeAfter: { type: Date, default: null },
  purged: { type: Boolean, default: false },
  purgedAt: { type: Date, default: null }
}, { _id: false });

/**
 * Extract the blob name (path within container) from an Azure Blob Storage URL.
 * e.g. "https://account.blob.core.windows.net/container/prefix/uuid.jpg" → "prefix/uuid.jpg"
 * e.g. "https://account.blob.core.windows.net/container/uuid.jpg" → "uuid.jpg"
 * Returns null if the URL cannot be parsed.
 */
function extractBlobName(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/');
    // pathname: /container-name/rest-of-path
    // parts[0] = '' (empty before first slash)
    // parts[1] = container name
    // parts[2..] = blob path within container
    const blobPath = parts.slice(2).join('/');
    return blobPath || null;
  } catch {
    return null;
  }
}

module.exports = { imageSchema, extractBlobName };
