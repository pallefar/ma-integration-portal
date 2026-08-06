---
phase: 05-synergy-value-capture
plan: 06
subsystem: ui
tags: [vanilla-js, synergy-tracker, stage-gates, baseline-history, authz, i18n]

# Dependency graph
requires:
  - phase: 05-synergy-value-capture (plan 03)
    provides: "POST /api/synergies/:id/stage (D-08 cumulative gate, D-09 reasoned demotion), POST /api/synergies/:id/rebaseline (D-15 admin+hrbp authz), pushBaseline()'s baselines[] entry shape (id/version/at/by/stage/runRateM/startMonth/curveShape/targetCurve/reason)"
  - phase: 05-synergy-value-capture (plan 05)
    provides: "enrichSynergy() fields the renderer reads (lastConfirmedAt/stale, consumed by a later plan) and confirms the base-upsert stage bypass this plan's pill/menu route around entirely"
provides:
  - "renderStageControl(): .syn-stage pill + .syn-stage-caret opening a 4-row .syn-stage-menu, replacing the retired click-to-cycle status button"
  - "requestStageChange()/openSynStageMenu()/closeSynStageMenu(): the one fetch this surface issues to POST /api/synergies/:id/stage, plus the document-level Escape/outside-click listener pair that never orphans across a wholesale renderSynergy() re-render"
  - "synAlertFailure(): the shared write-failure helper every write handler on this surface (this plan's and Plan 07's) routes its non-success branch through"
  - "renderBaselines(): the pinned deal-case (version 1, explicit lookup) + newest-first baseline history list, and the admin/hrbp-only .syn-rebaseline-btn"
affects: [05-07 rollup/cost-to-achieve UI (shares synAlertFailure and the .syn-detail sub-section pattern), 05-08 demo seed data (needs at least one initiative per stage + a 2nd baseline entry to exercise this UI), Phase 5 UAT/human checkpoint (live wizard walk deferred to Plan 08)]

# Actuals (#2632)
actuals:
  tokens: 7536   # chars/4 over git diff 0d516fe..237e3ab (public/js/execution.js + public/execution.html + test/synergy-stage.test.js)
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "One shared document-listener pair per open menu, torn down by a single closeSynStageMenu() choke point — every path that can trigger a wholesale renderSynergy() re-render (a successful stage change, a menu-item selection, an outside click) calls it first, so a rebuild can never leave a document.addEventListener orphaned (the concrete UI-SPEC requirement this task's own acceptance criteria named)"
    - "Absence over disabled for role-gated controls: the re-baseline button is omitted from the rendered markup string entirely for non-admin/non-hrbp roles (no disabled-attribute variant anywhere in the file) — mirrors DD-04's precedent that a route's own authz (isAdminOrIlRequest, Plan 03) is the real control and client-side hiding is cosmetic"
    - "Explicit version-1 lookup, never array-index assumption: renderBaselines() locates the deal case via baselines.find(b => b.version === 1) and concatenates it first, so a future baseline insertion order change can never silently unpin it"

key-files:
  created: []
  modified:
    - public/js/execution.js
    - public/execution.html
    - test/synergy-stage.test.js

key-decisions:
  - "Task 1 and Task 2 were built together in one editing pass (the baseline panel's markup call sits inside the same buildSynDetail() return the stage-control markup change touches) but were deliberately un-interleaved before committing: Task 1's commit temporarily omits the renderBaselines() call/function/CSS/tests, verified green on its own (326/326), then Task 2's content was restored and committed separately (333/333) — preserving true per-task atomicity rather than defaulting to a single combined commit"
  - "Reused .ex-status for the pill's base pill styling (padding/border-radius/color) via a second .syn-stage class, rather than inventing parallel CSS — matches the UI-SPEC file header's explicit instruction not to invent a parallel component system"
  - "The stage-menu's outside-click handler relies on the caret's own click handler calling ev.stopPropagation() so the newly-attached document listener never fires against the same click event that opened the menu — no setTimeout-deferred listener attachment needed"

patterns-established:
  - "requestStageChange(id, targetStage[, reason]) is the single fetch choke point for every stage-changing UI action (pill click, menu-ahead click, menu-behind click after the reason prompt) — a future control that also changes stage should call this rather than issuing its own fetch"

requirements-completed: [SYN-03]

coverage:
  - id: D1
    description: "Stage pill click advances exactly one stage forward; at captured (the last vocabulary entry) the click is a no-op — no fetch, no visual change, no wraparound back to idea"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (a), (b)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The caret opens a 4-row .syn-stage-menu (position:absolute inside a position:relative wrapper) listing all four stages with the current one checkmarked (not removed); selecting the current stage closes with no request; selecting ahead runs the same D-08 gate as the pill; selecting behind runs the D-09 reason prompt"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (c), (e)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A backward stage move's reason prompt aborts with no fetch when cancelled (null) or when the trimmed result is empty — an empty-reason request is never sent from the client"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (c)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The stage menu closes on outside click and on Escape via a document-level listener pair added on open and removed by the single closeSynStageMenu() cleanup path, so a wholesale re-render can never leave one orphaned"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (g)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every write handler added on this surface (stage change, re-baseline) routes its non-success branch through the shared synAlertFailure() helper, showing the server's stated reason verbatim — never a silent no-op"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (d), (j)"
        status: pass
    human_judgment: false
  - id: D6
    description: "renderBaselines() pins the version-1 entry (located explicitly, never assumed array index 0) first under the 'Deal case' label (never 'v1'), with every remaining entry newest-first beneath it, regardless of how many later baselines accumulate"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (h)"
        status: pass
    human_judgment: false
  - id: D7
    description: "An initiative with no baseline yet renders a single explanatory line, not an empty list container; each populated row shows a stage-coloured dot (not a full pill), and the reason truncates to one line with the full text in a title attribute"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (m), (n)"
        status: pass
    human_judgment: false
  - id: D8
    description: "The re-baseline button is absent from the rendered markup (never a disabled variant) for any role other than admin/hrbp, reading window.__portalUser.role; its click handler runs the same reason-prompt-and-abort-on-empty flow as a backward stage move"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (i), (j)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Every dynamic value reaching the baseline row markup (date, actor, run-rate, reason, stage-dot title) passes through the file's existing esc() helper before it reaches the innerHTML string"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-ui (l)"
        status: pass
    human_judgment: false
  - id: D10
    description: "Live visual/interaction confirmation of the pill, caret menu, keyboard/outside-click dismissal, and the re-baseline flow in a real browser"
    verification: []
    human_judgment: true
    rationale: "This plan's own <verification> block explicitly defers live visual confirmation to Plan 08's human checkpoint — no browser automation tool is available in this execution session, matching the identical deferral pattern in Plans 03/04/05's summaries."

duration: ~12.5min (Plan 05's completion commit 09:47:51 to this plan's final task commit 10:00:10)
completed: 2026-08-06
status: complete
---

# Phase 5 Plan 6: Gated Stage Control and Pinned Baseline History Summary

**SYN-03's client half: a forward-only stage pill + 4-row caret menu (no wraparound, D-09 reasoned demotion) replaces the click-to-cycle status button that had been silently 400ing since Plan 03, and a baseline history panel pins the deal case first with an admin/hrbp-only re-baseline control — every write on the surface now alerts the server's stated reason verbatim on rejection instead of failing silently.**

## Performance

- **Duration:** ~12.5 min (Plan 05's completion commit 09:47:51 → this plan's Task 2 commit 10:00:10)
- **Started:** 2026-08-06T09:47:51+02:00 (approx, following Plan 05's completion commit)
- **Completed:** 2026-08-06T10:00:10+02:00
- **Tasks:** 2
- **Files modified:** 3 (public/js/execution.js, public/execution.html, test/synergy-stage.test.js)

## Accomplishments
- `renderStageControl(item)` — `.syn-stage` pill (palette colour + i18n label) and `.syn-stage-caret` button, replacing the retired `.syn-status` click-to-cycle handler
- Pill click advances exactly one stage forward via `requestStageChange()`; at `captured` it is a structural no-op (no modulo index computation remains anywhere in the file — the wraparound that could silently demote an initiative is gone)
- `openSynStageMenu()`/`closeSynStageMenu()` — absolutely-positioned 4-row `.syn-stage-menu` (current stage checkmarked, not removed); forward selection runs the same D-08 gate as the pill; backward selection runs the D-09 reason prompt and aborts with no fetch on a cancelled or empty trimmed result; the menu closes on outside click and Escape via a document-listener pair that a single `closeSynStageMenu()` choke point always tears down, so a wholesale `renderSynergy()` rebuild can never leave one orphaned
- `synAlertFailure(res)` — the shared write-failure helper; every fetch this plan adds (stage change, re-baseline) routes its non-success branch through it, replacing the old handler's complete absence of an `else` branch
- `renderBaselines(item)` — locates the version-1 "Deal case" entry explicitly (never assumes array index 0), pins it first, renders every remaining entry newest-first beneath it; empty state renders an explanatory line instead of an empty list; each row shows a stage-coloured dot (not a full pill), the actor, run-rate, and a one-line-truncated reason with the full text in a `title` attribute
- `.syn-rebaseline-btn` — rendered only when `window.__portalUser` is `admin` or `hrbp` (absent from the markup for every other role, never a disabled variant); its click handler runs the identical reason-prompt-and-abort-on-empty flow as a backward stage move
- CSS: `.syn-stage-wrap`/`.syn-stage`/`.syn-stage-caret`/`.syn-stage-menu`/`.syn-stage-menu-item` and `.syn-baselines`/`.syn-baseline-row`/`.syn-baseline-dot`/`.syn-rebaseline-btn`, using only the UI-SPEC's declared spacing tokens and colours already present in the file
- `test/synergy-stage.test.js`: 14 new source-level assertions (`synergy-stage-ui` a–n) — no `node --test` execution of this file runs a browser, so these prove the wraparound removal, the empty-reason abort ordering, the universal failure-helper routing, the listener add/remove symmetry, the explicit version-1 lookup, the role-gated conditional (no disabled variant), and the escaping of every dynamic baseline value

## Task Commits

Each task was committed atomically:

1. **Task 1: Stage control — pill, caret menu, gated advance, reasoned demotion** — `70768c1` (feat)
2. **Task 2: Baseline history panel with the pinned deal case and the role-gated re-baseline control** — `237e3ab` (feat)

_Both files (`public/js/execution.js`, `public/execution.html`) are shared between the two tasks (the baseline panel's render call sits inside the same `buildSynDetail()` function the stage-control markup change touches). Rather than defaulting to a combined commit, Task 1's diff was built with Task 2's `renderBaselines()` call/function/CSS/tests temporarily withheld, verified green standalone (326/326), then committed; Task 2's content was then restored and committed on top (333/333) — true per-task atomicity, not the "couldn't split" precedent used elsewhere in this phase._

## Files Created/Modified
- `public/js/execution.js` — `synAlertFailure()`, `renderStageControl()`, `synStageMenuState`/`closeSynStageMenu()`/`requestStageChange()`/`openSynStageMenu()`, `formatBaselineDate()`, `renderBaselines()`; removed the old `.syn-status` modulo-cycle click handler; wired the new pill/caret/re-baseline handlers into the existing `#syn-list .syn-card` wiring loop
- `public/execution.html` — `.syn-stage-wrap`/`.syn-stage`/`.syn-stage-caret`/`.syn-stage-menu`/`.syn-stage-menu-item` and `.syn-baselines`/`.syn-baseline-row`/`.syn-baseline-label`/`.syn-baseline-date`/`.syn-baseline-dot`/`.syn-baseline-actor`/`.syn-baseline-runrate`/`.syn-baseline-reason`/`.syn-rebaseline-btn` CSS rules
- `test/synergy-stage.test.js` — 14 new tests (`synergy-stage-ui` a–n) across both tasks

## Decisions Made
- Reused `.ex-status` for the pill's base styling (padding, border-radius, `color:#fff`) via a second `.syn-stage` class rather than duplicating those declarations under a new class — the UI-SPEC file header explicitly instructs against inventing a parallel component system
- Outside-click dismissal relies on the caret's own `ev.stopPropagation()` rather than a `setTimeout`-deferred listener attachment — since the click event never bubbles to `document` for the very click that opened the menu, the newly-added `document` listener cannot fire against its own opening event
- Two extra i18n label keys (`syn.baselines_heading`, `syn.no_baseline`) were added beyond the two the UI-SPEC's Copywriting Contract table explicitly names (`syn.baseline_dealcase`, `syn.rebaseline_btn`) — mirroring the identical `syn.no_phasing`/`syn.no_phasing_body` empty-state key pair Plan 01 already established for the phasing grid, for consistency rather than leaving the new section heading and empty state as bare English text

## Deviations from Plan

None — plan executed exactly as written. The temporary withhold/restore commit-splitting technique described above is a process choice about *how* the already-planned diff was committed, not a change to what was built.

## Issues Encountered
None. Both tasks' source-level test assertions passed on the first write against the actual implementation.

## User Setup Required
None — no external service configuration required.

## Known Stubs
None — both controls are fully wired to their live server routes (`POST /api/synergies/:id/stage`, `POST /api/synergies/:id/rebaseline`) from Plan 03; nothing in this plan renders placeholder or hardcoded-empty data.

## Next Phase Readiness
- Plan 07 (cost-to-achieve, task progress, rollup restructure) can call `synAlertFailure()` directly rather than reintroducing a bare `window.alert()` pattern, and can follow this plan's `.syn-detail` sub-section ordering (phasing grid → baselines → cost-to-achieve, per UI-SPEC §2's stated order)
- Plan 08's demo seed data needs, per UI-SPEC's Demo Showcase Requirement: at least one initiative per stage (to exercise all four pill colours and the gate/no-wraparound behaviour), and at least one initiative with a 2nd baseline entry below "Deal case" (to prove the baseline-history UI is not decorative) — neither exists yet in the demo lane
- **Live visual/interaction confirmation is explicitly deferred to Plan 08's human checkpoint** (per this plan's own `<verification>` block) — no browser automation tool was available in this session; the wizard walk should specifically exercise: pill click at each of the 4 stages (confirming the no-op at `captured`), the caret menu's checkmark/outside-click/Escape behaviour, a rejected D-08 gate advance showing the server's reason verbatim, a backward move's reason prompt, and the re-baseline button's presence/absence across roles
- Suite: 333/333 green (was 319/319 entering this plan; +14 tests, all passing on both intermediate (Task 1 alone, 326/326) and final (333/333) states)

---
*Phase: 05-synergy-value-capture*
*Completed: 2026-08-06*

## Self-Check: PASSED

All modified files confirmed present on disk (`public/js/execution.js`, `public/execution.html`, `test/synergy-stage.test.js`); both task commits (`70768c1`, `237e3ab`) confirmed in `git log`.
