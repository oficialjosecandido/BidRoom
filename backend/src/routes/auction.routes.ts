import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate, canBid, isSeller } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// Placeholder controller
const auctionController = {
  getAll: (req: any, res: any) => res.json({ message: 'Get all auctions - to be implemented' }),
  getById: (req: any, res: any) => res.json({ message: 'Get auction by ID - to be implemented' }),
  create: (req: any, res: any) => res.json({ message: 'Create auction - to be implemented' }),
  update: (req: any, res: any) => res.json({ message: 'Update auction - to be implemented' }),
  delete: (req: any, res: any) => res.json({ message: 'Delete auction - to be implemented' }),
  getEndingSoon: (req: any, res: any) => res.json({ message: 'Get ending soon - to be implemented' }),
  getPromoted: (req: any, res: any) => res.json({ message: 'Get promoted - to be implemented' }),
};

// Public routes
router.get(
  '/',
  validate([
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('category').optional().isString(),
    query('sortBy').optional().isIn(['endTime', 'currentBid', 'totalBids', 'createdAt']),
    query('order').optional().isIn(['asc', 'desc']),
  ]),
  auctionController.getAll
);

router.get(
  '/ending-soon',
  validate([query('limit').optional().isInt({ min: 1, max: 50 })]),
  auctionController.getEndingSoon
);

router.get(
  '/promoted',
  validate([query('limit').optional().isInt({ min: 1, max: 20 })]),
  auctionController.getPromoted
);

router.get(
  '/:id',
  validate([param('id').isMongoId().withMessage('Invalid auction ID')]),
  auctionController.getById
);

// Protected routes (require authentication)
router.post(
  '/',
  authenticate(),
  validate([
    body('title').notEmpty().trim().isLength({ max: 200 }),
    body('description').notEmpty().trim().isLength({ max: 5000 }),
    body('category').notEmpty(),
    body('startingBid').isFloat({ min: 0 }),
    body('duration').isIn(['2h', '24h', '3d', '7d']),
    body('format').isIn(['highest_bid', 'best_offer']),
    body('buyNowPrice').optional().isFloat({ min: 0 }),
    body('reservePrice').optional().isFloat({ min: 0 }),
    body('allowPrivateRoom').optional().isBoolean(),
  ]),
  auctionController.create
);

router.put(
  '/:id',
  authenticate(),
  validate([param('id').isMongoId()]),
  auctionController.update
);

router.delete(
  '/:id',
  authenticate(),
  validate([param('id').isMongoId()]),
  auctionController.delete
);

export default router;

