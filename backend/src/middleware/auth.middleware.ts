import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import passport from 'passport';
import { Strategy as JwtStrategy, ExtractJwt, StrategyOptions } from 'passport-jwt';
import { BearerStrategy } from 'passport-azure-ad';
import config from '../config';
import { User, IUser } from '../models';
import { AppError } from './error.middleware';
import { logger } from '../utils/logger';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface User extends IUser {}
    interface Request {
      user?: IUser;
    }
  }
}

// JWT Strategy for internal token validation
const jwtOptions: StrategyOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: config.jwt.secret,
};

passport.use(
  'jwt',
  new JwtStrategy(jwtOptions, async (jwtPayload, done) => {
    try {
      const user = await User.findById(jwtPayload.id);
      
      if (!user) {
        return done(null, false);
      }

      if (!user.isActive || user.isSuspended) {
        return done(null, false);
      }

      return done(null, user);
    } catch (error) {
      return done(error, false);
    }
  })
);

// Azure AD B2C Strategy
const azureAdB2COptions = {
  identityMetadata: `https://${config.azureAdB2C.tenantName}.b2clogin.com/${config.azureAdB2C.tenantName}.onmicrosoft.com/${config.azureAdB2C.policyName}/v2.0/.well-known/openid-configuration`,
  clientID: config.azureAdB2C.clientId,
  audience: config.azureAdB2C.clientId,
  policyName: config.azureAdB2C.policyName,
  isB2C: true,
  validateIssuer: true,
  loggingLevel: 'info' as const,
  passReqToCallback: false,
};

if (config.azureAdB2C.clientId && config.azureAdB2C.tenantName) {
  passport.use(
    'azure-ad-b2c',
    new BearerStrategy(azureAdB2COptions, async (token: any, done: any) => {
      try {
        // Find or create user based on Azure AD B2C token
        let user = await User.findOne({ azureAdB2CId: token.oid });

        if (!user) {
          // Create new user from Azure AD B2C token
          user = await User.create({
            azureAdB2CId: token.oid,
            email: token.emails?.[0] || token.email,
            firstName: token.given_name || 'User',
            lastName: token.family_name || '',
            displayName: token.name || 'User',
          });
          logger.info(`New user created from Azure AD B2C: ${user.email}`);
        }

        if (!user.isActive || user.isSuspended) {
          return done(null, false);
        }

        return done(null, user);
      } catch (error) {
        logger.error('Azure AD B2C authentication error:', error);
        return done(error, false);
      }
    })
  );
}

// Middleware to protect routes
export const authenticate = (strategy: 'jwt' | 'azure-ad-b2c' = 'jwt') => {
  return (req: Request, res: Response, next: NextFunction) => {
    passport.authenticate(strategy, { session: false }, (err: Error, user: IUser, info: any) => {
      if (err) {
        return next(err);
      }

      if (!user) {
        return next(new AppError('Unauthorized', 401));
      }

      req.user = user;
      next();
    })(req, res, next);
  };
};

// Middleware to check if user can bid
export const canBid = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return next(new AppError('Unauthorized', 401));
  }

  if (!req.user.canBid()) {
    return next(
      new AppError(
        'You cannot bid. Please ensure your account is active and you have a valid payment authorization.',
        403
      )
    );
  }

  next();
};

// Middleware to check if user is seller of auction
export const isSeller = (auctionSellerIdField: string = 'auction.sellerId') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401));
    }

    // Extract sellerId from request context
    const parts = auctionSellerIdField.split('.');
    let sellerId: any = req;
    
    for (const part of parts) {
      sellerId = sellerId?.[part];
    }

    if (!sellerId || sellerId.toString() !== req.user._id.toString()) {
      return next(new AppError('Forbidden: You are not the seller of this auction', 403));
    }

    next();
  };
};

// Generate JWT token
export const generateToken = (user: IUser): string => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiresIn,
    }
  );
};

// Generate refresh token
export const generateRefreshToken = (user: IUser): string => {
  return jwt.sign(
    {
      id: user._id,
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.refreshExpiresIn,
    }
  );
};

export default passport;

