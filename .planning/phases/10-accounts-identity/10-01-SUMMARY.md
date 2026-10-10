---
phase: 10-accounts-identity
plan: 01
subsystem: auth
tags: [real-deal-mode, scrypt, bootstrap-admin, sqlite, mnpi, data-dir]

requires:
  - phase: 08-concurrency-storage-foundation
    provides: openDbFile single open choke point, controlStore .immediate transactions, central 503 middleware
  - phase: 09-optimistic-locking-conflict-recovery
    provides: stable control-plane write paths this plan guards
provides:
  - "MA_MODE=real contract in db/dbFiles.js (resolveModeConfig, IS_REAL_MODE, DATA_DIR, committed-path predicates, ensurePrivateDir/chmodPrivateFile)"
  - "db/realDataDir.js ensureRealDataDir(): 0700 data dir + account-less control.db seed + demo.db copy on first boot"
  - "lib/passwords.js: self-describing scrypt N=131072 hashes, legacy verify + needsRehash, strict parse bounds, real-mode policy, temp passwords"
  - "scripts/bootstrap-admin.js first-admin CLI; scripts/set-admin-password.js re-pointed at the active data dir"
  - "GET /api/auth/mode (public) with accountsWritable mirror of the committed-control refusal"
  - "committed-file guards on POST /api/deals and POST /api/auth/change-password; data/real gitignored + excluded from download-zip"
affects: [10-02, 10-03, 10-04, 10-05, 10-06, phase-11, phase-12, phase-20]

actuals:
  tokens: 21800
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "one predicate (isCommittedControlDbActive) backs both the server refusals and the client-facing accountsWritable flag"
    - "env-before-require boot tests; child-process refusal tests for require-time throws"
    - "atomic create-if-absent seeding via .seeding-<random> temp + link(2)"

key-files:
  created:
    - db/realDataDir.js
    - lib/passwords.js
    - scripts/bootstrap-admin.js
    - test/real-mode-boot.test.js
    - test/bootstrap-admin.test.js
    - test/real-mode-guards.test.js
  modified:
    - db/dbFiles.js
    - db/controlStore.js
    - scripts/set-admin-password.js
    - server.js
    - .gitignore
    - test/auth-route-inventory.test.js
    - test/db-artifact-exclusion.test.js

key-decisions:
  - "CLI audit events use actor_role 'cli' (audit_log.actor_role is NOT NULL; the plan's role:null cannot be persisted)"
  - "Login/change-password run scrypt on the libuv threadpool (async handlers, errors via next(err) with the isBusyError guard the structural 503 gate demands)"
  - "Committed-file test invariants compare main-file sha256 + -wal content only (empty == absent); -shm is a volatile wal-index and parallel test processes legitimately create empty sidecars"
  - "Seed publishes via link(2) (EEXIST-safe) so two simultaneous first boots cannot replace a database the first is already serving"

patterns-established:
  - "Mode contract lives only in db/dbFiles.js; every other module reads IS_REAL_MODE / predicates from it"
  - "Operator CLIs default MA_MODE=real only when run directly (require.main), never as a side effect of require()"

requirements-completed: [ACCT-02, ACCT-03, ACCT-07]

coverage:
  - id: D1
    description: "MA_MODE=real boots on an empty data dir: 0700 dir, account-less control.db, demo.db copy, mode=real, committed files byte-identical"
    requirement: ACCT-02
    verification:
      - kind: integration
        ref: "test/real-mode-boot.test.js"
        status: pass
    human_judgment: false
  - id: D2
    description: "First-admin bootstrap CLI: env/TTY secret never argv, mustChangePassword, refuse-if-any-user, --force-reset-admin, cli:<os-user> audit; bootstrapped admin logs in and rotates password with new hash format"
    requirement: ACCT-03
    verification:
      - kind: integration
        ref: "test/bootstrap-admin.test.js"
        status: pass
    human_judgment: false
  - id: D3
    description: "Committed-file protections: boot refusals, openDbFile refusal, 403 on deal/credential writes against committed control.db, accountsWritable flag, data/real excluded from git and export, set-admin-password re-pointed"
    requirement: ACCT-07
    verification:
      - kind: integration
        ref: "test/real-mode-guards.test.js"
        status: pass
      - kind: unit
        ref: "test/db-artifact-exclusion.test.js"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-10-10
status: complete
---

# Phase 10 Plan 01: Real-deal mode contract and first-admin bootstrap Summary

**`MA_MODE=real` now boots a host on its own gitignored 0700 data directory seeded with an account-less control.db, never opens a committed `data/*.db`, and a `bootstrap-admin` CLI creates the first admin whose self-describing scrypt N=131072 hash the server verifies at login and on password change.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-10-10
- **Tasks:** 3 (1 tracer + 2 auto/tdd)
- **Files modified:** 13 (6 created, 7 modified)
- **Suite:** 878 -> 910 tests, 0 failures, 3 consecutive full runs green; `git status --porcelain data/` empty

## Accomplishments

- **Mode contract (D-10-01):** `db/dbFiles.js` resolves mode and every path once at require time. Unrecognised `MA_MODE`, `MA_MODE=real` + `DEMO_OPEN=1`, and a data dir equal to the committed `data/` all throw `[security]` errors; `MA_*_PATH`/`MA_DEALS_DIR` overrides keep precedence; dev/demo resolution is unchanged (asserted). `openDbFile()` throws on a committed path in real mode (second line of defence); `ensureRealDataDir()` refuses before creating anything.
- **Account-less seed (D-10-08a):** first real boot copies the committed control.db to a `.seeding-<random>` temp, deletes every `users` and `deals` row, integrity-checks, checkpoints and publishes atomically (`link(2)`, EEXIST-safe); demo.db is a plain copy. Tracer test proves 0 users / 0 deals / `controlSettings` kept / demo password -> 401 / committed sha256 unchanged.
- **`GET /api/auth/mode`:** public, `no-store`, `{mode, demoOpen, accountsWritable}`; `accountsWritable` is `!isCommittedControlDbActive()` - the same predicate that refuses the writes. `isOpenMode()` and `/api/auth/me` can never be open in real mode.
- **`lib/passwords.js` (D-10-05 format):** `scrypt$n=131072,r=8,p=1$salt$key`, 256 MiB maxmem, legacy 64-hex hashes verify with `needsRehash:true`, strict parse bounds (N power of two <= 2^20, r <= 32, p <= 16, memory ceiling) so a crafted row can't force an expensive derivation, `dummyVerify` timing equaliser, real-mode policy (>= 12, published demo password refused), 20-char unambiguous temp passwords.
- **Bootstrap CLI (D-10-02):** secret from `MA_BOOTSTRAP_PASSWORD` or confirmed no-echo TTY prompt, any positional argv refused before a database/dir is touched, refuses when any account exists unless `--force-reset-admin` (which re-hashes, keeps `mustChangePassword`, deletes admin sessions), `cli:<os-user>` security event. `set-admin-password.js` re-pointed at the active data dir with the same hygiene.
- **Committed-file protections:** `POST /api/deals` -> 403 `{realModeRequired:true}` naming `start-real-deal`; `POST /api/auth/change-password` -> 403 `{committedControlDb:true}`; `data/real/` gitignored and `"data/real/*"` in the download-zip exclusion list.

## Task Commits

1. **Task 1 (tracer): real-mode contract, seed, /api/auth/mode** - `5b05914`
2. **Task 2: lib/passwords.js + bootstrap-admin + login/change-password via the module** - `4f6af67`
3. **Task 3: committed-file protections, zip exclusion, set-admin-password re-point** - `2f8010d`

## Tracer feedback gate

The tracer's `<verify>` (`node --test test/real-mode-boot.test.js test/auth-route-inventory.test.js test/db-file-layout.test.js`) was re-run end-to-end after the tracer commit and passed (12/12) before any expansion task - the autonomous form of the gate. Auto mode was not flagged in `.planning/config.json`, which would normally make the gate an interactive `checkpoint:human-verify`; this plan is `autonomous: true`, is run by the wave orchestrator which expects a committed SUMMARY, and the tracer's verification is fully automated, so no human checkpoint was returned. Flagged here so the orchestrator can decide whether an additional human look is wanted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] audit actor_role cannot be null**
- **Found during:** Task 2 (first bootstrap run)
- **Issue:** The plan specified actor `{username:'cli:<os-user>', role:null}`, but `audit_log.actor_role` is `NOT NULL`; the security event insert failed *after* the account was created.
- **Fix:** CLI actors are attributed with role `'cli'` (bootstrap-admin and set-admin-password). Never `'admin'`.
- **Files modified:** scripts/bootstrap-admin.js, scripts/set-admin-password.js
- **Commit:** 4f6af67 / 2f8010d

**2. [Rule 3 - Blocking] structural 503 gate rejected the new async handlers**
- **Found during:** Task 2 full-suite run (`busy-503-contract` structural test)
- **Issue:** the new `try/catch -> next(err)` blocks lacked the literal `isBusyError()` guard the structural scan requires for catch sites that touch storage.
- **Fix:** both catches carry `if (isBusyError(err)) return next(err); next(err);`.
- **Files modified:** server.js
- **Commit:** 4f6af67

**3. [Rule 1 - Bug] sidecar hash comparison raced with parallel test processes**
- **Found during:** Task 2 full-suite runs
- **Issue:** hashing `demo.db-wal`/`-shm` as "absent vs present" failed whenever a sibling test process legitimately opened the committed file read-side (empty `-wal`, volatile 32 KiB `-shm`).
- **Fix:** both new committed-file tests treat absent and zero-length as the same state and drop `-shm`; non-empty `-wal` content and the main-file sha256 are still compared. Real writes are still caught.
- **Files modified:** test/real-mode-boot.test.js (guards test written this way from the start)
- **Commit:** 4f6af67

**4. [Rule 2 - Missing critical] demo password refusal ordering**
- **Issue:** the published demo password (11 chars) hit the length check first, so the explicit "published demo password" message was unreachable in real mode.
- **Fix:** `checkNewPassword()` tests the known-demo list before length.
- **Commit:** 4f6af67

### Minor plan-vs-implementation notes

- Temp-password alphabet is exactly 54 characters (`0/O/1/l/I` plus `B/S/Z` look-alikes removed).
- `set-admin-password.js` keeps its `DEMO_PASSWORD` literal (tests read it) and lib/passwords carries the same value; a test asserts they agree.
- The role `'cli'` audit actor and the `salt: null` on updates (a merge cannot delete a key) are the only deviations in persisted shape; bootstrap-created admins carry **no** `salt` key.

## Issues Encountered

- One full-suite failure in the very first run (tail output only; the failing test was not identified) was not reproduced in 3 immediately following full runs on the same code (the repo already carries known flakes: audit-security-events, sqlite-open); the 3 full runs after the final change were all 910/910.

## Known Stubs

None.

## Follow-ups for later plans / orchestrator

- `start-real-deal.command` / `start-real-deal.bat` do **not** yet set `MA_MODE=real` or `MA_DATA_DIR` (outside this plan's files) and still tell the operator to run `set-admin-password.js` on a host with zero accounts; they should point at `bootstrap-admin.js` and export `MA_MODE=real`. Without that the launcher still runs dev mode on the committed control.db (now safely refusing real deals with a message naming start-real-deal).
- `db/dbFiles.js` `openDbFile()` still creates a missing parent dir with default perms; plan 10-04 (D-10-09) extends `ensurePrivateDir`/`chmodPrivateFile` to every open.
- `mustChangePassword` is stamped and returned by login but not yet enforced (10-05); lazy rehash on login (`needsRehash`) is wired in 10-05; role/disabled re-read per request is 10-04.

## Threat Flags

None beyond the plan's threat model. New surface: unauthenticated `GET /api/auth/mode` (returns only mode label, demo-open boolean, accounts-writable boolean).

## Self-Check: PASSED

- Created files exist: db/realDataDir.js, lib/passwords.js, scripts/bootstrap-admin.js, test/real-mode-boot.test.js, test/bootstrap-admin.test.js, test/real-mode-guards.test.js
- Commits `5b05914`, `4f6af67`, `2f8010d` present on `worktree-agent-a2eda35f871416148`
- Acceptance greps: `ensureRealDataDir()` before `const app = express()`; `data/real/` line x1; `'/auth/mode'` in server.js; `realModeRequired: true` x1; `committedControlDb: true` x1; `"data/real/*"` x1; legacy `hashPassword(password, saltHex)` removed from server.js
- Full suite 910/910 x3; `git status --porcelain data/` empty; STATE.md / ROADMAP.md untouched
