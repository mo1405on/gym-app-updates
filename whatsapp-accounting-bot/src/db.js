import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || './data/accounting.db';

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date      TEXT    NOT NULL,
    type            TEXT    NOT NULL CHECK(type IN ('in','out')),
    amount          REAL    NOT NULL CHECK(amount > 0),
    category        TEXT,
    description     TEXT    NOT NULL,
    created_by      TEXT    NOT NULL,
    created_by_name TEXT,
    created_at      TEXT    NOT NULL,
    voided          INTEGER NOT NULL DEFAULT 0,
    voided_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS allowed_users (
    jid   TEXT PRIMARY KEY,
    name  TEXT,
    role  TEXT NOT NULL DEFAULT 'member'
  );

  CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(entry_date);
`);

function addEntry({ type, amount, category, description, createdBy, createdByName }) {
  const now = new Date();
  const stmt = db.prepare(`
    INSERT INTO entries (entry_date, type, amount, category, description, created_by, created_by_name, created_at)
    VALUES (@entry_date, @type, @amount, @category, @description, @created_by, @created_by_name, @created_at)
  `);
  const info = stmt.run({
    entry_date: now.toISOString().slice(0, 10),
    type,
    amount,
    category: category || null,
    description,
    created_by: createdBy,
    created_by_name: createdByName || null,
    created_at: now.toISOString(),
  });
  return getEntry(info.lastInsertRowid);
}

function getEntry(id) {
  return db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
}

function voidEntry(id) {
  const entry = getEntry(id);
  if (!entry || entry.voided) return null;
  db.prepare('UPDATE entries SET voided = 1, voided_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  return getEntry(id);
}

function getBalance() {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'in'  AND voided = 0 THEN amount END), 0) AS total_in,
      COALESCE(SUM(CASE WHEN type = 'out' AND voided = 0 THEN amount END), 0) AS total_out
    FROM entries
  `).get();
  return {
    totalIn: row.total_in,
    totalOut: row.total_out,
    balance: row.total_in - row.total_out,
  };
}

function getRecentEntries(limit = 10) {
  return db.prepare(`
    SELECT * FROM entries WHERE voided = 0 ORDER BY id DESC LIMIT ?
  `).all(limit);
}

function getReport(fromDate, toDate) {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'in'  THEN amount END), 0) AS total_in,
      COALESCE(SUM(CASE WHEN type = 'out' THEN amount END), 0) AS total_out,
      COUNT(*) AS count
    FROM entries
    WHERE voided = 0 AND entry_date BETWEEN ? AND ?
  `).get(fromDate, toDate);

  const byCategory = db.prepare(`
    SELECT
      COALESCE(category, 'بدون تصنيف') AS category,
      type,
      SUM(amount) AS total
    FROM entries
    WHERE voided = 0 AND entry_date BETWEEN ? AND ?
    GROUP BY category, type
    ORDER BY total DESC
  `).all(fromDate, toDate);

  return {
    totalIn: totals.total_in,
    totalOut: totals.total_out,
    net: totals.total_in - totals.total_out,
    count: totals.count,
    byCategory,
  };
}

function isAllowed(jid) {
  return db.prepare('SELECT * FROM allowed_users WHERE jid = ?').get(jid);
}

function addAllowedUser(jid, name, role = 'member') {
  db.prepare(`
    INSERT INTO allowed_users (jid, name, role) VALUES (?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET name = excluded.name, role = excluded.role
  `).run(jid, name || null, role);
  return isAllowed(jid);
}

function seedAdmins(jids) {
  for (const jid of jids) {
    if (!isAllowed(jid)) addAllowedUser(jid, null, 'admin');
  }
}

export default {
  addEntry,
  getEntry,
  voidEntry,
  getBalance,
  getRecentEntries,
  getReport,
  isAllowed,
  addAllowedUser,
  seedAdmins,
};
