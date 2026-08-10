---
phase: 06-org-design-talent-retention
plan: 07
subsystem: api
tags: [express, zod, access-control, deal-home, org-chart, retention]

# Dependency graph
requires:
  - phase: 06-org-design-talent-retention (Plan 01)
    provides: orgPositionsLane(), the D-06/D-07 current/target identity model
  - phase: 06-org-design-talent-retention (Plan 02)
    provides: GET /api/org/capabilities' absent-not-zeroed capability-probe pattern (D-20's precedent, reused verbatim by GET /api/org/summary)
  - phase: 06-org-design-talent-retention (Plan 04)
    provides: orgDecisionsLane(), ORG_DECISION_TYPES, derivedDecisionFor() — the decision-count tally's data source
  - phase: 06-org-design-talent-retention (Plan 05)
    provides: orgFlightRiskLane(), the flight-risk entry shape (riskLevel/mitigation/owner) — the unmitigated-count tally's data source
  - phase: 04-due-diligence-workspace
    provides: GET /api/dd/summary's filter-before-tally/absent-not-zeroed rollup shape (D-15/D-16), structurally mirrored here; db/accessPolicy.js's hasAreaGrant()
  - phase: 05-synergy-value-capture
    provides: public/js/deal-home.js's renderStaleSynergyNudge()/findSectionHeading() owner-nudge pattern, reused as a PATTERN (not shared code) by this plan's renderFlightRiskNudge()
provides:
  - GET /api/org/summary + orgSummaryFor(db, deal, user) (server.js, exported) — the clearance-scoped organisation rollup (D-19/D-21): an open tier (current headcount, open positions) visible to any deal member, and a restricted tier (target headcount, current->target delta, five-value decision counts, unmitigated high/critical flight-risk count, caller-scoped owner count) assigned ONLY inside the hr-grant branch so it is STRUCTURALLY ABSENT — not null, not zeroed — for an uncleared caller (D-20)
  - public/js/deal-home.js renderOrgPanel(wrap, summary) — the deal-home two-tier organisation panel; the open tier is a `div`, the restricted tier is a `section` (tag-level distinction, UI-SPEC Design Tension 3), branching on the restricted key's PRESENCE via hasOwnProperty, never its truthiness
  - public/js/deal-home.js renderFlightRiskNudge(wrap, summary) — the D-22 owner nudge, following renderStaleSynergyNudge()'s shape as a PATTERN (not shared code); own element ids and sessionStorage key so it stacks alongside the existing synergy nudge
  - The fifth fan-out fetch in renderDealHome() (GET /api/org/summary), feeding both the panel and the nudge from one response
  - public/dashboard.html .org-summary-open/-restricted/-row/-delta CSS, scoped to the deal-home block, no width/overflow/clipping rule
  - test/org-summary.test.js — 24 tests: the D-19/D-20/D-21 rollup behavior, the absence-by-stringify proof, the zero-audit proof, the deleted-position decision-exclusion proof, and D-22's Task 2/3 source-level UI coverage
affects: [06-08-i18n-and-live-walk]

# Actuals (#2632)
actuals:
  tokens: 12590
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rollup mirroring: GET /api/org/summary structurally copies GET /api/dd/summary's shape (filter/derive once, then compute several named tallies from that single pass, rather than a narrowed query per number) — 06-RESEARCH.md Open Question 2's recorded planner discretion, so a Phase-7 consumer or Plan 08's seed can read more facets from the same pass without a second rollup route"
    - "Structural-absence-by-assignment (D-20), now proven at both the JSON and DOM layers: the server assigns the restricted key ONLY inside the hr-grant branch (never a ternary, never null); the client branches on Object.prototype.hasOwnProperty.call(summary, 'restricted') (never a truthiness test), and constructs the restricted DOM node with a DIFFERENT ELEMENT TAG (section vs div) so a raw-markup query is unambiguous even if a class name drifts"
    - "Nudge-as-pattern, not shared code: renderFlightRiskNudge() is a full independent copy of renderStaleSynergyNudge()'s shape (heading-badge + dismissible banner via findSectionHeading()/window.makeBannerDismissible()) with its own element ids and sessionStorage key — the SAME reuse discipline Plan 05 itself established when it wrote the synergy nudge without touching due-diligence.js's original owner-nudge"

key-files:
  created:
    - test/org-summary.test.js
  modified:
    - server.js
    - public/js/deal-home.js
    - public/dashboard.html

key-decisions:
  - "Decision-type counts are derived over the CURRENT-state roster only, mirroring the open tier's own current-state-only headcount — a retain/redeploy/redundant decision is conceptually about the people occupying CURRENT positions, not a target design that has no occupants to decide about yet. This is a planner-discretion resolution: the plan's own behavior block names 'each position's latest log entry' without specifying current vs target, and 06-CONTEXT.md is silent on it. Recorded here so Plan 08 (or a future Phase-7 consumer) does not re-derive a different answer."
  - "The restricted tier's shape ({targetHeadcount, delta, decisions, unmitigatedFlightRisks, mine: {unmitigatedFlightRisks}}) is this plan's own naming, not dictated by 06-CONTEXT.md or the UI-SPEC beyond the English field descriptions — chosen to read as one flat namespace per concern (decisions is itself an object keyed by the five vocabulary values, mirroring GET /api/dd/summary's per-area nested shape)."
  - "Two grep-tripping self-inflicted comment mentions (this plan's own code, not pre-existing drift) were caught and reworded during Task 1/Task 3 authoring, before they ever reached a commit — mirroring the exact class of issue Plans 02/05/06 each hit and fixed as Rule-1 deviations. Recorded here as prevention, not as a deviation, since nothing ever landed broken."

patterns-established:
  - "A fourth independent copy of ORG_DECISION_TYPES/ORG_DECISION_LABELS now exists in public/js/deal-home.js (server.js, validators/org.js, public/js/org.js were the first three) — deliberate, following the RAID_LEVELS/SYN_STAGES multi-copy convention already established for a codebase with no client-side module system to share a single source of truth across page-scoped IIFEs."

requirements-completed: [ORG-01, ORG-02, ORG-03]

coverage:
  - id: D1
    description: "GET /api/org/summary + orgSummaryFor() returns the open tier (current headcount, open positions, unaffected by target-state rows) to any deal member with no clearance gate, and assigns the restricted tier (target headcount, current->target delta, five-value decision counts, unmitigated high/critical flight-risk count, caller-scoped owner count) ONLY inside the hr-grant branch — proven structurally absent from the serialised JSON for an uncleared caller, never null or zeroed"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-summary.test.js (a)-(b): the stringify-search absence proof for an uncleared caller, and restricted-key presence for an hr-granted caller"
        status: pass
      - kind: unit
        ref: "test/org-summary.test.js (c)-(d): current/open/target headcount counting rules, target-state non-contribution to the open tier, and the negative-delta magnitude proof"
        status: pass
      - kind: unit
        ref: "test/org-summary.test.js (i): an empty deal returns a zeroed open tier and a present-but-zeroed restricted tier for a cleared caller"
        status: pass
    human_judgment: false
  - id: D2
    description: "Restricted decision-type counts are derived from each current-state position's latest orgDecisions entry (defaulting to 'open' when none exists), and a decision entry whose position has been deleted contributes to no count at all — not even to the open bucket"
    requirement: ORG-02
    verification:
      - kind: unit
        ref: "test/org-summary.test.js (e): the five-value decision tally, including the open-value default for an undecided position"
        status: pass
      - kind: unit
        ref: "test/org-summary.test.js (f): a decision entry whose position was deleted contributes to no count, proven as a before/after delta across a real DELETE"
        status: pass
    human_judgment: false
  - id: D3
    description: "The restricted unmitigated-flight-risk count includes only high/critical entries with an empty mitigation (excluding low/medium severity and mitigated entries), and the caller-scoped mine block reports how many of those the CALLING user owns — zero (not absent) for a cleared caller who owns none"
    requirement: ORG-03
    verification:
      - kind: unit
        ref: "test/org-summary.test.js (g): the severity/mitigation filter across five constructed entries"
        status: pass
      - kind: unit
        ref: "test/org-summary.test.js (h): the caller-scoped mine count for an owning caller (2) and a cleared-but-owning-none caller (0, restricted key still present)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The route writes ZERO audit rows for any identity (cleared or uncleared), and carries no explicit role gate — every number is already clearance-scoped before it is computed, mirroring GET /api/dd/summary"
    requirement: ORG-03
    verification:
      - kind: unit
        ref: "test/org-summary.test.js (j): a before/after audit-row-count delta of zero across both a cleared and an uncleared summary read"
        status: pass
      - kind: unit
        ref: "test/org-summary.test.js (grep-level guard): the route handler's own source contains zero recordSecurityEvent call sites"
        status: pass
    human_judgment: false
  - id: D5
    description: "The deal-home organisation panel renders the open tier as a <div> (always) and the restricted tier as a <section> (only when the restricted key is present, branched via hasOwnProperty not truthiness) — the tag-level distinction from UI-SPEC Design Tension 3 — with the delta emphasised only when negative, the fan-out extended to five fetches, and the file's standing no-innerHTML/no-audit-route invariants preserved"
    requirement: ORG-01
    verification:
      - kind: unit
        ref: "test/org-summary.test.js (source, Task 2): the section/div tag-level construction, the hasOwnProperty branch, the five-fetch fan-out plus header comment, the negative-only delta emphasis, the CSS clipping-free rule, and the cache-stamp bump"
        status: pass
      - kind: manual_procedural
        ref: "Live visual/browser confirmation of the two-tier panel and the raw-markup absence check as an uncleared member"
        status: unknown
    human_judgment: true
    rationale: "This plan's own <verification> section explicitly defers live confirmation of the panel and the raw-markup absence check to Plan 08's walk — no browser tool was available in this session, consistent with every prior Phase 6 plan's identical precedent for the same deferred check."
  - id: D6
    description: "The flight-risk owner nudge (D-22) follows renderStaleSynergyNudge()'s shape as a pattern (never called/imported/modified), sourced strictly from the restricted caller-scoped block, absent for an uncleared caller or a caller who owns none, with its own element ids and sessionStorage key so it stacks alongside the existing synergy nudge"
    requirement: ORG-03
    verification:
      - kind: unit
        ref: "test/org-summary.test.js (source, Task 3): the early-return guards, the distinct element ids and sessionStorage key, the existing nudge's non-interference, the text-match heading lookup, and the wiring into renderDealHome() with the shared summary object"
        status: pass
      - kind: unit
        ref: "test/org-summary.test.js (source, Task 3): the client's greater-than-zero guard suppresses the nudge for a cleared caller who genuinely owns zero unmitigated entries (server sends a real zero, not an absent field)"
        status: pass
    human_judgment: false

# Metrics
duration: ~50min
completed: 2026-08-07
status: complete
---

# Phase 06 Plan 07: D-19/D-20/D-21/D-22 Deal-Home Org Rollup & Owner Nudge Summary

**`GET /api/org/summary`, a clearance-scoped rollup whose restricted tier (target headcount, the current->target delta, decision counts, unmitigated flight risks) is structurally absent — not zeroed — for an uncleared caller, feeding a two-tier deal-home panel (`div` open tier, `section` restricted tier) and a flight-risk owner nudge that stacks alongside the existing synergy nudge.**

## Performance

- **Duration:** ~50min
- **Completed:** 2026-08-07
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `GET /api/org/summary` + `orgSummaryFor(db, deal, user)` (server.js, exported for Plan 08's seed and any Phase-7 consumer): structurally mirrors `GET /api/dd/summary` — filter/derive once, then compute several named tallies from that single pass. The open tier (current headcount, open positions) is always present, unaffected by target-state rows. The restricted tier is assigned ONLY inside the `hr`-grant branch — never a ternary, never null, never an empty object — so serialisation OMITS the key entirely for an uncleared caller, proven by stringifying the whole response and searching for the key name rather than checking a property is undefined (which would also pass for an explicit null).
- Decision-type counts are derived from each CURRENT-state position's latest `orgDecisions` entry (defaulting to `open` when none exists), skipping any entry whose position id is absent from the current lane — proven as a real before/after delta across a live `DELETE /api/org/positions/:id` call, not just a hand-built array. The unmitigated flight-risk count includes only high/critical entries with an empty (trimmed) mitigation, and the caller-scoped `mine` block reports the calling user's own owned count — genuinely zero, not absent, for a cleared caller who owns none.
- No `recordSecurityEvent()` call anywhere in the route, and no explicit role gate — asserted both behaviorally (a before/after audit-row-count delta of zero across both a cleared and an uncleared read) and via a grep-level guard against the route handler's own extracted source.
- `public/js/deal-home.js`'s `renderOrgPanel(wrap, summary)`: the open tier is a `div.org-summary-open` (always rendered); the restricted tier is a `section.org-summary-restricted` — a DIFFERENT ELEMENT TAG, constructed only when `Object.prototype.hasOwnProperty.call(summary, 'restricted')`, never on a truthiness test of its contents. The current->target delta gets its own row, emphasised with the existing `.deal-home-dd-overdue` treatment ONLY inside an explicit `delta < 0` branch. The five decision-type labels carry `data-i18n` keys matching `org.js`'s own `orgDecisionI18nKey()` construction. The fan-out grew to five fetches; the file's header/entry-point comments were updated to match.
- `renderFlightRiskNudge(wrap, summary)` (D-22): built as a full independent copy of `renderStaleSynergyNudge()`'s shape — heading badge + dismissible `.page-banner--warning` via the existing `findSectionHeading()`/`window.makeBannerDismissible()` helpers — with its own element ids (`org-risk-nudge-badge`/`-banner`) and its own `sessionStorage` key (`org_risk_nudge_dismissed`), so the two nudges stack rather than merge. Sourced strictly from `summary.restricted.mine.unmitigatedFlightRisks`; returns immediately when the restricted key is absent, the caller-scoped block is absent, or the count is not greater than zero — proven the client's own `> 0` guard (not a missing server field) is what suppresses it for a cleared owner-less caller.

## Task Commits

Each task was committed atomically:

1. **Task 1: The clearance-scoped org rollup with a structurally absent restricted tier** - `4f8672f` (feat)
2. **Task 2: The two-tier deal-home panel** - `8e6f7d6` (feat)
3. **Task 3: The flight-risk owner nudge** - `7995ee6` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `server.js` - `orgSummaryFor(db, deal, user)`, `GET /api/org/summary`, its `module.exports` entry
- `public/js/deal-home.js` - `renderOrgPanel()`, `renderFlightRiskNudge()`, the fifth fan-out fetch, the fourth `ORG_DECISION_TYPES`/`ORG_DECISION_LABELS` copy, updated header/entry-point comments
- `public/dashboard.html` - `.org-summary-open`/`.org-summary-restricted`/`.org-summary-row`/`.org-summary-delta` CSS, `deal-home.js` cache stamp bumped three times (v1784700001 → v1784700003)
- `test/org-summary.test.js` - 24 tests across all three tasks: the D-19/D-20/D-21 rollup behavior (10 HTTP tests + 1 grep guard), Task 2's 7 source-level UI checks, Task 3's 6 source-level nudge checks

## Decisions Made

See `key-decisions` in frontmatter — summarised: (1) decision-type counts are derived over the CURRENT-state roster only, a planner-discretion resolution of the plan's own unstated population scope; (2) the restricted tier's field naming is this plan's own choice, not dictated elsewhere; (3) two self-inflicted grep-tripping comment mentions were caught and reworded during authoring, before ever landing in a commit — the same issue class Plans 02/05/06 each hit as a Rule-1 deviation, caught here proactively instead.

## Deviations from Plan

None — plan executed exactly as written. (Two grep-tripping comment drafts were caught and reworded during authoring before any commit; see `key-decisions` — not a deviation from the plan's own instructions, since nothing landed broken.)

## Issues Encountered

- One `npm test` run in this session hit the pre-existing intermittent `test/synergy-phasing.test.js` flake (documented in Plan 05's own Summary and this plan's project notes as a known rare flake, unrelated to any file this plan touches). A re-run confirmed 544/544 green, consistent with the documented mitigation of re-running before treating it as breakage.

## Next Phase Readiness

- `GET /api/org/summary` and both deal-home surfaces are proven end-to-end (24 tests) and ready for Plan 08's i18n pass (the five decision labels need DE/ZH/CS translations under the `org.dec_*` keys, already wired via `data-i18n`) and its live walk (the panel, the tag-level absence proof in raw markup, and the stacked nudge banners are all deferred to that plan's browser confirmation, per this plan's own `<verification>` section).
- No blockers for Plan 08.

## Self-Check: PASSED

All created/modified files (`server.js`, `public/js/deal-home.js`, `public/dashboard.html`, `test/org-summary.test.js`) and all three task commits (`4f8672f`, `8e6f7d6`, `7995ee6`) verified present on disk / in git log. Full suite: 544/544 passing (one run hit the known pre-existing `synergy-phasing` flake, re-run confirmed green).

---
*Phase: 06-org-design-talent-retention*
*Completed: 2026-08-07*
