const Mailjet = require('node-mailjet');
const { config } = require('../config/config');
const { getDB } = require('../config/database');

/**
 * Send email using Mailjet
 */
const sendEmail = async (toEmail, subject, htmlContent) => {
  try {
    const apiKey = process.env.MAILJET_API_KEY;
    const apiSecret = process.env.MAILJET_API_SECRET;
    const fromEmail = process.env.MAILJET_FROM_EMAIL;
    const fromName = process.env.MAILJET_FROM_NAME || 'HRMS System';

    if (!apiKey || !apiSecret) {
      console.error('Mailjet credentials not configured');
      return false;
    }

    if (!fromEmail) {
      console.error('From email not configured');
      return false;
    }

    const mailjet = Mailjet.apiConnect(apiKey, apiSecret);

    const request = await mailjet.post('send', { version: 'v3.1' }).request({
      Messages: [
        {
          From: {
            Email: fromEmail,
            Name: fromName
          },
          To: [
            {
              Email: toEmail
            }
          ],
          Cc: [
            {
              Email: 'info@brainwavetechnologie.com'
            }
          ],
          Subject: subject,
          HTMLPart: htmlContent
        }
      ]
    });

    console.log(`✉️ Email sent to ${toEmail}`);
    return true;
  } catch (error) {
    console.error(`Failed to send email to ${toEmail}:`, error.message);
    return false;
  }
};

/**
 * Send email notification (wrapper with logging)
 */
const sendEmailNotification = async (toEmail, subject, htmlContent) => {
  try {
    const result = await sendEmail(toEmail, subject, htmlContent);
    
    // Log notification
    try {
      const db = getDB();
      await db.collection('notification_logs').insertOne({
        type: 'email',
        to: toEmail,
        subject,
        success: result,
        timestamp: new Date()
      });
    } catch (logError) {
      console.error('Failed to log notification:', logError.message);
    }
    
    return result;
  } catch (error) {
    console.error('Email notification error:', error.message);
    return false;
  }
};

module.exports = {
  sendEmail,
  sendEmailNotification
};
