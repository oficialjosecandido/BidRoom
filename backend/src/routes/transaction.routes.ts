import { Router } from 'express';
import { param } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// Placeholder controller
const transactionController = {
  getAll: (req: any, res: any) => res.json({ message: 'Get transactions - to be implemented' }),
  getById: (req: any, res: any) => res.json({ message: 'Get transaction - to be implemented' }),
  getSelling: (req: any, res: any) => res.json({ message: 'Get selling transactions - to be implemented' }),
  getBuying: (req: any, res: any) => res.json({ message: 'Get buying transactions - to be implemented' }),
};

// Get all user transactions
router.get('/', authenticate(), transactionController.getAll);

// Get specific transaction
router.get(
  '/:id',
  authenticate(),
  validate([param('id').isMongoId()]),
  transactionController.getById
);

// Get selling transactions
router.get('/selling/me', authenticate(), transactionController.getSelling);

// Get buying transactions
router.get('/buying/me', authenticate(), transactionController.getBuying);

export default router;

