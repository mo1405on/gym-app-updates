import db from './db.js';
import auth from './auth.js';

const CURRENCY = process.env.CURRENCY || 'ر.س';

function money(n) {
  const num = Number(n) || 0;
  return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${CURRENCY}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function resolvePeriod(period) {
  const today = todayISO();
  const p = (period || 'اليوم').trim();

  if (p === 'اليوم') return { from: today, to: today, label: 'اليوم' };
  if (p === 'الأمس' || p === 'امس') {
    const y = addDays(today, -1);
    return { from: y, to: y, label: 'الأمس' };
  }
  if (p === 'الأسبوع' || p === 'الاسبوع') return { from: addDays(today, -6), to: today, label: 'آخر 7 أيام' };
  if (p === 'الشهر') return { from: addDays(today, -29), to: today, label: 'آخر 30 يومًا' };

  const rangeMatch = p.match(/من\s+(\d{4}-\d{2}-\d{2})\s+الى\s+(\d{4}-\d{2}-\d{2})/);
  if (rangeMatch) return { from: rangeMatch[1], to: rangeMatch[2], label: `${rangeMatch[1]} إلى ${rangeMatch[2]}` };

  return { from: today, to: today, label: 'اليوم' };
}

const HELP_TEXT = `*الأوامر المتاحة*

قبض <مبلغ> <وصف> [#تصنيف] — تسجيل قيد قبض
مثال: قبض 500 اشتراك أحمد #اشتراكات

صرف <مبلغ> <وصف> [#تصنيف] — تسجيل قيد صرف
مثال: صرف 200 فاتورة كهرباء #تشغيل

رصيد — عرض الرصيد الحالي
تقرير [اليوم|الأسبوع|الشهر] — ملخص القيود
اخر [عدد] — آخر القيود (افتراضي 10)
مساعدة — عرض هذه القائمة

*للأدمن فقط*
حذف <رقم القيد> — إلغاء قيد
اضافة_مستخدم <رقم> <اسم> — تصريح رقم جديد`;

export function handleCommand(parsed, sender) {
  switch (parsed.command) {
    case 'in':
    case 'out': {
      const entry = db.addEntry({
        type: parsed.command,
        amount: parsed.amount,
        category: parsed.category,
        description: parsed.description,
        createdBy: sender.jid,
        createdByName: sender.name,
      });
      const { balance } = db.getBalance();
      const label = parsed.command === 'in' ? 'قبض' : 'صرف';
      const catLine = entry.category ? `\nالتصنيف: #${entry.category}` : '';
      return `✅ تم تسجيل ${label} رقم ${entry.id}\nالمبلغ: ${money(entry.amount)}\nالوصف: ${entry.description}${catLine}\n\nالرصيد الحالي: ${money(balance)}`;
    }

    case 'balance': {
      const { totalIn, totalOut, balance } = db.getBalance();
      return `💰 *الرصيد الحالي: ${money(balance)}*\n\nإجمالي القبض: ${money(totalIn)}\nإجمالي الصرف: ${money(totalOut)}`;
    }

    case 'report': {
      const { from, to, label } = resolvePeriod(parsed.period);
      const report = db.getReport(from, to);
      let text = `📊 *تقرير ${label}*\n\nعدد القيود: ${report.count}\nإجمالي القبض: ${money(report.totalIn)}\nإجمالي الصرف: ${money(report.totalOut)}\nالصافي: ${money(report.net)}`;
      if (report.byCategory.length) {
        text += '\n\n*حسب التصنيف:*';
        for (const row of report.byCategory) {
          const sign = row.type === 'in' ? 'قبض' : 'صرف';
          text += `\n- ${row.category} (${sign}): ${money(row.total)}`;
        }
      }
      return text;
    }

    case 'recent': {
      const entries = db.getRecentEntries(parsed.limit);
      if (!entries.length) return 'لا توجد قيود مسجّلة بعد.';
      const lines = entries.map((e) => {
        const sign = e.type === 'in' ? '↑' : '↓';
        const cat = e.category ? ` #${e.category}` : '';
        return `${sign} #${e.id} | ${money(e.amount)} | ${e.description}${cat} | ${e.entry_date}`;
      });
      return `📋 *آخر ${entries.length} قيد*\n\n${lines.join('\n')}`;
    }

    case 'delete': {
      if (sender.role !== 'admin') return '⛔ هذا الأمر متاح للأدمن فقط.';
      const entry = db.getEntry(parsed.id);
      if (!entry) return `لا يوجد قيد برقم ${parsed.id}.`;
      if (entry.voided) return `القيد رقم ${parsed.id} مُلغى مسبقًا.`;
      db.voidEntry(parsed.id);
      const { balance } = db.getBalance();
      return `🗑️ تم إلغاء القيد رقم ${parsed.id} (${money(entry.amount)} - ${entry.description})\n\nالرصيد الحالي: ${money(balance)}`;
    }

    case 'add_user': {
      if (sender.role !== 'admin') return '⛔ هذا الأمر متاح للأدمن فقط.';
      const jid = `${parsed.phone}@s.whatsapp.net`;
      db.addAllowedUser(jid, parsed.name, 'member');
      return `✅ تمت إضافة ${parsed.name || parsed.phone} كمستخدم مصرّح له.`;
    }

    case 'help':
      return HELP_TEXT;

    case 'error':
      return `⚠️ ${parsed.message}`;

    default:
      return `لم أفهم هذا الأمر. أرسل "مساعدة" لعرض قائمة الأوامر.`;
  }
}

export function handleIncoming(jid, rawText, parseMessage) {
  const access = auth.checkAccess(jid);
  if (!access.allowed) {
    return '⛔ هذا الرقم غير مصرّح له باستخدام هذا البوت. تواصل مع مسؤول الحساب لإضافتك.';
  }
  const parsed = parseMessage(rawText);
  return handleCommand(parsed, { jid, role: access.role, name: access.name });
}

export default { handleCommand, handleIncoming };
