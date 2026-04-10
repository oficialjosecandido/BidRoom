const express = require('express');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const User = require('../models/User');
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
  notifySellerBuyerRemindedShip,
  emitNewNotificationToUser
} = require('../services/notificationService');
const { ensureShippingDeadlinesFromPaidAt } = require('../services/shippingDeadlines');
const { suspendBothPartiesForDispute } = require('../services/accountStatusService');
const { generateInvoicePdf } = require('../services/invoiceService');

const router = express.Router();

/** Ensure API always returns transactionStatus, paymentStatus, sendingStatus (for old docs that only have status) */
function normalizeTransactionStatus(t) {
  const transactionStatus = t.transactionStatus || t.status || 'pending_payment';
  const paymentStatus = t.paymentStatus ?? (['paid', 'shipped', 'delivered', 'under_dispute', 'completed'].includes(transactionStatus) ? 'paid' : 'pending');
  const sendingStatus = t.sendingStatus ?? (transactionStatus === 'shipped' ? 'shipped' : ['delivered', 'under_dispute', 'completed'].includes(transactionStatus) ? 'delivered' : 'pending');
  return { transactionStatus, paymentStatus, sendingStatus };
}

const DISPUTE_REASON_CODES = ['item_not_as_described', 'damaged_in_transit', 'missing_parts', 'counterfeit', 'other'];

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
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom')
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
 * GET /api/transactions/:id/invoice?role=seller|buyer
 * Download invoice/receipt PDF (completed transactions only)
 */
router.get('/:id/invoice', async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const role = req.query.role;
    if (!role || !['seller', 'buyer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid or missing role. Use ?role=seller or ?role=buyer' });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const ts = transaction.transactionStatus ?? transaction.status;
    if (ts !== 'completed') {
      return res.status(400).json({ error: 'Invoice is only available for completed transactions.' });
    }

    const sellerId = transaction.seller?._id?.toString() || transaction.seller?.toString();
    const buyerId = transaction.buyer?._id?.toString() || transaction.buyer?.toString();
    if (role === 'seller' && sellerId !== user._id.toString()) {
      return res.status(403).json({ error: 'You do not have access to the seller invoice for this transaction.' });
    }
    if (role === 'buyer' && buyerId !== user._id.toString()) {
      return res.status(403).json({ error: 'You do not have access to the buyer receipt for this transaction.' });
    }

    const pdfBuffer = await generateInvoicePdf(transaction, role);
    const filename = role === 'seller' ? `invoice-${transaction._id}.pdf` : `receipt-${transaction._id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Error generating invoice:', error);
    res.status(500).json({ error: 'Failed to generate invoice', message: error.message });
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
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom')
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
 * POST /api/transactions/:id/open-dispute
 * Buyer opens a formal dispute (status must be 'shipped', handling period for receipt implied).
 * Body: { reason, explanation, mediaUrls } - reason from DISPUTE_REASON_CODES, mediaUrls: 3+ photos or 1 video.
 */
router.post('/:id/open-dispute', async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('listing', 'title slug')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email');

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

    // Suspend both buyer and seller accounts while dispute is under review
    const buyerUserId = transaction.buyer?._id?.toString?.() || transaction.buyer?.toString?.();
    const sellerUserId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
    const io = req.app.get('io');
    if (buyerUserId && sellerUserId) {
      suspendBothPartiesForDispute(transaction._id, buyerUserId, sellerUserId, io).catch(err =>
        console.error('Failed to suspend accounts for dispute:', err)
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
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    res.json({
      ...updated,
      role: 'buyer',
      ...normalizeTransactionStatus(updated)
    });
  } catch (error) {
    console.error('Error opening dispute:', error);
    res.status(500).json({ error: 'Failed to open dispute', message: error.message });
  }
});

/**
 * PATCH /api/transactions/:id/dispute/counter-evidence
 * Seller uploads counter-evidence (original listing photos, proof of secure packaging).
 */
router.patch('/:id/dispute/counter-evidence', async (req, res) => {
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
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    res.json({
      ...updated,
      role: 'seller',
      ...normalizeTransactionStatus(updated)
    });
  } catch (error) {
    console.error('Error updating counter-evidence:', error);
    res.status(500).json({ error: 'Failed to update counter-evidence', message: error.message });
  }
});

/** 24-hour cooldown between buyer "Remind seller to ship" requests. */
const REMIND_SHIP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/transactions/:id/remind-ship
 *
 * Allows the buyer to send a push notification nudging the seller to ship.
 * - Only available while transactionStatus is 'awaiting_seller_acceptance' or 'paid'.
 * - Rate-limited: returns HTTP 429 with retryAfterMs if called within 24 hours
 *   of the last reminder.
 * - Updates buyerRemindSellerShipAt on the transaction and sends an in-app
 *   notification to the seller via notificationService.
 */
router.post('/:id/remind-ship', requireActiveAccount, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid });
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const transaction = await Transaction.findById(req.params.id)
      .populate('listing', 'title slug')
      .populate('seller', '_id uid email firstName');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const isBuyer = transaction.buyer.toString() === user._id.toString();
    if (!isBuyer) {
      return res.status(403).json({ error: 'Only the buyer can send this reminder.' });
    }

    const ts = transaction.transactionStatus ?? transaction.status;
    if (!['awaiting_seller_acceptance', 'paid'].includes(ts)) {
      return res.status(400).json({
        error: 'Cannot remind',
        message: 'A reminder is only available before the item is marked as shipped.'
      });
    }

    const last = transaction.buyerRemindSellerShipAt ? new Date(transaction.buyerRemindSellerShipAt).getTime() : 0;
    if (last && Date.now() - last < REMIND_SHIP_COOLDOWN_MS) {
      return res.status(429).json({
        error: 'Too soon',
        message: 'You can remind the seller again after 24 hours.',
        retryAfterMs: REMIND_SHIP_COOLDOWN_MS - (Date.now() - last)
      });
    }

    transaction.buyerRemindSellerShipAt = new Date();
    await transaction.save();

    const sellerUserId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
    const listingTitle = transaction.listing?.title || 'your order';
    if (sellerUserId) {
      notifySellerBuyerRemindedShip({
        transactionId: transaction._id.toString(),
        listingTitle,
        sellerUserId
      }).catch(err => console.error('Failed to notify seller remind-ship:', err));
      const io = req.app.get('io');
      if (io) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
    }

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    res.json({
      ...updated,
      role: 'buyer',
      ...normalizeTransactionStatus(updated)
    });
  } catch (error) {
    console.error('Error remind-ship:', error);
    res.status(500).json({ error: 'Failed to send reminder', message: error.message });
  }
});

/**
 * PATCH /api/transactions/:id
 * Update transaction status (seller: mark shipped with tracking; buyer: mark delivered)
 */
router.patch('/:id', requireActiveAccount, async (req, res) => {
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

    const { status, trackingNumber, trackingCarrier, sellerProofOfDeliveryUrl, disputeOpen, disputeReason } = req.body;
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
          const buyer = await User.findById(buyerUserId).select('email firstName').lean();
          if (buyer?.email) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
            const txLink = `${frontendUrl}/dashboard/transactions`;
            const html = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #7A4F84 0%, #9b6ba8 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0;">Your order has been confirmed!</h1>
                </div>
                <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
                  <p>Hi ${buyer.firstName || 'there'},</p>
                  <p>The seller has accepted your payment for <strong>${listingTitle}</strong> and will prepare your order for shipment shortly.</p>
                  <p style="text-align: center; margin: 24px 0;">
                    <a href="${txLink}" style="background: #7A4F84; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Transaction</a>
                  </p>
                  <p>Best regards,<br>The BidRoom Team</p>
                </div>
              </div>
            `;
            sendEmail(buyer.email, `Your order for "${listingTitle}" has been confirmed`, html)
              .catch(err => console.error('Failed to send seller-accepted email to buyer:', err.message));
          }
        }
      } else if (status === 'shipped') {
        if (ts !== 'paid') {
          return res.status(400).json({
            error: 'Invalid state',
            message: 'You can only mark the item as shipped after confirming payment from the buyer.'
          });
        }
        transaction.transactionStatus = 'shipped';
        transaction.sendingStatus = 'shipped';
        transaction.shippedAt = transaction.shippedAt || new Date();
        if (trackingNumber != null) transaction.trackingNumber = trackingNumber;
        if (trackingCarrier != null) transaction.trackingCarrier = trackingCarrier;
        if (sellerProofOfDeliveryUrl != null) transaction.sellerProofOfDeliveryUrl = sellerProofOfDeliveryUrl;
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
          const buyer = await User.findById(buyerUserId).select('email firstName').lean();
          if (buyer?.email) {
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
            const txLink = `${frontendUrl}/dashboard/transactions`;
            const proofSection = sellerProofOfDeliveryUrl
              ? `<p style="margin-top: 16px;"><a href="${sellerProofOfDeliveryUrl}" target="_blank" style="color: #7A4F84; font-weight: bold;">View proof of shipment</a></p>`
              : '';
            const trackingSection = trackingNumber
              ? `<p>Tracking: <strong>${trackingCarrier ? trackingCarrier + ' – ' : ''}${trackingNumber}</strong></p>`
              : '';
            const html = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #7A4F84 0%, #9b6ba8 100%); color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0;">Your item has been shipped!</h1>
                </div>
                <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px;">
                  <p>Hi ${buyer.firstName || 'there'},</p>
                  <p>The seller has shipped <strong>${listingTitle}</strong>.</p>
                  ${trackingSection}
                  ${proofSection}
                  <p style="text-align: center; margin: 24px 0;">
                    <a href="${txLink}" style="background: #7A4F84; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold;">View Transaction</a>
                  </p>
                  <p>Best regards,<br>The BidRoom Team</p>
                </div>
              </div>
            `;
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
      // Suspend both parties while dispute is under review
      const patchBuyerId = transaction.buyer?._id?.toString?.() || transaction.buyer?.toString?.();
      const patchSellerId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
      const patchIo = req.app.get('io');
      if (patchBuyerId && patchSellerId) {
        suspendBothPartiesForDispute(transaction._id, patchBuyerId, patchSellerId, patchIo).catch(err =>
          console.error('Failed to suspend accounts for seller-opened dispute:', err)
        );
      }
    }

    if (isBuyer) {
      if (status === 'delivered' && ts === 'shipped') {
        transaction.transactionStatus = 'delivered';
        transaction.sendingStatus = 'delivered';
        const sellerUserId = transaction.seller?.toString?.();
        if (sellerUserId) {
          const listing = await Listing.findById(transaction.listing).select('title').lean();
          const listingTitle = listing?.title || 'the item';
          const buyer = await User.findById(transaction.buyer).select('firstName lastName').lean();
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
      .populate('listing', 'title slug images status commissionRate shippingCost shippingOption auctionFormat allowPrivateRoom')
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
