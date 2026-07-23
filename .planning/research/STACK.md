# Stack Research

**Domain:** Foundation hardening for an existing Node/Express + vanilla-JS M&A integration portal (zero-install bundle, committed `node_modules`) — moving from a single `db.json` file to SQLite/WAL, adding mandatory auth, an audit log, and write-path schema validation. This is a *subsequent-milestone* stack addendum, not a fresh stack — it only covers the four foundation capabilities; the existing stack (Express 4, vanilla JS, no build step) is unchanged and not re-researched.
**Researched:** 2026-07-23
**Confidence:** HIGH overall (all package versions verified live against the npm registry and official docs during this research; two items are explicitly flagged MEDIUM below because the underlying source didn't give a complete answer)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `better-sqlite3` | **13.0.1** (verified via `npm view better-sqlite3 version`) | SQLite driver, WAL-mode persistence layer replacing `db.json` | Synchronous API — matches this codebase's existing synchronous `fs.readFileSync`/`writeFileSync` mental model in `readDb()`/`writeDb()` exactly, so route handlers don't need to become `async` to get a database. It is also *faster* than the async drivers for this workload: single-file local SQLite queries are sub-millisecond, and paying an event-loop round-trip per query (as `sqlite3` does) only adds overhead without buying real concurrency, since SQLite itself serializes writes regardless of the Node-side API shape. v13 is better-sqlite3's first N-API release (see "Cross-Platform Bundle Implications" below) — directly relevant to this app's committed-binary bundling model. |
| `zod` | **4.4.3** (verified) | Schema validation on every write path (`/api/projects`, `/api/employees`, `/api/integration-tasks`, DD requests/findings, etc.) | Zero build step required — ships dual CJS/ESM, so `const { z } = require('zod')` works unchanged in this app's plain `require()`-based `server.js`. This is also the exact library `.planning/codebase/CONCERNS.md` already named ("Add Zod or Joi schema validation") when it flagged the Critical input-validation gap, so it's consistent with the prior audit, not a new direction. |
| Node's built-in `crypto.scryptSync` | Node ≥20 built-in (no package) | Password hashing for `PORTAL_AUTH` user accounts | **Already implemented correctly in `server.js` today** (`hashPassword()` uses `crypto.scryptSync`). This is an OWASP-endorsed KDF and needs zero additional dependency or native binary — the single best fit for a zero-install bundle. The only change needed is tuning cost parameters explicitly (see Patterns below); there is no reason to replace it with `bcrypt`/`argon2`. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `express-rate-limit` | **8.6.0** (verified) | Rate-limit `/api/auth/login`, `/api/rag/upload`, `/api/rag/search` | Replace the current ad hoc in-memory `Map`-based login throttle (`_loginAttempts` in `server.js`) with the maintained library once auth is mandatory and a real login form is internet/network-reachable on a shared host. In-memory store is fine at this scale (single-process, laptop or small shared host) — no Redis needed. |
| `csrf-csrf` | **4.0.3** (verified) | Optional defense-in-depth CSRF token (double-submit cookie pattern) | **Optional, not required** — see rationale under Auth Hardening. Reach for this only if a future phase adds classic HTML `<form>` POSTs or the app is exposed beyond TE's internal network without a reverse-proxy same-site guarantee. |
| None (no new package) — `Sec-Fetch-Site` header check | n/a | Zero-dependency CSRF mitigation for the current JSON-fetch-only write pattern | See Patterns below. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `better-sqlite3`'s built-in `Database.prototype.transaction()` | Wrap the one-time `db.json` → SQLite migration script, and every audit-logged write, in a single atomic transaction | No separate migration-runner package needed; hand-write numbered `.sql` migration files (`migrations/0001_init.sql`, `0002_add_dd_workspace.sql`, ...) applied at startup by comparing a `schema_version` table to the highest available file number. This mirrors the app's existing "no build tooling" philosophy — an ORM migration tool (Prisma Migrate, Drizzle Kit) would be the first build-step dependency introduced into this codebase. |

## Installation

```bash
# Core — SQLite driver + validation
npm install better-sqlite3@13.0.1 zod@4.4.3

# Auth hardening
npm install express-rate-limit@8.6.0

# Optional — only if a future phase needs it (see rationale)
# npm install csrf-csrf@4.0.3
```

No dev dependencies are required — this migration deliberately introduces no build step, consistent with the existing constraint.

## Migration Approach: `db.json` → SQLite (concrete plan for this codebase)

**1. Driver + connection (module-level singleton, mirrors the existing `_dbCache` pattern):**

```javascript
const Database = require('better-sqlite3');
const db = new Database(DB_FILE); // e.g. path.join(__dirname, 'data', 'ma-portal.sqlite')
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');   // the standard WAL pairing — extreme performance, still durable
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');    // if a writer briefly holds a lock, wait up to 5s instead of throwing
```
`journal_mode = WAL` only needs to be set once — it's persisted in the SQLite file header, so every future connection (including from the migration script and any later shared-host process) picks it up automatically. **Confidence: HIGH** — pragma choices verified against SQLite/better-sqlite3 documentation.

**2. Concurrency model — this directly eliminates the CONCERNS.md-cited race:**
The current bug ("Concurrent Database Writes", rated Critical) exists because two simultaneous `writeDb()` calls race on the same temp-file-then-rename, and the second wins, silently discarding the first. With `better-sqlite3`, all queries run synchronously on Node's single event-loop thread, so two "simultaneous" Express request handlers can never actually interleave a read-modify-write on the same statement — the driver itself serializes them without any app-level mutex. Combined with `BEGIN IMMEDIATE`-style transactions for anything that reads-then-writes (via `db.transaction(fn)`, which better-sqlite3 wraps around `fn` automatically with the correct locking mode), this closes the exact failure mode CONCERNS.md flags — no separate mutex library is needed for a single Node process. If a future shared-host deployment runs multiple Node processes (e.g. `pm2 -i` cluster mode) against the same file, WAL mode still allows multiple processes to read/write safely at the SQLite engine level, but plan to keep a single writer process for the foreseeable TE-internal load (a handful of concurrent IL/PMO users) rather than testing multi-process write concurrency now.

**3. Schema shape — hybrid, chosen specifically to preserve two things the milestone requires unchanged:**

- **Operational/reportable data → real relational tables** with a `project_id` column: `employees`, `integration_tasks`, `raid_entries`, `synergy_initiatives`, `assessment_instances`, `dd_requests`, `dd_findings` (new DD workspace tables), `users`, `sessions`, `audit_log`. These are exactly the entities the milestone's IMO reporting, DD workspace, and synergy-tracking requirements need to filter/join/aggregate by workstream, owner, severity, status, and project — a JSON blob can't do that efficiently, and CONCERNS.md's "No Audit Log" / "No User Sessions" gaps live here too.
- **CMS/content bundles → JSON-in-SQLite** via a `project_cms(project_id, key, value_json)` table: `courses`, `pages`, `menus`, `departments`, `processes`, `slides`, `i18n`. This content is already treated as an opaque bundle that gets swapped wholesale on project activation (`snapshotCms()`/`applyCmsToTopLevel()` in `server.js`) — nothing queries into individual fields of a course or a menu entry, so there is no relational value in normalizing it, and keeping it as JSON blobs minimizes migration risk for the CMS system this app has invested 6 build phases in.
- **This is a net architectural improvement, not just a storage swap:** replacing the current in-memory copy-out/copy-in `stashActiveProjectCms()` pattern (which CONCERNS.md flags under "Project Data Loss on Mode Switch" as fragile) with a `project_id`-scoped `WHERE` clause removes an entire class of "did the stash happen before the switch" bugs, because there is no longer a single mutable top-level object that gets swapped — every query is already scoped to the active project by its `project_id` column.

**4. Per-project isolation, preserved exactly:** every operational table carries `project_id TEXT REFERENCES projects(id)`; the app continues to have exactly one active project (per the existing `activeProjectId` model, unchanged by this milestone's Out of Scope decision against a portfolio view) — reads simply add `WHERE project_id = ?` instead of relying on the in-memory swap.

**5. Demo vs. real separation — the milestone's "must never share a store" requirement, made structural rather than a runtime flag:** use **two separate SQLite files** (e.g. `data/demo.sqlite` and `data/live.sqlite`), selected once at process start by a `PORTAL_MODE=demo|live` environment variable (or continue keying off the existing `demoMode` setting, but resolve it to a file path rather than an in-process boolean). This makes it structurally impossible for time-travel day-scaling, XP/leaderboard mutation, or any other showcase mechanic to reach real deal data — there is no shared table, connection, or file to accidentally cross. Compare this to a `mode` column on shared tables, which would require every single query in the codebase to remember to filter by mode; a separate file needs zero per-query discipline.

**6. One-time migration script (`scripts/migrate-db-json-to-sqlite.js`):** read `db.json` via the existing `readDb()`, open the new SQLite file, run the whole migration inside one `db.transaction()` so it's all-or-nothing, insert operational rows into their typed tables and CMS collections into `project_cms` as JSON text, then leave `db.json` in place untouched (renamed to `db.json.pre-migration-backup`) as a rollback path for the first release that ships this change.

## Driver Choice: `better-sqlite3` vs `node:sqlite` vs `sqlite3` (async)

| Driver | Verdict | Why |
|--------|---------|-----|
| **`better-sqlite3` 13.0.1** | **Recommended** | Synchronous API matches this codebase's existing style; N-API binary (see below) is the best fit for a committed-`node_modules` zero-install bundle; actively maintained, this is the de facto standard SQLite driver for Node webapps in 2026. |
| `node:sqlite` (Node built-in) | **Not yet** — confirmed still experimental on the app's target Node line | Directly tested on this machine's installed Node v22.18.0: `require('node:sqlite')` loads but emits `ExperimentalWarning: SQLite is an experimental feature and might change at any time`. Per official Node docs and the Node.js GitHub tracking issue, `node:sqlite` only reached Release Candidate in Node v25.7.0 and was fully stabilized in Node v26 — the app's `package.json` requires only `node >=20`, and the portable Node bundled in the turnkey zips is v22.23.1. Shipping on an experimental API in a tool meant to hold MNPI acquisition data is the wrong risk trade for a foundation-first milestone. **Revisit this choice if/when the bundled portable Node is upgraded to v26+.** **Confidence: HIGH** (directly verified by running the require on this machine, cross-checked against Node's own docs). |
| `sqlite3` (mapbox/TryGhost async driver) | **Not recommended** | Legacy callback-based API (requires promisifying every call to use with `async/await`), and its native binary story is the *older*, more fragile model this app already outgrew with `pdf-parse`/`@napi-rs/canvas`: prebuilds are fetched via `prebuild-install` per exact Node ABI version rather than N-API, meaning more platform+Node-version binary combinations to vendor, not fewer. `better-sqlite3` v13's move to N-API is a direct improvement on exactly this problem. |

## Cross-Platform Bundle Implications (native binary — the core constraint)

The app already has direct precedent for vendoring platform-specific native binaries: `@napi-rs/canvas` v0.1.80 ships as **separate optional npm packages per platform** (`@napi-rs/canvas-win32-x64-msvc`, `@napi-rs/canvas-darwin-x64`, `@napi-rs/canvas-darwin-arm64`, `@napi-rs/canvas-linux-x64-gnu`), which is why all four could be `npm install`ed and committed from a single (Mac) development machine — each is just a binary download, no compile step, and can be installed regardless of host OS.

`better-sqlite3` v13 uses a **different, simpler model that is easier for this constraint, not harder**: starting in v13.0.0, better-sqlite3 dropped the old `prebuild-install` postinstall-download approach and instead **ships prebuilt N-API binaries bundled directly inside the single npm package tarball** for the common platform/arch targets (win32-x64, darwin-x64, darwin-arm64, linux-x64-glibc, and others). Because it's N-API rather than V8-ABI-specific, one binary works across Node versions (and even Electron), so there's no per-Node-version matrix to maintain either.

**Practical implication for this repo:** a single `npm install better-sqlite3` on the current (Mac) dev machine is expected to vendor a working binary set for other platforms too, unlike the canvas case which required deliberately installing 4 separate platform packages. **Confidence: MEDIUM on the exact bundled-platform list** — this was confirmed from package-release commentary and the removal of `prebuild-install`, but the specific asset manifest on the v13.0.0 GitHub release could not be enumerated directly during this research. **Action before the next release build:** after `npm install better-sqlite3@13.0.1`, inspect `node_modules/better-sqlite3/` for its prebuilt-binary directory and explicitly verify a working binary exists for win32-x64, darwin-x64, darwin-arm64, and linux-x64-gnu (the same four targets already covered for `@napi-rs/canvas`) before zipping the three turnkey releases — if any platform is missing a prebuild, treat it the same way the canvas binaries were handled (obtain/build that platform's binary separately and vendor it in) rather than assuming `npm install` alone covers all three release zips.

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node:sqlite` (built-in, this milestone) | Still experimental on the app's Node ≥20 / bundled Node 22.23.1 baseline; stabilizes only in Node 26 | `better-sqlite3` 13.0.1 now; reconsider once the bundled portable Node moves to v26+ |
| `sqlite3` (async/callback driver) | Legacy API shape, older per-ABI native-binary model (more platform+version combinations to vendor), slower for this single-file local workload | `better-sqlite3` |
| `csurf` | Archived and no longer maintained by the Express team — explicitly deprecated, receives no security fixes | `csrf-csrf` (double-submit) or `csrf-sync` (synchronizer pattern) if a CSRF token library is ever needed; see Auth Hardening for why it likely isn't, here |
| `bcrypt` / `argon2` (native modules) | Both require compiling/vendoring yet another native-binary matrix (exactly the `@napi-rs/canvas` problem, for a solved problem) | Keep `crypto.scryptSync` — already implemented, OWASP-endorsed, zero dependency |
| `express-session` + a session-store package (`connect-sqlite3`, etc.) | Adds a dependency and a store-selection decision for something the app's existing custom HMAC-signed cookie session already does statelessly and correctly | Keep the existing `signSessionPayload`/`makeSessionToken`/`readSession` scheme in `server.js`; add one `sessions` table in SQLite for revocability (see Auth Hardening) rather than replacing the whole mechanism |
| An ORM/query builder (Prisma, Drizzle, Kysely) | Prisma requires a `generate` build step, which this app has never had and the milestone constraints explicitly exclude; Drizzle/Kysely are build-step-free but add API surface and a migration-tooling decision the data volume doesn't justify | Hand-written parameterized SQL via `better-sqlite3`'s `.prepare()`/`.run()`/`.all()`, plus hand-numbered `.sql` migration files — matches the codebase's existing zero-abstraction style |
| `DOMPurify`/`jsdom` as part of *this* milestone | Real, but out of scope here — these address the separately-tracked XSS/RAG-fragility concerns in CONCERNS.md, not the four foundation capabilities (SQLite, auth, audit log, validation) this research targets | Track under the existing "Incomplete XSS Audit" / "RAG Indexing Fragility" concerns, not this stack |

## Schema Validation Pattern (zod, no build step)

```javascript
const { z } = require('zod');

const ProjectCreateSchema = z.object({
  targetCompany: z.string().trim().min(1).max(100),
  sector: z.string().trim().max(50).optional().default(''),
  size: z.string().trim().max(50).optional().default(''),
  hq: z.string().trim().max(100).optional().default(''),
  acquisitionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO date').optional(),
}).strict(); // reject unknown keys outright, rather than silently coercing them like today's `String(b.x || '')`

app.post('/api/projects', requireRole('admin', 'pmo'), (req, res) => {
  const parsed = ProjectCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
  // ...proceed with parsed.data, now type- and length-guaranteed
});
```

This directly closes the exact gap CONCERNS.md names ("No Input Validation on Project/Employee Creation" — Critical severity) with the exact fields it calls out (`targetCompany <= 100`, `sector <= 50`, ISO date). Apply the same pattern to every write endpoint the milestone's "schema validation on all write paths" requirement covers — one schema module per resource type (`validators/projects.js`, `validators/integrationTasks.js`, `validators/ddFindings.js`, ...), each schema colocated with its route file.

## Audit Log Schema (append-only, SQLite)

```sql
CREATE TABLE audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_username TEXT,
  actor_role    TEXT,
  action        TEXT NOT NULL,      -- 'create' | 'update' | 'delete'
  resource_type TEXT NOT NULL,      -- 'integration_task' | 'raid_entry' | 'dd_finding' | ...
  resource_id   TEXT NOT NULL,
  project_id    TEXT,
  before_json   TEXT,               -- NULL on create
  after_json    TEXT,               -- NULL on delete
  ip            TEXT
);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);
CREATE INDEX idx_audit_ts        ON audit_log(ts);
```

- **Append-only in practice:** no route ever issues `UPDATE`/`DELETE` against this table; for defense-in-depth, add SQLite triggers that raise `RAISE(ABORT, ...)` on any `UPDATE`/`DELETE` targeting `audit_log`, so even a future bug in application code can't quietly rewrite history.
- **Atomicity with the write it records:** call the audit insert inside the *same* `db.transaction()` as the data mutation it describes, so an audit entry and its corresponding change always commit together or neither does — this is the "before/after values" requirement from PROJECT.md, made durable rather than best-effort.
- **Admin UI:** a simple "View History" query (`SELECT * FROM audit_log WHERE resource_type = ? AND resource_id = ? ORDER BY ts DESC`) is enough to satisfy the milestone requirement without a dedicated audit-viewer library.

## Auth Hardening (promoting the existing `PORTAL_AUTH`, not rebuilding)

The app already has the hard part done: server-verified sessions via HMAC-signed cookies, `scrypt` password hashing, constant-time comparisons, and a login throttle. The milestone's own Key Decisions table says this explicitly: "the work is enforcement and role granularity, not new authentication." Concretely:

| Hardening item | Current state (verified in `server.js`) | Recommended change |
|---|---|---|
| Password hashing | `crypto.scryptSync(password, salt, 32)` — correct primitive, default cost | Pass explicit OWASP-recommended cost params: `scryptSync(password, salt, 64, { N: 2**17, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })`. No new dependency. |
| Session store | Stateless signed cookie (`ma_session`), 12h TTL, `HttpOnly; SameSite=Lax` | **Add a `sessions` table** (`id TEXT PRIMARY KEY, username TEXT, role TEXT, created_at TEXT, expires_at TEXT`) now that SQLite exists. Login inserts a row; `readSession()` additionally checks the row still exists (not just signature + expiry); logout deletes it. This turns an otherwise-unrevocable 12-hour token into one that can be force-expired — the concrete gap for MNPI data, where "someone's laptop was stolen" needs an immediate remedy, not a 12-hour wait. |
| CSRF | `SameSite=Lax` cookie + all writes are same-origin JSON `fetch()` calls (not classic `<form>` posts) | Two zero/low-dependency steps before reaching for a library: **(1)** tighten the cookie to `SameSite=Strict` now that login is mandatory (there's no cross-site "click a link, land logged in" flow to preserve); **(2)** add a tiny middleware that rejects state-changing `/api` requests where the `Sec-Fetch-Site` request header is present and equals `cross-site` (all evergreen browsers send this header; it's the modern, low-maintenance CSRF mitigation for JSON-only APIs). **Confidence: MEDIUM** — a valid, real technique, but less universally documented as a *sole* defense than the double-submit-cookie pattern; treat it as the first line of defense, not the only one, and revisit `csrf-csrf` 4.0.3 if a later phase adds classic form posts or public-internet exposure. |
| Rate limiting | Ad hoc in-memory `Map` (`_loginAttempts`), 8 attempts/60s per IP | Replace with `express-rate-limit` 8.6.0 on `/api/auth/login`; keep the same shape (in-memory store — fine at this scale) but gain the maintained library's edge-case handling (proxy headers, `Retry-After`). |
| Role enforcement per write endpoint | Coarse: any authenticated session for ordinary writes, admin-role session (or `X-Admin-Token`) for `/api/admin/*` only | Add a small `requireRole(...roles)` middleware factory applied per-route (e.g. `requireRole('admin', 'pmo')` on `/api/projects`, `requireRole('admin')` on `/api/users`) — this is the concrete mechanism for the milestone's "roles enforced on every write endpoint" requirement, and needs no new package. |
| Token expiry | 12h TTL, no rotation on privilege change | Keep the 12h TTL (reasonable for a workday); additionally delete all of a user's `sessions` rows when their password or role changes, forcing re-login — only possible once sessions are tracked in SQLite per the row above. |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|------------------|-------|
| `better-sqlite3@13.0.1` | Node ≥20 (app's existing `engines` field), including the bundled portable Node v22.23.1 | N-API-based — should not require a Node-version-specific rebuild when the bundled portable Node is later bumped, unlike a V8-ABI-specific native module. |
| `zod@4.4.3` | Plain CommonJS `require()`, no bundler | Root import `require('zod')` is CJS-safe; avoid the `zod/v4` subpath import some TypeScript/bundler setups need — not applicable here since this is a plain-JS, no-build-step codebase. |
| `express-rate-limit@8.6.0` | `express@4.19.2` (current) and `express@4.22.2` (latest 4.x, per `npm view express dist-tags`) | No Express 5 migration implied or required by this addition; Express 5 (`5.2.1`, current `latest` tag) is a separate, larger decision (breaking wildcard-route and error-handling changes) explicitly out of scope for this foundation milestone. |
| `csrf-csrf@4.0.3` | Designed for Express 5 but documented as also usable on Express 4 | Only relevant if adopted later per the CSRF section above. |

## Sources

- npm registry, verified live via `npm view <pkg> version` / `dist-tags` during this research (2026-07-23): `better-sqlite3` 13.0.1, `zod` 4.4.3, `express` (latest 5.2.1 / latest-4 4.22.2), `csrf-csrf` 4.0.3, `csrf-sync` 4.2.1, `express-rate-limit` 8.6.0, `dompurify` 3.4.12, `jsdom` 29.1.1 — **HIGH confidence** (primary registry, not training data)
- [better-sqlite3 npm page](https://www.npmjs.com/package/better-sqlite3) and [WiseLibs/better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3) — v13 N-API migration, prebuilt-binary bundling — **MEDIUM confidence** on the exact bundled-platform manifest (see explicit verification action above)
- [Node.js SQLite docs](https://nodejs.org/api/sqlite.html) and [nodejs/node issue #57445](https://github.com/nodejs/node/issues/57445) (stabilization tracking) — **HIGH confidence**, additionally cross-checked by directly running `require('node:sqlite')` on this machine's installed Node v22.18.0, which emitted the experimental warning live
- [csrf-csrf npm](https://www.npmjs.com/package/csrf-csrf), [dev-academy.com CSURF vulnerability writeup](https://dev-academy.com/csurf-vulnerability/) — csurf deprecation, double-submit/synchronizer alternatives — **HIGH confidence**
- WAL/pragma guidance cross-checked against [DeepWiki WiseLibs/better-sqlite3 WAL Mode and Performance Tuning](https://deepwiki.com/WiseLibs/better-sqlite3/3.4-wal-mode-and-performance-tuning) and general SQLite locking documentation — **HIGH confidence**
- `/Users/karstenhaldan/M&A/.planning/codebase/CONCERNS.md` and `/Users/karstenhaldan/M&A/.planning/codebase/ARCHITECTURE.md` — internal source of truth for the exact current implementation (`readDb`/`writeDb`, session/auth code in `server.js` lines 85–241) that every recommendation above was calibrated against

---
*Stack research for: SQLite migration, mandatory auth hardening, audit log, and write-path validation on the M&A Integration Portal foundation milestone*
*Researched: 2026-07-23*
