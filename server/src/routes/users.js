'use strict';
/* routes/users.js – accounts and roles. Every route here is super-admin only, enforced by
   permissions.assert(role,'manageUsers'); Admin, Superuser and Viewer all receive 403.

   Changing someone's role or password ends their other sessions, so a demotion takes effect
   immediately rather than at their next sign-in. */

const users = require('../repos/users');
const sessions = require('../repos/sessions');
const requests = require('../repos/requests');
const audit = require('../repos/audit');
const permissions = require('../permissions');
const { readJson, sendJson, clientIp, badRequest, notFound } = require('../http');
const { requireUser } = require('../middleware');

/** Resolve the :id in the URL, which may be an email or the browser's underscore document id. */
function resolve(idOrEmail) {
  const raw = String(idOrEmail || '');
  return (raw.includes('@') ? users.byEmail(raw) : null) || users.byDocId(raw) || users.byEmail(raw);
}

function register(router) {
  /* ---- GET /api/users ---- */
  router.get('/api/users', async (req, res, ctx) => {
    const me = requireUser(ctx);
    permissions.assert(me.role, 'manageUsers');
    sendJson(res, 200, {
      users: users.list(),
      requests: requests.list(),
      roles: permissions.ROLES.map(r => permissions.describe(r)),
    });
  });

  /* ---- POST /api/users – add a colleague ---- */
  router.post('/api/users', async (req, res, ctx) => {
    const me = requireUser(ctx);
    permissions.assert(me.role, 'manageUsers');
    const body = await readJson(req);
    const created = users.create({
      email: body.email, name: body.name, role: body.role,
      password: body.password, externalId: body.externalId, createdBy: me.email,
    });
    /* Approving someone who was waiting clears their pending request. */
    if (body.requestId) requests.remove(body.requestId);
    audit.log({ actor: me.email, role: me.role, action: 'user.create', target: created.email,
                detail: { role: created.role }, ip: clientIp(req) });
    sendJson(res, 201, created);
  });

  /* ---- PATCH /api/users/:id – rename, change role, reset password ---- */
  router.patch('/api/users/:id', async (req, res, ctx) => {
    const me = requireUser(ctx);
    permissions.assert(me.role, 'manageUsers');
    const target = resolve(req.params.id);
    if (!target) throw notFound('No account with that email');

    const body = await readJson(req);
    const patch = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.role !== undefined) patch.role = body.role;
    if (body.password !== undefined && String(body.password) !== '') patch.password = body.password;
    if (body.externalId !== undefined) patch.externalId = body.externalId;

    if (target.email === me.email && patch.role && patch.role !== me.role) {
      throw badRequest('You cannot change your own role – ask another super admin', 'self_role');
    }
    const updated = users.update(target.email, patch);

    /* A new role or password must not leave an old session running with the old rights.
       When a super admin changes their own password here, their current session stays alive. */
    if (patch.role || patch.password) {
      if (updated.email === me.email && ctx.token) sessions.destroyOthers(updated.email, ctx.token);
      else sessions.destroyForEmail(updated.email);
    }
    audit.log({ actor: me.email, role: me.role, action: 'user.update', target: updated.email,
                detail: Object.keys(patch), ip: clientIp(req) });
    sendJson(res, 200, updated);
  });

  /* ---- DELETE /api/users/:id ---- */
  router.delete('/api/users/:id', async (req, res, ctx) => {
    const me = requireUser(ctx);
    permissions.assert(me.role, 'manageUsers');
    const target = resolve(req.params.id);
    if (!target) throw notFound('No account with that email');
    if (target.email === me.email) throw badRequest('You cannot remove your own account', 'self_delete');
    users.remove(target.email);
    sessions.destroyForEmail(target.email);
    audit.log({ actor: me.email, role: me.role, action: 'user.delete', target: target.email,
                detail: { role: target.role }, ip: clientIp(req) });
    sendJson(res, 200, { ok: true, email: target.email });
  });

  /* ---- GET /api/users/:id/sessions – where an account is currently signed in ---- */
  router.get('/api/users/:id/sessions', async (req, res, ctx) => {
    const me = requireUser(ctx);
    permissions.assert(me.role, 'manageUsers');
    const target = resolve(req.params.id);
    if (!target) throw notFound('No account with that email');
    sendJson(res, 200, { email: target.email, sessions: sessions.listForEmail(target.email) });
  });

  /* ---- Access requests ---- */

  /* Anyone who opens the page may announce themselves; the super admin decides. */
  router.post('/api/requests', async (req, res, ctx) => {
    const body = await readJson(req);
    const id = String(body.id || body.email || '').trim();
    if (!id) throw badRequest('A request needs an id or an email', 'bad_request_id');
    const saved = requests.put(id, { email: body.email, name: body.name });
    sendJson(res, saved.existing ? 200 : 201, { ok: true, id: saved.id });
  });

  router.get('/api/requests', async (req, res, ctx) => {
    const me = requireUser(ctx);
    permissions.assert(me.role, 'manageUsers');
    sendJson(res, 200, { requests: requests.list() });
  });

  router.delete('/api/requests/:id', async (req, res, ctx) => {
    const me = requireUser(ctx);
    permissions.assert(me.role, 'manageUsers');
    requests.remove(req.params.id);
    audit.log({ actor: me.email, role: me.role, action: 'request.remove', target: req.params.id, ip: clientIp(req) });
    sendJson(res, 200, { ok: true, id: req.params.id });
  });
}

module.exports = { register };
