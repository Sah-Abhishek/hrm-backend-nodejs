const { MongoClient } = require('mongodb');

let client = null;
let db = null;

const connectDB = async (mongoUrl, dbName) => {
  try {
    mongoUrl = mongoUrl || process.env.MONGO_URL || 'mongodb://localhost:27017';
    dbName = dbName || process.env.DB_NAME || 'hrms_production';

    client = new MongoClient(mongoUrl);
    await client.connect();
    
    db = client.db(dbName);
    
    // Test connection
    await db.command({ ping: 1 });
    console.log('✅ MongoDB connected successfully');
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    throw error;
  }
};

const getDB = () => {
  return db;
};

const getClient = () => client;

const closeDB = async () => {
  if (client) {
    await client.close();
    console.log('MongoDB connection closed');
  }
};

module.exports = {
  connectDB,
  getDB,
  getClient,
  closeDB
};
