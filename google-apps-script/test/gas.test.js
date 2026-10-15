'use strict';
/* gas.test.js – tests the Google Sheets backend (Code.gs) before it is ever deployed.
   The Apps Script services are stood in for by test/harness.js; the code under test is the real
   file. Run with:  node --test google-apps-script/test/ */

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

/* A fresh spreadsheet, a super admin, and one account per role. */
function freshWorld() {
  const world = load();
  const { call, sandbox } = world;
  sandbox.setupTracker();

  const boss = call('login', { email: 'admin@tracker.com', password: 'Admin@1234' });
  assert.ok(boss.token, 'the seeded super admin should be able to sign in');

  const tokens = { superadmin: boss.token };
  const accounts = [
    { email: 'amina@example.com', name: 'Amina', role: 'admin', password: 'adminpw' },
    { email: 'sohel@example.com', name: 'Sohel', role: 'superuser', password: 'superpw' },
    { email: 'vik@example.com', name: 'Vik', role: 'viewer', password: 'viewerpw' },
  ];
  for (const account of accounts) {
    const res = call('createUser', { ...account, token: tokens.superadmin });
    assert.ok(!res.error, `creating ${account.role}: ${JSON.stringify(res.error)}`);
    tokens[account.role] = call('login', { email: account.email, password: account.password }).token;
  }
  return { ...world, tokens };
}

test('setup creates the sheets and one super admin', () => {
  const { call, spreadsheet, sandbox } = load();
  assert.equal(call('health').setupRequired, true);
  sandbox.setupTracker();

  for (const name of ['Users', 'Items', 'Sessions', 'Requests', 'Archive', 'Audit']) {
    assert.ok(spreadsheet.getSheetByName(name), `the ${name} tab should exist`);
  }
  assert.equal(call('health').setupRequired, false);

  /* The password is hashed in the sheet, never stored as typed. */
  const users = spreadsheet.getSheetByName('Users');
  const row = users.getRange(2, 1, 1, 9).getValues()[0];
  assert.equal(row[0], 'admin@tracker.com');
  assert.match(String(row[3]), /^sha256\$\d+\$/);
  assert.ok(!String(row[3]).includes('Admin@1234'));
});

test('setup cannot be run twice to grab a second super admin', () => {
  const { call, sandbox } = load();
  sandbox.setupTracker();
  const res = call('setup', { name: 'Intruder', email: 'intruder@example.com', password: 'hunter2' });
  assert.equal(res.error.code, 'already_setup');
});

test('a wrong password is refused and a right one is accepted', () => {
  const { call, sandbox } = load();
  sandbox.setupTracker();
  assert.equal(call('login', { email: 'admin@tracker.com', password: 'wrong' }).error.code, 'unauthorized');
  assert.ok(call('login', { email: 'ADMIN@Tracker.com', password: 'Admin@1234' }).token, 'email case must not matter');
});

/* ---------------------------------------------------------------- SUPERUSER */
test('superuser: is told it may write Tasks only', () => {
  const { call, tokens } = freshWorld();
  const me = call('me', { token: tokens.superuser });
  assert.equal(me.user.role, 'superuser');
  assert.deepEqual(me.permissions.writableTypes, ['Task']);
  assert.equal(me.permissions.export, true);
  assert.equal(me.permissions.manageUsers, false);
});

test('superuser: can create, edit, change status of and delete a Task', () => {
  const { call, tokens } = freshWorld();
  const created = call('saveItem', {
    token: tokens.superuser,
    item: { type: 'Task', title: 'Replace UPS battery', f1: 'Sohel', pri: 'High' },
  });
  assert.ok(!created.error, JSON.stringify(created.error));
  assert.match(created.id, /^T-\d+$/);
  assert.equal(created.s, 'Ongoing');
  assert.equal(created.createdBy, 'sohel@example.com');

  const edited = call('saveItem', { token: tokens.superuser, id: created.id, item: { s: 'On Hold', title: 'UPS battery – HO' } });
  assert.equal(edited.s, 'On Hold');
  assert.equal(edited.title, 'UPS battery – HO');
  assert.equal(edited.type, 'Task', 'the type must survive a partial edit');

  assert.equal(call('deleteItem', { token: tokens.superuser, id: created.id }).ok, true);
  assert.equal(call('listItems', { token: tokens.superuser }).items.length, 0);
});

test('superuser: cannot create a Project or a Recurring item', () => {
  const { call, tokens } = freshWorld();
  for (const type of ['Project', 'Drive']) {
    const res = call('saveItem', { token: tokens.superuser, item: { type, title: 'No', f1: 'Sohel' } });
    assert.equal(res.error.code, 'forbidden', type);
    assert.match(res.error.message, /Superuser/);
  }
});

test('superuser: cannot touch a Project by pretending it is a Task', () => {
  const { call, tokens } = freshWorld();
  const project = call('saveItem', { token: tokens.admin, item: { type: 'Project', title: 'Core banking DR', f1: 'Amina' } });
  assert.match(project.id, /^P-\d+$/);

  const sneaky = call('saveItem', { token: tokens.superuser, id: project.id, item: { type: 'Task', title: 'hijacked' } });
  assert.equal(sneaky.error.code, 'forbidden');

  assert.equal(call('deleteItem', { token: tokens.superuser, id: project.id }).error.code, 'forbidden');
  assert.equal(call('listItems', { token: tokens.superuser }).items[0].title, 'Core banking DR');
});

test('superuser: sees everything and may export, but not manage users', () => {
  const { call, tokens } = freshWorld();
  call('saveItem', { token: tokens.admin, item: { type: 'Project', title: 'Visible', f1: 'Amina' } });

  assert.equal(call('listItems', { token: tokens.superuser }).items.length, 1);
  assert.equal(typeof call('stats', { token: tokens.superuser }).total, 'number');

  const exported = call('exportData', { token: tokens.superuser });
  assert.equal(exported.rows.length, 1);
  assert.equal(exported.columns[0], 'ID');

  assert.equal(call('listUsers', { token: tokens.superuser }).error.code, 'forbidden');
  assert.equal(call('audit', { token: tokens.superuser }).error.code, 'forbidden');
});

/* ---------------------------------------------------------------- ADMIN */
test('admin: may write every type but not manage users', () => {
  const { call, tokens } = freshWorld();
  const ids = [];
  for (const [type, title] of [['Project', 'Wi-Fi rollout'], ['Drive', 'Backup test'], ['Task', 'Renew SSL']]) {
    const res = call('saveItem', { token: tokens.admin, item: { type, title, f1: 'Amina' } });
    assert.ok(!res.error, `${type}: ${JSON.stringify(res.error)}`);
    ids.push(res.id);
  }
  assert.match(ids[0], /^P-/); assert.match(ids[1], /^D-/); assert.match(ids[2], /^T-/);

  assert.ok(!call('exportData', { token: tokens.admin }).error);
  assert.equal(call('listUsers', { token: tokens.admin }).error.code, 'forbidden');
  assert.equal(call('createUser', {
    token: tokens.admin, email: 'x@y.com', name: 'X', role: 'admin', password: 'pw12',
  }).error.code, 'forbidden');
});

/* ---------------------------------------------------------------- VIEWER */
test('viewer: reads everything and changes nothing', () => {
  const { call, tokens } = freshWorld();
  const item = call('saveItem', { token: tokens.admin, item: { type: 'Task', title: 'Look only', f1: 'Amina' } });

  assert.equal(call('listItems', { token: tokens.viewer }).items.length, 1);
  assert.ok(!call('stats', { token: tokens.viewer }).error);

  for (const type of ['Project', 'Drive', 'Task']) {
    assert.equal(call('saveItem', { token: tokens.viewer, item: { type, title: 'No', f1: 'Vik' } }).error.code, 'forbidden');
  }
  assert.equal(call('saveItem', { token: tokens.viewer, id: item.id, item: { s: 'Done' } }).error.code, 'forbidden');
  assert.equal(call('deleteItem', { token: tokens.viewer, id: item.id }).error.code, 'forbidden');

  const exported = call('exportData', { token: tokens.viewer });
  assert.equal(exported.error.code, 'forbidden');
  assert.match(exported.error.message, /download or print/);
});

/* ---------------------------------------------------------------- SUPER ADMIN */
test('super admin: manages users without ever exposing a password', () => {
  const { call, tokens } = freshWorld();
  const list = call('listUsers', { token: tokens.superadmin });
  assert.equal(list.users.length, 4);
  for (const u of list.users) assert.ok(!('password' in u), `${u.email} leaked its password`);
});

test('super admin: a role change ends the old sessions immediately', () => {
  const { call, tokens } = freshWorld();
  assert.equal(call('me', { token: tokens.viewer }).user.role, 'viewer');

  const changed = call('updateUser', { token: tokens.superadmin, email: 'vik@example.com', role: 'admin' });
  assert.equal(changed.role, 'admin');

  /* The old token is dead, so stale rights cannot linger. */
  assert.equal(call('me', { token: tokens.viewer }).user, null);

  const fresh = call('login', { email: 'vik@example.com', password: 'viewerpw' }).token;
  assert.ok(!call('saveItem', { token: fresh, item: { type: 'Project', title: 'Now allowed', f1: 'Vik' } }).error);
});

test('super admin: resets a password, and only the new one works', () => {
  const { call, tokens } = freshWorld();
  assert.ok(!call('updateUser', { token: tokens.superadmin, email: 'sohel@example.com', password: 'brandnew' }).error);
  assert.equal(call('login', { email: 'sohel@example.com', password: 'superpw' }).error.code, 'unauthorized');
  assert.ok(call('login', { email: 'sohel@example.com', password: 'brandnew' }).token);
});

test('super admin: cannot lock everyone out', () => {
  const { call, tokens } = freshWorld();
  assert.equal(call('updateUser', { token: tokens.superadmin, email: 'admin@tracker.com', role: 'viewer' }).error.code, 'self_role');
  assert.equal(call('deleteUser', { token: tokens.superadmin, email: 'admin@tracker.com' }).error.code, 'self_delete');
});

test('super admin: duplicate emails are refused', () => {
  const { call, tokens } = freshWorld();
  const res = call('createUser', {
    token: tokens.superadmin, email: 'Amina@Example.com', name: 'Copy', role: 'viewer', password: 'pw1234',
  });
  assert.equal(res.error.code, 'conflict');
});

test('super admin: removing an account also ends its session', () => {
  const { call, tokens } = freshWorld();
  assert.ok(call('deleteUser', { token: tokens.superadmin, email: 'vik@example.com' }).ok);
  assert.equal(call('me', { token: tokens.viewer }).user, null);
  assert.equal(call('listItems', { token: tokens.viewer }).error.code, 'unauthorized');
});

test('super admin: the audit log records what happened', () => {
  const { call, tokens } = freshWorld();
  call('saveItem', { token: tokens.admin, item: { type: 'Task', title: 'Audited', f1: 'Amina' } });
  call('exportData', { token: tokens.admin });

  const log = call('audit', { token: tokens.superadmin });
  const actions = log.entries.map(e => e.action);
  for (const expected of ['login', 'user.create', 'item.create', 'export']) {
    assert.ok(actions.includes(expected), `the audit log should record "${expected}"`);
  }
});

/* ---------------------------------------------------------------- access and validation */
test('no token means no access', () => {
  const { call } = freshWorld();
  for (const action of ['listItems', 'stats', 'exportData', 'listUsers', 'audit']) {
    assert.equal(call(action).error.code, 'unauthorized', action);
  }
  assert.equal(call('listItems', { token: 'made-up' }).error.code, 'unauthorized');
});

test('signing out stops the token working', () => {
  const { call, tokens } = freshWorld();
  assert.ok(call('logout', { token: tokens.admin }).ok);
  assert.equal(call('listItems', { token: tokens.admin }).error.code, 'unauthorized');
});

test('items are validated rather than trusted', () => {
  const { call, tokens } = freshWorld();
  const cases = [
    [{ type: 'Nonsense', title: 'x', f1: 'y' }, 'bad_type'],
    [{ type: 'Task', title: '', f1: 'y' }, 'bad_title'],
    [{ type: 'Task', title: 'x', f1: '' }, 'bad_focal'],
    [{ type: 'Task', title: 'x', f1: 'y', s: 'Flying' }, 'bad_status'],
    [{ type: 'Task', title: 'x', f1: 'y', pri: 'Urgent' }, 'bad_priority'],
    [{ type: 'Task', title: 'x', f1: 'y', sd: '14-10-2026' }, 'bad_date'],
  ];
  for (const [item, code] of cases) {
    assert.equal(call('saveItem', { token: tokens.admin, item }).error.code, code, JSON.stringify(item));
  }
});

test('accounts are validated too', () => {
  const { call, tokens } = freshWorld();
  const base = { token: tokens.superadmin, name: 'X', role: 'admin', password: 'pw12' };
  assert.equal(call('createUser', { ...base, email: 'not-an-email' }).error.code, 'bad_email');
  assert.equal(call('createUser', { ...base, email: 'a@b.com', role: 'wizard' }).error.code, 'bad_role');
  assert.equal(call('createUser', { ...base, email: 'a@b.com', password: 'x' }).error.code, 'bad_password');
  assert.equal(call('createUser', { ...base, email: 'a@b.com', name: '' }).error.code, 'bad_name');
});

test('repeated wrong passwords are throttled', () => {
  const { call } = freshWorld();
  let blocked = false;
  for (let i = 0; i < 12; i++) {
    const res = call('login', { email: 'admin@tracker.com', password: 'wrong' });
    if (res.error.code === 'rate_limited') { blocked = true; break; }
  }
  assert.ok(blocked, 'the script should start refusing after several failed attempts');
});

test('changing your own password needs the current one', () => {
  const { call, tokens } = freshWorld();
  const refused = call('changePassword', { token: tokens.admin, currentPassword: 'nope', newPassword: 'longenough' });
  assert.equal(refused.error.code, 'bad_current');
  assert.equal(refused.error.status, 400, 'a mistyped password must not look like an expired session');
  assert.equal(call('me', { token: tokens.admin }).user.email, 'amina@example.com', 'and must not sign them out');

  const ok = call('changePassword', { token: tokens.admin, currentPassword: 'adminpw', newPassword: 'adminpw2' });
  assert.equal(ok.ok, true);
  assert.equal(call('me', { token: tokens.admin }).user.email, 'amina@example.com',
    'the device you changed it on stays signed in');
  assert.equal(call('login', { email: 'amina@example.com', password: 'adminpw' }).error.code, 'unauthorized');
  assert.ok(call('login', { email: 'amina@example.com', password: 'adminpw2' }).token);
});

test('access requests: anyone may ask, only the super admin may approve', () => {
  const { call, tokens } = freshWorld();
  assert.equal(call('createRequest', { id: 'visitor-1', email: 'new@example.com', name: 'New Person' }).ok, true);
  assert.equal(call('deleteRequest', { token: tokens.viewer, id: 'visitor-1' }).error.code, 'forbidden');
  assert.equal(call('listUsers', { token: tokens.superadmin }).requests.length, 1);

  const approved = call('createUser', {
    token: tokens.superadmin, email: 'new@example.com', name: 'New Person',
    role: 'superuser', password: 'welcome1', requestId: 'visitor-1',
  });
  assert.ok(!approved.error);
  assert.equal(call('listUsers', { token: tokens.superadmin }).requests.length, 0);
});

test('item ids keep counting up per type', () => {
  const { call, tokens } = freshWorld();
  const a = call('saveItem', { token: tokens.admin, item: { type: 'Task', title: 'One', f1: 'A' } });
  const b = call('saveItem', { token: tokens.admin, item: { type: 'Task', title: 'Two', f1: 'A' } });
  const p = call('saveItem', { token: tokens.admin, item: { type: 'Project', title: 'Three', f1: 'A' } });
  assert.equal(Number(b.id.slice(2)), Number(a.id.slice(2)) + 1);
  assert.match(p.id, /^P-1$/, 'each type numbers independently');

  /* Deleting the newest and adding again must not reuse a live id. */
  call('deleteItem', { token: tokens.admin, id: b.id });
  const c = call('saveItem', { token: tokens.admin, item: { type: 'Task', title: 'Four', f1: 'A' } });
  assert.notEqual(c.id, a.id);
});

test('the archive round-trips through the sheet', () => {
  const { call, tokens } = freshWorld();
  const rows = [{ id: 'T-900', type: 'Task', title: 'Old task', s: 'Done', f1: 'A' }];
  assert.ok(!call('saveArchive', { token: tokens.admin, id: 'batch-1', rows }).error);

  const back = call('listArchive', { token: tokens.viewer });
  assert.equal(back.batches.length, 1);
  assert.deepEqual(back.batches[0].rows, rows);

  assert.equal(call('saveArchive', { token: tokens.superuser, id: 'batch-2', rows: [] }).error.code, 'forbidden');
});

test('unknown actions are reported, not silently ignored', () => {
  const { call, tokens } = freshWorld();
  assert.equal(call('dropAllTables', { token: tokens.superadmin }).error.code, 'not_found');
});

/* ---------------------------------------------------------------- sample data helpers */
test('addSampleData fills the sheet and is safe to run twice', () => {
  const { call, sandbox, tokens } = freshWorld();

  const added = sandbox.addSampleData();
  assert.equal(added, 13, 'all thirteen sample rows should be written');

  const items = call('listItems', { token: tokens.viewer }).items;
  assert.equal(items.length, 13);
  assert.equal(items.filter(i => i.type === 'Project').length, 5);
  assert.equal(items.filter(i => i.type === 'Drive').length, 3);
  assert.equal(items.filter(i => i.type === 'Task').length, 5);

  /* ids are numbered per type and the fields the page needs are populated */
  const dr = items.find(i => i.title === 'Core banking DR site');
  assert.match(dr.id, /^P-\d+$/);
  assert.equal(dr.s, 'Ongoing');
  assert.equal(dr.pri, 'High');
  assert.equal(dr.f1, 'Rafiqul Islam');
  assert.ok(dr.ms.includes('\n'), 'milestones are stored one per line');

  /* the dashboard figures add up */
  const stats = call('stats', { token: tokens.viewer });
  assert.equal(stats.total, 13);
  assert.equal(stats.byType.Project.total, 5);
  assert.ok(stats.people.includes('Rafiqul Islam'));

  /* running it again adds nothing */
  assert.equal(sandbox.addSampleData(), 0);
  assert.equal(call('listItems', { token: tokens.viewer }).items.length, 13);
});

test('addSampleUsers creates one working account per role', () => {
  const { call, sandbox } = freshWorld();
  assert.equal(sandbox.addSampleUsers(), 3);

  const checks = [
    ['admin2@tracker.com', 'Admin2@1234', 'admin'],
    ['superuser@tracker.com', 'Super@1234', 'superuser'],
    ['viewer@tracker.com', 'Viewer@1234', 'viewer'],
  ];
  for (const [email, password, role] of checks) {
    const session = call('login', { email, password });
    assert.ok(session.token, `${email} should be able to sign in`);
    assert.equal(session.user.role, role);
  }
  assert.equal(sandbox.addSampleUsers(), 0, 'running it again changes nothing');
});

test('checkDeployment reports a healthy install and spots a broken one', () => {
  const { sandbox } = freshWorld();
  /* the array comes from the sandbox's own realm, so compare its contents, not its identity */
  assert.equal(sandbox.checkDeployment().length, 0, 'a fresh install has no problems');

  /* a password typed straight into the sheet instead of being hashed is caught */
  const users = sandbox.readTable_('users');
  users[1].password = 'plaintext123';
  sandbox.writeTable_('users', users);
  const problems = sandbox.checkDeployment();
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not hashed/);
});

/* ---------------------------------------------------------------- forgotten password */
function codeFromOutbox(outbox) {
  const mail = outbox[outbox.length - 1];
  assert.ok(mail, 'an email should have been sent');
  const match = String(mail.subject + ' ' + mail.body).match(/\b(\d{6})\b/);
  assert.ok(match, 'the email should carry a six-digit code');
  return match[1];
}

test('forgot password: a code arrives by email and changes the password', () => {
  const { call, outbox } = freshWorld();

  const asked = call('forgotPassword', { email: 'sohel@example.com' });
  assert.equal(asked.ok, true);
  assert.match(asked.message, /six-digit code/);

  const mail = outbox[outbox.length - 1];
  assert.equal(mail.to, 'sohel@example.com');
  assert.match(mail.subject, /password code/i);
  assert.ok(mail.htmlBody.includes('Sohel'), 'the email greets the person by name');

  const code = codeFromOutbox(outbox);
  const done = call('resetPassword', { email: 'sohel@example.com', code, newPassword: 'freshpass' });
  assert.equal(done.ok, true);

  assert.equal(call('login', { email: 'sohel@example.com', password: 'superpw' }).error.code, 'unauthorized');
  const session = call('login', { email: 'sohel@example.com', password: 'freshpass' });
  assert.ok(session.token);
  assert.equal(session.user.role, 'superuser', 'the role is untouched by a password reset');
});

test('forgot password: the code is not stored in a usable form', () => {
  const { call, sandbox, outbox } = freshWorld();
  call('forgotPassword', { email: 'vik@example.com' });
  const code = codeFromOutbox(outbox);

  const rows = sandbox.readTable_('resets');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'vik@example.com');
  assert.ok(!String(rows[0].codeHash).includes(code), 'the sheet must not hold the code itself');
  assert.equal(String(rows[0].codeHash).length, 64, 'it holds a SHA-256 hash instead');
});

test('forgot password: an unknown address gets the same answer and no email', () => {
  const { call, outbox } = freshWorld();
  const before = outbox.length;
  const res = call('forgotPassword', { email: 'nobody@example.com' });
  assert.equal(res.ok, true, 'the answer must not reveal who has an account');
  assert.match(res.message, /If that address has an account/);
  assert.equal(outbox.length, before, 'but nothing is actually sent');
});

test('forgot password: a wrong code is refused and runs out of tries', () => {
  const { call, outbox } = freshWorld();
  call('forgotPassword', { email: 'vik@example.com' });
  const code = codeFromOutbox(outbox);
  const wrong = code === '000000' ? '111111' : '000000';

  for (let i = 1; i <= 5; i++) {
    const res = call('resetPassword', { email: 'vik@example.com', code: wrong, newPassword: 'whatever1' });
    assert.equal(res.error.code, 'bad_code', `attempt ${i}`);
  }
  /* the sixth attempt throws the code away, so even the right one no longer works */
  assert.equal(call('resetPassword', { email: 'vik@example.com', code: wrong, newPassword: 'whatever1' }).error.code, 'too_many_tries');
  assert.equal(call('resetPassword', { email: 'vik@example.com', code, newPassword: 'whatever1' }).error.code, 'bad_code');
  assert.ok(call('login', { email: 'vik@example.com', password: 'viewerpw' }).token, 'the old password still works');
});

test('forgot password: an expired code is refused', () => {
  const { call, sandbox, outbox } = freshWorld();
  call('forgotPassword', { email: 'vik@example.com' });
  const code = codeFromOutbox(outbox);

  const rows = sandbox.readTable_('resets');
  rows[0].expiresAt = new Date(Date.now() - 60000).toISOString();
  sandbox.writeTable_('resets', rows);

  const res = call('resetPassword', { email: 'vik@example.com', code, newPassword: 'whatever1' });
  assert.equal(res.error.code, 'expired_code');
  assert.equal(sandbox.readTable_('resets').length, 0, 'the spent code is cleared away');
});

test('forgot password: a code cannot be used twice', () => {
  const { call, outbox } = freshWorld();
  call('forgotPassword', { email: 'vik@example.com' });
  const code = codeFromOutbox(outbox);
  assert.equal(call('resetPassword', { email: 'vik@example.com', code, newPassword: 'firstpass' }).ok, true);
  assert.equal(call('resetPassword', { email: 'vik@example.com', code, newPassword: 'secondpass' }).error.code, 'bad_code');
  assert.ok(call('login', { email: 'vik@example.com', password: 'firstpass' }).token);
});

test('forgot password: a reset signs that person out everywhere', () => {
  const { call, tokens, outbox } = freshWorld();
  assert.equal(call('me', { token: tokens.viewer }).user.email, 'vik@example.com');

  call('forgotPassword', { email: 'vik@example.com' });
  call('resetPassword', { email: 'vik@example.com', code: codeFromOutbox(outbox), newPassword: 'brandnew1' });

  assert.equal(call('me', { token: tokens.viewer }).user, null, 'the old session is dead');
});

test('forgot password: one address cannot be used to send a flood of email', () => {
  const { call, outbox } = freshWorld();
  let blocked = false;
  for (let i = 0; i < 10; i++) {
    const res = call('forgotPassword', { email: 'vik@example.com' });
    if (res.error && res.error.code === 'rate_limited') { blocked = true; break; }
  }
  assert.ok(blocked, 'the script should stop sending after several requests');
  assert.ok(outbox.length <= 5, `at most five emails, got ${outbox.length}`);
});

test('forgot password: input is checked', () => {
  const { call, outbox } = freshWorld();
  assert.equal(call('forgotPassword', { email: 'not-an-email' }).error.code, 'bad_email');
  call('forgotPassword', { email: 'vik@example.com' });
  const code = codeFromOutbox(outbox);
  assert.equal(call('resetPassword', { email: 'vik@example.com', code, newPassword: 'ab' }).error.code, 'bad_password');
  assert.equal(call('resetPassword', { email: 'vik@example.com', code: '', newPassword: 'goodpass' }).error.code, 'bad_code');
});

test('forgot password: works without being signed in', () => {
  const { call } = freshWorld();
  /* no token is passed anywhere in this test, which is the whole point */
  const res = call('forgotPassword', { email: 'amina@example.com' });
  assert.equal(res.ok, true);
});

/* ---------------------------------------------------------------- own profile */
test('profile: anyone signed in can change their own name, but not their role', () => {
  const { call, tokens } = freshWorld();

  const updated = call('updateProfile', { token: tokens.viewer, name: 'Nadia R. Rahman' });
  assert.equal(updated.name, 'Nadia R. Rahman');
  assert.equal(updated.role, 'viewer', 'the role is untouched');
  assert.equal(call('me', { token: tokens.viewer }).user.name, 'Nadia R. Rahman');

  /* a role cannot be smuggled in through this endpoint */
  call('updateProfile', { token: tokens.viewer, name: 'Nadia', role: 'superadmin' });
  assert.equal(call('me', { token: tokens.viewer }).user.role, 'viewer');

  assert.equal(call('updateProfile', { token: tokens.viewer, name: '  ' }).error.code, 'bad_name');
  assert.equal(call('updateProfile', { name: 'Nobody' }).error.code, 'unauthorized');
});

test('changing your own password signs out your other devices only', () => {
  const { call } = freshWorld();
  const here = call('login', { email: 'vik@example.com', password: 'viewerpw' }).token;
  const elsewhere = call('login', { email: 'vik@example.com', password: 'viewerpw' }).token;

  assert.equal(call('changePassword', { token: here, currentPassword: 'viewerpw', newPassword: 'nextone1' }).ok, true);

  assert.equal(call('me', { token: here }).user.email, 'vik@example.com', 'this device stays signed in');
  assert.equal(call('me', { token: elsewhere }).user, null, 'the other device is signed out');
});
