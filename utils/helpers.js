const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../config/database');

/**
 * Hash password using bcrypt
 */
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
};

/**
 * Verify password against hash
 */
const verifyPassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate UUID
 */
const generateUUID = () => uuidv4();

/**
 * Calculate number of days between two dates
 */
const calculateDays = (startDate, endDate, isHalfDay = false) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  if (isHalfDay && diffDays === 1) {
    return 0.5;
  }
  
  return diffDays;
};

/**
 * Generate unique employee ID
 */
const generateEmployeeId = async () => {
  const db = getDB();
  
  // Get settings
  const settings = await db.collection('settings').findOne({});
  const prefix = settings?.employee_id_prefix || 'EMP';
  const startCounter = settings?.employee_id_counter || 1000;
  
  // Find highest counter
  const employees = await db.collection('employees')
    .find({}, { projection: { employee_id: 1 } })
    .toArray();
  
  let maxCounter = startCounter;
  
  for (const emp of employees) {
    const empId = emp.employee_id || '';
    if (empId.startsWith(prefix)) {
      try {
        const num = parseInt(empId.replace(prefix, ''), 10);
        if (!isNaN(num) && num > maxCounter) {
          maxCounter = num;
        }
      } catch (e) {
        // Ignore parsing errors
      }
    }
  }
  
  const newCounter = maxCounter + 1;
  return `${prefix}${String(newCounter).padStart(4, '0')}`;
};

/**
 * Normalize leave type to database key format
 */
const normalizeLeaveType = (leaveType) => {
  return leaveType.toLowerCase().replace(/ /g, '_');
};

/**
 * Get number of days in a month
 */
const getDaysInMonth = (year, month) => {
  return new Date(year, month, 0).getDate();
};

/**
 * Format date to ISO string
 */
const toISOString = (date) => {
  if (date instanceof Date) {
    return date.toISOString();
  }
  if (typeof date === 'string') {
    return new Date(date).toISOString();
  }
  return new Date().toISOString();
};

/**
 * Parse date from various formats
 */
const parseDate = (date) => {
  if (date instanceof Date) {
    return date;
  }
  if (typeof date === 'string') {
    return new Date(date);
  }
  return new Date();
};

/**
 * Format currency (INR)
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(amount);
};

/**
 * Get month name from date
 */
const getMonthName = (year, month) => {
  const date = new Date(year, month - 1, 1);
  return date.toLocaleString('default', { month: 'long', year: 'numeric' });
};

module.exports = {
  hashPassword,
  verifyPassword,
  generateUUID,
  calculateDays,
  generateEmployeeId,
  normalizeLeaveType,
  getDaysInMonth,
  toISOString,
  parseDate,
  formatCurrency,
  getMonthName
};
