---
phase: 09-optimistic-locking-conflict-recovery
plan: 03
subsystem: ui
tags: [vanilla-js, css, conflict-resolution, optimistic-locking, node-vm-testing]

# Dependency graph
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "09-01's showConflictDialog()/withFreshVersion()/relativeTime() scaffold in the ma-fetch-wrapper region of public/js/transitions.js, plus the initial .conflict-modal* CSS reusing the .deal-modal shell"
provides:
  - "Diff-list edge-state rendering: renamed .conflict-diff-empty / .conflict-diff-value-empty classes matching 09-UI-SPEC.md's own naming, non-string (array/object) JSON.stringify display, and the /* end conflict modal */ block sentinel for a no-clipping grep gate"
  - "In-place dialog re-render: showConflictDialog() now reuses the existing overlay/modal via the activeConflictDialog guard instead of closing and recreating it, so a second conflict never stacks a second overlay"
  - "Reapply-failure banner: .conflict-modal-error, driven by an optional errorReason argument threaded through showConflictDialog() and populated on a second 409 (detected centrally in attemptFetch), a network failure, or a 5xx"
  - "withFreshVersion() now returns { input, init } and detects a query-parameter version precondition (?expectedVersion=) on the request URL structurally, rewriting the URL instead of the body for that route shape — anticipates Plan 06's RAID DELETE route"
  - "test/client-conflict-dialog.test.js — a new node:vm sandbox harness (richer DOM stub than client-busy-retry.test.js's: class selectors, event listeners, textContent aggregation) proving 7 behavioral cases including the D-05/Pitfall-11 fetch-attempt-count gate and the Pitfall-1 marker-less-409 gate"
affects: [09-04, 09-05, 09-06, 09-07]

# Actuals (#2632)
actuals:
  tokens: 7570
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-place dialog re-render: showConflictDialog() checks activeConflictDialog first and rebuilds the SAME modal's children (modal.textContent = '' then full rebuild) rather than closing+recreating — the overlay element itself is never replaced across a re-render."
    - "Reapply-failure routing: every non-success outcome of the apply click's fetch (second 409, network reject, 5xx) funnels through showConflictDialog(..., reason) — the second-409 case is detected centrally in attemptFetch (activeConflictDialog already truthy means this fetch WAS a reapply), not by a flag threaded from the click handler."
    - "Structural (not verb-based) query-parameter detection: withFreshVersion() inspects the request URL for ?expectedVersion= via URLSearchParams rather than switching on HTTP method, so it works for any future route shape."

key-files:
  created:
    - test/client-conflict-dialog.test.js
  modified:
    - public/js/transitions.js
    - public/css/style.css

key-decisions:
  - "Renamed 09-01's .conflict-diff-empty-state -> .conflict-diff-empty and .conflict-diff-empty-value -> .conflict-diff-value-empty to match this plan's (and 09-UI-SPEC.md's) own class naming exactly — 09-01 had used adjacent-but-different names."
  - "Most of Task 1's overflow/long-text/one-vs-many CSS behavior (bounded .conflict-diff-list height with internal scroll, per-value 160px scroll boxes with white-space:pre-wrap/word-break:break-word, fixed dialog width) was already present from 09-01's scaffold — verified against this task's acceptance criteria rather than rebuilt from scratch."
  - "showConflictDialog() was restructured to accept an optional errorReason and to reuse the existing overlay/modal (via the activeConflictDialog guard) instead of always creating a fresh one — required for T-09-14/T-09-16's 'never stack a second overlay' invariant to hold by construction rather than by coincidence of close-then-recreate timing."
  - "withFreshVersion()'s return shape changed from a bare init object to { input, init } to support the query-parameter route case, which needs to rewrite the URL (input) rather than the body (init) — the only call site (the apply click handler) was updated in the same commit."

patterns-established:
  - "Diff-value stringification: typeof val === 'object' routes through JSON.stringify(val) before textContent assignment, so arrays/nested objects render their real JSON form instead of \"[object Object]\" — still textContent-only, never markup."

requirements-completed: [CONC-02]

# Coverage metadata — Task 3 (the human-verify checkpoint) is NOT yet run;
# its deliverable is intentionally left human_judgment: true / unresolved.
coverage:
  - id: D1
    description: "Diff-list edge states: empty-diff fallback with apply still enabled, italic (empty) placeholder for null/empty values, JSON-stringified display for non-string values, bounded/scrollable list with pinned header/footer on 8+ fields, content-driven height at 1 field, full-length scrollable long-text boxes with no ellipsis, and a wrapping (never truncated) long attribution name."
    requirement: "CONC-02"
    verification:
      - kind: unit
        ref: "node --test test/client-xss-sinks.test.js (10/10, no markup-sink regression)"
        status: pass
      - kind: other
        ref: "grep-based acceptance criteria: 0 innerHTML/insertAdjacentHTML/outerHTML in the wrapper region; 2 conflict-diff-empty*/value-empty CSS rules; 0 text-overflow inside the sentinel-delimited conflict-modal CSS block"
        status: pass
    human_judgment: true
    rationale: "The plan's own Task 3 checkpoint calls for a human two-window browser walk of the rendered diff list at 1440/1024/375px, including the 3000-char long-value scroll box and the 8+-field overflow scroll — not exercisable from this autonomous worktree run. Structural (grep) and unit checks give high confidence the logic is correct; the visual/interactive rendering itself is unverified pending Task 3."
  - id: D2
    description: "Action states, reapply-failure banner, and the wrapper's 409-never-auto-retried / marker-less-409-passthrough / second-conflict-in-place-rerender behavior."
    requirement: "CONC-02"
    verification:
      - kind: unit
        ref: "node --test test/client-conflict-dialog.test.js (7/7 new behavioral cases)"
        status: pass
      - kind: unit
        ref: "node --test test/client-busy-retry.test.js (7/7, unmodified — 503 path undisturbed)"
        status: pass
      - kind: integration
        ref: "npm test (full suite, 721/721)"
        status: pass
    human_judgment: true
    rationale: "The plan's Task 3 checkpoint additionally calls for a live two-window browser click-through of the in-flight button label, the discard-preserves-form path, and the visible inline error banner on a real second conflict — the sandboxed node:vm proof covers the control-flow logic but not the actual rendered UX. Pending Task 3."

# Metrics
duration: ~19min (Task 1 + Task 2 only; Task 3 not run)
completed: 2026-08-11
status: halted
---

# Phase 9 Plan 3: Conflict Dialog Edge States & Wrapper Behavior Proof Summary (CHECKPOINT-PAUSED)

**Completed the diff-list edge states (empty/partial/overflow/long-text) and in-place reapply-failure recovery on 09-01's conflict dialog, with a new node:vm sandbox harness proving the wrapper's 409 never auto-retries and never opens on an unrelated 409 — paused at Task 3's human-verify visual walk, not yet approved.**

## Status: CHECKPOINT REACHED — awaiting human visual/interaction walk (Task 3)

This plan is `autonomous: false` and carries a `type="checkpoint:human-verify" gate="blocking"` Task 3. Tasks 1 and 2 are fully implemented, verified by automated tests, and committed. Task 3 (the eight-step two-window browser walk specified in the plan) has **not** been run or approved — per the executor's operating rules, this checkpoint is never self-approved. See "CHECKPOINT REACHED" details below.

## Performance

- **Duration:** ~19 min (Tasks 1–2 only)
- **Tasks:** 2 of 3 complete (Task 3 pending human verification)
- **Files modified:** 3 (2 modified, 1 new test file)

## Accomplishments

- Diff-list edge states completed against 09-UI-SPEC.md's E1/E4 resolved considerations: empty-diff fallback, italic-placeholder partial values, non-string (array/object) JSON stringification, bounded/scrollable overflow with pinned header/footer, content-driven one-row height, full-length scrollable long-text boxes, and a wrapping long attribution name — most of the CSS mechanics were already present from 09-01's scaffold; this plan verified and completed the remainder (class renames to match UI-SPEC naming, non-string stringification, the `/* end conflict modal */` sentinel).
- In-flight action state (E2-loading) confirmed unchanged from 09-01 — apply disables only itself and swaps its label; discard stays clickable.
- Reapply-failure recovery (E2-error) newly implemented: an inline `.conflict-modal-error` banner, and `showConflictDialog()` restructured to reuse the same overlay/modal element on any re-render (second conflict, network failure, or 5xx) instead of closing and recreating it — proven never to stack a second overlay.
- `withFreshVersion()` extended to detect and rewrite a query-parameter (`?expectedVersion=`) version precondition on the URL, structurally rather than by HTTP method, ahead of Plan 06's RAID DELETE route.
- New `test/client-conflict-dialog.test.js`: 7 behavioral cases (fetch-attempt-count gate on D-05/Pitfall 11, marker-less-409 passthrough on Pitfall 1, apply's version-only body diff, query-param URL rewrite, discard's no-further-fetch, second-conflict in-place re-render, and the 503 path's non-interference) — all green.
- Full suite: 721/721 (up from 714/714 baseline after 09-01), zero regressions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Diff-list edge states — empty, partial, overflow, one-vs-many, long text** - `aaed7a0` (feat)
2. **Task 2: Action states, the reapply failure path, and the wrapper behavior harness** - `30d5b33` (feat)
3. **Task 3: Visual and interaction walk of the conflict dialog** - NOT RUN (checkpoint:human-verify, gate="blocking")

## Files Created/Modified

- `public/js/transitions.js` - `setConflictDiffValue()` non-string stringification + renamed empty-value class; `showConflictDialog()` restructured for overlay/modal reuse and the errorReason-driven inline banner; `withFreshVersion()` returns `{ input, init }` and detects the query-parameter version-precondition shape; `attemptFetch()`'s 409 branch detects an already-open dialog to pass the second-conflict error reason; new `CONFLICT_ERROR_*` constants and `conflictErrorMessage()` helper.
- `public/css/style.css` - `.conflict-diff-empty` / `.conflict-diff-value-empty` (renamed from 09-01), new `.conflict-modal-error` rule, `/* end conflict modal */` block sentinel.
- `test/client-conflict-dialog.test.js` - new node:vm sandbox harness (richer DOM stub than `test/client-busy-retry.test.js`'s) — 7 behavioral test cases.

## Decisions Made

- **Class renames (Rule 1, consistency fix):** 09-01 used `.conflict-diff-empty-state` and `.conflict-diff-empty-value`; this plan's own text and 09-UI-SPEC.md's Copywriting Contract name them `.conflict-diff-empty` and `.conflict-diff-value-empty`. Renamed both (JS `classList.add`/`className` call sites and CSS rules) to match the plan's literal, grep-checked acceptance criteria exactly.
- **Overlay/modal reuse via `activeConflictDialog` (structural change, required by the plan text):** `showConflictDialog()` previously always called `closeActiveConflictDialog()` then built a fresh overlay. Per the plan's explicit instruction ("route the re-render through the existing `activeConflictDialog` guard so the same overlay element is reused"), the function now checks `activeConflictDialog` first, and on reuse clears and rebuilds the existing modal's children in place. This makes the "never stack a second overlay" property hold by construction, not by the coincidence of remove-then-add ordering.
- **Central second-conflict detection (not threaded from the click handler):** rather than passing a "this is a reapply" flag down through the fetch call, `attemptFetch()`'s 409 branch checks whether `activeConflictDialog` is already truthy at the moment a new 409 arrives — if so, this fetch necessarily came from the open dialog's own apply button, so the error banner and in-place re-render apply automatically. Kept the click handler simpler and the logic in one place.
- **`withFreshVersion()` return-shape change:** switched from returning a bare `init` object to `{ input, init }` so a query-parameter route's URL can be rewritten alongside (or instead of) the body. The only call site (inside `showConflictDialog()`'s apply handler) was updated in the same commit — no other code called this function.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/consistency] Renamed 09-01's diff-empty CSS/JS class names to match this plan's and the UI-SPEC's literal naming**
- **Found during:** Task 1 (reading the plan's acceptance criteria against 09-01's existing code)
- **Issue:** 09-01 shipped `.conflict-diff-empty-state` (for the zero-conflicting-fields fallback) and `.conflict-diff-empty-value` (for a null/empty field value) — adjacent-but-different names from this plan's own text (`.conflict-diff-empty`, `.conflict-diff-value-empty`) and from 09-UI-SPEC.md's Copywriting Contract, which the plan's grep-based acceptance criteria check for verbatim.
- **Fix:** Renamed both the CSS rule selectors and the JS `className`/`classList.add()` call sites to the plan's literal names.
- **Files modified:** `public/js/transitions.js`, `public/css/style.css`
- **Verification:** `grep -c 'conflict-diff-empty\|conflict-diff-value-empty' public/css/style.css` returns 2 (the plan's own acceptance criterion); full suite green.
- **Committed in:** `aaed7a0` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, naming consistency to match the plan's own literal acceptance criteria). No scope creep — this is a rename, not new functionality.

## Issues Encountered

None. Most of Task 1's harder CSS mechanics (bounded/scrollable overflow, per-value long-text scroll boxes, content-driven single-row height, fixed dialog width) were already correctly implemented in 09-01's scaffold — verification against the acceptance criteria found them already satisfied, narrowing this plan's actual new work to the class renames, non-string stringification, the overlay-reuse restructure, and the reapply-error-banner/query-param additions.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## CHECKPOINT REACHED

**Type:** human-verify
**Gate:** blocking
**Plan:** 09-03
**Progress:** 2/3 tasks complete

### Completed Tasks

| Task | Name        | Commit | Files                        |
| ---- | ----------- | ------ | ----------------------------- |
| 1    | Diff-list edge states — empty, partial, overflow, one-vs-many, long text | `aaed7a0` | `public/js/transitions.js`, `public/css/style.css` |
| 2    | Action states, the reapply failure path, and the wrapper behavior harness | `30d5b33` | `public/js/transitions.js`, `public/css/style.css`, `test/client-conflict-dialog.test.js` |

### Current Task

**Task 3:** Visual and interaction walk of the conflict dialog
**Status:** blocked — awaiting human verification
**Blocked by:** `type="checkpoint:human-verify" gate="blocking"` — the executor never self-approves this gate, per its operating rules; auto-mode is also not active for this run (`workflow.auto_advance: false`, `_auto_chain_active: false` in `.planning/config.json`), so this would have stopped here even under automation.

### Checkpoint Details

**What was built:** The shared conflict-compare dialog, complete against every resolved consideration in `09-UI-SPEC.md`'s probe assigned to this plan: the field-diff list at zero, one, four and many rows; empty, short and very long values; the attribution line with and without actor/time; the in-flight action state; and the inline error banner with an in-place re-render on a second conflict.

**How to verify** (from the plan's Task 3, verbatim):

Start the server (`node server.js`) and open `http://localhost:3000/execution.html` in two browser windows, signed in as two different users if auth is enabled.

1. **Populated diff.** In both windows open the same RAID entry. Change two or three fields in each. Save window A, then save window B. Window B shows the dialog. Check: the title and attribution line read correctly, the changed fields appear as two-column rows, the left ("mine") boxes carry the orange left accent, the right ("theirs") boxes are the light neutral, and the orange appears nowhere else except the apply button.
2. **Form preserved.** Close the dialog with the discard action. Confirm window B's form still holds every character you typed — nothing cleared, no navigation, no reload.
3. **Reapply.** Repeat the conflict and click the apply action. Confirm the button label changes to the in-flight label and disables while the other action stays clickable, and that the save then succeeds and the dialog closes.
4. **Second conflict.** Repeat, but before clicking apply in window B, make and save another change in window A. Click apply in window B. Confirm the inline error banner appears INSIDE the same dialog, the right column refreshes to the new server values, your left column is unchanged, and there is exactly one dialog on screen (not two stacked).
5. **Long text.** Put a very long paragraph into a RAID entry's notes field in both windows and force a conflict. Confirm the full text is visible and scrollable inside its box, with no trailing shortening marker.
6. **Many fields.** Change eight or more fields and force a conflict. Confirm the list scrolls internally while the header and buttons stay pinned, and the dialog fits the window.
7. **Widths.** Repeat step 1 at 1440px, 1024px and 375px viewport widths. Confirm the dialog stays readable and inside the viewport at each.
8. **Attribution fallback.** Force a conflict on a record that has never been written by a logged-in actor (a demo-seeded record edited by a script). Confirm the header shows the fallback sentence rather than a blank line or a line containing a missing-value word.

### Awaiting

A human must run the eight-step browser walk above and either reply "approved" or describe what looks wrong. This plan's worktree is otherwise complete and ready to merge once Task 3 passes.

## Next Phase Readiness

- Tasks 1 and 2's mechanism is fully implemented and automatically verified (721/721 suite, all plan-specified grep/unit gates green). No further coding work is anticipated for this plan regardless of Task 3's outcome — Task 3 is a verification-only gate, not an implementation task.
- Plans 04/05/06/07 (the remaining wave-2/wave-3 plans wiring the rest of the ~9 versioned routes, RAID DELETE, and the coverage gate) do not depend on Task 3's approval to proceed with their own implementation work, since Task 3 verifies UX correctness of an already-complete component rather than gating new API surface. They should still be aware this plan's dialog behavior is implementation-complete but UAT-pending.
- **If Task 3's walk finds an issue:** re-open this plan, fix in a new commit, and re-request the walk. Do not mark this plan `complete` in STATE.md/ROADMAP.md until Task 3 is approved.

## Self-Check: PASSED

- FOUND: public/js/transitions.js
- FOUND: public/css/style.css
- FOUND: test/client-conflict-dialog.test.js
- FOUND: .planning/phases/09-optimistic-locking-conflict-recovery/09-03-SUMMARY.md
- FOUND commit: aaed7a0 (Task 1)
- FOUND commit: 30d5b33 (Task 2)

---
*Phase: 09-optimistic-locking-conflict-recovery*
*Completed: 2026-08-11 (Tasks 1-2 only; Task 3 pending)*
