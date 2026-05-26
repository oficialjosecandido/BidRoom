const mongoose = require('mongoose');
const dns = require('dns');
const logger = require('../utils/logger');

function ensureDbName(uri) {
  const lastSegment = uri.split('/').pop() || '';
  const hasDbName = lastSegment.trim() && !lastSegment.includes('?');
  if (!hasDbName) {
    const dbName = process.env.NODE_ENV === 'production' ? 'bidroom_prod' : 'bidroom-dev';
    return uri.replace(/\/?$/, '/') + dbName;
  }
  return uri;
}

/**
 * When mongodb+srv fails with ENODATA (DNS SRV not resolving), try the same host
 * with standard mongodb:// and port 27017. A-record lookups often still work.
 */
function srvUriToStandardUri(srvUri) {
  const match = srvUri.match(/^mongodb\+srv:\/\/([^@]+)@([^/]+)(\/[^?]*)?(\?.*)?$/);
  if (!match) return null;
  const [, auth, host, path = '/', existingQs = ''] = match;
  const pathPart = path === '/' || path === '' ? '/' : path;
  const opts = 'authSource=admin&directConnection=true';
  const sep = pathPart.includes('?') || existingQs ? '&' : '?';
  return `mongodb://${auth}@${host}:27017${pathPart}${existingQs}${sep}${opts}`;
}

const CONNECT_TIMEOUT_MS = 15000;
const MAX_BOOT_ATTEMPTS = parseInt(process.env.MONGO_BOOT_ATTEMPTS || '5', 10);
const BOOT_BACKOFF_BASE_MS = 2000;
const BOOT_BACKOFF_MAX_MS = 30000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSrvDnsError(err) {
  return /ENODATA|querySrv|getaddrinfo|ETIMEOUT/.test(err && err.message ? err.message : '');
}

async function tryConnect(uri, timeoutMs = CONNECT_TIMEOUT_MS) {
  return mongoose.connect(uri, { serverSelectionTimeoutMS: timeoutMs });
}

/**
 * Attempt the smart cascade of URIs we already know about:
 *   1) The configured MONGO_URI (SRV or standard).
 *   2) Same URI through Google DNS (if SRV).
 *   3) MONGO_URI_STANDARD if provided.
 *   4) Derived standard form from the SRV URI as last resort.
 */
async function connectOnce(primaryUri) {
  try {
    const conn = await tryConnect(primaryUri);
    return conn;
  } catch (error) {
    const srv = primaryUri.startsWith('mongodb+srv://');
    const dnsError = isSrvDnsError(error);

    if (dnsError && srv) {
      const defaultServers = dns.getServers();
      try {
        dns.setServers(['8.8.8.8', '8.8.4.4']);
        logger.warn('SRV DNS failed, retrying with Google DNS (8.8.8.8)');
        const conn = await tryConnect(primaryUri);
        return conn;
      } catch (retryErr) {
        if (!isSrvDnsError(retryErr)) throw retryErr;
      } finally {
        if (defaultServers.length) dns.setServers(defaultServers);
      }

      const standardUri = process.env.MONGO_URI_STANDARD;
      if (standardUri) {
        logger.warn('Trying MONGO_URI_STANDARD');
        const conn = await tryConnect(ensureDbName(standardUri));
        return conn;
      }

      const fallback = srvUriToStandardUri(primaryUri);
      if (fallback) {
        logger.warn('Trying standard format (host:27017)');
        const conn = await tryConnect(fallback);
        return conn;
      }
    }

    throw error;
  }
}

/**
 * Connect to MongoDB with bounded exponential backoff.
 *
 * Why retry at boot time:
 *   - Azure App Service often boots before Azure Cosmos / Atlas is reachable from
 *     the freshly assigned IP.
 *   - Network glitches at deploy time shouldn't kill the whole instance — the
 *     orchestrator will then mark the slot as unhealthy and bounce us, costing
 *     downtime. A few retries are cheaper.
 *
 * After exhausting MAX_BOOT_ATTEMPTS we still throw, letting the caller
 * (src/index.js) log and exit with code 1 so the platform restarts the process.
 */
const connectDB = async () => {
  const rawUri = process.env.MONGO_URI;
  if (!rawUri) {
    logger.error('MONGO_URI environment variable is not set');
    throw new Error('MONGO_URI environment variable is not set');
  }
  const mongoURI = ensureDbName(rawUri);

  let lastError;
  for (let attempt = 1; attempt <= MAX_BOOT_ATTEMPTS; attempt += 1) {
    try {
      const conn = await connectOnce(mongoURI);
      logger.info('MongoDB connected', {
        host: conn.connection.host,
        database: conn.connection.name,
        attempt,
      });

      mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error', { error: err.message });
      });
      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected');
      });
      // Mongoose 8 auto-reconnects internally, but log when it succeeds again.
      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
      });

      process.on('SIGINT', async () => {
        try {
          await mongoose.connection.close();
          logger.info('MongoDB connection closed (SIGINT)');
        } finally {
          process.exit(0);
        }
      });

      return mongoose.connection;
    } catch (err) {
      lastError = err;
      const backoff = Math.min(BOOT_BACKOFF_MAX_MS, BOOT_BACKOFF_BASE_MS * 2 ** (attempt - 1));
      logger.warn('MongoDB connection attempt failed', {
        attempt,
        of: MAX_BOOT_ATTEMPTS,
        error: err.message,
        nextRetryMs: attempt === MAX_BOOT_ATTEMPTS ? null : backoff,
      });
      if (attempt < MAX_BOOT_ATTEMPTS) {
        await sleep(backoff);
      }
    }
  }

  logger.error('MongoDB connection failed after all retries', {
    attempts: MAX_BOOT_ATTEMPTS,
    error: lastError && lastError.message,
  });
  if (lastError && isSrvDnsError(lastError)) {
    logger.error('Tip: set MONGO_URI_STANDARD with the Atlas "Standard connection string"');
  }
  throw lastError || new Error('MongoDB connection failed');
};

module.exports = connectDB;
