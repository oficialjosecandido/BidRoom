import { Server as SocketIOServer, Socket } from 'socket.io';
import { RedisClientType } from 'redis';
import jwt from 'jsonwebtoken';
import config from '../config';
import { User } from '../models';
import { logger } from '../utils/logger';
import { setupBiddingHandlers } from './bidding.socket';
import { setupAuctionHandlers } from './auction.socket';
import { setupNotificationHandlers } from './notification.socket';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
}

export function setupSocketIO(io: SocketIOServer, redisClient: RedisClientType<any>): void {
  // Socket authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, config.jwt.secret) as { id: string };
      
      // Get user from database
      const user = await User.findById(decoded.id);
      
      if (!user || !user.isActive || user.isSuspended) {
        return next(new Error('Invalid or inactive user'));
      }

      // Attach user to socket
      socket.userId = user._id.toString();
      socket.user = user;

      next();
    } catch (error) {
      logger.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  });

  // Connection handler
  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`Client connected: ${socket.id} (User: ${socket.userId})`);

    // Join user's personal room for notifications
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

    // Setup event handlers
    setupBiddingHandlers(io, socket, redisClient);
    setupAuctionHandlers(io, socket, redisClient);
    setupNotificationHandlers(io, socket, redisClient);

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      logger.info(`Client disconnected: ${socket.id} (User: ${socket.userId}) - Reason: ${reason}`);
      
      // Leave all auction rooms
      const rooms = Array.from(socket.rooms).filter((room) => room.startsWith('auction:'));
      rooms.forEach((room) => {
        socket.leave(room);
      });
    });

    // Handle errors
    socket.on('error', (error) => {
      logger.error(`Socket error for ${socket.id}:`, error);
    });
  });

  logger.info('✅ Socket.IO configured successfully');
}

export default setupSocketIO;

