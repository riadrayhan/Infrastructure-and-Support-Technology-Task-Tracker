'use strict';
/* crypto.js – password hashing and token generation, using only Node's built-in crypto.

   Passwords are stored as  scrypt$N$r$p$<salt base64>$<hash base64>  – a slow hash with a random
   salt per user, so the stored value cannot be reversed and two people with the same password get
   different records. Comparison is timing-safe.

   The browser build hashes a password with SHA-256 before it reaches the network in local mode;
   that is irrelevant here – whatever arrives is treated as the secret and hashed again with scrypt. */

const crypto = require('node:crypto');

const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, params = PARAMS) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, params.keylen, {
    N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 6) return false;
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  if (!N || !r || !p) return false;
  let salt, expected;
  try {
    salt = Buffer.from(parts[4], 'base64');
    expected = Buffer.from(parts[5], 'base64');
  } catch { return false; }
  let actual;
  try {
    actual = crypto.scryptSync(String(password), salt, expected.length, {
      N, r, p, maxmem: 256 * 1024 * 1024,
    });
  } catch { return false; }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** URL-safe random token, used for session tokens and CSRF tokens. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Session tokens are stored hashed, so a copy of the database does not hand out live sessions. */
function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/** Constant-time string comparison for CSRF tokens and similar. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  if (x.length !== y.length || x.length === 0) return false;
  return crypto.timingSafeEqual(x, y);
}

module.exports = { hashPassword, verifyPassword, randomToken, sha256, safeEqual, PARAMS };
