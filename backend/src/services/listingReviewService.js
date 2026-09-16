/**
 * Manual review of listings.
 *
 * Every listing is created as `pending_review` and stays invisible to the public
 * until an admin approves it in Nexus. This module owns both outcomes so the
 * route stays a thin HTTP wrapper and the side effects (clock, notifications,
 * follower announcements, audit trail) cannot drift apart between them.
 */

const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const { sendEmail } = require('./emailService');
const { renderEmailTemplate } = require('./templateEngine');
const { appendModerationAudit } = require('./moderationAuditService');
const { resolveLanguage } = require('./listingReviewMessages');
const {
  notifyListingReviewed,
  notifyFollowersNewListing,
  notifyCategoryFollowersNewListing,
  notifySimilarItemWatchers,
  emitNewNotificationToUser
} = require('./notificationService');
const { publicBaseUrl } = require('../utils/publicUrls');
const logger = require('../utils/logger');

/** Thrown for conditions the caller should turn into a 4xx rather than a 500. */
class ReviewError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Send the outcome email. Never throws: a mail failure must not roll back a
 * decision that is already saved, and the in-app notification still stands.
 */
async function sendReviewEmail(seller, listing, decision, reason) {
  if (!seller?.email) return;

  const base = publicBaseUrl();
  const language = resolveLanguage(seller.language);
  const template = decision === 'approved' ? 'listingApproved' : 'listingRejected';

  try {
    const { subject, html } = renderEmailTemplate(template, language, {
      firstName: seller.firstName || '',
      listingTitle: listing.titlePt || listing.title || '',
      listingUrl: `${base}/listing/${listing.slug}`,
      dashboardUrl: `${base}/dashboard/seller`,
      reason: reason || ''
    });
    await sendEmail(seller.email, subject, html);
  } catch (err) {
    logger.error(`[listingReview] ${template} email failed for ${listing.slug}:`, err.message);
  }
}

/**
 * Tell followers, category followers and similar-item watchers about a listing.
 *
 * This used to run at creation time. It cannot any more: until an admin
 * approves, the listing 404s for everyone but its seller, so announcing it then
 * would send people to a page they are not allowed to see.
 */
function announceToAudience(listing, seller, io) {
  setImmediate(() => {
    notifyFollowersNewListing({
      sellerId: seller._id,
      sellerFirstName: seller.firstName,
      listingTitle: listing.title,
      listingSlug: listing.slug,
      io
    });
    notifyCategoryFollowersNewListing({
      category: listing.category,
      listingTitle: listing.title,
      listingSlug: listing.slug,
      sellerUserId: seller._id,
      io
    });
    notifySimilarItemWatchers({
      category: listing.category,
      startingPrice: listing.startingPrice,
      listingTitle: listing.title,
      listingSlug: listing.slug,
      newListingId: listing._id,
      sellerUserId: seller._id,
      io
    });
  });
}

/** Loads a listing that is actually awaiting review, or explains why it is not. */
async function loadPendingListing(listingId) {
  const listing = await Listing.findById(listingId);
  if (!listing) throw new ReviewError('Listing not found', 404);
  if (listing.status !== 'pending_review') {
    throw new ReviewError(`Listing is "${listing.status}", not awaiting review.`, 409);
  }
  return listing;
}

/**
 * Approve a listing: it goes live and its auction starts counting from now.
 *
 * The clock is restarted on purpose. startDate/endDate are set at creation from
 * the chosen duration, but the listing does not exist for buyers until this
 * moment — leaving the original dates would silently spend the seller's auction
 * on the review queue, and a short slot could even end before it was published.
 */
async function approveListing({ listingId, admin, io, ip = null }) {
  const listing = await loadPendingListing(listingId);

  listing.status = 'active';
  listing.startDate = new Date();
  listing.endDate = listing.calculateEndDate(listing.startDate);
  listing.moderationReview = {
    decision: 'approved',
    reason: null,
    reviewedAt: new Date(),
    reviewedBy: admin?._id || null
  };
  // save() rather than updateOne(): the status→active hook on the model is what
  // pings IndexNow, and it only runs on a document save.
  await listing.save();

  const seller = await Customer.findById(listing.seller)
    .select('_id email firstName language')
    .lean();

  if (seller) {
    await notifyReviewedSeller(listing, seller, io, 'approved', null);
    announceToAudience(listing, seller, io);
  }

  await appendModerationAudit({
    subjectUserId: listing.seller,
    actionType: 'listing_review_approved',
    performedByUserId: admin?._id || null,
    performedByEmail: admin?.email || null,
    metadata: { listingId: String(listing._id), slug: listing.slug, endDate: listing.endDate },
    ip
  });

  return listing;
}

/**
 * Reject a listing: it is cancelled and never becomes public.
 *
 * `cancelled` is shared with seller-cancelled listings; moderationReview.decision
 * is what distinguishes the two, and the reason is shown to the seller.
 */
async function rejectListing({ listingId, admin, reason, io, ip = null }) {
  const cleanReason = String(reason || '').trim().slice(0, 1000);
  if (!cleanReason) throw new ReviewError('A reason is required when rejecting a listing.', 400);

  const listing = await loadPendingListing(listingId);

  listing.status = 'cancelled';
  listing.moderationReview = {
    decision: 'rejected',
    reason: cleanReason,
    reviewedAt: new Date(),
    reviewedBy: admin?._id || null
  };
  await listing.save();

  const seller = await Customer.findById(listing.seller)
    .select('_id email firstName language')
    .lean();

  if (seller) await notifyReviewedSeller(listing, seller, io, 'rejected', cleanReason);

  await appendModerationAudit({
    subjectUserId: listing.seller,
    actionType: 'listing_review_rejected',
    performedByUserId: admin?._id || null,
    performedByEmail: admin?.email || null,
    metadata: { listingId: String(listing._id), slug: listing.slug, reason: cleanReason },
    ip
  });

  return listing;
}

/** In-app notification + badge refresh + email, in the seller's own language. */
async function notifyReviewedSeller(listing, seller, io, decision, reason) {
  await notifyListingReviewed({
    listingSlug: listing.slug,
    listingTitle: listing.titlePt || listing.title,
    sellerUserId: seller._id,
    decision,
    reason
  }).catch(err => logger.error('[listingReview] notification failed:', err.message));

  if (io) emitNewNotificationToUser(io, seller._id).catch(() => {});

  await sendReviewEmail(seller, listing, decision, reason);
}

module.exports = { approveListing, rejectListing, ReviewError };
