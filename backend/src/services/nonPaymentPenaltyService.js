/**
 * Non-payment penalty enforcement for ALL transaction types (regular auctions + best-offer).
 * Private-room transactions are handled separately by privateRoomPaymentService.js.
 *
 * Policy (when payment deadline expires unpaid):
 *   1. Buyer receives a 2/5 platform review from BidRoom (non_payment tag).
 *   2. Buyer loses reputation points (via nonPaymentCount increment + review recalc).
 *   3. If buyer has a saved payment method:
 *        - €10 charged to buyer → transferred to seller
 *        - €20 charged to buyer → kept by BidRoom
 *        Total: €30 penalty charged off-session.
 *   4. Listing is automatically relisted with the same conditions.
 *   5. 3rd offense → permanent account ban.
 */

const Transaction = require('../models/Transaction');
const Listing     = require('../models/Listing');
const Customer    = require('../models/Customer');
const Review      = require('../models/Review');
const AccountStatusAuditLog = require('../models/AccountStatusAuditLog');
const { recalculateReputation } = require('./reputationService');
const { getStripe } = require('../utils/stripe.util');
const {
  notifyBuyerNonPayment,
  notifySellerBuyerNonPayment,
  emitNewNotificationToUser
} = require('./notificationService');
const logger = require('../utils/logger');

const DURATION_MS = {
  '5 minutes': 5 * 60 * 1000,
  '1 hour':    60 * 60 * 1000,
  '2 hours':   2 * 60 * 60 * 1000,
  '7 hours':   7 * 60 * 60 * 1000,
  '24 hours':  24 * 60 * 60 * 1000,
  '3 days':    3 * 24 * 60 * 60 * 1000,
  '7 days':    7 * 24 * 60 * 60 * 1000,
};

function generateSlug(title) {
  return title.toLowerCase().trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const LOG = '[NonPaymentPenalty]';
const NON_PAYMENT_BAN_THRESHOLD = 3;
const PENALTY_TO_SELLER_CENTS   = 1000; // €10
const PENALTY_TO_BIDROOM_CENTS  = 2000; // €20
const PENALTY_TOTAL_CENTS       = PENALTY_TO_SELLER_CENTS + PENALTY_TO_BIDROOM_CENTS; // €30

/**
 * Process all non-private-room transactions whose payment deadline has expired unpaid.
 * Idempotent: skips any tx where nonPaymentProcessedAt is already set.
 */
// Only apply penalties to transactions created on/after this date.
// Prevents retroactive penalisation of historical test/legacy transactions.
const PENALTY_CUTOFF_DATE = new Date('2026-06-10T00:00:00.000Z');

async function processAllNonPayments(io = null) {
  const now = new Date();

  const expired = await Transaction.find({
    isPrivateRoom: { $ne: true },
    transactionStatus: 'pending_payment',
    paymentDeadline: { $lte: now },
    nonPaymentProcessedAt: null,
    createdAt: { $gte: PENALTY_CUTOFF_DATE }
  })
    .populate('listing', 'title slug seller status auctionFormat')
    .lean();

  for (const tx of expired) {
    try {
      await handleNonPayment(tx, now, io);
    } catch (err) {
      logger.error(`${LOG} Processing failed for tx ${tx._id}:`, err.message);
    }
  }
}

async function handleNonPayment(tx, now, io) {
  // Idempotency guard
  const guard = await Transaction.findOneAndUpdate(
    { _id: tx._id, nonPaymentProcessedAt: null },
    { $set: { nonPaymentProcessedAt: now } }
  );
  if (!guard) return;

  const buyerId   = tx.buyer;
  const sellerId  = tx.listing?.seller ?? tx.seller;
  const listingId = tx.listing?._id ?? tx.listing;

  // ── Step 1: Platform review (2/5) + reputation recalculation ─────────────────
  const buyer = await Customer.findById(buyerId);
  let penaltyPoints = 20;

  await createNonPaymentPlatformReview(buyerId, listingId).catch(err =>
    logger.error(`${LOG} Platform review creation error:`, err.message)
  );

  if (buyer) {
    buyer.nonPaymentCount = (buyer.nonPaymentCount || 0) + 1;
    await buyer.save();
    // Recalculate AFTER the platform review is created so it's included in the score
    await recalculateReputation(buyerId).catch(err =>
      logger.error(`${LOG} recalculateReputation error:`, err.message)
    );

    if (buyer.nonPaymentCount >= NON_PAYMENT_BAN_THRESHOLD) {
      await applyNonPaymentBan(buyer, tx, io);
    }
  }

  // ── Step 2: Financial penalty (only if buyer has saved payment method) ────────
  let stripeChargedCents = 0;
  const hasSavedMethod = buyer?.stripeCustomerId && buyer?.savedPaymentMethodId;

  if (hasSavedMethod) {
    const seller = await Customer.findById(sellerId).select('stripeConnectAccountId stripeConnectOnboarded').lean();
    stripeChargedCents = await chargeNonPaymentPenalty(buyer, seller, tx).catch(err => {
      logger.error(`${LOG} Stripe penalty charge failed for tx ${tx._id}:`, err.message);
      return 0;
    });
  }

  // ── Step 3: Cancel transaction ────────────────────────────────────────────────
  await Transaction.updateOne(
    { _id: tx._id },
    {
      $set: {
        transactionStatus: 'cancelled',
        cancellationReason: 'non_payment',
        ...(stripeChargedCents > 0 ? { nonPaymentPenaltyChargedCents: stripeChargedCents, nonPaymentPenaltyChargedAt: now } : {})
      }
    }
  );

  // ── Step 4: Auto-relist with same conditions ──────────────────────────────────
  await relistAfterNonPayment(listingId, sellerId, tx.listing?.title, io).catch(err =>
    logger.error(`${LOG} Auto-relist failed for listing ${listingId}:`, err.message)
  );

  // ── Step 5: Notifications ─────────────────────────────────────────────────────
  const notifyOpts = {
    buyerId,
    listingTitle: tx.listing?.title,
    penaltyPoints,
    nonPaymentCount: buyer?.nonPaymentCount ?? 1,
    financialPenalty: stripeChargedCents > 0
      ? { totalCents: stripeChargedCents, sellerCents: PENALTY_TO_SELLER_CENTS, bidroomCents: PENALTY_TO_BIDROOM_CENTS }
      : null,
    io
  };

  await Promise.allSettled([
    notifyBuyerNonPayment(notifyOpts).catch(() => {}),
    sellerId ? notifySellerBuyerNonPayment({
      sellerId,
      listingTitle: tx.listing?.title,
      listingSlug: tx.listing?.slug,
      hasSecondBidder: false,
      canRelist: true,
      io
    }).catch(() => {}) : Promise.resolve(),
    io ? emitNewNotificationToUser(io, buyerId).catch(() => {}) : Promise.resolve(),
    io && sellerId ? emitNewNotificationToUser(io, sellerId).catch(() => {}) : Promise.resolve()
  ]);

  logger.info(`${LOG} Non-payment processed: tx=${tx._id} buyer=${buyerId} penalty=${penaltyPoints}pts stripeCharged=${stripeChargedCents}cts`);
}

/**
 * Create a platform review (2/5, tag: non_payment) on the buyer's profile.
 * Idempotent — duplicate key errors are silently ignored.
 */
async function createNonPaymentPlatformReview(buyerId, listingId) {
  try {
    await Review.create({
      listing: listingId,
      reviewer: null,
      reviewee: buyerId,
      role: 'as_buyer',
      score: 2,
      isPlatformReview: true,
      isAutoGenerated: true,
      tags: ['non_payment'],
      description: 'Não pagamento confirmado pela BidRoom.',
    });
    logger.info(`${LOG} Platform review (2/5) created for buyer ${buyerId}`);
  } catch (err) {
    if (err.code === 11000) return; // already exists — idempotent
    throw err;
  }
}

/**
 * Auto-relist the listing with the same conditions immediately after non-payment.
 * The original listing is marked as ended; a new active listing is created.
 */
async function relistAfterNonPayment(listingId, sellerId, listingTitle, io) {
  const listing = await Listing.findById(listingId);
  if (!listing) return;

  // Mark original as ended
  await Listing.updateOne({ _id: listingId }, { $set: { status: 'ended', nonPaymentCancelledAt: new Date() } });

  // Generate a unique slug for the new listing
  const baseSlug = generateSlug(listing.title);
  let slug = baseSlug;
  while (await Listing.exists({ slug })) {
    slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const durationMs = DURATION_MS[listing.durationSlot] || DURATION_MS['7 days'];
  const newEndDate = new Date(Date.now() + durationMs);

  const newListing = await Listing.create({
    title: listing.title,
    titlePt: listing.titlePt,
    titleEn: listing.titleEn,
    description: listing.description,
    descriptionPt: listing.descriptionPt,
    descriptionEn: listing.descriptionEn,
    category: listing.category,
    subCategory: listing.subCategory,
    images: listing.images,
    slug,
    startingPrice: listing.startingPrice,
    currentPrice: listing.startingPrice,
    bidIncrement: listing.bidIncrement,
    auctionFormat: listing.auctionFormat,
    durationSlot: listing.durationSlot,
    condition: listing.condition,
    location: listing.location,
    locationCity: listing.locationCity,
    locationCountry: listing.locationCountry,
    shippingOption: listing.shippingOption,
    shippingCost: listing.shippingCost,
    packageSize: listing.packageSize,
    shippingOriginPostalCode: listing.shippingOriginPostalCode,
    shippingOriginCity: listing.shippingOriginCity,
    shippingOriginCountry: listing.shippingOriginCountry,
    handlingTime: listing.handlingTime,
    returnPolicy: listing.returnPolicy,
    specifications: listing.specifications,
    minimumOfferPrice: listing.minimumOfferPrice,
    commissionRate: listing.commissionRate,
    allowPrivateRoom: listing.allowPrivateRoom,
    seller: listing.seller,
    status: 'active',
    startDate: new Date(),
    endDate: newEndDate,
    relistOf: listing._id,
    relistCount: (listing.relistCount || 0) + 1,
  });

  await Listing.updateOne({ _id: listingId }, { $set: { relistedAt: new Date() } });
  logger.info(`${LOG} Auto-relisted: ${listingId} → ${newListing._id}`);

  const { notifyFollowersNewListing } = require('./notificationService');
  notifyFollowersNewListing({
    sellerId: listing.seller,
    sellerFirstName: null,
    listingTitle: newListing.title,
    listingSlug: slug,
    io
  }).catch(() => {});
}

/**
 * Charge €30 off-session from buyer's saved payment method.
 * €10 is transferred to the seller's Stripe Connect account (if available).
 * €20 stays with BidRoom.
 * Returns the amount charged in cents, or 0 on failure.
 */
async function chargeNonPaymentPenalty(buyer, seller, tx) {
  const stripe = getStripe();
  if (!stripe) {
    logger.warn(`${LOG} Stripe not configured — skipping penalty charge for tx ${tx._id}`);
    return 0;
  }

  const sellerHasConnect = seller?.stripeConnectAccountId && seller?.stripeConnectOnboarded;

  const piParams = {
    amount: PENALTY_TOTAL_CENTS,
    currency: 'eur',
    customer: buyer.stripeCustomerId,
    payment_method: buyer.savedPaymentMethodId,
    confirm: true,
    off_session: true,
    description: `BidRoom non-payment penalty — transaction ${tx._id}`,
    metadata: {
      transactionId: String(tx._id),
      buyerId: String(buyer._id),
      type: 'non_payment_penalty'
    }
  };

  // Split: €10 to seller Connect account if available
  if (sellerHasConnect) {
    piParams.transfer_data = {
      amount: PENALTY_TO_SELLER_CENTS,
      destination: seller.stripeConnectAccountId
    };
  }

  const pi = await stripe.paymentIntents.create(piParams);
  logger.info(`${LOG} Penalty charged: pi=${pi.id} total=€${PENALTY_TOTAL_CENTS / 100} sellerSplit=${sellerHasConnect ? '€10' : '€0 (no connect)'}`);
  return PENALTY_TOTAL_CENTS;
}

async function applyNonPaymentBan(buyer, tx, io) {
  try {
    if (buyer.accountStatus === 'closed') return;

    buyer.accountStatus = 'closed';
    buyer.isActive = false;
    await buyer.save();

    await AccountStatusAuditLog.create({
      user: buyer._id,
      previousStatus: 'active',
      newStatus: 'closed',
      reason: 'non_payment_repeat_offender',
      transactionId: tx._id,
      metadata: { triggeredBy: 'system', nonPaymentCount: buyer.nonPaymentCount }
    });

    await Listing.updateMany(
      { seller: buyer._id, status: 'active' },
      { $set: { status: 'ended', endDate: new Date() } }
    );

    if (io) await emitNewNotificationToUser(io, buyer._id).catch(() => {});
    logger.info(`${LOG} Buyer banned for repeat non-payment: ${buyer._id} (${buyer.nonPaymentCount} offenses)`);
  } catch (err) {
    logger.error(`${LOG} applyNonPaymentBan error:`, err.message);
  }
}

module.exports = { processAllNonPayments };
