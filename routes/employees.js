const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate, getCurrentEmployee } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { schemas, UserRole, defaultLeaveBalance } = require('../models/schemas');
const { hashPassword, generateUUID, normalizeLeaveType } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { generateWelcomeEmail, generateNewEmployeeNotificationEmail } = require('../utils/emailTemplates');

/**
 * Default monthly credit rates for leave types
 * - Casual Leave: 0.5 per month
 * - Sick Leave: 0.5 per month
 * - Earned Leave: 1 per month
 */
const DEFAULT_MONTHLY_CREDITS = {
  'casual_leave': 0.5,
  'sick_leave': 0.5,
  'earned_leave': 1
};

/**
 * Helper: Calculate months since joining date
 * @param {Date} joiningDate - Employee's joining date
 * @returns {number} - Number of complete months since joining
 */
function calculateMonthsSinceJoining(joiningDate) {
  const now = new Date();
  const joining = new Date(joiningDate);

  let months = (now.getFullYear() - joining.getFullYear()) * 12;
  months += now.getMonth() - joining.getMonth();

  if (now.getDate() < joining.getDate()) {
    months--;
  }

  return Math.max(0, months);
}

/**
 * Helper: Calculate accrued balance for monthly-credited leaves
 * @param {Date} joiningDate - Employee's joining date
 * @param {number} monthlyCredit - Days credited per month
 * @param {number} annualQuota - Maximum annual quota (cap)
 * @returns {number} - Accrued balance
 */
function calculateAccruedBalance(joiningDate, monthlyCredit, annualQuota) {
  if (!joiningDate || !monthlyCredit) return 0;

  const months = calculateMonthsSinceJoining(joiningDate);
  const accrued = months * monthlyCredit;

  // Round to 1 decimal place and cap at annual quota
  return Math.min(Math.round(accrued * 10) / 10, annualQuota);
}

/**
 * Helper: Get monthly credit rate for a leave type
 * Uses policy if available, otherwise falls back to defaults
 */
function getMonthlyCredit(policyItem, leaveKey) {
  if (policyItem && policyItem.monthly_credit !== undefined && policyItem.monthly_credit > 0) {
    return policyItem.monthly_credit;
  }
  return DEFAULT_MONTHLY_CREDITS[leaveKey] || 0;
}

/**
 * Helper: Get leave balance from configured policy
 * Now properly handles monthly vs annual credits with default rates:
 * - Casual Leave: 0.5 per month
 * - Sick Leave: 0.5 per month
 * - Earned Leave: 1 per month
 * @param {Object} db - Database connection
 * @param {Date} joiningDate - Employee's joining date (for monthly credit calculation)
 */
async function getLeaveBalanceFromPolicy(db, joiningDate = null) {
  try {
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
  } catch (error) {
    console.error('Error fetching leave policy:', error);
    // Fallback to default on error
    const months = calculateMonthsSinceJoining(joiningDate || new Date());
    return {
      earned_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.earned_leave * 10) / 10,
      sick_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.sick_leave * 10) / 10,
      casual_leave: Math.round(months * DEFAULT_MONTHLY_CREDITS.casual_leave * 10) / 10,
      paid_leave: 0,
      unpaid_leave: 0,
      comp_off: 0
    };
  }
}

/**
 * GET /api/employees
 * Get all employees (admin) or team members (manager)
 */
router.get('/', authenticate, requireRole([UserRole.ADMIN, UserRole.MANAGER]), async (req, res) => {
  try {
    const db = getDB();
    const user = req.user;

    let query = {};

    // If user is a manager, only return employees in their team
    if (user.role === UserRole.MANAGER) {
      query = {
        $or: [
          { manager_email: user.email },  // Employees reporting to this manager
          { email: user.email }            // Include the manager themselves
        ]
      };
    }
    // If admin, query remains empty = fetch all employees

    const employees = await db.collection('employees')
      .find(query, { projection: { _id: 0 } })
      .toArray();

    // Normalize dates and set id to employee_id for frontend
    // Also ensure comp_off exists in leave_balance
    for (const emp of employees) {
      if (typeof emp.joining_date === 'string') {
        emp.joining_date = new Date(emp.joining_date);
      }
      if (typeof emp.created_at === 'string') {
        emp.created_at = new Date(emp.created_at);
      }
      emp.id = emp.employee_id;

      // Ensure comp_off exists in leave_balance
      if (emp.leave_balance && !('comp_off' in emp.leave_balance)) {
        emp.leave_balance.comp_off = 0;
      }
    }

    res.json(employees);
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/employees
 * Create new employee (admin only)
 */
router.post('/', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.employeeCreate), async (req, res) => {
  try {
    const db = getDB();
    const employeeData = req.validatedBody;
    const now = new Date();

    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ email: employeeData.email });
    if (existingUser) {
      return res.status(400).json({ detail: 'User with this email already exists' });
    }

    // ============================================
    // FIX: ATOMIC COUNTER INCREMENT
    // This prevents duplicate employee IDs
    // ============================================
    const settingsUpdate = await db.collection('settings').findOneAndUpdate(
      {},
      { $inc: { employee_id_counter: 1 } },
      { returnDocument: 'after' }
    );

    if (!settingsUpdate || !settingsUpdate.value) {
      // Try to get settings without update (maybe first time)
      const settings = await db.collection('settings').findOne({});
      if (!settings) {
        return res.status(500).json({ detail: 'System settings not initialized' });
      }
      // Initialize counter if not exists
      await db.collection('settings').updateOne(
        {},
        { $set: { employee_id_counter: (settings.employee_id_counter || 1000) + 1 } }
      );
      var employeeId = `${settings.employee_id_prefix || 'EMP'}${String((settings.employee_id_counter || 1000) + 1).padStart(4, '0')}`;
    } else {
      const settings = settingsUpdate.value;
      var employeeId = `${settings.employee_id_prefix || 'EMP'}${String(settings.employee_id_counter).padStart(4, '0')}`;
    }

    // Double-check this employee_id doesn't already exist (safety check)
    const existingEmployee = await db.collection('employees').findOne({ employee_id: employeeId });
    if (existingEmployee) {
      // If somehow duplicate, increment again and retry
      const retrySettings = await db.collection('settings').findOneAndUpdate(
        {},
        { $inc: { employee_id_counter: 1 } },
        { returnDocument: 'after' }
      );
      employeeId = `${retrySettings.value.employee_id_prefix || 'EMP'}${String(retrySettings.value.employee_id_counter).padStart(4, '0')}`;
    }

    const employeeUuid = generateUUID();

    // Resolve organization name
    let organizationName = null;
    if (employeeData.organization_id) {
      const org = await db.collection('organizations').findOne(
        { id: employeeData.organization_id },
        { projection: { name: 1 } }
      );
      if (!org) {
        return res.status(400).json({ detail: 'Invalid organization_id' });
      }
      organizationName = org.name;
    }

    // Resolve manager name
    let managerName = null;
    if (employeeData.manager_email) {
      const manager = await db.collection('employees').findOne(
        { email: employeeData.manager_email },
        { projection: { full_name: 1 } }
      );
      if (!manager) {
        return res.status(400).json({ detail: 'Invalid manager_email' });
      }
      managerName = manager.full_name;
    }

    // ============================================
    // GET LEAVE BALANCE FROM CONFIGURED POLICY
    // Now properly calculates monthly credits based on joining date
    // ============================================
    const joiningDate = employeeData.joining_date || now;
    let leaveBalance;

    if (employeeData.leave_balance && Object.keys(employeeData.leave_balance).length > 0) {
      // Use provided leave balance (for custom cases)
      leaveBalance = {
        ...employeeData.leave_balance,
        comp_off: employeeData.leave_balance.comp_off ?? 0  // Ensure comp_off exists
      };
    } else {
      // Get from configured policy - now with joining date for monthly credit calculation
      leaveBalance = await getLeaveBalanceFromPolicy(db, joiningDate);
    }

    // Create user document
    const userDoc = {
      id: employeeUuid,
      employee_id: employeeId,
      full_name: employeeData.full_name,
      email: employeeData.email,
      hashed_password: await hashPassword(employeeData.password),
      role: employeeData.role,
      department: employeeData.department,
      designation: employeeData.designation,
      phone: employeeData.phone || null,
      organization_id: employeeData.organization_id || null,
      created_at: now
    };

    await db.collection('users').insertOne(userDoc);

    // Create employee document
    const employeeDoc = {
      id: employeeUuid,
      employee_id: employeeId,
      email: employeeData.email,
      full_name: employeeData.full_name,
      role: employeeData.role,
      department: employeeData.department,
      designation: employeeData.designation,
      phone: employeeData.phone || null,
      organization_id: employeeData.organization_id || null,
      organization_name: organizationName,
      joining_date: joiningDate,
      manager_email: employeeData.manager_email || null,
      manager_name: managerName,
      leave_balance: leaveBalance,  // Includes comp_off and proper monthly credit calculation
      created_at: now
    };

    await db.collection('employees').insertOne(employeeDoc);

    // Send welcome email
    try {
      const welcomeHtml = generateWelcomeEmail(
        employeeData.full_name,
        employeeId,
        employeeData.email,
        employeeData.role,
        employeeData.department,
        employeeData.designation
      );
      await sendEmailNotification(
        employeeData.email,
        `Welcome to HRMS - ${employeeData.full_name}`,
        welcomeHtml
      );

      // Notify admin
      const admin = await db.collection('employees').findOne(
        { role: 'admin' },
        { projection: { email: 1, full_name: 1 } }
      );
      if (admin && admin.email !== req.user.email) {
        const adminNotificationHtml = generateNewEmployeeNotificationEmail(
          employeeData.full_name,
          employeeId,
          employeeData.email,
          employeeData.role,
          employeeData.department,
          employeeData.designation,
          admin.full_name || 'Admin'
        );
        await sendEmailNotification(
          admin.email,
          `New Employee Added - ${employeeData.full_name}`,
          adminNotificationHtml
        );
      }
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError.message);
    }

    // Remove MongoDB _id from response
    delete employeeDoc._id;

    res.status(201).json(employeeDoc);
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/employees/:userId
 * Update employee
 * 
 * FIX: Now uses EMAIL to find the correct employee, not employee_id
 * This prevents issues when there are duplicate employee_ids
 */
router.put('/:userId', authenticate, validate(schemas.employeeUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.params;
    const updateData = req.validatedBody;

    // ============================================
    // FIX: Find by employee_id but get the specific one
    // If there are duplicates, we need to be more careful
    // ============================================

    // First, check how many employees have this ID
    const employeesWithId = await db.collection('employees')
      .find({ employee_id: userId }, { projection: { _id: 0 } })
      .toArray();

    if (employeesWithId.length === 0) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // If there are multiple employees with same ID (data corruption), 
    // we need to identify which one to update
    let employee;
    if (employeesWithId.length > 1) {
      console.warn(`WARNING: Multiple employees found with employee_id ${userId}. This indicates data corruption.`);
      // Try to match by additional criteria from request if available
      // For now, log the issue and use the non-admin one (as admin should have unique setup)
      employee = employeesWithId.find(e => e.role !== 'admin') || employeesWithId[0];
    } else {
      employee = employeesWithId[0];
    }

    // Find corresponding user by EMAIL (more reliable)
    const user = await db.collection('users').findOne(
      { email: employee.email },
      { projection: { _id: 0 } }
    );

    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    // Permission check
    if (req.user.role !== UserRole.ADMIN && user.email !== req.user.email) {
      return res.status(403).json({ detail: 'Not enough permissions' });
    }

    // Allowed fields only - NOW INCLUDES joining_date
    const allowedFields = ['full_name', 'department', 'designation', 'phone', 'organization_id', 'manager_email', 'monthly_salary', 'joining_date'];
    const updateDict = {};

    for (const key of Object.keys(updateData)) {
      if (allowedFields.includes(key) && updateData[key] !== undefined) {
        updateDict[key] = updateData[key];
      }
    }

    // Resolve manager
    if ('manager_email' in updateDict) {
      if (updateDict.manager_email) {
        const manager = await db.collection('employees').findOne(
          { email: updateDict.manager_email },
          { projection: { full_name: 1 } }
        );
        if (!manager) {
          return res.status(400).json({ detail: 'Invalid manager_email' });
        }
        updateDict.manager_name = manager.full_name;
      } else {
        updateDict.manager_name = null;
      }
    }

    // Resolve organization
    if ('organization_id' in updateDict) {
      if (updateDict.organization_id) {
        const org = await db.collection('organizations').findOne(
          { id: updateDict.organization_id },
          { projection: { name: 1 } }
        );
        if (!org) {
          return res.status(400).json({ detail: 'Invalid organization_id' });
        }
        updateDict.organization_name = org.name;
      } else {
        updateDict.organization_name = null;
      }
    }

    // ============================================
    // Handle joining_date update - convert to Date object
    // ============================================
    if ('joining_date' in updateDict && updateDict.joining_date) {
      updateDict.joining_date = new Date(updateDict.joining_date);
    }

    // ============================================
    // FIX: Update by EMAIL, not employee_id
    // This ensures we update the correct record
    // ============================================
    if (Object.keys(updateDict).length > 0) {
      await db.collection('employees').updateOne(
        { email: employee.email },  // Use email instead of employee_id
        { $set: updateDict }
      );

      // Sync user fields - also by email
      const userSyncFields = {};
      for (const key of ['full_name', 'department', 'designation', 'phone', 'organization_id', 'monthly_salary']) {
        if (key in updateDict) {
          userSyncFields[key] = updateDict[key];
        }
      }

      if (Object.keys(userSyncFields).length > 0) {
        await db.collection('users').updateOne(
          { email: employee.email },  // Use email instead of employee_id
          { $set: userSyncFields }
        );
      }
    }

    // Get updated employee
    const updatedEmployee = await db.collection('employees').findOne(
      { email: employee.email },  // Use email
      { projection: { _id: 0 } }
    );

    res.json(updatedEmployee);
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/employees/:userId/role
 * Update employee role (admin only)
 * 
 * FIX: Better handling of duplicate employee_ids
 */
router.put('/:userId/role', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.roleUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.params;
    const { role } = req.validatedBody;

    // ============================================
    // FIX: Handle potential duplicate employee_ids
    // ============================================
    const employeesWithId = await db.collection('employees')
      .find({ employee_id: userId }, { projection: { _id: 0 } })
      .toArray();

    if (employeesWithId.length === 0) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // If duplicates exist, select the non-admin or first one
    let employee;
    if (employeesWithId.length > 1) {
      console.warn(`WARNING: Multiple employees found with employee_id ${userId}`);
      employee = employeesWithId.find(e => e.role !== 'admin') || employeesWithId[0];
    } else {
      employee = employeesWithId[0];
    }

    // Find user by email
    const user = await db.collection('users').findOne(
      { email: employee.email },
      { projection: { _id: 0 } }
    );

    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    // Validate role
    if (!Object.values(UserRole).includes(role)) {
      return res.status(400).json({ detail: 'Invalid role' });
    }

    // Prevent admin self-demotion (check by email, not employee_id)
    if (user.role === UserRole.ADMIN && role !== UserRole.ADMIN && req.user.email === user.email) {
      return res.status(400).json({ detail: 'Admin cannot change their own role' });
    }

    // ============================================
    // FIX: Update by EMAIL, not employee_id
    // ============================================
    await db.collection('users').updateOne(
      { email: employee.email },
      { $set: { role } }
    );

    await db.collection('employees').updateOne(
      { email: employee.email },
      { $set: { role } }
    );

    res.json({
      message: 'Role updated successfully',
      employee_id: userId,
      email: employee.email,
      new_role: role
    });
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * PUT /api/employees/:userId/leave-balance
 * Update employee leave balance (admin only)
 * Now supports comp_off even if it doesn't exist yet
 */
router.put('/:userId/leave-balance', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.leaveBalanceUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.params;
    const { leave_type, reason, adjustment_type, days } = req.validatedBody;

    // Find user - try by id first, then employee_id
    let user = await db.collection('users').findOne(
      { id: userId },
      { projection: { _id: 0 } }
    );

    if (!user) {
      user = await db.collection('users').findOne(
        { employee_id: userId },
        { projection: { _id: 0 } }
      );
    }

    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    // Find employee by email
    const employee = await db.collection('employees').findOne(
      { email: user.email },
      { projection: { _id: 0 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Normalize leave type
    const leaveKey = normalizeLeaveType(leave_type);

    // ============================================
    // KEY FIX: Allow comp_off even if not in leave_balance
    // ============================================
    const validLeaveTypes = ['sick_leave', 'casual_leave', 'paid_leave', 'unpaid_leave', 'comp_off', 'earned_leave'];

    // Check if it's a valid leave type OR exists in employee's leave_balance
    if (!validLeaveTypes.includes(leaveKey) && !(leaveKey in (employee.leave_balance || {}))) {
      return res.status(400).json({ detail: `Invalid leave type: ${leave_type}` });
    }

    if (days <= 0) {
      return res.status(400).json({ detail: 'Days must be greater than 0' });
    }

    // Get current balance (default to 0 if doesn't exist)
    const currentBalance = parseFloat(employee.leave_balance?.[leaveKey] || 0);
    let newBalance;

    if (adjustment_type === 'deduct') {
      if (currentBalance < days) {
        return res.status(400).json({ detail: 'Insufficient leave balance' });
      }
      newBalance = Math.round((currentBalance - days) * 100) / 100;
    } else if (adjustment_type === 'add') {
      newBalance = Math.round((currentBalance + days) * 100) / 100;
    } else {
      return res.status(400).json({ detail: "Invalid adjustment type (must be 'add' or 'deduct')" });
    }

    // Update balance by email
    await db.collection('employees').updateOne(
      { email: employee.email },
      { $set: { [`leave_balance.${leaveKey}`]: newBalance } }
    );

    // Audit log
    await db.collection('leave_adjustments').insertOne({
      user_id: userId,
      employee_id: employee.employee_id,
      employee_email: employee.email,
      leave_type: leaveKey,
      adjustment_type,
      days,
      reason,
      adjusted_by: req.user.email,
      timestamp: new Date()
    });

    res.json({
      message: 'Leave balance updated successfully',
      leave_type: leaveKey,
      new_balance: newBalance
    });
  } catch (error) {
    console.error('Update leave balance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * DELETE /api/employees/:employeeId
 * Delete employee (admin only)
 */
router.delete('/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;

    // Find employee
    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0, email: 1 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Prevent deleting yourself
    if (employee.email === req.user.email) {
      return res.status(400).json({ detail: 'Cannot delete your own account' });
    }

    // Delete by email (more reliable)
    await db.collection('users').deleteOne({ email: employee.email });
    await db.collection('employees').deleteOne({ email: employee.email });

    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/employees/employee-id-settings
 * Get employee ID settings (admin only)
 */
router.get('/employee-id-settings', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const settings = await db.collection('settings').findOne({}, { projection: { _id: 0, employee_id_prefix: 1, employee_id_counter: 1 } });

    if (!settings) {
      return res.json({ prefix: 'EMP', counter: 1000 });
    }

    res.json({
      prefix: settings.employee_id_prefix || 'EMP',
      counter: settings.employee_id_counter || 1000
    });
  } catch (error) {
    console.error('Get employee ID settings error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/employees/employee-id-settings
 * Update employee ID settings (admin only)
 */
router.post('/employee-id-settings', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.employeeIdSettings), async (req, res) => {
  try {
    const db = getDB();
    const { prefix, counter } = req.validatedBody;

    // Update in settings collection
    await db.collection('settings').updateOne(
      {},
      {
        $set: {
          employee_id_prefix: prefix || 'EMP',
          employee_id_counter: counter || 1000,
          updated_at: new Date(),
          updated_by: req.user.email
        }
      },
      { upsert: true }
    );

    res.json({
      message: 'Employee ID settings updated successfully',
      settings: { prefix, counter }
    });
  } catch (error) {
    console.error('Update employee ID settings error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/employees/check-duplicates
 * Check for duplicate employee IDs (admin only) - utility endpoint
 */
router.get('/check-duplicates', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    // Find duplicate employee_ids
    const duplicates = await db.collection('employees').aggregate([
      { $group: { _id: '$employee_id', count: { $sum: 1 }, emails: { $push: '$email' } } },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (duplicates.length === 0) {
      return res.json({ message: 'No duplicate employee IDs found', duplicates: [] });
    }

    res.json({
      message: `Found ${duplicates.length} duplicate employee ID(s)`,
      duplicates: duplicates.map(d => ({
        employee_id: d._id,
        count: d.count,
        emails: d.emails
      }))
    });
  } catch (error) {
    console.error('Check duplicates error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/employees/fix-duplicate/:employeeId
 * Fix a duplicate employee ID by assigning a new one (admin only)
 */
router.post('/fix-duplicate/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;
    const { email } = req.body;  // Which email to fix

    if (!email) {
      return res.status(400).json({ detail: 'Email is required to identify which record to fix' });
    }

    // Find the employee
    const employee = await db.collection('employees').findOne({ employee_id: employeeId, email });
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found with that ID and email combination' });
    }

    // Generate new employee ID
    const settingsUpdate = await db.collection('settings').findOneAndUpdate(
      {},
      { $inc: { employee_id_counter: 1 } },
      { returnDocument: 'after' }
    );

    const settings = settingsUpdate.value;
    const newEmployeeId = `${settings.employee_id_prefix || 'EMP'}${String(settings.employee_id_counter).padStart(4, '0')}`;

    // Update employee
    await db.collection('employees').updateOne(
      { email },
      { $set: { employee_id: newEmployeeId, id: newEmployeeId } }
    );

    // Update user
    await db.collection('users').updateOne(
      { email },
      { $set: { employee_id: newEmployeeId } }
    );

    res.json({
      message: 'Employee ID fixed successfully',
      old_id: employeeId,
      new_id: newEmployeeId,
      email
    });
  } catch (error) {
    console.error('Fix duplicate error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/employees/recalculate-leave-balance/:employeeId
 * Recalculate leave balance for an employee based on current policy and joining date
 * (admin only)
 */
router.post('/recalculate-leave-balance/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;

    // Find employee
    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Get new leave balance based on policy and joining date
    const newBalance = await getLeaveBalanceFromPolicy(db, employee.joining_date);

    // Update employee's leave balance
    await db.collection('employees').updateOne(
      { email: employee.email },
      { $set: { leave_balance: newBalance } }
    );

    res.json({
      message: 'Leave balance recalculated successfully',
      employee_id: employeeId,
      joining_date: employee.joining_date,
      new_balance: newBalance
    });
  } catch (error) {
    console.error('Recalculate leave balance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// ============================================
// TEST/SIMULATION ENDPOINT (for verifying future dates)
// ============================================

/**
 * GET /api/employees/simulate-balance/:employeeId
 * Simulate what an employee's leave balance will be on a given date
 * Query params: ?simulate_date=2026-09-07
 * 
 * This is useful for testing future joining dates
 */
router.get('/simulate-balance/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;
    const { simulate_date } = req.query;

    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    if (!employee.joining_date) {
      return res.status(400).json({ detail: 'Employee has no joining date set' });
    }

    const joiningDate = new Date(employee.joining_date);
    const simulatedDate = simulate_date ? new Date(simulate_date) : new Date();

    // Calculate months since joining for the simulated date
    let months = (simulatedDate.getFullYear() - joiningDate.getFullYear()) * 12;
    months += simulatedDate.getMonth() - joiningDate.getMonth();
    if (simulatedDate.getDate() < joiningDate.getDate()) {
      months--;
    }
    months = Math.max(0, months);

    // Calculate balances
    const simulatedBalance = {
      casual_leave: Math.min(Math.round(months * DEFAULT_MONTHLY_CREDITS.casual_leave * 10) / 10, 6),
      sick_leave: Math.min(Math.round(months * DEFAULT_MONTHLY_CREDITS.sick_leave * 10) / 10, 6),
      earned_leave: Math.min(Math.round(months * DEFAULT_MONTHLY_CREDITS.earned_leave * 10) / 10, 12),
      comp_off: employee.leave_balance?.comp_off || 0,
      unpaid_leave: 0
    };

    res.json({
      employee: {
        employee_id: employee.employee_id,
        full_name: employee.full_name,
        joining_date: joiningDate.toISOString().split('T')[0]
      },
      simulation: {
        simulated_date: simulatedDate.toISOString().split('T')[0],
        months_since_joining: months,
        is_future_date: simulatedDate > new Date(),
        has_joined: simulatedDate >= joiningDate
      },
      current_stored_balance: employee.leave_balance || {},
      simulated_balance: simulatedBalance,
      calculation_details: {
        casual_leave: `${months} months × 0.5 = ${months * 0.5} (max 6) → ${simulatedBalance.casual_leave}`,
        sick_leave: `${months} months × 0.5 = ${months * 0.5} (max 6) → ${simulatedBalance.sick_leave}`,
        earned_leave: `${months} months × 1.0 = ${months * 1.0} (max 12) → ${simulatedBalance.earned_leave}`
      }
    });
  } catch (error) {
    console.error('Simulate balance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/employees/recalculate-all-balances
 * Recalculate leave balances for all employees based on their joining dates
 * Useful after policy changes or for periodic recalculation
 */
router.post('/recalculate-all-balances', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const employees = await db.collection('employees').find({}).toArray();

    const results = [];

    for (const employee of employees) {
      const joiningDate = employee.joining_date || new Date();
      const newBalance = await getLeaveBalanceFromPolicy(db, joiningDate);

      // Preserve comp_off from existing balance
      newBalance.comp_off = employee.leave_balance?.comp_off || 0;

      await db.collection('employees').updateOne(
        { id: employee.id },
        { $set: { leave_balance: newBalance } }
      );

      results.push({
        employee_id: employee.employee_id,
        name: employee.full_name,
        joining_date: joiningDate,
        new_balance: newBalance
      });
    }

    res.json({
      status: 'success',
      message: `Recalculated balances for ${results.length} employees`,
      results
    });
  } catch (error) {
    console.error('Recalculate all balances error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Export helper for potential use elsewhere
module.exports = router;
module.exports.getLeaveBalanceFromPolicy = getLeaveBalanceFromPolicy;
module.exports.calculateAccruedBalance = calculateAccruedBalance;
module.exports.calculateMonthsSinceJoining = calculateMonthsSinceJoining;
module.exports.DEFAULT_MONTHLY_CREDITS = DEFAULT_MONTHLY_CREDITS;
