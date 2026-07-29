import baileys, { DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

const makeWASocket = baileys.default;
const AUTH_DIR = process.env.AUTH_DIR || './data/auth';
const ALLOWED_GROUP_JID = process.env.ALLOWED_GROUP_JID || null;

const logger = pino({ level: process.env.LOG_LEVEL || 'silent' });

function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  );
}

export async function startBot(onMessage) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
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
      console.log('\nامسح رمز QR التالي من واتساب (الأجهزة المرتبطة ← ربط جهاز):\n');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('تم قطع الاتصال.', statusCode, shouldReconnect ? '— إعادة المحاولة...' : '— تم تسجيل الخروج، احذف مجلد data/auth وأعد التشغيل.');
      if (shouldReconnect) startBot(onMessage);
    } else if (connection === 'open') {
      console.log('✅ تم الاتصال بواتساب بنجاح.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      const isGroup = remoteJid?.endsWith('@g.us');
      if (isGroup && remoteJid !== ALLOWED_GROUP_JID) continue;
      if (remoteJid === 'status@broadcast') continue;

      const senderJid = isGroup ? msg.key.participant : remoteJid;
      const text = extractText(msg.message).trim();
      if (!text) continue;

      try {
        const reply = await onMessage(senderJid, text);
        if (reply) await sock.sendMessage(remoteJid, { text: reply });
      } catch (err) {
        console.error('خطأ أثناء معالجة الرسالة:', err);
        await sock.sendMessage(remoteJid, { text: '⚠️ حدث خطأ غير متوقع أثناء معالجة الطلب.' });
      }
    }
  });

  return sock;
}

export default { startBot };
