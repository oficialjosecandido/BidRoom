const { purgeExpiredListingImages } = require('./imagePurgeService');

async function runImagePurge() {
  console.log('[ImagePurge] Starting daily image purge run...');
  try {
    const result = await purgeExpiredListingImages();
    return result;
  } catch (err) {
    console.error('[ImagePurge] Unhandled error during purge run:', err.message);
    throw err;
  }
}

module.exports = { runImagePurge };
