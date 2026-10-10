---
phase: 09-optimistic-locking-conflict-recovery
plan: 09
subsystem: api
tags: [optimistic-locking, conflict, versionRequired, server.js, test-sweep, gap-closure]
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "09-08 tracer: conflictIfStale() requirePrecondition option, VERSION_REQUIRED_MESSAGE, test/helpers/held-version.js, RAID routes strict"
provides:
  - "requirePrecondition opt-in on all 23 conflictIfStale() call sites in server.js"
  - "installHeldVersionFetch() installed in 20 non-contract suites (plus dd-findings from 09-08)"
  - "explicit version: 0 on the setup writes of 25 contract cases in optimistic-locking-contract.test.js"
affects: [09-10 (folds the opt-in into conflictIfStale() and deletes the option), 09-15 (asset ?v= stamp bump, T-09-41)]
tech-stack:
  added: []
  patterns:
    - "per-family strict rollout: opt-in + the suites that family breaks swept in the same commit (GD-2)"
    - "non-contract suites install the held-version fetch wrapper; the contract suite states preconditions explicitly (GD-3)"
key-files:
  created: []
  modified:
    - server.js
    - test/optimistic-locking-contract.test.js
    - test/synergy-stage.test.js
    - test/synergy-cost.test.js
    - test/synergy-phasing.test.js
    - test/synergy-rollup-split.test.js
    - test/synergy-staleness.test.js
    - test/synergy-tasks.test.js
    - test/org-decisions.test.js
    - test/org-flight-risk-audit.test.js
    - test/org-flight-risk-conversion.test.js
    - test/org-positions.test.js
    - test/org-summary.test.js
    - test/raid-access-filter.test.js
    - test/task-access-filter.test.js
    - test/reports-pack.test.js
    - test/reports-export.test.js
    - test/dd-seed.test.js
    - test/dd-summary.test.js
    - test/dd-vdr.test.js
    - test/dd-workspace.test.js
    - test/deal-wizard.test.js
key-decisions:
  - "Case (15) negative control keeps its assertions: it now sends version: 0 (the stored version of a never-edited record) so it passes the precheck and still reaches the CR-02 unrecognized-stage 409; its explanatory comment was rewritten to say so."
  - "DD opt-in added as a key inside the existing options object, after clearanceFilter — call order and ddAreaRefused() ordering untouched."
patterns-established:
  - "Strict rule is bitten family by family: server opt-in and the exact broken suites change in one commit, so every commit is green."
requirements-completed: [CONC-02]
duration: ~35min
completed: 2026-10-10
status: complete
actuals:
  tokens: 9000
  tasks: 3
  commits: 3
---

# Phase 9 Plan 09: Per-family strict precondition rollout Summary

**Every one of the 23 versioned write routes in server.js now refuses a precondition-less update or delete in a real deal (400 `versionRequired`), rolled out task/synergy then org then DD, with the 20 non-contract suites supplied the held-version precondition and the contract file stating `version: 0` explicitly.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 of 3
- **Files modified:** 22 (exactly the plan's `files_modified`; no extra file needed touching)

## Accomplishments

- All 23 `conflictIfStale(` call sites pass `requirePrecondition: true` (verified: 23 call sites carry the option; the 24th grep hit for `conflictIfStale(req, res` is the function definition).
- The demo store stays lenient (D-09): the option is a no-op for `req.isDemo === true`, unchanged from 09-08.
- Suite is 791/791 green at the final state and was green at each commit's own family; no assertion about a stale write, a 409 body, a clearance filter or a business rule was weakened or removed.

## Task Commits

1. **Task 1 (tracer): integration-task + synergy families strict** — `690df6d`
2. **Task 2: org positions, flight-risk, convert strict** — `dee4203`
3. **Task 3: DD request items, findings, convert strict + soak** — `0b6e8bd`

## Call sites by route (23)

| Family | Routes | Commit |
|---|---|---|
| RAID (09-08) | POST /api/raid, DELETE /api/raid/:id | 09-08 |
| integration tasks (2) | POST /api/integration-tasks, DELETE /api/integration-tasks/:id | 690df6d |
| synergies (9) | POST /api/synergies, DELETE /api/synergies/:id, POST …/cost-entries, DELETE …/cost-entries/:eid, POST …/generate-phasing, POST …/phasing/:month, POST …/stage, POST …/rebaseline, POST …/confirm-current | 690df6d |
| org (5) | POST /api/org/positions, DELETE /api/org/positions/:id, POST /api/org/flight-risk, DELETE /api/org/flight-risk/:id, POST /api/org/flight-risk/:id/convert | dee4203 |
| DD (5) | DELETE /api/dd/request-items/:id, POST /api/dd/request-items, DELETE /api/dd/findings/:id, POST /api/dd/findings, POST /api/dd/findings/:id/convert | 0b6e8bd |

## Suites touched

- Helper installed (`require('./helpers/held-version.js').installHeldVersionFetch()` + GD-3 comment, one line each): synergy-stage, synergy-cost, synergy-phasing, synergy-rollup-split, synergy-staleness, synergy-tasks; org-decisions, org-flight-risk-audit, org-flight-risk-conversion, org-positions, org-summary, raid-access-filter, task-access-filter, reports-pack; dd-seed, dd-summary, dd-vdr, dd-workspace, deal-wizard, reports-export. (dd-findings was done in 09-08.)
- Contract file: explicit `version: 0` on setup writes of cases (5) (7) (9) (12) (13) (14) (15) (26) (27) (30) (33) (34) (37) (38) (39) (40) (17) (18) (21) (23) (24) (41) (42) and Part 3 dual-lane 2 and 3. Case (15)'s comment was rewritten (its assertions are unchanged).
- Files touched beyond `files_modified`: none. The planner's measured set was exact.

## Verification

- `node --test` on the family suites + contract file: green after each task (7 failures per family in the contract file before the explicit-precondition edits, exactly the planner's measured list).
- `node --test --test-name-pattern="(25|CR-01)" test/optimistic-locking-contract.test.js`: 5/5 (ddAreaRefused-before-conflictIfStale ordering and CR-01 clearance parity intact).
- `npm test`: 791/791 at the final state.
- `node --test test/optimistic-locking-cross-process.test.js`: 7/7, unmodified.
- `SOAK_DURATION_MS=15000 npm run soak`: PASS — 1142 acknowledged / 0 missing / 0 committed-but-unaudited, audit 1:1, conflict lane 108 acknowledged + 223 real 409s, version reconciles exactly.

## Deviations from Plan

None - plan executed exactly as written. (Case (15)'s comment edit is within the plan's "setup requests only" intent: the request gained `version: 0`, the assertions are untouched.)

## Issues Encountered

- **Known environment flake (R5-02), not caused by this plan.** In the full `npm test`, roughly 1 run in 3 showed one failure that moved between runs and between files (org-summary (h), org-positions (cc), org-flight-risk-convert (d), dd-findings (c), deal-wizard (aa)). Where the output was captured (dd-findings (c), deal-wizard (aa)) it was a `404` on a plain GET — the "foreign local listener answered" signature — and dd-findings (c) is a read test unaffected by the strict rule. Every failing file passed when re-run alone, and the full suite was 791/791 on the re-runs at both the Task 2 and Task 3 states. Recorded per the plan's flake rule; no change made.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths or schema changes. T-09-36/T-09-44 mitigations applied as planned; T-09-41 (cached pre-gap-closure client) remains for plan 09-15's `?v=` bump.

## Next Phase Readiness

All 23 call sites pass the opt-in, so plan 09-10 can fold `requirePrecondition` into `conflictIfStale()` unconditionally and delete the option; the 20 non-contract suites are already supplied the precondition a real client sends.

## Self-Check: PASSED

- server.js and all 21 test files: FOUND (modified, in `git diff 3139d5c HEAD --name-only`)
- Commits 690df6d, dee4203, 0b6e8bd: FOUND
