const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.dirname(__dirname);
const SETUP_CONFIG_FILE = path.join(ROOT_DIR, 'setup_config.json');

const config = {
  // Server
  host: process.env.HOST || '0.0.0.0',
  port: parseInt(process.env.PORT || '8000', 10),

  // MongoDB
  mongoUrl: process.env.MONGO_URL || 'mongodb://localhost:27017',
  dbName: process.env.DB_NAME || 'hrms_production',

  // JWT
  jwtSecret: process.env.JWT_SECRET_KEY || 'your-secret-key-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // CORS
  corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['*'],

  // URLs
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:8000',

  // Mailjet
  mailjet: {
    apiKey: process.env.MAILJET_API_KEY,
    apiSecret: process.env.MAILJET_API_SECRET,
    fromEmail: process.env.MAILJET_FROM_EMAIL,
    fromName: process.env.MAILJET_FROM_NAME || 'HRMS System'
  },

  // Twilio
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER
  },

  // Environment
  nodeEnv: process.env.NODE_ENV || 'development',

  // Paths
  rootDir: ROOT_DIR,
  setupConfigFile: SETUP_CONFIG_FILE
};

// Setup status helpers
const isSetupCompleted = () => {
  // try {
  //   if (fs.existsSync(SETUP_CONFIG_FILE)) {
  //     const content = fs.readFileSync(SETUP_CONFIG_FILE, 'utf8');
  //     const setupConfig = JSON.parse(content);
  //     return setupConfig.setup_completed === true;
  //   }
  // } catch (error) {
  //   console.error('Error checking setup status:', error.message);
  // }
  return true;
};

const markSetupCompleted = () => {
  fs.writeFileSync(SETUP_CONFIG_FILE, JSON.stringify({ setup_completed: true }));
};

const logSetupStatus = () => {
  const status = isSetupCompleted();
  const color = status ? '\x1b[36m' : '\x1b[31m';
  console.log(`${color}[HRMS SETUP] setup_completed = ${status}\x1b[0m`);
};

module.exports = {
  config,
  isSetupCompleted,
  markSetupCompleted,
  logSetupStatus,
  ROOT_DIR,
  SETUP_CONFIG_FILE
};
