# Phase 3: Deal Isolation, Audit Log & Write Validation - Pattern Map

**Mapped:** 2026-08-01
**Files analyzed:** 15 (new/modified, per CONTEXT.md + RESEARCH.md `Recommended Project Structure`)
**Analogs found:** 12 / 15 (3 fully greenfield, flagged in "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `db/resolver.js` | middleware | request-response | `server.js` consolidated `/api` gate (lines 268-308) | role-match (new file, but the target pattern to extend) |
| `db/store.js` (modify: ALS binding + audit hook) | service/store | CRUD | `db/store.js` itself (`requireDb`/`writeDb`, lines 92-226) | exact (in-place extension) |
| `db/control-schema.sql` | config/migration | CRUD | `db/schema.sql` (lines 1-307) | exact |
| `db/audit-schema.sql` | config/migration | event-driven | `db/schema.sql` `sessions` table block (lines 285-307) | role-match (append-only, non-ARRAY_COLLECTIONS table) |
| `db/auditHook.js` | service | event-driven | `db/sessions.js` (whole file, direct-SQL sibling module pattern) | role-match |
| `db/dealRegistry.js` (deal/member CRUD in control.db) | service | CRUD | `db/sessions.js` (direct-SQL sibling module using shared connection) | role-match |
| `validators/deals.js` | utility/validation | request-response | none (greenfield — no validation module exists yet) | no analog (RESEARCH.md `Code Examples` is the reference) |
| `validators/<resource>.js` (~10-15 files, one per resource group) | utility/validation | request-response | none | no analog |
| `lib/sanitizeHtml.js` | utility | transform | `public/js/page-layout.js` `sanitize()` (lines 10-19) | exact (server-side port of existing client-side function) |
| `scripts/split-db-into-control-demo-deals.js` | migration | batch | `scripts/migrate-db-json-to-sqlite.js` (whole file) | exact |
| `server.js` (modify: resolver mount, DEMO_ONLY_PREFIXES, validate-middleware wiring, deal routes) | route/controller | request-response | `server.js` `/api` gate + `ROLE_WRITE_POLICY` (lines 157-308) and `app.post('/api/departments', ...)` (lines 1038-1059) | exact |
| `server.js` — new `/api/deals` routes (D-02/D-03/D-04) | controller | CRUD | `app.post('/api/departments', ...)` / `app.delete('/api/departments/:id', ...)` (lines 1038-1066) | exact |
| `server.js` — `/api/admin/audit` viewer route (D-10) | controller | request-response | `app.get('/api/processes', ...)` (line 1075) + `/api/admin/*` prefix gating (line 216) | role-match |
| `public/js/admin.js` / `admin.html` — Audit viewer tab | component | request-response | Admin console existing CMS tabs (Departments/Processes tabs referenced in server.js comments) | role-match (not read in full this pass — tab-pattern is well-established, see Shared Patterns) |
| `public/js/*` — deal switcher (D-04) | component | request-response | `public/js/transitions.js` sidebar/role-gated nav pattern | role-match |
| `test/deal-resolver.test.js`, `test/deal-isolation.test.js`, `test/demo-only-gating.test.js`, `test/audit-log.test.js`, `test/write-validation.test.js`, `test/xss-sanitization.test.js` | test | integration | `test/concurrent-write.test.js` (whole file) + `test/migration-roundtrip.test.js` | exact |

## Pattern Assignments

### `db/resolver.js` (middleware, request-response)

**Analog:** `server.js` lines 150-308 (the consolidated `/api` gate) — this is the mount point resolver.js plugs into, not a separate file to copy wholesale; RESEARCH.md's own diagram (`## Architecture Patterns` step [2]) places the new resolver middleware immediately after `req.portalUser` is set and before `ROLE_WRITE_POLICY`.

**Existing gate shape to extend** (server.js lines 268-308):
```javascript
app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  if (isOpenMode(req)) { req.portalUser = null; return next(); }
  const suppliedToken = req.get('X-Admin-Token') || '';
  if (ADMIN_TOKEN && suppliedToken && timingSafeEqualStr(suppliedToken, ADMIN_TOKEN)) {
    req.portalUser = { username: 'admin-token', role: 'admin', sessionId: null };
  } else {
    const cookieToken = readSessionCookie(req);
    const sess = cookieToken ? sessions.findSession(getConnection(), cookieToken) : null;
    if (!sess) return res.status(401).json({ error: 'Login required.', authRequired: true });
    req.portalUser = sess;
  }
  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  const fullPath = req.baseUrl + req.path;
  const requiresRoleCheck = isWrite || pathMatchesPrefix(fullPath, '/api/admin');
  if (requiresRoleCheck && !roleAllowedForWrite(req.portalUser.role, fullPath, req.method)) {
    return res.status(403).json({ error: 'Your role cannot perform this action.' });
  }
  next();
});
```
**Insertion point for the new deal-resolver middleware:** immediately after `req.portalUser` is set (after the `else` block, before the `isWrite`/`ROLE_WRITE_POLICY` check) — so `req.portalUser.role === 'admin'` bypass and `req.isDemo` are both available to `ROLE_WRITE_POLICY`/`DEMO_ONLY_PREFIXES` checks that follow.

**`isOpenMode` extension point (D-03 seam)** — server.js lines 157-166, already carries a forward-comment naming exactly this phase's obligation:
```javascript
function isOpenMode(req) {
  return process.env.DEMO_OPEN === '1';
}
// comment at line 158-163: "Kept as a named function... specifically so
// Phase 3's deal-resolver can extend it to
// `process.env.DEMO_OPEN === '1' && req.isDemo` (D-03) so a real-deal
// database is NEVER open regardless of this flag"
```
Copy this exact extension: `return process.env.DEMO_OPEN === '1' && req.isDemo;` — but `req.isDemo` must be set by the resolver BEFORE `isOpenMode()` is called, which means the resolver's demo/deal/control classification has to run earlier than line 271's `isOpenMode(req)` check, not after. Plan this ordering explicitly — it is a bootstrapping inversion versus the current gate's flow.

**Membership bind-time refusal pattern (D-03, Pitfall 3):** model directly on the existing 401/403 short-circuit style at line 282 (`if (!sess) return res.status(401)...`) and line 304 (`if (requiresRoleCheck && !roleAllowedForWrite(...)) return res.status(403)...`) — refuse to attach a connection with the same early-return shape, never a post-hoc filter.

---

### `db/store.js` (modify — ALS binding + audit hook)

**Analog:** itself. Full file already read (228 lines) — see RESEARCH.md `## Pattern 1` and `## Pattern 3` for the exact diff shape (`requireDb()` gains an `AsyncLocalStorage.getStore()` check; `writeDb()` gains an `actor` param and pushes `auditRows` during the existing `applyWrite` transaction).

**Core pattern to extend — `requireDb()`** (lines 92-95):
```javascript
function requireDb() {
  if (!db) throw new Error('db/store.js: initDb() must be called before readDb()/writeDb()');
  return db;
}
```
becomes (per RESEARCH.md `## Pattern 1`):
```javascript
function requireDb() {
  const scoped = requestDbStorage.getStore();
  if (scoped) return scoped;
  if (!db) throw new Error('db/store.js: initDb() must be called before readDb()/writeDb()');
  return db; // fallback: server startup, migration scripts, existing tests — UNCHANGED
}
```

**Core pattern to extend — `writeDb()` transaction body** (lines 167-226, the exact `beforeMap`/`afterArr`/`insert`/`update`/`del` loop) — RESEARCH.md `## Pattern 3` shows precisely where to push `auditRows.push({ collection: key, id, action, before, after })` inside the existing `afterArr.forEach` and the existing `for (const id of beforeMap.keys())` delete loop. **Do not re-read this file** — the full transaction body is already quoted verbatim above (Read output, lines 167-226) and in RESEARCH.md `## Pattern 3`'s code block.

**Non-enumerable metadata pattern to reuse for `dbKind`/`dealId` context** — mirrors the existing `__snapshot` convention (lines 130-134):
```javascript
Object.defineProperty(out, '__snapshot', { value: snapshot, enumerable: false, configurable: true });
```

---

### `db/control-schema.sql` / `db/audit-schema.sql` (config, CRUD / event-driven)

**Analog:** `db/schema.sql` (full file, 307 lines).

**Blob-per-row table pattern to copy** (repeated 33x in the analog, e.g. lines 15-21):
```sql
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project_id);
```
Use this shape for `control.db`'s `deals` table (per RESEARCH.md Open Question #1: a JSON `data` column holding `{ id, name, targetCompany, members: [...], status, createdBy, createdAt }`, NOT a normalized join table — "no precedent for" one in this codebase).

**Non-ARRAY_COLLECTIONS sibling-table pattern to copy** — `sessions` table (lines 285-307), the exact precedent for a table that is deliberately NOT part of `db/collections.js`'s `ARRAY_COLLECTIONS` inventory and is accessed via direct SQL (not `readDb()`/`writeDb()`):
```sql
-- Phase 2 (Mandatory Auth & Roles): server-side revocable sessions (AUTH-03,
-- D-06). This table is DELIBERATELY NOT part of the id/project_id/seq/data
-- ARRAY_COLLECTIONS inventory above...
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  role        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
```
`audit_log` in `db/audit-schema.sql` should follow this same shape: an explicit-column table (not blob-per-row), append-only (no UPDATE/DELETE statements anywhere in the codebase for it), columns per D-11 (`actor_username`, `actor_role`, `action`, `collection`, `row_id`, `deal_id`, `before_json`, `after_json`, `ts`), with the same top-of-file comment style explaining WHY it's excluded from `ARRAY_COLLECTIONS`.

**IMPORTANT — existing schema.sql comment to respect/update** (lines 9-10): `"Do NOT normalize individual fields into typed columns and do NOT add an audit_log table here — both are explicitly out of scope for this phase (Phase 3/4-5 concerns)."` This comment explicitly anticipates this phase; `audit_log` belongs in the NEW `db/audit-schema.sql`, not appended to `db/schema.sql`.

---

### `db/auditHook.js` / `db/dealRegistry.js` (service, event-driven / CRUD)

**Analog:** `db/sessions.js` (full file, 105 lines) — the established "direct-SQL sibling module, takes the shared connection as first arg, bypasses `readDb()`/`writeDb()`" pattern.

**Imports + module shape pattern** (lines 1-31):
```javascript
const crypto = require('crypto');
function newSessionToken() { return crypto.randomBytes(32).toString('base64url'); }
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
```

**Core write pattern** (lines 39-50, `createSession`) — copy this parameter-passing shape (explicit object destructure, connection as first arg, no implicit global state):
```javascript
function createSession(conn, { username, role, ttlMs, userAgent, ip }) {
  const token = newSessionToken();
  const now = new Date();
  conn.prepare(
    `INSERT INTO sessions (token_hash, username, role, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(/* ... */);
  return token;
}
```
For `auditHook.js`'s `writeAuditBatch(conn, { actor, dealId, rows, ts })`, mirror this exactly but wrap the batch insert in `conn.transaction(...)` the way `db/store.js`'s `applyWrite` does (store.js lines 174-222), since RESEARCH.md `## Pattern 3` specifies a batch transaction, not per-row `.run()` calls.

**Module export pattern** (line 102-105):
```javascript
module.exports = {
  createSession, findSession, deleteSession, deleteAllSessionsForUser, pruneExpiredSessions,
  newSessionToken, hashToken,
};
```

**Doc-comment header pattern to copy** (lines 1-21) — explain WHY the module bypasses `readDb()`/`writeDb()`, matching this codebase's "explain WHY, not WHAT" comment convention (CLAUDE.md `## Comments`).

---

### `validators/deals.js` + `validators/<resource>.js` (utility/validation, request-response)

**No direct in-repo analog** (RESEARCH.md: "zero `sanitize`/schema-validation references in `server.js`"). Use RESEARCH.md `## Code Examples` → "zod schema + safeParse → existing 400 error shape" as the canonical pattern:
```javascript
const { z } = require('zod');
const CreateDealSchema = z.object({
  name: z.string().min(1).max(200),
  targetCompany: z.string().min(1).max(200),
  members: z.array(z.string().min(1)).default([]),
});
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body || {});
    if (!result.success) {
      return res.status(400).json({
        error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
    }
    req.body = result.data;
    next();
  };
}
```
**Existing 400 error shape to match** (server.js line 1049, 1053, 413-414 — verified against real endpoints):
```javascript
return res.status(400).json({ error: 'Department name is required.' });
return res.status(400).json({ error: 'New password must be at least 8 characters.' });
```
The `validateBody()` wrapper's `{ error: '...' }` shape (string, not array) matches this exactly — schemas should derive field constraints (`.max()` lengths, required-ness) from what each existing endpoint's own ad hoc checks already enforce (D-14), e.g. `department.name` required + trimmed (server.js line 1042) becomes `z.string().min(1)` (zod does not auto-trim; keep `.trim()` server-side before validation, or note as a schema-authoring convention for the planner).

---

### `lib/sanitizeHtml.js` (utility, transform)

**Analog:** `public/js/page-layout.js` lines 10-19 (`sanitize()`), already read in full — this is a direct server-side port, not a new algorithm.

**Exact pattern to port:**
```javascript
// public/js/page-layout.js lines 14-19 (client-side original)
const sanitize = (s) => String(s == null ? '' : s)
  .replace(/<\/?(?:script|iframe|object|embed|form|meta|base|link)\b[^>]*>/gi, '')
  .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
  .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
  .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
  .replace(/(=\s*["']?\s*)(?:javascript|vbscript)\s*:/gi, '$1');
```
`lib/sanitizeHtml.js` should export this same function under CommonJS (`module.exports = { sanitizeHtml }`), called from validators for fields a schema tags as HTML-permitted (D-15). Keep the doc-comment style from the original (line 10-13: "Defence-in-depth alongside the CSP; DOMPurify is the recommended robust upgrade") — do not add DOMPurify per RESEARCH.md `## Don't Hand-Roll` recommendation (jsdom dependency weight rejected).

---

### `scripts/split-db-into-control-demo-deals.js` (migration, batch)

**Analog:** `scripts/migrate-db-json-to-sqlite.js` (full file, 185 lines) — explicitly named in CONTEXT.md D-05/D-06 as the precedent ("expected to follow Phase 1's precedent").

**Imports pattern** (lines 21-28):
```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ARRAY_COLLECTIONS, SINGLETON_KEYS } = require('../db/collections');
const store = require('../db/store');
```

**CLI arg-parsing pattern** (lines 30-41, `parseArgs`) — copy verbatim shape for `--source`/`--verify`-style flags (this script will likely need `--source db.json`/`ma-portal.db` plus per-target output paths for `control.db`/`demo.db`/`deals/<id>.db`).

**Atomic write pattern (temp path + rename-on-success)** (lines 62-129) — copy directly: build at `.{basename}.migrating-{timestamp}-{random}.tmp`, only `fs.renameSync` over the real output path on full success, WAL/SHM sidecar rename included, main-file rename failure re-thrown, sidecar failures non-fatal (lines 121-129).

**`--verify` gate pattern** (lines 134-167, `verifyMigration`) — copy the `canonicalize`/`canonicalJSON` key-order-agnostic comparison (lines 43-53) and the row-count + per-item structural-equality double-check loop; this is the exact precedent CONTEXT.md's `D-05`/discretion note calls for ("re-runnable, `--verify` parity gate, archive the source read-only after green").

**Read-only source constraint** (line 7-9, 56-59 comment) — copy the constraint verbatim: "Read-only access to the source — this is the ONLY touch of sourcePath in this entire script," since D-05's migration is similarly one-way/high-stakes (archiving `ma-portal.db` read-only after green, per CONTEXT.md D-05's Reversibility note).

**Key structural difference the planner must account for:** this script fans OUT to multiple output files (`control.db` + `demo.db` + N `deals/<id>.db` seeds) rather than the 1-source-to-1-output shape of the analog — the temp-path-then-rename pattern must be applied independently per output file, and `--verify` must check parity for the UNION of rows across all outputs against the single source (D-05: every row must land in exactly one destination, none dropped, none duplicated).

---

### `server.js` — new `/api/deals` routes (controller, CRUD)

**Analog:** `app.post('/api/departments', ...)` and `app.delete('/api/departments/:id', ...)` (server.js lines 1038-1066), already read in full.

**Create-or-update merge pattern:**
```javascript
app.post('/api/departments', (req, res) => {
  const db = readDb();
  db.departments = db.departments || [];
  const d = req.body || {};
  const nameOk = d.name && String(d.name).trim();
  let stored;
  if (d.id) {
    const i = db.departments.findIndex(x => x.id === d.id);
    if (i > -1) { db.departments[i] = { ...db.departments[i], ...d }; stored = db.departments[i]; }
    else {
      if (!nameOk) return res.status(400).json({ error: 'Department name is required.' });
      db.departments.push(d); stored = d;
    }
  } else {
    if (!nameOk) return res.status(400).json({ error: 'Department name is required.' });
    stored = { locked: true, systems: [], trainings: [], ...d, id: newId('dept') };
    db.departments.push(stored);
  }
  writeDb(db);
  res.json({ success: true, department: stored });
});
```
For `POST /api/deals`: same shape, but writes against `control.db` (via the resolved connection, per ISO-01), gated to `admin`+`hrbp` only per D-02 (add a `{ prefix: '/api/deals', roles: ['admin', 'hrbp'] }` entry to `ROLE_WRITE_POLICY`, following the existing table shape at server.js lines 215-236), and `newId('deal')` per the existing `newId(prefix)` convention (server.js lines 472-474).

**Destructive-guard pattern for delete/archive (D-02 admin-only)** — model on `/api/admin/*` prefix gating (line 216: `{ prefix: '/api/admin', roles: ['admin'] }`) combined with the delete-endpoint shape:
```javascript
app.delete('/api/departments/:id', (req, res) => {
  const db = readDb();
  db.departments = (db.departments || []).filter(x => x.id !== req.params.id);
  writeDb(db);
  res.json({ success: true });
});
```
Route deal delete/archive under an `/api/admin/deals/:id` or equivalent admin-only prefix so it inherits the existing `{ prefix: '/api/admin', roles: ['admin'] }` rule with zero new policy-table entries — consistent with how `migrate-db`/`revoke-sessions` (lines 1599, 1639) already live under `/api/admin/*`.

---

### Test files (integration)

**Analog:** `test/concurrent-write.test.js` (full file, 109 lines) + `test/migration-roundtrip.test.js`.

**Structural pattern to copy** (lines 1-35 of concurrent-write.test.js):
```javascript
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-concurrent-write-test-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}
```
**Fresh-module-per-test pattern** (line 44): `delete require.cache[require.resolve('../db/store.js')]; const store = require('../db/store.js'); store.initDb(dbPath);` — reuse this exact cache-busting idiom for any new test that needs an isolated `db/store.js`/`db/resolver.js` module state per test (relevant for `test/deal-resolver.test.js` binding different sessions to different deal files within one test run).

**Runner/command convention** (RESEARCH.md `Validation Architecture`): `node --test test/<file>.test.js` per new file; `node --test test/` does NOT work on this Node version (per the analog's own header comment, lines 12-14) — always target files explicitly or rely on `npm test`'s `node --test` bare-discovery convention.

## Shared Patterns

### Consolidated `/api` gate extension point
**Source:** `server.js` lines 268-308
**Apply to:** `db/resolver.js` (deal binding), `DEMO_ONLY_PREFIXES` guard (ISO-02), any new admin-only routes
```javascript
app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(req.path)) return next();
  // ... existing portalUser resolution ...
  // NEW: deal-resolver middleware inserted here, before ROLE_WRITE_POLICY check
  // NEW: DEMO_ONLY_PREFIXES.includes(fullPath) && !req.isDemo -> 403, mirroring
  //      the existing requiresRoleCheck/roleAllowedForWrite 403 shape at line 304-306
  next();
});
```

### `ROLE_WRITE_POLICY` boundary-safe prefix table
**Source:** `server.js` lines 211-248 (`pathMatchesPrefix`, `ROLE_WRITE_POLICY`, `roleAllowedForWrite`)
**Apply to:** `/api/deals` write-tier entries (D-02), and — per RESEARCH.md Anti-Patterns — `DEMO_ONLY_PREFIXES` should be built as a sibling array in the exact same shape (`{ prefix, ... }` entries + a `pathMatchesPrefix`-based lookup function), never scattered per-handler `if` checks.
```javascript
function pathMatchesPrefix(path, prefix) {
  return path === prefix || path.startsWith(prefix + '/');
}
const ROLE_WRITE_POLICY = [
  { prefix: '/api/admin', roles: ['admin'] },
  { prefix: '/api/deals', roles: ['admin', 'hrbp'] }, // NEW, D-02 — creation tier
  // ...
];
```

### 400 validation error response shape
**Source:** `server.js` lines 413-414, 1049, 1053, 1090, 1094 (every existing ad hoc validation check in the codebase)
**Apply to:** every `validators/<resource>.js` module's `validateBody()` middleware
```javascript
return res.status(400).json({ error: 'Department name is required.' });
```
zod's `safeParse` failure path must collapse to this exact `{ error: '<string>' }` shape (RESEARCH.md's `validateBody` example already does this via `.join('; ')`), not zod's native `{ error: { issues: [...] } }` object shape, so the existing frontend fetch error-handling (which reads `.error` as a display string) keeps working unchanged.

### Atomic file write (temp + rename)
**Source:** `scripts/migrate-db-json-to-sqlite.js` lines 62-129, and `db/store.js`'s WAL/pragma setup (lines 75-90)
**Apply to:** `scripts/split-db-into-control-demo-deals.js` (all new `.db` outputs), any new connection-cache `getOrOpenConnection()` in `db/resolver.js` (RESEARCH.md `## Pattern 2` — same pragma set: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, `busy_timeout = 5000`)
```javascript
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
```

### Attributed-actor pattern (never anonymous)
**Source:** `server.js` lines 273-278 (X-Admin-Token → `{ username: 'admin-token', role: 'admin', sessionId: null }`) — D-11's precedent already exists in code
**Apply to:** `db/auditHook.js`'s `actor` parameter — every write to a `deals/<id>.db` or control-plane security event must carry a non-null, non-anonymous actor object of this exact `{ username, role, sessionId }` shape, sourced from `req.portalUser` (session) or the admin-token identity, never synthesized/defaulted inside the hook itself.

### Doc-comment header convention (explain WHY, not WHAT)
**Source:** every existing `db/*.js` file's header block (e.g. `db/store.js` lines 1-26, `db/sessions.js` lines 1-21, `db/collections.js` lines 1-13)
**Apply to:** all 6+ new `db/` and `validators/` files — open with a comment block naming the requirement ID(s) it closes (ISO-01, AUD-01, VAL-01, etc.), the design tradeoff made, and why the alternative (SQLite triggers, ATTACH, a new sanitization dependency) was rejected — matching this codebase's established self-documenting convention.

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `validators/*.js` (all ~10-15 zod schema modules) | utility/validation | request-response | Zero schema-validation code exists anywhere in the repo today (RESEARCH.md: "zero `sanitize`/schema-validation references in `server.js`") — use RESEARCH.md `## Code Examples` (`z.object()` + `safeParse`) as the sole reference, not an in-repo analog |
| `db/auditHook.js` (the audit-capture mechanism specifically, as distinct from `db/sessions.js`'s general "sibling module" shape) | service | event-driven | No audit/logging table or write-interception hook exists in the codebase at all — `db/sessions.js` supplies the module-shape convention (connection-as-first-arg, direct SQL) but not the before/after-diff-capture logic itself, which is fully specified in RESEARCH.md `## Pattern 3` |
| Admin console "Audit viewer" tab UI (D-10) | component | request-response | Not read in this pass (admin.js/admin-cms.js were not opened — CLAUDE.md's Component Responsibilities table names them but this pattern-mapping pass stayed within the 3-5 analog budget); planner/executor should Read `public/js/admin.js`'s existing tab-registration pattern directly when this file is scheduled, rather than relying on this document's characterization |

## Metadata

**Analog search scope:** `db/`, `scripts/`, `test/`, `public/js/page-layout.js`, `server.js` (auth gate + representative CRUD endpoints)
**Files scanned:** `db/store.js`, `db/sessions.js`, `db/collections.js`, `db/schema.sql`, `scripts/migrate-db-json-to-sqlite.js`, `public/js/page-layout.js` (partial), `server.js` (auth gate lines 150-480, department/process CRUD lines 1038-1102), `test/concurrent-write.test.js` (partial)
**Pattern extraction date:** 2026-08-01
