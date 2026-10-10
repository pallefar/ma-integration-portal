---
phase: 12-data-layer-integrity-performance
plan: 06
subsystem: database
tags: [sqlite, user_version, migrations, quick_check, readiness, healthz, boot-sweep]

requires:
  - phase: 12-01
    provides: "test-isolation guard (every test sets the MA_* paths) at the openDbFile choke point"
  - phase: 12-04
    provides: "client marker for non-retryable 503 (retryable:false, no Retry-After)"
provides:
  - "db/migrate.js: ordered forward-only per-family migrations under BEGIN IMMEDIATE, committed-file rule, backup + disk precondition"
  - "db/readiness.js: process-level readiness object + DbNotReadyError (no paths, no deal ids)"
  - "db/migrations/{control,runtime,deal}/001-baseline.js stamp-only baselines (audit family registered, no migrations yet)"
  - "openDbFile family wiring: fresh stamp, migrate-before-schema, quick_check, sticky not-ready"
  - "server.js boot: eager audit.db open (B-1) + registered-deal sweep (W-5), DbNotReadyError 503 handler, /healthz readiness"
affects: [12-08, 12-13, 12-05]

actuals:
  tokens: 60000
  tasks: 3
  commits: 3

key-files:
  created:
    - db/migrate.js
    - db/readiness.js
    - db/migrations/control/001-baseline.js
    - db/migrations/runtime/001-baseline.js
    - db/migrations/deal/001-baseline.js
    - test/schema-migrations.test.js
    - test/healthz-readiness.test.js
    - test/helpers/boot-probe.js
    - test/fixtures/migrations-probe/control/001-baseline.js
    - test/fixtures/migrations-broken/control/001-baseline.js
    - test/fixtures/migrations-broken/control/002-broken.js
    - test/fixtures/migrations-backup/control/001-baseline.js
    - test/fixtures/migrations-backup/control/002-backup-probe.js
  modified:
    - db/dbFiles.js
    - server.js

key-decisions:
  - "Family is derived from the schemaPath openDbFile already receives, so no call site changed; any other schema path (test-only) gets no version and no checks"
  - "Committed demo/control files are reported implied-v1 and never written; a pending non-baseline migration there is not-ready, not a write (PD-5)"
  - "A corruption error from the very first statement on an existing non-empty family file is classified integrity-check-failed (not a crash) so the instance can still report it"
  - "bootOpen catches ONLY DbNotReadyError; every other boot error still throws as before"

patterns-established:
  - "Boot-probe test helper: spawn the real app on a loopback ephemeral port against temp MA_* files, issue ordered probes, print one JSON line"
  - "Sticky refusal keyed by resolved path in openDbFile; the cached error object is rethrown (identity-asserted in tests)"

requirements-completed: [DATA-03, DATA-06]

duration: ~70min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 06: Schema versioning, migrations at boot, readiness on /healthz

**Every SQLite file now carries `PRAGMA user_version`; ordered forward-only migrations run at boot under BEGIN IMMEDIATE for control, runtime, deal/demo and audit; `quick_check` plus a sticky process-level not-ready state are reported by `/healthz`; audit.db and every registered deal file are opened before listen; the committed demo/control files are byte-identical after every run.**

## Accomplishments

- **Runner** (`db/migrate.js`): `loadMigrations` validates layout (NNN prefix == id, contiguous from 1, `up` present); `runMigrations` stamps fresh files at the family latest without running any `up()`, runs pending migrations on existing files inside `conn.transaction(...).immediate()` with the version re-read under the lock, and keeps an `SQLITE_BUSY*` as the normal retryable 503 (never a not-ready failure).
- **Backup migrations** (`backup: true`, used by 12-13): free-space precondition `3 x size + 64 MB` (injectable `freeBytes`, ignored in real mode) -> `insufficient-disk-for-migration`, nothing written; a failed `VACUUM INTO` removes its partial `.bak`; a stale `.pre-v<id>.bak` is replaced; backup is 0600.
- **Readiness** (`db/readiness.js`): `markNotReady` / `recordVersion` / `snapshot` / `DbNotReadyError`; the deal family is always exposed as file `deal` (never the id), others as basename.
- **openDbFile wiring**: real-mode committed refusal -> test-isolation guard -> sticky check -> create/chmod -> pragmas -> (fresh: schema exec then stamp | existing: quick_check except audit, migrate, then idempotent schema exec). Committed files go through the implied/never-write branch.
- **server.js**: `bootOpen(label, fn)` wraps each require-time open; new boot statements `bootOpen('audit', ...)` and `bootOpen('deals', sweep)` directly after the control open (before `sessions.pruneExpiredSessions`); a `DbNotReadyError` handler between the 404 and busy handlers answers 503 `retryable:false` with no Retry-After and a fixed body; `/healthz` returns the readiness snapshot (200 `ok` / 503 `not-ready`) and uses a `SELECT 1` liveness instead of `readDb()`.
- Test-only `MA_MIGRATIONS_DIR` loader; `MA_MODE=real` with it set is a `[security]` fatal at require time.

## Task Commits

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | `5a9e4a2` | migrate.js, readiness.js, three baselines, openDbFile wiring, server.js boot/handler/healthz, tracer tests |
| 2 | `fe20ace` | broken/backup fixtures, sticky/corrupt/disk/committed/real-mode/boot-sweep tests |
| 3 | `f0a00e1` | migration runner contract header (forward-only, committed-file rule, backup, rollback path) |

Tracer gate (orchestrator policy, no interactive checkpoint): the tracer `<verify>` (`node --test test/schema-migrations.test.js test/healthz-readiness.test.js test/db-file-layout.test.js test/file-modes.test.js` then the full suite) was re-run end-to-end and passed before expansion.

## Verification

- Full suite `node --test`: **1333 tests, 1333 pass, 0 fail** (19.6 s). Base was 1305.
- Task 2 verify list (schema-migrations, healthz-readiness, real-mode-boot, real-mode-guards, busy-503-contract, no-get-mutates): 53/53.
- Acceptance greps: `DbNotReadyError` in server.js = 6, `bootOpen('audit'` = 1, `bootOpen('deals'` = 1, `insufficient-disk-for-migration` in db/migrate.js = 1, `forward-only` in db/migrate.js = 3.

### Committed-file proof (T-12-54)

Phase 10 runner, lanes `dev-committed` + `demo-committed`
(`PLAYWRIGHT_PATH=...playwright node scripts/uat/phase10-walk.js --lane dev-committed --lane demo-committed`):

```
[lane:demo-committed] PASS - committed data/control.db AND control.db-wal unchanged across this lane
[data-integrity] PASS - committed data/demo.db and data/control.db (+ -wal) sha256 unchanged :: 4 value(s) identical
[data-integrity] PASS - `git status --porcelain -- data` unchanged :: clean
57 PASS, 0 FAIL    EXIT=0
```

sha256 before and after every run (identical):

```
e83f049e9f018d84e363031a9b1c29613e0ad682d6585b6cee13f783c4854a72  data/control.db
63d552c4c4d8e301752d5f47b7f82b4fd391ee7d32534e7ea0b808cdcba805a8  data/demo.db
```

A separate automated case (`schema-migrations: whole app: booting against the committed data/control.db ...`) boots the real app on the committed control.db and asserts it is reported `{ version: 1, files: 1, implied: true }`, `user_version` still 0 and the file byte-identical.

### Boot timing on a volume deal (1,000 tasks / 5,000 RAID / 200 positions, 2.72 MB, version-0 file)

| Open path | Time |
|-----------|------|
| before (no family: pragmas + schema exec only) | 1.1 ms |
| after, first open (quick_check + v0->1 stamp + schema exec) | 8.8 ms |
| after, reopen (quick_check + schema exec, no migration) | 7.1 ms |

The added cost is the `quick_check` pass and scales with file size (one pass per registered deal file at boot, once per file per process). Measured with an in-process open of a seeded temp file; the sweep itself logs `[readiness] deal sweep: <n> opened, <k> not ready, <ms> ms` (no ids).

### Readiness snapshot shape (`GET /healthz`)

```json
{ "status": "ok", "ts": 1760125000000,
  "readiness": { "ready": true, "failures": [],
    "versions": { "control": { "version": 1, "files": 1 }, "runtime": { "version": 1, "files": 1 },
                  "deal": { "version": 1, "files": 3 }, "audit": { "version": 0, "files": 1 } } } }
```
Not ready: HTTP 503, `status: "not-ready"`, `failures: [{ "family": "control", "file": "control.db", "migration": "002-broken", "reason": "migration-failed" }]` (deal family: `"file": "deal"`, no `migration` key for integrity failures). Committed implied files add `"implied": true` to the family entry.

## Deviations from Plan

### Auto-fixed / judgement calls

**1. [Task boundary] Runtime/deal baselines and the Task-2 production code landed in the Task 1 commit**
- **Found during:** Task 1
- **Issue:** the fresh-file stamp test covers all four families and `openDbFile`/`server.js` changes for quick_check, sticky not-ready, `bootOpen`, the central 503 handler and the sweep are one coherent edit of the same two files.
- **Fix:** Task 1 commit carries the full production implementation; Task 2 commit carries its behaviours' tests, the broken/backup fixtures and the `insufficient-disk-for-migration` literal. Behaviour coverage and acceptance criteria are unchanged.

**2. [Rule 2 - correctness] Corruption surfaced by the very first statement is classified, not crashed**
- **Issue:** a damaged header makes `PRAGMA journal_mode = WAL` itself throw `SQLITE_CORRUPT*`/`SQLITE_NOTADB` before `quick_check` can run.
- **Fix:** on an existing non-empty file of a known family that error is recorded as `integrity-check-failed` and the file refused (sticky); non-corruption errors are unchanged.

**3. [Rule 2 - robustness] Sweep tolerates a non-mintable deal id**
- A registered deal whose id fails `dealDbPath()` validation is skipped instead of crashing boot (only `DbNotReadyError` is caught per deal otherwise).

**4. [Scope] New helper `test/helpers/boot-probe.js`** (not in the plan's file list) shared by both new suites: child-boot probe runner plus fixture builders.

None of the above changes a Phase 8/9/10/11 contract.

## Issues Encountered

- **One full-suite hang under load (not a failure):** during one full run `test/optimistic-locking-cross-process.test.js` (a spawned-child stdin handshake test, CONC-02) stalled for ~13 minutes with one child idle; I killed my own stragglers. The file passes 7/7 in isolation 21/21 times, and two further full runs were 1333/1333. This is the known Phase 9 cross-process flake family (the file opens an already-versioned file; no new lock is taken by this plan's open path beyond a read-only `quick_check`). Recorded here, not fixed (file not touched by this plan).
- `audit-security-events` flake did not appear in any of the three full runs.

## Known Stubs

None.

## Threat Flags

None — no new network surface; `/healthz` content is path-free and id-free by test (T-12-52).

## Self-Check: PASSED

- Files exist: db/migrate.js, db/readiness.js, db/migrations/{control,runtime,deal}/001-baseline.js, test/schema-migrations.test.js, test/healthz-readiness.test.js, fixtures (probe/broken/backup).
- Commits exist: `5a9e4a2`, `fe20ace`, `f0a00e1`.
- `git status --porcelain` empty; no STATE.md / ROADMAP.md / data/*.db / public/sent_emails changes.
