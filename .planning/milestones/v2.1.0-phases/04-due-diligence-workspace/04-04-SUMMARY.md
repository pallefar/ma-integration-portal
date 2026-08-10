---
phase: 04-due-diligence-workspace
plan: 04
subsystem: api
tags: [express, better-sqlite3, zod, access-control, audit-log, mnpi]

# Dependency graph
requires:
  - phase: 04-due-diligence-workspace (Plan 01)
    provides: db/accessPolicy.js's DD_AREA_IDS/grantedAreas()/filterByAreaGrant()/assertAreaGrant(), the ddFindings collection/table, ddRequestLane()-style flat-lane pattern, refuseDdArea()/ddAreaRefused() uniform-403 audit choke point
  - phase: 04-due-diligence-workspace (Plan 03)
    provides: the instantiate-route dedup-by-source pattern this plan's convert route reuses (not calls)
provides:
  - "ddFindingsLane(db) and the full findings CRUD surface: GET/POST /api/dd/findings, GET/DELETE /api/dd/findings/:id"
  - "DD_AREA_WORKSTREAM (server.js) — the D-25 area-to-workstream mapping, reused by any future conversion surface"
  - "POST /api/dd/findings/:id/convert — one-click, bidirectional, idempotent finding-to-task/RAID conversion"
  - "RAID_LEVELS extended to four levels (['low','medium','high','critical']) in both server.js and validators/workstream.js, kept in sync by a source-level test"
  - "`source` field on RAID entries — the reverse half of the bidirectional DD-finding<->RAID link"
  - "public/js/due-diligence.js findings section: create form, per-finding severity/owner/status controls, convert-to-task/convert-to-RAID buttons"
affects: [04-05-PLAN, 04-06-PLAN, 04-07-PLAN, 04-08-PLAN]

# Actuals (#2632)
actuals:
  tokens: 12945
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Independent-copy anti-drift test: two structurally identical but non-shared constant arrays (server.js's RAID_LEVELS and validators/workstream.js's RAID_LEVELS) are both exported and compared via assert.deepStrictEqual in the test suite, so a future edit to only one copy fails the build immediately instead of silently diverging"
    - "Convert-route dedup-by-source, reused a third time: POST /api/dd/findings/:id/convert follows the exact 'source' string + find-or-create + one-write-at-the-end shape POST /api/integration-tasks/from-remediation and POST /api/dd/request-items/instantiate already established, without calling either — a new route entirely, because neither existing route accepts a finding-shaped input"
    - "Clearance-before-read on a write route: the convert handler calls ddAreaRefused() against the finding's stored area BEFORE any field of the finding is read into the response, closing the read-side-channel threat (T-04-23) the same way Plan 01's by-id routes already do"

key-files:
  created:
    - test/dd-findings.test.js
  modified:
    - server.js
    - validators/dd.js
    - validators/workstream.js
    - public/js/due-diligence.js
    - public/due-diligence.html

key-decisions:
  - "DdFindingConvertSchema registration deferred from Task 1 to Task 3's own commit — even though validators/dd.js could have carried the schema earlier, registering a schema for a route that does not exist yet is scope creep the task boundaries did not ask for; the plan's own task split (findings CRUD in Task 1, RAID_LEVELS in Task 2, convert route + schema in Task 3) is honored literally so each commit's diff matches its own task's stated scope."
  - "RAID_LEVELS exported from both files (server.js's module.exports.RAID_LEVELS, validators/workstream.js's RAID_LEVELS) purely so a source-level test can assert the two independent copies agree — this is the ONLY reason either export was added; neither copy needed to be exported for its own route's behavior."
  - "A manually-created RAID entry's `source` field defaults to `''`, not `'manual'` (unlike the task shape's own default) — no existing UI or route reads `entry.source` for anything other than the convert route's dedup lookup, so an empty default carries less unexplained-sentinel risk than inventing a labeled default with no consumer."
  - "DD_AREA_WORKSTREAM is placed directly after the findings CRUD routes in server.js (not beside REMEDIATION_WS in the tasks section) — it is findings-specific, D-25-locked, and the plan's own interface contract names it as belonging to this plan's own section, not the general execution-engine section REMEDIATION_WS lives in."

patterns-established:
  - "Bidirectional link via array-of-ids-on-both-sides, written in one transaction: the finding's own linkedTaskIds/linkedRaidIds arrays and the created record's own source field are both updated inside the SAME handler invocation before the single writeDb(db) call — no second request, no eventual-consistency window where one side of the link exists without the other."

requirements-completed: [DD-02, DD-03]

coverage:
  - id: D1
    description: "The IL can record a DD finding carrying a severity, a functional area and an owner, and read it back from the deal's own database (DD-02)"
    requirement: "DD-02"
    verification:
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (a): a finding is creatable with each of the four severities and reads back unchanged"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (b): two findings with identical title, area and severity get distinct ids"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (c): a deal with zero findings returns an empty array with status 200"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (d): two equal-severity findings are returned in stable insertion order across two consecutive reads"
        status: pass
    human_judgment: false
  - id: D2
    description: "Finding severity uses four levels and a critical finding converts into a RAID entry that is still critical — no downgrade anywhere on the path (D-11, D-26)"
    requirement: "DD-03"
    verification:
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (g): POST /api/raid carrying the new critical severity succeeds and reads back with that severity"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (h): POST /api/raid carrying a value outside the four levels is rejected by the schema with a 400"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (i): both files' RAID severity lists contain the exact same four values"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (j): an existing RAID entry created before this change still reads and updates normally with its original three-level severity"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (k): converting a critical finding to both a task and a RAID entry preserves severity (asserted via GET /api/raid read-back), sets the workstream from the mapping, and links both directions"
        status: pass
    human_judgment: false
  - id: D3
    description: "One click on a finding creates a pre-filled Day-1 integration task and/or a RAID entry; the finding records what it spawned and each spawned record records the finding it came from (D-12)"
    requirement: "DD-03"
    verification:
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (k): the finding's linkedTaskIds/linkedRaidIds hold exactly the created ids; each created record's source equals dd-finding:<findingId>"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (l): the created task's and entry's workstream ids match DD_AREA_WORKSTREAM for each of the eight areas"
        status: pass
    human_judgment: false
  - id: D4
    description: "Converting the same finding twice creates no duplicate task and no duplicate RAID entry — both are deduplicated by a stable source string derived from the finding id"
    requirement: "DD-03"
    verification:
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (m): converting the same finding a second time creates nothing new and returns the same ids; lane lengths stay unchanged"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (n): a conversion requested with both flags false is rejected with a 400"
        status: pass
    human_judgment: false
  - id: D5
    description: "Findings are clean-room filtered exactly like request items: an uncleared member sees none of an area's findings, a direct by-id probe returns the same uniform 403 an unknown id returns (audited), and the convert route asserts clearance before reading the finding"
    requirement: "DD-02"
    verification:
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (e): an uncleared member's list omits an area's findings entirely"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (f): an uncleared member's by-id probe and an unknown-id probe return byte-identical 403 bodies, each auditing one dd-access-denied row"
        status: pass
      - kind: integration
        ref: "test/dd-findings.test.js#dd-findings (o): a member uncleared for the finding's area gets the uniform 403 and one dd-access-denied row; no task and no RAID entry are created"
        status: pass
    human_judgment: false
  - id: D6
    description: "public/js/due-diligence.js exposes a findings section per rendered area with create/convert controls, textContent-only"
    verification:
      - kind: other
        ref: "grep -c innerHTML public/js/due-diligence.js == 0"
        status: pass
    human_judgment: true
    rationale: "No browser automation tool was available this session to visually confirm the rendered page. The zero-innerHTML property and the wiring to GET/POST /api/dd/findings and POST /api/dd/findings/:id/convert are source-verified, but actual in-browser rendering (severity/owner/status controls, convert-button disable state, linked-record labels) has not been visually confirmed against a live server — matches the same human_judgment deferral pattern Plans 01-03 used for their own UI additions."

duration: ~55min
completed: 2026-08-02
status: complete
---

# Phase 4 Plan 4: DD Findings Register and One-Click Conversion Summary

**The DD findings register (DD-02) and one-click conversion into a pre-filled Day-1 task and/or RAID entry (DD-03) — bidirectionally linked, severity-faithful, and idempotent on re-click.**

## Performance

- **Duration:** ~55 min of active work
- **Tasks:** 3 (all completed)
- **Files modified:** 6 (1 created, 5 modified)
- **Commits:** 3 task commits + this docs commit

## Accomplishments

- Built `ddFindingsLane(db)` and the full findings CRUD surface in `server.js`: `GET /api/dd/findings` (optional `area` filter), `POST /api/dd/findings` (upsert-by-id, mirroring `POST /api/dd/request-items`'s shape exactly), `GET /api/dd/findings/:id`, `DELETE /api/dd/findings/:id` — every route reuses Plan 01's clean-room discipline verbatim (`filterByAreaGrant()` on lists, `assertAreaGrant()`/`refuseDdArea()`/`ddAreaRefused()` on by-id routes)
- Registered `DdFindingUpsertSchema` in `validators/dd.js`: required `area` (eight-area enum), optional four-level `severity` enum, optional three-value `status` enum, title-required-on-create via `refine()` — the same two-refine shape `DdRequestItemUpsertSchema` already established
- Extended `RAID_LEVELS` to four levels (`['low', 'medium', 'high', 'critical']`) in BOTH its independent copies — `server.js`'s route-handler field guard and `validators/workstream.js`'s `RaidUpsertSchema` — in the same commit, with a source-level test (`assert.deepStrictEqual`) asserting the two copies agree so a future edit to only one can never silently diverge again
- Added the `DD_AREA_WORKSTREAM` mapping constant (`server.js`), locked by D-25, shaped exactly like the existing `REMEDIATION_WS` literal
- Built `POST /api/dd/findings/:id/convert`: a NEW route (not a call into `/api/integration-tasks/from-remediation`, which has no finding-shaped input path) that asserts clearance BEFORE reading the finding, dedups by a `'dd-finding:<findingId>'` source string against both the task and RAID lanes, copies severity verbatim (no mapping, no clamping), and writes the bidirectional link — `finding.linkedTaskIds`/`linkedRaidIds` on one side, `task.source`/`raid.source` on the other — in a single `writeDb()` call
- Added a `source` field to the RAID create shape (`validators/workstream.js`'s `RaidUpsertSchema` + `server.js`'s `POST /api/raid`) so the reverse reference exists on that side too, matching the task shape's pre-existing `source` field
- Extended `public/js/due-diligence.js` with a findings section per rendered area: create form, per-finding severity/owner/status controls, "Create Day-1 task"/"Create RAID entry" buttons that POST to the convert route and disable themselves once a link exists, all `textContent`-only; cache stamp bumped to `?v=1784600003`
- Proved the whole slice through 15 new integration tests in `test/dd-findings.test.js`, all passing through the real HTTP stack against isolated temp databases

## Task Commits

Each task was committed atomically:

1. **Task 1: Findings register behind the clean-room filter** - `f0801a2` (feat)
2. **Task 2: Extend the RAID severity scale to four levels in both copies** - `fe2c9d5` (feat)
3. **Task 3: One-click conversion with bidirectional references and source dedup** - `8c2a7f7` (feat)

## Files Created/Modified

- `test/dd-findings.test.js` (new) - 15 integration tests: findings CRUD/severity round-trip (a-d), clean-room filtering + uniform-403 + audit (e-f), RAID four-level round-trip + anti-drift + backward-compat (g-j), conversion bidirectionality/workstream-mapping/idempotency/refusal-validation/access-control (k-o)
- `server.js` (modified) - `ddFindingsLane()`, `DD_FINDING_SEVERITIES`/`DD_FINDING_STATUSES`, the four findings routes, `RAID_LEVELS` extended to four values (with independent-copy comment), `source` added to the RAID create shape, `DD_AREA_WORKSTREAM`, `POST /api/dd/findings/:id/convert`, `module.exports.RAID_LEVELS` (test-only export)
- `validators/dd.js` (modified) - `DdFindingUpsertSchema` (Task 1), `DdFindingConvertSchema` (Task 3), both registered
- `validators/workstream.js` (modified) - `RAID_LEVELS` extended to four values (with independent-copy comment), `source` added to `RaidUpsertSchema`, `RAID_LEVELS` exported (test-only)
- `public/js/due-diligence.js` (modified) - findings section: `SEVERITIES`/`SEVERITY_LABELS`, `updateFinding()`, `convertFinding()`, `renderFinding()`, `renderFindingAddForm()`, wired into `render()` and `load()`
- `public/due-diligence.html` (modified) - `due-diligence.js` cache stamp bumped to `?v=1784600003`

## Decisions Made

- **`DdFindingConvertSchema` registration deferred to Task 3's own commit**, even though it could have been authored earlier — the plan's own task boundaries (findings CRUD / RAID_LEVELS / convert route) are honored literally so each commit's diff matches exactly what its own task describes, with no forward-declared schema for a route that doesn't exist yet.
- **`RAID_LEVELS` exported from both files** purely to let a test assert the two independent copies agree — neither copy needed export for its own runtime behavior; this is a test-only surface addition, matching the codebase's existing pattern of test-only exports at the bottom of `server.js` (`roleAllowedForWrite`, `isDemoOnlyPath`, `DEMO_ONLY_PREFIXES`).
- **RAID entry `source` defaults to `''`, not `'manual'`** (unlike the task shape's own `'manual'` default) — no existing route or UI reads `entry.source` for anything besides the convert route's dedup lookup, so an unlabeled empty default carries less unexplained-sentinel risk.
- **`DD_AREA_WORKSTREAM` placed in the findings section**, not beside `REMEDIATION_WS` in the general execution-engine section — it is findings-specific and D-25-locked, matching the plan's own interface contract's placement.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria (test file passes, `grep`-verifiable literal checks, `node scripts/list-unvalidated-routes.js` exit 0, `npm test` green) were met without needing a Rule 1-4 auto-fix or deviation.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `DD_AREA_WORKSTREAM` and the `'dd-finding:<findingId>'` source-string convention are stable for any later plan that wants to reference or extend the conversion surface.
- The findings UI's live in-browser click-through (severity/owner/status edits, convert-button disable state, linked-record labels) is deferred to `04-UAT.md` per this plan's own coverage entry — no browser automation tool was available this session, matching the same deferral pattern Plans 01-03 used for their own UI additions.
- No blockers for 04-05.

---
*Phase: 04-due-diligence-workspace*
*Completed: 2026-08-02*

## Self-Check: PASSED

All files created/modified by this plan exist on disk and all 3 task commits are present in git history:

- FOUND: test/dd-findings.test.js
- FOUND: server.js
- FOUND: validators/dd.js
- FOUND: validators/workstream.js
- FOUND: public/js/due-diligence.js
- FOUND: public/due-diligence.html
- FOUND commit: f0801a2 (Task 1)
- FOUND commit: fe2c9d5 (Task 2)
- FOUND commit: 8c2a7f7 (Task 3)

`npm test` = 171/171 (156 baseline + 15 new). `node scripts/list-unvalidated-routes.js` exits 0. `node -e "require('./server.js')"` boots clean.
