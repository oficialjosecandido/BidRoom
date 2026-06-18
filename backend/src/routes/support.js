const express = require('express');
const router = express.Router();
const SupportConversation = require('../models/SupportConversation');
const SupportMessage = require('../models/SupportMessage');
const Customer = require('../models/Customer');
const { authenticateToken, requireActiveAccount } = require('../middleware/auth');
const { requireAdmin, isAdminEmail } = require('../utils/roles');
const { createNotification, emitNewNotificationToUser } = require('../services/notificationService');

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const VALID_CATEGORIES = ['payment', 'shipping', 'dispute', 'account', 'listing', 'other'];
const VALID_STATUSES   = ['open', 'pending_customer', 'pending_agent', 'resolved', 'closed'];

function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

async function resolveDisplayName(uid) {
  if (!uid) return '';
  const c = await Customer.findOne({ uid }, 'firstName lastName').lean();
  return c ? `${c.firstName || ''} ${c.lastName || ''}`.trim() : '';
}

async function createMessageAndEmit(conversation, senderType, senderUid, rawBody, io) {
  const body = sanitizeText(rawBody).slice(0, 5000);
  if (!body) {
    const err = new Error('Message body is empty');
    err.status = 400;
    throw err;
  }

  const senderName = senderType !== 'system' ? await resolveDisplayName(senderUid) : 'BidRoom';

  const message = await SupportMessage.create({
    conversation: conversation._id,
    senderType,
    senderUid: senderUid || null,
    senderName,
    body,
  });

  const isFromCustomer = senderType === 'customer';
  await SupportConversation.findByIdAndUpdate(conversation._id, {
    $set: {
      lastMessageAt: new Date(),
      lastMessageBy: senderType,
      status: isFromCustomer ? 'pending_agent' : 'pending_customer',
    },
    $inc: isFromCustomer ? { unreadByAgent: 1 } : { unreadByCustomer: 1 },
  });

  if (io) {
    const payload = { conversationId: conversation._id.toString(), message };
    io.to(`user:${conversation.customerUid}`).emit('support:new-message', payload);
    io.to('support:agents').emit('support:new-message', payload);
  }

  if (senderType === 'agent' && io) {
    try {
      const customer = await Customer.findById(conversation.customer, '_id').lean();
      if (customer) {
        await createNotification({
          userId: customer._id,
          title: 'Resposta da equipa BidRoom',
          message: body.slice(0, 80),
          type: 'system',
          link: '/support',
        });
        await emitNewNotificationToUser(io, customer._id);
      }
    } catch {
      // notification failure is non-fatal
    }
  }

  return message;
}

// ─── Customer-facing routes ───────────────────────────────────────────────────

// POST /conversations — open or reuse an existing active conversation
router.post('/conversations', authenticateToken, requireActiveAccount, async (req, res) => {
  try {
    const io = req.app.get('io');
    const uid = req.user.uid;

    const customer = await Customer.findOne({ uid }, '_id').lean();
    if (!customer) return res.status(404).json({ error: 'Account not found' });

    // Reuse the most recent non-closed conversation rather than creating duplicates
    let conversation = await SupportConversation.findOne({
      customerUid: uid,
      status: { $in: ['open', 'pending_agent', 'pending_customer'] },
    }).sort({ lastMessageAt: -1 });

    if (!conversation) {
      const subject  = sanitizeText(req.body.subject || '').slice(0, 200);
      const category = VALID_CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
      conversation = await SupportConversation.create({
        customer: customer._id,
        customerUid: uid,
        subject,
        category,
        relatedTransaction: OBJECT_ID_RE.test(req.body.relatedTransaction || '') ? req.body.relatedTransaction : null,
        relatedListing:     OBJECT_ID_RE.test(req.body.relatedListing     || '') ? req.body.relatedListing     : null,
      });
    }

    if (req.body.initialMessage) {
      await createMessageAndEmit(conversation, 'customer', uid, req.body.initialMessage, io);
    }

    res.json({ conversation });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to open conversation' });
  }
});

// GET /conversations/mine — customer's own conversations
router.get('/conversations/mine', authenticateToken, async (req, res) => {
  try {
    const conversations = await SupportConversation.find({ customerUid: req.user.uid })
      .sort({ lastMessageAt: -1 })
      .lean();
    res.json({ conversations });
  } catch {
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// GET /conversations/:id/messages — message history (owner or admin)
router.get('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

    const conversation = await SupportConversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Not found' });

    const isAgent = isAdminEmail(req.user.email);
    if (conversation.customerUid !== req.user.uid && !isAgent) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const messages = await SupportMessage.find({ conversation: req.params.id })
      .sort({ createdAt: 1 })
      .lean();

    // Reset unread counter for the reading party
    const field = isAgent ? 'unreadByAgent' : 'unreadByCustomer';
    await SupportConversation.findByIdAndUpdate(req.params.id, { $set: { [field]: 0 } });

    res.json({ messages });
  } catch {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// POST /conversations/:id/messages — send a message
router.post('/conversations/:id/messages', authenticateToken, async (req, res) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

    const conversation = await SupportConversation.findById(req.params.id);
    if (!conversation) return res.status(404).json({ error: 'Not found' });
    if (conversation.status === 'closed') {
      return res.status(409).json({ error: 'Conversation is closed' });
    }

    const isAgent = isAdminEmail(req.user.email);
    if (conversation.customerUid !== req.user.uid && !isAgent) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const io = req.app.get('io');
    const message = await createMessageAndEmit(
      conversation,
      isAgent ? 'agent' : 'customer',
      req.user.uid,
      req.body.body,
      io
    );

    res.json({ message });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Failed to send message' });
  }
});

// ─── Admin/Nexus routes ───────────────────────────────────────────────────────

// GET /admin/conversations — support queue for Nexus
router.get('/admin/conversations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 30));
    const filter = {};
    if (req.query.status        && VALID_STATUSES.includes(req.query.status))     filter.status = req.query.status;
    if (req.query.category      && VALID_CATEGORIES.includes(req.query.category)) filter.category = req.query.category;
    if (req.query.assignedAgent) filter.assignedAgent = req.query.assignedAgent;

    const [conversations, total] = await Promise.all([
      SupportConversation.find(filter)
        .populate('customer', 'firstName lastName email reputationScore accountStatus')
        .sort({ lastMessageAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      SupportConversation.countDocuments(filter),
    ]);

    res.json({ conversations, total, page, pages: Math.ceil(total / limit) });
  } catch {
    res.status(500).json({ error: 'Failed to load conversations' });
  }
});

// PATCH /admin/conversations/:id — update status, agent, or category
router.patch('/admin/conversations/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!OBJECT_ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid ID' });

    const update = {};
    if (req.body.status        !== undefined && VALID_STATUSES.includes(req.body.status))     update.status = req.body.status;
    if (req.body.category      !== undefined && VALID_CATEGORIES.includes(req.body.category)) update.category = req.body.category;
    if (req.body.assignedAgent !== undefined) update.assignedAgent = req.body.assignedAgent || null;
    if (update.status === 'resolved') update.resolvedAt = new Date();
    if (update.status === 'closed')   update.closedAt   = new Date();

    const conversation = await SupportConversation.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    ).populate('customer', 'firstName lastName email reputationScore accountStatus');

    if (!conversation) return res.status(404).json({ error: 'Not found' });

    const io = req.app.get('io');
    if (io) {
      io.to(`user:${conversation.customerUid}`).emit('support:conversation-updated', {
        conversationId: conversation._id.toString(),
        status: conversation.status,
      });
    }

    res.json({ conversation });
  } catch {
    res.status(500).json({ error: 'Failed to update conversation' });
  }
});

module.exports = router;
