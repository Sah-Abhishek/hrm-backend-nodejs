const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate, getCurrentEmployee } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { schemas, UserRole, LeaveStatus, LeaveType, defaultLeavePolicy } = require('../models/schemas');
const { generateUUID, normalizeLeaveType, toISOString } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { sendWhatsAppNotification } = require('../services/whatsappService');
const { generateLeaveApplicationEmail, generateLeaveApprovalEmail, generateLeaveEditEmail } = require('../utils/emailTemplates');

/**
 * Default monthly credit rates for leave types
 * These are used as fallback if not defined in policy
 */
const DEFAULT_MONTHLY_CREDITS = {
  'casual_leave': 0.5,
  'sick_leave': 0.5,
  'earned_leave': 1
};

/**
 * Helper: Calculate days from dates array
 */
function calculateDaysFromDates(dates, isHalfDay = false) {
  if (!dates || dates.length === 0) return 0;
  if (isHalfDay && dates.length === 1) {
    return 0.5;
  }
  return dates.length;
}

/**
 * Helper: Format dates array for display
 */
function formatDatesForDisplay(dates) {
  if (!dates || dates.length === 0) return 'No dates';

  const sortedDates = dates
    .map(d => new Date(d))
    .sort((a, b) => a - b);

  if (sortedDates.length === 1) {
    return sortedDates[0].toLocaleDateString();
  }

  if (sortedDates.length <= 3) {
    return sortedDates.map(d => d.toLocaleDateString()).join(', ');
  }

  return `${sortedDates[0].toLocaleDateString()} to ${sortedDates[sortedDates.length - 1].toLocaleDateString()} (${sortedDates.length} days)`;
}

/**
 * Helper: Normalize dates in leave document
 */
function normalizeLeaveDates(leave) {
  if (leave.dates && Array.isArray(leave.dates)) {
    leave.dates = leave.dates.map(d => typeof d === 'string' ? new Date(d) : d);
  }

  for (const field of ['created_at', 'updated_at']) {
    if (typeof leave[field] === 'string') {
      leave[field] = new Date(leave[field]);
    }
  }

  for (const approval of leave.approvals || []) {
    if (typeof approval.timestamp === 'string') {
      approval.timestamp = new Date(approval.timestamp);
    }
  }

  return leave;
}

/**
 * Helper: Convert dates to ISO strings for storage
 */
function datesToISOStrings(dates) {
  if (!dates || !Array.isArray(dates)) return [];
  return dates.map(d => toISOString(d));
}

/**
 * Helper: Get leave policy for a specific leave type
 */
async function getLeavePolicyForType(db, leaveType) {
  const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });

  if (!policy || !policy.policies) {
    // Return from default policy
    const defaultPolicy = defaultLeavePolicy.policies.find(
      p => p.leave_type.toLowerCase() === leaveType.toLowerCase()
    );
    return defaultPolicy || null;
  }

  return policy.policies.find(
    p => p.leave_type.toLowerCase() === leaveType.toLowerCase()
  ) || null;
}

/**
 * Helper: Calculate months since joining date
 * @param {Date} joiningDate - Employee's joining date
 * @returns {number} - Number of complete months since joining
 */
function calculateMonthsSinceJoining(joiningDate) {
  const now = new Date();
  const joining = new Date(joiningDate);

  // Calculate months since joining
  let months = (now.getFullYear() - joining.getFullYear()) * 12;
  months += now.getMonth() - joining.getMonth();

  // If current day is before joining day in the month, subtract one month
  if (now.getDate() < joining.getDate()) {
    months--;
  }

  // Ensure non-negative
  return Math.max(0, months);
}

/**
 * Helper: Calculate accrued leave balance based on joining date
 * @param {Date} joiningDate - Employee's joining date
 * @param {number} monthlyCredit - Days credited per month
 * @param {number} maxBalance - Maximum balance cap (annual quota)
 * @returns {number} - Accrued balance rounded to 1 decimal
 */
function calculateAccruedBalance(joiningDate, monthlyCredit, maxBalance = Infinity) {
  if (!joiningDate || !monthlyCredit) return 0;

  const months = calculateMonthsSinceJoining(joiningDate);
  const accrued = months * monthlyCredit;

  // Cap at max balance and round to 1 decimal
  return Math.min(Math.round(accrued * 10) / 10, maxBalance);
}

/**
 * Helper: Get monthly credit rate for a leave type
 * Uses policy if available, otherwise falls back to defaults
 * @param {Object} policyItem - Policy item for the leave type
 * @param {string} leaveKey - Normalized leave type key
 * @returns {number} - Monthly credit rate
 */
function getMonthlyCredit(policyItem, leaveKey) {
  // First check if policy has monthly_credit defined
  if (policyItem && policyItem.monthly_credit !== undefined && policyItem.monthly_credit > 0) {
    return policyItem.monthly_credit;
  }

  // Fall back to default rates
  return DEFAULT_MONTHLY_CREDITS[leaveKey] || 0;
}

/**
 * Helper: Validate advance notice requirement
 */
function validateAdvanceNotice(dates, advanceDaysRequired) {
  if (!advanceDaysRequired || advanceDaysRequired <= 0) {
    return { valid: true };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const earliestDate = dates
    .map(d => new Date(d))
    .sort((a, b) => a - b)[0];

  earliestDate.setHours(0, 0, 0, 0);

  const diffTime = earliestDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < advanceDaysRequired) {
    return {
      valid: false,
      message: `${advanceDaysRequired} days advance notice required. You're applying ${diffDays} day(s) in advance.`
    };
  }

  return { valid: true };
}

/**
 * Helper: Check leave clubbing rules
 */
async function validateLeaveClubbing(db, employeeEmail, newLeaveType, newDates) {
  // Get policy
  const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
  const policyItem = policy?.policies?.find(
    p => p.leave_type.toLowerCase() === newLeaveType.toLowerCase()
  );

  if (!policyItem) {
    return { valid: true };
  }

  const clubbingNotAllowedWith = policyItem.clubbing_not_allowed_with || [];

  if (clubbingNotAllowedWith.length === 0) {
    return { valid: true };
  }

  // Get the date range for new leave
  const newDateObjs = newDates.map(d => new Date(d)).sort((a, b) => a - b);
  const earliestNew = new Date(newDateObjs[0]);
  const latestNew = new Date(newDateObjs[newDateObjs.length - 1]);

  // Extend range by 1 day on each side to check for adjacent leaves
  earliestNew.setDate(earliestNew.getDate() - 1);
  latestNew.setDate(latestNew.getDate() + 1);

  // Find existing approved/pending leaves that might overlap or be adjacent
  const existingLeaves = await db.collection('leaves').find({
    employee_email: employeeEmail,
    status: { $in: [LeaveStatus.PENDING, LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED] }
  }).toArray();

  for (const existingLeave of existingLeaves) {
    const existingType = existingLeave.leave_type;

    // Check if this leave type is in the not-allowed list
    const isNotAllowed = clubbingNotAllowedWith.some(
      notAllowed => notAllowed.toLowerCase() === existingType.toLowerCase()
    );

    if (!isNotAllowed) continue;

    // Check if dates overlap or are adjacent
    const existingDates = (existingLeave.dates || []).map(d => new Date(d));

    for (const existingDate of existingDates) {
      const dateOnly = new Date(existingDate);
      dateOnly.setHours(0, 0, 0, 0);

      if (dateOnly >= earliestNew && dateOnly <= latestNew) {
        return {
          valid: false,
          message: `${newLeaveType} cannot be clubbed with ${existingType}. You have an existing ${existingType} on or adjacent to these dates.`
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Helper: Get leave balance from policy based on joining date
 * Calculates accrued balance for monthly-credited leaves
 * @param {Object} db - Database connection
 * @param {Date} joiningDate - Employee's joining date
 * @returns {Object} - Leave balance object
 */
async function getLeaveBalanceFromPolicy(db, joiningDate = null) {
  const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
  const effectiveJoiningDate = joiningDate || new Date();

  // Default balance structure
  const defaultBalance = {
    earned_leave: 0,
    sick_leave: 0,
    casual_leave: 0,
    paid_leave: 0,
    unpaid_leave: 0,
    comp_off: 0
  };

  if (!policy || !policy.policies || policy.policies.length === 0) {
    // No policy configured - use default monthly credits
    const months = calculateMonthsSinceJoining(effectiveJoiningDate);

    return {
      earned_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.earned_leave * 10) / 10,
      sick_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.sick_leave * 10) / 10,
      casual_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.casual_leave * 10) / 10,
      paid_leave: 0,
      unpaid_leave: 0,
      comp_off: 0
    };
  }

  const balance = { ...defaultBalance };

  for (const policyItem of policy.policies) {
    const leaveKey = normalizeLeaveType(policyItem.leave_type);
    const monthlyCredit = getMonthlyCredit(policyItem, leaveKey);

    // Check credit type from policy
    if (policyItem.credit_type === 'monthly' || monthlyCredit > 0) {
      // Calculate accrued balance based on months since joining
      const maxBalance = policyItem.annual_quota || (monthlyCredit * 12);
      balance[leaveKey] = calculateAccruedBalance(effectiveJoiningDate, monthlyCredit, maxBalance);
    } else if (policyItem.credit_type === 'annually') {
      // Annual credit - assign full quota
      balance[leaveKey] = policyItem.annual_quota || 0;
    } else {
      // Fallback - use default monthly credit if available
      if (DEFAULT_MONTHLY_CREDITS[leaveKey]) {
        const maxBalance = policyItem.annual_quota || (DEFAULT_MONTHLY_CREDITS[leaveKey] * 12);
        balance[leaveKey] = calculateAccruedBalance(
          effectiveJoiningDate,
          DEFAULT_MONTHLY_CREDITS[leaveKey],
          maxBalance
        );
      } else {
        balance[leaveKey] = policyItem.annual_quota || 0;
      }
    }
  }

  // Ensure comp_off exists
  if (!('comp_off' in balance)) {
    balance.comp_off = 0;
  }

  return balance;
}

// ============================================
// LEAVE POLICY ROUTES (MUST BE BEFORE /:leaveId)
// ============================================

/**
 * GET /api/leaves/leave-policy
 * Get current leave policy
 */
router.get('/leave-policy', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });

    if (!policy) {
      return res.json({
        ...defaultLeavePolicy,
        updated_at: new Date().toISOString()
      });
    }

    res.json(policy);
  } catch (error) {
    console.error('Get leave policy error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/leaves/leave-policy
 * Save leave policy (admin only)
 */
router.post('/leave-policy', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const policyData = req.body;

    const policy = {
      id: 'default_policy',
      policies: policyData.policies || [],
      clubbing_rules: policyData.clubbing_rules || [],
      updated_at: toISOString(new Date()),
      updated_by: req.user.email
    };

    await db.collection('leave_policies').updateOne(
      { id: 'default_policy' },
      { $set: policy },
      { upsert: true }
    );

    delete policy._id;

    res.json({
      status: 'success',
      message: 'Leave policy updated successfully',
      policy
    });
  } catch (error) {
    console.error('Save leave policy error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/leaves/leave-policy/apply-to-employee/:employeeId
 * Apply policy to specific employee (admin only)
 * Calculates leave balance based on employee's joining date
 */
router.post('/leave-policy/apply-to-employee/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;

    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
    if (!policy) {
      return res.status(404).json({ detail: 'Leave policy not configured' });
    }

    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { full_name: 1, joining_date: 1, email: 1 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    const joiningDate = employee.joining_date || new Date();
    const months = calculateMonthsSinceJoining(joiningDate);

    const newBalance = { comp_off: 0 };

    for (const policyItem of policy.policies || []) {
      const leaveKey = normalizeLeaveType(policyItem.leave_type);
      const monthlyCredit = getMonthlyCredit(policyItem, leaveKey);

      if (policyItem.credit_type === 'monthly' || monthlyCredit > 0) {
        // Calculate accrued balance based on joining date
        const maxBalance = policyItem.annual_quota || (monthlyCredit * 12);
        newBalance[leaveKey] = calculateAccruedBalance(joiningDate, monthlyCredit, maxBalance);
      } else {
        // Annual credit
        newBalance[leaveKey] = policyItem.annual_quota || 0;
      }
    }

    await db.collection('employees').updateOne(
      { employee_id: employeeId },
      { $set: { leave_balance: newBalance } }
    );

    res.json({
      status: 'success',
      message: `Leave policy applied to ${employee.full_name}`,
      joining_date: joiningDate,
      months_since_joining: months,
      new_balance: newBalance
    });
  } catch (error) {
    console.error('Apply policy to employee error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/leaves/leave-policy/apply-to-all
 * Apply policy to all employees (admin only)
 * Calculates leave balance based on each employee's joining date
 */
router.post('/leave-policy/apply-to-all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
    if (!policy) {
      return res.status(404).json({ detail: 'Leave policy not configured' });
    }

    // Get all employees
    const employees = await db.collection('employees').find({}).toArray();
    let updatedCount = 0;
    const results = [];

    for (const employee of employees) {
      const joiningDate = employee.joining_date || new Date();
      const months = calculateMonthsSinceJoining(joiningDate);

      const newBalance = { comp_off: employee.leave_balance?.comp_off || 0 }; // Preserve comp_off

      for (const policyItem of policy.policies || []) {
        const leaveKey = normalizeLeaveType(policyItem.leave_type);
        const monthlyCredit = getMonthlyCredit(policyItem, leaveKey);

        if (policyItem.credit_type === 'monthly' || monthlyCredit > 0) {
          const maxBalance = policyItem.annual_quota || (monthlyCredit * 12);
          newBalance[leaveKey] = calculateAccruedBalance(joiningDate, monthlyCredit, maxBalance);
        } else {
          newBalance[leaveKey] = policyItem.annual_quota || 0;
        }
      }

      await db.collection('employees').updateOne(
        { id: employee.id },
        { $set: { leave_balance: newBalance } }
      );

      results.push({
        employee_id: employee.employee_id,
        name: employee.full_name,
        joining_date: joiningDate,
        months: months,
        balance: newBalance
      });

      updatedCount++;
    }

    res.json({
      status: 'success',
      message: `Leave policy applied to ${updatedCount} employees based on their joining dates`,
      employees_updated: updatedCount,
      details: results
    });
  } catch (error) {
    console.error('Apply policy to all error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * GET /api/leaves/validate-application
 * Validate leave application before submission (pre-check)
 */
router.post('/validate-application', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const { leave_type, dates } = req.body;
    const employee = req.employee;

    const warnings = [];
    const errors = [];

    // Get leave policy for this type
    const policyItem = await getLeavePolicyForType(db, leave_type);

    if (policyItem) {
      // Check advance notice
      const advanceCheck = validateAdvanceNotice(dates, policyItem.advance_days_required);
      if (!advanceCheck.valid) {
        warnings.push({
          type: 'advance_notice',
          message: advanceCheck.message,
          severity: 'warning'
        });
      }

      // Check clubbing rules
      const clubbingCheck = await validateLeaveClubbing(db, employee.email, leave_type, dates);
      if (!clubbingCheck.valid) {
        errors.push({
          type: 'clubbing',
          message: clubbingCheck.message,
          severity: 'error'
        });
      }

      // Check balance - calculate accrued if monthly credit
      const leaveKey = normalizeLeaveType(leave_type);
      const currentBalance = employee.leave_balance?.[leaveKey] || 0;
      const monthlyCredit = getMonthlyCredit(policyItem, leaveKey);

      if (monthlyCredit > 0) {
        const maxBalance = policyItem.annual_quota || (monthlyCredit * 12);
        const accruedBalance = calculateAccruedBalance(
          employee.joining_date,
          monthlyCredit,
          maxBalance
        );

        const daysRequested = dates.length;

        // Show accrued vs actual balance
        if (accruedBalance < daysRequested) {
          warnings.push({
            type: 'accrued_balance',
            message: `You have ${accruedBalance.toFixed(1)} days accrued based on your joining date. Requesting ${daysRequested} days.`,
            severity: 'info',
            accrued: accruedBalance,
            total: currentBalance,
            requested: daysRequested
          });
        }
      }

      // Add policy info
      warnings.push({
        type: 'policy_info',
        message: null,
        severity: 'info',
        policy: {
          credit_type: policyItem.credit_type,
          monthly_credit: monthlyCredit,
          advance_days_required: policyItem.advance_days_required,
          encashment_allowed: policyItem.encashment_allowed,
          carry_forward_allowed: policyItem.carry_forward_allowed,
          clubbing_not_allowed_with: policyItem.clubbing_not_allowed_with || []
        }
      });
    }

    res.json({
      valid: errors.length === 0,
      warnings,
      errors
    });
  } catch (error) {
    console.error('Validate application error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============================================
// LEAVE APPLICATION ROUTES
// ============================================

/**
 * POST /api/leaves
 * Apply for leave
 */
router.post('/', authenticate, getCurrentEmployee, validate(schemas.leaveApplication), async (req, res) => {
  try {
    const db = getDB();
    const leaveData = req.validatedBody;
    const employee = req.employee;

    const daysCount = calculateDaysFromDates(leaveData.dates, leaveData.is_half_day);

    // Get leave policy for validation
    const policyItem = await getLeavePolicyForType(db, leaveData.leave_type);

    // Validate advance notice (soft warning - allow override with force flag)
    if (policyItem && policyItem.advance_days_required > 0 && !req.body.force_submit) {
      const advanceCheck = validateAdvanceNotice(leaveData.dates, policyItem.advance_days_required);
      if (!advanceCheck.valid) {
        return res.status(400).json({
          detail: advanceCheck.message,
          warning_type: 'advance_notice',
          can_override: true
        });
      }
    }

    // Validate clubbing rules (hard error - cannot override)
    const clubbingCheck = await validateLeaveClubbing(db, employee.email, leaveData.leave_type, leaveData.dates);
    if (!clubbingCheck.valid) {
      return res.status(400).json({
        detail: clubbingCheck.message,
        warning_type: 'clubbing',
        can_override: false
      });
    }

    // Check leave balance
    const leaveTypeKey = normalizeLeaveType(leaveData.leave_type);
    const available = employee.leave_balance[leaveTypeKey] || 0;

    if (leaveData.leave_type !== LeaveType.UNPAID_LEAVE && available < daysCount) {
      return res.status(400).json({
        detail: `Insufficient leave balance. Available: ${available} days, Requested: ${daysCount} days`
      });
    }

    // Create leave application
    const now = new Date();
    const monthlyCredit = policyItem ? getMonthlyCredit(policyItem, leaveTypeKey) : 0;

    const leaveDoc = {
      id: generateUUID(),
      employee_id: employee.id,
      employee_name: employee.full_name,
      employee_email: employee.email,
      manager_email: employee.manager_email || null,
      leave_type: leaveData.leave_type,
      dates: datesToISOStrings(leaveData.dates),
      days_count: daysCount,
      reason: leaveData.reason,
      is_half_day: leaveData.is_half_day || false,
      half_day_period: leaveData.half_day_period || null,
      status: LeaveStatus.PENDING,
      approvals: [],
      policy_snapshot: policyItem ? {
        credit_type: policyItem.credit_type,
        monthly_credit: monthlyCredit,
        advance_days_required: policyItem.advance_days_required,
        encashment_allowed: policyItem.encashment_allowed,
        carry_forward_allowed: policyItem.carry_forward_allowed
      } : null,
      created_at: toISOString(now),
      updated_at: toISOString(now)
    };

    await db.collection('leaves').insertOne(leaveDoc);

    // Send notifications
    try {
      const datesDisplay = formatDatesForDisplay(leaveData.dates);

      const emailHtml = generateLeaveApplicationEmail(
        employee.full_name,
        leaveData.leave_type,
        datesDisplay,
        null,
        leaveData.reason
      );

      const whatsappMsg = `New leave application from ${employee.full_name}\nType: ${leaveData.leave_type}\nDates: ${datesDisplay}\nDays: ${daysCount}\nReason: ${leaveData.reason}`;

      const manager = await db.collection('employees').findOne(
        { department: employee.department, role: 'manager' },
        { projection: { email: 1, phone: 1 } }
      );

      if (manager) {
        await sendEmailNotification(
          manager.email,
          `Leave Application from ${employee.full_name}`,
          emailHtml
        );

        if (manager.phone) {
          await sendWhatsAppNotification(manager.phone, whatsappMsg);
        }
      }

      const admin = await db.collection('employees').findOne(
        { role: 'admin' },
        { projection: { email: 1, phone: 1 } }
      );

      if (admin && admin.email !== manager?.email) {
        await sendEmailNotification(
          admin.email,
          `Leave Application from ${employee.full_name}`,
          emailHtml
        );

        if (admin.phone) {
          await sendWhatsAppNotification(admin.phone, whatsappMsg);
        }
      }
    } catch (notifyError) {
      console.error('Failed to send notification:', notifyError.message);
    }

    delete leaveDoc._id;
    normalizeLeaveDates(leaveDoc);

    res.status(201).json(leaveDoc);
  } catch (error) {
    console.error('Apply leave error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/my-leaves
 * Get current user's leaves
 */
router.get('/my-leaves', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const employee = req.employee;

    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    leaves.forEach(normalizeLeaveDates);

    res.json(leaves);
  } catch (error) {
    console.error('Get my leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/pending
 * Get pending leaves for approval
 */
router.get('/pending', authenticate, getCurrentEmployee, async (req, res) => {
  try {
    const db = getDB();
    const user = req.user;
    const employee = req.employee;

    let query = {};

    if (user.role === UserRole.MANAGER) {
      query = {
        manager_email: employee.email,
        status: LeaveStatus.PENDING
      };
    } else if (user.role === UserRole.ADMIN) {
      query = {
        status: { $in: [LeaveStatus.PENDING, LeaveStatus.MANAGER_APPROVED] }
      };
    } else {
      return res.status(403).json({ detail: 'Not enough permissions' });
    }

    const leaves = await db.collection('leaves')
      .find(query, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    leaves.forEach(normalizeLeaveDates);

    res.json(leaves);
  } catch (error) {
    console.error('Get pending leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/all
 * Get all leaves (admin only)
 */
router.get('/all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const leaves = await db.collection('leaves')
      .find({}, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    leaves.forEach(normalizeLeaveDates);

    res.json(leaves);
  } catch (error) {
    console.error('Get all leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/calendar/me
 * Get current user's leaves for calendar
 */
router.get('/calendar/me', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const user = req.user;

    const employee = await db.collection('employees').findOne(
      { email: user.email },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    req.params.employeeId = employee.employee_id;

    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    const leaveColors = {
      sick_leave: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
      casual_leave: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
      paid_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      earned_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      unpaid_leave: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
      comp_off: { bg: '#e9d5ff', border: '#a855f7', text: '#6b21a8' }
    };

    const statusStyles = {
      pending: { opacity: '0.6', pattern: 'striped' },
      manager_approved: { opacity: '0.8', pattern: 'dotted' },
      approved: { opacity: '1', pattern: 'solid' },
      rejected: { opacity: '0.4', pattern: 'crossed' }
    };

    const { year, month } = req.query;
    const calendarEvents = [];

    for (const leave of leaves) {
      normalizeLeaveDates(leave);

      const leaveTypeKey = normalizeLeaveType(leave.leave_type);
      const colors = leaveColors[leaveTypeKey] || { bg: '#f1f5f9', border: '#64748b', text: '#334155' };
      const statusStyle = statusStyles[leave.status] || { opacity: '1', pattern: 'solid' };

      for (const date of leave.dates || []) {
        const dateObj = new Date(date);
        const dateStr = dateObj.toISOString().substring(0, 10);

        if (year && month) {
          const yearInt = parseInt(year, 10);
          const monthInt = parseInt(month, 10);
          const eventYear = dateObj.getFullYear();
          const eventMonth = dateObj.getMonth() + 1;

          if (eventYear !== yearInt || eventMonth !== monthInt) {
            continue;
          }
        } else if (year) {
          const yearInt = parseInt(year, 10);
          if (dateObj.getFullYear() !== yearInt) {
            continue;
          }
        }

        calendarEvents.push({
          id: `${leave.id}_${dateStr}`,
          leave_id: leave.id,
          title: leave.leave_type,
          date: dateStr,
          datetime: dateObj.toISOString(),
          leave_type: leave.leave_type,
          leave_type_key: leaveTypeKey,
          status: leave.status,
          reason: leave.reason,
          is_half_day: leave.is_half_day || false,
          half_day_period: leave.half_day_period,
          total_days_in_application: leave.days_count,
          colors,
          status_style: statusStyle
        });
      }
    }

    calendarEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      employee: {
        id: employee.employee_id,
        name: employee.full_name,
        email: employee.email,
        department: employee.department
      },
      leave_balance: employee.leave_balance || {},
      events: calendarEvents,
      color_legend: leaveColors,
      status_legend: statusStyles
    });
  } catch (error) {
    console.error('Get my calendar leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/leaves/calendar/:employeeId
 * Get employee leaves for calendar
 */
router.get('/calendar/:employeeId', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;
    const { year, month } = req.query;
    const user = req.user;

    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    if (![UserRole.ADMIN, UserRole.MANAGER].includes(user.role)) {
      if (employee.email !== user.email) {
        return res.status(403).json({ detail: "Not authorized to view this employee's leaves" });
      }
    }

    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    const leaveColors = {
      sick_leave: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
      casual_leave: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
      paid_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      earned_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      unpaid_leave: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
      comp_off: { bg: '#e9d5ff', border: '#a855f7', text: '#6b21a8' }
    };

    const statusStyles = {
      pending: { opacity: '0.6', pattern: 'striped' },
      manager_approved: { opacity: '0.8', pattern: 'dotted' },
      approved: { opacity: '1', pattern: 'solid' },
      rejected: { opacity: '0.4', pattern: 'crossed' }
    };

    const calendarEvents = [];

    for (const leave of leaves) {
      normalizeLeaveDates(leave);

      const leaveTypeKey = normalizeLeaveType(leave.leave_type);
      const colors = leaveColors[leaveTypeKey] || { bg: '#f1f5f9', border: '#64748b', text: '#334155' };
      const statusStyle = statusStyles[leave.status] || { opacity: '1', pattern: 'solid' };

      for (const date of leave.dates || []) {
        const dateObj = new Date(date);
        const dateStr = dateObj.toISOString().substring(0, 10);

        if (year && month) {
          const yearInt = parseInt(year, 10);
          const monthInt = parseInt(month, 10);
          const eventYear = dateObj.getFullYear();
          const eventMonth = dateObj.getMonth() + 1;

          if (eventYear !== yearInt || eventMonth !== monthInt) {
            continue;
          }
        } else if (year) {
          const yearInt = parseInt(year, 10);
          if (dateObj.getFullYear() !== yearInt) {
            continue;
          }
        }

        calendarEvents.push({
          id: `${leave.id}_${dateStr}`,
          leave_id: leave.id,
          title: leave.leave_type,
          date: dateStr,
          datetime: dateObj.toISOString(),
          leave_type: leave.leave_type,
          leave_type_key: leaveTypeKey,
          status: leave.status,
          reason: leave.reason,
          is_half_day: leave.is_half_day || false,
          half_day_period: leave.half_day_period,
          total_days_in_application: leave.days_count,
          colors,
          status_style: statusStyle
        });
      }
    }

    calendarEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json({
      employee: {
        id: employee.employee_id,
        name: employee.full_name,
        email: employee.email,
        department: employee.department
      },
      leave_balance: employee.leave_balance || {},
      events: calendarEvents,
      color_legend: leaveColors,
      status_legend: statusStyles
    });
  } catch (error) {
    console.error('Get calendar leaves error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============================================
// PARAMETERIZED ROUTES (MUST BE LAST)
// ============================================

/**
 * PUT /api/leaves/:leaveId/action
 * Approve or reject leave
 */
router.put('/:leaveId/action', authenticate, getCurrentEmployee, validate(schemas.leaveAction), async (req, res) => {
  try {
    const db = getDB();
    const { leaveId } = req.params;
    const { action, comments } = req.validatedBody;
    const user = req.user;
    const employee = req.employee;

    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    normalizeLeaveDates(leaveDoc);

    const originalStatus = leaveDoc.status;

    let newStatus = leaveDoc.status;

    if (user.role === UserRole.MANAGER) {
      if (leaveDoc.status !== LeaveStatus.PENDING) {
        return res.status(400).json({ detail: 'Leave is not pending' });
      }
      if (leaveDoc.manager_email !== employee.email) {
        return res.status(403).json({ detail: 'Not your team member' });
      }

      newStatus = action === 'approve' ? LeaveStatus.MANAGER_APPROVED : LeaveStatus.REJECTED;
    } else if (user.role === UserRole.ADMIN) {
      if (![LeaveStatus.PENDING, LeaveStatus.MANAGER_APPROVED].includes(leaveDoc.status)) {
        return res.status(400).json({ detail: 'Leave already processed' });
      }

      newStatus = action === 'approve' ? LeaveStatus.APPROVED : LeaveStatus.REJECTED;
    } else {
      return res.status(403).json({ detail: 'Not enough permissions' });
    }

    const approvalRecord = {
      approver_email: employee.email,
      approver_name: employee.full_name,
      approver_role: user.role,
      action,
      comments: comments || null,
      timestamp: toISOString(new Date())
    };

    leaveDoc.approvals.push(approvalRecord);
    leaveDoc.status = newStatus;
    leaveDoc.updated_at = toISOString(new Date());

    const wasBalanceNotYetDeducted = originalStatus === LeaveStatus.PENDING;
    const isNowApproved = newStatus === LeaveStatus.MANAGER_APPROVED || newStatus === LeaveStatus.APPROVED;

    if (wasBalanceNotYetDeducted && isNowApproved && leaveDoc.leave_type !== LeaveType.UNPAID_LEAVE) {
      const leaveTypeKey = normalizeLeaveType(leaveDoc.leave_type);
      await db.collection('employees').updateOne(
        { email: leaveDoc.employee_email },
        { $inc: { [`leave_balance.${leaveTypeKey}`]: -leaveDoc.days_count } }
      );
      console.log(`Deducted ${leaveDoc.days_count} ${leaveTypeKey} from ${leaveDoc.employee_email}`);
    }

    const wasAlreadyDeducted = originalStatus === LeaveStatus.MANAGER_APPROVED;
    const isNowRejected = newStatus === LeaveStatus.REJECTED;

    if (wasAlreadyDeducted && isNowRejected && leaveDoc.leave_type !== LeaveType.UNPAID_LEAVE) {
      const leaveTypeKey = normalizeLeaveType(leaveDoc.leave_type);
      await db.collection('employees').updateOne(
        { email: leaveDoc.employee_email },
        { $inc: { [`leave_balance.${leaveTypeKey}`]: leaveDoc.days_count } }
      );
      console.log(`Refunded ${leaveDoc.days_count} ${leaveTypeKey} to ${leaveDoc.employee_email} (rejected after manager approval)`);
    }

    const updateDoc = {
      ...leaveDoc,
      dates: datesToISOStrings(leaveDoc.dates),
      created_at: toISOString(leaveDoc.created_at),
      updated_at: leaveDoc.updated_at
    };

    for (const approval of updateDoc.approvals) {
      if (approval.timestamp instanceof Date) {
        approval.timestamp = toISOString(approval.timestamp);
      }
    }

    await db.collection('leaves').updateOne(
      { id: leaveId },
      { $set: updateDoc }
    );

    try {
      const employeeRecord = await db.collection('employees').findOne(
        { email: leaveDoc.employee_email },
        { projection: { phone: 1 } }
      );

      const datesDisplay = formatDatesForDisplay(leaveDoc.dates);

      if (newStatus === LeaveStatus.APPROVED || newStatus === LeaveStatus.REJECTED) {
        const statusText = newStatus === LeaveStatus.APPROVED ? 'approved' : 'rejected';
        const emailHtml = generateLeaveApprovalEmail(
          leaveDoc.employee_name,
          leaveDoc.leave_type,
          datesDisplay,
          null,
          statusText
        );

        await sendEmailNotification(
          leaveDoc.employee_email,
          `Leave ${statusText.charAt(0).toUpperCase() + statusText.slice(1)} - ${leaveDoc.leave_type}`,
          emailHtml
        );

        if (employeeRecord?.phone) {
          const whatsappMsg = `Your leave application has been ${statusText.toUpperCase()}!\n\nType: ${leaveDoc.leave_type}\nDates: ${datesDisplay}`;
          await sendWhatsAppNotification(employeeRecord.phone, whatsappMsg);
        }
      } else if (newStatus === LeaveStatus.MANAGER_APPROVED) {
        const emailHtml = generateLeaveApprovalEmail(
          leaveDoc.employee_name,
          leaveDoc.leave_type,
          datesDisplay,
          null,
          'approved by manager (pending admin approval)'
        );

        await sendEmailNotification(
          leaveDoc.employee_email,
          'Leave Approved by Manager - Pending Admin Approval',
          emailHtml
        );

        const admin = await db.collection('employees').findOne(
          { role: 'admin' },
          { projection: { email: 1 } }
        );

        if (admin) {
          const adminHtml = generateLeaveApplicationEmail(
            leaveDoc.employee_name,
            leaveDoc.leave_type,
            datesDisplay,
            null,
            leaveDoc.reason
          );

          await sendEmailNotification(
            admin.email,
            `Leave Approved by Manager - ${leaveDoc.employee_name}`,
            adminHtml
          );
        }
      }
    } catch (notifyError) {
      console.error('Failed to send notification:', notifyError.message);
    }

    normalizeLeaveDates(leaveDoc);

    res.json(leaveDoc);
  } catch (error) {
    console.error('Leave action error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/leaves/:leaveId
 * Edit leave (admin only)
 */
router.put('/:leaveId', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.leaveEdit), async (req, res) => {
  try {
    const db = getDB();
    const { leaveId } = req.params;
    const editData = req.validatedBody;
    const user = req.user;

    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    normalizeLeaveDates(leaveDoc);

    const originalLeave = { ...leaveDoc };
    const wasBalanceDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(originalLeave.status);
    const originalDays = originalLeave.days_count;
    const originalLeaveType = originalLeave.leave_type;

    const updateDict = {};

    if (editData.leave_type !== undefined) updateDict.leave_type = editData.leave_type;
    if (editData.reason !== undefined) updateDict.reason = editData.reason;
    if (editData.is_half_day !== undefined) updateDict.is_half_day = editData.is_half_day;
    if (editData.half_day_period !== undefined) updateDict.half_day_period = editData.half_day_period;

    const isHalfDay = editData.is_half_day !== undefined ? editData.is_half_day : originalLeave.is_half_day;
    let newDays = originalDays;

    if (editData.dates) {
      updateDict.dates = datesToISOStrings(editData.dates);
      newDays = calculateDaysFromDates(editData.dates, isHalfDay);
      updateDict.days_count = newDays;
    } else if (editData.is_half_day !== undefined) {
      newDays = calculateDaysFromDates(originalLeave.dates, isHalfDay);
      updateDict.days_count = newDays;
    }

    const newStatus = editData.status !== undefined ? editData.status : originalLeave.status;
    if (editData.status !== undefined) {
      updateDict.status = newStatus;

      const approvalRecord = {
        approver_email: user.email,
        approver_name: user.full_name,
        approver_role: user.role,
        action: 'edited',
        comments: `Status changed to ${newStatus} by admin`,
        timestamp: toISOString(new Date())
      };

      const existingApprovals = leaveDoc.approvals.map(a => ({
        ...a,
        timestamp: typeof a.timestamp === 'string' ? a.timestamp : toISOString(a.timestamp)
      }));
      existingApprovals.push(approvalRecord);
      updateDict.approvals = existingApprovals;
    }

    updateDict.updated_at = toISOString(new Date());

    const newLeaveType = updateDict.leave_type || originalLeaveType;
    const employeeEmail = originalLeave.employee_email;
    const willBalanceBeDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(newStatus);

    if (wasBalanceDeducted && originalLeaveType !== LeaveType.UNPAID_LEAVE) {
      const originalKey = normalizeLeaveType(originalLeaveType);

      if (!willBalanceBeDeducted) {
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: originalDays } }
        );
        console.log(`Refunded ${originalDays} ${originalKey} to ${employeeEmail} (status changed to ${newStatus})`);
      } else if (newLeaveType !== originalLeaveType) {
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: originalDays } }
        );
        console.log(`Refunded ${originalDays} ${originalKey} to ${employeeEmail} (leave type changed)`);

        if (newLeaveType !== LeaveType.UNPAID_LEAVE) {
          const newKey = normalizeLeaveType(newLeaveType);
          await db.collection('employees').updateOne(
            { email: employeeEmail },
            { $inc: { [`leave_balance.${newKey}`]: -newDays } }
          );
          console.log(`Deducted ${newDays} ${newKey} from ${employeeEmail} (leave type changed)`);
        }
      } else if (newDays !== originalDays) {
        const daysDiff = newDays - originalDays;
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: -daysDiff } }
        );
        console.log(`Adjusted ${-daysDiff} ${originalKey} for ${employeeEmail} (days changed)`);
      }
    } else if (!wasBalanceDeducted && willBalanceBeDeducted) {
      if (newLeaveType !== LeaveType.UNPAID_LEAVE) {
        const newKey = normalizeLeaveType(newLeaveType);

        const emp = await db.collection('employees').findOne(
          { email: employeeEmail },
          { projection: { leave_balance: 1 } }
        );
        const available = emp?.leave_balance?.[newKey] || 0;

        if (available < newDays) {
          return res.status(400).json({
            detail: `Insufficient ${newLeaveType} balance. Available: ${available}, Required: ${newDays}`
          });
        }

        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${newKey}`]: -newDays } }
        );
        console.log(`Deducted ${newDays} ${newKey} from ${employeeEmail} (status changed to ${newStatus})`);
      }
    }

    await db.collection('leaves').updateOne(
      { id: leaveId },
      { $set: updateDict }
    );

    await db.collection('leave_edit_logs').insertOne({
      leave_id: leaveId,
      edited_by: user.email,
      original_data: {
        leave_type: originalLeaveType,
        dates: datesToISOStrings(originalLeave.dates),
        days_count: originalDays,
        status: originalLeave.status
      },
      changes: editData,
      timestamp: new Date()
    });

    try {
      const emp = await db.collection('employees').findOne(
        { email: employeeEmail },
        { projection: { full_name: 1 } }
      );

      if (emp) {
        const changes = [];
        if (editData.leave_type) changes.push(`Leave type: ${originalLeaveType} → ${newLeaveType}`);
        if (editData.dates) changes.push('Dates updated');
        if (editData.status) changes.push(`Status: ${originalLeave.status} → ${newStatus}`);

        const emailHtml = generateLeaveEditEmail(emp.full_name, changes);
        await sendEmailNotification(employeeEmail, 'Leave Application Updated', emailHtml);
      }
    } catch (notifyError) {
      console.error('Failed to send leave edit notification:', notifyError.message);
    }

    const updatedLeave = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    normalizeLeaveDates(updatedLeave);

    res.json(updatedLeave);
  } catch (error) {
    console.error('Edit leave error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/leaves/:leaveId
 * Delete leave (admin only)
 */
router.delete('/:leaveId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { leaveId } = req.params;

    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    const wasBalanceDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(leaveDoc.status);

    if (wasBalanceDeducted && leaveDoc.leave_type !== LeaveType.UNPAID_LEAVE) {
      const leaveTypeKey = normalizeLeaveType(leaveDoc.leave_type);
      await db.collection('employees').updateOne(
        { email: leaveDoc.employee_email },
        { $inc: { [`leave_balance.${leaveTypeKey}`]: leaveDoc.days_count } }
      );
      console.log(`Refunded ${leaveDoc.days_count} ${leaveTypeKey} to ${leaveDoc.employee_email} (leave deleted)`);
    }

    await db.collection('leaves').deleteOne({ id: leaveId });

    await db.collection('leave_edit_logs').insertOne({
      leave_id: leaveId,
      action: 'deleted',
      deleted_by: req.user.email,
      leave_data: leaveDoc,
      timestamp: new Date()
    });

    res.json({
      status: 'success',
      message: 'Leave deleted successfully',
      leave_id: leaveId
    });
  } catch (error) {
    console.error('Delete leave error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
module.exports.getLeaveBalanceFromPolicy = getLeaveBalanceFromPolicy;
module.exports.calculateAccruedBalance = calculateAccruedBalance;
module.exports.calculateMonthsSinceJoining = calculateMonthsSinceJoining;
module.exports.DEFAULT_MONTHLY_CREDITS = DEFAULT_MONTHLY_CREDITS;
