'use strict';
/* repos/items.js – projects, recurring items and tasks.

   The shape matches exactly what the browser already uses, so no frontend rewrite is needed:
     id, type, title, s (status), pri, f1 (Focal-1), f2, sd (start), e (end),
     sh (stakeholder), ms (milestones), rm (remarks)
   Four extra audit columns are added by the server: created_at/by and updated_at/by. */

const db = require('../db');
const { TYPES } = require('../permissions');
const { badRequest, notFound } = require('../http');

const STATUSES = ['Ongoing', 'On Hold', 'Listed', 'Closed', 'Done'];
const PRIORITIES = ['High', 'Mid', 'Low'];
const PREFIX = { Project: 'P', Drive: 'D', Task: 'T' };

const FIELDS = ['id', 'type', 'title', 's', 'pri', 'f1', 'f2', 'sd', 'e', 'sh', 'ms', 'rm'];

const str = (v, max = 2000) => String(v === undefined || v === null ? '' : v).trim().slice(0, max);
const isDate = v => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

function toClient(row) {
  if (!row) return null;
  return {
    id: row.id, type: row.type, title: row.title, s: row.s, pri: row.pri,
    f1: row.f1, f2: row.f2, sd: row.sd, e: row.e, sh: row.sh, ms: row.ms, rm: row.rm,
    createdAt: row.created_at, createdBy: row.created_by,
    updatedAt: row.updated_at, updatedBy: row.updated_by,
  };
}

function list(filter = {}) {
  const where = [];
  const values = [];
  if (filter.type) { where.push('type = ?'); values.push(filter.type); }
  if (filter.status) { where.push('s = ?'); values.push(filter.status); }
  if (filter.person) {
    where.push('(LOWER(f1) LIKE ? OR LOWER(f2) LIKE ?)');
    const like = `%${String(filter.person).toLowerCase()}%`;
    values.push(like, like);
  }
  if (filter.q) {
    where.push('(LOWER(title) LIKE ? OR LOWER(id) LIKE ? OR LOWER(sh) LIKE ? OR LOWER(ms) LIKE ?)');
    const like = `%${String(filter.q).toLowerCase()}%`;
    values.push(like, like, like, like);
  }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY type, CAST(SUBSTR(id, 3) AS INTEGER)`;
  return db.get().prepare(sql).all(...values).map(toClient);
}

function byId(id) {
  return toClient(db.get().prepare('SELECT * FROM items WHERE id = ?').get(String(id)));
}

/** Next free id for a type: P-1, P-2, D-1, T-1 … (matches the browser's numbering). */
function nextId(type) {
  const prefix = `${PREFIX[type]}-`;
  const row = db.get().prepare(
    `SELECT MAX(CAST(SUBSTR(id, ?) AS INTEGER)) AS n FROM items WHERE id LIKE ?`
  ).get(prefix.length + 1, `${prefix}%`);
  return `${prefix}${(Number(row && row.n) || 0) + 1}`;
}

/** Validate and normalise an incoming item. Unknown fields are dropped. */
function clean(input = {}, { partial = false } = {}) {
  const out = {};
  const has = k => Object.prototype.hasOwnProperty.call(input, k);

  if (!partial || has('type')) {
    const type = str(input.type, 20);
    if (!TYPES.includes(type)) throw badRequest(`Type must be one of: ${TYPES.join(', ')}`, 'bad_type');
    out.type = type;
  }
  if (!partial || has('title')) {
    const title = str(input.title, 300);
    if (!title) throw badRequest('A name or title is required', 'bad_title');
    out.title = title;
  }
  if (!partial || has('f1')) {
    const f1 = str(input.f1, 120);
    if (!partial && !f1) throw badRequest('Focal-1 (lead) is required', 'bad_focal');
    if (partial && has('f1') && !f1) throw badRequest('Focal-1 (lead) is required', 'bad_focal');
    out.f1 = f1;
  }
  if (!partial || has('s')) {
    const s = str(input.s, 20) || 'Ongoing';
    if (!STATUSES.includes(s)) throw badRequest(`Status must be one of: ${STATUSES.join(', ')}`, 'bad_status');
    out.s = s;
  }
  if (!partial || has('pri')) {
    const pri = str(input.pri, 10) || 'Mid';
    if (!PRIORITIES.includes(pri)) throw badRequest(`Priority must be one of: ${PRIORITIES.join(', ')}`, 'bad_priority');
    out.pri = pri;
  }
  for (const [key, max] of [['f2', 120], ['sh', 200], ['rm', 2000], ['ms', 8000]]) {
    if (!partial || has(key)) out[key] = str(input[key], max);
  }
  for (const key of ['sd', 'e']) {
    if (!partial || has(key)) {
      const v = str(input[key], 10);
      if (!isDate(v)) throw badRequest(`${key === 'sd' ? 'Start' : 'End'} date must look like 2026-10-14`, 'bad_date');
      out[key] = v;
    }
  }
  return out;
}

function create(input, actor) {
  const data = clean(input);
  const id = /^[PDT]-\d+$/.test(String(input.id || '')) && !byId(input.id)
    ? String(input.id)
    : nextId(data.type);
  const now = db.nowIso();
  db.get().prepare(
    `INSERT INTO items (id, type, title, s, pri, f1, f2, sd, e, sh, ms, rm, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, data.type, data.title, data.s, data.pri, data.f1, data.f2,
        data.sd, data.e, data.sh, data.ms, data.rm, now, actor || null);
  return byId(id);
}

function update(id, patch, actor) {
  const current = byId(id);
  if (!current) throw notFound('That item no longer exists');
  const data = clean(patch, { partial: true });
  delete data.type;                       // an item never changes type once created
  const keys = Object.keys(data);
  if (!keys.length) return current;
  const sets = keys.map(k => `${k} = ?`).concat('updated_at = ?', 'updated_by = ?');
  const values = keys.map(k => data[k]).concat(db.nowIso(), actor || null, current.id);
  db.get().prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return byId(current.id);
}

function remove(id) {
  const current = byId(id);
  if (!current) throw notFound('That item no longer exists');
  db.get().prepare('DELETE FROM items WHERE id = ?').run(current.id);
  return current;
}

/** Replace an item wholesale (the browser's `set` call). Creates it when the id is unknown. */
function put(id, input, actor) {
  const existing = byId(id);
  if (!existing) return create({ ...input, id }, actor);
  return update(id, { ...input, type: undefined }, actor);
}

/* ---- archive ("taskhist" in the browser): batches of older rows kept read-only ---- */
function listArchive() {
  return db.get().prepare('SELECT * FROM archive_batches ORDER BY at').all().map(b => {
    let rows = [];
    try { rows = JSON.parse(b.rows); } catch { rows = []; }
    return { id: b.id, rows: Array.isArray(rows) ? rows : [], at: b.at };
  });
}

function putArchive(id, rows) {
  const list = Array.isArray(rows) ? rows : [];
  db.get().prepare('INSERT OR REPLACE INTO archive_batches (id, rows, at) VALUES (?, ?, ?)')
    .run(String(id), JSON.stringify(list), db.nowIso());
  return { id: String(id), rows: list };
}

function removeArchive(id) {
  db.get().prepare('DELETE FROM archive_batches WHERE id = ?').run(String(id));
  return { id: String(id) };
}

/** Counts per type and status, used by the dashboard and the exports. */
function stats() {
  const rows = db.get().prepare('SELECT type, s, COUNT(*) AS c FROM items GROUP BY type, s').all();
  const byType = {};
  for (const t of TYPES) {
    byType[t] = { total: 0 };
    for (const s of STATUSES) byType[t][s] = 0;
  }
  let total = 0;
  for (const r of rows) {
    if (!byType[r.type]) continue;
    byType[r.type][r.s] = r.c;
    byType[r.type].total += r.c;
    total += r.c;
  }
  const today = new Date().toISOString().slice(0, 10);
  const overdue = db.get().prepare(
    `SELECT COUNT(*) AS c FROM items WHERE s = 'Ongoing' AND e <> '' AND e < ?`
  ).get(today).c;
  return { total, overdue, byType, generatedAt: db.nowIso() };
}

module.exports = {
  STATUSES, PRIORITIES, TYPES, FIELDS,
  list, byId, nextId, clean, create, update, remove, put,
  listArchive, putArchive, removeArchive, stats, toClient,
};
