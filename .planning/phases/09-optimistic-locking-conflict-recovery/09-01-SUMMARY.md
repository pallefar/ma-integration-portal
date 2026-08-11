---
phase: 09-optimistic-locking-conflict-recovery
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, optimistic-locking, json_extract, express, vanilla-js, conflict-resolution]

# Dependency graph
requires:
  - phase: 08-concurrency-storage-foundation
    provides: "BEGIN IMMEDIATE + busy_timeout write serialization (db/dbFiles.js, db/store.js's .immediate transaction), the central-error-middleware pattern (isBusyError sibling), the audit-inside-transaction invariant (CR-01), and the ma-fetch-wrapper single interception point in public/js/transitions.js"
provides:
  - "VERSIONED_COLLECTIONS gating set (db/collections.js) — 10 tables, both demo/custom lanes"
  - "Version stamping + SQL json_extract() WHERE-clause enforcement inside writeDb()'s .immediate transaction (db/store.js), with a typed conflict error (isConflictError/makeConflictError)"
  - "The PD-3 fixed 409 body contract (conflictBody()/conflictIfStale()) and its central middleware sibling of the 503 one (server.js), wired into POST /api/raid"
  - "The shared conflict-recovery dialog (showConflictDialog()/withFreshVersion()/relativeTime()) in the ma-fetch-wrapper region of public/js/transitions.js, plus .conflict-modal* CSS"
  - "A real cross-process proof (test/optimistic-locking-cross-process.test.js) that the lock is per-record, not per-collection"
affects: [09-02, 09-03, 09-04, 09-05, 09-06, 09-07]

# Actuals (#2632)
actuals:
  tokens: 18000
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Collection-level gating set (VERSIONED_COLLECTIONS) mirroring db/auditHook.js's AUDITED_DB_KINDS precedent"
    - "Two-layer conflict check: a route-level precheck (conflictIfStale()) for a fast informative 409, plus a SQL WHERE-clause check inside writeDb()'s .immediate transaction as the actually race-free layer"
    - "Central error-middleware sibling pattern extended: 409 conflict middleware mounted beside the existing 503 busy middleware"
    - "Shared, wrapper-detected client dialog: one 409 branch in the existing fetch wrapper, no per-page wiring"

key-files:
  created:
    - test/optimistic-locking-contract.test.js
    - test/optimistic-locking-cross-process.test.js
  modified:
    - db/collections.js
    - db/store.js
    - server.js
    - validators/workstream.js
    - public/js/transitions.js
    - public/css/style.css
    - public/js/execution.js
    - test/synergy-staleness.test.js

key-decisions:
  - "The plan's 'RAID save form at line 1087' is actually a CREATE-only handler (no `id` in its payload) — there is no separate RAID full-edit form in this codebase, only the status-flip quick action and this create form. Left it untouched; threaded `version` only through the status-flip call site, which is the only genuine RAID edit surface today."
  - "The status-flip call site refreshes item.version from the server's response after a successful write (not in the plan's literal text) — without this, a second click in the same browser tab would resubmit the now-stale version and self-conflict against its own prior write."
  - "PD-4's 'deleted' conflict-dialog literals (CONFLICT_TITLE_DELETED/CONFLICT_DELETED_INTRO/CONFLICT_CLOSE_LABEL) were authored fresh for the 'my update landed on an already-deleted record' scenario, deliberately NOT reusing 09-UI-SPEC.md's similarly-named D-08 stale-delete title, since the two describe different scenarios (FA-2, flagged for developer/UAT review)."

patterns-established:
  - "Every VERSIONED_COLLECTIONS write (including the 'untouched by this writer' fast path) goes through the version-checked WHERE clause, never the plain unconditional UPDATE — see Deviations for why this mattered."
  - "Client resubmission on 'apply' goes through window.fetch (not a raw origFetch), so a genuine second conflict re-enters the same wrapper and re-renders the same dialog with fresh values."

requirements-completed: [CONC-02]

coverage:
  - id: D1
    description: "A stale-version RAID update is rejected 409 with the conflict marker; a current-version update succeeds and bumps the version by exactly one; a legacy version-less record is lazily adopted on first write; enforcement lives in the SQL WHERE clause inside writeDb()'s .immediate transaction."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (all 7 subtests)"
        status: pass
      - kind: unit
        ref: "node -e acceptance-criteria one-liners (VERSIONED_COLLECTIONS shape, ARRAY_COLLECTIONS membership, isConflictError export)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The 409 conflict body is a single fixed shape (conflict/conflictKind/recordId/currentRecord/currentVersion/changedBy/changedAt) built by one central middleware, distinguishable from the two pre-existing unrelated 409s in this codebase by the conflict:true marker."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (negative control subtest 4)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The shared conflict-recovery dialog renders on a same-origin 409 with conflict:true, shows a field-diff list and attribution, never auto-retries, preserves the user's in-progress form on every exit path, and reapplies against the fresh version on click — plus the PD-4 'deleted' variant."
    requirement: "CONC-02"
    verification:
      - kind: unit
        ref: "test/client-xss-sinks.test.js (no markup-sink regression; existing 10 subtests)"
        status: pass
      - kind: other
        ref: "ad-hoc node:vm sandbox check (not committed as a test file — mirrors test/client-busy-retry.test.js's harness): dialog structure, field-diff filtering, attribution/fallback text, and the 'deleted' variant all verified programmatically this session"
        status: pass
    human_judgment: true
    rationale: "The plan's own <verification> section calls for a manual two-tab browser check on execution.html (real click-through UX, visual rendering, Escape/overlay-click dismissal) — this autonomous worktree execution has no browser available. Structural (grep-based) and node:vm-sandboxed checks give high confidence the logic is correct, but the actual visual/interactive UX has not been human- or browser-verified."
  - id: D4
    description: "Cross-process proof: two real OS processes racing the SAME record produce exactly one commit and one typed conflict, never a blend; two real OS processes racing DIFFERENT records both commit (per-record, not per-collection granularity); an update racing a delete on the same record produces a clean outcome with a typed conflict for the loser, never a resurrection or a false success."
    requirement: "CONC-02"
    verification:
      - kind: e2e
        ref: "test/optimistic-locking-cross-process.test.js (all 3 subtests, re-run 3x consecutively with zero flakes)"
        status: pass
    human_judgment: false
  - id: D5
    description: "No regression against the Phase 8 baseline; the committed data/control.db and data/demo.db are unchanged (every test runs against isolated fs.mkdtempSync temp files)."
    verification:
      - kind: integration
        ref: "npm test (full suite)"
        status: pass
      - kind: other
        ref: "git status --short data/ (empty output — no committed DB touched)"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-08-11
status: complete
---

# Phase 9 Plan 1: End-to-End Stale-RAID-Write Rejection Summary

**Optimistic locking on RAID entries: a per-record `version`/`updatedBy`/`updatedAt` blob field, enforced by a SQL `json_extract()` WHERE clause inside `writeDb()`'s existing `.immediate` transaction, surfaced as a fixed-shape 409 through a central Express middleware, and recovered via a shared native-DOM compare-and-reapply dialog in the `ma-fetch-wrapper` fetch interceptor.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-11T04:51:44Z
- **Completed:** 2026-08-11T05:14:00Z
- **Tasks:** 3
- **Files modified:** 10 (2 new test files, 8 modified)

## Accomplishments

- Storage layer: `VERSIONED_COLLECTIONS` (10 tables, both demo/custom lanes), version stamping + a version-checked `UPDATE`/`DELETE` WHERE clause inside `writeDb()`'s `.immediate` transaction, throwing a typed conflict error (`version` or `deleted` per PD-4) that rolls back the whole transaction — nothing partially commits.
- Server contract: `conflictBody()`/`conflictIfStale()` (PD-3's fixed 409 shape, with an optional clearance-filter hook for plans 04/05) and a central 409 middleware sibling of the existing 503 one, wired into `POST /api/raid`'s route-level precheck.
- Client: a 409 branch in the existing `ma-fetch-wrapper` fetch interceptor (never auto-retries), a shared `showConflictDialog()` component (field-diff list, attribution with fallback, apply/discard actions, the PD-4 "deleted" variant), and `.conflict-modal*` CSS reusing the `.deal-modal` shell on the UI-SPEC's 4px scale.
- Real cross-process proof (`test/optimistic-locking-cross-process.test.js`): same-record conflict, different-record parallel success, update-vs-delete — all against real spawned OS processes, re-run 3x with zero flakes.
- Found and fixed a real cross-process data-loss bug in Task 1's own storage-layer code during Task 3's proof (see Deviations) — the fix is load-bearing for CONC-02's core guarantee, not cosmetic.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end stale-RAID-write rejection — storage layer through HTTP 409** - `352d12c` (feat)
2. **Task 2: The client half — 409 branch and the shared conflict dialog, on the RAID path** - `e1a35ad` (feat)
3. **Task 3: Cross-process proof that the lock bites per record, not per collection** - `c5f8705` (test, includes the Task-1 storage-layer fix described below)

## Files Created/Modified

- `db/collections.js` - `VERSIONED_COLLECTIONS` export (10 tables), length/membership assertions
- `db/store.js` - version stamping + WHERE-clause enforcement inside `writeDb()`'s `applyWrite`; `isConflictError`/`makeConflictError`; the Task-3-discovered fix to the "untouched row" fast path
- `server.js` - `conflictBody()`, `conflictIfStale()`, the central 409 middleware, `POST /api/raid`'s precheck wiring, re-exports
- `validators/workstream.js` - `version` field on `RaidUpsertSchema`
- `public/js/transitions.js` - the 409 branch + `showConflictDialog()`/`withFreshVersion()`/`relativeTime()` inside the `ma-fetch-wrapper` region
- `public/css/style.css` - `.conflict-modal*` rules
- `public/js/execution.js` - the RAID status-flip call site threads `version` and refreshes it from the response
- `test/optimistic-locking-contract.test.js` - the tracer's four proofs (new)
- `test/optimistic-locking-cross-process.test.js` - the three cross-process cases (new)
- `test/synergy-staleness.test.js` - one pre-existing assertion updated for the new cross-cutting version/updatedAt/updatedBy stamp

## Decisions Made

- **RAID "save form" mismatch (D-02 uniform-check spirit preserved):** the plan named "the RAID save form at line 1087" as a second client call site to thread `version` through, but that handler is a CREATE-only form (no `id` field in its payload — RAID entries have no full-edit form in this codebase today, only the status-flip quick action). Threaded `version` only through the status-flip call site; the create form was left untouched since a create carries no version precondition by definition (09-CONTEXT.md's own Claude's Discretion note: "creates carry no version precondition").
- **Client version refresh after a successful write:** added a refresh of `item.version` from the server's response on the status-flip call site (not explicit in the plan text) — without it, a second click in the same tab would resubmit the now-stale version and manufacture a self-conflict against its own prior write. This is required for basic single-tab usability, not an edge case.
- **PD-4's "deleted" literals authored independently of the UI-SPEC's D-08 title:** `CONFLICT_TITLE_DELETED`/`CONFLICT_DELETED_INTRO`/`CONFLICT_CLOSE_LABEL` describe "my update arrived after someone else deleted the record" (PD-4), which is a different scenario from the UI-SPEC's D-08 "I am deleting a stale record" dialog — despite the similarly-named constant, the copy was written fresh rather than reusing the UI-SPEC's D-08 title text, to avoid conflating the two scenarios. Flagged per FA-2 for developer/UAT review.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, found during Task 3's own cross-process proof] `writeDb()`'s "untouched row" fast path silently clobbered a concurrent writer's committed change to a DIFFERENT record in the same versioned collection**
- **Found during:** Task 3 (the "different records" cross-process test failed on its first run: record B's version came back `undefined` instead of `1`)
- **Issue:** Task 1's version-stamping logic only ran the SQL-guarded `WHERE json_extract(...)` UPDATE for rows the CURRENT writer's own payload actually changed. For a row the writer did NOT touch (identical to what they read), it fell through to the pre-existing plain, unconditional `UPDATE` — but `writeDb()`'s per-collection loop visits EVERY row in the array on every call (the existing whole-object snapshot-diff design, unchanged since Phase 1), not just the ones the caller intended to modify. If a SECOND process had already committed a change to that same untouched row in the meantime, this writer's own stale copy of it would silently overwrite that committed change — exactly the cross-process silent-clobber class CONC-02 exists to close, just reached through the reorder/no-op code path instead of an explicit edit.
- **Fix:** The "untouched" branch for a versioned collection now goes through the SAME version-checked WHERE clause as an explicit edit. On a match, it rewrites `seq`/`data` as before (preserving CR-01 reordering). On a version mismatch, it silently skips that row rather than throwing OR clobbering — since this writer never intended to change that row's content, the other writer's newer (or deleted) state stands untouched, mirroring the pre-existing CR-02 no-resurrect precedent.
- **Files modified:** `db/store.js`
- **Verification:** `test/optimistic-locking-cross-process.test.js`'s "different records" case now passes; re-run 3 consecutive times with zero flakes; `test/optimistic-locking-contract.test.js` and the full suite re-run clean (714/714) after the fix.
- **Committed in:** `c5f8705` (Task 3 commit)

**2. [Rule 1 - Bug, pre-existing test assertion] `test/synergy-staleness.test.js` asserted no new fields beyond `lastConfirmedAt`, now stale**
- **Found during:** Task 1 (first `npm test` run after wiring the versioned-collection stamping)
- **Issue:** `synergyInitiatives` is a `VERSIONED_COLLECTIONS` member (D-06 names it explicitly); a pre-existing test asserted `confirm-current` introduces exactly one new field (`lastConfirmedAt`). With version stamping wired, any write that changes a field also now stamps `version`/`updatedAt`/`updatedBy` — the new, correct cross-cutting behavior this phase introduces uniformly, not a regression.
- **Fix:** Updated the assertion to expect all four new fields.
- **Files modified:** `test/synergy-staleness.test.js`
- **Verification:** `node --test test/synergy-staleness.test.js` — all 15 subtests pass.
- **Committed in:** `352d12c` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule-1 correctness bug found via Task 3's own proof, 1 Rule-1 pre-existing-test update). Both essential for correctness; no scope creep.

## Issues Encountered

None beyond the deviation above — the cross-process bug was caught by the very test written to prove the opposite property, which is exactly what that test existed to do.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The central mechanism (storage layer, server contract, client dialog) is fully built and proven end-to-end on one route (`POST /api/raid`). Plans 02/04/05/06 can now wire the remaining ~9 versioned routes (integration tasks, synergy initiatives, DD findings/request-items, org positions/flight-risk, plus the DD/org area-clearance filter hook already structurally present in `conflictIfStale()`) through the SAME mechanism with no further storage-layer or client-wrapper changes needed.
- Plan 03 (dialog edge states) can build on the working `showConflictDialog()` — the error/loading-state UI-SPEC probes (E2-error, E3 stale-delete confirm) were explicitly deferred here per the plan's own scoping.
- Plan 06 (RAID DELETE version threading) can build on the delete-pass version enforcement already present in `db/store.js` — only the route-level `?expectedVersion=` query-param plumbing and the client DELETE call site remain.
- Plan 07 (coverage gate) can extend `test/optimistic-locking-contract.test.js` into the full structural coverage-gate shape (`test/busy-503-contract.test.js`'s 4-part recipe) once every route is wired.
- **Manual verification pending:** the plan's own `<verification>` section calls for a manual two-tab browser check on `execution.html` — not performed in this browser-less autonomous run. Recommend a human spot-check before UAT closes this phase (see coverage `D3`'s `human_judgment: true` rationale above).

## Self-Check: PASSED

- FOUND: test/optimistic-locking-contract.test.js
- FOUND: test/optimistic-locking-cross-process.test.js
- FOUND: .planning/phases/09-optimistic-locking-conflict-recovery/09-01-SUMMARY.md
- FOUND commit: 352d12c (Task 1)
- FOUND commit: e1a35ad (Task 2)
- FOUND commit: c5f8705 (Task 3)

---
*Phase: 09-optimistic-locking-conflict-recovery*
*Completed: 2026-08-11*
