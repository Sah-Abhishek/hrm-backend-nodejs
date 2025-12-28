const twilio = require('twilio');
const { getDB } = require('../config/database');

/**
 * Send WhatsApp message using Twilio
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

    console.log(`📱 WhatsApp sent to ${toPhone}: ${result.sid}`);

    // Log notification
    try {
      await db.collection('notification_logs').insertOne({
        type: 'whatsapp',
        to: toPhone,
        message_sid: result.sid,
        success: true,
        timestamp: new Date()
      });
    } catch (logError) {
      console.error('Failed to log notification:', logError.message);
    }

    return true;
  } catch (error) {
    console.error(`Failed to send WhatsApp to ${toPhone}:`, error.message);
    return false;
  }
};

module.exports = {
  sendWhatsAppNotification
};
