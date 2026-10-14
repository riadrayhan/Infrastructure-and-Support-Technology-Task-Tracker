'use strict';
/* repos/users.js – reading and writing sign-in accounts.
   A user's password hash never leaves this module: `publicUser()` strips it. */

const db = require('../db');
const { hashPassword } = require('../crypto');
const { ROLES } = require('../permissions');
const { badRequest, conflict, notFound } = require('../http');

const normalizeEmail = e => String(e || '').trim().toLowerCase();

/* The browser builds its document id by replacing every run of non-alphanumeric characters with
   an underscore. We keep the same id so the existing frontend code addresses the same records. */
const docId = email => normalizeEmail(email).replace(/[^a-z0-9]+/g, '_') || 'x';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function publicUser(row) {
  if (!row) return null;
  return {
    id: docId(row.email),
    email: row.email,
    name: row.name,
    role: row.role,
    externalId: row.external_id || '',
    at: (row.created_at || '').slice(0, 10),
    by: row.created_by || '',
    updatedAt: row.updated_at || null,
    lastLogin: row.last_login || null,
  };
}

function list() {
  return db.get().prepare('SELECT * FROM users ORDER BY name COLLATE NOCASE').all().map(publicUser);
}

/** Internal: the full row including the password hash. Only auth.js should use this. */
function rawByEmail(email) {
  return db.get().prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) || null;
}

function byEmail(email) { return publicUser(rawByEmail(email)); }

function byDocId(id) {
  const row = db.get().prepare('SELECT * FROM users').all().find(u => docId(u.email) === String(id));
  return publicUser(row);
}

function byExternalId(externalId) {
  if (!externalId) return null;
  return publicUser(db.get().prepare('SELECT * FROM users WHERE external_id = ?').get(String(externalId)));
}

function count() { return db.get().prepare('SELECT COUNT(*) AS c FROM users').get().c; }

function countByRole(role) {
  return db.get().prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get(role).c;
}

function validate({ email, name, role, password }, { requirePassword = true } = {}) {
  const e = normalizeEmail(email);
  const n = String(name || '').trim();
  if (!EMAIL_RE.test(e)) throw badRequest('Enter a valid email address', 'bad_email');
  if (!n) throw badRequest('Enter a name', 'bad_name');
  if (n.length > 120) throw badRequest('That name is too long', 'bad_name');
  if (!ROLES.includes(role)) throw badRequest(`Role must be one of: ${ROLES.join(', ')}`, 'bad_role');
  if (requirePassword) {
    const p = String(password || '');
    if (p.length < 4) throw badRequest('The password must be at least 4 characters', 'bad_password');
    if (p.length > 200) throw badRequest('That password is too long', 'bad_password');
  }
  return { email: e, name: n, role };
}

function create({ email, name, role, password, externalId, createdBy }) {
  const clean = validate({ email, name, role, password });
  if (rawByEmail(clean.email)) throw conflict('This email already has an account');
  db.get().prepare(
    `INSERT INTO users (email, name, role, password, external_id, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(clean.email, clean.name, clean.role, hashPassword(password),
        externalId || null, db.nowIso(), createdBy || null);
  return byEmail(clean.email);
}

/** Patch a user. `patch` may contain name, role, password, externalId. */
function update(email, patch = {}) {
  const current = rawByEmail(email);
  if (!current) throw notFound('No account with that email');

  const sets = [];
  const values = [];

  if (patch.name !== undefined) {
    const n = String(patch.name).trim();
    if (!n) throw badRequest('Enter a name', 'bad_name');
    sets.push('name = ?'); values.push(n);
  }
  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role)) throw badRequest(`Role must be one of: ${ROLES.join(', ')}`, 'bad_role');
    /* Never allow the last super admin to lose that role – it would lock everyone out of user management. */
    if (current.role === 'superadmin' && patch.role !== 'superadmin' && countByRole('superadmin') <= 1) {
      throw badRequest('This is the only super admin – promote someone else first', 'last_superadmin');
    }
    sets.push('role = ?'); values.push(patch.role);
  }
  if (patch.password !== undefined) {
    const p = String(patch.password);
    if (p.length < 4) throw badRequest('The password must be at least 4 characters', 'bad_password');
    sets.push('password = ?'); values.push(hashPassword(p));
  }
  if (patch.externalId !== undefined) {
    sets.push('external_id = ?'); values.push(patch.externalId || null);
  }
  if (!sets.length) return publicUser(current);

  sets.push('updated_at = ?'); values.push(db.nowIso());
  values.push(current.email);
  db.get().prepare(`UPDATE users SET ${sets.join(', ')} WHERE email = ?`).run(...values);
  return byEmail(current.email);
}

function remove(email) {
  const current = rawByEmail(email);
  if (!current) throw notFound('No account with that email');
  if (current.role === 'superadmin' && countByRole('superadmin') <= 1) {
    throw badRequest('This is the only super admin – add another one first', 'last_superadmin');
  }
  db.get().prepare('DELETE FROM users WHERE email = ?').run(current.email);
  return { email: current.email };
}

function touchLogin(email) {
  db.get().prepare('UPDATE users SET last_login = ? WHERE email = ?').run(db.nowIso(), normalizeEmail(email));
}

module.exports = {
  normalizeEmail, docId, publicUser, list, byEmail, byDocId, byExternalId, rawByEmail,
  count, countByRole, validate, create, update, remove, touchLogin, EMAIL_RE,
};
