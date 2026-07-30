const dayjs = require('dayjs');
const { normalizeArabic } = require('./textNormalize');

const CREDIT_NATURE_TYPES = new Set(['liability', 'equity', 'revenue']);

class LedgerError extends Error {}

function listAccounts(db) {
  return db.prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY code').all();
}

function getAccountById(db, id) {
  return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function getDefaultCashAccount(db) {
  return db.prepare('SELECT * FROM accounts WHERE is_default_cash = 1 ORDER BY id LIMIT 1').get();
}

function findAccountByText(db, text) {
  const needle = normalizeArabic(text);
  if (!needle) return null;

  const alias = db
    .prepare(
      `SELECT a.* FROM category_aliases c
       JOIN accounts a ON a.id = c.account_id
       WHERE c.alias = ?`
    )
    .get(needle);
  if (alias) return alias;

  const accounts = listAccounts(db);
  return accounts.find((acc) => normalizeArabic(acc.name) === needle) || null;
}

function nextCodeForType(db, type) {
  const ranges = { asset: 1000, liability: 2000, equity: 3000, revenue: 4000, expense: 5000 };
  const base = ranges[type];
  const row = db
    .prepare(`SELECT MAX(CAST(code AS INTEGER)) AS maxCode FROM accounts WHERE code >= ? AND code < ?`)
    .get(String(base), String(base + 1000));
  const next = row.maxCode ? row.maxCode + 10 : base + 10;
  return String(next);
}

function ensureAccount(db, name, type, { alias } = {}) {
  const existing = findAccountByText(db, name);
  if (existing) return existing;

  const code = nextCodeForType(db, type);
  const insert = db.prepare('INSERT INTO accounts (code, name, type) VALUES (?, ?, ?)');
  const result = insert.run(code, name.trim(), type);
  const account = getAccountById(db, result.lastInsertRowid);

  const aliasText = normalizeArabic(alias || name);
  db.prepare('INSERT OR IGNORE INTO category_aliases (alias, account_id) VALUES (?, ?)').run(aliasText, account.id);

  return account;
}

function accountBalance(db, accountId) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(debit),0) AS d, COALESCE(SUM(credit),0) AS c
               FROM journal_lines jl
               JOIN journal_entries je ON je.id = jl.entry_id
               WHERE jl.account_id = ? AND je.status = 'posted'`)
    .get(accountId);
  const account = getAccountById(db, accountId);
  const net = row.d - row.c;
  return CREDIT_NATURE_TYPES.has(account.type) ? -net : net;
}

function nextEntryNumber(db) {
  const row = db.prepare('SELECT MAX(entry_number) AS n FROM journal_entries').get();
  return (row.n || 0) + 1;
}

function postEntry(db, { date, description, lines, createdBy, source = 'whatsapp' }) {
  if (!lines || lines.length < 2) {
    throw new LedgerError('القيد يحتاج سطرين على الأقل (مدين ودائن)');
  }
  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    throw new LedgerError(`القيد غير متوازن: مدين ${totalDebit} ≠ دائن ${totalCredit}`);
  }

  const entryDate = date || dayjs().format('YYYY-MM-DD');
  const entryNumber = nextEntryNumber(db);

  const insertEntry = db.prepare(
    `INSERT INTO journal_entries (entry_number, entry_date, description, created_by, source)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertLine = db.prepare(
    `INSERT INTO journal_lines (entry_id, account_id, debit, credit, note) VALUES (?, ?, ?, ?, ?)`
  );

  const run = db.transaction(() => {
    const result = insertEntry.run(entryNumber, entryDate, description || null, createdBy, source);
    const entryId = result.lastInsertRowid;
    for (const line of lines) {
      insertLine.run(entryId, line.accountId, line.debit || 0, line.credit || 0, line.note || null);
    }
    return entryId;
  });

  const entryId = run();
  return { id: entryId, entryNumber, date: entryDate };
}

function voidEntry(db, entryId, voidedBy) {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(entryId);
  if (!entry) throw new LedgerError('القيد غير موجود');
  if (entry.status === 'void') throw new LedgerError('القيد ملغى مسبقاً');

  db.prepare(
    `UPDATE journal_entries SET status = 'void', voided_at = datetime('now'), voided_by = ? WHERE id = ?`
  ).run(voidedBy, entryId);
  return entry;
}

function getLastEntry(db) {
  return db.prepare(`SELECT * FROM journal_entries WHERE status = 'posted' ORDER BY id DESC LIMIT 1`).get();
}

function quickReceipt(db, { amount, categoryText, paymentMethodText, note, createdBy, date }) {
  const cashAccount = paymentMethodText ? findAccountByText(db, paymentMethodText) : getDefaultCashAccount(db);
  if (!cashAccount) throw new LedgerError('لم يتم العثور على حساب الصندوق/البنك المحدد');

  const revenueAccount = ensureAccount(db, categoryText, 'revenue');

  return postEntry(db, {
    date,
    description: note || `قبض - ${categoryText}`,
    createdBy,
    lines: [
      { accountId: cashAccount.id, debit: amount, note },
      { accountId: revenueAccount.id, credit: amount, note },
    ],
  });
}

function quickPayment(db, { amount, categoryText, paymentMethodText, note, createdBy, date }) {
  const cashAccount = paymentMethodText ? findAccountByText(db, paymentMethodText) : getDefaultCashAccount(db);
  if (!cashAccount) throw new LedgerError('لم يتم العثور على حساب الصندوق/البنك المحدد');

  const expenseAccount = ensureAccount(db, categoryText, 'expense');

  return postEntry(db, {
    date,
    description: note || `صرف - ${categoryText}`,
    createdBy,
    lines: [
      { accountId: expenseAccount.id, debit: amount, note },
      { accountId: cashAccount.id, credit: amount, note },
    ],
  });
}

function transfer(db, { amount, fromText, toText, note, createdBy, date }) {
  const fromAccount = findAccountByText(db, fromText);
  const toAccount = findAccountByText(db, toText);
  if (!fromAccount) throw new LedgerError(`لم يتم العثور على الحساب "${fromText}"`);
  if (!toAccount) throw new LedgerError(`لم يتم العثور على الحساب "${toText}"`);

  return postEntry(db, {
    date,
    description: note || `تحويل من ${fromAccount.name} إلى ${toAccount.name}`,
    createdBy,
    lines: [
      { accountId: toAccount.id, debit: amount, note },
      { accountId: fromAccount.id, credit: amount, note },
    ],
  });
}

module.exports = {
  LedgerError,
  listAccounts,
  getAccountById,
  getDefaultCashAccount,
  findAccountByText,
  ensureAccount,
  accountBalance,
  postEntry,
  voidEntry,
  getLastEntry,
  quickReceipt,
  quickPayment,
  transfer,
};
