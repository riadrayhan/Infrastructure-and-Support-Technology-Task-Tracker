'use strict';
/* repos/resets.js – the one-time codes emailed by the "forgot password" flow.
   Only the hash of a code is stored, so the database never holds a usable code. */

const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { sha256 } = require('../crypto');

const normalize = e => String(e || '').trim().toLowerCase();

/** A six-digit code from a cryptographic source, not Math.random. */
function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

const hashCode = (email, code) => sha256(`reset:${normalize(email)}:${String(code)}`);

/** Replace any previous code for this address with a fresh one. */
function create(email, code) {
  const target = normalize(email);
  const expires = new Date(Date.now() + config.resetCodeMinutes * 60000).toISOString();
  db.get().prepare(
    `INSERT INTO password_resets (email, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,
       expires_at = excluded.expires_at, attempts = 0, created_at = excluded.created_at`
  ).run(target, hashCode(target, code), expires, db.nowIso());
  return { email: target, expiresAt: expires };
}

function find(email) {
  return db.get().prepare('SELECT * FROM password_resets WHERE email = ?').get(normalize(email)) || null;
}

function bumpAttempts(email) {
  db.get().prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE email = ?').run(normalize(email));
}

function remove(email) {
  db.get().prepare('DELETE FROM password_resets WHERE email = ?').run(normalize(email));
}

function purgeExpired() {
  const res = db.get().prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(db.nowIso());
  return Number(res.changes || 0);
}

/**
 * Check a submitted code. Returns {ok:true} or {ok:false, code, message} so the route can
 * answer without leaking which part was wrong beyond what the person needs to know.
 */
function verify(email, code) {
  const row = find(email);
  if (!row) return { ok: false, code: 'bad_code', message: 'No code is waiting for that address – ask for a new one' };

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    remove(email);
    return { ok: false, code: 'expired_code', message: 'That code has expired – ask for a new one' };
  }
  if (row.attempts >= config.resetMaxTries) {
    remove(email);
    return { ok: false, code: 'too_many_tries', message: 'Too many wrong codes – ask for a new one' };
  }
  const expected = Buffer.from(row.code_hash);
  const actual = Buffer.from(hashCode(email, String(code).replace(/\s+/g, '')));
  const same = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  if (!same) {
    bumpAttempts(email);
    const left = config.resetMaxTries - (row.attempts + 1);
    return {
      ok: false, code: 'bad_code',
      message: left > 0 ? `That code is not correct – ${left} tries left` : 'That code is not correct',
    };
  }
  return { ok: true };
}

module.exports = { newCode, hashCode, create, find, verify, remove, purgeExpired, bumpAttempts };
