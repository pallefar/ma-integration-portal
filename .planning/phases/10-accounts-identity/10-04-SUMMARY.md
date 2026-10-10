---
phase: 10-accounts-identity
plan: 04
subsystem: infra
tags: [file-modes, sqlite, wal, umask, mnpi, hardening]

requires:
  - phase: 10-accounts-identity
    provides: "10-01 real-deal mode contract, ensurePrivateDir/chmodPrivateFile helpers, ensureRealDataDir"
  - phase: 08-concurrency-storage-foundation
    provides: "openDbFile as the single open choke point with the WAL pragma contract"
provides:
  - "openDbFile() creates/opens every database 0600 (sidecars included) in 0700 directories under any umask"
  - "chmodPrivateFile(file, {preExisting, strict}) failure policy: dev/demo tolerates EPERM/EROFS on pre-existing paths with one [security] warning, real mode and self-created paths are fatal"
  - "test/file-modes.test.js: umask-022 proof across every database kind incl. a deal created through the API in real mode"
affects: [10-05, 10-08, phase-11, phase-12]

actuals:
  tokens: 6500
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "create-0600-then-chmod before SQLite opens the file so -wal/-shm inherit the main file's bits"
    - "chmod only directories the call itself created; pre-existing/shared parents are never touched"
    - "fs.chmodSync resolved on the fs object at call time so tests stub it (non-owned/read-only paths need root otherwise)"

key-files:
  created:
    - test/file-modes.test.js
  modified:
    - db/dbFiles.js

key-decisions:
  - "chmodPrivateFile skips the chmod when a file is already 0600 (stat first) so an un-chmod-able but already-private file never produces a spurious warning or a refusal"
  - "Pre-existing sidecars are chmodded both before and after the connection opens, narrowing the window in which a 0644 -wal from an earlier run is live"
  - "A connection that fails during pragma/schema setup is closed before the error propagates (previously leaked)"

patterns-established:
  - "All database files and directories are private by construction at the one choke point; no caller needs to chmod"

requirements-completed: [OPS-08]

coverage:
  - id: D1
    description: "Under umask 022 every database the app opens or creates (control, runtime, audit, demo, per-deal) is 0600 with 0600 sidecars, and every directory it creates is 0700; a pre-existing 0644 database/-wal is tightened on first open; pre-existing parent directories are never chmodded"
    requirement: OPS-08
    verification:
      - kind: unit
        ref: "test/file-modes.test.js (A) cases 2-4"
        status: pass
    human_judgment: false
  - id: D2
    description: "A pre-existing path that cannot be chmodded (EPERM/EROFS) logs one [security] warning and a dev/demo boot still serves /healthz; the same failure in real-deal mode refuses to boot; a failure on a self-created path or any other error code is always fatal"
    requirement: OPS-08
    verification:
      - kind: integration
        ref: "test/file-modes.test.js (A) cases 5-7, (B) both children"
        status: pass
    human_judgment: false
  - id: D3
    description: "A real-mode instance under umask 022 holds only 0700 directories and 0600 files after boot, login, deal creation, deal selection and a deal write; committed data/control.db and data/demo.db are unchanged"
    requirement: OPS-08
    verification:
      - kind: integration
        ref: "test/file-modes.test.js (C)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-10-10
status: complete
---

# Phase 10 Plan 04: Database file modes Summary

**`openDbFile()` is now the single choke point that leaves every database 0600 (with 0600 -wal/-shm) inside 0700 directories under any umask, tolerating un-chmod-able pre-existing paths in dev/demo with one `[security]` warning and refusing to boot on them in real-deal mode.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-10-10
- **Tasks:** 2 (1 tracer + 1 auto/tdd)
- **Files modified:** 2 (1 created, 1 modified)
- **Suite:** 911 -> 921 tests at plan end (`node --test`: 921 pass, 0 fail, run twice); `git status --porcelain data/` empty

## Accomplishments

- **Create-then-chmod at the choke point (D-10-09):** `openDbFile()` calls `ensurePrivateDir()` (only directories this call created become 0700), creates a missing file with `openSync(..., 'a', 0o600)` plus an explicit chmod (umask can strip bits), tightens a pre-existing 0644 file, tightens pre-existing `-wal`/`-shm` before opening and again after the pragma/schema contract has run. SQLite's unix VFS gives new sidecars the main file's bits, so a 0600 main file yields 0600 sidecars.
- **Failure policy (PRD acceptance 6):** `chmodPrivateFile(file, {preExisting, strict})`, `strict` defaulting to `IS_REAL_MODE`. win32 EPERM/ENOSYS ignored; pre-existing + non-strict + EPERM/EROFS -> one `[security] could not tighten <path> to 0600 (<code>) — dev/demo continues; real-deal mode refuses to start on this` per path; everything else (real mode, self-created path, any other code) throws `[security] could not restrict <path> to 0600 (<code>)`.
- **Proof under umask 022:** unit cases (nested creation, 0644 tighten incl. a 0644 `-wal`, a pre-existing 0755 parent left at 0755, EPERM and EROFS stubs warning exactly once while the connection still works and `strict` throws, self-created and EIO always fatal); two whole-app child processes (dev boot with stubbed-EPERM databases serves `/healthz` 200 with the warning on stderr; the same stub under `MA_MODE=real` exits non-zero with `[security] could not restrict`); and a real-mode child that boots, creates an admin, signs in, `POST /api/deals`, selects the deal and writes to it, then walks the data dir: every directory 0700, every `.db`/`-wal`/`-shm` 0600, committed `data/control.db`/`demo.db` sha256 unchanged.
- Verified non-vacuous: against the pre-change `db/dbFiles.js` 9 of the 10 tests fail (only the umask precondition passes).

## Task Commits

1. **Task 1 (tracer): openDbFile creates and opens every database 0600 in 0700 directories** - `c4a483b`
2. **Task 2: whole-app proof — real-mode boot + deal creation under umask 022** - `031a8df`

## Tracer feedback gate

The tracer's `<verify>` (`node --test test/file-modes.test.js test/db-file-layout.test.js`) passed 15/15 after the tracer commit and the full suite (920/920) was green before the expansion task. Auto mode is not flagged in `.planning/config.json` (`auto_advance: false`, `_auto_chain_active: false`; `human_verify_mode: end-of-phase`), which would normally make the gate an interactive `checkpoint:human-verify`. As in 10-01 the plan is `autonomous: true`, the orchestrator expects a committed SUMMARY, and the tracer's verification is fully automated, so no human checkpoint was returned. Flagged so the orchestrator can decide whether an additional human look is wanted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Skip the chmod on an already-0600 file**
- **Found during:** Task 1 design
- **Issue:** the plan always calls chmod on a pre-existing file; on a file we cannot chmod but which is already private (root-owned 0600 on a volume, read-only mount) that would warn spuriously in dev and refuse to boot in real mode for no reason.
- **Fix:** `chmodPrivateFile` stats first and returns when the mode is already 0600 (POSIX only).
- **Files modified:** db/dbFiles.js
- **Commit:** c4a483b

**2. [Rule 1 - Bug] Connection leaked when pragma/schema setup threw**
- **Found during:** Task 1
- **Issue:** with sidecar tightening now running after schema exec, a throw there (strict chmod failure) would have left an open handle on a file the app is refusing to use.
- **Fix:** the connection is closed before the original error propagates.
- **Files modified:** db/dbFiles.js
- **Commit:** c4a483b

### Minor plan-vs-implementation notes

- Pre-existing sidecars are tightened before the open as well as after (plan said after), narrowing the window in which an older 0644 `-wal` is live.
- Task 2 is marked `tdd="true"` but, because Task 1 already shipped the implementation, its tests pass on first run; the RED half was demonstrated retroactively by running the suite against the pre-change `db/dbFiles.js` (9 failures).
- Task 2 selects the created deal and POSTs a department so the deal database is opened through the resolver with live sidecars; without that the deal DB's `-wal`/`-shm` would be gone (createDealDatabase closes its connection) and the sidecar modes would be unproven.

## Issues Encountered

None. Dev-mode runs tighten the committed `data/control.db`/`demo.db` to 0600 on the working copy; git tracks only the executable bit, so `git status` stays clean (checked).

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths or schema changes; the plan only narrows filesystem permissions. T-10-23/24/26 mitigated and tested; T-10-25 (Windows ACLs) and T-10-57 accepted as planned and documented in code comments (DEPLOYMENT.md wording is 10-08).

## Follow-ups for later plans / orchestrator

- 10-08 should document in DEPLOYMENT.md that Windows relies on the user-profile ACL + full-disk encryption (T-10-25) and that dev/demo logs `[security] could not tighten` instead of failing.
- `scripts/*` seed tools that open files through `openDbFile()` inherit the new behaviour automatically; none were edited.

## Self-Check: PASSED

- Created/modified files exist: `db/dbFiles.js`, `test/file-modes.test.js`
- Commits `c4a483b`, `031a8df` present on `worktree-agent-ad63b4733fe88ebe7`
- Acceptance greps: `0o600` x4, `0o700` x3, `EROFS` x3, `could not tighten` x1 in db/dbFiles.js
- Full suite 921/921; `test/db-file-layout.test.js` passes; `git status --porcelain data/` empty; STATE.md / ROADMAP.md untouched
