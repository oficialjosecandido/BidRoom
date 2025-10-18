import { Request, Response, NextFunction } from 'express';
import { Strategy as JwtStrategy, ExtractJwt, VerifiedCallback } from 'passport-jwt';
import { IUser } from '../models/User.model';
import config from '../config';
import { logger } from '../utils/logger';
import User from '../models/User.model';

// Azure AD JWT Strategy
export class AzureADStrategy extends JwtStrategy {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.azureAdB2C.clientSecret,
      issuer: `https://login.microsoftonline.com/${config.azureAdB2C.tenantId}/v2.0`,
      audience: config.azureAdB2C.clientId,
      algorithms: ['RS256'],
      passReqToCallback: true,
    }, async (_req: Request, payload: any, done: VerifiedCallback) => {
      try {
        // Extract user info from Azure AD token
        const azureObjectId = payload.sub || payload.oid;
        const email = payload.email || payload.preferred_username;
        const firstName = payload.given_name || payload.firstName;
        const lastName = payload.family_name || payload.lastName;
        const displayName = payload.name || payload.display_name || `${firstName} ${lastName}`;

        if (!azureObjectId || !email) {
          return done(new Error('Missing required user information from token'), false);
        }

        // Find or create user
        let user = await User.findOne({ azureAdB2CId: azureObjectId });

        if (!user) {
          // Create new user from Azure AD data
          user = new User({
            azureAdB2CId: azureObjectId,
            email: email.toLowerCase(),
            firstName,
            lastName,
            displayName,
            verificationLevel: 'basic',
            isActive: true,
            lastLoginAt: new Date(),
          });

          await user.save();
          logger.info(`New user created from Azure AD: ${email}`);
        } else {
          // Update last login time
          user.lastLoginAt = new Date();
          await user.save();
        }

        return done(null, user);
      } catch (error) {
        logger.error('Azure AD authentication error:', error);
        return done(error, false);
      }
    });
  }
}

// Traditional JWT Strategy for email/password auth
export class LocalJwtStrategy extends JwtStrategy {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.jwt.secret,
      algorithms: ['HS256'],
      passReqToCallback: true,
    }, async (_req: Request, payload: any, done: VerifiedCallback) => {
      try {
        const user = await User.findById(payload.userId);
        
        if (!user) {
          return done(new Error('User not found'), false);
        }

        if (!user.isActive) {
          return done(new Error('User account is inactive'), false);
        }

        if (user.isSuspended) {
          return done(new Error('User account is suspended'), false);
        }

        return done(null, user);
      } catch (error) {
        logger.error('Local JWT authentication error:', error);
        return done(error, false);
      }
    });
  }
}

// Middleware to check authentication
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please log in to access this resource'
    });
    return;
  }
  next();
};

// Middleware to check if user can bid
export const requireBiddingAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please log in to place bids'
    });
    return;
  }

  const user = req.user as IUser;
  
  // Check if user has valid pre-authorization
  if (!user.preAuthStatus?.isAuthorized) {
    res.status(403).json({
      error: 'Bidding not authorized',
      message: 'Please complete payment verification to place bids',
      requiredAction: 'payment_verification'
    });
    return;
  }

  // Check if pre-authorization is still valid
  if (user.preAuthStatus.expiresAt && new Date(user.preAuthStatus.expiresAt) < new Date()) {
    res.status(403).json({
      error: 'Bidding authorization expired',
      message: 'Please renew your payment verification to place bids',
      requiredAction: 'payment_verification'
    });
    return;
  }

  next();
};

// Middleware to check admin privileges
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'Please log in to access this resource'
    });
    return;
  }

  const user = req.user as IUser;
  
  if (user.verificationLevel !== 'premium') {
    res.status(403).json({
      error: 'Admin privileges required',
      message: 'This action requires admin privileges'
    });
    return;
  }

  next();
};

// Middleware to check specific bidding tier
export const requireBiddingTier = (tier: 'basic' | 'advanced' | 'premium') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ 
        error: 'Authentication required',
        message: 'Please log in to access this resource'
      });
      return;
    }

    const user = req.user as IUser;
    
    const tierLevels = { basic: 0, advanced: 1, premium: 2 };
    const userTierLevel = tierLevels[user.verificationLevel];
    const requiredTierLevel = tierLevels[tier];

    if (userTierLevel < requiredTierLevel) {
      res.status(403).json({
        error: 'Insufficient verification level',
        message: `This action requires ${tier} verification level`,
        currentTier: user.verificationLevel,
        requiredTier: tier
      });
      return;
    }

    next();
  };
};