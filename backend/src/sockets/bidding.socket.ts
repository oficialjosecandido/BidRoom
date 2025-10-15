import { Server as SocketIOServer, Socket } from 'socket.io';
import { RedisClientType } from 'redis';
import { logger } from '../utils/logger';
import { Auction, Bid, User } from '../models';
import config from '../config';

interface BidData {
  auctionId: string;
  amount: number;
  isAutoBid?: boolean;
  maxAutoBidAmount?: number;
}

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
}

export function setupBiddingHandlers(
  io: SocketIOServer,
  socket: AuthenticatedSocket,
  redisClient: RedisClientType<any>
): void {
  
  // Join auction room to receive real-time updates
  socket.on('auction:join', async (auctionId: string) => {
    try {
      const auction = await Auction.findById(auctionId);
      
      if (!auction) {
        socket.emit('error', { message: 'Auction not found' });
        return;
      }

      socket.join(`auction:${auctionId}`);
      logger.info(`User ${socket.userId} joined auction room: ${auctionId}`);

      // Send current auction state from Redis cache
      const cachedAuction = await redisClient.get(`auction:${auctionId}`);
      if (cachedAuction) {
        socket.emit('auction:state', JSON.parse(cachedAuction));
      } else {
        // Cache doesn't exist, send from DB and cache it
        const auctionData = {
          _id: auction._id,
          currentBid: auction.currentBid,
          totalBids: auction.totalBids,
          uniqueBidders: auction.uniqueBidders,
          endTime: auction.endTime,
          status: auction.status,
        };
        
        await redisClient.setEx(
          `auction:${auctionId}`,
          300, // 5 minutes TTL
          JSON.stringify(auctionData)
        );
        
        socket.emit('auction:state', auctionData);
      }
    } catch (error) {
      logger.error('Error joining auction room:', error);
      socket.emit('error', { message: 'Failed to join auction' });
    }
  });

  // Leave auction room
  socket.on('auction:leave', (auctionId: string) => {
    socket.leave(`auction:${auctionId}`);
    logger.info(`User ${socket.userId} left auction room: ${auctionId}`);
  });

  // Place bid via WebSocket
  socket.on('bid:place', async (data: BidData) => {
    try {
      const { auctionId, amount, isAutoBid, maxAutoBidAmount } = data;

      // Validate user can bid
      if (!socket.user.canBid()) {
        socket.emit('bid:error', {
          message: 'You are not authorized to bid. Please update your payment authorization.',
        });
        return;
      }

      // Get auction
      const auction = await Auction.findById(auctionId);
      
      if (!auction) {
        socket.emit('bid:error', { message: 'Auction not found' });
        return;
      }

      // Check auction status
      if (auction.status !== 'active' && auction.status !== 'private_room') {
        socket.emit('bid:error', { message: 'Auction is not active' });
        return;
      }

      // Check if auction has ended
      if (auction.endTime < new Date()) {
        socket.emit('bid:error', { message: 'Auction has ended' });
        return;
      }

      // Validate bid amount
      const minBidAmount = auction.currentBid + auction.minBidIncrement;
      if (amount < minBidAmount) {
        socket.emit('bid:error', {
          message: `Bid must be at least ${minBidAmount}`,
          minBid: minBidAmount,
        });
        return;
      }

      // Check if user is the seller
      if (auction.sellerId.toString() === socket.userId) {
        socket.emit('bid:error', { message: 'You cannot bid on your own auction' });
        return;
      }

      // Private room check
      if (auction.status === 'private_room') {
        const isParticipant = auction.privateRoomParticipants.some(
          (id) => id.toString() === socket.userId
        );
        
        if (!isParticipant) {
          socket.emit('bid:error', { message: 'You are not a participant in the private room' });
          return;
        }

        // Extend private room end time by 1 minute
        auction.endTime = new Date(Date.now() + config.auction.privateRoom.extendTimeMinutes * 60 * 1000);
        auction.privateRoomLastBidAt = new Date();
      }

      // Create bid
      const bid = await Bid.create({
        auctionId: auction._id,
        bidderId: socket.userId,
        amount,
        isAutoBid: isAutoBid || false,
        maxAutoBidAmount,
        isPrivateRoomBid: auction.status === 'private_room',
        ipAddress: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
      });

      // Get previous high bidder
      const previousHighBidderId = auction.currentBid > 0 
        ? (await Bid.findOne({ auctionId: auction._id, amount: auction.currentBid }).sort({ bidTime: -1 }))?.bidderId
        : null;

      // Check if this is a new unique bidder
      const existingBid = await Bid.findOne({
        auctionId: auction._id,
        bidderId: socket.userId,
        _id: { $ne: bid._id },
      });

      if (!existingBid) {
        auction.uniqueBidders += 1;
      }

      // Update auction
      auction.currentBid = amount;
      auction.totalBids += 1;
      await auction.save();

      // Update user stats
      await User.findByIdAndUpdate(socket.userId, {
        $inc: { 'stats.totalBidsPlaced': 1 },
      });

      // Update Redis cache
      const auctionData = {
        _id: auction._id,
        currentBid: auction.currentBid,
        totalBids: auction.totalBids,
        uniqueBidders: auction.uniqueBidders,
        endTime: auction.endTime,
        status: auction.status,
      };
      
      await redisClient.setEx(
        `auction:${auctionId}`,
        300,
        JSON.stringify(auctionData)
      );

      // Broadcast bid to all users in auction room
      io.to(`auction:${auctionId}`).emit('bid:new', {
        bidId: bid._id,
        auctionId: auction._id,
        amount: bid.amount,
        totalBids: auction.totalBids,
        uniqueBidders: auction.uniqueBidders,
        timestamp: bid.bidTime,
      });

      // Notify previous high bidder they've been outbid
      if (previousHighBidderId && previousHighBidderId.toString() !== socket.userId) {
        io.to(`user:${previousHighBidderId}`).emit('notification', {
          type: 'outbid',
          auctionId: auction._id,
          auctionTitle: auction.title,
          newBid: amount,
          message: 'You have been outbid!',
        });
      }

      // Send success to bidder
      socket.emit('bid:success', {
        bidId: bid._id,
        amount: bid.amount,
        auctionId: auction._id,
      });

      logger.info(`Bid placed: ${amount} on auction ${auctionId} by user ${socket.userId}`);
    } catch (error) {
      logger.error('Error placing bid:', error);
      socket.emit('bid:error', { message: 'Failed to place bid' });
    }
  });

  // Get auction bid history
  socket.on('auction:bid-history', async (auctionId: string) => {
    try {
      const bids = await Bid.find({ auctionId })
        .sort({ bidTime: -1 })
        .limit(50)
        .populate('bidderId', 'displayName reputationScore');

      socket.emit('auction:bid-history', bids);
    } catch (error) {
      logger.error('Error fetching bid history:', error);
      socket.emit('error', { message: 'Failed to fetch bid history' });
    }
  });
}

