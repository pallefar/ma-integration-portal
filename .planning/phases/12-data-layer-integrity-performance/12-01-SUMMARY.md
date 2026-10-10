---
phase: 12-data-layer-integrity-performance
plan: 01
subsystem: testing
tags: [node-test, sqlite, test-isolation, audit, mnpi]

requires:
  - phase: 10-real-deal-mode
    provides: "D-10-01 committed-path refusal and the single openDbFile() choke point"
  - phase: 11-authorization-clean-room-closure
    provides: "11-04 static server.js-requirer guard (kept) and listenLocal loopback helper"
provides:
  - "assertTestIsolation() in db/dbFiles.js, wired into openDbFile(): a test run that resolves any <repo>/data path fails loudly with [test-isolation] and the MA_* fix"
  - "test/test-isolation-guard.test.js: pure-function + child-process proof (default-path open refused, server.js require refused, isolated open passes, real-mode [security] refusal wins)"
  - "Four leaking/unisolated suites fixed; full suite proven not to touch data/audit.db or data/runtime.db"
affects: [12-02, 12-03, 12-04, 12-15, "every later Phase 12 plan that adds a server-requiring suite"]

actuals:
  tokens: 5440
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Fail-loud guard at the single open choke point (same strategy as D-10-01)"
    - "Narrow, env-gated, test-only exemption (MA_TEST_ALLOW_COMMITTED_CONTROL_DB=1) that exempts exactly data/control.db"

key-files:
  created: [test/test-isolation-guard.test.js]
  modified:
    - db/dbFiles.js
    - test/write-validation-coverage.test.js
    - test/deal-seed.test.js
    - test/deal-wizard-page.test.js
    - test/accounts-writable-gate.test.js
    - test/real-mode-guards.test.js

key-decisions:
  - "Guard keyed on NODE_TEST_CONTEXT (set by Node's runner for every file and spawned child), inert in production, soak, UAT runners and CLIs"
  - "Guard placed AFTER the real-mode committed-path refusal and BEFORE ensurePrivateDir, so refused paths create nothing and real-mode tests still see [security]"
  - "One sanctioned exemption, MA_TEST_ALLOW_COMMITTED_CONTROL_DB=1, exempting exactly data/control.db (see Deviations)"

patterns-established:
  - "Every suite that requires server.js or db/* sets the five MA_* temp paths before the first require and removes the temp dir in test.after"

requirements-completed: [DATA-06]

duration: 12min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 01: Test isolation guard Summary

**`[test-isolation]` guard in `db/dbFiles.js openDbFile()` makes any `node --test` open of a `<repo>/data` path fail loudly with the MA_* fix; four unisolated suites fixed; two full runs (1271/1271) leave data/audit.db and data/runtime.db byte-identical.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2 (Task 1 tracer, Task 2 auto)
- **Commits:** 2 task commits
- **Files:** 1 created, 6 modified

## Accomplishments

- `assertTestIsolation(dbFilePath, env)` (exported) throws `[test-isolation] node --test may not open <repo-relative path> — set MA_CONTROL_DB_PATH, MA_RUNTIME_DB_PATH, MA_DEMO_DB_PATH, MA_DEALS_DIR and MA_AUDIT_DB_PATH (or MA_DATA_DIR with MA_MODE=real) ...` when `NODE_TEST_CONTEXT` is a non-empty string and the path (lexical `path.resolve` plus realpath of the nearest existing ancestor, so `data/../data` and symlinked spellings are caught) lies inside the committed data directory (covers data/*.db, data/deals/, data/real/).
- Wired into `openDbFile()` immediately after the real-mode committed-path refusal and before `ensurePrivateDir()` - a refused path creates no directory or file. Path resolution, file modes and pragmas untouched.
- `test/test-isolation-guard.test.js` (9 cases): pure-function refusals (incl. `..` and symlink spellings), the opt-in scope, inertness without `NODE_TEST_CONTEXT`, temp/look-alike-sibling paths allowed; spawnSync children prove a default-path open is refused and creates nothing, `require('./server.js')` with MA_* removed exits non-zero naming the fix, an all-MA_* temp open succeeds, and MA_MODE=real + committed path still yields the unchanged `[security]` message. data/audit.db and data/runtime.db stat state is snapshotted before/after every child probe.

## Task Commits

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | `1342676` | guard in db/dbFiles.js, test/test-isolation-guard.test.js, MA_* block in test/write-validation-coverage.test.js |
| 2 | `855fb62` | MA_* block / opt-in in the four suites the guard flagged |

Tracer gate (orchestrator policy: no interactive checkpoint): the tracer's `<verify>` (`node --test test/test-isolation-guard.test.js test/write-validation-coverage.test.js`) was re-run end-to-end and passed 9/9 before expansion.

## Informational full-suite run after Task 1 (guard only)

1268 tests, 1258 pass, 10 fail - every failure a `[test-isolation]` refusal, from exactly four files:

| File | Why it tripped the guard |
|------|--------------------------|
| test/accounts-writable-gate.test.js | not on the planner's list; deliberately boots with committed data/control.db ACTIVE (module-load crash, exit 7) |
| test/real-mode-guards.test.js | not on the planner's list; section A, same committed-control-active subject (2 tests) |
| test/deal-seed.test.js | `createDealDatabase()` resolved DEALS_DIR to the real `data/deals` (created a deal file there; 5 subtests + parent) |
| test/deal-wizard-page.test.js | `require('../server.js')` with no MA_* block (opened data/demo.db) |

(write-validation-coverage.test.js, fixed in Task 1, was the tracer's first offender: `require('../server.js')` with no MA_* block.)

## Files edited in Task 2 (measured, not the planner's candidate list)

- `test/deal-seed.test.js` - MA_* temp block (all five) before the first `db/*` require + `test.after` cleanup; one stale comment ("no way to override DEALS_DIR") updated. Only comment lines were removed.
- `test/deal-wizard-page.test.js` - MA_* temp block + `test.after` cleanup, `os` import added.
- `test/accounts-writable-gate.test.js`, `test/real-mode-guards.test.js` - one `process.env.MA_TEST_ALLOW_COMMITTED_CONTROL_DB = '1'` line each with a `[security]` comment.

Planner-listed candidates NOT edited because the guard did not flag them (they use temp `initDb(path)`, MA_* blocks of their own, or spawn children with their own env): bootstrap-admin, control-plane-serialization, db-file-layout, migration-roundtrip, real-mode-boot, reports-i18n, session-lifecycle, concurrent-write, writedb-merge. The guard run was the authority, as the plan stated.

`git diff -U0 -- test/` removed lines: only the six-line stale comment in deal-seed. No assertion, test name or tested behaviour changed.

## Proof: real data files untouched by a full run

The worktree starts with data/audit.db and data/runtime.db absent, so absence-before/after alone would be a weak proof. To make it a real equality, valid schema-only sentinel files were created at those paths (created via `openDbFile` against a temp dir, WAL-truncated, copied in; deleted after the proof; gitignored). Snapshot (sha256, bytes) before run 1 and after run 2:

| File | Before (and after run 1, and after run 2) |
|------|-----------------------------------------|
| data/audit.db | `cd340d9535dd78a3bcdd20a7476342025708ef550c5bbcf5234a1e55741b522a`, 24576 B |
| data/audit.db-wal / -shm | absent / absent |
| data/runtime.db | `ad0e523be98f4608ed82db139191a9127dfc64b963e346045e525bc548e47a93`, 36864 B |
| data/runtime.db-wal / -shm | absent / absent |
| data/demo.db | `63d552c4c4d8e301752d5f47b7f82b4fd391ee7d32534e7ea0b808cdcba805a8`, 1310720 B |
| data/control.db | `e83f049e9f018d84e363031a9b1c29613e0ad682d6585b6cee13f783c4854a72`, 36864 B |
| data/control.db-wal / -shm | absent / absent |
| data/ma-portal.db | `da9c2a0545713b386057e0ebeaaf7345486e68ed0fe7d56a766c048b00aac44a`, 1249280 B |

Run 1 (`node --test`): 1271 tests, 1271 pass, 0 fail; snapshot identical. Run 2 (second consecutive run): 1271/1271, snapshot identical (diff empty). `git status --porcelain` is empty after both (no data/*.db, no public/sent_emails changes).

One observation, not a leak: `data/demo.db-wal` (0 bytes) and `data/demo.db-shm` (32 KB) appear after a run. Cause: `test/org-positions.test.js` (oo/ss/tt) opens the committed data/demo.db directly with `better-sqlite3 { readonly: true }` for content assertions; a read-only open of a WAL-mode file creates empty sidecars. They are gitignored, the main file hash is unchanged, and the pre-existing suites already document "an absent and a zero-length -wal are the same state". Those reads bypass `openDbFile` and are outside the guard's scope (PD-18); they do not write.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Narrow opt-in exemption for the committed control.db**
- **Found during:** Task 1 informational full run (after the guard landed)
- **Issue:** `test/accounts-writable-gate.test.js` and section A of `test/real-mode-guards.test.js` (Phase 10 suites, not on the planner's candidate list) exist to prove that with the committed `data/control.db` ACTIVE every account write is 403 and the file never changes. `isCommittedControlDbActive()` compares identities against the committed file itself, so the scenario cannot be exercised against a temp copy; the plan's fix ("copy into the temp dir first") would silently delete the thing being tested.
- **Fix:** `assertTestIsolation` honours `MA_TEST_ALLOW_COMMITTED_CONTROL_DB=1` and then exempts exactly the committed `data/control.db` identity (never runtime.db, audit.db, demo.db, control.db-wal, deals/, real/). The two suites set it (their own committed-file hash assertions remain). It is consulted only inside the `NODE_TEST_CONTEXT` branch, so it is inert in production. Pure-function tests in test-isolation-guard pin the scope (only exact value `'1'`; every other data/ path still refused with the opt-in set).
- **Why this is within intent:** the leak R5-04 closed wrote data/audit.db and data/runtime.db; control.db is committed and tracked by git, writes show in `git status`, and those suites hash it before/after.
- **Files modified:** db/dbFiles.js, test/test-isolation-guard.test.js, test/accounts-writable-gate.test.js, test/real-mode-guards.test.js
- **Commits:** `1342676` (guard + its tests), `855fb62` (suite opt-ins)

**2. [Plan accuracy] Task 1 commit leaves the suite red until Task 2**
- The plan states this explicitly ("it may fail here with `[test-isolation]` refusals only, which Task 2 fixes"). Task 1 commit `1342676` has 10 guard-refusal failures in the four files above; `855fb62` is green. No other deviation.

**Total deviations:** 1 auto-fix (Rule 3). **Impact:** the exemption is a deliberate, narrow hole in an otherwise absolute guard; flagging it for the Fable review of Phase 12.

## Known Stubs

None.

## Threat Flags

None - the change removes a way for tests to write real files; no new network or auth surface.

## Threat model status

- T-12-01 (tests writing fabricated rows into real audit.db/runtime.db): mitigated - guard at the openDbFile choke point, child-process refusal proof, before/after sha256 proof above, 11-04 static guard (test/denial-audit.test.js) retained.
- T-12-02 (guard misfiring in production): mitigated - active only when NODE_TEST_CONTEXT is non-empty; the pure-function "inert without NODE_TEST_CONTEXT" case asserts it, and the guard test's child probes set the variable explicitly.

## Notes for the orchestrator

- After all wave-1 plans merge, run the full suite once before wave 2 (plan I-5): any suite a sibling plan creates without an MA_* block now fails with `[test-isolation]` and needs only the MA_* block added.
- The known `audit-security-events` flake did not appear in either full run.
- Host disk was 95% full; no scratch artifacts remain in the repo (sentinels and logs live under the session scratchpad / were deleted).

## Self-Check: PASSED

- db/dbFiles.js contains `[test-isolation]` and `assertTestIsolation` (definition, call in openDbFile, export).
- test/test-isolation-guard.test.js exists and passes (9 cases).
- Commits `1342676` and `855fb62` exist on branch worktree-agent-a32367112a847ab52.
- Full suite 1271/1271 twice; `git status --porcelain` empty before this SUMMARY.
