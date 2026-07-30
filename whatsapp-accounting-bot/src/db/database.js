const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_ACCOUNTS = [
  { code: '1000', name: 'الصندوق', type: 'asset', is_default_cash: 1 },
  { code: '1010', name: 'البنك', type: 'asset', is_default_cash: 0 },
  { code: '3000', name: 'رأس المال', type: 'equity' },
  { code: '3900', name: 'الأرباح المرحلة', type: 'equity' },
  { code: '4000', name: 'إيرادات عامة', type: 'revenue' },
  { code: '5000', name: 'مصروفات عامة', type: 'expense' },
];

const DEFAULT_ALIASES = [
  ['نقدي', '1000'],
  ['كاش', '1000'],
  ['الصندوق', '1000'],
  ['بنك', '1010'],
  ['تحويل بنكي', '1010'],
  ['اشتراكات', '4000'],
  ['ايرادات', '4000'],
  ['إيرادات', '4000'],
  ['مصاريف', '5000'],
  ['مصروفات', '5000'],
];

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  seedDefaults(db);
  return db;
}

function seedDefaults(db) {
  const countAccounts = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  if (countAccounts === 0) {
    const insertAccount = db.prepare(
      `INSERT INTO accounts (code, name, type, is_default_cash) VALUES (@code, @name, @type, @is_default_cash)`
    );
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insertAccount.run({ is_default_cash: 0, ...row });
    });
    insertMany(DEFAULT_ACCOUNTS);
  }

  const countAliases = db.prepare('SELECT COUNT(*) AS n FROM category_aliases').get().n;
  if (countAliases === 0) {
    const findAccountByCode = db.prepare('SELECT id FROM accounts WHERE code = ?');
    const insertAlias = db.prepare('INSERT OR IGNORE INTO category_aliases (alias, account_id) VALUES (?, ?)');
    const insertMany = db.transaction((rows) => {
      for (const [alias, code] of rows) {
        const account = findAccountByCode.get(code);
        if (account) insertAlias.run(alias, account.id);
      }
    });
    insertMany(DEFAULT_ALIASES);
  }
}

module.exports = { openDatabase };
