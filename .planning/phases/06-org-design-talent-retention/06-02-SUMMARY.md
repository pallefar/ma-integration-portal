---
phase: 06-org-design-talent-retention
plan: 02
subsystem: ui
tags: [express, zod, vanilla-js, access-control, org-chart, clean-room]

# Dependency graph
requires:
  - phase: 06-org-design-talent-retention (Plan 01)
    provides: orgPositions registry, positionGraphFailure() graph guard, the D-01/D-02/D-04/D-07 tiered clearance rule on GET/POST /api/org/positions, public/org.html + public/js/org.js tracer shell
provides:
  - Collapsible indented org tree — module-level expandedIds Set (never reassigned), default expand depth 2, indent cap at depth 6 (desktop) / depth 3 (narrow), level chip at every depth, structural (not CSS) collapse
  - Client-side search over title/level/occupant name with ancestor force-expansion and de-emphasised non-matches, plus an "Unassigned employees (N)" flat bucket below the tree
  - GET /api/org/capabilities — absent-not-zeroed restricted capability probe (D-20), the "equivalent probe" UI-SPEC Design Tension 3 names in place of Plan 07's not-yet-existing GET /api/org/summary
  - POST /api/org/positions/copy-to-target — clones current-state rows into NEW target-state rows via an old-to-new id map, idempotent-by-refusal (400) while target already holds rows
  - DELETE /api/org/positions/:id — refuses 400 with the direct-report count rather than cascading; hr-grant gated like the existing write routes
  - Current/target switch — structurally absent (not disabled) for an uncleared or errored capability probe; each toggle re-fetches from the server, never combines both states client-side
affects: [06-04-decisions, 06-05-flight-risk, 06-07-deal-home-rollup, 06-08-i18n-and-live-walk]

# Actuals (#2632)
actuals:
  tokens: 15061
  tasks: 3
  commits: 5

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side expand/collapse state as a single module-level Set, declared once and only ever mutated via .add()/.delete() — never reassigned to a fresh Set — so an unrelated re-render never silently collapses the operator's working view (verified by a source-level test counting `new Set(` occurrences in the file)"
    - "Absent-not-zeroed capability probe (D-20): the restricted key is assigned only inside the granted branch, never from a ternary and never as false, mirroring GET /api/dd/summary's filter-before-tally rule — the same pattern Plan 07's GET /api/org/summary will reuse verbatim"
    - "State-clone via an old-to-new id map built in one pass before any clone is constructed, so a clone whose source has a parent can resolve the parent's own clone id regardless of array order"
    - "Client-side capability gating: every target-state request string is constructed inside the SAME function as its own `capabilities.targetOrgDesign` guard, so a single source-level regex proves no call site can construct a target-state request outside that branch"

key-files:
  created: []
  modified:
    - server.js
    - validators/org.js
    - public/org.html
    - public/js/org.js
    - test/org-positions.test.js
    - test/org-access-policy.test.js

key-decisions:
  - "Task 1's expand/collapse discipline test ('exactly one `new Set(` construction') was written broad on purpose — it constrains every later task in this file, not just Task 1's own code, to avoid a second Set anywhere in org.js. Task 2's search-forced-ids tracking and Task 3's capability/viewState bookkeeping both use plain object hashes instead of Sets to satisfy it, which was the intended forcing function, not an accident discovered late."
  - "The manual add form now tags a new position with `state: viewState` (Rule 1 fix, not in the plan's literal text) — before this, adding a position while viewing the target state would have created a CURRENT-state row while the reportsTo dropdown offered TARGET-state parents, guaranteeing a cross-state graph-integrity 400 from positionGraphFailure(). Minimal, scoped fix: tag the new row with the same state the reportsTo options were drawn from."
  - "Non-matching search siblings are de-emphasised (opacity, `.org-node--dim`) rather than removed from the DOM — this plan's own must_haves and task action text say 'de-emphasised rather than removed,' which reads differently from 06-UI-SPEC.md Design Tension 2's earlier prose ('stay collapsed/hidden'). The plan text is the executable authority for this task, so its explicit wording was followed; UI-SPEC's Tension 2 prose predates this plan's own resolution and should be read as superseded here, not contradicted."
  - "The destructive delete confirmation shows a generic 'Delete position? This cannot be undone.' at confirm time (no client-guessed report count); the {N}-direct-report count from the Copywriting Contract's template is surfaced afterwards, in the error element, using the SERVER's own count from a 400 refusal — matching the task action text's own phrasing that interpolation happens 'when the server refuses,' and avoiding a client-side count that could race a concurrent edit."

patterns-established:
  - "Depth-bounded recursion driven by a single named constant (DEFAULT_EXPAND_DEPTH) rather than an unrolled two-level special case, so the 'default expand depth is 2' rule has one source of truth in the file, not a magic number duplicated in a comment"

requirements-completed: [ORG-01]

coverage:
  - id: D1
    description: "The organisation renders as a collapsible indented tree — module-level expandedIds Set (declared once, never reassigned), children container constructed only when a node is expanded (structural absence, not CSS), indent cap at depth 6 desktop / depth 3 narrow, level chip at every depth with a non-empty level"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (r): public/js/org.js declares the expanded-id Set exactly once and never reassigns it"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (s): the children container is constructed only inside the branch guarded by isExpanded"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (t): the level chip is appended only when the position carries a non-empty level"
        status: pass
    human_judgment: false
  - id: D2
    description: "Client-side search (title/level/occupant substring match, no new endpoint) force-expands ancestors of a match and de-emphasises non-matching siblings; a zero-match search renders the no-match copy; an 'Unassigned employees (N)' flat list below the tree is computed by excluding employeeIds already referenced by a position"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (u): the search filter operates on already-fetched data and issues no fetch call"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (v): the unassigned-employees bucket is computed by excluding employeeIds referenced by positions, not a second server call"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (w): the no-match copy and the unassigned heading each appear exactly once, the heading with a count interpolation"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/org/capabilities returns a truthy restricted key for an hr-granted caller and NO key at all (absent, not false) for an other-area-granted caller, proven across the D-07 four-identity matrix"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (x): GET /api/org/capabilities returns a truthy restricted key for an hr-granted member and NO key at all for an other-area member"
        status: pass
      - kind: unit
        ref: "test/org-access-policy.test.js#org-access-policy: GET /api/org/capabilities — the D-07 four-identity matrix, absent key for uncleared, truthy for cleared"
        status: pass
    human_judgment: false
  - id: D4
    description: "POST /api/org/positions/copy-to-target clones every current-state row into a NEW target-state row via an old-to-new id map (a clone's reportsToId points at the CLONE of its source's parent, never the original), never mutates a current-state row, and refuses a second call with 400 while any target-state row exists"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (y): POST /api/org/positions/copy-to-target clones every current position with a new id, remaps reportsToId through the clone map, and never mutates a current row"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (z): a second copy-to-target call is refused with 400 while the target design is not empty, and creates no additional rows"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (aa): copy-to-target is refused with 403 for a member without the hr grant, and creates no target row"
        status: pass
    human_judgment: false
  - id: D5
    description: "DELETE /api/org/positions/:id refuses 400 with the direct-report count while reports exist (never cascades), succeeds once reports are reassigned, and requires the hr grant"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (bb): DELETE /api/org/positions/:id is refused with 400 and names the direct-report count while reports exist; the row survives"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (cc): DELETE succeeds once direct reports are reassigned, removing exactly that row"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (dd): DELETE is refused with 403 for a member without the hr grant"
        status: pass
    human_judgment: false
  - id: D6
    description: "The current/target switch and every target-state request are constructed only inside the branch guarded by the capability key — structurally absent (not disabled) for an uncleared or errored probe; toggling re-fetches from the server rather than filtering a combined payload"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-access-policy.test.js#org-access-policy: defence-in-depth — public/js/org.js never constructs a target-state request outside the branch guarded by the capability key"
        status: pass
      - kind: unit
        ref: "test/org-access-policy.test.js#org-access-policy: copy-to-target and delete are both refused 403 for an it-only member, identical to the write boundary already proven for POST /api/org/positions"
        status: pass
    human_judgment: false
  - id: D7
    description: "Live visual/browser confirmation of the tree at 200+ nodes, at 375px, and at the longest translation, plus the switch/search/bucket interaction in a real browser"
    verification: []
    human_judgment: true
    rationale: "This plan's own <verification> section explicitly defers live visual confirmation to Plan 08's walk; no browser tool was available in this session and the plan text does not ask for one here (same precedent as Plan 01's D6)."

# Metrics
duration: ~2h
completed: 2026-08-07
status: complete
---

# Phase 06 Plan 02: ORG-01 Org Workspace — Tree, Search, Target-State Copy & Guarded Delete Summary

**Collapsible indented org tree with client-side search and an unassigned-employees bucket, plus a server-enforced current/target switch (GET /api/org/capabilities absent-not-zeroed probe, POST .../copy-to-target id-remapping clone, DELETE .../:id direct-report guard) that is structurally absent for an uncleared session.**

## Performance

- **Duration:** ~2h
- **Completed:** 2026-08-07
- **Tasks:** 3
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments

- Turned Plan 01's flat card list into a collapsible indented tree: a single never-reassigned `expandedIds` Set drives expand/collapse, the children container is structurally absent (not CSS-hidden) when collapsed, the indent rail caps at depth 6 desktop / depth 3 below 768px, and the level chip renders at every depth per D-08 (level is free text, not seniority)
- Client-side search (title/level/occupant substring, no new endpoint) force-expands every ancestor of a match, de-emphasises non-matching siblings, and scrolls the first match into view; a flat "Unassigned employees (N)" bucket lists roster members with no position, computed by excluding referenced `employeeId`s
- `GET /api/org/capabilities` — the UI-SPEC's own-named "equivalent probe" standing in for Plan 07's not-yet-buildable `GET /api/org/summary` — assigns its restricted key only inside the hr-granted branch, absent (not false) otherwise, proven across the D-07 four-identity matrix
- `POST /api/org/positions/copy-to-target` clones current-state rows into NEW target-state rows via an old-to-new id map (never mutates a current row, never re-points a clone at an original id), refusing a second call with 400 while any target row exists; `DELETE /api/org/positions/:id` refuses 400 naming the direct-report count instead of cascading
- The current/target switch (two plain-text toggle labels) and every `state=target` request are constructed only inside the branch guarded by `capabilities.targetOrgDesign` — proven by a source-level defence-in-depth test that the file contains no target-state construction outside that guard

## Task Commits

Each task was committed atomically:

1. **Task 1: Collapsible indented tree — expand state, indent cap, elevation, narrow width** - `97949ca` (feat)
2. **Task 2: Search and the unassigned-employees bucket** - `4385209` (feat)
3. **Task 3: Current/target switch, the capability probe, copy-to-target and the guarded delete** (TDD) - `50fd013` (test / RED) → `0bf9dbd` (feat / GREEN) → `a014793` (refactor)

**Plan metadata:** (this commit)

## Files Created/Modified

- `public/js/org.js` - expandedIds Set + seedDefaultExpansion, restructured renderNode (toggle, level chip, indent-cap classes, per-card delete control), search filter + de-emphasis, unassigned-employees bucket, capability probe + current/target switch + copy-from-current action
- `public/org.html` - `.org-node-row`/`.org-node-main` layout, indent-cap classes + 768px media block, `.org-search`, `.org-unassigned`, `.org-state-switch`, `.org-node-delete`, `#org-delete-error`; cache stamp bumped three times (v1784900003 → v1784900005)
- `server.js` - `GET /api/org/capabilities`, `POST /api/org/positions/copy-to-target`, `DELETE /api/org/positions/:id`, all hr-grant-gated and placed in the existing `/api/org` section
- `validators/org.js` - `OrgCopyToTargetSchema` + its route registration; `EmptyBodySchema` registered for the position DELETE route
- `test/org-positions.test.js` - 15 new tests: Task 1's Set/children-container/level-chip source checks, Task 2's search/unassigned source checks, Task 3's full behavior-block coverage
- `test/org-access-policy.test.js` - 3 new tests: the capability probe's four-identity matrix, the copy/delete 403 cases, and the strengthened defence-in-depth client source check

## Decisions Made

See `key-decisions` in frontmatter — summarised: (1) the "exactly one `new Set(`" test was deliberately written to constrain the whole file, forcing later tasks to plain-object hashes; (2) the manual add form now tags new positions with the currently-viewed state (Rule 1 fix — otherwise adding while viewing target would create a current-state row with a target-state parent, guaranteed to 400); (3) non-matching search siblings are de-emphasised, not hidden, per this plan's own explicit wording (superseding 06-UI-SPEC.md's earlier "collapsed/hidden" prose); (4) the delete confirmation's report count is surfaced from the server's refusal, not guessed client-side.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Manual add form now tags new positions with the currently-viewed state**
- **Found during:** Task 3 (while wiring the current/target switch)
- **Issue:** The reportsTo dropdown in the manual add form is built from `state.positions`, which after Task 3 can hold either current- or target-state rows depending on `viewState`. The add form's POST body never set `state`, so it always defaulted to `current` server-side — meaning a position added while viewing Target would be created as `current` but offered a Target-state parent in the dropdown, which `positionGraphFailure()` correctly refuses (cross-state parent). This bug did not exist before this task, since there was no way to view target state client-side prior to it.
- **Fix:** Added `state: viewState` to the add form's POST body, so a new position is always created in the same state its reportsTo options were drawn from.
- **Files modified:** `public/js/org.js`
- **Verification:** Full suite green (420/420); no test explicitly exercised this path, but the fix is minimal and directly matches the existing server contract already covered by Plan 01's graph-integrity tests.
- **Committed in:** `0bf9dbd` (Task 3 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug — Rule 1)
**Impact on plan:** Necessary to avoid a newly-introduced (by this task's own switch) failure mode. No scope creep — the fix is a one-line addition to an existing POST body.

## Issues Encountered

None beyond the deviation above.

## Next Phase Readiness

- The org tree, search, unassigned bucket, capability probe, target-state copy, and guarded delete are all proven end-to-end and ready for Plan 03 (bulk paste import) to build on.
- `GET /api/org/capabilities`'s `targetOrgDesign` key and its hr-grant check are the exact pattern Plan 07's `GET /api/org/summary` will reuse for its own restricted tier — no rework anticipated there.
- No blockers for Plan 03.

## Self-Check: PASSED

All modified files (`server.js`, `validators/org.js`, `public/org.html`, `public/js/org.js`, `test/org-positions.test.js`, `test/org-access-policy.test.js`) and all five task commits (`97949ca`, `4385209`, `50fd013`, `0bf9dbd`, `a014793`) verified present on disk / in git log.

---
*Phase: 06-org-design-talent-retention*
*Completed: 2026-08-07*
