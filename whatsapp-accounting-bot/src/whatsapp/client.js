const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const pino = require('pino');

async function connectWhatsApp({ authDir, onMessage, logLevel = 'silent' }) {
  const logger = pino({ level: logLevel });
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('امسح رمز QR التالي من واتساب > الأجهزة المرتبطة:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('تم إغلاق الاتصال.', shouldReconnect ? 'إعادة المحاولة...' : 'تم تسجيل الخروج.');
      if (shouldReconnect) connectWhatsApp({ authDir, onMessage, logLevel });
    } else if (connection === 'open') {
      console.log('✅ تم الاتصال بواتساب بنجاح.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      const chatId = msg.key.remoteJid;
      const fromNumber = msg.key.participant || msg.key.remoteJid;
      const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        '';
      if (!text) continue;

      try {
        const reply = await onMessage({ chatId, fromNumber, text });
        if (reply) await sock.sendMessage(chatId, { text: reply });
      } catch (err) {
        console.error('خطأ أثناء معالجة الرسالة:', err);
        await sock.sendMessage(chatId, { text: '⚠️ حدث خطأ غير متوقع أثناء تنفيذ الأمر.' });
      }
    }
  });

  return sock;
}

module.exports = { connectWhatsApp };
