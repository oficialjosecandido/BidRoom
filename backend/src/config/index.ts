import dotenv from 'dotenv';

dotenv.config();

interface Config {
  env: string;
  port: number;
  apiUrl: string;
  frontendUrl: string;
  
  mongodb: {
    uri: string;
  };
  
  redis: {
    url: string;
    host: string;
    port: number;
    password?: string;
    tls?: boolean;
  };
  
  jwt: {
    secret: string;
    expiresIn: string;
    refreshExpiresIn: string;
  };
  
  azureAdB2C: {
    tenantName: string;
    clientId: string;
    clientSecret: string;
    policyName: string;
    redirectUri: string;
  };
  
  azureStorage: {
    connectionString: string;
    containerName: string;
  };
  
  stripe: {
    secretKey: string;
    webhookSecret: string;
  };
  
  auction: {
    minBidIncrement: number;
    privateRoom: {
      minBidders: number;
      topBidders: number;
      extendTimeMinutes: number;
      noBidCloseMinutes: number;
    };
    preAuth: {
      amount: number;
      validityDays: number;
    };
    commission: {
      noPrivateRoom: number;
      withPrivateRoom: number;
    };
  };
  
  cors: {
    origin: string | string[];
  };
  
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiUrl: process.env.BACKEND_URL || 'http://localhost:3000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:4200',
  
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/bidroom',
  },
  
  redis: {
    url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS_ENABLED === 'true',
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  
  azureAdB2C: {
    tenantName: process.env.AZURE_AD_B2C_TENANT_NAME || '',
    clientId: process.env.AZURE_AD_B2C_CLIENT_ID || '',
    clientSecret: process.env.AZURE_AD_B2C_CLIENT_SECRET || '',
    policyName: process.env.AZURE_AD_B2C_POLICY_NAME || 'B2C_1_signupsignin',
    redirectUri: process.env.AZURE_AD_B2C_REDIRECT_URI || 'http://localhost:4200/auth/callback',
  },
  
  azureStorage: {
    connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || '',
    containerName: process.env.AZURE_STORAGE_CONTAINER_NAME || 'bidroom-images',
  },
  
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  
  auction: {
    minBidIncrement: parseFloat(process.env.MIN_BID_INCREMENT || '1.00'),
    privateRoom: {
      minBidders: parseInt(process.env.PRIVATE_ROOM_MIN_BIDDERS || '15', 10),
      topBidders: parseInt(process.env.PRIVATE_ROOM_TOP_BIDDERS || '5', 10),
      extendTimeMinutes: parseInt(process.env.PRIVATE_ROOM_EXTEND_TIME_MINUTES || '1', 10),
      noBidCloseMinutes: parseInt(process.env.PRIVATE_ROOM_NO_BID_CLOSE_MINUTES || '2', 10),
    },
    preAuth: {
      amount: parseFloat(process.env.PRE_AUTH_AMOUNT || '5.00'),
      validityDays: parseInt(process.env.PRE_AUTH_VALIDITY_DAYS || '30', 10),
    },
    commission: {
      noPrivateRoom: parseFloat(process.env.COMMISSION_NO_PRIVATE_ROOM || '0.5'),
      withPrivateRoom: parseFloat(process.env.COMMISSION_WITH_PRIVATE_ROOM || '2.0'),
    },
  },
  
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  },
  
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
};

export default config;

