/**
 * Changes an admin makes to a listing's content from Nexus: its text in each
 * language and its photos.
 *
 * The slug is never touched — it is the listing's public URL, already shared
 * on social media and in emails.
 */

const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const azureStorageService = require('./azureStorage.service');
const { extractBlobName } = require('../shared/schemas/imageSchema');
const { detectImageMagic } = require('../utils/imageMagic');
const { LISTING_LOCALE_FIELDS, normalizeListingLocaleFields } = require('../utils/listingLocale');
const logger = require('../utils/logger');

const TITLE_MAX = 80;
const DESCRIPTION_MAX = 5000;
/** Same ceiling a seller has when creating a listing with photos only. */
const MAX_LISTING_IMAGES = 20;

/** The "No Image" URL a listing created without photos carries. */
const isPlaceholderImage = url => /placeholder\.com/i.test(String(url));

class ListingEditError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const TEXT_SELECT = ['title', 'description', ...LISTING_LOCALE_FIELDS].join(' ');

/**
 * Replaces the listing's title and description in every language.
 *
 * `fields` holds the eight per-language fields; a language left empty has no
 * text of its own and readers of it see the fallback. `title`/`description`
 * are recomputed as that fallback (Portuguese first), so at least one language
 * needs both a title and a description.
 */
async function updateListingText(listingId, fields = {}) {
  const input = {};
  for (const field of LISTING_LOCALE_FIELDS) {
    const value = fields[field];
    if (value != null && typeof value !== 'string') {
      throw new ListingEditError(400, 'invalid_text', `${field} must be text.`);
    }
    input[field] = value ?? '';
  }

  // Only the per-language fields go in, never `title`/`description`: those
  // would be taken as Portuguese and refill a language the admin just cleared.
  const localized = normalizeListingLocaleFields(input);

  for (const field of LISTING_LOCALE_FIELDS) {
    const max = field.startsWith('title') ? TITLE_MAX : DESCRIPTION_MAX;
    if ((localized[field] || '').length > max) {
      throw new ListingEditError(400, 'text_too_long', `${field} is longer than ${max} characters.`);
    }
  }
  if (!localized.title) throw new ListingEditError(400, 'title_required', 'At least one language needs a title.');
  if (!localized.description) {
    throw new ListingEditError(400, 'description_required', 'At least one language needs a description.');
  }

  const listing = await Listing.findByIdAndUpdate(listingId, { $set: localized }, { new: true })
    .select(TEXT_SELECT)
    .lean();
  if (!listing) throw new ListingEditError(404, 'not_found', 'Listing not found.');
  return listing;
}

async function loadImages(listingId) {
  const listing = await Listing.findById(listingId).select('images imageManifest status').lean();
  if (!listing) throw new ListingEditError(404, 'not_found', 'Listing not found.');
  return listing;
}

/** Manifest entries for new photos, matching the retention already set on the listing. */
function manifestEntriesFor(listing, urls) {
  const purgeAfter = (listing.imageManifest || []).find(img => img.purgeAfter)?.purgeAfter || null;
  return urls.map(url => ({
    url, blobName: extractBlobName(url), uploadedAt: new Date(), purgeAfter, purged: false, purgedAt: null
  }));
}

/**
 * Uploads photos and appends them to the listing.
 *
 * `files` are multer files. Their content is checked by magic bytes — the
 * client's Content-Type is not trusted. The "No Image" placeholder goes away
 * with the first real photo. Unlike seller uploads there is no content-safety
 * scan: that scan penalises the uploader, and here the uploader is the admin.
 */
async function addListingImages(listingId, files = []) {
  if (files.length === 0) throw new ListingEditError(400, 'no_files', 'No photos were sent.');

  const listing = await loadImages(listingId);
  const current = (listing.images || []).filter(url => !isPlaceholderImage(url));
  if (current.length + files.length > MAX_LISTING_IMAGES) {
    throw new ListingEditError(
      400, 'too_many_images',
      `A listing can have up to ${MAX_LISTING_IMAGES} photos (it has ${current.length}).`
    );
  }

  const verified = files.map(file => {
    const mimetype = detectImageMagic(file.buffer);
    if (!mimetype) {
      throw new ListingEditError(
        400, 'invalid_image', `"${file.originalname}" is not a JPEG, PNG, GIF, WebP or BMP image.`
      );
    }
    return { buffer: file.buffer, originalname: file.originalname, mimetype };
  });

  const uploaded = await azureStorageService.uploadMultipleImages(verified);
  const urls = uploaded.map(u => u.url);

  try {
    const update = { $push: { images: { $each: urls } } };
    // The manifest is only filled once a listing ends; keep it in step when it is.
    if ((listing.imageManifest || []).length > 0) {
      update.$push.imageManifest = { $each: manifestEntriesFor(listing, urls) };
    }
    if (current.length !== (listing.images || []).length) {
      // $pull and $push cannot target the same array in one update.
      await Listing.updateOne(
        { _id: listingId },
        { $pull: { images: { $regex: 'placeholder\\.com', $options: 'i' } } }
      );
    }
    const updated = await Listing.findByIdAndUpdate(listingId, update, { new: true }).select('images').lean();
    if (!updated) throw new ListingEditError(404, 'not_found', 'Listing not found.');
    return updated.images;
  } catch (err) {
    await Promise.allSettled(urls.map(url => azureStorageService.deleteImage(url)));
    throw err;
  }
}

/**
 * Of the photos taken off a listing, those whose files can be deleted: stored in
 * our container, not used by another listing (autorelist copies the URLs), and
 * not part of a completed sale, which keeps its photos for the fiscal retention
 * period (see imagePurgeService).
 */
async function deletableImages(listingId, removed) {
  const base = azureStorageService.getContainerBaseUrl();
  const ours = removed.filter(url => base && url.startsWith(base));
  if (ours.length === 0) return [];

  const sold = await Transaction.exists({ listing: listingId, transactionStatus: 'completed' });
  if (sold) return [];

  const shared = await Listing.find({ _id: { $ne: listingId }, images: { $in: ours } }).select('images').lean();
  const usedElsewhere = new Set(shared.flatMap(l => l.images));
  return ours.filter(url => !usedElsewhere.has(url));
}

/**
 * Sets which of the listing's photos it keeps, in order — the first is the
 * cover. Only photos the listing already has are accepted; new ones go through
 * addListingImages.
 *
 * `expected` is the list the admin was looking at. When the listing's photos
 * changed since (another admin, the seller), nothing is written and 409 comes
 * back, so a stale screen cannot silently drop someone else's upload.
 */
async function setListingImages(listingId, images, expected) {
  if (!Array.isArray(images) || images.some(url => typeof url !== 'string')) {
    throw new ListingEditError(400, 'invalid_images', 'images must be a list of photo URLs.');
  }
  if (new Set(images).size !== images.length) {
    throw new ListingEditError(400, 'duplicate_images', 'The same photo appears twice.');
  }

  const listing = await loadImages(listingId);
  const current = listing.images || [];
  if (Array.isArray(expected) && JSON.stringify(expected) !== JSON.stringify(current)) {
    throw new ListingEditError(409, 'images_changed', 'The photos were changed meanwhile. Reload and try again.');
  }

  const unknown = images.filter(url => !current.includes(url));
  if (unknown.length > 0) {
    throw new ListingEditError(400, 'unknown_images', 'Only photos the listing already has can be kept or reordered.');
  }
  if (images.filter(url => !isPlaceholderImage(url)).length === 0) {
    throw new ListingEditError(400, 'image_required', 'A listing needs at least one photo.');
  }

  const removed = current.filter(url => !images.includes(url));
  const deletable = await deletableImages(listingId, removed);

  const $set = { images };
  if ((listing.imageManifest || []).length > 0) {
    // A photo whose file stays (shared or fiscal) keeps its manifest entry so
    // the purge still gets to it.
    $set.imageManifest = listing.imageManifest.filter(img => !deletable.includes(img.url));
  }

  // Matching on the array read above makes the check-then-write atomic.
  const result = await Listing.updateOne({ _id: listingId, images: current }, { $set });
  if (result.matchedCount === 0) {
    throw new ListingEditError(409, 'images_changed', 'The photos were changed meanwhile. Reload and try again.');
  }

  if (deletable.length > 0) {
    Promise.allSettled(deletable.map(url => azureStorageService.deleteImage(url)))
      .catch(err => logger.error(`[listing-edit] deleting photos of ${listingId}:`, err.message));
  }

  return { images, removed, deletedFiles: deletable.length };
}

module.exports = {
  MAX_LISTING_IMAGES,
  ListingEditError,
  updateListingText,
  addListingImages,
  setListingImages
};
