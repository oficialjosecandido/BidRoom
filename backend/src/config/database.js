const mongoose = require('mongoose');
const dns = require('dns');

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
  const pathPart = (path === '/' || path === '') ? '/' : path;
  const opts = 'authSource=admin&directConnection=true';
  const sep = pathPart.includes('?') || existingQs ? '&' : '?';
  return `mongodb://${auth}@${host}:27017${pathPart}${existingQs}${sep}${opts}`;
}

const CONNECT_TIMEOUT_MS = 15000;

const connectDB = async () => {
  let mongoURI = process.env.MONGO_URI;
  if (!mongoURI) {
    console.error('❌ MONGO_URI environment variable is not set');
    process.exit(1);
  }
  mongoURI = ensureDbName(mongoURI);

  const tryConnect = async (uri, timeoutMs = CONNECT_TIMEOUT_MS) => {
    return mongoose.connect(uri, { serverSelectionTimeoutMS: timeoutMs });
  };

  try {
    const conn = await tryConnect(mongoURI);
    console.log(`🍃 MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
  } catch (error) {
    const isSrvDnsError = /ENODATA|querySrv|getaddrinfo/.test(error.message);
    const isSrvUri = mongoURI.startsWith('mongodb+srv://');
    let connected = false;

    // 1) SRV failed: retry with Google DNS (often fixes "worked yesterday" when ISP DNS is flaky)
    if (isSrvDnsError && isSrvUri) {
      const defaultServers = dns.getServers();
      dns.setServers(['8.8.8.8', '8.8.4.4']);
      console.log('⚠️  SRV DNS failed, retrying with Google DNS (8.8.8.8)...');
      try {
        const conn = await tryConnect(mongoURI);
        console.log(`🍃 MongoDB Connected: ${conn.connection.host}`);
        console.log(`📊 Database: ${conn.connection.name}`);
        connected = true;
      } catch (retryErr) {
        if (!/ENODATA|querySrv|getaddrinfo/.test(retryErr.message)) {
          console.error('❌ Database connection failed:', retryErr.message);
          process.exit(1);
        }
      } finally {
        if (defaultServers.length) dns.setServers(defaultServers);
      }
    }

    if (!connected) {
      const standardUri = process.env.MONGO_URI_STANDARD;
      if (isSrvDnsError && standardUri) {
        console.log('⚠️  Trying MONGO_URI_STANDARD...');
        try {
          const conn = await tryConnect(ensureDbName(standardUri));
          console.log(`🍃 MongoDB Connected: ${conn.connection.host}`);
          console.log(`📊 Database: ${conn.connection.name}`);
          connected = true;
        } catch (err2) {
          console.error('❌ Database connection failed (standard URI):', err2.message);
          process.exit(1);
        }
      }
      if (!connected && isSrvDnsError && isSrvUri) {
        const fallback = srvUriToStandardUri(ensureDbName(process.env.MONGO_URI));
        if (fallback) {
          console.log('⚠️  Trying standard format (host:27017, 15s timeout)...');
          try {
            const conn = await tryConnect(fallback);
            console.log(`🍃 MongoDB Connected: ${conn.connection.host}`);
            console.log(`📊 Database: ${conn.connection.name}`);
            connected = true;
          } catch (err2) {
            console.error('❌ Database connection failed:', err2.message);
            console.error('💡 Get the "Standard connection string" from Atlas (Connect → Drivers) and set MONGO_URI_STANDARD in .env');
            process.exit(1);
          }
        }
      }
      if (!connected) {
        console.error('❌ Database connection failed:', error.message);
        if (isSrvDnsError) {
          console.error('💡 Get the "Standard connection string" from Atlas and set MONGO_URI_STANDARD in .env');
        }
        process.exit(1);
      }
    }
  }

  mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB connection error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.log('⚠️  MongoDB disconnected');
  });

  process.on('SIGINT', async () => {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed through app termination');
    process.exit(0);
  });

  return mongoose.connection;
};

module.exports = connectDB;
