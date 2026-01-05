const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const { faker } = require('@faker-js/faker');
require('dotenv').config();

// Configuration
const CONFIG = {
  MONGO_URL: process.env.MONGO_URL || 'mongodb://localhost:27017',
  DB_NAME: process.env.DB_NAME || 'hrms',
  MONTHS_OF_HISTORY: 3
};

// Enums
const UserRole = { ADMIN: 'admin', MANAGER: 'manager', EMPLOYEE: 'employee' };
const LeaveStatus = { PENDING: 'pending', MANAGER_APPROVED: 'manager_approved', APPROVED: 'approved', REJECTED: 'rejected' };
const AttendanceStatus = { PRESENT: 'present', ABSENT: 'absent', HALF_DAY: 'half-day', LEAVE: 'leave' };
const ReimbursementStatus = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', CLEARED: 'cleared' };
const ReimbursementCategory = { TRAVEL: 'Travel', FOOD_MEALS: 'Food & Meals', ACCOMMODATION: 'Accommodation', OFFICE_SUPPLIES: 'Office Supplies', EQUIPMENT: 'Equipment', SOFTWARE_TOOLS: 'Software & Tools', TRAINING_COURSES: 'Training & Courses', MEDICAL: 'Medical', COMMUNICATION: 'Communication', OTHER: 'Other' };

const DEPARTMENTS = ['Engineering', 'Human Resources', 'Finance', 'Marketing', 'Sales'];
const DESIGNATIONS = {
  Engineering: ['Software Engineer', 'Senior Software Engineer', 'Tech Lead'],
  'Human Resources': ['HR Executive', 'HR Manager'],
  Finance: ['Accountant', 'Financial Analyst'],
  Marketing: ['Marketing Executive', 'Marketing Manager'],
  Sales: ['Sales Executive', 'Sales Manager']
};

class HRMSSeeder {
  constructor() {
    this.client = null;
    this.db = null;
    this.organizations = [];
    this.users = [];
    this.employees = [];
  }

  async connect() {
    console.log('🔌 Connecting to MongoDB...');
    this.client = new MongoClient(CONFIG.MONGO_URL);
    await this.client.connect();
    this.db = this.client.db(CONFIG.DB_NAME);
    console.log(`✅ Connected to database: ${CONFIG.DB_NAME}`);
  }

  async clearDatabase() {
    console.log('🧹 Clearing existing data...');
    const collections = [
      'users',
      'employees',
      'organizations',
      'holidays',
      'leave_balances',
      'leave_policies',
      'leave_adjustments',
      'reimbursements',
      'salary_structures',
      'salary_templates',
      'comp_off_records',
      'comp_off_requests',
      'notification_settings',
      'notification_logs',
      'employee_id_settings',
      'password_reset_logs',
      'password_reset_tokens',
      'settings',
      'attendance'
    ];
    for (const col of collections) {
      try {
        await this.db.collection(col).deleteMany({});
      } catch (e) {
        // Collection might not exist
      }
    }
    console.log('✅ Database cleared');
  }

  async seedOrganizations() {
    console.log('🏢 Creating organizations...');
    this.organizations = [
      {
        _id: new ObjectId(),
        name: 'TechCorp Solutions Pvt. Ltd.',
        logo_url: '',
        description: 'A leading technology solutions company',
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        _id: new ObjectId(),
        name: 'InnoSoft Technologies',
        logo_url: '',
        description: 'Innovation driven software company',
        created_at: new Date(),
        updated_at: new Date()
      }
    ];
    await this.db.collection('organizations').insertMany(this.organizations);
    console.log(`✅ Created ${this.organizations.length} organizations`);
  }

  async seedEmployeeIdSettings() {
    console.log('🔢 Setting up employee ID configuration...');
    const settings = this.organizations.map(org => ({
      _id: new ObjectId(),
      organization_id: org._id.toString(),
      prefix: 'EMP',
      counter: 1000,
      created_at: new Date(),
      updated_at: new Date()
    }));
    await this.db.collection('employee_id_settings').insertMany(settings);
    console.log('✅ Employee ID settings created');
  }

  async seedSettings() {
    console.log('⚙️ Creating settings...');
    const settings = this.organizations.map(org => ({
      _id: new ObjectId(),
      organization_id: org._id.toString(),
      created_at: new Date(),
      updated_at: new Date()
    }));
    await this.db.collection('settings').insertMany(settings);
    console.log('✅ Settings created');
  }

  async seedLeavePolicies() {
    console.log('📋 Creating leave policies...');
    const policies = this.organizations.map(org => ({
      _id: new ObjectId(),
      organization_id: org._id.toString(),
      policies: [
        { leave_type: 'Sick Leave', annual_quota: 12, order: 1 },
        { leave_type: 'Casual Leave', annual_quota: 12, order: 2 },
        { leave_type: 'Paid Leave', annual_quota: 15, order: 3 },
        { leave_type: 'Unpaid Leave', annual_quota: 0, order: 4 },
        { leave_type: 'Comp Off', annual_quota: 0, order: 5 }
      ],
      created_at: new Date(),
      updated_at: new Date()
    }));
    await this.db.collection('leave_policies').insertMany(policies);
    console.log('✅ Leave policies created');
  }

  async seedSalaryTemplates() {
    console.log('💰 Creating salary templates...');
    const templates = this.organizations.map(org => ({
      _id: new ObjectId(),
      organization_id: org._id.toString(),
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
      ],
      created_at: new Date(),
      updated_at: new Date()
    }));
    await this.db.collection('salary_templates').insertMany(templates);
    console.log('✅ Salary templates created');
  }

  async seedNotificationSettings() {
    console.log('🔔 Creating notification settings...');
    const settings = this.organizations.map(org => ({
      _id: new ObjectId(),
      organization_id: org._id.toString(),
      email_enabled: false,
      whatsapp_enabled: false,
      smtp_host: '',
      smtp_port: 587,
      smtp_username: '',
      smtp_password: '',
      from_email: '',
      from_name: 'HRMS System',
      twilio_account_sid: '',
      twilio_auth_token: '',
      twilio_phone_number: '',
      created_at: new Date(),
      updated_at: new Date()
    }));
    await this.db.collection('notification_settings').insertMany(settings);
    console.log('✅ Notification settings created');
  }

  getBaseSalary(role) {
    const salaries = { admin: 100000, manager: 75000, employee: 45000 };
    return salaries[role] + faker.number.int({ min: -10000, max: 20000 });
  }

  async seedUsersAndEmployees() {
    console.log('👥 Creating users and employees...');

    const hashedPassword = bcrypt.hashSync('password123', 10);
    const hashedAdminPassword = bcrypt.hashSync('admin123', 10);

    let employeeCounter = 1001;

    // For each organization
    for (let orgIndex = 0; orgIndex < this.organizations.length; orgIndex++) {
      const org = this.organizations[orgIndex];
      const orgPrefix = orgIndex === 0 ? 'techcorp' : 'innosoft';

      // Create Admin for each org
      const adminUserId = new ObjectId();
      const adminEmployeeId = new ObjectId();

      this.users.push({
        _id: adminUserId,
        email: `admin@${orgPrefix}.com`,
        hashed_password: hashedAdminPassword,
        role: UserRole.ADMIN,
        organization_id: org._id.toString(),
        employee_id: adminEmployeeId.toString(),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      this.employees.push({
        _id: adminEmployeeId,
        user_id: adminUserId.toString(),
        employee_code: `EMP${employeeCounter++}`,
        full_name: orgIndex === 0 ? 'Admin TechCorp' : 'Admin InnoSoft',
        email: `admin@${orgPrefix}.com`,
        phone: faker.phone.number('+91 ##########'),
        department: 'Human Resources',
        designation: 'HR Admin',
        organization_id: org._id.toString(),
        manager_id: null,
        joining_date: new Date('2022-01-01'),
        monthly_salary: 120000,
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      // Create 1 Manager per org
      const managerUserId = new ObjectId();
      const managerEmployeeId = new ObjectId();
      const managerFirstName = faker.person.firstName();
      const managerLastName = faker.person.lastName();
      const managerEmail = `${managerFirstName.toLowerCase()}.${managerLastName.toLowerCase()}@${orgPrefix}.com`;

      this.users.push({
        _id: managerUserId,
        email: managerEmail,
        hashed_password: hashedPassword,
        role: UserRole.MANAGER,
        organization_id: org._id.toString(),
        employee_id: managerEmployeeId.toString(),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      this.employees.push({
        _id: managerEmployeeId,
        user_id: managerUserId.toString(),
        employee_code: `EMP${employeeCounter++}`,
        full_name: `${managerFirstName} ${managerLastName}`,
        email: managerEmail,
        phone: faker.phone.number('+91 ##########'),
        department: 'Engineering',
        designation: 'Engineering Manager',
        organization_id: org._id.toString(),
        manager_id: adminEmployeeId.toString(),
        joining_date: faker.date.past({ years: 2 }),
        monthly_salary: this.getBaseSalary('manager'),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      // Create 3 regular employees per org
      for (let i = 0; i < 3; i++) {
        const userId = new ObjectId();
        const employeeId = new ObjectId();
        const firstName = faker.person.firstName();
        const lastName = faker.person.lastName();
        const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${orgPrefix}.com`;
        const dept = faker.helpers.arrayElement(DEPARTMENTS);
        const designation = faker.helpers.arrayElement(DESIGNATIONS[dept]);

        this.users.push({
          _id: userId,
          email: email,
          hashed_password: hashedPassword,
          role: UserRole.EMPLOYEE,
          organization_id: org._id.toString(),
          employee_id: employeeId.toString(),
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        });

        this.employees.push({
          _id: employeeId,
          user_id: userId.toString(),
          employee_code: `EMP${employeeCounter++}`,
          full_name: `${firstName} ${lastName}`,
          email: email,
          phone: faker.phone.number('+91 ##########'),
          department: dept,
          designation: designation,
          organization_id: org._id.toString(),
          manager_id: managerEmployeeId.toString(),
          joining_date: faker.date.past({ years: 1 }),
          monthly_salary: this.getBaseSalary('employee'),
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }

    await this.db.collection('users').insertMany(this.users);
    await this.db.collection('employees').insertMany(this.employees);
    console.log(`✅ Created ${this.users.length} users and ${this.employees.length} employees`);
  }

  async seedLeaveBalances() {
    console.log('🏖️ Creating leave balances...');
    const balances = this.employees.map(emp => ({
      _id: new ObjectId(),
      employee_id: emp._id.toString(),
      user_id: emp.user_id,
      organization_id: emp.organization_id,
      sick_leave: faker.number.int({ min: 6, max: 12 }),
      casual_leave: faker.number.int({ min: 6, max: 12 }),
      paid_leave: faker.number.int({ min: 8, max: 15 }),
      unpaid_leave: 0,
      comp_off: faker.number.int({ min: 0, max: 3 }),
      created_at: new Date(),
      updated_at: new Date()
    }));
    await this.db.collection('leave_balances').insertMany(balances);
    console.log(`✅ Created ${balances.length} leave balances`);
  }

  async seedSalaryStructures() {
    console.log('💵 Creating salary structures...');
    const structures = this.employees.map(emp => {
      const basic = Math.round(emp.monthly_salary * 0.4);
      return {
        _id: new ObjectId(),
        employee_id: emp._id.toString(),
        user_id: emp.user_id,
        organization_id: emp.organization_id,
        basic_salary: basic,
        components: [
          { name: 'Basic', amount: basic, type: 'earning', is_percentage: false },
          { name: 'Dearness Allowance', amount: Math.round(basic * 0.1), type: 'earning', is_percentage: true, calculation_base: 'basic' },
          { name: 'House Rent Allowance', amount: Math.round(basic * 0.4), type: 'earning', is_percentage: true, calculation_base: 'basic' },
          { name: 'Conveyance Allowance', amount: 1600, type: 'earning', is_percentage: false },
          { name: 'Medical Allowance', amount: 1250, type: 'earning', is_percentage: false },
          { name: 'Special Allowance', amount: Math.round(emp.monthly_salary * 0.2), type: 'earning', is_percentage: false },
          { name: 'Professional Tax', amount: 200, type: 'deduction', is_percentage: false },
          { name: 'EPF', amount: Math.round(basic * 0.12), type: 'deduction', is_percentage: true, calculation_base: 'basic' }
        ],
        created_at: new Date(),
        updated_at: new Date()
      };
    });
    await this.db.collection('salary_structures').insertMany(structures);
    console.log(`✅ Created ${structures.length} salary structures`);
  }

  async seedHolidays() {
    console.log('🎉 Creating holidays...');
    const year = new Date().getFullYear();
    const holidayList = [
      { name: 'New Year', date: new Date(`${year}-01-01`), type: 'public' },
      { name: 'Republic Day', date: new Date(`${year}-01-26`), type: 'public' },
      { name: 'Holi', date: new Date(`${year}-03-14`), type: 'public' },
      { name: 'Independence Day', date: new Date(`${year}-08-15`), type: 'public' },
      { name: 'Gandhi Jayanti', date: new Date(`${year}-10-02`), type: 'public' },
      { name: 'Diwali', date: new Date(`${year}-11-01`), type: 'public' },
      { name: 'Christmas', date: new Date(`${year}-12-25`), type: 'public' }
    ];

    const holidays = [];
    for (const org of this.organizations) {
      for (const h of holidayList) {
        holidays.push({
          _id: new ObjectId(),
          organization_id: org._id.toString(),
          name: h.name,
          date: h.date,
          type: h.type,
          description: `${h.name} holiday`,
          created_at: new Date(),
          updated_at: new Date()
        });
      }
    }
    await this.db.collection('holidays').insertMany(holidays);
    console.log(`✅ Created ${holidays.length} holidays`);
  }

  async seedReimbursements() {
    console.log('🧾 Creating reimbursements...');
    const reimbursements = [];
    const categories = Object.values(ReimbursementCategory);
    const statuses = Object.values(ReimbursementStatus);

    // Get non-admin employees
    const regularEmployees = this.employees.filter(e =>
      !this.users.find(u => u.employee_id === e._id.toString() && u.role === 'admin')
    );

    for (const emp of regularEmployees) {
      if (Math.random() > 0.5) continue;

      reimbursements.push({
        _id: new ObjectId(),
        employee_id: emp._id.toString(),
        user_id: emp.user_id,
        organization_id: emp.organization_id,
        title: faker.helpers.arrayElement(['Cab fare', 'Team lunch', 'Office supplies', 'Software license']),
        category: faker.helpers.arrayElement(categories),
        amount: faker.number.int({ min: 500, max: 5000 }),
        description: faker.lorem.sentence(),
        expense_date: faker.date.recent({ days: 30 }),
        status: faker.helpers.arrayElement(statuses),
        remarks: null,
        created_at: faker.date.recent({ days: 45 }),
        updated_at: new Date()
      });
    }

    if (reimbursements.length > 0) {
      await this.db.collection('reimbursements').insertMany(reimbursements);
    }
    console.log(`✅ Created ${reimbursements.length} reimbursements`);
  }

  async seedCompOffRecords() {
    console.log('🔄 Creating comp-off records...');
    const records = [];

    const regularEmployees = this.employees.filter(e =>
      !this.users.find(u => u.employee_id === e._id.toString() && u.role === 'admin')
    );

    for (const emp of regularEmployees) {
      if (Math.random() > 0.3) continue;

      records.push({
        _id: new ObjectId(),
        employee_id: emp._id.toString(),
        user_id: emp.user_id,
        organization_id: emp.organization_id,
        days: faker.helpers.arrayElement([0.5, 1, 1, 2]),
        work_date: faker.date.recent({ days: 60 }),
        reason: faker.helpers.arrayElement([
          'Worked on Saturday for release',
          'Weekend support duty',
          'Production deployment'
        ]),
        is_used: false,
        created_at: faker.date.recent({ days: 70 }),
        updated_at: new Date()
      });
    }

    if (records.length > 0) {
      await this.db.collection('comp_off_records').insertMany(records);
    }
    console.log(`✅ Created ${records.length} comp-off records`);
  }

  async seedLeaveAdjustments() {
    console.log('📝 Creating leave adjustments...');
    const adjustments = [];

    for (const emp of this.employees.slice(0, 4)) {
      adjustments.push({
        _id: new ObjectId(),
        employee_id: emp._id.toString(),
        user_id: emp.user_id,
        organization_id: emp.organization_id,
        leave_type: faker.helpers.arrayElement(['Sick Leave', 'Casual Leave', 'Paid Leave']),
        adjustment_type: faker.helpers.arrayElement(['add', 'deduct']),
        days: faker.number.int({ min: 1, max: 3 }),
        reason: faker.helpers.arrayElement([
          'Annual leave credit',
          'Policy adjustment',
          'Leave encashment'
        ]),
        adjusted_by: this.users.find(u => u.role === 'admin')._id.toString(),
        created_at: faker.date.recent({ days: 90 }),
        updated_at: new Date()
      });
    }

    if (adjustments.length > 0) {
      await this.db.collection('leave_adjustments').insertMany(adjustments);
    }
    console.log(`✅ Created ${adjustments.length} leave adjustments`);
  }

  async createIndexes() {
    console.log('📇 Creating indexes...');
    await this.db.collection('users').createIndex({ email: 1 }, { unique: true });
    await this.db.collection('users').createIndex({ organization_id: 1 });
    await this.db.collection('employees').createIndex({ email: 1 });
    await this.db.collection('employees').createIndex({ organization_id: 1 });
    await this.db.collection('employees').createIndex({ user_id: 1 });
    await this.db.collection('leave_balances').createIndex({ employee_id: 1 });
    await this.db.collection('holidays').createIndex({ organization_id: 1, date: 1 });
    console.log('✅ Indexes created');
  }

  printSummary() {
    console.log('\n' + '='.repeat(70));
    console.log('🎉 SEEDING COMPLETE!');
    console.log('='.repeat(70));

    console.log('\n📧 TEST CREDENTIALS:');
    console.log('-'.repeat(70));

    for (let i = 0; i < this.organizations.length; i++) {
      const org = this.organizations[i];
      const orgUsers = this.users.filter(u => u.organization_id === org._id.toString());
      const orgEmployees = this.employees.filter(e => e.organization_id === org._id.toString());

      console.log(`\n🏢 ${org.name}`);
      console.log(`   Organization ID: ${org._id.toString()}`);

      for (const user of orgUsers) {
        const emp = orgEmployees.find(e => e._id.toString() === user.employee_id);
        const password = user.role === 'admin' ? 'admin123' : 'password123';
        console.log(`   [${user.role.toUpperCase()}] ${emp?.full_name || 'N/A'}`);
        console.log(`      Email: ${user.email}`);
        console.log(`      Password: ${password}`);
      }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`Database: ${CONFIG.DB_NAME}`);
    console.log(`Total Organizations: ${this.organizations.length}`);
    console.log(`Total Users: ${this.users.length}`);
    console.log(`Total Employees: ${this.employees.length}`);
    console.log('='.repeat(70) + '\n');
  }

  async run() {
    try {
      await this.connect();
      await this.clearDatabase();
      await this.seedOrganizations();
      await this.seedEmployeeIdSettings();
      await this.seedSettings();
      await this.seedLeavePolicies();
      await this.seedSalaryTemplates();
      await this.seedNotificationSettings();
      await this.seedUsersAndEmployees();
      await this.seedLeaveBalances();
      await this.seedSalaryStructures();
      await this.seedHolidays();
      await this.seedReimbursements();
      await this.seedCompOffRecords();
      await this.seedLeaveAdjustments();
      await this.createIndexes();
      this.printSummary();
    } catch (error) {
      console.error('❌ Seeding failed:', error);
      throw error;
    } finally {
      if (this.client) {
        await this.client.close();
        console.log('🔌 Database connection closed');
      }
    }
  }
}

const seeder = new HRMSSeeder();
seeder.run().catch(console.error);
