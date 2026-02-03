const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    // MONGO_URI should already include the database name
    // e.g., mongodb+srv://user:pass@cluster.mongodb.net/bidroom_dev
    // If it doesn't end with a database name, append it
    let mongoURI = process.env.MONGO_URI;
    if (!mongoURI) {
      throw new Error('MONGO_URI environment variable is not set');
    }
    
    // Check if URI already has a database name
    // MongoDB URI format: mongodb+srv://...@host.net/database_name
    const lastSegment = mongoURI.split('/').pop() || '';
    const hasDbName = lastSegment.trim() && !lastSegment.includes('?');
    if (!hasDbName) {
      const dbName = process.env.NODE_ENV === 'production' ? 'bidroom_prod' : 'bidroom_dev';
      mongoURI = mongoURI.replace(/\/?$/, '/') + dbName;
    }
    
    const conn = await mongoose.connect(mongoURI);

    console.log(`🍃 MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB disconnected');
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      console.log('🔌 MongoDB connection closed through app termination');
      process.exit(0);
    });

    return conn;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
