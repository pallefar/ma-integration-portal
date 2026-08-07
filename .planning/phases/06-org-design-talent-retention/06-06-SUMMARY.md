---
phase: 06-org-design-talent-retention
plan: 06
subsystem: api
tags: [express, zod, access-control, provenance-filtering, raid-log, org-chart]

# Dependency graph
requires:
  - phase: 06-org-design-talent-retention (Plan 01)
    provides: orgFlightRiskLane() and the orgFlightRisks collection
  - phase: 06-org-design-talent-retention (Plan 05)
    provides: the flight-risk register (GET/POST/DELETE /api/org/flight-risk), its D-02 hr-grant/D-04 tier-2 gates, linkedTaskIds/linkedRaidIds fields declared empty and unused until this plan
  - phase: 04-due-diligence-workspace
    provides: POST /api/dd/findings/:id/convert's lookup-then-create/dedupe-by-source pattern (structurally copied), db/accessPolicy.js's grantedAreas()/hasAreaGrant() clean-room primitive (reused as the per-entry clearance check, NOT filterByAreaGrant() — see key-decisions), the T-04-21 accepted risk this plan closes
provides:
  - POST /api/org/flight-risk/:id/convert (D-15) — one-click bidirectional conversion of a flight-risk entry into a linked Day-1 task and/or RAID entry, deduped on the 'org-flightrisk:<id>' source prefix, severity copied verbatim (D-16)
  - resolveRaidEntryClearanceArea(entry, db) (server.js, exported) — the D-17 provenance resolver: dd-finding source -> the finding's own area (or null if deleted); org-flightrisk source -> fixed 'hr'; anything else -> null
  - GET /api/raid rewritten as a provenance-filtered outbound route — closes the Phase-4 accepted risk T-04-21, proven live once (a converted Legal finding reached an HR-only-cleared member)
  - public/execution.html's .raid-lvl.critical CSS rule — closes a styling gap live since the severity enum widened to four values in Phase 4
  - public/js/due-diligence.js's corrected conversion-note copy (no longer claims whole-deal-team visibility)
  - public/js/org.js conversion controls on the flight-risk register (buttons + linked pills + corrected note)
  - validators/org.js FlightRiskConvertSchema
affects: [06-07-deal-home-rollup, 06-08-i18n-and-live-walk]

# Actuals (#2632)
actuals:
  tokens: 17300
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Provenance-based outbound filtering: an entry in a shared, non-clearance-scoped log (RAID) is gated by resolving its OWN source string back to the functional area of the record that produced it, never by a field the log's own rows carry (workstreamId is many-to-one/non-invertible; the generic area-keyed filterByAreaGrant() cannot be reused because RAID rows carry no `area` field at all — a naive reuse would empty the log for every caller including admin)"
    - "Orphaned-provenance-degrades-to-unlinked: when the record a provenance string points to has been deleted, the resolver returns null (unfiltered) rather than continuing to withhold the entry from everyone — a deletion elsewhere must never silently blank a shared log"
    - "Companion copy/CSS fixes land in the SAME commit as the access-control change they depend on, never a follow-up — a green test suite cannot detect a sentence that has merely become false"

key-files:
  created:
    - test/org-flight-risk-conversion.test.js
    - test/raid-access-filter.test.js
  modified:
    - server.js
    - validators/org.js
    - public/js/org.js
    - public/org.html
    - public/execution.html
    - public/js/due-diligence.js
    - public/due-diligence.html
    - test/synergy-stage.test.js
    - test/dd-findings.test.js
    - test/org-flight-risk-audit.test.js

key-decisions:
  - "resolveRaidEntryClearanceArea() is NEW access-control code, not a reuse of db/accessPolicy.js's filterByAreaGrant() — that helper keys on item.area, and RAID entries carry no area field (only workstreamId), so a naive reuse would evaluate every entry's membership as undefined-in-granted-set (false for every possible set, including the full admin set), emptying the RAID log for EVERY caller. This was the single most dangerous item this plan's own objective flagged, and the failure mode is fail-closed-to-useless, not a leak."
  - "The workstream field is never used as the clearance key: DD_AREA_WORKSTREAM is many-to-one (financial+tax -> ws_finance, legal+complianceEsg -> ws_legal), so a workstream id cannot be inverted back to the area that produced it without guessing wrong roughly half the time that collision applies."
  - "An entry whose originating record was deleted resolves to null (unlinked), not to a permanently-withheld state — proven directly by test/raid-access-filter.test.js (f), which shows a previously-excluded caller GAINS visibility to the entry once its source finding is deleted."
  - "The flight-risk conversion route's source prefix is the literal 'org-flightrisk:' + entry id (06-RESEARCH.md Assumptions Log A1, planner discretion) — distinguishable from the DD finding prefix ('dd-finding:') by its own leading token, which is exactly what the outbound filter branches on."
  - "test/dd-findings.test.js (p) and test/org-flight-risk-audit.test.js's fetch-count guard were both updated (Rule 1) because this plan's own changes made their prior literal assertions stale by design — the DD page's whole-deal-team disclosure became factually wrong the instant the filter shipped, and the flight-risk register gained a genuinely new fetch call site (the post-conversion refresh)."

patterns-established:
  - "A shared, non-clearance-native log (RAID) gains selective content restriction by resolving each row's OWN provenance rather than retrofitting a field onto the row or reusing an ID-based filter shaped for a different collection — the reusable pattern for any future plan that republishes restricted content into an unrestricted lane."

requirements-completed: [ORG-03]

coverage:
  - id: D1
    description: "POST /api/org/flight-risk/:id/convert creates a linked Day-1 task and/or RAID entry from a flight-risk register entry, bidirectionally linked via linkedTaskIds/linkedRaidIds, deduped by the 'org-flightrisk:<id>' source string so a repeat click creates nothing new (D-15); RAID severity is copied verbatim from the entry's level including critical (D-16); the route is gated D-04 tier-2 (admin/IL) + hr area grant, refusing a non-IL caller and an unknown entry id"
    requirement: ORG-03
    verification:
      - kind: unit
        ref: "test/org-flight-risk-conversion.test.js (a)-(d): single-target, dual-target, and critical-severity-verbatim cases"
        status: pass
      - kind: unit
        ref: "test/org-flight-risk-conversion.test.js (e): repeat-click no-op — lane lengths and link arrays unchanged, same ids returned"
        status: pass
      - kind: unit
        ref: "test/org-flight-risk-conversion.test.js (f)-(i): 400 (no target), 404 (unknown id), 403 (non-IL), 403 (structural hr-grant proof)"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /api/raid gates each entry on the functional area its OWN provenance resolves to (D-17): a dd-finding-sourced entry is gated on that finding's own area, an org-flightrisk-sourced entry is gated on the fixed hr area, and a source-less or orphaned entry is returned unfiltered to everyone including admin — closing the Phase-4 accepted risk T-04-21"
    requirement: ORG-03
    verification:
      - kind: unit
        ref: "test/raid-access-filter.test.js (a)-(b): admin and the IL identity receive every entry including the manually created source-less one (the over-filtering regression canary)"
        status: pass
      - kind: unit
        ref: "test/raid-access-filter.test.js (c)-(d): a legal-only member and an hr-only member each see exactly their own provenance plus the manual entry, and nothing else"
        status: pass
      - kind: unit
        ref: "test/raid-access-filter.test.js (e): a deal with only manually created entries returns the identical array to every identity, unchanged from before this filter"
        status: pass
      - kind: unit
        ref: "test/raid-access-filter.test.js (f): an entry whose originating finding was deleted remains visible to admin AND becomes newly visible to a previously-excluded caller"
        status: pass
      - kind: unit
        ref: "test/raid-access-filter.test.js (g): resolveRaidEntryClearanceArea unit cases — empty source, live/orphaned dd-finding, flight-risk prefix, unrecognised prefix"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two companion fixes ship in the SAME commit as the filter: public/execution.html gains the fourth .raid-lvl.critical CSS rule (closing a gap live since Phase 4's severity enum widening), and public/js/due-diligence.js's conversion note is corrected to state the true, now-restricted audience instead of the superseded whole-deal-team claim"
    requirement: ORG-03
    verification:
      - kind: unit
        ref: "test/raid-access-filter.test.js (i): .raid-lvl.critical carries a colour and a font-weight heavier than .high"
        status: pass
      - kind: unit
        ref: "test/raid-access-filter.test.js (j)-(k): due-diligence.js carries the corrected wording and not the superseded sentence; the script's cache stamp was bumped"
        status: pass
      - kind: unit
        ref: "test/dd-findings.test.js (p): updated (Rule 1) to assert the corrected copy replaces the now-stale whole-deal-team disclosure"
        status: pass
    human_judgment: false
  - id: D4
    description: "The flight-risk register surface gains two secondary-styled conversion buttons, constructed only inside the existing governance-capability branch, with genuinely disabled (not hidden) state once a link exists, linked pills, and the corrected conversion note rendered unconditionally for every cleared reader"
    requirement: ORG-03
    verification:
      - kind: unit
        ref: "test/org-flight-risk-conversion.test.js (k): buttons constructed only inside the governance-capability branch; pills/note are not"
        status: pass
      - kind: unit
        ref: "test/org-flight-risk-conversion.test.js (l)-(n): corrected copy present and superseded sentence absent; refresh-not-mutate click handler; CSS + cache-stamp bump"
        status: pass
      - kind: manual_procedural
        ref: "Live visual/browser confirmation of the conversion buttons, pills, note, and critical badge in a real browser"
        status: unknown
    human_judgment: true
    rationale: "This plan's own <verification> section explicitly defers live confirmation of the critical badge's appearance through both conversion paths to Plan 08's walk — no browser tool was available in this session, consistent with every prior Phase 6 plan's identical precedent for the same deferred check."

# Metrics
duration: ~95min
completed: 2026-08-07
status: complete
---

# Phase 06 Plan 06: D-15/D-17 Flight-Risk Conversion & Provenance-Based RAID Clearance Filter Summary

**One-click bidirectional flight-risk-to-task/RAID conversion (D-15), and closure of the Phase-4 accepted risk T-04-21 via a provenance-based outbound RAID filter (D-17) that resolves each entry's own source back to a functional area rather than reusing a field RAID rows do not carry — proven from both the over-filtering and under-filtering directions.**

## Performance

- **Duration:** ~95min
- **Completed:** 2026-08-07
- **Tasks:** 3
- **Files modified:** 12 (2 created, 10 modified)

## Accomplishments

- `POST /api/org/flight-risk/:id/convert` (D-15): structurally mirrors `POST /api/dd/findings/:id/convert` — tier-2 role gate as the literal first statement, hr area grant, lookup-then-create for a Day-1 task and/or a RAID entry, deduped on the stable `org-flightrisk:<id>` source string, bidirectional `linkedTaskIds`/`linkedRaidIds`, one conditional write. RAID severity is copied VERBATIM from the entry's `riskLevel` (D-16) — a critical retention risk arrives in the RAID log as critical, never downgraded.
- `resolveRaidEntryClearanceArea(entry, db)` (D-17): the genuinely new access-control primitive this plan's objective called the single most dangerous item — NOT a reuse of `db/accessPolicy.js`'s `filterByAreaGrant()` (which keys on a field RAID rows don't carry) and NOT keyed on `workstreamId` (a many-to-one, non-invertible mapping). Resolves a `dd-finding:` source to the originating finding's own area (or `null` if the finding was deleted — orphaned degrades to unlinked, never permanently withheld), an `org-flightrisk:` source to the fixed `hr` area, and everything else to `null` (returned unfiltered).
- `GET /api/raid` rewritten as a provenance-filtered route, closing the Phase-4 accepted risk T-04-21 that was proven live once (a converted Legal finding reached an HR-only-cleared member). Proven from BOTH directions across 11 tests: admin/IL receive every entry including a manually created, source-less one (the over-filtering regression canary); single-area members are correctly included for their own provenance and excluded from others'; a deal with no restricted-provenance entries is completely unaffected; an orphaned link (originating finding deleted) becomes visible to a previously-excluded caller.
- Two companion fixes shipped in the SAME commit as the filter, per this plan's explicit non-negotiable: `public/execution.html` gained the missing `.raid-lvl.critical` CSS rule (a gap live since the severity enum widened to four values in Phase 4), and `public/js/due-diligence.js`'s conversion note no longer claims whole-deal-team visibility — corrected to state the true, now-restricted audience.
- `public/js/org.js`'s flight-risk register gained conversion controls: two secondary-styled buttons constructed only inside the existing governance-capability branch (a cleared-but-non-IL reader still sees the linked pills and the corrected note, just no buttons), genuinely disabled (not hidden) once a link exists, and a click handler that refreshes `state.flightRisks` from the server rather than mutating the clicked entry locally.

## Task Commits

Each task was committed atomically:

1. **Task 1: One-click bidirectional conversion, deduped by source** - `476eab2` (feat)
2. **Task 2: The provenance-based outbound RAID filter, plus its two companion fixes, in one commit** - `59daabb` (fix)
3. **Task 3: Conversion controls on the register** - `479eee1` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `server.js` - `POST /api/org/flight-risk/:id/convert`, `resolveRaidEntryClearanceArea()` (exported), rewritten `GET /api/raid`
- `validators/org.js` - `FlightRiskConvertSchema`, its route registration
- `public/js/org.js` - `buildFlightRiskRow()`'s conversion controls, `convertFlightRisk()`
- `public/org.html` - `.org-risk-convert`/`.org-risk-linked`/`.org-risk-convert-note` CSS, cache stamp bump
- `public/execution.html` - `.raid-lvl.critical` CSS rule
- `public/js/due-diligence.js` - corrected `.dd-finding-convert-note` copy and comment
- `public/due-diligence.html` - cache stamp bump
- `test/org-flight-risk-conversion.test.js` - 14 tests: Task 1's conversion behavior + Task 3's source-level UI checks
- `test/raid-access-filter.test.js` - 11 tests: the D-17 both-directions proof, orphan case, unit-level resolver cases, source-level CSS/copy checks
- `test/synergy-stage.test.js` - `isAdminOrIlRequest(req)` call-site literal count updated 6→7 (Rule 1)
- `test/dd-findings.test.js` - test (p) updated (Rule 1) to assert the corrected, now-true conversion-note copy
- `test/org-flight-risk-audit.test.js` - the register-fetch literal-count guard updated 2→3 (Rule 1)

## Decisions Made

See `key-decisions` in frontmatter — summarised: (1) `resolveRaidEntryClearanceArea()` is new access-control code, deliberately not reusing `filterByAreaGrant()` (field mismatch would fail-closed-to-useless, emptying the log for admin too); (2) the workstream field is never the clearance key (non-invertible many-to-one mapping); (3) an orphaned provenance link degrades to unlinked, proven by a caller gaining visibility after a deletion; (4) the flight-risk source prefix is `org-flightrisk:<id>` per the plan's recorded planner discretion; (5) three pre-existing tests were updated (Rule 1) because this plan's own changes made their literal assertions stale by design, not because of a regression.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `test/synergy-stage.test.js`'s `isAdminOrIlRequest` call-site literal count updated 6→7**
- **Found during:** Task 1 (full-suite verification after adding the new conversion route's role gate)
- **Issue:** `synergy-baseline (h)` asserted a literal count of `isAdminOrIlRequest(req)` occurrences (6, from Plan 05). This task's one new real call site (the conversion route's tier-2 gate) inflated the true count to 7 — the same drift class Plans 04 and 05 each documented fixing for their own routes.
- **Fix:** Updated the literal expectation and its descriptive comment to 7, naming the new call site.
- **Files modified:** `test/synergy-stage.test.js`
- **Verification:** Full suite green (505/505) after the fix.
- **Committed in:** `476eab2` (Task 1 commit)

**2. [Rule 1 - Bug] `test/dd-findings.test.js` (p) asserted a disclosure this plan's own Task 2 makes false**
- **Found during:** Task 2 (full-suite verification after correcting the due-diligence conversion note)
- **Issue:** The pre-existing test asserted the client carried the literal "whole deal team" disclosure text (T-04-21's original accepted-risk documentation). This plan's own objective requires that sentence to become false the instant the outbound filter ships — the test was asserting the STALE state, not a regression.
- **Fix:** Rewrote the test to assert the corrected, now-true copy is present and the superseded sentence is absent, with the comment updated to record T-04-21's closure.
- **Files modified:** `test/dd-findings.test.js`
- **Verification:** Full suite green (516/516) after the fix.
- **Committed in:** `59daabb` (Task 2 commit)

**3. [Rule 1 - Bug] `test/org-flight-risk-audit.test.js`'s register-fetch literal-count guard updated 2→3**
- **Found during:** Task 3 (full-suite verification after adding the post-conversion refresh fetch call)
- **Issue:** Plan 05's own test asserted exactly two `fetch('/api/org/flight-risk')` call sites (page-load + post-submit refresh). This task's `convertFlightRisk()` added a legitimate third call site (the post-conversion refresh, itself a direct consequence of an explicit user action, never a poll).
- **Fix:** Updated the literal expectation to 3 and the descriptive comment/message to name the new call site, while keeping the existing no-`setInterval`/`setTimeout` assertion unchanged.
- **Files modified:** `test/org-flight-risk-audit.test.js`
- **Verification:** Full suite green (520/520) after the fix.
- **Committed in:** `479eee1` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1 — pre-existing tests whose literal assertions this plan's own design deliberately superseded; no functional code beyond this plan's declared scope was altered by any of the three)
**Impact on plan:** All three were necessary to keep the full suite green and reflect this plan's own true, intended end state. No scope creep — each is a test-only literal update in a file this plan's own task explicitly touches or that Task 2's threat model names as in-scope (the due-diligence copy fix).

## Issues Encountered

None beyond the three deviations above.

## Next Phase Readiness

- D-15 (bidirectional conversion) and D-17 (the Phase-4 accepted-risk closure) are both proven end-to-end (25 tests across two new test files) and ready for Plan 07 (deal-home rollup) and Plan 08 (i18n + live walk) to build on directly.
- Live browser confirmation of the conversion buttons, linked pills, corrected note, and the critical severity badge's rendered appearance through both conversion paths remains deferred to Plan 08's walk, per this plan's own `<verification>` section — consistent with every prior Phase 6 plan's identical precedent.
- No blockers for Plan 07.

## Self-Check: PASSED

All created files (`test/org-flight-risk-conversion.test.js`, `test/raid-access-filter.test.js`) and all three task commits (`476eab2`, `59daabb`, `479eee1`) verified present on disk / in git log. Full suite: 520/520 passing.

---
*Phase: 06-org-design-talent-retention*
*Completed: 2026-08-07*
