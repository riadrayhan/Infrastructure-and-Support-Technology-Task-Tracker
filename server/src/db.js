'use strict';
/* db.js – the SQLite database (Node's built-in engine, so there is nothing to install).

   Everything the tracker stores lives here:
     users            sign-in accounts and their role
     sessions         active sign-ins (token stored hashed)
     items            projects, recurring items and tasks
     archive_batches  older tasks kept for reference ("taskhist" in the browser)
     access_requests  people who opened the page but have no account yet
     audit            who changed what, and when
*/

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./crypto');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  email       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('superadmin','admin','superuser','viewer')),
  password    TEXT NOT NULL,
  external_id TEXT,
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  last_login  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  csrf        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS sessions_email ON sessions(email);

CREATE TABLE IF NOT EXISTS items (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('Project','Drive','Task')),
  title       TEXT NOT NULL,
  s           TEXT NOT NULL,
  pri         TEXT NOT NULL DEFAULT 'Mid',
  f1          TEXT NOT NULL DEFAULT '',
  f2          TEXT NOT NULL DEFAULT '',
  sd          TEXT NOT NULL DEFAULT '',
  e           TEXT NOT NULL DEFAULT '',
  sh          TEXT NOT NULL DEFAULT '',
  ms          TEXT NOT NULL DEFAULT '',
  rm          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  created_by  TEXT,
  updated_at  TEXT,
  updated_by  TEXT
);
CREATE INDEX IF NOT EXISTS items_type ON items(type);
CREATE INDEX IF NOT EXISTS items_status ON items(s);

CREATE TABLE IF NOT EXISTS archive_batches (
  id    TEXT PRIMARY KEY,
  rows  TEXT NOT NULL,
  at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS access_requests (
  id    TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  name  TEXT NOT NULL DEFAULT '',
  at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  actor   TEXT,
  role    TEXT,
  action  TEXT NOT NULL,
  target  TEXT,
  detail  TEXT,
  ip      TEXT
);
CREATE INDEX IF NOT EXISTS audit_at ON audit(at);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db = null;

function nowIso() { return new Date().toISOString(); }

function open(file) {
  if (file !== ':memory:') {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  const handle = new DatabaseSync(file);
  handle.exec(SCHEMA);
  return handle;
}

/** Create the first super admin (and the shipped test admin) when the users table is empty. */
function seed(handle, config, log = () => {}) {
  const count = handle.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) return { seeded: false };

  const insert = handle.prepare(
    `INSERT INTO users (email, name, role, password, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'seed')`
  );
  const accounts = [
    { ...config.seedSuperAdmin, role: 'superadmin' },
    ...(config.seedTestAdmin ? [config.seedTestAdmin] : []),
  ];
  for (const a of accounts) {
    insert.run(a.email, a.name, a.role, hashPassword(a.password), nowIso());
    log(`seeded ${a.role}: ${a.email}`);
  }
  handle.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
    .run('seeded_at', nowIso());
  return { seeded: true, accounts: accounts.map(a => a.email) };
}

/** Open (once) and return the shared database handle. */
function init(config, log) {
  if (db) return db;
  db = open(config.dbFile);
  seed(db, config, log);
  return db;
}

function get() {
  if (!db) throw new Error('Database not initialised – call db.init(config) first');
  return db;
}

/** Used by the tests, which run against an in-memory database. */
function close() {
  if (db) { try { db.close(); } catch { /* already closed */ } db = null; }
}

/** Delete sessions whose expiry has passed. Called on a timer and before every auth check sweep. */
function purgeExpiredSessions() {
  if (!db) return 0;
  const res = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso());
  return Number(res.changes || 0);
}

module.exports = { init, get, close, open, seed, purgeExpiredSessions, nowIso, SCHEMA };
