const express = require('express');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const Customer = require('../models/Customer');
const Review = require('../models/Review');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const { sendSellerDisputeOpenedNotification, sendEmail } = require('../services/emailService');
const {
  notifyDisputeOpened,
  notifyEvidenceSubmitted,
  notifyItemMarkedShipped,
  notifyTrackingProvided,
  notifyBuyerConfirmedReceipt,
  notifyBuyerSellerAccepted,
  notifyReviewPrompt,
  emitNewNotificationToUser
} = require('../services/notificationService');
const { ensureShippingDeadlinesFromPaidAt } = require('../services/shippingDeadlines');
const { restrictBothPartiesForDispute, checkAndApplyPendingSuspensions } = require('../services/accountStatusService');
const {
  wrapBidRoomEmail,
  emailInfoBox,
  emailTextLink,
  transactionUrl
} = require('../utils/bidroomEmailLayout');

const router = express.Router();

/** Ensure API always returns transactionStatus, paymentStatus, sendingStatus (for old docs that only have status) */
function normalizeTransactionStatus(t) {
  const transactionStatus = t.transactionStatus || t.status || 'pending_payment';
  const paymentStatus = t.paymentStatus ?? (['paid', 'shipped', 'delivered', 'under_dispute', 'completed'].includes(transactionStatus) ? 'paid' : 'pending');
  const sendingStatus = t.sendingStatus ?? (transactionStatus === 'shipped' ? 'shipped' : ['delivered', 'under_dispute', 'completed'].includes(transactionStatus) ? 'delivered' : 'pending');
  return { transactionStatus, paymentStatus, sendingStatus };
}

function partyId(party) {
  if (!party) return null;
  return (party._id || party).toString();
}

function listingIdOf(listing) {
  if (!listing) return null;
  return (listing._id || listing).toString();
}

/** Whether buyer/seller have left their review for this specific transaction pair. */
function getPartyReviewFlags(transaction, reviews) {
  const lid = listingIdOf(transaction.listing);
  const buyerId = partyId(transaction.buyer);
  const sellerId = partyId(transaction.seller);
  if (!lid || !buyerId || !sellerId) {
    return { buyerHasReviewedSeller: false, sellerHasReviewedBuyer: false };
  }

  let buyerHasReviewedSeller = false;
  let sellerHasReviewedBuyer = false;
  for (const r of reviews) {
    if (listingIdOf(r.listing) !== lid) continue;
    const reviewerId = partyId(r.reviewer);
    const revieweeId = partyId(r.reviewee);
    if (reviewerId === buyerId && revieweeId === sellerId) buyerHasReviewedSeller = true;
    if (reviewerId === sellerId && revieweeId === buyerId) sellerHasReviewedBuyer = true;
  }
  return { buyerHasReviewedSeller, sellerHasReviewedBuyer };
}

async function getPartyReviewFlagsForTransaction(transaction) {
  const lid = listingIdOf(transaction.listing);
  const buyerId = partyId(transaction.buyer);
  const sellerId = partyId(transaction.seller);
  if (!lid || !buyerId || !sellerId) {
    return { buyerHasReviewedSeller: false, sellerHasReviewedBuyer: false };
  }
  const [buyerHasReviewedSeller, sellerHasReviewedBuyer] = await Promise.all([
    Review.exists({ listing: lid, reviewer: buyerId, reviewee: sellerId }),
    Review.exists({ listing: lid, reviewer: sellerId, reviewee: buyerId })
  ]);
  return { buyerHasReviewedSeller: !!buyerHasReviewedSeller, sellerHasReviewedBuyer: !!sellerHasReviewedBuyer };
}

/** Seller may ship when paid, or Stripe/verified payment while legacy status awaits manual accept. */
function sellerCanMarkAsShipped(transaction, transactionStatus) {
  if (transactionStatus === 'paid') return true;
  if (transactionStatus !== 'awaiting_seller_acceptance') return false;
  return (
    transaction.paymentStatus === 'paid' ||
    !!transaction.stripePaymentIntentId ||
    !!transaction.stripeCheckoutSessionId
  );
}

const DISPUTE_REASON_CODES = ['item_not_as_described', 'damaged_in_transit', 'missing_parts', 'counterfeit', 'other'];

router.use(authenticateToken);

/**
 * GET /api/transactions
 * List transactions for the current user (as buyer or seller)
 */
router.get('/', async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found. Please complete your profile.' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
    const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const skip  = (page - 1) * limit;
    const filter = { $or: [{ seller: user._id }, { buyer: user._id }] };

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom returnPolicy')
        .populate('seller', 'firstName lastName')
        .populate('buyer', 'firstName lastName')
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter)
    ]);

    const listingIds = [...new Set(transactions.map(t => t.listing?._id || t.listing).filter(Boolean))];
    const reviews = listingIds.length > 0
      ? await Review.find({ listing: { $in: listingIds } }).select('listing reviewer reviewee').lean()
      : [];

    const withRole = transactions.map(t => {
      const role = t.seller?._id?.toString() === user._id.toString() ? 'seller' : 'buyer';
      const { buyerHasReviewedSeller, sellerHasReviewedBuyer } = getPartyReviewFlags(t, reviews);
      return {
        ...t,
        role,
        buyerHasReviewedSeller,
        sellerHasReviewedBuyer,
        ...normalizeTransactionStatus(t)
      };
    });

    res.json({ transactions: withRole, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

/**
 * GET /api/transactions/:id
 * Get a single transaction (only if current user is buyer or seller)
 */
router.get('/:id', async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom returnPolicy')
      .populate('seller', 'firstName lastName')
      .populate('buyer', 'firstName lastName')
      .lean();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const sellerId = transaction.seller?._id?.toString() || transaction.seller?.toString();
    const buyerId = transaction.buyer?._id?.toString() || transaction.buyer?.toString();
    if (sellerId !== user._id.toString() && buyerId !== user._id.toString()) {
      return res.status(403).json({ error: 'You do not have access to this transaction' });
    }

    const { buyerHasReviewedSeller, sellerHasReviewedBuyer } = await getPartyReviewFlagsForTransaction(transaction);

    res.json({
      ...transaction,
      buyerHasReviewedSeller,
      sellerHasReviewedBuyer,
      ...normalizeTransactionStatus(transaction)
    });
  } catch (error) {
    console.error('Error fetching transaction:', error);
    res.status(500).json({ error: 'Failed to fetch transaction', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * POST /api/transactions/:id/open-dispute
 * Buyer opens a formal dispute (status must be 'shipped', handling period for receipt implied).
 * Body: { reason, explanation, mediaUrls } - reason from DISPUTE_REASON_CODES, mediaUrls: 3+ photos or 1 video.
 */
router.post('/:id/open-dispute', async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('listing', 'title slug')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const isBuyer = transaction.buyer._id.toString() === user._id.toString();
    if (!isBuyer) {
      return res.status(403).json({ error: 'Only the buyer can open a dispute for this transaction.' });
    }

    const ts = transaction.transactionStatus ?? transaction.status;
    if (ts !== 'shipped') {
      return res.status(400).json({
        error: 'Invalid state',
        message: 'You can only open a dispute when the item has been marked as shipped. Please choose "Received Not Properly" from the transaction.'
      });
    }

    if (transaction.disputeOpen) {
      return res.status(400).json({ error: 'A dispute is already open for this transaction.' });
    }

    const { reason, explanation, mediaUrls } = req.body;
    if (!reason || !DISPUTE_REASON_CODES.includes(reason)) {
      return res.status(400).json({
        error: 'Invalid reason',
        message: 'Please select a valid reason: item_not_as_described, damaged_in_transit, missing_parts, counterfeit, other'
      });
    }
    if (!explanation || String(explanation).trim().length < 20) {
      return res.status(400).json({
        error: 'Invalid explanation',
        message: 'Please provide a detailed explanation (at least 20 characters).'
      });
    }
    if (!mediaUrls || !Array.isArray(mediaUrls) || mediaUrls.length < 1) {
      return res.status(400).json({
        error: 'Missing evidence',
        message: 'Please upload at least 3 high-resolution photos or 1 video as evidence.'
      });
    }

    transaction.disputeOpen = true;
    transaction.disputeOpenedAt = new Date();
    transaction.disputeOpenedBy = 'buyer';
    transaction.disputeReason = reason;
    transaction.disputeExplanation = String(explanation).trim();
    transaction.disputeBuyerMediaUrls = mediaUrls.slice(0, 10);
    transaction.transactionStatus = 'under_dispute';
    transaction.sendingStatus = 'delivered'; // Item was received (buyer claims not properly)
    await transaction.save();

    // Restrict both parties from new marketplace actions while dispute is under review
    const buyerUserId = transaction.buyer?._id?.toString?.() || transaction.buyer?.toString?.();
    const sellerUserId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
    const io = req.app.get('io');
    if (buyerUserId && sellerUserId) {
      restrictBothPartiesForDispute(transaction._id, buyerUserId, sellerUserId, io).catch(err =>
        console.error('Failed to restrict accounts for dispute:', err)
      );
    }

    const listingTitle = transaction.listing?.title || 'Item';
    const buyerName = [transaction.buyer?.firstName, transaction.buyer?.lastName].filter(Boolean).join(' ') || 'Buyer';
    if (sellerUserId) {
      notifyDisputeOpened({
        transactionId: transaction._id.toString(),
        listingTitle,
        openerName: buyerName,
        otherPartyUserId: sellerUserId
      }).catch(err => console.error('Failed to create dispute-opened notification:', err));
      const io = req.app.get('io');
      if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
    }
    if (transaction.seller?.email) {
      sendSellerDisputeOpenedNotification(
        transaction.seller.email,
        transaction.seller.firstName,
        listingTitle,
        buyerName,
        transaction._id.toString()
      ).catch((err) => console.error('Dispute notification email:', err.message));
    }

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom returnPolicy')
      .populate('seller', 'firstName lastName')
      .populate('buyer', 'firstName lastName')
      .lean();

    res.json({
      ...updated,
      role: 'buyer',
      ...normalizeTransactionStatus(updated)
    });
  } catch (error) {
    console.error('Error opening dispute:', error);
    res.status(500).json({ error: 'Failed to open dispute', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * PATCH /api/transactions/:id/dispute/counter-evidence
 * Seller uploads counter-evidence (original listing photos, proof of secure packaging).
 */
router.patch('/:id/dispute/counter-evidence', async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const isSeller = transaction.seller.toString() === user._id.toString();
    if (!isSeller) {
      return res.status(403).json({ error: 'Only the seller can upload counter-evidence.' });
    }

    if (!transaction.disputeOpen || transaction.disputeAdminVerdict) {
      return res.status(400).json({
        error: 'Invalid state',
        message: 'No open dispute or dispute has already been ruled on.'
      });
    }

    const { mediaUrls } = req.body;
    if (!mediaUrls || !Array.isArray(mediaUrls)) {
      return res.status(400).json({ error: 'Invalid request', message: 'Provide mediaUrls array.' });
    }

    transaction.disputeSellerCounterMediaUrls = mediaUrls.slice(0, 10);
    await transaction.save();

    const buyerUserId = transaction.buyer?.toString?.();
    if (buyerUserId) {
      const listing = await Listing.findById(transaction.listing).select('title').lean();
      const listingTitle = listing?.title || 'the transaction';
      notifyEvidenceSubmitted({
        transactionId: transaction._id.toString(),
        listingTitle,
        submitterRole: 'seller',
        otherPartyUserId: buyerUserId
      }).catch(err => console.error('Failed to create evidence-submitted notification:', err));
      const io = req.app.get('io');
      if (io) emitNewNotificationToUser(io, buyerUserId).catch(() => {});
    }

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom returnPolicy')
      .populate('seller', 'firstName lastName')
      .populate('buyer', 'firstName lastName')
      .lean();

    res.json({
      ...updated,
      role: 'seller',
      ...normalizeTransactionStatus(updated)
    });
  } catch (error) {
    console.error('Error updating counter-evidence:', error);
    res.status(500).json({ error: 'Failed to update counter-evidence', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * PATCH /api/transactions/:id
 * Update transaction status (seller: mark shipped with tracking; buyer: mark delivered)
 */
router.patch('/:id', requireActiveAccount, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid });
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

    const { status, trackingNumber, trackingCarrier, sellerProofOfDeliveryUrl, estimatedDeliveryDays, disputeOpen, disputeReason } = req.body;
    const ts = transaction.transactionStatus ?? transaction.status;

    /** When under dispute, lock: no status changes until admin ruling */
    if (ts === 'under_dispute' && status) {
      return res.status(400).json({
        error: 'Transaction under dispute',
        message: 'This transaction is under dispute. An admin will mediate and provide a ruling. No status changes are allowed until the dispute is resolved.'
      });
    }

    if (isSeller) {
      if (status === 'accept_payment' && ts === 'awaiting_seller_acceptance') {
        transaction.transactionStatus = 'paid';
        transaction.paymentStatus = 'paid';
        transaction.paidAt = transaction.paidAt || new Date();
        ensureShippingDeadlinesFromPaidAt(transaction);
        const listing = await Listing.findById(transaction.listing).select('title').lean();
        const listingTitle = listing?.title || 'the item';
        // Notify buyer that seller accepted
        const buyerUserId = transaction.buyer?.toString?.();
        if (buyerUserId) {
          notifyBuyerSellerAccepted({
            transactionId: transaction._id.toString(),
            listingTitle,
            buyerUserId
          }).catch(err => console.error('Failed to create buyer seller-accepted notification:', err));
          const io = req.app.get('io');
          if (io) emitNewNotificationToUser(io, buyerUserId).catch(() => {});
          // Email to buyer
          const buyer = await Customer.findById(buyerUserId).select('email firstName').lean();
          if (buyer?.email) {
            const txLink = transactionUrl(transaction._id?.toString?.());
            const bodyHtml = `
              <p style="margin:0 0 16px;">Hi ${buyer.firstName || 'there'},</p>
              <p style="margin:0 0 16px;">The seller confirmed your payment for <strong>${listingTitle}</strong> and will prepare your order for shipment.</p>
              ${emailInfoBox('We will notify you when the item is marked as shipped.')}`;
            const html = wrapBidRoomEmail({
              title: 'Order confirmed',
              bodyHtml,
              ctaUrl: txLink,
              ctaLabel: 'View transaction'
            });
            sendEmail(buyer.email, `Your order for "${listingTitle}" has been confirmed`, html)
              .catch(err => console.error('Failed to send seller-accepted email to buyer:', err.message));
          }
          // Payment accepted: apply any deferred suspensions (listing auction has ended at this point).
          checkAndApplyPendingSuspensions(
            [transaction.buyer?.toString(), transaction.seller?.toString()].filter(Boolean),
            io
          ).catch(err => console.error('[AccountStatus] checkAndApplyPendingSuspensions error:', err.message));
        }
      } else if (status === 'shipped') {
        if (!sellerCanMarkAsShipped(transaction, ts)) {
          return res.status(400).json({
            error: 'Invalid state',
            message: 'You can only mark the item as shipped after payment has been received.'
          });
        }
        if (ts === 'awaiting_seller_acceptance') {
          transaction.transactionStatus = 'paid';
          transaction.paymentStatus = 'paid';
          transaction.paidAt = transaction.paidAt || new Date();
          ensureShippingDeadlinesFromPaidAt(transaction);
          transaction.paymentAcceptanceDeadline = null;
        }
        transaction.transactionStatus = 'shipped';
        transaction.sendingStatus = 'shipped';
        transaction.shippedAt = transaction.shippedAt || new Date();
        if (trackingNumber != null) transaction.trackingNumber = trackingNumber;
        if (trackingCarrier != null) transaction.trackingCarrier = trackingCarrier;
        if (sellerProofOfDeliveryUrl != null) transaction.sellerProofOfDeliveryUrl = sellerProofOfDeliveryUrl;
        // Compute estimated delivery date and auto-release cutoff
        const shipDate = transaction.shippedAt;
        const deliveryDays = estimatedDeliveryDays != null
          ? parseInt(estimatedDeliveryDays, 10)
          : (transaction.shippingDeliveryDays || null);
        if (deliveryDays && deliveryDays > 0) {
          const estDelivery = new Date(shipDate);
          estDelivery.setDate(estDelivery.getDate() + deliveryDays);
          transaction.estimatedDeliveryDate = estDelivery;
          const autoRelease = new Date(estDelivery);
          autoRelease.setDate(autoRelease.getDate() + 5);
          transaction.autoReleaseAt = autoRelease;
        } else {
          // No delivery estimate: auto-release 14 days after ship date
          const autoRelease = new Date(shipDate);
          autoRelease.setDate(autoRelease.getDate() + 14);
          transaction.autoReleaseAt = autoRelease;
        }
        const buyerUserId = transaction.buyer?.toString?.();
        if (buyerUserId) {
          const listing = await Listing.findById(transaction.listing).select('title').lean();
          const listingTitle = listing?.title || 'Your item';
          notifyItemMarkedShipped({
            transactionId: transaction._id.toString(),
            listingTitle,
            buyerUserId
          }).catch(err => console.error('Failed to create shipped notification:', err));
          if (trackingNumber) {
            notifyTrackingProvided({
              transactionId: transaction._id.toString(),
              listingTitle,
              buyerUserId
            }).catch(err => console.error('Failed to create tracking notification:', err));
          }
          const io = req.app.get('io');
          if (io) emitNewNotificationToUser(io, buyerUserId).catch(() => {});

          // Email to buyer with optional proof-of-shipment link
          const buyer = await Customer.findById(buyerUserId).select('email firstName').lean();
          if (buyer?.email) {
            const txLink = transactionUrl(transaction._id?.toString?.());
            const trackingSection = trackingNumber
              ? emailInfoBox(`Tracking: <strong>${trackingCarrier ? trackingCarrier + ' – ' : ''}${trackingNumber}</strong>`)
              : '';
            const proofSection = sellerProofOfDeliveryUrl
              ? `<p style="margin:16px 0 0;">${emailTextLink(sellerProofOfDeliveryUrl, 'View proof of shipment')}</p>`
              : '';
            const bodyHtml = `
              <p style="margin:0 0 16px;">Hi ${buyer.firstName || 'there'},</p>
              <p style="margin:0 0 16px;">The seller marked <strong>${listingTitle}</strong> as shipped.</p>
              ${trackingSection}
              ${proofSection}
              ${emailInfoBox('When you receive the item, confirm receipt in your dashboard.')}`;
            const html = wrapBidRoomEmail({
              title: 'Your item has shipped',
              bodyHtml,
              ctaUrl: txLink,
              ctaLabel: 'View transaction'
            });
            sendEmail(buyer.email, `Your item "${listingTitle}" has been shipped`, html)
              .catch(err => console.error('Failed to send shipped email to buyer:', err.message));
          }
        }
      } else if (status === 'cancelled' && ts === 'pending_payment') {
        transaction.transactionStatus = 'cancelled';
      }
    }

    /** Dispute: seller can open via PATCH; buyer should use POST /open-dispute for full form. */
    if (disputeOpen === true && !transaction.disputeOpen) {
      transaction.disputeOpen = true;
      transaction.disputeOpenedAt = new Date();
      transaction.disputeOpenedBy = isSeller ? 'seller' : 'buyer';
      if (disputeReason != null) transaction.disputeReason = String(disputeReason).trim() || null;
      transaction.transactionStatus = 'under_dispute';
      // Restrict both parties from new marketplace actions while dispute is under review
      const patchBuyerId = transaction.buyer?._id?.toString?.() || transaction.buyer?.toString?.();
      const patchSellerId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
      const patchIo = req.app.get('io');
      if (patchBuyerId && patchSellerId) {
        restrictBothPartiesForDispute(transaction._id, patchBuyerId, patchSellerId, patchIo).catch(err =>
          console.error('Failed to restrict accounts for seller-opened dispute:', err)
        );
      }
    }

    if (isBuyer) {
      if (status === 'delivered' && ts === 'shipped') {
        transaction.transactionStatus = 'delivered';
        transaction.sendingStatus = 'delivered';
        transaction.deliveredAt = transaction.deliveredAt || new Date();
        transaction.autoReleaseAt = null; // buyer confirmed — auto-release no longer needed
        const sellerUserId = transaction.seller?.toString?.();
        if (sellerUserId) {
          const listing = await Listing.findById(transaction.listing).select('title').lean();
          const listingTitle = listing?.title || 'the item';
          const buyer = await Customer.findById(transaction.buyer).select('firstName lastName').lean();
          const buyerName = buyer ? `${buyer.firstName || ''} ${buyer.lastName || ''}`.trim() : 'The buyer';
          notifyBuyerConfirmedReceipt({
            transactionId: transaction._id.toString(),
            listingTitle,
            buyerName,
            sellerUserId
          }).catch(err => console.error('Failed to create buyer-confirmed-receipt notification:', err));
          const io = req.app.get('io');
          if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
        }
      } else if (status === 'completed' && ['paid', 'shipped', 'delivered'].includes(ts)) {
        transaction.transactionStatus = 'completed';
        transaction.completedAt = transaction.completedAt || new Date();
        // Prompt both parties to leave a review
        const io = req.app.get('io');
        notifyReviewPrompt({
          buyerId: transaction.buyer,
          sellerId: transaction.seller,
          listingTitle: transaction.listing?.title,
          transactionId: transaction._id?.toString(),
          io
        }).catch(err => console.error('Failed to send review prompt notification:', err));
        // Apply any deferred suspensions now that the transaction is concluded.
        checkAndApplyPendingSuspensions(
          [transaction.buyer?.toString(), transaction.seller?.toString()].filter(Boolean),
          io
        ).catch(err => console.error('[AccountStatus] checkAndApplyPendingSuspensions error:', err.message));
      }
    }

    await transaction.save();

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom returnPolicy')
      .populate('seller', 'firstName lastName')
      .populate('buyer', 'firstName lastName')
      .lean();

    const { buyerHasReviewedSeller, sellerHasReviewedBuyer } = await getPartyReviewFlagsForTransaction(updated);

    const role = updated.seller?._id?.toString() === user._id.toString() ? 'seller' : 'buyer';
    res.json({
      ...updated,
      role,
      buyerHasReviewedSeller,
      sellerHasReviewedBuyer,
      ...normalizeTransactionStatus(updated)
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

const RETURN_WINDOW_DAYS = 7;

/**
 * POST /api/transactions/:id/request-return
 * Buyer requests a return within 7 days of confirmed delivery.
 * Body: { reason, photoUrls[] }
 * Moves to under_dispute + seller has 48h to respond before platform mediates.
 */
router.post('/:id/request-return', requireActiveAccount, async (req, res) => {
  try {
    const user = await Customer.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const transaction = await Transaction.findById(req.params.id)
      .populate('listing', 'title slug')
      .populate('seller', '_id uid firstName email');

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const isBuyer = transaction.buyer.toString() === user._id.toString();
    if (!isBuyer) return res.status(403).json({ error: 'Only the buyer can request a return.' });

    const ts = transaction.transactionStatus ?? transaction.status;
    if (ts !== 'delivered') {
      return res.status(400).json({
        error: 'Invalid state',
        message: 'Returns can only be requested after you confirm receipt of the item.'
      });
    }

    if (transaction.returnRequestedAt) {
      return res.status(400).json({ error: 'A return request has already been submitted for this transaction.' });
    }

    if (transaction.deliveredAt) {
      const returnDeadline = new Date(transaction.deliveredAt);
      returnDeadline.setDate(returnDeadline.getDate() + RETURN_WINDOW_DAYS);
      if (new Date() > returnDeadline) {
        return res.status(400).json({
          error: 'Return window closed',
          message: `The ${RETURN_WINDOW_DAYS}-day return window has closed.`
        });
      }
    }

    const { reason, photoUrls } = req.body;
    if (!reason || String(reason).trim().length < 5) {
      return res.status(400).json({ error: 'Please provide a return reason (at least 5 characters).' });
    }
    if (!photoUrls || !Array.isArray(photoUrls) || photoUrls.length < 1) {
      return res.status(400).json({ error: 'At least 1 photo is required as evidence.' });
    }

    const now = new Date();
    transaction.returnRequestedAt = now;
    transaction.returnReason = String(reason).trim();
    transaction.returnPhotoUrls = photoUrls.slice(0, 10);
    transaction.returnStatus = 'pending_seller_response';
    transaction.returnSellerDeadline = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    transaction.transactionStatus = 'under_dispute';
    transaction.disputeOpen = true;
    transaction.disputeOpenedAt = now;
    transaction.disputeOpenedBy = 'buyer';
    transaction.disputeReason = 'return_request';
    transaction.disputeExplanation = String(reason).trim();
    transaction.disputeBuyerMediaUrls = photoUrls.slice(0, 10);
    await transaction.save();

    // Restrict both parties
    const buyerMongoId = user._id.toString();
    const sellerMongoId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
    const io = req.app.get('io');
    if (buyerMongoId && sellerMongoId) {
      const { restrictBothPartiesForDispute } = require('../services/accountStatusService');
      restrictBothPartiesForDispute(transaction._id, buyerMongoId, sellerMongoId, io).catch(err =>
        console.error('Failed to restrict accounts for return dispute:', err)
      );
    }

    const listingTitle = transaction.listing?.title || 'the item';
    const buyerName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Buyer';
    if (sellerMongoId) {
      const { notifyDisputeOpened } = require('../services/notificationService');
      notifyDisputeOpened({
        transactionId: transaction._id.toString(),
        listingTitle,
        openerName: buyerName,
        otherPartyUserId: sellerMongoId
      }).catch(() => {});
      if (io) {
        const { emitNewNotificationToUser } = require('../services/notificationService');
        emitNewNotificationToUser(io, sellerMongoId).catch(() => {});
      }
      if (transaction.seller?.email) {
        const txLink = transactionUrl(transaction._id?.toString?.());
        const bodyHtml = `
          <p style="margin:0 0 16px;">Hi ${transaction.seller.firstName || 'there'},</p>
          <p style="margin:0 0 16px;">The buyer requested a return for <strong>${listingTitle}</strong>.</p>
          ${emailInfoBox(`<strong>Reason:</strong> ${transaction.returnReason}`)}
          ${emailInfoBox('You have <strong>48 hours</strong> to accept or reject before BidRoom mediates.')}`;
        const html = wrapBidRoomEmail({
          title: 'Return request received',
          bodyHtml,
          ctaUrl: txLink,
          ctaLabel: 'View transaction'
        });
        sendEmail(transaction.seller.email, `Return request for "${listingTitle}"`, html)
          .catch(err => console.error('Failed to send return request email:', err.message));
      }
    }

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom returnPolicy')
      .populate('seller', 'firstName lastName')
      .populate('buyer', 'firstName lastName')
      .lean();

    res.json({ ...updated, role: 'buyer', ...normalizeTransactionStatus(updated) });
  } catch (error) {
    console.error('Error requesting return:', error);
    res.status(500).json({ error: 'Failed to submit return request', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

module.exports = router;
