---
phase: 05-synergy-value-capture
plan: 07
subsystem: ui
tags: [vanilla-js, synergy-tracker, cost-to-achieve, task-linkage, staleness, rollup, deal-home]

# Dependency graph
requires:
  - phase: 05-synergy-value-capture (plan 04)
    provides: "costEntries[]/costPlannedM/costExpectedMonth (cost-entry sub-routes), taskIds[] linkage, costIncurredM/netBenefitM enrichment fields this plan's client renders"
  - phase: 05-synergy-value-capture (plan 05)
    provides: "POST /api/synergies/:id/confirm-current (no-field schema), the per-item stale boolean and lastConfirmedAt, and GET /api/synergies/rollup (grossRealizedM/costIncurredM/netBenefitM/dealTargetM/unconfirmedRealizedM/staleCount/mine.staleCount) this plan's client consumes verbatim"
  - phase: 05-synergy-value-capture (plan 06)
    provides: "synAlertFailure() shared write-failure helper, the .syn-detail sub-section ordering (phasing grid -> baselines -> cost-to-achieve), formatBaselineDate() reused for the stale badge's title"
provides:
  - "renderCostSection(item): the third .syn-detail sub-section — planned figure + expected month on one line, then .syn-cost-list (a plain dated list, never a grid) with the existing .ex-add mini-form to add and the confirm-then-delete idiom to remove"
  - "renderTaskProgress(item): a non-interactive 'N of M tasks done' indicator (no button, no listener, no cursor, no hover) inside the collapsed card body, resolved against the already-fetched task array"
  - "the stale badge (.syn-stale-badge) and the always-present confirm-current control (.syn-confirm-btn), both gated on/wired to the server's own verdict and dedicated route — never a client-side timestamp computation"
  - "renderSynRollup(): the four-tile rollup (gross realized, cost incurred, net benefit, deal target) with the destructive-coloured negative net benefit, the D-18 unconfirmed-split sentence (omitted at zero stale), and the retained percent-of-target bar"
  - "renderStaleSynergyNudge() in public/js/deal-home.js: a heading badge + dismissible warning banner for the caller's own stale synergy initiatives, authored following (never calling) the due-diligence page's owner-nudge pattern"
affects: [05-08 demo seed data + human checkpoint (live wizard walk exercises every surface this plan built), Phase 7 RPT-03 (client now demonstrates the full gross/cost/net/unconfirmed reporting contract)]

# Actuals (#2632)
actuals:
  tokens: 12063   # chars/4 over git diff e5254cf..d2cebd6 (execution.js + execution.html + deal-home.js + 3 test files)
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Server-verdict-only staleness on the client: the stale badge and the rollup's stale-derived figures are read exclusively from s.stale/rollup fields (Plan 05's enrichSynergy()/GET .../rollup) — the client never subtracts lastConfirmedAt from Date.now() and never replicates isSynergyStale(), so a wrong client clock can never disagree with the server's own verdict (T-05-36, asserted by a source-level grep for both patterns)"
    - "Confirm-current is its own button, its own route, its own empty-object payload: JSON.stringify({}) with the route literal '/confirm-current' appearing in exactly one fetch() call in the whole file — the structural half of D-16's 'not by editing a note' guarantee, verifiable by grep rather than by trusting review"
    - "Deal-home nudge authored, never extended: renderStaleSynergyNudge() replicates the due-diligence page's badge+banner+session-dismissal shape but contains zero references to renderOwnerNudge()/loadOwnerNudge()/due-diligence.js's import path, and uses entirely distinct storage key + element ids — proven by four independent source-level greps rather than a single import-absence check"
    - "Task-progress denominator excludes dangling links by construction: ids.map(...).filter(Boolean) drops any taskId that no longer resolves in state.tasks BEFORE either the numerator or denominator is computed, so a deleted linked task inflates neither figure — no separate 'still exists' branch needed"

key-files:
  created: []
  modified:
    - public/js/execution.js
    - public/execution.html
    - public/js/deal-home.js
    - test/synergy-cost.test.js
    - test/synergy-tasks.test.js
    - test/synergy-staleness.test.js

key-decisions:
  - "The stale-synergy nudge's heading badge attaches to the 'Diligence progress' panel's h2, located by an explicit text-content lookup (findSectionHeading()) rather than an assumed DOM position — deal-home.js has no top-level heading of its own and no panel is thematically 'synergy', so the plan's own instruction to 'pick a real element it produces rather than assuming one' was resolved by picking the panel closest in spirit to ongoing deal-execution tracking, verified against the file's actual rendered structure rather than guessed."
  - "The nudge badge is styled with an inline style.cssText, matching the due-diligence page's own established fallback for a JS-injected badge — this plan's files_modified scope is public/js/deal-home.js only (no CSS file), so a new CSS class would have required touching a file outside the plan's declared scope."
  - "The confirm-current button's success handler replaces state.synergies[idx] with the route's raw (unenriched) response item, matching the identical convention Plan 06 already established for the stage-change and re-baseline routes (05-05-SUMMARY.md: 'dedicated stamping routes ... return the raw item ... matching every other dedicated synergy sub-route's established convention'). This is intentional, not an oversight: the raw item carries no stale/costIncurredM/netBenefitM fields, so those fields go briefly undefined on that one card until the next full load() — for `stale` specifically this is exactly correct (confirming just made the item fresh, so the badge disappearing immediately is the desired behavior, not a bug)."
  - "The unconfirmed-split sentence and the cost-to-achieve planned line deliberately carry NO data-i18n attribute on their computed-content element, mirroring the pre-existing rollup's own established discipline (data-i18n lives on static LABELS only, e.g. syn.rollup_gross, never on a sibling holding an interpolated number) — applying a key to an element whose text already embeds computed figures would let a future i18n-hydration pass silently overwrite the numbers with static translated boilerplate the moment that key is populated."

patterns-established:
  - "Cost-entry delete resolves the entry id from the row's own data-cost-entry attribute via delBtn.parentNode (not event delegation, not closest()) — matches the file's existing convention of reading a data attribute off a directly-known DOM ancestor rather than introducing a new traversal idiom."

requirements-completed: [SYN-02, SYN-04, SYN-05]

coverage:
  - id: D1
    description: "Cost-to-achieve renders as a planned-figure line + a plain dated .syn-cost-list (never a grid); add uses the existing .ex-add mini-form pattern; delete uses the existing confirm-then-delete idiom; entries render in the server's own order with no client-side sort"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost-ui (a)-(f)"
        status: pass
    human_judgment: false
  - id: D2
    description: "UI-E4 partial/long-text/zero-one-many: a note-less entry renders date+amount only; a long note truncates with a title attribute holding the full escaped text; the list grows inline for any entry count"
    requirement: SYN-02
    verification:
      - kind: unit
        ref: "test/synergy-cost.test.js#synergy-cost-ui (d), (e)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Task linkage renders as plain text + a thin progress bar reusing .ex-ws-track/.ex-ws-fill, inside a non-interactive <div> with no click handler, no cursor, no hover state anywhere in markup or CSS — structurally cannot be mistaken for a value/stage control (D-23 prohibition)"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks-ui (a), (d)"
        status: pass
    human_judgment: false
  - id: D4
    description: "UI-E5 empty/zero-one-many: zero linked tasks renders the no-tasks-linked line, never '0 of 0'; the denominator excludes any linked id that no longer resolves to a task"
    requirement: SYN-04
    verification:
      - kind: unit
        ref: "test/synergy-tasks.test.js#synergy-tasks-ui (b), (c)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The stale badge renders only when the item's server-computed stale flag is true, carries the exact last-confirmed date in a title attribute, and the client performs no staleness computation of its own"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness-ui (d)"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-16: confirm-current is available on every card at all times, hits its own dedicated route with a payload carrying no content fields, and no title/notes handler references that route — a confirmation and a content edit can never be the same request"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness-ui (a), (b)"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-21/UI-E7: the rollup renders four tiles (gross realized, cost incurred, net benefit, deal target); net benefit applies the destructive colour when negative; the percent-of-target bar is retained on the pre-existing .syn-track/.syn-fill classes, now driven by target vs gross realized"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness-ui (e), (h)"
        status: pass
    human_judgment: false
  - id: D8
    description: "D-18/UI-E6 empty: the unconfirmed-split sentence is emitted only inside a conditional on a non-zero stale count, omitted entirely (not zeroed) when nothing is stale; the rollup fetch degrades to a neutral empty object on failure"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness-ui (c), (f)"
        status: pass
    human_judgment: false
  - id: D9
    description: "D-19: the deal-home nudge (badge + dismissible banner) reads the caller-scoped mine.staleCount, returns early at zero/absent, uses a dismissal key and element ids fully distinct from the due-diligence page's own nudge, and neither calls nor imports that page's nudge functions"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness-ui (j), (k), (l), (m)"
        status: pass
    human_judgment: false
  - id: D10
    description: "public/js/deal-home.js preserves its textContent-only discipline (no innerHTML assignment anywhere) after this plan's additions; the fourth rollup fetch added to renderDealHome() degrades the same way as the three pre-existing fetches"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness-ui (i), (n), (o)"
        status: pass
    human_judgment: false
  - id: D11
    description: "Live visual/interaction confirmation of the cost-to-achieve mini-form, the task-progress indicator's non-interactivity, the stale badge/confirm-current button, the four-tile rollup, and the deal-home nudge in a real browser"
    verification: []
    human_judgment: true
    rationale: "This plan's own <verification> block explicitly defers live visual confirmation to Plan 08's human checkpoint — no browser automation tool was available in this execution session, matching the identical deferral pattern in Plans 03/04/05/06's summaries."

duration: ~20min (Plan 06's completion commit e5254cf to this plan's Task 3 commit d2cebd6)
completed: 2026-08-06
status: complete
---

# Phase 5 Plan 7: Cost-to-Achieve, Task Progress, Staleness, and the Four-Tile Rollup Summary

**The client half of SYN-02/SYN-04/SYN-05 lands: a dated cost-entry list with the existing mini-form/delete idioms, a non-interactive task-progress indicator that can never read as a control, a stale badge and always-available confirm-current button both driven strictly by the server's own verdict, a four-tile rollup replacing the old two-figure headline with the D-18 unconfirmed-split sentence, and a deal-home nudge authored (never extended) from the due-diligence page's owner-nudge pattern.**

## Performance

- **Duration:** ~20 min (Plan 06's completion commit `e5254cf` -> this plan's Task 3 commit `d2cebd6`)
- **Tasks:** 3
- **Files modified:** 3 production files (`public/js/execution.js`, `public/execution.html`, `public/js/deal-home.js`); 3 test files extended with source-level assertions

## Accomplishments
- `renderCostSection(item)` — the third `.syn-detail` sub-section: a planned-figure + expected-month line, then `.syn-cost-list` (a plain list, never a grid) of dated `.syn-cost-row` entries with delete buttons, plus the `.ex-add`-pattern mini-form to add one; entries render in the server's own returned order (no client-side `.sort()`), note text passes through `esc()` with a truncation-and-title-attribute convention matching the baseline reason from Plan 06
- `renderTaskProgress(item)` — "N of M tasks done" plus a thin `.ex-ws-track`/`.ex-ws-fill` bar inside a plain `<div class="syn-task-progress">` with zero interactive markup or CSS anywhere (no button, no listener, no cursor, no hover) — the denominator is computed from `item.taskIds` resolved against the already-fetched `state.tasks` array, filtering out any linked id that no longer resolves to a task before either figure is computed
- `.syn-stale-badge` — rendered only inside a conditional on the item's own server-computed `stale` field, title attribute carrying the exact last-confirmed date, reusing the exact `.ex-src`/`.page-banner--warning` palette (no fifth colour)
- `.syn-confirm-btn` — present on every card at all times, POSTs an empty-object body to the dedicated `.../confirm-current` route (the literal route string appears in exactly one `fetch()` call in the whole file), and routes its non-success branch through `synAlertFailure()`
- `renderSynRollup()` — replaces the old two-figure rollup with four `.syn-rollup-tile` stats (gross realized, cost incurred, net benefit, deal target), net benefit rendered in the destructive colour (`#C0392B`) when negative, the D-18 unconfirmed-split sentence ("realized $XM, of which $YM unconfirmed") gated on a non-zero stale count and omitted (not zeroed) otherwise, and the pre-existing `.syn-track`/`.syn-fill` percent-of-target bar retained, now driven by deal target vs gross realized
- A fifth fetch in `load()`'s `Promise.all` against `GET /api/synergies/rollup`, degrading to `{}` on failure so the tab still renders
- `renderStaleSynergyNudge(wrap, rollup)` in `public/js/deal-home.js` — a heading badge (on the "Diligence progress" panel, located by text-content lookup) plus a dismissible `.page-banner--warning` naming the caller's own stale-initiative count, session-scoped dismissal via `window.makeBannerDismissible` guarded by a `typeof` check, authored following (never calling or importing) `public/js/due-diligence.js`'s `renderOwnerNudge()` pattern, with fully distinct storage key (`syn_nudge_dismissed`) and element ids (`syn-nudge-badge`/`syn-nudge-banner`)
- A fourth fetch against the rollup route added to `renderDealHome()`'s `Promise.all`, degrading to `null` on failure to match the three pre-existing fetches
- 25 new source-level assertions across `test/synergy-cost.test.js` (6), `test/synergy-tasks.test.js` (4), and `test/synergy-staleness.test.js` (15) — no browser automation runs in this session, so these are what proves the mini-form reuse, the confirm-before-delete ordering, the non-interactive task indicator, the server-verdict-only staleness, the confirm-current click/route/payload isolation, the omitted-at-zero unconfirmed sentence, the net-benefit colour rule, and the deal-home nudge's total independence from the due-diligence nudge, ahead of Plan 08's live walk

## Task Commits

Each task was committed atomically:

1. **Task 1: Cost-to-achieve section and the informational task-progress indicator** — `7436723` (feat)
2. **Task 2: Staleness badge, confirm-current control, and the restructured rollup** — `f6682f4` (feat)
3. **Task 3: Deal-home nudge for the caller's own stale synergy initiatives** — `d2cebd6` (feat)

## Files Created/Modified
- `public/js/execution.js` — `renderCostSection()`, `formatCostExpectedMonth()`, `renderTaskProgress()`, `renderSynRollup()`, the stale badge + `.syn-confirm-btn` markup and handler, the cost-entry add/delete handlers, the fifth rollup fetch in `load()`
- `public/execution.html` — `.syn-cost`/`.syn-cost-planned`/`.syn-cost-list`/`.syn-cost-row`/`.syn-cost-date`/`.syn-cost-amount`/`.syn-cost-note`, `.syn-task-progress` (no cursor, no hover), `.syn-stale-badge`, `.syn-confirm-btn`, `.syn-rollup-tiles`/`.syn-rollup-tile`/`.syn-rollup-label`/`.syn-rollup-value`/`.syn-rollup-stale-split`
- `public/js/deal-home.js` — `findSectionHeading()`, `renderStaleSynergyNudge()`, the fourth rollup fetch + its call wired into `renderDealHome()`
- `test/synergy-cost.test.js` — 6 new `synergy-cost-ui` source-level tests
- `test/synergy-tasks.test.js` — 4 new `synergy-tasks-ui` source-level tests
- `test/synergy-staleness.test.js` — 15 new `synergy-staleness-ui` source-level tests (8 for Task 2, 7 for Task 3)

## Decisions Made
- The nudge's heading badge attaches to the "Diligence progress" panel heading, located by an explicit text-content lookup rather than assumed DOM position, since deal-home.js has no top-level heading and no panel is thematically "synergy" — see Key Decisions in frontmatter for the full rationale
- The badge is styled via inline `style.cssText` (matching the due-diligence page's own established fallback), since this plan's declared file scope for Task 3 is `public/js/deal-home.js` only, with no CSS file to add a class to
- The confirm-current success handler replaces the local item with the route's raw (unenriched) response, deliberately matching the identical convention Plan 06 already established for stage-change/re-baseline — see Key Decisions in frontmatter for why this is correct rather than an oversight
- No `data-i18n` attribute on the unconfirmed-split sentence or the cost-to-achieve planned line's computed-content element, matching the pre-existing rollup's own discipline of keying only static labels — protects against a future i18n key silently overwriting interpolated numbers

## Deviations from Plan

None (Rules 1-4) — no bugs found, no missing critical functionality discovered, no blocking issues, no architectural changes needed. Plan executed as written; the three items above are documented implementation decisions made where the plan's own text explicitly deferred to "verify at implementation time," not deviations from stated instructions.

**Total deviations:** 0

## Issues Encountered
- An early draft of the cost-entry-note title-attribute source-level regex assumed the wrong quote placement around the `title` attribute's closing bracket; corrected against the actual emitted string (`'title="' + esc(e.note) + '">'`) rather than an assumed shape. Test-only fix; no production code affected.
- An early draft of the "no reference to the due-diligence nudge" source-level assertion flagged the file's own pre-existing header comment (which mentions `public/js/due-diligence.js`'s D-16 discipline for documentation purposes, predating this plan). Narrowed the assertion to check for an actual `require()`/`<script src>` import or a call to `renderOwnerNudge()`/`loadOwnerNudge()`, rather than any mention of the filename — the substantive guarantee (no import, no call) is unaffected. Test-only fix; no production code affected.
- An early draft of the "confirm-current referenced exactly once" assertion also matched a pre-existing Plan-06-era comment mentioning "Plan 07's confirm-current/cost-entry writes." Narrowed the assertion to the literal route-path string used inside a `fetch()` call (`'/confirm-current'`) rather than the bare word. Test-only fix; no production code affected.

## User Setup Required
None — no external service configuration required.

## Known Stubs
None — every control added in this plan is wired to its live server route from Plans 04/05 (`POST/DELETE .../cost-entries`, `POST .../confirm-current`, `GET .../rollup`); the task-progress indicator reads the already-fetched real task array with no mock/placeholder data path.

## Next Phase Readiness
- Plan 08's demo seed data (per the UI-SPEC's Demo Showcase Requirement) needs, in addition to the per-stage and 2nd-baseline coverage Plan 06 already flagged: at least one initiative with cost entries and a planned figure (to exercise the non-empty cost list), at least one initiative with linked tasks including a mix of done/not-done (to exercise the task-progress bar at a non-trivial percentage), and the one deliberately-stale initiative Plan 06 already flagged also now needs to exercise the stale badge, the confirm-current control, the rollup's unconfirmed-split sentence, and the deal-home nudge simultaneously
- **Live visual/interaction confirmation is explicitly deferred to Plan 08's human checkpoint** (per this plan's own `<verification>` block) — no browser automation tool was available in this session; the wizard walk should specifically exercise: adding and deleting a cost entry, confirming the task-progress bar has no hover/cursor affordance and is unclickable, clicking confirm-current on both a stale and a fresh card, verifying the rollup's four tiles and the unconfirmed sentence's presence/absence, and the deal-home nudge's badge/banner/dismissal behavior as a synergy-owning user
- Suite: 351/351 entering Task 3, 358/358 at plan completion (333/333 entering this plan overall; +25 tests across the plan, all passing)
- SYN-02, SYN-04 and SYN-05 are now fully client-complete; Phase 7's RPT-03 can point at the same `GET /api/synergies/rollup` contract this plan's UI already renders end-to-end

---
*Phase: 05-synergy-value-capture*
*Completed: 2026-08-06*

## Self-Check: PASSED

All modified files confirmed present on disk (`public/js/execution.js`, `public/execution.html`, `public/js/deal-home.js`, `test/synergy-cost.test.js`, `test/synergy-tasks.test.js`, `test/synergy-staleness.test.js`); all three task commits (`7436723`, `f6682f4`, `d2cebd6`) confirmed in `git log`. Full suite green: 358/358.
