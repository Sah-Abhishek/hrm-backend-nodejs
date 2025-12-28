#!/usr/bin/env node

/**
 * Script to send password reset email to a specific employee by Employee ID
 * 
 * Usage:
 *   node scripts/sendResetToEmployee.js EMP0009
 *   node scripts/sendResetToEmployee.js EMP0005 --dry-run
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

if (!employeeId) {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       Password Reset Email Sender (Single Employee)        ║
╚════════════════════════════════════════════════════════════╝

Usage:
  node sendResetToEmployee.js <EMPLOYEE_ID> [options]

Arguments:
  EMPLOYEE_ID    The employee ID (e.g., EMP0009, EMP0005)

Options:
  --dry-run      Preview without sending email

Examples:
  node sendResetToEmployee.js EMP0009
  node sendResetToEmployee.js EMP0005 --dry-run
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
          <p style="color: #94a3b8; margin: 10px 0 0; font-size: 14px;">Password Reset Request</p>
        </div>
        
        <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #334155; font-size: 18px; line-height: 1.6; margin: 0 0 20px;">
            Hi <strong>${fullName}</strong>,
          </p>
          
          <p style="color: #475569; font-size: 16px; line-height: 1.6; margin: 0 0 25px;">
            We received a request to reset your password. Click the button below to create a new password:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" 
               style="display: inline-block; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); 
                      color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 50px; 
                      font-size: 16px; font-weight: 600; box-shadow: 0 4px 14px rgba(30, 41, 59, 0.3);">
              Reset My Password
            </a>
          </div>
          
          <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 16px; margin: 25px 0;">
            <p style="color: #92400e; font-size: 14px; margin: 0; line-height: 1.5;">
              <strong>⚠️ Important:</strong> This is a <strong>one-time use link</strong> and will expire in <strong>${expiryHours} hours</strong>. 
              After you reset your password, this link will no longer work.
            </p>
          </div>
          
          <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin: 20px 0 0;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="background: #f8fafc; padding: 12px; border-radius: 6px; word-break: break-all; 
                    font-size: 12px; color: #475569; margin: 10px 0;">
            ${resetUrl}
          </p>
          
          <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 25px 0 0;">
            <p style="color: #64748b; font-size: 13px; margin: 0; line-height: 1.5;">
              🔒 <strong>Security Notice:</strong> If you didn't request this password reset, you can safely ignore this email.
            </p>
          </div>
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
 * Main function
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║       Password Reset Email Sender (Single Employee)        ║
╚════════════════════════════════════════════════════════════╝
`);

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No email will be sent\n');
  }

  console.log(`🔎 Looking for employee: ${employeeId}\n`);

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
    // Find employee by employee_id
    const employee = await db.collection('employees').findOne(
      { employee_id: employeeId.toUpperCase() },
      { projection: { full_name: 1, email: 1, employee_id: 1, department: 1, designation: 1 } }
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

    // Display employee info
    console.log('┌─────────────────────────────────────────────────────────');
    console.log('│ Employee Found');
    console.log('├─────────────────────────────────────────────────────────');
    console.log(`│ ID:          ${employee.employee_id}`);
    console.log(`│ Name:        ${employee.full_name}`);
    console.log(`│ Email:       ${employee.email}`);
    console.log(`│ Department:  ${employee.department || 'N/A'}`);
    console.log(`│ Designation: ${employee.designation || 'N/A'}`);
    console.log('└─────────────────────────────────────────────────────────\n');

    if (dryRun) {
      // Generate preview URL
      const previewToken = 'preview-token-xxxxx';
      const previewUrl = `${FRONTEND_URL}/reset-password?token=${previewToken}`;

      console.log('📧 Email Preview:');
      console.log('─────────────────────────────────────────────────────────');
      console.log(`To:      ${employee.email}`);
      console.log(`Subject: Password Reset Request - HRMS`);
      console.log(`Reset URL: ${previewUrl}`);
      console.log(`Expires in: ${TOKEN_EXPIRY_HOURS} hours`);
      console.log('─────────────────────────────────────────────────────────\n');
      console.log('🔍 Dry run complete. No email was sent.\n');
      return;
    }

    // Generate reset token
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    // Invalidate existing tokens
    const invalidated = await db.collection('password_reset_tokens').updateMany(
      { email: employee.email, used: false },
      { $set: { used: true, invalidated_at: new Date() } }
    );

    if (invalidated.modifiedCount > 0) {
      console.log(`⚠️  Invalidated ${invalidated.modifiedCount} existing token(s)\n`);
    }

    // Store new token
    await db.collection('password_reset_tokens').insertOne({
      token: resetToken,
      email: employee.email,
      employee_id: employee.employee_id,
      full_name: employee.full_name,
      created_at: new Date(),
      expires_at: expiresAt,
      used: false,
      triggered_by: 'manual_script'
    });

    console.log('✅ Reset token generated');
    console.log(`   Expires: ${expiresAt.toLocaleString()}\n`);

    // Generate reset URL and email
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${resetToken}`;
    const emailHtml = generatePasswordResetEmail(employee.full_name, resetUrl, TOKEN_EXPIRY_HOURS);

    console.log('📤 Sending email...\n');

    // Send email
    await sendEmail(employee.email, 'Password Reset Request - HRMS', emailHtml);

    // Log the action
    await db.collection('password_reset_logs').insertOne({
      email: employee.email,
      employee_id: employee.employee_id,
      action: 'manual_reset_sent',
      triggered_by: 'manual_script',
      email_sent: true,
      timestamp: new Date()
    });

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    ✅ EMAIL SENT!                          ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log(`║ To:      ${employee.email.padEnd(47)}║`);
    console.log(`║ Name:    ${employee.full_name.padEnd(47)}║`);
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║ Reset URL (for testing):                                   ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log(`\n🔗 ${resetUrl}\n`);
    console.log('💡 The employee can click the link in their email or use the URL above.\n');

  } finally {
    await client.close();
  }
}

// Run the script
main().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
