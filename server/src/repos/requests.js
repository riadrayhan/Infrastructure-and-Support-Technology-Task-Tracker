'use strict';
/* repos/requests.js – people who opened the tracker but have no account yet.
   The super admin sees them in the Users dialog and can approve them with a role. */

const db = require('../db');

function list() {
  return db.get().prepare('SELECT * FROM access_requests ORDER BY at').all();
}

function put(id, { email = '', name = '' } = {}) {
  const key = String(id).slice(0, 120);
  const existing = db.get().prepare('SELECT id FROM access_requests WHERE id = ?').get(key);
  if (existing) return { id: key, existing: true };
  db.get().prepare('INSERT INTO access_requests (id, email, name, at) VALUES (?, ?, ?, ?)')
    .run(key, String(email || '').toLowerCase().slice(0, 200), String(name || '').slice(0, 120), db.nowIso());
  return { id: key, existing: false };
}

function remove(id) {
  db.get().prepare('DELETE FROM access_requests WHERE id = ?').run(String(id));
  return { id: String(id) };
}

function count() { return db.get().prepare('SELECT COUNT(*) AS c FROM access_requests').get().c; }

module.exports = { list, put, remove, count };
