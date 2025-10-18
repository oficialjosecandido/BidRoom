import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// Mock auction data
const mockAuctions = [
  {
    id: '1',
    title: 'Vintage Camera Collection',
    description: 'Beautiful collection of vintage cameras from the 1950s-1970s',
    category: 'Electronics',
    startingPrice: 100,
    currentPrice: 150,
    endTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    images: ['https://via.placeholder.com/300x200?text=Vintage+Camera'],
    seller: { id: 'seller1', name: 'Camera Collector' },
    isActive: true,
    bidCount: 5,
    isPromoted: false,
    isEndingSoon: false
  },
  {
    id: '2',
    title: 'Antique Furniture Set',
    description: 'Elegant antique furniture from the 1800s',
    category: 'Furniture',
    startingPrice: 500,
    currentPrice: 750,
    endTime: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    images: ['https://via.placeholder.com/300x200?text=Antique+Furniture'],
    seller: { id: 'seller2', name: 'Antique Dealer' },
    isActive: true,
    bidCount: 12,
    isPromoted: false,
    isEndingSoon: false
  },
  {
    id: '3',
    title: 'Rare Book Collection',
    description: 'First edition books from famous authors',
    category: 'Books',
    startingPrice: 200,
    currentPrice: 320,
    endTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2 hours
    images: ['https://via.placeholder.com/300x200?text=Rare+Books'],
    seller: { id: 'seller3', name: 'Book Collector' },
    isActive: true,
    bidCount: 8,
    isPromoted: false,
    isEndingSoon: true
  },
  {
    id: '4',
    title: 'Luxury Watch Collection',
    description: 'Premium luxury watches from top brands',
    category: 'Luxury',
    startingPrice: 1000,
    currentPrice: 1500,
    endTime: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(), // 3 days
    images: ['https://via.placeholder.com/300x200?text=Luxury+Watch'],
    seller: { id: 'seller4', name: 'Watch Expert' },
    isActive: true,
    bidCount: 15,
    isPromoted: true,
    isEndingSoon: false
  },
  {
    id: '5',
    title: 'Art Deco Jewelry',
    description: 'Stunning Art Deco jewelry pieces from the 1920s',
    category: 'Jewelry',
    startingPrice: 300,
    currentPrice: 450,
    endTime: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours
    images: ['https://via.placeholder.com/300x200?text=Art+Deco+Jewelry'],
    seller: { id: 'seller5', name: 'Jewelry Specialist' },
    isActive: true,
    bidCount: 7,
    isPromoted: true,
    isEndingSoon: true
  }
];

// Placeholder controller
const auctionController = {
  getAll: (_req: any, res: any) => res.json(mockAuctions),
  getById: (_req: any, res: any) => res.json(mockAuctions[0]),
  create: (_req: any, res: any) => res.json({ message: 'Create auction - to be implemented' }),
  update: (_req: any, res: any) => res.json({ message: 'Update auction - to be implemented' }),
  delete: (_req: any, res: any) => res.json({ message: 'Delete auction - to be implemented' }),
  getEndingSoon: (_req: any, res: any) => res.json(mockAuctions.filter(auction => auction.isEndingSoon)),
  getPromoted: (_req: any, res: any) => res.json(mockAuctions.filter(auction => auction.isPromoted)),
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

