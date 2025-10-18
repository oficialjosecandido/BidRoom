import { Server as SocketIOServer, Socket } from 'socket.io';
import { RedisClientType } from 'redis';
import { logger } from '../utils/logger';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
}

interface NotificationData {
  type: 'outbid' | 'auction_ending' | 'auction_won' | 'message' | 'dispute' | 'payment';
  title: string;
  message: string;
  data?: any;
}

export function setupNotificationHandlers(
  _io: SocketIOServer,
  socket: AuthenticatedSocket,
  redisClient: RedisClientType<any>
): void {
  
  // Mark notification as read
  socket.on('notification:read', async (notificationId: string) => {
    try {
      // Store read notification in Redis
      const key = `notification:read:${socket.userId}:${notificationId}`;
      await redisClient.setEx(key, 86400 * 30, '1'); // 30 days

      socket.emit('notification:read:success', { notificationId });
      logger.info(`Notification ${notificationId} marked as read by user ${socket.userId}`);
    } catch (error) {
      logger.error('Error marking notification as read:', error);
    }
  });

  // Get unread notification count
  socket.on('notification:count', async () => {
    try {
      // This would typically query a notifications collection
      // For now, sending a placeholder response
      socket.emit('notification:count', { count: 0 });
    } catch (error) {
      logger.error('Error getting notification count:', error);
    }
  });
}

// Helper function to send notification to a specific user
export async function sendNotificationToUser(
  io: SocketIOServer,
  userId: string,
  notification: NotificationData
): Promise<void> {
  try {
    io.to(`user:${userId}`).emit('notification', notification);
    logger.info(`Notification sent to user ${userId}:`, notification.type);
  } catch (error) {
    logger.error('Error sending notification:', error);
  }
}

// Helper function to broadcast notification to auction room
export async function sendNotificationToAuction(
  io: SocketIOServer,
  auctionId: string,
  notification: NotificationData
): Promise<void> {
  try {
    io.to(`auction:${auctionId}`).emit('notification', notification);
    logger.info(`Notification sent to auction ${auctionId}:`, notification.type);
  } catch (error) {
    logger.error('Error sending notification:', error);
  }
}

