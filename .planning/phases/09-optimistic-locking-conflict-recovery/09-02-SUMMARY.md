---
phase: 09-optimistic-locking-conflict-recovery
plan: 02
subsystem: api
tags: [express, zod, sqlite, optimistic-locking, conflict-resolution, vanilla-js]

# Dependency graph
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "Plan 01's tracer mechanism — conflictBody()/conflictIfStale() (server.js), the version-checked WHERE-clause layer inside writeDb() (db/store.js), VERSIONED_COLLECTIONS already listing both integrationTasks/customIntegrationTasks and synergyInitiatives/customSynergyInitiatives lanes (db/collections.js), and the client showConflictDialog()/409-branch in the ma-fetch-wrapper (public/js/transitions.js)"
provides:
  - "parseExpectedVersion(req) — the shared dual-channel (req.body.version / req.query.expectedVersion) input-resolution helper, with an explicit non-negative-integer bounds check on the query channel; conflictIfStale() now delegates to it"
  - "POST /api/integration-tasks and POST /api/synergies main upsert routes wired onto the conflict contract, including the kanban-shaped status-flip quick action (D-02 uniform check)"
  - "All seven synergy sub-routes (cost-entries add/delete, generate-phasing, per-month phasing, stage, rebaseline, confirm-current) wired onto the same contract — the cost-entries DELETE is the first route to use the query-channel form"
  - "version field on TaskUpsertSchema, SynergyUpsertSchema, and the six JSON-body-accepting synergy sub-route schemas (validators/workstream.js)"
affects: ["09-07"]

# Actuals (#2632)
actuals:
  tokens: 13236
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "parseExpectedVersion(req) dual-channel precondition resolution, reused by every DELETE-shaped or body-less route in later plans without re-deriving the bounds check per route"
    - "A route that echoes the mutated record on success (all synergy sub-routes but the whole-record DELETE) lets the client refresh its held version from the response, avoiding a same-tab self-conflict on the next write"

key-files:
  created: []
  modified:
    - server.js
    - validators/workstream.js
    - public/js/execution.js
    - test/optimistic-locking-contract.test.js
    - test/synergy-staleness.test.js

key-decisions:
  - "The plan named 'the task upsert near line 228' and 'the synergy save form near line 1066' as edit call sites to thread version through — both are actually CREATE-only forms (no `id` in their payload; there is no full-edit form for either record in this codebase, only inline field handlers and the dedicated sub-routes). Left both untouched, matching Plan 01's identical 'RAID save form' finding — a create carries no version precondition by definition."
  - "ConfirmCurrentSchema (Task 2) gained `version` as the SOLE exception to D-16's 'accepts no fields' guarantee — it carries no content of its own, only the optimistic-lock precondition, and the route mutates the initiative (stamps lastConfirmedAt) so D-02 gives it no exemption from the version check. Updated the pre-existing test/synergy-staleness.test.js assertion accordingly (it now asserts zero CONTENT fields are ever assigned, not a literal empty-object body)."
  - "The plan's Task 2 action text says 'the five [sub-routes] that already POST a JSON body add version to it', naming five, but the must_haves and acceptance criteria explicitly require confirm-current to also enforce the version precondition — a sixth JSON-body route. Threaded version through all six JSON-body routes (cost-entries add, generate-phasing, phasing-month, stage, rebaseline, confirm-current) plus the one query-channel route (cost-entries delete), matching the must_haves' explicit 'confirm-current' call-out over the action text's apparent miscount."
  - "[Rule 1 fix] DELETE /api/synergies/:id/cost-entries/:eid now echoes `{ success: true, initiative: item }` instead of the original `{ success: true }` — matching every sibling sub-route's response shape. Without the updated initiative in the response, the client would have no way to refresh the version it holds in memory after a successful delete, and the NEXT write in the same tab would resubmit the now-stale version and self-conflict against its own successful delete."

patterns-established:
  - "Every DELETE-shaped or otherwise body-less write route in this codebase now has a proven query-channel precondition path (?expectedVersion=) to follow, rather than needing to invent one per route."

requirements-completed: [CONC-02]

coverage:
  - id: D1
    description: "A stale-version update to an integration task is rejected 409 with the conflict marker, and the earlier writer's field values survive intact."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (5)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A stale-version update to a synergy initiative is rejected 409 with the conflict marker, and the earlier writer's field values survive intact."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (9)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A kanban status flip on an integration task (payload carrying only id/status/version) goes through the identical version check as a full edit — no quick-action carve-out."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (7)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every route that mutates an existing synergy initiative — the main upsert plus all seven sub-routes (cost-entries add/delete, generate-phasing, per-month phasing, stage, rebaseline, confirm-current) — enforces the version precondition; the pre-existing unrecognized-stage 409 stays distinguishable from a conflict 409."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (10, 12, 13, 14, 15)"
        status: pass
      - kind: other
        ref: "test/optimistic-locking-contract.test.js (16, structural) — source scan asserting conflictIfStale() precedes writeDb(db) in all seven sub-route handlers"
        status: pass
    human_judgment: false
  - id: D5
    description: "A create route (POST /api/integration-tasks/instantiate; POST /api/integration-tasks/from-remediation is structurally unmodified and untouched by conflictIfStale) carries no version precondition and still succeeds with no version in its payload."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (8)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The version precondition is resolvable either as a `version` JSON-body field or as an `expectedVersion` query parameter, through one shared parseExpectedVersion()/conflictIfStale() contract — proven on a DELETE-shaped route with no body."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (13, 14)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A non-integer or negative expectedVersion query value is rejected 400 before any record is mutated, never coerced."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (11)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The optimistic-lock `version` on a synergy initiative is documented at its schema declaration as distinct from the pre-existing per-entry `version` inside that same record's nested baselines array."
    requirement: "CONC-02"
    verification:
      - kind: other
        ref: "validators/workstream.js SynergyUpsertSchema `version` field comment (grep-verified: comment text distinguishes it from the nested baselines-array version at authoring time)"
        status: pass
    human_judgment: false
  - id: D9
    description: "npm test suite green with no regression against Plan 01's baseline (704 -> 726 tests, all passing)."
    verification:
      - kind: integration
        ref: "npm test (full suite)"
        status: pass
    human_judgment: false
  - id: D10
    description: "Manual two-tab browser verification on execution.html (both integration-task and synergy edit surfaces) — the plan's own <verification> section calls for this."
    verification: []
    human_judgment: true
    rationale: "This autonomous worktree execution has no browser available. Structural (grep-based) and HTTP-level integration tests give high confidence the server contract and client threading logic are correct, but the actual visual/interactive UX (dialog rendering, form-preservation on conflict, Escape/overlay-click dismissal) has not been human- or browser-verified. Mirrors Plan 01's identical D3 rationale."

duration: 24min
completed: 2026-08-11
status: complete
---

# Phase 9 Plan 2: Integration Tasks and Synergy Initiatives — Conflict-Safe Edits Summary

**Expanded Plan 01's proven optimistic-locking contract onto integration tasks and all nine synergy-initiative write routes (main upsert plus seven sub-routes), introducing a shared dual-channel `parseExpectedVersion()` helper that resolves the version precondition from either a JSON body or a query parameter — the plumbing the DELETE-shaped routes in later plans reuse.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-08-11T05:10:00Z
- **Completed:** 2026-08-11T05:34:06Z
- **Tasks:** 2
- **Files modified:** 5 (server.js, validators/workstream.js, public/js/execution.js, test/optimistic-locking-contract.test.js, test/synergy-staleness.test.js)

## Accomplishments

- `parseExpectedVersion(req)` — the single dual-channel input-resolution helper (`req.body.version` falling back to `req.query.expectedVersion`), with an explicit non-negative-integer bounds check on the query form (400 before any record is mutated, never coerced). `conflictIfStale()` now delegates to it, extending Plan 01's contract to cover body-less routes without duplicating the check.
- `POST /api/integration-tasks` and `POST /api/synergies` main upsert routes wired onto the conflict contract, including the kanban-shaped status-flip quick action on integration tasks — proven with no carve-out (D-02).
- All seven synergy sub-routes (cost-entries add/delete, generate-phasing, per-month phasing, stage, rebaseline, confirm-current) wired onto the same contract, with the pre-existing unrecognized-stage 409 left provably distinguishable from a conflict 409 (negative-control test), and the cost-entries DELETE route proving the query-channel path end-to-end.
- Client (`public/js/execution.js`): the task status-flip and every synergy write call site now threads the version this page already holds, refreshing it from each response so a second write in the same tab never self-conflicts against its own prior success.
- 12 new integration/structural test cases appended to `test/optimistic-locking-contract.test.js` (14 -> 19 for the file's own test count across both tasks, plus one pre-existing test file updated for a cross-cutting schema change).

## Task Commits

Each task was committed atomically:

1. **Task 1: Integration tasks and synergy initiatives — main upsert routes** - `ecf2cb0` (feat)
2. **Task 2: The seven synergy sub-routes that mutate an initiative** - `6584151` (feat)

## Files Created/Modified

- `server.js` - `parseExpectedVersion(req)`, `conflictIfStale()` extended to use it, precheck wired into `POST /api/integration-tasks`, `POST /api/synergies`, and all seven synergy sub-routes; the cost-entries DELETE route's response now echoes the updated initiative
- `validators/workstream.js` - `version` field added to `TaskUpsertSchema`, `SynergyUpsertSchema`, `GeneratePhasingSchema`, `PhasingMonthSchema`, `CostEntrySchema`, `StageChangeSchema`, `RebaselineSchema`, `ConfirmCurrentSchema`
- `public/js/execution.js` - task status-flip call site and all nine synergy write call sites (main upsert's realized-value input plus all seven sub-routes) thread the held version and refresh it from the response
- `test/optimistic-locking-contract.test.js` - 12 new cases: task/synergy stale-current pairs, kanban no-carve-out, instantiate-is-exempt, query-channel bounds check, stage stale/negative-control, cost-entries query-channel stale/current, structural seven-route coverage scan
- `test/synergy-staleness.test.js` - updated the pre-existing D-16 "no-content-fields" assertion for confirm-current's new conditional version field

## Decisions Made

- **Two plan-text/codebase mismatches, both matching Plan 01's own precedent:** "the task upsert near line 228" and "the synergy save form near line 1066" are both CREATE-only forms (no `id` in their payload) — left untouched since a create carries no version precondition by definition.
- **ConfirmCurrentSchema's `version` field is the sole exception to D-16's "no content fields" guarantee** — it carries no content, only the optimistic-lock precondition, and the route mutates the initiative so D-02 gives it no exemption. Updated the pre-existing test assertion to check "zero content fields ever assigned" rather than a literal empty-object body string.
- **Threaded version through six JSON-body sub-routes, not five** — the plan's action text says "the five that already POST a JSON body," but the must_haves and acceptance criteria explicitly require confirm-current's version enforcement too. Took the must_haves' explicit requirement over the action text's apparent count.
- **[Rule 1 fix] Changed DELETE /api/synergies/:id/cost-entries/:eid's response shape** from `{ success: true }` to `{ success: true, initiative: item }`, matching every sibling sub-route — without it, the client has no way to refresh its held version after a successful delete, and the next write in the same tab would self-conflict.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] DELETE /api/synergies/:id/cost-entries/:eid response shape didn't return the updated initiative**
- **Found during:** Task 2 (threading the version through the cost-entries delete client call site)
- **Issue:** Every other synergy sub-route response echoes `{ success: true, initiative: item }`, letting the client refresh the version it holds in memory. This route alone returned `{ success: true }`, which would leave the client's held version stale after a successful delete — the next write in the same tab would then resubmit that stale version and manufacture a self-conflict against its own prior success (the same class of bug Plan 01 fixed for the RAID status-flip client refresh).
- **Fix:** Changed the response to `{ success: true, initiative: item }`; updated the client delete handler to refresh `item.version` from `res.initiative.version` on success.
- **Files modified:** server.js, public/js/execution.js
- **Verification:** test/optimistic-locking-contract.test.js (14) asserts `delBody.initiative.version === 2` after a current-version delete.
- **Committed in:** `6584151` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, correctness — self-conflict prevention). No scope creep; the fix is required for basic single-tab usability, matching Plan 01's identical precedent for the RAID/task status-flip refresh.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The version precondition now covers RAID (Plan 01), integration tasks, and all nine synergy-initiative write routes (this plan) — 3 of CONC-02's 5 named collections, plus the D-02 no-exemptions rule proven on every quick single-field action this phase surfaced (kanban status flip, stage move, month-cell phasing edit, cost-entry add/delete).
- Plans 04/05 (DD findings/request-items, org positions/flight-risks) can wire the remaining collections through the SAME `conflictIfStale()`/`parseExpectedVersion()` contract — no further storage-layer, server-helper, or client-wrapper changes needed; `conflictIfStale()`'s existing `opts.clearanceFilter` hook (built in Plan 01, unused until now) is what those plans will pass.
- Plan 06 (RAID DELETE version threading) has a proven, real query-channel precedent to follow now (`DELETE /api/synergies/:id/cost-entries/:eid?expectedVersion=`) — not just the storage-layer enforcement Plan 01 already proved.
- Plan 07 (coverage gate) can extend `test/optimistic-locking-contract.test.js` further — this plan's own test (16, structural) already demonstrates the exact scan shape (`conflictIfStale()` before `writeDb(db)`) that gate will generalize across every VERSIONED_COLLECTIONS route.
- **Manual verification pending:** the plan's own `<verification>` section calls for a manual two-tab browser check on `execution.html` (both the integration-task and synergy edit surfaces) — not performed in this browser-less autonomous run. Recommend a human spot-check before UAT closes this phase (see coverage `D10`'s `human_judgment: true` rationale above), same recommendation Plan 01 carried forward.

## Self-Check: PASSED

- FOUND: server.js (parseExpectedVersion, conflictIfStale extension, 9 route call sites)
- FOUND: validators/workstream.js (8 `version` field additions)
- FOUND: public/js/execution.js (10 call-site threadings)
- FOUND: test/optimistic-locking-contract.test.js (12 new tests, all passing)
- FOUND: test/synergy-staleness.test.js (updated assertion, passing)
- FOUND commit: ecf2cb0 (Task 1)
- FOUND commit: 6584151 (Task 2)

---
*Phase: 09-optimistic-locking-conflict-recovery*
*Completed: 2026-08-11*
