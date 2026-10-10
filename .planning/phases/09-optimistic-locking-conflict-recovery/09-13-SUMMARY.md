---
phase: 09-optimistic-locking-conflict-recovery
plan: 13
subsystem: client-conflict-dialog
tags: [conflict-dialog, field-map, labels, withheld-record, ui-spec-amendment, CONC-02, R7-F-3, R7-F-4, R7-F-5, R7-F-7, gap-closure]
status: complete

requires:
  - phase: 09-11
    provides: held-promise conflict sessions in the ma-fetch-wrapper region of public/js/transitions.js
  - phase: 09-08
    provides: scripts/uat/phase9-walk.js harness + scenario-module contract, window.maVersionOf
provides:
  - declarative per-route CONFLICT_FIELD_MAP (alias / cell / ignore) driving the diff rows
  - CONFLICT_FIELD_LABELS display-label table + deterministic humaniser fallback
  - neutral panel replacing the retired empty-diff sentence
  - withheld-record variant (currentRecord null), deleted variant without attribution
  - real 4xx reasons in the reapply banner
  - 09-UI-SPEC.md Amendments A1-A7 (dated) + Copywriting Contract rows
  - browser scenarios synergy-stage-f3, confirm-current-neutral-f3, phasing-month-f3, labels-f5, withheld-f4, reapply-4xx-f4, deleted-variant-f7, dialog-widths
affects: [09-14 in-app delete confirm (adds A8, reuses the shell), 09-15 ?v= stamp bump, 09-16 full walk]

tech-stack:
  added: []
  patterns:
    - "per-route table keyed by method + pathname regexp; entry = { aliases | cell | ignore }; unmatched route uses payload-keys-that-exist-on-the-record"
    - "attribution element joins the dialog head per variant, so a variant that cannot back it (deleted) or would repeat a sentence (neutral panel) simply omits it"
    - "label lookup by hasOwnProperty (payload keys are user JSON), humanised fallback, textContent only"

key-files:
  created:
    - scripts/uat/phase9-scenarios/f3-f7-dialog.js
  modified:
    - public/js/transitions.js
    - public/css/style.css
    - test/client-conflict-dialog.test.js
    - .planning/phases/09-optimistic-locking-conflict-recovery/09-UI-SPEC.md

key-decisions:
  - "GD-6: payload keys are the user's edited intent; a table says which key stands for which record field (targetStage -> stage), which is one cell of an array (phasing month), and which is an action parameter. No payload field maps -> the neutral panel, never a claim about what changed."
  - "GD-7: a version-conflict body with currentRecord === null (strict) is the withheld variant: attribution stays (T-09-17 accepted), values never, no Apply / Delete anyway, one Close. Checked before the delete/edit variants."
  - "GD-8: authored display labels, no CSS case transform; unknown keys humanised deterministically ('someNewField' -> 'Some new field', trailing 'Id' dropped, final 'M' -> '(M)')."
  - "GD-10: deleted variant titled 'Someone else deleted this' and renders no attribution element; UI-SPEC amended explicitly (A1-A7) rather than silently drifted; FA-2 resolved."

requirements-completed: [CONC-02]

actuals:
  tokens: 17700
  tasks: 3
  commits: 4

metrics:
  completed: 2026-10-10
---

# Phase 9 Plan 13: Truthful conflict dialog Summary

**The conflict dialog now compares the right things and says only what it can know: a per-route field map turns `targetStage` into a "Stage" row and a per-month phasing edit into a month-cell row, a payload that names no record field gets an honest neutral panel instead of a false claim, a record withheld by clearance gets a Close-only dead end, a refused reapply shows the server's own reason, and the signed UI-SPEC carries dated Amendments A1-A7 (R7 F-3/F-4/F-5/F-7, SC6 + the UI-SPEC half of SC9).**

## What changed

- `public/js/transitions.js` (ma-fetch-wrapper region, built on the 09-11 session model, not rewritten):
  - `CONFLICT_FIELD_MAP` + `findConflictFieldMapEntry` + `buildConflictRows`: entries for stage (`targetStage` -> `stage`, ignore `reason`), rebaseline (ignore `reason`), cost-entries (ignore `date`/`amountM`/`note`), per-month phasing (cell of `phasing[]` by the path's month capture; label suffixed ` · YYYY-MM`; a missing month row renders `(empty)`), and both convert routes (ignore `toTask`/`toRaid`). `mine` is always the ORIGINAL payload value, `theirs` is read only from the `currentRecord` the server already sent (T-09-53).
  - `CONFLICT_FIELD_LABELS` (35 authored labels) + `humaniseConflictKey`; lookup by `hasOwnProperty`.
  - Neutral panel: `CONFLICT_EMPTY_DIFF` deleted outright; the empty case shows `CONFLICT_ATTRIBUTION_FALLBACK` (one constant) and omits the attribution element when it would repeat that sentence (`renderConflictAttribution` now returns whether it rendered the real line).
  - Withheld variant (`conflictKind !== 'deleted' && currentRecord === null`, checked before delete/edit): edit title, attribution, `CONFLICT_WITHHELD_TEXT`, no rows, single `Close` settling with the original 409.
  - Deleted variant: title `Someone else deleted this`, no attribution element.
  - Reapply outcome mapping: marker 409 re-renders in place (unchanged); marker-less 409 and any other 4xx read the body's `error` via `res.clone().json()` through `conflictServerReason` (trim, one trailing period removed, cap 200, else `CONFLICT_ERROR_REASON_REFUSED`); DELETE 404 / 5xx / rejected fetch keep their existing reasons.
- `public/css/style.css`: `text-transform: capitalize` removed from `.conflict-diff-label`. The neutral panel reuses `.conflict-diff-empty` and needed no new rule.
- `09-UI-SPEC.md`: dated "Amendments (2026-10-10 — Phase 9 gap closure, plans 09-13/09-14)" section with A1-A7; Copywriting Contract gains rows for the neutral panel, deleted title/intro/Close, the withheld sentence, the 4xx reapply reason and the diff-label rule; the "Field-diff empty fallback" row is marked superseded by A3; the E1-empty and E4 UI-Consideration rows updated. The i18n decision text and the "Destructive confirmation" row are untouched (A8 belongs to 09-14).
- `test/client-conflict-dialog.test.js`: DT1-DT14 added (DT12b and a source-level DT-src too): 15 new cases.
- `scripts/uat/phase9-scenarios/f3-f7-dialog.js`: eight browser scenarios.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (tracer) | `44d3074` | field map + stage alias, DT1, synergy-stage-f3 |
| 2 | `36cee91` | neutral panel, month cells, label table + humaniser, CSS, DT2-DT7/DT14/DT-src |
| 3 | `09cd2ba` | withheld + deleted variants, 4xx reasons, UI-SPEC amendments, DT8-DT13/DT12b |
| 3 | `0785461` | seven remaining browser scenarios |

## Verification

- Red first at every step: DT1 failed `0 !== 1` before the map existed; before Task 2 DT2-DT6, DT14 and DT-src were red (DT7, equal values still rendered, passed trivially — the default path already renders every mapped field); before Task 3 DT8-DT13 and DT12b were red.
- `node --test test/client-conflict-dialog.test.js test/client-xss-sinks.test.js test/client-busy-retry.test.js`: 58/58 at the Task 3 code commit.
- `npm test`: 820/820, two consecutive green full runs at the final commit (three earlier full runs each hit one different unrelated failure — login-throttle / org-decisions / synergy-phasing / org-positions — each passing in isolation; the documented R5-02 foreign-listener flake while sibling worktrees run their own suites).
- Browser: the eight-scenario command from the plan run as one invocation against an isolated temp deal: **66 PASS, 0 FAIL**, including six fit checks (edit / withheld / deleted at 1440x900 and 390x844) and `data-integrity` (committed demo.db/control.db untouched). `git status` after the suites shows no `data/` changes.
- Screenshots viewed (scratch evidence dir, not committed): `synergy-stage-f3-1440` (one "Stage" row validated vs committed), `confirm-current-neutral-f3-1440` (neutral sentence once, attribution + Apply/Discard, orange only on Apply), `phasing-month-f3-1440` ("Target (M) · 2026-01" 9 vs 7), `withheld-f4-1440` (sentence + attribution + single Close, no values), `reapply-4xx-f4-1440` (Stage row + banner with the server's reason, dialog still one overlay), `dialog-widths-edit-1440`, `dialog-widths-edit-390` (two month rows, buttons wrap inside the card), `dialog-widths-withheld-390`, `dialog-widths-deleted-390` (Close-only, no attribution line). Not individually viewed but covered by the programmatic fit check and row/label assertions: `deleted-variant-f7-1440`, `labels-f5-realized-1440`, `labels-f5-duedate-1440`, `dialog-widths-withheld-1440`, `dialog-widths-deleted-1440`.

## Deviations from Plan

**1. [Process] Tracer feedback gate satisfied by automated re-verification, not a human checkpoint**
- **Found during:** Task 1 (tracer)
- **Issue:** the tracer protocol asks for a `checkpoint:human-verify` in a non-auto run; the plan is `autonomous: true` and GD-13 makes the Playwright two-context evidence the replacement for human walks (same call 09-11 made).
- **Fix:** re-ran the tracer's full `<verify>` (unit suites + `synergy-stage-f3`) before any expansion; both passed and the screenshot was viewed.
- **Commit:** `44d3074`

**2. [Rule 1 - Bug in my own scenario] Synthetic `change` event caused a second conflict**
- **Found during:** Task 3 (first browser run of `phasing-month-f3`)
- **Issue:** `dispatchEvent('change')` after `fill()` leaves the input dirty, so the blur caused by the next click fired a native second `change` -> second write -> second dialog; "dialog closes on Discard" failed (a harness artefact, not a product defect).
- **Fix:** commit the value with `press('Tab')` (one natural change event) in `phasing-month-f3` and `labels-f5`.
- **Files modified:** scripts/uat/phase9-scenarios/f3-f7-dialog.js
- **Commit:** `0785461`

**3. [Note] Scenario scope trimmed where a second browser tab added only a login**
- The plan sketches "A edits through the UI" for several scenarios. Where the other user's act is incidental (`confirm-current-neutral-f3`, `labels-f5`, `reapply-4xx-f4`) the seeder's API session makes that write instead of a second tab, which keeps within the 8-logins-per-minute harness throttle; the stage and phasing scenarios use two real tabs because the UI act is the subject. Server state and the 409 are real in all cases; only `withheld-f4`, `reapply-4xx-f4`'s second leg, `deleted-variant-f7` and `dialog-widths` intercept responses with `page.route`, as the plan prescribes.

**4. [Note] Task 3 split into two commits**
- Code + UI-SPEC were committed once the suite was green, the seven remaining scenarios afterwards, so the code commit is not held hostage to a ~5 minute browser run.

**Total deviations:** 1 own-scenario bug, 1 process note, 2 notes. **Impact:** none on the delivered behaviour.

## Behaviour notes for downstream plans

- `public/css/style.css` and `public/js/transitions.js` are served under existing `?v=` stamps; the stamp bump is plan 09-15's (GD-11), so a long-cached browser keeps the capitalised labels / old dialog until then.
- The page-level handlers that run after the held promise settles (`synAlertFailure`, DD `refresh`, ...) are plan 09-12's. On Discard / Close the original 409 body still flows to them; the scenarios here assert only the dialog and the server state.
- Phasing-grid month edits fire the per-month route; the map labels them from the payload key (`targetM` -> "Target (M)"), so a future route using the same bare key for a different meaning needs its own map entry.
- A withheld-record 409 on a DELETE gets the same Close-only variant (checked before the delete variant), so "Delete anyway" is never offered for a record the caller cannot see.

## Known Stubs

None.

## Threat Flags

None. T-09-50 (labels/values via textContent; client-xss-sinks green), T-09-51 (DT8/DT9 + `withheld-f4`: zero rows, zero Apply/Delete-anyway), T-09-52 (DT10/DT12b: textContent, trimmed, one period removed, capped 200; `<b>` shown as literal text), T-09-53 (rows built only from the `currentRecord` the server sent) mitigated as planned; T-09-17 accepted and unchanged.

## Self-Check: PASSED

- FOUND: scripts/uat/phase9-scenarios/f3-f7-dialog.js, public/js/transitions.js, public/css/style.css, test/client-conflict-dialog.test.js, .planning/phases/09-optimistic-locking-conflict-recovery/09-UI-SPEC.md
- FOUND commits: 44d3074, 36cee91, 09cd2ba, 0785461
- Acceptance greps: UI-SPEC contains "Amendments (2026-10-10" with A1-A7 and the four required literals; the retired sentence occurs nowhere in the wrapper source (DT-src).
- No changes to server.js, execution.js, org.js, due-diligence.js, STATE.md, ROADMAP.md or data/*.db.
