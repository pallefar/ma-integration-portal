---
phase: 09-optimistic-locking-conflict-recovery
plan: 04
subsystem: api
tags: [express, zod, sqlite, optimistic-locking, conflict-resolution, clean-room, vanilla-js]

# Dependency graph
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "Plan 01's mechanism (conflictBody()/conflictIfStale()/parseExpectedVersion(), the version-checked WHERE-clause layer in db/store.js, ddFindings/ddRequestItems already listed in VERSIONED_COLLECTIONS) plus Plan 01's unused-until-now opts.clearanceFilter hook on conflictIfStale(), built specifically for this plan and Plan 05."
provides:
  - "POST /api/dd/findings, POST /api/dd/request-items and POST /api/dd/findings/:id/convert wired onto the conflict contract, each passing a clearanceFilter that re-runs accessPolicy.hasAreaGrant() against the record's CURRENT area before echoing currentRecord into a 409 body"
  - "The request-items conflict body's currentRecord projected through publicDdItem() identically to the route's own 200 response"
  - "version field on the DD findings, request-items and convert validators/dd.js schemas"
  - "public/js/due-diligence.js's four mutating call sites (item edits, vdrLink set/clear, finding edits, convert) thread the in-memory record's held version"
affects: ["09-07"]

# Actuals (#2632)
actuals:
  tokens: 8270
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "clearanceFilter(record) closure passed into conflictIfStale()'s opts — re-runs the SAME accessPolicy.hasAreaGrant() gate the route's own read path applies, returning null (withholding currentRecord but not version/attribution) on refusal, the full (optionally projected) record on grant"
    - "Area-gated routes call ddAreaRefused() BEFORE conflictIfStale() (T-09-19) — every future area-gated versioned route (Plan 05's org positions/flight-risks) should follow the same ordering for the same anti-enumeration reason"

key-files:
  created: []
  modified:
    - server.js
    - validators/dd.js
    - public/js/due-diligence.js
    - public/due-diligence.html
    - test/optimistic-locking-contract.test.js

key-decisions:
  - "The clearanceFilter's 'denied' branch is structurally unreachable via any single-process HTTP request against these three routes, given T-09-19's own mandated ordering (ddAreaRefused() must run BEFORE conflictIfStale()). Since both gates check hasAreaGrant() against the exact same freshly-read record's `.area`, passing the first gate guarantees the second's filter will always grant. Verified this by exhaustive scenario construction (moving the record's area out-of-band, revoking the caller's grant out-of-band — both cases resolve to a 403 at ddAreaRefused before conflictIfStale ever runs) before concluding the acceptance criteria's HTTP-level 'denied conflict body' scenario cannot be constructed as literally worded. Implemented the clearanceFilter exactly as specified (real defense-in-depth, reused verbatim by Plan 05) and proved its withholding LOGIC directly via test (22), which invokes the exported `conflictIfStale()` with a stubbed clearanceFilter returning null — the same function every route wires through the same `opts.clearanceFilter` contract. Paired with a structural test (25) that locks in the ddAreaRefused-before-conflictIfStale ordering itself, which is what actually protects the reachable-in-practice case."
  - "`<verify>`'s `node --test test/dd-clearance.test.js` names a file that does not exist in this codebase (no dd-clearance.test.js under test/) — ran the full existing DD test suite instead (dd-access-policy, dd-findings, dd-grants, dd-seed, dd-summary, dd-vdr, dd-workspace — 78 tests, all passing unmodified), matching the acceptance criteria's actual requirement ('every pre-existing DD clearance test still passes unmodified')."
  - "Task 1's and Task 2's server-side halves landed in one commit (b050d9f): all three server.js route insertions (findings, request-items, convert) and all three validators/dd.js schema fields were written and verified together before the first commit, since they share one clearanceFilter pattern and one read pass. Task 2's client-side half (public/js/due-diligence.js call-site threading + the due-diligence.html cache-stamp bump) is its own commit (0626396). Documented here rather than re-split retroactively, since both commits are independently coherent, buildable, and test-clean."
  - "[Rule 2] Bumped public/due-diligence.html's due-diligence.js cache-busting query param (`?v=`) alongside the client content change — an unbumped stamp would leave a browser's cached copy silently sending the pre-fix id-only payload shape (no version field) in production, defeating the whole client-side threading for anyone who doesn't hard-refresh."

requirements-completed: [CONC-02]

coverage:
  - id: D1
    description: "A stale-version update to a DD finding is rejected with a 409 carrying the conflict marker, and the earlier writer's field values survive intact."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (17)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A stale-version update to a DD request item is rejected with a 409 carrying the conflict marker, and the earlier writer's field values survive intact."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (18)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Current-version updates to a DD finding and a DD request item both return 200 and advance the stored version by exactly one."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (19, 20)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The request-item 409 conflict body's currentRecord carries the same projected key set as the route's own 200-response item — publicDdItem() applied identically on both paths."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (21)"
        status: pass
    human_judgment: false
  - id: D5
    description: "conflictIfStale()'s clearanceFilter option withholds currentRecord (never version or attribution) when the caller lacks clearance for the record's current area — the T-09-17/T-09-18 mitigation."
    requirement: "CONC-02"
    verification:
      - kind: unit
        ref: "test/optimistic-locking-contract.test.js (22, direct — invokes the exported conflictIfStale() with a stubbed clearanceFilter)"
        status: pass
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (25, structural — ddAreaRefused() before conflictIfStale() on all three DD routes, the T-09-19 anti-enumeration ordering that makes the clearanceFilter's denied branch unreachable via a single HTTP request in the first place)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Converting a DD finding to a task/RAID entry carries a version precondition; a stale-version convert is rejected 409 with no orphan task/RAID entry and the finding's link arrays unchanged; a current-version convert succeeds, creates the task/RAID entry, and advances the finding's version by exactly one."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (23, 24)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every DD write call site in public/js/due-diligence.js that targets an existing record (request-item field edits, vdrLink set/clear, finding field edits, the convert action) threads the version of the in-memory record the edit control was rendered from; the three create-only call sites are left untouched."
    requirement: "CONC-02"
    verification:
      - kind: other
        ref: "grep -n \"fetch('/api/dd/\" public/js/due-diligence.js — 4 mutating call sites (updateItem, updateVdrLink, updateFinding, convertFinding) each conditionally add `version`; the 3 create call sites (add request item, add finding, template instantiate) carry no `id` and no version"
        status: pass
      - kind: manual_procedural
        ref: "two browser tabs on due-diligence.html editing the same request item — second save shows the conflict dialog; two tabs editing DIFFERENT items both save with no dialog"
        status: unknown
    human_judgment: true
    rationale: "This autonomous worktree execution has no browser available. Structural (grep-based) verification and the full HTTP-level test suite give high confidence the payload threading and server contract are correct, but the actual visual/interactive two-tab UX (dialog rendering, no-dialog on different records) has not been human- or browser-verified — same gap Plans 01/02 carried forward under their own D3/D10 rationale."
  - id: D8
    description: "No regression against the Plan 01/02 baseline and every pre-existing DD test."
    verification:
      - kind: integration
        ref: "npm test (full suite, 735/735)"
        status: pass
      - kind: integration
        ref: "node --test test/dd-access-policy.test.js test/dd-findings.test.js test/dd-grants.test.js test/dd-seed.test.js test/dd-summary.test.js test/dd-vdr.test.js test/dd-workspace.test.js (78/78, unmodified)"
        status: pass
    human_judgment: false

duration: 24min
completed: 2026-08-11
status: complete
---

# Phase 9 Plan 4: Due Diligence Workspace — Conflict-Safe Findings, Request Items and Conversion Summary

**Extended the plan-01/02 optimistic-locking contract onto the Due Diligence workspace — findings, request items, and the finding-to-task/RAID conversion — with `conflictIfStale()`'s `clearanceFilter` hook wired for the first time, re-running the route's own area-clearance gate against the conflict body's `currentRecord` so a race can never disclose more than the route's read path already would.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-08-11T05:31:00Z (approx.)
- **Completed:** 2026-08-11T05:55:44Z
- **Tasks:** 2
- **Files modified:** 5 (server.js, validators/dd.js, public/js/due-diligence.js, public/due-diligence.html, test/optimistic-locking-contract.test.js)

## Accomplishments

- `POST /api/dd/findings` and `POST /api/dd/request-items` reject stale writes with the plan-01/02 409 conflict contract, `conflictIfStale()` placed strictly AFTER `ddAreaRefused()` per T-09-19's anti-enumeration ordering.
- First real use of Plan 01's `opts.clearanceFilter` hook: each route passes a closure that re-runs `accessPolicy.hasAreaGrant()` against the record's CURRENT area before letting `currentRecord` into the 409 body — withholding it (but never the version/attribution) on refusal. Request-items additionally project `currentRecord` through `publicDdItem()`, matching the route's own 200 response exactly.
- `POST /api/dd/findings/:id/convert` carries the same version precondition, placed before the finding's `linkedTaskIds`/`linkedRaidIds` are touched and before the task/RAID lanes are read — a stale convert leaves the finding, the task lane and the RAID lane all untouched, since nothing has mutated yet at that point.
- `public/js/due-diligence.js`: the four call sites that mutate an existing record (`updateItem`, `updateVdrLink`, `updateFinding`, `convertFinding`) now take the in-memory record itself (not just its id) and thread its held `version`, sourced from the same `state.itemsByArea`/`state.findingsByArea` list the edit control was rendered from — never a re-fetch. The three create-only call sites are untouched.
- 9 new test cases (17–25) in `test/optimistic-locking-contract.test.js`, including a direct-invocation proof of the `clearanceFilter` withholding logic and a structural test locking in the `ddAreaRefused()`-before-`conflictIfStale()` ordering — see Decisions Made for why the HTTP-level "denied conflict body" scenario as literally specified is unreachable.

## Task Commits

Each task was committed atomically (with a documented deviation on the server/client split — see Decisions Made):

1. **Task 1 + Task 2's server-side half: DD findings/request-items version precondition, clearance-filtered conflict body, and the convert route's own precondition** - `b050d9f` (feat)
2. **Task 2's client-side half: `public/js/due-diligence.js` version threading + cache-stamp bump** - `0626396` (feat)

## Files Created/Modified

- `server.js` - `conflictIfStale()` wired into `POST /api/dd/findings`, `POST /api/dd/request-items` and `POST /api/dd/findings/:id/convert`, each after `ddAreaRefused()` and before any field mutation, each passing a `clearanceFilter` closure; request-items' filter additionally projects through `publicDdItem()`
- `validators/dd.js` - `version: z.number().int().nonnegative().optional()` added to `DdRequestItemUpsertSchema`, `DdFindingUpsertSchema` and `DdFindingConvertSchema`
- `public/js/due-diligence.js` - `updateItem`, `updateVdrLink`, `updateFinding`, `convertFinding` take the in-memory record and thread its `version`; all 6 call sites updated to pass the record instead of just its id
- `public/due-diligence.html` - cache-busting `due-diligence.js?v=` stamp bumped alongside the content change
- `test/optimistic-locking-contract.test.js` - 9 new cases: DD finding/request-item stale+current pairs (17–20), the request-item projection match (21), the direct-invocation clearanceFilter proof (22), the convert stale/current pair with orphan-check (23–24), and the ddAreaRefused-before-conflictIfStale structural ordering check (25)

## Decisions Made

- **The clearanceFilter's "denied" branch is unreachable via HTTP given T-09-19's own mandated ordering** — see the full reasoning in the frontmatter's `key-decisions`. Implemented the filter exactly as specified (real, reused-by-Plan-05 defense-in-depth) and proved its withholding logic via a direct-invocation unit test instead of an unconstructible HTTP scenario.
- **`test/dd-clearance.test.js` (named in the plan's `<verify>`) does not exist** — ran the full existing DD test suite (7 files, 78 tests) instead, satisfying the actual acceptance criterion ("every pre-existing DD clearance test still passes unmodified").
- **Task 1/Task 2 server-side work landed in one commit** — all three routes share one clearanceFilter pattern and were read/edited/verified together before the first commit ran. Task 2's client-side half is its own commit. Both commits are independently coherent and test-clean.
- **[Rule 2] Bumped the due-diligence.js cache-busting query param** in `public/due-diligence.html` alongside the client content change — an unbumped stamp risks a cached browser silently sending the old id-only payload shape in production.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Cache-busting stamp not bumped alongside the client content change**
- **Found during:** Task 2 (threading version through `public/js/due-diligence.js`)
- **Issue:** The plan's action text doesn't mention `public/due-diligence.html`'s cache-busting query param, but a pre-existing test (`test/raid-access-filter.test.js` (k)) exists specifically to catch an unbumped stamp after a due-diligence.js content change — meaning production browsers with a cached copy would keep sending the old id-only payload shape (no version field), silently defeating this plan's client-side threading for any user who doesn't hard-refresh.
- **Fix:** Bumped the `?v=` query param on `due-diligence.js`'s script tag.
- **Files modified:** `public/due-diligence.html`
- **Verification:** `test/raid-access-filter.test.js` (k) passes; full `npm test` clean (735/735).
- **Committed in:** `0626396` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2, correctness — cache-staleness prevention). No scope creep.

## Issues Encountered

- The plan's acceptance criteria for Task 1's clearance case, and its `<verify>`'s `test/dd-clearance.test.js` reference, both required investigation and a documented resolution — see Decisions Made above. Neither blocked the work; both are resolved with reasoning that should hold up under review.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The `clearanceFilter` pattern (a closure re-running the route's own area gate against the CURRENT record before it enters a conflict body) is now proven and committed — Plan 05 (org positions/flight-risks, the same `hasAreaGrant`-style clearance shape) can reuse this exact pattern with no further server-helper changes.
- The `ddAreaRefused()`-before-`conflictIfStale()` ordering (T-09-19) is now locked in by a structural test across all three DD routes — Plan 05 should follow the identical ordering for its own area-gated routes, for the identical anti-enumeration reason.
- **Manual verification pending:** the plan's own `<verification>` section calls for a manual two-tab browser check on `due-diligence.html` — not performed in this browser-less autonomous run. Recommend a human spot-check before UAT closes this phase, same recommendation Plans 01/02 carried forward (see coverage `D7`'s `human_judgment: true` rationale above).

## Self-Check: PASSED

- FOUND: server.js (`conflictIfStale()` wired into 3 DD routes, `clearanceFilter` closures)
- FOUND: validators/dd.js (3 `version` field additions)
- FOUND: public/js/due-diligence.js (4 call sites threading version)
- FOUND: public/due-diligence.html (cache-stamp bump)
- FOUND: test/optimistic-locking-contract.test.js (9 new tests, 28/28 total passing)
- FOUND commit: b050d9f (Task 1 + Task 2 server-side)
- FOUND commit: 0626396 (Task 2 client-side)

---
*Phase: 09-optimistic-locking-conflict-recovery*
*Completed: 2026-08-11*
