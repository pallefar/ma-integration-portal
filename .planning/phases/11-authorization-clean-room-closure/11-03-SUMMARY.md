---
phase: 11-authorization-clean-room-closure
plan: 03
subsystem: auth
tags: [authz, clean-room, clearance, optimistic-locking, 404-not-403, store-backstop, express, sqlite]

requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "conflictIfStale() precheck + clearanceFilter arming (CR-01), db/store.js WHERE-layer conflict, CLEARANCE_SCOPED_COLLECTIONS"
  - phase: 11-authorization-clean-room-closure (11-01, 11-02)
    provides: "read gate, admin-only config writes, test/helpers/deal-fixture.js and route-inventory.js"
provides:
  - "assertRecordVisibleOr404 / recordVisibleTo / recordClearanceFilter / hrClearanceFilter + RecordNotFoundError in server.js"
  - "central 404 { error: 'Not found' } handler, ABOVE the Phase 8 503 and Phase 9 409 handlers (11-04 hangs its denial audit on err.reason === 'clearance' there)"
  - "CLEARANCE_SCOPED_COLLECTIONS extended to the task/RAID lanes and orgPositions/orgFlightRisks; PROVENANCE_SCOPED_COLLECTIONS; hasRestrictedProvenance (db/collections.js)"
  - "provenance-aware conflictVisibleRecord (db/store.js)"
  - "test/clearance-write-paths.test.js (12 tests: acceptance-3 matrix on both lanes, synergy link, conversions, structural gates)"
affects: [11-04 denial audit, 11-08 route-inventory/denial scenarios]

tech-stack:
  added: []
  patterns:
    - "invisible == missing: one thrown typed error, one central 404 body, no 403/409 echo"
    - "guard-before-conflictIfStale on every by-id write route, filter armed on the db context"
    - "store backstop fails closed by PROVENANCE for lanes whose restriction is derived, not stored"
    - "structural source-scan gate classifies routes by lane helper and fails on an unfiltered conflictIfStale caller"

key-files:
  created:
    - test/clearance-write-paths.test.js
  modified:
    - server.js
    - db/collections.js
    - db/store.js
    - test/task-access-filter.test.js
    - test/raid-access-filter.test.js

key-decisions:
  - "RecordNotFoundError 404 handler sits ABOVE the 503/409 handlers (orchestrator-accepted at the tracer gate)"
  - "Demo-store requests have deal = null; grantedAreas() fails closed for every role there, so a clearance-stamped record is invisible even to admin in the demo store — identical to the existing read filter; kept (orchestrator-accepted)"
  - "A re-convert whose source-matched existing record is outside the converter's clearance answers 404 via assertRecordVisibleOr404 — never a leak, never a duplicate (orchestrator-accepted)"
  - "orgPositions/orgFlightRisks ARE added to CLEARANCE_SCOPED_COLLECTIONS, after arming a new hrClearanceFilter on the five org conflictIfStale callers (the plan's 'arm first, then add' branch)"
  - "An uncleared member's synergy edit PRESERVES existing restricted taskIds links it cannot see (neither dropped nor oracle-able)"
  - "Store backstop is deliberately conservative: restricted provenance (stamp or dd-finding:/org-flightrisk: source) withholds the echo even when the server resolver would call an orphaned record unrestricted"

patterns-established:
  - "assertRecordVisibleOr404(req, db, deal, record) before conflictIfStale(...{ clearanceFilter }) on every by-id task/RAID write"
  - "look up and clearance-check ALL source-matched existing records BEFORE the first lane mutation (readDb() shared cache)"

requirements-completed: [AUTHZ-03]

duration: ~2h (tracer previously; Tasks 2-3 this run)
completed: 2026-10-10
status: complete
actuals:
  tokens: 18700   # chars/4 over the realized diff vs base e9c18bf (74,958 chars)
  tasks: 3
  commits: 3   # 00f79ba, 714a981, 04cc1d2 (+ merge b46d66b bringing the tracer in)
---

# Phase 11 Plan 03: Task/RAID write-path clean-room closure Summary

**An uncleared deal member can no longer read (409 echo), overwrite, status-flip, delete, link or convert-over an hr-area task or RAID entry by id: every such path answers the byte-identical `404 { error: 'Not found' }` a missing id gets, and the store's WHERE-layer conflict now fails closed for restricted provenance (closes 09-SECURITY UF-2).**

## Performance

- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Commits:** 3 task commits, suite green at each: 1056 (tracer worktree), 1089 (combined baseline), 1097 (Task 2), 1102 (Task 3)
- **Files:** 1 new suite, 5 modified files

## Accomplishments

- PRD acceptance 3 proven on BOTH lanes (default and `demoMode:false` custom): update, status flip and delete of an hr-area task and RAID entry, with a current, a stale (`?expectedVersion=999` / `version: 999`) and no version, answer 404 `{"error":"Not found"}`; no field of the record appears in any response; the stored record re-reads byte-for-byte unchanged; a missing id answers the identical bytes.
- Cleared member (hr grant), the IL and admin are unaffected; unrestricted manual tasks/RAID entries stay fully editable/deletable by the uncleared member (over-blocking regression row).
- Both conversion routes dedupe and return records exactly as before for the cleared converter; a record stamped for an area the converter lacks answers 404 and creates no duplicate.
- Synergy linking: a restricted task id is refused with the same 400 as an unknown id (the only difference in the body is the id the caller supplied).
- Store layer: with no route filter armed, a WHERE-layer conflict on any of the four task/RAID lanes withholds `currentRecord` for restricted provenance, still echoes ordinary records, and keeps version + attribution (T-09-17).
- A structural source scan fails the suite when any `conflictIfStale(` caller on a clearance-scoped lane omits `clearanceFilter`.

## Task Commits

1. **Task 1 (tracer): guard on the task update path** - `00f79ba` (merged into this branch by `b46d66b`)
2. **Task 2: every task/RAID write, delete, synergy link and conversion path** - `714a981`
3. **Task 3: provenance-aware store backstop + structural gate** - `04cc1d2`

## Decisions and Findings (requested by the plan)

### orgPositions / orgFlightRisks decision

Read every org `conflictIfStale` caller (POST/DELETE `/api/org/positions`, POST/DELETE `/api/org/flight-risk`, POST `/api/org/flight-risk/:id/convert`): all five passed NO clearanceFilter, relying on a whole-route `hr` area-grant check at the top of the handler. Per the plan's "if any path does not arm one, arm it first" branch, a new `hrClearanceFilter(req, deal)` (restates that one `hr` grant on the conflict body and arms the WHERE layer) is now passed at all five sites, and both lanes were added to `CLEARANCE_SCOPED_COLLECTIONS`. For an hr-cleared caller nothing changes (the filter passes the record, the Phase 9 dialog is unchanged); the benefit is that a future route that reaches an org row without the whole-route gate fails closed. The remaining org write routes (create, copy-to-target, import) only insert and cannot raise a version conflict.

### Synergy enrichment finding and line boundary (amendment 4)

`GET /api/synergies` and `GET /api/synergies/rollup` do NOT enrich linked tasks: `taskIds` is echoed as the stored id array only, and the client (`public/js/execution.js` `renderTaskProgress`) resolves ids against the already clearance-filtered `GET /api/integration-tasks` list. Ids are not record content, so no read-side change was made and **no line of `GET /api/synergies` or the rollup region was touched**. The exact boundary 11-03 owns in the synergy section: `resolveSynergyTaskIds` (signature now `(taskIds, db, req, deal, existing)`) and its two call sites inside `POST /api/synergies` (the update branch's `if (b.taskIds !== undefined)` block and the create branch's `createdTaskIds` block). The `synergyStaleDays` call sites and the rollup region (11-02's) were not edited.

### instantiate / from-remediation

`POST /api/integration-tasks/instantiate` and `/from-remediation` only create (source-deduped by `template:`/`remediation:` sources) and return `{ success, created: <count> }` — no record body is echoed and neither source prefix is clearance-bearing, so no change was needed.

## Deviations from Plan

### Auto-fixed / auto-added

**1. [Rule 2 - Missing critical functionality] DD re-convert returned a restricted record to a member not cleared for its stamped area**
- **Found during:** Task 2 (conversion read-through)
- **Issue:** `POST /api/dd/findings/:id/convert` clears the caller for the FINDING's current area only. `clearanceArea` is sticky by design (WR-03), so after an admin re-points a finding hr -> legal, a legal-only member re-converting got the hr-stamped task/RAID back in the 200 body (and the dedupe path mutated the finding's link arrays).
- **Fix:** both convert routes now look up the source-matched existing task and RAID entry and call `assertRecordVisibleOr404` BEFORE either lane is touched (the shared `readDb()` cache would otherwise keep a pushed task after a later 404).
- **Files modified:** server.js, test/clearance-write-paths.test.js (conversion row + structural order assertion; mutation-checked — removing the guard fails 2 tests)
- **Commit:** 714a981

**2. [Rule 2 - Missing critical functionality] Uncleared synergy edit would silently drop restricted links**
- **Found during:** Task 2 (`resolveSynergyTaskIds` change)
- **Issue:** once a restricted id is "unknown" to the caller, an explicit `taskIds` array from an uncleared member would have overwritten and erased an existing link to a task they cannot see.
- **Fix:** `resolveSynergyTaskIds` returns `preserved` (existing links that are in the lane but invisible to the caller) and the update branch appends them. The caller can neither add nor remove a link it is not cleared for.
- **Commit:** 714a981

**3. [Plan-sanctioned branch, not a deviation of intent] hrClearanceFilter armed on five org routes** — see "orgPositions / orgFlightRisks decision". Commit 04cc1d2.

### Plan text vs reality (intent followed)

- `DELETE /api/RAID/:id`, `/api/raid//:id`, `/api/raid/:id/` (D-11-07): the unregistered spellings are already refused by the VAL-01 schema gate ("No schema registered for DELETE ... refusing") before reaching a handler, and the test asserts they never answer 200 and never echo a record. They do not reach `assertRecordVisibleOr404` at all.
- `test/optimistic-locking-contract.test.js` was NOT edited and passes unchanged. Its CR-01 (b) title still says raidEntries is "NOT clearance-scoped"; the assertion it makes (an ordinary, provenance-free RAID entry still echoes on a WHERE-layer conflict) remains true under the provenance-aware fallback, only the title wording is now historical. Left alone per "Phase 9/10 contract suites must pass unchanged".
- The route-level try/catch gotcha: none of the guarded routes (task POST/DELETE, RAID POST/DELETE, both convert routes, POST /api/synergies) wrap their guarded path in a try/catch, so `RecordNotFoundError` propagates to the central handler with no forwarding site needed; each route is proven by a test that would answer 200/409 if its guard were missing (the tracer's stale-version row, the matrix rows, and the mutation check above).

## Accepted residuals (unchanged, documented)

- `GET /api/notifications` nudge counts `tasks_overdue` / `tasks_blocked` / `raid_high` are computed over the unfiltered lanes (T-ERM-08, an aggregate integer with no title/owner) — out of this plan's scope and untouched.
- `GET /api/synergies` echoes stored `taskIds` (ids only, not record content), so an uncleared member can see that an initiative links N tasks; the ids resolve to nothing in their own filtered task list.
- T-11-23 timing: missing vs invisible do the same one in-memory lane scan plus an in-memory finding lookup; no I/O difference.

## Issues Encountered

- Heredoc-based edits were refused by the worktree command guard; all edits were made with the Edit tool instead.
- The first structural-gate draft classified `POST /api/synergies/:id/confirm-current` as a clearance-scoped route because the route "text" ran into the following `raidLane(db)` helper definition; fixed by ending a route at its first column-0 `});`.

## Verification

- `node --test` full suite: **1102 tests, 1102 pass, 0 fail** (baseline 1089 after the tracer merge).
- `node --test test/clearance-write-paths.test.js test/task-access-filter.test.js test/raid-access-filter.test.js test/synergy-tasks.test.js test/org-flight-risk-conversion.test.js test/dd-findings.test.js test/optimistic-locking-contract.test.js test/optimistic-locking-cross-process.test.js test/optimistic-locking-precondition.test.js` green.
- Acceptance greps: `assertRecordVisibleOr404(req, db, deal` call sites in server.js >= 4 (task POST, task DELETE, RAID POST, RAID DELETE, plus both convert routes use `deal` too); `class RecordNotFoundError` count 1; the four task/RAID collections and `hasRestrictedProvenance` exported from db/collections.js.
- Mutation checks run and reverted: removed the DD-convert guard (2 tests fail), removed `clearanceFilter` from `DELETE /api/org/positions/:id` (structural gate fails naming it).
- `git status --porcelain data/` empty; no `public/sent_emails` change; STATE.md / ROADMAP.md untouched.

## Known Stubs

None.

## Threat Flags

None. (No new network endpoint, auth path or schema; the new 404 branch is the one the plan specified.)

## Self-Check: PASSED

- FOUND: test/clearance-write-paths.test.js, db/collections.js (hasRestrictedProvenance), db/store.js (PROVENANCE_SCOPED_COLLECTIONS use), server.js (class RecordNotFoundError, hrClearanceFilter)
- FOUND commits: 00f79ba, 714a981, 04cc1d2
