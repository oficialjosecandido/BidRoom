import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import config from '../config';
import { logger } from '../utils/logger';

export function setupMiddleware(app: Application): void {
  // Security headers
  app.use(helmet());

  // CORS configuration
  app.use(
    cors({
      origin: config.cors.origin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Compression
  app.use(compression());

  // HTTP request logging
  const morganFormat = config.env === 'production' ? 'combined' : 'dev';
  app.use(
    morgan(morganFormat, {
      stream: {
        write: (message: string) => {
          logger.info(message.trim());
        },
      },
    })
  );

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
    });
  });

  // API info endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Bidroom API',
      version: '1.0.0',
      description: 'Real-time auction platform API',
      documentation: '/api/docs',
    });
  });
}

