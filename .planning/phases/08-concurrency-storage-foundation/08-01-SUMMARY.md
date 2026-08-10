---
phase: 08-concurrency-storage-foundation
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, wal, concurrency, express, error-middleware]

# Dependency graph
requires: []
provides:
  - "busy_timeout 1000ms as the single, shared SQLite pragma contract (db/dbFiles.js openDbFile()) every SQLite file in the app opens through"
  - "db/store.js writeDb() acquiring the write lock up front via BEGIN IMMEDIATE (.immediate transaction variant)"
  - "isBusyError(err) — the single, exported SQLITE_BUSY*-prefix predicate on server.js's app object, reused by later plans' local re-throw guards"
  - "one central Express error middleware mapping SQLite write-lock contention to 503 + Retry-After, mounted before the final 500 handler"
  - "test/concurrency-busy-retry.test.js — real multi-process contention proof (end-to-end 503 + zero-lost-update), the artifact 08-RESEARCH.md/08-PATTERNS.md named for this plan"
affects: [08-02, 08-03, 08-04, 08-05]

# Actuals (#2632)
actuals:
  tokens: 6531
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQLite BEGIN IMMEDIATE + busy_timeout as the cross-process serialization authority (not the Node process) — D-01's generalized model"
    - "One central 4-arg Express error middleware mapping a specific err property to a response, positioned before the final generic handler"
    - "Real spawned node:child_process instances for multi-process contention tests — never Promise/timer simulation within one process (deadlocks)"

key-files:
  created:
    - test/concurrency-busy-retry.test.js
  modified:
    - db/dbFiles.js
    - db/store.js
    - server.js
    - test/db-file-layout.test.js

key-decisions:
  - "isBusyError() implemented as a pure prefix-test predicate on err.code (per PLAN.md's literal spec), not an `instanceof Database.SqliteError` check — avoids requiring better-sqlite3 in server.js purely for a type check, and a prefix test on err.code is already the stable, documented contract (RESEARCH.md 'Don't Hand-Roll')."
  - "Split the single planned test file into two atomic commits (Task 1's end-to-end proof, then Task 2's zero-lost-update proof appended to the same file) to honor per-task atomic commits despite both tasks sharing one file."
  - "test/db-file-layout.test.js's hardcoded busy_timeout=5000 assertion updated to 1000 (Rule 1 auto-fix) — a pre-existing test broken directly by this plan's own pragma change, required for npm test to stay green."

patterns-established:
  - "isBusyError(err): err && typeof err.code === 'string' && err.code.startsWith('SQLITE_BUSY') — the ONE definition of 'this error is contention', exported on server.js's app object for plan 08-03's re-throw guards to reuse."

requirements-completed: [CONC-01]

coverage:
  - id: D1
    description: "A write contended by a real second OS process returns 503 with a Retry-After header, and succeeds on identical retry once the lock releases — proven end-to-end through session -> resolver -> writeDb() -> central error middleware."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "test/concurrency-busy-retry.test.js#CONC-01 (end-to-end): a write contended by a real second OS process returns 503 + Retry-After, and succeeds identically once the lock releases"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two real OS processes issuing hundreds of interleaved writes (150 each, 300 total) against one shared SQLite deal file lose zero acknowledged writes; PRAGMA integrity_check returns ok; a row acknowledged by one process survives the other's later commits."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "test/concurrency-busy-retry.test.js#CONC-01 (zero-lost-update): two real processes issuing hundreds of interleaved writes lose zero acknowledged writes"
        status: pass
    human_judgment: false
  - id: D3
    description: "The 503 response body never leaks a SQLite error string, a filesystem path, or the resolved database file path — the fixed generic literal only."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "test/concurrency-busy-retry.test.js#CONC-01 (end-to-end) — the same test's body-content assertions"
        status: pass
    human_judgment: false
  - id: D4
    description: "isBusyError() correctly classifies SQLITE_BUSY and the WAL-specific SQLITE_BUSY_SNAPSHOT extended code as contention, and non-busy SqliteErrors as not-contention, without ever inspecting err.message."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "node -e assertion in PLAN.md's own <verify> block, re-run at plan close: app.isBusyError({code:'SQLITE_BUSY'})===true, app.isBusyError({code:'SQLITE_BUSY_SNAPSHOT'})===true, app.isBusyError({code:'SQLITE_CONSTRAINT'})===false, app.isBusyError(null)===false"
        status: pass
    human_judgment: false
  - id: D5
    description: "No committed data/ file was dirtied by the new test (all writes confined to fs.mkdtempSync temp directories); npm test full suite green with zero regressions."
    verification:
      - kind: other
        ref: "node scripts/wal-checkpoint.js && git status --porcelain data/ (empty) + npm test (689/689 pass)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-08-10
status: complete
---

# Phase 8 Plan 1: Concurrency & Storage Foundation — End-to-End Contended Write Summary

**A real second OS process contending a `/api/pulses` write against SQLite's own `BEGIN IMMEDIATE` write lock now gets a clean, bounded `503 Retry-After` — the gating architectural proof for the whole v2.2.0 milestone.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-10T20:22:00Z
- **Completed:** 2026-08-10T20:43:06Z
- **Tasks:** 2
- **Files modified:** 5 (4 modified, 1 created)

## Accomplishments

- `db/dbFiles.js`'s `openDbFile()` — the single pragma contract every SQLite file in the app opens through — now sets `busy_timeout = 1000` (was 5000), with the file header documenting the accepted event-loop-stall trade-off (D-04) at ~15-person deal-team scale.
- `db/store.js`'s `writeDb()` now acquires the write lock up front via the `.immediate` transaction variant (`BEGIN IMMEDIATE`), avoiding the mid-transaction lock-upgrade failure class; the snapshot-diff merge body itself is byte-identical, and no try/catch was added around `applyWrite(data)` — a `SqliteError` still propagates uncaught per the existing no-swallow contract.
- `server.js` gained `isBusyError(err)` (a `SQLITE_BUSY*` prefix test on `err.code`, exported on the app object) and ONE new central 4-arg error middleware mapping contention to `503` + `Retry-After: 1`, mounted immediately before the existing final 500 handler so non-contention errors are unaffected. The response body is a fixed generic literal, never `err.message`.
- `test/concurrency-busy-retry.test.js` (new) proves both halves of CONC-01 with REAL spawned `node:child_process` instances (never a Promise/timer simulation, which RESEARCH.md's Pitfall 3 confirms deadlocks in-process):
  - **End-to-end:** a child process holds `BEGIN IMMEDIATE` on `demo.db` for 2.5s (well past the 1s budget) while the parent drives a real HTTP `POST /api/pulses` through the full app; asserts `503` + `Retry-After`, a body with no leaked SQLite/path detail, then an identical retry that succeeds exactly once after the lock releases.
  - **Zero-lost-update:** two child processes each issue 150 interleaved `readDb()`/`writeDb()` cycles (300 total) directly against `db/store.js` on one shared, seeded deal file; asserts every id each child reported as *acknowledged* survives, the seeded baseline is never dropped, total row count matches exactly, `PRAGMA integrity_check` returns `ok`, and a negative control that child A's first acknowledged write survives every one of child B's later commits.
- No other call site changed — the ~90 existing `readDb()`/`writeDb()` endpoint callers are untouched, matching D-02.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end contended write — one path, wired through every layer** - `9365ad4` (feat)
2. **Task 2: Zero-lost-update proof across two writing processes** - `bd3998e` (test)

_Note: Task 2 extends the SAME test file Task 1 created — both tasks committed atomically against the shared file by writing/verifying/committing Task 1's content first, then appending and re-verifying Task 2's content before its own commit._

## Files Created/Modified

- `db/dbFiles.js` - `busy_timeout` pragma 5000ms → 1000ms (D-03/D-05/CONC-01); file header documents the accepted event-loop-stall trade-off (D-04)
- `db/store.js` - `writeDb()`'s `applyWrite` transaction changed to the `.immediate` variant (`BEGIN IMMEDIATE` acquired up front); transaction body unchanged
- `server.js` - new `isBusyError(err)` predicate + one central 503/Retry-After error middleware, both exported on the app object alongside `roleAllowedForWrite`
- `test/concurrency-busy-retry.test.js` (new) - real multi-process contention proof: end-to-end 503 + zero-lost-update, per D-12(a)
- `test/db-file-layout.test.js` - updated its `busy_timeout` assertion from the pre-Phase-8 value of 5000 to the new 1000 contract

## Decisions Made

- `isBusyError()` is a pure `err.code.startsWith('SQLITE_BUSY')` prefix-test predicate, exactly as PLAN.md specifies — not an `instanceof Database.SqliteError` check (which 08-PATTERNS.md's code example showed as one option). This avoids requiring `better-sqlite3` in `server.js` purely for a type check; `err.code` is already the stable, documented SQLite result-code contract (08-RESEARCH.md "Don't Hand-Roll").
- Split the single test file's two tasks into two atomic commits: wrote and verified Task 1's end-to-end test alone first (all four of Task 1's `<verify>` commands green), committed, then appended Task 2's zero-lost-update test to the same file, re-verified (Task 2's `<verify>` commands + full `npm test`), and committed separately — honoring per-task atomic commits even though both tasks share one file.
- Chose 150 iterations per child (300 total interleaved writes) for the zero-lost-update proof — comfortably within "several hundred" per D-12(a) while keeping the full test file's runtime under 4 seconds (well inside the 60s acceptance bound), since `writeDb()` issues a prepare() per array collection (38 collections) on every call regardless of delta.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `test/db-file-layout.test.js`'s hardcoded `busy_timeout` assertion broken by this plan's own pragma change**
- **Found during:** Task 1 verification (`npm test` full-suite run)
- **Issue:** A pre-existing Phase-3 test asserted `conn.pragma('busy_timeout', ...) === 5000` — directly falsified by this plan's Task 1 change to `db/dbFiles.js`'s `openDbFile()`.
- **Fix:** Updated the assertion to expect `1000` (Phase 8's new contract), with a comment referencing D-03/D-05/CONC-01 and the file header it now matches.
- **Files modified:** `test/db-file-layout.test.js`
- **Verification:** `npm test` — 689/689 pass (was 688/689 before the fix)
- **Committed in:** `9365ad4` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, Rule 1)
**Impact on plan:** Necessary to keep `npm test` green per this plan's own verification section (`npm test exits 0 — full suite, no regressions`). No scope creep — the fix touches only the one assertion this plan's own change falsified.

## Issues Encountered

None — both `node -e` verification scripts, both `node --test` runs, and both `npm test` full-suite runs passed on first attempt after implementation. No fix-attempt-limit issues, no auth gates, no checkpoints.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The gating architectural proof for v2.2.0 (D-01) is now committed and green: cross-process `BEGIN IMMEDIATE` + `busy_timeout` correctly serializes contended writes and the losing writer gets a clean, bounded 503.
- `isBusyError(err)` is exported and ready for plan 08-03's local `try/catch` re-throw-guard audit pass (the ~8 local catches in `server.js` that currently swallow write errors) and plan 08-02's control-plane serialization work.
- `test/concurrency-busy-retry.test.js` exists as named in 08-RESEARCH.md's Validation Architecture and 08-PATTERNS.md's file classification table — plans 08-02 through 08-04 reference it as an established precedent (`test/control-plane-serialization.test.js`, `test/busy-503-contract.test.js`, `test/client-busy-retry.test.js` are new files those plans still need to create).
- No blockers. The `readDb()` torn-read subtlety (08-RESEARCH.md Open Question 2) remains explicitly out of scope, as documented in PLAN.md's "Artifacts this phase produces" section.

---
*Phase: 08-concurrency-storage-foundation*
*Completed: 2026-08-10*

## Self-Check: PASSED

- FOUND: db/dbFiles.js, db/store.js, server.js, test/concurrency-busy-retry.test.js, test/db-file-layout.test.js
- FOUND: commit 9365ad4 (Task 1), commit bd3998e (Task 2) in `git log --oneline`
