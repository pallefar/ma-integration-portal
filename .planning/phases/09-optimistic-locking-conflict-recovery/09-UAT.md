---
status: complete
phase: 09-optimistic-locking-conflict-recovery
source: [09-VERIFICATION.md, .planning/reviews/v3.0/R7-phase9-uat.md]
started: 2026-08-11T09:05:00Z
updated: 2026-10-10T13:30:00Z
verification: automated — real two-context Playwright walks on an isolated real-deal-mode instance (plus a --demo-open lane), judged by Fable against 09-CONTEXT.md D-01..D-09, 09-UI-SPEC.md (literal Copywriting Contract + Amendments A1–A11), REQUIREMENTS.md CONC-02 (per standing directive 2026-08-08). R7 evidence in R7-phase9-uat.md; gap-closure evidence in walk-evidence/ (committed run) and re-run independently by the verifier 2026-10-10 (350 PASS / 0 FAIL real-deal; 18 PASS / 0 FAIL demo-open; suite 875/875 twice).
---

## Current Test

[testing complete — all 7 R7 gaps closed and re-verified; see 09-VERIFICATION.md (status: passed)]

## Tests

### 1. Two-tab conflict walk — Execution Hub (integration tasks + synergy initiatives)
expected: Tab B shows the conflict dialog with a correct field diff on the same-record case; no dialog on the different-record case.
result: pass
reported: "R7 2026-10-10 found F-1/F-2/F-3 (core path PASS). Gap closure verified 2026-10-10: F-1 — never-edited record's first co-edit now 409s (client sends version 0 via window.maVersionOf; Playwright `task-f1-never-edited` 6/6, `synergy-stage-never-edited` 5/5; test precondition P2). F-2 — page reflects the reapplied state, no self-conflict (`one-tab-no-self-conflict` 5/5, `synergy-realized-f2` 8/8; transitions.js held promise settles with the 2xx). F-3 — stage conflict shows a Stage row via the per-route field map, neutral panel for `{}` payloads, per-month cells compare cell-to-cell (`synergy-stage-f3` 9/9, `confirm-current-neutral-f3` 8/8, `phasing-month-f3` 6/6; test DT4). Different records: `different-records` 2/2."

### 2. Two-tab conflict walk — Due Diligence (findings + request items)
expected: The second save shows the conflict dialog. A caller cleared for the item's area sees the area-filtered current record and a field diff; a caller whose clearance no longer covers the item sees who changed it and when (attribution is deliberately disclosed — T-09-17 / 09-REVIEW IN-01) but no field value, and the dialog states the change cannot be applied.
expectation corrected 2026-10-10 (gap closure 09-15) — R7 item 2
result: pass
reported: "R7 found F-4. Gap closure verified 2026-10-10: `currentRecord:null` renders the withheld variant ('This record is no longer within your clearance; your change cannot be applied.', attribution kept, no diff rows, no Apply, one Close — UI-SPEC A2; test DT8/DT9; Playwright `withheld-f4` 9/9, screenshot `dialog-widths-withheld-390.png`); a reapply 4xx shows the server's own error, never 'a network error' (A6; `reapply-4xx-f4` 6/6). DD refresh never runs under an open dialog (`dd-f2` 16/16). Leak-safety unchanged: CR-01 (a–d, c2) pass; DD routes run ddAreaRefused() before conflictIfStale()."

### 3. Two-tab conflict walk — Org design (position edit)
expected: The second save shows the conflict dialog.
result: pass
reported: "Contract-level PASS stands (stale POST /api/org/positions from the real page → dialog with Title/Level diff → reapply persisted, R7 item 3). The missing position-edit UI is a pre-existing product gap, now recorded as WINDOWS.md #3 (routed Phase 18 IL-18) per SC9; org delete/convert surfaces walked in Playwright `org-delete-anyway-f2` 9/9 and `delete-confirm-surfaces`."

### 4. Two-tab destructive-delete walk — execution.html (RAID/task/synergy) + org.html (position)
expected: Edit a record in tab A and save, then delete that same record in tab B → tab B shows the destructive-variant dialog (no diff list, delete/cancel actions; the dialog IS the confirmation) and the record still exists until confirm. Deleting an untouched record works in one click with no dialog.
result: pass
reported: "R7 found F-6 (native confirm stacked) and F-2c (row stays after Delete anyway). Gap closure verified 2026-10-10: every delete path opens the in-app confirm `window.maConfirmDelete` (execution.js:260,1053,1096,1190; org.js:598; no window.confirm left on any delete path; UI-SPEC A8) which becomes the stale-delete variant on 409 — Playwright `delete-confirm-surfaces` 79/79 ('native dialogs: 0', 'two DELETEs (409 then 2xx)'), `delete-confirm-raid` 19/19, `confirm-widths` 16/16; rows are gone from DOM and API after Delete anyway (`raid-f2-delete-anyway` 12/12, `org-delete-anyway-f2`). Screenshots `delete-confirm-state-390.png`, `delete-stale-state-390.png` match the contract (Cancel + red Delete / Delete anyway, no orange)."

### 5. FA-1 review — hand-derived CONC-02 truth list
expected: Confirm the hand-derived must_haves decomposition of CONC-02 (stale-write / reapply / per-record granularity / version-less legacy rows / update-vs-delete) is accurate and complete.
result: pass
reported: "Amended in 09-15: 09-01-PLAN.md now carries the per-record-granularity truth (:42, proven by cross-process different-records), the client-precondition truth for version-less records (:50, proven by precondition P1–P3 and client-version-precondition C1) and the WHERE-layer 409-clearance truth (:68, proven by CR-01 a–d). Verified present and each test green 2026-10-10."

### 6. FA-2 review — deleted-record dialog copy extends the signed UI-SPEC
expected: Confirm the three fresh EN literals (CONFLICT_TITLE_DELETED / CONFLICT_DELETED_INTRO / CONFLICT_CLOSE_LABEL) are acceptable, or route them through a UI-SPEC amendment.
result: pass
reported: "Accepted with UI-SPEC Amendment A1 (title 'Someone else deleted this', intro kept, single Close, NO attribution line — closes F-7); literals stay hardcoded EN via textContent. Verified in transitions.js:159-161,753; test DT13/HP13; Playwright `deleted-variant-f7` 6/6; screenshot `dialog-widths-deleted-390.png`."

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "The first concurrent edit of a record that was never edited before is rejected with a 409 (CONC-02; D-02 'no exemptions'; D-09 'legacy records gain protection the moment two people co-edit one')"
  status: resolved
  resolved_by: "Plans 09-08/09-09/09-10/09-12 (GD-1, GD-1a, GD-1b, GD-2): window.maVersionOf at 29 client sites; server.js:507-512 refuses a precondition-less update/delete of an existing record with 400 {error, versionRequired:true} unless req.isDemo === true. Tests: optimistic-locking-precondition P1–P7/U1–U3; contract (3)/(43); client-version-precondition C1. Playwright: task-f1-never-edited, synergy-stage-never-edited, raid-f1, raid-delete-f1, api-version-required. Re-verified 2026-10-10."
  severity: blocker
  test: 1

- truth: "After 'Apply my changes anyway' or 'Delete anyway' succeeds the page shows the server's resulting state (D-03 'form state is never lost' end to end)"
  status: resolved
  resolved_by: "Plans 09-11/09-12 (GD-4, GD-5) + WR-03 fix 522eb1b: the wrapper holds the original promise and settles it with the reapply's response (transitions.js:533,611); every exit locked while a request is in flight; page re-reads after Discard; DD refresh only after its own dialog closes. Tests: client-conflict-dialog HP3/HP4/HP9/HP11, WR03a-c. Playwright: one-tab-no-self-conflict, raid-f2-apply, raid-f2-delete-anyway, org-delete-anyway-f2, synergy-realized-f2, dd-f2, task-discard-keeps-theirs. Re-verified 2026-10-10."
  severity: major
  test: 1

- truth: "The conflict dialog shows a CORRECT field diff for every conflicting write, and never claims 'no conflicting fields' when it cannot tell"
  status: resolved
  resolved_by: "Plan 09-13 (GD-6, GD-8; UI-SPEC A3/A4/A5): CONFLICT_FIELD_MAP (aliases, per-month cells, ignored action params) + CONFLICT_FIELD_LABELS with humanised fallback; the 'No conflicting fields…' sentence is retired, the neutral panel 'This record changed since you loaded it.' replaces it. Tests: DT4, DT6. Playwright: synergy-stage-f3, confirm-current-neutral-f3, phasing-month-f3, labels-f5. Re-verified 2026-10-10."
  severity: major
  test: 1

- truth: "A caller whose clearance no longer covers the record is told so truthfully and sees the server's real reason on reapply"
  status: resolved
  resolved_by: "Plan 09-13 (GD-7; UI-SPEC A2/A6): withheld variant (transitions.js:667,696) with one Close; conflictServerReason() surfaces the 4xx body's error (200-char cap). Tests: DT8, DT9, CF6. Playwright: withheld-f4, reapply-4xx-f4. Re-verified 2026-10-10."
  severity: major
  test: 2

- truth: "A stale delete is confirmed by the destructive dialog alone, with no stacked native prompt (09-UI-SPEC 'Destructive confirmation')"
  status: resolved
  resolved_by: "Plan 09-14 (GD-9; UI-SPEC A8): window.maConfirmDelete(question, url) at every delete surface (execution.js:260,1053,1096,1190; org.js:598); the in-app confirm becomes the stale-delete variant on 409; no window.confirm remains on a delete path. Playwright: delete-confirm-raid, delete-confirm-surfaces (79/79, native dialogs 0), confirm-widths. Re-verified 2026-10-10."
  severity: minor
  test: 4

- truth: "The deleted-record variant is internally consistent"
  status: resolved
  resolved_by: "Plan 09-13 (GD-10; UI-SPEC A1/A7): title 'Someone else deleted this', no attribution element in the deleted variant (transitions.js:753). Tests: DT13, HP13. Playwright: deleted-variant-f7. Re-verified 2026-10-10."
  severity: cosmetic
  test: 6

- truth: "Phase documentation is accurate"
  status: resolved
  resolved_by: "Plan 09-15 (GD-12): 09-01-PLAN.md truths :42/:50/:68 added with tests; 09-UI-SPEC Copywriting Contract rows + Amendments A1–A11; UAT item-2 expectation corrected; WINDOWS.md #3 records the org position-edit gap (Phase 18 IL-18). Re-verified 2026-10-10."
  severity: minor
  test: 5
