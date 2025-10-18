import { Server as SocketIOServer, Socket } from 'socket.io';
import { RedisClientType } from 'redis';
import { logger } from '../utils/logger';
import { Auction, Watchlist } from '../models';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
}

export function setupAuctionHandlers(
  _io: SocketIOServer,
  socket: AuthenticatedSocket,
  redisClient: RedisClientType<any>
): void {
  
  // Watch/unwatch auction
  socket.on('auction:watch', async (auctionId: string) => {
    try {
      const auction = await Auction.findById(auctionId);
      
      if (!auction) {
        socket.emit('error', { message: 'Auction not found' });
        return;
      }

      // Check if already watching
      const existing = await Watchlist.findOne({
        userId: socket.userId,
        auctionId,
      });

      if (existing) {
        socket.emit('auction:watch:error', { message: 'Already watching this auction' });
        return;
      }

      // Add to watchlist
      await Watchlist.create({
        userId: socket.userId,
        auctionId,
      });

      // Update auction watcher count
      await Auction.findByIdAndUpdate(auctionId, {
        $inc: { watcherCount: 1 },
      });

      socket.emit('auction:watch:success', { auctionId });
      logger.info(`User ${socket.userId} is now watching auction ${auctionId}`);
    } catch (error) {
      logger.error('Error watching auction:', error);
      socket.emit('error', { message: 'Failed to watch auction' });
    }
  });

  socket.on('auction:unwatch', async (auctionId: string) => {
    try {
      const result = await Watchlist.findOneAndDelete({
        userId: socket.userId,
        auctionId,
      });

      if (result) {
        // Update auction watcher count
        await Auction.findByIdAndUpdate(auctionId, {
          $inc: { watcherCount: -1 },
        });

        socket.emit('auction:unwatch:success', { auctionId });
        logger.info(`User ${socket.userId} stopped watching auction ${auctionId}`);
      }
    } catch (error) {
      logger.error('Error unwatching auction:', error);
      socket.emit('error', { message: 'Failed to unwatch auction' });
    }
  });

  // Track auction view
  socket.on('auction:view', async (auctionId: string) => {
    try {
      // Check if view was already counted in this session
      const viewKey = `auction:view:${auctionId}:${socket.id}`;
      const hasViewed = await redisClient.get(viewKey);

      if (!hasViewed) {
        // Increment view count
        await Auction.findByIdAndUpdate(auctionId, {
          $inc: { viewCount: 1 },
        });

        // Mark as viewed for this session (expires in 1 hour)
        await redisClient.setEx(viewKey, 3600, '1');

        logger.info(`View counted for auction ${auctionId} by user ${socket.userId}`);
      }
    } catch (error) {
      logger.error('Error tracking auction view:', error);
    }
  });

  // Private room notification
  socket.on('auction:private-room:check', async (auctionId: string) => {
    try {
      const auction = await Auction.findById(auctionId);
      
      if (!auction) {
        return;
      }

      // Temporarily disabled - canStartPrivateRoom method not implemented
      // if (auction.canStartPrivateRoom) {
      //   socket.emit('auction:private-room:eligible', {
      //     auctionId: auction._id,
      //     message: 'This auction is eligible for a private room!',
      //   });
      // }
    } catch (error) {
      logger.error('Error checking private room eligibility:', error);
    }
  });
}

