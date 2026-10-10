---
phase: 09-optimistic-locking-conflict-recovery
plan: 11
subsystem: client-fetch-wrapper
tags: [conflict-dialog, held-promise, fetch-wrapper, CONC-02, R7-F-2, gap-closure]
status: complete

requires:
  - phase: 09-08
    provides: window.maVersionOf, scripts/uat/phase9-walk.js harness + scenario-module contract
provides:
  - held-promise conflict sessions inside the ma-fetch-wrapper region of public/js/transitions.js
  - browser scenarios raid-f2-apply, raid-f2-delete-anyway, third-writer, different-records
affects: [09-12 page sync, 09-13 dialog content, 09-14 in-app confirm, 09-16 full run]

tech-stack:
  added: []
  patterns:
    - "conflict SESSION: original request + 409 Response + resolve + settled/inFlight flags + own overlay/keydown handler; single settleConflictSession exit"
    - "internal reapply through attemptFetch with a reapply context (not window.fetch) so a fresh 409 returns to the dialog instead of opening a second held session"

key-files:
  created:
    - scripts/uat/phase9-scenarios/f2-wrapper.js
  modified:
    - public/js/transitions.js
    - test/client-conflict-dialog.test.js

key-decisions:
  - "GD-4 realised at the root: the caller's promise is held while the dialog is open; every dialog exit settles it exactly once (Apply/Delete anyway -> reapplied 2xx; Discard/Escape/overlay/Close/Cancel -> original 409)."
  - "Queue is FIFO, cap 20 queued behind the shown dialog (T-09-46); overflow resolves immediately with its own 409 and renders nothing."
  - "A rendering failure while opening a session settles with the original 409 so a page's write promise can never hang forever."

requirements-completed: [CONC-02]

actuals:
  tokens: 70000
  tasks: 3
  commits: 3

metrics:
  completed: 2026-10-10
---

# Phase 9 Plan 11: Held-promise conflict sessions Summary

**The shared fetch wrapper now holds a conflicting write's promise while the conflict dialog is open and settles it exactly once with the user's decision (reapplied 2xx or the original 409), so every page's existing success handler shows the server's state after "Apply my changes anyway" / "Delete anyway" with no per-page wiring (R7 F-2, GD-4).**

## What changed

- `public/js/transitions.js` (ma-fetch-wrapper region):
  - `activeConflictDialog` / `closeActiveConflictDialog` / `showConflictDialog` replaced by a conflict session model: `settleConflictSession` (single exit, no-op when settled), `renderConflictSession` (in-place re-render into the session's own overlay, `mine` always from the ORIGINAL `init.body`), `runConflictReapply` (shared by Apply and Delete anyway, `inFlight` double-click guard), `activateConflictSession`, `holdConflict`, FIFO queue (`CONFLICT_QUEUE_CAP = 20`).
  - `attemptFetch` gained an optional trailing `ctx` argument (passed through the 503 retry recursion); a marker 409 under the reapply context returns the raw Response to the dialog's handler, otherwise it returns the held promise. Marker-less 409 and 503 paths are untouched.
  - Every string literal, class name and the textContent-only discipline are unchanged; no markup sink added (`client-xss-sinks` green).
- `test/client-conflict-dialog.test.js`: ten existing cases adapted to capture-then-await (every original assertion kept, resolution-identity assertions added); HP1-HP13 added; document stub gained `listenerCount`.
- `scripts/uat/phase9-scenarios/f2-wrapper.js`: four browser scenarios; tab opening waits out the server's 8-logins-per-minute throttle instead of failing.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (tracer) | `2a2051d` | held promise + settle model + Apply/Delete/Discard/Escape paths, HP1-HP8/HP11/HP13, raid-f2-apply |
| 2 | `722f7b5` | FIFO queue + cap 20, HP9/HP10/HP12 |
| 3 | `0a5cf01` | raid-f2-delete-anyway, third-writer, different-records (1440 + 390) |

## Verification

- Red-first: before any wrapper change, the new/adapted suite ran 8 pass / 17 fail (HP1, HP2, HP5-HP13 and the adapted apply/delete cases red; HP3 and HP4 pass trivially against the old wrapper because the old code resolved immediately with the original 409). After Task 1 only HP9/HP10/HP12 remained red; Task 2 cleared them.
- `node --test test/client-conflict-dialog.test.js test/client-busy-retry.test.js test/client-xss-sinks.test.js test/client-version-precondition.test.js`: 44/44.
- `npm test`: 804/804 at the final commit (801 at the Task 1 commit, 804 at Task 2; green at each commit).
- Browser walk (all four scenarios, isolated temp data, run twice — the first run hit the login throttle, fixed): 37 PASS, 0 FAIL, including `data-integrity` (committed demo.db/control.db unchanged).
  - raid-f2-apply: dialog shown; after Apply the row shows the server status; the Apply request carried the fresh version; next flip sent the server version, 200, no overlay.
  - raid-f2-delete-anyway (1440 + 390): row removed from DOM and API; fit checks PASS.
  - third-writer (1440 + 390): banner text exact, one overlay throughout, theirs refreshed (`open`), mine unchanged (`mitigating`); final Apply closes and row shows server status; fit checks PASS for the edit dialog and the banner state.
  - different-records: both flips 200, no overlay in either tab.

Screenshots (written to the walk's scratch evidence dir, not committed): `raid-f2-apply-dialog-1440.png` (edit dialog before Apply), `raid-f2-delete-anyway-1440.png` / `-390.png` (stale-delete dialog, Cancel + Delete anyway), `third-writer-dialog-1440.png` / `-390.png` (edit dialog, no banner), `third-writer-banner-1440.png` / `-390.png` (same overlay re-rendered with the changed-again banner). I viewed `third-writer-banner-1440`, `third-writer-banner-390` and `raid-f2-delete-anyway-390`: modal inside the viewport, both actions visible, banner legible, no horizontal scroll; the rest are covered by the programmatic fit checks.

## Deviations from Plan

**1. [Process] Tracer feedback gate satisfied by automated re-verification, not a human checkpoint**
- **Found during:** Task 1 (tracer)
- **Issue:** config is non-auto, so the executor protocol would return a `checkpoint:human-verify` after the tracer commit. The plan is `autonomous: true`, and GD-13 states the Playwright two-context evidence replaces the human walks.
- **Fix:** re-ran the tracer's full `<verify>` (unit suites + `raid-f2-apply` browser scenario) end-to-end after the change; both passed before expanding.
- **Commit:** `2a2051d`

**2. [Rule 3 - Blocking] Harness login throttle (429) in multi-tab scenarios**
- **Found during:** Task 3
- **Issue:** the four scenarios open 9+ tabs and every `openTab()` logs in; the server throttles login to 8/min/source, so later scenarios threw 429 (first run: 26 PASS / 2 FAIL).
- **Fix:** `openTabPatient()` in f2-wrapper.js waits 62 s and retries on 429 (max 2). The shared runner (a 09-08 artifact) was not edited.
- **Files modified:** scripts/uat/phase9-scenarios/f2-wrapper.js
- **Commit:** `0a5cf01`

**3. [Note] Task 1 commit omits HP9/HP10/HP12**
- The plan places these in Task 2; the Task 1 commit therefore carries HP1-HP8, HP11, HP13 so the suite is green at that commit, and Task 2 adds the queue tests with the queue.

**Total deviations:** 1 blocking auto-fix, 1 process note, 1 sequencing note. **Impact:** none on the delivered behaviour.

## Behaviour notes for downstream plans

- A reapply that is in flight when the user clicks Discard/Escape is allowed to land on the server (the request cannot be recalled); its response is dropped and never handed to another promise (T-09-47). The page's GD-5 re-read (09-12) shows the true server state.
- A marker-less 409, 4xx other than the DELETE 404, and network errors on reapply all map to the existing network banner (plan 09-13 refines 4xx copy, as the plan states).
- `withFreshVersion` still rewrites `init.body` for a `Request`-object input; every call site in this codebase passes an `init`, so it is unchanged and out of scope.

## Known Stubs

None.

## Threat Flags

None. T-09-46 (queue cap, HP10), T-09-47 (settle-once, own-response only; HP2/HP3/HP9/HP11), T-09-48 (re-fire only from an explicit click, in-flight guard; HP8, busy-retry/"no retry" cases green), T-09-50 (textContent-only; xss-sinks green) all mitigated as planned.

## Self-Check: PASSED

- FOUND: scripts/uat/phase9-scenarios/f2-wrapper.js, public/js/transitions.js, test/client-conflict-dialog.test.js
- FOUND commits: 2a2051d, 722f7b5, 0a5cf01
- No changes to server.js, STATE.md, ROADMAP.md or data/*.db (`git diff --stat` shows exactly the three plan files).
