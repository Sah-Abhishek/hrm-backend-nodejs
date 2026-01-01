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
 * Helper: Calculate days from dates array
 */
function calculateDaysFromDates(dates, isHalfDay = false) {
  if (!dates || dates.length === 0) return 0;
  // If half day and single date, count as 0.5
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

  // For more than 3 dates, show first, last and count
  return `${sortedDates[0].toLocaleDateString()} to ${sortedDates[sortedDates.length - 1].toLocaleDateString()} (${sortedDates.length} days)`;
}

/**
 * Helper: Normalize dates in leave document
 */
function normalizeLeaveDates(leave) {
  // Normalize dates array
  if (leave.dates && Array.isArray(leave.dates)) {
    leave.dates = leave.dates.map(d => typeof d === 'string' ? new Date(d) : d);
  }

  // Normalize other date fields
  for (const field of ['created_at', 'updated_at']) {
    if (typeof leave[field] === 'string') {
      leave[field] = new Date(leave[field]);
    }
  }

  // Normalize approval timestamps
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
 * Helper: Get leave balance from policy
 */
async function getLeaveBalanceFromPolicy(db) {
  const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });

  if (!policy || !policy.policies || policy.policies.length === 0) {
    // Return default if no policy configured
    return {
      sick_leave: 12,
      casual_leave: 12,
      paid_leave: 15,
      unpaid_leave: 0
    };
  }

  const balance = {};
  for (const policyItem of policy.policies) {
    const leaveKey = normalizeLeaveType(policyItem.leave_type);
    balance[leaveKey] = policyItem.annual_quota;
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
      updated_at: toISOString(new Date()),
      updated_by: req.user.email
    };

    // Save to DB (upsert)
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
 */
router.post('/leave-policy/apply-to-employee/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;

    // Get policy
    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
    if (!policy) {
      return res.status(404).json({ detail: 'Leave policy not configured' });
    }

    // Find employee
    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { full_name: 1 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Build new leave balance
    const newBalance = {};
    for (const policyItem of policy.policies || []) {
      const leaveKey = normalizeLeaveType(policyItem.leave_type);
      newBalance[leaveKey] = policyItem.annual_quota;
    }

    // Update employee
    await db.collection('employees').updateOne(
      { employee_id: employeeId },
      { $set: { leave_balance: newBalance } }
    );

    res.json({
      status: 'success',
      message: `Leave policy applied to ${employee.full_name}`,
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
 */
router.post('/leave-policy/apply-to-all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    // Get policy
    const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });
    if (!policy) {
      return res.status(404).json({ detail: 'Leave policy not configured' });
    }

    // Build new leave balance
    const newBalance = {};
    for (const policyItem of policy.policies || []) {
      const leaveKey = normalizeLeaveType(policyItem.leave_type);
      newBalance[leaveKey] = policyItem.annual_quota;
    }

    // Update all employees
    const result = await db.collection('employees').updateMany(
      {},
      { $set: { leave_balance: newBalance } }
    );

    res.json({
      status: 'success',
      message: `Leave policy applied to ${result.modifiedCount} employees`,
      new_balance: newBalance,
      employees_updated: result.modifiedCount
    });
  } catch (error) {
    console.error('Apply policy to all error:', error);
    res.status(500).json({ detail: error.message });
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

    // Calculate days from dates array
    const daysCount = calculateDaysFromDates(leaveData.dates, leaveData.is_half_day);

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
        null, // No end_date anymore
        leaveData.reason
      );

      const whatsappMsg = `New leave application from ${employee.full_name}\nType: ${leaveData.leave_type}\nDates: ${datesDisplay}\nDays: ${daysCount}\nReason: ${leaveData.reason}`;

      // Find and notify manager
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

      // Find and notify admin
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

    // Remove MongoDB _id
    delete leaveDoc._id;

    // Normalize dates for response
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

    // Normalize dates
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

    // Normalize dates
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

    // Normalize dates
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
 * NOTE: This must be BEFORE /calendar/:employeeId to avoid matching "me" as employeeId
 */
router.get('/calendar/me', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const user = req.user;

    // Find employee by user email
    const employee = await db.collection('employees').findOne(
      { email: user.email },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Reuse the calendar logic
    req.params.employeeId = employee.employee_id;

    // Get leaves
    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    // Define colors for leave types
    const leaveColors = {
      sick_leave: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
      casual_leave: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
      paid_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
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

    // Process leaves for calendar
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

    // Find employee
    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Permission check
    if (![UserRole.ADMIN, UserRole.MANAGER].includes(user.role)) {
      if (employee.email !== user.email) {
        return res.status(403).json({ detail: "Not authorized to view this employee's leaves" });
      }
    }

    // Get leaves
    const leaves = await db.collection('leaves')
      .find({ employee_email: employee.email }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();

    // Define colors for leave types
    const leaveColors = {
      sick_leave: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' },
      casual_leave: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
      paid_leave: { bg: '#dcfce7', border: '#22c55e', text: '#166534' },
      unpaid_leave: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' },
      comp_off: { bg: '#e9d5ff', border: '#a855f7', text: '#6b21a8' }
    };

    const statusStyles = {
      pending: { opacity: '0.6', pattern: 'striped' },
      manager_approved: { opacity: '0.8', pattern: 'dotted' },
      approved: { opacity: '1', pattern: 'solid' },
      rejected: { opacity: '0.4', pattern: 'crossed' }
    };

    // Process leaves for calendar - create an event for each date
    const calendarEvents = [];

    for (const leave of leaves) {
      normalizeLeaveDates(leave);

      const leaveTypeKey = normalizeLeaveType(leave.leave_type);
      const colors = leaveColors[leaveTypeKey] || { bg: '#f1f5f9', border: '#64748b', text: '#334155' };
      const statusStyle = statusStyles[leave.status] || { opacity: '1', pattern: 'solid' };

      // Create an event for each date in the dates array
      for (const date of leave.dates || []) {
        const dateObj = new Date(date);
        const dateStr = dateObj.toISOString().substring(0, 10);

        // Filter by year/month if provided
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

    // Sort events by date
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

    // Fetch leave
    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    // Normalize dates
    normalizeLeaveDates(leaveDoc);

    // *** CAPTURE ORIGINAL STATUS BEFORE ANY MODIFICATIONS ***
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

    // Add approval record
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

    // ============================================
    // LEAVE BALANCE DEDUCTION LOGIC (FIXED)
    // ============================================

    // Deduct balance on FIRST approval (manager_approved or direct admin approval from pending)
    // This ensures balance is deducted when:
    // 1. Manager approves: pending -> manager_approved
    // 2. Admin approves directly: pending -> approved
    // But NOT when admin approves after manager: manager_approved -> approved (already deducted)

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

    // Refund balance if admin rejects AFTER manager had already approved
    // This handles the case where balance was already deducted at manager_approved stage
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

    // Update leave in database
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

    // Send notifications
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
        // Notify employee
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

        // Notify admin
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

    // Normalize dates for response
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

    // Fetch existing leave
    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    // Normalize dates
    normalizeLeaveDates(leaveDoc);

    const originalLeave = { ...leaveDoc };
    // Balance was deducted if status is manager_approved OR approved
    const wasBalanceDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(originalLeave.status);
    const originalDays = originalLeave.days_count;
    const originalLeaveType = originalLeave.leave_type;

    // Build update dictionary
    const updateDict = {};

    if (editData.leave_type !== undefined) updateDict.leave_type = editData.leave_type;
    if (editData.reason !== undefined) updateDict.reason = editData.reason;
    if (editData.is_half_day !== undefined) updateDict.is_half_day = editData.is_half_day;
    if (editData.half_day_period !== undefined) updateDict.half_day_period = editData.half_day_period;

    // Handle dates array changes
    const isHalfDay = editData.is_half_day !== undefined ? editData.is_half_day : originalLeave.is_half_day;
    let newDays = originalDays;

    if (editData.dates) {
      updateDict.dates = datesToISOStrings(editData.dates);
      newDays = calculateDaysFromDates(editData.dates, isHalfDay);
      updateDict.days_count = newDays;
    } else if (editData.is_half_day !== undefined) {
      // Recalculate if only half_day changed
      newDays = calculateDaysFromDates(originalLeave.dates, isHalfDay);
      updateDict.days_count = newDays;
    }

    // Handle status change
    const newStatus = editData.status !== undefined ? editData.status : originalLeave.status;
    if (editData.status !== undefined) {
      updateDict.status = newStatus;

      // Add approval record
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

    // Leave balance adjustments
    const newLeaveType = updateDict.leave_type || originalLeaveType;
    const employeeEmail = originalLeave.employee_email;
    const willBalanceBeDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(newStatus);

    // Case 1: Balance was deducted and leave is being modified
    if (wasBalanceDeducted && originalLeaveType !== LeaveType.UNPAID_LEAVE) {
      const originalKey = normalizeLeaveType(originalLeaveType);

      if (!willBalanceBeDeducted) {
        // Status changing to pending or rejected - refund original days
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: originalDays } }
        );
        console.log(`Refunded ${originalDays} ${originalKey} to ${employeeEmail} (status changed to ${newStatus})`);
      } else if (newLeaveType !== originalLeaveType) {
        // Leave type changed - refund original, deduct new
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: originalDays } }
        );
        console.log(`Refunded ${originalDays} ${originalKey} to ${employeeEmail} (leave type changed)`);

        // Deduct from new type
        if (newLeaveType !== LeaveType.UNPAID_LEAVE) {
          const newKey = normalizeLeaveType(newLeaveType);
          await db.collection('employees').updateOne(
            { email: employeeEmail },
            { $inc: { [`leave_balance.${newKey}`]: -newDays } }
          );
          console.log(`Deducted ${newDays} ${newKey} from ${employeeEmail} (leave type changed)`);
        }
      } else if (newDays !== originalDays) {
        // Days changed but same type - adjust difference
        const daysDiff = newDays - originalDays;
        await db.collection('employees').updateOne(
          { email: employeeEmail },
          { $inc: { [`leave_balance.${originalKey}`]: -daysDiff } }
        );
        console.log(`Adjusted ${-daysDiff} ${originalKey} for ${employeeEmail} (days changed)`);
      }
    } else if (!wasBalanceDeducted && willBalanceBeDeducted) {
      // Case 2: Balance was NOT deducted but now needs to be (status changed to approved/manager_approved)
      if (newLeaveType !== LeaveType.UNPAID_LEAVE) {
        const newKey = normalizeLeaveType(newLeaveType);

        // Check balance
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

    // Update leave document
    await db.collection('leaves').updateOne(
      { id: leaveId },
      { $set: updateDict }
    );

    // Log the edit
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

    // Send notification
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

    // Return updated leave
    const updatedLeave = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    // Normalize dates for response
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

    // Fetch leave
    const leaveDoc = await db.collection('leaves').findOne(
      { id: leaveId },
      { projection: { _id: 0 } }
    );

    if (!leaveDoc) {
      return res.status(404).json({ detail: 'Leave not found' });
    }

    // Refund balance if it was deducted (manager_approved or approved status)
    const wasBalanceDeducted = [LeaveStatus.MANAGER_APPROVED, LeaveStatus.APPROVED].includes(leaveDoc.status);

    if (wasBalanceDeducted && leaveDoc.leave_type !== LeaveType.UNPAID_LEAVE) {
      const leaveTypeKey = normalizeLeaveType(leaveDoc.leave_type);
      await db.collection('employees').updateOne(
        { email: leaveDoc.employee_email },
        { $inc: { [`leave_balance.${leaveTypeKey}`]: leaveDoc.days_count } }
      );
      console.log(`Refunded ${leaveDoc.days_count} ${leaveTypeKey} to ${leaveDoc.employee_email} (leave deleted)`);
    }

    // Delete leave
    await db.collection('leaves').deleteOne({ id: leaveId });

    // Log deletion
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

// Export helper for use in employee routes
module.exports = router;
module.exports.getLeaveBalanceFromPolicy = async (db) => {
  const policy = await db.collection('leave_policies').findOne({}, { projection: { _id: 0 } });

  if (!policy || !policy.policies || policy.policies.length === 0) {
    return {
      sick_leave: 12,
      casual_leave: 12,
      paid_leave: 15,
      unpaid_leave: 0
    };
  }

  const balance = {};
  for (const policyItem of policy.policies) {
    const leaveKey = normalizeLeaveType(policyItem.leave_type);
    balance[leaveKey] = policyItem.annual_quota;
  }

  return balance;
};
