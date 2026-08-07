---
phase: 06-org-design-talent-retention
plan: 03
subsystem: api
tags: [express, zod, vanilla-js, org-chart, bulk-import, csv-json-parsing]

# Dependency graph
requires:
  - phase: 06-org-design-talent-retention (Plan 01)
    provides: orgPositions registry, positionGraphFailure() graph guard, orgPositionsLane()
  - phase: 06-org-design-talent-retention (Plan 02)
    provides: the collapsible tree, the add form (state:viewState tagging), state.employees fetched alongside positions
provides:
  - POST /api/org/positions/import (D-09/D-10) — all-or-nothing bulk paste import; title-keyed reportsTo resolution (paste-own rows first, then existing positions in the requested state); email-case-insensitive-else-exact-name employee linking with a per-request resolution cache; a final positionGraphFailure() self-check against the merged lane before the single writeDb()
  - validators/org.js OrgPositionImportSchema (500-row cap, no schema-level title .min() so the handler's own VALIDATE-EVERYTHING pass can report a per-row index)
  - public/js/org.js two-step Preview-then-Import paste importer (client-side CSV/JSON parse, header alias matching, preview table, all-or-nothing 400 rendering)
  - DELETE /api/employees/:id's first guard of any kind — refuses 400 while any org position (either state) links to the employee, naming the count and the first position's title
  - public/js/org.js employee-link select on the add/edit form (D-09)
affects: [06-07-deal-home-rollup, 06-08-i18n-and-live-walk]

# Actuals (#2632)
actuals:
  tokens: 15600
  tasks: 3
  commits: 5

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "All-or-nothing bulk write: a full validate-everything pass collects every {row, message} problem before any mutation begins; a non-empty problem list touches nothing (not even a partial employee creation)"
    - "Staged-then-committed mutation: new employee rows are held in a local array (never attached to db.employees/db.customEmployees) until a final positionGraphFailure() self-check over the merged lane passes — readDb() reconstructs a fresh object from SQLite on every call (no shared cache), so an aborted request's in-memory mutations have zero effect on any subsequent read"
    - "Title-keyed two-tier parent resolution: reportsTo resolves against the paste's own titles first, then against existing same-state positions second — a duplicate title inside one paste is refused because title-based resolution is undecidable when two rows share a title"
    - "Email-case-insensitive-else-exact-name employee matching, cached per request so two rows naming the same person (any casing) produce exactly one employee row"

key-files:
  created:
    - test/org-import.test.js
  modified:
    - server.js
    - validators/org.js
    - public/js/org.js
    - public/org.html
    - test/org-positions.test.js

key-decisions:
  - "The import row schema's title field carries no zod .min() floor — an empty-after-trim title is caught by the handler's own VALIDATE-EVERYTHING pass instead of a schema-level rejection, because only the handler's pass can report the offending row's index; a schema-level 400 would use the generic formatIssues() shape with no row index."
  - "Employee matching is if/else, not OR-fallback: a row carrying an email matches ONLY by email (case-insensitive); a row with no email matches by exact name. Matches the UI-SPEC's literal 'matched (email case-insensitively, else exact name)' wording rather than trying both for every row."
  - "New employee rows created by the importer carry an 'email' field — absent from POST /api/employees' existing shape. This is a minimal, additive extension: D-09's email-based dedup requires somewhere to store the email, and every pre-existing code path that doesn't know about the field simply ignores it."
  - "The employee orphan guard lives inline inside DELETE /api/employees/:id rather than a helper shared with the org section, because /api/employees is reachable by pmo as well as admin/hrbp through the default write policy (ROLE_WRITE_POLICY / DEFAULT_WRITE_ROLES) — a guard living only in the org lane's own callers would miss every one of those."
  - "Per this plan's own planner resolution: mixed valid/invalid rows in one paste are refused wholesale (all-or-nothing), not imported-good-and-reported-bad — an org chart is a graph, and dropping a bad row's children silently re-roots them at the top level, producing a tree that looks complete while being structurally wrong."
  - "Per this plan's own planner resolution of the UI-SPEC/Copywriting-Contract inconsistency: deleting an employee linked to a position is REFUSED (400), never a 'will become vacant' confirm-then-proceed — the confirm string for that case is deliberately unused."

patterns-established:
  - "A bulk-write route's mutation phase is split into 'resolve/stage' and 'commit', with a graph-integrity self-check gating the boundary between them — any future bulk-write route in this codebase inheriting a graph-shaped collection should follow this same staged-then-committed shape rather than mutating incrementally."

requirements-completed: [ORG-01]

coverage:
  - id: D1
    description: "POST /api/org/positions/import creates positions + linked employees from a well-formed paste, reporting a created-position count and resolving reportsTo by title (paste-own rows first, then existing same-state positions)"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-import.test.js#org-import (a): three well-formed rows create three positions with a created count of three"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (b): reportsTo naming another row's title in the SAME paste resolves to that row's newly created id"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (c): reportsTo naming an EXISTING position's title resolves to that position's id"
        status: pass
    human_judgment: false
  - id: D2
    description: "The import is all-or-nothing: an unresolvable reportsTo, a duplicate title, or an empty title each return 400 naming the offending row index, and a follow-up read proves nothing was created"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-import.test.js#org-import (d): an unresolvable reportsTo returns 400 naming the offending row index, and a follow-up read shows zero positions created"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (e): two rows sharing the same title return 400 naming the duplicate, and nothing is created"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (f): a row with an empty title returns 400 with that row's index, and nothing is created"
        status: pass
    human_judgment: false
  - id: D3
    description: "One employee record per person: email matching is case-insensitive and reused both within one paste and across separate import calls; a created employee carries no gamification points/badge; a 500-row cap and the hr-grant check both refuse before any mutation"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-import.test.js#org-import (h): two rows carrying the same email in different casing create exactly ONE employee and both positions link to it"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (i): a row whose email matches an EXISTING employee (from a prior import) reuses that employee's id and creates no second employee row"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (j): an employee row created by the import carries no truthy gamification points value and no badge value"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (k): the route is refused with 403 for a member without the hr grant, and nothing is created"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (l): a payload exceeding the schema's row cap is refused by the validator with 400, before the handler runs, and names the limit"
        status: pass
    human_judgment: false
  - id: D4
    description: "The paste-and-preview importer UI: client-side CSV/JSON parse with header aliasing, a Preview step gating the Import button, an explicit-visible-display error/status surface, and no innerHTML sink anywhere in org.js"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-import.test.js#org-import (m): no innerHTML sink exists anywhere in public/js/org.js"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (n): the parse-failure apology appears exactly once, set via an explicit visible display value"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (o): every style.display assignment in org.js uses a non-empty literal value"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (p): the import commit handler is reachable only after a preview has been produced"
        status: pass
      - kind: unit
        ref: "test/org-import.test.js#org-import (q): the .org-import-preview rule carries no fixed height declaration"
        status: pass
    human_judgment: false
  - id: D5
    description: "DELETE /api/employees/:id refuses 400 while any position (either state) links to the employee, naming the count and the first position's title; succeeds once unlinked or the position is deleted; an unoccupied employee remains deletable; the guard runs before the array filter"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (ee): DELETE for an employee occupying one position returns 400 naming that position's title, and the employee survives"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (hh): an employee occupying positions in BOTH current and target state is refused, and the message reflects more than one position"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (jj): the guard runs before removal — a refused delete leaves the roster length AND ids byte-identical"
        status: pass
      - kind: unit
        ref: "test/org-positions.test.js#org-positions (ll): the guard's early return precedes the array filter, so the refusal path never reaches a write"
        status: pass
    human_judgment: false
  - id: D6
    description: "Live visual/browser confirmation of the paste-and-preview flow (parse feedback, preview table, all-or-nothing 400 rendering) and the employee-link select in a real browser"
    verification: []
    human_judgment: true
    rationale: "This plan's own <verification> section explicitly defers live browser confirmation of the paste-and-preview flow to Plan 08's walk — no browser tool was available in this session and the plan text does not ask for one here (same precedent as Plans 01/02's own D6/D7)."

# Metrics
duration: ~60min
completed: 2026-08-07
status: complete
---

# Phase 06 Plan 03: ORG-01 Bulk Import & Employee Orphan Guard Summary

**All-or-nothing bulk paste import (`POST /api/org/positions/import`) turning a pasted CSV/JSON roster into positions plus linked `employees` rows in one action, a two-step Preview-then-Import client UI, and `DELETE /api/employees/:id`'s first guard of any kind — refusing rather than orphaning a position.**

## Performance

- **Duration:** ~60min
- **Completed:** 2026-08-07
- **Tasks:** 3
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `POST /api/org/positions/import`: a full validate-everything pass (duplicate titles, unresolvable `reportsTo`, empty titles) runs before any mutation and collects every problem into one 400 response — a partially-invalid 150-row paste changes nothing, proven by a follow-up read in every failure-case test, not just the status code
- `reportsTo` resolves by title in two tiers — the paste's own rows first, then existing positions in the requested state — with a title-to-new-id map built before any position object exists, so a row can name a parent appearing later in the same paste
- Employee linking is case-insensitive-email-else-exact-name, cached per request so two rows naming the same person (any casing) produce exactly one `employees` row, whether within one paste or reused from a prior import call; created employees carry identity fields only — no gamification points/badge/bonusPoints, matching ISO-02's hard gate
- A final `positionGraphFailure()` self-check runs against the merged lane before the single `writeDb()`; new employee rows are staged (never attached to `db.employees`/`db.customEmployees`) until that check passes, so an aborted import creates zero employees and zero positions
- `public/js/org.js`'s two-step paste importer: client-side CSV/JSON parse with header aliasing (`Reports To`/`reports_to`/`reportsto`/`manager` all resolve to `reportsTo`), a Preview step gating the Import button, the UI-SPEC's fixed parse-failure apology and per-row problem rendering, both via explicit visible `display` values (never `''`)
- `DELETE /api/employees/:id` gained its first guard: scans `orgPositions` across BOTH states for `employeeId === id` and refuses 400 (naming the count and the first position's title) before the existing filter-and-write; kept inline rather than shared with the org section since the route is reachable by `pmo` as well as `admin`/`hrbp`

## Task Commits

Each task was committed atomically:

1. **Task 1: Bulk import route — all-or-nothing validation, title-keyed parents, employee linking** - `9a65846` (feat)
2. **Task 2: Paste-and-preview importer UI** - `c2c9949` (feat)
3. **Task 3: The employee orphan guard and the position link picker** (TDD) - `26b2d88` (test / RED) → `50fa4dc` (feat / GREEN)

**Plan metadata:** (this commit)

## Files Created/Modified

- `server.js` - `POST /api/org/positions/import` (validate-everything pass, title-keyed two-tier `reportsTo` resolution, staged employee resolution, final `positionGraphFailure()` self-check); `DELETE /api/employees/:id`'s new orphan guard
- `validators/org.js` - `OrgPositionImportSchema` (500-row cap with its own message, no schema-level title `.min()`), registered for the import route
- `public/js/org.js` - the two-step paste importer (parse, preview table, commit), the employee-link `<select>` on the add/edit form
- `public/org.html` - `.org-import`/`.org-import-preview` page-local styles (no fixed height on the preview), `#org-import` container, cache stamp bump
- `test/org-import.test.js` - 18 tests: 12 behavior-block cases for Task 1, 6 source-level assertions for Task 2
- `test/org-positions.test.js` - 8 new tests for Task 3: 6 behavior-block cases (both-states refusal, byte-identical-roster-on-refusal, unoccupied-employee-still-deletable) plus 2 source-level assertions (link-picker wiring, guard-precedes-filter ordering)

## Decisions Made

See `key-decisions` in frontmatter — summarised: (1) the import schema's title field has no `.min()` floor so the handler's own row-indexed problem list is what rejects an empty title, not a generic schema 400; (2) employee matching is if/else (email-only when present, else exact name) not an OR-fallback; (3) new employee rows gained an additive `email` field the existing `POST /api/employees` shape lacked; (4) the orphan guard stays inline in the employees route rather than a shared helper, since `pmo` reaches that route too; (5) the plan's own two delegated-decision resolutions (all-or-nothing import; refuse-not-vacate delete) were applied exactly as specified in the plan text, not re-litigated.

## Deviations from Plan

None — plan executed exactly as written. The `email` field addition to the employee record shape (see Decisions) is a direct, minimal consequence of the plan's own explicit instruction that email-based matching must work, not an unplanned addition.

## Issues Encountered

None.

## Next Phase Readiness

- The bulk import route, its UI, and the employee orphan guard are proven end-to-end (behavior + source-level tests) and ready for Plan 04 onward.
- Live browser confirmation of the paste-and-preview flow and the employee-link select remains deferred to Plan 08's walk, per this plan's own `<verification>` section — consistent with Plans 01/02's precedent.
- No blockers for Plan 04.

## Self-Check: PASSED

All created/modified files (`server.js`, `validators/org.js`, `public/js/org.js`, `public/org.html`, `test/org-import.test.js`, `test/org-positions.test.js`) and all four task commits (`9a65846`, `c2c9949`, `26b2d88`, `50fa4dc`) verified present on disk / in git log.

---
*Phase: 06-org-design-talent-retention*
*Completed: 2026-08-07*
