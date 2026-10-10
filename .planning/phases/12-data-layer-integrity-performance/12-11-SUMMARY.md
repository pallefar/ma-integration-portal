---
phase: 12-data-layer-integrity-performance
plan: 11
subsystem: database
tags: [sqlite, read-path, org-design, reports, export, pack, clearance, perf]

requires:
  - phase: 12-data-layer-integrity-performance
    provides: "12-05 readCollections/readSingleton/readProjection with throwing accessors; 12-04 pack worker + 429 guard"
  - phase: 11-authorization-clean-room-closure
    provides: "hr-grant gate, hrClearanceFilter-armed 409 echo, bounded denial audit, no-get-mutates gate"
provides:
  - "server.js: ORG_READ_SET / ORG_POSITIONS_SET, orgPositionsBody, orgDecisionsBody, orgPositionWriteSet; GET /api/org/{positions,decisions,flight-risk,summary} and POST /api/org/positions on partial read sets"
  - "server.js: REPORT_SET, buildPackModel(db, ctx); GET /api/reports/export and the pack's data assembly on REPORT_SET"
  - "test/read-sets-org-reports.test.js (13 cases): HTTP body == builder(readDb()) per identity, audit deltas, byte equality per dataset x format, pack model deep-equality"
affects: [12-14]

actuals:
  tokens: 11000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "route names the narrowest read set it touches; summary picks ORG_READ_SET vs ORG_POSITIONS_SET from the caller's hr grant"
    - "a write loads the roster lane only when the body names an employeeId (the sole consumer of employeeRosterLane in that route)"
    - "pure builder (db, ctx) exposed as app.<name> so equality over readDb() vs readCollections() is a one-line assertion"

key-files:
  created:
    - test/read-sets-org-reports.test.js
  modified:
    - server.js

key-decisions:
  - "ORG_READ_SET is the union of the three org lanes (orgPositions, orgDecisions, orgFlightRisks); GET positions needs only orgPositions, so it uses the narrower ORG_POSITIONS_SET"
  - "GET /api/org/summary reads positions alone for an uncleared caller (open tier only) and the full ORG_READ_SET only for an hr-granted one"
  - "POST /api/org/positions (PD-20) loads orgPositions, plus settings + the one roster lane only when b.employeeId is set"
  - "REPORT_SET = settings, i18n, checklistTemplates, ddFindings, integrationTasks/customIntegrationTasks, raidEntries/customRaidEntries, synergyInitiatives/customSynergyInitiatives"
  - "pack route keeps 12-04's statement order; only the readDb() line and the inline model assembly were replaced (buildPackModel + counts)"

patterns-established:
  - "buildPackModel(db, ctx): { hasAnyData, model|null, counts } with generatedAt/nowMs injected"

requirements-completed: [DATA-02]

duration: ~45min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 11: Org-design and reports on proportional read sets Summary

**The five org-design reads, the common position write, the four-dataset export and the pack's data assembly now read only the collections they need (orgPositions alone for the R5 10x3 read; REPORT_SET of ten keys for reports), with HTTP bodies, CSV/JSON bytes, pack model and every read/denial/export audit row asserted identical to the full-read result for admin, hrbp, hr-granted pmo and un-granted pmo.**

## Performance

- **Tasks:** 3 (Task 1 `type="tracer"`; its automated verify re-ran green before expansion: "Tracer verified end-to-end — expanding")
- **Files:** 1 created, 1 modified (server.js)
- **Suite:** 1366 at base -> **1379/1379**, 0 failures (+13 new cases)

### Measured (host load average 25-31 on 11 CPUs — noisy, shared host)

`node scripts/perf/list-reads.js` (1k tasks / 5k RAID / 200 positions, hrbp), single sequential requests:

| Route | Before (12-05 summary context) | After (this plan) | Payload |
|---|---|---|---|
| GET /api/org/positions | full `readDb()` (43 reads) | **median 6.1 ms (min 2.0)** | 16,136 B |

Round (10 users x 3 list reads) under load ~25: in-round p50 ~550 ms, p95 well over budget, event-loop p99 416 ms — **expected and not asserted here**: GET /api/integration-tasks (12-09) and the employees read are not converted in this worktree; the three-endpoint round only becomes proportional once 12-09 merges, and 12-14 asserts the p95 <= 300 ms budget on a quiet host.

## Route-level conversion inventory

| Route | Before | After |
|---|---|---|
| GET /api/org/positions | `readDb()` | `readCollections(['orgPositions'])` via `orgPositionsBody` |
| GET /api/org/decisions | `readDb()` | `readCollections(['orgDecisions'])` (read only after the clearance gate + read audit) via `orgDecisionsBody` |
| GET /api/org/flight-risk | `readDb()` | `readCollections(['orgFlightRisks'])` (after gate + audit) |
| GET /api/org/summary | `readDb()` | `readCollections(ORG_READ_SET)` for an hr-granted caller, `['orgPositions']` for an uncleared one; `orgSummaryFor` unchanged |
| GET /api/org/capabilities | no data read | unchanged (already read nothing from the deal) |
| POST /api/org/positions (create/update) | `readDb()` | `readCollections(orgPositionWriteSet(body))` = `['orgPositions']`, + `['settings', <one roster lane>]` when `employeeId` is named |
| POST copy-to-target, DELETE position, POST import, POST decisions, POST/DELETE flight-risk, POST flight-risk convert | `readDb()` | unchanged, with a PD-20 comment (bulk/rare or touch task/RAID lanes too) |
| GET /api/reports/export (4 datasets x csv/json) | `readDb()` | `readCollections(REPORT_SET)` |
| GET /api/reports/pack (data assembly) | `readDb()` + inline model | `readCollections(REPORT_SET)` + `buildPackModel(db, ctx)`; 12-04 getReportPack/503/429/worker/audit lines and order untouched |
| every other route | — | untouched by this plan (12-08/09/10 own theirs) |

## Task Commits

1. **Task 1 (tracer): GET /api/org/positions on a proportional read set** - `23a3a29`
2. **Task 2: remaining org reads + POST /api/org/positions on read sets** - `a96c9ec`
3. **Task 3: reports export + pack data assembly on REPORT_SET** - `24495c7`

## Deviations from Plan

**1. [Interpretation] Two named sets instead of one**
- `ORG_READ_SET` (the union) plus `ORG_POSITIONS_SET`: the plan's tracer GET reads only `orgPositions`, so the positions read, the open-tier summary and the common write use the narrower set. `ORG_READ_SET` is used by the hr-granted summary. No behaviour change.

**2. [Interpretation] Roster lane loaded conditionally on the write**
- `employeeRosterLane()` is called only inside `if (b.employeeId)` branches of POST /api/org/positions, so `settings` + the one roster lane (`customEmployees` or `employees`, picked from `readSingleton('settings')`) are loaded only then. Unknown employee still 404 with the same body.

**3. [Test adjustment] Denial audit is rate-bounded**
- The decisions denial rows are bounded per caller (Phase 11 WR-01), so the suite asserts one row on the first refusal and none on an immediate repeat — the pre-existing behaviour, not a change.

**4. [Exposure] `app.orgPositionsBody`, `app.orgDecisionsBody`, `app.REPORT_SET`, `app.buildPackModel`**
- Attached beside the handlers (not in the `module.exports` tail) per the wave-3 merge protocol; `orgSummaryFor` was already exported.

**5. [Plan intent] pack equality is asserted on the builder, not the PDF bytes**
- A rendered PDF embeds a timestamp and fonts; the model passed to the worker is the contract. The route-level test confirms a `%PDF-` response (or the 503 portability gate on a host without the canvas binding).

**Total deviations:** 5, none architectural; no Phase 8-11 contract changed.

## Issues Encountered

- Host load average 25-31 throughout; every full-suite run was green (3 runs: 1369, 1375, 1379); no known load-flake appeared.
- The first denial-audit assertion in the decisions test assumed one row per refusal; adjusted to the bounded auditor's real contract (deviation 3).

## Verification

| Check | Result |
|---|---|
| `test/read-sets-org-reports.test.js` | 13/13 |
| org-positions, org-decisions, org-flight-risk-audit, org-flight-risk-conversion, org-import, org-summary, org-access-policy, org-dd-read-audit, optimistic-locking-contract, no-get-mutates | 253/253 together with the new suite, **zero edits** |
| reports-export, reports-audit, reports-pack, reports-filename, reports-i18n, reports-pdf, cpu-isolation | 123/123 (with no-get-mutates), **zero edits** |
| `grep -c ORG_READ_SET server.js` / `grep -c REPORT_SET server.js` | 3 / 6 |
| Full suite after the last code commit (`24495c7`) | **1379 tests / 1379 pass / 0 fail** |
| `git status --porcelain` (data/, public/sent_emails) | empty; no STATE.md / ROADMAP.md changes |

## Known Stubs

None.

## Threat Flags

None. No new endpoint or trust boundary; T-12-100..103 mitigations (gates and `hrClearanceFilter` untouched, helper-shared clearance filtering, audit calls left in routes, throwing accessors + builder equality) are in place and tested.

## Merge Notes for the Orchestrator

- Regions edited in server.js: the org-design section (`ORG_READ_SET` before `app.get('/api/org/positions'`, `orgDecisionsBody` before `app.get('/api/org/decisions'`, `orgPositionWriteSet` before `app.post('/api/org/positions'`, summary handler body), `REPORT_SET` immediately above `ReportExportQuerySchema`, `buildPackModel` between the export handler and the pack route's leading comment, and the data-read lines inside `app.get('/api/reports/pack'`. The `// Due Diligence workspace (DD-01/DD-04)` marker and the blank line above it are untouched.
- No STATE.md / ROADMAP.md changes (orchestrator-owned).

## Self-Check: PASSED

- Created: `test/read-sets-org-reports.test.js`, this SUMMARY.
- Commits present: `23a3a29`, `a96c9ec`, `24495c7`.
