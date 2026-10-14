'use strict';
/* routes/auth.js – signing in and out, who am I, and changing your own password. */

const config = require('../config');
const users = require('../repos/users');
const sessions = require('../repos/sessions');
const audit = require('../repos/audit');
const permissions = require('../permissions');
const { verifyPassword } = require('../crypto');
const { readJson, sendJson, setCookie, clearCookie, clientIp, badRequest, unauthorized, tooMany } = require('../http');
const { loginLimiter, requireUser } = require('../middleware');

/** The payload the browser receives about the signed-in person. */
function sessionPayload(user, csrf, expiresAt, token) {
  return {
    user: { email: user.email, name: user.name, role: user.role, id: user.id },
    permissions: permissions.describe(user.role),
    csrf,
    expiresAt,
    token,            // for API clients that cannot use cookies
  };
}

function register(router) {
  /* ---- POST /api/auth/login ---- */
  router.post('/api/auth/login', async (req, res, ctx) => {
    const body = await readJson(req);
    const email = users.normalizeEmail(body.email);
    const password = String(body.password || '');
    const ip = clientIp(req);

    if (!email || !password) throw badRequest('Enter your email and password', 'missing_credentials');

    const key = `${email}|${ip}`;
    const gate = loginLimiter.hit(key);
    if (!gate.ok) {
      audit.log({ actor: email, action: 'login.blocked', detail: 'rate limited', ip });
      const err = tooMany(`Too many sign-in attempts. Try again in ${Math.ceil(gate.retryAfter / 60)} minute(s).`);
      err.retryAfter = gate.retryAfter;
      throw err;
    }

    const row = users.rawByEmail(email);
    /* Always run a hash comparison so a missing account and a wrong password take the same time. */
    const ok = row ? verifyPassword(password, row.password) : verifyPassword(password, 'scrypt$16384$8$1$AAAA$AAAA');
    if (!row || !ok) {
      audit.log({ actor: email, action: 'login.failed', ip });
      throw unauthorized('Email or password is not correct');
    }

    loginLimiter.reset(key);
    const { token, csrf, expiresAt } = sessions.create(row.email, { userAgent: req.headers['user-agent'] || '', ip });
    users.touchLogin(row.email);
    audit.log({ actor: row.email, role: row.role, action: 'login', ip });

    const maxAge = config.sessionTtlHours * 3600;
    setCookie(res, config.sessionCookie, token, { maxAge, httpOnly: true });
    setCookie(res, config.csrfCookie, csrf, { maxAge, httpOnly: false });

    sendJson(res, 200, sessionPayload(users.publicUser(row), csrf, expiresAt, token));
  });

  /* ---- POST /api/auth/logout ---- */
  router.post('/api/auth/logout', async (req, res, ctx) => {
    if (ctx.token) sessions.destroy(ctx.token);
    if (ctx.user) audit.log({ actor: ctx.user.email, role: ctx.user.role, action: 'logout', ip: clientIp(req) });
    clearCookie(res, config.sessionCookie);
    clearCookie(res, config.csrfCookie, { httpOnly: false });
    sendJson(res, 200, { ok: true });
  });

  /* ---- GET /api/auth/me – also tells a signed-out browser whether any account exists yet ---- */
  router.get('/api/auth/me', async (req, res, ctx) => {
    if (!ctx.user) {
      return sendJson(res, 200, {
        user: null,
        permissions: null,
        setupRequired: users.count() === 0,
        roles: permissions.ROLES.map(r => permissions.describe(r)),
      });
    }
    const expiresAt = sessions.touch(ctx.token);
    sendJson(res, 200, {
      ...sessionPayload(ctx.user, ctx.session.csrf, expiresAt),
      setupRequired: false,
      roles: permissions.ROLES.map(r => permissions.describe(r)),
    });
  });

  /* ---- POST /api/auth/password – change your own password ---- */
  router.post('/api/auth/password', async (req, res, ctx) => {
    const me = requireUser(ctx);
    const body = await readJson(req);
    const current = String(body.currentPassword || '');
    const next = String(body.newPassword || '');
    if (next.length < 4) throw badRequest('The new password must be at least 4 characters', 'bad_password');

    const row = users.rawByEmail(me.email);
    if (!row || !verifyPassword(current, row.password)) {
      throw unauthorized('Your current password is not correct');
    }
    users.update(me.email, { password: next });
    /* Every other sign-in of this account is ended; this one keeps working. */
    const token = ctx.token;
    sessions.destroyForEmail(me.email);
    const fresh = sessions.create(me.email, { userAgent: req.headers['user-agent'] || '', ip: clientIp(req) });
    const maxAge = config.sessionTtlHours * 3600;
    setCookie(res, config.sessionCookie, fresh.token, { maxAge, httpOnly: true });
    setCookie(res, config.csrfCookie, fresh.csrf, { maxAge, httpOnly: false });
    audit.log({ actor: me.email, role: me.role, action: 'password.change', ip: clientIp(req) });
    sendJson(res, 200, { ok: true, csrf: fresh.csrf, token: fresh.token, expiresAt: fresh.expiresAt, replaced: Boolean(token) });
  });

  /* ---- POST /api/auth/setup – create the first super admin, only while no account exists ---- */
  router.post('/api/auth/setup', async (req, res, ctx) => {
    if (users.count() > 0) throw badRequest('Setup has already been completed – please sign in', 'already_setup');
    const body = await readJson(req);
    const created = users.create({
      email: body.email, name: body.name, role: 'superadmin',
      password: body.password, createdBy: 'setup',
    });
    const ip = clientIp(req);
    const { token, csrf, expiresAt } = sessions.create(created.email, { userAgent: req.headers['user-agent'] || '', ip });
    const maxAge = config.sessionTtlHours * 3600;
    setCookie(res, config.sessionCookie, token, { maxAge, httpOnly: true });
    setCookie(res, config.csrfCookie, csrf, { maxAge, httpOnly: false });
    audit.log({ actor: created.email, role: 'superadmin', action: 'setup', ip });
    sendJson(res, 201, sessionPayload(created, csrf, expiresAt, token));
  });
}

module.exports = { register, sessionPayload };
