/**
 * Admin Routes for Leave Credit Management
 * 
 * Add to your routes:
 *   const leaveCreditRoutes = require('./routes/leaveCredit');
 *   app.use('/api/admin/leave-credit', leaveCreditRoutes);
 */

const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');
const { creditMonthlyLeaves, LEAVE_CREDIT_RULES, initializeLeaveBalance } = require('../cron/monthlyLeaveCredit');
const { normalizeLeaveType } = require('../utils/helpers');

/**
 * GET /api/admin/leave-credit/rules
 * Get current leave credit rules
 */
router.get('/rules', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  res.json({
    rules: LEAVE_CREDIT_RULES,
    description: {
      casual_leave: "6 days credited annually on January 1st. No carry forward. Resets each year.",
      sick_leave: "0.5 days credited on 1st of each month. Max 6 days. Resets to 0.5 each January.",
      earned_leave: "1 day credited on 1st of each month (starting Feb). Max 12 days. Resets to 0 each January."
    },
    cron_schedule: {
      monthly_credit: "1st of every month at 00:01 AM"
    },
    january_reset: {
      casual_leave: "Reset to 6",
      sick_leave: "Reset to 0, then +0.5 = 0.5",
      earned_leave: "Reset to 0"
    }
  });
});

/**
 * POST /api/admin/leave-balance/bulk-update
 * Bulk update leave balance for all employees
 * 
 * Body: {
 *   action_type: 'set' | 'add' | 'deduct',
 *   leave_type: 'casual_leave' | 'sick_leave' | 'earned_leave' | 'comp_off',
 *   days: number,
 *   reason: string
 * }
 */
router.post('/leave-balance/bulk-update', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { action_type, leave_type, days, reason } = req.body;

    // Validate inputs
    if (!['set', 'add', 'deduct'].includes(action_type)) {
      return res.status(400).json({ detail: 'Invalid action_type. Must be set, add, or deduct.' });
    }

    const validLeaveTypes = ['casual_leave', 'sick_leave', 'earned_leave', 'comp_off', 'unpaid_leave'];
    const leaveKey = normalizeLeaveType(leave_type);

    if (!validLeaveTypes.includes(leaveKey)) {
      return res.status(400).json({ detail: 'Invalid leave_type' });
    }

    if (typeof days !== 'number' || days < 0) {
      return res.status(400).json({ detail: 'Days must be a non-negative number' });
    }

    // Get all employees
    const employees = await db.collection('employees').find({}).toArray();
    const results = [];
    let updatedCount = 0;
    let errorCount = 0;

    for (const employee of employees) {
      try {
        const currentBalance = employee.leave_balance?.[leaveKey] || 0;
        let newBalance;

        switch (action_type) {
          case 'set':
            newBalance = days;
            break;
          case 'add':
            newBalance = currentBalance + days;
            break;
          case 'deduct':
            newBalance = Math.max(0, currentBalance - days);
            break;
        }

        // Round to 1 decimal
        newBalance = Math.round(newBalance * 10) / 10;

        // Update employee
        await db.collection('employees').updateOne(
          { id: employee.id },
          { $set: { [`leave_balance.${leaveKey}`]: newBalance } }
        );

        results.push({
          employee_id: employee.employee_id,
          name: employee.full_name,
          previous: currentBalance,
          new: newBalance
        });

        updatedCount++;
      } catch (err) {
        errorCount++;
        results.push({
          employee_id: employee.employee_id,
          name: employee.full_name,
          error: err.message
        });
      }
    }

    // Log the bulk action
    await db.collection('leave_adjustment_logs').insertOne({
      type: 'bulk_update',
      action_type,
      leave_type: leaveKey,
      days,
      reason,
      performed_by: req.user.email,
      affected_employees: updatedCount,
      results,
      created_at: new Date()
    });

    res.json({
      status: 'success',
      message: `Bulk update completed: ${action_type} ${days} ${leaveKey}`,
      updated_count: updatedCount,
      error_count: errorCount,
      results
    });
  } catch (error) {
    console.error('Bulk update error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/admin/leave-balance/update/:employeeId
 * Update leave balance for a specific employee
 * 
 * Body: {
 *   action_type: 'set' | 'add' | 'deduct',
 *   leave_type: 'casual_leave' | 'sick_leave' | 'earned_leave' | 'comp_off',
 *   days: number,
 *   reason: string
 * }
 */
router.post('/leave-balance/update/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;
    const { action_type, leave_type, days, reason } = req.body;

    // Validate inputs
    if (!['set', 'add', 'deduct'].includes(action_type)) {
      return res.status(400).json({ detail: 'Invalid action_type. Must be set, add, or deduct.' });
    }

    const validLeaveTypes = ['casual_leave', 'sick_leave', 'earned_leave', 'comp_off', 'unpaid_leave'];
    const leaveKey = normalizeLeaveType(leave_type);

    if (!validLeaveTypes.includes(leaveKey)) {
      return res.status(400).json({ detail: 'Invalid leave_type' });
    }

    if (typeof days !== 'number' || days < 0) {
      return res.status(400).json({ detail: 'Days must be a non-negative number' });
    }

    // Find employee
    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    const currentBalance = employee.leave_balance?.[leaveKey] || 0;
    let newBalance;

    switch (action_type) {
      case 'set':
        newBalance = days;
        break;
      case 'add':
        newBalance = currentBalance + days;
        break;
      case 'deduct':
        if (currentBalance < days) {
          return res.status(400).json({
            detail: `Insufficient balance. Current: ${currentBalance}, Trying to deduct: ${days}`
          });
        }
        newBalance = currentBalance - days;
        break;
    }

    // Round to 1 decimal
    newBalance = Math.round(newBalance * 10) / 10;

    // Update employee
    await db.collection('employees').updateOne(
      { employee_id: employeeId },
      { $set: { [`leave_balance.${leaveKey}`]: newBalance } }
    );

    // Log the adjustment
    await db.collection('leave_adjustment_logs').insertOne({
      type: 'individual_update',
      employee_id: employeeId,
      employee_email: employee.email,
      action_type,
      leave_type: leaveKey,
      previous_balance: currentBalance,
      new_balance: newBalance,
      days,
      reason,
      performed_by: req.user.email,
      created_at: new Date()
    });

    // Get updated leave balance
    const updatedEmployee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { leave_balance: 1 } }
    );

    res.json({
      status: 'success',
      message: `Successfully ${action_type} ${days} ${leaveKey} for ${employee.full_name}`,
      employee_id: employeeId,
      leave_type: leaveKey,
      previous_balance: currentBalance,
      new_balance: newBalance,
      new_leave_balance: updatedEmployee.leave_balance
    });
  } catch (error) {
    console.error('Individual update error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/admin/leave-credit/run-monthly
 * Manually trigger monthly leave credit (for testing)
 * 
 * Body: { "simulate_date": "2026-02-01" } (optional)
 */
router.post('/run-monthly', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { simulate_date } = req.body;

    const creditDate = simulate_date ? new Date(simulate_date) : new Date();

    console.log(`\n🔄 Manual trigger: Monthly leave credit for ${creditDate.toDateString()}`);

    const results = await creditMonthlyLeaves(db, creditDate);

    res.json({
      status: 'success',
      message: `Monthly leave credit completed for ${creditDate.toDateString()}`,
      credit_date: creditDate.toISOString(),
      results
    });
  } catch (error) {
    console.error('Manual monthly credit error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/admin/leave-credit/initialize-all
 * Initialize/reset all employees to starting balance based on current date
 * 
 * Policy (as of January 2026):
 * - Casual Leave: 6 days (annual quota)
 * - Sick Leave: 0.5 days (January credit)
 * - Earned Leave: 0 days (first credit on Feb 1st)
 * 
 * Body: { "as_of_date": "2026-01-07" } (optional)
 */
router.post('/initialize-all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { as_of_date } = req.body;

    const effectiveDate = as_of_date ? new Date(as_of_date) : new Date();
    const currentMonth = effectiveDate.getMonth() + 1; // 1-12
    const currentYear = effectiveDate.getFullYear();

    const employees = await db.collection('employees').find({}).toArray();
    const results = [];

    for (const employee of employees) {
      const joiningDate = employee.joining_date ? new Date(employee.joining_date) : null;

      // Skip if no joining date and can't determine
      if (!joiningDate) {
        // Assume they joined before this year, give them current month's balance
        const balance = calculateBalanceForDate(effectiveDate, effectiveDate);
        balance.comp_off = employee.leave_balance?.comp_off || 0;

        await db.collection('employees').updateOne(
          { id: employee.id },
          { $set: { leave_balance: balance, last_leave_credit_date: effectiveDate } }
        );

        results.push({
          employee_id: employee.employee_id,
          name: employee.full_name,
          status: 'initialized',
          note: 'No joining date - assumed existing employee',
          balance
        });
        continue;
      }

      // Skip if not yet joined
      if (joiningDate > effectiveDate) {
        results.push({
          employee_id: employee.employee_id,
          name: employee.full_name,
          status: 'skipped',
          reason: 'Not yet joined',
          joining_date: joiningDate.toISOString().split('T')[0]
        });
        continue;
      }

      // Calculate balance based on joining date and effective date
      const balance = calculateBalanceForDate(joiningDate, effectiveDate);
      balance.comp_off = employee.leave_balance?.comp_off || 0;  // Preserve existing comp_off

      await db.collection('employees').updateOne(
        { id: employee.id },
        {
          $set: {
            leave_balance: balance,
            last_leave_credit_date: effectiveDate
          }
        }
      );

      results.push({
        employee_id: employee.employee_id,
        name: employee.full_name,
        joining_date: joiningDate.toISOString().split('T')[0],
        status: 'initialized',
        balance
      });
    }

    res.json({
      status: 'success',
      message: `Initialized leave balance for ${results.filter(r => r.status === 'initialized').length} employees`,
      effective_date: effectiveDate.toISOString().split('T')[0],
      policy: {
        casual_leave: '6 days (annual)',
        sick_leave: '0.5 days/month',
        earned_leave: '1 day/month (from Feb)'
      },
      results
    });
  } catch (error) {
    console.error('Initialize all error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * Helper: Calculate balance for a given date
 * Based on joining date and effective date
 * 
 * Policy:
 * - Casual Leave: 6 days (reset each January)
 * - Sick Leave: 0.5 on joining + 0.5/month after (reset each January to 0.5)
 * - Earned Leave: 0 on joining, +1/month starting next month (reset each January to 0)
 */
function calculateBalanceForDate(joiningDate, effectiveDate) {
  const joining = new Date(joiningDate);
  const effective = new Date(effectiveDate);

  // If effective date is before joining, return zeros
  if (effective < joining) {
    return {
      casual_leave: 0,
      sick_leave: 0,
      earned_leave: 0,
      unpaid_leave: 0
    };
  }

  // Determine the start of the current leave year (most recent January 1st)
  let yearStart = new Date(effective.getFullYear(), 0, 1); // Jan 1 of effective year

  // If joining date is after year start, use joining date as reference
  const referenceDate = joining > yearStart ? joining : yearStart;

  // Calculate months since reference date
  let monthsSinceReference = (effective.getFullYear() - referenceDate.getFullYear()) * 12;
  monthsSinceReference += effective.getMonth() - referenceDate.getMonth();

  // If effective day is before reference day in the month, don't count this month
  if (effective.getDate() < referenceDate.getDate()) {
    monthsSinceReference--;
  }
  monthsSinceReference = Math.max(0, monthsSinceReference);

  // Calculate balance
  // Casual Leave: 6 (annual quota)
  const casualLeave = 6;

  // Sick Leave: 0.5 initial + 0.5 per month (max 6)
  // For January: starts at 0.5
  // For other months: accumulated from January
  let sickLeave;
  if (joining > yearStart) {
    // New employee this year - started with 0.5, add 0.5 per month after
    const joinDay = joining.getDate();
    const initialSick = joinDay <= 15 ? 0.5 : 0;
    sickLeave = Math.min(initialSick + (monthsSinceReference * 0.5), 6);
  } else {
    // Existing employee - 0.5 for Jan + 0.5 per month since
    const monthsThisYear = effective.getMonth(); // 0 = Jan, so Jan = 0 months after
    sickLeave = Math.min(0.5 + (monthsThisYear * 0.5), 6);
  }

  // Earned Leave: 0 initial, +1 per month starting from next month (max 12)
  let earnedLeave;
  if (joining > yearStart) {
    // New employee - earned leave starts next month
    earnedLeave = Math.min(monthsSinceReference * 1, 12);
  } else {
    // Existing employee - 0 for Jan, +1 per month since
    const monthsThisYear = effective.getMonth(); // 0 = Jan
    earnedLeave = Math.min(monthsThisYear * 1, 12);
  }

  return {
    casual_leave: casualLeave,
    sick_leave: Math.round(sickLeave * 10) / 10,
    earned_leave: Math.round(earnedLeave * 10) / 10,
    unpaid_leave: 0
  };
}

/**
 * GET /api/admin/leave-credit/logs
 * Get leave credit logs
 * 
 * Query: ?employee_id=EMP1001&month=1&year=2026&limit=50
 */
router.get('/logs', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employee_id, month, year, limit = 50 } = req.query;

    const query = {};
    if (employee_id) query.employee_id = employee_id;
    if (month) query.credit_month = parseInt(month);
    if (year) query.credit_year = parseInt(year);

    const logs = await db.collection('leave_credit_logs')
      .find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .toArray();

    res.json({
      count: logs.length,
      logs
    });
  } catch (error) {
    console.error('Get credit logs error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/admin/leave-credit/simulate
 * Simulate what balance would be on a future date without actually applying
 * 
 * Policy:
 * - January: Reset CL=6, SL=0.5, EL=0
 * - Other months: SL+0.5, EL+1
 * 
 * Body: { "employee_id": "EMP1001", "simulate_date": "2026-06-01" }
 */
router.post('/simulate', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employee_id, simulate_date } = req.body;

    if (!employee_id || !simulate_date) {
      return res.status(400).json({ detail: 'employee_id and simulate_date are required' });
    }

    const employee = await db.collection('employees').findOne(
      { employee_id },
      { projection: { _id: 0 } }
    );

    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    const targetDate = new Date(simulate_date);
    const today = new Date();
    const joiningDate = employee.joining_date ? new Date(employee.joining_date) : today;

    // Calculate months between now and target date
    const monthsToSimulate = calculateMonthsDiff(today, targetDate);

    // Start from current balance
    const currentBalance = employee.leave_balance || {};
    const simulatedBalance = { ...currentBalance };

    // Simulate monthly credits
    const creditDetails = [];
    let simDate = new Date(today);
    simDate.setDate(1);
    simDate.setMonth(simDate.getMonth() + 1); // Start from next month

    while (simDate <= targetDate) {
      const isJanuary = simDate.getMonth() === 0;

      if (isJanuary) {
        // JANUARY - YEAR RESET
        simulatedBalance.casual_leave = 6;
        simulatedBalance.sick_leave = 0.5;
        simulatedBalance.earned_leave = 0;
        creditDetails.push(`${simDate.toDateString()}: YEAR RESET - CL=6, SL=0.5, EL=0`);
      } else {
        // OTHER MONTHS - MONTHLY CREDITS
        simulatedBalance.sick_leave = Math.min((simulatedBalance.sick_leave || 0) + 0.5, 6);
        simulatedBalance.earned_leave = Math.min((simulatedBalance.earned_leave || 0) + 1, 12);
        creditDetails.push(`${simDate.toDateString()}: +0.5 SL, +1 EL`);
      }

      simDate.setMonth(simDate.getMonth() + 1);
    }

    // Round values
    simulatedBalance.sick_leave = Math.round((simulatedBalance.sick_leave || 0) * 10) / 10;
    simulatedBalance.earned_leave = Math.round((simulatedBalance.earned_leave || 0) * 10) / 10;

    res.json({
      employee: {
        employee_id: employee.employee_id,
        name: employee.full_name,
        joining_date: joiningDate.toISOString().split('T')[0]
      },
      simulation: {
        from_date: today.toISOString().split('T')[0],
        to_date: targetDate.toISOString().split('T')[0],
        months_simulated: monthsToSimulate
      },
      current_balance: currentBalance,
      simulated_balance: simulatedBalance,
      credit_details: creditDetails,
      policy: {
        january: 'Reset CL=6, SL=0.5, EL=0',
        other_months: '+0.5 SL, +1 EL'
      }
    });
  } catch (error) {
    console.error('Simulate error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * Helper: Calculate months between two dates
 */
function calculateMonthsDiff(fromDate, toDate) {
  const from = new Date(fromDate);
  const to = new Date(toDate);

  let months = (to.getFullYear() - from.getFullYear()) * 12;
  months += to.getMonth() - from.getMonth();

  // Don't count partial months
  if (to.getDate() < from.getDate()) {
    months--;
  }

  return Math.max(0, months);
}

/**
 * GET /api/admin/leave-credit/adjustment-logs
 * Get leave balance adjustment logs
 * 
 * Query: ?employee_id=EMP1001&type=bulk_update&limit=50
 */
router.get('/adjustment-logs', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employee_id, type, limit = 50 } = req.query;

    const query = {};
    if (employee_id) query.employee_id = employee_id;
    if (type) query.type = type;

    const logs = await db.collection('leave_adjustment_logs')
      .find(query)
      .sort({ created_at: -1 })
      .limit(parseInt(limit))
      .toArray();

    res.json({
      count: logs.length,
      logs
    });
  } catch (error) {
    console.error('Get adjustment logs error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/admin/leave-balance/set-all
 * Set specific leave balances for all employees at once
 * 
 * Body: {
 *   casual_leave: 6,
 *   sick_leave: 0.5,
 *   earned_leave: 0,
 *   reason: string
 * }
 */
router.post('/leave-balance/set-all', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { casual_leave, sick_leave, earned_leave, comp_off, reason } = req.body;

    const updateFields = {};
    if (casual_leave !== undefined) updateFields['leave_balance.casual_leave'] = casual_leave;
    if (sick_leave !== undefined) updateFields['leave_balance.sick_leave'] = sick_leave;
    if (earned_leave !== undefined) updateFields['leave_balance.earned_leave'] = earned_leave;
    if (comp_off !== undefined) updateFields['leave_balance.comp_off'] = comp_off;

    if (Object.keys(updateFields).length === 0) {
      return res.status(400).json({ detail: 'No leave types specified' });
    }

    // Update all employees
    const result = await db.collection('employees').updateMany(
      {},
      { $set: updateFields }
    );

    // Log the action
    await db.collection('leave_adjustment_logs').insertOne({
      type: 'set_all',
      changes: { casual_leave, sick_leave, earned_leave, comp_off },
      reason,
      performed_by: req.user.email,
      affected_employees: result.modifiedCount,
      created_at: new Date()
    });

    res.json({
      status: 'success',
      message: `Set leave balances for ${result.modifiedCount} employees`,
      updated_count: result.modifiedCount,
      values_set: { casual_leave, sick_leave, earned_leave, comp_off }
    });
  } catch (error) {
    console.error('Set all balances error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * GET /api/admin/leave-balance/summary
 * Get summary statistics of all employee leave balances
 */
router.get('/leave-balance/summary', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();

    const employees = await db.collection('employees').find({}).toArray();

    const summary = {
      total_employees: employees.length,
      leave_types: {}
    };

    const leaveTypes = ['casual_leave', 'sick_leave', 'earned_leave', 'comp_off'];

    for (const leaveType of leaveTypes) {
      const balances = employees.map(e => e.leave_balance?.[leaveType] || 0);
      summary.leave_types[leaveType] = {
        total: Math.round(balances.reduce((a, b) => a + b, 0) * 10) / 10,
        average: Math.round((balances.reduce((a, b) => a + b, 0) / balances.length) * 10) / 10,
        min: Math.min(...balances),
        max: Math.max(...balances),
        zero_balance_count: balances.filter(b => b === 0).length
      };
    }

    // Distribution
    summary.distribution = {
      casual_leave: {
        '0': employees.filter(e => (e.leave_balance?.casual_leave || 0) === 0).length,
        '1-3': employees.filter(e => {
          const b = e.leave_balance?.casual_leave || 0;
          return b > 0 && b <= 3;
        }).length,
        '4-6': employees.filter(e => {
          const b = e.leave_balance?.casual_leave || 0;
          return b > 3 && b <= 6;
        }).length,
        '6+': employees.filter(e => (e.leave_balance?.casual_leave || 0) > 6).length
      }
    };

    res.json(summary);
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({ detail: error.message });
  }
});

module.exports = router;
