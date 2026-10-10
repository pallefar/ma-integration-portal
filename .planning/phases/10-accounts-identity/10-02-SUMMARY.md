---
phase: 10-accounts-identity
plan: 02
subsystem: testing
tags: [test-fixtures, identity, control-db, sessions, node-test]

requires:
  - phase: 08-concurrency-storage
    provides: busy-503 contract suite and temp control/runtime/demo trio harness
provides:
  - test/helpers/seed-identity.js (ensureUser, sessionAs) for seeding control.db accounts behind directly-created sessions
  - 13 suites whose session identities all have matching control.db accounts, so plan 10-03 can make the /api gate re-read role/disabled per request without breaking the suite
affects: [10-03 (strict per-request identity), any future suite that creates sessions directly]

actuals:
  tokens: 2000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Directly-created test sessions must be preceded by ensureUser(controlConn, {username, role}); ensureUser refuses a role that differs from the stored account"

key-files:
  created: [test/helpers/seed-identity.js]
  modified:
    - test/busy-503-contract.test.js
    - test/org-access-policy.test.js
    - test/org-flight-risk-conversion.test.js
    - test/org-decisions.test.js
    - test/org-dd-read-audit.test.js
    - test/org-flight-risk-audit.test.js
    - test/org-positions.test.js
    - test/org-summary.test.js
    - test/raid-access-filter.test.js
    - test/reports-export.test.js
    - test/reports-pack.test.js
    - test/task-access-filter.test.js
    - test/write-validation.test.js

key-decisions:
  - "Seed identities inside each suite's existing newSession() helper (one added line) rather than at each call site, so every identity a suite authenticates is covered, including future ones"
  - "ensureUser throws on a role mismatch with a stored account instead of overwriting or ignoring it (T-10-11): a snapshot role that differs from the account would silently change test meaning once the gate re-reads roles"

patterns-established:
  - "Strict-identity simulation as an early signal: a scratch-only preload wrapping db/sessions.js findSession (never committed)"

requirements-completed: [COLLAB-02]

coverage:
  - id: D1
    description: "seed-identity helper (ensureUser/sessionAs) with role-mismatch refusal"
    requirement: "COLLAB-02"
    verification:
      - kind: integration
        ref: "node --test test/busy-503-contract.test.js (plain and under strict-identity preload)"
        status: pass
  - id: D2
    description: "All 13 suites seed the control.db accounts behind their directly-created sessions"
    requirement: "COLLAB-02"
    verification:
      - kind: integration
        ref: "node --test (879/879 plain; 879/879 under strict-identity preload, 0 STRICT-MISSING)"
        status: pass

status: complete
---

# Phase 10 Plan 02: Seed session identities for strict per-request identity Summary

**Test-only prep for COLLAB-02: a `seed-identity` helper plus fixture-only edits so 13 suites seed a control.db account for every session they create directly, keeping the suite green once the gate re-reads accounts per request.**

## Accomplishments

- `test/helpers/seed-identity.js`: `ensureUser(controlConn, {username, role, name?})` inserts an account row (id = username, `seq` = max+1, no password hash) and is idempotent; it throws if an account already exists with a different role. `sessionAs(runtimeConn, controlConn, {...})` = `ensureUser` + `createSession`.
- Tracer (`test/busy-503-contract.test.js`): seeds `busy-503-contract-test` and `busy-503-contract-negctl` (hrbp). Baseline under the strict simulation: 2 failures, both `STRICT-MISSING`; after the change: 5/5 pass, 0 `STRICT-MISSING`.
- 12 further suites: each `newSession(username, role)` helper now calls `ensureUser(controlConn, { username, role })` before `createSession`. Covers pmo_hr, pmo_it, pmo_legal, pmo_uncleared, supporting, seed_admin and karen2, plus the four db.json accounts (already present, same role, so no-ops).
- No production file, assertion, route, payload or expected status changed (diff is 48 pure insertions in the 12 suites plus 6 in the tracer).

## Verification

| Run | Result |
| --- | --- |
| Strict simulation, full suite, BEFORE Task 2 | 7 missing identities (karen2, pmo_hr x16, pmo_it x14, pmo_legal x12, pmo_uncleared, seed_admin, supporting x2); 0 role mismatches |
| `node --test`, after Task 2 | 879 tests, 879 pass, 0 fail |
| Strict simulation, full suite, after Task 2 | 879 tests, 879 pass, 0 fail, no `STRICT-MISSING` / `STRICT-ROLE-MISMATCH` |
| `git status --porcelain data/` | empty |

The simulation is a scratch-only preload (not committed; `node --require <scratch>/strict-preload.js --test`) that wraps `db/sessions.js` `findSession` and returns null for a session whose username has no `findUser()` row. It approximates, but does not reproduce, the real gate (no disabled-account handling or session deletion). The authoritative proof is plan 10-03 Task 1's real full-suite run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Strict preload invoked via `node --require`, not `NODE_OPTIONS`**
- **Found during:** Task 1
- **Issue:** the sandbox refuses `NODE_OPTIONS=...` commands in a worktree-isolated agent.
- **Fix:** ran `node --require <scratch>/strict-preload.js --test [file]`; the node test runner forwards `--require` to each test-file subprocess, so the simulation applies to every suite. Same simulation, different flag.
- **Files modified:** none (scratch-only)

**2. [Observation] Test count is 879, plan states 878**
- The plan and orchestrator state 878 at base; the suite reports 879 on this worktree. This plan adds and removes no tests (only helper lines inside existing suites), so the one-test difference pre-dates this plan; not investigated further. Suite is fully green either way.

**3. [Plan intent] Seeding done in each suite's `newSession` helper**
- The plan says to call `ensureUser` where users are seeded or right before the first session. Calling it inside the shared `newSession` helper achieves the same (every session identity seeded before its session) with one added line per file and no call-site churn. No suite reused a username with two roles, so no username splits were needed.

## Known Stubs

None.

## Threat Flags

None. T-10-11 mitigated (ensureUser refuses role mismatch; no lenient fallback introduced). T-10-12 accepted: every listed suite already uses MA_* temp paths.

## Self-Check: PASSED

- test/helpers/seed-identity.js exists
- commits 93f6f06 (Task 1) and 58fd6c2 (Task 2) exist
- no STATE.md / ROADMAP.md / non-test source changes
