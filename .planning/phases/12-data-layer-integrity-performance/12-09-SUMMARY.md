---
phase: 12-data-layer-integrity-performance
plan: 09
subsystem: database
tags: [sqlite, read-path, list-query, paging, clearance, tasks]
requires:
  - phase: 12-data-layer-integrity-performance
    provides: "12-05 readCollections/readProjection, lib/listQuery.js, clearanceAreaFromProvenance, areaVisibleTo"
provides:
  - "GET /api/integration-tasks filter + paging over a light projection (TASK_LIST_SPEC)"
  - "taskLaneName, TASK_READ_SET, taskRowVisible, taskProjectionVisibleRows in server.js"
  - "POST/DELETE /api/integration-tasks on readCollections(TASK_READ_SET)"
status: partial
---

# Phase 12 Plan 09: Execution-family proportional reads — PARTIAL (Task 1 of 3 done)

**PARTIAL — resume at Task 2.** Task 1 (the tracer) is complete, committed and verified; Tasks 2 and 3 are not started.
The executor stopped at a task boundary because of context pressure, not because of a failure.

## Task status

| Task | Name | Status | Commit |
|------|------|--------|--------|
| 1 (tracer) | GET /api/integration-tasks paged/filtered; task writes on the task read set | DONE | `a4c9db9` |
| 2 | notifications, synergies + rollup, checklist templates, employees, assessment status on read sets | NOT STARTED | — |
| 3 | scripts/perf/run-all.js + `npm run perf`; measurements; D-12-02 readDb() inventory | NOT STARTED | — |

Tracer gate (autonomous policy): Task 1's `<verify>` re-ran end to end — tasks-list-query 8/8, task-access-filter /
clearance-write-paths / optimistic-locking-contract / raid-access-filter / no-get-mutates / read-policy-matrix pass
unedited, full suite **1366 -> 1374/1374, 0 failures**. "Tracer verified end-to-end — expanding".

## What Task 1 delivered (server.js, route level)

| Route / function | Before | After |
|---|---|---|
| GET /api/integration-tasks | `readDb()` + `reportTaskRows` | `parseListQuery(TASK_LIST_SPEC)` -> `readSingleton('settings')` -> `readProjection(taskLaneName(...), [clearanceArea, source, + filter fields])` -> `taskRowVisible` (lazy `ddFindings` id/area map) -> `applyListFilters` -> `sendList`. No params: bare array assembled from stored raw JSON, byte-identical (asserted against rows read from the deal file for hrbp and 3 restricted pmo identities). `limit`/`offset` -> `{ items, total }`; `status`, `owner`, `workstream`, `phase`, `q` (title); invalid -> 400 `{ error: 'Invalid list query.' }` |
| POST /api/integration-tasks | `readDb()` | `readCollections(TASK_READ_SET)` = settings, integrationTasks, customIntegrationTasks, ddFindings |
| DELETE /api/integration-tasks/:id | `readDb()` | `readCollections(TASK_READ_SET)` |
| `resolveTaskClearanceArea` | own copy of the rule | delegates to `clearanceAreaFromProvenance` (one core for task + RAID lanes) |
| `reportTaskRows` | inline area test | `taskRowVisible()` (same predicate as the paged list); still calls `resolveTaskClearanceArea` |
| `taskLane` | unchanged body | unchanged; `taskLaneName(settings)` added beside it |

Placement: all new constants/functions sit beside the task handlers / `resolveTaskClearanceArea` (nothing in the
top-of-file constants block or the `module.exports` tail). `server.js` was not touched outside the task region.

## Deviations from Plan

**1. [Rule 3 - Blocking] `test/task-access-filter.test.js` (j) pins the old delegation textually.** It requires the
`GET /api/integration-tasks` handler body to contain `reportTaskRows(` and `reportTaskRows`'s body to contain
`resolveTaskClearanceArea`. The plan makes GET stop calling `reportTaskRows` and says the suite must pass unchanged.
Same situation as 12-05 deviation 1. Fix: an in-handler comment names `reportTaskRows()` and `taskRowVisible`;
`reportTaskRows` keeps calling `resolveTaskClearanceArea` and presents the resolved area to `taskRowVisible` as the stamp
(provably the same result: a stamp is returned first by `clearanceAreaFromProvenance`). The suite passes unedited, but
(j) proves the text, not delegation; the real equivalence is proven by tasks-list-query (a)/(c)/(d)/(e). Recommend a
later plan update (j) to assert `taskRowVisible(`. Commit `a4c9db9`.

**2. [Interpretation] `q` searches `title` only** (tasks carry no `notes` field; RAID searches title + notes).

## Notes for the continuation (Task 2 design, verified against the code, not yet applied)

Read sets (the throwing accessor will name anything missed — add it, never fall back to `readDb()`):
- `GET /api/checklist-templates`: `['checklistTemplates']`.
- `GET /api/employees`: `['settings','employees','customEmployees','courses']` (`getCatalogLessonIds` reads `db.courses`; `scaleEmployeesForDay` is pure; the demo scaling keys on `req.isDemo`).
- `GET /api/assessment-status`: `['settings','customSettings','assessmentTemplates','assessmentInstances','customAssessmentInstances']`; builder needs `stripNames` (= `lockedDown(req) && !isAdminRequest(req)`) and `req.portalUser` — pass them in a ctx.
- `GET /api/synergies` + `/rollup`: `['settings','synergyInitiatives','customSynergyInitiatives','integrationTasks','customIntegrationTasks','ddFindings']` (`synergyLinksVisibleTo` -> `taskLane` + `recordVisibleTo` -> `resolveTaskClearanceArea` -> `ddFindingsLane`). `dealSettingsFor(req)` is control-plane (no db). Builders take `(db, req, nowMs)`; expose as `app.<name>`.
- `GET /api/notifications`: `readCollections(['settings','assessmentTemplates','assessmentInstances','customAssessmentInstances'])` for templates/instances/`portalNowMs`; task counts from `readProjection(taskLaneName(db.settings), ['status','due'])` (overdue = `status !== 'done' && due && due < today`, blocked = `status === 'blocked'`), RAID count from `readProjection(raidLaneName(db.settings), ['status','severity'])` (`status !== 'closed' && severity in high|critical`). Keep the 11-05 role gate and the `// In-app notifications — computed on demand` marker verbatim; leave >= 1 untouched line before `portalNowMs` and after the handler (`DELETE /api/raid/:id` follows it and is 12-05's).
- Test idea that needs no production hook: in `test/read-sets-execution.test.js`, wrap `JSON.parse` in-process during the notifications request and count calls whose argument looks like a task/RAID row (the server runs in the test process). Run builders under `store.runWithDb({ conn, kind, dealId, dbPath }, ...)` against `store.readDb()` for the equality assertions (see test/audit-log.test.js:73 for the context shape).
- Fixture pattern: copy the seeding in `test/tasks-list-query.test.js` (`createDealFixture` + direct INSERT into the lane tables, lane chosen from the settings row's `demoMode`).

Task 3 notes: `scripts/perf/{write-latency,list-reads,load-40,pack-isolation}.js` already exist from 12-02/12-04/12-05/12-06;
`run-all.js` runs them sequentially (`list-reads --runs 3`, `load-40 --runs 3`), forwards `--assert`, prints a summary table and a
last line `PERF PASS` / `PERF FAIL <script>`; add `"perf": "node scripts/perf/run-all.js"` to package.json only.
Perf scripts refuse to start below 1 GB free; host load was ~12-40 at the start of this run (disk 94% used, 28 GiB free).

## Verification (Task 1)

| Check | Result |
|---|---|
| test/tasks-list-query.test.js | 8/8 |
| task-access-filter, clearance-write-paths, optimistic-locking-contract, raid-access-filter, no-get-mutates, read-policy-matrix | pass, zero edits |
| `grep -c taskRowVisible server.js` | 5 |
| Full suite | 1366 -> **1374/1374**, 0 failures |
| `git status --porcelain data public/sent_emails` | empty |

## Threat model coverage so far

T-12-80 (total/q oracle) and T-12-81 (lane drift) mitigated and tested in Task 1; T-12-82 / T-12-83 belong to Task 2.

## Known Stubs

None.
