import { Application, Router } from 'express';
import { apiLimiter } from '../middleware/ratelimit.middleware';
import authRoutes from './auth.routes';
import auctionRoutes from './auction.routes';
import bidRoutes from './bid.routes';
import userRoutes from './user.routes';
import watchlistRoutes from './watchlist.routes';
import transactionRoutes from './transaction.routes';
import disputeRoutes from './dispute.routes';

export function setupRoutes(app: Application): void {
  const apiRouter = Router();

  // Apply rate limiting to all API routes
  apiRouter.use(apiLimiter);

  // Mount routes
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/auctions', auctionRoutes);
  apiRouter.use('/bids', bidRoutes);
  apiRouter.use('/users', userRoutes);
  apiRouter.use('/watchlist', watchlistRoutes);
  apiRouter.use('/transactions', transactionRoutes);
  apiRouter.use('/disputes', disputeRoutes);

  // Mount API router
  app.use('/api/v1', apiRouter);
}

