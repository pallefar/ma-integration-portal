# Deployment Guide — TE Connectivity M&A Integration Portal

This portal ships **three modes from one codebase**: a public **demo showcase**, a
plain **dev/test** mode, and the **real-deal** mode that holds material non-public
information (MNPI) about live acquisitions. They are selected by how the server is
launched. Choosing the wrong launcher on a real-deal host either disables
authentication (demo) or leaves the host on published credentials and the committed
database files (dev). Only real-deal mode is safe for MNPI.

## Choose the right launcher

| Host purpose | Launcher (macOS/Linux) | Launcher (Windows) | Mode | Auth |
|---|---|---|---|---|
| **Real acquisition data (MNPI)** | `start-real-deal.command` | `start-real-deal.bat` | real-deal (`MA_MODE=real`) | **Mandatory (fail-closed)** |
| Demo / showcase only | `start.command` | `start.bat` | demo (`DEMO_OPEN=1`) | Open |
| Development / test | `node server.js` | `node server.js` | dev | Mandatory (fail-closed) |

> **Never run `start.command` / `start.bat` on a host that will hold real deal
> data.** Those launchers set `DEMO_OPEN=1`, which disables all `/api`
> authentication and authorization so the showcase runs without a login. The
> real-deal launchers deliberately do not set it — they clear any `DEMO_OPEN`
> inherited from your shell or profile — and the server refuses to boot at all
> when `MA_MODE=real` and `DEMO_OPEN=1` are set together.

The server prints a `[security]` warning at boot whenever `DEMO_OPEN=1` is in
effect — if you see that line on a real-deal host, stop and switch launchers.

## Three modes

| | demo | dev / test | real-deal |
|---|---|---|---|
| Selected by | `DEMO_OPEN=1` (the `start.*` launchers) | neither variable set (plain `node server.js`) | `MA_MODE=real` (the `start-real-deal.*` launchers) |
| Database files | the **committed** `data/*.db` | the **committed** `data/*.db` | its **own** data directory: `data/real` (gitignored) or `MA_DATA_DIR` |
| Accounts | the four published demo accounts | the four published demo accounts, **read-only** | none until you run `scripts/bootstrap-admin.js`; managed in the admin console |
| Authentication | `/api` open for the demo lane | required | required; demo credentials unusable |
| Fit for MNPI | **No** | **No** (published passwords, committed files) | **Yes** |

- **demo** — the showcase: `DEMO_OPEN=1` makes the demo lane open so no login is
  needed. Real deals are never served open.
- **dev / test** — what plain `node server.js` runs: authentication is required, but
  the host uses the committed `data/control.db` and `data/demo.db`, whose published
  demo passwords are public. The server treats that control database as **read-only
  for accounts**: password changes, session ending, user management and creating
  real deals are refused with a message that names the real-deal launcher.
  `GET /api/auth/mode` reports `accountsWritable:false` and the UI hides or disables
  those controls. Use a real-deal host to manage accounts.
- **real-deal** — `MA_MODE=real`. The server never opens or writes a committed
  database file in this mode (it refuses to boot rather than do so), the data lives
  in its own directory, and the published demo accounts do not exist. Any other
  `MA_MODE` value (`REAL`, `prod`, …) is refused at boot rather than silently
  falling back to dev behaviour.

## Real-deal first run

1. **Start with the real-deal launcher** (`start-real-deal.command` /
   `start-real-deal.bat`). It exports `MA_MODE=real`. On first boot the server
   creates the real-deal data directory — `data/real` under the install folder, or
   the folder named by `MA_DATA_DIR` — with mode `0700`. It is gitignored and
   excluded from the in-app download. `control.db` there is seeded from the
   committed one with **every demo account removed** (no users, no deals), and
   `demo.db` is a plain copy. Environment variables `MA_CONTROL_DB_PATH`,
   `MA_RUNTIME_DB_PATH`, `MA_AUDIT_DB_PATH`, `MA_DEMO_DB_PATH` and `MA_DEALS_DIR`
   still override individual paths when set; pointing any of them at a committed
   `data/*.db` file makes the server refuse to boot.
2. **Create the first admin** on that host, once, as the service user, with the
   same environment (in particular the same `MA_DATA_DIR`) the service uses:
   ```
   node scripts/bootstrap-admin.js
   ```
   It asks for a password on a no-echo prompt (typed twice), or reads
   `MA_BOOTSTRAP_PASSWORD` from the environment for unattended installs. It never
   accepts the password on the command line. The account is named `admin`, carries
   a must-change flag, and the action is recorded as a `cli:<os-user>` security
   event. It refuses to run if any account already exists.
3. **Sign in and change the password.** The bootstrap password is one-time: the
   first sign-in is fenced to the change-password screen until you set a new one.
   Real-deal mode requires **at least 12 characters** and rejects the published
   demo passwords.
4. **Create people in Admin console → Users.** Choose username, display name and
   role; the temporary password is shown **once** (copy it then) and the person is
   forced to change it at their first sign-in. Role changes and disabling take
   effect on the person's very next request. There is no delete — **disable** an
   account instead; at least one enabled admin always remains (the last one cannot
   be disabled or demoted).
5. **Enable OS full-disk encryption** on the host. Deal databases are stored
   unencrypted at the application layer by design this milestone; disk-level
   encryption plus the documented access policy is the control. (SQLCipher was
   deferred.)
6. **Back up the data directory** (`data/real` or `MA_DATA_DIR`) with the same
   handling as the source data — it contains MNPI once real deals are created.

`node scripts/set-admin-password.js` still exists: it rotates the `admin` password
on the **active** data directory (the same one the service uses) and, like the
bootstrap script, takes the password from the `ADMIN_PASSWORD` environment
variable or a prompt rather than the command line. On a host with **no** accounts yet, use
`scripts/bootstrap-admin.js` instead.

### Files at rest

Every database file the server creates or opens is held at `0600` (including the
`-wal` / `-shm` sidecars) and every directory it creates at `0700`, **regardless of
the process umask**. On macOS/Linux additionally run the service as a dedicated
non-login service user so that only it (and root) can read the data directory. On
Windows the permission bits are not enforceable, so protection relies on the
user-profile ACLs of the account running the service. In dev/demo a pre-existing
file the process cannot tighten (read-only mount, foreign owner) produces a single
`[security]` warning; in real-deal mode the server refuses to start instead.

## Credential lockdown

If a real-deal host is started on a hand-copied **committed** `control.db` (for
example by copying `data/control.db` into `data/real`), an enabled account may still
verify a published demo password. The server detects that at boot and at sign-in and
enters **credential lockdown**:

- a `[security] CREDENTIAL LOCKDOWN` banner is logged naming the affected accounts;
- the server answers `403` to everything **except** the sign-in page and its static
  assets, `/api/auth/*` and the `/healthz` probe (read-only). API clients receive
  `{"credentialLockdown":true}`; browsers get a fixed explanation page;
- **Remedy:** sign in as each affected account with its published password (the
  sign-in is then fenced to the change-password screen) and set a new private
  password of 12+ characters. The lockdown lifts by itself when no enabled account
  verifies a published password any more. The clean alternative is to stop the
  service, remove the hand-copied database files and let the next boot seed the data
  directory without demo accounts.

Dev and demo mode are never locked down; real-deal mode seeded by the launcher has
no demo accounts and therefore never triggers it.

## Behind a reverse proxy / TLS

The usual deployment terminates TLS in a reverse proxy (nginx, Caddy, …) in front of
Node. Three settings tell the server about it:

- **`TRUST_PROXY`** — the number of proxy **hops** in front of Node (`1` for a
  single nginx/Caddy). Use an **integer hop count**. Do **not** use a CIDR/subnet
  or address list until the `proxy-addr` advisory is patched in the committed
  dependencies (tracked under REL-02, Phase 21). With `TRUST_PROXY` set Express
  derives the client address and the `https` scheme from `X-Forwarded-*`.
  **Without it, behind a proxy every user arrives from the proxy's own address and
  they all share one per-source sign-in budget**; the server logs a `[security]`
  warning when it sees a https `PUBLIC_BASE_URL` or forwarded headers with
  `TRUST_PROXY` unset.
- **`PUBLIC_BASE_URL`** — the externally visible origin (default
  `http://localhost:<PORT>`). When it is `https://…`, or a request is https as seen
  through a trusted proxy, the session cookie is marked **`Secure`**. This is
  independent of `ENABLE_HSTS`.
- **`ENABLE_HSTS=1`** — sends `Strict-Transport-Security: max-age=31536000`.
  `includeSubDomains` is added **only** when `HSTS_INCLUDE_SUBDOMAINS=1` is also
  set — on a shared corporate parent domain that directive pins every sibling host
  to https for a year, which is your decision to make.

Sign-in throttling is **per account** (the first five failures inside 15 minutes are
free, then an exponential backoff starting at one second, capped at 5 minutes for
every account name alike, so the throttle cannot reveal which names are admins) plus
a generous **per-source** limit (fifty failures), so one person mistyping a password
cannot lock the rest of the team out. A throttled sign-in answers `429` with a
`Retry-After` header and the same body whether the account exists or not.

### Sign-in lockout recovery

Throttle state is held only in the memory of the server process and is never
persisted. Every account's backoff is capped at **5 minutes** (the same ceiling for
admins and everyone else). A locked-out admin therefore either waits it out or the operator **restarts**
the service, which clears every throttle entry. If the admin password itself is lost
or suspected compromised, stop the service, run
`node scripts/bootstrap-admin.js --force-reset-admin` (it rotates the admin
password, forces a change at the next sign-in and ends the admin's sessions), then
start the service again. `--force-reset-admin` does not reach into a running
server — the **restart** is what clears the throttle.

## Self-service

Every signed-in person has **Change password** and **My sessions** in the account
menu: the current device is marked, and any other session can be ended. On the
dev/demo committed database (`accountsWritable:false`) **Change password** is
disabled with an explanatory note; **My sessions** still lists your sessions but
offers no **End session**.

## Roles and what they can read

Every account has exactly one of four roles. In the portal they are shown as
**Admin** (`admin`), **Integration Leader** (`hrbp`, the person who runs the deal),
**Workstream lead** (`pmo`) and **Employee** (`employee`). What a role may *read* is a
declared table, evaluated by the server on every `GET` / `HEAD` request — the
browser hiding a control is a convenience, never the enforcement.

- **Fail-closed.** A read route with no row below is refused (`403`) for every role
  on a real deal. A route added without a row fails the test suite
  (`test/read-policy-coverage.test.js`), so the table cannot silently fall behind.
- **One spelling.** The verdict is taken over the canonical form of the path
  (decoded once, `//` collapsed, trailing slash dropped, lower-cased): `/api/Synergies`,
  `/api//raid` and `/api/%73ynergies` get the same answer as `/api/synergies`.
- **The showcase is lenient on purpose.** Requests that resolve to the demo store
  (demo mode, dev mode without a deal, `DEMO_OPEN=1`) are not judged by this table, so
  the demonstration behaves exactly as it always has. The table applies to every
  request bound to a **real deal** and to the control-plane routes (`/api/deals*`,
  `/api/admin*`, `/api/auth/sessions`) always.
- **Drift is a build failure.** `test/deployment-role-matrix.test.js` compares the
  table below with `lib/readPolicy.js` row for row, in order.

| Route prefix | admin | hrbp (Integration Leader) | pmo (workstream lead) | employee | Why |
|---|---|---|---|---|---|
| `/api/admin` | yes | no | no | no | Account roster, audit log, source and database archive downloads (every method). |
| `/api/auth/sessions` | yes | yes | yes | yes | Each role lists and ends only its own sessions. |
| `/api/deals` (exact) | yes | yes | yes | yes | The deal list, already filtered to the deals the caller is a member of (the deal switcher). |
| `/api/deals` | yes | yes | no | no | Per-deal member grants and clearance map (`/api/deals/:id/grants`). |
| `/api/synergies` | yes | yes | yes | no | Synergy financials (run-rate, one-time cost, owners). |
| `/api/integration-tasks` | yes | yes | yes | no | Task lane; titles can name the pre-announcement target. Clearance-filtered per record. |
| `/api/checklist-templates` | yes | yes | yes | no | Templates that feed the task lane. |
| `/api/raid` | yes | yes | yes | no | Risks, issues and decisions about the deal. Clearance-filtered per record. |
| `/api/org` | yes | yes | yes | no | Org design: named positions, target-state designs, retention data. Clearance-gated. |
| `/api/dd` | yes | yes | yes | no | Due-diligence workspace; handlers additionally apply per-area clearance. |
| `/api/reports` | yes | yes | yes | no | IMO exports and the report pack aggregate every deal dataset. |
| `/api/employees` | yes | yes | yes | no | The named roster (names, e-mails, departments). |
| `/api/communications` | yes | yes | yes | no | Communications log can name affected populations pre-announcement. |
| `/api/projects` | yes | yes | yes | no | Project list carries target and project names. |
| `/api/processes` | yes | yes | yes | no | Process integration catalog (sending to receiving). |
| `/api/assessments` | yes | yes | yes | no | Named assessment results. |
| `/api/ai/insight` | yes | yes | yes | no | Sends portal data to the AI provider (third-party egress). |
| `/api/rag/search` | yes | yes | yes | no | Deal uploads are indexed; a search would return their text. |
| `/api/assessment-instances` | yes | no | no | no | Admin-only, matching the handler guard. |
| `/api/hrbps` | yes | yes | no | no | Integration Leader directory with colleague e-mail addresses. |
| `/api/assessment/latest` | yes | yes | yes | yes | Org-level latest scores, not personal. |
| `/api/assessment-templates` | yes | yes | yes | yes | Question templates a respondent needs. |
| `/api/assessment-status` | yes | yes | yes | yes | Completion status with respondent names stripped. |
| `/api/settings` | yes | yes | yes | yes | Admin gets the full object; every other role gets the public allowlist only (no API key, no connection details). |
| `/api/departments` | yes | yes | yes | yes | Department list (employee dashboard). |
| `/api/modules` | yes | yes | yes | yes | Learning modules. |
| `/api/questions` | yes | yes | yes | yes | Assessment questions a respondent needs. |
| `/api/slides` | yes | yes | yes | yes | Slide content. |
| `/api/courses` | yes | yes | yes | yes | Learning courses. |
| `/api/lessons` | yes | yes | yes | yes | Learning lessons. |
| `/api/i18n` | yes | yes | yes | yes | Translations. |
| `/api/menus` | yes | yes | yes | yes | Menus the shell renders for every role. |
| `/api/pages` | yes | yes | yes | yes | CMS pages. |
| `/api/banners` | yes | yes | yes | yes | Banners. |
| `/api/media` | yes | yes | yes | yes | CMS media. |
| `/api/notifications` | yes | yes | yes | yes | The caller's notifications; task and RAID nudges are withheld from roles that cannot read those lanes. |
| `/api/alerts` | yes | yes | yes | yes | Alerts. |
| `/api/pulses` | yes | yes | yes | yes | Pulse feed projected per role in a real deal (see Personal data below). |

### Configuration and content are admin-only to write

Instance configuration and shared content can be changed by an **admin** only. A
Workstream lead, Integration Leader or Employee receives `403` on every method that
changes these, under every path spelling; the stored data is untouched.

| Write route | Covers |
|---|---|
| `/api/settings` | instance settings, the company profile, the AI-provider key, the new-acquisition reset (`/api/settings/new-ma`) |
| `/api/menus` | navigation menus |
| `/api/pages` | page content and layouts |
| `/api/banners` | banners |
| `/api/slides` | slides and slide uploads (`/api/slides/upload`) |
| `/api/media` | the media library |
| `/api/i18n` | translations |
| `/api/courses` | courses and their lessons (`/api/courses/:id/lessons*`) |

The one exception is the demo-only time-travel control (`POST /api/settings/time-travel`),
which is refused outside the demo store anyway.

`GET /api/settings` returns the **full** object to an admin and a **public allowlist**
to everyone else (target-company profile, welcome-video settings, role visibility,
the demo/timeline flags and the synergy defaults — and `hasGeminiApiKey`, a boolean
that says whether a key exists, never the key). A setting added later is withheld
from non-admins until someone adds it to the allowlist
(`PUBLIC_SETTINGS_KEYS` in `validators/settings.js`).

### Deal-level values: the Integration Leader's route

The values an Integration Leader legitimately changes for **their own deal** are not
instance settings. They are posted to `POST /api/deals/:id/setup` as
`{ "dealSettings": { ... } }` by an admin or by an `hrbp` who is a member of that
deal (a non-member receives the same `404` a missing deal gets):

| Field | Bounds |
|---|---|
| `currency` | text, at most 10 characters |
| `day1Date` | text, at most 10 characters (`YYYY-MM-DD`) |
| `synergyTargetM` | number, 0 to 100000 (millions) |
| `synergyStaleDays` | number, greater than 0, at most 365 |
| `synergyHorizonYears` | whole number, 1 to 15 |

A value set on the deal wins over the instance setting, which wins over the built-in
default. Every change is recorded as a `deal-settings-update` security event with
the before and after values.

### Personal data

- **Pulse feedback** (`/api/pulses`, real deals only). An admin or Integration
  Leader reads every named rating and comment. An author reads their own. A
  Workstream lead reads their own plus one **aggregate row** per other pulse
  carrying only `rating`, `type` and the calendar day, re-ordered so arrival order
  does not identify anyone. An Employee reads only their own. Authorship is stamped
  from the signed-in account on the server, never from the request body.
- **Integration Leader directory** (`/api/hrbps`, colleague e-mail addresses) is
  admin and Integration Leader only.
- **The employee's own roster record.** A role that may not read the roster
  resolves only the record derived from its own account when it opens the employee
  portal (`POST /api/employees/get-or-create`); a colleague's id or name supplied in
  the request is ignored. No `GET` request changes application data (an instrumented
  test drives every registered `GET` route; only append-only read-audit rows are
  written).

### Clean-room clearance reaches tasks and RAID entries

A task or RAID entry that came from a due-diligence area (a converted finding, a
flight-risk conversion) carries that area. A deal member who is **not cleared** for
the area gets `404 {"error":"Not found"}` — byte-for-byte what a missing id returns —
on reading, updating, flipping the status of, deleting or re-converting it, with or
without a version, and the record's fields appear in no response. Lists simply omit
it. The Integration Leader and admin are cleared for every area; any other member
needs an explicit grant (`POST /api/deals/:id/grants`). A genuinely missing id and an
invisible one are indistinguishable to the caller by design; the refusal of an
invisible record is audited as `clearance-404`, a genuinely missing id is not.

### Controls the portal hides

The portal asks the server what the signed-in role may do (`access` on
`GET /api/auth/me`) and does not draw a control that could only answer `403`:

| When the role cannot… | The portal hides |
|---|---|
| read the roster | the Acquired Team Leaderboard, the Leaders portal roster, the chatbot's roster summary (neutral line instead) |
| read communications | the employee notifications banner list and the Digital Broadcast Archive |
| read the Integration Leader directory | the provisioning desk in the PMO console, the profile menu's leader lookup, the wizard directory |
| use AI insight / playbook search | the AI-Insight card (the chatbot keeps answering without playbook snippets) |
| read synergies, diligence or org | the matching panels and nudges on the deal home |
| write configuration (everyone except admin) | the admin console's course, slide, page, translation, menu, banner and media tabs; the settings, role-visibility, custom-M&A and database cards; the demo/edit-mode switches; inline "Edit Content"; the PMO demo-mode switch and custom-setup wizard; the AI-model download prompt |
| file a communication (Employee) | the HR helpdesk card on the employee portal; a ticket that is refused anyway shows an error, never "Inquiry Received" |
| read the assessment instance trends (everyone except admin) | the per-template instance requests on the assessments page (the scorecard falls back to the status roll-up) |
| use the demo time machine (every role in a real deal) | the Day pill |

Hiding is presentation only; the server is the control and answers `403` to every
call a hidden control would have made. On top of it the portal sends a signed-in
session **home** (`/`) when its server-verified role is not on a page's access list:
`admin.html` is for admin and Integration Leader, `pmo.html` for admin and workstream
lead, `employee.html` for admin, workstream lead and employee, and `dashboard.html`,
`execution.html`, `assessments.html` and `survey.html` for admin, workstream lead and
Integration Leader; `due-diligence.html` / `org.html` are open to any role that may
read `/api/dd` / `/api/org` (an employee may not). The check uses the role the server
verified, never one inferred from the path. The open demonstration (no sign-in) has no
role and keeps its path-derived personas.

### Deal records are projected per role

The deal registry record carries the deal size, signing and close dates, the
Integration Leader's synergy target and who is cleared for which clean-room area.
Membership decides *which* deals a caller sees; the role decides *what* of each deal:

| Role | `GET /api/deals`, the select echo and every setup/members/grants response hold |
|---|---|
| admin, Integration Leader | the full record |
| workstream lead | `id`, `name`, `targetCompany`, `status` |
| employee (and any unknown role) | `id`, `name`, `status` |

The allowlist lives in `lib/dealProjection.js`; a field added to the registry record
later is withheld from the two lower roles until it is listed there.

The `access` map is booleans only (no data) and carries two kinds of key. Most keys
are **read probes** - each is the read-table verdict for one representative route
(`synergies`, `raid`, `tasks`, `roster`, `communications`, `org`, `dd`, `reports`,
`hrbps`, `projects`, `processes`, `assessmentsList`, `ai`, `rag`; defined in
`ACCESS_PROBES` in `lib/readPolicy.js`) and are all `true` on the demo store. The
keys below do not map to a row of the read table above:

- `assessmentInstances` - may the role read the per-template assessment instance
  list (`/api/assessment-instances`)? `true` for **admin** only (a read probe of
  the admin-only row above; the portal falls back to the status rollup without
  asking when it is `false`).
- `configWrite` - may the role change instance configuration and content (the
  admin-only write table above, probed with `POST /api/settings`)? `true` for
  **admin** only.
- `helpdesk` - may the role file the employee-portal HR helpdesk ticket
  (`POST /api/communications/send`)? `true` for **admin**, **Integration Leader**
  and **Workstream lead**; `false` for **Employee**, so the portal does not draw a
  form that could only be refused.
- `timeTravel` - is the demo Day pill / Time Machine usable
  (`POST /api/settings/time-travel`)? `true` for **admin**, **Integration Leader**
  and **Workstream lead** only while the session is **not** bound to a real deal
  (the control is demo-only); always `false` for **Employee** and for any
  deal-bound session.

### Refused requests are audited

Every refusal above is a `403`/`404` the server records as an `access-denied` event,
**rate-bounded to at most one audit row per account + method + route + reason per 60
seconds per server process**, with the folded count written as the next row. The
details, including the accepted loss of pending counts on a crash, are in the next
section.

## Denial audit (refused requests)

Every request that the central authorization gate, the deal resolver, the
credential lockdown or a clearance guard **refuses on authorization grounds** is
written to the audit trail as an `access-denied` security event, visible to an
admin in the audit viewer (Admin console, **Audit**). Not yet covered (tracked for a
later release): about twenty handler-level inline 403s — organisation-design write
clearance, Integration-Leader-only inline checks, deal-member administration,
selecting a deal one is not a member of, and assessment-owner checks — answer 403
without an audit row. Each event records the account (or `(anonymous)`), the HTTP method,
the canonical route (a template such as `DELETE /api/raid/:id`, never a record id),
the reason, the HTTP status, and the deal when one applies. Reasons: `no-session`
(401), `must-change-password`, `demo-only`, `role-write`, `role-read`,
`deal-access`, `role-inline` and `credential-lockdown` (all 403), and
`clearance-404` (a record the caller is not cleared for, answered 404 exactly like
a missing id). A genuinely missing id is **not** recorded. Audit rows never carry
request bodies, passwords or record content.

- **Rate-bounded.** The audit trail is append-only, so a probe must not be able to
  flood it: at most **one row per account + method + route + reason per 60 seconds**.
  Further identical refusals inside the window are counted, and when the window ends
  the count is written once as the next row (`folded: true`, `count: n`). The
  bound is per route *template*, so probing many random ids on one route is a single
  key. The in-memory key table is capped (5000); beyond that, refusals fold into one
  `(overflow)` key per reason.
- **Crash loss (accepted).** The folded counts of the *current* window live in
  process memory until the window ends. If the server is killed or crashes inside
  a window, that window's not-yet-written folded count is lost; the first refusal of
  every window is always already on disk, so the *fact* of a probe is never lost —
  only its repeat count. A graceful restart loses the same pending counts.
- **Per process.** The bound applies per server process; the supported shared-host
  shape runs a small fixed number of processes against one SQLite file, so the
  worst case is that number times the rate above.
- **Busy audit database.** If the audit database cannot be written because of
  write-lock contention, the refused request is answered `503` with `Retry-After`
  (never turned into a success) and the client retries.
- **Clean-room clearance refusals use the same bound.** The due-diligence and
  organisation clearance refusals keep their own audit action names
  (`dd-access-denied`, `org-positions-target-access-denied`,
  `org-decisions-access-denied`, `org-flightrisk-access-denied`) and the same row
  shape as before, but are rate-bounded exactly as above: the first refusal of a
  window is written at once, later identical refusals are counted and written once
  as the next row (`after.folded: true`, `after.count: n`). For `dd-access-denied`
  the subject (the item's area, or empty for an unknown id) is part of the key, so
  "unknown id" and "uncleared area" remain separate rows. Every rate key also
  includes the deal, so a refusal in one deal is never counted under another.

## ADMIN_TOKEN (optional break-glass, discouraged)

`ADMIN_TOKEN` is an optional shared secret: a request carrying it in the
`X-Admin-Token` header acts as an attributed `admin-token` admin identity, and every
use is written to the audit trail. It is **not** a substitute for accounts — a
shared secret cannot be attributed to a person or revoked per person. Prefer
per-person accounts (`scripts/bootstrap-admin.js`, then the admin console **Users**
tab) and leave `ADMIN_TOKEN` unset. If it is set the server logs a `[security]`
warning at boot.

## Platform support envelope

- **Node.js:** requires `>= 22` (bundled in the turnkey zips as a portable Node;
  system Node also works).
- **Linux:** the committed `better-sqlite3@13.0.1` native prebuilds require
  **glibc >= 2.38** — i.e. **Ubuntu 24.04+ / Debian 13+**, or a musl
  distribution (Alpine; musl prebuilds ship too). Older glibc hosts
  (Ubuntu 22.04, Debian 12) fail to load the SQLite binding at boot.
- **macOS:** arm64 and x64 both verified.
- **Windows:** x64 and arm64 prebuilds ship; launch with `start-real-deal.bat`.

## Known limitations

- **Deal-settings change audited after the control-plane write (accepted).**
  `POST /api/deals/:id/setup` (and the older `/api/deals/:id/members` route)
  commits the change to the deal registry first and appends its
  `deal-settings-update` audit event second. If the audit database is busy at that
  instant the request answers `503` and the client silently retries; because the
  update is a plain overwrite of the same values (idempotent), the retry leaves the
  same end state and writes the audit event, so the only effect is that the first,
  unaudited attempt is not separately recorded. Moving the audit append inside the
  registry transaction (as deal-data writes already do) is planned with the
  runtime-hardening work (Phase 20).
- **`compression` dependency (GHSA-vc2v-76pw-4v95).** The committed tree ships
  `compression@1.8.1`; the fixed `1.8.2` is pending the dependency-legitimacy age
  gate and is tracked under REL-02 (Phase 21) or an earlier quick task. The
  advisory is a denial-of-service (memory growth on premature connection close).
  This note is removed once `1.8.2` is committed.
- **AI-Insight wizard downloads model weights at runtime.** The optional
  AI-Insight feature fetches Transformers.js model weights from the Hugging Face
  Hub on first use, which departs from the otherwise self-contained / no-CDN
  posture. It is **user-gated** — unreachable unless a user explicitly opens the
  AI-Insight wizard — and is **deferred to a follow-up task** (vendoring the
  weights or gating the feature to demo mode). Real-deal hosts that must stay
  fully offline should not use the AI-Insight feature until this is resolved.
- **Client-side XSS sink audit is partial.** The milestone security review
  traced the highest-risk stored-string→`innerHTML` sinks and fixed the
  confirmed ones; the full sink class across the legacy frontend is not
  exhaustively proven. Treat any new user-authored free-text rendering as
  requiring explicit escaping.
