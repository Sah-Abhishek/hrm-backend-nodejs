const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../config/database');

const AUTH_DIR = path.join(__dirname, '..', 'whatsapp-auth');

// Baileys requires a pino logger — silent level to avoid noisy output
const logger = pino({ level: 'silent' });

let sock = null;
let connectionStatus = 'disconnected'; // disconnected | qr_ready | connecting | connected
let currentQR = null;
let connectedPhone = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Format phone number for WhatsApp JID
 * Strips non-digits, prepends 91 if 10 digits (India)
 */
const formatPhoneForWhatsApp = (phone) => {
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) {
    digits = '91' + digits;
  }
  return digits + '@s.whatsapp.net';
};

/**
 * Initialize and connect Baileys WhatsApp socket
 */
const connect = async () => {
  // If already connected, no-op
  if (sock && connectionStatus === 'connected') {
    return { status: 'already_connected' };
  }

  // If a previous socket exists but isn't connected, clean it up
  if (sock) {
    try { sock.end(); } catch (_) {}
    sock = null;
  }

  try {
    connectionStatus = 'connecting';
    currentQR = null;

    // Ensure auth directory exists
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    sock = makeWASocket({
      auth: state,
      logger,
      browser: Browsers.macOS('Chrome'),
      // Required by Baileys 6.x — return undefined if no store
      getMessage: async () => undefined,
    });

    // Handle credentials update — MUST be saved for session persistence
    sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          currentQR = await QRCode.toDataURL(qr);
          connectionStatus = 'qr_ready';
          console.log('[Baileys] QR code generated — waiting for scan');
        } catch (err) {
          console.error('[Baileys] QR generation error:', err.message);
        }
      }

      if (connection === 'open') {
        connectionStatus = 'connected';
        currentQR = null;
        reconnectAttempts = 0; // Reset on successful connection
        connectedPhone = sock.user?.id?.split(':')[0] || null;
        console.log(`[Baileys] Connected as ${connectedPhone}`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`[Baileys] Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);

        connectionStatus = 'disconnected';
        currentQR = null;
        const oldSock = sock;
        sock = null;

        // Clean up the old socket
        try { oldSock?.end(); } catch (_) {}

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(2000 * reconnectAttempts, 30000); // 2s, 4s, 6s, 8s, 10s max 30s
          console.log(`[Baileys] Reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay / 1000}s...`);

          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            connect().catch(err => console.error('[Baileys] Reconnect failed:', err.message));
          }, delay);
        } else if (shouldReconnect) {
          console.error(`[Baileys] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up. Use the UI to reconnect.`);
          connectionStatus = 'disconnected';
        } else {
          // Logged out — clear session so next connect shows fresh QR
          connectedPhone = null;
          clearAuthFolder();
        }
      }
    });

    return { status: 'connecting' };
  } catch (error) {
    connectionStatus = 'disconnected';
    console.error('[Baileys] Connect error:', error.message);
    throw error;
  }
};

/**
 * Disconnect WhatsApp session
 * @param {boolean} clearSession - If true, deletes auth folder so QR is needed again
 */
const disconnect = async (clearSession = false) => {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS; // Prevent auto-reconnect during intentional disconnect

  if (sock) {
    if (clearSession) {
      try { await sock.logout(); } catch (_) {}
    }
    try { sock.end(); } catch (_) {}
    sock = null;
  }

  connectionStatus = 'disconnected';
  currentQR = null;
  reconnectAttempts = 0; // Reset for future manual connects

  if (clearSession) {
    connectedPhone = null;
    clearAuthFolder();
  }
};

/**
 * Remove auth folder to force fresh QR scan
 */
const clearAuthFolder = () => {
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
      console.log('[Baileys] Auth folder cleared');
    }
  } catch (err) {
    console.error('[Baileys] Failed to clear auth folder:', err.message);
  }
};

/**
 * Send a WhatsApp message via Baileys
 */
const sendMessage = async (phone, text) => {
  if (!sock || connectionStatus !== 'connected') {
    console.warn(`[Baileys] Not connected (status: ${connectionStatus}), cannot send message to ${phone}`);
    return false;
  }

  try {
    const jid = formatPhoneForWhatsApp(phone);
    await sock.sendMessage(jid, { text });
    console.log(`[Baileys] Message sent to ${phone}`);

    // Log to DB
    try {
      const db = getDB();
      await db.collection('notification_logs').insertOne({
        type: 'whatsapp_baileys',
        to: phone,
        jid,
        success: true,
        timestamp: new Date()
      });
    } catch (logErr) {
      console.error('[Baileys] Failed to log notification:', logErr.message);
    }

    return true;
  } catch (error) {
    console.error(`[Baileys] Failed to send to ${phone}:`, error.message);
    return false;
  }
};

/**
 * Get current connection status
 */
const getStatus = () => ({
  status: connectionStatus,
  qr: currentQR,
  phone: connectedPhone
});

/**
 * Check if connected
 */
const isConnected = () => connectionStatus === 'connected';

/**
 * Auto-connect if a saved session exists (called on server startup)
 */
const autoConnect = () => {
  const credsPath = path.join(AUTH_DIR, 'creds.json');
  if (fs.existsSync(credsPath)) {
    console.log('[Baileys] Saved session found — auto-connecting...');
    connect().catch(err => console.error('[Baileys] Auto-connect failed:', err.message));
  } else {
    console.log('[Baileys] No saved session — skipping auto-connect');
  }
};

// Auto-connect when this module is first loaded
autoConnect();

module.exports = {
  connect,
  disconnect,
  sendMessage,
  getStatus,
  isConnected,
  formatPhoneForWhatsApp
};
