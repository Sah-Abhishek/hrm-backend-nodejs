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
 * Now supports manual unpaid leave deduction rates
 */
router.post('/payroll/send-detailed-salary-slip', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const {
      employee_id,
      month,
      unpaid_full_days = 0,
      unpaid_half_days = 0,
      per_full_day_deduction = 0,
      per_half_day_deduction = 0,
      unpaid_leave_deduction = 0
    } = req.body;

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

    // Calculate total unpaid days for payable days calculation
    const totalUnpaidDays = unpaid_full_days + (unpaid_half_days * 0.5);
    const payableDays = totalDaysInMonth - totalUnpaidDays;

    // Calculate salary with components
    const basicSalary = salaryStructure.basic_salary;

    // Build earnings HTML
    let earningsHtml = `<tr><td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px;">Basic Salary</td><td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 14px; font-weight: 600;">₹${basicSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`;
    let totalEarnings = basicSalary;

    for (const comp of salaryStructure.components || []) {
      if (comp.type === 'earning') {
        let compAmount;
        if (comp.is_percentage && comp.calculation_base === 'basic') {
          compAmount = (basicSalary * comp.amount) / 100;
        } else {
          compAmount = comp.calculated_amount || comp.amount;
        }

        totalEarnings += compAmount;
        earningsHtml += `<tr><td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px;">${comp.name}</td><td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 14px; font-weight: 600;">₹${compAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`;
      }
    }

    // Build deductions HTML
    let deductionsHtml = '';
    let totalDeductions = 0;

    for (const comp of salaryStructure.components || []) {
      if (comp.type === 'deduction') {
        let compAmount;
        if (comp.is_percentage && comp.calculation_base === 'basic') {
          compAmount = (basicSalary * comp.amount) / 100;
        } else if (comp.is_percentage && comp.calculation_base === 'gross') {
          compAmount = (totalEarnings * comp.amount) / 100;
        } else {
          compAmount = comp.calculated_amount || comp.amount;
        }

        totalDeductions += compAmount;
        deductionsHtml += `<tr><td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; font-size: 14px;">${comp.name}</td><td style="padding: 12px 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-size: 14px; font-weight: 600; color: #dc2626;">₹${compAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>`;
      }
    }

    // Add unpaid leave deduction if applicable
    let leaveDeductionHtml = '';
    if (unpaid_leave_deduction > 0) {
      // Build detailed leave deduction breakdown
      let leaveBreakdown = '';
      if (unpaid_full_days > 0) {
        leaveBreakdown += `${unpaid_full_days} full day${unpaid_full_days !== 1 ? 's' : ''} @ ₹${per_full_day_deduction.toLocaleString('en-IN')}`;
      }
      if (unpaid_half_days > 0) {
        if (leaveBreakdown) leaveBreakdown += ', ';
        leaveBreakdown += `${unpaid_half_days} half day${unpaid_half_days !== 1 ? 's' : ''} @ ₹${per_half_day_deduction.toLocaleString('en-IN')}`;
      }

      leaveDeductionHtml = `
        <tr style="background-color: #fef3c7;">
          <td style="padding: 12px 16px; border-bottom: 1px solid #fcd34d; font-size: 14px;">
            <div style="font-weight: 600; color: #92400e;">Unpaid Leave Deduction</div>
            <div style="font-size: 12px; color: #a16207; margin-top: 4px;">${leaveBreakdown}</div>
          </td>
          <td style="padding: 12px 16px; border-bottom: 1px solid #fcd34d; text-align: right; font-size: 14px; font-weight: 600; color: #dc2626;">
            ₹${unpaid_leave_deduction.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </td>
        </tr>
      `;
      totalDeductions += unpaid_leave_deduction;
    }

    const grossSalary = totalEarnings;
    const netSalary = grossSalary - totalDeductions;

    // Generate email with leave deductions included
    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f1f5f9;">
  <div style="max-width: 650px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 32px; text-align: center;">
      <h1 style="color: #1e293b; margin: 0; font-size: 28px; font-weight: 700;">Salary Slip</h1>
      <p style="color: #94a3b8; margin: 8px 0 0 0; font-size: 16px;">${monthName}</p>
    </div>

    <!-- Employee Info -->
    <div style="padding: 24px; background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0;">
            <span style="color: #64748b; font-size: 13px;">Employee Name</span><br>
            <span style="color: #1e293b; font-size: 15px; font-weight: 600;">${employee.full_name}</span>
          </td>
          <td style="padding: 8px 0; text-align: right;">
            <span style="color: #64748b; font-size: 13px;">Employee ID</span><br>
            <span style="color: #1e293b; font-size: 15px; font-weight: 600;">${employee.employee_id || employee.id}</span>
          </td>
        </tr>
        <tr>
          <td style="padding: 8px 0;">
            <span style="color: #64748b; font-size: 13px;">Department</span><br>
            <span style="color: #1e293b; font-size: 15px; font-weight: 600;">${employee.department || 'N/A'}</span>
          </td>
          <td style="padding: 8px 0; text-align: right;">
            <span style="color: #64748b; font-size: 13px;">Designation</span><br>
            <span style="color: #1e293b; font-size: 15px; font-weight: 600;">${employee.designation || 'N/A'}</span>
          </td>
        </tr>
      </table>
    </div>

    <!-- Attendance Summary -->
    <div style="padding: 20px 24px; background-color: #ffffff; border-bottom: 1px solid #e2e8f0;">
      <h3 style="color: #334155; font-size: 16px; margin: 0 0 16px 0; font-weight: 600;">Attendance Summary</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 16px; background-color: #f1f5f9; border-radius: 8px; text-align: center; width: 25%;">
            <div style="color: #64748b; font-size: 12px;">Total Days</div>
            <div style="color: #1e293b; font-size: 20px; font-weight: 700;">${totalDaysInMonth}</div>
          </td>
          <td style="width: 8px;"></td>
          <td style="padding: 8px 16px; background-color: #fef3c7; border-radius: 8px; text-align: center; width: 25%;">
            <div style="color: #92400e; font-size: 12px;">Full Day Leave</div>
            <div style="color: #92400e; font-size: 20px; font-weight: 700;">${unpaid_full_days}</div>
          </td>
          <td style="width: 8px;"></td>
          <td style="padding: 8px 16px; background-color: #fed7aa; border-radius: 8px; text-align: center; width: 25%;">
            <div style="color: #9a3412; font-size: 12px;">Half Day Leave</div>
            <div style="color: #9a3412; font-size: 20px; font-weight: 700;">${unpaid_half_days}</div>
          </td>
          <td style="width: 8px;"></td>
          <td style="padding: 8px 16px; background-color: #dcfce7; border-radius: 8px; text-align: center; width: 25%;">
            <div style="color: #166534; font-size: 12px;">Payable Days</div>
            <div style="color: #166534; font-size: 20px; font-weight: 700;">${payableDays}</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Main Content -->
    <div style="padding: 24px;">
      <div style="display: flex; gap: 24px;">
        
        <!-- Earnings -->
        <div style="flex: 1; margin-bottom: 24px;">
          <div style="background-color: #f0fdf4; border-radius: 12px; overflow: hidden; border: 1px solid #bbf7d0;">
            <div style="background-color: #22c55e; padding: 14px 16px;">
              <h3 style="color: #ffffff; margin: 0; font-size: 16px; font-weight: 600;">💰 Earnings</h3>
            </div>
            <table style="width: 100%; border-collapse: collapse;">
              ${earningsHtml}
              <tr style="background-color: #dcfce7;">
                <td style="padding: 14px 16px; font-weight: 700; color: #166534; font-size: 15px;">Total Earnings</td>
                <td style="padding: 14px 16px; text-align: right; font-weight: 700; color: #166534; font-size: 15px;">₹${totalEarnings.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              </tr>
            </table>
          </div>
        </div>

      </div>

      <!-- Deductions -->
      <div style="margin-bottom: 24px;">
        <div style="background-color: #fef2f2; border-radius: 12px; overflow: hidden; border: 1px solid #fecaca;">
          <div style="background-color: #ef4444; padding: 14px 16px;">
            <h3 style="color: #ffffff; margin: 0; font-size: 16px; font-weight: 600;">📉 Deductions</h3>
          </div>
          <table style="width: 100%; border-collapse: collapse;">
            ${deductionsHtml}
            ${leaveDeductionHtml}
            <tr style="background-color: #fee2e2;">
              <td style="padding: 14px 16px; font-weight: 700; color: #991b1b; font-size: 15px;">Total Deductions</td>
              <td style="padding: 14px 16px; text-align: right; font-weight: 700; color: #991b1b; font-size: 15px;">₹${totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- Net Salary -->
      <div style="background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%); border-radius: 12px; padding: 24px; text-align: center;">
        <p style="color: rgba(255,255,255,0.8); margin: 0 0 8px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Net Salary Payable</p>
        <p style="color: #ffffff; margin: 0; font-size: 36px; font-weight: 700;">₹${netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
      </div>

      ${unpaid_leave_deduction > 0 ? `
      <!-- Leave Deduction Note -->
      <div style="margin-top: 16px; padding: 16px; background-color: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
        <p style="margin: 0; color: #92400e; font-size: 13px;">
          <strong>Note:</strong> Unpaid leave deduction of ₹${unpaid_leave_deduction.toLocaleString('en-IN')} has been applied for ${unpaid_full_days > 0 ? `${unpaid_full_days} full day${unpaid_full_days !== 1 ? 's' : ''}` : ''}${unpaid_full_days > 0 && unpaid_half_days > 0 ? ' and ' : ''}${unpaid_half_days > 0 ? `${unpaid_half_days} half day${unpaid_half_days !== 1 ? 's' : ''}` : ''} of unpaid leave.
        </p>
      </div>
      ` : ''}

    </div>

    <!-- Footer -->
    <div style="padding: 20px 24px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; text-align: center;">
      <p style="color: #64748b; font-size: 12px; margin: 0;">
        This is a computer-generated salary slip and does not require a signature.<br>
        For any queries, please contact HR department.
      </p>
    </div>

  </div>
</body>
</html>
    `;

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
        unpaid_leave_deduction: unpaid_leave_deduction,
        unpaid_full_days: unpaid_full_days,
        unpaid_half_days: unpaid_half_days,
        per_full_day_deduction: per_full_day_deduction,
        per_half_day_deduction: per_half_day_deduction,
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
