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

// Export helper for potential use elsewhere
module.exports = router;
module.exports.getLeaveBalanceFromPolicy = getLeaveBalanceFromPolicy;
