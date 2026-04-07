const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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
const shippingRoutes = require('./routes/shipping');
const configRoutes = require('./routes/config');
const airwallexRoutes = require('./routes/airwallex');

// Import services
const auctionEndScheduler = require('./services/auctionEndScheduler');
const { runCleanup: runProofOfPaymentCleanup } = require('./services/proofOfPaymentCleanup');
const escrowExpiryScheduler = require('./services/escrowExpiryScheduler');

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
const isAllowedOrigin = (origin) => {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.azurestaticapps.net')) return true;
  return false;
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: isAllowedOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// Trust the first hop proxy (Azure App Service / load balancer) so req.ip is the real client IP
app.set('trust proxy', 1);

// Middleware
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(null, allowedOrigins[0]);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(morgan('combined'));

// Airwallex webhooks need raw body for signature verification (must be before express.json())
app.post('/api/airwallex/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
  req.rawBody = req.body;
  next();
});

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

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/listings', generalLimiter, listingRoutes);
app.use('/api/bids', bidOfferLimiter, bidRoutes);
app.use('/api/offers', bidOfferLimiter, offerRoutes);
app.use('/api/uploads', generalLimiter, uploadRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/private-room', privateRoomRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/shipping', shippingRoutes);
app.use('/api/config', configRoutes);
app.use('/api/airwallex', airwallexRoutes);

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

// Socket.io connection handling
io.on('connection', (socket) => {
  // Join a listing room to receive real-time updates
  socket.on('join-listing', (listingId) => {
    socket.join(`listing:${listingId}`);
    updateViewerCount(io, listingId);
  });

  // Join a private room as a viewer
  socket.on('join-private-room-viewer', (listingId) => {
    socket.join(`private-room:${listingId}`);
    updatePrivateRoomViewerCount(io, listingId);
  });

  // Leave a listing room
  socket.on('leave-listing', (listingId) => {
    socket.leave(`listing:${listingId}`);
    updateViewerCount(io, listingId);
  });

  // Leave a private room viewer
  socket.on('leave-private-room-viewer', (listingId) => {
    socket.leave(`private-room:${listingId}`);
    updatePrivateRoomViewerCount(io, listingId);
  });

  // Join user room for real-time notification updates (uid = Firebase/auth uid)
  socket.on('join-user', (uid) => {
    if (uid) socket.join(`user:${uid}`);
  });

  socket.on('leave-user', (uid) => {
    if (uid) socket.leave(`user:${uid}`);
  });

  socket.on('disconnect', () => {});
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
    
    // Start the server
    server.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 API URL: http://localhost:${PORT}`);
      console.log(`🔌 Socket.io server is ready`);
      
      // Start auction end scheduler (checks every 1 minute)
      auctionEndScheduler.startScheduler(1, io);
      console.log(`⏰ Auction end scheduler started`);

      // Escrow expiry scheduler: 14-day hold warnings + T+3 escrow releases (checks every 60 min)
      escrowExpiryScheduler.startScheduler(60, io);
      console.log(`🔒 Escrow expiry scheduler started`);

      // Proof-of-payment cleanup: delete files from Azure 30 days after paid (run daily)
      const PROOF_CLEANUP_MS = 24 * 60 * 60 * 1000;
      setTimeout(() => runProofOfPaymentCleanup().catch(e => console.error('Proof-of-payment cleanup:', e.message)), 60000);
      setInterval(() => runProofOfPaymentCleanup().catch(e => console.error('Proof-of-payment cleanup:', e.message)), PROOF_CLEANUP_MS);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server, io };
