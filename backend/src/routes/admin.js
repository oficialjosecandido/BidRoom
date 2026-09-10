const express = require('express');
const mongoose = require('mongoose');
const { authenticateToken } = require('../middleware/auth');
const Customer = require('../models/Customer');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const ReviewFlag = require('../models/ReviewFlag');
const Review = require('../models/Review');
const ReviewAppeal = require('../models/ReviewAppeal');
const Report = require('../models/Report');
const ModerationAuditLog = require('../models/ModerationAuditLog');
const Bid = require('../models/Bid');
const { sendEmail } = require('../services/emailService');
const { renderEmailTemplate } = require('../services/templateEngine');
const { notifyDisputeDecisionIssued, notifyDamageClaimResolved, notifyContentRestrictionLifted, emitNewNotificationToUser } = require('../services/notificationService');
const DamageClaim = require('../models/DamageClaim');
const { applyDisputeAccountOutcome } = require('../services/accountStatusService');
const { applyDisputeVerdictImpact } = require('../services/reputationService');
const { appendModerationAudit } = require('../services/moderationAuditService');
const { runImagePurge } = require('../services/imagePurgeScheduler');
const { getBlocklistItems, addBlocklistItem, removeBlocklistItem, ensureBlocklistExists } = require('../services/contentSafetyService');
const azureStorageService = require('../services/azureStorage.service');
const { requireAdmin, ADMIN_EMAILS } = require('../utils/roles');
const {
  createListingAsAdmin,
  parseCsv,
  mapCsvRowToCreateInput
} = require('../services/adminListingService');
const multer = require('multer');
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (file.mimetype === 'text/csv' || file.mimetype === 'application/vnd.ms-excel' || name.endsWith('.csv')) {
      return cb(null, true);
    }
    cb(new Error('Only CSV files are allowed'));
  }
});

const { getStripe } = require('../utils/stripe.util');
const logger = require('../utils/logger');

function computeBuyerTrustTier(buyer) {
  if (!buyer) return 1;
  if (buyer.kycStatus === 'approved' && buyer.savedPaymentMethodId) return 3;
  if (buyer.kycStatus === 'approved') return 2;
  if (buyer.emailVerified) return 1;
  return 0;
}

const router = express.Router();

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function utcStartOfCalendarDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function utcEndOfCalendarDay(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function utcEndOfMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));
}

/** Monday 00:00 UTC of the ISO week containing `d` */
function utcMondayOfWeekContaining(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  t.setUTCDate(t.getUTCDate() + delta);
  t.setUTCHours(0, 0, 0, 0);
  return t;
}

const SNAPSHOT_COMPARISON_MODES = new Set([
  'today_vs_yesterday',
  'week_vs_week',
  'month_vs_month',
  'year_vs_year'
]);

/**
 * @returns {{ comparison: string, current: {label,from,to}, previous: {label,from,to} } | null}
 */
function resolveSnapshotComparisonWindows(mode, now) {
  if (mode === 'today_vs_yesterday') {
    const todayStart = utcStartOfCalendarDay(now);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    const yesterdayEnd = utcEndOfCalendarDay(yesterdayStart);
    return {
      comparison: mode,
      current: { label: 'Today (UTC → now)', from: todayStart, to: now },
      previous: { label: 'Yesterday (UTC, full day)', from: yesterdayStart, to: yesterdayEnd }
    };
  }

  if (mode === 'week_vs_week') {
    const thisMonday = utcMondayOfWeekContaining(now);
    const prevMonday = new Date(thisMonday);
    prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
    const prevSundayEnd = new Date(thisMonday);
    prevSundayEnd.setUTCMilliseconds(-1);
    return {
      comparison: mode,
      current: { label: 'This week (UTC → now)', from: thisMonday, to: now },
      previous: {
        label: 'Last week (UTC, full)',
        from: prevMonday,
        to: prevSundayEnd
      }
    };
  }

  if (mode === 'month_vs_month') {
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth();
    const curFrom = new Date(Date.UTC(y, mo, 1));
    const prevMonth = mo === 0 ? 11 : mo - 1;
    const prevYear = mo === 0 ? y - 1 : y;
    const prevFrom = new Date(Date.UTC(prevYear, prevMonth, 1));
    const prevTo = utcEndOfMonth(prevYear, prevMonth);
    return {
      comparison: mode,
      current: { label: 'This month (UTC → now)', from: curFrom, to: now },
      previous: {
        label: 'Last month (UTC, full)',
        from: prevFrom,
        to: prevTo
      }
    };
  }

  if (mode === 'year_vs_year') {
    const y = now.getUTCFullYear();
    const curFrom = new Date(Date.UTC(y, 0, 1));
    const prevFrom = new Date(Date.UTC(y - 1, 0, 1));
    const prevTo = utcEndOfMonth(y - 1, 11);
    return {
      comparison: mode,
      current: { label: `${y} year to date (UTC → now)`, from: curFrom, to: now },
      previous: {
        label: `${y - 1} full year (UTC)`,
        from: prevFrom,
        to: prevTo
      }
    };
  }

  return null;
}

async function snapshotMetricsForWindow(from, to) {
  const timeRange = { $gte: from, $lte: to };
  const paidMatch = {
    paymentStatus: 'paid',
    paidAt: { ...timeRange, $exists: true, $ne: null }
  };

  const [activeAccounts, newRegistrations, bids, txnAggRows] = await Promise.all([
    Customer.countDocuments({ isActive: true, createdAt: { $lte: to } }),
    Customer.countDocuments({ createdAt: timeRange }),
    Bid.countDocuments({ createdAt: timeRange }),
    Transaction.aggregate([
      { $match: paidMatch },
      {
        $group: {
          _id: null,
          paidTransactions: { $sum: 1 },
          transactionAmountTotal: { $sum: { $ifNull: ['$amount', 0] } },
          bidRoomFeesTotal: { $sum: { $ifNull: ['$bidRoomFeeAmount', 0] } }
        }
      }
    ])
  ]);

  const row = txnAggRows[0] || {};
  return {
    activeAccounts,
    newRegistrations,
    bids,
    paidTransactions: Math.round(Number(row.paidTransactions) || 0),
    transactionAmountTotal:
      Math.round((Number(row.transactionAmountTotal) || 0) * 100) / 100,
    bidRoomFeesTotal: Math.round((Number(row.bidRoomFeesTotal) || 0) * 100) / 100
  };
}

// Get platform statistics
router.get('/statistics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const now = new Date();

    const [
      totalUsers,
      listingsByStatusRows,
      liveActiveAuctions,
      totalAuctionsListed,
      openDisputes,
      totalTransactions,
      listingSegmentAgg
    ] = await Promise.all([
      Customer.countDocuments({ isActive: true }),
      Listing.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Listing.countDocuments({
        status: 'active',
        endDate: { $gt: now }
      }),
      Listing.countDocuments({
        status: { $in: ['active', 'ended', 'cancelled'] }
      }),
      Transaction.countDocuments({ disputeOpen: true }),
      Transaction.countDocuments({}),
      Listing.aggregate([
        {
          $project: {
            segment: {
              $switch: {
                branches: [
                  {
                    case: { $eq: [{ $ifNull: ['$auctionFormat', 'highest-bid'] }, 'best-offer'] },
                    then: 'bestOffer'
                  },
                  {
                    case: {
                      $and: [
                        { $eq: [{ $ifNull: ['$auctionFormat', 'highest-bid'] }, 'highest-bid'] },
                        { $eq: ['$allowPrivateRoom', true] }
                      ]
                    },
                    then: 'highestBidPrivateRoom'
                  }
                ],
                default: 'highestBid'
              }
            }
          }
        },
        { $group: { _id: '$segment', n: { $sum: 1 } } }
      ])
    ]);

    const listingsByStatus = {};
    for (const row of listingsByStatusRows) {
      if (row._id != null) {
        listingsByStatus[row._id] = row.n;
      }
    }

    const totalAuctionsDraftsIncluded = listingsByStatusRows.reduce((sum, row) => sum + (row.n || 0), 0);

    const listingsByAuctionSegment = {
      bestOffer: 0,
      highestBid: 0,
      highestBidPrivateRoom: 0
    };
    for (const row of listingSegmentAgg) {
      const k = row._id;
      if (k === 'bestOffer' || k === 'highestBid' || k === 'highestBidPrivateRoom') {
        listingsByAuctionSegment[k] = row.n || 0;
      }
    }

    res.json({
      totalUsers,
      /** Published listings (excluding draft): matches legacy "totalAuctions" meaning */
      totalAuctions: totalAuctionsListed,
      /** Listings currently in `active` with endDate in the future */
      activeAuctions: liveActiveAuctions,
      /** All listing documents by status label */
      listingsByStatus,
      /** Inventory by auction format (all statuses; sums to totalListingsAllStatuses) */
      listingsByAuctionSegment,
      totalListingsAllStatuses: totalAuctionsDraftsIncluded,
      openDisputes,
      totalTransactions
    });
  } catch (error) {
    logger.error('Error fetching admin statistics:', error);
    res.status(500).json({ 
      error: 'Failed to fetch statistics',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

/**
 * GET /admin/platform-snapshot-comparison
 * Compare current vs previous period (UTC).
 * Query: comparison=today_vs_yesterday | week_vs_week | month_vs_month | year_vs_year (default today_vs_yesterday)
 */
router.get('/platform-snapshot-comparison', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const raw = String(req.query.comparison || 'today_vs_yesterday').toLowerCase();
    if (!SNAPSHOT_COMPARISON_MODES.has(raw)) {
      return res.status(400).json({
        error: 'Invalid comparison',
        message: `Use one of: ${[...SNAPSHOT_COMPARISON_MODES].join(', ')}`
      });
    }

    const bounds = resolveSnapshotComparisonWindows(raw, new Date());
    if (!bounds) {
      return res.status(400).json({ error: 'Invalid comparison' });
    }

    const [current, previous] = await Promise.all([
      snapshotMetricsForWindow(bounds.current.from, bounds.current.to),
      snapshotMetricsForWindow(bounds.previous.from, bounds.previous.to)
    ]);

    function packSide(boundsSide, metrics) {
      return {
        label: boundsSide.label,
        from: boundsSide.from.toISOString(),
        to: boundsSide.to.toISOString(),
        ...metrics
      };
    }

    res.json({
      comparison: raw,
      current: packSide(bounds.current, current),
      previous: packSide(bounds.previous, previous),
      currency: 'EUR'
    });
  } catch (error) {
    logger.error('Error fetching platform snapshot comparison:', error);
    res.status(500).json({
      error: 'Failed to fetch platform snapshot comparison',
      message: error.message
    });
  }
});

// Get all auctions for admin
router.get('/auctions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const filter = {};
    const cat = req.query.category && String(req.query.category).trim();
    const stat = req.query.status && String(req.query.status).trim();
    const q = req.query.q && String(req.query.q).trim();
    const allowedCat = ['electronics', 'home-garden', 'art', 'collectibles', 'jewelry', 'real-estate', 'vehicles'];
    if (cat && cat !== 'all' && allowedCat.includes(cat)) {
      filter.category = cat;
    }
    if (stat && stat !== 'all') {
      const allowedStat = ['active', 'ended', 'cancelled', 'draft'];
      if (allowedStat.includes(stat)) {
        filter.status = stat;
      }
    }
    if (q) {
      const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      const sellerMatches = await Customer.find(
        {
          $or: [
            { firstName: regex },
            { lastName: regex },
            { email: regex }
          ]
        },
        '_id'
      ).limit(50).lean();
      const sellerIds = sellerMatches.map(s => s._id);
      filter.$or = [
        { title: regex },
        { titlePt: regex },
        { titleEn: regex },
        { titleFr: regex },
        { titleEs: regex },
        { slug: regex },
        { 'attributes.brand': regex },
        { 'attributes.referenceNo': regex },
        { 'attributes.year': regex },
        ...(sellerIds.length ? [{ seller: { $in: sellerIds } }] : [])
      ];
    }

    const [auctions, total] = await Promise.all([
      Listing.find(filter)
        .populate('seller', 'firstName lastName email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Listing.countDocuments(filter)
    ]);

    res.json({
      auctions,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (error) {
    logger.error('Error fetching auctions:', error);
    res.status(500).json({
      error: 'Failed to fetch auctions',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// POST /api/admin/auctions — create listing on behalf of a seller
router.post('/auctions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { listing, seller } = await createListingAsAdmin(req.body || {});
    const adminUser =
      (req.user?.uid && await Customer.findOne({ uid: req.user.uid }).select('_id').lean()) ||
      (req.user?.email && await Customer.findOne({ email: String(req.user.email).toLowerCase() }).select('_id').lean());
    await appendModerationAudit({
      subjectUserId: seller._id,
      actionType: 'admin_listing_created',
      performedByUserId: adminUser?._id || null,
      performedByEmail: req.user?.email || null,
      metadata: {
        listingId: listing._id,
        title: listing.title,
        auctionFormat: listing.auctionFormat
      }
    });
    return res.status(201).json({
      ok: true,
      listing: {
        _id: listing._id,
        title: listing.title,
        slug: listing.slug,
        status: listing.status,
        endDate: listing.endDate,
        seller: { _id: seller._id, email: seller.email, firstName: seller.firstName, lastName: seller.lastName }
      }
    });
  } catch (error) {
    logger.error('Error creating admin auction:', error);
    const status = error.status || (error.name === 'ValidationError' ? 400 : 500);
    return res.status(status).json({
      error: 'Failed to create auction',
      message: error.message || 'Internal server error'
    });
  }
});

// POST /api/admin/auctions/import — bulk create from CSV
router.post('/auctions/import', authenticateToken, requireAdmin, (req, res) => {
  csvUpload.single('file')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        error: 'Invalid CSV upload',
        message: err.message || 'Failed to read CSV file'
      });
    }
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({
          error: 'Missing file',
          message: 'Upload a CSV file in the "file" field.'
        });
      }

      const text = req.file.buffer.toString('utf8');
      const rows = parseCsv(text);
      if (!rows.length) {
        return res.status(400).json({
          error: 'Empty CSV',
          message: 'CSV must include a header row and at least one data row.'
        });
      }

      const results = [];
      let created = 0;
      let failed = 0;

      for (let i = 0; i < rows.length; i += 1) {
        const rowNumber = i + 2; // header is row 1
        const payload = mapCsvRowToCreateInput(rows[i]);
        try {
          const { listing, seller } = await createListingAsAdmin(payload);
          created += 1;
          results.push({
            row: rowNumber,
            ok: true,
            title: listing.title,
            listingId: listing._id,
            slug: listing.slug,
            sellerEmail: seller.email
          });
        } catch (rowErr) {
          failed += 1;
          results.push({
            row: rowNumber,
            ok: false,
            title: payload.title || null,
            error: rowErr.message || 'Failed to create listing'
          });
        }
      }

      if (req.user?.uid || req.user?.email) {
        const adminUser =
          (req.user.uid && await Customer.findOne({ uid: req.user.uid }).select('_id').lean()) ||
          (req.user.email && await Customer.findOne({ email: String(req.user.email).toLowerCase() }).select('_id').lean());
        if (adminUser?._id) {
          await appendModerationAudit({
            subjectUserId: adminUser._id,
            actionType: 'admin_listings_csv_import',
            performedByUserId: adminUser._id,
            performedByEmail: req.user?.email || null,
            metadata: { created, failed, totalRows: rows.length }
          });
        }
      }

      return res.json({ ok: failed === 0, created, failed, total: rows.length, results });
    } catch (error) {
      logger.error('Error importing auctions CSV:', error);
      return res.status(500).json({
        error: 'Failed to import CSV',
        message: error.message || 'Internal server error'
      });
    }
  });
});

// Get single auction by ID for admin
router.get('/auctions/:id', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
  try {
    const auction = await Listing.findById(req.params.id)
      .populate('seller', 'firstName lastName email')
      .populate('platinumBidders', 'firstName lastName email')
      .lean();

    if (!auction) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    res.json(auction);
  } catch (error) {
    logger.error('Error fetching auction:', error);
    res.status(500).json({ 
      error: 'Failed to fetch auction',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

// Update listing category (admin) — sellers no longer pick category on create
router.patch('/auctions/:id/category', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
  try {
    const ALLOWED = ['electronics', 'home-garden', 'art', 'collectibles', 'jewelry', 'real-estate', 'vehicles'];
    const category = req.body?.category ? String(req.body.category).trim().toLowerCase().replace(/\s+/g, '-') : '';
    const subCategory = req.body?.subCategory ? String(req.body.subCategory).trim() : '';
    if (!category || !ALLOWED.includes(category)) {
      return res.status(400).json({ error: 'Invalid category', allowed: ALLOWED });
    }
    if (!subCategory) {
      return res.status(400).json({ error: 'Sub-category is required' });
    }

    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    listing.category = category;
    listing.subCategory = subCategory;
    await listing.save();

    await appendModerationAudit({
      action: 'admin_listing_category_updated',
      subjectUserId: listing.seller,
      targetType: 'listing',
      targetId: listing._id,
      details: { category, subCategory }
    });

    return res.json({
      ok: true,
      category: listing.category,
      subCategory: listing.subCategory
    });
  } catch (error) {
    logger.error('Error updating listing category:', error);
    res.status(500).json({
      error: 'Failed to update category',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Update listing end date (admin) — extend or shorten an auction
router.patch('/auctions/:id/end-date', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
  try {
    const { endDate } = req.body;
    const parsed = new Date(endDate);
    if (!endDate || isNaN(parsed.getTime())) {
      return res.status(400).json({ error: 'A valid end date is required' });
    }

    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const oldEnd = listing.endDate;
    listing.endDate = parsed;

    // If the listing had already ended but is being extended into the future, reactivate it.
    if (listing.status === 'ended' && parsed > new Date()) {
      listing.status = 'active';
    }

    await listing.save();

    await appendModerationAudit({
      action: 'admin_listing_end_date_updated',
      subjectUserId: listing.seller,
      targetType: 'listing',
      targetId: listing._id,
      details: { oldEndDate: oldEnd, newEndDate: parsed }
    });

    return res.json({ ok: true, endDate: listing.endDate });
  } catch (error) {
    logger.error('Error updating listing end date:', error);
    res.status(500).json({
      error: 'Failed to update end date',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Hard-delete a listing (admin only)
router.delete('/auctions/:id', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
  try {
    const listing = await Listing.findById(req.params.id).populate('seller', '_id firstName lastName email').lean();
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Block deletion if there is an active or paid transaction to avoid data integrity issues
    const activeTransaction = await Transaction.findOne({
      listing: listing._id,
      transactionStatus: { $in: ['awaiting_payment', 'paid', 'shipped', 'delivered'] }
    }).lean();
    if (activeTransaction) {
      return res.status(409).json({
        error: 'Cannot delete',
        message: 'This listing has an active transaction. Resolve or cancel the transaction first.'
      });
    }

    // Delete in parallel: bids + images (best effort) + listing document
    await Promise.all([
      Bid.deleteMany({ listing: listing._id }),
      azureStorageService.deleteMultipleImages(Array.isArray(listing.images) ? listing.images : []).catch(() => {}),
      Listing.findByIdAndDelete(listing._id)
    ]);

    await appendModerationAudit({
      action: 'admin_listing_deleted',
      subjectUserId: listing.seller?._id ?? listing.seller,
      targetType: 'listing',
      targetId: listing._id,
      details: { title: listing.title, status: listing.status }
    });

    return res.json({ ok: true, deletedId: listing._id });
  } catch (error) {
    logger.error('Error deleting listing:', error);
    res.status(500).json({
      error: 'Failed to delete listing',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Create private auction room for a listing
router.post('/auctions/:id/private-room', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
  try {
    const listingId = req.params.id;
    const { platinumBidderIds } = req.body;

    if (!platinumBidderIds || !Array.isArray(platinumBidderIds) || platinumBidderIds.length === 0) {
      return res.status(400).json({ 
        error: 'Invalid input',
        message: 'Please select at least one Platinum Bidder' 
      });
    }

    if (platinumBidderIds.length > 5) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'You can select a maximum of 5 Platinum Bidders'
      });
    }

    if (!platinumBidderIds.every(id => isValidObjectId(id))) {
      return res.status(400).json({ error: 'Invalid input', message: 'One or more bidder IDs are invalid' });
    }

    const listing = await Listing.findById(listingId).populate('seller', 'firstName lastName email');
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Check if private room already exists
    if (listing.privateRoomStatus === 'active') {
      return res.status(400).json({ 
        error: 'Private room already active',
        message: 'This listing already has an active private auction room' 
      });
    }

    // Validate that all selected bidders are valid users
    const validBidders = await Customer.find({ 
      _id: { $in: platinumBidderIds } 
    }).select('_id firstName lastName email emailVerified');
    
    if (validBidders.length !== platinumBidderIds.length) {
      return res.status(400).json({ 
        error: 'Invalid bidders',
        message: 'One or more selected bidders are invalid' 
      });
    }

    // Set platinum bidders (no acceptance required - room is active immediately)
    listing.platinumBidders = platinumBidderIds;
    listing.platinumBidderInvitedAt = new Date();

    const now = new Date();
    const privateRoomEndDate = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours from now

    listing.privateRoomStatus = 'active';
    listing.privateRoomEndDate = privateRoomEndDate;
    listing.privateRoomLastBidTime = null;
    
    // Only update endDate if auction hasn't ended yet
    if (listing.status === 'active' && listing.endDate > now) {
      // Auction still active - extend it
      listing.endDate = privateRoomEndDate;
    }
    
    // If auction was ended/cancelled, reactivate it for the private room
    if (listing.status === 'ended' || listing.status === 'cancelled') {
      listing.status = 'active';
    }

    await listing.save();

    // Send notification emails to all platinum bidders (no accept/decline - they can join immediately)
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200';
    const listingUrl = `${frontendUrl}/listing/${listing.slug}`;

    for (const bidder of validBidders) {
      try {
        const emailData = {
          bidderName: `${bidder.firstName} ${bidder.lastName}`,
          listingTitle: listing.title,
          listingUrl,
          currentPrice: listing.currentPrice,
          endDate: privateRoomEndDate.toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          })
        };

        let emailContent;
        try {
          emailContent = renderEmailTemplate('platinumBidderInvitation', 'en', emailData);
        } catch (templateError) {
          emailContent = {
            subject: `🎯 You're in the Private Auction Room: ${listing.title}`,
            html: `
              <h2>Private Auction Room</h2>
              <p>Hello ${bidder.firstName},</p>
              <p>You have been selected as a Platinum Bidder for the private auction room of:</p>
              <h3>${listing.title}</h3>
              <p><strong>Current Price:</strong> $${listing.currentPrice.toFixed(2)}</p>
              <p><strong>Private Room Ends:</strong> ${emailData.endDate}</p>
              <p>You can place bids now. Each bid extends the deadline by 30 seconds.</p>
              <p><a href="${listingUrl}">Join the Private Room</a></p>
            `
          };
        }

        await sendEmail(bidder.email, emailContent.subject, emailContent.html);
        logger.info(`📧 Notification sent to ${bidder.email}`);
      } catch (emailError) {
        logger.error(`Failed to send notification to ${bidder.email}:`, emailError);
      }
    }

    // Emit socket event if available
    const io = req.app.get('io');
    if (io) {
      io.to(`listing:${listingId}`).emit('listing-update', {
        listingId: listing._id.toString(),
        privateRoomStatus: listing.privateRoomStatus,
        privateRoomEndDate: listing.privateRoomEndDate,
        endDate: listing.endDate
      });
    }

    res.json({
      success: true,
      message: 'Private auction room created and invitations sent successfully',
      listing: {
        id: listing._id,
        privateRoomStatus: listing.privateRoomStatus,
        privateRoomEndDate: listing.privateRoomEndDate,
        endDate: listing.endDate
      },
      invitationsSent: validBidders.length
    });
  } catch (error) {
    logger.error('Error creating private room:', error);
    res.status(500).json({ 
      error: 'Failed to create private room',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

/**
 * GET /api/admin/customers
 * List all users with pagination and optional search by name/email.
 */
router.get('/customers', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip  = (page - 1) * limit;

    const filter = {};
    const q = req.query.q ? String(req.query.q).trim() : '';
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ email: re }, { firstName: re }, { lastName: re }];
    }
    const status = req.query.status ? String(req.query.status).trim() : '';
    if (status && ['active', 'suspended', 'closed'].includes(status)) {
      filter.accountStatus = status;
    }

    const [users, total] = await Promise.all([
      Customer.find(filter)
        .select('firstName lastName email accountStatus emailVerified reputationScore createdAt lastLogin sellerClassification contentViolationCount contentRestrictedUntil')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Customer.countDocuments(filter)
    ]);

    res.json({ customers: users, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    logger.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers', message: error.message });
  }
});

/**
 * POST /api/admin/customers/:id/unlock-content-restriction
 * Lifts an active content-policy (contact info / abusive language / image) restriction early.
 * Does not reset contentViolationCount — repeat future violations still escalate the same ladder.
 */
router.post('/customers/:id/unlock-content-restriction', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const user = await Customer.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const wasRestricted = !!(user.contentRestrictedUntil && user.contentRestrictedUntil > new Date());
    if (!wasRestricted) {
      return res.status(400).json({ error: 'Not currently restricted', message: 'This user does not have an active content restriction.' });
    }

    const previousRestrictedUntil = user.contentRestrictedUntil;
    user.contentRestrictedUntil = null;
    await user.save();

    await appendModerationAudit({
      subjectUserId: user._id,
      actionType: 'content_restriction_unlocked',
      performedByEmail: req.user.email || null,
      metadata: { previousRestrictedUntil, violationCount: user.contentViolationCount }
    });

    await notifyContentRestrictionLifted({ userId: user._id }).catch(err => logger.error('Notify restriction lifted:', err.message));

    res.json({ success: true, message: 'Content restriction lifted.' });
  } catch (error) {
    logger.error('Error unlocking content restriction:', error);
    res.status(500).json({ error: 'Failed to unlock content restriction', message: error.message });
  }
});

/**
 * GET /api/admin/transactions
 * List all transactions with pagination and optional status filter.
 */
router.get('/transactions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
    const skip  = (page - 1) * limit;

    const filter = {};
    const status = req.query.status ? String(req.query.status).trim() : '';
    const allowed = ['pending_payment', 'awaiting_seller_acceptance', 'paid', 'shipped', 'delivered', 'under_dispute', 'completed', 'cancelled'];
    if (status && allowed.includes(status)) {
      filter.transactionStatus = status;
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('seller', 'firstName lastName email')
        .populate('buyer',  'firstName lastName email')
        .populate('listing', 'title images')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(filter)
    ]);

    res.json({ transactions, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    logger.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Failed to fetch transactions', message: error.message });
  }
});

/**
 * GET /api/admin/disputes
 * List all open disputes, sorted by time since opened (oldest first for prioritization).
 */
router.get('/disputes', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const disputes = await Transaction.find({
      disputeOpen: true,
      disputeAdminVerdict: null
    })
      .populate('listing', 'title slug images')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .sort({ disputeOpenedAt: 1 })
      .lean();

    const withAge = disputes.map((d) => {
      const openedAt = d.disputeOpenedAt ? new Date(d.disputeOpenedAt) : null;
      const ageMs = openedAt ? Date.now() - openedAt.getTime() : 0;
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      const ageDays = Math.floor(ageHours / 24);
      return {
        ...d,
        disputeAgeHours: ageHours,
        disputeAgeDays: ageDays
      };
    });

    res.json({ disputes: withAge });
  } catch (error) {
    logger.error('Error fetching disputes:', error);
    res.status(500).json({
      error: 'Failed to fetch disputes',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/admin/disputes/:transactionId
 * Get full dispute details for a transaction.
 */
router.get('/disputes/:transactionId', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.transactionId)) return res.status(400).json({ error: 'Invalid transaction ID' });
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('listing', 'title slug images description')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email kycStatus savedPaymentMethodId stripeCustomerId')
      .lean();

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (!transaction.disputeOpen) {
      return res.status(400).json({ error: 'Not a dispute', message: 'This transaction does not have an open dispute.' });
    }

    res.json({
      ...transaction,
      buyerTrustTier: computeBuyerTrustTier(transaction.buyer),
      buyerHasSavedMethod: !!(transaction.buyer?.savedPaymentMethodId),
    });
  } catch (error) {
    logger.error('Error fetching dispute:', error);
    res.status(500).json({
      error: 'Failed to fetch dispute',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/admin/disputes/:transactionId/ruling
 * Issue final ruling: buyer_refund | seller_payout | partial_refund.
 * Body: { verdict, refundAmount?, adminNotes }
 */
router.post('/disputes/:transactionId/ruling', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { verdict, refundAmount, adminNotes, accountOutcome } = req.body;

    const validVerdicts = ['buyer_refund', 'seller_payout', 'partial_refund'];
    if (!verdict || !validVerdicts.includes(verdict)) {
      return res.status(400).json({
        error: 'Invalid verdict',
        message: 'Verdict must be one of: buyer_refund, seller_payout, partial_refund'
      });
    }

    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('seller', '_id')
      .populate('buyer', '_id');

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    if (!transaction.disputeOpen || transaction.disputeAdminVerdict) {
      return res.status(400).json({
        error: 'Invalid state',
        message: 'No open dispute or dispute has already been ruled on.'
      });
    }

    let resolvedRefundAmount = null;
    if (verdict === 'buyer_refund') {
      resolvedRefundAmount = transaction.amount;
    } else if (verdict === 'partial_refund') {
      const amt = typeof refundAmount === 'number' ? refundAmount : parseFloat(refundAmount);
      if (Number.isNaN(amt) || amt < 0 || amt > transaction.amount) {
        return res.status(400).json({
          error: 'Invalid refund amount',
          message: `Refund amount must be between 0 and ${transaction.amount}`
        });
      }
      resolvedRefundAmount = amt;
    }

    transaction.disputeAdminVerdict = verdict;
    transaction.disputeRefundAmount = resolvedRefundAmount;
    transaction.disputeRuledAt = new Date();
    if (adminNotes != null) transaction.disputeAdminNotes = String(adminNotes).trim() || null;
    transaction.transactionStatus = 'completed';
    transaction.completedAt = transaction.completedAt || new Date();
    transaction.disputeOpen = false;
    // Idempotent: only increment seller's completed-sales counter once per transaction.
    if (!transaction.salesCountIncremented) {
      transaction.salesCountIncremented = true;
      const sellerId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
      if (sellerId) {
        Customer.findByIdAndUpdate(sellerId, { $inc: { completedSalesCount: 1 } })
          .catch(err => logger.error('[Waiver] Failed to increment completedSalesCount:', err.message));
      }
    }
    await transaction.save();

    const listing = await Listing.findById(transaction.listing).select('title').lean();
    const listingTitle = listing?.title || 'the transaction';
    const sellerUserId = transaction.seller?._id?.toString?.() || transaction.seller?.toString?.();
    const buyerUserId = transaction.buyer?._id?.toString?.() || transaction.buyer?.toString?.();
    if (sellerUserId) {
      notifyDisputeDecisionIssued({ transactionId: transaction._id.toString(), listingTitle, verdict, userId: sellerUserId })
        .catch(err => logger.error('Failed to create dispute decision notification:', err));
    }
    if (buyerUserId) {
      notifyDisputeDecisionIssued({ transactionId: transaction._id.toString(), listingTitle, verdict, userId: buyerUserId })
        .catch(err => logger.error('Failed to create dispute decision notification:', err));
    }
    const io = req.app.get('io');
    if (io) {
      if (sellerUserId) emitNewNotificationToUser(io, sellerUserId).catch(() => {});
      if (buyerUserId) emitNewNotificationToUser(io, buyerUserId).catch(() => {});
    }

    // Apply account outcome: reactivate both, reactivate one and close the other, or close both
    const validAccountOutcomes = ['reactivate_both', 'reactivate_buyer_close_seller', 'reactivate_seller_close_buyer', 'close_both'];
    if (accountOutcome && validAccountOutcomes.includes(accountOutcome) && buyerUserId && sellerUserId) {
      await applyDisputeAccountOutcome(accountOutcome, buyerUserId, sellerUserId, transaction._id, io);
    }

    // Reputation impact: increment disputeLossCount for party ruled against
    applyDisputeVerdictImpact(verdict, buyerUserId, sellerUserId).catch(err =>
      logger.error('Dispute verdict reputation impact:', err.message)
    );

    // Issue Stripe refund when verdict favours the buyer
    if (resolvedRefundAmount > 0 && transaction.stripePaymentIntentId) {
      try {
        const stripe = getStripe();
        if (stripe) {
          const refund = await stripe.refunds.create({
            payment_intent: transaction.stripePaymentIntentId,
            amount: Math.round(resolvedRefundAmount * 100), // cents
            reason: 'fraudulent',
            metadata: {
              transactionId: transaction._id.toString(),
              verdict,
              adminNotes: adminNotes || ''
            }
          });
          await Transaction.findByIdAndUpdate(transaction._id, { $set: { stripeRefundId: refund.id } }, { runValidators: false });
          logger.info(`[Admin] Stripe refund issued refundId=${refund.id} amount=${resolvedRefundAmount} transaction=${transaction._id}`);
        }
      } catch (refundErr) {
        // Log but don't fail the ruling — admin can retry the Stripe refund manually
        logger.error(`[Admin] Stripe refund failed transaction=${transaction._id}:`, refundErr.message);
      }
    }

    // Issue Stripe charge to buyer when verdict favours the seller (Tier 3 buyers only)
    if (verdict === 'seller_payout' || verdict === 'partial_refund') {
      const chargeAmount = verdict === 'seller_payout'
        ? transaction.amount
        : transaction.amount - (resolvedRefundAmount ?? 0);

      if (chargeAmount > 0) {
        try {
          const stripe = getStripe();
          if (stripe) {
            const buyerUser = await Customer.findById(buyerUserId).select(
              'stripeCustomerId savedPaymentMethodId savedPaymentMethodLast4 email firstName'
            );
            if (buyerUser?.savedPaymentMethodId && buyerUser?.stripeCustomerId) {
              const chargeIntent = await stripe.paymentIntents.create({
                amount: Math.round(chargeAmount * 100),
                currency: 'eur',
                customer: buyerUser.stripeCustomerId,
                payment_method: buyerUser.savedPaymentMethodId,
                off_session: true,
                confirm: true,
                description: `BidRoom dispute compensation — transaction ${transaction._id}`,
                metadata: { transactionId: transaction._id.toString(), disputeVerdict: verdict, sellerUserId, buyerUserId },
              });
              await Transaction.findByIdAndUpdate(transaction._id, { $set: { disputeCompensationChargeId: chargeIntent.id } }, { runValidators: false });
              logger.info(`[Admin Ruling] ✅ Buyer compensation charge created chargeId=${chargeIntent.id} amount=${chargeAmount} transaction=${transaction._id}`);
            } else {
              logger.warn(`[Admin Ruling] ⚠️ Verdict=${verdict} but buyer has no saved payment method. Manual compensation required. transaction=${transaction._id} buyer=${buyerUserId}`);
            }
          }
        } catch (chargeErr) {
          logger.error(`[Admin Ruling] ❌ Buyer compensation charge FAILED transaction=${transaction._id}:`, chargeErr.message);
        }
      }
    }

    // Send refund emails to buyer and seller
    if (resolvedRefundAmount > 0) {
      try {
        const [buyerUser, sellerUser] = await Promise.all([
          Customer.findById(transaction.buyer).select('firstName lastName email').lean(),
          Customer.findById(transaction.seller).select('firstName lastName email').lean()
        ]);
        const listingForEmail = await Listing.findById(transaction.listing).select('title').lean();
        const listingTitle = listingForEmail?.title || 'your listing';
        const refundAmountFormatted = `$${resolvedRefundAmount.toFixed(2)}`;

        if (buyerUser?.email) {
          const buyerEmail = renderEmailTemplate('disputeRefundBuyer', 'en', {
            buyerName: `${buyerUser.firstName} ${buyerUser.lastName}`.trim(),
            listingTitle,
            refundAmount: refundAmountFormatted
          });
          await sendEmail(buyerUser.email, buyerEmail.subject, buyerEmail.html).catch(err =>
            logger.error('[Admin] Failed to send dispute refund buyer email:', err.message)
          );
        }

        if (sellerUser?.email) {
          const sellerEmail = renderEmailTemplate('disputeRefundSeller', 'en', {
            sellerName: `${sellerUser.firstName} ${sellerUser.lastName}`.trim(),
            listingTitle,
            refundAmount: refundAmountFormatted
          });
          await sendEmail(sellerUser.email, sellerEmail.subject, sellerEmail.html).catch(err =>
            logger.error('[Admin] Failed to send dispute refund seller email:', err.message)
          );
        }
      } catch (emailErr) {
        logger.error('[Admin] Failed to send dispute refund emails:', emailErr.message);
      }
    }

    const updated = await Transaction.findById(transaction._id)
      .populate('listing', 'title slug images')
      .populate('seller', 'firstName lastName email')
      .populate('buyer', 'firstName lastName email')
      .lean();

    res.json({
      success: true,
      message: 'Dispute ruling applied successfully',
      transaction: updated
    });
  } catch (error) {
    logger.error('Error issuing dispute ruling:', error);
    res.status(500).json({
      error: 'Failed to issue ruling',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/admin/reviews/flagged
 * List reviews flagged for potential fraud/abuse (pending admin review).
 */
router.get('/reviews/flagged', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    const [flags, total] = await Promise.all([
      ReviewFlag.find({ status: 'pending' })
        .populate('review')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReviewFlag.countDocuments({ status: 'pending' })
    ]);
    const withReviewDetails = await Promise.all(
      flags.map(async (f) => {
        const r = f.review;
        if (!r) return { ...f, reviewer: null, reviewee: null, listing: null };
        const [reviewer, reviewee, listing] = await Promise.all([
          Customer.findById(r.reviewer).select('firstName lastName email').lean(),
          Customer.findById(r.reviewee).select('firstName lastName email').lean(),
          Listing.findById(r.listing).select('title slug').lean()
        ]);
        return { ...f, reviewer, reviewee, listing };
      })
    );
    res.json({ flags: withReviewDetails, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    logger.error('Error fetching flagged reviews:', error);
    res.status(500).json({ error: 'Failed to fetch flagged reviews', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/reviews/flags/:id
 * Resolve a review flag: dismissed | confirmed_fake.
 * Body: { status, adminNotes? }
 */
router.patch('/reviews/flags/:id', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid flag ID' });
  try {
    const { status, adminNotes } = req.body;
    if (!status || !['dismissed', 'confirmed_fake'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'status must be dismissed or confirmed_fake'
      });
    }
    const flag = await ReviewFlag.findById(req.params.id);
    if (!flag) return res.status(404).json({ error: 'Flag not found' });
    if (flag.status !== 'pending') {
      return res.status(400).json({ error: 'Already resolved', message: 'This flag has already been resolved.' });
    }
    flag.status = status;
    flag.resolvedAt = new Date();
    flag.resolvedBy = req.user?.email || 'admin';
    if (adminNotes != null) flag.adminNotes = String(adminNotes).trim() || null;
    await flag.save();
    res.json({ success: true, flag });
  } catch (error) {
    logger.error('Error resolving review flag:', error);
    res.status(500).json({ error: 'Failed to resolve flag', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * GET /api/admin/reviews/appeals
 * Admin queue for pending review appeals.
 */
router.get('/reviews/appeals', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;
    const [appeals, total] = await Promise.all([
      ReviewAppeal.find({ status: 'pending' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReviewAppeal.countDocuments({ status: 'pending' })
    ]);
    const withDetails = await Promise.all(
      appeals.map(async (a) => {
        const [review, appellant] = await Promise.all([
          Review.findById(a.review).lean(),
          Customer.findById(a.appellant).select('firstName lastName email').lean()
        ]);
        let listing = null;
        let reviewer = null;
        let reviewee = null;
        if (review) {
          [listing, reviewer, reviewee] = await Promise.all([
            Listing.findById(review.listing).select('title slug').lean(),
            Customer.findById(review.reviewer).select('firstName lastName email').lean(),
            Customer.findById(review.reviewee).select('firstName lastName email').lean()
          ]);
        }
        return { ...a, review, appellant, listing, reviewer, reviewee };
      })
    );
    res.json({ appeals: withDetails, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    logger.error('Error fetching review appeals:', error);
    res.status(500).json({ error: 'Failed to fetch review appeals', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

/**
 * PATCH /api/admin/reviews/appeals/:id
 * Resolve an appeal: accepted | rejected.
 * Body: { status, adminNotes? }
 */
router.patch('/reviews/appeals/:id', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid appeal ID' });
  try {
    const { status, adminNotes } = req.body;
    if (!status || !['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
        message: 'status must be accepted or rejected'
      });
    }
    const appeal = await ReviewAppeal.findById(req.params.id);
    if (!appeal) return res.status(404).json({ error: 'Appeal not found' });
    if (appeal.status !== 'pending') {
      return res.status(400).json({ error: 'Already resolved', message: 'This appeal has already been resolved.' });
    }
    appeal.status = status;
    appeal.resolvedAt = new Date();
    appeal.resolvedBy = req.user?.email || 'admin';
    if (adminNotes != null) appeal.adminNotes = String(adminNotes).trim() || null;
    await appeal.save();
    res.json({ success: true, appeal });
  } catch (error) {
    logger.error('Error resolving review appeal:', error);
    res.status(500).json({ error: 'Failed to resolve appeal', message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' });
  }
});

// Close private room and end auction
router.post('/auctions/:id/close-private-room', authenticateToken, requireAdmin, async (req, res) => {
  if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid listing ID' });
  try {
    const listingId = req.params.id;
    
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Check if private room is active or eligible
    if (listing.privateRoomStatus !== 'active' && listing.privateRoomStatus !== 'eligible') {
      return res.status(400).json({ 
        error: 'Invalid operation',
        message: 'Private room is not active or eligible to be closed' 
      });
    }

    // Check if auction is already ended
    if (listing.status === 'ended') {
      return res.status(400).json({ 
        error: 'Auction already ended',
        message: 'This auction has already been ended' 
      });
    }

    // Import auction notification service first to send notifications
    const auctionNotificationService = require('../services/auctionNotificationService');
    
    // Get highest bid before ending (needed for notifications)
    const Bid = require('../models/Bid');
    const highestBid = await Bid.findOne({ listing: listingId })
      .sort({ amount: -1 })
      .populate('bidder', 'firstName lastName email')
      .lean();

    // Close private room and end auction
    listing.privateRoomStatus = 'ended';
    listing.status = 'ended';
    const now = new Date();
    listing.endDate = now; // Set end date to now
    
    // Set winner selection deadline (24 hours from now)
    const deadline = new Date(now);
    deadline.setHours(deadline.getHours() + 24);
    listing.winnerSelectionDeadline = deadline;

    await listing.save();

    // Send auction end notifications
    try {
      if (highestBid) {
        await auctionNotificationService.sendAuctionClosedNotifications(listing, highestBid._id);
      } else {
        await auctionNotificationService.sendAuctionClosedNotifications(listing);
      }
      
      // Send notification to seller to choose winner
      await auctionNotificationService.sendChooseWinnerNotification(listing);
      
      logger.info(`✅ Auction end notifications sent for listing: ${listingId}`);
    } catch (notificationError) {
      logger.error('Error sending auction end notifications:', notificationError);
      // Don't fail the request if notifications fail
    }

    // Emit socket event if available
    const io = req.app.get('io');
    if (io) {
      io.to(`listing:${listingId}`).emit('listing-update', {
        listingId: listing._id.toString(),
        privateRoomStatus: listing.privateRoomStatus,
        status: listing.status,
        endDate: listing.endDate
      });
    }

    res.json({
      success: true,
      message: 'Private room closed and auction ended successfully',
      listing: {
        id: listing._id,
        privateRoomStatus: listing.privateRoomStatus,
        status: listing.status,
        endDate: listing.endDate
      }
    });
  } catch (error) {
    logger.error('Error closing private room and ending auction:', error);
    res.status(500).json({ 
      error: 'Failed to close private room and end auction',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error' 
    });
  }
});

// GET /api/admin/reports — list reports (filterable by status, reportType)
router.get('/reports', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, reportType, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (reportType) filter.reportType = reportType;

    const reports = await Report.find(filter)
      .sort({ createdAt: -1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit))
      .populate('reportedBy', 'firstName lastName email')
      .lean();

    const total = await Report.countDocuments(filter);

    return res.json({ reports, total });
  } catch (err) {
    logger.error('GET /api/admin/reports error:', err);
    return res.status(500).json({ error: 'Failed to fetch reports.' });
  }
});

// POST /api/admin/reports — admin flags a listing/user (source: nexus)
router.post('/reports', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { reportType = 'listing', targetId, reason, description } = req.body || {};
    const VALID_REASONS = ['fraud_scam', 'offensive_content', 'prohibited_item', 'spam', 'off_platform_transaction', 'other'];

    if (!['listing', 'user'].includes(reportType)) {
      return res.status(400).json({ error: 'Invalid reportType', message: 'Must be listing or user.' });
    }
    if (!isValidObjectId(targetId)) {
      return res.status(400).json({ error: 'Invalid targetId', message: 'A valid target id is required.' });
    }
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason', message: `Allowed: ${VALID_REASONS.join(', ')}` });
    }

    if (reportType === 'listing') {
      const listing = await Listing.findById(targetId).select('_id').lean();
      if (!listing) return res.status(404).json({ error: 'Listing not found', message: 'Listing not found.' });
    } else {
      const user = await Customer.findById(targetId).select('_id').lean();
      if (!user) return res.status(404).json({ error: 'User not found', message: 'User not found.' });
    }

    const reporter =
      (await Customer.findOne({ uid: req.user.uid }).select('_id').lean()) ||
      (req.user.email
        ? await Customer.findOne({ email: String(req.user.email).toLowerCase() }).select('_id').lean()
        : null);
    if (!reporter) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Admin user not found in database.' });
    }
    const reporterId = reporter._id;

    const report = await Report.create({
      reportType,
      targetId,
      reportedBy: reporterId,
      reason,
      description: description?.trim() || 'Reported from Nexus auctions',
      status: 'pending'
    });

    await appendModerationAudit({
      subjectUserId: reporterId,
      actionType: 'admin_report_created',
      performedByUserId: reporterId,
      performedByEmail: req.user?.email || null,
      metadata: { reason, reportId: report._id, reportType, targetId }
    });

    return res.status(201).json({
      ok: true,
      message: 'Report submitted successfully.',
      reportId: report._id
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        error: 'Already reported',
        message: 'You have already reported this item.'
      });
    }
    logger.error('POST /api/admin/reports error:', err);
    return res.status(500).json({ error: 'Failed to submit report.', message: err.message || 'Internal server error' });
  }
});

// PATCH /api/admin/reports/:id — update report status
router.patch('/reports/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const VALID_STATUSES = ['pending', 'reviewed', 'resolved', 'dismissed'];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }

    const update = { status };
    if (adminNotes !== undefined) update.adminNotes = adminNotes;
    if (status === 'resolved' || status === 'dismissed') {
      update.resolvedBy = req.user._id;
      update.resolvedAt = new Date();
    }

    const report = await Report.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!report) return res.status(404).json({ error: 'Report not found.' });

    return res.json({ report });
  } catch (err) {
    logger.error('PATCH /api/admin/reports error:', err);
    return res.status(500).json({ error: 'Failed to update report.' });
  }
});

/**
 * GET /api/admin/moderation-audit — DSA traceability (internal / lawful authority support)
 * Query: subjectUserId (optional), actionType (optional), limit (default 100, max 500)
 */
router.get('/moderation-audit', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const q = {};
    if (req.query.subjectUserId && isValidObjectId(req.query.subjectUserId)) {
      q.subjectUserId = req.query.subjectUserId;
    }
    if (req.query.actionType && String(req.query.actionType).length < 80) {
      q.actionType = String(req.query.actionType).trim();
    }
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const entries = await ModerationAuditLog.find(q)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ entries, total: entries.length });
  } catch (err) {
    logger.error('GET /api/admin/moderation-audit error:', err);
    return res.status(500).json({ error: 'Failed to fetch moderation audit log.' });
  }
});

/**
 * POST /api/admin/seller-verifications/:userId
 * DSA: verify or reject professional (trader) identity submitted by the seller.
 * Body: { status: "verified" | "rejected", note?: string } (note used when rejected)
 */
router.post('/seller-verifications/:userId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const { status, note } = req.body || {};
    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status', message: 'status must be "verified" or "rejected".' });
    }
    const user = await Customer.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.sellerClassification !== 'professional') {
      return res.status(400).json({ error: 'Not a professional seller', message: 'This user is not registered as a professional (trader) seller.' });
    }

    if (status === 'verified') {
      user.professionalVerificationStatus = 'verified';
      user.professionalVerifiedAt = new Date();
      user.professionalVerifiedByEmail = (req.user.email || '').trim() || null;
      user.professionalRejectionNote = null;
    } else {
      user.professionalVerificationStatus = 'rejected';
      user.professionalVerifiedAt = null;
      user.professionalVerifiedByEmail = null;
      user.professionalRejectionNote = note != null ? String(note).trim().slice(0, 1000) : null;
    }
    await user.save();

    await appendModerationAudit({
      subjectUserId: user._id,
      actionType: 'seller_professional_verification',
      performedByEmail: req.user.email || null,
      metadata: { decision: status, rejectionNote: user.professionalRejectionNote }
    });

    return res.json({
      professionalVerificationStatus: user.professionalVerificationStatus,
      professionalVerifiedAt: user.professionalVerifiedAt,
      message: status === 'verified' ? 'Seller trader identity marked as verified.' : 'Seller trader identity rejected.'
    });
  } catch (err) {
    logger.error('POST /api/admin/seller-verifications error:', err);
    return res.status(500).json({ error: 'Failed to update seller verification.' });
  }
});

// ── Damage Claims ─────────────────────────────────────────────────────────────

/**
 * GET /api/admin/damage-claims
 * List all damage claims, most recent first.
 * Query: status (optional filter), page (default 1)
 */
router.get('/damage-claims', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const PAGE_SIZE = 20;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [claims, total] = await Promise.all([
      DamageClaim.find(filter)
        .populate('buyer', 'firstName lastName email')
        .populate('seller', 'firstName lastName email')
        .populate('listing', 'title slug category')
        .populate('transaction', 'amount shippingRateId deliveredAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      DamageClaim.countDocuments(filter)
    ]);

    return res.json({ claims, total, page, pages: Math.ceil(total / PAGE_SIZE) });
  } catch (err) {
    logger.error('GET /api/admin/damage-claims error:', err);
    return res.status(500).json({ error: 'Failed to load damage claims.' });
  }
});

/**
 * GET /api/admin/damage-claims/:id
 * Get a single damage claim with full detail.
 */
router.get('/damage-claims/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID.' });

    const claim = await DamageClaim.findById(req.params.id)
      .populate('buyer', 'firstName lastName email')
      .populate('seller', 'firstName lastName email')
      .populate('listing', 'title slug category images')
      .populate('transaction', 'amount buyerTotalPaid shippingRateId deliveredAt shippingCarrier trackingNumber')
      .lean();

    if (!claim) return res.status(404).json({ error: 'Claim not found.' });
    return res.json({ claim });
  } catch (err) {
    logger.error('GET /api/admin/damage-claims/:id error:', err);
    return res.status(500).json({ error: 'Failed to load claim.' });
  }
});

/**
 * PATCH /api/admin/damage-claims/:id
 * Update a damage claim (status, packaging compliance, notes, carrier claim, refund amounts).
 * Body (all optional):
 *   status, packagingCompliant, adminNotes, carrierClaimReference,
 *   carrierClaimFiledAt, refundAmount, sellerCompensationAmount
 */
router.patch('/damage-claims/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid ID.' });

    const VALID_STATUSES = [
      'pending_review', 'approved_refund', 'packaging_rejected',
      'carrier_claim_filed', 'resolved', 'closed'
    ];

    const {
      status, packagingCompliant, adminNotes, carrierClaimReference,
      carrierClaimFiledAt, refundAmount, sellerCompensationAmount
    } = req.body;

    const claim = await DamageClaim.findById(req.params.id)
      .populate('listing', 'title')
      .populate('transaction', '_id');

    if (!claim) return res.status(404).json({ error: 'Claim not found.' });

    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      claim.status = status;
      if (status === 'carrier_claim_filed' && carrierClaimReference) {
        claim.carrierClaimFiledAt = carrierClaimFiledAt ? new Date(carrierClaimFiledAt) : new Date();
      }
      if (status === 'approved_refund' || status === 'resolved') {
        if (!claim.refundedAt && refundAmount !== undefined) claim.refundedAt = new Date();
      }
      if (status === 'resolved') {
        claim.resolvedAt = claim.resolvedAt ?? new Date();
        if (sellerCompensationAmount !== undefined && !claim.sellerCompensatedAt) {
          claim.sellerCompensatedAt = new Date();
        }
      }
    }

    if (packagingCompliant !== undefined) claim.packagingCompliant = packagingCompliant;
    if (adminNotes !== undefined) claim.adminNotes = adminNotes;
    if (carrierClaimReference !== undefined) claim.carrierClaimReference = carrierClaimReference;
    if (carrierClaimFiledAt !== undefined) claim.carrierClaimFiledAt = new Date(carrierClaimFiledAt);
    if (refundAmount !== undefined) claim.refundAmount = refundAmount;
    if (sellerCompensationAmount !== undefined) claim.sellerCompensationAmount = sellerCompensationAmount;

    await claim.save();

    // Notify buyer if claim moved to a resolved/decision state
    const notifyStatuses = ['approved_refund', 'packaging_rejected', 'resolved', 'closed'];
    if (status && notifyStatuses.includes(status)) {
      const io = req.app.get('io');
      setImmediate(async () => {
        try {
          await notifyDamageClaimResolved({
            buyerId: claim.buyer,
            listingTitle: claim.listing?.title,
            status: claim.status,
            transactionId: claim.transaction?._id ?? claim.transaction,
            io
          });
        } catch (e) {
          logger.error('notifyDamageClaimResolved error:', e.message);
        }
      });
    }

    const updated = await DamageClaim.findById(claim._id)
      .populate('buyer', 'firstName lastName email')
      .populate('seller', 'firstName lastName email')
      .populate('listing', 'title slug category')
      .lean();

    return res.json({ claim: updated });
  } catch (err) {
    logger.error('PATCH /api/admin/damage-claims/:id error:', err);
    return res.status(500).json({ error: 'Failed to update claim.' });
  }
});

/**
 * POST /api/admin/maintenance/image-purge
 * Manually trigger the RGPD image purge job (admin only).
 */
router.post('/maintenance/image-purge', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await runImagePurge();
    return res.json({ success: true, result });
  } catch (err) {
    logger.error('POST /api/admin/maintenance/image-purge error:', err);
    return res.status(500).json({ error: 'Image purge failed', message: err.message });
  }
});

/**
 * GET /api/admin/moderation/blocklist
 * List all terms in the Azure Content Safety prohibited blocklist.
 */
router.get('/moderation/blocklist', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const items = await getBlocklistItems();
    return res.json({ items });
  } catch (err) {
    logger.error('GET /api/admin/moderation/blocklist error:', err);
    return res.status(500).json({ error: 'Failed to fetch blocklist', message: err.message });
  }
});

/**
 * POST /api/admin/moderation/blocklist
 * Add a term to the Azure Content Safety prohibited blocklist.
 * Body: { text: string }
 */
router.post('/moderation/blocklist', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    await ensureBlocklistExists();
    const item = await addBlocklistItem(text.trim());
    logger.info(`[admin] blocklist term added by ${req.user?.email}: "${text.trim()}"`);
    return res.json({ success: true, item });
  } catch (err) {
    logger.error('POST /api/admin/moderation/blocklist error:', err);
    return res.status(500).json({ error: 'Failed to add term', message: err.message });
  }
});

/**
 * DELETE /api/admin/moderation/blocklist/:itemId
 * Remove a term from the Azure Content Safety prohibited blocklist.
 */
router.delete('/moderation/blocklist/:itemId', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await removeBlocklistItem(req.params.itemId);
    logger.info(`[admin] blocklist term removed by ${req.user?.email}: itemId=${req.params.itemId}`);
    return res.json({ success: true });
  } catch (err) {
    logger.error('DELETE /api/admin/moderation/blocklist error:', err);
    return res.status(500).json({ error: 'Failed to remove term', message: err.message });
  }
});

module.exports = router;

