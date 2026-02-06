const twilio = require('twilio');
const { getDB } = require('../config/database');
const baileysService = require('./baileysService');

/**
 * Send WhatsApp message via Twilio
 */
const sendViaTwilio = async (toPhone, message, settings) => {
  const twilioSid = settings.twilio_account_sid;
  const twilioToken = settings.twilio_auth_token;
  const twilioNumber = settings.twilio_phone_number;

  if (!twilioSid || !twilioToken || !twilioNumber) {
    console.warn('Twilio credentials not configured');
    return false;
  }

  const client = twilio(twilioSid, twilioToken);

  const result = await client.messages.create({
    body: message,
    from: `whatsapp:${twilioNumber}`,
    to: `whatsapp:${toPhone}`
  });

  console.log(`WhatsApp (Twilio) sent to ${toPhone}: ${result.sid}`);

  // Log notification
  try {
    const db = getDB();
    await db.collection('notification_logs').insertOne({
      type: 'whatsapp_twilio',
      to: toPhone,
      message_sid: result.sid,
      success: true,
      timestamp: new Date()
    });
  } catch (logError) {
    console.error('Failed to log notification:', logError.message);
  }

  return true;
};

/**
 * Send WhatsApp message via Baileys
 */
const sendViaBaileys = async (toPhone, message) => {
  return await baileysService.sendMessage(toPhone, message);
};

/**
 * Send WhatsApp notification - routes to correct provider
 */
const sendWhatsAppNotification = async (toPhone, message) => {
  try {
    const db = getDB();

    // Get settings from database
    const settings = await db.collection('notification_settings').findOne({});

    if (!settings || !settings.whatsapp_enabled) {
      console.log('WhatsApp notifications disabled');
      return false;
    }

    const provider = settings.whatsapp_provider || 'twilio';

    if (provider === 'baileys') {
      return await sendViaBaileys(toPhone, message);
    } else {
      return await sendViaTwilio(toPhone, message, settings);
    }
  } catch (error) {
    console.error(`Failed to send WhatsApp to ${toPhone}:`, error.message);
    return false;
  }
};

/**
 * Check if WhatsApp should be sent for a given notification type
 * @param {string} notificationType - e.g. 'leave_applied', 'leave_approved'
 * @returns {boolean}
 */
const shouldSendWhatsApp = async (notificationType) => {
  try {
    const db = getDB();
    const settings = await db.collection('notification_settings').findOne({});

    if (!settings || !settings.whatsapp_enabled) {
      return false;
    }

    const allowedTypes = settings.whatsapp_notification_types || [];

    // If no types configured, allow all (backward compatibility)
    if (allowedTypes.length === 0) {
      return true;
    }

    return allowedTypes.includes(notificationType);
  } catch (error) {
    console.error('Failed to check WhatsApp notification type:', error.message);
    return false;
  }
};

module.exports = {
  sendWhatsAppNotification,
  shouldSendWhatsApp
};
