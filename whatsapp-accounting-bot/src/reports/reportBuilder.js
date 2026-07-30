const dayjs = require('dayjs');
const { listAccounts, findAccountByText, accountBalance } = require('../accounting/ledger');

function resolveDateRange({ period, from, to }) {
  const today = dayjs();
  if (period === 'today') {
    const d = today.format('YYYY-MM-DD');
    return { from: d, to: d };
  }
  if (period === 'week') {
    return { from: today.subtract(6, 'day').format('YYYY-MM-DD'), to: today.format('YYYY-MM-DD') };
  }
  if (period === 'month') {
    return { from: today.startOf('month').format('YYYY-MM-DD'), to: today.format('YYYY-MM-DD') };
  }
  return { from, to };
}

function sumByType(db, type, from, to) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(jl.debit),0) AS d, COALESCE(SUM(jl.credit),0) AS c
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       JOIN accounts a ON a.id = jl.account_id
       WHERE a.type = ? AND je.status = 'posted' AND je.entry_date BETWEEN ? AND ?`
    )
    .get(type, from, to);
  return row;
}

function buildSummaryReport(db, { period, from, to }, { currency = 'ريال', businessName } = {}) {
  const range = resolveDateRange({ period, from, to });
  const revenue = sumByType(db, 'revenue', range.from, range.to);
  const expense = sumByType(db, 'expense', range.from, range.to);

  const totalRevenue = revenue.c - revenue.d;
  const totalExpense = expense.d - expense.c;
  const net = totalRevenue - totalExpense;

  const cashAccounts = listAccounts(db).filter((a) => a.type === 'asset');
  const cashLines = cashAccounts
    .map((a) => `  • ${a.name}: ${accountBalance(db, a.id).toFixed(2)} ${currency}`)
    .join('\n');

  const header = businessName ? `📊 *${businessName}*\n` : '';
  const rangeLabel = range.from === range.to ? range.from : `${range.from} إلى ${range.to}`;

  return (
    `${header}تقرير الفترة: ${rangeLabel}\n\n` +
    `💰 الإيرادات: ${totalRevenue.toFixed(2)} ${currency}\n` +
    `💸 المصروفات: ${totalExpense.toFixed(2)} ${currency}\n` +
    `📈 الصافي: ${net.toFixed(2)} ${currency}\n\n` +
    `أرصدة الحسابات النقدية:\n${cashLines || '  لا يوجد'}`
  );
}

function buildAccountStatement(db, accountText, { from, to } = {}, { currency = 'ريال' } = {}) {
  const account = findAccountByText(db, accountText);
  if (!account) return null;

  const range = {
    from: from || '2000-01-01',
    to: to || dayjs().format('YYYY-MM-DD'),
  };

  const rows = db
    .prepare(
      `SELECT je.entry_number, je.entry_date, je.description, jl.debit, jl.credit
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.entry_id
       WHERE jl.account_id = ? AND je.status = 'posted' AND je.entry_date BETWEEN ? AND ?
       ORDER BY je.entry_date, je.id`
    )
    .all(account.id, range.from, range.to);

  const lines = rows.map(
    (r) =>
      `#${r.entry_number} | ${r.entry_date} | ${r.description || '-'} | مدين ${r.debit.toFixed(2)} / دائن ${r.credit.toFixed(2)}`
  );

  const balance = accountBalance(db, account.id);

  return (
    `كشف حساب: ${account.name}\n` +
    `من ${range.from} إلى ${range.to}\n\n` +
    (lines.length ? lines.join('\n') : 'لا توجد حركات في هذه الفترة') +
    `\n\nالرصيد الحالي: ${balance.toFixed(2)} ${currency}`
  );
}

module.exports = { buildSummaryReport, buildAccountStatement, resolveDateRange };
