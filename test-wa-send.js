const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, 'whatsapp-auth');
const PHONE = process.argv[2];

if (!PHONE) {
  console.log('Usage: node test-wa-send.js <phone_number>');
  console.log('Example: node test-wa-send.js 9142483627');
  process.exit(1);
}

// Format phone to JID
let digits = PHONE.replace(/\D/g, '');
if (digits.length === 10) digits = '91' + digits;
const jid = digits + '@s.whatsapp.net';

async function start() {
  if (!fs.existsSync(AUTH_DIR)) {
    console.error('No whatsapp-auth/ folder found. Run test-baileys.js first to link your WhatsApp.');
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.macOS('Chrome'),
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      console.log(`Connected as ${sock.user?.id?.split(':')[0]}`);
      console.log(`Sending message to ${digits} (${jid})...\n`);

      try {
        await sock.sendMessage(jid, {
          text: '✅ HRMS Test Notification\n\nThis is a test WhatsApp message from HRMS.\nIf you received this, Baileys is working correctly!'
        });
        console.log('Message sent successfully!');
      } catch (err) {
        console.error('Failed to send:', err.message);
      }

      // Wait a bit for message to deliver, then exit
      setTimeout(() => {
        sock.end();
        process.exit(0);
      }, 2000);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        start(); // reconnect
      } else {
        console.error('Session logged out. Re-link with test-baileys.js');
        process.exit(1);
      }
    }
  });
}

start().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
