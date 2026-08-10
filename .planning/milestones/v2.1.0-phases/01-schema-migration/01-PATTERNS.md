# Phase 1: Schema & Migration - Pattern Map

**Mapped:** 2026-07-23
**Files analyzed:** 8 (new/modified)
**Analogs found:** 5 / 8 (in-repo); 2 external-library-only (no in-repo analog, by design — new capability); 1 partial

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `server.js` `readDb()`/`writeDb()` (rewrite ~lines 244-380) | service (persistence layer) | CRUD | itself (`server.js:244-380`, current impl) — direct predecessor, not external | exact (in-place rewrite) |
| `db/collections.js` | config/utility (schema inventory) | — | `readDb()`'s inline defaulting block (`server.js:258-328`) — the closest thing to a "collection list" today, though incomplete (see Pitfall 1) | role-match, needs correction |
| `db/schema.sql` | config (DDL) | — | none in-repo (no SQL file exists today) — model directly on Code Examples "Pattern 2" in 01-RESEARCH.md | no analog |
| `scripts/migrate-db-json-to-sqlite.js` | utility (offline batch script) | batch/transform | none in-repo (`scripts/` dir doesn't exist yet) — closest conceptual analog is `writeDb`'s atomic-temp-file+rename discipline (`server.js:351-380`) for "never corrupt on partial write" | no direct analog, borrow atomicity discipline |
| `scripts/verify-migration.js` (or `--verify` mode folded into the above) | utility (verification/diff) | batch/transform | none in-repo — hand-roll per RESEARCH.md's canonical-diff Code Example | no analog |
| `test/concurrent-write.test.js` | test | event-driven (concurrency) | **none — this repo has ZERO test files today** (verified: no `*.test.js`/`*.spec.js`, no jest/vitest/mocha config anywhere outside node_modules) | no analog — first test file in repo |
| `package.json` (`engines.node` bump, add `better-sqlite3` dep) | config | — | itself — existing `dependencies`/`engines` block, same file, same conventions | exact (edit in place) |
| `.gitignore` + download-zip exclusion (`server.js:411`) | config | — | itself — existing `db.json.tmp`/`db.json.bak` exclusion entries (both `.gitignore` and the `zip -x` arg list) | exact (extend existing pattern) |

## Pattern Assignments

### `server.js` — `readDb()`/`writeDb()` rewrite (service, CRUD)

**Analog:** the current `readDb()`/`writeDb()` themselves (`server.js:244-380`) — this is a rewrite-in-place, not a new file, so the "analog" is the existing contract every one of the ~90 endpoint call sites already depends on.

**Current signature/contract to preserve (D-03)** (`server.js:249-349`):
```javascript
function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return { settings: {...}, questions: [], assessments: [], modules: [], employees: [], hrbps: [], alerts: [], pulses: [] };
    }
    const mtime = fs.statSync(DB_FILE).mtimeMs;
    if (_dbCache && mtime === _dbMtime) return _dbCache;   // <-- mtime cache: REMOVE per RESEARCH.md Pitfall 3 (SQLite reads are sub-ms; no cache needed)
    const data = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(data);
    parsed.settings = parsed.settings || {};
    parsed.customSettings = parsed.customSettings || {};
    parsed.questions = parsed.questions || [];
    // ... 30+ more `parsed.X = parsed.X || []` defaulting lines (lines 258-328) ...
    parsed.activeProjectId = parsed.activeProjectId || 'proj_demo';
    _dbCache = parsed;
    _dbMtime = mtime;
    return parsed;
  } catch (error) {
    // never wipe on read failure — see Error-path guard excerpt below
  }
}
```

**Error-path guard to preserve conceptually** (`server.js:332-348`):
```javascript
catch (error) {
  console.error('Error reading database file:', error);
  // Never silently hand back an EMPTY database when a real db.json exists — the
  // next writeDb() would then persist that empty skeleton over all the real data
  // (permanent wipe). Prefer the last good in-memory copy; if there is none but a
  // non-empty file is present, fail loudly so mutating endpoints 500 instead of
  // clobbering.
  if (_dbCache) return _dbCache;
  try {
    if (fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0) {
      throw new Error('db.json exists but could not be parsed; refusing to serve/overwrite it with an empty database.');
    }
  } catch (guardErr) {
    if (/refusing to serve/.test(guardErr.message)) throw guardErr;
  }
  return { settings: {...}, questions: [], ... };
}
```
Port this "never wipe on failure" intent to the SQLite version: if the `.db` file exists but a query throws (corrupt file, locked file, etc.), fail loudly (throw / 500) rather than silently returning/persisting an empty object. There's no in-memory "last good copy" fallback needed anymore since SQLite is the source of truth on every call (no cache), but the throw-loudly-on-corruption behavior must be preserved.

**Current `writeDb` atomic-write discipline to preserve conceptually** (`server.js:351-380`):
```javascript
function writeDb(data) {
  try {
    if (fs.existsSync(DB_FILE) && fs.statSync(DB_FILE).size > 0) {
      fs.copyFileSync(DB_FILE, DB_FILE + '.bak');           // rolling backup before overwrite
    }
  } catch (e) { console.warn('db backup skipped:', e && e.message); }
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);                             // atomic rename — never a half-written file
    _dbCache = data;
    _dbMtime = fs.statSync(DB_FILE).mtimeMs;
    return true;
  } catch (error) {
    console.error('Error writing to database file:', error);
    throw new Error('Failed to persist database');           // surface failure, don't swallow it
  }
}
```
The atomic-rename-over-temp-file trick doesn't map 1:1 to SQLite (WAL mode + `db.transaction()` gives atomicity natively — see RESEARCH.md Pattern 1/Code Examples), but the THROW-ON-FAILURE contract (`throw new Error('Failed to persist database')`) must be preserved verbatim so every caller's existing (lack of) error handling still surfaces a 500 instead of silently succeeding.

**New implementation to use (from 01-RESEARCH.md "Code Examples" — already codebase-specific, not generic library boilerplate):** the snapshot-tagged `readDb()`/transactional-merge `writeDb()` pair given in full in RESEARCH.md lines 317-394. Copy that code directly; it already follows this repo's conventions (sync API matching `fs.readFileSync` mental model, throw-based error surfacing, `Object.defineProperty` non-enumerable metadata to avoid leaking into `JSON.stringify(db)` responses used throughout `server.js`).

---

### `db/collections.js` (config/utility, no data flow — static inventory)

**Analog:** `readDb()`'s inline defaulting block, `server.js:258-328` (~33 keys) — **INCOMPLETE, do not copy verbatim.**

**What to actually copy:** the grep-verified 38-key list from 01-RESEARCH.md "Pattern 3":
```
activeProjectId (singleton), alerts, assessmentInstances, assessments, assessmentTemplates,
banners, checklistTemplates, communications, courses, customAlerts, customAssessmentInstances,
customAssessments, customCommunications, customEmployees, customHrbps, customIntegrationTasks,
customRaidEntries, customSettings (singleton), customSynergyInitiatives, departments, employees,
hrbps, i18n (singleton), integrationTasks, media, menus (singleton), modules, pages,
processCatalog, projects, pulses, questions, ragUploads, raidEntries, settings (singleton),
slides, synergyInitiatives, users
```
`readDb()`'s block is missing `communications`, `customAlerts`, `customAssessments`, `customCommunications`, `customHrbps` — these exist via ad hoc `|| []` guards at scattered call sites, not in the defaulting block. `db/collections.js` must include all 38, split into `ARRAY_COLLECTIONS` (33) and `SINGLETON_KEYS` (5: `settings`, `customSettings`, `i18n`, `menus`, `activeProjectId`).

---

### `db/schema.sql` (config, DDL — no in-repo analog)

**No analog exists in this codebase** (first `.sql` file). Use 01-RESEARCH.md Code Examples "Pattern 2" verbatim as the template — one table per array collection (`id TEXT PRIMARY KEY`, `project_id TEXT`, `seq INTEGER`, `data TEXT NOT NULL` JSON blob) plus one shared `app_state(key TEXT PRIMARY KEY, data TEXT NOT NULL)` table for the 5 singleton keys. Do NOT normalize individual fields (per D-08 discretion resolution in RESEARCH.md — that's Phase 4/5).

---

### `scripts/migrate-db-json-to-sqlite.js` (utility, batch/transform — no in-repo analog)

**Closest borrowed discipline:** `writeDb`'s atomic-temp-file+rename pattern (`server.js:351-380`, excerpted above) — the migration script must apply the same "never leave a half-written artifact" discipline: build the SQLite file at a temp path (or inside one transaction with `DROP`+`CREATE`+repopulate), only "commit" (rename/finalize) on full success. Also borrow the newId()-preservation discipline already established at `server.js:379` (`function newId(prefix)`) — the migration must reuse each item's own existing id verbatim, never re-mint (RESEARCH.md Pitfall 5), exactly the way `newId()` is designed to avoid id-collision today.

**Concrete algorithm to implement:** RESEARCH.md's System Architecture Diagram + "Code Examples" section (readDb/writeDb reimplementation) is the direct template — the migration script's `--verify` mode should literally call the new `readDb()` against the freshly-migrated file and diff it against the source snapshot using the canonicalize/canonicalJSON functions given in RESEARCH.md lines 401-408.

---

### `test/concurrent-write.test.js` (test, event-driven/concurrency — NO ANALOG)

**No analog exists.** This repository has zero test files today — verified via `find` for `*.test.js`/`*.spec.js` and grep for jest/vitest/mocha config, all empty. This is the first test file ever added to this codebase. Use `node:test` (Node's built-in runner, zero new dependency, matches the project's stated "no build tooling" convention per `.claude/CLAUDE.md`). No existing project convention for test file structure to inherit — planner/builder should follow `node:test`'s own idiomatic `test()`/`describe()` API directly, e.g.:
```javascript
const { test } = require('node:test');
const assert = require('node:assert');
// spin up / call writeDb+readDb directly in-process, fire two concurrent
// "add a different item to the same collection" writes, assert BOTH survive.
```
Run via `node --test test/concurrent-write.test.js` (no config file, no framework install).

---

### `package.json` (config — edit in place)

**Analog:** itself, current state:
```json
"engines": { "node": ">=20" },
"dependencies": {
  "compression": "^1.8.1",
  "express": "^4.19.2",
  "pdf-parse": "^2.4.5"
}
```
**Edits required:** bump `engines.node` to `>=22` (better-sqlite3@13.0.1 requires it; both local dev Node v22.18.0 and bundled portable Node v22.23.1 already satisfy it — see RESEARCH.md Summary); add `"better-sqlite3": "13.0.1"` to `dependencies`, following the exact same flat-pin style already used for `pdf-parse`.

---

### `.gitignore` + download-zip exclusion (`server.js:411`) — config, edit in place

**Analog — existing `.gitignore` pattern for DB runtime artifacts** (verified full file):
```
# Database runtime artifacts (atomic-write temp + rolling backup)
db.json.tmp
db.json.bak
```
**Edit required:** add the SQLite WAL/SHM sidecars using the exact same section-comment style:
```
# SQLite runtime artifacts (WAL mode sidecars + rolling backup)
data/*.db-wal
data/*.db-shm
data/*.db.bak
```
(Adjust the `data/` prefix to whatever path the plan settles on — RESEARCH.md's Open Question #1 proposes `data/ma-portal.db`.) Note the top of `.gitignore` explicitly documents `node_modules/` is NOT ignored (committed for zero-install) — do not accidentally ignore `node_modules/better-sqlite3/prebuilds/`.

**Analog — existing download-zip exclusion list** (`server.js:411`, single line, verified verbatim):
```javascript
execSync(`zip -r "${zipPath}" . -x "node_modules/*" ".git/*" ".gemini/*" "public/ma-app.zip" "ma-portal.zip" "looxmaxing/*" ".playwright-mcp/*" ".DS_Store" "*/.DS_Store" "db.json" "db.json.tmp" "db.json.bak" ".env" ".env.*" "public/sent_emails/*" "sent_emails/*"`, { cwd: __dirname });
```
**Edit required (RESEARCH.md Pitfall 4, exact strings given):** extend the `-x` argument list to also exclude `"data/*.db"` `"data/*.db-wal"` `"data/*.db-shm"` `"data/*.db.bak"` — insert them adjacent to the existing `"db.json" "db.json.tmp" "db.json.bak"` triplet, same quoting style, same flat list (no nested logic). This must ship in the same wave that introduces the new file path — a working migration whose download-zip still bundles live `.db` data is not phase-complete (Pitfall 4 explicitly flags this as a checklist item, not a follow-up).

---

## Shared Patterns

### Throw-on-persist-failure (not swallow-and-200)
**Source:** `server.js:377-379` (current `writeDb` catch block) and `server.js:186` (`process.on('uncaughtException', ...)`, contextually — not read here but referenced in RESEARCH.md's error-handling conventions)
**Apply to:** the new `readDb()`/`writeDb()`, the migration script, and the verify script — every one of these must `throw` on unrecoverable failure, never return a falsy/empty value that lets an endpoint answer HTTP 200 on data that was never persisted.

### Non-enumerable metadata never leaks into JSON responses
**Source:** existing convention of using plain-object collections that are directly `res.json(db.someCollection)`-serialized throughout `server.js` (every `/api/*` GET handler serializes read-model objects straight to the client)
**Apply to:** the new `__snapshot` property `readDb()` stamps onto its return value MUST be defined via `Object.defineProperty(out, '__snapshot', { value: snapshot, enumerable: false })` (RESEARCH.md Code Examples, already specified this way) — this is a hard requirement, not a style choice, because dozens of endpoints do `res.json(readDb())`-adjacent things and an enumerable `__snapshot` would leak the internal id/hash map to every API client.

### Committed native-binary precedent (FND-04's exact model)
**Source:** `@napi-rs/canvas` v0.1.80 — 5 platform packages (`canvas-darwin-arm64`, `canvas-darwin-x64`, `canvas-linux-x64-gnu`, `canvas-win32-x64-msvc`, plus others in `package-lock.json`) already committed under `node_modules/@napi-rs/` for the zero-install release model (per `.claude/CLAUDE.md` line 56 and `package-lock.json:16-186`).
**Apply to:** `better-sqlite3@13.0.1` — per RESEARCH.md, this is actually SIMPLER than the canvas precedent (all 8 platform `.node` prebuilds ship inside the ONE npm tarball, no per-platform sub-package install needed). Still: commit the resulting `node_modules/better-sqlite3/` (with its `prebuilds/*.node` files) exactly the way `node_modules/@napi-rs/canvas*` is committed today — same `.gitignore` carve-out (`node_modules/` is NOT ignored, per the `.gitignore` header comment), same "verify all N binaries present and non-empty before cutting a release zip" discipline the canvas precedent already established (documented in the milestone-level STACK.md, referenced by 01-RESEARCH.md).

### Atomic-write-or-throw, never partial state
**Source:** `writeDb`'s temp-file+rename+rolling-backup pattern (`server.js:351-380`, fully excerpted above)
**Apply to:** the migration script (`scripts/migrate-db-json-to-sqlite.js`) and the SQLite `writeDb` reimplementation — both must guarantee no half-written artifact survives a crash/error, using the mechanism appropriate to each layer (temp-path + finalize for the migration script's output file; `better-sqlite3`'s `db.transaction()` for the request-serving `writeDb`).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `db/schema.sql` | config (DDL) | — | No `.sql` file exists anywhere in this codebase today; first SQL artifact. Use RESEARCH.md's Pattern 2 code example as the template instead of an in-repo analog. |
| `scripts/migrate-db-json-to-sqlite.js` | utility (batch script) | batch/transform | No `scripts/` directory exists yet; no prior one-off data-migration script in this codebase to model structure on. Borrow only the atomicity/id-preservation *disciplines* from `writeDb`/`newId()`, not file structure. |
| `scripts/verify-migration.js` | utility (verification) | batch/transform | Same as above — no prior verification/diff tooling exists. Use RESEARCH.md's canonical-diff Code Example directly. |
| `test/concurrent-write.test.js` | test | event-driven | **Confirmed: zero test files exist anywhere in this repository** (`find` for `*.test.js`/`*.spec.js` returned nothing; no jest/vitest/mocha config found outside `node_modules`). This is the first test ever added. Use `node:test`'s own idiomatic API — there is no house style to match yet, this file establishes it. |

## Metadata

**Analog search scope:** repo root (`server.js`, `package.json`, `.gitignore`, `package-lock.json`), full-file reads of `server.js` lines 1-420 (imports through download-zip endpoint), targeted greps for `canvas`, `@napi-rs`, `*.test.js`/`*.spec.js`, `scripts/`, `db/`, `test/` directories (none of the last three exist pre-phase).
**Files scanned:** `server.js` (~420 lines read), `package.json`, `.gitignore`, `package-lock.json` (napi-rs section), `.claude/CLAUDE.md` (stack section) — plus confirmation greps for absence of test infra and absence of a `scripts/`/`db/`/`test/` directory.
**Pattern extraction date:** 2026-07-23
</content>
