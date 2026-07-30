const config = require('./config');
const { openDatabase } = require('./db/database');
const { connectWhatsApp } = require('./whatsapp/client');
const { handleCommand } = require('./whatsapp/commandHandler');

async function main() {
  if (config.ownerNumbers.length === 0) {
    console.warn('⚠️ لم يتم تعيين OWNER_NUMBERS في ملف .env — لن يستطيع أي شخص استخدام البوت.');
  }

  const db = openDatabase(config.dbPath);

  await connectWhatsApp({
    authDir: config.authDir,
    onMessage: ({ chatId, fromNumber, text }) => handleCommand(db, config, { chatId, fromNumber, text }),
  });
}

main().catch((err) => {
  console.error('فشل تشغيل البوت:', err);
  process.exit(1);
});
