/**
 * Notification Routes
 * Endpoints for notification settings management
 */

const express = require('express');
const router = express.Router();
const { getDB } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');

/**
 * POST /api/notification-settings
 * Save notification settings (admin only)
 */
router.post('/notification-settings', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const db = getDB();
    const settings = req.body;

    const settingsDict = {
      email_enabled: settings.email_enabled || false,
      whatsapp_enabled: settings.whatsapp_enabled || false,
      smtp_host: settings.smtp_host || null,
      smtp_port: settings.smtp_port || 587,
      smtp_username: settings.smtp_username || null,
      smtp_password: settings.smtp_password || null,
      from_email: settings.from_email || null,
      from_name: settings.from_name || 'HRMS System',
      twilio_account_sid: settings.twilio_account_sid || null,
      twilio_auth_token: settings.twilio_auth_token || null,
      twilio_phone_number: settings.twilio_phone_number || null,
      updated_at: new Date().toISOString(),
      updated_by: req.user.email
    };

    // Upsert settings
    await db.collection('notification_settings').deleteMany({});
    await db.collection('notification_settings').insertOne(settingsDict);

    // Remove _id for response
    delete settingsDict._id;

    res.json({ status: 'success', message: 'Notification settings saved' });
  } catch (error) {
    console.error('Save notification settings error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * GET /api/notification-settings
 * Get current notification settings (admin/manager)
 */
router.get('/notification-settings', authenticate, requireRole([UserRole.ADMIN, UserRole.MANAGER]), async (req, res) => {
  try {
    const db = getDB();
    const settings = await db.collection('notification_settings').findOne(
      {},
      { projection: { _id: 0 } }
    );

    if (!settings) {
      // Return default settings
      return res.json({
        email_enabled: false,
        whatsapp_enabled: false,
        smtp_host: null,
        smtp_port: 587,
        smtp_username: null,
        smtp_password: null,
        from_email: null,
        from_name: 'HRMS System',
        twilio_account_sid: null,
        twilio_auth_token: null,
        twilio_phone_number: null
      });
    }

    res.json(settings);
  } catch (error) {
    console.error('Get notification settings error:', error);
    res.status(500).json({ detail: 'Internal server error' });
  }
});

/**
 * POST /api/notification-settings/test-email
 * Test email configuration
 */
router.post('/notification-settings/test-email', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const { to_email } = req.body;
    const { sendEmailNotification } = require('../services/emailService');

    const testHtml = `
      <html>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h2 style="color: #10b981; border-bottom: 3px solid #10b981; padding-bottom: 10px;">Test Email</h2>
          <p>This is a test email from HRMS.</p>
          <p>If you received this email, your email configuration is working correctly!</p>
          <p style="color: #64748b; font-size: 12px; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 15px;">
            This is an automated notification from HRMS Leave Management System.
          </p>
        </div>
      </body>
      </html>
    `;

    const success = await sendEmailNotification(to_email, 'HRMS Test Email', testHtml);

    if (success) {
      res.json({ status: 'success', message: 'Test email sent successfully' });
    } else {
      res.status(500).json({ detail: 'Failed to send test email' });
    }
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ detail: error.message });
  }
});

/**
 * POST /api/notification-settings/test-whatsapp
 * Test WhatsApp configuration
 */
router.post('/notification-settings/test-whatsapp', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const { to_phone } = req.body;
    const { sendWhatsAppNotification } = require('../services/whatsappService');

    const testMessage = 'This is a test message from HRMS. If you received this, your WhatsApp configuration is working correctly!';

    const success = await sendWhatsAppNotification(to_phone, testMessage);

    if (success) {
      res.json({ status: 'success', message: 'Test WhatsApp message sent successfully' });
    } else {
      res.status(500).json({ detail: 'Failed to send test WhatsApp message' });
    }
  } catch (error) {
    console.error('Test WhatsApp error:', error);
    res.status(500).json({ detail: error.message });
  }
});

module.exports = router;
