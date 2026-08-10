---
phase: 01-schema-migration
plan: 02
subsystem: database
tags: [better-sqlite3, sqlite, migration, node-test, snapshot-diff, concurrency]

# Dependency graph
requires:
  - phase: 01-schema-migration (Plan 01)
    provides: "better-sqlite3@13.0.1 vendored into committed node_modules with all 8 platform prebuilt binaries; engines.node bumped to >=22; .gitignore + admin download-zip export both exclude the SQLite artifact family"
provides:
  - "db/collections.js — single-source 38-key collection inventory (33 ARRAY_COLLECTIONS + 5 SINGLETON_KEYS)"
  - "db/schema.sql — one JSON-blob-per-row table per array collection + one app_state table for singletons"
  - "db/store.js — initDb(path)/readDb()/writeDb(data) SQLite compat layer with snapshot-tagged transactional merge"
  - "scripts/migrate-db-json-to-sqlite.js — re-runnable, verified (--verify) db.json -> SQLite migration"
  - "data/ma-portal.db — committed demo database migrated + verified from the committed db.json"
  - "server.js reading/writing exclusively through SQLite (mtime cache removed)"
  - "test/migration-roundtrip.test.js + test/concurrent-write.test.js — first test files in this repo (node:test)"
affects: [01-03-schema-migration (db.json retirement), phase-2-auth, phase-3-deal-resolver]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Snapshot-tagged three-way merge for writeDb(): readDb() stamps a hidden, non-enumerable __snapshot (per-collection id -> serialized-JSON Map) at read time; writeDb(data) diffs data[key] against data.__snapshot[key] (the caller's own read baseline), never against live DB state — this is what makes two concurrent same-collection adds both survive"
    - "JSON-blob-per-row schema: id/project_id/seq extracted as metadata columns, item itself stored untouched as a data TEXT column — sidesteps SQLite type-affinity coercion entirely, making the round-trip diff exact"
    - "Temp-path-then-finalize for offline migrations: the migration script builds its SQLite output at a temp path and only renames over --out on full success, so a crash/error never leaves a half-written database"
    - "Fallback row identity for id-less collections: users items have no `id` field (keyed by `username` only) — db/store.js's idOf() falls back to username when id is absent, used purely as an internal SQLite primary key, never mutating the stored item"

key-files:
  created:
    - db/collections.js
    - db/schema.sql
    - db/store.js
    - scripts/migrate-db-json-to-sqlite.js
    - data/ma-portal.db
    - test/migration-roundtrip.test.js
    - test/concurrent-write.test.js
  modified:
    - server.js

key-decisions:
  - "Tracer feedback gate: proceeded directly from Task 1 (tracer) to Task 2 without a mid-flight human-verify pause. The project's own workflow.human_verify_mode config is \"end-of-phase\" (mid-flight checkpoint:human-verify halts are suppressed by design), the tracer's <verify> is 100% automated with no visual/UI component, and it had already passed in full (round-trip diff, re-runnability, writeDb persistence, no __snapshot leak) before Task 2 began."
  - "users collection items have no `id` field (only `username`) — db/store.js's idOf() falls back to item.username as the internal SQLite row key for that one collection. This never mutates the stored item (the `data` column is still the exact untouched JSON) and does not affect the round-trip diff, which compares canonical JSON content per index, not the internal key."
  - "project_id is NULL for every item in every collection today — confirmed via direct grep (zero `.projectId` references in server.js) and codebase inspection; per-item project scoping doesn't exist yet (matches 01-RESEARCH.md Assumption A3). The column exists and is indexed for Phase 3's deal-resolver split but is inert this phase."

patterns-established:
  - "Single-source collection inventory: db/collections.js is imported by db/schema.sql's generation, db/store.js, and the migration script — never duplicated. Any future collection addition/removal touches exactly one file."
  - "node:test as the project's test framework (first test files ever added to this repo) — zero new dependency, matches the project's no-build-tooling convention."

requirements-completed: [FND-01, FND-02, FND-03]

coverage:
  - id: D1
    description: "Re-runnable, verified migration: db.json migrates into SQLite, reconstructs exactly (canonical-JSON deep diff + row-count parity across all 38 collections), and re-running from the same source reproduces identical output (ids reused verbatim, order-preserved)"
    requirement: "FND-01"
    verification:
      - kind: integration
        ref: "node scripts/migrate-db-json-to-sqlite.js --source db.json --out <tmp> --verify -> exit 0"
        status: pass
      - kind: unit
        ref: "test/migration-roundtrip.test.js#migration-roundtrip: reconstructs all 38 collections with exact canonical-JSON equality and row-count parity"
        status: pass
      - kind: unit
        ref: "test/migration-roundtrip.test.js#migration-roundtrip: re-running the migration from the same source reconstructs identically (re-runnable)"
        status: pass
    human_judgment: false
  - id: D2
    description: "server.js reads/writes exclusively through SQLite: readDb()/writeDb() sourced from db/store.js, the _dbCache/_dbMtime mtime cache is fully removed, no live code path touches db.json"
    requirement: "FND-02"
    verification:
      - kind: other
        ref: "grep -c \"_dbCache\" server.js -> 0"
        status: pass
      - kind: integration
        ref: "node -e boot-smoke: initDb + readDb + mutate + writeDb + readDb round-trips through data/ma-portal.db"
        status: pass
      - kind: integration
        ref: "manual server boot on :3099 — /healthz, GET /api/employees, GET /api/projects, POST /api/pulses all served correctly through the new store"
        status: pass
    human_judgment: false
  - id: D3
    description: "Concurrent writes never lose data: two independent readDb() snapshots of the SAME collection, each appending a different item, both survive after both writeDb() calls complete (no lost update)"
    requirement: "FND-03"
    verification:
      - kind: unit
        ref: "test/concurrent-write.test.js#concurrent-write: two same-collection concurrent adds both survive (no lost update)"
        status: pass
      - kind: unit
        ref: "test/concurrent-write.test.js#concurrent-write: two concurrent adds to DIFFERENT collections both survive"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-23
status: complete
---

# Phase 1 Plan 02: SQLite Schema + Verified Migration + Store Cutover + Concurrency Proofs Summary

**db.json fully replaced by a SQLite persistence layer: a snapshot-tagged transactional writeDb() merge that survives concurrent same-collection writes, a re-runnable migration verified by a canonical-JSON round-trip diff across all 38 collections, and server.js cut over with the mtime cache removed**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-23T20:47:00Z (approx)
- **Completed:** 2026-07-23T21:11:15Z
- **Tasks:** 3 of 3
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments
- Built `db/collections.js` as the single-source 38-key inventory (33 array collections + 5 singletons), correcting the 5-key gap in `readDb()`'s legacy defaulting block (`communications`, `customAlerts`, `customAssessments`, `customCommunications`, `customHrbps`)
- Built `db/schema.sql`: one JSON-blob-per-row table per array collection (`id`/`project_id`/`seq` metadata + untouched `data` blob) plus a shared `app_state` table for the 5 singletons
- Built `db/store.js`: `initDb()`/`readDb()`/`writeDb(data)` preserving the exact whole-object signatures the ~90 existing endpoints depend on; `readDb()` stamps a non-enumerable `__snapshot`; `writeDb()` diffs each collection against that request's own snapshot inside one transaction — the mechanism that closes the same-collection lost-update race
- Built `scripts/migrate-db-json-to-sqlite.js`: re-runnable `--source`/`--out`/`--verify` migration, temp-path-then-finalize, verified against the real committed `db.json` (0 mismatches across 38 collections)
- Generated and committed `data/ma-portal.db` — the migration output of the committed `db.json`, verified
- Cut `server.js` over to the SQLite store: removed the `_dbCache`/`_dbMtime` mtime cache and every direct `fs` read/write of `db.json`; boot-tested live (server started, `/healthz`, `GET /api/employees`, `GET /api/projects`, `POST /api/pulses` all round-tripped correctly)
- Added `test/migration-roundtrip.test.js` and `test/concurrent-write.test.js` — the first test files in this repository (`node:test`, zero new dependency), covering FND-01/D-06 and FND-03 respectively; both prove same-collection AND cross-collection concurrent writes survive with no lost update

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end SQLite persistence tracer — schema, migration, store, one collection round-trip verified** - `9ff8e8f` (feat)
2. **Task 2: Cut the live server over to the SQLite store** - `99c6c1c` (feat)
3. **Task 3: Automated proofs — full round-trip verification and concurrent-write no-lost-update** - `2194d1e` (test)

## Files Created/Modified
- `db/collections.js` - single-source 38-key inventory (ARRAY_COLLECTIONS[33] + SINGLETON_KEYS[5]), self-asserting its own length
- `db/schema.sql` - 33 collection tables (id/project_id/seq/data + project_id index) + `app_state` singleton table
- `db/store.js` - `initDb(path)`, `readDb()` (snapshot-tagged), `writeDb(data)` (transactional per-collection snapshot merge); `idOf()`/`projectIdOf()` helpers exported for reuse by the migration script
- `scripts/migrate-db-json-to-sqlite.js` - the re-runnable, verified migration; exports `runMigration`/`verifyMigration`/`canonicalize`/`canonicalJSON` for the test suite to reuse
- `data/ma-portal.db` - committed demo database (migration output of committed `db.json`)
- `server.js` - `readDb()`/`writeDb()` now sourced from `./db/store`; `_dbCache`/`_dbMtime` and all direct `db.json` file I/O removed; `DB_FILE` constant kept only as a documented dormant archive reference
- `test/migration-roundtrip.test.js` - FND-01/D-06 proof (round-trip deep diff + row-count parity + re-runnability)
- `test/concurrent-write.test.js` - FND-03 proof (same-collection and cross-collection concurrent-add survival)

## Decisions Made
- **Tracer feedback gate handled via config, not a mid-flight pause:** Task 1 is a `type="tracer"` task. The protocol calls for a `checkpoint:human-verify` pause after committing the tracer when auto-mode isn't active. This project's `.planning/config.json` has `workflow.human_verify_mode: "end-of-phase"` — the documented default that suppresses mid-flight `checkpoint:human-verify` halts in favor of end-of-phase batching. Since the tracer's `<verify>` is fully automated (no visual/UI component) and had already passed completely, execution proceeded directly to Task 2 rather than pausing. This decision and the full tracer verification evidence are recorded here for end-of-phase review.
- **`users` collection id fallback:** `db.json`'s `users` array items have no `id` field (only `username`, `name`, `role`, `salt`, `hash`) — confirmed via direct inspection, this is the one exception to "every item has an id" across all 33 array collections. `db/store.js`'s `idOf()` falls back to `item.username` for internal SQLite row-keying only; the stored `data` column and the round-trip diff (which compares canonical JSON per array index, not by internal key) are unaffected.
- **`project_id` is NULL everywhere today:** grep-confirmed zero `.projectId` references in `server.js` — no collection currently carries per-item project scoping (matches 01-RESEARCH.md's own Assumption A3 for the `custom*` shadow arrays, and turns out to hold for every other collection too). The column and its index exist per D-08 but are inert until Phase 3's deal-resolver.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Verify command inaccuracy] `node --test test/` fails on this Node v22.18.0 install**
- **Found during:** Task 3 verification
- **Issue:** The plan's and 01-RESEARCH.md's literal automated verify command, `node --test test/`, throws `Error: Cannot find module '.../test'` on this machine's Node v22.18.0 — it treats the bare directory path as a CommonJS module specifier instead of a test-file glob root. Reproduced identically in a brand-new scratch directory containing a single trivial `test/sample.test.js` with zero project code involved, confirming this is a Node CLI/version quirk, not a bug in this repo's test files or setup.
- **Fix:** No code fix needed (nothing broken in the test files themselves). Verified via `node --test` (Node's own default file-discovery, no path argument — correctly finds and runs both `test/*.test.js` files) and via the explicit glob `node --test 'test/**/*.test.js'` (also works). Both produce the identical 4-pass, 0-fail result as the intended `node --test test/` would have.
- **Files modified:** None (verification-only; no test or source file changed).
- **Verification:** `node --test` → `# tests 4 / # pass 4 / # fail 0`; `node --test 'test/**/*.test.js'` → same result.
- **Committed in:** N/A (no code change; documented in the Task 3 commit message, 2194d1e).

---

**Total deviations:** 1 auto-fixed (1 verify-command correction, no code/behavior impact)
**Impact on plan:** Zero impact on scope or correctness — both test files exist, both pass, and the substance of the plan's acceptance criteria (`node --test test/` passes both files) is met in full; only the literal shell invocation needed a Node-version-compatible substitution.

## Issues Encountered
- The Task 2 boot-smoke test (a `POST /api/pulses` against the live-booted server on `:3099`) wrote a test pulse into the SQLite WAL for the committed `data/ma-portal.db`, which got checkpointed into the main file on process exit. Caught via `git status --short data/` showing the file as modified after the boot test; restored with `git checkout -- data/ma-portal.db` (a single-file restore of my own just-created artifact — not a blanket reset) followed by deleting the stray `-wal`/`-shm` sidecars. Verified restored to the original 9-pulse committed state before any commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SQLite is now the sole live persistence layer; `db.json` remains on disk, untouched, as the read-only pre-migration archive per D-01.
- Plan 01-03 (this phase's remaining plan) can proceed with `db.json`'s formal reversible retirement/cutover step, now that FND-01 (verified migration), FND-02 (exclusive SQLite reads/writes), and FND-03 (no lost-update concurrency) are all closed and automated.
- `node --test` (not `node --test test/`) is the working invocation on this machine's Node version — future plans in this repo should use that form (or an explicit glob) in their own `<verify>` blocks.
- Cross-platform (Windows/Linux) boot verification against SQLite remains explicitly out of scope for this plan, per 01-01-SUMMARY.md's own note that it is Plan 03's responsibility.

---
*Phase: 01-schema-migration*
*Completed: 2026-07-23*

## Self-Check: PASSED

- FOUND: db/collections.js
- FOUND: db/schema.sql
- FOUND: db/store.js
- FOUND: scripts/migrate-db-json-to-sqlite.js
- FOUND: data/ma-portal.db
- FOUND: test/migration-roundtrip.test.js
- FOUND: test/concurrent-write.test.js
- FOUND: server.js (readDb/writeDb sourced from ./db/store; _dbCache removed)
- FOUND: commit 9ff8e8f (Task 1)
- FOUND: commit 99c6c1c (Task 2)
- FOUND: commit 2194d1e (Task 3)
