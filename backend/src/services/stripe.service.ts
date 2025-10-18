import Stripe from 'stripe';
import config from '../config';
import { logger } from '../utils/logger';
import User, { IUser } from '../models/User.model';
import { PreAuthRequest } from '../types/payment.types';

export interface PreAuthResult {
  preAuthId: string;
  clientSecret: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed';
  expiresAt: Date;
}

export interface ConfirmPreAuthResult {
  success: boolean;
  paymentIntentId?: string;
  error?: string;
}

export class StripeService {
  private stripe: Stripe;

  constructor() {
    this.stripe = new Stripe(config.stripe.secretKey, {
      apiVersion: '2023-10-16',
    });
  }

  /**
   * Create a customer in Stripe
   */
  async createCustomer(user: IUser): Promise<string> {
    try {
      const customer = await this.stripe.customers.create({
        email: user.email,
        name: user.displayName,
        metadata: {
          userId: (user._id as any).toString(),
          azureObjectId: user.azureAdB2CId,
        },
      });

      logger.info(`Stripe customer created: ${customer.id} for user: ${user.email}`);
      return customer.id;
    } catch (error) {
      logger.error('Error creating Stripe customer:', error);
      throw new Error('Failed to create payment customer');
    }
  }

  /**
   * Create a pre-authorization hold
   */
  async createPreAuthorization(
    user: IUser,
    request: PreAuthRequest
  ): Promise<PreAuthResult> {
    try {
      let customerId = user.stripeCustomerId;

      // Create customer if doesn't exist
      if (!customerId) {
        customerId = await this.createCustomer(user);
        user.stripeCustomerId = customerId;
        await user.save();
      }

      // Create payment intent for pre-authorization
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(request.amount * 100), // Convert to cents
        currency: request.currency || 'usd',
        customer: customerId,
        capture_method: 'manual', // Don't capture immediately
        metadata: {
          userId: (user._id as any).toString(),
          type: 'pre_authorization',
          auctionId: request.auctionId || 'general',
        },
        description: `Pre-authorization for ${user.email}`,
        confirm: false, // Don't confirm immediately
      });

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 days expiry

      const result: PreAuthResult = {
        preAuthId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret!,
        amount: request.amount,
        status: 'pending',
        expiresAt,
      };

      logger.info(`Pre-authorization created: ${paymentIntent.id} for user: ${user.email}`);
      return result;
    } catch (error) {
      logger.error('Error creating pre-authorization:', error);
      throw new Error('Failed to create pre-authorization');
    }
  }

  /**
   * Confirm a pre-authorization with payment method
   */
  async confirmPreAuthorization(
    preAuthId: string,
    paymentMethodId: string,
    user: IUser
  ): Promise<ConfirmPreAuthResult> {
    try {
      // Confirm the payment intent
      const paymentIntent = await this.stripe.paymentIntents.confirm(preAuthId, {
        payment_method: paymentMethodId,
      });

      if (paymentIntent.status === 'requires_capture') {
        // Update user's pre-auth status
        user.preAuthStatus = {
          isAuthorized: true,
          authorizedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          amount: paymentIntent.amount / 100, // Convert back to dollars
          stripePaymentIntentId: paymentIntent.id,
        };

        await user.save();

        logger.info(`Pre-authorization confirmed: ${preAuthId} for user: ${user.email}`);
        
        return {
          success: true,
          paymentIntentId: paymentIntent.id,
        };
      } else {
        logger.error(`Payment intent not in correct state: ${paymentIntent.status}`);
        return {
          success: false,
          error: 'Payment confirmation failed',
        };
      }
    } catch (error) {
      logger.error('Error confirming pre-authorization:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Release a pre-authorization hold
   */
  async releasePreAuthorization(preAuthId: string, user: IUser): Promise<boolean> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.cancel(preAuthId);

      if (paymentIntent.status === 'canceled') {
        // Update user's pre-auth status
        user.preAuthStatus = {
          isAuthorized: false,
          amount: 0,
        };
        user.preAuthStatus.stripePaymentIntentId = undefined;

        await user.save();

        logger.info(`Pre-authorization released: ${preAuthId} for user: ${user.email}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error releasing pre-authorization:', error);
      return false;
    }
  }

  /**
   * Capture a pre-authorization (when user wins auction)
   */
  async capturePreAuthorization(
    preAuthId: string,
    amount: number,
    _user: IUser
  ): Promise<boolean> {
    try {
      const paymentIntent = await this.stripe.paymentIntents.capture(preAuthId, {
        amount_to_capture: Math.round(amount * 100), // Convert to cents
      });

      if (paymentIntent.status === 'succeeded') {
        logger.info(`Pre-authorization captured: ${preAuthId} for amount: $${amount}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error capturing pre-authorization:', error);
      return false;
    }
  }

  /**
   * Get payment methods for a customer
   */
  async getPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: 'card',
      });

      return paymentMethods.data;
    } catch (error) {
      logger.error('Error fetching payment methods:', error);
      return [];
    }
  }

  /**
   * Create setup intent for saving payment method without charging
   */
  async createSetupIntent(customerId: string): Promise<string> {
    try {
      const setupIntent = await this.stripe.setupIntents.create({
        customer: customerId,
        payment_method_types: ['card'],
        usage: 'off_session',
      });

      return setupIntent.client_secret!;
    } catch (error) {
      logger.error('Error creating setup intent:', error);
      throw new Error('Failed to create payment setup');
    }
  }

  /**
   * Check if user can bid on specific auction
   */
  async canBidOnAuction(
    user: IUser,
    _auctionId: string,
    bidAmount: number
  ): Promise<{ canBid: boolean; reason?: string }> {
    // Check if user is active
    if (!user.isActive || user.isSuspended) {
      return { canBid: false, reason: 'Account is inactive or suspended' };
    }

    // Check pre-authorization status
    if (!user.preAuthStatus.isAuthorized) {
      return { canBid: false, reason: 'Payment verification required' };
    }

    // Check expiry
    if (user.preAuthStatus.expiresAt && user.preAuthStatus.expiresAt < new Date()) {
      return { canBid: false, reason: 'Payment authorization expired' };
    }

    // Check verification level
    if (user.verificationLevel === 'basic') {
      return { canBid: false, reason: 'Basic tier cannot bid' };
    }

    // Check amount limits based on tier
    if (user.verificationLevel === 'advanced') {
      const maxBidAmount = user.preAuthStatus.amount || 0;
      if (bidAmount > maxBidAmount) {
        return { 
          canBid: false, 
          reason: `Bid amount exceeds pre-authorized limit of $${maxBidAmount}` 
        };
      }
    }

    return { canBid: true };
  }

  /**
   * Update user's verification tier
   */
  async updateVerificationTier(
    user: IUser,
    tier: 'basic' | 'advanced' | 'premium'
  ): Promise<boolean> {
    try {
      user.verificationLevel = tier;
      await user.save();

      logger.info(`User ${user.email} verification tier updated to: ${tier}`);
      return true;
    } catch (error) {
      logger.error('Error updating verification tier:', error);
      return false;
    }
  }

  /**
   * Handle webhook events from Stripe
   */
  async handleWebhook(event: Stripe.Event): Promise<void> {
    try {
      switch (event.type) {
        case 'payment_intent.succeeded':
          await this.handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.payment_failed':
          await this.handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
          break;
        case 'payment_intent.canceled':
          await this.handlePaymentIntentCanceled(event.data.object as Stripe.PaymentIntent);
          break;
        default:
          logger.info(`Unhandled Stripe webhook event: ${event.type}`);
      }
    } catch (error) {
      logger.error('Error handling Stripe webhook:', error);
    }
  }

  private async handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const userId = paymentIntent.metadata?.userId;
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        user.preAuthStatus.isAuthorized = true;
        user.preAuthStatus.authorizedAt = new Date();
        await user.save();
        logger.info(`Payment intent succeeded for user: ${user.email}`);
      }
    }
  }

  private async handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const userId = paymentIntent.metadata?.userId;
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        user.preAuthStatus.isAuthorized = false;
        await user.save();
        logger.info(`Payment intent failed for user: ${user.email}`);
      }
    }
  }

  private async handlePaymentIntentCanceled(paymentIntent: Stripe.PaymentIntent): Promise<void> {
    const userId = paymentIntent.metadata?.userId;
    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        user.preAuthStatus.isAuthorized = false;
        await user.save();
        logger.info(`Payment intent canceled for user: ${user.email}`);
      }
    }
  }
}

export const stripeService = new StripeService();
