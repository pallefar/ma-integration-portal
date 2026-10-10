---
phase: 09-optimistic-locking-conflict-recovery
plan: 12
subsystem: client-pages
tags: [version-precondition, maVersionOf, conflict-recovery, page-sync, CONC-02, R7-F-1, R7-F-2, gap-closure]
status: complete

requires:
  - phase: 09-08
    provides: window.maVersionOf, strict server precondition rule, scripts/uat/phase9-walk.js harness
  - phase: 09-11
    provides: held-promise conflict sessions (page handlers settle only after the dialog closes)
provides:
  - maVersionOf at all 19 write call sites (13 execution.js, 2 org.js, 4 due-diligence.js)
  - reloadAfterConflict(res) page re-read path (execution.js) and equivalent org.js conflict re-reads
  - C3/C4 structural drift guards in test/client-version-precondition.test.js
  - browser scenarios in scripts/uat/phase9-scenarios/f1f2-pages.js
affects: [09-13 dialog content, 09-14 in-app confirm on delete sites, 09-16 full walk]

tech-stack:
  added: []
  patterns:
    - "every page write sends window.maVersionOf(heldRecord) unconditionally; a never-edited record sends 0"
    - "non-success branch of every execution.js write handler calls reloadAfterConflict(res); it returns true exactly when res.conflict === true so callers skip their own alert (WR-01)"

key-files:
  created:
    - scripts/uat/phase9-scenarios/f1f2-pages.js
  modified:
    - public/js/execution.js
    - public/js/org.js
    - public/js/due-diligence.js
    - test/client-version-precondition.test.js

key-decisions:
  - "GD-5 realised as one choke point in execution.js (reloadAfterConflict -> load() -> render/renderSynergy/renderRaid) rather than per-handler fetches."
  - "org.js flight-risk conflict branch falls through to the SAME refetch + renderFlightRiskRegister() the success path uses; position delete conflict branch calls the same reloadPositionsForViewState() + three renders as success."
  - "due-diligence.js needed no new re-read code: its unconditional .then(refresh) is already the re-read path and is safe because the held promise (09-11) only settles after the dialog closes."

requirements-completed: [CONC-02]

actuals:
  tokens: 13500
  tasks: 3
  commits: 3

metrics:
  completed: 2026-10-10
---

# Phase 9 Plan 12: Client sweep and page re-read Summary

**Every edit/delete call site in execution.js, org.js and due-diligence.js now sends `window.maVersionOf(record)` (0 for a never-edited record), and every page re-reads the server state after a conflict dialog that did not apply the user's change; R7's exact never-edited-task repro now produces the dialog.**

## What changed

- `public/js/execution.js`
  - New `reloadAfterConflict(res)`: when `res.conflict === true` it calls `load()` then `render()`, `renderSynergy()`, `renderRaid()`, `applyI18n()` and returns true. `synAlertFailure` delegates to it (WR-01 preserved: never an alert for a conflict).
  - 13 call sites send `maVersionOf` unconditionally: task flip, task delete, synergy stage, confirm-current, generate-phasing, header realized value, per-month phasing cell, rebaseline, cost-entry add, cost-entry delete, synergy delete, RAID flip, RAID delete. DELETE URLs always carry `?expectedVersion=`.
  - Task flip, task delete, synergy delete, RAID flip and RAID delete gained a non-success branch calling `reloadAfterConflict`; the three inline alerts (generate-phasing, header realized, per-month phasing) became "alert only when `reloadAfterConflict(res)` returned false".
- `public/js/org.js`: position delete always sends `?expectedVersion=` from `maVersionOf(node.position)`; its conflict branch now re-reads (`reloadPositionsForViewState()` + renderTree/renderUnassigned/renderAddForm). Flight-risk convert sites pass `maVersionOf(entry)`, `payload.version` is unconditional, and the conflict branch refetches `/api/org/flight-risk` and re-renders like success. The inline error is still suppressed for a conflict (WR-02).
- `public/js/due-diligence.js`: `updateItem`, `updateVdrLink`, `updateFinding`, `convertFinding` set `version = window.maVersionOf(record)` unconditionally; the "first-edit-exempt" comment is rewritten to state omission is now refused by the server.
- `test/client-version-precondition.test.js`: C3a (task flip handler), C3 (no conditional-version idiom in the three files + call-site counts >=13/>=2/>=4), C4 (no unclassified writer in any other public/js file; allow-list of exactly the four create/read-only pairs, and stale allow-list entries fail too).
- `scripts/uat/phase9-scenarios/f1f2-pages.js`: seven browser scenarios.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (tracer) | `3c09bb7` | never-edited task flip sends version 0, `reloadAfterConflict`, C3a, task-f1-never-edited + task-discard-keeps-theirs |
| 2 | `f6744e3` | sweep of the remaining call sites + org/DD re-read paths, C3 + C4 |
| 3 | `b8a6e67` | synergy-stage-never-edited, synergy-realized-f2, dd-f2, org-delete-anyway-f2, one-tab-no-self-conflict |

## Verification

- Red first: C3a failed on the unchanged flip handler ("the task flip must send window.maVersionOf(task)") before the change; C3 failed ("conditional version idiom") before the sweep; C4 passed immediately (nothing outside the three pages writes today) and is a pure drift guard.
- `node --test test/client-version-precondition.test.js test/client-conflict-dialog.test.js test/client-xss-sinks.test.js`: 40/40.
- `npm test`: 807/807 at the final commit and at each task commit (each task's gate run is recorded below under Deviations: known flake).
- Browser walk (isolated temp copies, committed demo.db/control.db hashed before/after) of task-f1-never-edited, task-discard-keeps-theirs, synergy-stage-never-edited, synergy-realized-f2, dd-f2, org-delete-anyway-f2, one-tab-no-self-conflict: **53 PASS, 0 FAIL**, including `data-integrity`.
  - task-f1-never-edited: A flips twice (`version` 0 then 1, 200/200); B flips once and sends `version: 0`, gets 409 `conflict:true` and exactly one overlay; the API still holds A's status at version 2.
  - task-discard-keeps-theirs: after Discard the overlay closes and B's row shows A's label ("Blocked", was "To do"); B's next flip sends the server's version (2) and returns 200 with no overlay.
  - synergy-stage-never-edited: B's `/stage` request carries `version: 0`, 409, one overlay, no native alert.
  - synergy-realized-f2: dialog rows mine `2.5` / theirs `1.5`; after Apply B's header shows `$2.5M`, the input shows `2.5` and the API holds 2.5 (B made exactly one conflicting write and one reapply).
  - dd-f2 (1440 and 390): no GET to `/api/dd/request-items` was issued while the dialog was open, B's select kept showing `received`, fit checks PASS at both widths; after Apply the select and the API both hold `received`.
  - org-delete-anyway-f2: `DELETE ...?expectedVersion=1`, stale-delete dialog, no inline org error, after Delete anyway the `article[data-position-id]` node is gone from the DOM and the API.
  - one-tab-no-self-conflict: from one tab, a never-edited synergy `/confirm-current` twice (versions 0 then 1) and a never-edited DD item status twice (versions 0 then 1) all return 200 with no overlay.

Screenshots (written to the walk's scratch evidence dir, not committed; viewed by me):
- `task-f1-never-edited-1440.png` - B's dialog for the never-edited task: status row mine `doing` / theirs `blocked`.
- `synergy-stage-never-edited-1440.png` - B's dialog on the synergy stage change (see Observations).
- `synergy-realized-f2-1440.png` - after Apply: B's card header shows `$2.5M` with input 2.5.
- `dd-f2-dialog-1440.png` and `dd-f2-dialog-390.png` - DD dialog, Status row received / requested, both actions visible and inside the viewport.
- `org-delete-anyway-f2-1440.png` - stale-delete dialog "Someone else updated this - still delete it?" with Cancel and Delete anyway.

## Deviations from Plan

**1. [Process] Tracer feedback gate satisfied by automated re-verification, not a human checkpoint**
- **Found during:** Task 1 (tracer)
- **Issue:** config is non-auto, so the tracer protocol would stop for a `checkpoint:human-verify`. The plan is `autonomous: true` and GD-13 states the Playwright two-context evidence replaces the human walks (same call 09-11 made).
- **Fix:** re-ran the tracer's full `<verify>` (C-suite + both browser scenarios) end-to-end after the commit and before expanding; both passed.
- **Commit:** `3c09bb7`

**2. [Rule 1 - Bug] confirm-current body shape must stay "starts empty, only `version` assigned"**
- **Found during:** Task 2 full suite (`synergy-staleness-ui (a)`)
- **Issue:** my first rewrite built `var confirmBody = { version: ... }`, which breaks that source-level suite's D-16 guarantee (body starts as `{}`, the only assigned property is `version`).
- **Fix:** kept `var confirmBody = {};` then `confirmBody.version = window.maVersionOf(existingItem);` - same behaviour, unconditional, suite green. The suite's comment still says "conditionally"; the test file is outside this plan's files_modified so it was not touched.
- **Commit:** `f6744e3`

**3. [Rule 1 - Bug] Scenario driver produced a double `change` event**
- **Found during:** Task 3 (synergy-realized-f2)
- **Issue:** `fill()` plus a synthetic `dispatchEvent('change')` combined with the browser's own commit-on-removal change fired two writes (A: v1 then v2; B: two queued 409s), a harness artifact not a product defect.
- **Fix:** the scenario now presses a real `Tab` so the browser fires one native change, and asserts B made exactly one conflicting write then one reapply.
- **Commit:** `b8a6e67`

**4. [Note] Known full-suite flake (R5-02)**
- Across the runs for this plan, single non-reproducing failures appeared in `synergy-stage-gate (h)`, `deal-wizard (z)` and `dd-workspace (h)`; each passed when its file was re-run alone and the next full run was green (807/807). No file touched by this plan is involved; sibling worktrees run suites concurrently on the same host.

**5. [Scope note] `due-diligence.js` conflict branch**
- The plan's `<action>` for DD says "No other behaviour changes". Added no re-read code there: `.then(refresh)` already re-reads and, with 09-11's held promise, runs only after the dialog closes (verified by the "no re-fetch while the dialog is open" row).

**Total deviations:** 3 auto-fixes, 1 process note, 1 flake note, 1 scope note. **Impact:** none on delivered behaviour.

## Observations for downstream plans

- **09-13 (dialog content):** for a synergy stage change the request body field is `targetStage` while the record field is `stage`, so the dialog shows "No conflicting fields - the record's version changed without affecting anything you edited" (screenshot `synergy-stage-never-edited-1440.png`). The 409 itself and the single overlay are correct; the dialog could map `targetStage` to `stage` for a useful diff.
- **09-14:** the delete sites still use native `window.confirm`; each now sends `?expectedVersion=` unconditionally and has a conflict re-read, so replacing the confirm needs no further change to the precondition.
- The generate-phasing, per-month phasing, rebaseline, cost-entry add/delete, confirm-current and flight-risk-convert sites are covered by C3/C4 structure and by the shared wrapper; only the stage, header-realized and confirm-current sub-routes have browser rows here (as the plan scopes).

## Known Stubs

None.

## Threat Flags

None. T-09-36 (call site omitting the precondition) mitigated by C3 and C4; T-09-49 (stale page after Discard) mitigated by `reloadAfterConflict` / org re-reads and proven by `task-discard-keeps-theirs`; T-09-38 (re-read after a withheld record) relies on the normal clearance-filtered GET routes, no new endpoint or field was added; T-09-17 accepted, no body field added.

## Self-Check: PASSED

- FOUND: scripts/uat/phase9-scenarios/f1f2-pages.js, public/js/execution.js, public/js/org.js, public/js/due-diligence.js, test/client-version-precondition.test.js
- FOUND commits: 3c09bb7, f6744e3, b8a6e67
- `git diff --stat` against the base shows exactly the five plan files; no changes to server.js, transitions.js, STATE.md, ROADMAP.md or data/*.db.
