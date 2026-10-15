# Google Sheets backend (Google Apps Script)

Use a Google Spreadsheet as the tracker's database. Everyone shares one live set of data, there is
no server to rent or maintain, and the records stay in a sheet you own and can open, filter and
chart like any other.

This is an alternative to the Node.js server in [`../server`](../server). Pick one. Both enforce
the same four roles, and the page works with either without any change to its screens.

| | Google Sheets | Node.js server |
|---|---|---|
| Hosting cost | free | needs a host that runs Node |
| Setup | paste a script, click Deploy | `npm start` |
| Works with the page on GitHub Pages / Vercel | yes | only if the server is reachable |
| Speed of each action | roughly 0.5–2 seconds | instant |
| Good for | a team up to a few thousand rows | any size |

---

## Deploy it in five steps

**1. Make the spreadsheet**

Open <https://sheets.new> and name it, for example *Task Tracker Database*.

**2. Add the script**

In that sheet choose **Extensions → Apps Script**.

Open this link, press Ctrl+A then Ctrl+C to copy the whole file:

<https://raw.githubusercontent.com/sajalkumar-byte/Infrastructure-and-Support-Technology-Task-Tracker/main/google-apps-script/Code.gs>

Back in the editor, click inside `Code.gs`, press Ctrl+A to select everything that is there,
then Ctrl+V to replace it. Save with Ctrl+S.

> **Paste the right file.** It must be `google-apps-script/Code.gs`, nothing from the `js` folder.
> The correct file is about a thousand lines, its first line of code is `var SHEETS = {`, and it
> never contains the word `window` outside a comment. If the editor's file list on the left shows
> more than one file, delete the others. Pasting `js/gsheet.js` by mistake gives
> `ReferenceError: window is not defined`, because that file is browser code.

**3. Run the setup once**

In the Apps Script toolbar pick the function **`setupTracker`** and press **Run**.

Two optional extras you can run the same way afterwards:

| Function | What it does |
|---|---|
| `addSampleData` | writes thirteen realistic projects, recurring items and tasks so the dashboard is not empty |
| `addSampleUsers` | creates one account per role for testing: `admin2@tracker.com` / `Admin2@1234`, `superuser@tracker.com` / `Super@1234`, `viewer@tracker.com` / `Viewer@1234` |
| `checkDeployment` | checks the installation and prints what is wrong, if anything |

Google asks for permission the first time. Choose your account, then *Advanced → Go to
(project name)* → *Allow*. The warning appears because the script is yours and unverified; it only
ever touches this spreadsheet.

The log then shows the sign-in you will use:

```
Super admin created.
  email:    admin@tracker.com
  password: Admin@1234
```

Change these before running it by adding Script Properties `SEED_EMAIL`, `SEED_NAME` and
`SEED_PASSWORD` (Project Settings → Script Properties). Otherwise change the password after your
first sign-in.

Your sheet now has six tabs: **Users, Items, Sessions, Requests, Archive, Audit**.

**4. Publish it as a Web App**

**Deploy → New deployment → ⚙ → Web app**

| Field | Value |
|---|---|
| Description | Tracker API |
| Execute as | **Me** |
| Who has access | **Anyone** |

Press **Deploy** and copy the **Web app URL**. It looks like
`https://script.google.com/macros/s/AKfy...../exec`.

> "Anyone" means anyone who has that URL may *call the script*. It does **not** share your
> spreadsheet, and the script still refuses everything except health, sign-in and an access
> request unless a valid session token is sent. Treat the URL as a setting, not as a secret.

**5. Point the page at it**

In [`../index.html`](../index.html) there is a commented-out line just above the scripts. Replace
it with your URL:

```html
<script>window.GAS_URL='https://script.google.com/macros/s/AKfy...../exec';</script>
<script src="js/gsheet.js?v=4"></script>
```

Reload the tracker. The sign-in page appears, and from then on everyone who opens the link sees
the same data.

### After changing Code.gs

Apps Script keeps serving the old version until you redeploy: **Deploy → Manage deployments →
✏ → Version: New version → Deploy**. The URL stays the same.

---

## What each role may do

The rules are in one place in `Code.gs` (`WRITABLE_TYPES` and `CAPABILITIES`) and are checked on
every request. Hiding a button in the browser is convenience; this is the part that protects the
data.

| | Super admin | Admin | Superuser | Viewer |
|---|---|---|---|---|
| View everything | yes | yes | yes | yes |
| Create / edit / delete **Tasks** | yes | yes | **yes** | no |
| Create / edit / delete **Projects** and **Recurring** | yes | yes | no | no |
| Download PDF / Excel / print | yes | yes | yes | no |
| Add users and assign roles | **yes** | no | no | no |
| Read the audit log | yes | no | no | no |

Two things worth knowing:

* An edit is checked against the type **already in the sheet**, so sending `type:"Task"` for a
  project does not let a Superuser through.
* Changing someone's role or password ends their other sessions at once, so a demotion applies
  immediately instead of at their next sign-in.

## Forgotten passwords

The sign-in page has a **Forgot your password?** link. The person types their email, the script
emails them a six-digit code, and they type that code with the new password they want.

Sending is free and needs no setup: the mail goes through Gmail using the Google account that owns
the script. A consumer account may send about 100 emails a day, a Workspace account about 1500.
`checkDeployment` prints how much of today's quota is left.

Safeguards, all enforced in the script:

* The code is random, lasts 15 minutes and works once.
* Only a SHA-256 hash of it is written to the `Resets` tab, so the sheet never shows a usable code.
* Five wrong tries throw the code away.
* One address may request five codes an hour, so nobody can be mail-bombed.
* The answer is the same whether or not the address has an account, so the page cannot be used to
  discover who is registered.
* A successful reset signs that person out everywhere.

Tune `RESET_CODE_MINUTES`, `RESET_MAX_TRIES` and `RESET_MAX_REQUESTS` near the top of `Code.gs`.

## The tabs

| Tab | Holds | Safe to edit by hand? |
|---|---|---|
| `Users` | email, name, role, hashed password | Name and role yes. Never type a password here – it must be hashed. |
| `Items` | every project, recurring item and task | Yes, if you keep the column order |
| `Sessions` | who is currently signed in | Clearing it signs everyone out |
| `Requests` | people waiting for an account | Yes |
| `Archive` | older tasks kept for reference | Leave to the app |
| `Resets` | hashed password-reset codes, short-lived | Leave to the app |
| `Audit` | who changed what, and when | Append-only; do not edit |

Because `Items` is an ordinary sheet you can build pivot tables, charts and Looker Studio reports
straight on top of the live data.

## Settings

Project Settings → Script Properties:

| Property | Purpose |
|---|---|
| `SEED_EMAIL`, `SEED_NAME`, `SEED_PASSWORD` | the first super admin, read only by `setupTracker` |
| `SHEET_ID` | use a different spreadsheet instead of the one the script is attached to |

In `Code.gs` near the top: `SESSION_HOURS` (how long a sign-in lasts), `HASH_ROUNDS` (password
hashing effort, raise it for more protection or lower it if sign-in feels slow),
`LOGIN_MAX_ATTEMPTS` and `LOGIN_WINDOW_MIN`.

## Security

* Passwords are stored as salted SHA-256, repeated `HASH_ROUNDS` times. The sheet never holds a
  password as typed.
* Session tokens are random, and only their hash is written to the `Sessions` tab, so a copy of
  the spreadsheet cannot be replayed as a live sign-in.
* Failed sign-ins are throttled per email.
* Every change is appended to `Audit` with the person, the target and the time.
* Writes are serialised with a script lock, so two people saving at the same moment cannot
  corrupt a row.

One honest limitation: Apps Script Web Apps cannot read custom request headers, so the session
token travels in the request body and is kept in each browser's own storage rather than in a
`HttpOnly` cookie. Always use the `https://script.google.com/...` URL so it is encrypted in
transit. If that matters for your data, use the Node.js server instead, which uses cookies.

## Limits

Google's free quotas are generous for a tracker of this size: roughly 20,000 script calls per day
for a consumer account and 90 minutes of total run time. The page refreshes every 12 seconds while
a tab is open and in the foreground, so ten people working all day stay well inside that. Raise
`pollMs` in [`../js/gsheet.js`](../js/gsheet.js) if you want even less traffic.

## Tests

The script can be tested before it is deployed. `test/harness.js` stands in for Google's services
with an in-memory spreadsheet and runs the real `Code.gs`:

```
cd google-apps-script
node --test
```

28 tests cover every role's abilities and refusals, password hashing, sessions, validation,
throttling, the audit log, the access-request flow and id numbering.

## Troubleshooting

| What you see | Why, and what to do |
|---|---|
| The page never leaves "Connecting…" | `GAS_URL` is wrong or the deployment is not "Anyone". Open the URL in a browser: it should print JSON. |
| "The script did not answer with data" | Google returned its sign-in page. Redeploy with **Who has access: Anyone**. |
| Changes to `Code.gs` have no effect | Redeploy a **new version**; the old one keeps serving otherwise. |
| "Authorization required" when running `setupTracker` | Accept the permission prompt: *Advanced → Go to project → Allow*. |
| Sign-in is slow | Lower `HASH_ROUNDS`, or accept it: Apps Script is simply slower than a server. |
