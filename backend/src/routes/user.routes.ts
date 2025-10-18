import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware';
import { validate } from '../middleware/validation.middleware';

const router = Router();

// Placeholder controller
const userController = {
  getProfile: (req: any, res: any) => res.json({ user: req.user }),
  updateProfile: (_req: any, res: any) => res.json({ message: 'Update profile - to be implemented' }),
  getStats: (_req: any, res: any) => res.json({ message: 'Get stats - to be implemented' }),
  getPaymentMethods: (_req: any, res: any) => res.json({ message: 'Get payment methods - to be implemented' }),
  addPaymentMethod: (_req: any, res: any) => res.json({ message: 'Add payment method - to be implemented' }),
  removePaymentMethod: (_req: any, res: any) => res.json({ message: 'Remove payment method - to be implemented' }),
  updatePreAuth: (_req: any, res: any) => res.json({ message: 'Update pre-auth - to be implemented' }),
  getNotificationPreferences: (req: any, res: any) => res.json({ preferences: req.user.notificationPreferences }),
  updateNotificationPreferences: (_req: any, res: any) => res.json({ message: 'Update preferences - to be implemented' }),
};

// Get current user profile
router.get('/me', authenticate(), userController.getProfile);

// Update user profile
router.put(
  '/me',
  authenticate(),
  validate([
    body('firstName').optional().trim().isLength({ min: 1, max: 50 }),
    body('lastName').optional().trim().isLength({ min: 1, max: 50 }),
    body('phoneNumber').optional().trim().isMobilePhone('any'),
  ]),
  userController.updateProfile
);

// Get user stats
router.get('/me/stats', authenticate(), userController.getStats);

// Payment methods
router.get('/me/payment-methods', authenticate(), userController.getPaymentMethods);
router.post('/me/payment-methods', authenticate(), userController.addPaymentMethod);
router.delete('/me/payment-methods/:id', authenticate(), userController.removePaymentMethod);

// Pre-authorization
router.post('/me/pre-auth', authenticate(), userController.updatePreAuth);

// Notification preferences
router.get('/me/notifications', authenticate(), userController.getNotificationPreferences);
router.put('/me/notifications', authenticate(), userController.updateNotificationPreferences);

export default router;

