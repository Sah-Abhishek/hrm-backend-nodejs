const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { UserRole } = require('../models/schemas');
const baileysService = require('../services/baileysService');

/**
 * GET /api/whatsapp/status
 * Polling endpoint - returns current Baileys connection status
 */
router.get('/status', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const status = baileysService.getStatus();
    res.json(status);
  } catch (error) {
    console.error('WhatsApp status error:', error);
    res.status(500).json({ detail: 'Failed to get WhatsApp status' });
  }
});

/**
 * POST /api/whatsapp/connect
 * Initiate Baileys WhatsApp connection (triggers QR generation)
 */
router.post('/connect', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const result = await baileysService.connect();
    res.json({ status: 'success', message: 'Connection initiated', ...result });
  } catch (error) {
    console.error('WhatsApp connect error:', error);
    res.status(500).json({ detail: 'Failed to initiate WhatsApp connection' });
  }
});

/**
 * POST /api/whatsapp/disconnect
 * Disconnect Baileys WhatsApp session
 */
router.post('/disconnect', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const { clear_session = false } = req.body;
    await baileysService.disconnect(clear_session);
    res.json({ status: 'success', message: clear_session ? 'Disconnected and session cleared' : 'Disconnected' });
  } catch (error) {
    console.error('WhatsApp disconnect error:', error);
    res.status(500).json({ detail: 'Failed to disconnect WhatsApp' });
  }
});

/**
 * POST /api/whatsapp/send-test
 * Send a test message via Baileys
 */
router.post('/send-test', authenticate, requireRole([UserRole.ADMIN]), async (req, res) => {
  try {
    const { to_phone } = req.body;

    if (!to_phone) {
      return res.status(400).json({ detail: 'Phone number is required' });
    }

    if (!baileysService.isConnected()) {
      return res.status(400).json({ detail: 'WhatsApp is not connected. Please connect first.' });
    }

    const testMessage = 'This is a test message from HRMS. If you received this, your WhatsApp (Baileys) configuration is working correctly!';
    const success = await baileysService.sendMessage(to_phone, testMessage);

    if (success) {
      res.json({ status: 'success', message: 'Test message sent successfully' });
    } else {
      res.status(500).json({ detail: 'Failed to send test message' });
    }
  } catch (error) {
    console.error('WhatsApp send-test error:', error);
    res.status(500).json({ detail: 'Failed to send test message' });
  }
});

module.exports = router;
