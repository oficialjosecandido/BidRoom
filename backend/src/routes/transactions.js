const express = require('express');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/** Ensure API always returns transactionStatus, paymentStatus, sendingStatus (for old docs that only have status) */
function normalizeTransactionStatus(t) {
  const transactionStatus = t.transactionStatus || t.status || 'pending_payment';
  const paymentStatus = t.paymentStatus ?? (['paid', 'shipped', 'delivered', 'completed'].includes(transactionStatus) ? 'paid' : 'pending');
  const sendingStatus = t.sendingStatus ?? (transactionStatus === 'shipped' ? 'shipped' : ['delivered', 'completed'].includes(transactionStatus) ? 'delivered' : 'pending');
  return { transactionStatus, paymentStatus, sendingStatus };
}

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

    const withRole = transactions.map(t => {
      const role = t.seller?._id?.toString() === user._id.toString() ? 'seller' : 'buyer';
      return { ...t, role, ...normalizeTransactionStatus(t) };
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

    res.json({ ...transaction, ...normalizeTransactionStatus(transaction) });
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

    const { status, trackingNumber, trackingCarrier } = req.body;
    const ts = transaction.transactionStatus ?? transaction.status;
    const ps = transaction.paymentStatus ?? 'pending';
    const ss = transaction.sendingStatus ?? 'pending';

    if (isSeller) {
      if (status === 'shipped') {
        transaction.transactionStatus = 'shipped';
        transaction.sendingStatus = 'shipped';
        transaction.shippedAt = transaction.shippedAt || new Date();
        if (trackingNumber != null) transaction.trackingNumber = trackingNumber;
        if (trackingCarrier != null) transaction.trackingCarrier = trackingCarrier;
      } else if (status === 'cancelled' && ts === 'pending_payment') {
        transaction.transactionStatus = 'cancelled';
      }
    }

    if (isBuyer) {
      if (status === 'paid') {
        transaction.transactionStatus = 'paid';
        transaction.paymentStatus = 'paid';
        transaction.paidAt = transaction.paidAt || new Date();
      } else if (status === 'delivered' && ts === 'shipped') {
        transaction.transactionStatus = 'delivered';
        transaction.sendingStatus = 'delivered';
      } else if (status === 'completed' && ['paid', 'shipped', 'delivered'].includes(ts)) {
        transaction.transactionStatus = 'completed';
      }
    }

    await transaction.save();

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images status')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    res.json({ ...updated, ...normalizeTransactionStatus(updated) });
  } catch (error) {
    console.error('Error updating transaction:', error);
    res.status(500).json({ error: 'Failed to update transaction', message: error.message });
  }
});

module.exports = router;
