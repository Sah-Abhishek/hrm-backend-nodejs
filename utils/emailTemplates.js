/**
 * Generate leave application notification email
 */
const generateLeaveApplicationEmail = (employeeName, leaveType, startDate, endDate, reason) => {
  return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #1e293b; border-bottom: 3px solid #10b981; padding-bottom: 10px;">Leave Application Submitted</h2>
            <p>Hello,</p>
            <p><strong>${employeeName}</strong> has applied for leave with the following details:</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Leave Type:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${leaveType}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Start Date:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${startDate}</td>
                </tr>
                <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>End Date:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${endDate}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Reason:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${reason}</td>
                </tr>
            </table>
            <p style="margin-top: 20px; padding: 15px; background-color: #dbeafe; border-left: 4px solid #3b82f6; border-radius: 4px;">
                Please review and approve/reject this leave application at your earliest convenience.
            </p>
            <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                This is an automated notification from HRMS Leave Management System.
            </p>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate leave approval/rejection email
 */
const generateLeaveApprovalEmail = (employeeName, leaveType, startDate, endDate, status) => {
  const isApproved = status.toLowerCase().includes('approved');
  const statusColor = isApproved ? '#10b981' : '#ef4444';
  const statusText = isApproved ? 'Approved' : 'Rejected';

  return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: ${statusColor}; border-bottom: 3px solid ${statusColor}; padding-bottom: 10px;">Leave ${statusText}</h2>
            <p>Hello <strong>${employeeName}</strong>,</p>
            <p>Your leave application has been <strong style="color: ${statusColor};">${statusText.toUpperCase()}</strong>.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Leave Type:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${leaveType}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Start Date:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${startDate}</td>
                </tr>
                <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>End Date:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${endDate}</td>
                </tr>
            </table>
            <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                This is an automated notification from HRMS Leave Management System.
            </p>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate welcome email for new employee
 */
const generateWelcomeEmail = (employeeName, employeeId, email, role, department, designation) => {
  return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #10b981; border-bottom: 3px solid #10b981; padding-bottom: 10px;">Welcome to HRMS! 🎉</h2>
            <p>Dear <strong>${employeeName}</strong>,</p>
            <p>Welcome aboard! Your account has been successfully created in our HRMS Leave Management System.</p>
            
            <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <h3 style="margin-top: 0; color: #166534;">Your Account Details</h3>
                <table style="width: 100%;">
                    <tr>
                        <td style="padding: 5px 0;"><strong>Employee ID:</strong></td>
                        <td style="padding: 5px 0;">${employeeId}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0;"><strong>Email:</strong></td>
                        <td style="padding: 5px 0;">${email}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0;"><strong>Role:</strong></td>
                        <td style="padding: 5px 0; text-transform: capitalize;">${role}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0;"><strong>Department:</strong></td>
                        <td style="padding: 5px 0;">${department}</td>
                    </tr>
                    <tr>
                        <td style="padding: 5px 0;"><strong>Designation:</strong></td>
                        <td style="padding: 5px 0;">${designation}</td>
                    </tr>
                </table>
            </div>
            
            <p>You can now:</p>
            <ul>
                <li>Apply for leaves</li>
                <li>View your leave balance</li>
                <li>Track leave application status</li>
                <li>Update your profile information</li>
            </ul>
            
            <p style="margin-top: 20px;">If you have any questions, please contact your HR administrator.</p>
            
            <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                This is an automated notification from HRMS Leave Management System.
            </p>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate new employee notification email for admin
 */
const generateNewEmployeeNotificationEmail = (employeeName, employeeId, email, role, department, designation, adminName) => {
  return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #1e293b; border-bottom: 3px solid #3b82f6; padding-bottom: 10px;">New Employee Added</h2>
            <p>Hello ${adminName},</p>
            <p>A new employee has been added to the HRMS system:</p>
            
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Employee Name:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${employeeName}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Employee ID:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${employeeId}</td>
                </tr>
                <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Email:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${email}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Role:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0; text-transform: capitalize;">${role}</td>
                </tr>
                <tr style="background-color: #f8fafc;">
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Department:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${department}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;"><strong>Designation:</strong></td>
                    <td style="padding: 10px; border: 1px solid #e2e8f0;">${designation}</td>
                </tr>
            </table>
            
            <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                This is an automated notification from HRMS Leave Management System.
            </p>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate leave edit notification email
 */
const generateLeaveEditEmail = (employeeName, changes) => {
  const changesList = changes.map(c => `<li>${c}</li>`).join('');

  return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #1e293b; border-bottom: 3px solid #3b82f6; padding-bottom: 10px;">Leave Application Updated</h2>
            <p>Hello <strong>${employeeName}</strong>,</p>
            <p>Your leave application has been updated by an administrator.</p>
            
            <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <h3 style="margin-top: 0;">Changes Made:</h3>
                <ul>
                    ${changesList}
                </ul>
            </div>
            
            <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
                This is an automated notification from HRMS Leave Management System.
            </p>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate salary slip email
 */
const generateSalarySlipEmail = (data) => {
  const {
    employeeName,
    employeeId,
    department,
    designation,
    monthName,
    totalDaysInMonth,
    payableDays,
    baseSalary,
    perDaySalary,
    unpaidDays,
    unpaidDeduction,
    netSalary,
    approvedLeaves = []
  } = data;

  const unpaidSection = unpaidDays > 0 ? `
    <tr style="background: #fee2e2; border-left: 3px solid #ef4444;">
        <td style="padding: 10px; color: #991b1b;">Unpaid Leave Deduction (${unpaidDays} days):</td>
        <td style="padding: 10px; color: #991b1b; font-weight: 600; text-align: right;">- ₹${unpaidDeduction.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
    </tr>
  ` : '';

  const leavesSection = approvedLeaves.length > 0 ? `
    <div style="margin-top: 25px; padding: 20px; background: #fffbeb; border-radius: 8px; border-left: 4px solid #f59e0b;">
        <h3 style="margin: 0 0 15px 0; color: #92400e;">Leave Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="border-bottom: 2px solid #fcd34d;">
                    <th style="text-align: left; padding: 10px 0; color: #78350f;">Type</th>
                    <th style="text-align: center; padding: 10px 0; color: #78350f;">Dates</th>
                    <th style="text-align: right; padding: 10px 0; color: #78350f;">Days</th>
                </tr>
            </thead>
            <tbody>
                ${approvedLeaves.map(leave => `
                <tr>
                    <td style="padding: 8px 0; color: #92400e;">${leave.leave_type}</td>
                    <td style="padding: 8px 0; color: #92400e; text-align: center; font-size: 13px;">
                        ${new Date(leave.start_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} - ${new Date(leave.end_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                    <td style="padding: 8px 0; color: #92400e; text-align: right; font-weight: 600;">${leave.days_count}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
    </div>
  ` : '';

  return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 700px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Salary Slip</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0 0;">${monthName}</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            <!-- Employee Details -->
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
                <h2 style="margin: 0 0 15px 0; color: #1e293b; font-size: 18px;">Employee Details</h2>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #64748b; width: 40%;">Employee Name:</td>
                        <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${employeeName}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b;">Employee ID:</td>
                        <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${employeeId}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b;">Department:</td>
                        <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${department}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; color: #64748b;">Designation:</td>
                        <td style="padding: 8px 0; color: #1e293b; font-weight: 600;">${designation}</td>
                    </tr>
                </table>
            </div>
            
            <!-- Attendance Summary -->
            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin-bottom: 25px; border-left: 4px solid #10b981;">
                <h2 style="margin: 0 0 15px 0; color: #166534; font-size: 18px;">Attendance Summary</h2>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px 0; color: #15803d;">Total Days in Month:</td>
                        <td style="padding: 8px 0; color: #166534; font-weight: 600; text-align: right;">${totalDaysInMonth} days</td>
                    </tr>
                    <tr style="background: #fee2e2;">
                        <td style="padding: 8px 0; color: #991b1b;">Unpaid Leaves:</td>
                        <td style="padding: 8px 0; color: #991b1b; font-weight: 600; text-align: right;">${unpaidDays} days</td>
                    </tr>
                    <tr style="border-top: 2px solid #86efac; border-bottom: 2px solid #86efac;">
                        <td style="padding: 12px 0; color: #166534; font-weight: 600;">Payable Days:</td>
                        <td style="padding: 12px 0; color: #166534; font-weight: 700; text-align: right; font-size: 18px;">${payableDays} days</td>
                    </tr>
                </table>
            </div>
            
            <!-- Salary Breakdown -->
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin-bottom: 25px;">
                <h2 style="margin: 0 0 15px 0; color: #1e293b; font-size: 18px;">Salary Breakdown</h2>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 10px 0; color: #64748b;">Base Salary:</td>
                        <td style="padding: 10px 0; color: #1e293b; font-weight: 600; text-align: right;">₹${baseSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                    <tr>
                        <td style="padding: 10px 0; color: #64748b;">Per Day Salary:</td>
                        <td style="padding: 10px 0; color: #64748b; text-align: right;">₹${perDaySalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                    ${unpaidSection}
                </table>
            </div>
            
            <!-- Net Salary -->
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 25px; border-radius: 8px; text-align: center;">
                <p style="color: rgba(255,255,255,0.9); margin: 0 0 10px 0; font-size: 16px;">Net Salary</p>
                <h1 style="color: white; margin: 0; font-size: 36px; font-weight: 700;">₹${netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h1>
            </div>
            
            ${leavesSection}
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e2e8f0; text-align: center;">
                <p style="color: #64748b; font-size: 12px; margin: 0;">
                    This is a system-generated salary slip. For queries, please contact HR.
                </p>
                <p style="color: #94a3b8; font-size: 11px; margin: 10px 0 0 0;">
                    Generated on ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}
                </p>
            </div>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate detailed salary slip email with components
 */
const generateDetailedSalarySlipEmail = (data) => {
  const {
    employeeName,
    employeeId,
    department,
    designation,
    monthName,
    totalDaysInMonth,
    payableDays,
    unpaidDays,
    earningsHtml,
    deductionsHtml,
    grossSalary,
    totalDeductions,
    netSalary
  } = data;

  return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px; text-align: center;">SALARY SLIP</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 5px 0 0 0; text-align: center;">${monthName}</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            <!-- Employee Details -->
            <table style="width: 100%; margin-bottom: 20px; border-collapse: collapse;">
                <tr>
                    <td style="padding: 10px; background: #f8fafc; font-weight: 600; width: 30%;">Employee Name:</td>
                    <td style="padding: 10px; background: #f8fafc;">${employeeName}</td>
                    <td style="padding: 10px; background: #f8fafc; font-weight: 600; width: 30%;">Employee ID:</td>
                    <td style="padding: 10px; background: #f8fafc;">${employeeId}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; font-weight: 600;">Department:</td>
                    <td style="padding: 10px;">${department}</td>
                    <td style="padding: 10px; font-weight: 600;">Designation:</td>
                    <td style="padding: 10px;">${designation}</td>
                </tr>
                <tr>
                    <td style="padding: 10px; background: #f8fafc; font-weight: 600;">Pay Period:</td>
                    <td style="padding: 10px; background: #f8fafc;">${monthName}</td>
                    <td style="padding: 10px; background: #f8fafc; font-weight: 600;">Payable Days:</td>
                    <td style="padding: 10px; background: #f8fafc;">${payableDays} / ${totalDaysInMonth}</td>
                </tr>
            </table>
            
            <!-- Salary Breakdown -->
            <div style="margin: 30px 0;">
                <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding-right: 10px;">
                            <!-- Earnings -->
                            <div style="border: 2px solid #10b981; border-radius: 8px; overflow: hidden;">
                                <div style="background: #10b981; color: white; padding: 12px; font-weight: 600; font-size: 16px;">
                                    EARNINGS
                                </div>
                                <table style="width: 100%;">
                                    ${earningsHtml}
                                    <tr style="background: #dcfce7;">
                                        <td style="padding: 12px; font-weight: 700; font-size: 16px;">Gross Earnings</td>
                                        <td style="padding: 12px; text-align: right; font-weight: 700; font-size: 16px;">₹${grossSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                    </tr>
                                </table>
                            </div>
                        </td>
                        <td style="width: 50%; vertical-align: top; padding-left: 10px;">
                            <!-- Deductions -->
                            <div style="border: 2px solid #ef4444; border-radius: 8px; overflow: hidden;">
                                <div style="background: #ef4444; color: white; padding: 12px; font-weight: 600; font-size: 16px;">
                                    DEDUCTIONS
                                </div>
                                <table style="width: 100%;">
                                    ${deductionsHtml || '<tr><td style="padding: 20px; text-align: center; color: #64748b;">No deductions</td></tr>'}
                                    <tr style="background: #fee2e2;">
                                        <td style="padding: 12px; font-weight: 700; font-size: 16px;">Total Deductions</td>
                                        <td style="padding: 12px; text-align: right; font-weight: 700; font-size: 16px;">₹${totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                                    </tr>
                                </table>
                            </div>
                        </td>
                    </tr>
                </table>
            </div>
            
            <!-- Net Salary -->
            <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 20px; border-radius: 8px; text-align: center; margin: 30px 0;">
                <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 14px;">NET SALARY (Gross - Deductions)</p>
                <h1 style="color: white; margin: 10px 0 0 0; font-size: 42px; font-weight: 700;">₹${netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h1>
            </div>
            
            <div style="text-align: center; padding: 20px; border-top: 2px solid #e2e8f0; margin-top: 30px;">
                <p style="color: #64748b; font-size: 12px; margin: 0;">
                    This is a system-generated salary slip. For queries, contact HR.
                </p>
                <p style="color: #94a3b8; font-size: 11px; margin: 10px 0 0 0;">
                    Generated on ${new Date().toLocaleString('en-IN', { dateStyle: 'long', timeStyle: 'short' })}
                </p>
            </div>
        </div>
    </body>
    </html>
  `;
};

/**
 * Generate password reset email HTML
 * Add this function to your existing emailTemplates.js file
 */

const generatePasswordResetEmail = (fullName, resetUrl, expiryHours = 24) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 40px 30px; border-radius: 16px 16px 0 0; text-align: center;">
          <h1 style="color: #020202; margin: 0; font-size: 28px; font-weight: 700;">HRMS</h1>
          <p style="color: #94a3b8; margin: 10px 0 0; font-size: 14px;">Password Reset Request</p>
        </div>
        
        <!-- Content -->
        <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #334155; font-size: 18px; line-height: 1.6; margin: 0 0 20px;">
            Hi <strong>${fullName}</strong>,
          </p>
          
          <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
            We received a request to reset your password. Click the button below to create a new password:
          </p>
          
          <!-- Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); 
                      color: #020202; text-decoration: none; padding: 16px 40px; border-radius: 50px; 
                      font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(30, 41, 59, 0.3);">
              Reset My Password
            </a>
          </div>
          
          <!-- Warning Box -->
          <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 25px 0;">
            <p style="color: #92400e; font-size: 14px; margin: 0; line-height: 1.5;">
              <strong>⚠️ Important:</strong> This is a <strong>one-time use link</strong> and will expire in <strong>${expiryHours} hours</strong>. 
              After you reset your password, this link will no longer work.
            </p>
          </div>
          
          <!-- Link fallback -->
          <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="background: #f8fafc; padding: 12px; border-radius: 6px; word-break: break-all; 
                    font-size: 12px; color: #475569; margin: 10px 0;">
            ${resetUrl}
          </p>
          
          <!-- Security notice -->
          <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 25px 0 0;">
            <p style="color: #64748b; font-size: 13px; margin: 0; line-height: 1.5;">
              🔒 <strong>Security Notice:</strong> If you didn't request this password reset, you can safely ignore this email. 
              Your password will remain unchanged.
            </p>
          </div>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 25px 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; text-align: center;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            This is an automated message from HRMS. Please do not reply to this email.
          </p>
          <p style="color: #cbd5e1; font-size: 11px; margin: 10px 0 0;">
            © ${new Date().getFullYear()} HRMS. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generate bulk password reset email HTML (for admin-triggered resets)
 */
const generateBulkPasswordResetEmail = (fullName, resetUrl, expiryHours = 24) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset Required</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 40px 30px; border-radius: 16px 16px 0 0; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">HRMS</h1>
          <p style="color: #94a3b8; margin: 10px 0 0; font-size: 14px;">Password Reset Required</p>
        </div>
        
        <!-- Content -->
        <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #334155; font-size: 18px; line-height: 1.6; margin: 0 0 20px;">
            Hi <strong>${fullName}</strong>,
          </p>
          
          <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 15px;">
            Your administrator has initiated a password reset for your HRMS account. 
          </p>
          
          <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
            Please click the button below to set a new password:
          </p>
          
          <!-- Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); 
                      color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 50px; 
                      font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(30, 41, 59, 0.3);">
              Set New Password
            </a>
          </div>
          
          <!-- Warning Box -->
          <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 25px 0;">
            <p style="color: #92400e; font-size: 14px; margin: 0; line-height: 1.5;">
              <strong>⚠️ Important:</strong> This is a <strong>one-time use link</strong> and will expire in <strong>${expiryHours} hours</strong>. 
              Please reset your password as soon as possible.
            </p>
          </div>
          
          <!-- Link fallback -->
          <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="background: #f8fafc; padding: 12px; border-radius: 6px; word-break: break-all; 
                    font-size: 12px; color: #475569; margin: 10px 0;">
            ${resetUrl}
          </p>
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 25px 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; text-align: center;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            This is an automated message from HRMS. Please do not reply to this email.
          </p>
          <p style="color: #cbd5e1; font-size: 11px; margin: 10px 0 0;">
            © ${new Date().getFullYear()} HRMS. All rights reserved.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};




module.exports = {
  generateLeaveApplicationEmail,
  generateLeaveApprovalEmail,
  generateWelcomeEmail,
  generateNewEmployeeNotificationEmail,
  generateLeaveEditEmail,
  generateSalarySlipEmail,
  generateDetailedSalarySlipEmail,
  generatePasswordResetEmail,
  generateBulkPasswordResetEmail
};
