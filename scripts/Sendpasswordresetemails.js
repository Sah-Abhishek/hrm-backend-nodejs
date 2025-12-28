#!/usr/bin/env node

/**
 * Script to send password reset emails to all employees
 * 
 * Usage:
 *   node scripts/sendPasswordResetEmails.js                    # Send to all employees
 *   node scripts/sendPasswordResetEmails.js --email user@example.com  # Send to specific email
 *   node scripts/sendPasswordResetEmails.js --department Engineering  # Send to department
 *   node scripts/sendPasswordResetEmails.js --dry-run          # Preview without sending
 */

require('dotenv').config();
const crypto = require('crypto');
const { MongoClient } = require('mongodb');
const Mailjet = require('node-mailjet');

// Configuration
const TOKEN_EXPIRY_HOURS = 24;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const DELAY_BETWEEN_EMAILS_MS = 1000; // 1 second delay to avoid rate limiting

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  email: null,
  department: null,
  dryRun: false,
  help: false
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--email':
      options.email = args[++i];
      break;
    case '--department':
      options.department = args[++i];
      break;
    case '--dry-run':
      options.dryRun = true;
      break;
    case '--help':
    case '-h':
      options.help = true;
      break;
  }
}

if (options.help) {
  console.log(`
Password Reset Email Sender
============================

Usage:
  node sendPasswordResetEmails.js [options]

Options:
  --email <email>        Send to specific employee email
  --department <name>    Send to all employees in a department
  --dry-run              Preview emails without actually sending
  --help, -h             Show this help message

Examples:
  node sendPasswordResetEmails.js                           # Send to all employees
  node sendPasswordResetEmails.js --email john@example.com  # Send to specific user
  node sendPasswordResetEmails.js --department Engineering  # Send to department
  node sendPasswordResetEmails.js --dry-run                 # Preview mode
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
 * Generate password reset email HTML
 */
function generatePasswordResetEmail(fullName, resetUrl, expiryHours) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 40px 30px; border-radius: 16px 16px 0 0; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">HRMS</h1>
          <p style="color: #94a3b8; margin: 10px 0 0; font-size: 14px;">Password Reset Required</p>
        </div>
        
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
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); 
                      color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 50px; 
                      font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(30, 41, 59, 0.3);">
              Set New Password
            </a>
          </div>
          
          <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 25px 0;">
            <p style="color: #92400e; font-size: 14px; margin: 0; line-height: 1.5;">
              <strong>⚠️ Important:</strong> This is a <strong>one-time use link</strong> and will expire in <strong>${expiryHours} hours</strong>.
            </p>
          </div>
          
          <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
            If the button doesn't work, copy and paste this link:
          </p>
          <p style="background: #f8fafc; padding: 12px; border-radius: 6px; word-break: break-all; 
                    font-size: 12px; color: #475569; margin: 10px 0;">
            ${resetUrl}
          </p>
        </div>
        
        <div style="background: #f8fafc; padding: 25px 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 16px 16px; text-align: center;">
          <p style="color: #94a3b8; font-size: 12px; margin: 0;">
            This is an automated message from HRMS. Please do not reply.
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
 * Main function
 */
async function main() {
  console.log('\n🔐 HRMS Password Reset Email Sender\n');
  console.log('='.repeat(50));

  // Check environment variables
  const requiredEnvVars = ['MONGO_URL', 'MAILJET_API_KEY', 'MAILJET_API_SECRET', 'MAILJET_FROM_EMAIL'];
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);

  if (missingVars.length > 0 && !options.dryRun) {
    console.error(`\n❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Please check your .env file.\n');
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('\n🔍 DRY RUN MODE - No emails will be sent\n');
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
    if (options.email) {
      query.email = options.email.toLowerCase();
    }
    if (options.department) {
      query.department = options.department;
    }

    // Fetch employees
    const employees = await db.collection('employees')
      .find(query, { projection: { full_name: 1, email: 1, employee_id: 1, department: 1 } })
      .toArray();

    if (employees.length === 0) {
      console.log('⚠️ No employees found matching the criteria.\n');
      return;
    }

    console.log(`📧 Found ${employees.length} employee(s) to send password reset emails:\n`);

    // Preview employees
    employees.forEach((emp, idx) => {
      console.log(`  ${idx + 1}. ${emp.full_name} <${emp.email}> - ${emp.department || 'N/A'}`);
    });
    console.log('');

    if (options.dryRun) {
      console.log('🔍 Dry run complete. No emails were sent.\n');
      return;
    }

    // Confirm before sending
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const confirm = await new Promise(resolve => {
      rl.question(`\n⚠️ Send password reset emails to ${employees.length} employee(s)? (yes/no): `, answer => {
        rl.close();
        resolve(answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y');
      });
    });

    if (!confirm) {
      console.log('\n❌ Cancelled by user.\n');
      return;
    }

    console.log('\n📤 Sending emails...\n');

    // Statistics
    const stats = {
      success: 0,
      failed: 0,
      errors: []
    };

    // Send emails
    for (let i = 0; i < employees.length; i++) {
      const employee = employees[i];
      const progress = `[${i + 1}/${employees.length}]`;

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
          triggered_by: 'bulk_script'
        });

        // Generate reset URL and email
        const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
        const emailHtml = generatePasswordResetEmail(employee.full_name, resetUrl, TOKEN_EXPIRY_HOURS);

        // Send email
        await sendEmail(employee.email, 'Password Reset Required - HRMS', emailHtml);

        // Log success
        await db.collection('password_reset_logs').insertOne({
          email: employee.email,
          employee_id: employee.employee_id,
          action: 'bulk_reset_sent',
          triggered_by: 'bulk_script',
          email_sent: true,
          timestamp: new Date()
        });

        console.log(`  ${progress} ✅ ${employee.full_name} <${employee.email}>`);
        stats.success++;

        // Delay between emails
        if (i < employees.length - 1) {
          await sleep(DELAY_BETWEEN_EMAILS_MS);
        }
      } catch (error) {
        console.log(`  ${progress} ❌ ${employee.full_name} <${employee.email}> - ${error.message}`);
        stats.failed++;
        stats.errors.push({ email: employee.email, error: error.message });

        // Log failure
        await db.collection('password_reset_logs').insertOne({
          email: employee.email,
          employee_id: employee.employee_id,
          action: 'bulk_reset_failed',
          triggered_by: 'bulk_script',
          email_sent: false,
          error: error.message,
          timestamp: new Date()
        });
      }
    }

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('📊 Summary:');
    console.log(`  ✅ Successful: ${stats.success}`);
    console.log(`  ❌ Failed: ${stats.failed}`);
    console.log(`  📧 Total: ${employees.length}`);

    if (stats.errors.length > 0) {
      console.log('\n❌ Failed emails:');
      stats.errors.forEach(err => {
        console.log(`  - ${err.email}: ${err.error}`);
      });
    }

    console.log('\n✅ Done!\n');
  } finally {
    await client.close();
  }
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
