const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate, getCurrentEmployee, createAccessToken } = require('../middleware/auth');
const { validate } = require('../middleware/roleCheck');
const { schemas, defaultLeaveBalance } = require('../models/schemas');
const { hashPassword, verifyPassword, generateUUID, generateEmployeeId } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { generateWelcomeEmail, generateNewEmployeeNotificationEmail } = require('../utils/emailTemplates');

/**
 * POST /api/auth/register
 * Register a new user
 */
router.post('/register', validate(schemas.userRegister), async (req, res) => {
  try {
    const db = getDB();
    const userData = req.validatedBody;

    // Check if user exists
    const existingUser = await db.collection('users').findOne({ email: userData.email });
    if (existingUser) {
      return res.status(400).json({ detail: 'Email already registered' });
    }

    // Generate employee ID
    const employeeId = await generateEmployeeId();
    const hashedPassword = await hashPassword(userData.password);
    const now = new Date();
    const userId = generateUUID();

    // Create user document
    const userDoc = {
      id: userId,
      employee_id: employeeId,
      email: userData.email,
      full_name: userData.full_name,
      role: userData.role,
      hashed_password: hashedPassword,
      created_at: now
    };

    await db.collection('users').insertOne(userDoc);

    // Get manager name if provided
    let managerName = null;
    if (userData.manager_email) {
      const manager = await db.collection('employees').findOne(
        { email: userData.manager_email },
        { projection: { full_name: 1 } }
      );
      if (manager) {
        managerName = manager.full_name;
      }
    }

    // Create employee profile
    const employeeDoc = {
      id: userId,
      employee_id: employeeId,
      email: userData.email,
      full_name: userData.full_name,
      role: userData.role,
      department: userData.department,
      designation: userData.designation,
      phone: userData.phone || null,
      organization_id: userData.organization_id || null,
      organization_name: null,
      joining_date: now,
      manager_email: userData.manager_email || null,
      manager_name: managerName,
      leave_balance: { ...defaultLeaveBalance },
      created_at: now
    };

    await db.collection('employees').insertOne(employeeDoc);

    // Send welcome email
    try {
      const welcomeHtml = generateWelcomeEmail(
        userData.full_name,
        employeeId,
        userData.email,
        userData.role,
        userData.department,
        userData.designation
      );
      await sendEmailNotification(
        userData.email,
        `Welcome to HRMS - ${userData.full_name}`,
        welcomeHtml
      );

      // Notify admin
      const admin = await db.collection('employees').findOne(
        { role: 'admin' },
        { projection: { email: 1, full_name: 1 } }
      );
      if (admin) {
        const adminNotificationHtml = generateNewEmployeeNotificationEmail(
          userData.full_name,
          employeeId,
          userData.email,
          userData.role,
          userData.department,
          userData.designation,
          admin.full_name || 'Admin'
        );
        await sendEmailNotification(
          admin.email,
          `New Employee Added - ${userData.full_name}`,
          adminNotificationHtml
        );
      }
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError.message);
    }

    // Create token
    const accessToken = createAccessToken(userData.email);

    res.status(201).json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: userId,
        employee_id: employeeId,
        email: userData.email,
        full_name: userData.full_name,
        role: userData.role
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/auth/login
 * Login user
 */
router.post('/login', validate(schemas.userLogin), async (req, res) => {
  try {
    const db = getDB();
    const { email, password } = req.validatedBody;

    // Find user
    const userDoc = await db.collection('users').findOne(
      { email },
      { projection: { _id: 0 } }
    );

    if (!userDoc) {
      return res.status(401).json({ detail: 'Invalid credentials' });
    }

    // Verify password
    const hashedPassword = userDoc.hashed_password;
    if (!hashedPassword) {
      return res.status(500).json({ detail: 'Password not set' });
    }

    const isValid = await verifyPassword(password, hashedPassword);
    if (!isValid) {
      return res.status(401).json({ detail: 'Invalid credentials' });
    }

    // Create token
    const accessToken = createAccessToken(email);

    res.json({
      access_token: accessToken,
      token_type: 'bearer',
      user: {
        id: userDoc.id,
        employee_id: userDoc.employee_id,
        email: userDoc.email,
        full_name: userDoc.full_name || userDoc.name,
        role: userDoc.role
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile
 */
router.get('/me', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    res.json(req.employee);
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
