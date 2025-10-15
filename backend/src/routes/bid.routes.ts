import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, canBid } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';
import { bidLimiter } from '../middleware/ratelimit.middleware';

const router = Router();

// Placeholder controller
const bidController = {
  placeBid: (req: any, res: any) => res.json({ message: 'Place bid - to be implemented' }),
  getAuctionBids: (req: any, res: any) => res.json({ message: 'Get auction bids - to be implemented' }),
  getUserBids: (req: any, res: any) => res.json({ message: 'Get user bids - to be implemented' }),
};

// Place a bid
router.post(
  '/',
  authenticate(),
  canBid,
  bidLimiter,
  validate([
    body('auctionId').isMongoId().withMessage('Invalid auction ID'),
    body('amount').isFloat({ min: 0 }).withMessage('Invalid bid amount'),
    body('isAutoBid').optional().isBoolean(),
    body('maxAutoBidAmount').optional().isFloat({ min: 0 }),
  ]),
  bidController.placeBid
);

// Get bids for an auction
router.get(
  '/auction/:auctionId',
  validate([
    param('auctionId').isMongoId(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ]),
  bidController.getAuctionBids
);

// Get user's bids
router.get(
  '/user/me',
  authenticate(),
  validate([
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ]),
  bidController.getUserBids
);

export default router;

