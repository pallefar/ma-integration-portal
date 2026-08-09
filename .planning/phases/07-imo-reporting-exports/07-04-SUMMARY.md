---
phase: 07-imo-reporting-exports
plan: 04
subsystem: api
tags: [synergy-rollup, headline-integrity, staleness, csv-export, express, sqlite]

# Dependency graph
requires:
  - phase: 07-imo-reporting-exports
    plan: 02
    provides: the completed export architecture (all eight dataset/format combinations) and computeWorkstreamRollup(db), which this plan's stale-day-count addition to the synergies branch extends
provides:
  - "GET /api/synergies/rollup's grossRealizedM REDEFINED to phased-only realized money, plus a new unphasedRealizedM field for the complementary partition — computed once, at read time, from the same has-phasing predicate synergyRollupFields() already uses"
  - "the execution tab's five-tile rollup row (gross realized, unphased, cost incurred, net benefit, deal target) — the sole consumer, updated in the same commit as the redefinition"
  - "enrichSynergy()'s new staleDays whole-day age field, from the same single-clock ctx and the same lastConfirmedAt-falling-back-to-createdAt resolution isSynergyStale() already uses"
  - "the synergies CSV/JSON export carrying both the split rollup fields (via the live rollup route) and the per-item staleDays column"
affects: ["07-05 (PDF steerco pack) reads GET /api/synergies/rollup's grossRealizedM/unphasedRealizedM and enrichSynergy()'s staleDays for its Section 4 synergies page and exec-summary stale sentence — both fields now exist for it to read, never re-derive"]

# Actuals (#2632)
actuals:
  tokens: 8900
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A field redefinition with 'costly' reversibility (D-01) lands in the SAME commit as its sole consumer, after a repo-wide grep re-proves that consumer count — never a two-commit sequence with an intermediate state whose meaning silently changed"
    - "A per-item age field (staleDays) is derived from the SAME ctx object (nowMs) and the SAME timestamp-resolution logic as the sibling boolean it sits beside (stale) — one clock, one fallback chain, never two independently-maintained copies that could disagree"
    - "Pre-existing tests whose assertions depended on a field's OLD meaning are updated deliberately in the same commit as the redefinition, with an inline comment naming the plan/decision that changed their expectation — never silently deleted"

key-files:
  created:
    - test/synergy-rollup-split.test.js
  modified:
    - server.js (GET /api/synergies/rollup's grossRealizedM redefinition + new unphasedRealizedM; enrichSynergy()'s new staleDays field; GET /api/reports/export's synergies CSV column)
    - public/js/execution.js (renderSynRollup(): five tiles, unphased tile added)
    - public/execution.html (execution.js cache-stamp bump)
    - test/synergy-staleness.test.js (three pre-existing assertions updated for the redefinition, not deleted)
    - test/reports-export.test.js (new Task 2 test: staleDays at the export surface, D-14's one-threshold property, unknown-age null/false)

key-decisions:
  - "Repository-wide grep re-confirmed exactly one consumer of grossRealizedM/unconfirmedRealizedM (public/js/execution.js:652) before redefining, per 07-RESEARCH.md Pitfall 3's stated precondition — no second consumer had appeared since research, so the redefine-in-place reading proceeded as planned rather than halting"
  - "costIncurredM, netBenefitM, dealTargetM, unconfirmedRealizedM and staleCount deliberately keep summing the FULL enriched array, unpartitioned — only grossRealizedM is redefined and unphasedRealizedM is new; netBenefitM moves with the redefinition (it derives from the now-phased-only gross), which is the intended consequence, not a bug"
  - "Per-item staleDays is a DIFFERENT number from ctx.staleDays (the deal's configured threshold) despite sharing a name — one is an item's own age, the other is the deal-wide setting it is judged against; documented inline at enrichSynergy() to prevent future confusion"
  - "test/synergy-staleness.test.js (l): the old 'unconfirmedRealizedM never exceeds grossRealizedM' invariant is restated against the CONSERVED gross+unphased total, since unconfirmedRealizedM still sums over the full array while grossRealizedM now sums only the phased partition"
  - "test/synergy-staleness.test.js (n): its unphased fixture was converted to a phased one (generate-phasing + a per-month realizedM write) so the test keeps proving the general 'net benefit = gross - cost' formula, rather than incidentally re-testing the redefinition's consequence for an unphased item"
  - "test/reports-export.test.js (n)'s 'within threshold' fixture uses 25 of a 30-day threshold, not exactly 30 — an HTTP round trip cannot inject a fixed clock, so the literal exactly-at-threshold boundary stays proven at the pure-function level (test/synergy-staleness.test.js (g)) while this export-level test proves the day count and boolean survive correctly into the export surface without a wall-clock race"

patterns-established: []

requirements-completed: [RPT-03, RPT-04]

coverage:
  - id: D1
    description: "GET /api/synergies/rollup's grossRealizedM counts phased-backed realized money only; a new unphasedRealizedM field carries the complementary partition — both directions proven in one test plus the conservation invariant (gross + unphased = old undifferentiated total)"
    requirement: "RPT-03"
    verification:
      - kind: integration
        ref: "test/synergy-rollup-split.test.js#synergy-rollup-split (a)"
        status: pass
      - kind: integration
        ref: "test/synergy-rollup-split.test.js#synergy-rollup-split (b)"
        status: pass
      - kind: integration
        ref: "test/synergy-rollup-split.test.js#synergy-rollup-split (c)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The execution tab's rollup row renders five tiles (gross realized, unphased, cost incurred, net benefit, deal target) from the server rollup response alone, never re-summing the card list; the unphased tile carries its own label, never a footnote inside gross"
    requirement: "RPT-03"
    verification:
      - kind: unit
        ref: "node -e source assertion in 07-04-PLAN.md Task 1's <verify> block (unphasedRealizedM present, no card-list re-sum)"
        status: pass
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness-ui (e)"
        status: pass
    human_judgment: false
  - id: D3
    description: "enrichSynergy() attaches a whole-day staleDays age from the same single-clock ctx and timestamp-resolution the stale boolean uses; an item with no parseable timestamp exports staleDays: null and stale: false, never a false 0"
    requirement: "RPT-04"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (n)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The synergies CSV export carries a Stale days column immediately after Stale; JSON carries staleDays automatically since it is the enriched shape; moving the deal's synergyStaleDays threshold flips the export's stale verdict for the same item (D-14's one-knob property, proven at the export surface)"
    requirement: "RPT-04"
    verification:
      - kind: integration
        ref: "test/reports-export.test.js#reports-export (n)"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-13 stands untouched — no staleness concept invented for tasks, RAID, workstreams or the flight-risk register in this plan"
    requirement: "RPT-04"
    verification: []
    human_judgment: true
    rationale: "This is a negative/absence claim (nothing was added) — provable by the diff containing no such code, which is a review judgment rather than something a test asserts"

duration: ~35min
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 4: Synergy Headline Split and Stale Day Count Summary

**Redefined GET /api/synergies/rollup's grossRealizedM to phased-backed money only (closing the T-05-47 Phase-5 debt), added the complementary unphasedRealizedM field and a five-tile execution-tab row, and gave enrichSynergy() a whole-day staleDays field that now flows into the synergies CSV/JSON exports.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-08-09
- **Tasks:** 2
- **Files modified:** 6 (server.js, public/js/execution.js, public/execution.html, test/synergy-rollup-split.test.js [new], test/synergy-staleness.test.js, test/reports-export.test.js)

## Accomplishments
- Closed T-05-47: `GET /api/synergies/rollup`'s `grossRealizedM` now sums ONLY items with at least one phasing row; a new `unphasedRealizedM` field sums the complementary partition — computed once, at read time, from the same has-phasing predicate `synergyRollupFields()` already used, so an initiative that later gains phasing self-corrects on its next read with no migration.
- Re-verified the research's "exactly one consumer" premise via a fresh repo-wide grep before redefining, then updated that sole consumer (`renderSynRollup()` in `public/js/execution.js`) in the SAME commit — the tile row is now five tiles (gross realized, unphased, cost incurred, net benefit, deal target), reading only the server rollup response.
- Added `enrichSynergy()`'s new `staleDays` field: a whole-day age derived from the identical single-clock `ctx` and the identical `lastConfirmedAt`-falling-back-to-`createdAt` resolution `isSynergyStale()` uses, so the boolean and the count can never disagree; unparseable timestamps report `null`, never a misleading `0`.
- Extended the synergies CSV export with a `Stale days` column immediately after `Stale`; the JSON export carries it automatically as part of the enriched shape.
- `test/synergy-rollup-split.test.js` (new, 3 tests) proves both directions of the split in one test plus the conservation invariant, a floating-point rounding-edge fixture, and the zero-initiative case.
- `test/reports-export.test.js` gained one new test proving `staleDays` and `stale` at the export surface, an unknown-age item exporting `null`/`false`, and D-14's one-threshold property flipping the export's verdict when the deal's `synergyStaleDays` setting changes.
- Three pre-existing `test/synergy-staleness.test.js` assertions that depended on the OLD undifferentiated `grossRealizedM` were updated deliberately (per the plan's own verification note), each with an inline comment naming why.

## Task Commits

Each task was committed atomically:

1. **Task 1: Split the synergy headline into phased and unphased, and update its one consumer in the same commit** - `39e9f52` (feat)
2. **Task 2: A stale day count behind the existing boolean, and staleness in the exports** - `72397a2` (feat)

## Files Created/Modified
- `server.js` - `GET /api/synergies/rollup`'s `grossRealizedM` redefinition + new `unphasedRealizedM`; `enrichSynergy()`'s new `staleDays` field + its helper `synergyStaleDayCount()`; `GET /api/reports/export`'s synergies CSV column
- `public/js/execution.js` - `renderSynRollup()`: five tiles, the new unphased tile
- `public/execution.html` - execution.js cache-stamp bump (`?v=1786250801`)
- `test/synergy-rollup-split.test.js` (new) - both-directions proof, conservation invariant, rounding-edge fixture, zero-initiative case
- `test/synergy-staleness.test.js` - (l)/(n) updated for the redefinition's consequences; (e) updated for the five-tile count
- `test/reports-export.test.js` - new test (n): staleDays/stale at the export surface, D-14 threshold flip, unknown-age null/false

## Decisions Made
- Repository-wide grep re-confirmed exactly one consumer of `grossRealizedM`/`unconfirmedRealizedM` before redefining (07-RESEARCH.md Pitfall 3's stated precondition) — proceeded with the redefine-in-place reading rather than halting.
- `costIncurredM`, `netBenefitM`, `dealTargetM`, `unconfirmedRealizedM` and `staleCount` deliberately keep summing the full enriched array, unpartitioned; `netBenefitM` moves with the redefinition since it derives from the now-phased-only gross — the intended consequence per the plan, not a bug.
- Per-item `staleDays` is a different number from `ctx.staleDays` (the deal's configured threshold) despite sharing a name; documented inline to prevent future confusion.
- `test/synergy-staleness.test.js` (l)'s invariant restated against the conserved gross+unphased total, since `unconfirmedRealizedM` still sums unpartitioned while `grossRealizedM` no longer does.
- `test/synergy-staleness.test.js` (n)'s fixture converted from unphased to phased so it keeps testing the general net-benefit formula rather than incidentally re-testing the redefinition.
- `test/reports-export.test.js` (n)'s "within threshold" fixture uses 25 of a 30-day threshold (not exactly 30) to avoid a wall-clock race in an HTTP-level test — the literal exactly-at-threshold boundary stays proven at the pure-function level in `test/synergy-staleness.test.js` (g).

## Deviations from Plan

### Auto-fixed Issues

**1. [Anticipated by the plan's own verification note, not an unplanned deviation] Updated three pre-existing test/synergy-staleness.test.js assertions**
- **Found during:** Task 1 (redefining grossRealizedM)
- **Issue:** Tests (l), (n) and (e) in `test/synergy-staleness.test.js` asserted values computed under the OLD undifferentiated `grossRealizedM` definition (a single sum over all items) or the old four-tile count; the redefinition changed their expected results.
- **Fix:** (e) updated to expect five tiles and assert the new unphased tile's presence. (l) updated to assert `grossRealizedM: 0`/`unphasedRealizedM: 7.4` for its two unphased fixtures, and its invariant restated against the conserved `gross + unphased` total. (n) had its fixture converted to a phased initiative (via `generate-phasing` + a per-month `realizedM` write) so it keeps proving the general net-benefit formula.
- **Files modified:** `test/synergy-staleness.test.js`
- **Verification:** `node --test test/synergy-staleness.test.js` — all 34 staleness tests + 16 staleness-ui tests pass.
- **Committed in:** `39e9f52` (Task 1 commit, same commit as the redefinition per the plan's own "no intermediate commit" requirement)

---

**Total deviations:** 1 (a plan-anticipated test update, not an unplanned deviation under Rules 1-4)
**Impact on plan:** None on scope — the plan's own `<verification>` section explicitly named this update as required ("must be updated deliberately rather than deleted if the redefinition changes their expectations").

## Issues Encountered
- Initial draft of `test/reports-export.test.js` (n) computed an "exactly at the 30-day threshold" fixture timestamp before the HTTP round trip, which raced against `isSynergyStale()`'s own strictly-greater-than-threshold boundary check (the request's `nowMs` is captured a few milliseconds after the fixture's timestamp is computed, tipping the item over the boundary). Fixed by using a fixture comfortably within the threshold (25 of 30 days) instead — the literal exact-boundary case remains proven at the pure-function level by the pre-existing `test/synergy-staleness.test.js` (g), which controls `nowMs` directly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plan 07-05 (the PDF steerco pack) can now read `GET /api/synergies/rollup`'s `grossRealizedM`/`unphasedRealizedM` directly for its Section 4 synergies page and exec-summary split sentence, and `enrichSynergy()`'s `staleDays` field for the pack's "Stale {N}d" tag — both fields this plan added are exactly what 07-UI-SPEC.md §4/§5 named as missing.
- No outstanding manual verification debt: both tasks' `<verify>` blocks are fully automated (`node --test`, plus the source-level tile assertion), and the full suite (602/602) is green.

---
*Phase: 07-imo-reporting-exports*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 6 modified/created files confirmed present on disk; both task commit hashes (`39e9f52`, `72397a2`) confirmed present in `git log --oneline --all`.
