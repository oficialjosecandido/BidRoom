const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Initialize Firebase Admin
require('./config/firebaseAdmin');

// Import database connection
const connectDB = require('./config/database');
const User = require('./models/User');
const Listing = require('./models/Listing');
const redisService = require('./services/redis.service');

// Import routes
const authRoutes = require('./routes/auth');
const listingRoutes = require('./routes/listings');
const bidRoutes = require('./routes/bids');
const offerRoutes = require('./routes/offers');
const uploadRoutes = require('./routes/uploads');
const adminRoutes = require('./routes/admin');
const privateRoomRoutes = require('./routes/privateRoom');
const customerRoutes = require('./routes/customers');
const watchlistRoutes = require('./routes/watchlist');
const reviewRoutes = require('./routes/reviews');
const transactionsRoutes = require('./routes/transactions');
const notificationsRoutes = require('./routes/notifications');
const { router: paymentsRouter, stripeWebhookHandler } = require('./routes/payments');
const { router: connectRouter, connectWebhookHandler } = require('./routes/connect');
const shippingRoutes = require('./routes/shipping');
const configRoutes = require('./routes/config');
const reportRoutes = require('./routes/reports');
const userRoutes = require('./routes/users');
const followRoutes = require('./routes/follows');
const blockRoutes = require('./routes/blocks');
const categoryFollowRoutes = require('./routes/category-follows');
const damageClaimsRoutes = require('./routes/damageClaims');
const { router: kycRoutes, kycWebhookHandler } = require('./routes/kyc');

// Import services
const auctionEndScheduler = require('./services/auctionEndScheduler');
const shippingDeadlineScheduler = require('./services/shippingDeadlineScheduler');
const deliveryAutoReleaseScheduler = require('./services/deliveryAutoReleaseScheduler');
const reviewAutoGenerateScheduler = require('./services/reviewAutoGenerateScheduler');
const dsaComplianceScheduler = require('./services/dsaComplianceScheduler');
const { runCleanup: runProofOfPaymentCleanup } = require('./services/proofOfPaymentCleanup');
const { runImagePurge } = require('./services/imagePurgeScheduler');

// CORS: FRONTEND_URL(s), optional CORS_EXTRA_ORIGINS (comma-separated), localhost, Azure Static Web Apps
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_PROD,
  ...extraOrigins,
  'http://localhost:4200',
  'https://localhost:4200'
].filter(Boolean);
/** Local Angular / Vite dev servers (any port). */
const isLocalDevOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin || '');

const isAllowedOrigin = (origin) => {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.azurestaticapps.net')) return true;
  if (isLocalDevOrigin(origin)) return true;
  return false;
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }
      return callback(null, isAllowedOrigin(origin));
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// Trust the first hop proxy (Azure App Service / load balancer) so req.ip is the real client IP
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    console.warn('[CORS] blocked origin:', origin);
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Fingerprint'],
  credentials: true
};
app.use(cors(corsOptions));
/** Explicit preflight so OPTIONS always returns CORS headers (some Azure/proxy setups miss this). */
app.options('*', cors(corsOptions));
app.use(morgan('combined'));

// Stripe webhooks need raw body for signature verification (must be before express.json())
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.post('/api/connect/webhook', express.raw({ type: 'application/json' }), connectWebhookHandler);
app.post('/api/kyc/webhook', express.raw({ type: 'application/json' }), kycWebhookHandler);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Too many attempts. Please try again in 15 minutes.' }
});

const bidOfferLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Too many requests. Please slow down.' }
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Too many requests. Please slow down.' }
});

const adminLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Too many requests. Please slow down.' }
});

// Reviews limiter: stricter than general because writes (review/flag/appeal) are abuse-prone
const reviewsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', message: 'Too many requests. Please slow down.' }
});

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/listings', generalLimiter, listingRoutes);
app.use('/api/bids', bidOfferLimiter, bidRoutes);
app.use('/api/offers', bidOfferLimiter, offerRoutes);
app.use('/api/uploads', generalLimiter, uploadRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/private-room', bidOfferLimiter, privateRoomRoutes);
app.use('/api/customers', generalLimiter, customerRoutes);
app.use('/api/watchlist', generalLimiter, watchlistRoutes);
app.use('/api/reviews', reviewsLimiter, reviewRoutes);
app.use('/api/transactions', generalLimiter, transactionsRoutes);
app.use('/api/notifications', generalLimiter, notificationsRoutes);
app.use('/api/payments', generalLimiter, paymentsRouter);
app.use('/api/connect', generalLimiter, connectRouter);
app.use('/api/shipping', generalLimiter, shippingRoutes);
app.use('/api/config', generalLimiter, configRoutes);
app.use('/api/reports', generalLimiter, reportRoutes);
app.use('/api/users', generalLimiter, userRoutes);
app.use('/api/follows', generalLimiter, followRoutes);
app.use('/api/blocks', generalLimiter, blockRoutes);
app.use('/api/category-follows', generalLimiter, categoryFollowRoutes);
app.use('/api/damage-claims', generalLimiter, damageClaimsRoutes);
app.use('/api/kyc', generalLimiter, kycRoutes);

app.get('/', (req, res) => {
  res.json({
    message: `BidRoom API is running (${process.env.NODE_ENV || 'development'})`,
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});


// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl
  });
});

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;
const SAFE_UID_RE  = /^[a-zA-Z0-9_-]{1,128}$/;

// Socket.io connection handling
io.on('connection', (socket) => {
  // Join a listing room to receive real-time updates
  socket.on('join-listing', (listingId) => {
    if (!OBJECT_ID_RE.test(listingId)) return;
    socket.join(`listing:${listingId}`);
    updateViewerCount(io, listingId);
  });

  // Join a private room as a viewer
  socket.on('join-private-room-viewer', (listingId) => {
    if (!OBJECT_ID_RE.test(listingId)) return;
    socket.join(`private-room:${listingId}`);
    updatePrivateRoomViewerCount(io, listingId);
  });

  // Leave a listing room
  socket.on('leave-listing', (listingId) => {
    if (!OBJECT_ID_RE.test(listingId)) return;
    socket.leave(`listing:${listingId}`);
    updateViewerCount(io, listingId);
  });

  // Leave a private room viewer
  socket.on('leave-private-room-viewer', (listingId) => {
    if (!OBJECT_ID_RE.test(listingId)) return;
    socket.leave(`private-room:${listingId}`);
    updatePrivateRoomViewerCount(io, listingId);
  });

  // Join user room for real-time notification updates (uid = Firebase/auth uid)
  socket.on('join-user', (uid) => {
    if (uid && SAFE_UID_RE.test(uid)) socket.join(`user:${uid}`);
  });

  socket.on('leave-user', (uid) => {
    if (uid && SAFE_UID_RE.test(uid)) socket.leave(`user:${uid}`);
  });

  socket.on('disconnect', () => {
    // Recalculate viewer counts for any rooms this socket was in
    const rooms = Array.from(socket.rooms);
    for (const room of rooms) {
      if (room.startsWith('listing:')) {
        const listingId = room.slice('listing:'.length);
        updateViewerCount(io, listingId);
      } else if (room.startsWith('private-room:')) {
        const listingId = room.slice('private-room:'.length);
        updatePrivateRoomViewerCount(io, listingId);
      }
    }
  });
});

// Helper function to update viewer count for listings
function updateViewerCount(io, listingId) {
  const room = io.sockets.adapter.rooms.get(`listing:${listingId}`);
  const count = room ? room.size : 0;
  io.to(`listing:${listingId}`).emit('viewer-count-update', {
    listingId,
    count
  });
}

// Helper function to update viewer count for private rooms
function updatePrivateRoomViewerCount(io, listingId) {
  const room = io.sockets.adapter.rooms.get(`private-room:${listingId}`);
  const count = room ? room.size : 0;
  io.to(`private-room:${listingId}`).emit('private-room-viewer-count-update', {
    listingId,
    count
  });
}

// Make io available to routes
app.set('io', io);
app.set('redisService', redisService);

// Start server and connect to database
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Drop legacy unique index on platinumBidderInvitations.invitationToken (no longer used)
    try {
      await Listing.collection.dropIndex('platinumBidderInvitations.invitationToken_1');
      console.log('🗑️ Dropped legacy index platinumBidderInvitations.invitationToken_1');
    } catch (e) {
      if (e.code !== 27) console.warn('Index drop (optional):', e.message);
    }

    // Connect to Redis
    await redisService.connect();

    // Attach socket.io Redis adapter so events are broadcast across all server instances.
    // Uses two dedicated pub/sub clients (required by the adapter API).
    // Fail-open: if the adapter setup throws, socket.io continues in single-instance mode.
    if (process.env.REDIS_HOST) {
      try {
        const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
        const redisOpts = {
          host: process.env.REDIS_HOST,
          port: redisPort,
          password: process.env.REDIS_PASSWORD || undefined,
          tls: redisPort === 6380 ? {} : undefined,
          lazyConnect: false
        };
        const pubClient = new Redis(redisOpts);
        const subClient = pubClient.duplicate();
        await Promise.all([
          new Promise((res, rej) => {
            pubClient.once('ready', res);
            pubClient.once('error', rej);
          }),
          new Promise((res, rej) => {
            subClient.once('ready', res);
            subClient.once('error', rej);
          })
        ]);
        io.adapter(createAdapter(pubClient, subClient));
        console.log('🔌 Socket.io Redis adapter attached (multi-instance support enabled)');
      } catch (adapterErr) {
        console.warn('⚠️  Socket.io Redis adapter failed — running in single-instance mode:', adapterErr.message);
      }
    } else {
      console.log('ℹ️  REDIS_HOST not set — socket.io running in single-instance mode');
    }

    // Start the server
    server.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 API URL: http://localhost:${PORT}`);
      console.log(`🔌 Socket.io server is ready`);
      
      // Start auction end scheduler (checks every 1 minute)
      auctionEndScheduler.startScheduler(1, io);
      console.log(`⏰ Auction end scheduler started`);

      shippingDeadlineScheduler.startScheduler(15, io);
      console.log(`📦 Shipping deadline scheduler started`);

      deliveryAutoReleaseScheduler.startDeliveryAutoReleaseScheduler(15, io);
      console.log(`🚚 Delivery auto-release scheduler started`);

      reviewAutoGenerateScheduler.startReviewAutoGenerateScheduler(6, io);
      console.log(`⭐ Review auto-generate scheduler started`);

      dsaComplianceScheduler.startDsaComplianceScheduler(24, io);
      console.log(`⚖️  DSA compliance scheduler started`);

      const DAILY_MS = 24 * 60 * 60 * 1000;

      // Proof-of-payment cleanup: delete files from Azure 30 days after paid (run daily)
      setTimeout(() => runProofOfPaymentCleanup().catch(e => console.error('Proof-of-payment cleanup:', e.message)), 60000);
      setInterval(() => runProofOfPaymentCleanup().catch(e => console.error('Proof-of-payment cleanup:', e.message)), DAILY_MS);

      // RGPD image purge: delete listing images past their retention period (run daily at startup + every 24h)
      setTimeout(() => runImagePurge().catch(e => console.error('Image purge error:', e.message)), 5 * 60 * 1000);
      setInterval(() => runImagePurge().catch(e => console.error('Image purge error:', e.message)), DAILY_MS);
      console.log(`🧹 Image purge scheduler started`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server, io };
