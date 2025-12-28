const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate, getCurrentEmployee } = require('../middleware/auth');
const { requireRole, validate } = require('../middleware/roleCheck');
const { schemas, UserRole, LeaveStatus } = require('../models/schemas');
const { generateUUID, toISOString, getDaysInMonth, getMonthName } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { generateSalarySlipEmail, generateDetailedSalarySlipEmail } = require('../utils/emailTemplates');

// Comp-Off Routes

/**
 * POST /api/comp-off/grant
 * Grant comp-off to employee
 */
router.post('/comp-off/grant', authenticate, requireRole([UserRole.ADMIN, UserRole.MANAGER]), validate(schemas.compOffGrant), async (req, res) => {
  try {
    const db = getDB();
    const { user_id, days, work_date, reason } = req.validatedBody;

    // Find user
    const user = await db.collection('users').findOne(
      { employee_id: user_id },
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

    // Normalize work_date
    const workDateObj = new Date(work_date);

    if (days <= 0) {
      return res.status(400).json({ detail: 'Days must be > 0' });
    }

    // Create comp-off record
    const compOffRecord = {
      id: generateUUID(),
      user_id,
      employee_id: employee.employee_id,
      employee_email: employee.email,
      employee_name: employee.full_name,
      days,
      used: 0,
      work_date: toISOString(workDateObj),
      reason,
      granted_by: req.user.email,
      granted_by_role: req.user.role,
      granted_date: new Date(),
      expiry_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
    };

    await db.collection('comp_off_records').insertOne(compOffRecord);

    res.json({
      message: 'Comp-off granted successfully',
      employee: employee.full_name,
      added_days: days
    });
  } catch (error) {
    console.error('Grant comp-off error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/comp-off/records
 * Get comp-off records
 */
router.get('/comp-off/records', authenticate, requireRole([UserRole.ADMIN, UserRole.MANAGER]), async (req, res) => {
  try {
    const db = getDB();
    const records = await db.collection('comp_off_records')
      .find({}, { projection: { _id: 0 } })
      .toArray();

    res.json(records);
  } catch (error) {
    console.error('Get comp-off records error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Salary Template Routes

/**
 * POST /api/salary-template
 * Save salary template (admin only)
 */
router.post('/salary-template', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const template = req.body;

    const templateData = {
      id: 'default_template',
      earnings: template.earnings || [],
      deductions: template.deductions || [],
      updated_at: toISOString(new Date()),
      updated_by: req.user.email
    };

    await db.collection('salary_templates').deleteMany({});
    await db.collection('salary_templates').insertOne(templateData);

    delete templateData._id;

    res.json({ status: 'success', template: templateData });
  } catch (error) {
    console.error('Save salary template error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/salary-template
 * Get salary template
 */
router.get('/salary-template', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const template = await db.collection('salary_templates').findOne(
      { id: 'default_template' },
      { projection: { _id: 0 } }
    );

    if (!template) {
      return res.json({
        id: 'default_template',
        earnings: [
          { name: 'Basic', order: 1 },
          { name: 'Dearness Allowance', order: 2 },
          { name: 'House Rent Allowance', order: 3 },
          { name: 'Conveyance Allowance', order: 4 },
          { name: 'Medical Allowance', order: 5 },
          { name: 'Special Allowance', order: 6 }
        ],
        deductions: [
          { name: 'Professional Tax', order: 1 },
          { name: 'TDS', order: 2 },
          { name: 'EPF', order: 3 }
        ]
      });
    }

    res.json(template);
  } catch (error) {
    console.error('Get salary template error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Salary Structure Routes

/**
 * POST /api/salary-structure/:employeeId
 * Save salary structure for employee (admin only)
 */
router.post('/salary-structure/:employeeId', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;
    const structure = req.body;

    // Find employee
    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    const salaryData = {
      employee_id: employeeId,
      basic_salary: structure.basic_salary || 0,
      components: structure.components || [],
      updated_at: toISOString(new Date())
    };

    // Calculate total salary
    const basic = salaryData.basic_salary;
    let totalEarnings = basic;
    let totalDeductions = 0;

    for (const comp of salaryData.components) {
      if (comp.is_percentage) {
        if (comp.calculation_base === 'basic') {
          comp.calculated_amount = (basic * comp.amount) / 100;
        } else {
          comp.calculated_amount = comp.amount;
        }
      } else {
        comp.calculated_amount = comp.amount;
      }

      if (comp.type === 'earning') {
        totalEarnings += comp.calculated_amount;
      } else {
        totalDeductions += comp.calculated_amount;
      }
    }

    salaryData.gross_salary = totalEarnings;
    salaryData.total_deductions = totalDeductions;
    salaryData.net_salary = totalEarnings - totalDeductions;

    // Update or insert
    await db.collection('salary_structures').deleteMany({ employee_id: employeeId });
    await db.collection('salary_structures').insertOne(salaryData);

    // Update employee's monthly_salary
    await db.collection('employees').updateOne(
      { employee_id: employeeId },
      { $set: { monthly_salary: salaryData.net_salary } }
    );

    delete salaryData._id;

    res.json({ status: 'success', structure: salaryData });
  } catch (error) {
    console.error('Save salary structure error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/salary-structure/:employeeId
 * Get salary structure for employee
 */
router.get('/salary-structure/:employeeId', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { employeeId } = req.params;

    // Permission check
    if (![UserRole.ADMIN, UserRole.MANAGER].includes(req.user.role)) {
      const employee = await db.collection('employees').findOne(
        { employee_id: employeeId },
        { projection: { email: 1 } }
      );
      if (!employee || employee.email !== req.user.email) {
        return res.status(403).json({ detail: 'Not authorized' });
      }
    }

    const structure = await db.collection('salary_structures').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );

    if (!structure) {
      // Return default structure
      const employee = await db.collection('employees').findOne(
        { employee_id: employeeId },
        { projection: { monthly_salary: 1 } }
      );

      if (employee?.monthly_salary) {
        return res.json({
          employee_id: employeeId,
          basic_salary: employee.monthly_salary,
          components: [],
          gross_salary: employee.monthly_salary,
          total_deductions: 0,
          net_salary: employee.monthly_salary
        });
      }

      return res.json(null);
    }

    res.json(structure);
  } catch (error) {
    console.error('Get salary structure error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

// Payroll Routes

/**
 * POST /api/payroll/send-salary-slip
 * Send basic salary slip (admin only)
 */
router.post('/payroll/send-salary-slip', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employee_id, month } = req.body;

    // Get employee
    const employee = await db.collection('employees').findOne(
      { employee_id },
      { projection: { _id: 0 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    if (!employee.monthly_salary) {
      return res.status(400).json({ detail: 'Employee salary not configured' });
    }

    // Parse month
    const [year, monthNum] = month.split('-');
    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(monthNum, 10);
    const monthName = getMonthName(yearInt, monthInt);
    const totalDaysInMonth = getDaysInMonth(yearInt, monthInt);

    // Get leaves for that month
    const startOfMonth = new Date(yearInt, monthInt - 1, 1);
    const endOfMonth = new Date(yearInt, monthInt, 0, 23, 59, 59);

    const leaves = await db.collection('leaves')
      .find({
        employee_id: employee.id,
        start_date: { $gte: startOfMonth.toISOString(), $lte: endOfMonth.toISOString() }
      }, { projection: { _id: 0 } })
      .toArray();

    // Calculate leave days
    const approvedLeaves = leaves.filter(l => l.status === LeaveStatus.APPROVED);
    const unpaidLeaves = approvedLeaves.filter(l => l.leave_type === 'Unpaid Leave');

    const totalLeaveDays = approvedLeaves.reduce((sum, l) => sum + l.days_count, 0);
    const unpaidDays = unpaidLeaves.reduce((sum, l) => sum + l.days_count, 0);

    // Calculate salary
    const baseSalary = employee.monthly_salary;
    const perDaySalary = baseSalary / totalDaysInMonth;
    const unpaidDeduction = unpaidDays * perDaySalary;
    const netSalary = baseSalary - unpaidDeduction;
    const actualWorkingDays = totalDaysInMonth - unpaidDays;

    // Generate email
    const emailHtml = generateSalarySlipEmail({
      employeeName: employee.full_name,
      employeeId: employee.id,
      department: employee.department,
      designation: employee.designation,
      monthName,
      totalDaysInMonth,
      payableDays: actualWorkingDays,
      baseSalary,
      perDaySalary,
      unpaidDays,
      unpaidDeduction,
      netSalary,
      approvedLeaves
    });

    // Send email
    const sent = await sendEmailNotification(
      employee.email,
      `Salary Slip - ${monthName}`,
      emailHtml
    );

    if (!sent) {
      return res.status(500).json({ detail: 'Failed to send salary slip' });
    }

    res.json({
      status: 'success',
      message: `Salary slip sent to ${employee.full_name}`,
      details: {
        base_salary: baseSalary,
        net_salary: netSalary,
        unpaid_deduction: unpaidDeduction,
        working_days: actualWorkingDays,
        leave_days: totalLeaveDays
      }
    });
  } catch (error) {
    console.error('Send salary slip error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/payroll/send-detailed-salary-slip
 * Send detailed salary slip with components (admin only)
 */
router.post('/payroll/send-detailed-salary-slip', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { employee_id, month } = req.body;

    // Get employee and salary structure
    const employee = await db.collection('employees').findOne(
      { employee_id },
      { projection: { _id: 0 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    const salaryStructure = await db.collection('salary_structures').findOne(
      { employee_id },
      { projection: { _id: 0 } }
    );
    if (!salaryStructure) {
      return res.status(400).json({ detail: 'Salary structure not configured for this employee' });
    }

    // Parse month
    const [year, monthNum] = month.split('-');
    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(monthNum, 10);
    const monthName = getMonthName(yearInt, monthInt);
    const totalDaysInMonth = getDaysInMonth(yearInt, monthInt);

    // Get leaves
    const startOfMonth = new Date(yearInt, monthInt - 1, 1);
    const endOfMonth = new Date(yearInt, monthInt, 0, 23, 59, 59);

    const leaves = await db.collection('leaves')
      .find({
        employee_id: employee.id,
        start_date: { $gte: startOfMonth.toISOString(), $lte: endOfMonth.toISOString() }
      }, { projection: { _id: 0 } })
      .toArray();

    const approvedLeaves = leaves.filter(l => l.status === LeaveStatus.APPROVED);
    const unpaidLeaves = approvedLeaves.filter(l => l.leave_type === 'Unpaid Leave');
    const unpaidDays = unpaidLeaves.reduce((sum, l) => sum + l.days_count, 0);
    const payableDays = totalDaysInMonth - unpaidDays;

    // Calculate salary with components
    const basicSalary = salaryStructure.basic_salary;
    const perDayBasic = basicSalary / totalDaysInMonth;
    const basicDeduction = unpaidDays * perDayBasic;
    const payableBasic = basicSalary - basicDeduction;

    // Build earnings HTML
    let earningsHtml = `<tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">Basic Salary</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">₹${payableBasic.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`;
    let totalEarnings = payableBasic;

    for (const comp of salaryStructure.components || []) {
      if (comp.type === 'earning') {
        let compAmount;
        if (comp.is_percentage && comp.calculation_base === 'basic') {
          compAmount = (payableBasic * comp.amount) / 100;
        } else {
          compAmount = comp.calculated_amount || comp.amount;
          const perDay = compAmount / totalDaysInMonth;
          compAmount = compAmount - (perDay * unpaidDays);
        }

        totalEarnings += compAmount;
        earningsHtml += `<tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${comp.name}</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">₹${compAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`;
      }
    }

    // Build deductions HTML
    let deductionsHtml = '';
    let totalDeductions = 0;

    for (const comp of salaryStructure.components || []) {
      if (comp.type === 'deduction') {
        let compAmount;
        if (comp.is_percentage && comp.calculation_base === 'basic') {
          compAmount = (payableBasic * comp.amount) / 100;
        } else if (comp.is_percentage && comp.calculation_base === 'gross') {
          compAmount = (totalEarnings * comp.amount) / 100;
        } else {
          compAmount = comp.calculated_amount || comp.amount;
        }

        totalDeductions += compAmount;
        deductionsHtml += `<tr><td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${comp.name}</td><td style="padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: right;">₹${compAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`;
      }
    }

    const grossSalary = totalEarnings;
    const netSalary = grossSalary - totalDeductions;

    // Generate email
    const emailHtml = generateDetailedSalarySlipEmail({
      employeeName: employee.full_name,
      employeeId: employee.id,
      department: employee.department,
      designation: employee.designation,
      monthName,
      totalDaysInMonth,
      payableDays,
      unpaidDays,
      earningsHtml,
      deductionsHtml,
      grossSalary,
      totalDeductions,
      netSalary
    });

    // Send email
    const sent = await sendEmailNotification(
      employee.email,
      `Salary Slip - ${monthName}`,
      emailHtml
    );

    if (!sent) {
      return res.status(500).json({ detail: 'Failed to send salary slip' });
    }

    res.json({
      status: 'success',
      message: `Detailed salary slip sent to ${employee.full_name}`,
      details: {
        gross_salary: grossSalary,
        total_deductions: totalDeductions,
        net_salary: netSalary,
        payable_days: payableDays
      }
    });
  } catch (error) {
    console.error('Send detailed salary slip error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/payroll/employee-report/:employeeId/:month
 * Get payroll report for employee
 */
router.get('/payroll/employee-report/:employeeId/:month', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { employeeId, month } = req.params;

    // Get employee
    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId },
      { projection: { _id: 0 } }
    );
    if (!employee) {
      return res.status(404).json({ detail: 'Employee not found' });
    }

    // Permission check
    if (![UserRole.ADMIN, UserRole.MANAGER].includes(req.user.role) && req.user.email !== employee.email) {
      return res.status(403).json({ detail: 'Not authorized' });
    }

    // Parse month
    const [year, monthNum] = month.split('-');
    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(monthNum, 10);
    const totalDaysInMonth = getDaysInMonth(yearInt, monthInt);

    // Get leaves
    const startOfMonth = new Date(yearInt, monthInt - 1, 1);
    const endOfMonth = new Date(yearInt, monthInt, 0, 23, 59, 59);

    const leaves = await db.collection('leaves')
      .find({
        employee_id: employee.id,
        start_date: { $gte: startOfMonth.toISOString(), $lte: endOfMonth.toISOString() }
      }, { projection: { _id: 0 } })
      .toArray();

    const approvedLeaves = leaves.filter(l => l.status === LeaveStatus.APPROVED);
    const unpaidLeaves = approvedLeaves.filter(l => l.leave_type === 'Unpaid Leave');

    const totalLeaveDays = approvedLeaves.reduce((sum, l) => sum + l.days_count, 0);
    const unpaidDays = unpaidLeaves.reduce((sum, l) => sum + l.days_count, 0);
    const actualWorkingDays = totalDaysInMonth - unpaidDays;

    let salaryData = null;
    if (employee.monthly_salary) {
      const baseSalary = employee.monthly_salary;
      const perDaySalary = baseSalary / totalDaysInMonth;
      const unpaidDeduction = unpaidDays * perDaySalary;
      const netSalary = baseSalary - unpaidDeduction;

      salaryData = {
        base_salary: baseSalary,
        per_day_salary: perDaySalary,
        unpaid_deduction: unpaidDeduction,
        net_salary: netSalary
      };
    }

    res.json({
      employee: {
        id: employee.id,
        name: employee.full_name,
        email: employee.email,
        department: employee.department,
        designation: employee.designation
      },
      month,
      attendance: {
        total_days_in_month: totalDaysInMonth,
        leave_days: totalLeaveDays,
        unpaid_days: unpaidDays,
        payable_days: actualWorkingDays
      },
      leaves: approvedLeaves,
      salary: salaryData
    });
  } catch (error) {
    console.error('Get employee payroll report error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/payroll/monthly-summary/:month
 * Get monthly payroll summary (admin only)
 */
router.get('/payroll/monthly-summary/:month', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const { month } = req.params;

    // Parse month
    const [year, monthNum] = month.split('-');
    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(monthNum, 10);
    const totalDaysInMonth = getDaysInMonth(yearInt, monthInt);

    const employees = await db.collection('employees')
      .find({}, { projection: { _id: 0 } })
      .toArray();

    const payrollSummary = [];
    let totalPayroll = 0;

    for (const employee of employees) {
      if (!employee.monthly_salary) continue;

      // Get leaves
      const startOfMonth = new Date(yearInt, monthInt - 1, 1);
      const endOfMonth = new Date(yearInt, monthInt, 0, 23, 59, 59);

      const leaves = await db.collection('leaves')
        .find({
          employee_id: employee.id,
          start_date: { $gte: startOfMonth.toISOString(), $lte: endOfMonth.toISOString() }
        }, { projection: { _id: 0 } })
        .toArray();

      const approvedLeaves = leaves.filter(l => l.status === LeaveStatus.APPROVED);
      const unpaidLeaves = approvedLeaves.filter(l => l.leave_type === 'Unpaid Leave');

      const totalLeaveDays = approvedLeaves.reduce((sum, l) => sum + l.days_count, 0);
      const unpaidDays = unpaidLeaves.reduce((sum, l) => sum + l.days_count, 0);
      const payableDays = totalDaysInMonth - unpaidDays;

      const baseSalary = employee.monthly_salary;
      const perDaySalary = baseSalary / totalDaysInMonth;
      const unpaidDeduction = unpaidDays * perDaySalary;
      const netSalary = baseSalary - unpaidDeduction;

      totalPayroll += netSalary;

      payrollSummary.push({
        employee_id: employee.id,
        employee_name: employee.full_name,
        department: employee.department,
        designation: employee.designation,
        base_salary: baseSalary,
        total_days_in_month: totalDaysInMonth,
        payable_days: payableDays,
        leave_days: totalLeaveDays,
        unpaid_days: unpaidDays,
        unpaid_deduction: unpaidDeduction,
        net_salary: netSalary
      });
    }

    res.json({
      month,
      total_days_in_month: totalDaysInMonth,
      total_employees: payrollSummary.length,
      total_payroll: totalPayroll,
      employees: payrollSummary
    });
  } catch (error) {
    console.error('Get monthly payroll summary error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
