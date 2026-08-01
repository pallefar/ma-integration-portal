---
phase: quick-260801-fj5
plan: 01
subsystem: ui
tags: [vanilla-js, transitions.js, feature-flag, cache-busting]

# Dependency graph
requires: []
provides:
  - "SPLASH_SCREEN_DISABLED module-scope flag in public/js/transitions.js, guarding triggerPostMergerSplashScreen() with an early return before any DOM/style creation"
  - "Bumped ?v= cache stamp on the shared transitions.js script tag across all 15 HTML pages that load it"
affects: [demo-showcase, frontend-transitions]

# Actuals (#2632)
actuals:
  tokens: 2505
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Named UPPER_SNAKE_CASE disable-flag + guarded early return at the top of a function body, used to hide a feature without deleting its implementation (reversible via single-line flip)"

key-files:
  created: []
  modified:
    - public/js/transitions.js
    - public/index.html
    - public/overview.html
    - public/pmo.html
    - public/dashboard.html
    - public/admin.html
    - public/employee.html
    - public/assessments.html
    - public/capability-hub.html
    - public/execution.html
    - public/insights.html
    - public/integration-excellence.html
    - public/leaders.html
    - public/playbook.html
    - public/supporting.html
    - public/survey.html

key-decisions:
  - "Guard placed as the very first statement inside triggerPostMergerSplashScreen(), above the existing path check, so neither the overlay nor the injected <style> element ever reaches the DOM regardless of page."
  - "SPLASH_SCREEN_DISABLED declared directly above the function's banner comment (module scope) with a WHY comment, not inline in the function, so it reads as a discoverable toggle."
  - "Cache stamp bumped uniformly across all 15 loaders (not just the 3 splash-capable pages) to match the repo's one-shared-stamp-per-asset convention and avoid future stamp-tracking errors."

patterns-established:
  - "Feature-hide-not-delete: module-scope BOOL_DISABLED constant + guarded early return as the first statement in the function, leaving 100% of the implementation intact and restorable via a single-line edit."

requirements-completed: [QUICK-FJ5]

coverage:
  - id: D1
    description: "Splash overlay no longer renders on /, /index.html, or /pmo.html; guard trips before any DOM/style creation"
    requirement: "QUICK-FJ5"
    verification:
      - kind: unit
        ref: "node --check public/js/transitions.js && node -e (guard-before-createElement source check, see Task 1 verify)"
        status: pass
    human_judgment: true
    rationale: "Actual splash suppression is a visual/runtime behavior in a browser; the source-level check proves the guard is correctly placed and unconditional, but no browser tool was available this session to confirm the overlay is visually absent post cache-stamp bump. Plan's own 'Optional developer confirmation' step is deferred to a human with a browser."
  - id: D2
    description: "Splash implementation (function body, styles, markup, skip button, call site) remains fully present and unmodified — restorable by flipping SPLASH_SCREEN_DISABLED to false"
    requirement: "QUICK-FJ5"
    verification:
      - kind: unit
        ref: "grep -c 'pmi-splash' public/js/transitions.js >= 30; git diff --numstat HEAD~2 HEAD -- public/js/transitions.js shows 7 insertions / 0 deletions"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full regression suite (86 node --test tests) stays green after the change"
    requirement: "QUICK-FJ5"
    verification:
      - kind: unit
        ref: "npm test — 86 pass, 0 fail"
        status: pass
    human_judgment: false
  - id: D4
    description: "All 15 HTML pages that load transitions.js reference the bumped cache stamp (1784600002); no other asset stamp touched"
    requirement: "QUICK-FJ5"
    verification:
      - kind: unit
        ref: "grep -l 'js/transitions.js?v=1784600002' public/*.html | wc -l == 15; style.css?v=1784600001 count unchanged at 16"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-08-01
status: complete
---

# Quick Task 260801-fj5: Hide Post-Merger Splash Screen Summary

**Added a `SPLASH_SCREEN_DISABLED` module-scope flag with a guarded early return at the top of `triggerPostMergerSplashScreen()` in transitions.js, plus a uniform cache-stamp bump across all 15 pages that load the script — the splash no longer renders anywhere, and every line of its implementation stays intact for a one-line restore.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-08-01T09:15:00Z
- **Completed:** 2026-08-01T09:16:25Z
- **Tasks:** 2
- **Files modified:** 16

## Accomplishments
- Splash function now returns immediately when `SPLASH_SCREEN_DISABLED` is `true` (default), before the existing path check and before any `document.createElement` call — no overlay markup and no injected `<style>` element ever reach the DOM.
- Every existing line of the splash implementation (300+ lines: markup, styles, skip button, timers, path check, call site near line 619) is untouched; restoring the splash is a single `true` → `false` edit.
- All 15 `public/*.html` files that load `/js/transitions.js` now reference it at `?v=1784600002`, so no browser holding the previous cached copy will keep executing the old (splash-showing) version.
- Full `node --test` regression suite stays green: 86/86 passing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add named disable flag + guarded early return to the splash function** - `1a0f3b5` (feat)
2. **Task 2: Bump the transitions.js cache stamp so browsers pick up the hidden state** - `f2a0484` (chore)

_Note: no TDD tasks in this plan._

## Files Created/Modified
- `public/js/transitions.js` - Added `const SPLASH_SCREEN_DISABLED = true;` (module scope, above the splash banner comment) and a guarded early return as the first statement in `triggerPostMergerSplashScreen()`. Purely additive: +7 lines, 0 deletions.
- `public/index.html`, `public/overview.html`, `public/pmo.html`, `public/dashboard.html`, `public/admin.html`, `public/employee.html`, `public/assessments.html`, `public/capability-hub.html`, `public/execution.html`, `public/insights.html`, `public/integration-excellence.html`, `public/leaders.html`, `public/playbook.html`, `public/supporting.html`, `public/survey.html` - Each: single-line bump of the `transitions.js` script tag's `?v=` cache stamp from `1784500010` to `1784600002`. No other line touched in any of these files.

## Decisions Made
- Guard is the first statement inside `triggerPostMergerSplashScreen()`, above the existing `isPmoPage` path check, so the function short-circuits identically on every page regardless of path — simpler and more obviously "off" than gating only the call site.
- Cache stamp bumped uniformly across all 15 loaders rather than only the 3 splash-capable pages (`/`, `/index.html`, `/pmo.html`), matching the repo's one-shared-stamp-per-asset convention (per plan's documented rationale, avoids future stamp-tracking errors from having two different stamps for the same file).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Splash is fully hidden and the fix is verified at the source/test level (parse check, guard-placement check, additive-diff check, 86/86 regression).
- Deferred: the plan's own "Optional developer confirmation" step (hard-refresh `/` and `/pmo.html` in a real browser to visually confirm no overlay/console errors) was not run — no browser automation tool was available this session. Low risk given the guard trips unconditionally before any DOM work, but a human should do a quick visual check when convenient.
- No blockers for other work; this task touched only `public/js/transitions.js` and the 15 declared HTML files, respecting the mid-flight Phase 3 boundary (`server.js`, `db/`, `validators/`, `lib/`, `test/`, `.planning/phases/` all untouched).

---
*Phase: quick-260801-fj5*
*Completed: 2026-08-01*

## Self-Check: PASSED

- FOUND: public/js/transitions.js
- FOUND: public/index.html
- FOUND: .planning/quick/260801-fj5-hide-post-merger-splash-screen-via-guard/260801-fj5-SUMMARY.md
- FOUND: 1a0f3b5 (Task 1 commit)
- FOUND: f2a0484 (Task 2 commit)
