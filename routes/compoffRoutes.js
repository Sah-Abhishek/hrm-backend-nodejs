const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');
const { generateUUID, toISOString } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');

/**
 * Helper function to update employee's comp_off balance
 */
const updateEmployeeCompOffBalance = async (db, employeeEmail, daysToAdd) => {
  // Get current employee
  const employee = await db.collection('employees').findOne({ email: employeeEmail });

  if (!employee) {
    throw new Error('Employee not found');
  }

  // Get current comp_off balance (default to 0 if not exists)
  const currentCompOff = employee.leave_balance?.comp_off || 0;
  const newCompOff = currentCompOff + daysToAdd;

  // Update the employee's leave_balance with new comp_off value
  await db.collection('employees').updateOne(
    { email: employeeEmail },
    {
      $set: {
        'leave_balance.comp_off': newCompOff,
        updated_at: toISOString(new Date())
      }
    }
  );

  return newCompOff;
};

/**
 * Helper function to deduct from employee's comp_off balance
 */
const deductEmployeeCompOffBalance = async (db, employeeEmail, daysToDeduct) => {
  const employee = await db.collection('employees').findOne({ email: employeeEmail });

  if (!employee) {
    throw new Error('Employee not found');
  }

  const currentCompOff = employee.leave_balance?.comp_off || 0;

  if (currentCompOff < daysToDeduct) {
    throw new Error(`Insufficient comp-off balance. Available: ${currentCompOff}, Required: ${daysToDeduct}`);
  }

  const newCompOff = currentCompOff - daysToDeduct;

  await db.collection('employees').updateOne(
    { email: employeeEmail },
    {
      $set: {
        'leave_balance.comp_off': newCompOff,
        updated_at: toISOString(new Date())
      }
    }
  );

  return newCompOff;
};

/**
 * POST /api/comp-off/request
 * Request comp-off (employee/manager)
 */
router.post('/request', authenticate, requireRole([UserRole.EMPLOYEE, UserRole.MANAGER]), async (req, res) => {
  try {
    const db = getDB();
    const { work_date, days, reason } = req.body;

    // Validate
    if (!work_date || !reason) {
      return res.status(400).json({ detail: 'Work date and reason are required' });
    }

    const parsedDays = parseFloat(days) || 1;
    if (parsedDays !== 0.5 && parsedDays !== 1) {
      return res.status(400).json({ detail: 'Days must be 0.5 or 1' });
    }

    // Check if work_date is in the future
    const workDateObj = new Date(work_date);
    if (workDateObj > new Date()) {
      return res.status(400).json({ detail: 'Work date cannot be in the future' });
    }

    // Get employee info
    const employee = await db.collection('employees').findOne(
      { email: req.user.email },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Check if already requested for this date
    const existingRequest = await db.collection('comp_off_requests').findOne({
      employee_email: req.user.email,
      work_date: work_date
    });

    if (existingRequest) {
      return res.status(400).json({ detail: 'You have already requested comp-off for this date' });
    }

    // Create comp-off request
    const compOffRequest = {
      id: generateUUID(),
      employee_id: employee.employee_id || employee.id,
      employee_email: employee.email,
      employee_name: employee.full_name,
      employee_role: req.user.role,
      department: employee.department,
      manager_email: employee.manager_email || null,
      work_date: work_date,
      days: parsedDays,
      reason: reason,
      status: 'pending',
      remarks: null,
      approved_by: null,
      approved_at: null,
      expiry_date: null,
      remaining_days: parsedDays,
      added_to_balance: false, // Track if added to leave balance
      created_at: toISOString(new Date()),
      updated_at: toISOString(new Date())
    };

    await db.collection('comp_off_requests').insertOne(compOffRequest);

    // Send notification to approver
    let approverEmail = null;
    if (req.user.role === UserRole.MANAGER) {
      // Manager's request goes to admin - find an admin
      const admin = await db.collection('users').findOne(
        { role: UserRole.ADMIN },
        { projection: { email: 1 } }
      );
      approverEmail = admin?.email;
    } else {
      // Employee's request goes to manager
      approverEmail = employee.manager_email;
    }

    if (approverEmail) {
      const emailHtml = generateCompOffRequestEmail({
        employeeName: employee.full_name,
        employeeRole: req.user.role,
        workDate: work_date,
        days: parsedDays,
        reason: reason
      });

      await sendEmailNotification(
        approverEmail,
        `Comp-Off Request from ${employee.full_name}`,
        emailHtml
      );
    }

    delete compOffRequest._id;

    res.json({
      status: 'success',
      message: 'Comp-off request submitted successfully',
      request: compOffRequest
    });
  } catch (error) {
    console.error('Request comp-off error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/comp-off/my-requests
 * Get my comp-off requests (employee/manager)
 */
router.get('/my-requests', authenticate, requireRole([UserRole.EMPLOYEE, UserRole.MANAGER]), async (req, res) => {
  try {
    const db = getDB();

    const requests = await db.collection('comp_off_requests')
      .find(
        { employee_email: req.user.email },
        { projection: { _id: 0 } }
      )
      .sort({ created_at: -1 })
      .toArray();

    res.json(requests);
  } catch (error) {
    console.error('Get my comp-off requests error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/comp-off/team-requests
 * Get team comp-off requests (manager)
 */
router.get('/team-requests', authenticate, requireRole([UserRole.MANAGER]), async (req, res) => {
  try {
    const db = getDB();

    // Get requests from employees who report to this manager
    const requests = await db.collection('comp_off_requests')
      .find(
        {
          manager_email: req.user.email,
          employee_role: UserRole.EMPLOYEE  // Only employee requests, not other managers
        },
        { projection: { _id: 0 } }
      )
      .sort({ created_at: -1 })
      .toArray();

    res.json(requests);
  } catch (error) {
    console.error('Get team comp-off requests error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/comp-off/all-requests
 * Get all comp-off requests (admin)
 */
router.get('/all-requests', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const requests = await db.collection('comp_off_requests')
      .find({}, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    res.json(requests);
  } catch (error) {
    console.error('Get all comp-off requests error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/comp-off/:id/action
 * Approve or reject comp-off request (manager/admin)
 */
router.post('/:id/action', authenticate, requireRole([UserRole.MANAGER, UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { action, remarks } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ detail: 'Invalid action. Must be approve or reject' });
    }

    // Get request
    const compOffRequest = await db.collection('comp_off_requests').findOne(
      { id },
      { projection: { _id: 0 } }
    );

    if (!compOffRequest) {
      return res.status(404).json({ detail: 'Comp-off request not found' });
    }

    if (compOffRequest.status !== 'pending') {
      return res.status(400).json({ detail: 'Request has already been processed' });
    }

    // Authorization check
    if (req.user.role === UserRole.MANAGER) {
      // Manager can only approve employee requests (not other managers)
      if (compOffRequest.employee_role !== UserRole.EMPLOYEE) {
        return res.status(403).json({ detail: 'Managers can only approve employee requests' });
      }
      // Manager can only approve requests from their team
      if (compOffRequest.manager_email !== req.user.email) {
        return res.status(403).json({ detail: 'You can only approve requests from your team members' });
      }
    }
    // Admin can approve any request

    // Require remarks for rejection
    if (action === 'reject' && !remarks?.trim()) {
      return res.status(400).json({ detail: 'Remarks are required for rejection' });
    }

    // Calculate expiry date (90 days from work date)
    const expiryDate = new Date(compOffRequest.work_date);
    expiryDate.setDate(expiryDate.getDate() + 90);

    // Update request
    const updateData = {
      status: action === 'approve' ? 'approved' : 'rejected',
      remarks: remarks || null,
      approved_by: req.user.email,
      approved_at: toISOString(new Date()),
      updated_at: toISOString(new Date())
    };

    if (action === 'approve') {
      updateData.expiry_date = toISOString(expiryDate);
      updateData.added_to_balance = true;

      // *** ADD COMP-OFF TO EMPLOYEE'S LEAVE BALANCE ***
      try {
        const newBalance = await updateEmployeeCompOffBalance(
          db,
          compOffRequest.employee_email,
          compOffRequest.days
        );
        console.log(`Added ${compOffRequest.days} comp-off days to ${compOffRequest.employee_email}. New balance: ${newBalance}`);
      } catch (balanceError) {
        console.error('Failed to update leave balance:', balanceError);
        return res.status(500).json({ detail: 'Failed to update leave balance' });
      }
    }

    await db.collection('comp_off_requests').updateOne(
      { id },
      { $set: updateData }
    );

    // Send email notification to employee
    const emailHtml = action === 'approve'
      ? generateCompOffApprovedEmail({
        employeeName: compOffRequest.employee_name,
        workDate: compOffRequest.work_date,
        days: compOffRequest.days,
        expiryDate: expiryDate,
        remarks: remarks
      })
      : generateCompOffRejectedEmail({
        employeeName: compOffRequest.employee_name,
        workDate: compOffRequest.work_date,
        days: compOffRequest.days,
        reason: remarks
      });

    await sendEmailNotification(
      compOffRequest.employee_email,
      action === 'approve' ? 'Comp-Off Request Approved!' : 'Comp-Off Request Rejected',
      emailHtml
    );

    res.json({
      status: 'success',
      message: `Comp-off request ${action}d successfully${action === 'approve' ? '. Days added to leave balance.' : ''}`,
      request_id: id
    });
  } catch (error) {
    console.error('Process comp-off action error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/comp-off/balance
 * Get comp-off balance for current user
 */
router.get('/balance', authenticate, async (req, res) => {
  try {
    const db = getDB();

    // Get balance from employee's leave_balance
    const employee = await db.collection('employees').findOne(
      { email: req.user.email },
      { projection: { _id: 0, leave_balance: 1 } }
    );

    const compOffBalance = employee?.leave_balance?.comp_off || 0;

    // Also get approved comp-off requests for history
    const approvedRequests = await db.collection('comp_off_requests')
      .find(
        {
          employee_email: req.user.email,
          status: 'approved'
        },
        { projection: { _id: 0 } }
      )
      .toArray();

    // Filter out expired comp-offs for display
    const now = new Date();
    const validCompOffs = approvedRequests.filter(r => {
      if (!r.expiry_date) return true;
      return new Date(r.expiry_date) > now;
    });

    res.json({
      total_balance: compOffBalance,
      comp_offs: validCompOffs
    });
  } catch (error) {
    console.error('Get comp-off balance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/comp-off/records
 * Get comp-off records for all employees (manager/admin)
 * Used in the Comp-Off Management page
 */
router.get('/records', authenticate, requireRole([UserRole.MANAGER, UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    let query = {};

    // If manager, only get records for their team members
    if (req.user.role === UserRole.MANAGER) {
      query.manager_email = req.user.email;
    }

    const records = await db.collection('comp_off_requests')
      .find(query, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    // Transform to match expected format
    const transformedRecords = records.map(r => ({
      id: r.id,
      employee_id: r.employee_id,
      employee_email: r.employee_email,
      employee_name: r.employee_name,
      days: r.days,
      used: (r.days || 0) - (r.remaining_days || r.days || 0),
      work_date: r.work_date,
      reason: r.reason,
      status: r.status,
      granted_date: r.approved_at || r.created_at,
      granted_by: r.approved_by,
      expiry_date: r.expiry_date,
      remaining_days: r.remaining_days,
      added_to_balance: r.added_to_balance || false
    }));

    res.json(transformedRecords);
  } catch (error) {
    console.error('Get comp-off records error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/comp-off/grant
 * Directly grant comp-off to an employee (manager/admin)
 * This creates an already-approved comp-off record
 */
router.post('/grant', authenticate, requireRole([UserRole.MANAGER, UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { user_id, days, work_date, reason } = req.body;

    // Validate
    if (!user_id || !days || !work_date || !reason) {
      return res.status(400).json({ detail: 'All fields are required' });
    }

    const parsedDays = parseFloat(days);
    if (isNaN(parsedDays) || parsedDays <= 0) {
      return res.status(400).json({ detail: 'Invalid number of days' });
    }

    // Get employee info by user_id (which is the users collection id)
    const user = await db.collection('users').findOne(
      { id: user_id },
      { projection: { _id: 0, email: 1 } }
    );

    if (!user) {
      return res.status(404).json({ detail: 'User not found' });
    }

    const employee = await db.collection('employees').findOne(
      { email: user.email },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Authorization check for managers
    if (req.user.role === UserRole.MANAGER) {
      if (employee.manager_email !== req.user.email) {
        return res.status(403).json({ detail: 'You can only grant comp-off to your team members' });
      }
    }

    // Check if already exists for this date
    const existingRecord = await db.collection('comp_off_requests').findOne({
      employee_email: employee.email,
      work_date: work_date
    });

    if (existingRecord) {
      return res.status(400).json({ detail: 'Comp-off already exists for this date' });
    }

    // Calculate expiry date (90 days from work date)
    const expiryDate = new Date(work_date);
    expiryDate.setDate(expiryDate.getDate() + 90);

    // *** ADD COMP-OFF TO EMPLOYEE'S LEAVE BALANCE ***
    let newBalance;
    try {
      newBalance = await updateEmployeeCompOffBalance(db, employee.email, parsedDays);
      console.log(`Granted ${parsedDays} comp-off days to ${employee.email}. New balance: ${newBalance}`);
    } catch (balanceError) {
      console.error('Failed to update leave balance:', balanceError);
      return res.status(500).json({ detail: 'Failed to update leave balance' });
    }

    // Create approved comp-off record
    const compOffRecord = {
      id: generateUUID(),
      employee_id: employee.employee_id || employee.id,
      employee_email: employee.email,
      employee_name: employee.full_name,
      employee_role: 'employee',
      department: employee.department,
      manager_email: employee.manager_email || req.user.email,
      work_date: work_date,
      days: parsedDays,
      reason: reason,
      status: 'approved',  // Directly approved since granted by manager/admin
      remarks: `Granted by ${req.user.email}`,
      approved_by: req.user.email,
      approved_at: toISOString(new Date()),
      expiry_date: toISOString(expiryDate),
      remaining_days: parsedDays,
      added_to_balance: true, // Mark as added to leave balance
      created_at: toISOString(new Date()),
      updated_at: toISOString(new Date())
    };

    await db.collection('comp_off_requests').insertOne(compOffRecord);

    // Send notification email to employee
    const emailHtml = generateCompOffGrantedEmail({
      employeeName: employee.full_name,
      workDate: work_date,
      days: parsedDays,
      reason: reason,
      grantedBy: req.user.email,
      expiryDate: expiryDate
    });

    await sendEmailNotification(
      employee.email,
      'Comp-Off Granted!',
      emailHtml
    );

    delete compOffRecord._id;

    res.json({
      status: 'success',
      message: `Granted ${parsedDays} comp-off day(s) to ${employee.full_name}. New balance: ${newBalance}`,
      record: compOffRecord,
      new_balance: newBalance
    });
  } catch (error) {
    console.error('Grant comp-off error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/comp-off/:id/use
 * Use comp-off days (when applying for leave)
 * This is typically called from the leave application
 */
router.post('/:id/use', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { id } = req.params;
    const { days_to_use } = req.body;

    const compOff = await db.collection('comp_off_requests').findOne(
      { id, employee_email: req.user.email },
      { projection: { _id: 0 } }
    );

    if (!compOff) {
      return res.status(404).json({ detail: 'Comp-off not found' });
    }

    if (compOff.status !== 'approved') {
      return res.status(400).json({ detail: 'Comp-off is not approved' });
    }

    // Check expiry
    if (compOff.expiry_date && new Date(compOff.expiry_date) < new Date()) {
      return res.status(400).json({ detail: 'Comp-off has expired' });
    }

    const remaining = compOff.remaining_days || compOff.days;
    if (days_to_use > remaining) {
      return res.status(400).json({ detail: `Only ${remaining} days remaining` });
    }

    // *** DEDUCT FROM EMPLOYEE'S LEAVE BALANCE ***
    try {
      await deductEmployeeCompOffBalance(db, req.user.email, days_to_use);
    } catch (balanceError) {
      return res.status(400).json({ detail: balanceError.message });
    }

    // Update remaining days in comp-off request
    await db.collection('comp_off_requests').updateOne(
      { id },
      {
        $set: {
          remaining_days: remaining - days_to_use,
          updated_at: toISOString(new Date())
        }
      }
    );

    res.json({
      status: 'success',
      message: `Used ${days_to_use} comp-off day(s)`,
      remaining: remaining - days_to_use
    });
  } catch (error) {
    console.error('Use comp-off error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/comp-off/use-balance
 * Use comp-off from leave balance directly (for leave applications)
 * This deducts from the employee's leave_balance.comp_off
 */
router.post('/use-balance', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { days_to_use } = req.body;

    if (!days_to_use || days_to_use <= 0) {
      return res.status(400).json({ detail: 'Invalid days to use' });
    }

    // Deduct from employee's leave balance
    try {
      const newBalance = await deductEmployeeCompOffBalance(db, req.user.email, days_to_use);

      res.json({
        status: 'success',
        message: `Used ${days_to_use} comp-off day(s)`,
        new_balance: newBalance
      });
    } catch (balanceError) {
      return res.status(400).json({ detail: balanceError.message });
    }
  } catch (error) {
    console.error('Use comp-off balance error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Email Template Functions

const generateCompOffRequestEmail = ({ employeeName, employeeRole, workDate, days, reason }) => {
  const formattedDate = new Date(workDate).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%); padding: 32px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">New Comp-Off Request</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Requires your approval</p>
    </div>

    <div style="padding: 32px;">
      <p style="color: #334155; font-size: 16px; margin: 0 0 24px 0;">
        <strong>${employeeName}</strong> (${employeeRole}) has requested a comp-off:
      </p>

      <div style="background-color: #f8fafc; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Work Date</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${formattedDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Days Requested</td>
            <td style="padding: 8px 0; color: #7c3aed; font-size: 14px; font-weight: 600; text-align: right;">${days} day${days !== 1 ? 's' : ''}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #f5f3ff; border-left: 4px solid #7c3aed; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="color: #5b21b6; font-size: 13px; margin: 0;">
          <strong>Reason:</strong> ${reason}
        </p>
      </div>

      <p style="color: #64748b; font-size: 14px; margin: 0;">
        Please log in to the HRMS to approve or reject this request.
      </p>
    </div>

    <div style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        This is an automated email from the HRMS System.
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

const generateCompOffApprovedEmail = ({ employeeName, workDate, days, expiryDate, remarks }) => {
  const formattedWorkDate = new Date(workDate).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const formattedExpiryDate = expiryDate.toLocaleDateString('en-IN', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 60px;">
        <span style="font-size: 28px; color: #ffffff;">✓</span>
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Comp-Off Approved!</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Days added to your leave balance</p>
    </div>

    <div style="padding: 32px;">
      <p style="color: #334155; font-size: 16px; margin: 0 0 24px 0;">
        Dear <strong>${employeeName}</strong>,
      </p>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
        Great news! Your comp-off request has been approved and <strong>${days} day(s)</strong> have been added to your leave balance.
      </p>

      <div style="background-color: #ecfdf5; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #a7f3d0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #064e3b; font-size: 14px;">Work Date</td>
            <td style="padding: 8px 0; color: #064e3b; font-size: 14px; font-weight: 600; text-align: right;">${formattedWorkDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #064e3b; font-size: 14px;">Days Added to Balance</td>
            <td style="padding: 8px 0; color: #059669; font-size: 18px; font-weight: 700; text-align: right;">${days}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #064e3b; font-size: 14px;">Valid Until</td>
            <td style="padding: 8px 0; color: #064e3b; font-size: 14px; font-weight: 600; text-align: right;">${formattedExpiryDate}</td>
          </tr>
        </table>
      </div>

      ${remarks ? `
      <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="color: #065f46; font-size: 13px; margin: 0;">
          <strong>Note:</strong> ${remarks}
        </p>
      </div>
      ` : ''}

      <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #92400e; font-size: 13px; margin: 0;">
          <strong>⚠️ Remember:</strong> Please use this comp-off before ${formattedExpiryDate}, otherwise it will expire.
        </p>
      </div>

      <p style="color: #64748b; font-size: 14px; margin: 0;">
        You can apply for leave using your comp-off balance from the HRMS portal.
      </p>
    </div>

    <div style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        This is an automated email from the HRMS System.
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

const generateCompOffRejectedEmail = ({ employeeName, workDate, days, reason }) => {
  const formattedWorkDate = new Date(workDate).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 60px;">
        <span style="font-size: 28px; color: #ffffff;">✕</span>
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Comp-Off Rejected</h1>
    </div>

    <div style="padding: 32px;">
      <p style="color: #334155; font-size: 16px; margin: 0 0 24px 0;">
        Dear <strong>${employeeName}</strong>,
      </p>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
        We regret to inform you that your comp-off request has been rejected.
      </p>

      <div style="background-color: #fef2f2; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #fecaca;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Work Date</td>
            <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600; text-align: right;">${formattedWorkDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Days Requested</td>
            <td style="padding: 8px 0; color: #dc2626; font-size: 14px; font-weight: 600; text-align: right;">${days}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="color: #991b1b; font-size: 13px; margin: 0;">
          <strong>Reason:</strong> ${reason}
        </p>
      </div>

      <p style="color: #64748b; font-size: 14px; margin: 0;">
        If you have any questions, please contact your manager or HR.
      </p>
    </div>

    <div style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        This is an automated email from the HRMS System.
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

const generateCompOffGrantedEmail = ({ employeeName, workDate, days, reason, grantedBy, expiryDate }) => {
  const formattedWorkDate = new Date(workDate).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const formattedExpiryDate = expiryDate.toLocaleDateString('en-IN', {
    year: 'numeric', month: 'long', day: 'numeric'
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%); padding: 32px; text-align: center;">
      <div style="width: 60px; height: 60px; background-color: rgba(255,255,255,0.2); border-radius: 50%; margin: 0 auto 16px; line-height: 60px;">
        <span style="font-size: 28px; color: #ffffff;">🎁</span>
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 700;">Comp-Off Granted!</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Days added to your leave balance</p>
    </div>

    <div style="padding: 32px;">
      <p style="color: #334155; font-size: 16px; margin: 0 0 24px 0;">
        Dear <strong>${employeeName}</strong>,
      </p>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px 0;">
        Great news! You have been granted <strong>${days} comp-off day(s)</strong> which have been added to your leave balance.
      </p>

      <div style="background-color: #f5f3ff; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #ddd6fe;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #5b21b6; font-size: 14px;">Work Date</td>
            <td style="padding: 8px 0; color: #5b21b6; font-size: 14px; font-weight: 600; text-align: right;">${formattedWorkDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #5b21b6; font-size: 14px;">Days Added to Balance</td>
            <td style="padding: 8px 0; color: #7c3aed; font-size: 18px; font-weight: 700; text-align: right;">${days}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #5b21b6; font-size: 14px;">Granted By</td>
            <td style="padding: 8px 0; color: #5b21b6; font-size: 14px; text-align: right;">${grantedBy}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #5b21b6; font-size: 14px;">Valid Until</td>
            <td style="padding: 8px 0; color: #5b21b6; font-size: 14px; font-weight: 600; text-align: right;">${formattedExpiryDate}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #f5f3ff; border-left: 4px solid #7c3aed; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
        <p style="color: #5b21b6; font-size: 13px; margin: 0;">
          <strong>Reason:</strong> ${reason}
        </p>
      </div>

      <div style="background-color: #fef3c7; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #92400e; font-size: 13px; margin: 0;">
          <strong>⚠️ Remember:</strong> Please use this comp-off before ${formattedExpiryDate}, otherwise it will expire.
        </p>
      </div>

      <p style="color: #64748b; font-size: 14px; margin: 0;">
        You can apply for leave using your comp-off balance from the HRMS portal.
      </p>
    </div>

    <div style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #94a3b8; font-size: 12px; margin: 0;">
        This is an automated email from the HRMS System.
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

module.exports = router;
