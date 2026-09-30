const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const Offer = require('../models/Offer');
const { logTransactionCreated } = require('./bestOfferLogger');
const logger = require('../utils/logger');

const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;        // T+24h (regular auctions)
const PR_PAYMENT_WINDOW_MS = 48 * 60 * 60 * 1000;     // T+48h (private rooms, per spec)

/**
 * Create a transaction for a listing that has a winner set (auction flow).
 * Idempotent: does nothing if listing has no winner or a transaction already exists.
 * @param {string|ObjectId} listingId
 * @param {{ privateRoom?: boolean }} [opts]
 */
async function createTransactionForListing(listingId, opts = {}) {
  try {
    const listing = await Listing.findById(listingId)
      .populate('seller', '_id')
      .populate('winner', '_id')
      .populate('winnerBid');
    if (!listing || !listing.winner || !listing.winnerBid) {
      return null;
    }

    const existing = await Transaction.findOne({ listing: listingId });
    if (existing) return existing;

    const winnerBidId = listing.winnerBid?._id || listing.winnerBid;
    const winnerBidDoc = await Bid.findById(winnerBidId).lean();
    if (!winnerBidDoc) return null;

    const buyerId = listing.winner._id || listing.winner;
    const sellerId = listing.seller._id || listing.seller;
    const isPrivateRoom = opts.privateRoom ?? listing.allowPrivateRoom ?? false;
    const windowMs = isPrivateRoom ? PR_PAYMENT_WINDOW_MS : PAYMENT_WINDOW_MS;
    const paymentDeadline = new Date(Date.now() + windowMs);

    const transaction = await Transaction.create({
      listing: listingId,
      seller: sellerId,
      buyer: buyerId,
      winnerBid: winnerBidId,
      winnerOffer: null,
      amount: winnerBidDoc.amount,
      transactionStatus: 'pending_payment',
      paymentStatus: 'pending',
      sendingStatus: 'pending',
      paymentDeadline,
      isPrivateRoom
    });

    logger.info(`✅ Transaction created for listing ${listingId}: ${transaction._id}`);
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      return await Transaction.findOne({ listing: listingId });
    }
    logger.error('Error creating transaction for listing:', listingId, error);
    throw error;
  }
}

/**
 * Create a transaction when a best-offer is accepted.
 * Idempotent: returns existing transaction if one already exists for the listing.
 * Also ensures listing.winner is set (older accepts may have left it null).
 */
async function createTransactionForAcceptedOffer(listingId, offerId) {
  try {
    const existing = await Transaction.findOne({ listing: listingId });
    if (existing) {
      // Still repair winner if missing
      await Listing.updateOne(
        { _id: listingId, winner: null },
        { $set: { winner: existing.buyer, currentPrice: existing.amount } }
      ).catch(() => {});
      return existing;
    }

    const offer = await Offer.findById(offerId).populate('listing').populate('offerer');
    if (!offer || offer.status !== 'accepted') return null;

    const listing = offer.listing;
    if (!listing || listing._id.toString() !== listingId.toString()) return null;

    const sellerId = listing.seller?._id || listing.seller;
    const buyerId = offer.offerer?._id || offer.offerer;
    if (!buyerId) {
      logger.error(`Cannot create transaction for offer ${offerId}: no registered offerer`);
      return null;
    }
    if (!sellerId) {
      logger.error(`Cannot create transaction for offer ${offerId}: listing has no seller`);
      return null;
    }

    const paymentDeadline = new Date(Date.now() + PAYMENT_WINDOW_MS);

    const transaction = await Transaction.create({
      listing: listingId,
      seller: sellerId,
      buyer: buyerId,
      winnerBid: null,
      winnerOffer: offerId,
      amount: offer.amount,
      transactionStatus: 'pending_payment',
      paymentStatus: 'pending',
      sendingStatus: 'pending',
      paymentDeadline
    });

    await Listing.updateOne(
      { _id: listingId },
      {
        $set: {
          status: 'ended',
          winner: buyerId,
          currentPrice: offer.amount
        }
      }
    );

    logger.info(`✅ Transaction created for best-offer listing ${listingId}: ${transaction._id}`);
    logTransactionCreated(transaction);
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      return await Transaction.findOne({ listing: listingId });
    }
    logger.error('Error creating transaction for accepted offer:', offerId, error);
    throw error;
  }
}

/**
 * Find accepted offers that never got a Transaction (bug / race / older code) and create them.
 * Optionally scoped to a buyer or seller. Returns newly created transactions.
 */
async function healMissingOfferTransactions({ buyerId = null, sellerId = null, notify = true } = {}) {
  const offerFilter = { status: 'accepted', offerer: { $ne: null } };
  if (buyerId) offerFilter.offerer = buyerId;

  const offers = await Offer.find(offerFilter)
    .select('_id listing offerer amount')
    .sort({ respondedAt: -1 })
    .limit(100)
    .lean();

  if (!offers.length) return [];

  const listingIds = [...new Set(offers.map((o) => o.listing.toString()))];
  const existingTx = await Transaction.find({ listing: { $in: listingIds } }).select('listing').lean();
  const hasTx = new Set(existingTx.map((t) => t.listing.toString()));

  const created = [];
  for (const offer of offers) {
    const lid = offer.listing.toString();
    if (hasTx.has(lid)) continue;

    if (sellerId) {
      const listing = await Listing.findById(offer.listing).select('seller').lean();
      if (!listing || String(listing.seller) !== String(sellerId)) continue;
    }

    try {
      const tx = await createTransactionForAcceptedOffer(lid, offer._id.toString());
      if (!tx) continue;
      created.push(tx);
      hasTx.add(lid);

      if (notify) {
        try {
          const listing = await Listing.findById(lid).select('title slug').lean();
          const { notifyProposalAccepted } = require('./notificationService');
          const buyerUserId = (offer.offerer._id || offer.offerer).toString();
          await notifyProposalAccepted({
            listingSlug: listing?.slug || null,
            listingTitle: listing?.title || 'the item',
            offerAmount: offer.amount,
            buyerUserId
          });
        } catch (err) {
          logger.error('Heal notify failed for offer', offer._id, err.message);
        }
      }
    } catch (err) {
      logger.error('Heal transaction failed for offer', offer._id, err.message);
    }
  }

  if (created.length) {
    logger.info(`🔧 Healed ${created.length} accepted offer(s) missing transactions`);
  }
  return created;
}

/**
 * Create a transaction when a buyer uses Buy Now.
 * No bid or offer exists; the buyer pays the buyNowPrice directly.
 * Idempotent: returns existing transaction if one already exists for the listing.
 * @param {string|ObjectId} listingId
 * @param {string|ObjectId} buyerUserId
 */
async function createTransactionForBuyNow(listingId, buyerUserId) {
  try {
    const existing = await Transaction.findOne({ listing: listingId });
    if (existing) return existing;

    const listing = await Listing.findById(listingId).populate('seller', '_id');
    if (!listing || !listing.buyNowPrice) return null;

    const paymentDeadline = new Date(Date.now() + PAYMENT_WINDOW_MS);

    const transaction = await Transaction.create({
      listing: listingId,
      seller: listing.seller._id || listing.seller,
      buyer: buyerUserId,
      winnerBid: null,
      winnerOffer: null,
      amount: listing.buyNowPrice,
      transactionStatus: 'pending_payment',
      paymentStatus: 'pending',
      sendingStatus: 'pending',
      paymentDeadline
    });

    logger.info(`✅ Buy-Now transaction created for listing ${listingId}: ${transaction._id}`);
    logTransactionCreated(transaction);
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      return await Transaction.findOne({ listing: listingId });
    }
    logger.error('Error creating buy-now transaction for listing:', listingId, error);
    throw error;
  }
}

module.exports = {
  createTransactionForListing,
  createTransactionForAcceptedOffer,
  createTransactionForBuyNow,
  healMissingOfferTransactions
};
