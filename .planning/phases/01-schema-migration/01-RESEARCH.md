# Phase 1: Schema & Migration - Research

**Researched:** 2026-07-23
**Domain:** File-store-to-SQLite migration for an existing Node/Express + vanilla-JS app (`better-sqlite3`, WAL mode), with a transactional per-collection compat write layer and a verified, re-runnable migration.
**Confidence:** HIGH overall — the single highest-risk unknown (native-binary bundling for the zero-install release model) was resolved by directly downloading and inspecting the actual `better-sqlite3@13.0.1` npm tarball on this machine, not by searching for secondhand descriptions of it.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cutover strategy**
- **D-01:** Big-bang cutover with a verified archive — run the deterministic migration against a `db.json` snapshot, verify offline, cut over in one step, and keep `db.json` (and its `.bak`) as a read-only archive rather than deleting it. The migration's re-runnability (FND-01) is the safety net, so no live dual-write plumbing is built. — Reversibility: reversible.
- **D-02:** No live dual-run / parallel-store comparison. Rejected as heavier than justified for a deterministic migration over demo data.

**readDb/writeDb API fate (this is where FND-03 is won)**
- **D-03:** Preserve the existing `readDb()` / `writeDb(data)` whole-object signatures as a compatibility layer so the ~3,200-line `server.js` and its ~90 endpoints barely change. — Reversibility: costly.
- **D-04:** Re-implement `writeDb` internals to upsert only the **changed collections inside a single SQLite transaction**, instead of rewriting the entire database. Two concurrent writers touching different collections no longer clobber each other. Whole-object write semantics alone (even on SQLite) do NOT fix the lost-update race; the per-collection transactional upsert is what closes it. A global write mutex was considered and rejected as it keeps the O(whole-db) write cost.
- **D-05:** Do NOT refactor hot endpoints to targeted per-row writes this phase — deferred (candidate for a later hardening pass, v2 HARD-03).

**Verification bar (gates retirement of db.json — success criterion 1.1)**
- **D-06:** Migration is verified by a **round-trip deep diff plus per-collection row-count parity**: migrate `db.json` → SQLite, reconstruct the full in-memory object from SQLite, assert it deep-equals the original parsed `db.json`, and assert each collection's row count matches. `db.json` is retired (archived) only when this passes. — Reversibility: reversible.
- **D-07:** No extended parallel-run verification — the deterministic round-trip diff is sufficient.

**Phase-3 schema anticipation**
- **D-08:** Migrate into a **single SQLite database this phase**, but design the schema (clean per-collection tables, deal/scope awareness) so Phase 3's split into control/demo/deal files is a mechanical move, not a redesign. — Reversibility: costly — the table shape chosen here is what makes (or breaks) a clean Phase-3 split.

### Claude's Discretion (builder/researcher decides)
- Blob-per-collection vs normalized columns per table — planner picks the concrete shape, keeping D-08's deal-aware requirement. (Resolved below — see "Schema Shape".)
- The mtime in-memory cache (`_dbCache`/`_dbMtime`, server.js ~246): whether to keep an in-memory cache over SQLite or query directly. (Resolved below — see "Cache Fate".)
- Faithful migration of the existing demo/real lane split — the `custom*` shadow arrays migrate as-is so the round-trip deep diff (D-06) can pass; Phase 3 restructures them into the file split.
- Handling of the existing `.bak`/`.tmp` atomic-write machinery and the `download-zip` exclusion list (server.js ~411), which already excludes `db.json*` — extend for `.db` files during planning. (Resolved below.)

### Deferred Ideas (OUT OF SCOPE)
- Refactoring hot endpoints to targeted per-row SQLite writes (instead of the whole-object compat API) — deferred (D-05); candidate for v2 HARD-03.
- Automated test suite around migration/isolation beyond FND-03's concurrent-write test and D-06's round-trip verify — v2 HARD-02.
- SQLCipher at-rest encryption — v2 HARD-01; this milestone relies on OS full-disk encryption.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FND-01 | A re-runnable, diffable migration copies all existing `db.json` data into SQLite, with the source verified against the result before the file store is retired | See "Migration Idempotency & Re-Runnability" and "Round-Trip Verification" below — concrete script design, canonical-diff algorithm, and the 38-collection ground-truth inventory (grep-verified, exceeds `readDb()`'s own defaulting list). |
| FND-02 | The app reads and writes all data through SQLite (`better-sqlite3`, WAL mode) instead of `db.json` | See "Schema Shape", "Cache Fate", and Code Examples — concrete `readDb()`/`writeDb()` reimplementation preserving the whole-object signature. |
| FND-03 | Concurrent writes never lose data (no lost-update race), verified by a concurrent-write test | See "Transactional Per-Collection writeDb — The Concrete Merge Algorithm" — resolves the ambiguity in D-04's phrasing (cross-collection vs. same-collection safety) with a snapshot-diff merge design, plus the Validation Architecture test spec. |
| FND-04 | The zero-install Windows/macOS/any-OS bundles run against SQLite with the correct native binary vendored per platform | See "better-sqlite3@13 Native-Binary Bundling" — directly verified against the actual npm tarball; this is the highest-confidence finding in this document. |
</phase_requirements>

## Summary

`better-sqlite3@13.0.1` ships all 8 platform/arch prebuilt N-API binaries **inside the single npm package tarball** — there is no per-platform package split like `@napi-rs/canvas` required. A single `npm install better-sqlite3` on this Mac, committed to `node_modules` as usual, already contains working binaries for macOS (x64+arm64), Windows (x64+arm64) and Linux (glibc + musl, x64+arm64); the correct one is selected automatically at *runtime* by `process.platform`/`process.arch`, not at install time. This makes FND-04 substantially easier than the canvas precedent it was modeled on — no 4-package install dance is needed, only a one-time verification that all 8 `.node` files are present and non-empty before cutting the next release zips. The one real gotcha: **`better-sqlite3@13.0.1` declares `engines.node: ">=22"`**, stricter than this repo's current `package.json` (`>=20`) — both the local dev Node (v22.18.0) and the bundled portable Node (v22.23.1) already satisfy this, so nothing breaks, but `package.json`'s `engines` field must be bumped to avoid it silently lying about the floor.

For FND-03, D-04's own wording ("two concurrent writers touching different collections don't clobber each other") only proves half of what the Phase 1 success criterion actually demands ("two simultaneous writes to the same resource" — Roadmap.md SC #3). A naive "diff the incoming array against current live DB, delete what's missing, upsert what's present" implementation of `writeDb` would still lose a concurrent *add* to the same collection: two requests that each read the collection, each append a different new item, and each write back their own version — the second writer's array doesn't contain the first writer's addition, so a diff-against-current-DB delete pass would erase it. The concrete fix (detailed below) is a **snapshot-tagged three-way merge**: `readDb()` stamps a hidden, non-enumerable "as-read" snapshot (per-collection id-set + content hash) onto the object it returns; `writeDb(data)` diffs the caller's mutated array against *that specific request's own snapshot* (not current DB state) to compute add/update/delete deltas, then applies only those deltas inside one SQLite transaction. This requires zero endpoint changes (satisfies D-03/D-05) and is what actually closes the lost-update race for same-collection concurrent writes, not just cross-collection ones.

For schema shape (D-08's discretion item), this phase should NOT adopt STACK.md's longer-term normalized-columns vision yet — that vision is calibrated for Phase 4+ capability areas (DD findings, synergy) that don't exist as concrete field lists yet. For Phase 1's narrower, locked scope (faithful 1:1 migration, exact round-trip diff, no per-row write refactor), the safer design is **one SQLite table per top-level `db.json` collection key, each row storing the untouched item as a JSON `data` column plus two extracted metadata columns (`id`, `project_id`)**. This makes the round-trip diff trivial (just `JSON.parse` per row — no type-coercion risk at all), makes D-04's per-collection diff mechanical, and makes D-08's Phase-3 file split a `WHERE project_id = ?` copy rather than a redesign, all without touching any endpoint code.

**Primary recommendation:** Ship `better-sqlite3@13.0.1` as a single cross-platform `node_modules` commit (no per-platform install needed); bump `package.json` `engines.node` to `>=22`; keep `readDb()`/`writeDb(data)` as the only two functions endpoints touch; reimplement `writeDb` as a snapshot-tagged, per-collection, transactional merge (not a live-DB diff); store every collection as JSON-blob-per-row with `id`/`project_id` extracted columns; verify the migration with a canonical-JSON structural diff (no new dependency) plus row-count parity, run twice from a fresh `db.json` snapshot with identical output, before archiving `db.json`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Data persistence (SQLite driver, WAL, transactions) | API/Backend | Database/Storage | `better-sqlite3` is an in-process, synchronous driver — there is no separate DB server tier in this laptop-local app; the "database" and "backend" collapse into the same Node process by design (single-writer, single-file). |
| `readDb()`/`writeDb()` compat layer | API/Backend | — | Pure server-side reimplementation; no browser or CDN involvement. Endpoint call sites (`server.js` handlers) are the only consumers and are explicitly NOT changing signature (D-03). |
| Migration script (`db.json` → SQLite) | API/Backend (offline tooling) | — | A standalone Node script run manually by the operator before cutover — not a request-serving code path, but lives in the same codebase/runtime as the server (reuses `readDb()`'s existing collection-defaulting logic where safe). |
| Native binary vendoring (`better-sqlite3` prebuilds) | Build/Release artifact | Database/Storage | The binaries are committed alongside `node_modules` (build-time/release concern), but the file selected at runtime is a storage-tier detail (`process.platform`/`process.arch` resolution happens inside the driver, invisible to the API tier). |
| Concurrency safety (no lost-update) | API/Backend | Database/Storage | The transaction boundary (SQLite `db.transaction()`) enforces atomicity at the storage tier, but the merge-diff logic that decides *what* to write is backend application logic, not something SQLite gives you for free. |
| Round-trip verification / diff tooling | API/Backend (offline tooling) | — | A standalone verification script, run once per migration attempt, not part of the running app. |
| Zero-install bundle boot (3 release zips) | Build/Release artifact | API/Backend | The zip's `start.bat`/`start.command` launchers and the bundled portable Node are release-packaging concerns; what they boot into (the Express server + SQLite file) is backend. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `better-sqlite3` | **13.0.1** `[VERIFIED: npm registry — npm view + tarball inspection performed this session]` | SQLite driver, WAL-mode persistence layer replacing `db.json` | Synchronous API matches this codebase's existing `fs.readFileSync`/`writeFileSync` mental model exactly — route handlers don't need to become `async`. Already the project-level recommendation in `.planning/research/STACK.md`; this research re-verified the exact version and its native-binary bundling model directly against the registry (see below), not from training-data memory. |

No other new runtime dependency is required for Phase 1's scope (schema + migration only). `zod` (write validation) is Phase 3's concern (VAL-01/02) and is out of scope here — do not add it in this phase.

### Supporting

None required for Phase 1. (`express-rate-limit`, `zod`, etc. from `.planning/research/STACK.md` belong to Phases 2/3.)

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `better-sqlite3` (sync, N-API) | `node:sqlite` (Node built-in) | Still experimental until Node 26 (per `.planning/research/STACK.md`, directly tested); the app's declared floor and bundled portable Node are both v22.x. Not viable this milestone. |
| `better-sqlite3` (sync, N-API) | `sqlite3` (async/callback driver, mapbox/TryGhost) | Legacy per-Node-ABI prebuild model (`prebuild-install`) — MORE platform+version combinations to vendor, not fewer; the exact problem `better-sqlite3@13`'s N-API move solves. Confirmed not recommended. |
| One SQLite file, JSON-blob-per-row schema (this phase) | Fully normalized relational columns per collection (STACK.md's longer-term vision) | Normalizing now is riskier for D-06's exact round-trip diff (type coercion, missing/null handling) and provides no benefit yet since D-05 defers per-row endpoint writes — the whole-object API still reads/writes full collections regardless of column shape. Correct move for Phase 4/5 once DD/synergy field lists are concrete; premature here. |

**Installation:**
```bash
npm install better-sqlite3@13.0.1
```

**Version verification:** Verified live this session via `npm view better-sqlite3 version` → `13.0.1`, and via `npm pack better-sqlite3` + tarball extraction (see Package Legitimacy Audit and "better-sqlite3@13 Native-Binary Bundling" below) — not training-data recall. Package publish date for 13.0.1: 2026-07-21 (2 days before this research, per registry metadata) — new patch release, but the package itself (WiseLibs/better-sqlite3) is long-established (first released 2016, 8.65M weekly downloads at time of research).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `better-sqlite3` | npm | 13.0.1 published 2026-07-21 (2 days old); package itself est. 2016 | 8,650,077/week | github.com/WiseLibs/better-sqlite3 | `[SUS]` (seam flags "too-new" — see note) | Approved, with note |

**Note on the `[SUS]` verdict:** The `package-legitimacy check` seam flagged `better-sqlite3` `SUS` solely because the **latest published version** (13.0.1) is 2 days old at time of research — this is a false-positive trigger on *version* recency, not *package* legitimacy. Cross-checked independently: 8.65M weekly downloads, an established GitHub org (`WiseLibs`), no `postinstall` script (`npm view better-sqlite3 scripts.postinstall` → empty), and the package has been the de facto standard synchronous SQLite driver for Node since 2016 (versions 11.x–13.x in the registry history, confirmed via `npm view better-sqlite3 versions`). Per the Package Legitimacy Protocol, the planner should still insert a `checkpoint:human-verify` task before the install step (satisfying the letter of the SUS-verdict rule), but this note should accompany it so the human check is a quick confirmation, not a from-scratch legitimacy investigation.

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `better-sqlite3` (see note above — recommend a lightweight `checkpoint:human-verify`, not a blocking investigation).

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────┐
                     │  ~90 Express route handlers (server.js)  │
                     │  UNCHANGED call pattern:                 │
                     │  const db = readDb();                    │
                     │  db.someCollection.push(newItem);         │
                     │  writeDb(db);                             │
                     └───────────────┬───────────────────────────┘
                                     │  (whole-object compat API, D-03)
                                     ▼
                     ┌─────────────────────────────────────────┐
                     │  readDb() / writeDb(data)  [server.js]    │
                     │                                            │
                     │  readDb():                                 │
                     │   for each of 38 collections:               │
                     │     SELECT id, data FROM <table>            │
                     │       ORDER BY seq                          │
                     │     JSON.parse each row.data                │
                     │   assemble into one JS object                │
                     │   stamp hidden __snapshot (id-set+hash        │
                     │     per collection) — non-enumerable          │
                     │                                                │
                     │  writeDb(data):                                │
                     │   db.transaction(() => {                        │
                     │     for each of 38 collection keys:               │
                     │       diff data[key] against data.__snapshot[key]  │
                     │         (NOT against live current DB state)          │
                     │       compute added/updated/removed ids               │
                     │       if no delta for this collection: SKIP entirely   │
                     │       else: apply INSERT/UPDATE/DELETE for exactly      │
                     │         the delta rows in this collection's table        │
                     │   })()   <- one atomic transaction, tight scope           │
                     └───────────────┬─────────────────────────────────────────┘
                                     │  prepared statements (parameterized)
                                     ▼
                     ┌─────────────────────────────────────────┐
                     │  better-sqlite3 (sync, N-API, WAL mode)   │
                     │  single .db file + .db-wal + .db-shm       │
                     │  38 tables, each:                           │
                     │   (rowid autoincrement,                      │
                     │    id TEXT UNIQUE,                            │
                     │    project_id TEXT NULL,                       │
                     │    seq INTEGER,   -- migration-time array index│
                     │    data TEXT NOT NULL) -- untouched JSON blob   │
                     │  + one `app_state(key TEXT PK, data TEXT)`      │
                     │    table for non-array top-level keys             │
                     │    (settings, customSettings, i18n, menus,         │
                     │     activeProjectId)                                 │
                     └─────────────────────────────────────────────────────┘
                                     ▲
                                     │  one-time, re-runnable, offline
                     ┌───────────────┴─────────────────────────┐
                     │  scripts/migrate-db-json-to-sqlite.js     │
                     │  1. read db.json snapshot (never mutate it)│
                     │  2. DROP + CREATE all 38 tables + app_state │
                     │  3. for each collection: insert every item   │
                     │     preserving original array order (seq)     │
                     │     and its own existing `id` field (no new    │
                     │     ids minted)                                  │
                     │  4. commit as ONE transaction                     │
                     │  5. --verify mode: reconstruct full object from    │
                     │     SQLite, canonical-diff vs source db.json,       │
                     │     assert per-collection row counts match           │
                     └───────────────────────────────────────────────────┘
```

### Recommended Project Structure
```
/Users/karstenhaldan/M&A/
├── server.js                              # readDb()/writeDb() reimplemented internals; endpoints unchanged
├── db/
│   ├── schema.sql                         # CREATE TABLE statements (38 collection tables + app_state)
│   └── collections.js                     # single source of truth: the 38-key inventory (array vs singleton, project-scoped or not)
├── scripts/
│   ├── migrate-db-json-to-sqlite.js        # the re-runnable migration (--source, --out, --verify)
│   └── verify-migration.js                 # canonical-diff + row-count parity check (or folded into --verify above)
├── data/
│   └── ma-portal.db                        # committed demo SQLite file (replaces committed db.json), .db-wal/.db-shm gitignored
├── db.json                                 # RETAINED as read-only archive post-cutover (D-01) — not deleted
├── db.json.pre-migration-backup            # permanent snapshot, per Pitfall 2 guidance
└── test/
    └── concurrent-write.test.js            # FND-03's automated concurrent-write test (node:test, no new devDependency)
```

### Pattern 1: better-sqlite3 connection singleton (module-level, mirrors existing `_dbCache` pattern)
**What:** One `Database` instance opened once at server startup, WAL + busy_timeout pragmas set once.
**When to use:** Always — do not open a new connection per request.
**Example:**
```javascript
// Source: better-sqlite3 official docs (github.com/WiseLibs/better-sqlite3), cross-checked
// against the tarball's lib/database.js this session.
const Database = require('better-sqlite3');
const db = new Database(path.join(__dirname, 'data', 'ma-portal.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
```
`journal_mode = WAL` is persisted in the file header — set once, every future connection (migration script, verify script, the running server) picks it up automatically.

### Pattern 2: JSON-blob-per-row collection table (the concrete answer to D-08's discretion item)
**What:** Each of the 38 top-level `db.json` collections that is an array gets its own table with this exact shape:
```sql
CREATE TABLE integration_tasks (
  rowid_seq   INTEGER,                 -- migration-time array order, for exact round-trip
  id          TEXT PRIMARY KEY,        -- the item's own existing id (newId()-minted), NOT re-minted
  project_id  TEXT,                    -- extracted from item.projectId if present, else NULL
  data        TEXT NOT NULL            -- JSON.stringify(item) — UNCHANGED, no coercion
);
CREATE INDEX idx_integration_tasks_project ON integration_tasks(project_id);
```
Non-array top-level keys (`settings`, `customSettings`, `i18n`, `menus`, `activeProjectId`) go into one shared table:
```sql
CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  data  TEXT NOT NULL
);
```
**When to use:** For every one of the 38 collections this phase migrates (see the ground-truth inventory below). Do NOT normalize individual fields into typed columns this phase — that is Phase 4/5's job, once DD/synergy field lists exist and the whole-object API is finally cut over to per-row writes (D-05).
**Why this is the right call for Phase 1 specifically (not STACK.md's longer-term vision):** `.planning/research/STACK.md` (project-level, milestone-wide research) recommends real relational columns for operational tables — that is the correct end state, but it is calibrated against capability areas (DD findings, synergy phasing) that Phase 1 does not build. Adopting it now would (a) risk D-06's exact round-trip diff on SQLite type-affinity coercion of numeric/date fields that today are loosely-typed strings in JSON, and (b) provide zero query benefit yet, since D-05 explicitly keeps every endpoint on the whole-object read-modify-write pattern this phase. The `data TEXT` blob column sidesteps type coercion entirely — reconstruction is a pure `JSON.parse`, making the deep-diff verification (D-06) trivially exact.

### Pattern 3: Ground-truth collection inventory (do NOT trust `readDb()`'s own defaulting block alone)
**What:** `readDb()`'s explicit per-collection defaulting (`server.js:258-328`) is missing at least 5 collections that are referenced elsewhere in the file: `communications`, `customAlerts`, `customAssessments`, `customCommunications`, `customHrbps`. These exist in `db.json` and are read/written via ad hoc `|| []` guards at each call site rather than being normalized once. CONTEXT.md's canonical-refs section calls `readDb()`'s list "the authoritative schema inventory" — it is not complete.
**Verified full inventory** (via `grep -oE '\b(db|parsed)\.[a-zA-Z_][a-zA-Z0-9_]*' server.js`, 2026-07-23, `[VERIFIED: codebase grep]`), 38 top-level keys:
```
activeProjectId (singleton), alerts, assessmentInstances, assessments, assessmentTemplates,
banners, checklistTemplates, communications, courses, customAlerts, customAssessmentInstances,
customAssessments, customCommunications, customEmployees, customHrbps, customIntegrationTasks,
customRaidEntries, customSettings (singleton), customSynergyInitiatives, departments, employees,
hrbps, i18n (singleton), integrationTasks, media, menus (singleton), modules, pages,
processCatalog, projects, pulses, questions, ragUploads, raidEntries, settings (singleton),
slides, synergyInitiatives, users
```
**When to use:** Build the migration script's collection list from this grep-verified inventory (or re-run the same grep against the current `server.js` at plan/build time to catch any drift), not from `readDb()`'s defaulting block alone.
**Warning signs:** A migration script whose collection list has exactly the ~33 keys visible in `readDb()`'s defaulting block and silently drops `communications`/`customAlerts`/`customAssessments`/`customCommunications`/`customHrbps` data.

### Anti-Patterns to Avoid
- **Wrapping the whole HTTP request handler in `db.transaction()`:** Several handlers do non-DB work (Gemini AI calls, PDF parsing, file I/O) between `readDb()` and `writeDb()`. Scope the transaction tightly around `writeDb`'s own diff-and-apply body, not the handler. (PITFALLS.md Pitfall 4.)
- **Diffing the incoming array against *current live SQLite state* instead of the request's own as-read snapshot:** This silently deletes concurrently-added rows from other requests (see Summary and the concrete merge algorithm below) — it looks correct in single-user testing and fails exactly the FND-03 concurrent-write test.
- **Re-minting ids during migration:** Every item in `db.json` already carries a stable `newId()`-generated id. Migration must reuse it verbatim, not generate a new one, or re-running the migration against the same source produces different primary keys each time (breaks FND-01's re-runnability).
- **A TTL/mtime-keyed application cache reintroduced "to keep things fast like before":** better-sqlite3 reads are sub-millisecond in-process; no cache is needed. (PITFALLS.md Pitfall 3 — see "Cache Fate" below.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite native binary per platform | A custom binary-download/vendoring script (like the canvas precedent required) | `npm install better-sqlite3@13.0.1` on any one dev machine, commit the resulting `node_modules/better-sqlite3/prebuilds/*.node` (all 8 already present in the single package) | `better-sqlite3@13`'s N-API prebuild bundling already solves the exact problem the canvas 4-package vendoring script exists for — building a parallel mechanism would be pure duplicated effort. |
| Transaction atomicity | Manual flag/lock files, custom rollback logic | `better-sqlite3`'s built-in `db.transaction(fn)` | It already wraps `fn` with the correct `BEGIN`/`COMMIT`/`ROLLBACK` semantics and re-throws on error — hand-rolling this is pure risk for zero benefit. |
| Structural JSON deep-equality for the round-trip diff | A general-purpose diff library dependency | A ~15-line hand-rolled canonical-stringify (recursively sort object keys, then string-compare) | Zero new dependency, matches the project's "no build step, minimal deps" convention; the JSON-blob-per-row schema already guarantees no type-coercion risk, so a heavyweight diff library buys nothing extra. |
| Migration "runner" / version tracking | An ORM migration tool (Prisma Migrate, Drizzle Kit) | One hand-written `db/schema.sql` + one `scripts/migrate-db-json-to-sqlite.js` | Already the explicit STACK.md recommendation — an ORM migration tool would be the first build-step dependency this zero-build-step codebase has ever had. |

**Key insight:** Every "don't hand-roll" item above already has a project-appropriate zero-dependency or already-adopted solution; the temptation in a from-scratch SQLite migration is to reach for heavier general-purpose tooling (ORMs, diff libraries, custom binary vendoring) that this specific codebase's constraints (no build step, committed `node_modules`, already-solved binary vendoring precedent) make unnecessary.

## Runtime State Inventory

> This is a migration phase (file-store → SQLite); the canonical question is: after `db.json` is replaced, what runtime systems still have the old file/format cached, stored, or registered?

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `db.json` itself is the only stored-data artifact holding the pre-migration state. No other datastore (no external DB, no cache service) references its contents. | Migration script reads it once; `db.json` + `db.json.bak` retained as read-only archive per D-01 (code edit: none beyond the migration script itself; data migration: the one-time run). |
| Live service config | None — this app has no external services (n8n-style workflow engine, Datadog, etc.) whose config lives outside git and references `db.json`'s structure. | None. Verified by reading `.planning/codebase/ARCHITECTURE.md`-referenced integration points and `server.js` in full — no external service integrations beyond the Gemini API (which reads `settings.geminiApiKey` at request time, not `db.json`'s file path). |
| OS-registered state | None — no Task Scheduler/pm2/launchd/systemd registration references `db.json` by name or path; the app is started directly via `node server.js` / `start.bat` / `start.command`. | None. |
| Secrets/env vars | `DB_FILE` is a hardcoded `path.join(__dirname, 'db.json')` constant, not an env var — no secret/env-var name references "db.json" that would break on rename. `ADMIN_TOKEN`/`PORTAL_AUTH_SECRET` are unrelated to the DB file. | Code edit only: introduce the new SQLite path constant (e.g. `path.join(__dirname, 'data', 'ma-portal.db')`); no secret renaming needed. |
| Build artifacts / installed packages | The `/api/admin/download-zip` export (`server.js:411`) hardcodes an exclusion list that names `db.json`, `db.json.tmp`, `db.json.bak` explicitly — this WILL NOT automatically exclude the new `.db`/`.db-wal`/`.db-shm` files. | **Code edit required**: extend the `zip -x` exclusion list to also exclude the real SQLite artifacts (see "download-zip Extension" in Common Pitfalls below) before this phase ships, or the admin export will bundle live data into a "shareable" zip. |

**Nothing found in "Stored data beyond db.json", "Live service config", "OS-registered state" categories** — verified by direct reading of `server.js` in full and the codebase architecture docs; this app is a single-process, no-external-service, directly-launched Node server with no OS-level registrations.

## Common Pitfalls

### Pitfall 1: A collection-list drift between `readDb()`'s defaulting block and the true set of keys in `db.json`
**What goes wrong:** The migration script is written against `readDb()`'s explicit defaulting block (`server.js:258-328`, ~33 keys) and silently drops `communications`, `customAlerts`, `customAssessments`, `customCommunications`, `customHrbps` — all of which are read/written elsewhere in `server.js` via ad hoc `|| []` guards but never appear in `readDb()`'s own defaulting list.
**Why it happens:** `readDb()`'s defaulting block looks authoritative (it's the single place that initializes most collections) but was added incrementally over many features; five collections never got added to it because their call sites already guard with `|| []` inline.
**How to avoid:** Build the migration's collection inventory from the grep-verified 38-key list in "Pattern 3" above (or re-run `grep -oE '\b(db|parsed)\.[a-zA-Z_][a-zA-Z0-9_]*' server.js | sed -E 's/^(db|parsed)\.//' | sort -u` at plan/build time to catch any further drift before finalizing `db/schema.sql`).
**Warning signs:** A round-trip diff (D-06) that passes on row counts for the ~33 `readDb()`-defaulted keys but the verification script itself never checked `communications`/`customAlerts`/`customAssessments`/`customCommunications`/`customHrbps` because they weren't in its own collection list either.
**Phase to address:** This phase, before writing `db/schema.sql`.

### Pitfall 2: `writeDb`'s per-collection diff computed against live current-DB state, not the request's own as-read snapshot
**What goes wrong:** Two concurrent requests A and B both `readDb()` (collection X has N items), each appends a different new item (A appends item A1, B appends item B1), each calls `writeDb()`. If `writeDb` computes its diff as "delete rows in table X not present in the incoming array, upsert rows present in it" using *current live DB state* as the baseline, then whichever of A/B commits second will DELETE the other's newly-inserted row (A1 or B1) because its own incoming array doesn't contain it — this is the exact lost-update race FND-03 exists to catch, reintroduced one layer down.
**Why it happens:** "Diff the whole-object array against current DB" is the natural first implementation of D-04 and looks correct in every single-request manual test; it only breaks under genuine concurrency on the same collection, which is precisely what an automated concurrent-write test (not manual testing) is designed to catch.
**How to avoid:** Tag the object `readDb()` returns with a hidden, non-enumerable `__snapshot` property capturing each collection's id-set + a content hash *at read time*. `writeDb(data)` diffs `data[key]` against `data.__snapshot[key]` (what THIS request started from) to compute its own add/update/delete delta, then applies only that delta — never touching rows whose ids were never present in this request's own read. See Code Examples below for the concrete pattern.
**Warning signs:** The automated concurrent-write test (FND-03) passes when the two writes touch different collections but fails (loses one item) when both touch the same collection with different new items.
**Phase to address:** This phase — this is the crux of satisfying Roadmap.md's Phase 1 success criterion #3 ("two simultaneous writes to the same resource ... no lost update"), which is a stronger claim than D-04's own wording ("two concurrent writers touching different collections").

### Pitfall 3: The mtime cache pattern carried forward, or torn out with a TTL replacement
Covered exhaustively in `.planning/research/PITFALLS.md` Pitfall 3. Concrete resolution for this phase: **remove `_dbCache`/`_dbMtime` entirely.** better-sqlite3 is a synchronous, in-process, WAL-mode driver — reads are sub-millisecond and always reflect the same process's most recent writes (no cross-connection staleness in a single-process app). Reconstructing the full object from 38 tables' worth of prepared-statement `SELECT`s on every `readDb()` call is expected to be faster than the previous 300KB `JSON.parse`, not slower — there is no performance justification for a cache, and every cache reintroduces exactly the staleness bug class this migration is meant to close. If a genuinely hot path later needs caching, key it by a write-version counter incremented inside the same transaction as the write (never by wall-clock time or mtime), per PITFALLS.md's own guidance.

### Pitfall 4: `download-zip`'s hardcoded exclusion list doesn't know about `.db`/`.db-wal`/`.db-shm`
**What goes wrong:** `server.js:411`'s `zip -x` argument list explicitly names `db.json`, `db.json.tmp`, `db.json.bak`. Once the persistence layer moves to SQLite, this exclusion list is stale by construction — the admin "download portable app package" export would bundle the live `.db` file (and WAL/SHM sidecars) into what's designed to be a safely-shareable zip.
**Why it happens:** The exclusion list is a hand-maintained string, not derived from the actual DB_FILE constant; nobody revisits it when the persistence mechanism changes underneath it.
**How to avoid:** Extend the `execSync` exclusion arguments to also exclude the new SQLite path and its WAL/SHM sidecars — e.g. `"data/*.db" "data/*.db-wal" "data/*.db-shm" "data/*.db.bak"` (adjust to whatever path/naming this phase settles on) — as an explicit checklist item in the same plan wave that decides the new file path, not a follow-up.
**Warning signs:** A working migration where nobody re-ran `/api/admin/download-zip` and inspected the resulting zip's contents for the new `.db` file before considering the phase done.
**Phase to address:** This phase — flagged specifically because CONTEXT.md's discretion section calls this out but does not resolve the concrete new exclusion strings; this research provides them.

### Pitfall 5: Migration script re-mints ids or doesn't preserve original array order
**What goes wrong:** If the migration script generates fresh ids (e.g. via `newId()` at migration time rather than reusing each item's existing id field) or doesn't record original array order, re-running the migration against the same `db.json` snapshot produces a SQLite file with different primary keys or different reconstructed array order each time — breaking FND-01's re-runnability and D-06's diff (arrays would still be *set*-equal but not *order*-equal, and any UI relying on array order — e.g. courses/lessons display order — would silently reorder).
**How to avoid:** Reuse each item's own existing `id` field verbatim (never regenerate); add an explicit `seq INTEGER` column capturing the item's index in the source array, and `ORDER BY seq` on every reconstruction query — SQLite gives no ordering guarantee from `rowid`/insertion order alone that survives a `DROP`+`CREATE`+repopulate re-run.
**Phase to address:** This phase, in the migration script itself.

## Code Examples

### `readDb()` reimplementation (snapshot-tagged, all 38 collections, no cache)
```javascript
// Source: hand-written for this codebase, following better-sqlite3's documented
// .prepare()/.all() API (github.com/WiseLibs/better-sqlite3) — cross-checked against
// the tarball's lib/database.js this session.
const ARRAY_COLLECTIONS = require('./db/collections'); // the 33 array-shaped keys, ground-truth list
const SINGLETON_KEYS = ['settings', 'customSettings', 'i18n', 'menus', 'activeProjectId'];

function readDb() {
  const out = {};
  const snapshot = {};

  for (const key of ARRAY_COLLECTIONS) {
    const rows = db.prepare(`SELECT id, data FROM ${key} ORDER BY seq`).all();
    out[key] = rows.map(r => JSON.parse(r.data));
    // Snapshot: id-set + a cheap content hash per row, keyed for O(1) diff later.
    snapshot[key] = new Map(rows.map(r => [r.id, r.data])); // r.data is already the
    // canonical JSON string as stored — comparing strings is enough for change detection
    // since it was written by JSON.stringify(item) with a stable key order at write time.
  }
  for (const key of SINGLETON_KEYS) {
    const row = db.prepare('SELECT data FROM app_state WHERE key = ?').get(key);
    out[key] = row ? JSON.parse(row.data) : undefined;
  }

  // Non-enumerable so it never leaks into JSON.stringify(db) responses or Object.keys(db).
  Object.defineProperty(out, '__snapshot', { value: snapshot, enumerable: false });
  return out;
}
```

### `writeDb(data)` reimplementation (snapshot-diff merge, one transaction, only-changed-collections)
```javascript
// Source: hand-written for this codebase — the concrete mechanism that satisfies
// D-04's intent AND Roadmap.md Phase 1 success criterion #3 (same-resource concurrent
// writes, not just cross-collection writes).
const applyWrite = db.transaction((data) => {
  const before = data.__snapshot || {};

  for (const key of ARRAY_COLLECTIONS) {
    const beforeMap = before[key] || new Map();
    const afterArr = data[key] || [];
    const afterIds = new Set();
    const upsert = db.prepare(`INSERT INTO ${key} (id, project_id, seq, data) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, seq=excluded.seq, data=excluded.data`);
    const del = db.prepare(`DELETE FROM ${key} WHERE id = ?`);
    let changed = false;

    afterArr.forEach((item, i) => {
      afterIds.add(item.id);
      const serialized = JSON.stringify(item);
      if (beforeMap.get(item.id) !== serialized) { // new OR modified since this request's own read
        upsert.run(item.id, item.projectId || null, i, serialized);
        changed = true;
      }
    });
    // Only delete ids that THIS request's own snapshot saw and no longer has —
    // never an id we never knew about (i.e. never touch another writer's concurrent add).
    for (const id of beforeMap.keys()) {
      if (!afterIds.has(id)) { del.run(id); changed = true; }
    }
    // If `changed` is false, zero SQL statements were issued for this collection —
    // this IS "upsert only the changed collections" (D-04), verified per-collection.
  }

  for (const key of SINGLETON_KEYS) {
    if (data[key] !== undefined) {
      db.prepare(`INSERT INTO app_state (key, data) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET data=excluded.data`).run(key, JSON.stringify(data[key]));
    }
  }
});

function writeDb(data) {
  applyWrite(data);
  return true; // preserves existing callers' truthy-return expectation
}
```

### Canonical structural diff for the round-trip verification (no new dependency)
```javascript
// Source: hand-written — key-order-agnostic structural equality, since JSON.stringify's
// output order depends on object insertion order and would produce false diff failures
// if compared as plain strings without first canonicalizing key order.
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = canonicalize(v[k]); return acc; }, {});
  }
  return v;
}
function canonicalJSON(v) { return JSON.stringify(canonicalize(v)); }

// Usage in scripts/migrate-db-json-to-sqlite.js --verify:
const sourceDb = JSON.parse(fs.readFileSync(sourceSnapshotPath, 'utf8'));
const reconstructed = readDb(); // against the freshly-migrated SQLite file
for (const key of ARRAY_COLLECTIONS) {
  const src = sourceDb[key] || [];
  const got = reconstructed[key] || [];
  assert.strictEqual(got.length, src.length, `row-count mismatch for ${key}`); // D-06 check #2
  for (let i = 0; i < src.length; i++) {
    assert.strictEqual(canonicalJSON(got[i]), canonicalJSON(src[i]), `field-level mismatch in ${key}[${i}]`); // D-06 check #1
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `sqlite3` (async/callback, prebuild-install per-Node-ABI binary) | `better-sqlite3` (sync, N-API, all-prebuilds-in-tarball) | `better-sqlite3` moved to N-API/bundled-prebuilds starting at v13.0.0 (2026, per registry version history) | One binary works across Node major versions and even Electron; no per-Node-version rebuild matrix, unlike the old prebuild-install model this app already outgrew with `pdf-parse`. |
| `node:sqlite` treated as a future built-in replacement | Still experimental until Node 26 | Per `.planning/research/STACK.md`, directly tested against this machine's Node v22.18.0 | Not viable for this milestone; revisit only if the bundled portable Node moves to v26+. |

**Deprecated/outdated:** Nothing else in this narrow phase's scope has shifted since `.planning/research/STACK.md` was written earlier the same day — this research extends it with concretely-verified binary-bundling mechanics and the concurrency-merge algorithm, it does not supersede its package version choices.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The new SQLite file path/naming (`data/ma-portal.db`) proposed in "Recommended Project Structure" is a suggestion, not a locked decision — CONTEXT.md left the exact path unspecified. | Recommended Project Structure, Runtime State Inventory | Low — purely cosmetic; whatever path the planner picks, the same download-zip exclusion and .gitignore updates apply, just with different literal strings. |
| A2 | The `project_id` extraction for existing collections assumes most items either carry a `projectId`/`project_id` field already or are legitimately global (no such field) — this was spot-checked against `taskLane()`'s demo/custom split pattern but not exhaustively verified across all 38 collections' item shapes. | Pattern 2 (JSON-blob-per-row schema) | Medium — if a collection's items turn out to need per-item project scoping that this phase doesn't correctly extract, Phase 3's "mechanical" file split (D-08) becomes slightly less mechanical for that one collection; recoverable via an `ALTER TABLE`/backfill, not a re-migration. |
| A3 | The `custom*` shadow-array collections (customEmployees, customIntegrationTasks, etc.) do not have a natural per-item `project_id` today — their scoping is governed by the global `settings.demoMode` flag, not a field on each item. This research recommends leaving their `project_id` column NULL and preserving the existing lane-selection logic (`taskLane()` etc.) unchanged in application code (per D-05's no-refactor constraint). | Summary, Pattern 2 | Low — explicitly deferred to Phase 3 (ISO-03's deal-resolver) per CONTEXT.md's own scope boundary; NULL is a safe, honest placeholder, not a data-loss risk. |

**If this table is empty:** N/A — three assumptions logged above; none block planning, all have documented low/medium risk and a stated recovery path.

## Open Questions

1. **Exact literal path/filename for the new SQLite file(s).**
   - What we know: Phase 1 is explicitly single-database (D-08); Phase 3 will split into `control.db`/`demo.db`/`deals/<id>.db`.
   - What's unclear: whether Phase 1's single file should already be named in a way that anticipates the Phase-3 split (e.g. `data/demo.db` even though it's the only file this phase creates) or a neutral name (e.g. `data/ma-portal.db`) that gets renamed/replaced in Phase 3.
   - Recommendation: name it in a way Phase 3 can cleanly supersede without a rename that breaks any hardcoded references — e.g. `data/ma-portal.db` (neutral) is simplest for Phase 1 and Phase 3 introduces the `control.db`/`demo.db`/`deals/*.db` naming fresh at that point, treating Phase 1's file as the one-time migration's output rather than a name that must survive unchanged into Phase 3.

2. **Whether the committed demo `.db` file should be the direct output of running the migration script against the currently-committed `db.json`, checked in as a binary artifact (mirroring today's committed `db.json`), or generated at first boot if absent.**
   - What we know: today's zero-install bundles boot immediately because `db.json` is already committed; there's no "first boot generates the DB" step today.
   - What's unclear: whether committing a binary SQLite file (as opposed to committing the migration script + running it once at release-build time, similar to how the portable Node binaries are added at release-zip-build time, not committed to git) is preferred.
   - Recommendation: commit the migrated `.db` file directly (mirrors the existing `db.json` commit pattern most closely, and avoids requiring the release-build process to run the migration script itself) — but flag this as a discretion point for the planner since it's a release-workflow decision, not purely a schema decision.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Server runtime, better-sqlite3 driver | ✓ | v22.18.0 (local dev); v22.23.1 (bundled portable Node in release zips) | — both already satisfy better-sqlite3@13's `>=22` floor; no action needed beyond the `package.json` `engines` bump. |
| npm | Installing/vendoring `better-sqlite3` | ✓ | 10.9.3 | — |
| `zip` CLI (Info-ZIP) | `/api/admin/download-zip` export | ✓ | 3.0 | — |
| Python 3 + Xcode Command Line Tools | `node-gyp rebuild` invoked by better-sqlite3's `install` script (a no-op build when a matching prebuild exists for the host, per binding.gyp's `prebuild_exists` check — see Standard Stack) | ✓ | Python 3.14.6; CLT at `/Library/Developer/CommandLineTools` | Only needed on the machine that runs `npm install better-sqlite3` once, to produce the committed `node_modules`; end users of the zero-install release bundles never run `npm install` (per the existing committed-`node_modules` model), so this is a dev-machine-only requirement, not a release-bundle requirement. |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — all probed dependencies are present on this development machine.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | **`node:test`** (Node's built-in test runner, Node ≥18) — no test framework or config exists in this repo today (`[VERIFIED: codebase grep]` — no `*.test.js`, `*.spec.js`, jest/vitest/mocha config found). Recommending `node:test` over Jest/Vitest/Mocha because it requires **zero new dependency** and zero build step, matching this codebase's explicit "no build tooling" convention (`.claude/CLAUDE.md` Conventions section) more closely than any third-party framework would. |
| Config file | none — `node:test` needs no config file; run via `node --test test/` |
| Quick run command | `node --test test/concurrent-write.test.js` |
| Full suite command | `node --test test/` (once more test files exist in later phases) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FND-01 | Migration is re-runnable and diffable — running twice from the same source snapshot produces identical, verified output | integration (script) | `node scripts/migrate-db-json-to-sqlite.js --source db.json --out /tmp/verify1.db --verify && node scripts/migrate-db-json-to-sqlite.js --source db.json --out /tmp/verify2.db --verify && diff /tmp/verify1.db /tmp/verify2.db` (or compare canonical-JSON reconstructions of both rather than raw file bytes, since SQLite file bytes can differ even for identical logical content — recommend the canonical-JSON comparison, not a raw byte diff) | ❌ Wave 0 |
| FND-02 | The app reads and writes exclusively through SQLite — no remaining `fs.readFileSync(DB_FILE)`/`fs.writeFileSync(DB_FILE, ...)` code path against `db.json` | smoke (grep-based) | `grep -n "DB_FILE\|db.json" server.js` reviewed manually against the new `readDb()`/`writeDb()` — no automated assertion needed beyond code review, since this is a "does the code path exist" check, not a runtime behavior | ❌ Wave 0 (the grep itself, run at verification time) |
| FND-03 | Concurrent writes never lose data (no lost-update race) | integration | `node --test test/concurrent-write.test.js` — spins up the server (or calls `writeDb`/`readDb` directly in-process), fires two concurrent "add a different item to the same collection" operations, asserts BOTH items are present after both complete | ❌ Wave 0 |
| FND-04 | All 3 release bundles boot with the correct native binary per platform | manual (smoke, per-platform) | Inspect `node_modules/better-sqlite3/prebuilds/` for all 8 expected `.node` files present and non-empty (`ls -la node_modules/better-sqlite3/prebuilds/*.node`); boot-test at minimum the macOS bundle directly (this machine), and treat Windows/Linux boot verification as a `checkpoint:human-verify` if no CI runner for those platforms exists | ❌ Wave 0 (the prebuild presence check is scriptable; full boot-test on non-Mac platforms is manual) |

### Sampling Rate
- **Per task commit:** `node --test test/` (fast — no build step, in-process SQLite)
- **Per wave merge:** same command; also re-run the migration `--verify` mode against the committed demo `db.json` snapshot
- **Phase gate:** Full suite green + migration `--verify` passing + `checkpoint:human-verify` for the non-Mac boot tests, before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/concurrent-write.test.js` — covers FND-03 (the concurrent-write test is a NEW file; nothing like it exists today)
- [ ] `scripts/migrate-db-json-to-sqlite.js` with `--verify` mode — covers FND-01 (D-06's round-trip diff + row-count parity)
- [ ] `db/schema.sql` + `db/collections.js` (the 38-key ground-truth inventory as a single source of truth, not duplicated between the migration script and `readDb()`)
- [ ] Framework install: none — `node:test` is built into Node ≥18, already satisfied by this app's `engines.node` floor

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No — this phase | Mandatory auth is explicitly Phase 2 (AUTH-01..04); Phase 1 must not regress the existing optional `PORTAL_AUTH`/`ADMIN_TOKEN` gates, but does not add new auth controls. |
| V3 Session Management | No — this phase | Same as above; Phase 2. |
| V4 Access Control | No — this phase | Same as above; Phase 2/3 (clean-room segregation). |
| V5 Input Validation | Partial | Schema validation on writes (VAL-01/02, `zod`) is explicitly Phase 3 — out of scope here. However, this phase's SQL layer MUST use `better-sqlite3`'s parameterized `.prepare()`/`.run()`/`.all()` exclusively (never string-concatenated SQL), which is the SQL-injection-equivalent of input validation for this phase's own surface. |
| V6 Cryptography | No — this phase | No new cryptographic primitive introduced; existing `scrypt` password hashing (Phase 2's concern) is untouched. |
| V8 Data Protection | Yes | The migration introduces a new at-rest artifact (`.db`/`.db-wal`/`.db-shm`) holding the same data `db.json` already held. Continue relying on OS full-disk encryption as the documented baseline (per `.planning/research/PITFALLS.md` Security Mistakes table) — SQLCipher is explicitly deferred (v2 HARD-01). The `.gitignore`/download-zip exclusion updates in this phase are the concrete V8 control for this milestone stage: preventing the new artifact from leaking via git history or the admin export. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| SQL injection via string-concatenated queries | Tampering | Use `better-sqlite3`'s `.prepare(sql).run(...params)` / `.all(...params)` exclusively for every query this phase introduces — never build SQL strings by concatenating request-derived values. All example code in this document already follows this pattern. |
| Real/live SQLite artifact accidentally committed to git or bundled into the admin `download-zip` export | Information Disclosure | Extend `.gitignore` (for `.db-wal`/`.db-shm` sidecars and any real, non-demo `.db` file path) and the `download-zip` exclusion list (server.js:411) in the SAME plan wave that introduces the new file path — this is Pitfall 4 and Pitfall 11 (PITFALLS.md) made concrete for this phase. |
| Migration script accidentally mutating the source `db.json` on a failed/partial run | Tampering (self-inflicted data loss) | The migration script must only ever `readFileSync` the source `db.json` (or an explicit `--source` snapshot path) and never write to it — verified by code review: no `fs.writeFileSync`/`fs.copyFileSync` call in the migration script should ever target the source path. |
| Audit-log-adjacent: this phase does NOT add an audit log (that's Phase 3, AUD-01/02) | Repudiation | Out of scope for Phase 1; flagged here only so the planner doesn't accidentally scope-creep an audit table into this phase's schema design — `db/schema.sql` should NOT include `audit_log` yet (Phase 3's job), to avoid a half-built table that Phase 3 then has to redesign around real write-path validation. |

## Sources

### Primary (HIGH confidence)
- Direct `npm view better-sqlite3 version|engines|os|cpu|scripts.postinstall|versions` against the live npm registry, 2026-07-23 — `[VERIFIED: npm registry]`
- Direct `npm pack better-sqlite3` + tarball extraction + `file` inspection of the actual `.node` binaries (`package/prebuilds/*.node`), 2026-07-23 — `[VERIFIED: npm registry — tarball inspection]`. This is the single most authoritative source possible for FND-04 (the packaged artifact itself, not a description of it).
- `package/binding.gyp` and `package/lib/binding.js` read directly from the extracted tarball — confirms the `prebuild_exists` no-op-build mechanism and the runtime `process.platform`/`process.arch` selection logic. `[VERIFIED: tarball inspection]`
- `node ~/.claude/gsd-core/bin/gsd-tools.cjs query package-legitimacy check --ecosystem npm better-sqlite3` — 2026-07-23, returned `SUS` on the "too-new" version-recency heuristic; cross-checked independently against weekly download count and repo history.
- Direct codebase inspection: `server.js` read in full (lines 1-420, plus targeted reads at 2028-2280); `grep -oE '\b(db|parsed)\.[a-zA-Z_][a-zA-Z0-9_]*' server.js` for the ground-truth 38-collection inventory; `grep -n "customEmployees\|customHrbps\|..." server.js` for the lane-selection pattern. `[VERIFIED: codebase grep]`
- `.planning/research/STACK.md`, `.planning/research/PITFALLS.md`, `.planning/codebase/CONCERNS.md` — prior project-level research, treated as canonical per this phase's CONTEXT.md instruction to build on, not re-derive.

### Secondary (MEDIUM confidence)
- None — every claim in this document was either directly tool-verified this session or is a design recommendation explicitly reasoned from the verified facts and the locked CONTEXT.md decisions.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack / native-binary bundling (FND-04): **HIGH** — verified by direct tarball download and binary inspection, the strongest possible evidence short of running the actual boot test on all 3 platforms (which remains a manual `checkpoint:human-verify` for non-Mac platforms).
- Concurrency merge algorithm (FND-03): **HIGH** for the design reasoning (grounded directly in this codebase's actual read-modify-write call sites, read in full); **MEDIUM** for "this exact algorithm is what the planner will implement" since it's a novel design for this specific codebase, not copied from an external verified source — flag for code review once implemented.
- Schema shape (D-08 discretion): **HIGH** — directly reconciles STACK.md's longer-term vision with this phase's locked constraints (D-01, D-05, D-06), with explicit reasoning for the divergence.
- Migration idempotency / round-trip diff (FND-01): **HIGH** — concrete, dependency-free algorithm, cross-checked against PITFALLS.md's own re-runnability guidance.
- Collection inventory completeness: **HIGH** — directly grep-verified against the live codebase, catching a real gap in CONTEXT.md's own characterization of `readDb()`'s defaulting block as "authoritative."

**Research date:** 2026-07-23
**Valid until:** 30 days for the design/algorithm recommendations (stable); the exact `better-sqlite3` version pin (13.0.1) should be re-verified with `npm view better-sqlite3 version` immediately before the `npm install` step if planning/execution is delayed more than a few days, since this is an actively-maintained package.
