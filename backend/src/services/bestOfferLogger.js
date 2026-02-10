/**
 * Structured logging for Best Offer auctions.
 * All messages are prefixed with [BestOffer] for easy filtering.
 */

const TAG = '[BestOffer]';

function safeJson(obj) {
  try {
    return JSON.stringify(obj, (key, value) => {
      if (value && typeof value === 'object' && value.constructor.name === 'ObjectId') return value.toString();
      if (value instanceof Date) return value.toISOString();
      return value;
    }, 2);
  } catch (e) {
    return String(obj);
  }
}

function logAuctionCreated(populatedListing) {
  if (populatedListing?.auctionFormat !== 'best-offer') return;
  const summary = {
    _id: populatedListing._id,
    slug: populatedListing.slug,
    title: populatedListing.title,
    category: populatedListing.category,
    subCategory: populatedListing.subCategory,
    auctionFormat: populatedListing.auctionFormat,
    minimumOfferPrice: populatedListing.minimumOfferPrice,
    startDate: populatedListing.startDate,
    endDate: populatedListing.endDate,
    status: populatedListing.status,
    seller: populatedListing.seller
  };
  console.log(`${TAG} Auction created:\n${safeJson(summary)}`);
}

function logOfferReceived(offer, bidderDetails) {
  const payload = {
    offerId: offer._id,
    listingId: offer.listing,
    amount: offer.amount,
    status: offer.status,
    bidder: bidderDetails
  };
  console.log(`${TAG} Offer received:\n${safeJson(payload)}`);
}

function logMultipleOffers(listingId, count, offersDetail) {
  console.log(`${TAG} Listing ${listingId} has ${count} offer(s). Seller must choose.`);
  if (offersDetail && offersDetail.length) {
    console.log(`${TAG} Offers on listing:\n${safeJson(offersDetail)}`);
  }
}

function logSellerAcceptedWinner(offer, sellerDetails, allOffersSummary) {
  const winner = {
    offerId: offer._id,
    amount: offer.amount,
    buyer: offer.offerer
      ? { id: offer.offerer._id, email: offer.offerer.email, name: `${offer.offerer.firstName || ''} ${offer.offerer.lastName || ''}`.trim() }
      : { guestEmail: offer.offererEmail }
  };
  console.log(`${TAG} Seller accepted offer. Winner:\n${safeJson(winner)}`);
  console.log(`${TAG} Seller: ${safeJson(sellerDetails)}`);
  if (allOffersSummary) {
    console.log(`${TAG} Offers on listing: ${safeJson(allOffersSummary)}`);
  }
}

function logTransactionCreated(transaction) {
  const details = {
    _id: transaction._id,
    listing: transaction.listing,
    seller: transaction.seller,
    buyer: transaction.buyer,
    amount: transaction.amount,
    paymentDeadline: transaction.paymentDeadline,
    transactionStatus: transaction.transactionStatus
  };
  console.log(`${TAG} Transaction created:\n${safeJson(details)}`);
}

module.exports = {
  logAuctionCreated,
  logOfferReceived,
  logMultipleOffers,
  logSellerAcceptedWinner,
  logTransactionCreated
};
