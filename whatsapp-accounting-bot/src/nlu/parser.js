const { normalizeArabic } = require('../accounting/textNormalize');

const NOTE_MARKERS = ['ملاحظة:', 'ملاحظه:', 'ملاحظة', 'ملاحظه'];
const PAYMENT_KEYWORDS = ['نقدي', 'كاش', 'الصندوق', 'بنك', 'تحويل بنكي', 'شبكة'];
const ACCOUNT_TYPE_WORDS = {
  اصل: 'asset',
  أصل: 'asset',
  التزام: 'liability',
  'حقوق ملكية': 'equity',
  ايراد: 'revenue',
  إيراد: 'revenue',
  مصروف: 'expense',
};

function splitNote(text) {
  for (const marker of NOTE_MARKERS) {
    const idx = text.indexOf(marker);
    if (idx !== -1) {
      const before = text.slice(0, idx).trim();
      const note = text.slice(idx + marker.length).replace(/^:/, '').trim();
      return { text: before, note: note || null };
    }
  }
  return { text, note: null };
}

function extractAmount(text) {
  const match = text.match(/([\d,.]+)/);
  if (!match) return null;
  const amount = parseFloat(match[1].replace(/,/g, ''));
  if (Number.isNaN(amount) || amount <= 0) return null;
  const rest = (text.slice(0, match.index) + ' ' + text.slice(match.index + match[0].length))
    .replace(/\s+/g, ' ')
    .trim();
  return { amount, rest };
}

function extractPaymentMethod(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (const kwLen of [2, 1]) {
    if (words.length <= kwLen) continue;
    const candidate = words.slice(-kwLen).join(' ');
    const norm = normalizeArabic(candidate);
    if (PAYMENT_KEYWORDS.some((k) => normalizeArabic(k) === norm)) {
      return { text: words.slice(0, -kwLen).join(' ').trim(), paymentMethodText: candidate };
    }
  }
  return { text, paymentMethodText: null };
}

function parseReceiptOrPayment(kind, body) {
  const { text: withoutNote, note } = splitNote(body);
  const amountResult = extractAmount(withoutNote);
  if (!amountResult) {
    return { type: 'error', message: 'لم أفهم المبلغ. مثال: قبض 500 اشتراكات نقدي' };
  }
  const { text: withoutMethod, paymentMethodText } = extractPaymentMethod(amountResult.rest);
  const categoryText = withoutMethod.trim();
  if (!categoryText) {
    return { type: 'error', message: 'أدخل تصنيف العملية. مثال: قبض 500 اشتراكات نقدي' };
  }
  return { type: kind, amount: amountResult.amount, categoryText, paymentMethodText, note };
}

function parseTransfer(body) {
  const { text: withoutNote, note } = splitNote(body);
  const amountResult = extractAmount(withoutNote);
  if (!amountResult) {
    return { type: 'error', message: 'لم أفهم المبلغ. مثال: تحويل 500 من الصندوق الى البنك' };
  }
  const fromToMatch = amountResult.rest.match(/^من\s+(.+?)\s+(?:الى|إلى)\s+(.+)$/);
  if (!fromToMatch) {
    return { type: 'error', message: 'الصيغة الصحيحة: تحويل <مبلغ> من <حساب> الى <حساب>' };
  }
  return {
    type: 'transfer',
    amount: amountResult.amount,
    fromText: fromToMatch[1].trim(),
    toText: fromToMatch[2].trim(),
    note,
  };
}

function parseCommand(rawText) {
  const original = String(rawText || '').trim();
  if (!original) return { type: 'unknown', raw: original };

  const normalized = normalizeArabic(original);

  if (['مساعده', 'اوامر', 'help', 'الاوامر'].includes(normalized)) return { type: 'help' };
  if (/^(نعم|تاكيد|اكد|ok)$/i.test(normalized)) return { type: 'confirm' };
  if (/^(لا|الغاء|cancel)$/i.test(normalized)) return { type: 'cancel' };
  if (/^(?:ال)?حسابات$|^دليل الحسابات$/.test(normalized)) return { type: 'accounts' };
  if (/^حذف اخر قيد$|^الغاء اخر قيد$/.test(normalized)) return { type: 'voidLast' };

  const voidByNumberMatch = original.match(/^(?:حذف|الغاء|إلغاء)\s+قيد\s*#?(\d+)$/);
  if (voidByNumberMatch) return { type: 'voidByNumber', number: parseInt(voidByNumberMatch[1], 10) };

  if (/^رصيد(\s+.+)?$/.test(original)) {
    const accountText = original.replace(/^رصيد\s*/, '').trim();
    return { type: 'balance', accountText: accountText || null };
  }

  const addAccountMatch = original.match(
    /^(?:اضافة|إضافة)\s+حساب\s+(.+?)\s+(اصل|أصل|التزام|حقوق ملكية|ايراد|إيراد|مصروف)$/
  );
  if (addAccountMatch) {
    return {
      type: 'addAccount',
      name: addAccountMatch[1].trim(),
      accountType: ACCOUNT_TYPE_WORDS[addAccountMatch[2]],
    };
  }

  const statementMatch = original.match(/^كشف حساب\s+(.+)$/);
  if (statementMatch) {
    let rest = statementMatch[1].trim();
    let from = null;
    let to = null;
    const rangeMatch = rest.match(/من\s+(\S+)\s+(?:الى|إلى)\s+(\S+)$/);
    if (rangeMatch) {
      from = rangeMatch[1];
      to = rangeMatch[2];
      rest = rest.slice(0, rangeMatch.index).trim();
    }
    return { type: 'statement', accountText: rest, from, to };
  }

  if (/^تقرير/.test(normalized)) {
    if (/تقرير اليوم/.test(normalized)) return { type: 'report', period: 'today' };
    if (/تقرير الاسبوع/.test(normalized)) return { type: 'report', period: 'week' };
    if (/تقرير الشهر/.test(normalized)) return { type: 'report', period: 'month' };
    const rangeMatch = original.match(/تقرير من\s+(\S+)\s+(?:الى|إلى)\s+(\S+)/);
    if (rangeMatch) return { type: 'report', period: 'range', from: rangeMatch[1], to: rangeMatch[2] };
    return { type: 'report', period: 'today' };
  }

  const receiptMatch = original.match(/^قبض\s+(.+)$/);
  if (receiptMatch) return parseReceiptOrPayment('receipt', receiptMatch[1]);

  const paymentMatch = original.match(/^صرف\s+(.+)$/);
  if (paymentMatch) return parseReceiptOrPayment('payment', paymentMatch[1]);

  const transferMatch = original.match(/^تحويل\s+(.+)$/);
  if (transferMatch) return parseTransfer(transferMatch[1]);

  return { type: 'unknown', raw: original };
}

module.exports = { parseCommand };
