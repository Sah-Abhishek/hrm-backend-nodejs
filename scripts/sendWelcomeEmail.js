#!/usr/bin/env node

/**
 * Script to send Welcome email with password setup link to new employees
 * 
 * Usage:
 *   node scripts/sendWelcomeEmail.js EMP0009
 *   node scripts/sendWelcomeEmail.js EMP0005 --dry-run
 *   node scripts/sendWelcomeEmail.js --all
 *   node scripts/sendWelcomeEmail.js --all --dry-run
 */

require('dotenv').config();
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const Mailjet = require('node-mailjet');

// Configuration
const TOKEN_EXPIRY_HOURS = 24;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// Parse command line arguments
const args = process.argv.slice(2);
const employeeId = args.find(arg => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const sendToAll = args.includes('--all');

if (!employeeId && !sendToAll) {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         Welcome Email Sender (New Employee Onboarding)     ║
╚════════════════════════════════════════════════════════════╝

Usage:
  node sendWelcomeEmail.js <EMPLOYEE_ID> [options]
  node sendWelcomeEmail.js --all [options]

Arguments:
  EMPLOYEE_ID    The employee ID (e.g., EMP0009, EMP0005)

Options:
  --all          Send welcome email to ALL employees
  --dry-run      Preview without sending email

Examples:
  node sendWelcomeEmail.js EMP0009
  node sendWelcomeEmail.js EMP0005 --dry-run
  node sendWelcomeEmail.js --all
  node sendWelcomeEmail.js --all --dry-run
  `);
  process.exit(1);
}

/**
 * Generate a secure random token
 */
function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate welcome email HTML with password setup link
 */
function generateWelcomeEmailWithPasswordSetup(employee, resetUrl, expiryHours) {
  const { full_name, employee_id, email, department, designation, organization_name } = employee;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 50px 30px; border-radius: 16px 16px 0 0; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 15px;">🎉</div>
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">Welcome to ${organization_name || 'Our Organization'}!</h1>
          <p style="color: #94a3b8; margin: 15px 0 0; font-size: 16px;">We're excited to have you on board</p>
        </div>
        
        <!-- Content -->
        <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e2e8f0; border-top: none;">
          
          <p style="color: #334155; font-size: 18px; line-height: 1.6; margin: 0 0 20px;">
            Hi <strong>${full_name}</strong>,
          </p>
          
          <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
            Welcome to the team! Your employee account has been created and you're all set to get started.
          </p>
          
          <!-- Employee Details Card -->
          <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; padding: 20px; margin: 25px 0; border: 1px solid #e2e8f0;">
            <h3 style="color: #334155; font-size: 14px; font-weight: 600; margin: 0 0 15px; text-transform: uppercase; letter-spacing: 0.5px;">
              Your Details
            </h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 14px; width: 120px;">Employee ID</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${employee_id}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Email</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${email}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Department</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${department || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Designation</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${designation || 'N/A'}</td>
              </tr>
            </table>
          </div>
          
          <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 25px 0;">
            To get started, please set up your password by clicking the button below:
          </p>
          
          <!-- CTA Button -->
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); 
                      color: #ffffff; text-decoration: none; padding: 18px 50px; border-radius: 50px; 
                      font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(30, 41, 59, 0.3);
                      transition: transform 0.2s;">
              🔐 Set Up My Password
            </a>
          </div>
          
          <!-- Warning Box -->
          <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 12px; padding: 20px; margin: 30px 0;">
            <div style="display: flex; align-items: flex-start;">
              <span style="font-size: 20px; margin-right: 12px;">⚠️</span>
              <div>
                <p style="color: #92400e; font-size: 14px; font-weight: 600; margin: 0 0 5px;">Important - One Time Link</p>
                <p style="color: #a16207; font-size: 14px; margin: 0; line-height: 1.5;">
                  This link is for <strong>one-time use only</strong> and will <strong>expire in ${expiryHours} hours</strong>. 
                  Please set up your password as soon as possible.
                </p>
              </div>
            </div>
          </div>
          
          <!-- Link fallback -->
          <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="background: #f8fafc; padding: 14px; border-radius: 8px; word-break: break-all; 
                    font-size: 12px; color: #475569; margin: 10px 0; border: 1px solid #e2e8f0;">
            ${resetUrl}
          </p>
          
          <!-- What's Next Section -->
          <div style="background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 20px; margin: 30px 0 0;">
            <h3 style="color: #065f46; font-size: 14px; font-weight: 600; margin: 0 0 12px;">
              🚀 What's Next?
            </h3>
            <ul style="color: #047857; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
              <li>Set up your password using the link above</li>
              <li>Log in to the HRMS portal</li>
              <li>Complete your profile information</li>
              <li>Explore the dashboard and features</li>
            </ul>
          </div>
          
        </div>
        
        <!-- Footer -->
        <div style="background: #f8fafc; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; text-align: center;">
          <p style="color: #64748b; font-size: 14px; margin: 0 0 10px;">
            Need help? Contact your HR administrator or manager.
          </p>
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            This is an automated message from HRMS. Please do not reply.
          </p>
          <p style="color: #cbd5e1; font-size: 11px; margin: 15px 0 0;">
            © ${new Date().getFullYear()} ${organization_name || 'HRMS'}. All rights reserved.
          </p>
        </div>
        
      </div>
    </body>
    </html>
  `;
}

/**
 * Send email using Mailjet
 */
async function sendEmail(toEmail, subject, htmlContent) {
  const apiKey = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  const fromEmail = process.env.MAILJET_FROM_EMAIL;
  const fromName = process.env.MAILJET_FROM_NAME || 'HRMS System';

  if (!apiKey || !apiSecret) {
    throw new Error('Mailjet credentials not configured in .env');
  }

  if (!fromEmail) {
    throw new Error('MAILJET_FROM_EMAIL not configured in .env');
  }

  const mailjet = Mailjet.apiConnect(apiKey, apiSecret);

  await mailjet.post('send', { version: 'v3.1' }).request({
    Messages: [
      {
        From: {
          Email: fromEmail,
          Name: fromName
        },
        To: [{ Email: toEmail }],
        Subject: subject,
        HTMLPart: htmlContent
      }
    ]
  });
}

/**
 * Process a single employee - generate token and send email
 */
async function processEmployee(db, employee, dryRun) {
  const result = {
    employee_id: employee.employee_id,
    email: employee.email,
    full_name: employee.full_name,
    success: false,
    error: null
  };

  try {
    if (dryRun) {
      const previewToken = 'preview-token-xxxxx';
      const previewUrl = `${FRONTEND_URL}/reset-password?token=${previewToken}`;

      console.log(`   📧 ${employee.employee_id} - ${employee.full_name} <${employee.email}>`);
      console.log(`      Reset URL: ${previewUrl}`);

      result.success = true;
      return result;
    }

    // Generate reset token
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    // Invalidate existing tokens
    await db.collection('password_reset_tokens').updateMany(
      { email: employee.email, used: false },
      { $set: { used: true, invalidated_at: new Date() } }
    );

    // Store new token
    await db.collection('password_reset_tokens').insertOne({
      token: resetToken,
      email: employee.email,
      employee_id: employee.employee_id,
      full_name: employee.full_name,
      created_at: new Date(),
      expires_at: expiresAt,
      used: false,
      triggered_by: 'welcome_email_script',
      type: 'welcome'
    });

    // Generate reset URL and email
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
    const emailHtml = generateWelcomeEmailWithPasswordSetup(employee, resetUrl, TOKEN_EXPIRY_HOURS);
    const subject = `Welcome to ${employee.organization_name || 'Our Organization'}! Set Up Your Password`;

    // Send email
    await sendEmail(employee.email, subject, emailHtml);

    // Log the action
    await db.collection('password_reset_logs').insertOne({
      email: employee.email,
      employee_id: employee.employee_id,
      action: 'welcome_email_sent',
      triggered_by: 'welcome_email_script',
      email_sent: true,
      timestamp: new Date()
    });

    console.log(`   ✅ ${employee.employee_id} - ${employee.full_name} <${employee.email}>`);
    result.success = true;

  } catch (error) {
    console.log(`   ❌ ${employee.employee_id} - ${employee.full_name} <${employee.email}>`);
    console.log(`      Error: ${error.message}`);
    result.error = error.message;
  }

  return result;
}

/**
 * Main function
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         Welcome Email Sender (New Employee Onboarding)     ║
╚════════════════════════════════════════════════════════════╝
`);

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No emails will be sent\n');
  }

  if (sendToAll) {
    console.log('📨 Mode: Send to ALL employees\n');
  } else {
    console.log(`🔎 Looking for employee: ${employeeId}\n`);
  }

  // Connect to MongoDB
  const mongoUrl = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME || 'hrms';

  if (!mongoUrl) {
    console.error('❌ MONGO_URL not configured in .env');
    process.exit(1);
  }

  let client;
  try {
    client = new MongoClient(mongoUrl);
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error.message);
    process.exit(1);
  }

  const db = client.db(dbName);

  try {
    let employees = [];

    if (sendToAll) {
      // Fetch all employees
      employees = await db.collection('employees')
        .find({}, { projection: { full_name: 1, email: 1, employee_id: 1, department: 1, designation: 1, organization_name: 1 } })
        .toArray();

      if (employees.length === 0) {
        console.error('❌ No employees found in the database');
        process.exit(1);
      }

      console.log(`📋 Found ${employees.length} employee(s)\n`);
      console.log('┌─────────────────────────────────────────────────────────');
      console.log('│ Employees to process:');
      console.log('├─────────────────────────────────────────────────────────');
      employees.forEach((emp, idx) => {
        console.log(`│ ${idx + 1}. ${emp.employee_id} - ${emp.full_name} <${emp.email}>`);
      });
      console.log('└─────────────────────────────────────────────────────────\n');

    } else {
      // Find single employee by employee_id
      const employee = await db.collection('employees').findOne(
        { employee_id: employeeId.toUpperCase() },
        { projection: { full_name: 1, email: 1, employee_id: 1, department: 1, designation: 1, organization_name: 1 } }
      );

      if (!employee) {
        console.error(`❌ Employee not found: ${employeeId}`);
        console.log('\n💡 Tip: Make sure you\'re using the correct Employee ID (e.g., EMP0009)\n');

        // Show available employees
        const allEmployees = await db.collection('employees')
          .find({}, { projection: { employee_id: 1, full_name: 1, email: 1 } })
          .limit(10)
          .toArray();

        if (allEmployees.length > 0) {
          console.log('📋 Available employees:');
          allEmployees.forEach(emp => {
            console.log(`   ${emp.employee_id} - ${emp.full_name} <${emp.email}>`);
          });
          console.log('');
        }

        process.exit(1);
      }

      employees = [employee];

      // Display employee info
      console.log('┌─────────────────────────────────────────────────────────');
      console.log('│ 🎉 Employee Found');
      console.log('├─────────────────────────────────────────────────────────');
      console.log(`│ ID:           ${employee.employee_id}`);
      console.log(`│ Name:         ${employee.full_name}`);
      console.log(`│ Email:        ${employee.email}`);
      console.log(`│ Department:   ${employee.department || 'N/A'}`);
      console.log(`│ Designation:  ${employee.designation || 'N/A'}`);
      console.log(`│ Organization: ${employee.organization_name || 'N/A'}`);
      console.log('└─────────────────────────────────────────────────────────\n');
    }

    // Process employees
    console.log(dryRun ? '📧 Preview of emails to be sent:\n' : '📤 Sending welcome emails...\n');

    const results = [];
    for (const employee of employees) {
      const result = await processEmployee(db, employee, dryRun);
      results.push(result);

      // Add a small delay between emails to avoid rate limiting (only when actually sending)
      if (!dryRun && employees.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Summary
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    if (dryRun) {
      console.log('║                    📋 DRY RUN SUMMARY                      ║');
    } else {
      console.log('║                    📊 SENDING SUMMARY                      ║');
    }
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ Total Employees:    ${employees.length.toString().padEnd(36)}║`);
    console.log(`║ ✅ Successful:      ${successful.length.toString().padEnd(36)}║`);
    console.log(`║ ❌ Failed:          ${failed.length.toString().padEnd(36)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    if (failed.length > 0) {
      console.log('❌ Failed employees:');
      failed.forEach(f => {
        console.log(`   ${f.employee_id} - ${f.email}: ${f.error}`);
      });
      console.log('');
    }

    if (dryRun) {
      console.log('🔍 Dry run complete. No emails were sent.');
      console.log('💡 Remove --dry-run flag to send actual emails.\n');
    } else if (successful.length > 0) {
      console.log('💡 Employees can click the link in their email to set their password.');
      console.log('⏰ Links will expire in 24 hours.\n');
    }

  } finally {
    await client.close();
  }
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
