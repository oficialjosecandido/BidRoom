const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
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
const { router: paymentsRouter, stripeWebhookHandler } = require('./routes/payments');

// Import services
const auctionEndScheduler = require('./services/auctionEndScheduler');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:4200';
app.use(cors({
  origin: [frontendOrigin, 'http://localhost:4200', 'https://localhost:4200'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(morgan('combined'));

// Stripe webhook needs raw body for signature verification (must be before express.json())
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/private-room', privateRoomRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/payments', paymentsRouter);

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

// Test MongoDB connection endpoint (development only)
if (process.env.NODE_ENV === 'development') {
  app.get('/test-db', async (req, res) => {
    try {
      const userCount = await User.countDocuments();
      res.json({
        message: 'MongoDB connection successful!',
        userCount: userCount,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        error: 'Database connection failed',
        message: error.message
      });
    }
  });
}


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
  console.log(`🔌 Client connected: ${socket.id}`);

  // Join a listing room to receive real-time updates
  socket.on('join-listing', (listingId) => {
    socket.join(`listing:${listingId}`);
    console.log(`👤 ${socket.id} joined listing room: ${listingId}`);
    
    // Update viewer count for this listing
    updateViewerCount(io, listingId);
  });

  // Join a private room as a viewer
  socket.on('join-private-room-viewer', (listingId) => {
    socket.join(`private-room:${listingId}`);
    console.log(`👁️ ${socket.id} joined private room viewer: ${listingId}`);
    
    // Update viewer count for private room
    updatePrivateRoomViewerCount(io, listingId);
  });

  // Leave a listing room
  socket.on('leave-listing', (listingId) => {
    socket.leave(`listing:${listingId}`);
    console.log(`👤 ${socket.id} left listing room: ${listingId}`);
    
    // Update viewer count
    updateViewerCount(io, listingId);
  });

  // Leave a private room viewer
  socket.on('leave-private-room-viewer', (listingId) => {
    socket.leave(`private-room:${listingId}`);
    console.log(`👁️ ${socket.id} left private room viewer: ${listingId}`);
    
    // Update viewer count
    updatePrivateRoomViewerCount(io, listingId);
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
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
    
    // Start the server
    server.listen(PORT, () => {
      console.log(`🚀 Server is running on port ${PORT}`);
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 API URL: http://localhost:${PORT}`);
      console.log(`🔌 Socket.io server is ready`);
      
      // Start auction end scheduler (checks every 1 minute)
      auctionEndScheduler.startScheduler(1, io);
      console.log(`⏰ Auction end scheduler started`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server, io };
