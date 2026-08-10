---
phase: 06-org-design-talent-retention
plan: 04
subsystem: api
tags: [express, zod, vanilla-js, access-control, org-chart, governance]

# Dependency graph
requires:
  - phase: 06-org-design-talent-retention (Plan 01)
    provides: orgPositions registry, orgDecisionsLane() (declared but unused until this plan), isAdminOrIlRequest() D-15 precedent (via Phase 5)
  - phase: 06-org-design-talent-retention (Plan 02)
    provides: GET /api/org/capabilities (the absent-not-zeroed restricted probe pattern this plan's second key reuses verbatim)
provides:
  - POST /api/org/decisions (D-04 tier 2) — isAdminOrIlRequest(req) as the handler's literal first statement, plus the hr area grant; append-only, never overwrites; decidedBy/decidedAt server-stamped
  - GET /api/org/decisions — hr-grant restricted read, most-recent-first, optional ?positionId= narrowing
  - server.js ORG_DECISION_TYPES + derivedDecisionFor() (first of three vocabulary copies + the pure derivation function)
  - validators/org.js OrgDecisionSchema + ORG_DECISION_TYPES (second copy) — decidedBy/decidedAt deliberately absent from the schema
  - public/js/org.js ORG_DECISION_TYPES (third copy) + decision badge (every card, always present) + per-position history panel + the capability-gated record-a-decision form
  - GET /api/org/capabilities extended with a second restricted key (recordOrgDecisions), absent-not-false for every cleared-but-non-IL member
  - test/org-decisions.test.js — 23 tests: the D-04 four-identity matrix, break-glass exclusion, decidedBy/decidedAt server-stamping, append-only proof, derived-current contract (including the flagged planner assumption pinned as a test), the privacy prohibition, and the Task 3 UI source-level/HTTP coverage
affects: [06-05-flight-risk, 06-07-deal-home-rollup, 06-08-i18n-and-live-walk]

# Actuals (#2632)
actuals:
  tokens: 17400
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-04 tier 2: a governance write gate strictly narrower than the tier-1 hr-area-grant write clearance used elsewhere in the org section — isAdminOrIlRequest(req) as the handler's literal first statement, before any deal or position lookup, reused verbatim from the synergy re-baseline route (D-15) rather than re-implemented"
    - "Derived-current, never stored: a position's current decision is computed at read time (derivedDecisionFor()) from the append-only orgDecisions log and stored nowhere — the position record itself carries no decision field, checked by a test that reads a created position back and asserts no decision-typed key"
    - "The badge always renders, defaulting to 'open' when state.decisions carries no entry for a position — including when GET /api/org/decisions itself 403s for an uncleared caller and load()'s Promise.all falls the whole array back to []. No true restricted value (retain/redeploy/in-selection/redundant) is ever disclosed by this fallback; only the harmless default is shown."
    - "The decision-history panel reads from the already-fetched state.decisions array (no per-click fetch); an uncleared caller's empty/403 result and a genuinely empty log render the IDENTICAL 'No decisions recorded yet.' copy — the same anti-enumeration graceful-degradation convention DD-04 established."

key-files:
  created:
    - test/org-decisions.test.js
  modified:
    - server.js
    - validators/org.js
    - public/js/org.js
    - public/org.html
    - test/synergy-stage.test.js

key-decisions:
  - "The decision badge is rendered for EVERY position regardless of whether the caller is cleared to view GET /api/org/decisions — an uncleared caller simply sees the harmless 'open' default (state.decisions falls back to [] on a 403, mirroring the positions/employees/capabilities fetch pattern already established), never a fabricated retain/redeploy/in-selection/redundant value. This reading takes Surface Contract §5's 'every position carries a derived decision — open is itself one of the five values, so there is no gap state on the card' literally, at face value, since the plan text does not carve out a separate clearance rule for the badge distinct from the history panel's own explicitly-documented catch-to-empty-state rule."
  - "The decision-history panel and its 403-catch both resolve to the identical 'No decisions recorded yet.' copy — an uncleared caller cannot distinguish 'this position has no decisions' from 'you are not cleared to see them,' matching DD-04's own anti-enumeration precedent rather than surfacing a distinct error state."
  - "GET /api/org/capabilities' second restricted key (recordOrgDecisions) was added to server.js even though Task 3's declared file list in the plan named only public/js/org.js and public/org.html — the task's own action text explicitly requires 'Extend Plan 02's capability probe response with a second key,' which cannot be satisfied without touching server.js. Treated as an in-scope correction to an incomplete file list, not a deviation requiring a checkpoint (Rule 2: essential for the task's own literal, stated requirement)."
  - "Task 2's action text ('use it to build the decision-type select's options and to map a value to its badge class and its i18n key') was read as foreshadowing Task 3's consumption, not as Task 2 owning DOM construction — Task 2 landed only the client vocabulary array plus small, inert helper maps/functions (ORG_DECISION_BADGE_CLASS, orgDecisionI18nKey, ORG_DECISION_LABELS split across Tasks 2/3); Task 3 owns all actual badge/panel/form rendering. This kept Task 2's commit atomic and testable via its own anti-drift/append-only/derived-current/privacy tests without depending on unbuilt UI."

patterns-established:
  - "A THIRD independent vocabulary copy (client-side, in addition to the server+validator pair every prior enum in this codebase used) is declared as a single array-literal statement specifically so an anti-drift test can extract it from the file as text via regex — the SYN_STAGES/RAID_LEVELS precedent extended to a genuinely brand-new (not reused) enum for the first time in this phase."

requirements-completed: [ORG-02]

coverage:
  - id: D1
    description: "POST /api/org/decisions records an append-only decision entry, gated by isAdminOrIlRequest(req) (D-04 tier 2) as the handler's literal first statement plus the hr area grant; decidedBy/decidedAt are server-stamped and a client-supplied value for either is ignored"
    requirement: ORG-02
    verification:
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions (c/d): the D-04 tier-2 four-identity matrix — admin/hrbp 201, hr-granted-pmo/ungranted-pmo 403 for the SAME payload"
        status: pass
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions (e): the break-glass admin-token identity is refused 403"
        status: pass
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions (h): a client-supplied decidedBy/decidedAt is ignored — the stored entry is stamped server-side"
        status: pass
    human_judgment: false
  - id: D2
    description: "A position's current decision is DERIVED as its latest orgDecisions entry by decidedAt, computed at read time and stored nowhere; the position record itself is never touched"
    requirement: ORG-02
    verification:
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions (k): derivedDecisionFor() returns the latest entry, null for none, ignores other positions"
        status: pass
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions-derived-current: the derived current decision is the latest by decidedAt; the log survives the position's own deletion (the flagged planner assumption pinned as a test)"
        status: pass
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions: no decision field is stored on a position"
        status: pass
    human_judgment: false
  - id: D3
    description: "The five-value vocabulary (retain/redeploy/in-selection/redundant/open) exists as three independent copies, proven identical to each other and to a literal expectation by an anti-drift test"
    requirement: ORG-02
    verification:
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions-drift: server.js, validators/org.js and public/js/org.js all hold the identical ordered five-value decision vocabulary"
        status: pass
    human_judgment: false
  - id: D4
    description: "The append-only guarantee: no update/delete path exists for a decision entry; a second decision for the same position appends rather than overwrites"
    requirement: ORG-02
    verification:
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions (j): recording a second decision appends; the first entry is unchanged"
        status: pass
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions-append-only: three entries survive; the first two are byte-identical to their creation response; DELETE/PUT against the collection both fail closed"
        status: pass
    human_judgment: false
  - id: D5
    description: "The privacy prohibition: a decision recorded against a linked employee never reaches that employee's own roster record (GET /api/employees)"
    requirement: ORG-02
    verification:
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions-privacy: a redundant decision recorded against a linked employee never reaches that employee's own roster record"
        status: pass
    human_judgment: false
  - id: D6
    description: "Decision badge (filled pill, top-right, always present) and per-position history panel (reverse-chronological, bare count, effectiveDate omitted when absent) render correctly; the record-a-decision form is constructed only inside the capability-gated branch and never rendered disabled; the redundant/redeploy governance confirmation carries the legal-and-severance sentence verbatim"
    requirement: ORG-02
    verification:
      - kind: unit
        ref: "test/org-decisions.test.js#org-decisions-ui: no innerHTML sink; no width/max-width/overflow/text-overflow on .org-node-decision; the concatenated i18n key; the capability-gated form construction with no clearance-purposed disabled control; the legal-and-severance confirmation guard; the capabilities probe's absent-not-false governance key"
        status: pass
      - kind: manual_procedural
        ref: "Live visual/browser confirmation of the badge palette, the history panel, and the confirmation copy in a real browser"
        status: unknown
    human_judgment: true
    rationale: "This plan's own <verification> section explicitly defers live browser confirmation to Plan 08's walk — no browser tool was available in this session and the plan text does not ask for one here (same precedent as Plans 01/02/03's own deferred D6/D7)."

# Metrics
duration: ~65min
completed: 2026-08-07
status: complete
---

# Phase 06 Plan 04: ORG-02 Decision Register — Append-Only Log, Five-Value Vocabulary, Tier-2 Write Gate Summary

**An Integration Lead records a role-selection or redundancy decision against a position via `POST /api/org/decisions` (D-04 tier-2 gate, strictly narrower than every other org-section write), derived-current computed at read time from an append-only log, three independent vocabulary copies proven identical by an anti-drift test, and a decision badge/history panel/record form on the org tree.**

## Performance

- **Duration:** ~65min
- **Completed:** 2026-08-07
- **Tasks:** 3
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `POST /api/org/decisions` / `GET /api/org/decisions`: a D-04 tier-2 governance write gate — `isAdminOrIlRequest(req)` as the handler's literal first statement, before any deal or position lookup, reusing the synergy re-baseline route's D-15 precedent verbatim rather than re-implementing an `['admin','hrbp']` check inline; the break-glass `X-Admin-Token` identity is excluded exactly as it is there. Proven from an identical payload across all four identities (admin/hrbp 201, hr-granted-pmo/ungranted-pmo 403), not just each identity in isolation.
- `derivedDecisionFor()`: a position's current decision is computed at read time as the latest `orgDecisions` entry by `decidedAt` and stored nowhere — a reversal a week later leaves the original entry's rationale intact and readable. The position record itself carries no decision field anywhere, checked mechanically by reading a created position back and asserting no decision-typed key exists.
- The five-value vocabulary (`retain`/`redeploy`/`in-selection`/`redundant`/`open`) exists as three independent copies — `server.js`, `validators/org.js`, `public/js/org.js` — each declared as a single array-literal statement so an anti-drift test can extract and cross-check all three, plus a literal expectation, deeply equal.
- The append-only guarantee is mechanical, not just documented: no route anywhere exposes an update or delete path for a decision entry (`DELETE`/`PUT` against the collection both fail closed via `VAL-01`'s unregistered-route refusal), and three sequential decisions for one position leave the first two byte-identical to their own creation response.
- The privacy prohibition is proven end-to-end: a `redundant` decision recorded against an imported, linked employee never surfaces on that employee's own `GET /api/employees` roster record — no decision-typed key, and none of the five vocabulary values appear anywhere in the serialised employee object.
- Every tree card carries a filled decision-pill badge (top-right, per UI-SPEC's exact palette), a per-position history panel (reverse-chronological, bare count, `effectiveDate` omitted rather than placeholder'd when absent), and a record-a-decision form constructed ONLY inside a server-signalled `capabilities.recordOrgDecisions` branch — never rendered disabled for every other cleared-but-non-IL member. The `redundant`/`redeploy` confirmation carries the legal-and-severance sentence verbatim; the other three types get a lighter one-line confirm.

## Task Commits

Each task was committed atomically:

1. **Task 1: The append-only decision log, the five-value vocabulary, and the tier-2 write gate** (TDD-adjacent, tests-with-implementation) - `c0d4f3e` (feat)
2. **Task 2: Three-copy anti-drift, append-only proof, and the derived-current contract** - `fd80f2c` (test)
3. **Task 3: Decision badge, history panel, and the absent-not-disabled record form** - `b333cdf` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `server.js` - `ORG_DECISION_TYPES` (first vocabulary copy), `derivedDecisionFor()`, `GET`/`POST /api/org/decisions` (D-04 tier 2), `GET /api/org/capabilities` extended with the `recordOrgDecisions` governance key
- `validators/org.js` - `ORG_DECISION_TYPES` (second copy), `OrgDecisionSchema` (deliberately omits `decidedBy`/`decidedAt`), local `isValidCalendarDate` idiom for `effectiveDate`
- `public/js/org.js` - `ORG_DECISION_TYPES` (third copy), `ORG_DECISION_BADGE_CLASS`/`ORG_DECISION_LABELS`/`orgDecisionI18nKey()` helpers, the decision badge on every card, the per-position history panel, the capability-gated record-a-decision form with the governance confirmation
- `public/org.html` - `.org-node-decision`/`.org-dec-history`/`.org-dec-row`/`.org-dec-form` CSS per the UI-SPEC's exact per-value palette, no fixed width or clip on the badge; cache stamp bumped
- `test/org-decisions.test.js` - 23 tests across all three tasks: the D-04 four-identity matrix, break-glass exclusion, server-side stamping, append-only proof, derived-current contract (including the flagged planner assumption pinned as a test), the privacy prohibition, and Task 3's source-level/HTTP UI coverage
- `test/synergy-stage.test.js` - updated the `isAdminOrIlRequest` call-site count twice (2→3→4) as this plan's own decisions/capabilities routes adopted the shared helper (Rule 1 fixes)

## Decisions Made

See `key-decisions` in frontmatter — summarised: (1) the decision badge always renders, defaulting to `open` even for a caller uncleared to view `GET /api/org/decisions`, since the fallback discloses no true restricted value; (2) the history panel's 403-catch and its genuinely-empty state render identical copy, matching DD-04's anti-enumeration precedent; (3) `GET /api/org/capabilities`'s second key landed in `server.js` even though Task 3's declared file list omitted it, because the task's own action text required it; (4) Task 2 landed only the client vocabulary array plus small inert helpers, leaving all DOM construction to Task 3, keeping both commits atomic and independently testable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `test/synergy-stage.test.js`'s `isAdminOrIlRequest` call-site count updated twice**
- **Found during:** Task 1 (full-suite verification after adding `POST /api/org/decisions`), then again in Task 3 (after extending `GET /api/org/capabilities`)
- **Issue:** `synergy-baseline (h)` asserted a literal count of `isAdminOrIlRequest(req)` occurrences in `server.js` (originally 2: the definition plus the re-baseline route's own call site). This task's new routes each added a real call site, breaking that pre-existing literal count — the same class of drift Plan 01 hit with the collections-length assertion.
- **Fix:** Updated the literal (2→3 after Task 1, 3→4 after Task 3) and the test's own descriptive text; also reworded a doc comment above the new capabilities-route code that had accidentally spelled out the literal string `isAdminOrIlRequest(req)`, which was inflating the same grep count from a comment rather than a real call site.
- **Files modified:** `test/synergy-stage.test.js`, `server.js` (comment wording only)
- **Verification:** Full suite green (469/469) after both fixes.
- **Committed in:** `c0d4f3e` (Task 1 commit), `b333cdf` (Task 3 commit)

**2. [Rule 2 - Missing Critical] `GET /api/org/capabilities` extended in `server.js` despite Task 3's declared file list omitting it**
- **Found during:** Task 3 (implementing the absent-not-disabled record form)
- **Issue:** Task 3's `<files>` block named only `public/js/org.js` and `public/org.html`, but its own action text explicitly required extending Plan 02's capability probe with a second, IL/admin-only restricted key — impossible without touching `server.js`.
- **Fix:** Added the `recordOrgDecisions` key to `GET /api/org/capabilities`, gated by `isAdminOrIlRequest(req)`, mirroring the existing `targetOrgDesign` key's absent-not-false shape exactly.
- **Files modified:** `server.js`
- **Verification:** `test/org-decisions.test.js#org-decisions-ui: GET /api/org/capabilities` — the key is truthy for admin/hrbp and absent (not false) for an hr-granted-but-non-IL pmo.
- **Committed in:** `b333cdf` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug — Rule 1, twice; 1 missing critical functionality — Rule 2)
**Impact on plan:** Both necessary to keep the full suite green and to satisfy Task 3's own literal, stated requirement. No scope creep — the capabilities extension is the minimum needed for the record form's absence discipline to have anything to gate on.

## Issues Encountered

None beyond the deviations above.

## Next Phase Readiness

- The decision register, its D-04 tier-2 write gate, its three-copy vocabulary, and its badge/history/form UI are proven end-to-end (23 behavior/source-level tests) and ready for Plan 05 (flight-risk register) and Plan 07 (deal-home rollup, which will read `derivedDecisionFor()`-shaped data for its own restricted tier) to build on.
- Live browser confirmation of the badge palette, history panel, and confirmation copy remains deferred to Plan 08's walk, per this plan's own `<verification>` section — consistent with Plans 01/02/03's precedent.
- No blockers for Plan 05.

## Self-Check: PASSED

All created/modified files (`server.js`, `validators/org.js`, `public/js/org.js`, `public/org.html`, `test/org-decisions.test.js`, `test/synergy-stage.test.js`) and all three task commits (`c0d4f3e`, `fd80f2c`, `b333cdf`) verified present on disk / in git log.

---
*Phase: 06-org-design-talent-retention*
*Completed: 2026-08-07*
