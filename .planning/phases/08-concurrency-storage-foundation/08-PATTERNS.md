# Phase 8: Concurrency & Storage Foundation - Pattern Map

**Mapped:** 2026-08-10
**Files analyzed:** 11 (5 modified storage/server/client files + up to 5 controlStore functions treated as one unit + 4 new test/script/config files)
**Analogs found:** 11 / 11 (every file is either a direct in-place modification of itself, or has a strong existing in-repo precedent)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `db/dbFiles.js` (modify: `busy_timeout` 5000→~1000) | config/utility (pragma contract) | CRUD (connection-open) | itself (existing `openDbFile()`) | exact — self-modification |
| `db/store.js` (modify: `writeDb()`'s `conn.transaction(fn)` → `.immediate`) | service/model (storage) | CRUD, transactional | itself (existing `writeDb()`) | exact — self-modification |
| `db/auditHook.js` (modify: `writeAuditBatch()`'s transaction → `.immediate`) | service (audit) | CRUD, transactional, append-only | itself (existing `writeAuditBatch()`) | exact — self-modification |
| `db/controlStore.js` (modify: wrap 5 read-modify-write fns in `.immediate()`) | service (control-plane data) | CRUD, transactional | itself (`updateDealMembers()` is the canonical repeated shape) | exact — self-modification, one pattern repeated 5x |
| `server.js` (new: central 503 middleware near line 6839; modify: ~8 local try/catch blocks) | middleware / controller | request-response, error-handling | `server.js:157-162` (existing malformed-JSON error middleware) + `server.js:6839-6843` (existing final 500 handler) | exact — same file, same error-middleware-chain pattern |
| `public/js/transitions.js` (modify: extend `window.fetch` wrapper; new: give-up toast helper) | client interceptor / utility | request-response, retry | itself (`public/js/transitions.js:13-54`, the existing admin-auth fetch wrapper) | exact — same file, same wrapper pattern to extend |
| `test/concurrency-busy-retry.test.js` (new) | test | event-driven (multi-process), CRUD | `test/concurrent-write.test.js` (structure) + Pattern 2 spawn code in RESEARCH.md | role-match — extends existing concurrency-test ground with real child processes |
| `test/busy-503-contract.test.js` (new) | test (coverage gate) | request-response | `test/write-validation-coverage.test.js` | exact — identical coverage-gate shape (route enumeration via `app._router.stack`) |
| `scripts/soak.js` (new) | script / harness | batch, process-orchestration, request-response | `test/audit-log.test.js` (env-var override pattern) + `test/role-enforcement.test.js` (`app.listen(0)` + native `fetch`) | role-match — no direct precedent for spawning real server.js processes; composed from two existing precedents |
| `package.json` (modify: add `"soak"` script) | config | — | itself (`scripts` block, existing `start`/`dev`/`test` entries) | exact — self-modification |

## Pattern Assignments

### `db/dbFiles.js` (config, CRUD/connection-open)

**Analog:** itself — `openDbFile()` at lines 78-92

**Current pragma block to change** (lines 82-86):
```javascript
const conn = new Database(dbFilePath);
conn.pragma('journal_mode = WAL');
conn.pragma('synchronous = NORMAL');
conn.pragma('foreign_keys = ON');
conn.pragma('busy_timeout = 5000');   // ← change to ~1000 (D-03/D-05)
```

**Pattern to copy:** This is the SINGLE pragma contract for every SQLite file the app opens (per the file's own header comment, lines 1-17). Do not add a second pragma-setting path anywhere else — every new/modified module (`controlStore.js`, `auditHook.js`) must keep routing opens through this one `openDbFile()` function so the busy_timeout change reaches all files at once (D-09's scope).

**Comment style to match** (this file's own convention, lines 1-17, 58-63): long block comments prefixed with the driving requirement ID (`ISO-01`, `AUD-02`), explaining WHY centralized before the code. New comments explaining the busy_timeout change should use the same `D-03/D-05:` prefix style already used in this file's header (line 14 already anticipates this: "busy_timeout 5000").

---

### `db/store.js` (service/model, CRUD transactional)

**Analog:** itself — `writeDb()` at lines 287-390

**Core pattern to change** (lines 305-359, specifically the `conn.transaction()` call site):
```javascript
const applyWrite = conn.transaction((payload) => {
  // ... existing snapshot-diff body, UNCHANGED ...
});
applyWrite(data);
```
becomes:
```javascript
const applyWrite = conn.transaction((payload) => {
  // ... existing snapshot-diff body, UNCHANGED ...
}).immediate;
applyWrite(data);
```

**No-swallow error pattern to preserve** (lines 363-387): `writeDb()` already has a documented no-swallow contract for the audit dispatch — "Never swallowed: if the audit write itself throws... it propagates through writeDb()'s existing no-swallow error contract." A `SQLITE_BUSY` thrown from `applyWrite(data)` itself must propagate the same way (it already does — `conn.transaction()` re-throws and rolls back automatically per the existing doc comment at lines 284-286). No new try/catch should be added around `applyWrite(data)` in this file — that would defeat D-06's central-middleware contract exactly the way Pitfall 1 (RESEARCH.md) describes for `server.js`'s local catches.

**Comment style to match:** doc-comment blocks above each function explain the WHY with requirement-ID prefixes (`AUD-01/D-08`, `D-04`) — add a similar block explaining the `.immediate` change with a `D-03:` prefix, referencing this phase's CONC-01.

---

### `db/auditHook.js` (service, CRUD transactional, append-only)

**Analog:** itself — `writeAuditBatch()` at lines 96-115

**Core pattern to change** (lines 102-113):
```javascript
const insert = conn.prepare(INSERT_SQL);
const runBatch = conn.transaction((entries) => {
  for (const row of entries) {
    insert.run(/* ... */);
  }
});
runBatch(rows);
```
Change `conn.transaction((entries) => {...})` to `conn.transaction((entries) => {...}).immediate` — mirrors the exact same one-line change as `db/store.js`'s `writeDb()`.

**No-swallow contract to preserve** (file header, lines 22-32): "an audit write that itself throws is NEVER swallowed... a rolled-back write never produces an audit row." D-10 requires this stays true under contention: a busy `audit.db` append after the wait must fail the WHOLE request 503, not a separately-caught 500. Do not wrap `runBatch(rows)` in a local try/catch here — let it propagate to `db/store.js`'s caller, which propagates to `server.js`'s central middleware.

`recordSecurityEvent()` (lines 126-141) is a bare autocommit `.run()` (not a `.transaction()`) — per RESEARCH.md's system diagram, this does NOT need `.immediate` (no `BEGIN` to choose a mode for); the shared `busy_timeout` pragma alone governs its wait.

---

### `db/controlStore.js` (service, CRUD transactional — control-plane)

**Analog:** itself — the repeated read-modify-write shape, canonically `updateDealMembers()` at lines 245-251

**The exact repeated pattern to wrap (5 occurrences):**
```javascript
// Source: db/controlStore.js:245-251 (updateDealMembers — the canonical shape)
function updateDealMembers(dealId, members) {
  const deal = getDeal(dealId);
  if (!deal) throw new Error(`db/controlStore.js: updateDealMembers() found no deal '${dealId}'`);
  const updated = { ...deal, members: Array.from(new Set((members || []).map(String))) };
  controlConn().prepare('UPDATE deals SET data = ? WHERE id = ?').run(JSON.stringify(updated), dealId);
  return updated;
}
```
The same unwrapped SELECT-then-UPDATE shape repeats in:
- `updateUser()` — lines 67-76
- `setDealMemberGrants()` — lines 267-277
- `updateDealSetup()` — lines 232-238
- `archiveDeal()` — lines 293-299

**Pattern to apply (per RESEARCH.md Pitfall 4 / Open Question 1, "Fix it in Phase 8"):** wrap each function's read+write pair in `conn.transaction((args) => { /* read + write */ }).immediate()`, following the exact `.immediate` variant syntax used in `db/store.js`/`db/auditHook.js`. Example shape for `updateDealMembers`:
```javascript
function updateDealMembers(dealId, members) {
  const conn = controlConn();
  const apply = conn.transaction((dealId, members) => {
    const deal = getDeal(dealId);
    if (!deal) throw new Error(`db/controlStore.js: updateDealMembers() found no deal '${dealId}'`);
    const updated = { ...deal, members: Array.from(new Set((members || []).map(String))) };
    conn.prepare('UPDATE deals SET data = ? WHERE id = ?').run(JSON.stringify(updated), dealId);
    return updated;
  }).immediate;
  return apply(dealId, members);
}
```
Note `getDeal()` itself (lines 87-91) does its own `controlConn()` call — inside the wrapped transaction it must use the SAME `conn` handle captured in the closure (not re-call `getDeal()`, which would re-acquire via `controlConn()` — same connection, fine, but keep the read inside the transaction body so it's part of the same locked section) — RESEARCH.md's own example code block for this exact function (`db/controlStore.js:245-251`) is the literal target to modify.

**Comment style to match:** each function's own doc comment (e.g. lines 240-244) already documents throw-when-missing / not-an-upsert contracts with requirement-ID prefixes (`D-03:`, `DD-04/D-02:`) — add a note referencing D-09's scope ("every SQLite file... including direct-SQL writers") explaining why this wrap was added.

---

### `server.js` (middleware/controller, request-response + error-handling)

**Analog 1 — existing error-middleware chain shape** (lines 157-162, the malformed-JSON handler):
```javascript
// Source: server.js:157-162 (verbatim — the pattern to replicate)
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Malformed JSON in request body.' });
  }
  next(err);
});
```
This is the EXACT shape for the new D-06 central 503 middleware: check a specific error property, respond directly if matched, otherwise `next(err)` to fall through to the final handler.

**Analog 2 — existing final error handler** (lines 6839-6843, verbatim):
```javascript
// Source: server.js:6839-6843
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});
```
The new 503 middleware must be registered BEFORE this final handler (per RESEARCH.md's own placement note) so non-busy errors still fall through to this generic 500. Same discipline: never echo `err.message` — a fixed generic string only (this handler's own comment: "return a generic message without internal details").

**New middleware to add (from RESEARCH.md Code Examples, already verified against installed better-sqlite3):**
```javascript
const Database = require('better-sqlite3');
app.use((err, req, res, next) => {
  if (err instanceof Database.SqliteError && err.code && err.code.startsWith('SQLITE_BUSY')) {
    const retryAfterSeconds = 1; // Claude's Discretion within D-05's ~1s budget
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(503).json({ error: 'Server is busy. Please try again.' });
  }
  next(err);
});
```

**Local try/catch swallow sites to fix (8 found, one verified example):**
```javascript
// Source: server.js:2447-2451 (verbatim — the pattern that must NOT swallow SQLITE_BUSY)
try {
  writeDb(db);
} catch (e) {
  return res.status(500).json({ error: 'Failed to save assessment.' });
}
```
Fix pattern (re-throw guard before the generic catch body):
```javascript
try {
  writeDb(db);
} catch (e) {
  if (e && e.code && e.code.startsWith('SQLITE_BUSY')) throw e; // let it reach the central 503 middleware
  return res.status(500).json({ error: 'Failed to save assessment.' });
}
```
Other candidate sites (grep for `try {` near a `writeDb(`/`controlStore.`/`sessions.` call — 18 total `try {` blocks in server.js per this session's scan; 8 wrap a write call per RESEARCH.md's brace-depth scan): lines near 788, 1139, 1152, 1214, 1801, 2038, 2322, 2450, 5884, 6039 are `res.status(500)` sites to audit individually — not all wrap a write call (some wrap zip/export/RAG failures unrelated to SQLite), so each must be checked for whether it wraps `writeDb()`/`controlStore.*()`/`sessions.*()` before applying the re-throw guard.

**4 async route handlers (Pitfall 2):** must be individually verified for `.catch(next)`/`try{}catch(e){next(e)}` — Express 4 does not auto-forward async rejections. Find via `grep -n "app\.\(post\|put\|patch\|delete\)(.*async"` server.js.

---

### `public/js/transitions.js` (client interceptor, request-response + retry)

**Analog:** itself — the existing `window.fetch` wrapper, lines 13-54

**Full existing pattern to extend (verbatim, lines 13-54):**
```javascript
(function () {
  if (window.__adminAuthWrapped || !window.fetch) return;
  window.__adminAuthWrapped = true;
  const KEY = 'admin_token';
  const origFetch = window.fetch.bind(window);
  const isApi = (url) => {
    try { const u = new URL(url, location.href); return u.origin === location.origin && u.pathname.startsWith('/api/'); }
    catch (e) { return false; }
  };
  // ... withToken(), onLoginPage(), maybePromptForToken() ...
  window.fetch = function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init.method || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
    const tok = localStorage.getItem(KEY);
    if (tok && isApi(url)) init = withToken(init, tok);
    return origFetch(input, init).then((res) => {
      if (res.status !== 401 || !isApi(url)) return res;
      // ... 401 handling ...
    });
  };
})();
```

**Pattern to apply for D-07's silent retry:** the SAME `isApi(url)` helper (lines 18-21) already distinguishes same-origin `/api` calls — reuse it, do not write a second URL-matching helper. Add a `res.status === 503` branch inside the `.then((res) => {...})` chain (parallel to the existing `res.status !== 401` branch at line 44), reading the `Retry-After` header, waiting, and re-calling `origFetch` up to 2-3 times (D-07) before falling through to the give-up toast (D-08). This is a SECOND IIFE-wrapped block in the same file (mirroring how `openPlaybookSlide`'s IIFE, lines 59-149+, sits alongside the auth-bridge IIFE) OR an extension of the SAME `window.fetch` override — prefer extending the SAME override (one `window.fetch` reassignment, not two competing ones) since RESEARCH.md's own diagram warns "a second interceptor elsewhere would race it."

**Give-up toast — build new, do NOT reuse `banners.js` or `dashboard.js`'s `showToast()`** (RESEARCH.md Pitfall 6, verified this session: `banners.js` is a CMS-fetched page-banner system, `dashboard.js`'s `showToast()` at line 945 is page-scoped, not on `window`, not loaded app-wide). Style reference only (not to be imported/called) — `public/js/dashboard.js:945-965`:
```javascript
// Source: public/js/dashboard.js:945-965 (style reference ONLY — do not call this
// function; build a small new equivalent directly in transitions.js since
// dashboard.js's showToast() is page-scoped and not exposed on window)
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '2rem';
  toast.style.right = '2rem';
  // ... inline styles, then appendChild + timed removal ...
}
```
Build the new toast helper directly inside `transitions.js` (the one file loaded on every page, per RESEARCH.md) — a small `document.createElement('div')` + inline-style + auto-dismiss pattern, matching this project's convention of inline styles for dynamically-created DOM (also seen in the `playbook-modal-overlay` IIFE in the same file, lines 65-79, though that uses CSS classes not inline styles — either is acceptable, inline styles match `dashboard.js`'s toast more closely).

**IIFE-wrap + explicit global convention (CLAUDE.md-level project rule):** all new client code must stay IIFE-wrapped with intentional `window.*` globals only where needed — this file's existing two IIFEs (lines 13-54, 59+) are the pattern to follow exactly.

---

### `test/concurrency-busy-retry.test.js` (new — D-12a fast multi-process test)

**Analog 1 — structural shape:** `test/concurrent-write.test.js` (full file, 109 lines) — same `tempDbPath()`/`cleanupDbFile()` helper pair (lines 27-35), same `node:test`/`node:assert` bare imports, same try/finally cleanup discipline.

```javascript
// Source: test/concurrent-write.test.js:27-35 (verbatim helper pair to reuse/extend)
function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-concurrent-write-test-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}
```

**Analog 2 — CRITICAL deviation required (RESEARCH.md Pattern 2 / Pitfall 3):** `test/concurrent-write.test.js`'s existing tests simulate "concurrent" writers IN-PROCESS (two sequential `store.readDb()`/`store.writeDb()` calls, same connection cache) — this does NOT reproduce real cross-process contention and must NOT be copied for the busy-wait proof itself. The new test MUST spawn real `node:child_process` instances per RESEARCH.md's verified working pattern:
```javascript
// Pattern verified working this session (RESEARCH.md Code Examples) — spawn REAL
// child processes, each requiring db/store.js directly and calling writeDb()
// against the SAME shared file path passed as argv. Do NOT simulate the second
// writer with Promises/timers in one process (deadlocks — RESEARCH.md Pitfall 3).
const { spawn } = require('node:child_process');
```
Reuse `tempDbPath()`/`cleanupDbFile()` from `test/concurrent-write.test.js` for setup/teardown of the shared file, but replace the in-process double-`writeDb()`-call body with spawned children.

---

### `test/busy-503-contract.test.js` (new — D-06 coverage gate)

**Analog:** `test/write-validation-coverage.test.js` (full file, 25 lines) — exact structural template:
```javascript
// Source: test/write-validation-coverage.test.js (verbatim — the template to mirror)
const test = require('node:test');
const assert = require('node:assert');
const app = require('../server.js');
const { findUnvalidatedWriteRoutes } = require('../validators/index.js');

test('write-validation-coverage (VAL-01): every registered write route resolves to a schema', () => {
  const unvalidated = findUnvalidatedWriteRoutes(app);
  assert.deepStrictEqual(unvalidated, [], /* ... */);
});
```
Mirror this exactly: `require('../server.js')` for the live route inventory (`app._router.stack`), enumerate every registered write route (`POST`/`PUT`/`PATCH`/`DELETE`), and — per RESEARCH.md's Wave-0-gap note — stub/mock the write layer to synthetically throw a `SqliteError('database is locked', 'SQLITE_BUSY')` for each route, asserting every one responds 503 + `Retry-After`, never a swallowed 500. This needs a runtime stub (not a static schema-registry check like `write-validation-coverage.test.js`'s `findUnvalidatedWriteRoutes`) — the coverage MECHANISM (route enumeration via `app._router.stack`, deepStrictEqual against an empty violations array) is what to copy; the CHECK BODY (route enumeration → synthetic throw → assert 503) is new.

---

### `scripts/soak.js` (new — D-12b/D-13/D-14 standalone harness)

**Analog 1 — env-var override pattern (verified precedent):**
```javascript
// Source: test/audit-log.test.js:24-33 (verbatim — the env-override pattern to reuse)
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-audit-log-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
```
Set these BEFORE any `require('../db/dbFiles.js')` (module-load-time consts) and pass the SAME env object into each spawned child's `env` option — so the soak run never dirties the live committed `data/demo.db`/`data/control.db`.

**Analog 2 — HTTP-driving pattern:**
```javascript
// Source: test/role-enforcement.test.js — established shape (app.listen(0) + native fetch)
const server = app.listen(0);
const port = server.address().port;
const res = await fetch(`http://127.0.0.1:${port}/api/...`, { method: 'POST', /* ... */ });
```
The soak harness itself must go further than this in-process pattern — it needs `spawn('node', ['server.js'], { env: {...} })` for REAL separate OS processes (server.js already reads `process.env.PORT || 3000`), then drive each with native `fetch` the same way `role-enforcement.test.js` drives its in-process `app.listen(0)`.

**No existing script/ directory precedent** — this is genuinely new territory (RESEARCH.md Wave 0 gap). Compose from the two analogs above: env-override setup (audit-log.test.js) + child-process spawning (concurrency-busy-retry.test.js's own new pattern) + fetch-driving (role-enforcement.test.js). Support D-14's configurable process-count/duration/write-rate via env vars or CLI flags — no existing config-flag precedent in this repo's `scripts/` directory (check `scripts/*.js` for any CLI-arg parsing convention before inventing one; none was found this session, so plain `process.argv`/`process.env` parsing is acceptable).

---

### `package.json` (config)

**Analog:** itself — `scripts` block, lines 6-10:
```json
"scripts": {
  "start": "node server.js",
  "dev": "(sleep 1 && open http://localhost:3000) & node server.js",
  "test": "node --test"
},
```
Add: `"soak": "node scripts/soak.js"` — one new key, same flat shape, no build tooling involved (matches project's no-bundler convention).

## Shared Patterns

### Central error-middleware chain (Express, sync-error-forwarding)
**Source:** `server.js:157-162` (malformed-JSON handler) and `server.js:6839-6843` (final 500 handler)
**Apply to:** the new D-06 503 middleware — same `app.use((err, req, res, next) => {...})` four-arg signature, same "check a specific condition, respond or `next(err)`" shape, registered between the two existing handlers (after route registration, before the final generic handler).
```javascript
app.use((err, req, res, next) => {
  if (/* specific condition */) {
    return res.status(/* code */).json({ error: /* fixed generic string, never err.message */ });
  }
  next(err);
});
```

### `.immediate` transaction-variant change (better-sqlite3)
**Source:** `node_modules/better-sqlite3/lib/methods/transaction.js` (verified this session) — applies identically to `db/store.js` `writeDb()` and `db/auditHook.js` `writeAuditBatch()`, and (wrapped fresh) to `db/controlStore.js`'s 5 read-modify-write functions.
```javascript
const applyWrite = conn.transaction((payload) => { /* unchanged body */ }).immediate;
applyWrite(data);
```

### No-swallow error propagation (audit + write path)
**Source:** `db/store.js` header comment (lines 24-32) and `db/auditHook.js` header comment (lines 22-32) — both already document "never swallow, let it propagate" contracts for the pre-existing audit no-swallow rule (D-11/D-09 Phase 3). D-10 (this phase) extends the SAME discipline to contention errors: no new try/catch anywhere in the storage layer should convert a `SQLITE_BUSY` into anything other than a clean throw that reaches `server.js`'s central middleware.

### `err.code` detection, never `err.message` string-matching
**Source:** RESEARCH.md "Don't Hand-Roll" table — `SqliteError.code` (e.g. `'SQLITE_BUSY'`, `'SQLITE_BUSY_SNAPSHOT'`) is the stable check; use `err.code && err.code.startsWith('SQLITE_BUSY')` everywhere a busy-detection branch is needed (the central middleware AND every re-throw guard in `server.js`'s local try/catch fixes) — never parse `err.message`.

### IIFE-wrapped client modules with explicit `window.*` globals
**Source:** `public/js/transitions.js:13-54` (existing convention, also this project's CLAUDE.md convention) — every new client-side addition in `transitions.js` stays inside an IIFE; anything that must be reachable elsewhere is an explicit `window.foo = foo` assignment (see `window.openPlaybookSlide = openPlaybookSlide` at line 85), never an implicit global.

## No Analog Found

None — every file in scope either has a direct in-place self-analog (the file being modified already establishes the pattern it needs to extend) or a strong existing in-repo precedent identified above. `scripts/soak.js` has no single direct analog (genuinely new territory per RESEARCH.md) but is fully composable from three existing precedents documented above — not a gap requiring RESEARCH.md fallback beyond what's already cited there.

## Metadata

**Analog search scope:** `db/*.js`, `server.js`, `public/js/transitions.js`, `public/js/banners.js`, `public/js/dashboard.js`, `test/*.js`, `package.json`
**Files scanned:** `db/dbFiles.js`, `db/store.js`, `db/auditHook.js`, `db/controlStore.js`, `db/sessions.js`, `server.js` (targeted greps + 2 line ranges), `public/js/transitions.js` (first 100 lines), `public/js/dashboard.js` (showToast excerpt), `test/concurrent-write.test.js`, `test/write-validation-coverage.test.js`, `test/audit-log.test.js` (header), `test/role-enforcement.test.js` (header), `package.json`
**Pattern extraction date:** 2026-08-10
