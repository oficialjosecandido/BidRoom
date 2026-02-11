const express = require('express');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Review = require('../models/Review');
const { authenticateToken } = require('../middleware/auth');
const { sendSellerProofOfPaymentNotification } = require('../services/emailService');

const router = express.Router();

/** Ensure API always returns transactionStatus, paymentStatus, sendingStatus (for old docs that only have status) */
function normalizeTransactionStatus(t) {
  const transactionStatus = t.transactionStatus || t.status || 'pending_payment';
  const paymentStatus = t.paymentStatus ?? (['paid', 'shipped', 'delivered', 'completed'].includes(transactionStatus) ? 'paid' : 'pending');
  const sendingStatus = t.sendingStatus ?? (transactionStatus === 'shipped' ? 'shipped' : ['delivered', 'completed'].includes(transactionStatus) ? 'delivered' : 'pending');
  return { transactionStatus, paymentStatus, sendingStatus };
}

const PAYMENT_ACCEPTANCE_DAYS = 5;

router.use(authenticateToken);

/**
 * GET /api/transactions
 * List transactions for the current user (as buyer or seller)
 */
router.get('/', async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found. Please complete your profile.' });
    }

    const transactions = await Transaction.find({
      $or: [{ seller: user._id }, { buyer: user._id }]
    })
      .populate('listing', 'title slug images status')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .sort({ updatedAt: -1 })
      .lean();

    const listingIds = [...new Set(transactions.map(t => t.listing?._id || t.listing).filter(Boolean))];
    const reviews = listingIds.length > 0
      ? await Review.find({ listing: { $in: listingIds } }).select('listing reviewer reviewee role').lean()
      : [];
    const buyerReviewedSeller = {}; // listingId -> true if buyer reviewed seller
    const sellerReviewedBuyer = {};
    for (const r of reviews) {
      const lid = (r.listing && r.listing._id ? r.listing._id : r.listing)?.toString();
      if (!lid) continue;
      if (r.role === 'as_seller') {
        buyerReviewedSeller[lid] = true;
      } else {
        sellerReviewedBuyer[lid] = true;
      }
    }

    const withRole = transactions.map(t => {
      const role = t.seller?._id?.toString() === user._id.toString() ? 'seller' : 'buyer';
      const listingId = (t.listing && t.listing._id ? t.listing._id : t.listing)?.toString();
      const buyerHasReviewedSeller = !!buyerReviewedSeller[listingId];
      const sellerHasReviewedBuyer = !!sellerReviewedBuyer[listingId];
      return {
        ...t,
        role,
        buyerHasReviewedSeller,
        sellerHasReviewedBuyer,
        ...normalizeTransactionStatus(t)
      };
    });

    res.json({ transactions: withRole });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions', message: error.message });
  }
});

/**
 * GET /api/transactions/:id
 * Get a single transaction (only if current user is buyer or seller)
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('listing', 'title slug images status')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const sellerId = transaction.seller?._id?.toString() || transaction.seller?.toString();
    const buyerId = transaction.buyer?._id?.toString() || transaction.buyer?.toString();
    if (sellerId !== user._id.toString() && buyerId !== user._id.toString()) {
      return res.status(403).json({ error: 'You do not have access to this transaction' });
    }

    const listingId = (transaction.listing && transaction.listing._id ? transaction.listing._id : transaction.listing)?.toString();
    const [buyerReviewedSeller, sellerReviewedBuyer] = listingId
      ? await Promise.all([
          Review.exists({ listing: listingId, role: 'as_seller' }),
          Review.exists({ listing: listingId, role: 'as_buyer' })
        ])
      : [false, false];

    res.json({
      ...transaction,
      buyerHasReviewedSeller: !!buyerReviewedSeller,
      sellerHasReviewedBuyer: !!sellerReviewedBuyer,
      ...normalizeTransactionStatus(transaction)
    });
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: 'Failed to fetch transaction', message: error.message });
  }
});

/**
 * PATCH /api/transactions/:id
 * Update transaction status (seller: mark shipped with tracking; buyer: mark delivered)
 */
router.patch('/:id', async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const isSeller = transaction.seller.toString() === user._id.toString();
    const isBuyer = transaction.buyer.toString() === user._id.toString();
    if (!isSeller && !isBuyer) {
      return res.status(403).json({ error: 'You do not have access to this transaction' });
    }

    const { status, trackingNumber, trackingCarrier, sellerBankIban, sellerBankSwift, sellerBankAccountName, buyerProofOfPaymentUrl, sellerProofOfDeliveryUrl, disputeOpen, disputeReason } = req.body;
    const ts = transaction.transactionStatus ?? transaction.status;
    const ps = transaction.paymentStatus ?? 'pending';
    const ss = transaction.sendingStatus ?? 'pending';

    if (isSeller) {
      if (sellerBankIban !== undefined) transaction.sellerBankIban = sellerBankIban || null;
      if (sellerBankSwift !== undefined) transaction.sellerBankSwift = sellerBankSwift || null;
      if (sellerBankAccountName !== undefined) transaction.sellerBankAccountName = sellerBankAccountName || null;
      if (status === 'accept_payment' && ts === 'awaiting_seller_acceptance') {
        transaction.transactionStatus = 'paid';
        transaction.paymentStatus = 'paid';
        transaction.paidAt = transaction.paidAt || new Date();
        if (!transaction.handlingDeadline) {
          const listing = await Listing.findById(transaction.listing).select('handlingTime').lean();
          const days = (listing && listing.handlingTime) ? Math.max(1, listing.handlingTime) : 3;
          const d = new Date();
          d.setDate(d.getDate() + days);
          transaction.handlingDeadline = d;
        }
      } else if (status === 'shipped') {
        transaction.transactionStatus = 'shipped';
        transaction.sendingStatus = 'shipped';
        transaction.shippedAt = transaction.shippedAt || new Date();
        if (trackingNumber != null) transaction.trackingNumber = trackingNumber;
        if (trackingCarrier != null) transaction.trackingCarrier = trackingCarrier;
        if (sellerProofOfDeliveryUrl != null) transaction.sellerProofOfDeliveryUrl = sellerProofOfDeliveryUrl;
      } else if (status === 'cancelled' && ts === 'pending_payment') {
        transaction.transactionStatus = 'cancelled';
      }
    }

    /** Dispute: either buyer or seller can open; both see it. Closing requires admin. */
    if (disputeOpen === true && !transaction.disputeOpen) {
      transaction.disputeOpen = true;
      transaction.disputeOpenedAt = new Date();
      transaction.disputeOpenedBy = isSeller ? 'seller' : 'buyer';
      if (disputeReason != null) transaction.disputeReason = String(disputeReason).trim() || null;
    }

    if (isBuyer) {
      if (status === 'paid') {
        transaction.transactionStatus = 'awaiting_seller_acceptance';
        if (buyerProofOfPaymentUrl != null) transaction.buyerProofOfPaymentUrl = buyerProofOfPaymentUrl;
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + PAYMENT_ACCEPTANCE_DAYS);
        transaction.paymentAcceptanceDeadline = deadline;
      } else if (status === 'delivered' && ts === 'shipped') {
        transaction.transactionStatus = 'delivered';
        transaction.sendingStatus = 'delivered';
      } else if (status === 'completed' && ['paid', 'shipped', 'delivered'].includes(ts)) {
        const lid = transaction.listing?.toString?.() || transaction.listing;
        const [buyerReviewed, sellerReviewed] = lid
          ? await Promise.all([
              Review.exists({ listing: lid, role: 'as_seller' }),
              Review.exists({ listing: lid, role: 'as_buyer' })
            ])
          : [false, false];
        if (!buyerReviewed || !sellerReviewed) {
          return res.status(400).json({
            error: 'Reviews required',
            message: 'Both buyer and seller must leave a review before the transaction can be marked as complete.'
          });
        }
        transaction.transactionStatus = 'completed';
      }
    }

    await transaction.save();

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images status')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    const listingId = (updated.listing && updated.listing._id ? updated.listing._id : updated.listing)?.toString();
    let buyerHasReviewedSeller = false;
    let sellerHasReviewedBuyer = false;
    if (listingId) {
      const [b, s] = await Promise.all([
        Review.exists({ listing: listingId, role: 'as_seller' }),
        Review.exists({ listing: listingId, role: 'as_buyer' })
      ]);
      buyerHasReviewedSeller = !!b;
      sellerHasReviewedBuyer = !!s;
    }

    if (isBuyer && status === 'paid' && buyerProofOfPaymentUrl && updated.seller?.email) {
      const listingTitle = updated.listing?.title || 'Item';
      const buyerName = [updated.buyer?.firstName, updated.buyer?.lastName].filter(Boolean).join(' ') || 'Buyer';
      sendSellerProofOfPaymentNotification(
        updated.seller.email,
        updated.seller.firstName,
        listingTitle,
        buyerName,
        buyerProofOfPaymentUrl
      ).catch(err => console.error('Proof of payment notification email:', err.message));
    }

    res.json({
      ...updated,
      buyerHasReviewedSeller,
      sellerHasReviewedBuyer,
      ...normalizeTransactionStatus(updated)
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction', message: error.message });
  }
});

module.exports = router;
