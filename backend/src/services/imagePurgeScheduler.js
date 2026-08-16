const { purgeExpiredListingImages } = require('./imagePurgeService');
const logger = require('../utils/logger');

async function runImagePurge() {
  logger.info('[ImagePurge] Starting daily image purge run...');
  try {
    const result = await purgeExpiredListingImages();
    return result;
  } catch (err) {
    logger.error('[ImagePurge] Unhandled error during purge run:', err.message);
    throw err;
  }
}

module.exports = { runImagePurge };
