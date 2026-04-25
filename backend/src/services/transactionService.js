const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const Offer = require('../models/Offer');
const { logTransactionCreated } = require('./bestOfferLogger');

const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000; // T+24h

/**
 * Create a transaction for a listing that has a winner set (auction flow).
 * Idempotent: does nothing if listing has no winner or a transaction already exists.
 */
async function createTransactionForListing(listingId) {
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
    const paymentDeadline = new Date(Date.now() + PAYMENT_WINDOW_MS);

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
      paymentDeadline
    });

    console.log(`✅ Transaction created for listing ${listingId}: ${transaction._id}`);
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      return await Transaction.findOne({ listing: listingId });
    }
    console.error('Error creating transaction for listing:', listingId, error);
    throw error;
  }
}

/**
 * Create a transaction when a best-offer is accepted.
 * Idempotent: returns existing transaction if one already exists for the listing.
 */
async function createTransactionForAcceptedOffer(listingId, offerId) {
  try {
    const existing = await Transaction.findOne({ listing: listingId });
    if (existing) return existing;

    const offer = await Offer.findById(offerId).populate('listing').populate('offerer');
    if (!offer || offer.status !== 'accepted') return null;

    const listing = offer.listing;
    if (!listing || listing._id.toString() !== listingId.toString()) return null;

    const sellerId = listing.seller?._id || listing.seller;
    const buyerId = offer.offerer?._id || offer.offerer;
    if (!buyerId) return null; // Guest offers: we'd need offererEmail and no User ref; for now require registered buyer for transaction

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

    console.log(`✅ Transaction created for best-offer listing ${listingId}: ${transaction._id}`);
    logTransactionCreated(transaction);
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      return await Transaction.findOne({ listing: listingId });
    }
    console.error('Error creating transaction for accepted offer:', offerId, error);
    throw error;
  }
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

    console.log(`✅ Buy-Now transaction created for listing ${listingId}: ${transaction._id}`);
    logTransactionCreated(transaction);
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      return await Transaction.findOne({ listing: listingId });
    }
    console.error('Error creating buy-now transaction for listing:', listingId, error);
    throw error;
  }
}

module.exports = {
  createTransactionForListing,
  createTransactionForAcceptedOffer,
  createTransactionForBuyNow
};
