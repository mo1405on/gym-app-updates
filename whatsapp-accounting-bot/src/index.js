import 'dotenv/config';
import auth from './auth.js';
import commands from './commands.js';
import { parseMessage } from './parser.js';
import { startBot } from './whatsapp.js';

const seeded = auth.seedAdminsFromEnv();
if (seeded.length === 0) {
  console.warn('⚠️ لم يتم ضبط ADMIN_NUMBERS في .env — لن يستطيع أي أحد استخدام البوت حتى تضيف رقم أدمن.');
} else {
  console.log('أدمن مصرّح لهم:', seeded.join(', '));
}

async function onMessage(senderJid, text) {
  return commands.handleIncoming(senderJid, text, parseMessage);
}

startBot(onMessage).catch((err) => {
  console.error('فشل تشغيل البوت:', err);
  process.exit(1);
});
