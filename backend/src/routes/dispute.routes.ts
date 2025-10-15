import { Router } from 'express';
import { body, param } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// Placeholder controller
const disputeController = {
  getAll: (req: any, res: any) => res.json({ message: 'Get disputes - to be implemented' }),
  getById: (req: any, res: any) => res.json({ message: 'Get dispute - to be implemented' }),
  create: (req: any, res: any) => res.json({ message: 'Create dispute - to be implemented' }),
  addMessage: (req: any, res: any) => res.json({ message: 'Add message - to be implemented' }),
  uploadEvidence: (req: any, res: any) => res.json({ message: 'Upload evidence - to be implemented' }),
};

// Get user's disputes
router.get('/', authenticate(), disputeController.getAll);

// Get specific dispute
router.get(
  '/:id',
  authenticate(),
  validate([param('id').isMongoId()]),
  disputeController.getById
);

// Create dispute
router.post(
  '/',
  authenticate(),
  validate([
    body('transactionId').isMongoId(),
    body('reason').isIn([
      'item_not_received',
      'item_not_as_described',
      'damaged_item',
      'payment_issue',
      'seller_not_responding',
      'buyer_not_paying',
      'other',
    ]),
    body('description').notEmpty().isLength({ max: 2000 }),
  ]),
  disputeController.create
);

// Add message to dispute
router.post(
  '/:id/messages',
  authenticate(),
  validate([
    param('id').isMongoId(),
    body('message').notEmpty().isLength({ max: 1000 }),
  ]),
  disputeController.addMessage
);

// Upload evidence
router.post(
  '/:id/evidence',
  authenticate(),
  validate([param('id').isMongoId()]),
  disputeController.uploadEvidence
);

export default router;

