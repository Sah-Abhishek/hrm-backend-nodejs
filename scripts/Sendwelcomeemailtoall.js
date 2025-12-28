#!/usr/bin/env node

/**
 * Script to send Welcome emails with password setup links to all employees
 * 
 * Usage:
 *   node scripts/sendWelcomeEmailToAll.js                    # Send to all employees
 *   node scripts/sendWelcomeEmailToAll.js --department Engineering  # Send to department
 *   node scripts/sendWelcomeEmailToAll.js --organization "Brainwave Technologie"  # Send to org
 *   node scripts/sendWelcomeEmailToAll.js --dry-run          # Preview without sending
 */

require('dotenv').config();
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const Mailjet = require('node-mailjet');
const readline = require('readline');

// Configuration
const TOKEN_EXPIRY_HOURS = 24;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const DELAY_BETWEEN_EMAILS_MS = 1000; // 1 second delay to avoid rate limiting

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  department: null,
  organization: null,
  role: null,
  dryRun: false,
  help: false,
  skipConfirmation: false
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--department':
      options.department = args[++i];
      break;
    case '--organization':
    case '--org':
      options.organization = args[++i];
      break;
    case '--role':
      options.role = args[++i];
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--yes':
    case '-y':
      options.skipConfirmation = true;
      break;
    case '--help':
    case '-h':
      options.help = true;
      break;
  }
}

if (options.help) {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║      Bulk Welcome Email Sender (All Employees)             ║
╚════════════════════════════════════════════════════════════╝

Usage:
  node sendWelcomeEmailToAll.js [options]

Options:
  --department <name>    Send only to employees in this department
  --organization <name>  Send only to employees in this organization
  --org <name>           Alias for --organization
  --role <role>          Send only to employees with this role (employee/manager/admin)
  --dry-run              Preview emails without actually sending
  --yes, -y              Skip confirmation prompt
  --help, -h             Show this help message

Examples:
  node sendWelcomeEmailToAll.js                              # Send to ALL employees
  node sendWelcomeEmailToAll.js --dry-run                    # Preview mode
  node sendWelcomeEmailToAll.js --department Engineering     # Only Engineering dept
  node sendWelcomeEmailToAll.js --org "Brainwave Technologie" # Only this org
  node sendWelcomeEmailToAll.js --role employee              # Only employees (not managers/admins)
  node sendWelcomeEmailToAll.js --department IT --dry-run    # Preview IT department
  `);
  process.exit(0);
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
    throw new Error('Mailjet credentials not configured');
  }

  if (!fromEmail) {
    throw new Error('From email not configured');
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
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ask for confirmation
 */
async function askConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
    });
  });
}

/**
 * Main function
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║      🎉 Bulk Welcome Email Sender (All Employees)          ║
╚════════════════════════════════════════════════════════════╝
`);

  if (options.dryRun) {
    console.log('🔍 DRY RUN MODE - No emails will be sent\n');
  }

  // Show filters
  if (options.department || options.organization || options.role) {
    console.log('📋 Filters applied:');
    if (options.department) console.log(`   Department: ${options.department}`);
    if (options.organization) console.log(`   Organization: ${options.organization}`);
    if (options.role) console.log(`   Role: ${options.role}`);
    console.log('');
  }

  // Check environment variables
  const requiredEnvVars = ['MONGO_URL', 'MAILJET_API_KEY', 'MAILJET_API_SECRET', 'MAILJET_FROM_EMAIL'];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0 && !options.dryRun) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file.\n');
    process.exit(1);
  }

  // Connect to MongoDB
  const mongoUrl = process.env.MONGO_URL;
  const dbName = process.env.DB_NAME || 'hrms';

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
    // Build query
    const query = {};
    if (options.department) {
      query.department = options.department;
    }
    if (options.organization) {
      query.organization_name = options.organization;
    }
    if (options.role) {
      query.role = options.role;
    }

    // Fetch employees
    const employees = await db.collection('employees')
      .find(query, {
        projection: {
          full_name: 1,
          email: 1,
          employee_id: 1,
          department: 1,
          designation: 1,
          organization_name: 1,
          role: 1
        }
      })
      .toArray();

    if (employees.length === 0) {
      console.log('⚠️  No employees found matching the criteria.\n');
      return;
    }

    // Display employees
    console.log(`📧 Found ${employees.length} employee(s) to send welcome emails:\n`);
    console.log('┌─────────────────────────────────────────────────────────────────────────────────');
    console.log('│ #   │ Employee ID │ Name                    │ Email                           │ Dept');
    console.log('├─────────────────────────────────────────────────────────────────────────────────');

    employees.forEach((emp, idx) => {
      const num = String(idx + 1).padEnd(3);
      const id = (emp.employee_id || 'N/A').padEnd(11);
      const name = (emp.full_name || 'N/A').substring(0, 23).padEnd(23);
      const email = (emp.email || 'N/A').substring(0, 33).padEnd(33);
      const dept = (emp.department || 'N/A').substring(0, 15);
      console.log(`│ ${num} │ ${id} │ ${name} │ ${email} │ ${dept}`);
    });

    console.log('└─────────────────────────────────────────────────────────────────────────────────\n');

    if (options.dryRun) {
      console.log('🔍 Dry run complete. No emails were sent.\n');
      console.log('💡 Remove --dry-run flag to send emails.\n');
      return;
    }

    // Confirm before sending
    if (!options.skipConfirmation) {
      const confirm = await askConfirmation(
        `\n⚠️  Send welcome emails to ${employees.length} employee(s)? (yes/no): `
      );

      if (!confirm) {
        console.log('\n❌ Cancelled by user.\n');
        return;
      }
    }

    console.log('\n📤 Sending welcome emails...\n');

    // Statistics
    const stats = {
      success: 0,
      failed: 0,
      errors: []
    };

    // Progress bar helper
    const showProgress = (current, total, email, status) => {
      const percent = Math.round((current / total) * 100);
      const filled = Math.round(percent / 5);
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
      const statusIcon = status === 'success' ? '✅' : '❌';
      console.log(`  [${bar}] ${percent}% (${current}/${total}) ${statusIcon} ${email}`);
    };

    // Send emails
    for (let i = 0; i < employees.length; i++) {
      const employee = employees[i];

      try {
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
          triggered_by: 'bulk_welcome_script',
          type: 'welcome'
        });

        // Generate reset URL and email
        const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
        const emailHtml = generateWelcomeEmailWithPasswordSetup(employee, resetUrl, TOKEN_EXPIRY_HOURS);
        const subject = `Welcome to ${employee.organization_name || 'Our Organization'}! Set Up Your Password`;

        // Send email
        await sendEmail(employee.email, subject, emailHtml);

        // Log success
        await db.collection('password_reset_logs').insertOne({
          email: employee.email,
          employee_id: employee.employee_id,
          action: 'bulk_welcome_email_sent',
          triggered_by: 'bulk_welcome_script',
          email_sent: true,
          timestamp: new Date()
        });

        showProgress(i + 1, employees.length, employee.email, 'success');
        stats.success++;

        // Delay between emails
        if (i < employees.length - 1) {
          await sleep(DELAY_BETWEEN_EMAILS_MS);
        }
      } catch (error) {
        showProgress(i + 1, employees.length, employee.email, 'failed');
        stats.failed++;
        stats.errors.push({
          employee_id: employee.employee_id,
          email: employee.email,
          error: error.message
        });

        // Log failure
        await db.collection('password_reset_logs').insertOne({
          email: employee.email,
          employee_id: employee.employee_id,
          action: 'bulk_welcome_email_failed',
          triggered_by: 'bulk_welcome_script',
          email_sent: false,
          error: error.message,
          timestamp: new Date()
        });
      }
    }

    // Summary
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                      📊 SUMMARY                            ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║  ✅ Successful:  ${String(stats.success).padEnd(40)}║`);
    console.log(`║  ❌ Failed:      ${String(stats.failed).padEnd(40)}║`);
    console.log(`║  📧 Total:       ${String(employees.length).padEnd(40)}║`);
    console.log('╚════════════════════════════════════════════════════════════╝');

    if (stats.errors.length > 0) {
      console.log('\n❌ Failed emails:');
      console.log('─────────────────────────────────────────────────────────────');
      stats.errors.forEach(err => {
        console.log(`  ${err.employee_id} - ${err.email}`);
        console.log(`    Error: ${err.error}`);
      });
    }

    if (stats.success > 0) {
      console.log('\n🎉 Welcome emails sent successfully!');
      console.log('⏰ Password setup links will expire in 24 hours.\n');
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
