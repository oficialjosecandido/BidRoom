const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const Bid = require('../models/Bid');

/**
 * Create a transaction for a listing that has a winner set.
 * Idempotent: does nothing if listing has no winner or a transaction already exists.
 * @param {string} listingId - Listing ID
 * @returns {Promise<object|null>} Created transaction or null
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
    if (existing) {
      return existing;
    }

    const winnerBidId = listing.winnerBid?._id || listing.winnerBid;
    if (!winnerBidId) return null;

    const winnerBidDoc = await Bid.findById(winnerBidId).lean();
    if (!winnerBidDoc) return null;

    const buyerId = listing.winner._id || listing.winner;
    const sellerId = listing.seller._id || listing.seller;

    const transaction = await Transaction.create({
      listing: listingId,
      seller: sellerId,
      buyer: buyerId,
      winnerBid: winnerBidId,
      amount: winnerBidDoc.amount,
      transactionStatus: 'pending_payment',
      paymentStatus: 'pending',
      sendingStatus: 'pending'
    });

    console.log(`✅ Transaction created for listing ${listingId}: ${transaction._id}`);
    return transaction;
  } catch (error) {
    if (error.code === 11000) {
      // Duplicate key (listing already has a transaction)
      return await Transaction.findOne({ listing: listingId });
    }
    console.error('Error creating transaction for listing:', listingId, error);
    throw error;
  }
}

module.exports = {
  createTransactionForListing
};
