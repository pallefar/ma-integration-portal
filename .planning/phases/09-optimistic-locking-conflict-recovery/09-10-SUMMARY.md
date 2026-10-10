---
phase: 09-optimistic-locking-conflict-recovery
plan: 10
subsystem: api
tags: [optimistic-locking, conflict, versionRequired, server.js, gap-closure, edge-tests]
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "09-08/09-09: requirePrecondition opt-in on all 23 conflictIfStale() call sites, VERSION_REQUIRED_MESSAGE, test/helpers/held-version.js, held-version fetch swept into 20 suites"
provides:
  - "the precondition rule as one unconditional branch inside conflictIfStale() — no per-route option survives"
  - "test/optimistic-locking-precondition.test.js U1-U6, S1 (structural), T-table (23/23), T-demo, E-adjacency, E-invalid, E-ordering, E-idempotency"
  - "CR-01 (c) adapted to the strict default + new CR-01 (c2) proving arming precedes the new 400 return"
affects: [09-15 (09-01 truth amendment cites these tests), 09-16 (validation map, api-version-required walk), security re-verification]
tech-stack:
  added: []
  patterns:
    - "one rule, one place: the version precondition lives only in conflictIfStale(); the Part 1 gate forces every versioned handler through it and S1 forbids any option other than clearanceFilter"
    - "fail-closed demo predicate: only req.isDemo === true is lenient; missing resolver context is strict"
key-files:
  created: []
  modified:
    - server.js
    - test/optimistic-locking-precondition.test.js
    - test/optimistic-locking-contract.test.js
key-decisions:
  - "The rule is unconditional (`record && req.isDemo !== true`); the requirePrecondition option and its 23 call-site arguments were deleted, not defaulted — a future route cannot opt out."
  - "S1 is a real call-site parser (paren-balanced arguments, top-level object keys), not a grep, and asserts exactly 23 call sites so it cannot pass vacuously."
  - "Task 2 changed no server code: every one of the 23 routes already conformed to the T-table."
patterns-established:
  - "Probe edges (adjacency, invalid, ordering, idempotency) are explicit named tests on two families, never implicit in the per-route table."
requirements-completed: [CONC-02]
duration: ~25min
completed: 2026-10-10
status: complete
actuals:
  tokens: 11700
  tasks: 2
  commits: 2
---

# Phase 9 Plan 10: Unconditional precondition rule and per-route edge proofs Summary

**The version-precondition rule is now a single unconditional branch in `conflictIfStale()` (the opt-in is gone from all 23 call sites), proven per route by a 23-entry table and by explicit adjacency / invalid-input / ordering / idempotency edge tests, with the cross-process proof and the full-length soak green.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 of 2
- **Files modified:** 3 (exactly the plan's `files_modified`)

## Accomplishments

- `conflictIfStale()` refuses (400 `{ error, versionRequired: true }`) any request that reaches it for an existing record (`record` truthy) with no precondition, unless `req.isDemo === true`. A create (`record` falsy) is never refused. CR-01 arming remains the first statement, ahead of every return including the new 400.
- All 23 `requirePrecondition: true` arguments were removed; the five DD sites keep their `{ clearanceFilter: ... }` object unchanged. `grep requirePrecondition server.js` is empty.
- The doc comment of `conflictIfStale()` was rewritten: the two layers (PD-2), the precondition rule (GD-1/GD-1a/GD-1b/GD-2, D-02, D-06), the fail-closed demo predicate, creates never refused, the arming-order requirement, and a pointer to the Part 1 gate and S1. No other comment in server.js claimed a client could omit the version.
- Per-route proof: the T-table drives all 23 `VERSIONED_WRITE_ROUTES` entries in a deal-bound admin session — omit the precondition -> 400 `versionRequired` with a body of exactly two keys and the record byte-unchanged on re-read; send the stored version (0 for never-edited, 1 for the cost-entry and phasing routes whose prep stamps the initiative) -> success (< 400, not 409).

## Task Commits

1. **Task 1 (tracer): rule unconditional inside conflictIfStale()** — `5de2741`
2. **Task 2: per-route table and probe edges** — `a2dccc2`

## Tracer red/green record (Task 1)

U1-U6 and S1 were written first. Before the server change, U1, U3 and S1 failed (U2, U4, U5, U6 already held — they pin behaviour that must not regress). After the change all 16 tests in the file pass. CR-01 (c) was adapted: the "passes through" assertion now uses a demo-shaped request (`isDemo: true`), and a new sibling CR-01 (c2) asserts that a deal-shaped request returns `true` with 400 `versionRequired` AND that the clearance filter was armed first.

Mutation check (not committed): neutralising the new branch in server.js (`if (false && record && ...)`) turned P3, P5, U1, U3 and the T-table red; reverted.

## Edge coverage (Task 2)

| Edge | Test | Result |
|---|---|---|
| Adjacency | stored 2: precondition 1 and 3 -> 409 `currentVersion` 2; 2 -> 200, stored 3 | pass |
| Empty/invalid | body `version` null, "1", -1, 1.5 -> 400, record unchanged; `?expectedVersion=` "", "abc", "-1", "1.5" -> 400, record in place | pass |
| Ordering | B and C each hold v1, both 409 with currentVersion 2; reapply with v2 in either order -> one 200 (v3), one fresh 409 whose `currentRecord` carries the winner's value; run on RAID and integration tasks, both orders | pass |
| Idempotency | replayed success -> 409, stored version still 3; delete with current version -> 200, replayed delete -> 404 with no `conflict` field | pass |
| Demo leniency | unbound admin session: RAID update/delete, task update, synergy stage with no precondition -> never `versionRequired` | pass |

## Verification

- `node --test test/optimistic-locking-precondition.test.js`: 22/22 (was 9 before this plan).
- `node --test test/optimistic-locking-contract.test.js`: 57/57; `--test-name-pattern="CR-01"`: 5/5.
- `npm test`: 818/818 (base 804; +7 U/S1, +1 CR-01 (c2), +6 Task 2 tests). Two consecutive fully green runs at the final state.
- `node --test test/optimistic-locking-cross-process.test.js`: 7/7, file unmodified.
- `npm run soak` (full length, 3 processes, 120 s): **PASS** — 3945 acknowledged / 0 missing / 0 mismatched; 16 clean 503s (0.4%); 0 committed-but-unaudited; audit 1:1 (3945 rows, 0 missing, 0 duplicate, 0 extra); `integrity_check` ok on deal/control/audit; conflict lane 394 acknowledged + 878 real 409s + 3 bounded 503s, version reconciles exactly (1 -> 395); 0 conflicted writes leaked into the audit trail.

## Deviations from Plan

None - plan executed exactly as written. Task 2's `server.js` entry in `files_modified` was a standby (fix the server if a route disagreed with the table); no route did, so Task 2 changed no server code.

## Issues Encountered

- **Known environment flake (R5-02), not caused by this plan.** Of five full `npm test` runs at/after the Task 2 test file landed, two showed failures that moved between runs and files (org-import (h) alone; then reports-pack route + task-access-filter (e) + one more). org-import passed 18/18 when re-run alone, and the next two consecutive full runs were 818/818 each. None of the failing suites touch the files this plan changed beyond the already-green precondition behaviour; recorded per the gate's flake rule, no change made.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access or schema changes. T-09-36, T-09-42, T-09-43, T-09-44 mitigations applied as planned (S1 forbids per-route options; E-invalid covers every type-confusion variant; CR-01 (c)/(c2) cover arming order on both the demo-shaped and the deal-shaped (400) path); T-09-45 accepted and exercised by T-demo.

## Self-Check: PASSED

- server.js, test/optimistic-locking-precondition.test.js, test/optimistic-locking-contract.test.js: FOUND, modified as stated.
- Commits `5de2741` and `a2dccc2`: FOUND in `git log`.
- STATE.md, ROADMAP.md and the client files owned by 09-12/09-13: not touched.
