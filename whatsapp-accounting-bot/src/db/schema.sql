-- دليل الحسابات
CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('asset','liability','equity','revenue','expense')),
  parent_id     INTEGER REFERENCES accounts(id),
  is_default_cash INTEGER NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ربط كلمات مفتاحية (تصنيفات) بحساب معيّن لتسريع الإدخال السريع من واتساب
CREATE TABLE IF NOT EXISTS category_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  alias       TEXT UNIQUE NOT NULL,
  account_id  INTEGER NOT NULL REFERENCES accounts(id)
);

-- رأس القيد
CREATE TABLE IF NOT EXISTS journal_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_number  INTEGER UNIQUE NOT NULL,
  entry_date    TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','void')),
  created_by    TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'whatsapp',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  voided_at     TEXT,
  voided_by     TEXT
);

-- سطور القيد (مدين / دائن) - قيد مزدوج
CREATE TABLE IF NOT EXISTS journal_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id    INTEGER NOT NULL REFERENCES journal_entries(id),
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  debit       REAL NOT NULL DEFAULT 0,
  credit      REAL NOT NULL DEFAULT 0,
  note        TEXT
);

-- سجل تدقيق لكل أمر وارد من واتساب
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_number TEXT NOT NULL,
  raw_text    TEXT NOT NULL,
  parsed_type TEXT,
  entry_id    INTEGER REFERENCES journal_entries(id),
  result      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(entry_date);
