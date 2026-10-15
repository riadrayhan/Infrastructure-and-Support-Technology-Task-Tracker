/**
 * Task and Project Tracker – Google Sheets backend (Google Apps Script)
 * =====================================================================
 *
 * A complete backend where the database is a Google Spreadsheet. Deploy this file as a Web App
 * and the tracker page talks to it exactly as it talks to the Node.js server: same accounts,
 * same four roles, same rules, enforced here rather than in the browser.
 *
 * Nothing to host and nothing to pay for. The data lives in a spreadsheet you own and can open,
 * sort and chart like any other sheet.
 *
 *   1. Open https://sheets.new and give the spreadsheet a name.
 *   2. Extensions → Apps Script. Delete the sample code, paste this whole file, save.
 *   3. Run the function  setupTracker  once and allow the permissions it asks for.
 *   4. Deploy → New deployment → Web app
 *         Execute as:        Me
 *         Who has access:    Anyone            ← required, the page is not signed in to Google
 *      Copy the /exec URL it gives you.
 *   5. In index.html, before js/gsheet.js, add:
 *         <script>window.GAS_URL='https://script.google.com/macros/s/..../exec';</script>
 *
 * After step 3 the sheet contains the tabs Users, Items, Sessions, Requests and Audit, plus a
 * super admin to sign in with. The password is printed in the run log and can be changed in the
 * Script Properties before you run it:  SEED_EMAIL, SEED_NAME, SEED_PASSWORD.
 *
 * Security notes
 *   · Passwords are stored as salted, repeatedly hashed SHA-256, never in plain text.
 *   · Session tokens are random and the sheet keeps only their hash.
 *   · Every role check happens in this file, so a Viewer calling the URL directly still gets a
 *     refusal. Hiding a button in the browser is convenience, not protection.
 *   · "Anyone" access means anyone who knows the URL may CALL the script, not that they can read
 *     the spreadsheet. Every action except health, setup and login requires a valid token.
 */

/* ===================================================================== */
/* Configuration                                                          */
/* ===================================================================== */

var SHEETS = {
  users:    { name: 'Users',    headers: ['email', 'name', 'role', 'password', 'externalId', 'createdAt', 'createdBy', 'updatedAt', 'lastLogin'] },
  items:    { name: 'Items',    headers: ['id', 'type', 'title', 's', 'pri', 'f1', 'f2', 'sd', 'e', 'sh', 'ms', 'rm', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'] },
  sessions: { name: 'Sessions', headers: ['tokenHash', 'email', 'createdAt', 'expiresAt', 'userAgent'] },
  requests: { name: 'Requests', headers: ['id', 'email', 'name', 'at'] },
  archive:  { name: 'Archive',  headers: ['id', 'rows', 'at'] },
  resets:   { name: 'Resets',   headers: ['email', 'codeHash', 'expiresAt', 'attempts', 'createdAt'] },
  audit:    { name: 'Audit',    headers: ['at', 'actor', 'role', 'action', 'target', 'detail'] }
};

var ROLES = ['superadmin', 'admin', 'superuser', 'viewer'];

var ROLE_LABEL = {
  superadmin: 'Super admin', admin: 'Admin', superuser: 'Superuser', viewer: 'Viewer'
};

var ROLE_DESCRIPTION = {
  superadmin: 'Full access, plus user and role management',
  admin: 'Create, edit, delete and export everything',
  superuser: 'View everything · create and edit Tasks · export',
  viewer: 'View only'
};

/* Which item types each role may create, edit and delete. This is the whole permission model. */
var WRITABLE_TYPES = {
  superadmin: ['Project', 'Drive', 'Task'],
  admin:      ['Project', 'Drive', 'Task'],
  superuser:  ['Task'],
  viewer:     []
};

var CAPABILITIES = {
  superadmin: { view: true, export: true, manageUsers: true, viewAudit: true },
  admin:      { view: true, export: true, manageUsers: false, viewAudit: false },
  superuser:  { view: true, export: true, manageUsers: false, viewAudit: false },
  viewer:     { view: true, export: false, manageUsers: false, viewAudit: false }
};

var TYPES = ['Project', 'Drive', 'Task'];
var STATUSES = ['Ongoing', 'On Hold', 'Listed', 'Closed', 'Done'];
var PRIORITIES = ['High', 'Mid', 'Low'];
var PREFIX = { Project: 'P', Drive: 'D', Task: 'T' };

var SESSION_HOURS = 12;
var HASH_ROUNDS = 500;          // raise for more protection, lower if sign-in feels slow
var LOGIN_MAX_ATTEMPTS = 8;
var LOGIN_WINDOW_MIN = 15;
var RESET_CODE_MINUTES = 15;       // how long an emailed code stays usable
var RESET_MAX_TRIES = 5;           // wrong codes allowed before the code is thrown away
var RESET_MAX_REQUESTS = 5;        // codes one address may ask for inside the window below
var RESET_REQUEST_WINDOW_MIN = 60;

/* ===================================================================== */
/* One-time setup – run this function from the editor                     */
/* ===================================================================== */

function setupTracker() {
  var ss = spreadsheet_();
  Object.keys(SHEETS).forEach(function (key) { sheet_(key); });

  var props = PropertiesService.getScriptProperties();
  var email = (props.getProperty('SEED_EMAIL') || 'admin@tracker.com').toLowerCase();
  var name = props.getProperty('SEED_NAME') || 'Super admin';
  var password = props.getProperty('SEED_PASSWORD') || 'Admin@1234';

  var existing = readTable_('users');
  if (existing.length) {
    Logger.log('Users sheet already has %s account(s) – nothing seeded.', existing.length);
  } else {
    appendRow_('users', {
      email: email, name: name, role: 'superadmin',
      password: hashPassword_(password), externalId: '',
      createdAt: nowIso_(), createdBy: 'setup', updatedAt: '', lastLogin: ''
    });
    Logger.log('Super admin created.\n  email:    %s\n  password: %s\nChange it after the first sign-in.', email, password);
  }

  Logger.log('Spreadsheet: %s', ss.getUrl());
  Logger.log('Now use Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).');
  return 'Setup complete – see the execution log.';
}

/**
 * Fill the sheet with realistic sample rows so you can see the tracker working straight away.
 * Run it from the editor (choose addSampleData, press Run). Safe to run twice: a row whose title
 * is already there is skipped. Delete them from the Items tab whenever you want them gone.
 */
function addSampleData() {
  var samples = [
    /* type, title, status, priority, focal-1, focal-2, start, end, stakeholder, milestones */
    ['Project', 'Core banking DR site', 'Ongoing', 'High', 'Rafiqul Islam', 'Nadia Rahman', '2026-07-01', '2026-12-31', 'Operations', 'Requirement analysis - Done\nSite survey - Done\nHardware delivery - Ongoing\nFailover test - Listed'],
    ['Project', 'Branch Wi-Fi rollout (120 branches)', 'Ongoing', 'Mid', 'Nadia Rahman', '', '2026-08-15', '2027-01-31', 'Branch Operations', 'Vendor selection - Done\nPilot 10 branches - Done\nPhase 1 rollout - Ongoing'],
    ['Project', 'Ticketing system upgrade', 'On Hold', 'Mid', 'Rafiqul Islam', 'Sohel Mahmud', '2026-06-01', '2026-09-30', 'IT Service Desk', 'Licence renewal - Done\nData migration - on hold pending budget'],
    ['Project', 'Data centre cooling upgrade', 'Done', 'High', 'Sohel Mahmud', '', '2026-02-01', '2026-05-30', 'Facilities', 'Quotation - Done\nInstallation - Done\nLoad test - Done'],
    ['Project', 'Biometric attendance rollout', 'Listed', 'Low', 'Nadia Rahman', '', '2027-01-05', '2027-06-30', 'Human Resources', ''],

    ['Drive', 'Monthly backup restore test', 'Ongoing', 'High', 'Sohel Mahmud', 'Rafiqul Islam', '2026-01-01', '', 'Risk and Compliance', 'Restore drill on the first Sunday of each month'],
    ['Drive', 'Weekly server patching', 'Ongoing', 'Mid', 'Rafiqul Islam', '', '2026-01-01', '', 'Infrastructure', 'Windows and Linux fleet, Thursday night window'],
    ['Drive', 'Quarterly disaster recovery drill', 'Ongoing', 'High', 'Nadia Rahman', 'Sohel Mahmud', '2026-01-01', '', 'Operations', 'Q1 - Done\nQ2 - Done\nQ3 - Ongoing'],

    ['Task', 'Replace UPS battery - Head Office', 'Ongoing', 'High', 'Sohel Mahmud', '', '2026-10-01', '2026-10-25', 'Facilities', 'Quotation - Done\nFitting scheduled - Ongoing'],
    ['Task', 'Renew wildcard SSL certificate', 'Done', 'High', 'Rafiqul Islam', '', '2026-09-01', '2026-09-20', 'Security', 'Purchase - Done\nInstall on load balancer - Done'],
    ['Task', 'Reset VPN tokens for field staff', 'Ongoing', 'Mid', 'Nadia Rahman', '', '2026-10-05', '2026-10-30', 'Field Operations', ''],
    ['Task', 'Decommission old file server', 'Listed', 'Low', 'Sohel Mahmud', '', '2026-11-01', '2026-11-30', 'Infrastructure', ''],
    ['Task', 'Audit firewall rules', 'On Hold', 'Mid', 'Rafiqul Islam', 'Nadia Rahman', '2026-08-01', '2026-09-15', 'Security', 'Rule export - Done\nReview with vendor - on hold']
  ];

  var existing = readTable_('items');
  var titles = {};
  existing.forEach(function (row) { titles[String(row.title)] = true; });

  var added = 0;
  samples.forEach(function (sample) {
    if (titles[sample[1]]) return;
    var record = {
      id: nextId_(sample[0], existing),
      type: sample[0], title: sample[1], s: sample[2], pri: sample[3],
      f1: sample[4], f2: sample[5], sd: sample[6], e: sample[7],
      sh: sample[8], ms: sample[9], rm: '',
      createdAt: nowIso_(), createdBy: 'sample data', updatedAt: '', updatedBy: ''
    };
    appendRow_('items', record);
    existing.push(record);
    added += 1;
  });

  Logger.log('Added %s sample row(s); %s were already there.', added, samples.length - added);
  return added;
}

/**
 * Create one account per role so all four can be tried immediately.
 * Run it from the editor. The passwords are printed in the log - change them before real use.
 */
function addSampleUsers() {
  var people = [
    { email: 'admin2@tracker.com', name: 'Rafiqul Islam', role: 'admin', password: 'Admin2@1234' },
    { email: 'superuser@tracker.com', name: 'Sohel Mahmud', role: 'superuser', password: 'Super@1234' },
    { email: 'viewer@tracker.com', name: 'Nadia Rahman', role: 'viewer', password: 'Viewer@1234' }
  ];
  var added = 0;
  people.forEach(function (p) {
    if (findUser_(p.email)) { Logger.log('%s already exists - skipped.', p.email); return; }
    appendRow_('users', {
      email: p.email, name: p.name, role: p.role, password: hashPassword_(p.password),
      externalId: '', createdAt: nowIso_(), createdBy: 'sample', updatedAt: '', lastLogin: ''
    });
    Logger.log('%s  role: %s  password: %s', p.email, p.role, p.password);
    added += 1;
  });
  Logger.log('Added %s account(s). Change these passwords before real use.', added);
  return added;
}

/**
 * Check the installation and say what is wrong, if anything.
 * Run it from the editor after pasting this file or changing settings.
 */
function checkDeployment() {
  var problems = [];
  try { spreadsheet_(); } catch (err) { problems.push('No spreadsheet: ' + err.message); }

  Object.keys(SHEETS).forEach(function (key) {
    if (!spreadsheet_().getSheetByName(SHEETS[key].name)) {
      problems.push('Missing tab: ' + SHEETS[key].name + ' - run setupTracker');
    }
  });

  var users = readTable_('users');
  if (!users.length) problems.push('No accounts yet - run setupTracker');
  users.forEach(function (u) {
    if (String(u.password).indexOf('sha256$') !== 0) {
      problems.push('The password for ' + u.email + ' is not hashed - reset it from the Users dialog');
    }
  });

  Logger.log('health:   %s', JSON.stringify(ACTIONS.health()));
  Logger.log('accounts: %s     items: %s', users.length, readTable_('items').length);
  try {
    Logger.log('email quota left today: %s (used for \'forgot password\' codes)',
               MailApp.getRemainingDailyQuota());
  } catch (err) { problems.push('Email is not available: ' + err.message); }

  if (problems.length) {
    Logger.log('PROBLEMS FOUND:');
    problems.forEach(function (p) { Logger.log('  - %s', p); });
  } else {
    Logger.log('Everything looks correct.');
    Logger.log('If the page still cannot reach this script, publish the current code:');
    Logger.log('Deploy -> Manage deployments -> pencil -> Version: New version -> Deploy.');
  }
  return problems;
}

/** Optional helper: remove expired sessions. Add a time-driven trigger for it if you like. */
function cleanUpSessions() {
  var rows = readTable_('sessions');
  var now = new Date().getTime();
  var keep = rows.filter(function (r) { return new Date(r.expiresAt).getTime() > now; });
  if (keep.length !== rows.length) {
    writeTable_('sessions', keep);
    Logger.log('Removed %s expired session(s).', rows.length - keep.length);
  }
  return keep.length;
}

/* ===================================================================== */
/* Web App entry points                                                   */
/* ===================================================================== */

/**
 * The page sends POST requests with Content-Type text/plain, which browsers treat as a "simple"
 * request: no CORS preflight, which Apps Script cannot answer.
 */
function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ error: { code: 'bad_json', message: 'The request body is not valid JSON' } });
  }
  return handle_(body, e);
}

/** GET is supported for health checks and for opening the URL in a browser to test it. */
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (!params.action) {
    return json_({
      ok: true, service: 'task-tracker-gas',
      message: 'The tracker backend is running. The page talks to it with POST requests.',
      setupRequired: readTable_('users').length === 0
    });
  }
  return handle_(params, e);
}

/** Every action is dispatched here, so GET and POST behave identically. */
function handle_(body, e) {
  var action = String(body.action || '');
  try {
    var handler = ACTIONS[action];
    if (!handler) return json_({ error: { code: 'not_found', message: 'Unknown action: ' + action } });

    /* Actions that work without being signed in. */
    var open = { health: 1, setup: 1, login: 1, roles: 1, createRequest: 1, me: 1,
                 forgotPassword: 1, resetPassword: 1 };
    var ctx = { user: null, token: String(body.token || '') };
    if (ctx.token) ctx.user = userForToken_(ctx.token);
    if (!open[action] && !ctx.user) {
      return json_({ error: { code: 'unauthorized', message: 'Please sign in to continue' } });
    }
    return json_(handler(body, ctx, e));
  } catch (err) {
    var status = err && err.status ? err.status : 500;
    var code = err && err.code ? err.code : 'server_error';
    var message = (err && err.message) ? String(err.message) : 'Something went wrong';
    if (status === 500) Logger.log('Error in %s: %s', action, (err && err.stack) || message);
    return json_({ error: { code: code, message: message, status: status } });
  }
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function fail_(status, code, message) {
  var err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/* ===================================================================== */
/* Actions                                                                */
/* ===================================================================== */

var ACTIONS = {

  /* ---------- open ---------- */

  health: function () {
    return {
      ok: true, service: 'task-tracker-gas', version: '1.0.0',
      time: nowIso_(), setupRequired: readTable_('users').length === 0, roles: ROLES
    };
  },

  roles: function () {
    return { roles: ROLES.map(describeRole_) };
  },

  /** Create the first super admin. Refused once any account exists. */
  setup: function (body, ctx, e) {
    return withLock_(function () {
      if (readTable_('users').length) throw fail_(400, 'already_setup', 'Setup has already been completed – please sign in');
      var user = createUser_({
        email: body.email, name: body.name, role: 'superadmin',
        password: body.password, createdBy: 'setup'
      });
      var session = createSession_(user.email, e);
      audit_('setup', user.email, 'superadmin', user.email, '');
      return sessionPayload_(user, session);
    });
  },

  login: function (body, ctx, e) {
    var email = normaliseEmail_(body.email);
    var password = String(body.password || '');
    if (!email || !password) throw fail_(400, 'missing_credentials', 'Enter your email and password');

    throttleLogin_(email);

    var row = findUser_(email);
    var ok = row && verifyPassword_(password, row.password);
    if (!ok) {
      audit_('login.failed', email, '', email, '');
      throw fail_(401, 'unauthorized', 'Email or password is not correct');
    }
    clearThrottle_(email);

    var session = createSession_(row.email, e);
    updateUserRow_(row.email, { lastLogin: nowIso_() });
    audit_('login', row.email, row.role, row.email, '');
    return sessionPayload_(publicUser_(row), session);
  },

  me: function (body, ctx) {
    if (!ctx.user) {
      return { user: null, permissions: null, setupRequired: readTable_('users').length === 0,
               roles: ROLES.map(describeRole_) };
    }
    return {
      user: { email: ctx.user.email, name: ctx.user.name, role: ctx.user.role, id: docId_(ctx.user.email) },
      permissions: describeRole_(ctx.user.role),
      setupRequired: false,
      roles: ROLES.map(describeRole_)
    };
  },

  logout: function (body, ctx) {
    if (ctx.token) destroySession_(ctx.token);
    audit_('logout', ctx.user.email, ctx.user.role, ctx.user.email, '');
    return { ok: true };
  },

  changePassword: function (body, ctx, e) {
    var row = findUser_(ctx.user.email);
    /* 400, not 401: the person IS signed in, they just mistyped. A 401 here would make the
       page think the session had expired and sign them out. */
    if (!row || !verifyPassword_(String(body.currentPassword || ''), row.password)) {
      throw fail_(400, 'bad_current', 'Your current password is not correct');
    }
    var next = String(body.newPassword || '');
    if (next.length < 4) throw fail_(400, 'bad_password', 'The new password must be at least 4 characters');
    updateUserRow_(row.email, { password: hashPassword_(next), updatedAt: nowIso_() });
    /* Your other devices are signed out, but the one you are using stays signed in. */
    destroySessionsFor_(row.email, ctx.token);
    audit_('password.change', row.email, row.role, row.email, '');
    return { ok: true, message: 'Your password has been changed.' };
  },


  /** Change your own display name. Your email and role are not touched here. */
  updateProfile: function (body, ctx) {
    var name = String(body.name || '').trim();
    if (!name) throw fail_(400, 'bad_name', 'Enter a name');
    if (name.length > 120) throw fail_(400, 'bad_name', 'That name is too long');
    return withLock_(function () {
      updateUserRow_(ctx.user.email, { name: name, updatedAt: nowIso_() });
      audit_('profile.update', ctx.user.email, ctx.user.role, ctx.user.email, 'name');
      return publicUser_(findUser_(ctx.user.email));
    });
  },

  /* ---------- forgotten password ---------- */

  /**
   * Step one: email a six-digit code to the address, if it has an account.
   * The answer is the same either way, so the script never reveals who has an account.
   */
  forgotPassword: function (body) {
    var email = normaliseEmail_(body.email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw fail_(400, 'bad_email', 'Enter a valid email address');
    }
    throttleReset_(email);

    var user = findUser_(email);
    if (user) {
      var code = resetCode_();
      withLock_(function () { putReset_(email, code); });
      var delivered = sendResetEmail_(user, code);
      audit_('password.forgot', email, user.role, email, delivered ? 'code emailed' : 'email failed');
      if (!delivered) {
        throw fail_(500, 'mail_failed',
          'The code could not be emailed. Ask the super admin to reset your password instead.');
      }
    } else {
      audit_('password.forgot', email, '', email, 'no such account');
    }
    return {
      ok: true,
      message: 'If that address has an account, a six-digit code is on its way. It expires in '
        + RESET_CODE_MINUTES + ' minutes.'
    };
  },

  /** Step two: the code plus a new password. */
  resetPassword: function (body) {
    var email = normaliseEmail_(body.email);
    var code = String(body.code || '').replace(/\s+/g, '');
    var next = String(body.newPassword || '');
    if (next.length < 4) throw fail_(400, 'bad_password', 'The new password must be at least 4 characters');
    if (!code) throw fail_(400, 'bad_code', 'Enter the code from the email');

    return withLock_(function () {
      var row = findReset_(email);
      if (!row) throw fail_(400, 'bad_code', 'No code is waiting for that address - ask for a new one');

      if (new Date(row.expiresAt).getTime() <= new Date().getTime()) {
        removeReset_(email);
        throw fail_(400, 'expired_code', 'That code has expired - ask for a new one');
      }
      var attempts = Number(row.attempts || 0) + 1;
      if (attempts > RESET_MAX_TRIES) {
        removeReset_(email);
        throw fail_(429, 'too_many_tries', 'Too many wrong codes - ask for a new one');
      }
      if (hashCode_(email, code) !== String(row.codeHash)) {
        updateReset_(email, { attempts: attempts });
        throw fail_(400, 'bad_code', 'That code is not correct - ' + (RESET_MAX_TRIES - attempts) + ' tries left');
      }

      var user = findUser_(email);
      if (!user) { removeReset_(email); throw fail_(404, 'not_found', 'No account with that email'); }

      updateUserRow_(email, { password: hashPassword_(next), updatedAt: nowIso_() });
      removeReset_(email);
      destroySessionsFor_(email);          // any old sign-in of this account stops working
      clearThrottle_(email);
      audit_('password.reset', email, user.role, email, 'by emailed code');
      return { ok: true, message: 'Your password has been changed. Please sign in.' };
    });
  },

  /* ---------- items ---------- */

  listItems: function (body, ctx) {
    return { items: readTable_('items').map(itemOut_), role: ctx.user.role };
  },

  saveItem: function (body, ctx) {
    return withLock_(function () {
      var input = body.item || {};
      var id = String(body.id || input.id || '');
      var rows = readTable_('items');
      var index = -1;
      for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) { index = i; break; }

      if (index === -1) {
        /* Creating: the role must be allowed to write this type. */
        var type = String(input.type || '');
        assertWrite_(ctx.user.role, type);
        var created = cleanItem_(input, false);
        created.id = /^[PDT]-\d+$/.test(id) ? id : nextId_(created.type, rows);
        created.createdAt = nowIso_();
        created.createdBy = ctx.user.email;
        created.updatedAt = '';
        created.updatedBy = '';
        appendRow_('items', created);
        audit_('item.create', ctx.user.email, ctx.user.role, created.id, created.type + ': ' + created.title);
        return itemOut_(created);
      }

      /* Editing: the type ALREADY STORED decides, so a Superuser cannot pass a project off
         as a task by sending type:"Task". */
      assertWrite_(ctx.user.role, rows[index].type);
      var patch = cleanItem_(input, true);
      delete patch.type;
      var merged = rows[index];
      Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
      merged.updatedAt = nowIso_();
      merged.updatedBy = ctx.user.email;
      updateRowAt_('items', index, merged);
      audit_('item.update', ctx.user.email, ctx.user.role, merged.id, Object.keys(patch).join(','));
      return itemOut_(merged);
    });
  },

  deleteItem: function (body, ctx) {
    return withLock_(function () {
      var id = String(body.id || '');
      var rows = readTable_('items');
      var index = -1;
      for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) { index = i; break; }
      if (index === -1) throw fail_(404, 'not_found', 'That item no longer exists');
      assertWrite_(ctx.user.role, rows[index].type);
      var gone = rows[index];
      deleteRowAt_('items', index);
      audit_('item.delete', ctx.user.email, ctx.user.role, gone.id, gone.type + ': ' + gone.title);
      return { ok: true, id: gone.id };
    });
  },

  listArchive: function () {
    return {
      batches: readTable_('archive').map(function (b) {
        var rows = [];
        try { rows = JSON.parse(b.rows || '[]'); } catch (err) { rows = []; }
        return { id: b.id, rows: rows, at: b.at };
      })
    };
  },

  saveArchive: function (body, ctx) {
    assertWrite_(ctx.user.role, 'Project');       // an admin-level action
    return withLock_(function () {
      var id = String(body.id || '');
      var rows = Array.isArray(body.rows) ? body.rows : [];
      var table = readTable_('archive');
      var index = -1;
      for (var i = 0; i < table.length; i++) if (String(table[i].id) === id) { index = i; break; }
      var record = { id: id, rows: JSON.stringify(rows), at: nowIso_() };
      if (index === -1) appendRow_('archive', record); else updateRowAt_('archive', index, record);
      audit_('archive.save', ctx.user.email, ctx.user.role, id, rows.length + ' rows');
      return { id: id, rows: rows };
    });
  },

  /* ---------- users (super admin only) ---------- */

  listUsers: function (body, ctx) {
    assertCan_(ctx.user.role, 'manageUsers');
    return {
      users: readTable_('users').map(publicUser_),
      requests: readTable_('requests'),
      roles: ROLES.map(describeRole_)
    };
  },

  createUser: function (body, ctx) {
    assertCan_(ctx.user.role, 'manageUsers');
    return withLock_(function () {
      var user = createUser_({
        email: body.email, name: body.name, role: body.role,
        password: body.password, externalId: body.externalId, createdBy: ctx.user.email
      });
      if (body.requestId) removeRequest_(body.requestId);
      audit_('user.create', ctx.user.email, ctx.user.role, user.email, user.role);
      return user;
    });
  },

  updateUser: function (body, ctx) {
    assertCan_(ctx.user.role, 'manageUsers');
    return withLock_(function () {
      var email = normaliseEmail_(body.email || body.id);
      var row = findUser_(email);
      if (!row) throw fail_(404, 'not_found', 'No account with that email');

      var patch = {};
      if (body.name !== undefined) {
        var name = String(body.name).trim();
        if (!name) throw fail_(400, 'bad_name', 'Enter a name');
        patch.name = name;
      }
      if (body.role !== undefined) {
        if (ROLES.indexOf(body.role) === -1) throw fail_(400, 'bad_role', 'Role must be one of: ' + ROLES.join(', '));
        if (row.email === ctx.user.email && body.role !== row.role) {
          throw fail_(400, 'self_role', 'You cannot change your own role – ask another super admin');
        }
        if (row.role === 'superadmin' && body.role !== 'superadmin' && countSuperAdmins_() <= 1) {
          throw fail_(400, 'last_superadmin', 'This is the only super admin – promote someone else first');
        }
        patch.role = body.role;
      }
      if (body.password) {
        if (String(body.password).length < 4) throw fail_(400, 'bad_password', 'The password must be at least 4 characters');
        patch.password = hashPassword_(String(body.password));
      }
      if (body.externalId !== undefined) patch.externalId = String(body.externalId || '');
      patch.updatedAt = nowIso_();

      updateUserRow_(row.email, patch);

      /* A new role or password must not leave an old sign-in running with the old rights. */
      if (patch.role || patch.password) {
        if (row.email === ctx.user.email) destroySessionsFor_(row.email, ctx.token);
        else destroySessionsFor_(row.email);
      }
      audit_('user.update', ctx.user.email, ctx.user.role, row.email, Object.keys(patch).join(','));
      return publicUser_(findUser_(row.email));
    });
  },

  deleteUser: function (body, ctx) {
    assertCan_(ctx.user.role, 'manageUsers');
    return withLock_(function () {
      var email = normaliseEmail_(body.email || body.id);
      var rows = readTable_('users');
      var index = -1;
      for (var i = 0; i < rows.length; i++) if (rows[i].email === email) { index = i; break; }
      if (index === -1) throw fail_(404, 'not_found', 'No account with that email');
      if (email === ctx.user.email) throw fail_(400, 'self_delete', 'You cannot remove your own account');
      if (rows[index].role === 'superadmin' && countSuperAdmins_() <= 1) {
        throw fail_(400, 'last_superadmin', 'This is the only super admin – add another one first');
      }
      deleteRowAt_('users', index);
      destroySessionsFor_(email);
      audit_('user.delete', ctx.user.email, ctx.user.role, email, rows[index].role);
      return { ok: true, email: email };
    });
  },

  /* ---------- access requests ---------- */

  createRequest: function (body) {
    return withLock_(function () {
      var id = String(body.id || body.email || '').trim();
      if (!id) throw fail_(400, 'bad_request_id', 'A request needs an id or an email');
      var rows = readTable_('requests');
      for (var i = 0; i < rows.length; i++) if (String(rows[i].id) === id) return { ok: true, id: id, existing: true };
      appendRow_('requests', {
        id: id, email: normaliseEmail_(body.email), name: String(body.name || ''), at: nowIso_()
      });
      return { ok: true, id: id, existing: false };
    });
  },

  deleteRequest: function (body, ctx) {
    assertCan_(ctx.user.role, 'manageUsers');
    removeRequest_(String(body.id || ''));
    audit_('request.remove', ctx.user.email, ctx.user.role, String(body.id || ''), '');
    return { ok: true, id: String(body.id || '') };
  },

  /* ---------- reporting ---------- */

  stats: function (body, ctx) {
    var items = readTable_('items');
    var byType = {};
    TYPES.forEach(function (t) {
      byType[t] = { total: 0 };
      STATUSES.forEach(function (s) { byType[t][s] = 0; });
    });
    var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var overdue = 0;
    items.forEach(function (i) {
      if (!byType[i.type]) return;
      if (byType[i.type][i.s] !== undefined) byType[i.type][i.s] += 1;
      byType[i.type].total += 1;
      if (i.s === 'Ongoing' && i.e && String(i.e) < today) overdue += 1;
    });
    var workload = {};
    items.forEach(function (i) {
      [i.f1, i.f2].forEach(function (who) {
        var name = String(who || '').replace(/\s*\(.*?\)/g, '').trim();
        if (!name) return;
        if (!workload[name]) workload[name] = { Ongoing: 0, 'On Hold': 0, Listed: 0, Closed: 0, Done: 0, total: 0 };
        if (workload[name][i.s] !== undefined) workload[name][i.s] += 1;
        workload[name].total += 1;
      });
    });
    return { total: items.length, overdue: overdue, byType: byType, workload: workload,
             people: Object.keys(workload).sort(), generatedAt: nowIso_() };
  },

  exportData: function (body, ctx) {
    assertCan_(ctx.user.role, 'export');          // a Viewer is refused here
    var columns = ['ID', 'Type', 'Title', 'Status', 'Priority', 'Focal-1', 'Focal-2',
                   'Start', 'End', 'Stakeholder', 'Milestones / progress', 'Remarks'];
    var label = { Project: 'Project', Drive: 'Recurring', Task: 'Task' };
    var items = readTable_('items');
    if (body.type) items = items.filter(function (i) { return i.type === body.type; });
    if (body.status) items = items.filter(function (i) { return i.s === body.status; });
    var rows = items.map(function (i) {
      return [i.id, label[i.type] || i.type, i.title, i.s, i.pri, i.f1, i.f2, i.sd, i.e, i.sh,
              String(i.ms || '').split(/\s*(?:\n|\*|•)\s*/).filter(String).join('; '), i.rm];
    });
    audit_('export', ctx.user.email, ctx.user.role, '', rows.length + ' rows');
    return { columns: columns, rows: rows, items: items.map(itemOut_), generatedAt: nowIso_() };
  },

  audit: function (body, ctx) {
    assertCan_(ctx.user.role, 'viewAudit');
    var rows = readTable_('audit');
    var limit = Math.min(Number(body.limit) || 200, 1000);
    return { entries: rows.slice(-limit).reverse(), total: rows.length };
  }
};

/* ===================================================================== */
/* Permissions                                                            */
/* ===================================================================== */

function describeRole_(role) {
  var caps = CAPABILITIES[role] || {};
  return {
    role: role, label: ROLE_LABEL[role] || role, description: ROLE_DESCRIPTION[role] || '',
    writableTypes: WRITABLE_TYPES[role] || [],
    view: !!caps.view, export: !!caps.export, manageUsers: !!caps.manageUsers, viewAudit: !!caps.viewAudit
  };
}

function canWrite_(role, type) {
  return (WRITABLE_TYPES[role] || []).indexOf(type) !== -1;
}

function assertWrite_(role, type) {
  if (TYPES.indexOf(type) === -1) throw fail_(400, 'bad_type', 'Type must be one of: ' + TYPES.join(', '));
  if (canWrite_(role, type)) return true;
  var what = type === 'Drive' ? 'Recurring items' : type + 's';
  throw fail_(403, 'forbidden', 'Your role (' + (ROLE_LABEL[role] || role) + ') cannot edit ' + what);
}

function assertCan_(role, capability) {
  var caps = CAPABILITIES[role] || {};
  if (caps[capability]) return true;
  var what = capability === 'export' ? 'download or print'
    : capability === 'manageUsers' ? 'manage users'
    : capability === 'viewAudit' ? 'read the audit log' : capability;
  throw fail_(403, 'forbidden', 'Your role (' + (ROLE_LABEL[role] || role) + ') cannot ' + what);
}

/* ===================================================================== */
/* Users and sessions                                                     */
/* ===================================================================== */

function normaliseEmail_(value) { return String(value || '').trim().toLowerCase(); }
function docId_(email) { return normaliseEmail_(email).replace(/[^a-z0-9]+/g, '_') || 'x'; }

function publicUser_(row) {
  if (!row) return null;
  return {
    id: docId_(row.email), email: row.email, name: row.name, role: row.role,
    externalId: row.externalId || '', at: String(row.createdAt || '').slice(0, 10),
    by: row.createdBy || '', updatedAt: row.updatedAt || '', lastLogin: row.lastLogin || ''
  };
}

function findUser_(email) {
  var target = normaliseEmail_(email);
  var rows = readTable_('users');
  for (var i = 0; i < rows.length; i++) if (normaliseEmail_(rows[i].email) === target) return rows[i];
  return null;
}

function countSuperAdmins_() {
  return readTable_('users').filter(function (u) { return u.role === 'superadmin'; }).length;
}

function createUser_(input) {
  var email = normaliseEmail_(input.email);
  var name = String(input.name || '').trim();
  var role = String(input.role || '');
  var password = String(input.password || '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail_(400, 'bad_email', 'Enter a valid email address');
  if (!name) throw fail_(400, 'bad_name', 'Enter a name');
  if (ROLES.indexOf(role) === -1) throw fail_(400, 'bad_role', 'Role must be one of: ' + ROLES.join(', '));
  if (password.length < 4) throw fail_(400, 'bad_password', 'The password must be at least 4 characters');
  if (findUser_(email)) throw fail_(409, 'conflict', 'This email already has an account');

  var record = {
    email: email, name: name, role: role, password: hashPassword_(password),
    externalId: String(input.externalId || ''), createdAt: nowIso_(),
    createdBy: input.createdBy || '', updatedAt: '', lastLogin: ''
  };
  appendRow_('users', record);
  return publicUser_(record);
}

function updateUserRow_(email, patch) {
  var target = normaliseEmail_(email);
  var rows = readTable_('users');
  for (var i = 0; i < rows.length; i++) {
    if (normaliseEmail_(rows[i].email) !== target) continue;
    Object.keys(patch).forEach(function (k) { rows[i][k] = patch[k]; });
    updateRowAt_('users', i, rows[i]);
    return rows[i];
  }
  return null;
}

/* ---- password hashing: salted SHA-256, repeated, so a leaked sheet is not a password list ---- */

function hashPassword_(password, salt, rounds) {
  salt = salt || Utilities.base64EncodeWebSafe(randomBytes_(12));
  rounds = rounds || HASH_ROUNDS;
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, 'tracker:' + salt + ':' + password, Utilities.Charset.UTF_8);
  for (var i = 1; i < rounds; i++) {
    digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, digest);
  }
  return 'sha256$' + rounds + '$' + salt + '$' + bytesToHex_(digest);
}

function verifyPassword_(password, stored) {
  var parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'sha256') return false;
  var expected = String(stored);
  var actual = hashPassword_(password, parts[2], Number(parts[1]));
  /* Length-equal comparison that does not stop at the first difference. */
  if (actual.length !== expected.length) return false;
  var diff = 0;
  for (var i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function randomBytes_(count) {
  var out = [];
  for (var i = 0; i < count; i++) out.push(Math.floor(Math.random() * 256) - 128);
  /* Mix in a true-random element so tokens are not predictable from the clock alone. */
  var seed = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    Utilities.getUuid() + ':' + new Date().getTime() + ':' + Math.random());
  for (var j = 0; j < out.length; j++) out[j] = seed[j % seed.length] ^ out[j];
  return out;
}

function bytesToHex_(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

function sha256Hex_(value) {
  return bytesToHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8));
}

/* ---- sessions ---- */

function createSession_(email, e) {
  var token = Utilities.getUuid().replace(/-/g, '') + bytesToHex_(randomBytes_(16));
  var expires = new Date(new Date().getTime() + SESSION_HOURS * 3600 * 1000);
  appendRow_('sessions', {
    tokenHash: sha256Hex_(token), email: normaliseEmail_(email),
    createdAt: nowIso_(), expiresAt: expires.toISOString(),
    userAgent: ''
  });
  return { token: token, expiresAt: expires.toISOString() };
}

function userForToken_(token) {
  if (!token) return null;
  var hash = sha256Hex_(token);
  var rows = readTable_('sessions');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].tokenHash) !== hash) continue;
    if (new Date(rows[i].expiresAt).getTime() <= new Date().getTime()) {
      deleteRowAt_('sessions', i);
      return null;
    }
    var user = findUser_(rows[i].email);
    return user ? publicUser_(user) : null;
  }
  return null;
}

function destroySession_(token) {
  var hash = sha256Hex_(token);
  var rows = readTable_('sessions');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].tokenHash) === hash) { deleteRowAt_('sessions', i); return true; }
  }
  return false;
}

function destroySessionsFor_(email, keepToken) {
  var target = normaliseEmail_(email);
  var keepHash = keepToken ? sha256Hex_(keepToken) : '';
  var rows = readTable_('sessions');
  var keep = rows.filter(function (r) {
    return normaliseEmail_(r.email) !== target || (keepHash && String(r.tokenHash) === keepHash);
  });
  if (keep.length !== rows.length) writeTable_('sessions', keep);
}

function sessionPayload_(user, session) {
  return {
    user: { email: user.email, name: user.name, role: user.role, id: docId_(user.email) },
    permissions: describeRole_(user.role),
    token: session.token,
    expiresAt: session.expiresAt
  };
}

/* ---- sign-in throttling, kept in script properties ---- */

function throttleLogin_(email) {
  var props = PropertiesService.getScriptProperties();
  var key = 'throttle:' + email;
  var raw = props.getProperty(key);
  var now = new Date().getTime();
  var entry = raw ? JSON.parse(raw) : { count: 0, reset: now + LOGIN_WINDOW_MIN * 60000 };
  if (entry.reset <= now) entry = { count: 0, reset: now + LOGIN_WINDOW_MIN * 60000 };
  entry.count += 1;
  props.setProperty(key, JSON.stringify(entry));
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    var minutes = Math.ceil((entry.reset - now) / 60000);
    throw fail_(429, 'rate_limited', 'Too many sign-in attempts. Try again in ' + minutes + ' minute(s).');
  }
}

function clearThrottle_(email) {
  PropertiesService.getScriptProperties().deleteProperty('throttle:' + email);
}


/* ---- forgotten-password codes ---- */

/** A six-digit code drawn from the same random source as the session tokens. */
function resetCode_() {
  var bytes = randomBytes_(8);
  var n = 0;
  for (var i = 0; i < 4; i++) n = (n * 256 + ((bytes[i] + 256) % 256)) % 1000000;
  return ('00000' + n).slice(-6);
}

/** Only the hash of a code is stored, so the sheet never shows a usable code. */
function hashCode_(email, code) {
  return sha256Hex_('reset:' + normaliseEmail_(email) + ':' + String(code));
}

function findReset_(email) {
  var target = normaliseEmail_(email);
  var rows = readTable_('resets');
  for (var i = 0; i < rows.length; i++) {
    if (normaliseEmail_(rows[i].email) === target) return rows[i];
  }
  return null;
}

function putReset_(email, code) {
  var target = normaliseEmail_(email);
  removeReset_(target);
  appendRow_('resets', {
    email: target,
    codeHash: hashCode_(target, code),
    expiresAt: new Date(new Date().getTime() + RESET_CODE_MINUTES * 60000).toISOString(),
    attempts: 0,
    createdAt: nowIso_()
  });
}

function updateReset_(email, patch) {
  var target = normaliseEmail_(email);
  var rows = readTable_('resets');
  for (var i = 0; i < rows.length; i++) {
    if (normaliseEmail_(rows[i].email) !== target) continue;
    Object.keys(patch).forEach(function (k) { rows[i][k] = patch[k]; });
    updateRowAt_('resets', i, rows[i]);
    return rows[i];
  }
  return null;
}

function removeReset_(email) {
  var target = normaliseEmail_(email);
  var rows = readTable_('resets');
  for (var i = rows.length - 1; i >= 0; i--) {
    if (normaliseEmail_(rows[i].email) === target) deleteRowAt_('resets', i);
  }
}

/** Stop one address from being used to send somebody a flood of emails. */
function throttleReset_(email) {
  var props = PropertiesService.getScriptProperties();
  var key = 'reset:' + email;
  var now = new Date().getTime();
  var raw = props.getProperty(key);
  var entry = raw ? JSON.parse(raw) : { count: 0, reset: now + RESET_REQUEST_WINDOW_MIN * 60000 };
  if (entry.reset <= now) entry = { count: 0, reset: now + RESET_REQUEST_WINDOW_MIN * 60000 };
  entry.count += 1;
  props.setProperty(key, JSON.stringify(entry));
  if (entry.count > RESET_MAX_REQUESTS) {
    throw fail_(429, 'rate_limited',
      'Too many codes requested for that address. Try again in '
      + Math.ceil((entry.reset - now) / 60000) + ' minute(s).');
  }
}

/**
 * Send the code with Gmail, through the account that owns this script.
 * Free, and nothing to configure: a consumer account may send about 100 emails a day,
 * a Workspace account about 1500. MailApp.getRemainingDailyQuota() shows what is left.
 */
function sendResetEmail_(user, code) {
  var subject = 'Your Task and Project Tracker password code: ' + code;
  var plain = [
    'Hello ' + user.name + ',',
    '',
    'Your password reset code is: ' + code,
    '',
    'Type it on the tracker sign-in page within ' + RESET_CODE_MINUTES + ' minutes, together with',
    'the new password you want to use.',
    '',
    'If you did not ask for this, ignore this email. Your current password still works.',
    '',
    'Infrastructure & Support, Technology, Microfinance'
  ].join('\n');

  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0f172a;line-height:1.6">'
    + '<p>Hello ' + escapeHtml_(user.name) + ',</p>'
    + '<p>Your password reset code is:</p>'
    + '<p style="font-size:30px;font-weight:bold;letter-spacing:8px;color:#ec008c;margin:18px 0">'
    + code + '</p>'
    + '<p>Type it on the tracker sign-in page within <b>' + RESET_CODE_MINUTES + ' minutes</b>, '
    + 'together with the new password you want to use.</p>'
    + '<p style="color:#64748b;font-size:13px">If you did not ask for this, ignore this email. '
    + 'Your current password still works.</p>'
    + '<hr style="border:0;border-top:1px solid #e5e9f2;margin:18px 0">'
    + '<p style="color:#64748b;font-size:12px">Infrastructure &amp; Support · Technology · Microfinance</p>'
    + '</div>';

  try {
    MailApp.sendEmail({
      to: user.email,
      subject: subject,
      body: plain,
      htmlBody: html,
      name: 'Task and Project Tracker'
    });
    return true;
  } catch (err) {
    Logger.log('Could not send the reset email to %s: %s', user.email, err.message);
    return false;
  }
}

function escapeHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ===================================================================== */
/* Items                                                                  */
/* ===================================================================== */

function itemOut_(row) {
  return {
    id: row.id, type: row.type, title: row.title, s: row.s, pri: row.pri,
    f1: row.f1, f2: row.f2, sd: row.sd, e: row.e, sh: row.sh, ms: row.ms, rm: row.rm,
    createdAt: row.createdAt, createdBy: row.createdBy,
    updatedAt: row.updatedAt, updatedBy: row.updatedBy
  };
}

function cleanItem_(input, partial) {
  var out = {};
  var has = function (k) { return Object.prototype.hasOwnProperty.call(input, k); };
  var text = function (v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max); };

  if (!partial || has('type')) {
    var type = text(input.type, 20);
    if (TYPES.indexOf(type) === -1) throw fail_(400, 'bad_type', 'Type must be one of: ' + TYPES.join(', '));
    out.type = type;
  }
  if (!partial || has('title')) {
    var title = text(input.title, 300);
    if (!title) throw fail_(400, 'bad_title', 'A name or title is required');
    out.title = title;
  }
  if (!partial || has('f1')) {
    var f1 = text(input.f1, 120);
    if (!f1) throw fail_(400, 'bad_focal', 'Focal-1 (lead) is required');
    out.f1 = f1;
  }
  if (!partial || has('s')) {
    var s = text(input.s, 20) || 'Ongoing';
    if (STATUSES.indexOf(s) === -1) throw fail_(400, 'bad_status', 'Status must be one of: ' + STATUSES.join(', '));
    out.s = s;
  }
  if (!partial || has('pri')) {
    var pri = text(input.pri, 10) || 'Mid';
    if (PRIORITIES.indexOf(pri) === -1) throw fail_(400, 'bad_priority', 'Priority must be one of: ' + PRIORITIES.join(', '));
    out.pri = pri;
  }
  [['f2', 120], ['sh', 200], ['rm', 2000], ['ms', 8000]].forEach(function (pair) {
    if (!partial || has(pair[0])) out[pair[0]] = text(input[pair[0]], pair[1]);
  });
  ['sd', 'e'].forEach(function (key) {
    if (!partial || has(key)) {
      var v = text(input[key], 10);
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        throw fail_(400, 'bad_date', (key === 'sd' ? 'Start' : 'End') + ' date must look like 2026-10-14');
      }
      out[key] = v;
    }
  });
  return out;
}

function nextId_(type, rows) {
  var prefix = PREFIX[type] + '-';
  var highest = 0;
  (rows || readTable_('items')).forEach(function (r) {
    var id = String(r.id || '');
    if (id.indexOf(prefix) !== 0) return;
    var n = parseInt(id.slice(prefix.length), 10);
    if (!isNaN(n) && n > highest) highest = n;
  });
  return prefix + (highest + 1);
}

function removeRequest_(id) {
  var rows = readTable_('requests');
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].id) === String(id)) { deleteRowAt_('requests', i); return true; }
  }
  return false;
}

function audit_(action, actor, role, target, detail) {
  try {
    appendRow_('audit', {
      at: nowIso_(), actor: actor || '', role: role || '',
      action: action, target: target || '', detail: detail || ''
    });
  } catch (err) { /* the audit log must never break the action that triggered it */ }
}

/* ===================================================================== */
/* Spreadsheet helpers                                                    */
/* ===================================================================== */

function spreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);

  var active = null;
  try {
    active = SpreadsheetApp.getActive();
  } catch (err) {
    /* Almost always one of two things, and the raw message says neither. */
    throw fail_(500, 'no_permission',
      'This script may not open the spreadsheet yet: ' + err.message +
      '  Run setupTracker from the editor and accept the permission prompt. If no prompt appears,' +
      ' remove the project under myaccount.google.com → Data & privacy → Third-party access, then run it again.');
  }
  if (active) return active;
  throw fail_(500, 'no_sheet',
    'No spreadsheet is attached to this script. Either open the script from inside the sheet' +
    ' (Extensions → Apps Script), or set a SHEET_ID script property to the id in the sheet URL.');
}

function sheet_(key) {
  var spec = SHEETS[key];
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(spec.name);
  if (!sh) {
    sh = ss.insertSheet(spec.name);
    sh.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** Read a whole tab as an array of objects keyed by the header row. */
function readTable_(key) {
  var spec = SHEETS[key];
  var sh = sheet_(key);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, spec.headers.length).getValues();
  return values.map(function (row) {
    var object = {};
    spec.headers.forEach(function (header, i) {
      var v = row[i];
      object[header] = (v instanceof Date) ? v.toISOString() : (v === null || v === undefined ? '' : String(v));
    });
    return object;
  }).filter(function (o) {
    /* Skip blank lines left behind by manual edits. */
    return Object.keys(o).some(function (k) { return String(o[k]).length; });
  });
}

function rowValues_(key, object) {
  return SHEETS[key].headers.map(function (h) {
    var v = object[h];
    return v === undefined || v === null ? '' : v;
  });
}

function appendRow_(key, object) {
  sheet_(key).appendRow(rowValues_(key, object));
}

function updateRowAt_(key, index, object) {
  var spec = SHEETS[key];
  sheet_(key).getRange(index + 2, 1, 1, spec.headers.length).setValues([rowValues_(key, object)]);
}

function deleteRowAt_(key, index) {
  sheet_(key).deleteRow(index + 2);
}

function writeTable_(key, rows) {
  var spec = SHEETS[key];
  var sh = sheet_(key);
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, spec.headers.length).clearContent();
  if (!rows.length) return;
  sh.getRange(2, 1, rows.length, spec.headers.length)
    .setValues(rows.map(function (r) { return rowValues_(key, r); }));
}

/** Serialise writes so two people saving at the same moment cannot corrupt a row. */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function nowIso_() { return new Date().toISOString(); }
