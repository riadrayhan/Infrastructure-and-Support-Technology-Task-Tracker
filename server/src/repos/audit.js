'use strict';
/* repos/audit.js – an append-only record of who changed what.
   Every write route calls `log()`. The super admin can read it from the API. */

const db = require('../db');

function log({ actor = null, role = null, action, target = null, detail = null, ip = null }) {
  try {
    db.get().prepare(
      'INSERT INTO audit (at, actor, role, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(db.nowIso(), actor, role, String(action), target,
          detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)),
          ip);
  } catch {
    /* The audit log must never break the request that triggered it. */
  }
}

function list({ limit = 200, offset = 0, action = '', actor = '' } = {}) {
  const where = [];
  const values = [];
  if (action) { where.push('action = ?'); values.push(action); }
  if (actor) { where.push('actor = ?'); values.push(String(actor).toLowerCase()); }
  const sql = `SELECT * FROM audit ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT ? OFFSET ?`;
  values.push(Math.min(Math.max(Number(limit) || 200, 1), 1000), Math.max(Number(offset) || 0, 0));
  return db.get().prepare(sql).all(...values);
}

function count() { return db.get().prepare('SELECT COUNT(*) AS c FROM audit').get().c; }

module.exports = { log, list, count };
