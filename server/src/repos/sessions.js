'use strict';
/* repos/sessions.js – active sign-ins.
   The token the browser holds is random; only its SHA-256 is stored, so a copy of the
   database cannot be replayed as a live session. */

const db = require('../db');
const config = require('../config');
const { randomToken, sha256 } = require('../crypto');

function create(email, { userAgent = '', ip = '' } = {}) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlHours * 3600 * 1000);
  db.get().prepare(
    `INSERT INTO sessions (token_hash, email, csrf, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sha256(token), String(email).toLowerCase(), csrf,
        now.toISOString(), expires.toISOString(), String(userAgent).slice(0, 300), String(ip).slice(0, 60));
  return { token, csrf, expiresAt: expires.toISOString() };
}

/** Look a session up by its raw token. Returns null when missing or expired. */
function find(token) {
  if (!token) return null;
  const row = db.get().prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha256(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.get().prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return null;
  }
  return row;
}

/** Slide the expiry forward so an active person is not signed out mid-session. */
function touch(token) {
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000).toISOString();
  db.get().prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(expires, sha256(token));
  return expires;
}

function destroy(token) {
  if (!token) return 0;
  const res = db.get().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  return Number(res.changes || 0);
}

/** Sign a person out everywhere – used when their role changes or their account is removed. */
function destroyForEmail(email) {
  const res = db.get().prepare('DELETE FROM sessions WHERE email = ?').run(String(email).toLowerCase());
  return Number(res.changes || 0);
}

/** Sign a person out everywhere except the session they are using right now. */
function destroyOthers(email, keepToken) {
  const res = db.get().prepare('DELETE FROM sessions WHERE email = ? AND token_hash <> ?')
    .run(String(email).toLowerCase(), sha256(keepToken || ''));
  return Number(res.changes || 0);
}

function listForEmail(email) {
  return db.get().prepare(
    'SELECT created_at, expires_at, user_agent, ip FROM sessions WHERE email = ? ORDER BY created_at DESC'
  ).all(String(email).toLowerCase());
}

module.exports = { create, find, touch, destroy, destroyForEmail, destroyOthers, listForEmail };
