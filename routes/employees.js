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
 * Helper: Get leave balance from configured policy
 * Falls back to default if no policy is configured
 * Always includes comp_off: 0
 */
async function getLeaveBalanceFromPolicy(db) {
  try {
    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });

    if (!policy || !policy.policies || policy.policies.length === 0) {
      // Return default if no policy configured (includes comp_off)
      return {
        ...defaultLeaveBalance,
        comp_off: 0  // Always include comp_off
      };
    }

    const balance = {};
    for (const policyItem of policy.policies) {
      const leaveKey = normalizeLeaveType(policyItem.leave_type);
      balance[leaveKey] = policyItem.annual_quota;
    }

    // Always include comp_off (even if not in policy)
    if (!('comp_off' in balance)) {
      balance.comp_off = 0;
    }

    return balance;
  } catch (error) {
    console.error('Error fetching leave policy:', error);
    // Fallback to default on error (includes comp_off)
    return {
      ...defaultLeaveBalance,
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

    // Get settings
    const settings = await db.collection('settings').findOne({});
    if (!settings) {
      return res.status(500).json({ detail: 'System settings not initialized' });
    }

    const employeeUuid = generateUUID();
    const employeeId = `${settings.employee_id_prefix}${String(settings.employee_id_counter).padStart(4, '0')}`;

    // Increment counter
    await db.collection('settings').updateOne({}, { $inc: { employee_id_counter: 1 } });

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
    // Always includes comp_off: 0
    // ============================================
    let leaveBalance;
    if (employeeData.leave_balance && Object.keys(employeeData.leave_balance).length > 0) {
      // Use provided leave balance (for custom cases)
      leaveBalance = {
        ...employeeData.leave_balance,
        comp_off: employeeData.leave_balance.comp_off ?? 0  // Ensure comp_off exists
      };
    } else {
      // Get from configured policy (includes comp_off: 0)
      leaveBalance = await getLeaveBalanceFromPolicy(db);
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
      joining_date: employeeData.joining_date || now,
      manager_email: employeeData.manager_email || null,
      manager_name: managerName,
      leave_balance: leaveBalance,  // Includes comp_off
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
 */
router.put('/:userId', authenticate, validate(schemas.employeeUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.params;
    const updateData = req.validatedBody;

    // Find user by employee_id
    const user = await db.collection('users').findOne(
      { employee_id: userId },
      { projection: { _id: 0 } }
    );
    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    // Find employee
    const employee = await db.collection('employees').findOne(
      { email: user.email },
      { projection: { _id: 0 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Permission check
    if (req.user.role !== UserRole.ADMIN && user.email !== req.user.email) {
      return res.status(403).json({ detail: 'Not enough permissions' });
    }

    // Allowed fields only
    const allowedFields = ['full_name', 'department', 'designation', 'phone', 'organization_id', 'manager_email', 'monthly_salary'];
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

    // Update employee
    if (Object.keys(updateDict).length > 0) {
      await db.collection('employees').updateOne(
        { email: user.email },
        { $set: updateDict }
      );

      // Sync user fields
      const userSyncFields = {};
      for (const key of ['full_name', 'department', 'designation', 'phone', 'organization_id', 'monthly_salary']) {
        if (key in updateDict) {
          userSyncFields[key] = updateDict[key];
        }
      }

      if (Object.keys(userSyncFields).length > 0) {
        await db.collection('users').updateOne(
          { employee_id: userId },
          { $set: userSyncFields }
        );
      }
    }

    // Get updated employee
    const updatedEmployee = await db.collection('employees').findOne(
      { email: user.email },
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
 */
router.put('/:userId/role', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.roleUpdate), async (req, res) => {
  try {
    const db = getDB();
    const { userId } = req.params;
    const { role } = req.validatedBody;

    // Find user
    const user = await db.collection('users').findOne(
      { employee_id: userId },
      { projection: { _id: 0 } }
    );
    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    // Find employee
    const employee = await db.collection('employees').findOne(
      { email: user.email },
      { projection: { _id: 0 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Validate role
    if (!Object.values(UserRole).includes(role)) {
      return res.status(400).json({ detail: 'Invalid role' });
    }

    // Prevent admin self-demotion
    if (user.role === UserRole.ADMIN && role !== UserRole.ADMIN && req.user.email === user.email) {
      return res.status(400).json({ detail: 'Admin cannot change their own role' });
    }

    // Update both collections
    await db.collection('users').updateOne(
      { employee_id: userId },
      { $set: { role } }
    );

    await db.collection('employees').updateOne(
      { employee_id: userId },
      { $set: { role } }
    );

    res.json({
      message: 'Role updated successfully',
      employee_id: userId,
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

    // Find user
    const user = await db.collection('users').findOne(
      { id: userId },
      { projection: { _id: 0 } }
    );
    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    // Find employee
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
    const validLeaveTypes = ['sick_leave', 'casual_leave', 'paid_leave', 'unpaid_leave', 'comp_off'];

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

    // Update balance
    await db.collection('employees').updateOne(
      { email: user.email },
      { $set: { [`leave_balance.${leaveKey}`]: newBalance } }
    );

    // Audit log
    await db.collection('leave_adjustments').insertOne({
      user_id: userId,
      employee_id: employee.id,
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

    // Delete user and employee
    await db.collection('users').deleteOne({ email: employee.email });
    await db.collection('employees').deleteOne({ employee_id: employeeId });

    res.json({ message: 'Employee deleted successfully' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/employee-id-settings
 * Get employee ID settings (admin only)
 */
router.get('/employee-id-settings', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const settings = await db.collection('employee_id_settings').findOne({}, { projection: { _id: 0 } });

    if (!settings) {
      return res.json({ prefix: 'EMP', counter: 1000 });
    }

    res.json(settings);
  } catch (error) {
    console.error('Get employee ID settings error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/employee-id-settings
 * Update employee ID settings (admin only)
 */
router.post('/employee-id-settings', authenticate, requireRole([UserRole.ADMIN]), validate(schemas.employeeIdSettings), async (req, res) => {
  try {
    const db = getDB();
    const settingsData = req.validatedBody;

    const settingsDoc = {
      ...settingsData,
      updated_at: new Date(),
      updated_by: req.user.email
    };

    // Upsert settings
    await db.collection('employee_id_settings').deleteMany({});
    await db.collection('employee_id_settings').insertOne(settingsDoc);

    delete settingsDoc._id;

    res.json({ message: 'Employee ID settings updated successfully', settings: settingsDoc });
  } catch (error) {
    console.error('Update employee ID settings error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Export helper for potential use elsewhere
module.exports = router;
module.exports.getLeaveBalanceFromPolicy = getLeaveBalanceFromPolicy;
