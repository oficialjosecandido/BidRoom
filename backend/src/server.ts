import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import mongoose from 'mongoose';
import { createClient, RedisClientType } from 'redis';
import config from './config';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/error.middleware';
import { setupMiddleware } from './middleware';
import { setupRoutes } from './routes';
import { setupSocketIO } from './sockets';

// Load environment variables
dotenv.config();

class Application {
  public app: express.Application;
  public server: http.Server;
  public io: SocketIOServer;
  public redisClient: RedisClientType;

  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: config.cors.origin,
        credentials: true,
      },
    });
    this.redisClient = createClient({
      url: config.redis.url,
      password: config.redis.password,
    });
  }

  private async connectDatabase(): Promise<void> {
    try {
      await mongoose.connect(config.mongodb.uri);
      logger.info('✅ MongoDB connected successfully');
    } catch (error) {
      logger.error('❌ MongoDB connection error:', error);
      process.exit(1);
    }
  }

  private async connectRedis(): Promise<void> {
    try {
      await this.redisClient.connect();
      logger.info('✅ Redis connected successfully');
    } catch (error) {
      logger.error('❌ Redis connection error:', error);
      process.exit(1);
    }
  }

  private setupMiddleware(): void {
    setupMiddleware(this.app);
  }

  private setupRoutes(): void {
    setupRoutes(this.app);
  }

  private setupSockets(): void {
    setupSocketIO(this.io, this.redisClient);
  }

  private setupErrorHandling(): void {
    // 404 handler
    this.app.use((_req, res) => {
      res.status(404).json({
        success: false,
        message: 'Route not found',
      });
    });

    // Global error handler
    this.app.use(errorHandler);
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`${signal} signal received: closing HTTP server`);
      
      this.server.close(async () => {
        logger.info('HTTP server closed');

        try {
          await mongoose.connection.close();
          logger.info('MongoDB connection closed');

          await this.redisClient.quit();
          logger.info('Redis connection closed');

          process.exit(0);
        } catch (error) {
          logger.error('Error during graceful shutdown:', error);
          process.exit(1);
        }
      });

      // Force close after 10 seconds
      setTimeout(() => {
        logger.error('Forcing shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  public async initialize(): Promise<void> {
    try {
      // Connect to databases
      await this.connectDatabase();
      await this.connectRedis();

      // Setup application
      this.setupMiddleware();
      this.setupRoutes();
      this.setupSockets();
      this.setupErrorHandling();
      this.setupGracefulShutdown();

      // Start server
      this.server.listen(config.port, () => {
        logger.info(`
╔═══════════════════════════════════════════════╗
║                                               ║
║   🎯 Bidroom API Server                       ║
║                                               ║
║   Environment: ${config.env.padEnd(30)}║
║   Port: ${config.port.toString().padEnd(37)}║
║   URL: ${config.apiUrl.padEnd(38)}║
║                                               ║
║   Verified Value. Decisive Win.               ║
║                                               ║
╚═══════════════════════════════════════════════╝
        `);
      });
    } catch (error) {
      logger.error('Failed to initialize application:', error);
      process.exit(1);
    }
  }
}

// Initialize and start application
const application = new Application();
application.initialize().catch((error) => {
  logger.error('Application initialization failed:', error);
  process.exit(1);
});

export default application;

