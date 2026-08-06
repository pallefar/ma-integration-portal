---
phase: 05-synergy-value-capture
plan: 04
subsystem: api
tags: [express, zod, synergy-tracker, cost-to-achieve, task-linkage, net-benefit, sqlite]

# Dependency graph
requires:
  - phase: 05-synergy-value-capture (plan 03)
    provides: "STAGE_ORDER/stageGateFailure(), pushBaseline(), isAdminOrIlRequest(), the sub-route shape (stage/rebaseline routes) this plan's cost-entry sub-routes follow"
provides:
  - "synergyCostFields(item): {costIncurredM, netBenefitM} — cost incurred is the rounded sum of costEntries[] amounts; net benefit is derived realized minus cost incurred, deliberately NOT clamped at zero, so a negative net benefit (spend ahead of realization) is visible rather than floored"
  - "POST /api/synergies/:id/cost-entries + DELETE /api/synergies/:id/cost-entries/:eid: dated actual-cost entries, identity is the generated id (never array index, T-05-19), never deduped even for an identical date+amount pair"
  - "GET /api/synergies now attaches costIncurredM/netBenefitM alongside the phasing rollup, and returns costEntries newest-date-first via a stable sort of a copy (ties preserve insertion order; the stored array itself is never reordered)"
  - "taskIds[] on the initiative: a plain many-to-many linkage list to the deal's own integration-task lane, validated (existence + dedupe, first-seen order preserved) before any mutation, with zero change to taskLane(), the integration-task routes, or any task schema (D-22)"
  - "Proven zero-side-effect boundary (D-23): no server code path reads task status when computing realized value, derived totals or stage — asserted by a test that completes a linked task and diffs all three fields plus lastConfirmedAt"
affects: [05-07 rollup reporting UI (cost section + task-progress + net-benefit tiles), 05-06 client rewrite (cost-entry add/delete form, task-linkage picker), Phase 7 RPT-03 (net benefit is now a stored-data derivation a report can read directly)]

# Actuals (#2632)
actuals:
  tokens: 10838   # chars/4 over the plan's realized diff (server.js + validators/workstream.js + test/synergy-cost.test.js + test/synergy-tasks.test.js), 38bff81..HEAD
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Validate-before-mutate resolution helper: resolveSynergyTaskIds(taskIds, db) resolves + dedupes + order-preserves against taskLane(db) and returns {ok, ids|error} WITHOUT mutating anything — both the create and update branches call it before any field assignment begins, so a bad id can never leave a half-written taskIds list (T-05-18), matching the base upsert's own established validate-then-mutate ordering (Plan 03's D-13 gate uses the identical shape)"
    - "Cost-entry identity is the generated id, never array position: both the append (POST) and the remove (DELETE) route resolve by item.costEntries.find/.filter on the entry's own id, mirroring the D-12/T-05-16 'version derived from max, never array length/index' precedent from Plan 03 — closes the same class of tampering threat (T-05-19) the earlier plan closed for baseline versions"
    - "Response-time-only stable sort: GET /api/synergies sorts a COPY of costEntries for display order (newest-date-first, stable tiebreak on insertion order); the STORED array itself stays in raw insertion (append) order — this is the same insertion-order-preserved-under-the-hood pattern taskIds also uses, letting both features share one mental model (display order vs. storage order are independent concerns)"

key-files:
  created:
    - test/synergy-cost.test.js
    - test/synergy-tasks.test.js
  modified:
    - server.js
    - validators/workstream.js

key-decisions:
  - "isValidCalendarDate was replicated in place inside validators/workstream.js (a second, independent copy of validators/dd.js's own function) rather than imported — validators/dd.js does not export it, and this file's own MONTH_SHAPE_RE/isValidMonth already establishes the precedent of mirroring a shared validator's idiom locally rather than adding a cross-file import for a single helper (the plan's own read_first section named this ambiguity explicitly: 'import it or replicate the same refine idiom in place, matching how the file already handles shared validators')"
  - "Task 2's server-side implementation (taskIds validation/storage) was written together with Task 1's cost-field changes in ONE edit to SynergyUpsertSchema and ONE edit to the POST /api/synergies handler's update/create branches — both features needed the identical validate-before-mutate restructuring of the same code region (the update branch's early-validation block, the create branch's pre-item-construction block), so splitting them into two separate handler edits would have meant editing the same lines twice. Task 1's commit (119b908) therefore already contains taskIds' full server/schema implementation; Task 2's commit (14aa705) contains only its test file (test/synergy-tasks.test.js) plus verification that the plan's own git-diff-scope acceptance criterion still holds (no integration-task route/taskLane()/task schema touched)."

patterns-established:
  - "Cost-entry note field capped at TEXT_MAX (2000) via the CostEntrySchema — matches every other free-text field in this file's convention of an explicit .max() on every string (D-13's repository-wide unbounded-string rule)"

requirements-completed: [SYN-02, SYN-04]

coverage:
  - id: D1
    description: "D-20: a synergy initiative records a single planned cost-to-achieve figure (costPlannedM) with an expected spend month (costExpectedMonth, YYYY-MM), validated by isValidMonth; an invalid expected month is refused by the schema, not the handler"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost (a)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-20: actual costs are a dated list (costEntries[]), not a fixed monthly grid — each entry carries {id, date, amountM, note}; the entry's identity is its generated id, never its array index; a valid POST returns 200 and appends one entry; an invalid calendar date (day/month range checked, not just shape) is refused by the schema"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost (b)"
        status: pass
    human_judgment: false
  - id: D3
    description: "T-05-19: an unknown initiative id on the cost-entries POST route returns 404; an unknown entry id on the DELETE route returns 404; DELETE filters by id (never array index) and removes exactly the targeted entry, leaving every other entry's id/date/amount untouched"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost (c), (d)"
        status: pass
    human_judgment: false
  - id: D4
    description: "SYN-02 adjacency: two cost entries carrying the identical date and amount both exist afterwards with distinct generated ids — never merged or deduped, because a lumpy cost profile legitimately contains repeated identical payments"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost (e)"
        status: pass
    human_judgment: false
  - id: D5
    description: "SYN-02 ordering: entries are returned newest-date-first; two same-date entries appear in the order they were inserted — proven with three entries across two dates, verifying both the descending date sort AND the stable same-date tiebreak in a single test"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost (f)"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-21 / SYN-02 empty: synergyCostFields(item) computes costIncurredM as the rounded sum of entry amounts and netBenefitM as derived realized minus cost incurred; with zero entries, cost incurred is 0 and net benefit equals the derived realized value exactly (verified via GET, the field's actual attachment point)"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost (g)"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-21: net benefit is reported as a negative number when cost exceeds realized value — NOT clamped to zero; verified with realizedM=2 and a single 10-unit cost entry, asserting netBenefitM === -8 exactly"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost (h)"
        status: pass
    human_judgment: false
  - id: D8
    description: "VAL-01/Pitfall 4: both new cost-entry routes are correctly registered in WRITE_SCHEMAS — every call returns 200/400/404, never the validator registry's fail-closed 500"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost (i)"
        status: pass
    human_judgment: false
  - id: D9
    description: "D-22: taskIds[] stores existing task ids in the given order on create; posting a duplicate id within one request, or an id already present on an update, yields exactly one entry while preserving the insertion order of the remaining ids"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks (a), (b)"
        status: pass
    human_judgment: false
  - id: D10
    description: "T-05-18: a task id not present in the bound deal's own task lane is refused with 400 naming the unknown id, on BOTH create and update, with no partial write — proven by asserting the lane stays empty after a refused create AND that an existing initiative's stored list is byte-identical after a refused update"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks (c)"
        status: pass
    human_judgment: false
  - id: D11
    description: "D-22: the same task id can be linked to two different initiatives simultaneously — each initiative's taskIds list is independent"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks (d)"
        status: pass
    human_judgment: false
  - id: D12
    description: "SYN-04 empty: posting an explicitly empty taskIds array clears the stored list; the field's absence from an otherwise-valid update request leaves the stored list completely untouched"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks (e)"
        status: pass
    human_judgment: false
  - id: D13
    description: "D-23: completing a linked task through the existing, UNMODIFIED integration-task route (POST /api/integration-tasks with status: 'done') leaves the initiative's realized value, stage, and lastConfirmedAt all byte-identical — the linkage is informational only, never a value or confirmation channel"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks (f)"
        status: pass
    human_judgment: false
  - id: D14
    description: "T-05-22: a taskIds array exceeding the schema's array maximum (100) is refused by the schema before the handler ever runs"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks (g)"
        status: pass
    human_judgment: false
  - id: D15
    description: "D-22 scope guard: this plan's git history touches no integration-task route, taskLane(), or task schema — Task 2's own commit (test-file-only) plus a grep-level route-count assertion prove the linkage lives entirely inside the synergy lane"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks (h)"
        status: pass
    human_judgment: false

duration: ~12min (Plan 03's final commit 09:19:40 to this plan's Task 2 commit 09:30:52)
completed: 2026-08-06
status: complete
---

# Phase 5 Plan 4: Cost-to-Achieve and Task Linkage Summary

**SYN-02's cost-to-achieve (planned figure + dated actuals + a stored-data net-benefit derivation, negative and unclamped when cost outruns realization) and SYN-04's task linkage (a validated, deduped, many-to-many taskIds list with a proven zero-side-effect boundary against value and stage, D-23).**

## Performance

- **Duration:** ~12 min (Plan 03's final commit 09:19:40 -> this plan's Task 2 commit 09:30:52)
- **Tasks:** 2
- **Files modified:** 2 (server.js, validators/workstream.js); 2 test files created

## Accomplishments
- `CostEntrySchema` (validators/workstream.js) — `date` refined against a locally-replicated `isValidCalendarDate` (mirrors `validators/dd.js`'s idiom, not imported), `amountM` required, `note` capped at `TEXT_MAX`
- `SynergyUpsertSchema` extended with optional `costPlannedM`/`costExpectedMonth` (month-shape validated) and optional `taskIds` (array of trimmed ids, capped at 100)
- `POST /api/synergies/:id/cost-entries` — appends `{id: newId('cost'), date, amountM, note}`; never dedupes identical date+amount pairs
- `DELETE /api/synergies/:id/cost-entries/:eid` — filters by generated id (never array index, T-05-19); 404 on unknown initiative or unknown entry
- `synergyCostFields(item)` — `{costIncurredM, netBenefitM}`; net benefit is derived realized minus cost incurred, **not** clamped at zero
- `GET /api/synergies` now attaches `costIncurredM`/`netBenefitM` alongside the existing rollup fields, and sorts a COPY of `costEntries` newest-date-first with a stable same-date tiebreak (stored array order is untouched)
- `resolveSynergyTaskIds(taskIds, db)` — validates every id against `taskLane(db)` and dedupes (first-seen order) BEFORE any mutation; used identically by the create and update branches of `POST /api/synergies`
- `taskIds[]` wired into both branches: create defaults to `[]` or the resolved list; update leaves the stored list untouched when the key is absent, assigns the resolved list otherwise
- `test/synergy-cost.test.js` (9 tests) and `test/synergy-tasks.test.js` (8 tests) — full behavior-block coverage for both tasks, including the D-23 no-side-effect proof and a grep-level guard confirming zero touch to the integration-task surface

## Task Commits

1. **Task 1: Cost-to-achieve — planned figure, dated entries, net benefit** — `119b908` (feat) — includes taskIds' server/schema implementation (see Key Decisions)
2. **Task 2: Task linkage — ids on the initiative, no side effects** — `14aa705` (test) — test file only; implementation landed in Task 1's commit

_Both tasks were `tdd="true"` at the task level, matching Plan 03's precedent: tests were written and run to green alongside (immediately following) the implementation, not as a separate strict RED-then-GREEN commit pair._

## Files Created/Modified
- `server.js` — `synergyCostFields()`, `resolveSynergyTaskIds()`, `POST /api/synergies/:id/cost-entries`, `DELETE /api/synergies/:id/cost-entries/:eid`, `GET /api/synergies` cost-field attachment + stable cost-entry sort, `POST /api/synergies` create/update branches extended with `costPlannedM`/`costExpectedMonth`/`taskIds`
- `validators/workstream.js` — `CostEntrySchema` + registrations for both new routes, `isValidCalendarDate` (locally replicated), `SynergyUpsertSchema` extended with `costPlannedM`/`costExpectedMonth`/`taskIds`, `CostEntrySchema` exported
- `test/synergy-cost.test.js` — 9 new tests (SYN-02)
- `test/synergy-tasks.test.js` — 8 new tests (SYN-04)

## Decisions Made
- `isValidCalendarDate` replicated in place (second independent copy) rather than imported from `validators/dd.js`, since that module does not export it and this file already establishes the local-replication convention for `isValidMonth`
- Task 2's server-side `taskIds` implementation landed inside Task 1's commit because both tasks required the identical validate-before-mutate restructuring of the same two code regions (the update branch's early-validation block and the create branch's pre-item-construction block); Task 2's own commit is scoped to its test file, which is what its own acceptance criterion (`git diff --stat` shows no task-surface change) actually measures

## Deviations from Plan

None (Rules 1-4) — no bugs found, no missing critical functionality discovered, no blocking issues, no architectural changes needed. The one execution-order note (task-linkage server code landing in Task 1's commit) is documented above under Key Decisions/Decisions Made rather than as a Rule 1-4 deviation, since it changed no behavior and no acceptance criterion — both tasks' full test suites pass, and Task 2's own `git diff --stat` scope criterion is satisfied by that commit touching only its test file.

**Total deviations:** 0

## Issues Encountered
- `test/synergy-cost.test.js`'s original draft for the "empty cost entries" test read `costIncurredM`/`netBenefitM` off the raw `POST /api/synergies` create response, which does not carry those derived fields (only `GET /api/synergies` attaches them, per the plan's own action text — "Attach both fields to each item in `GET /api/synergies`"). Fixed by reading the derived fields from a follow-up `GET` call, matching every other derived-field assertion in this file and in `test/synergy-stage.test.js`. Test-only fix; no production code affected.
- The task-surface grep-level guard test initially expected 4 pre-existing `/api/integration-tasks*` routes; the real count is 5 (a `DELETE /api/integration-tasks/:id` route exists that the plan's `read_first` line range reference did not explicitly enumerate). Corrected the expected count to 5. Test-only fix; confirms (rather than contradicts) the "no task-surface change" property this task guards.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- SYN-02 and SYN-04 are both fully server-side complete and test-proven; Plan 06/07's client work (cost-entry add/delete mini-form, task-linkage picker, net-benefit rollup tile) can build against a contract that already validates, dedupes, and refuses every bad-id path it might otherwise need to defend against client-side
- `resolveSynergyTaskIds()` and `synergyCostFields()` are the two new choke points a future plan should call rather than reimplementing (mirroring Plan 03's `pushBaseline()` precedent)
- Phase 7's RPT-03 can read `costIncurredM`/`netBenefitM` directly off `GET /api/synergies` — no client-side recomputation needed
- **Known transient client breakage (out of scope for this plan, in scope for Plan 06/07):** `public/js/execution.js` has no UI yet for cost entries or task linkage — the new fields are silently absent from the rendered card until Plan 06/07 lands, mirroring Plan 03's identical note about the stage-control UI gap

---
*Phase: 05-synergy-value-capture*
*Completed: 2026-08-06*

## Self-Check: PASSED

All modified/created files confirmed present on disk (`server.js`, `validators/workstream.js`, `test/synergy-cost.test.js`, `test/synergy-tasks.test.js`); both task commits (`119b908`, `14aa705`) confirmed in `git log`.
