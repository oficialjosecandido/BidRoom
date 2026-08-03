'use strict';

const express = require('express');
const router = express.Router();
const VehicleTransaction = require('../models/VehicleTransaction');
const {
  attemptBuyerDeposit,
  confirmBuyerDeposit,
  attemptSellerFee,
  confirmSellerFee,
  confirmCompletion,
  uploadRegistrationProof,
} = require('../services/vehicleTransactionService');
const { requireAuth } = require('../middleware/auth');

// ── Helpers ───────────────────────────────────────────────────────────────────

function isParty(vt, userId) {
  const uid = userId.toString();
  return (vt.buyer.toString() === uid) || (vt.seller.toString() === uid);
}

// Strip clientSecret from response unless it belongs to the requesting user
function sanitizeForParty(vt, userId) {
  const obj = vt.toObject ? vt.toObject() : { ...vt };
  const uid = userId.toString();
  const isBuyer = (vt.buyer?._id?.toString() || vt.buyer?.toString()) === uid;
  const isSeller = (vt.seller?._id?.toString() || vt.seller?.toString()) === uid;

  // clientSecret is only needed by the party that must take action
  if (!isBuyer) delete obj.deposit?.clientSecret;
  if (!isSeller) delete obj.sellerFee?.clientSecret;

  // Hide the other party's contact until partiesIntroducedAt is set
  if (!vt.partiesIntroducedAt) {
    if (!isBuyer && obj.buyer?.email) obj.buyer.email = null;
    if (!isSeller && obj.seller?.email) obj.seller.email = null;
  }

  return obj;
}

// ── GET /vehicle-transactions (list for current user) ─────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const uid = req.customer._id;
    const vts = await VehicleTransaction.find({ $or: [{ buyer: uid }, { seller: uid }] })
      .sort({ createdAt: -1 })
      .populate('listing', 'title slug images currentPrice')
      .lean();

    const result = vts.map(vt => {
      const isBuyer = (vt.buyer?._id?.toString() || vt.buyer?.toString()) === uid.toString();
      return {
        _id: vt._id,
        listing: vt.listing,
        agreedPrice: vt.agreedPrice,
        status: vt.status,
        role: isBuyer ? 'buyer' : 'seller',
        setupDeadline: vt.setupDeadline,
        transactionDeadline: vt.transactionDeadline,
        createdAt: vt.createdAt,
      };
    });

    return res.json({ vehicleTransactions: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /vehicle-transactions/:id ─────────────────────────────────────────────

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const vt = await VehicleTransaction.findById(req.params.id)
      .populate('buyer',   'firstName lastName email')
      .populate('seller',  'firstName lastName email')
      .populate('listing', 'title slug category images currentPrice');

    if (!vt) return res.status(404).json({ error: 'Not found' });
    if (!isParty(vt, req.customer._id)) return res.status(403).json({ error: 'Forbidden' });

    const obj = sanitizeForParty(vt, req.customer._id);
    const uid = req.customer._id.toString();
    obj.role = (vt.buyer?._id?.toString() || vt.buyer?.toString()) === uid ? 'buyer' : 'seller';
    return res.json(obj);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /vehicle-transactions/:id/authorize-deposit ─────────────────────────

router.post('/:id/authorize-deposit', requireAuth, async (req, res) => {
  try {
    const vt = await VehicleTransaction.findById(req.params.id).lean();
    if (!vt) return res.status(404).json({ error: 'Not found' });

    const uid = req.customer._id.toString();
    if ((vt.buyer._id || vt.buyer).toString() !== uid) {
      return res.status(403).json({ error: 'Only the buyer can authorize the deposit' });
    }
    if (vt.status !== 'awaiting_setup') {
      return res.status(409).json({ error: `Cannot authorize deposit in status: ${vt.status}` });
    }
    if (vt.deposit.status === 'authorized') {
      return res.json({ status: 'authorized' });
    }

    const result = await attemptBuyerDeposit(req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /vehicle-transactions/:id/confirm-deposit ────────────────────────────

router.post('/:id/confirm-deposit', requireAuth, async (req, res) => {
  try {
    const vt = await VehicleTransaction.findById(req.params.id).lean();
    if (!vt) return res.status(404).json({ error: 'Not found' });

    const uid = req.customer._id.toString();
    if ((vt.buyer._id || vt.buyer).toString() !== uid) {
      return res.status(403).json({ error: 'Only the buyer can confirm the deposit' });
    }

    await confirmBuyerDeposit(req.params.id);
    return res.json({ status: 'authorized' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ── POST /vehicle-transactions/:id/pay-fee ────────────────────────────────────

router.post('/:id/pay-fee', requireAuth, async (req, res) => {
  try {
    const vt = await VehicleTransaction.findById(req.params.id).lean();
    if (!vt) return res.status(404).json({ error: 'Not found' });

    const uid = req.customer._id.toString();
    if ((vt.seller._id || vt.seller).toString() !== uid) {
      return res.status(403).json({ error: 'Only the seller can pay the success fee' });
    }
    if (vt.status !== 'awaiting_setup') {
      return res.status(409).json({ error: `Cannot pay fee in status: ${vt.status}` });
    }
    if (vt.sellerFee.status === 'paid') {
      return res.json({ status: 'paid' });
    }

    const result = await attemptSellerFee(req.params.id);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /vehicle-transactions/:id/confirm-fee ────────────────────────────────

router.post('/:id/confirm-fee', requireAuth, async (req, res) => {
  try {
    const vt = await VehicleTransaction.findById(req.params.id).lean();
    if (!vt) return res.status(404).json({ error: 'Not found' });

    const uid = req.customer._id.toString();
    if ((vt.seller._id || vt.seller).toString() !== uid) {
      return res.status(403).json({ error: 'Only the seller can confirm the fee' });
    }

    await confirmSellerFee(req.params.id);
    return res.json({ status: 'paid' });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ── POST /vehicle-transactions/:id/confirm-completion ────────────────────────

router.post('/:id/confirm-completion', requireAuth, async (req, res) => {
  try {
    const vt = await VehicleTransaction.findById(req.params.id).lean();
    if (!vt) return res.status(404).json({ error: 'Not found' });
    if (!isParty(vt, req.customer._id)) return res.status(403).json({ error: 'Forbidden' });

    await confirmCompletion(req.params.id, req.customer._id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ── POST /vehicle-transactions/:id/registration-proof ─────────────────────────

router.post('/:id/registration-proof', requireAuth, async (req, res) => {
  try {
    const { proofUrl } = req.body;
    if (!proofUrl || typeof proofUrl !== 'string') {
      return res.status(400).json({ error: 'proofUrl is required' });
    }

    const vt = await VehicleTransaction.findById(req.params.id).lean();
    if (!vt) return res.status(404).json({ error: 'Not found' });

    const uid = req.customer._id.toString();
    if ((vt.buyer._id || vt.buyer).toString() !== uid) {
      return res.status(403).json({ error: 'Only the buyer can upload registration proof' });
    }

    await uploadRegistrationProof(req.params.id, proofUrl);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

module.exports = router;
