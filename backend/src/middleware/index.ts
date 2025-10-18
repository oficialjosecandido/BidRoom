import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import passport from 'passport';
import config from '../config';
import { logger } from '../utils/logger';
import { sanitizeHtml } from './sanitization.middleware';
import { 
  preventParameterPollution, 
  addSecurityHeaders, 
  validateRequestSize,
  requestTimeout 
} from './security.middleware';
import { AzureADStrategy, LocalJwtStrategy } from './azure-auth.middleware';

export function setupMiddleware(app: Application): void {
  // Security headers with enhanced configuration
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "blob:"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'", config.apiUrl, config.frontendUrl],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

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

  // Initialize Passport
  app.use(passport.initialize());

  // Configure Passport strategies
  passport.use(new AzureADStrategy());
  passport.use(new LocalJwtStrategy());

  // Input sanitization
  app.use(sanitizeHtml);

  // Additional security middleware
  app.use(preventParameterPollution);
  app.use(addSecurityHeaders);
  app.use(validateRequestSize());
  app.use(requestTimeout());

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
  app.get('/health', (_req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: config.env,
    });
  });

  // API info endpoint
  app.get('/', (_req, res) => {
    res.json({
      name: 'Bidroom API',
      version: '1.0.0',
      description: 'Real-time auction platform API',
      documentation: '/api/docs',
    });
  });
}

