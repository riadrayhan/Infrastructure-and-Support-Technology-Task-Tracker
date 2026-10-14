# Task and Project Tracker – Node.js backend

A complete backend for the tracker: accounts, roles, items, exports and an audit log.
It has **no npm dependencies** – it uses Node's own HTTP server and Node's built-in SQLite
engine, so there is nothing to install and nothing to keep up to date.

```
cd server
npm start
```

Then open <http://localhost:3000/>. The server also serves the existing frontend, so the page and
the API share one address and sessions work with no extra configuration.

Requires **Node 22.5 or newer** (this project is developed on Node 24). Check with `node -v`.

## First sign-in

| Role | Email | Password |
|---|---|---|
| Super admin | `admin@tracker.com` | `Admin@1234` |
| Admin | `testadmin@gmail.com` | `testpass` |

These two are created only when the database has no accounts at all. Change the passwords after
the first sign-in, from the Users dialog or `POST /api/auth/password`. Set different starting
accounts with `SEED_SUPERADMIN_*` in `.env`.

## What each role may do

The rules live in one file, [`src/permissions.js`](src/permissions.js), and the server checks them
on **every** request. The browser hides buttons using the same table, but hiding a button is not
security: if a Viewer calls the API directly they still get `403`.

| | Super admin | Admin | Superuser | Viewer |
|---|---|---|---|---|
| View everything | yes | yes | yes | yes |
| Create / edit / delete **Tasks** | yes | yes | **yes** | no |
| Create / edit / delete **Projects** and **Recurring** | yes | yes | no | no |
| Download PDF / Excel / print | yes | yes | yes | no |
| Add users and assign roles | **yes** | no | no | no |
| Read the audit log | yes | no | no | no |

Two details worth knowing:

* An edit is checked against the type **already stored**, so sending `type:"Task"` in the body of a
  request against a project does not let a Superuser through.
* Changing someone's role or password ends their other sessions immediately, so a demotion takes
  effect at once rather than at their next sign-in.

## Configuration

Copy `.env.example` to `.env`. Everything is optional.

| Setting | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3000` / `0.0.0.0` | where to listen |
| `DB_FILE` | `./data/tracker.db` | the SQLite file, created automatically |
| `SERVE_STATIC` | `1` | also serve the tracker page from this server |
| `CORS_ORIGINS` | empty | exact origins allowed to call the API from elsewhere |
| `SESSION_TTL_HOURS` | `12` | how long a sign-in lasts |
| `COOKIE_SECURE` | on in production | mark cookies Secure (needed for HTTPS) |
| `LOGIN_MAX_ATTEMPTS` | `8` per 15 min | failed sign-ins before throttling |
| `RATE_MAX` | `600` per minute | general request ceiling per address |

## Security

* Passwords are stored with **scrypt** and a random salt per account. They are never returned by
  any endpoint.
* Session tokens are random and stored **hashed**, so a copy of the database cannot be replayed.
* The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
* Changing requests sent with the cookie must also carry the `X-CSRF-Token` header (double-submit),
  which stops another website from acting for a signed-in person. API clients using
  `Authorization: Bearer` are exempt because browsers never attach that automatically.
* Failed sign-ins are throttled per email and address; a missing account takes the same time as a
  wrong password, so the API does not reveal who has an account.
* Every change is written to the audit log with the actor, the target and the address.

## API

All endpoints answer JSON. Errors look like `{"error":{"code":"forbidden","message":"…"}}`.
Sign in with the cookie (the browser does this) or with `Authorization: Bearer <token>`.

### Authentication

| Method | Path | Who | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | anyone | is the server up, is setup still needed |
| `POST` | `/api/auth/setup` | anyone, only while no account exists | create the first super admin |
| `POST` | `/api/auth/login` | anyone | sign in; returns the user, permissions, CSRF and token |
| `POST` | `/api/auth/logout` | signed in | end this session |
| `GET` | `/api/auth/me` | anyone | who am I, and what may I do |
| `POST` | `/api/auth/password` | signed in | change your own password |

### Items

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/items?type=&status=&person=&q=` | any role |
| `GET` | `/api/items/:id` | any role |
| `POST` | `/api/items` | write permission for that type |
| `PUT` | `/api/items/:id` | write permission for the stored type |
| `PATCH` | `/api/items/:id` | write permission for the stored type |
| `DELETE` | `/api/items/:id` | write permission for the stored type |
| `GET` | `/api/items/archive` | any role |
| `PUT` | `/api/items/archive/:id` | Admin and above |

An item keeps the same field names the browser already uses: `id, type, title, s, pri, f1, f2,
sd, e, sh, ms, rm`, plus `createdAt/By` and `updatedAt/By` added by the server.

### Users and access

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/users` | super admin |
| `POST` | `/api/users` | super admin |
| `PATCH` | `/api/users/:emailOrId` | super admin |
| `DELETE` | `/api/users/:emailOrId` | super admin |
| `GET` | `/api/users/:emailOrId/sessions` | super admin |
| `POST` | `/api/requests` | anyone – "please give me access" |
| `GET` / `DELETE` | `/api/requests[/:id]` | super admin |

### Reporting

| Method | Path | Who |
|---|---|---|
| `GET` | `/api/stats` | any role |
| `GET` | `/api/export?format=json\|csv&type=&status=` | not Viewer |
| `GET` | `/api/audit?limit=&offset=&action=&actor=` | super admin |
| `GET` | `/api/roles` | anyone |

### Example

```bash
# sign in and keep the token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@tracker.com","password":"Admin@1234"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

# create a project
curl -s -X POST http://localhost:3000/api/items \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"Project","title":"Core banking DR site","f1":"Amina","pri":"High"}'

# download everything as CSV
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/export?format=csv" -o tracker.csv
```

## Tests

```
npm test
```

29 tests run against a real HTTP server and a real database: every role's abilities and refusals,
validation, sessions, CSRF, throttling, the audit log and the access-request flow.

## How the browser uses it

`js/api.js` in the project root implements the same small store interface that the browser already
had (`watch` / `set` / `update` / `remove`), so none of the screens changed. On start-up the page
calls `/api/health`:

* **a backend answers** – it signs in against the server, the server decides the role, and all data
  is shared between everyone;
* **nothing answers** – the page behaves exactly as before, storing data in that browser.

To host the page somewhere else (GitHub Pages, Vercel) and the API here, set `CORS_ORIGINS` on the
server and `window.API_BASE = 'https://your-server'` in the page before `js/api.js` loads.

## Files

```
server/
  src/
    index.js        start the server
    app.js          request pipeline: headers, CORS, rate limit, routing, errors
    config.js       every setting, read from .env
    db.js           SQLite schema, migrations and first-run seeding
    crypto.js       scrypt password hashing, tokens
    permissions.js  the role matrix – the one place the rules live
    middleware.js   rate limiting, session lookup, CSRF
    router.js       small pattern router
    static.js       serves the frontend
    repos/          users, sessions, items, requests, audit
    routes/         auth, users, items, meta
  test/api.test.js  the full suite
  scripts/reset.js  wipe the database and reseed
```
