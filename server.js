/**
 * HRMS Backend Server
 * Express.js + MongoDB
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { connectDB, getDB, closeDB } = require('./config/database');
const { isSetupCompleted, markSetupCompleted, SETUP_CONFIG_FILE } = require('./config/config');

// Import routes
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const leaveRoutes = require('./routes/leaves');
const organizationRoutes = require('./routes/organizations');
const dashboardRoutes = require('./routes/dashboard');
const payrollRoutes = require('./routes/payroll');
const setupRoutes = require('./routes/setup');
const notificationRoutes = require('./routes/notifications');
const holidayRoutes = require('./routes/holidays');
const uploadsRouter = require('./routes/uploads');
const passwordResetRouter = require('./routes/passwordReset');
const attendanceRouter = require('./routes/attendance');





const app = express();

// Middleware
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Log setup status on startup
function logSetupStatus() {
  const status = isSetupCompleted();
  const color = status ? '\x1b[36m' : '\x1b[31m'; // cyan or red
  console.log(`${color}[HRMS SETUP] setup_completed = ${status}\x1b[0m`);
}

// ============= API ROUTES =============

// Setup routes (available even without setup)
app.use('/api/setup', setupRoutes);

// Health check
app.get('/health', async (req, res) => {
  try {
    const db = getDB();
    if (db) {
      await db.command({ ping: 1 });
      return res.json({
        status: 'healthy',
        service: 'HRMS Backend',
        database: 'connected',
        setup_completed: isSetupCompleted(),
        timestamp: new Date().toISOString()
      });
    } else {
      return res.json({
        status: 'setup_required',
        service: 'HRMS Backend',
        database: 'not_configured',
        setup_completed: isSetupCompleted(),
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    return res.json({
      status: 'unhealthy',
      service: 'HRMS Backend',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'HRMS API',
    version: '1.0.0',
    status: 'running',
    docs: '/api-docs',
    health: '/health'
  });
});

// Protected routes (require database connection)
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api', payrollRoutes); // Payroll handles /comp-off, /salary-template, /salary-structure, /payroll
app.use('/api', leaveRoutes); // Leave also handles /leave-policy
app.use('/api', employeeRoutes); // Employee also handles /employee-id-settings
app.use('/api', notificationRoutes); // Notification handles /notification-settings
app.use('/api/holidays', holidayRoutes);
app.use('/api/uploads', uploadsRouter);
app.use('/api/password-reset', passwordResetRouter);
app.use('/api/attendance', attendanceRouter);







// 404 handler
app.use((req, res) => {
  res.status(404).json({ detail: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ detail: 'Internal server error' });
});

// ============= SERVER STARTUP =============

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  logSetupStatus();

  // Connect to database if MONGO_URL is set
  const mongoUrl = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME || 'hrms_production';

  console.log(`[DATABASE] MONGO_URL: ${mongoUrl ? 'Set' : 'Not set'}`);
  console.log(`[DATABASE] DB_NAME: ${dbName}`);

  if (mongoUrl) {
    try {
      await connectDB(mongoUrl, dbName);
      console.log('\x1b[32m[DATABASE] Connected to MongoDB\x1b[0m');
    } catch (error) {
      console.error('\x1b[31m[DATABASE] Failed to connect to MongoDB:\x1b[0m', error.message);
    }
  } else {
    console.log('\x1b[33m[DATABASE] Skipping connection - MONGO_URL not set in .env\x1b[0m');
  }

  app.listen(PORT, HOST, () => {
    console.log(`\x1b[32m[SERVER] HRMS Backend running on http://${HOST}:${PORT}\x1b[0m`);
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[SERVER] Shutting down...');
  await closeDB();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n[SERVER] Shutting down...');
  await closeDB();
  process.exit(0);
});

startServer().catch(console.error);

module.exports = app;
