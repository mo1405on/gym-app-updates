const { parseCommand } = require('../nlu/parser');
const ledger = require('../accounting/ledger');
const { buildSummaryReport, buildAccountStatement } = require('../reports/reportBuilder');
const { getRole, can } = require('../auth/accessControl');
const session = require('../session/sessionManager');

const HELP_TEXT = `📋 *الأوامر المتاحة*

قبض <مبلغ> <تصنيف> [نقدي/بنك] [ملاحظة: ...]
صرف <مبلغ> <تصنيف> [نقدي/بنك] [ملاحظة: ...]
تحويل <مبلغ> من <حساب> الى <حساب>
رصيد [اسم الحساب]
الحسابات
إضافة حساب <اسم> <اصل/التزام/حقوق ملكية/ايراد/مصروف>
تقرير اليوم | تقرير الاسبوع | تقرير الشهر
كشف حساب <اسم> [من YYYY-MM-DD الى YYYY-MM-DD]
حذف اخر قيد
الغاء قيد #<رقم>

أمثلة:
قبض 500 اشتراكات نقدي
صرف 200 كهرباء بنك ملاحظة: فاتورة يوليو`;

function formatEntryReply(kindLabel, result, extra) {
  return `✅ تم تسجيل ${kindLabel}\nرقم القيد: #${result.entryNumber}\nالتاريخ: ${result.date}\n${extra || ''}`.trim();
}

function logAudit(db, { fromNumber, rawText, parsedType, entryId, result }) {
  db.prepare(
    `INSERT INTO audit_log (from_number, raw_text, parsed_type, entry_id, result) VALUES (?, ?, ?, ?, ?)`
  ).run(fromNumber, rawText, parsedType || null, entryId || null, result);
}

function executeReceiptOrPayment(db, config, parsed, fromNumber) {
  const args = { ...parsed, createdBy: fromNumber };
  const result =
    parsed.type === 'receipt' ? ledger.quickReceipt(db, args) : ledger.quickPayment(db, args);
  const kindLabel = parsed.type === 'receipt' ? 'سند قبض' : 'سند صرف';
  return { reply: formatEntryReply(kindLabel, result, `المبلغ: ${parsed.amount} ${config.currency}`), entryId: result.id };
}

function executeTransfer(db, config, parsed, fromNumber) {
  const result = ledger.transfer(db, { ...parsed, createdBy: fromNumber });
  return {
    reply: formatEntryReply('سند تحويل', result, `المبلغ: ${parsed.amount} ${config.currency}`),
    entryId: result.id,
  };
}

function needsConfirmation(config, parsed) {
  return (
    (parsed.type === 'receipt' || parsed.type === 'payment' || parsed.type === 'transfer') &&
    config.confirmAboveAmount != null &&
    parsed.amount > config.confirmAboveAmount
  );
}

function executeParsed(db, config, parsed, fromNumber) {
  if (parsed.type === 'receipt' || parsed.type === 'payment') {
    return executeReceiptOrPayment(db, config, parsed, fromNumber);
  }
  if (parsed.type === 'transfer') {
    return executeTransfer(db, config, parsed, fromNumber);
  }
  throw new ledger.LedgerError('نوع عملية غير مدعوم للتنفيذ');
}

function handleCommand(db, config, { chatId, fromNumber, text }) {
  const role = getRole(config, fromNumber);
  const parsed = parseCommand(text);

  if (!role) {
    logAudit(db, { fromNumber, rawText: text, parsedType: parsed.type, result: 'denied' });
    return 'عذراً، هذا الرقم غير مصرح له باستخدام هذا البوت.';
  }

  try {
    switch (parsed.type) {
      case 'help':
        return HELP_TEXT;

      case 'confirm': {
        const pending = session.getPending(chatId);
        if (!pending) return 'لا يوجد طلب بانتظار التأكيد.';
        session.clearPending(chatId);
        const { reply, entryId } = executeParsed(db, config, pending, fromNumber);
        logAudit(db, { fromNumber, rawText: text, parsedType: pending.type, entryId, result: 'ok' });
        return reply;
      }

      case 'cancel': {
        const hadPending = session.getPending(chatId);
        session.clearPending(chatId);
        return hadPending ? 'تم إلغاء العملية المعلّقة.' : 'لا يوجد طلب لإلغائه.';
      }

      case 'receipt':
      case 'payment':
      case 'transfer': {
        if (!can(role, 'post')) return 'غير مصرح لك بتسجيل عمليات محاسبية.';
        if (needsConfirmation(config, parsed)) {
          session.setPending(chatId, parsed);
          return `⚠️ المبلغ ${parsed.amount} ${config.currency} يتجاوز حد التأكيد.\nأرسل "تأكيد" للمتابعة أو "الغاء" للتراجع.`;
        }
        const { reply, entryId } = executeParsed(db, config, parsed, fromNumber);
        logAudit(db, { fromNumber, rawText: text, parsedType: parsed.type, entryId, result: 'ok' });
        return reply;
      }

      case 'balance': {
        if (!can(role, 'report')) return 'غير مصرح لك بعرض الأرصدة.';
        if (parsed.accountText) {
          const account = ledger.findAccountByText(db, parsed.accountText);
          if (!account) return `لم يتم العثور على حساب "${parsed.accountText}".`;
          const balance = ledger.accountBalance(db, account.id);
          return `رصيد ${account.name}: ${balance.toFixed(2)} ${config.currency}`;
        }
        const cash = ledger.getDefaultCashAccount(db);
        if (!cash) return 'لا يوجد حساب صندوق افتراضي.';
        const balance = ledger.accountBalance(db, cash.id);
        return `رصيد ${cash.name}: ${balance.toFixed(2)} ${config.currency}`;
      }

      case 'accounts': {
        if (!can(role, 'accounts')) return 'غير مصرح لك بعرض دليل الحسابات.';
        const accounts = ledger.listAccounts(db);
        const lines = accounts.map(
          (a) => `${a.code} - ${a.name}: ${ledger.accountBalance(db, a.id).toFixed(2)} ${config.currency}`
        );
        return `📒 *دليل الحسابات*\n\n${lines.join('\n')}`;
      }

      case 'addAccount': {
        if (!can(role, 'addAccount')) return 'إضافة الحسابات متاحة لمالك الحساب فقط.';
        const account = ledger.ensureAccount(db, parsed.name, parsed.accountType);
        return `✅ تم إنشاء/العثور على الحساب: ${account.code} - ${account.name}`;
      }

      case 'report': {
        if (!can(role, 'report')) return 'غير مصرح لك بعرض التقارير.';
        return buildSummaryReport(db, parsed, config);
      }

      case 'statement': {
        if (!can(role, 'statement')) return 'غير مصرح لك بعرض كشف الحساب.';
        const statement = buildAccountStatement(db, parsed.accountText, parsed, config);
        return statement || `لم يتم العثور على حساب "${parsed.accountText}".`;
      }

      case 'voidLast': {
        if (!can(role, 'void')) return 'إلغاء القيود متاح لمالك الحساب فقط.';
        const last = ledger.getLastEntry(db);
        if (!last) return 'لا يوجد قيد لإلغائه.';
        ledger.voidEntry(db, last.id, fromNumber);
        return `تم إلغاء القيد #${last.entry_number}.`;
      }

      case 'voidByNumber': {
        if (!can(role, 'void')) return 'إلغاء القيود متاح لمالك الحساب فقط.';
        const entry = db.prepare('SELECT * FROM journal_entries WHERE entry_number = ?').get(parsed.number);
        if (!entry) return `لم يتم العثور على القيد #${parsed.number}.`;
        ledger.voidEntry(db, entry.id, fromNumber);
        return `تم إلغاء القيد #${entry.entry_number}.`;
      }

      case 'error':
        return `⚠️ ${parsed.message}`;

      default:
        return 'لم أفهم الأمر. أرسل "مساعدة" لعرض قائمة الأوامر المتاحة.';
    }
  } catch (err) {
    logAudit(db, { fromNumber, rawText: text, parsedType: parsed.type, result: 'error' });
    if (err instanceof ledger.LedgerError) return `⚠️ ${err.message}`;
    throw err;
  }
}

module.exports = { handleCommand, HELP_TEXT };
