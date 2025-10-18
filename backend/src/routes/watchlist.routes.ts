import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// Placeholder controller
const watchlistController = {
  getAll: (_req: any, res: any) => res.json({ message: 'Get watchlist - to be implemented' }),
  add: (_req: any, res: any) => res.json({ message: 'Add to watchlist - to be implemented' }),
  remove: (_req: any, res: any) => res.json({ message: 'Remove from watchlist - to be implemented' }),
  update: (_req: any, res: any) => res.json({ message: 'Update watchlist item - to be implemented' }),
};

// Get user's watchlist
router.get('/', authenticate(), watchlistController.getAll);

// Add auction to watchlist
router.post(
  '/',
  authenticate(),
  validate([body('auctionId').isMongoId().withMessage('Invalid auction ID')]),
  watchlistController.add
);

// Remove auction from watchlist
router.delete(
  '/:auctionId',
  authenticate(),
  validate([param('auctionId').isMongoId()]),
  watchlistController.remove
);

// Update watchlist item notifications
router.put(
  '/:auctionId',
  authenticate(),
  validate([
    param('auctionId').isMongoId(),
    body('notifyOnBid').optional().isBoolean(),
    body('notifyBeforeEnd').optional().isBoolean(),
  ]),
  watchlistController.update
);

export default router;

