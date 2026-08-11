---
phase: 09-optimistic-locking-conflict-recovery
plan: 05
subsystem: api
tags: [express, zod, sqlite, optimistic-locking, conflict-resolution, clean-room, vanilla-js]

# Dependency graph
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "Plans 01/02/04's mechanism (conflictBody()/conflictIfStale()/parseExpectedVersion(), the version-checked WHERE-clause layer in db/store.js, orgPositions/orgFlightRisks already listed in VERSIONED_COLLECTIONS) plus Plan 04's clearanceFilter pattern precedent (not reused here — org routes carry a single uniform hr-area gate, not a per-record area)"
provides:
  - "POST /api/org/positions, POST /api/org/flight-risk and POST /api/org/flight-risk/:id/convert wired onto the conflict contract, each placed after the existing not-found/employee-existence guards and before any field mutation"
  - "The org-positions precheck specifically placed before the shallow-merge candidate evaluation and positionGraphFailure() call, so a request that is both stale and structurally invalid returns 409, not 400"
  - "The recorded CONC-02 append-only exemption on POST /api/org/decisions, quoting the requirement text — orgDecisions has no update/delete path and therefore no version field or VERSIONED_COLLECTIONS membership"
  - "version field on the org position, flight-risk and flight-risk-convert validators/org.js schemas"
  - "public/js/org.js's convertFlightRisk() threads the in-memory entry's held version"
affects: ["09-07"]

# Actuals (#2632)
actuals:
  tokens: 7300
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Uniform single-area-gate routes (org) pass no clearanceFilter to conflictIfStale() — unlike DD's per-record area, the whole org route is already gated on one hr grant at the top, so a caller reaching the conflict path is already cleared for every record the route can resolve"
    - "A route whose existence-check and field-assignment were previously fused in one `if` block (POST /api/org/flight-risk) was split into a read-only check followed by the version precheck followed by the assignment, to honor the plan's mandated placement without changing any refusal condition"

key-files:
  created: []
  modified:
    - server.js
    - validators/org.js
    - public/js/org.js
    - public/org.html
    - test/optimistic-locking-contract.test.js
    - test/org-flight-risk-conversion.test.js

key-decisions:
  - "The plan named 'the flight-risk upsert near line 1024' and 'the position upsert near line 1257' as client call sites to thread version through, but both are CREATE-only forms (no `id` in their payload) — there is no edit UI anywhere in public/js/org.js for either an existing position or an existing flight-risk entry (only Add forms, a delete button, and the conversion action). This is the identical plan-text/codebase mismatch Plans 01/02/04 already found and documented for RAID/tasks/synergies/DD's own 'save form' references. Left both untouched; threaded version only through convertFlightRisk(), the one genuine call site that mutates an existing record."
  - "POST /api/org/flight-risk's existence-check-and-assignment for employeeId was originally fused in one `if (b.employeeId !== undefined) { ...check...; item.employeeId = b.employeeId; }` block. Split the check from the assignment (preserving the exact same refusal condition) so the version precheck could sit between them, per the plan's required ordering — mirrors POST /api/org/positions' own pre-existing separated-check shape."
  - "The org-decisions exemption comment quotes CONC-02's own requirement text verbatim (it names 'org decision' among its examples) rather than paraphrasing, so a future reader searching for that literal phrase lands directly on the reasoning."

patterns-established:
  - "positionGraphFailure()'s ordering rule (nothing mutates before either the version check or the graph check) is now proven end-to-end by a combined stale+invalid test, not just documented in a comment."

requirements-completed: [CONC-02]

coverage:
  - id: D1
    description: "A stale-version update to an org position is rejected with a 409 carrying the conflict marker, and the earlier writer's field values survive intact."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (26)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A stale-version update to a flight-risk entry is rejected with a 409 carrying the conflict marker, and the earlier writer's field values survive intact."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (27)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Current-version updates to a position and a flight-risk entry both return 200 and advance the stored version by exactly one."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (28, 29)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A position update that is both stale AND graph-invalid (self-parent reportsToId) returns 409, not 400, and the stored position is unchanged — the version precheck sits before positionGraphFailure(), not after."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (30)"
        status: pass
      - kind: other
        ref: "test/optimistic-locking-contract.test.js (35, structural) — source scan asserting conflictIfStale() precedes positionGraphFailure(lane, candidate) and writeDb(db) in all three org write routes"
        status: pass
    human_judgment: false
  - id: D5
    description: "POST /api/org/decisions succeeds with no version in its payload and the created decision record carries no version key — the recorded, deliberate append-only exemption."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (31)"
        status: pass
      - kind: unit
        ref: "test/optimistic-locking-contract.test.js (structural, pre-existing from Plan 01) — asserts orgDecisions absent from VERSIONED_COLLECTIONS"
        status: pass
    human_judgment: false
  - id: D6
    description: "Bulk org routes that only create records (copy-to-target, roster import) carry no version precondition and still succeed with no version in their payload."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (32)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Converting a flight-risk entry to a task/RAID entry carries a version precondition; a stale-version convert is rejected 409 with no orphan task/RAID entry and the entry's link arrays unchanged; a current-version convert succeeds, creates the task/RAID entry, and advances the entry's version by exactly one."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (33, 34)"
        status: pass
    human_judgment: false
  - id: D8
    description: "public/js/org.js's convertFlightRisk() threads the in-memory entry's held version at both click sites (Create Day-1 task / Create RAID entry)."
    requirement: "CONC-02"
    verification:
      - kind: other
        ref: "grep -n \"convertFlightRisk(entry.id\" public/js/org.js — both call sites pass entry.version; test/org-flight-risk-conversion.test.js (m, updated) asserts the handler's own body shape"
        status: pass
      - kind: manual_procedural
        ref: "two browser tabs on org.html editing the same position — second save shows the conflict dialog; two tabs editing DIFFERENT positions both save with no dialog"
        status: unknown
    human_judgment: true
    rationale: "This autonomous worktree execution has no browser available. Structural (grep-based) verification and the full HTTP-level test suite give high confidence the payload threading and server contract are correct, but the actual visual/interactive two-tab UX has not been human- or browser-verified — same gap Plans 01/02/04 carried forward under their own D3/D10/D7 rationale."
  - id: D9
    description: "No regression against the Plan 01/02/04 baseline and every pre-existing org test."
    verification:
      - kind: integration
        ref: "npm test (full suite, 745/745)"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-08-11
status: complete
---

# Phase 9 Plan 5: Org Design and Talent Retention — Conflict-Safe Positions, Flight-Risk and Conversion Summary

**Extended the plan-01/02/04 optimistic-locking contract onto org positions, the flight-risk register, and the flight-risk-to-task/RAID conversion — completing D-06's enumerated collection list — with the org-decisions append-only exemption recorded explicitly in code rather than left for a future reader to wonder whether it was missed.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-11T05:58:06Z (approx.)
- **Completed:** 2026-08-11T06:09:28Z
- **Tasks:** 2
- **Files modified:** 6 (server.js, validators/org.js, public/js/org.js, public/org.html, test/optimistic-locking-contract.test.js, test/org-flight-risk-conversion.test.js)

## Accomplishments

- `POST /api/org/positions` and `POST /api/org/flight-risk` reject stale writes with the plan-01/02/04 409 conflict contract, placed after each route's existing not-found/employee-existence guards and before any field mutation — the positions route's precheck additionally sits before the shallow-merge candidate evaluation and `positionGraphFailure()` call, so a request that is both stale and structurally invalid returns 409, not 400.
- `POST /api/org/flight-risk/:id/convert` carries the same version precondition, placed before `source` derivation and any mutation, so a stale-version conflict leaves the entry, the task lane and the RAID lane all untouched.
- `POST /api/org/decisions` gained a recorded CONC-02 exemption comment quoting the requirement text verbatim — the route only ever pushes a new entry, so there is no mutable write for a version check to guard.
- No `clearanceFilter` on any of the three org routes: unlike DD's per-record area, every org route is already gated on a single uniform `hr` area grant, so a caller reaching the conflict path is already cleared for every record the route can resolve.
- `public/js/org.js`: `convertFlightRisk()` threads the version of the in-memory `entry` its click handler closes over; the other two call sites the plan named turned out to be CREATE-only forms with no edit UI behind them (see Decisions Made).
- 10 new test cases (26–35) appended to `test/optimistic-locking-contract.test.js`, including a combined stale-and-graph-invalid precedence case and a structural ordering assertion across all three org write routes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Org positions and the flight-risk register** - `e6e385b` (feat)
2. **Task 2: The flight-risk conversion and the org client call sites** - `d183e97` (feat)

## Files Created/Modified

- `server.js` - `conflictIfStale()` wired into `POST /api/org/positions`, `POST /api/org/flight-risk` and `POST /api/org/flight-risk/:id/convert`; the recorded append-only exemption comment at `POST /api/org/decisions`
- `validators/org.js` - `version: z.number().int().nonnegative().optional()` added to `OrgPositionUpsertSchema`, `FlightRiskUpsertSchema` and `FlightRiskConvertSchema`
- `public/js/org.js` - `convertFlightRisk()` gained a fourth `version` parameter, threaded from both call sites (`entry.version`)
- `public/org.html` - bumped org.js's cache-busting `?v=` stamp
- `test/optimistic-locking-contract.test.js` - 10 new cases (26–35): position/flight-risk stale+current pairs, the combined stale-and-invalid precedence case, the decisions no-version-key proof, the copy-to-target/import no-version-required proof, the convert stale/current pair with orphan-row checks, and the three-route structural ordering assertion
- `test/org-flight-risk-conversion.test.js` - updated test (m)'s literal `convertFlightRisk()` signature search string for the new `version` parameter

## Decisions Made

- **Two plan-text/codebase mismatches, matching Plans 01/02/04's own precedent:** "the flight-risk upsert near line 1024" and "the position upsert near line 1257" are both CREATE-only forms (no `id` in their payload) — there is no edit UI for either an existing position or an existing flight-risk entry in this codebase (only Add forms, delete, and the conversion action). Left both untouched; threaded version only through `convertFlightRisk()`, the one genuine mutating client call site.
- **Split POST /api/org/flight-risk's fused employeeId check-and-assign block** into a read-only existence check followed by the version precheck followed by the assignment, preserving the exact same refusal condition, so the version precheck could sit in the plan's required position (after the check, before any mutation) — mirrors `POST /api/org/positions`' own pre-existing separated-check shape.
- **The org-decisions exemption comment quotes CONC-02's requirement text verbatim** (it names "org decision" among its examples), so a future reader searching for that literal phrase lands directly on the reasoning rather than a paraphrase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, pre-existing test assertion] test/org-flight-risk-conversion.test.js (m) searched for a stale literal function signature**
- **Found during:** Task 2 (threading `version` through `convertFlightRisk()`)
- **Issue:** A pre-existing test located `convertFlightRisk()` by an exact-string search for `'function convertFlightRisk(entryId, toTask, toRaid) {'`. Adding the fourth `version` parameter (required to thread the optimistic-lock precondition) changed that literal string, breaking the search — the same class of cross-cutting-signature-change test staleness Plan 01 hit with `test/synergy-staleness.test.js`.
- **Fix:** Updated the search string to `'function convertFlightRisk(entryId, toTask, toRaid, version) {'`.
- **Files modified:** `test/org-flight-risk-conversion.test.js`
- **Verification:** `npm test` — full suite green (745/745) after the fix.
- **Committed in:** `d183e97` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, pre-existing test staleness from a required cross-cutting signature change). No scope creep.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-06's enumerated collection list is now complete: RAID entries, integration tasks, synergy initiatives, DD findings, DD request items, org positions and flight-risk entries — both lanes of each demo/custom split where applicable — with org decisions the single documented exemption.
- Plan 06 (RAID DELETE version threading, per this plan's own read_first note that "the position delete near line 589 is plan 06's work") can proceed independently — this plan did not touch `DELETE /api/org/positions/:id` or `DELETE /api/org/flight-risk/:id`.
- Plan 07 (coverage gate) can extend `test/optimistic-locking-contract.test.js`'s existing structural-scan shape (tests 16, 25, and this plan's 35) across every remaining VERSIONED_COLLECTIONS route for the final coverage-gate pass.
- **Manual verification pending:** the plan's own `<verification>` section calls for a manual two-tab browser check on `org.html` — not performed in this browser-less autonomous worktree run. Recommend a human spot-check before UAT closes this phase, same recommendation Plans 01/02/04 carried forward (see coverage `D8`'s `human_judgment: true` rationale above).

## Self-Check: PASSED

- FOUND: server.js (`conflictIfStale()` wired into 3 org routes, org-decisions exemption comment)
- FOUND: validators/org.js (3 `version` field additions)
- FOUND: public/js/org.js (`convertFlightRisk()` 4-arg signature, both call sites threading `entry.version`)
- FOUND: public/org.html (cache-stamp bump)
- FOUND: test/optimistic-locking-contract.test.js (10 new tests, 38/38 total passing)
- FOUND: test/org-flight-risk-conversion.test.js (updated signature search, passing)
- FOUND commit: e6e385b (Task 1)
- FOUND commit: d183e97 (Task 2)
- npm test: 745/745 passing

---
*Phase: 09-optimistic-locking-conflict-recovery*
*Completed: 2026-08-11*
