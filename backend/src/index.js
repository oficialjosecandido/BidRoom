const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const Redis = require('ioredis');
const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const logger = require('./utils/logger');
const { createLimiter } = require('./middleware/rateLimiters');

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
const shareRoutes = require('./routes/share');

// Import services
const auctionEndScheduler = require('./services/auctionEndScheduler');
const shippingDeadlineScheduler = require('./services/shippingDeadlineScheduler');
const deliveryAutoReleaseScheduler = require('./services/deliveryAutoReleaseScheduler');
const reviewAutoGenerateScheduler = require('./services/reviewAutoGenerateScheduler');
const dsaComplianceScheduler = require('./services/dsaComplianceScheduler');
const { runCleanup: runProofOfPaymentCleanup } = require('./services/proofOfPaymentCleanup');
const { runImagePurge } = require('./services/imagePurgeScheduler');

// CORS allowlist.
//   - FRONTEND_URL / FRONTEND_URL_PROD: primary domains.
//   - CORS_EXTRA_ORIGINS: comma-separated list of extra exact origins (e.g. preview deploys).
//   - CORS_ALLOWED_SUBDOMAINS: comma-separated list of subdomain suffixes ("*.azurestaticapps.net")
//     scoped to the BidRoom apps. Empty by default — never accept ANY *.azurestaticapps.net.
//   - In NODE_ENV !== 'production' we also accept any localhost/127.0.0.1 origin (any port) so
//     local Angular/Vite dev servers work without extra configuration.
const extraOrigins = (process.env.CORS_EXTRA_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const allowedSubdomainSuffixes = (process.env.CORS_ALLOWED_SUBDOMAINS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_PROD,
  ...extraOrigins,
  'http://localhost:4200',
  'https://localhost:4200'
]
  .filter(Boolean)
  .map((o) => o.toLowerCase().replace(/\/$/, ''));

/** Local Angular / Vite dev servers (any port). Only accepted outside production. */
const isLocalDevOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin || '');

const isAllowedOrigin = (origin) => {
  if (!origin) return false;
  const normalized = origin.toLowerCase().replace(/\/$/, '');
  if (allowedOrigins.includes(normalized)) return true;
  if (allowedSubdomainSuffixes.length > 0) {
    try {
      const host = new URL(normalized).hostname;
      if (allowedSubdomainSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
        return true;
      }
    } catch (_) {
      // Malformed origin — reject.
    }
  }
  if (process.env.NODE_ENV !== 'production' && isLocalDevOrigin(normalized)) return true;
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

// ─── Security headers ───────────────────────────────────────────────────────
// The API is consumed exclusively from the Angular SPA, so we can ship a strict
// CSP that only allows the integrations we actually use (Stripe + Google OAuth)
// without breaking the Express JSON responses themselves.
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        connectSrc: [
          "'self'",
          'https://api.stripe.com',
          'https://*.stripe.com',
          'https://identitytoolkit.googleapis.com',
          'https://securetoken.googleapis.com',
          'wss:',
        ],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        scriptSrc: ["'self'", 'https://js.stripe.com', 'https://checkout.stripe.com'],
        frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com', 'https://checkout.stripe.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
      },
    },
  })
);

// Attach a stable request id so logs (and Application Insights) can correlate.
app.use((req, res, next) => {
  const incoming = req.headers['x-request-id'];
  const requestId = typeof incoming === 'string' && incoming.length <= 64
    ? incoming
    : crypto.randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (isAllowedOrigin(origin)) {
      return callback(null, true);
    }
    logger.warn('CORS blocked origin', { origin });
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Fingerprint', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
  credentials: true
};
app.use(cors(corsOptions));
/** Explicit preflight so OPTIONS always returns CORS headers (some Azure/proxy setups miss this). */
app.options('*', cors(corsOptions));

// HTTP access logs.
// - Production: feed morgan into the structured logger so every request becomes a JSON line.
// - Other: human-readable dev format.
if (process.env.NODE_ENV === 'production') {
  app.use(
    morgan('combined', {
      stream: { write: (line) => logger.info(line.trim(), { kind: 'access' }) },
    })
  );
} else {
  app.use(morgan('dev'));
}

// Stripe webhooks need raw body for signature verification (must be before express.json())
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.post('/api/connect/webhook', express.raw({ type: 'application/json' }), connectWebhookHandler);
app.post('/api/kyc/webhook', express.raw({ type: 'application/json' }), kycWebhookHandler);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiters — backed by Redis when REDIS_HOST is set (the only correct
// option once we run behind a horizontal scaler), in-memory otherwise.
const authLimiter = createLimiter({
  name: 'auth',
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many attempts. Please try again in 15 minutes.',
});
const bidOfferLimiter = createLimiter({
  name: 'bid-offer',
  windowMs: 60 * 1000,
  max: 30,
});
const generalLimiter = createLimiter({
  name: 'general',
  windowMs: 60 * 1000,
  max: 120,
});
const adminLimiter = createLimiter({
  name: 'admin',
  windowMs: 60 * 1000,
  max: 60,
});
// Reviews limiter: stricter than general because writes (review/flag/appeal) are abuse-prone
const reviewsLimiter = createLimiter({
  name: 'reviews',
  windowMs: 60 * 1000,
  max: 30,
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

// Share pages — no auth, no rate limit beyond express defaults
// URL: /share/listing/:slug → OG HTML page for social bots, JS redirect for browsers
// URL: /share/og-default.png → BidRoom brand PNG for OG image fallback
app.use('/share', shareRoutes);

app.get('/', (req, res) => {
  res.json({
    message: `BidRoom API is running (${process.env.NODE_ENV || 'development'})`,
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ─── Health checks ──────────────────────────────────────────────────────────
// /healthz : cheap liveness probe (does the event loop respond?). No external IO.
// /readyz  : real readiness probe (DB + Redis). Used by Azure App Service / K8s
//             to take an instance out of rotation when a dependency is down.
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/readyz', async (req, res) => {
  // Lazy-load to avoid circular imports at boot time.
  const mongoose = require('mongoose');

  const checks = { mongo: 'unknown', redis: 'unknown' };
  const mongoState = mongoose.connection?.readyState;
  // 1 = connected, 2 = connecting (treat as not-ready), 0/3 = disconnected/closing.
  checks.mongo = mongoState === 1 ? 'ok' : 'down';

  try {
    if (process.env.REDIS_HOST && redisService?.client) {
      const pong = await Promise.race([
        redisService.client.ping(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('redis ping timeout')), 1500)),
      ]);
      checks.redis = pong === 'PONG' ? 'ok' : 'down';
    } else {
      checks.redis = 'disabled';
    }
  } catch (err) {
    checks.redis = 'down';
  }

  const ok = checks.mongo === 'ok' && checks.redis !== 'down';
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    checks,
  });
});

// Backwards compatibility — existing deploy probes still hit /health.
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ─── 404 handler (must come before the error handler) ──────────────────────
app.use((req, res, next) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    requestId: req.id,
  });
});

// ─── Centralised error handler ─────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });
  const status = err.status && Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message || 'Request failed',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    requestId: req.id,
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
    // Connect to MongoDB (with internal retry/backoff — see config/database.js).
    await connectDB();

    // Drop legacy unique index on platinumBidderInvitations.invitationToken (no longer used).
    try {
      await Listing.collection.dropIndex('platinumBidderInvitations.invitationToken_1');
      logger.info('Dropped legacy index platinumBidderInvitations.invitationToken_1');
    } catch (e) {
      if (e.code !== 27) logger.warn('Index drop (optional)', { error: e.message });
    }

    // Connect to Redis (cache/state). Failures here are surfaced but not fatal.
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
        logger.info('Socket.io Redis adapter attached (multi-instance support enabled)');
      } catch (adapterErr) {
        logger.warn('Socket.io Redis adapter failed — running in single-instance mode', { error: adapterErr.message });
      }
    } else {
      logger.info('REDIS_HOST not set — socket.io running in single-instance mode');
    }

    // Start the server
    server.listen(PORT, () => {
      logger.info('Server started', {
        port: PORT,
        env: process.env.NODE_ENV || 'development',
        url: `http://localhost:${PORT}`,
      });

      auctionEndScheduler.startScheduler(1, io);
      shippingDeadlineScheduler.startScheduler(15, io);
      deliveryAutoReleaseScheduler.startDeliveryAutoReleaseScheduler(15, io);
      reviewAutoGenerateScheduler.startReviewAutoGenerateScheduler(6, io);
      dsaComplianceScheduler.startDsaComplianceScheduler(24, io);
      logger.info('Schedulers started', {
        auctionEnd: '1m',
        shipping: '15m',
        delivery: '15m',
        reviews: '6h',
        dsa: '24h',
      });

      const DAILY_MS = 24 * 60 * 60 * 1000;

      // Proof-of-payment cleanup: delete files from Azure 30 days after paid (run daily)
      setTimeout(() => runProofOfPaymentCleanup().catch((e) => logger.error('Proof-of-payment cleanup failed', { error: e.message })), 60000);
      setInterval(() => runProofOfPaymentCleanup().catch((e) => logger.error('Proof-of-payment cleanup failed', { error: e.message })), DAILY_MS);

      // RGPD image purge: delete listing images past their retention period (run daily at startup + every 24h)
      setTimeout(() => runImagePurge().catch((e) => logger.error('Image purge failed', { error: e.message })), 5 * 60 * 1000);
      setInterval(() => runImagePurge().catch((e) => logger.error('Image purge failed', { error: e.message })), DAILY_MS);
      logger.info('Image purge scheduler started');
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

// Surface — but don't crash on — unexpected errors.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
});

startServer();

module.exports = { app, server, io };
