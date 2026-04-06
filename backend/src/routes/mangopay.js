/**
 * MangoPay Routes
 *
 * Seller onboarding:
 *   POST /api/mangopay/seller/setup          — create NaturalUser + Wallet + BankAccount
 *   GET  /api/mangopay/seller/status         — returns mangoPayOnboarded + kycLevel
 *   POST /api/mangopay/seller/update-iban    — deactivate old bank account, add new IBAN
 *
 * Buyer payment (card, via MangoPay.js tokenization):
 *   POST /api/mangopay/payment/card-registration  — returns CardRegistration object for frontend
 *   POST /api/mangopay/payment/pay-in             — creates PayIn after card is tokenized
 *   GET  /api/mangopay/payment/pay-in/:payInId    — poll PayIn status (3DS redirect return)
 *
 * Escrow release (automated + admin-triggered):
 *   POST /api/mangopay/payment/release-escrow/:transactionId — transfer commission + payout to seller
 *
 * Webhook:
 *   POST /api/mangopay/webhook               — handles MangoPay event notifications
 *
 * Admin controls (mounted under /api/admin/mangopay via admin router, see admin.js additions):
 *   POST /api/admin/mangopay/freeze/:transactionId  — block payout on open dispute
 *   POST /api/admin/mangopay/refund/:transactionId  — issue refund from seller wallet
 *   GET  /api/admin/mangopay/kyc                    — KYC status for all sellers
 */

const express = require('express');
const crypto = require('crypto');
const { authenticateToken, requireActiveAccount, optionalAuth } = require('../middleware/auth');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const mangoPayService = require('../services/mangoPayService');
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../services/templateEngine');
const { notifySellerPaymentReceived, emitNewNotificationToUser } = require('../services/notificationService');

const router = express.Router();
const LOG = '[MangoPay]';

const PLATFORM_FEE_RATE = 0.02; // 2% platform commission
const ESCROW_HOLD_MS = 48 * 60 * 60 * 1000; // 48 hours
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:4200';
const PLATFORM_WALLET_ID = process.env.MANGOPAY_PLATFORM_WALLET_ID;
const PLATFORM_USER_ID = process.env.MANGOPAY_PLATFORM_USER_ID;

// ─── Seller Onboarding ────────────────────────────────────────────────────────

/**
 * POST /api/mangopay/seller/setup
 * Create MangoPay NaturalUser + Wallet + IBAN BankAccount for a seller.
 * If the seller already has a mangoPayUserId, this updates their details and replaces the bank account.
 *
 * Body: { dobDay, dobMonth, dobYear, addressLine1, addressCity, addressPostal, addressCountry, iban, bic }
 */
router.post('/seller/setup', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const { dobDay, dobMonth, dobYear, addressLine1, addressCity, addressPostal, addressCountry, iban, bic } = req.body;

    if (!dobDay || !dobMonth || !dobYear) {
      return res.status(400).json({ error: 'Date of birth is required' });
    }
    if (!addressLine1 || !addressCity || !addressPostal || !addressCountry) {
      return res.status(400).json({ error: 'Full address is required' });
    }
    const ibanClean = iban ? String(iban).replace(/\s+/g, '').toUpperCase() : '';
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{1,30}$/.test(ibanClean) || ibanClean.length < 15) {
      return res.status(400).json({ error: 'Invalid IBAN format' });
    }

    const user = await User.findOne({ uid: req.user.uid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    let mangoPayUserId = user.mangoPayUserId;

    const kycData = {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      dobDay: parseInt(dobDay, 10),
      dobMonth: parseInt(dobMonth, 10),
      dobYear: parseInt(dobYear, 10),
      addressLine1,
      addressCity,
      addressPostal,
      addressCountry: String(addressCountry).toUpperCase()
    };

    // Create or update the NaturalUser
    if (!mangoPayUserId) {
      mangoPayUserId = await mangoPayService.createNaturalUser(kycData);
      user.mangoPayUserId = mangoPayUserId;
    } else {
      await mangoPayService.updateNaturalUser(mangoPayUserId, kycData);
    }

    // Create wallet if not already done
    if (!user.mangoPayWalletId) {
      const walletId = await mangoPayService.createWallet(mangoPayUserId);
      user.mangoPayWalletId = walletId;
    }

    // Deactivate old bank account if present, then create new one
    if (user.mangoPayBankAccountId) {
      await mangoPayService.deactivateBankAccount(mangoPayUserId, user.mangoPayBankAccountId).catch(err =>
        console.error(`${LOG} Could not deactivate old bank account: ${err.message}`)
      );
    }
    const bankAccountId = await mangoPayService.createIbanBankAccount(mangoPayUserId, {
      ownerName: `${user.firstName} ${user.lastName}`,
      iban: ibanClean,
      bic: bic || null,
      addressLine1,
      addressCity,
      addressPostal,
      addressCountry: String(addressCountry).toUpperCase()
    });
    user.mangoPayBankAccountId = bankAccountId;
    user.mangoPayOnboarded = true;

    await user.save();

    console.log(`${LOG} Seller onboarded uid=${user.uid?.slice(0, 8)} mangoPayUserId=${mangoPayUserId}`);
    res.json({ onboarded: true, mangoPayUserId, walletId: user.mangoPayWalletId, bankAccountId });
  } catch (err) {
    console.error(`${LOG} Seller setup error:`, err.message);
    res.status(500).json({ error: 'Failed to set up payout account', message: err.message });
  }
});

/**
 * GET /api/mangopay/seller/status
 * Returns the seller's MangoPay onboarding status.
 */
router.get('/seller/status', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ uid: req.user.uid }).select('mangoPayUserId mangoPayWalletId mangoPayBankAccountId mangoPayOnboarded mangoPayKycLevel');
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.mangoPayUserId) {
      // Refresh KYC level from MangoPay
      try {
        const kycLevel = await mangoPayService.getUserKycLevel(user.mangoPayUserId);
        if (kycLevel !== user.mangoPayKycLevel) {
          user.mangoPayKycLevel = kycLevel;
          await user.save();
        }
      } catch (_) { /* non-critical */ }
    }

    res.json({
      onboarded: user.mangoPayOnboarded,
      hasWallet: !!user.mangoPayWalletId,
      hasBankAccount: !!user.mangoPayBankAccountId,
      kycLevel: user.mangoPayKycLevel
    });
  } catch (err) {
    console.error(`${LOG} Seller status error:`, err.message);
    res.status(500).json({ error: 'Failed to get account status' });
  }
});

// ─── Buyer Payment (Card) ─────────────────────────────────────────────────────

/**
 * POST /api/mangopay/payment/card-registration
 * Returns a CardRegistration object for the frontend to use with MangoPay.js.
 * The frontend tokenizes the card and sends back the RegistrationData token.
 *
 * Body: { transactionId }
 */
router.post('/payment/card-registration', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId) return res.status(400).json({ error: 'transactionId is required' });

    const transaction = await Transaction.findById(transactionId)
      .populate('listing', 'title currentPrice shippingCost shippingOption')
      .populate('seller', 'mangoPayWalletId mangoPayOnboarded');

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'Already paid' });
    }
    if (!transaction.seller?.mangoPayOnboarded || !transaction.seller?.mangoPayWalletId) {
      return res.status(400).json({ error: 'Seller not ready', message: 'The seller has not set up their payout account yet.' });
    }

    const buyer = await User.findOne({ uid: req.user.uid }).select('mangoPayUserId firstName lastName email');
    if (!buyer) return res.status(404).json({ error: 'Buyer not found' });

    // Create a MangoPay user for the buyer lazily if they don't have one yet
    if (!buyer.mangoPayUserId) {
      const mangoPayUserId = await mangoPayService.createNaturalUser({
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        email: buyer.email,
        dobDay: 1, dobMonth: 1, dobYear: 1990, // placeholder — MangoPay requires DOB for NaturalUser
        addressLine1: 'N/A', addressCity: 'N/A', addressPostal: '00000', addressCountry: 'PT'
      });
      buyer.mangoPayUserId = mangoPayUserId;
      await buyer.save();
    }

    const cardReg = await mangoPayService.createCardRegistration(buyer.mangoPayUserId);

    res.json({
      id: cardReg.Id,
      accessKey: cardReg.AccessKey,
      preregistrationData: cardReg.PreregistrationData,
      cardRegistrationUrl: cardReg.CardRegistrationURL,
      currency: cardReg.Currency
    });
  } catch (err) {
    console.error(`${LOG} Card registration error:`, err.message);
    res.status(500).json({ error: 'Failed to create card registration', message: err.message });
  }
});

/**
 * POST /api/mangopay/payment/pay-in
 * Create a PayIn after MangoPay.js has tokenized the card.
 * Initiates 3DS if required — returns SecureModeRedirectURL for frontend to redirect to.
 *
 * Body: { transactionId, cardRegistrationId, registrationData }
 */
router.post('/payment/pay-in', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const { transactionId, cardRegistrationId, registrationData } = req.body;
    if (!transactionId || !cardRegistrationId || !registrationData) {
      return res.status(400).json({ error: 'transactionId, cardRegistrationId, and registrationData are required' });
    }

    const transaction = await Transaction.findById(transactionId)
      .populate('listing', 'title currentPrice shippingCost shippingOption commissionRate')
      .populate('seller', 'mangoPayUserId mangoPayWalletId mangoPayOnboarded firstName lastName');
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.paymentStatus === 'paid') {
      return res.status(400).json({ error: 'Already paid' });
    }
    if (!transaction.seller?.mangoPayOnboarded || !transaction.seller?.mangoPayWalletId) {
      return res.status(400).json({ error: 'Seller not ready', message: 'The seller has not set up their payout account yet.' });
    }

    const buyer = await User.findOne({ uid: req.user.uid }).select('mangoPayUserId');
    if (!buyer?.mangoPayUserId) return res.status(400).json({ error: 'Buyer MangoPay account not found. Please retry.' });

    // Finalize card registration to get a reusable CardId
    const cardId = await mangoPayService.finalizeCardRegistration(cardRegistrationId, registrationData);

    // Calculate amounts (in cents — MangoPay uses smallest currency unit)
    const itemAmount = transaction.amount;
    const shippingAmount = transaction.shippingAmount ?? (
      transaction.listing?.shippingOption === 'free' || transaction.listing?.shippingOption === 'local-pickup'
        ? 0
        : (transaction.listing?.shippingCost ?? 0)
    );
    const totalAmount = itemAmount + shippingAmount;
    const commissionRate = transaction.listing?.commissionRate ?? PLATFORM_FEE_RATE;
    const commissionAmount = Math.round(itemAmount * commissionRate * 100) / 100; // on item amount only

    const totalCents = Math.round(totalAmount * 100);
    const commissionCents = Math.round(commissionAmount * 100);

    // Idempotency key based on transactionId to prevent double-charge
    const idempotencyKey = `payin-${transactionId}`;

    const returnUrl = `${FRONTEND_URL}/dashboard/transactions?mangopay_return=1&transactionId=${transactionId}`;

    const payIn = await mangoPayService.createDirectCardPayIn({
      buyerMangoPayUserId: buyer.mangoPayUserId,
      sellerWalletId: transaction.seller.mangoPayWalletId,
      cardId,
      amountCents: totalCents,
      feeCents: commissionCents,
      currency: 'EUR',
      transactionId: transaction._id.toString(),
      returnUrl,
      idempotencyKey
    });

    // Store PayIn ID and commission on the transaction immediately
    const escrowReleasesAt = new Date(Date.now() + ESCROW_HOLD_MS);
    await Transaction.findByIdAndUpdate(transactionId, {
      $set: {
        mangoPayPayInId: payIn.Id,
        bidRoomFeeAmount: commissionAmount,
        shippingAmount,
        buyerTotalPaid: totalAmount,
        escrowStatus: 'pending_inspection',
        escrowReleasesAt
      }
    }, { runValidators: false });

    if (payIn.Status === 'FAILED') {
      return res.status(400).json({
        error: 'Payment failed',
        message: payIn.ResultMessage || 'The payment was declined. Please check your card details and try again.'
      });
    }

    // 3DS required — redirect buyer to MangoPay's secure page
    if (payIn.SecureModeRedirectURL) {
      return res.json({ requires3ds: true, redirectUrl: payIn.SecureModeRedirectURL, payInId: payIn.Id });
    }

    // PayIn succeeded immediately (no 3DS)
    if (payIn.Status === 'SUCCEEDED') {
      await _handlePayInSuccess(transaction, payIn, commissionAmount, shippingAmount, totalAmount, escrowReleasesAt);
    }

    res.json({ payInId: payIn.Id, status: payIn.Status });
  } catch (err) {
    console.error(`${LOG} PayIn error:`, err.message);
    res.status(500).json({ error: 'Payment failed', message: err.message });
  }
});

/**
 * GET /api/mangopay/payment/pay-in/:payInId
 * Poll PayIn status after buyer returns from 3DS redirect.
 * Called by the frontend on the return URL.
 */
router.get('/payment/pay-in/:payInId', authenticateToken, async (req, res) => {
  try {
    const payIn = await mangoPayService.getPayIn(req.params.payInId);

    if (payIn.Status === 'SUCCEEDED') {
      // Find transaction by PayIn tag (bidroom-transaction:<id>)
      const transactionId = payIn.Tag?.split(':')[1];
      if (transactionId) {
        const transaction = await Transaction.findById(transactionId)
          .populate('listing', 'title currentPrice shippingCost shippingOption commissionRate')
          .populate('seller', 'mangoPayUserId mangoPayWalletId');

        if (transaction && transaction.paymentStatus !== 'paid') {
          const commissionAmount = transaction.bidRoomFeeAmount ?? (transaction.amount * PLATFORM_FEE_RATE);
          const shippingAmount = transaction.shippingAmount ?? 0;
          const totalAmount = transaction.buyerTotalPaid ?? (transaction.amount + shippingAmount);
          const escrowReleasesAt = transaction.escrowReleasesAt ?? new Date(Date.now() + ESCROW_HOLD_MS);
          await _handlePayInSuccess(transaction, payIn, commissionAmount, shippingAmount, totalAmount, escrowReleasesAt);
        }
      }
    }

    res.json({ status: payIn.Status, resultCode: payIn.ResultCode, resultMessage: payIn.ResultMessage });
  } catch (err) {
    console.error(`${LOG} Get PayIn error:`, err.message);
    res.status(500).json({ error: 'Failed to get payment status' });
  }
});

/**
 * POST /api/mangopay/payment/release-escrow/:transactionId
 * Transfer platform commission + payout remaining funds to seller IBAN.
 * Called automatically after 48h (by a scheduler) or manually by admin.
 * Protected: only accessible by the authenticated admin or internal scheduler (via service key).
 */
router.post('/payment/release-escrow/:transactionId', authenticateToken, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('seller', 'mangoPayUserId mangoPayWalletId mangoPayBankAccountId firstName lastName');

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.escrowStatus !== 'pending_inspection') {
      return res.status(400).json({ error: 'Escrow not in pending_inspection state' });
    }
    if (transaction.disputeOpen) {
      return res.status(400).json({ error: 'Cannot release escrow: dispute is open' });
    }
    if (transaction.escrowReleasesAt && new Date() < transaction.escrowReleasesAt) {
      return res.status(400).json({ error: 'Inspection window has not expired yet' });
    }

    const seller = transaction.seller;
    if (!seller?.mangoPayUserId || !seller?.mangoPayWalletId || !seller?.mangoPayBankAccountId) {
      return res.status(400).json({ error: 'Seller MangoPay account incomplete' });
    }

    const totalPaid = transaction.buyerTotalPaid ?? transaction.amount;
    const commissionAmount = transaction.bidRoomFeeAmount ?? Math.round(transaction.amount * PLATFORM_FEE_RATE * 100) / 100;
    const shippingAmount = transaction.shippingAmount ?? 0;
    const payoutAmount = totalPaid - commissionAmount;

    const commissionCents = Math.round(commissionAmount * 100);
    const payoutCents = Math.round(payoutAmount * 100);

    // 1. Transfer commission to platform wallet
    if (commissionCents > 0 && PLATFORM_WALLET_ID) {
      const transfer = await mangoPayService.createTransfer({
        sellerMangoPayUserId: seller.mangoPayUserId,
        sellerWalletId: seller.mangoPayWalletId,
        platformWalletId: PLATFORM_WALLET_ID,
        commissionCents,
        currency: 'EUR',
        transactionId: transaction._id.toString()
      });
      await Transaction.findByIdAndUpdate(transaction._id, { $set: { mangoPayTransferId: transfer.Id } }, { runValidators: false });
    }

    // 2. Payout remaining funds to seller IBAN
    const payout = await mangoPayService.createPayout({
      sellerMangoPayUserId: seller.mangoPayUserId,
      sellerWalletId: seller.mangoPayWalletId,
      sellerBankAccountId: seller.mangoPayBankAccountId,
      amountCents: payoutCents,
      currency: 'EUR',
      transactionId: transaction._id.toString()
    });

    await Transaction.findByIdAndUpdate(transaction._id, {
      $set: {
        mangoPayPayoutId: payout.Id,
        escrowStatus: 'released',
        sellerPayoutAmount: payoutAmount,
        transactionStatus: 'completed'
      }
    }, { runValidators: false });

    console.log(`${LOG} Escrow released txn=${transaction._id} payoutId=${payout.Id} amount=${payoutAmount}`);
    res.json({ success: true, payoutId: payout.Id, payoutAmount });
  } catch (err) {
    console.error(`${LOG} Release escrow error:`, err.message);
    res.status(500).json({ error: 'Failed to release escrow', message: err.message });
  }
});

// ─── Webhook ──────────────────────────────────────────────────────────────────

/**
 * POST /api/mangopay/webhook
 * MangoPay sends event notifications here.
 * Verify authenticity with the MANGOPAY_WEBHOOK_SECRET (basic auth or token check).
 *
 * Key events handled:
 *   PAYIN_NORMAL_SUCCEEDED  — payment confirmed, start escrow
 *   PAYIN_NORMAL_FAILED     — payment failed, notify buyer
 *   KYC_SUCCEEDED           — seller KYC level upgraded to REGULAR
 *   PAYOUT_NORMAL_SUCCEEDED — payout landed, notify seller
 *   TRANSFER_NORMAL_SUCCEEDED — commission transfer confirmed
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Acknowledge immediately — MangoPay expects a 200 before processing
  res.status(200).send('OK');

  try {
    // MangoPay sends webhook as query params on the URL, not in the body
    // Actual event data is in req.query (EventType, RessourceId, Date)
    const { EventType, RessourceId } = req.query;

    if (!EventType || !RessourceId) return;

    console.log(`${LOG} Webhook received EventType=${EventType} RessourceId=${RessourceId}`);

    switch (EventType) {
      case 'PAYIN_NORMAL_SUCCEEDED': {
        const payIn = await mangoPayService.getPayIn(RessourceId);
        const transactionId = payIn.Tag?.split(':')[1];
        if (!transactionId) break;

        const transaction = await Transaction.findById(transactionId)
          .populate('listing', 'title commissionRate')
          .populate('seller', 'mangoPayUserId mangoPayWalletId');

        if (transaction && transaction.paymentStatus !== 'paid') {
          const commissionAmount = transaction.bidRoomFeeAmount ?? (transaction.amount * PLATFORM_FEE_RATE);
          const shippingAmount = transaction.shippingAmount ?? 0;
          const totalAmount = transaction.buyerTotalPaid ?? (transaction.amount + shippingAmount);
          const escrowReleasesAt = transaction.escrowReleasesAt ?? new Date(Date.now() + ESCROW_HOLD_MS);
          await _handlePayInSuccess(transaction, payIn, commissionAmount, shippingAmount, totalAmount, escrowReleasesAt);
        }
        break;
      }

      case 'PAYIN_NORMAL_FAILED': {
        const payIn = await mangoPayService.getPayIn(RessourceId);
        const transactionId = payIn.Tag?.split(':')[1];
        if (transactionId) {
          console.log(`${LOG} PayIn FAILED txn=${transactionId} reason=${payIn.ResultMessage}`);
          // PayIn failed — transaction remains pending_payment, buyer can retry
          await Transaction.findByIdAndUpdate(transactionId, {
            $set: { mangoPayPayInId: payIn.Id }
          }, { runValidators: false });
        }
        break;
      }

      case 'KYC_SUCCEEDED': {
        const user = await User.findOne({ mangoPayUserId: RessourceId });
        if (user) {
          user.mangoPayKycLevel = 'REGULAR';
          await user.save();
          console.log(`${LOG} KYC_SUCCEEDED uid=${user.uid?.slice(0, 8)}`);
        }
        break;
      }

      case 'PAYOUT_NORMAL_SUCCEEDED': {
        const payout = await mangoPayService.getPayout(RessourceId);
        const transactionId = payout.Tag?.split(':')[1];
        if (transactionId) {
          await Transaction.findByIdAndUpdate(transactionId, {
            $set: { escrowStatus: 'released', transactionStatus: 'completed' }
          }, { runValidators: false });
          console.log(`${LOG} Payout confirmed txn=${transactionId}`);
        }
        break;
      }

      default:
        console.log(`${LOG} Unhandled webhook event: ${EventType}`);
    }
  } catch (err) {
    console.error(`${LOG} Webhook processing error:`, err.message);
  }
});

// ─── Internal helper ──────────────────────────────────────────────────────────

async function _handlePayInSuccess(transaction, payIn, commissionAmount, shippingAmount, totalAmount, escrowReleasesAt) {
  const io = global._io; // set in index.js via app.set('io', io) and global._io = io

  await Transaction.findByIdAndUpdate(transaction._id, {
    $set: {
      mangoPayPayInId: payIn.Id,
      bidRoomFeeAmount: commissionAmount,
      shippingAmount,
      buyerTotalPaid: totalAmount,
      paymentStatus: 'paid',
      transactionStatus: 'awaiting_seller_acceptance',
      paidAt: new Date(),
      escrowStatus: 'pending_inspection',
      escrowReleasesAt
    }
  }, { runValidators: false });

  // Notify seller
  try {
    const populatedTxn = await Transaction.findById(transaction._id)
      .populate('seller', 'firstName lastName email uid')
      .populate('buyer', 'firstName lastName')
      .populate('listing', 'title');

    if (populatedTxn?.seller?.email) {
      const sellerUserId = populatedTxn.seller._id?.toString();
      const buyerName = `${populatedTxn.buyer?.firstName || ''} ${populatedTxn.buyer?.lastName || ''}`.trim() || 'A buyer';

      notifySellerPaymentReceived({
        transactionId: transaction._id.toString(),
        listingTitle: populatedTxn.listing?.title || 'your listing',
        buyerName,
        sellerUserId
      }).catch(err => console.error(`${LOG} Seller payment notification failed:`, err));

      if (io && sellerUserId) {
        emitNewNotificationToUser(io, sellerUserId).catch(() => {});
      }
    }
  } catch (notifyErr) {
    console.error(`${LOG} Notification error after PayIn:`, notifyErr.message);
  }

  console.log(`${LOG} PayIn success handled txn=${transaction._id} escrowReleasesAt=${escrowReleasesAt.toISOString()}`);
}

module.exports = router;
