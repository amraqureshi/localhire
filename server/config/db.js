// Legacy MongoDB Connection Helper (Retained for migration / backward compatibility)
// Note: Hardcoded DNS resolvers and forced TLS settings have been removed.

const path = require('path');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    console.warn('[Database] MONGODB_URI not provided. Skipping legacy MongoDB connection.');
    return null;
  }

  try {
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true
    });
    console.log(`[Database] Legacy MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.warn(`[Database] Legacy MongoDB connection skipped or unavailable: ${error.message}`);
    return null;
  }
};

module.exports = connectDB;
