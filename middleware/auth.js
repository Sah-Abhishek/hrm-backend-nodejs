const jwt = require('jsonwebtoken');
const { config } = require('../config/config');
const { getDB } = require('../config/database');

/**
 * Middleware to verify JWT token and attach user to request
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        detail: 'Could not validate credentials',
        headers: { 'WWW-Authenticate': 'Bearer' }
      });
    }

    const token = authHeader.split(' ')[1];
    
    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch (error) {
      return res.status(401).json({
        detail: 'Could not validate credentials',
        headers: { 'WWW-Authenticate': 'Bearer' }
      });
    }

    const email = payload.sub;
    if (!email) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    const db = getDB();
    const userDoc = await db.collection('users').findOne(
      { email },
      { projection: { _id: 0 } }
    );

    if (!userDoc) {
      return res.status(401).json({
        detail: 'Could not validate credentials'
      });
    }

    // Normalize datetime fields
    if (typeof userDoc.created_at === 'string') {
      userDoc.created_at = new Date(userDoc.created_at);
    }
    if (typeof userDoc.date_of_joining === 'string') {
      userDoc.date_of_joining = new Date(userDoc.date_of_joining);
    }

    // Attach user to request
    req.user = {
      id: userDoc.id,
      employee_id: userDoc.employee_id,
      full_name: userDoc.full_name || userDoc.name,
      email: userDoc.email,
      role: userDoc.role
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(401).json({
      detail: 'Could not validate credentials'
    });
  }
};

/**
 * Get current employee from database
 */
const getCurrentEmployee = async (req, res, next) => {
  try {
    const db = getDB();
    const employee = await db.collection('employees').findOne(
      { email: req.user.email },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      // Admin without employee profile
      if (req.user.role === 'admin') {
        req.employee = {
          id: req.user.id,
          employee_id: 'ADMIN',
          email: req.user.email,
          full_name: req.user.full_name,
          role: req.user.role,
          department: 'Administration',
          designation: 'System Administrator',
          joining_date: new Date(),
          leave_balance: {
            sick_leave: 10,
            casual_leave: 15,
            paid_leave: 20,
            unpaid_leave: 0
          }
        };
        return next();
      }
      return res.status(404).json({ detail: 'Employee profile not found' });
    }

    // Normalize dates
    if (typeof employee.joining_date === 'string') {
      employee.joining_date = new Date(employee.joining_date);
    }
    if (typeof employee.created_at === 'string') {
      employee.created_at = new Date(employee.created_at);
    }

    req.employee = employee;
    next();
  } catch (error) {
    console.error('Get employee error:', error);
    return res.status(500).json({ detail: 'Internal server error' });
  }
};

/**
 * Create JWT access token
 */
const createAccessToken = (email) => {
  const payload = {
    sub: email,
    iat: Math.floor(Date.now() / 1000)
  };
  
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
};

module.exports = {
  authenticate,
  getCurrentEmployee,
  createAccessToken
};
