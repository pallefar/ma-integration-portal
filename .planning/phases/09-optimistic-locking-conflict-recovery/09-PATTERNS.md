# Phase 9: Optimistic Locking & Conflict Recovery - Pattern Map

**Mapped:** 2026-08-11
**Files analyzed:** ~10 (modified, no wholly new module files except tests + shared client dialog)
**Analogs found:** 10/10 (every file in scope has a strong in-repo analog — this phase is additive to Phase 8's own precedents)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `db/store.js` (`writeDb()` UPDATE/DELETE statements + version stamping) | model / storage | CRUD (transactional write) | Same file's own pre-existing snapshot-diff merge + `AUD-01`/CR-01 audit-append-inside-txn block | exact (self-extension) |
| `db/collections.js` (new `VERSIONED_COLLECTIONS` set) | config | N/A (static gating set) | `db/auditHook.js` `AUDITED_DB_KINDS` set | exact |
| `server.js` — ~18 upsert routes (`POST /api/raid`, `/api/integration-tasks`, `/api/synergies`, `/api/dd/findings`, `/api/dd/request-items`, `/api/org/positions`, `/api/org/flight-risk`) | route / controller | request-response (field-patch upsert) | `POST /api/raid` (server.js:4208-4249) | exact |
| `server.js` — ~7 DELETE routes (`DELETE /api/raid/:id` etc.) | route / controller | request-response (delete) | `DELETE /api/raid/:id` (server.js:5784-5792) | exact |
| `server.js` — new 409 central error middleware | middleware | request-response (error mapping) | existing 503 central middleware (server.js:6909-6938, `isBusyError` sibling) | exact |
| `validators/workstream.js`, `validators/dd.js`, `validators/org.js` (add `version` field to ~8 Upsert schemas) | validation | request-response (schema) | `RaidUpsertSchema` (validators/workstream.js:310-327) | exact |
| `public/js/transitions.js` (new 409 branch in `attemptFetch`) | client / fetch-wrapper | event-driven (interception) | Same file's existing 503 retry branch + 401 branch (transitions.js:136-156) | exact |
| `public/js/[shared-conflict-dialog].js` (new) | component / provider | event-driven (modal render) | `showBusyGiveUpToast()` (transitions.js:56-91) — the only reusable native-DOM UI construction precedent in a shared, page-agnostic file | role-match (toast, not modal, but same textContent/native-DOM discipline) |
| `test/optimistic-locking-contract.test.js` (new) | test | structural + integration | `test/busy-503-contract.test.js` (431 lines, 4-part recipe) | exact |
| `test/optimistic-locking-cross-process.test.js` (new) | test | event-driven (spawned processes) | `test/concurrency-busy-retry.test.js` | exact |
| `test/client-conflict-dialog.test.js` (new) | test | client-side (node:vm sandbox) | `test/client-busy-retry.test.js` | exact |

## Pattern Assignments

### `db/store.js` — `writeDb()` version enforcement (model, CRUD)

**Analog:** same file, `writeDb()`'s existing snapshot-diff merge (lines ~326-370) and the CR-01 audit-append-inside-transaction block (~lines 400-430).

**Core pattern — per-collection loop, gated by a named set** (lines 326-370, current unconditional shape):
```javascript
const applyWrite = conn.transaction((payload) => {
  for (const key of ARRAY_COLLECTIONS) {
    const beforeMap = before[key] || new Map();
    ...
    const update = conn.prepare(
      `UPDATE ${key} SET project_id = ?, seq = ?, data = ? WHERE id = ?`
    );
    ...
    update.run(projectIdOf(item), i, serialized, id);
    // Phase 9: when key is in VERSIONED_COLLECTIONS, this UPDATE statement
    // gains a version-aware WHERE clause (see Code Example below) and
    // `changes === 0` while the row still exists must THROW a typed
    // conflict, mirroring the D-11 actor-check throw immediately below
    // this loop (verified pattern: throw INSIDE the transaction body so
    // conn.transaction() rolls back everything this call did).
  }
```

**Throw-on-conflict precedent to imitate** (verbatim existing pattern, lines ~410-430):
```javascript
if (deltas && deltas.length) {
  const actor = scoped.actor;
  if (!actor || !actor.username) {
    // D-11: never synthesize an actor here — an audited write reaching
    // this point with no resolved identity is a bug in the caller...
    throw new Error(
      `db/store.js: writeDb() resolved an audited context (kind=${auditKind}) with no attributed actor — refusing to write an anonymous audit row (D-11)`
    );
  }
```
Use the identical shape for a version conflict: throw a typed error (e.g. `err.isConflict = true; err.conflictDetail = {...}`) from inside `conn.transaction(...)`'s body, before it returns, so better-sqlite3 rolls back the whole `.immediate` transaction — never a partial commit (Pitfall 6).

**Verified WHERE-clause mechanic** (hands-on tested against installed `better-sqlite3@13.0.1`, from 09-RESEARCH.md):
```javascript
const upd = db.prepare(
  "UPDATE t SET data=? WHERE id=? AND (json_extract(data,'$.version') IS NULL OR json_extract(data,'$.version') = ?)"
);
upd.run(JSON.stringify({ id: 'a', version: 4, name: 'y' }), 'a', 3).changes; // 1 — matched
upd.run(JSON.stringify({ id: 'a', version: 5, name: 'z' }), 'a', 3).changes; // 0 — stale, rejected
```

**No-swallow contract to preserve** (comment directly above `applyWrite`, lines ~318-325):
```javascript
// No try/catch is added around applyWrite(data) below — a SqliteError
// (including SQLITE_BUSY*) must propagate uncaught through writeDb()'s
// existing no-swallow contract so it reaches server.js's central 503 error
// middleware (D-06).
```
The new conflict-throw must follow the same discipline: propagate uncaught to a NEW central 409 middleware, never caught/logged-and-swallowed inside `writeDb()` itself.

---

### `db/collections.js` — `VERSIONED_COLLECTIONS` set (config)

**Analog:** `db/auditHook.js:55`

```javascript
// db/auditHook.js:55 — the exact shape to mirror
const AUDITED_DB_KINDS = new Set(['deal', 'control']);
```

Phase 9's analog is collection-level, not kind-level, and must include BOTH lanes of every demo/custom-split collection (Pitfall 7):
```javascript
const VERSIONED_COLLECTIONS = new Set([
  'raidEntries', 'customRaidEntries',
  'integrationTasks', 'customIntegrationTasks',
  'synergyInitiatives', 'customSynergyInitiatives',
  'ddFindings', 'ddRequestItems',
  'orgPositions', 'orgFlightRisks',
  // orgDecisions deliberately excluded — append-only, no update/delete route (Pitfall 8)
]);
```

---

### `server.js` upsert routes (controller, request-response) — e.g. `POST /api/raid`

**Analog:** `POST /api/raid` (server.js:4208-4249), the representative field-patch upsert.

**Full existing pattern to extend** (lines 4208-4232):
```javascript
app.post('/api/raid', (req, res) => {
  const b = req.body || {};
  const db = readDb();
  const lane = raidLane(db);
  if (b.id) {
    const item = lane.find(r => r.id === b.id);
    if (!item) return res.status(404).json({ error: 'Entry not found.' });
    if (b.title !== undefined && !String(b.title).trim()) {
      return res.status(400).json({ error: 'Entry title cannot be empty.' });
    }
    ['title', 'owner', 'workstreamId', 'notes'].forEach(k => { if (b[k] !== undefined) item[k] = String(b[k] || '').slice(0, 300); });
    if (b.type !== undefined && RAID_TYPES.includes(b.type)) item.type = b.type;
    if (b.severity !== undefined && RAID_LEVELS.includes(b.severity)) item.severity = b.severity;
    if (b.probability !== undefined && RAID_LEVELS.includes(b.probability)) item.probability = b.probability;
    if (b.status !== undefined) item.status = b.status;
    writeDb(db);
    return res.json({ success: true, entry: item });
  }
  ...
```
Phase 9 inserts a fast-path precondition check right after `if (!item) return res.status(404)...` and before the `if (b.title !== undefined...)` validation:
```javascript
if (item.version !== undefined && b.version !== undefined && b.version !== item.version) {
  return res409Conflict(res, item, /* changedBy/changedAt from item.updatedBy/updatedAt */);
}
```
The mutation lines (`['title','owner',...].forEach`) are the exact reference for D-03/Pitfall 12's "fields the user changed = keys present in the request body" rule — the conflict dialog can reuse the same field list this route already treats as mutable.

**404 vs 409 precedent** — `res.status(404).json({ error: 'Entry not found.' })` is the existing not-found shape; keep it structurally distinct from the new `res.status(409).json({ conflict: true, ... })` shape (Pitfall 1: two unrelated pre-existing 409s already exist elsewhere in server.js, e.g. line 6043 and line 3984 — the new conflict body's `conflict: true` marker is what the client discriminates on, never status code alone).

---

### `server.js` DELETE routes (controller, request-response) — e.g. `DELETE /api/raid/:id`

**Analog:** `DELETE /api/raid/:id` (server.js:5784-5792) — full text:
```javascript
app.delete('/api/raid/:id', (req, res) => {
  const db = readDb();
  const lane = raidLane(db);
  const filtered = lane.filter(r => r.id !== req.params.id);
  if (filtered.length === lane.length) return res.status(404).json({ error: 'Entry not found.' });
  if (db.settings && db.settings.demoMode === false) db.customRaidEntries = filtered;
  else db.raidEntries = filtered;
  writeDb(db);
  res.json({ success: true });
});
```
Per Pitfall 3, this route reads NO body/query today. D-08 requires a version precondition on delete — the recommended shape (Claude's Discretion, flagged as assumption A1 in research) is a query param:
```javascript
app.delete('/api/raid/:id', (req, res) => {
  const db = readDb();
  const lane = raidLane(db);
  const existing = lane.find(r => r.id === req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entry not found.' });
  const expected = req.query.expectedVersion !== undefined ? Number(req.query.expectedVersion) : undefined;
  if (existing.version !== undefined && expected !== undefined && expected !== existing.version) {
    return res409Conflict(res, existing, ...);
  }
  ...
```
Also update every matching client DELETE call site (see `public/js/execution.js:1038`, `fetch('/api/raid/' + id, { method: 'DELETE' })` — no body today, must append `?expectedVersion=N`).

---

### `server.js` — new 409 central error middleware (middleware, request-response)

**Analog:** existing 503 central middleware (server.js:6909-6938) — full text:
```javascript
app.use((err, req, res, next) => {
  if (isBusyError(err)) {
    if (res.headersSent) return next(err);
    const retryAfterSeconds = 1;
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(503).json({ error: 'Server is busy. Please try again.' });
  }
  next(err);
});
```
Mount a direct sibling immediately beside it, checking a distinguishing typed-error property (`err.isConflict`), mirroring `isBusyError(err)`'s discrimination-by-SqliteError-code pattern:
```javascript
app.use((err, req, res, next) => {
  if (isConflictError(err)) {
    if (res.headersSent) return next(err);
    return res.status(409).json({
      conflict: true,
      currentRecord: err.conflictDetail.currentRecord,
      currentVersion: err.conflictDetail.currentVersion,
      changedBy: err.conflictDetail.changedBy,
      changedAt: err.conflictDetail.changedAt,
    });
  }
  next(err);
});
```
`isBusyError` is exported at `module.exports.isBusyError = isBusyError;` (server.js:6992) — export `isConflictError` the same way if any other module needs it.

---

### `validators/*.js` — add `version` field to Upsert schemas (validation)

**Analog:** `RaidUpsertSchema` (validators/workstream.js:310-327):
```javascript
const RaidUpsertSchema = z.object({
  id: z.string().trim().min(1).max(ID_MAX).optional(),
  title: z.string().trim().min(1, 'Entry title is required.').max(NAME_MAX).optional(),
  type: z.enum(RAID_TYPES).optional(),
  severity: z.enum(RAID_LEVELS).optional(),
  probability: z.enum(RAID_LEVELS).optional(),
  owner: z.string().trim().max(NAME_MAX).optional(),
  workstreamId: z.string().trim().max(60).optional(),
  status: z.enum(RAID_STATUSES).optional(),
  notes: z.string().trim().max(TEXT_MAX).optional(),
  source: z.string().trim().max(160).optional(),
}).refine((data) => data.id || (data.title && data.title.trim()), {
  message: 'Entry title is required.',
  path: ['title'],
});
registerSchema('POST', '/api/raid', RaidUpsertSchema);
registerSchema('DELETE', '/api/raid/:id', EmptyBodySchema);
```
Per Pitfall 2 (zod v4 strips unknown keys by default, verified `validators/index.js:8-10`), add explicitly to every in-scope schema:
```javascript
version: z.number().int().nonnegative().optional(),
```
DELETE schemas currently register `EmptyBodySchema` (`z.object({})`); if the version travels as a query param (not body), `EmptyBodySchema` may not need a change — but if planner chooses query-string validation, add a matching query schema instead.

---

### `public/js/transitions.js` — 409 branch in `attemptFetch` (client, event-driven)

**Analog:** same function's existing 503 branch and 401 branch (transitions.js:136-156), full text:
```javascript
const attemptFetch = (input, init, url, method, attempt) => origFetch(input, init).then((res) => {
  if (res.status === 503 && isApi(url)) {
    if (attempt < BUSY_RETRY_MAX_RETRIES && isRetryableBody(input, init)) {
      const wait = parseRetryAfterMs(res) + Math.floor(Math.random() * BUSY_RETRY_JITTER_MAX_MS);
      return delay(wait).then(() => attemptFetch(input, init, url, method, attempt + 1));
    }
    showBusyGiveUpToast();
    return res;
  }
  if (res.status !== 401 || !isApi(url)) return res;
  return res.clone().json().then((body) => {
    if (body && body.authRequired) {
      if (!onLoginPage()) window.location.href = '/login.html';
      return res;
    }
    return maybePromptForToken(res, input, init, method);
  }).catch(() => maybePromptForToken(res, input, init, method));
});
```
Add a NEW branch structurally between the 503 branch and the 401 branch, using `res.clone().json()` exactly like the 401 branch does (never `res.json()` directly — the original response must still be returned to the caller), and gated on the `conflict: true` marker (Pitfall 1) not status code alone:
```javascript
if (res.status === 409 && isApi(url)) {
  return res.clone().json().then((body) => {
    if (body && body.conflict === true) {
      renderConflictDialog(body, input, init); // NEVER re-fires attemptFetch automatically (D-05/Pitfall 11)
      return res;
    }
    return res; // pre-existing unrelated 409 (Pitfall 1) — pass through unchanged
  }).catch(() => res);
}
```
**Critical constraint (D-05/Pitfall 11):** unlike the 503 branch, this must NEVER call `delay(...).then(() => attemptFetch(...))` — the only re-fire path is the user clicking "Apply my changes anyway" inside the dialog, which constructs its own fresh `fetch()` call.

---

### `public/js/[shared-conflict-dialog].js` (new) — component, event-driven

**Analog:** `showBusyGiveUpToast()` (transitions.js:56-91) — the only precedent in this codebase for constructing native-DOM UI from a shared, page-agnostic client file:
```javascript
const toast = document.createElement('div');
toast.style.position = 'fixed';
...
toast.textContent = BUSY_GIVE_UP_MESSAGE; // textContent, never innerHTML — house XSS rule
document.body.appendChild(toast);
```
The conflict dialog (per 09-CONTEXT.md UI decisions, D-03) is a `.deal-modal`-shell-based dialog (per the phase's UI-SPEC decisions — reuses `.deal-modal` shell class, orange only on the Apply-CTA and the "mine" border, copy hardcoded EN via `textContent` never `data-i18n`). Follow the SAME textContent-only discipline as the toast above; no markup assignment anywhere in the dialog's field-diff rendering (Pitfall 12: intersect `Object.keys(JSON.parse(init.body))` against `body.currentRecord` to render only the fields the user actually touched).

---

### `test/optimistic-locking-contract.test.js` (new) — coverage gate

**Analog:** `test/busy-503-contract.test.js` (431 lines) — 4-part recipe, structural scan excerpt (lines 1-60):
```javascript
// Part 1: structural coverage — scanned from the LIVE server.js source text,
// not a hand-maintained list of line numbers or route paths.
const STORAGE_CALL_RE = /\b(writeDb\(|controlStore\.|sessions\.|dealSeed\.|createDealDatabase\(|recordSecurityEvent\()/;

function braceMatch(src, openIdx) { ... } // character-index brace matching used to isolate each route handler body for the scan
```
Mirror the same shape: (1) structural scan of server.js's live source to assert every `VERSIONED_COLLECTIONS`-listed route has a version-check branch before its `writeDb(` call, (2) live route inventory cross-check against `VERSIONED_COLLECTIONS`, (3) real 409 behavior proof (stale write → 409 with `conflict: true`), (4) negative control (fresh version → 200, and an unrelated pre-existing 409 e.g. steerco-pack-empty-deal → NOT treated as a conflict by the dialog-triggering marker check).

---

### `test/optimistic-locking-cross-process.test.js` (new) — cross-process proof

**Analog:** `test/concurrency-busy-retry.test.js` (spawned-child-process harness) — reuse its `spawn('node', [...])` mechanic verbatim; per 09-RESEARCH.md, in-process contention simulation DEADLOCKS (Ph8 pitfall), so this MUST spawn real child processes, never mock/unit-simulate the race.

---

### `test/client-conflict-dialog.test.js` (new) — client-side node:vm harness

**Analog:** `test/client-busy-retry.test.js` — node:vm sandbox harness for `transitions.js`. Gotcha carried forward: "sandbox uses REAL setTimeout; swap the context global for a recording fake when testing waits" — likely N/A here since the conflict dialog has no retry timer, but verify before assuming.

---

## Shared Patterns

### Central error-middleware sibling shape
**Source:** `server.js:6909-6938` (`isBusyError` → 503)
**Apply to:** the new 409 conflict middleware — same guard order (`res.headersSent` check first), same fixed generic-safe body discipline (never echo `err.message`, a stack, or a file path — T-08-01 precedent), mounted before the final generic 500 handler.

### Named gating-set precedent
**Source:** `db/auditHook.js:55` `AUDITED_DB_KINDS`
**Apply to:** `db/collections.js`'s new `VERSIONED_COLLECTIONS` — same "one set, checked in one place" discipline so the coverage test can assert structurally, not by convention.

### Fetch-wrapper single interception point
**Source:** `public/js/transitions.js:136-156` (`ma-fetch-wrapper:begin`...`:end` sentinels)
**Apply to:** the new 409 branch — must land inside this SAME function/IIFE, never a second wrapper or per-page fetch override (D-05 locks one shared interception point).

### textContent-only / no-markup-assignment discipline
**Source:** `showBusyGiveUpToast()` (transitions.js:56-91), `toast.textContent = BUSY_GIVE_UP_MESSAGE;`
**Apply to:** the new shared conflict-dialog component — every dynamic string (field values, attribution name/time) via `textContent`, never `innerHTML`/markup assignment, to stay covered by `test/client-xss-sinks.test.js`.

### Zod strip-unknown-keys-by-default awareness
**Source:** `validators/index.js:8-10` (documented header comment)
**Apply to:** every schema touched — the `version` field addition and any new query-string schema for DELETE routes; a schema change and its corresponding route-level check must ship together or the check silently never fires (Pitfall 2).

### No-swallow error propagation
**Source:** `db/store.js` comment directly above `applyWrite` (~lines 318-325) and the D-11 actor-check throw (~lines 410-427)
**Apply to:** the new version-conflict throw inside `writeDb()`'s `.immediate` transaction — must propagate uncaught to the central 409 middleware, exactly like `isBusyError`/D-11 errors do today; never caught-and-logged inside `writeDb()` itself.

## No Analog Found

None — every file in scope has a strong, cited in-repo analog (Phase 8's 503/audit machinery structurally anticipates this phase's 409/conflict machinery).

## Metadata

**Analog search scope:** `db/store.js`, `db/auditHook.js`, `db/collections.js`, `server.js` (upsert/delete routes + central error middleware), `validators/index.js`, `validators/workstream.js`, `public/js/transitions.js`, `public/js/execution.js`, `test/busy-503-contract.test.js`
**Files scanned:** 9 read in full or substantial part this session (all previously read during 09-RESEARCH.md's own research pass; re-confirmed via targeted grep/read here, no re-reads of already-loaded ranges)
**Pattern extraction date:** 2026-08-11
