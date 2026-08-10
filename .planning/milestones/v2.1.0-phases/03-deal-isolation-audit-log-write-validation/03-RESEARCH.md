# Phase 3: Deal Isolation, Audit Log & Write Validation - Research

**Researched:** 2026-08-01
**Domain:** Multi-database SQLite architecture (better-sqlite3), request-scoped connection resolution, application-level audit logging, schema validation (zod) on an Express/vanilla-JS stack
**Confidence:** HIGH (stack versions, SQLite/WAL cross-database semantics, zod API); MEDIUM (audit-mechanism recommendation — architectural judgment call, not a single documented "correct" pattern); LOW (none presented as fact — the one open XSS-library alternative is flagged)

## Summary

This phase replaces two things that currently sit in `server.js` at the same layer — the `demoMode`-flag/`custom*`-shadow-array project switch (`stashActiveCustomProject`/`snapshotCms`/`applyCmsToTopLevel`, ~64 `demoMode` references, 10 `custom*` collections) — with a session-bound, physically-separate-file architecture (`control.db` + `demo.db` + `deals/<id>.db`), plus adds two capabilities that don't exist in the codebase at all today: an audit log (zero `audit` references in `server.js`) and server-side write validation/sanitization (zero `sanitize`/schema-validation references in `server.js` — the only sanitizer in the repo is a client-side regex in `public/js/page-layout.js` that runs at *render* time, not write time).

The critical finding that shapes the audit-mechanism decision: **SQLite does not guarantee atomic commits across ATTACHed databases when the main database is in WAL mode** [VERIFIED: sqlite.org/lang_attach.html — "If the main database is ':memory:' or if the journal_mode is WAL, then transactions continue to be atomic within each individual database file."]. Since D-09 locks `audit.db` as a dedicated file physically separate from every `deals/<id>.db`, and every deal file must run WAL (matching Phase 1's `db/store.js` pragma precedent), a cross-database SQLite trigger (`deals/<id>.db` table → `audit.db` table via `ATTACH`) cannot give a stronger atomicity guarantee than two independent single-file commits — which is exactly what an application-level hook inside `db/store.js`'s existing `writeDb()` gives you, with far less operational complexity (no per-connection `ATTACH` bookkeeping, no SQL-side actor-context table). Combined with the fact that `writeDb()`'s snapshot-diff merge **already computes** the exact old/new row values D-11 requires (`beforeMap.get(id)` vs the serialized `afterArr[i]`) — the store-layer hook is the recommended mechanism, not SQLite triggers.

The second major finding: the request→database binding (D-01, session-bound) can be implemented with **zero changes to the ~90 existing endpoint call sites** that call bare `readDb()`/`writeDb()` — by using Node's built-in `AsyncLocalStorage` inside `db/store.js`'s `requireDb()`/`getConnection()`, populated once per request by resolver middleware early in the existing consolidated `/api` gate (server.js ~L268). This generalizes the current single-connection singleton to "one connection per resolved database" without touching any handler.

**Primary recommendation:** Multiple independent `better-sqlite3` `Database` handles (one per resolved file: `control.db`, `demo.db`, one per open `deals/<id>.db`), cached in a `Map` keyed by resolved path and opened lazily; bound per-request via `AsyncLocalStorage` inside `db/store.js`; audited via a `writeDb()`-wrapping store-layer hook that writes before/after JSON snapshots to a separately-opened `audit.db` connection in its own transaction, immediately after the deal-db transaction commits; validated via `zod` (`z.object()`'s default strip-unknown behavior) with one schema module per resource, `safeParse` mapped to the existing `{ error: '...' }` 400 shape; HTML fields sanitized at write time by porting the existing `public/js/page-layout.js` regex-strip pattern into a shared server-side module — no new sanitization dependency needed, only `zod` crosses the Package Legitimacy Gate this phase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Request → database resolution (ISO-01/03) | API / Backend | — | Must happen before any handler runs; belongs in the existing consolidated `/api` gate (server.js), the single choke point every request already passes through |
| Deal file connection lifecycle (open/cache/pragma) | Database / Storage | API / Backend | `db/store.js` owns connection management today; resolver generalizes it, doesn't move it |
| Demo-only mechanic gating (ISO-02: time-travel, XP) | API / Backend | — | Route-prefix guard in the same consolidated gate that already does `ROLE_WRITE_POLICY` — not scattered per-handler `if` checks (that's the anti-pattern being replaced) |
| Audit capture (AUD-01/02) | Database / Storage | API / Backend | Row-level before/after diff is cheapest at the `db/store.js` write boundary, where the diff is already computed; actor identity comes from the API tier's `req.portalUser` |
| Schema validation (VAL-01) | API / Backend | — | Express middleware/route-level, before the handler touches `readDb()`/`writeDb()` |
| HTML sanitization (VAL-02) | API / Backend | Browser / Client | Sanitize at write time (server, source of truth) AND keep the existing `textContent`/`escapeHtml` render-time discipline (client, defense-in-depth) |
| Deal registry + membership (D-02/D-03) | Database / Storage (control.db) | API / Backend | New control-plane table, not part of any deal file — must survive deal deletion and be queryable before a deal file is even opened |
| Deal switcher UI (D-04) | Browser / Client | — | Pure presentation; reads `/api/deals` and posts the selected deal id, no business logic |

## User Constraints

### Locked Decisions (from CONTEXT.md, verbatim)

**Deal lifecycle & switching**
- **D-01:** The resolver is session-bound: each logged-in user selects a deal; the selection is stored server-side on their Phase-2 sessions-table row (new deal column). Demo requests resolve to `demo.db`. No global "active deal", no URL rewrite of the frontend.
- **D-02:** Deal creation: admin + hrbp (Integration Lead). Deal deletion/archival: admin-only, destructive-guarded, with the audit trail retained per AUD-02.
- **D-03:** Per-deal member list (username allowlist stored in the control DB). The resolver refuses to bind a session to a deal the user is not a member of; admin is always allowed.
- **D-04:** UI this phase = a small header/sidebar deal switcher (visible to deal members) plus a minimal create-deal form (name, target company, members) — deliberately separate from the demo Projects UI.

**Existing data's fate (migration split)**
- **D-05:** Everything demo-flavored goes to `demo.db` — including the Custom-M&A shadow lane. Users/settings/deal-registry go to the control DB. A new real deal always starts with zero demo-derived rows.
- **D-06:** A new `deals/<id>.db` is seeded with templates only: same schema as demo plus `checklistTemplates`, `assessmentTemplates`, `processCatalog`, and `i18n` strings. No demo employees, projects, pulses, XP, or CMS showcase content.
- **D-07:** Commit `demo.db` and a near-static `control.db`; live sessions and other churning runtime rows move to a gitignored `runtime.db`; `deals/*.db` are gitignored AND excluded from the admin download-zip.

**Audit log scope & access**
- **D-08:** Audit every write to any `deals/<id>.db` PLUS control-plane security events: deal create/delete/archive, membership changes, user/role/password changes, session revocations, and every X-Admin-Token (break-glass) use. Demo writes are NOT audited.
- **D-09:** Audit rows live in a dedicated central append-only `audit.db` — gitignored, zip-excluded, physically outside every deal file.
- **D-10:** Admin-only audit viewer this phase: a small filterable table in the admin console (filter by deal, user, date range). Deal-scoped IL views are deferred.
- **D-11:** Each entry stores full before/after row JSON snapshots (plus who/what/when/deal-id).

**Validation strictness**
- **D-12:** Use zod for schema validation across the ~60 write endpoints. Committed to node_modules like better-sqlite3.
- **D-13:** Strip unknown fields, reject invalid ones.
- **D-14:** One validation pipeline, same rules in demo and deal mode.
- **D-15:** XSS closed from both ends: schemas tag which fields may carry HTML — those are sanitized at write time; all other fields stored as plain text; existing textContent-on-render discipline stays.

### Claude's Discretion (from CONTEXT.md)
- Audit capture mechanism (SQLite triggers vs middleware wrapper vs store-layer hook) — research recommended triggers + a one-row actor table stamped by middleware; planner decides against the current db/store.js shape.
- Exact control-DB vs runtime-DB table split beyond "sessions + churning runtime rows leave the committed file".
- Deal id format, `deals/` directory layout, WAL/backup handling per deal file.
- Migration script mechanics — expected to follow Phase 1's precedent (re-runnable, `--verify` parity gate, archive the source read-only after green).
- How demo-only endpoints (time-travel, XP scaling) are hard-gated (route guard vs resolver-level refusal) — success criterion 2 defines the observable behavior.

### Deferred Ideas (OUT OF SCOPE)
- Deal-scoped audit views for ILs (admin-only this phase, D-10) — Phase 4+ follow-up alongside clean-room.
- Audit retention/rotation policy and tamper-evidence (hash chaining) — not required by AUD-01/02; revisit at shared-host milestone (v2).
- Workstream-lead role taxonomy (ws_lead_hr, …) — still parked for Phase 4 planning.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ISO-01 | Real-deal data in a separate SQLite file per deal, physically separate from demo/control | `## Multi-Database Connection Architecture` — N cached `Database` handles, one per file, no `ATTACH` for deal isolation |
| ISO-02 | Demo-only mechanics (time-travel, XP/leaderboards) cannot read or mutate any real-deal database | `## Demo-Only Mechanic Gating` — resolver-level route-prefix refusal in the consolidated `/api` gate |
| ISO-03 | A request resolves to exactly one deal (or demo) database before any handler runs, replacing `demoMode`+shadow-array | `## Request-Scoped Connection Binding` — `AsyncLocalStorage` inside `db/store.js`, zero endpoint-signature changes |
| AUD-01 | Every write to deal data recorded in an append-only audit log (who/what/when/before-after) | `## Audit Capture Mechanism` — store-layer hook on `writeDb()`, writes to separately-opened `audit.db` |
| AUD-02 | Audit log survives deletion of the deal it describes | `audit.db` physically outside every `deals/<id>.db` file (D-09); deleting a deal file cannot touch it |
| VAL-01 | Every write endpoint validates input against a schema, rejects malformed requests with a clear error | `## zod Validation Pipeline` — `safeParse` + `.strip()` default, one schema module per resource |
| VAL-02 | Free-text/HTML-bearing fields sanitized before storage or render | `## HTML Sanitization Without a New Dependency` — port existing client-side regex sanitizer server-side |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads (last 30d) | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------------------|--------------|---------|-------------|
| `zod` | npm | 5+ years (published 2020-03-07) [VERIFIED: `npm view zod time.created`] | 986,681,084 [VERIFIED: `api.npmjs.org/downloads/point/last-month/zod`] | `github.com/colinhacks/zod` [VERIFIED: `npm view zod repository.url`] | OK | Approved |

No `postinstall` script on `zod` [VERIFIED: `npm view zod scripts.postinstall` returned empty]. Current published version on the npm registry is **4.4.3** [VERIFIED: `npm view zod version`, checked 2026-08-01] — matches the version this project's own milestone research (`SUMMARY.md`) already recorded, and matches Context7's `/colinhacks/zod` v4 docs (`z.object()` strips unknown keys by default; `z.strictObject()` throws on unrecognized keys; `z.looseObject()` passes them through) [CITED: github.com/colinhacks/zod v4 source, via Context7].

**better-sqlite3** is not re-audited here — it was already vetted and installed in Phase 1 (pinned at 13.0.1 in `package.json`; latest registry version as of this check is 13.0.2 [VERIFIED: `npm view better-sqlite3 version`] — a patch bump, not required for this phase, note for the planner as optional).

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none. `zod` is the only new dependency this phase introduces; no HTML-sanitization library is recommended (see below) — VAL-02 is closed by porting existing in-repo logic, not by adding a dependency.

## Architecture Patterns

### System Architecture Diagram

```text
Browser (deal switcher / any write form)
   │
   ▼
POST/GET /api/*  ──────────────────────────────────────────────┐
   │                                                            │
   ▼                                                            │
[1] Consolidated /api gate (server.js ~L268, EXISTING)          │
    - PUBLIC_API_PATHS passthrough                              │
    - isOpenMode(req) / DEMO_OPEN                                │
    - X-Admin-Token → attributed identity (D-11)                │
    - session cookie → sessions.findSession()                   │
    - req.portalUser = { username, role, sessionId }            │
    - ROLE_WRITE_POLICY 403 check                                │
   │                                                            │
   ▼                                                            │
[2] Deal-resolver middleware (NEW, same gate, after portalUser)  │
    - session row's bound deal-id (D-01) OR demo → req.isDemo   │
    - D-03: membership check against control.db deal_members    │
    - resolve → { kind: 'demo'|'deal'|'control', dbPath }        │
    - open-or-reuse cached Database handle for dbPath            │
    - AsyncLocalStorage.run(handle, next())  ← binds db/store.js │
   │                                                            │
   ▼                                                            │
[3] Demo-only route guard (NEW, same gate)                      │
    - DEMO_ONLY_PREFIXES.includes(fullPath) && !req.isDemo → 403 │
   │                                                            │
   ▼                                                            │
[4] zod validation middleware (NEW, per-route)                  │
    - schema.safeParse(req.body)                                │
    - fail → 400 { success:false, error }                       │
    - pass → req.body = result.data (unknown keys stripped)     │
    - HTML-tagged fields → sanitizeHtml() before this returns    │
   │                                                            │
   ▼                                                            │
[5] Route handler (EXISTING, UNCHANGED call sites)               │
    - const db = readDb();  ...  writeDb(db);                    │
    - readDb()/writeDb() resolve the ALS-bound connection         │
      via db/store.js's requireDb() — same whole-object API      │
   │                                                            │
   ▼                                                            │
[6] writeDb() store-layer audit hook (NEW, inside db/store.js)   │
    - snapshot-diff merge ALREADY computes before/after per row  │
    - after the deal/control-db transaction commits:             │
      write { actor, action, dealId, before, after, ts } rows    │
      to the separately-opened audit.db connection, own txn      │
   │                                                            │
   ▼                                                            │
res.json(...)
```

### Recommended Project Structure

```
db/
├── store.js              # readDb/writeDb — gains ALS-bound connection resolution + audit hook
├── sessions.js            # gains a nullable `deal_id` column (D-01)
├── collections.js         # unchanged this phase (still the demo/deal schema inventory)
├── schema.sql             # unchanged shape, becomes the per-deal-file schema (D-06 seed)
├── control-schema.sql     # NEW: users, deal_registry, deal_members, (moved) sessions
├── audit-schema.sql       # NEW: single audit_log table
├── resolver.js            # NEW: deal-resolver middleware + connection cache Map
└── auditHook.js           # NEW: writeDb()-wrapping before/after capture → audit.db
validators/
├── deals.js               # NEW: zod schemas for /api/deals (D-02/D-03)
└── <resource>.js           # NEW: one file per existing resource group (~60 endpoints)
lib/
└── sanitizeHtml.js         # NEW: server-side port of page-layout.js's regex sanitizer
scripts/
└── split-db-into-control-demo-deals.js  # NEW: re-runnable, --verify, mirrors migrate-db-json-to-sqlite.js
data/
├── control.db              # committed (near-static: users, deal_registry, deal_members)
├── demo.db                  # committed (all demo-flavored collections, D-05)
├── runtime.db                # gitignored (sessions + churn)
├── audit.db                   # gitignored, zip-excluded
└── deals/
    └── <id>.db                 # gitignored, zip-excluded
```

### Pattern 1: Request-Scoped Connection Binding via AsyncLocalStorage

**What:** `db/store.js` currently holds one module-level `db` singleton, opened once at server startup, referenced by every bare `readDb()`/`writeDb()` call across ~90 endpoint call sites [VERIFIED: db/store.js:36-37, `let db = null; let dbPath = null;`]. Generalizing this to "one connection per resolved database" without touching any of those ~90 call sites requires the resolved connection to travel with the request implicitly, not as an explicit parameter.

**When to use:** Any time per-request state (here: which SQLite file this request is scoped to) must reach deeply-nested, already-existing code that has no request object in scope and cannot be refactored to accept one without a large, regression-risking diff.

**Example:**
```javascript
// Source: Node.js official docs, nodejs.org/api/async_context.html
const { AsyncLocalStorage } = require('node:async_hooks');
const requestDbStorage = new AsyncLocalStorage();

// In the resolver middleware (server.js ~/api gate, step [2] above):
app.use('/api', (req, res, next) => {
  // ... existing portalUser resolution unchanged ...
  const resolved = resolveDatabase(req); // { kind, dbPath, dealId }
  const conn = store.getOrOpenConnection(resolved.dbPath); // cached Map lookup
  req.dealContext = resolved; // still useful for handlers that need dealId explicitly (e.g. audit)
  requestDbStorage.run(conn, () => next());
});

// Inside db/store.js — requireDb() falls back to the module singleton
// OUTSIDE a request (server startup, migration scripts, tests) so nothing
// that calls initDb()/readDb() directly (e.g. test/*.test.js) breaks:
function requireDb() {
  const scoped = requestDbStorage.getStore();
  if (scoped) return scoped;
  if (!db) throw new Error('db/store.js: initDb() must be called before readDb()/writeDb()');
  return db;
}
```
`asyncLocalStorage.run(store, callback)` / `asyncLocalStorage.getStore()` are the two APIs used — `run()` establishes the context for the callback and everything it awaits; `getStore()` returns `undefined` outside any `run()` context, which is exactly the desired fallback-to-singleton behavior for non-request code paths (tests, the migration script, server startup) [CITED: nodejs.org/api/async_context.html].

### Pattern 2: Multiple Independent Database Handles, Not ATTACH, for Deal Isolation

**What:** Each resolved database (`control.db`, `demo.db`, each open `deals/<id>.db`) gets its own `new Database(path)` handle, cached in a `Map<path, Database>` and opened lazily on first request that resolves to it. `ATTACH DATABASE` is deliberately NOT used to give one connection cross-deal query access — that would work directly against the isolation goal (a resolver bug or a stray un-scoped query could then read another deal's rows through the same connection).

**When to use:** Whenever isolation between the databases matters more than convenience of cross-database querying. `ATTACH` is reserved for the one place two databases legitimately need to interact: the audit hook writing into `audit.db` (see Pattern 3), where an independent second connection (not `ATTACH`) is still the recommendation.

**Why this works at this app's scale:** WAL mode's own design goal is exactly "one writer, multiple readers, concurrently" and supports multiple independent connections to the same file, including opened at different times by the same process — "The WAL journal mode will be set on all connections to the same database file if it is set on any one connection" [CITED: sqlite.org/wal.html]. A laptop-scale single-IL app with a handful of deals at once means the connection-cache `Map` never grows large; a simple LRU-close-on-idle is optional polish, not a correctness requirement (`.close()` on eviction is safe — better-sqlite3's `Database.close()` finalizes prepared statements and flushes WAL cleanly).

**Example — connection cache:**
```javascript
// Source: pattern derived from db/store.js's existing initDb() (VERIFIED: db/store.js:67-90)
// pragma set applied to EVERY newly opened connection — matches Phase 1 precedent exactly.
const connectionCache = new Map(); // dbPath -> Database
function getOrOpenConnection(dbFilePath) {
  if (connectionCache.has(dbFilePath)) return connectionCache.get(dbFilePath);
  const conn = new Database(dbFilePath);
  conn.pragma('journal_mode = WAL');
  conn.pragma('synchronous = NORMAL');
  conn.pragma('foreign_keys = ON');
  conn.pragma('busy_timeout = 5000');
  conn.exec(fs.readFileSync(DEAL_SCHEMA_PATH, 'utf8')); // idempotent CREATE TABLE IF NOT EXISTS
  connectionCache.set(dbFilePath, conn);
  return conn;
}
```

### Pattern 3: Store-Layer Audit Hook (Not SQLite Triggers)

**What:** `writeDb()`'s existing per-collection loop already has `beforeMap.get(id)` (the exact serialized JSON this request's own `readDb()` saw) and computes `serialized = JSON.stringify(item)` (the new value) for every insert/update, and already knows which ids were deleted [VERIFIED: db/store.js:174-221, the `applyWrite` transaction body]. Wrapping `writeDb()` to also append `{ action: 'insert'|'update'|'delete', collection: key, id, before, after }` rows to an array, then — **after** the deal-db `applyWrite` transaction commits successfully — writing that array as one batch transaction to a separately-opened `audit.db` connection, is a direct extension of code that already exists, with the actor (`req.portalUser`) passed in as an explicit parameter (not stamped via a SQL-side temp table).

**When to use:** Any write to a `deals/<id>.db` or a control-plane security event (D-08). Demo writes explicitly skip this hook (no audit value, D-08).

**Why not SQLite `AFTER INSERT/UPDATE/DELETE` triggers with `ATTACH`:** Three compounding reasons, not one:
1. **Non-atomicity in WAL mode** — the deal-db write and the `audit.db` write would not commit as a single atomic unit even with `ATTACH` [VERIFIED: sqlite.org/lang_attach.html, quoted above]. The store-layer hook has the *same* non-atomicity (two independent commits) but without pretending otherwise via `ATTACH` syntax — the failure mode is explicit and easier to reason about in code review.
2. **Actor context is not naturally available to a SQL trigger.** `OLD`/`NEW` give row-level before/after for free, but "who made this write" (`req.portalUser.username`) has no SQL-native channel into a trigger body without a stamped per-transaction temp table (the milestone-level `SUMMARY.md` research floated this as `middleware/auditActor.js`) — that's an extra moving part the store-layer hook avoids entirely, since the actor is already an in-memory JS value at the point `writeDb(db, actor)` is called.
3. **Every deal-file connection would need `audit.db` `ATTACH`ed at open time**, using a consistent alias, adding per-connection setup that the connection-cache (Pattern 2) would otherwise not need — extra surface for a silently-missing `ATTACH` to make triggers fail loudly (or worse, be forgotten on a newly-opened deal file).

The store-layer hook keeps `db/schema.sql` free of triggers (matching the Phase 1 schema's own explicit comment: "do NOT add an audit_log table here — both are explicitly out of scope for this phase (Phase 3/4-5 concerns)" [VERIFIED: db/schema.sql:9-10]) and reuses code that is already correct and tested (`writeDb-merge.test.js` exists).

**Trade-off to document for the planner:** this is best-effort, not two-phase-commit. A crash between the deal-db commit and the `audit.db` commit loses that one audit entry while the underlying write still lands. This matches D-08/D-09's stated bar (no tamper-evidence/hash-chaining required this phase, explicitly deferred) and is standard practice for application-level audit logs; write the audit entry only *after* confirming the source commit succeeded, never before (never audit a write that didn't happen).

**Example — hook shape:**
```javascript
// Extends db/store.js's existing writeDb(data) (VERIFIED: db/store.js:167-226)
function writeDb(data, actor) { // actor: { username, role } — NEW required param for deal/control writes
  const conn = requireDb();
  // ... existing snapshot-diff merge, UNCHANGED, but now also pushes into auditRows[] ...
  const auditRows = [];
  const applyWrite = conn.transaction((payload) => {
    for (const key of ARRAY_COLLECTIONS) {
      // ... existing insert/update/delete logic ...
      // at each insert.run/update.run/del.run call site, also:
      auditRows.push({ collection: key, id, action, before: beforeMap.get(id) || null, after: serialized || null });
    }
  });
  applyWrite(data);
  if (auditRows.length && shouldAudit(dbKind)) { // dbKind: resolved from the SAME context Pattern 1 sets
    writeAuditBatch(getAuditConnection(), { actor, dealId: currentDealId(), rows: auditRows, ts: new Date().toISOString() });
  }
  return true;
}
```

### Anti-Patterns to Avoid

- **Scattering `req.isDemo` checks across individual route handlers:** This is structurally the same anti-pattern as the current 64 `demoMode` checks ISO-03 is replacing. Gate demo-only routes (time-travel, XP scaling) once, in the consolidated `/api` gate, with a `DEMO_ONLY_PREFIXES` list mirroring `ROLE_WRITE_POLICY`'s existing shape — not per-handler `if (!req.isDemo) return 403`.
- **`ATTACH`ing every deal connection to `audit.db` "for convenience":** defeats the non-atomicity argument above for no benefit — an independent second connection plus an explicit JS-level write is simpler and equally (non-)atomic.
- **Trusting `readDb()`'s caller to pass the right actor into `writeDb()`:** make `actor` a required parameter (or pull it from the same `AsyncLocalStorage` context Pattern 1 already threads through) so a call site that forgets it fails loudly at development time rather than silently producing an audit row with a null actor.
- **Validating only `req.body` shape and skipping the HTML-tagged-field sanitization step:** VAL-01 and VAL-02 are two different gates (schema shape vs. content safety) — a payload can be perfectly well-typed and still carry a `<script>` tag in a field the schema marked as HTML-permitted. Both steps are required per D-15, not either/or.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Schema/type validation across ~60 write endpoints | Custom hand-written `if (typeof x !== 'string')` checks per route (the codebase currently has zero of these — VAL-01 closes a total gap) | `zod` (`z.object()` + `.safeParse()`) | D-12 already locks this; zod's default `.strip()` behavior directly implements D-13 with no extra code; 986M weekly downloads, MIT license, 5+ year track record [VERIFIED] |
| Per-request "which database" plumbing through ~90 call sites | Rewriting every `readDb()`/`writeDb()` call site to accept an explicit connection parameter | `AsyncLocalStorage` inside `db/store.js` | Zero-diff to existing handlers; Node core API, no dependency; officially documented pattern for exactly this use case [CITED] |
| Robust HTML allowlist sanitization | A hand-rolled regex from scratch | Either (a) port the *already-proven* `public/js/page-layout.js` regex-strip pattern server-side (recommended — zero new dependency, matches D-15's "zero-or-tiny new deps" instinct and the existing precedent's own comment that DOMPurify is "the recommended robust upgrade," not a requirement), or (b) `isomorphic-dompurify` if the planner wants the stronger guarantee — but that pulls in `jsdom`, a heavy transitive dependency this vanilla-JS/no-build-step app has never carried; flag as a discretion point, not a locked recommendation | The existing regex already ships in production, strips `<script>`/`<iframe>`/`<object>`/`<embed>`/`<form>`/`<meta>`/`<base>`/`<link>` tags, inline `on*=` handlers, and `javascript:`/`vbscript:` schemes [VERIFIED: public/js/page-layout.js:14-19] |

**Key insight:** This phase's two "new capability" requirements (AUD-01/02, VAL-01/02) have almost no existing code to build on in `server.js` — they are genuinely greenfield within this codebase. The isolation requirement (ISO-01/02/03), by contrast, is explicitly a generalization of `db/store.js`'s already-correct connection/read/write pattern — resist the temptation to redesign that pattern from scratch; extend it.

## Common Pitfalls

### Pitfall 1: Treating `ATTACH` + cross-database triggers as "the SQLite way" without checking WAL atomicity
**What goes wrong:** A planner reads that SQLite triggers can reference `ATTACH`ed databases and concludes cross-file audit triggers give a stronger guarantee than an application-level hook — then discovers post-implementation that a crash mid-write can still desync the two files, having built the more complex mechanism for no atomicity gain.
**Why it happens:** SQLite's own docs describe `ATTACH` and triggers separately from the WAL atomicity caveat; the two facts aren't juxtaposed unless you specifically search for "WAL ATTACH atomicity."
**How to avoid:** Treat the store-layer hook (Pattern 3) as the default; only reconsider triggers if a future phase needs the audit write to happen even for writes that bypass `db/store.js` entirely (none exist today — `db/sessions.js` is the only sibling module with direct SQL access, and D-08 already covers its writes as "control-plane security events").
**Warning signs:** Any design doc that says "the trigger guarantees the audit entry is never lost" for a cross-file write.

### Pitfall 2: Migrating `demoMode`/`custom*` call sites mechanically instead of auditing the blast radius first
**What goes wrong:** 64 `demoMode` references and 10 distinct `custom*` collections (`customEmployees` 18 refs, `customSettings` 31 refs, down to `customRaidEntries` 7 refs) [VERIFIED: `grep -c demoMode server.js` = 64; `grep -oE "\bcustom[A-Za-z]+\b" server.js | sort | uniq -c`] span read paths, write paths, and the project-switch machinery (`saveCustomLaneToProject`/`loadProjectIntoCustomLane`/`stashActiveCustomProject`/`snapshotCms`/`applyCmsToTopLevel`, `server.js:850-949`). A plan that budgets this as "flip a flag" will run out of task budget mid-wave.
**Why it happens:** The `demoMode` boolean currently gates BOTH which data lane is read (isCustom ? customX : x) AND which UI behavior applies (time-travel scaling only makes sense on demo employees) — two orthogonal concerns collapsed into one flag.
**How to avoid:** Have the planner produce a literal call-site inventory (one Grep pass, already partially done above) before estimating task count; each `demoMode`/`custom*` site becomes either "delete — now structurally impossible because resolved DB has no demo-only fields" or "replace `db.employees`/`db.customEmployees` with `readDb()` against the resolved connection, no branching needed" once ISO-03 lands. Most sites collapse to the second, simpler case.
**Warning signs:** A plan wave that touches `server.js` broadly without first producing this inventory as its own deliverable.

### Pitfall 3: Building the deal-resolver membership check (D-03) as a read-time filter instead of a bind-time refusal
**What goes wrong:** If the resolver lets a request bind to a deal and only filters *results* by membership afterward, a bug in any one of the ~60 write endpoints becomes a cross-deal write, not just a cross-deal read — much worse blast radius.
**Why it happens:** Filtering read results feels like the natural place to enforce "need to know" if you're thinking about clean-room (Phase 4's concern), but D-03 for this phase is coarser and earlier: refuse the *bind* itself.
**How to avoid:** The membership check belongs inside the resolver, before `getOrOpenConnection()` is even called for that deal's file — a non-member's session simply cannot obtain a connection handle to that `deals/<id>.db`, full stop (401/403 before Pattern 1's `AsyncLocalStorage.run()`).
**Warning signs:** Any code path where a handler, not the resolver, is the first place membership is checked.

### Pitfall 4: Forgetting `runtime.db`/`audit.db`/`deals/*.db` in BOTH `.gitignore` AND the download-zip exclusion list
**What goes wrong:** The existing `.gitignore` already excludes `data/*.db-wal`/`data/*.db-shm`/`data/*.db.bak` but commits the primary `data/*.db` file itself (demo database precedent) [VERIFIED: .gitignore]. The existing download-zip `execSync` exclusion list is a hardcoded string of `-x` glob patterns inside `server.js` [VERIFIED: server.js:501, currently excludes `"data/*.db" "data/*.db-wal" "data/*.db-shm" "data/*.db.bak"`] — a flat pattern that does NOT recurse into `data/deals/*.db` (glob `data/*.db` does not match `data/deals/<id>.db`, a nested path) and predates `runtime.db`/`audit.db` entirely.
**Why it happens:** Two independent lists (`.gitignore`, the zip `-x` args) must both be updated for every new gitignored file family, and the existing zip exclusion pattern was written for a flat `data/` directory, before the `deals/` subdirectory existed.
**How to avoid:** Update `.gitignore` to add `data/runtime.db*`, `data/audit.db*`, `data/deals/` (whole directory) — and update the `server.js:501` `execSync` string to add `"data/runtime.db*" "data/audit.db*" "data/deals/*"`. Verify with the same technique `test/`-suite conventions already use: assert the exported zip does NOT contain these paths, mirroring how Phase 1 pre-emptively excluded `.db`/`.db-wal`/`.db-shm`/`.db.bak` "before wave 2 creates the first .db file" [per STATE.md decision log].
**Warning signs:** A `deals/<id>.db` file appearing in a downloaded zip during manual verification.

### Pitfall 5: Assuming `zod` v3 API examples (common in older tutorials/training data) apply unchanged to the installed v4
**What goes wrong:** zod v4 (the current registry version, 4.4.3) reorganizes some object-schema constructors — `z.object()` / `z.strictObject()` / `z.looseObject()` are the v4-native names for strip/strict/passthrough behavior, alongside the v3-style `.strict()`/`.passthrough()` chainable methods which still work but are documented as the v3 API surface [CITED: Context7 `/colinhacks/zod` v4 source]. A plan or implementation written from memory/training data (which skews toward v3, given zod v4 is comparatively recent) may reach for patterns that still work but aren't the primary v4-documented style, or worse, reach for a removed v3-only helper.
**Why it happens:** Training data has more historical zod v3 content than v4 content.
**How to avoid:** When the planner or executor writes zod schemas, verify against the installed `node_modules/zod/package.json` version and prefer `z.object(shape)` (strips by default — matches D-13 directly) over remembering to chain `.strip()` explicitly.
**Warning signs:** Code using `z.string().nonempty()` (deprecated in v4 in favor of `.min(1)`) or other v3-era idioms without checking against the installed version.

## Code Examples

### zod schema + safeParse → existing 400 error shape
```javascript
// Source: https://github.com/colinhacks/zod v4 docs, via Context7 /colinhacks/zod
const { z } = require('zod');

const CreateDealSchema = z.object({
  name: z.string().min(1).max(200),
  targetCompany: z.string().min(1).max(200),
  members: z.array(z.string().min(1)).default([]),
  // z.object() with no explicit catchall STRIPS unknown keys by default (D-13) —
  // no .strict()/.passthrough() call needed for the "strip unknown" behavior.
});

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      // result.error.issues: [{ code, expected, received, path, message }, ...]
      return res.status(400).json({
        error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    req.body = result.data; // unknown keys already stripped
    next();
  };
}

app.post('/api/deals', validateBody(CreateDealSchema), (req, res) => { /* ... */ });
```

### AsyncLocalStorage-bound connection resolution (extends db/store.js)
```javascript
// Source: pattern combines nodejs.org/api/async_context.html (CITED) with the
// existing db/store.js requireDb()/getConnection() shape (VERIFIED: db/store.js:92-105)
const { AsyncLocalStorage } = require('node:async_hooks');
const requestDbStorage = new AsyncLocalStorage();

function requireDb() {
  const scoped = requestDbStorage.getStore();
  if (scoped) return scoped;
  if (!db) throw new Error('db/store.js: initDb() must be called before readDb()/writeDb()');
  return db; // unchanged fallback: server startup, migration scripts, existing tests
}

module.exports = {
  initDb, readDb, writeDb, idOf, projectIdOf, DEFAULT_DB_PATH, getConnection,
  requestDbStorage, // exported so the resolver middleware can call .run()
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `demoMode` boolean + `custom*` shadow arrays + `stashActiveCustomProject`/`snapshotCms` on ONE shared SQLite file (`data/ma-portal.db`) | Session-bound resolver → one physically separate SQLite file per deal (+ demo.db + control.db) | This phase (ISO-01/02/03) | The bug class the milestone research named (40+ scattered `demoMode` checks) becomes structurally impossible — a resolver bug can misroute a request, but it cannot make two deals' rows land in the same file |
| No server-side write validation anywhere in `server.js` | zod schema per write endpoint, `safeParse` before the handler runs | This phase (VAL-01) | Closes a documented Critical gap named in the milestone's own `CONCERNS.md`/`SUMMARY.md` research |
| Client-side-only regex HTML stripping (render time, `page-layout.js`) | Server-side sanitization at write time (D-15) + existing client-side discipline kept as defense-in-depth | This phase (VAL-02) | Closes the "stored XSS" gap noted inline in `server.js:3036`'s own comment about unescaped values being a stored-XSS vector |

**Deprecated/outdated:**
- The `demoMode`-flag mechanism itself is not "deprecated" in the sense of an external library changing — it is this codebase's own Phase-2-era-and-earlier architecture, explicitly named for full replacement by ISO-03 (not incremental extension).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | Porting the existing client-side regex sanitizer (`page-layout.js`) server-side, rather than adding a dedicated HTML-sanitization library, satisfies D-15's "zero-or-tiny new deps" intent for the planner | `## Don't Hand-Roll`, `## Package Legitimacy Audit` | If the user actually wants the stronger DOMPurify-class guarantee despite the `jsdom` dependency weight, the planner under-scopes VAL-02's robustness; low risk since the existing regex is already the app's documented production defense and the discussion explicitly names "zero-or-tiny new deps" |
| A2 | Resolver-level route-prefix refusal (extending the `ROLE_WRITE_POLICY` pattern with a `DEMO_ONLY_PREFIXES` list) is the intended interpretation of "hard-gate" for ISO-02, over a per-handler guard | `## Demo-Only Mechanic Gating` (Pattern under Architecture Patterns), CONTEXT.md's own Claude's Discretion note | If the planner instead wants gating enforced structurally by which DB was resolved (e.g., time-travel columns simply don't exist in the deal schema), that's a stronger but more invasive alternative not fully explored here — flag for the planner to confirm during plan-check |
| A3 | The store-layer `writeDb()` hook writes to `audit.db` via an independent second `better-sqlite3` connection (not `ATTACH`), accepting non-atomic best-effort semantics | `## Audit Capture Mechanism` (Pattern 3) | This is the phase's single highest-leverage architectural decision and is grounded in verified SQLite/WAL documentation, not training-data recall — risk is low, but it is a recommendation, not a locked CONTEXT.md decision (explicitly left to Claude's Discretion) |

**If this table is empty:** N/A — see entries above; all three are reasoned recommendations for CONTEXT.md's explicit "Claude's Discretion" items, not verified-fact claims, and are flagged for plan-check/user confirmation accordingly.

## Open Questions

1. **Where does `deal_members` live relative to `deal_registry`, and what's the exact row shape?**
   - What we know: D-03 says "username allowlist stored in the control DB"; D-02 says admin+hrbp can create, admin-only can delete/archive.
   - What's unclear: whether membership is a join table (`deal_id`, `username`) or an array column on the deal-registry row (blob-per-row schema precedent from Phase 1 suggests the latter is more consistent with this codebase's existing style — `data` JSON column holding `{ id, name, members: [...] }`).
   - Recommendation: Follow the existing blob-per-row convention (`db/schema.sql`'s pattern) for `control.db`'s `deals` table — a JSON `data` column with `members: []` inside it — rather than introducing a normalized join table this codebase has no precedent for. Keeps the planner's task count down and matches D-06's "same schema as demo" instinct.

2. **Does the connection cache (Pattern 2) need an eviction/close-on-idle policy this phase, or is "never close" acceptable at this app's scale?**
   - What we know: laptop-scale, single active IL, realistically single-digit concurrent deals per CONTEXT.md's scope.
   - What's unclear: whether a long-running server process (left open for days) accumulating open file handles for every deal ever touched is a real concern worth a task, or premature optimization.
   - Recommendation: Ship without eviction this phase (open connections live for the process lifetime, same as today's single-connection singleton) — note it as a natural v2/shared-host-milestone follow-up (HOST-02's "multi-process/network-filesystem SQLite" hardening territory), not a Phase 3 requirement.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|----------|----------|
| better-sqlite3 | All of ISO-01/02/03, AUD-01/02 (already installed, Phase 1) | ✓ | 13.0.1 installed (13.0.2 latest on registry) [VERIFIED] | — |
| zod | VAL-01 (new this phase) | Not yet installed — must be added via `npm install zod` and committed to `node_modules` per D-12 | 4.4.3 current on npm registry [VERIFIED] | — |
| node:async_hooks (AsyncLocalStorage) | ISO-03 resolver binding | ✓ (Node core, no install) | Built into Node ≥20 (project requires ≥22) | — |
| `zip` CLI | Download-zip exclusion-list update (Pitfall 4) | Already a documented platform requirement per CLAUDE.md ("zip utility required for admin `/api/admin/download-zip` feature") | — | — |

**Missing dependencies with no fallback:** none — `zod` is a standard `npm install`, no environment-specific blocker.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in, zero dependency) [VERIFIED: package.json `"test": "node --test"`, and existing `test/*.test.js` files all `require('node:test')`] |
| Config file | none — bare `node --test` discovers `test/*.test.js` by convention (existing repo pattern; `node --test test/` does NOT work on this project's Node version per `test/role-enforcement.test.js`'s own header comment) |
| Quick run command | `node --test test/deal-resolver.test.js` (or whichever new file, run individually during a task) |
| Full suite command | `npm test` (runs all of `test/*.test.js`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| ISO-01 | Two different deals' `.db` files contain no shared rows | integration | `node --test test/deal-isolation.test.js` | ❌ Wave 0 |
| ISO-01 | A request resolves to exactly one database before any handler runs | integration | `node --test test/deal-resolver.test.js` | ❌ Wave 0 |
| ISO-02 | Time-travel/XP invoked against a deal session has no effect on deal data | integration | `node --test test/demo-only-gating.test.js` | ❌ Wave 0 |
| ISO-03 | `demoMode`/`custom*` mechanism fully removed, resolver is the only switch | integration + static grep assertion | `node --test test/deal-resolver.test.js` (+ a grep-count assertion mirroring `db/collections.js`'s own self-check pattern) | ❌ Wave 0 |
| AUD-01 | Every write to `deals/<id>.db` produces an audit row with who/what/when/before/after | integration | `node --test test/audit-log.test.js` | ❌ Wave 0 |
| AUD-02 | Deleting a deal leaves its audit trail intact | integration | `node --test test/audit-log.test.js` (same file, dedicated test case) | ❌ Wave 0 |
| VAL-01 | Malformed payload (wrong type/missing field/over length) rejected with clear 400 on every write endpoint | integration, parametrized across route list | `node --test test/write-validation.test.js` | ❌ Wave 0 |
| VAL-02 | HTML-bearing field round-trips without executing injected script | integration | `node --test test/xss-sanitization.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the single new test file for that task's requirement (e.g. `node --test test/deal-resolver.test.js` after the resolver task)
- **Per wave merge:** `npm test` (full suite — must stay green, including all pre-existing Phase 1/2 test files: `session-lifecycle`, `role-enforcement`, `concurrent-write`, `migration-roundtrip`, `writedb-merge`, `auth-route-inventory`)
- **Phase gate:** Full suite green before `/gsd-verify-work 3`

### Wave 0 Gaps
- [ ] `test/deal-resolver.test.js` — covers ISO-01 (one-DB-per-request), ISO-03 (resolver is the sole switch)
- [ ] `test/deal-isolation.test.js` — covers ISO-01 (no shared rows across two deal files) — follow `test/concurrent-write.test.js`'s existing pattern of booting the real app against temp SQLite files
- [ ] `test/demo-only-gating.test.js` — covers ISO-02
- [ ] `test/audit-log.test.js` — covers AUD-01/02, including the "delete deal, audit survives" case
- [ ] `test/write-validation.test.js` — covers VAL-01 across a representative sample of the ~60 write endpoints (not necessarily all 60 individually — the planner should decide a representative subset plus the zod-schema-module unit tests covering the rest)
- [ ] `test/xss-sanitization.test.js` — covers VAL-02 round-trip (write HTML-bearing payload, read it back, assert `<script>` was stripped but benign markup survived)
- [ ] `scripts/split-db-into-control-demo-deals.js` needs its own `--verify` test coverage mirroring `test/migration-roundtrip.test.js`'s existing pattern against `scripts/migrate-db-json-to-sqlite.js`

*(No existing test infrastructure covers any of this phase's requirements — Phase 1/2's test files cover FND/AUTH only, confirmed by `grep` across `test/*.test.js` file names and their own requirement-ID comments.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No (Phase 2 closed) | — |
| V3 Session Management | Yes — extending, not replacing | Existing `db/sessions.js` opaque-token/SHA-256-hash pattern gains a `deal_id` column (D-01); no new session mechanism |
| V4 Access Control | Yes | D-03's bind-time membership refusal (resolver-level, not read-time filter — see Pitfall 3); `ROLE_WRITE_POLICY`-style `DEMO_ONLY_PREFIXES` extension for ISO-02 |
| V5 Input Validation | Yes | `zod` `safeParse` per write endpoint (VAL-01), D-13's strip-unknown/reject-invalid |
| V6 Cryptography | No new crypto surface this phase — audit rows are plaintext JSON in `audit.db` (D-11), no hash-chaining/tamper-evidence required (explicitly deferred) | — |
| V7 Error Handling & Logging | Yes | AUD-01/02's append-only audit log IS this app's V7 logging control for deal-data writes; zod's `safeParse` error messages must not leak internal schema/stack details in the 400 response body |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Stored XSS via a free-text field that gets rendered with `innerHTML` elsewhere in the app | Tampering / Elevation of Privilege | Server-side sanitization at write time (D-15) for schema-tagged HTML fields; plain-text storage + existing `textContent`/`escapeHtml` discipline for everything else |
| Cross-deal data leakage via a resolver bug or a forgotten membership check on a new route | Information Disclosure | Bind-time refusal in the resolver (Pitfall 3), not read-time filtering; a new route added without going through the resolver simply has no `readDb()`/`writeDb()` access at all (fail-closed, `requireDb()` throws if no `AsyncLocalStorage` context and no fallback singleton was explicitly initialized for that path) |
| Audit log tampering (an attacker with filesystem access rewrites `audit.db` to cover tracks) | Repudiation | Out of scope this phase per D-09/Deferred — `audit.db`'s physical separation from every `deals/<id>.db` is the only control landing now; hash-chaining/tamper-evidence explicitly deferred to the shared-host (v2) milestone |
| A write endpoint's zod schema is too permissive (e.g., a free-text field with no `.max()` length limit) and becomes a DoS vector (unbounded blob stored per row) | Denial of Service | D-13's "over-length values reject with clear 400" — every string field in every schema must carry an explicit `.max()`, derived from what the existing UI actually sends (D-14) |

## Sources

### Primary (HIGH confidence)
- `sqlite.org/lang_attach.html` — WAL/ATTACH cross-database atomicity limitation, fetched and quoted directly [VERIFIED]
- `sqlite.org/wal.html` — concurrent reader/writer semantics, same-host-only constraint, fetched and quoted directly [VERIFIED]
- `nodejs.org/api/async_context.html` — AsyncLocalStorage API (`run()`, `getStore()`) [CITED]
- Context7 `/colinhacks/zod` (v4 source + docs) — `z.object()`/`z.strictObject()`/`z.looseObject()` unknown-key handling, `safeParse().error.issues` shape [CITED]
- Context7 `/wiselibs/better-sqlite3` — `new Database(path, options)`, `.transaction()`, WAL pragma usage, `.serialize()` [CITED]
- npm registry, verified live 2026-08-01: `zod@4.4.3` (created 2020-03-07, 986,681,084 downloads/last-30-days, MIT, github.com/colinhacks/zod, no postinstall script), `better-sqlite3@13.0.2` latest (13.0.1 installed) [VERIFIED]
- Direct codebase inspection: `db/store.js`, `db/sessions.js`, `db/collections.js`, `db/schema.sql`, `server.js` (auth gate, project-switch mechanics, time-travel/pulse-scaling functions, download-zip exclusion list), `scripts/migrate-db-json-to-sqlite.js`, `test/role-enforcement.test.js`, `public/js/page-layout.js`, `.gitignore`, `package.json`

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md` (this project's own milestone-level research, 2026-07-23) — file-per-deal rationale, original trigger-based audit suggestion (superseded by this phase's deeper WAL/ATTACH finding above), zod/better-sqlite3 version selection

### Tertiary (LOW confidence)
- WebSearch results on lightweight HTML sanitizer alternatives (`xss`, `@jitbit/htmlsanitizer`, `simple-sanitizer`) — surfaced for awareness only; NOT recommended (see `## Don't Hand-Roll`), no legitimacy audit run against them since they are not the chosen path

## Metadata

**Confidence breakdown:**
- Standard stack (zod version, better-sqlite3 version): HIGH — verified live against npm registry same-day
- Architecture (resolver/AsyncLocalStorage/connection-cache/audit-hook design): HIGH for the SQLite/WAL/ATTACH factual grounding, MEDIUM for the overall recommendation as a judgment call (explicitly a Claude's Discretion item in CONTEXT.md, not a locked decision)
- Pitfalls: HIGH — all five grounded in direct codebase grep/read, not external speculation
- Validation Architecture: HIGH — test framework and existing file conventions directly verified; new file list is a reasoned extrapolation from the requirement list

**Research date:** 2026-08-01
**Valid until:** 30 days (stable stack; re-check zod/better-sqlite3 registry versions if planning is delayed past early September 2026)
