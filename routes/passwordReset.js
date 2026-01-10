const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDB } = require('../config/database');
const { hashPassword } = require('../utils/helpers');
const { sendEmailNotification } = require('../services/emailService');
const { generatePasswordResetEmail } = require('../utils/emailTemplates');

// Token expiry time (24 hours)
const TOKEN_EXPIRY_HOURS = 24;

/**
 * Generate a secure random token
 */
function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * POST /api/password-reset/request
 * Request password reset - sends email with reset link
 */
router.post('/request', async (req, res) => {
  try {
    const db = getDB();
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ detail: 'Email is required' });
    }

    // Find employee by email
    const employee = await db.collection('employees').findOne(
      { email: email.toLowerCase() },
      { projection: { _id: 0, full_name: 1, email: 1, employee_id: 1 } }
    );

    // Always return success to prevent email enumeration
    if (!employee) {
      console.log(`Password reset requested for non-existent email: ${email}`);
      return res.json({
        status: 'success',
        message: 'If an account with that email exists, a password reset link has been sent.'
      });
    }

    // Generate reset token
    const resetToken = generateResetToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    // Invalidate any existing tokens for this user
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
      used: false
    });

    // Build reset URL
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Send email
    const emailHtml = generatePasswordResetEmail(employee.full_name, resetUrl, TOKEN_EXPIRY_HOURS);
    const emailSent = await sendEmailNotification(
      employee.email,
      'Password Reset Request - HRMS',
      emailHtml
    );

    if (!emailSent) {
      console.error(`Failed to send password reset email to ${employee.email}`);
    }

    // Log the request
    await db.collection('password_reset_logs').insertOne({
      email: employee.email,
      employee_id: employee.employee_id,
      action: 'requested',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      email_sent: emailSent,
      timestamp: new Date()
    });

    res.json({
      status: 'success',
      message: 'If an account with that email exists, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * GET /api/password-reset/validate/:token
 * Validate reset token and return user info
 */
router.get('/validate/:token', async (req, res) => {
  try {
    const db = getDB();
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ detail: 'Token is required' });
    }

    // Find token
    const tokenDoc = await db.collection('password_reset_tokens').findOne({
      token,
      used: false
    });

    if (!tokenDoc) {
      return res.status(400).json({
        detail: 'Invalid or expired reset link',
        code: 'INVALID_TOKEN'
      });
    }

    // Check if token is expired
    if (new Date() > new Date(tokenDoc.expires_at)) {
      return res.status(400).json({
        detail: 'This reset link has expired. Please request a new one.',
        code: 'TOKEN_EXPIRED'
      });
    }

    res.json({
      status: 'valid',
      full_name: tokenDoc.full_name,
      email: tokenDoc.email,
      expires_at: tokenDoc.expires_at
    });
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/password-reset/reset
 * Reset password using token
 */
router.post('/reset', async (req, res) => {
  try {
    const db = getDB();
    const { token, new_password } = req.body;

    if (!token) {
      return res.status(400).json({ detail: 'Token is required' });
    }

    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ detail: 'Password must be at least 6 characters' });
    }

    // Find and validate token
    const tokenDoc = await db.collection('password_reset_tokens').findOne({
      token,
      used: false
    });

    if (!tokenDoc) {
      return res.status(400).json({
        detail: 'Invalid or expired reset link',
        code: 'INVALID_TOKEN'
      });
    }

    // Check if token is expired
    if (new Date() > new Date(tokenDoc.expires_at)) {
      return res.status(400).json({
        detail: 'This reset link has expired. Please request a new one.',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Hash new password
    const hashedPassword = await hashPassword(new_password);

    // Update user password
    await db.collection('users').updateOne(
      { email: tokenDoc.email },
      {
        $set: {
          hashed_password: hashedPassword,
          password_updated_at: new Date()
        }
      }
    );

    // Mark token as used
    await db.collection('password_reset_tokens').updateOne(
      { token },
      {
        $set: {
          used: true,
          used_at: new Date()
        }
      }
    );

    // Log the reset
    await db.collection('password_reset_logs').insertOne({
      email: tokenDoc.email,
      employee_id: tokenDoc.employee_id,
      action: 'reset_completed',
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      timestamp: new Date()
    });

    // Send confirmation email
    try {
      const confirmationHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #1e293b 0%, #334155 100%); padding: 30px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #020202; margin: 0; font-size: 24px;">Password Changed Successfully</h1>
          </div>
          <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
              Hi ${tokenDoc.full_name},
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
              Your password has been successfully changed. You can now log in with your new password.
            </p>
            <p style="color: #64748b; font-size: 14px; line-height: 1.6; margin-top: 20px;">
              If you did not make this change, please contact your administrator immediately.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">
            <p style="color: #94a3b8; font-size: 12px;">
              This is an automated message from HRMS. Please do not reply.
            </p>
          </div>
        </div>
      `;
      await sendEmailNotification(tokenDoc.email, 'Password Changed - HRMS', confirmationHtml);
    } catch (emailError) {
      console.error('Failed to send password change confirmation:', emailError);
    }

    res.json({
      status: 'success',
      message: 'Password has been reset successfully. You can now log in with your new password.'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

module.exports = router;
