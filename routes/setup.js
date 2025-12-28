/**
 * Setup Routes
 * Endpoints for initial system setup wizard
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const { connectDB, getDB, closeDB } = require('../config/database');
const { isSetupCompleted, markSetupCompleted, ROOT_DIR } = require('../config/config');

/**
 * GET /api/setup/status
 * Check if setup is completed
 */
router.get('/status', (req, res) => {
  res.json({
    setup_completed: isSetupCompleted(),
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /api/setup/test-connection
 * Test MongoDB connection
 */
router.post('/test-connection', async (req, res) => {
  const config = req.body;
  
  if (!config || !config.mongo_url) {
    return res.status(200).json({ success: true, message: 'No config provided' });
  }

  let testClient = null;
  try {
    // Save PEM certificate if provided
    let pemPath = null;
    if (config.pem_certificate) {
      pemPath = path.join(ROOT_DIR, 'mongodb_cert.pem');
      fs.writeFileSync(pemPath, config.pem_certificate);
    }

    // Build connection options
    const options = {};
    if (pemPath) {
      options.tls = true;
      options.tlsCAFile = pemPath;
    }

    // Test connection
    testClient = new MongoClient(config.mongo_url, options);
    await testClient.connect();
    
    const testDb = testClient.db(config.db_name || 'hrms_production');
    await testDb.command({ ping: 1 });

    res.json({
      success: true,
      message: 'Successfully connected to MongoDB!',
      db_name: config.db_name
    });
  } catch (error) {
    res.json({
      success: false,
      message: `Connection failed: ${error.message}`
    });
  } finally {
    if (testClient) {
      await testClient.close();
    }
  }
});

/**
 * POST /api/setup/configure
 * Complete setup: configure database and create admin user
 */
router.post('/configure', async (req, res) => {
  const { db_config, server_config, admin_config } = req.body;

  if (!db_config || !server_config || !admin_config) {
    return res.status(400).json({
      success: false,
      message: 'Missing required configuration'
    });
  }

  let newClient = null;
  try {
    // 1. Save PEM certificate if provided
    let pemPath = null;
    if (db_config.pem_certificate) {
      pemPath = path.join(ROOT_DIR, 'mongodb_cert.pem');
      fs.writeFileSync(pemPath, db_config.pem_certificate);
    }

    // 2. Connect to database
    const options = {};
    if (pemPath) {
      options.tls = true;
      options.tlsCAFile = pemPath;
    }

    newClient = new MongoClient(db_config.mongo_url, options);
    await newClient.connect();
    
    const db = newClient.db(db_config.db_name || 'hrms_production');
    await db.command({ ping: 1 });

    // 3. Check if admin already exists
    const existingAdmin = await db.collection('users').findOne({ role: 'admin' });
    if (existingAdmin) {
      await newClient.close();
      return res.json({
        success: false,
        message: 'Admin user already exists. Setup already completed.'
      });
    }

    // 4. Create admin user and employee
    const adminId = uuidv4();
    const now = new Date();
    const hashedPassword = await bcrypt.hash(admin_config.password, 10);

    const adminUser = {
      id: adminId,
      employee_id: 'ADMIN001',
      full_name: admin_config.name,
      email: admin_config.email,
      hashed_password: hashedPassword,
      role: 'admin',
      department: 'Administration',
      designation: 'System Administrator',
      phone: '',
      organization_id: null,
      created_at: now.toISOString()
    };
    await db.collection('users').insertOne(adminUser);

    const adminEmployee = {
      id: adminId,
      employee_id: 'ADMIN001',
      email: admin_config.email,
      full_name: admin_config.name,
      role: 'admin',
      department: 'Administration',
      designation: 'System Administrator',
      phone: '',
      organization_id: null,
      organization_name: null,
      joining_date: now.toISOString(),
      manager_email: null,
      manager_name: null,
      leave_balance: {
        sick_leave: 10.0,
        casual_leave: 15.0,
        paid_leave: 20.0,
        unpaid_leave: 0.0
      },
      created_at: now.toISOString()
    };
    await db.collection('employees').insertOne(adminEmployee);

    // 5. Initialize system settings
    await db.collection('settings').insertOne({
      id: uuidv4(),
      departments: ['HR', 'Engineering', 'Sales', 'Marketing', 'Finance', 'Operations'],
      designations: ['Manager', 'Senior Developer', 'Developer', 'Analyst', 'Executive'],
      leave_types: ['Sick Leave', 'Casual Leave', 'Paid Leave', 'Unpaid Leave', 'Comp-Off'],
      employee_id_prefix: 'EMP',
      employee_id_counter: 1,
      created_at: now.toISOString()
    });

    // 6. Default salary template
    await db.collection('salary_templates').insertOne({
      id: uuidv4(),
      earnings: [
        { name: 'Basic Salary', order: 1 },
        { name: 'Dearness Allowance (DA)', order: 2 },
        { name: 'House Rent Allowance (HRA)', order: 3 },
        { name: 'Conveyance Allowance', order: 4 },
        { name: 'Medical Allowance', order: 5 },
        { name: 'Special Allowance', order: 6 }
      ],
      deductions: [
        { name: 'Professional Tax', order: 1 },
        { name: 'Tax Deducted at Source (TDS)', order: 2 },
        { name: 'Employee Provident Fund (EPF)', order: 3 }
      ],
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      updated_by: adminId
    });

    // 7. Create backend .env file
    const backendEnvContent = `# Auto-generated by HRMS Setup Wizard
HOST=0.0.0.0
PORT=${server_config.backend_port}

MONGO_URL=${db_config.mongo_url}
DB_NAME=${db_config.db_name}

JWT_SECRET_KEY=${server_config.jwt_secret}

CORS_ORIGINS=http://${server_config.server_ip}:${server_config.frontend_port}

FRONTEND_URL=http://${server_config.server_ip}:${server_config.frontend_port}
BACKEND_URL=http://${server_config.server_ip}:${server_config.backend_port}

ENVIRONMENT=production
`;
    fs.writeFileSync(path.join(ROOT_DIR, '.env'), backendEnvContent);

    // 8. Create frontend .env file (if frontend directory exists)
    const frontendDir = path.join(ROOT_DIR, '..', 'frontend');
    if (fs.existsSync(frontendDir)) {
      const frontendEnvContent = `# Auto-generated by HRMS Setup Wizard
REACT_APP_BACKEND_URL=http://${server_config.server_ip}:${server_config.backend_port}

REACT_APP_ENABLE_VISUAL_EDITS=false
REACT_APP_ENABLE_HEALTH_CHECK=false

NODE_ENV=production
`;
      fs.writeFileSync(path.join(frontendDir, '.env'), frontendEnvContent);
    }

    // 9. Mark setup completed
    markSetupCompleted();

    // 10. Close test client and reconnect with main connection
    await newClient.close();

    // Reconnect using the application's database module
    await connectDB(db_config.mongo_url, db_config.db_name);

    res.json({
      success: true,
      message: 'Setup completed successfully. Restart backend and frontend.',
      admin_email: admin_config.email,
      frontend_url: `http://${server_config.server_ip}:${server_config.frontend_port}`,
      backend_url: `http://${server_config.server_ip}:${server_config.backend_port}`
    });
  } catch (error) {
    console.error('Setup error:', error);
    if (newClient) {
      await newClient.close();
    }
    res.json({
      success: false,
      message: `Setup failed: ${error.message}`
    });
  }
});

module.exports = router;
