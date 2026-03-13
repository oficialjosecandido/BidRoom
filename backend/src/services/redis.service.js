const Redis = require('ioredis');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  connect() {
    if (this.client && this.isConnected) {
      return Promise.resolve();
    }

    // Connect to Redis - using Azure Cache for Redis or local Redis
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port,
      password: process.env.REDIS_PASSWORD || undefined,
      // Azure Cache for Redis requires TLS on port 6380
      tls: port === 6380 ? {} : undefined,
      retryStrategy: (times) => {
        if (process.env.NODE_ENV !== 'production' && times >= 1) {
          return null; // Stop retrying in dev - avoid reconnection spam when Redis isn't running
        }
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      lazyConnect: false // Connect immediately
    };

    this.client = new Redis(redisConfig);

    return new Promise((resolve, reject) => {
      // Handle connection events
      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('✅ Connected to Redis');
        resolve();
      });

      this.client.on('ready', () => {
        this.isConnected = true;
        console.log('✅ Redis is ready');
      });

      this.client.on('error', (error) => {
        console.error('❌ Redis error:', error);
        this.isConnected = false;
        // In development, continue without Redis; in production, reject
        if (process.env.NODE_ENV === 'production') {
          reject(error);
        } else {
          console.warn('⚠️  Continuing without Redis (development mode)');
          this.client.disconnect();
          resolve();
        }
      });

      this.client.on('close', () => {
        if (this.isConnected) {
          console.log('Redis connection closed');
        }
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        if (process.env.NODE_ENV === 'production') {
          console.log('Reconnecting to Redis...');
        }
      });

      // If already connected, resolve immediately
      if (this.client.status === 'ready') {
        this.isConnected = true;
        resolve();
      }
    });
  }

  async get(key) {
    if (!this.isConnected || !this.client) {
      return null;
    }
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Redis GET error for key ${key}:`, error);
      return null;
    }
  }

  async set(key, value, expirationSeconds = null) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    try {
      const stringValue = JSON.stringify(value);
      if (expirationSeconds) {
        await this.client.setex(key, expirationSeconds, stringValue);
      } else {
        await this.client.set(key, stringValue);
      }
      return true;
    } catch (error) {
      console.error(`Redis SET error for key ${key}:`, error);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error(`Redis DEL error for key ${key}:`, error);
      return false;
    }
  }

  async exists(key) {
    if (!this.isConnected || !this.client) {
      return false;
    }
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Redis EXISTS error for key ${key}:`, error);
      return false;
    }
  }

  // Cache current bid information for a listing
  async cacheListingBid(listingId, bidData) {
    const key = `listing:${listingId}:current`;
    return await this.set(key, bidData, 86400); // Cache for 24 hours
  }

  // Get cached current bid for a listing
  async getCachedListingBid(listingId) {
    const key = `listing:${listingId}:current`;
    return await this.get(key);
  }

  // Cache listing stats (bid count, current price, etc.)
  async cacheListingStats(listingId, stats) {
    const key = `listing:${listingId}:stats`;
    return await this.set(key, stats, 3600); // Cache for 1 hour
  }

  // Get cached listing stats
  async getCachedListingStats(listingId) {
    const key = `listing:${listingId}:stats`;
    return await this.get(key);
  }

  // Invalidate cache for a listing (when bid is placed)
  async invalidateListingCache(listingId) {
    const keys = [
      `listing:${listingId}:current`,
      `listing:${listingId}:stats`
    ];
    for (const key of keys) {
      await this.del(key);
    }
  }

  disconnect() {
    if (this.client) {
      this.client.disconnect();
      this.isConnected = false;
    }
  }
}

// Export singleton instance
const redisService = new RedisService();
module.exports = redisService;

