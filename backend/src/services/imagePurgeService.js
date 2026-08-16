/**
 * RGPD-compliant image purge service.
 *
 * Retention rules:
 *  - Listing with completed transaction  → 10 years (lei fiscal portuguesa)
 *  - Listing ended, no transaction        → 90 days from end date
 *  - Listing cancelled                    → 30 days from cancellation
 *  - Account closure (Art. 17)            → immediate, except fiscal-protected images
 */

const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const azureStorageService = require('./azureStorage.service');
const ModerationAuditLog = require('../models/ModerationAuditLog');
const { extractBlobName } = require('../shared/schemas/imageSchema');
const logger = require('../utils/logger');

const RETENTION_DAYS = {
  COMPLETED_TRANSACTION: 10 * 365, // ~10 years (fiscal law)
  ENDED_NO_TRANSACTION: 90,
  CANCELLED: 30
};

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Determine the purge date for a listing's images based on status and transactions.
 * Returns null when no purge date should be set yet (active/draft).
 */
async function calcListingImagePurgeDate(listing) {
  const { status } = listing;

  if (status === 'active' || status === 'draft') return null;

  if (status === 'cancelled') {
    const base = listing.updatedAt || new Date();
    return addDays(base, RETENTION_DAYS.CANCELLED);
  }

  if (status === 'ended') {
    const completedTx = await Transaction.findOne({
      listing: listing._id,
      transactionStatus: 'completed'
    }).select('_id').lean();

    const base = listing.endDate || listing.updatedAt || new Date();
    return completedTx
      ? addDays(base, RETENTION_DAYS.COMPLETED_TRANSACTION)
      : addDays(base, RETENTION_DAYS.ENDED_NO_TRANSACTION);
  }

  return null;
}

/**
 * Build an imageManifest array from a listing's images string array.
 * Extracts blobName from each URL.
 */
function buildManifestFromUrls(urls, purgeAfter, uploadedAt) {
  return (urls || []).map(url => ({
    url,
    blobName: extractBlobName(url),
    uploadedAt: uploadedAt || new Date(),
    purgeAfter,
    purged: false,
    purgedAt: null
  }));
}

/**
 * Daily purge job — two passes:
 *  1. Set purge dates on ended/cancelled listings with missing manifests
 *  2. Delete blobs whose purgeAfter has passed
 */
async function purgeExpiredListingImages() {
  const now = new Date();
  let purgeSet = 0;
  let purged = 0;
  let errors = 0;

  // ── Pass 1: Set purge dates ─────────────────────────────────────────────
  const noManifest = await Listing.find({
    status: { $in: ['ended', 'cancelled'] },
    images: { $exists: true, $not: { $size: 0 } },
    imageManifest: { $size: 0 }
  }).select('_id status images endDate updatedAt').lean();

  for (const listing of noManifest) {
    try {
      const purgeAfter = await calcListingImagePurgeDate(listing);
      if (!purgeAfter) continue;

      const manifest = buildManifestFromUrls(listing.images, purgeAfter, listing.updatedAt);
      await Listing.updateOne({ _id: listing._id }, { $set: { imageManifest: manifest } });
      purgeSet++;
    } catch (err) {
      logger.error(`[ImagePurge] Failed to set purge date for listing ${listing._id}:`, err.message);
      errors++;
    }
  }

  // ── Pass 2: Delete overdue blobs ────────────────────────────────────────
  const toDelete = await Listing.find({
    'imageManifest': {
      $elemMatch: {
        purgeAfter: { $lte: now },
        purged: false
      }
    }
  }).select('_id imageManifest').lean();

  for (const listing of toDelete) {
    const due = (listing.imageManifest || []).filter(
      img => img.purgeAfter && new Date(img.purgeAfter) <= now && !img.purged
    );

    for (const img of due) {
      try {
        if (img.blobName) {
          await azureStorageService.deleteBlobByName(img.blobName);
        }
        await Listing.updateOne(
          { _id: listing._id, 'imageManifest.url': img.url },
          { $set: { 'imageManifest.$.purged': true, 'imageManifest.$.purgedAt': now } }
        );
        purged++;
      } catch (err) {
        logger.error(`[ImagePurge] Failed to purge ${img.blobName || img.url}:`, err.message);
        errors++;
      }
    }
  }

  const summary = { purgeSet, purged, errors, runAt: now.toISOString() };
  logger.info(`[ImagePurge] Daily run complete — manifests set: ${purgeSet}, blobs purged: ${purged}, errors: ${errors}`);
  return summary;
}

/**
 * Immediately purge all non-fiscal images when a user account is closed (RGPD Art. 17).
 * Images from completed transactions are preserved for fiscal retention (10 years).
 */
async function purgeUserImagesOnClosure(userId) {
  const now = new Date();
  let purged = 0;
  let errors = 0;

  // IDs of listings with completed transactions (fiscal-protected)
  const protectedListingIds = await Transaction.distinct('listing', {
    seller: userId,
    transactionStatus: 'completed'
  });
  const protectedSet = new Set(protectedListingIds.map(id => id.toString()));

  const listings = await Listing.find({ seller: userId }).select('_id images imageManifest updatedAt').lean();

  for (const listing of listings) {
    if (protectedSet.has(listing._id.toString())) continue;

    // Use existing manifest or build from URL array
    const manifest = (listing.imageManifest || []).length > 0
      ? listing.imageManifest
      : buildManifestFromUrls(listing.images, now, listing.updatedAt);

    const updatedManifest = [];
    for (const img of manifest) {
      if (img.purged) {
        updatedManifest.push(img);
        continue;
      }
      const blobName = img.blobName || extractBlobName(img.url);
      try {
        if (blobName) await azureStorageService.deleteBlobByName(blobName);
        updatedManifest.push({ ...img, blobName, purgeAfter: now, purged: true, purgedAt: now });
        purged++;
      } catch (err) {
        logger.error(`[ImagePurge] Closure purge error for ${blobName}:`, err.message);
        updatedManifest.push({ ...img, blobName });
        errors++;
      }
    }

    await Listing.updateOne(
      { _id: listing._id },
      { $set: { imageManifest: updatedManifest } }
    ).catch(e => logger.error(`[ImagePurge] Manifest update failed for listing ${listing._id}:`, e.message));
  }

  await ModerationAuditLog.create({
    subjectUserId: userId,
    actionType: 'image_purge_account_closure',
    performedByUserId: null,
    metadata: { purgedCount: purged, errorCount: errors, runAt: now, protectedListings: protectedSet.size }
  }).catch(e => logger.error('[ImagePurge] Audit log write failed:', e.message));

  logger.info(`[ImagePurge] Account closure purge for user ${userId}: ${purged} blobs deleted, ${errors} errors`);
  return { purged, errors };
}

module.exports = {
  calcListingImagePurgeDate,
  purgeExpiredListingImages,
  purgeUserImagesOnClosure
};
