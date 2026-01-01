const Joi = require('joi');

// Enums
const UserRole = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  EMPLOYEE: 'employee'
};

const LeaveStatus = {
  PENDING: 'pending',
  MANAGER_APPROVED: 'manager_approved',
  APPROVED: 'approved',
  REJECTED: 'rejected'
};

const LeaveType = {
  SICK_LEAVE: 'Sick Leave',
  CASUAL_LEAVE: 'Casual Leave',
  PAID_LEAVE: 'Paid Leave',
  UNPAID_LEAVE: 'Unpaid Leave',
  COMP_OFF: 'Comp Off'
};

const AttendanceStatus = {
  PRESENT: 'present',
  ABSENT: 'absent',
  HALF_DAY: 'half-day',
  LEAVE: 'leave'
};

const ReimbursementStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CLEARED: 'cleared'
};

const ReimbursementCategory = {
  TRAVEL: 'Travel',
  FOOD_MEALS: 'Food & Meals',
  ACCOMMODATION: 'Accommodation',
  OFFICE_SUPPLIES: 'Office Supplies',
  EQUIPMENT: 'Equipment',
  SOFTWARE_TOOLS: 'Software & Tools',
  TRAINING_COURSES: 'Training & Courses',
  MEDICAL: 'Medical',
  COMMUNICATION: 'Communication',
  OTHER: 'Other'
};

// Validation Schemas
const schemas = {
  // Auth
  userRegister: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    full_name: Joi.string().required(),
    role: Joi.string().valid(...Object.values(UserRole)).required(),
    department: Joi.string().required(),
    designation: Joi.string().required(),
    phone: Joi.string().allow(null, ''),
    organization_id: Joi.string().allow(null, ''),
    manager_email: Joi.string().email().allow(null, '')
  }),

  userLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
  }),

  // Employee
  employeeCreate: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    full_name: Joi.string().required(),
    role: Joi.string().valid(...Object.values(UserRole)).required(),
    department: Joi.string().required(),
    designation: Joi.string().required(),
    phone: Joi.string().allow(null, ''),
    organization_id: Joi.string().allow(null, ''),
    joining_date: Joi.date().default(() => new Date()),
    manager_email: Joi.string().email().allow(null, ''),
    leave_balance: Joi.object({
      sick_leave: Joi.number().default(12),
      casual_leave: Joi.number().default(12),
      paid_leave: Joi.number().default(15),
      unpaid_leave: Joi.number().default(0)
    }).default()
  }),

  employeeUpdate: Joi.object({
    full_name: Joi.string(),
    department: Joi.string(),
    designation: Joi.string(),
    phone: Joi.string().allow(null, ''),
    monthly_salary: Joi.number().allow(null, ''),
    organization_id: Joi.string().allow(null, ''),
    manager_email: Joi.string().email().allow(null, '')
  }),

  roleUpdate: Joi.object({
    role: Joi.string().valid(...Object.values(UserRole)).required()
  }),

  leaveBalanceUpdate: Joi.object({
    leave_type: Joi.string().required(),
    reason: Joi.string().required(),
    adjustment_type: Joi.string().valid('add', 'deduct').required(),
    days: Joi.number().positive().required()
  }),

  // Leave
  leaveApplication: Joi.object({
    leave_type: Joi.string().required(),
    dates: Joi.array().items(Joi.date()).min(1).unique().required(),
    reason: Joi.string().required(),
    is_half_day: Joi.boolean().default(false),
    half_day_period: Joi.string().valid('morning', 'afternoon').allow(null)
  }),

  leaveAction: Joi.object({
    action: Joi.string().valid('approve', 'reject').required(),
    comments: Joi.string().allow(null, '')
  }),

  leaveEdit: Joi.object({
    leave_type: Joi.string(),
    dates: Joi.array().items(Joi.date()).min(1).unique(),
    reason: Joi.string(),
    is_half_day: Joi.boolean(),
    half_day_period: Joi.string().valid('morning', 'afternoon').allow(null),
    status: Joi.string().valid(...Object.values(LeaveStatus))
  }),

  // Organization
  organizationCreate: Joi.object({
    name: Joi.string().required(),
    logo_url: Joi.string().allow(null, ''),
    description: Joi.string().allow(null, '')
  }),

  organizationUpdate: Joi.object({
    name: Joi.string(),
    logo_url: Joi.string().allow(null, ''),
    description: Joi.string().allow(null, '')
  }),

  // Leave Policy
  leavePolicyItem: Joi.object({
    leave_type: Joi.string().required(),
    annual_quota: Joi.number().required(),
    order: Joi.number().default(0)
  }),

  leavePolicy: Joi.object({
    policies: Joi.array().items(Joi.object({
      leave_type: Joi.string().required(),
      annual_quota: Joi.number().required(),
      order: Joi.number().default(0)
    })).required()
  }),

  // Comp-Off
  compOffGrant: Joi.object({
    user_id: Joi.string().required(),
    days: Joi.number().positive().required(),
    work_date: Joi.date().required(),
    reason: Joi.string().required()
  }),

  // Salary
  salaryTemplate: Joi.object({
    earnings: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      order: Joi.number().default(0)
    })).required(),
    deductions: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      order: Joi.number().default(0)
    })).required()
  }),

  salaryStructure: Joi.object({
    basic_salary: Joi.number().required(),
    components: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      amount: Joi.number().required(),
      type: Joi.string().valid('earning', 'deduction').required(),
      is_percentage: Joi.boolean().default(false),
      calculation_base: Joi.string().valid('basic', 'gross').allow(null)
    })).default([])
  }),

  // Notification Settings
  notificationSettings: Joi.object({
    email_enabled: Joi.boolean().default(false),
    whatsapp_enabled: Joi.boolean().default(false),
    smtp_host: Joi.string().allow(null, ''),
    smtp_port: Joi.number().default(587),
    smtp_username: Joi.string().allow(null, ''),
    smtp_password: Joi.string().allow(null, ''),
    from_email: Joi.string().email().allow(null, ''),
    from_name: Joi.string().default('HRMS System'),
    twilio_account_sid: Joi.string().allow(null, ''),
    twilio_auth_token: Joi.string().allow(null, ''),
    twilio_phone_number: Joi.string().allow(null, '')
  }),

  // Setup
  setupDBConfig: Joi.object({
    mongo_url: Joi.string().required(),
    db_name: Joi.string().required(),
    pem_certificate: Joi.string().allow(null, '')
  }),

  setupServerConfig: Joi.object({
    server_ip: Joi.string().required(),
    backend_port: Joi.string().required(),
    frontend_port: Joi.string().required(),
    jwt_secret: Joi.string().required()
  }),

  setupAdminConfig: Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required()
  }),

  // Employee ID Settings
  employeeIdSettings: Joi.object({
    prefix: Joi.string().default('EMP'),
    counter: Joi.number().default(1000)
  }),

  // Payroll
  sendSalarySlip: Joi.object({
    employee_id: Joi.string().required(),
    month: Joi.string().pattern(/^\d{4}-\d{2}$/).required()
  }),

  sendDetailedSalarySlip: Joi.object({
    employee_id: Joi.string().required(),
    month: Joi.string().pattern(/^\d{4}-\d{2}$/).required(),
    unpaid_full_days: Joi.number().min(0).default(0),
    unpaid_half_days: Joi.number().min(0).default(0),
    per_full_day_deduction: Joi.number().min(0).default(0),
    per_half_day_deduction: Joi.number().min(0).default(0),
    unpaid_leave_deduction: Joi.number().min(0).default(0)
  }),

  // Holiday
  holidayCreate: Joi.object({
    name: Joi.string().required(),
    date: Joi.date().required(),
    type: Joi.string().valid('public', 'optional', 'restricted').default('public'),
    description: Joi.string().allow(null, '')
  }),

  holidayUpdate: Joi.object({
    name: Joi.string(),
    date: Joi.date(),
    type: Joi.string().valid('public', 'optional', 'restricted'),
    description: Joi.string().allow(null, '')
  }),

  recurringHoliday: Joi.object({
    name: Joi.string().required(),
    day_of_week: Joi.number().min(0).max(6).required(), // 0=Sunday, 6=Saturday
    scope: Joi.string().valid('year', 'month').required(),
    year: Joi.number().required(),
    month: Joi.number().min(1).max(12).allow(null), // Required if scope is 'month'
    type: Joi.string().valid('public', 'optional', 'restricted').default('public')
  }),

  bulkHolidayDelete: Joi.object({
    day_of_week: Joi.number().min(0).max(6).required(),
    scope: Joi.string().valid('year', 'month').required(),
    year: Joi.number().required(),
    month: Joi.number().min(1).max(12).allow(null)
  }),

  // Attendance
  attendanceMark: Joi.object({
    employee_id: Joi.string().required(),
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(), // YYYY-MM-DD
    status: Joi.string().valid(...Object.values(AttendanceStatus), '').required()
  }),

  attendanceBulkMark: Joi.object({
    records: Joi.array().items(Joi.object({
      employee_id: Joi.string().required(),
      date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
      status: Joi.string().valid(...Object.values(AttendanceStatus), '').required()
    })).min(1).required()
  }),

  attendanceMarkColumn: Joi.object({
    date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    status: Joi.string().valid(...Object.values(AttendanceStatus)).required()
  }),

  attendanceQuery: Joi.object({
    month: Joi.number().min(1).max(12),
    year: Joi.number().min(2000).max(2100)
  }),

  attendanceDownload: Joi.object({
    month: Joi.number().min(1).max(12),
    year: Joi.number().min(2000).max(2100)
  }),

  attendanceClear: Joi.object({
    month: Joi.number().min(1).max(12).required(),
    year: Joi.number().min(2000).max(2100).required()
  }),

  // Reimbursement
  reimbursementApply: Joi.object({
    title: Joi.string().required().max(200),
    category: Joi.string().valid(...Object.values(ReimbursementCategory)).required(),
    amount: Joi.number().positive().required(),
    description: Joi.string().max(1000).allow(null, ''),
    expense_date: Joi.date().required()
  }),

  reimbursementAction: Joi.object({
    action: Joi.string().valid('approve', 'reject', 'clear').required(),
    remarks: Joi.string().max(500).allow(null, '')
  })
};

// Default leave balance
const defaultLeaveBalance = {
  sick_leave: 10,
  casual_leave: 15,
  paid_leave: 20,
  unpaid_leave: 0
};

// Default salary template
const defaultSalaryTemplate = {
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
};

// Default leave policy
const defaultLeavePolicy = {
  id: 'default_policy',
  policies: [
    { leave_type: 'Sick Leave', annual_quota: 12, order: 1 },
    { leave_type: 'Casual Leave', annual_quota: 12, order: 2 },
    { leave_type: 'Paid Leave', annual_quota: 15, order: 3 },
    { leave_type: 'Unpaid Leave', annual_quota: 0, order: 4 }
  ]
};

module.exports = {
  schemas,
  UserRole,
  LeaveStatus,
  LeaveType,
  AttendanceStatus,
  ReimbursementStatus,
  ReimbursementCategory,
  defaultLeaveBalance,
  defaultSalaryTemplate,
  defaultLeavePolicy
};
