/**
 * Private-room payment enforcement:
 *   1. Send a 1-hour warning notification before the 48h payment deadline.
 *   2. When the deadline passes without payment:
 *      a. Mark original transaction as cancelled (non_payment).
 *      b. Increment buyer's nonPaymentCount; recalculate reputation.
 *      c. Apply repeat-offender consequences (warning → stronger warning → ban).
 *      d. Offer item to second-highest bidder with a 24h window (re-assign transaction).
 *      e. If no second bidder: notify seller to relist or cancel.
 */

const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const Customer = require('../models/Customer');
const AccountStatusAuditLog = require('../models/AccountStatusAuditLog');
const { recalculateReputation } = require('./reputationService');
const {
  notifyBuyerPaymentDeadlineWarning,
  notifyBuyerNonPayment,
  notifySellerBuyerNonPayment,
  notifySecondBidderSecondChance,
  emitNewNotificationToUser
} = require('./notificationService');

const SECOND_CHANCE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h for second-chance bidder
const WARNING_BEFORE_MS = 60 * 60 * 1000;             // Send warning 1h before deadline
const NON_PAYMENT_BAN_THRESHOLD = 3;                  // 3rd offense → ban

/**
 * Send approaching-deadline warnings to buyers whose payment is due within 1h.
 * Idempotent: uses paymentDeadlineWarningSentAt to avoid duplicate sends.
 */
async function sendPaymentDeadlineWarnings(io = null) {
  const now = new Date();
  const warnCutoff = new Date(now.getTime() + WARNING_BEFORE_MS);

  const pending = await Transaction.find({
    isPrivateRoom: true,
    transactionStatus: 'pending_payment',
    paymentDeadline: { $gt: now, $lte: warnCutoff },
    paymentDeadlineWarningSentAt: null,
    nonPaymentProcessedAt: null
  })
    .populate('listing', 'title slug')
    .lean();

  for (const tx of pending) {
    try {
      await Transaction.updateOne({ _id: tx._id }, { $set: { paymentDeadlineWarningSentAt: now } });
      await notifyBuyerPaymentDeadlineWarning({
        buyerId: tx.buyer,
        listingTitle: tx.listing?.title,
        listingSlug: tx.listing?.slug,
        deadlineAt: tx.paymentDeadline
      });
      if (io) await emitNewNotificationToUser(io, tx.buyer).catch(() => {});
    } catch (err) {
      console.error(`Warning notification failed for tx ${tx._id}:`, err.message);
    }
  }
}

/**
 * Process all private-room transactions whose payment deadline has passed unpaid.
 * Idempotent: skips any tx where nonPaymentProcessedAt is already set.
 */
async function processPrivateRoomNonPayments(io = null) {
  const now = new Date();

  const expired = await Transaction.find({
    isPrivateRoom: true,
    transactionStatus: 'pending_payment',
    paymentDeadline: { $lte: now },
    nonPaymentProcessedAt: null
  })
    .populate('listing', 'title slug seller allowPrivateRoom')
    .lean();

  for (const tx of expired) {
    try {
      await handleNonPayment(tx, now, io);
    } catch (err) {
      console.error(`Non-payment processing failed for tx ${tx._id}:`, err.message);
    }
  }
}

async function handleNonPayment(tx, now, io) {
  // Idempotency: mark processed immediately to prevent double-processing on concurrent runs
  const guard = await Transaction.findOneAndUpdate(
    { _id: tx._id, nonPaymentProcessedAt: null },
    { $set: { nonPaymentProcessedAt: now } }
  );
  if (!guard) return; // Already processed by another scheduler run

  const originalBuyerId = tx.buyer;
  const sellerId = tx.listing?.seller;
  const listingId = tx.listing?._id ?? tx.listing;

  // ── Step 1: Apply penalty and reputation to original buyer ──────────────────
  const buyer = await Customer.findById(originalBuyerId);
  if (buyer) {
    buyer.nonPaymentCount = (buyer.nonPaymentCount || 0) + 1;
    await buyer.save();
    await recalculateReputation(originalBuyerId).catch(err =>
      console.error('recalculateReputation error:', err.message)
    );

    // Notify buyer of penalty
    await notifyBuyerNonPayment({
      buyerId: originalBuyerId,
      listingTitle: tx.listing?.title,
      penaltyPoints: 10,
      nonPaymentCount: buyer.nonPaymentCount,
      io
    }).catch(() => {});

    // Repeat-offender enforcement
    if (buyer.nonPaymentCount >= NON_PAYMENT_BAN_THRESHOLD) {
      await applyNonPaymentBan(buyer, tx, io);
    }
  }

  // ── Step 2: Find the second-highest bidder ───────────────────────────────────
  // Exclude the original buyer to get the actual second-highest
  const secondBid = await Bid.findOne({
    listing: listingId,
    bidder: { $exists: true, $ne: null, $ne: originalBuyerId }
  })
    .sort({ amount: -1 })
    .populate('bidder', 'firstName lastName email')
    .lean();

  if (secondBid?.bidder) {
    await offerToSecondBidder(tx, secondBid, originalBuyerId, now, io);
  } else {
    await handleNoSecondBidder(tx, sellerId, now, io);
  }
}

async function offerToSecondBidder(tx, secondBid, originalBuyerId, now, io) {
  const newDeadline = new Date(now.getTime() + SECOND_CHANCE_WINDOW_MS);

  // Re-assign the existing transaction in-place (avoids unique-index conflict)
  await Transaction.updateOne(
    { _id: tx._id },
    {
      $set: {
        buyer: secondBid.bidder._id,
        winnerBid: secondBid._id,
        amount: secondBid.amount,
        transactionStatus: 'pending_payment',
        paymentStatus: 'pending',
        paymentDeadline: newDeadline,
        originalBuyerId,
        secondChanceAssignedAt: now,
        paymentDeadlineWarningSentAt: null // reset so warning can fire again
      }
    }
  );

  // Update listing winner to reflect second bidder
  await Listing.updateOne(
    { _id: tx.listing?._id ?? tx.listing },
    { $set: { winner: secondBid.bidder._id, winnerBid: secondBid._id } }
  );

  const sellerId = tx.listing?.seller ?? tx.seller;

  await Promise.allSettled([
    notifySecondBidderSecondChance({
      buyerId: secondBid.bidder._id,
      listingTitle: tx.listing?.title,
      listingSlug: tx.listing?.slug,
      paymentDeadlineHours: 24,
      io
    }),
    notifySellerBuyerNonPayment({
      sellerId,
      listingTitle: tx.listing?.title,
      listingSlug: tx.listing?.slug,
      hasSecondBidder: true,
      io
    })
  ]);
}

async function handleNoSecondBidder(tx, sellerId, now, io) {
  // Mark transaction as cancelled
  await Transaction.updateOne(
    { _id: tx._id },
    { $set: { transactionStatus: 'cancelled', cancellationReason: 'non_payment', noSecondBidderNotifiedAt: now } }
  );

  // Mark listing as ended without a winner (seller must relist or cancel)
  await Listing.updateOne(
    { _id: tx.listing?._id ?? tx.listing },
    { $set: { status: 'ended', winner: null, winnerBid: null, privateRoomClosedReason: 'non_payment_no_second_bidder' } }
  );

  if (sellerId) {
    await notifySellerBuyerNonPayment({
      sellerId,
      listingTitle: tx.listing?.title,
      listingSlug: tx.listing?.slug,
      hasSecondBidder: false,
      io
    }).catch(() => {});
  }
}

async function applyNonPaymentBan(buyer, tx, io) {
  try {
    if (buyer.accountStatus === 'closed') return;

    buyer.accountStatus = 'closed';
    buyer.isActive = false;
    await buyer.save();

    await AccountStatusAuditLog.create({
      user: buyer._id,
      previousStatus: buyer.accountStatus,
      newStatus: 'closed',
      reason: 'non_payment_repeat_offender',
      transactionId: tx._id,
      metadata: { triggeredBy: 'system', nonPaymentCount: buyer.nonPaymentCount }
    });

    // End any active listings from this buyer acting as a seller
    await Listing.updateMany(
      { seller: buyer._id, status: 'active' },
      { $set: { status: 'ended', endDate: new Date() } }
    );

    if (io) await emitNewNotificationToUser(io, buyer._id).catch(() => {});
  } catch (err) {
    console.error('applyNonPaymentBan error:', err.message);
  }
}

module.exports = { sendPaymentDeadlineWarnings, processPrivateRoomNonPayments };
