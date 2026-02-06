const { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrTerminal = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

const AUTH_DIR = path.join(__dirname, 'whatsapp-auth');

async function start() {
  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const logger = pino({ level: 'silent' });

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: Browsers.macOS('Chrome'),
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\nScan this QR code with WhatsApp:\n');
      qrTerminal.generate(qr, { small: true });
    }

    if (connection === 'open') {
      const phone = sock.user?.id?.split(':')[0] || 'unknown';
      console.log(`\n✅ Connected successfully! Phone: ${phone}\n`);
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`Connection closed. Code: ${statusCode}. Reconnecting: ${shouldReconnect}`);

      if (shouldReconnect) {
        start();
      } else {
        console.log('Logged out. Clearing session...');
        if (fs.existsSync(AUTH_DIR)) {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        }
        process.exit(0);
      }
    }
  });
}

console.log('Starting Baileys test — scan the QR code when it appears:\n');
start().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
