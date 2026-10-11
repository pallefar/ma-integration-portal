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
   the folder named by `MA_DATA_DIR` — with mode `0700`. Only the default
   `data/real` is both gitignored and excluded from the in-app download. Point
   `MA_DATA_DIR` at a folder **outside the install folder**: a new subfolder of
   `data/` is gitignored but still reaches the in-app download, and any other
   folder inside the install folder is neither. `control.db` there is seeded from the
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

## Audit trail: partitions, seal, export, purge and retention

Real acquisition data is MNPI, so the audit trail is both a compliance record and
itself sensitive: it holds full before/after snapshots of deal records. From the
Phase 12 release the trail is split per deal so that one deal's history can be
closed out — sealed, exported, and eventually purged — without touching any other
deal's, and so that tampering is detectable.

### 1. Layout

All three live inside the data directory (`data/real` or `MA_DATA_DIR`), files
`0600` in directories `0700`, gitignored and excluded from the in-app download —
**include the `audit/` directory in your backups** next to `audit.db`.

- `audit.db` — the **control-plane** log: deal create / archive / delete, member
  and grant changes, user and credential events, read audits, `access-denied`
  refusals, CLI and break-glass-token use, and the lifecycle records of the
  partitions themselves (seal, export, purge).
- `audit/<dealId>.db` — one deal's **record history** (every audited write to that
  deal's data), hash-chained.
- `audit/legacy.db` — rows of deals that were already deleted before the upgrade.
  The upgrade seals it (read-only, SHA-256 recorded); it is never written again.

The Admin console **Audit** tab and `GET /api/admin/audit` read all of them
together; each row is tagged with its partition.

**Durability.** `audit.db` and every partition are flushed to disk on every
commit (SQLite `synchronous = FULL`, plus `fullfsync` on macOS), and a deal
write's audit row is committed before the deal write itself — so after a power
loss or OS crash an audit row can be present for a write that did not survive,
but a surviving deal write never lacks its audit row. Measured cost on the dev
host (`scripts/perf/write-latency.js`, 5,000 RAID / 1,000 tasks): median
`POST /api/raid` 21.7 ms, `POST /api/integration-tasks` 9.2 ms against the
40 ms budget.

### 2. Tamper evidence

Every row of `audit.db` and of every partition is linked to the one before it by a
SHA-256 hash that covers the whole row (including the previous hash). An edited,
deleted or reordered row breaks every link after it. Check a host at any time:

```
node scripts/audit-verify.js --all          # audit.db + every partition (exit 0 = all OK)
node scripts/audit-verify.js --deal <dealId>
node scripts/audit-verify.js --jsonl <export.jsonl>   # an exported trail, standalone
```

A sealed partition is additionally compared with the SHA-256 its seal event
recorded in `audit.db` (`sealed-sha=match`); a flipped byte reports `MISMATCH`.
A row inserted without a hash (for example by an older release run after a
rollback) is reported once as `unchained-row` and exits `1`.

**Residual.** The chain detects edits, deletions and reordering inside a file. It
cannot detect *truncation of the tail* of a partition that is not sealed yet (a
shorter, still valid chain), and a whole file replaced by an older valid copy is
only caught once the partition has been sealed and its hash recorded. Sealing at
deal end is therefore what makes the trail evidence. Someone with write access
to the data directory *and* the ability to re-compute every hash after an edit is
outside this control; keep the data directory private to the service user.

### 3. Deal-end path for MNPI (seal → export → verify → purge)

1. **Archive the deal** (Admin console). Only a closed deal's trail can be sealed;
   an active deal is still being written.
2. **Seal** it: Admin console deal audit panel, or
   `node scripts/audit-admin.js seal <dealId> --confirm <dealId>`. The partition
   gets a final chained `partition-seal` row, becomes read-only (`0400`) and its
   SHA-256 is written to `audit.db` as an `audit-partition-sealed` event. There is
   no unseal. A seal refused with `checkpoint-busy` means another process still
   holds the file open; retry once it is gone.
3. **Export** it as JSONL: panel, or
   `node scripts/audit-admin.js export <dealId> --out <file.jsonl>` (a new `0600`
   file, never overwritten). Store the export under TE's records policy — it
   contains the full MNPI history.
4. **Verify** the export: `node scripts/audit-verify.js --jsonl <file.jsonl>`. It
   prints the file's SHA-256, which is also recorded in the
   `audit-partition-exported` event.
5. **Purge** after the retention period (below):
   `node scripts/audit-admin.js purge <dealId> --confirm <dealId>`. A purge is
   refused unless the partition is sealed, still matches its seal, an export of
   exactly that sealed state is on record, and the retention period has elapsed.
   Every refusal and the purge itself are control events.
6. **Delete the deal** (Admin console) once its trail is purged or exported.

### 4. Retention is TE legal's decision and is never automatic

`MA_AUDIT_RETENTION_DAYS` sets the period, counted from the seal event.
**Unset, empty or `never` (the default) means a partition is never purged** — the
purge is always refused with `retention-never`. A value that is not a positive
integer is treated as `never` (and warned once), so a typo can never shorten
retention. **TE legal owns the period**: the number is not chosen by this
software or by IT, and nothing in the system purges on a timer. A purge is only
ever an explicit, confirmed admin or CLI action.

### 5. What remains in `audit.db` after a purge

Purging removes a deal's partition file; it does **not** rewrite `audit.db`
(append-only by design — it is the evidence that the lifecycle happened). Still
present afterwards:

- the deal registry snapshots in the `deal-create`, archive and delete events
  (deal codename and target company name);
- member and grant changes naming the deal;
- read audits and `access-denied` events that name the deal id;
- the seal, export and purge events themselves (hashes, row counts, timestamps).

Whether that residue is acceptable after the retention period is a **TE legal
decision**; this release does not purge it. Raise it before the first real deal
ends.

### 6. The upgrade (migration #1) — backup, disk rule, duration, rollback

On the first boot of this release against an existing `audit.db` the server runs
**migration #1** *before it starts listening*: it takes a backup, moves each
deal's rows into `audit/<dealId>.db` (rows of deals already deleted go to the
sealed `legacy.db`), and rebuilds `audit.db` as the chained control log with the
original row ids preserved. Counts are asserted per partition (no row lost or
duplicated) and both chains are verified before it commits; a failure changes
nothing in `audit.db`.

- **Backup:** `audit.db.pre-v1.bak` (mode `0600`, same MNPI handling as
  `audit.db`) is written first, WAL-aware. Delete it only after you have
  verified the upgraded host and your own backups cover the new layout.
- **Disk rule:** the upgrade refuses to start the migration (instance not-ready,
  reason `insufficient-disk-for-migration`, nothing written) unless the data
  volume has at least **3 × the `audit.db` size + 64 MB** free.
- **Not-ready until done:** the process does not accept connections while the
  migration runs; set the supervisor's start timeout accordingly. If the migration
  fails the instance *does* listen but `GET /healthz` answers `503` with
  `family: audit, migration: 001-partition-legacy, reason: migration-failed`
  (no path, no deal id) and every request fails closed. A re-run after the cause
  is fixed completes without duplicating a row; it never opens the sealed
  `legacy.db` for writing.
- **Measured cost** (synthetic legacy file, `node scripts/perf/legacy-audit-migration.js`;
  never run on real data): 150,000 rows, 158 MB source file, 1,000 deals of which
  800 existed → boot with migration **6.4 s** (≈ 6.3 s of migration), peak WAL
  5.3 MB, peak scratch 512 MB in total (the source file, the `.bak`, the
  partitions and their sidecars; about 354 MB — 2.2 × the file — on top of the
  source, inside the 3 × rule), 114,105 rows into 800 partitions, 28,270 into
  `legacy.db`, 7,625 kept. **Extrapolated, not measured:** a 5 GB legacy file
  scales to roughly 3–4 minutes of migration and ≈ 16 GB peak scratch
  (the linear extrapolation overstates the fixed per-partition overhead, so the
  real figure is lower); the disk rule needs ≥ 15.1 GB free for that size.
- **Rollback:** the forward step is one-way, recovery is a restore. Stop the
  service; copy `audit.db.pre-v1.bak` over `audit.db` (control events written
  since the upgrade exist only in the file you replace — keep a copy); remove
  `audit.db-wal` and `audit.db-shm`; start the previous release. Partition files
  created by the migration are left in place, never deleted, and stay readable
  with any SQLite tool. The previous release does not read partitions, so a deal's
  record history is not visible in its audit viewer until you upgrade again.

### 7. Windows

A purge deletes the partition files, so **no other process may hold them open**
(stop any SQLite browser or backup job that has the file open, then retry). A seal refused `checkpoint-busy` is retried once the other
reader is gone. POSIX file modes do not apply on Windows; the sealed file is
protected by its read-only attribute and the user-profile ACLs.

### Residuals of this section

- Tail truncation of an unsealed partition and replacement by an older valid file
  are detectable only after sealing (see 2).
- A crash can lose at most the denial counts of one open rate window (Denial audit
  above); it never loses the first denial of a window.
- A purge does not remove the control-plane residue listed in 5.

## Content safety

A deal host stores content that people author (pages, lessons, banners, translations,
slides) and renders it to other people who are signed in. Three layers keep that
content from running as script in someone else's session:

1. **Sanitising.** Stored HTML is reduced to a fixed allowlist of elements,
   attributes and URL schemes when it is written (server) and is built from the same
   allowlist again when it is rendered (browser).
2. **A strict Content-Security-Policy, enforced.** Script that survives both
   layers still cannot run: the policy permits no inline script, no `eval` and no
   third-party script origin.
3. **Third-party services are off unless an admin switches them on** in a real-deal
   instance, and uploaded slides run in a sandbox with no access to the portal.

This section lists the controls, their defaults and the one-variable rollback.

### CSP and `CSP_MODE`

Every response carries one `Content-Security-Policy` header whose `script-src` is
exactly `'self' 'wasm-unsafe-eval'`: no inline `<script>`, no inline `on*=` handler,
no `javascript:` URL, no `eval`, no nonce, no third-party script origin. The shipped
pages and decks contain no inline code, and a static test over the whole `public/`
tree keeps it that way. The real-deal default (every external service off, so no
`https:` token anywhere):

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; media-src 'self' blob: data:; worker-src 'self' blob:; report-uri /api/csp-report
```

`img-src`, `connect-src`, `frame-src` and `media-src` gain the origins of exactly the
external services an admin has switched on (next subsection); nothing else changes.

| `CSP_MODE` | What the server sends |
|---|---|
| unset, empty or `enforce` (default) | the strict policy above as `Content-Security-Policy`, nothing else |
| `report-only` (rollback) | the previous enforcing policy (`script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'`) as `Content-Security-Policy`, and the strict policy as `Content-Security-Policy-Report-Only` |
| anything else | treated as `enforce`; one `[security]` warning is logged at boot |

The server logs the active mode once at boot (`[security] CSP_MODE=…`).

**Rollback.** If a page or the in-browser AI-model flow misbehaves after an upgrade,
set `CSP_MODE=report-only` in the service environment and restart; no code change and
no data change is involved. Everything the strict policy would have blocked is then
reported instead of blocked, and the list below tells you what. Remove the variable
and restart to return to enforcing.

**Violations list.** `GET /api/admin/csp-violations` (admin only) answers
`{ mode, count, violations }`: the last 100 *distinct* violations (directive, blocked
URI, source file, line, count, first and last seen). It lives in the memory of the
server process, so a restart empties it and a second process has its own list; query
strings and fragments are dropped before storage. Browsers post to
`POST /api/csp-report`, which cannot require a session: its body is limited to 4 KB
for every content type (any other type is refused `415` unread), it allows 60 reports
per minute per client address before any body is read (set `TRUST_PROXY` behind a
proxy, see above), it keeps only reports about pages the portal actually serves, and
when the store is full it evicts reports from other origins (browser extensions)
first. Treat the list as **advisory**: anyone can post a report and a browser may drop
one, so judge a rollout by walking the pages as well as by reading the list.

An expected entry: the vendored Transformers.js bundle probes for the global object
with a guarded `new Function("return this")`. Under the enforced policy that call is
blocked once and appears as a `script-src` entry with blocked URI `eval` from
`/vendor/transformers/transformers.min.js`. It is harmless: the bundle still imports
and the WebAssembly runtime still compiles (checked in a real browser).

### External services (the egress switch)

Admin console, **Settings** tab, **External services** card. Three independent
switches, stored per instance in `runtime.db` (not per deal). A change takes effect on
the next request in every process without a restart, and every change is audited as
`egress-settings-changed` with the actor and the before/after values.

| Switch | What it enables | Origins it adds to the policy |
|---|---|---|
| Gemini | the server's Gemini calls (AI Insight, the AI-training upload, assessment plan and PDF review) | none: the call is made by the server, not the browser |
| Hugging Face | downloading the in-browser model weights (AI-Insight wizard) | `connect-src` `huggingface.co`, `*.huggingface.co`, `cdn-lfs.huggingface.co`, `cdn-lfs-us-1.huggingface.co`; `img-src` `*.huggingface.co` |
| YouTube | video thumbnails and embedded videos (employee welcome video) | `frame-src` `www.youtube.com`, `www.youtube-nocookie.com`, `youtube.com`; `img-src` `img.youtube.com`, `i.ytimg.com`; `media-src` `*.youtube.com` |

**Defaults.** Real-deal mode: **all three off**, so a real host contacts no third
party until an admin decides otherwise. Dev and demo: all three on, as before.

- **Gemini off:** the server makes no outbound call. `GET /api/ai/insight` and
  `POST /api/rag/upload` answer HTTP `200` with `{ "egressDisabled": "gemini", "message": … }`,
  which the browser shows once as a "switched off" state and never retries; the
  assessment plan and PDF review fall back to the built-in local engine.
- **Hugging Face off:** the downloadable model options are disabled and the wizard
  uses the local simulation; the model bundle is not even requested.
- **YouTube off:** no thumbnail or embed is built. The card shows a neutral
  "switched off by your administrator" placeholder.
- **The AI-training upload (`/api/rag/upload`) is `404` in real-deal mode**
  regardless of the switch, and its card is hidden in the console.
- **Fonts are local.** Inter and Outfit are vendored under `public/vendor/fonts`
  (SIL OFL texts alongside); no font CDN origin exists anywhere in the policy.
- **Dev mode is not offline.** A host without `MA_MODE=real` and without `DEMO_OPEN`
  inherits the demo defaults, so an ordinary laptop-local run *does* contact YouTube
  (video thumbnails) and, in the AI-Insight wizard, Hugging Face. Use real-deal mode
  for anything that must not.
- **Under `DEMO_OPEN=1`** the console cannot change the switches: open mode has no
  signed-in identity, and `POST /api/admin/egress` (like
  `GET /api/admin/csp-violations`) answers `403` to every caller unless the request
  carries the `X-Admin-Token` header of a configured `ADMIN_TOKEN`. The External
  services card still renders there, but **Save** is refused with that `403`.
  Showcase defaults are all on, so nothing is lost; to read the violations list on a
  demo-open host, use the break-glass header or read it on a dev or real instance.
- `POST /api/admin/egress` with no egress key (`{}`) is refused `400`
  `No egress key supplied`; nothing is written or audited.

### Slides

The admin **Slides** tab accepts `.html`, `.htm`, `.pdf`, `.png`, `.jpg`, `.jpeg` and
`.webp`. The extension, the declared type (when the browser supplies one) and, for
the binary types, the magic bytes must agree; anything else is refused before any
file is written.

| Limit | Value | Refusal |
|---|---|---|
| file type | allowlist above | `415` `This file type is not allowed for slides.` |
| one file | 10 MB | `413` `Slide file is larger than 10 MB.` |
| slide library | `MA_SLIDE_QUOTA_MB`, default **100** (positive integer; an invalid value logs a warning and keeps 100) | `413` `The slide library is full.` |

- **Where slides live.** Uploaded slides are stored **outside the public web root**:
  `<instance data dir>/slides`, i.e. `data/slides` on a dev/demo host and
  `<MA_DATA_DIR>/slides` (default `data/real/slides`) on a real-deal host. The
  directory is created `0700` and is never committed (`data/slides/` and `data/real/`
  are gitignored). `MA_SLIDES_UPLOAD_DIR` overrides the location. Slides are served
  only through `/uploads/slides/<name>`.
- **Back up the slide directory** together with the data directory: it holds uploaded
  deck files, possibly deal material.
- **Sandbox.** HTML and image slides are served with
  `Content-Security-Policy: sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data:; connect-src 'none'; form-action 'none'`
  plus `X-Content-Type-Options: nosniff`, and the portal frames them in an
  `<iframe sandbox="allow-scripts">`. A slide's own scripts run, but in an opaque
  origin with no cookies, no storage, no portal API and no network. Slides that relied
  on external images, fonts or scripts render without them; re-upload them with the
  assets inlined.
- **PDFs are not sandboxed.** A sandboxing policy would stop the browser's built-in
  PDF viewer, so a PDF keeps the application policy plus `nosniff`; the file is
  verified to be a PDF by its first bytes before it is stored.
- **Mount names.** `/uploads/slides/` serves only a single file name of letters,
  digits, `.`, `_` and `-` (not starting with a dot, at most 200 characters) with an
  allowlisted extension; anything else is `404`.
- **Windows hosts.** Request paths containing a backslash, a NUL, a path segment
  ending in `.` or a space, and (outside `/api`) `:` or `~` are answered `404` by
  design: they are Windows path-alias spellings, and no page or API of the portal
  uses them.
- **Deleting a slide in the admin UI also deletes its uploaded file**, once no other
  slide record of the same deal references it, which frees library quota. Upload temp
  files (`*.tmp`) never count toward the quota; ones older than an hour are removed
  at boot.
- **Slide reads are not authenticated yet.** The slide directory is outside
  `public/`, but anyone who knows a `/uploads/slides/<name>` URL can fetch it. Do not
  treat a slide URL as secret; authenticated, per-deal file storage arrives with the
  deal file store in Phase 14.

**Upgrading an existing host.** Earlier releases kept slides in
`public/uploads/slides`. On the first boot after the upgrade, with
`MA_SLIDES_UPLOAD_DIR` unset, the server moves the files whose names the slide URL
can serve into the new directory; a file whose name already exists there is left
where it is and never overwritten. The boot log prints a count only,
`[slides] legacy slide move: N file(s) moved …`, never a file name. Afterwards check
`public/uploads/slides`: anything left there was skipped (a name collision or a
non-slide file). Move it by hand if a slide record still points at it, then delete
it. If `MA_SLIDES_UPLOAD_DIR` is set, nothing is moved automatically: copy the legacy
files into that directory yourself.

### Media library uploads

`POST /api/media` (admin only; the admin console lists the library, uploads arrive
through this route) stores **images and PDF only**: PNG, JPEG (`.jpg`/`.jpeg`), WebP
and PDF, up to 10 MiB decoded. The final file extension, the declared type (the
data-URL header or the `kind` field) and the file's own first bytes must all agree.
Anything else (HTML, SVG, scripts, executables, plain text, a name with no extension
or a double extension such as `x.png.html`) is refused `415`
`{ "error": "This file type is not allowed.", "code": "media-type-refused" }`, and an
oversize file `413` `{ "error": "This file is too large.", "code": "media-too-large" }`;
a refusal stores nothing and the bodies never echo what was sent. Files are written to
`public/uploads/` and served from the portal's own origin as static files with
`X-Content-Type-Options: nosniff`. Deleting a media item removes its file only when it
is a regular file directly inside `public/uploads/`; a record that points anywhere
else is just dropped.

**Upgrade audit (do this once).** Files uploaded through the media library before this
release were never type-checked. On any host whose admin media route has been
reachable, list `public/uploads/` (the top level; `slides/` is a separate directory)
and delete every file that is not a PNG, JPEG, WebP or PDF you recognise, then remove
its entry from the media list if one is shown. Active content left there (`.html`,
`.htm`, `.svg`, `.js`) is still served from the portal's own origin until the
per-deal file store with a static guard arrives in Phase 14.

### Caching and sign-out

- Every `/api` response, at every status including errors, carries
  `Cache-Control: no-store`, so a shared browser or proxy cache never keeps a
  person's data.
- **Sign-out clears the browser.** A logout that carried a session cookie answers
  `Clear-Site-Data: "cache", "storage"` (a cross-site auto-submitted logout form
  without a session no longer wipes anything), and the page also clears
  `sessionStorage`, `localStorage`, Cache Storage and service-worker registrations
  itself. Only the language preference (`employeeLanguage`) survives.
- **`Clear-Site-Data` is honoured by browsers only on a secure context** (https, or
  `localhost`). On a plain-HTTP LAN host the header is ignored and only the
  page-side clearing runs, so **run a shared host behind TLS** (see "Behind a reverse
  proxy / TLS"). The remaining gap there: a person who signs out on a shared browser
  without TLS depends on the page-side clearing alone.
- The Transformers.js model cache (`transformers-cache`) now survives page loads (the
  per-load cache wipe is gone) and is cleared at sign-out. `public/sw.js` is a
  self-unregistering stub and `manifest.json` no longer ships.

### Upgrade: stored HTML is re-sanitised once (migration deal/002)

On the first boot of this release, every **deal database** the server opens runs
migration `deal/002 resanitize-html` before it serves requests: it re-sanitises every
stored page body, layout rich-text block and lesson body with the same allowlist the
write path now uses, and rewrites **only the values that change** (a row with nothing
to change keeps its bytes). The boot log prints one `[migrate] deal/002 …` summary
line per file with the number of changed values, and per changed value a collection,
a hashed id and a before/after digest — never content or a verbatim row id. No audit
rows are written (a boot-time repair).

- **Back up first.** The migration is forward-only and rewrites content in place. Copy
  the whole data directory (every `deals/*.db` and its `-wal`/`-shm` sidecars with the
  service stopped) before the first boot, as for the audit upgrade in section 6
  above. Rollback is a restore of that copy together with the previous release; a
  sanitised value cannot be un-sanitised.
- **Expect rewritten markup.** A value the old sanitiser let through (a handler
  attribute, a `javascript:` link, an unknown element) is stored without it. A page or
  lesson that depended on such markup will show differently; fix it in the editor.
- **Limits that now apply on write.** An HTML field nested deeper than 2000 elements
  is stored as escaped text, not markup (fail-closed). An i18n map carries at most 20
  language variants. `HTML_MAX` (20 000 characters per HTML field) is also the
  sanitiser's cost bound: raise it only together with `test/sanitize-html.test.js`.
- **The committed demo database was regenerated.** `data/demo.db` ships at schema
  version 2 (no demo value changed). A running server never migrates the committed
  demo or control databases in place: use the file from the release, and for a
  rollback restore the previous release's `data/demo.db` with the previous release.
  Real-deal hosts never open the committed databases.

### Client-side notes

- **Stored links must be relative or `http(s)`.** Every stored link field accepts only
  a relative path (`/…`, `#…`, `?…`) or an absolute `http://` / `https://` URL; any
  other value (`javascript:`, `data:`, `//host`, a bare name) is refused with `400`
  `Link must be a relative path or http(s) URL`. The rule covers module and lesson
  playbook links, sidebar and landing-card targets, quick-nav bookmark pages, the CMS
  hero/CTA links and the welcome-video URLs (`welcomeVideoUrl` and its `_en`, `_de`,
  `_zh`, `_cs` variants; these also accept a bare 11-character YouTube id). Values
  stored before this release are **not migrated**: the browser neutralises an unsafe
  link at render time (it renders as `#`, falls back to `/playbook.html`, or, for a
  custom sidebar item, is not rendered at all). The admin menu editor saves the whole
  menu list, so it reports a `400` naming the offending row (for example
  `sidebar.3.href: Link must be a relative path or http(s) URL`) until that row is
  corrected. An absolute `http(s)` link to another site is still a legitimate target;
  the policy governs script, not where a link leads.
- **Ending your current session is a sign-out.** Choosing **End session** on the
  session marked "This device" in **My sessions** clears the browser exactly like
  **Logout** (local and session storage, Cache Storage; only the language preference
  survives), and the response carries `Clear-Site-Data: "cache", "storage"`. Ending one
  of your *other* sessions leaves this browser untouched. As above, `Clear-Site-Data`
  is honoured only in a secure context; the page-side clearing runs everywhere.
- **Back button after sign-out.** A page restored from the browser's back/forward
  cache always reloads, so on a plain-HTTP LAN host (where `Clear-Site-Data` is
  ignored) the Back button cannot show the previous person's page.
- **Authored content may use the portal's own CSS class names (accepted).** An author
  can therefore make content look like application chrome, such as a full-screen
  overlay. Only administrators can author CMS content (pages, lessons, banners,
  translations, slides); treat CMS authoring as a trusted-admin capability.
- **A `<base>` pasted into a translation is inert but reported.** Parsing a
  `<base href="…">` inside an i18n value (the one channel that stores raw markup)
  applies nothing, because the renderer drops the element, but the browser files one
  `base-uri` entry in the violations list for it. If that entry appears, look for a
  `<base>` in **Translations**.

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
  AI-Insight wizard — and, since Phase 13, **off by default in real-deal mode**:
  the Hugging Face switch (see Content safety, External services) is off there, the
  policy lists no Hugging Face origin and the wizard uses the local simulation. An
  admin who switches it on accepts the download; vendoring the weights is still
  deferred to a follow-up task. Dev and demo hosts have the switch on.
- **A RAID entry or task with a malformed clearance area is hidden from everyone,
  admin included (fail-closed, accepted).** The app only ever writes a valid
  clearance area; a value that is not one (only possible by editing the deal file
  directly) makes the row invisible in every list, export and report rather than
  risk showing it to someone uncleared. If an admin reports "a row I can't see",
  check that row's `clearanceArea` in the deal database first.
- **Client-side XSS sink audit is partial; the enforced CSP is the backstop.**
  Every enumerated render path that turns stored or message-sourced markup into DOM
  (CMS page bodies and layout blocks, lesson bodies, `[data-i18n-html]` values,
  banners, the chatbot, the slide launcher, inline editing, the slide list) is built
  from the allowlist renderer or from `textContent`, and a static scan keeps it so.
  About **300 other client HTML sinks** (`innerHTML` template builds of app-sourced
  data across the legacy frontend) are not individually audited; they are bounded by
  the enforced policy (no inline or eval'd script can run from them), not proven
  safe one by one. Treat any new user-authored free-text rendering as requiring
  explicit escaping or `textContent`.
- **`style-src` still allows inline styles.** The strict policy governs script only;
  inline `style` attributes and `<style>` blocks are permitted, so style-based
  tricks (layout overlay, CSS-driven requests to origins the policy allows) are not
  prevented by it. Stored `style` values are filtered through a property allowlist.
- **Multi-thread Transformers.js inference is not verified under the strict policy.**
  A threaded WebAssembly runtime starts its workers with `importScripts(blob:)`
  inside a blob worker, which inherits `script-src 'self'` and would be blocked. The
  app runs the single-thread runtime (an enforced-policy run imports the bundle and
  compiles `/vendor/transformers/ort-wasm-simd.wasm` without a violation), so this is
  not exercised. If the AI-model flow regresses on a host, `CSP_MODE=report-only`
  plus a restart is the rollback.
- **Deleting a slide record can remove a file another deal's slide record still
  points at.** The "no other record references this URL" check runs inside the
  current deal's database only (opening every deal on a delete would cross
  clean-room lines), while the slide directory is shared by the instance. Upload
  each deal's slides separately rather than pasting one uploaded URL into several
  deals.
