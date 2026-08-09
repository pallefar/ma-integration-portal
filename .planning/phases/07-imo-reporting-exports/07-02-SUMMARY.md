---
phase: 07-imo-reporting-exports
plan: 02
subsystem: api
tags: [export, csv, json, workstream-rollup, zod, express, sqlite, audit, rfc4180, content-disposition]

# Dependency graph
requires:
  - phase: 07-imo-reporting-exports
    plan: 01
    provides: the whole export architecture (zod whitelist -> clearance filter -> RFC 4180 CSV -> safe Content-Disposition -> gated audit call), lib/reportCsv.js, lib/reportFilename.js, the Reports & Exports execution.html tab
provides:
  - computeWorkstreamRollup(db) — the single server-side implementation of execution.js's client-side workstream rollup math, defined adjacent to taskLane(db)
  - GET /api/reports/export?dataset={workstreams,tasks,raid,synergies}&format={csv,json} — all eight accepted combinations return real data, no 501 remains
  - the completed four-row Reports & Exports tab (Workstreams, Tasks, RAID, Synergies), each with CSV and JSON links
affects: [07-03-through-07-06 (PDF steerco pack, stale-day-count column — all can now read the server-computed workstream rollup and every dataset's JSON shape)]

# Actuals (#2632)
actuals:
  tokens: 7900
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A rollup or derived figure shown on a live screen gets exactly ONE server-side implementation (computeWorkstreamRollup(db)) that both the export and the screen's own future server-side consumers read — never re-derived from percentages by a second caller"
    - "A JSON export's body is the SAME array of objects the CSV branch derived its rows from, serialised whole — for a dataset with a live GET route (raid, synergies) this makes JSON export parity with that route a structural property, not a maintained invariant"
    - "Datasets with no per-item clearance concept (tasks, workstreams) apply no filter at all — clearance filtering is dataset-specific, not a blanket wrapper applied to every branch"

key-files:
  created: []
  modified:
    - server.js (computeWorkstreamRollup(db); GET /api/reports/export's workstreams/tasks/synergies branches + json format branch)
    - test/reports-export.test.js (13 new tests: all 8 combinations, JSON/live-route parity, workstream rollup number parity, empty-deal behavior, clearance-filter re-proof, cross-deal isolation, sentinel absence)
    - public/execution.html (the remaining three Reports tab rows + JSON links; cache-stamp bump)

key-decisions:
  - "ragStatus is computed once inside computeWorkstreamRollup(db) using the named form of execution.js's ragColor() thresholds (blocked->red; pctComplete>=80->green; >=40->amber; else red) — no second consumer re-derives it from a percentage"
  - "The synergies JSON branch replicates GET /api/synergies' exact per-item mapping (a ctx built once, then the same costEntries newest-first sort) rather than calling enrichSynergy() alone, since the live route's response also carries the sorted costEntries — anything less would fail the deep-equality parity test by construction"
  - "No API route exists to create a checklist template, so the workstream-rollup and cross-dataset-identical-set tests insert a checklistTemplates row directly into the deal's own SQLite file via store.getOrOpenConnection() (the same cache db/resolver.js uses), mirroring test/deal-seed.test.js's insertRow pattern"

patterns-established: []

requirements-completed: [RPT-01]

coverage:
  - id: D9
    description: "All four datasets (workstreams, tasks, raid, synergies) export as both CSV and JSON — all eight accepted combinations return 200, never 501"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (f)"
        status: pass
    human_judgment: false
  - id: D10
    description: "The JSON export of raid and synergies deep-equals the live GET route's body for the same identity in the same run — D-08 parity is literal, never a bespoke export schema"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (g)"
        status: pass
    human_judgment: false
  - id: D11
    description: "The exported workstream numbers equal what execution.js's own client-side math produces for the same seeded template and task set, including a blocked workstream forcing a red band and an absent zero-task workstream"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (h)"
        status: pass
    human_judgment: false
  - id: D12
    description: "An empty deal yields a headers-only CSV and an empty JSON array for all four datasets, never an error"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (i)"
        status: pass
    human_judgment: false
  - id: D13
    description: "The RAID clearance filter survives the four-dataset expansion in BOTH formats; the three unfiltered datasets return an identical set for every identity (catching an accidental over-filter as loudly as a leak)"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (j)-(k)"
        status: pass
    human_judgment: false
  - id: D14
    description: "The export route reads through the deal-bound context, never a global — a session bound to a second deal receives ONLY that deal's rows"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (l)"
        status: pass
    human_judgment: false
  - id: D15
    description: "The legal-target sentinel never appears in any response body or Content-Disposition header, across all four datasets and both formats"
    requirement: "RPT-01"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (m)"
        status: pass
    human_judgment: false
  - id: D16
    description: "The Reports tab renders the locked four-row layout (Workstreams, Tasks, RAID, Synergies) with a CSV and JSON link on every row, no fifth row, no role/grant check"
    verification:
      - kind: static-assertion
        ref: "node -e markup assertion in 07-02-PLAN.md Task 2's <verify> block"
        status: pass
    human_judgment: false
    rationale: "Static markup shape (row count, link count, dataset names, absence of org/talent dataset names) is fully verifiable from the served HTML without a browser; no visual/interactive behavior was added beyond what Plan 07-01's tracer already proved live"

duration: ~35min
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 2: Server-Side Workstream Rollup and the Remaining Export/UI Surface Summary

**Expanded the phase tracer's proven export architecture from one dataset/format to all eight accepted combinations, adding the single server-side workstream rollup (computeWorkstreamRollup(db)) the phase's data layer was missing, and completed the Reports tab's locked four-row layout.**

## Performance

- **Duration:** ~35 min (Tasks 1-3)
- **Completed:** 2026-08-09
- **Tasks:** 3
- **Files modified:** 3 (server.js, test/reports-export.test.js, public/execution.html)

## Accomplishments
- Added `computeWorkstreamRollup(db)` to server.js, adjacent to `taskLane(db)` — the single server-side port of `public/js/execution.js`'s client-side workstream math (task counts, `pctComplete`, `blocked`, `ragStatus`), so the export, the Execution Hub screen and a future PDF pack's RAG strip can never disagree.
- Replaced `GET /api/reports/export`'s three 501 stubs with real `workstreams`/`tasks`/`synergies` branches and added the `json` format branch for all four datasets — the synergies branch mirrors `GET /api/synergies`' exact per-item mapping (ctx built once, `costEntries` sorted the same way) so its JSON body is field-for-field identical to the live route.
- Completed `execution.html`'s Reports & Exports tab to the locked four-row layout (Workstreams, Tasks, RAID, Synergies), each carrying a CSV and a JSON link, matching the RAID row's existing markup with no role/grant check and no fifth row.
- Added 13 new tests across 4 tasks' worth of proof: all eight dataset/format combinations return 200; JSON exports for raid and synergies deep-equal their live GET counterparts; the workstream rollup's numbers match a seeded fixture including a blocked-workstream red band and an absent zero-task workstream; an empty deal yields a headers-only CSV and empty JSON array for every dataset; the RAID clearance filter re-proven in both formats; the three unfiltered datasets return identical sets across four identities; a second deal's export is isolated to its own rows; the legal-target sentinel is absent everywhere.

## Task Commits

Each task was committed atomically:

1. **Task 1: Server-side workstream rollup and the three remaining dataset branches** - `8068735` (feat)
2. **Task 2: The remaining three export rows and the JSON links** - `9ac2468` (feat)
3. **Task 3: Prove the clearance filter survived the expansion** - `0a4d337` (test)

## Files Created/Modified
- `server.js` - `computeWorkstreamRollup(db)`; `GET /api/reports/export`'s `workstreams`/`tasks`/`synergies` branches and the `json` format branch
- `test/reports-export.test.js` - tests (f) through (m): eight-combination sweep, JSON/live-route parity, workstream rollup number parity, empty-deal behavior, clearance re-proof, cross-deal isolation, sentinel absence
- `public/execution.html` - the Workstreams/Tasks/Synergies rows and every row's JSON link; execution.js cache-stamp bump

## Decisions Made
- `ragStatus` is computed once inside `computeWorkstreamRollup(db)`, never re-derived from a percentage by a second consumer
- The synergies JSON export replicates `GET /api/synergies`' exact mapping (ctx + sorted `costEntries`) rather than calling `enrichSynergy()` alone, since anything less would fail the deep-equality parity test
- No API route exists to create a checklist template, so tests insert a `checklistTemplates` row directly into the deal's own SQLite file via `store.getOrOpenConnection()`, mirroring `test/deal-seed.test.js`'s existing pattern

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed as specified; no auto-fixes, no architectural questions, no auth gates.

## Issues Encountered

None. `dealDbPath()`'s `deal_<alphanumeric>` regex (no underscores after the prefix) initially rejected a test fixture's deal id (`deal_rptl_one`) — caught immediately by the test run and fixed by renaming to `deal_rptlone`/`deal_rptltwo`, not a product-code issue.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The PDF steerco pack (Plan 07-04+) can now read `computeWorkstreamRollup(db)` directly for its RAG strip, and every dataset's JSON export shape is stable and proven for reuse.
- Plan 07-04's stale-day-count column is explicitly NOT pre-created on the synergies export (per this plan's own instruction) — that field's addition is deferred to its own plan.
- No outstanding manual verification debt: Task 2's markup completeness was fully verified via the plan's own static assertion script; the underlying click/download behavior was already proven live via Plan 07-01's tracer checkpoint and is architecturally identical here (same link pattern, same route).

---
*Phase: 07-imo-reporting-exports*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 3 modified files confirmed present on disk; all 3 task commit hashes (`8068735`, `9ac2468`, `0a4d337`) confirmed present in `git log --oneline --all`.
