---
phase: 02-mandatory-auth-roles
plan: 03
subsystem: auth
tags: [vanilla-js, fetch-wrapper, client-redirect, demo-mode, shell-launchers]

# Dependency graph
requires:
  - phase: 02-mandatory-auth-roles (Plan 01)
    provides: "fail-closed /api gate contract: 401 { authRequired: true } on missing/expired session + isOpenMode(req)/DEMO_OPEN semantics"
provides:
  - "Client-side redirect to /login.html on any authRequired:true 401, including gated GET reads"
  - "DEMO_OPEN=1 set by both demo release launchers, keeping the showcase open under the new fail-closed default"
affects: [phase-03-clean-room-and-demo-real-split]

actuals:
  tokens: 1000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Single composed window.fetch wrapper per concern-file convention: authRequired-redirect checked first inside the existing admin-token IIFE, falling through to the write-only token prompt, rather than stacking a second monkey-patch on window.fetch"

key-files:
  created: []
  modified:
    - public/js/transitions.js
    - start.bat
    - start.command

key-decisions:
  - "Merged the new authRequired-redirect logic into the existing admin-token fetch wrapper's single window.fetch assignment (rather than the PATTERNS.md-suggested standalone second IIFE) to satisfy the plan's own acceptance criterion that window.fetch not be reassigned via two independent stacked patches"
  - "authRequired check runs on res.clone().json() and takes priority; falls through to the existing write-only token prompt (same behavior as before) when the 401 body is not an authRequired session-gate response, preserving the admin-token flow byte-for-byte for that case"

requirements-completed: [AUTH-01]

coverage:
  - id: D1
    description: "A 401 with authRequired:true on ANY /api call (GET reads included) deterministically redirects the browser to /login.html instead of rendering blank/broken widgets"
    requirement: "AUTH-01"
    verification:
      - kind: other
        ref: "node --check public/js/transitions.js (syntax); grep -c authRequired/login.html/'window.fetch =' public/js/transitions.js (structural wiring, single coherent wrapper)"
        status: pass
    human_judgment: true
    rationale: "No browser test harness exists in this zero-dep repo (per 02-VALIDATION.md Manual-Only table); the actual redirect behavior in a live session-expiry scenario requires manual UAT, exercised during /gsd-verify-work."
  - id: D2
    description: "Demo release launchers (start.bat, start.command) set DEMO_OPEN=1 before starting the server, keeping the showcase open under fail-closed default; real-deal deployments never run these launchers"
    requirement: "AUTH-01"
    verification:
      - kind: other
        ref: "grep -c DEMO_OPEN=1 start.bat start.command; grep -c server.js start.bat start.command (run path unchanged)"
        status: pass
    human_judgment: true
    rationale: "Confirming the demo bundle actually boots without a login prompt requires launching the app (manual UAT per 02-VALIDATION.md), not just static grep verification."

duration: 6min
completed: 2026-07-31
status: complete
---

# Phase 2 Plan 3: Client Read-401 Redirect + Demo-Open Launchers Summary

**A 401 `authRequired:true` on any `/api` call (GET reads included) now redirects the browser to `/login.html` via a single composed `window.fetch` wrapper, and both demo release launchers export `DEMO_OPEN=1` so the showcase stays open under the new fail-closed default.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-31T20:38:00Z (approx.)
- **Completed:** 2026-07-31T20:39:06Z
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments
- Fail-closed session gate is now usable at the client: an expired or missing session on any read (not just writes) sends the browser to `/login.html` deterministically, closing the RESEARCH Pitfall 3 gap (the old `/api/auth/me` page-load probe raced other GETs and could leave a blank/broken page).
- The new redirect logic is composed into the single existing `window.fetch` wrapper in `public/js/transitions.js` — no second monkey-patch stacked on `window.fetch` — preserving the existing write-only admin-token prompt flow unchanged for non-session 401s.
- `start.bat` / `start.command` now set `DEMO_OPEN=1` before invoking `node server.js`, one-line insertions each, so the turnkey demo bundles keep working exactly as before under the new mandatory-auth default; real-deal deployments (which never run these launchers) stay fail-closed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Client read-401 redirect-to-login in transitions.js** - `27cf729` (feat)
2. **Task 2: Set DEMO_OPEN=1 in the demo launchers** - `3f27ad6` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `public/js/transitions.js` - Composed authRequired-redirect handling into the existing admin-token `window.fetch` wrapper; redirects to `/login.html` on any 401 with `authRequired:true`, no-op on the login page itself, falls through to the write-only token prompt for non-session 401s.
- `start.bat` - Added `set "DEMO_OPEN=1"` before the `node server.js` invocation.
- `start.command` - Added `export DEMO_OPEN=1` before the `exec ... server.js` invocation.

## Decisions Made
- Deviated from 02-PATTERNS.md's suggested standalone second IIFE for the redirect handler, in favor of merging the logic directly into the existing admin-token wrapper's single `window.fetch` assignment. The plan's own Task 1 acceptance criteria required verifying the wrapper is "not duplicated into two independent stacked patches," and the PATTERNS.md snippet itself flagged this as a planner/executor decision point ("the planner should decide ordering/merge rather than stacking two independent monkey-patches"). Ordering inside the single wrapper: authRequired-redirect is checked first (via `res.clone().json()`), falling through to the existing write-only token prompt only when the 401 body is not an authRequired session-gate response — matching the plan's specified priority.

## Deviations from Plan

None - plan executed exactly as written (the composition-into-one-wrapper choice was an explicitly flagged decision point in 02-PATTERNS.md, not a deviation from the plan's task instructions, which themselves required the single-wrapper outcome).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 2 (mandatory-auth-roles) is now complete: Plan 01 (fail-closed auth spine), Plan 02 (coarse ROLE_WRITE_POLICY + break-glass + employee seed + password-change + first-run secret), and Plan 03 (client read-401 redirect + demo-open launchers) are all committed.
- Full `node --test` suite: 25/25 passing after this plan's changes (no server/test files touched by this plan; regression-only run).
- Manual UAT still outstanding (per 02-VALIDATION.md's Manual-Only table, deferred to `/gsd-verify-work`): (1) confirm a live session-expiry redirect on a portal page under fail-closed mode, (2) confirm the demo bundle boots without a login prompt via its launcher.
- No blockers for Phase 3 (clean-room/demo-real split), which will further bind `isOpenMode` to the resolved database per D-03.

---
*Phase: 02-mandatory-auth-roles*
*Completed: 2026-07-31*

## Self-Check: PASSED
- FOUND: public/js/transitions.js
- FOUND: start.bat
- FOUND: start.command
- FOUND: 27cf729 (Task 1 commit)
- FOUND: 3f27ad6 (Task 2 commit)
