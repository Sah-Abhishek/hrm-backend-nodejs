# HRMS Backend - Express.js + MongoDB

A comprehensive Human Resource Management System backend built with Express.js and MongoDB.

## Features

- **Authentication & Authorization**
  - JWT-based authentication with bcrypt password hashing
  - Role-based access control (admin, manager, employee)
  - Protected routes with middleware

- **Employee Management**
  - Auto-generated employee IDs (configurable prefix/counter)
  - Full CRUD operations with permission checks
  - Role updates (admin only)
  - Leave balance adjustments with audit logging
  - Manager/organization assignment

- **Leave Management**
  - Leave application with balance validation
  - Multi-level approval workflow (manager → admin)
  - Leave editing by admin (with balance recalculation)
  - Leave deletion with balance refund
  - Calendar view with color-coded leave types
  - Leave policy management (configurable quotas)
  - Half-day leave support

- **Payroll System**
  - Comp-off grant and tracking
  - Salary template configuration (earnings/deductions)
  - Employee-specific salary structures with components
  - Percentage-based calculations (basic/gross)
  - Basic and detailed salary slip generation
  - Automatic unpaid leave deduction calculation
  - Monthly payroll summary reports

- **Notifications**
  - Email notifications via Mailjet
  - WhatsApp notifications via Twilio
  - Rich HTML email templates
  - Notification logging

- **Organizations**
  - Multi-organization support
  - Organization CRUD with employee count validation

- **Dashboard**
  - Role-specific statistics
  - Pending leaves count
  - Recent leaves display
  - Leave balance overview

- **Setup Wizard**
  - Database connection testing
  - Admin account creation
  - System initialization

## Project Structure

```
hrms-backend/
├── package.json          # Dependencies and scripts
├── server.js             # Main entry point
├── .env.example          # Environment variables template
├── config/
│   ├── database.js       # MongoDB connection
│   └── config.js         # App configuration
├── middleware/
│   ├── auth.js           # JWT authentication
│   └── roleCheck.js      # Role-based access control
├── models/
│   └── schemas.js        # Joi validation schemas
├── routes/
│   ├── auth.js           # Authentication endpoints
│   ├── employees.js      # Employee management
│   ├── leaves.js         # Leave management
│   ├── organizations.js  # Organization management
│   ├── dashboard.js      # Dashboard statistics
│   ├── payroll.js        # Payroll & salary
│   ├── setup.js          # Setup wizard
│   └── notifications.js  # Notification settings
├── services/
│   ├── emailService.js   # Mailjet integration
│   └── whatsappService.js # Twilio WhatsApp
└── utils/
    ├── helpers.js        # Utility functions
    └── emailTemplates.js # HTML email templates
```

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```
4. Start the server:
   ```bash
   npm start
   # or for development
   npm run dev
   ```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| HOST | Server host | 0.0.0.0 |
| PORT | Server port | 8000 |
| MONGO_URL | MongoDB connection string | mongodb://localhost:27017 |
| DB_NAME | Database name | hrms_production |
| JWT_SECRET_KEY | JWT signing secret | (required) |
| CORS_ORIGINS | Allowed CORS origins | * |
| MAILJET_API_KEY | Mailjet API key | (optional) |
| MAILJET_API_SECRET | Mailjet API secret | (optional) |
| MAILJET_FROM_EMAIL | From email address | (optional) |
| TWILIO_ACCOUNT_SID | Twilio account SID | (optional) |
| TWILIO_AUTH_TOKEN | Twilio auth token | (optional) |
| TWILIO_PHONE_NUMBER | Twilio phone number | (optional) |

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Employees
- `GET /api/employees` - List all employees
- `POST /api/employees` - Create employee
- `PUT /api/employees/:id` - Update employee
- `DELETE /api/employees/:id` - Delete employee
- `PUT /api/employees/:id/role` - Update role
- `PUT /api/employees/:id/leave-balance` - Adjust leave balance

### Leaves
- `POST /api/leaves` - Apply for leave
- `GET /api/leaves/my-leaves` - Get my leaves
- `GET /api/leaves/pending` - Get pending leaves
- `GET /api/leaves/all` - Get all leaves (admin)
- `PUT /api/leaves/:id/action` - Approve/reject leave
- `PUT /api/leaves/:id` - Edit leave (admin)
- `DELETE /api/leaves/:id` - Delete leave (admin)
- `GET /api/leaves/calendar/:employeeId` - Get calendar view

### Leave Policy
- `GET /api/leave-policy` - Get leave policy
- `POST /api/leave-policy` - Save leave policy
- `POST /api/leave-policy/apply-to-employee/:id` - Apply to employee
- `POST /api/leave-policy/apply-to-all` - Apply to all

### Organizations
- `GET /api/organizations` - List organizations
- `POST /api/organizations` - Create organization
- `PUT /api/organizations/:id` - Update organization
- `DELETE /api/organizations/:id` - Delete organization

### Payroll
- `GET /api/salary-template` - Get salary template
- `POST /api/salary-template` - Save salary template
- `GET /api/salary-structure/:employeeId` - Get salary structure
- `POST /api/salary-structure/:employeeId` - Save salary structure
- `POST /api/payroll/send-salary-slip` - Send basic salary slip
- `POST /api/payroll/send-detailed-salary-slip` - Send detailed salary slip
- `GET /api/payroll/employee-report/:employeeId/:month` - Get employee report
- `GET /api/payroll/monthly-summary/:month` - Get monthly summary

### Comp-Off
- `POST /api/comp-off/grant` - Grant comp-off
- `GET /api/comp-off/records` - Get comp-off records

### Dashboard
- `GET /api/dashboard/stats` - Get dashboard statistics

### Setup
- `GET /api/setup/status` - Check setup status
- `POST /api/setup/test-connection` - Test database connection
- `POST /api/setup/configure` - Complete setup

### Notifications
- `GET /api/notification-settings` - Get notification settings
- `POST /api/notification-settings` - Save notification settings

### Health Check
- `GET /health` - Server health status
- `GET /` - API info

## License

MIT
