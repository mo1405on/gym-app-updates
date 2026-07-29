const IN_WORDS = ['قبض', 'دخل', 'وارد', 'استلام'];
const OUT_WORDS = ['صرف', 'مصروف', 'سحب', 'دفع'];
const BALANCE_WORDS = ['رصيد', 'الرصيد'];
const REPORT_WORDS = ['تقرير'];
const RECENT_WORDS = ['اخر', 'آخر'];
const DELETE_WORDS = ['حذف', 'الغاء', 'إلغاء'];
const ADD_USER_WORDS = ['اضافة_مستخدم', 'اضافة مستخدم', 'اضف'];
const HELP_WORDS = ['مساعدة', 'help', 'اوامر', 'الاوامر'];

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalizeDigits(text) {
  return text.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d)));
}

function extractCategory(text) {
  const match = text.match(/#(\S+)/);
  if (!match) return { text, category: null };
  return {
    text: (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim(),
    category: match[1],
  };
}

function extractAmount(text) {
  const match = text.match(/\d+(\.\d+)?/);
  if (!match) return null;
  return {
    amount: parseFloat(match[0]),
    before: text.slice(0, match.index).trim(),
    after: text.slice(match.index + match[0].length).trim(),
  };
}

function firstWord(text) {
  const idx = text.indexOf(' ');
  if (idx === -1) return { word: text, rest: '' };
  return { word: text.slice(0, idx), rest: text.slice(idx + 1).trim() };
}

export function parseMessage(rawText) {
  if (!rawText || !rawText.trim()) return { command: 'unknown', raw: rawText };

  const normalized = normalizeDigits(rawText.trim());
  const { text: withoutCategory, category } = extractCategory(normalized);
  const { word, rest } = firstWord(withoutCategory.trim());
  const cmd = word.trim();

  if (IN_WORDS.includes(cmd) || OUT_WORDS.includes(cmd)) {
    const type = IN_WORDS.includes(cmd) ? 'in' : 'out';
    const parsed = extractAmount(rest);
    if (!parsed) {
      return { command: 'error', raw: rawText, message: 'لم أفهم المبلغ. مثال: قبض 500 اشتراك أحمد' };
    }
    const description = [parsed.before, parsed.after].filter(Boolean).join(' ').trim();
    if (!description) {
      return { command: 'error', raw: rawText, message: 'اكتب وصفًا للقيد. مثال: قبض 500 اشتراك أحمد' };
    }
    return { command: type, amount: parsed.amount, description, category, raw: rawText };
  }

  if (BALANCE_WORDS.includes(cmd) && rest === '') {
    return { command: 'balance', raw: rawText };
  }

  if (REPORT_WORDS.includes(cmd)) {
    const period = rest.trim();
    return { command: 'report', period: period || 'اليوم', raw: rawText };
  }

  if (RECENT_WORDS.includes(cmd)) {
    const n = parseInt(rest, 10);
    return { command: 'recent', limit: Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 10, raw: rawText };
  }

  if (DELETE_WORDS.includes(cmd)) {
    const id = parseInt(rest, 10);
    if (!Number.isFinite(id)) {
      return { command: 'error', raw: rawText, message: 'اكتب رقم القيد. مثال: حذف 45' };
    }
    return { command: 'delete', id, raw: rawText };
  }

  if (ADD_USER_WORDS.some((w) => withoutCategory.trim().startsWith(w))) {
    const afterKeyword = ADD_USER_WORDS.reduce((acc, w) => (withoutCategory.trim().startsWith(w) ? withoutCategory.trim().slice(w.length).trim() : acc), rest);
    const { word: phone, rest: name } = firstWord(afterKeyword);
    if (!/^\d{8,15}$/.test(phone)) {
      return { command: 'error', raw: rawText, message: 'اكتب رقم واتساب صحيح بصيغة دولية بدون +. مثال: اضافة_مستخدم 966500000000 محمد' };
    }
    return { command: 'add_user', phone, name: name || null, raw: rawText };
  }

  if (HELP_WORDS.includes(cmd.toLowerCase())) {
    return { command: 'help', raw: rawText };
  }

  return { command: 'unknown', raw: rawText };
}

export default { parseMessage };
