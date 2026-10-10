---
status: diagnosed
phase: 09-optimistic-locking-conflict-recovery
source: [09-VERIFICATION.md, .planning/reviews/v3.0/R7-phase9-uat.md]
started: 2026-08-11T09:05:00Z
updated: 2026-10-10T09:45:00Z
verification: automated — real two-context Playwright walks on an isolated real-deal-mode instance, judged by Fable against 09-CONTEXT.md D-01..D-09, 09-UI-SPEC.md (literal Copywriting Contract), REQUIREMENTS.md CONC-02 (per standing directive 2026-08-08; evidence in R7-phase9-uat.md)
---

## Current Test

[testing complete — diagnosed; gap closure planned via `/gsd-plan-phase 9 --gaps`]

## Tests

### 1. Two-tab conflict walk — Execution Hub (integration tasks + synergy initiatives)
expected: Tab B shows the conflict dialog with a correct field diff on the same-record case; no dialog on the different-record case.
result: issue
reported: "Core path PASS (same record → correct dialog + diff, reapply persists, different records don't fight, second conflict re-renders in place, 390 px fits). But: (F-1) a never-edited record's first concurrent edit silently clobbers — no dialog; (F-2) after a successful reapply the page is stale and the next click self-conflicts; (F-3) a synergy *stage* conflict shows 'No conflicting fields'."
severity: blocker

### 2. Two-tab conflict walk — Due Diligence (findings + request items)
expected: The second save shows the conflict dialog with the area-filtered currentRecord (an uncleared caller sees the attribution fallback, never field values from an uncleared area).
result: issue
reported: "Cleared same-user conflicts render a correct diff on items and findings; leak-safety holds (uncleared caller gets 403 at the route layer / currentRecord:null on the WHERE-layer body, never field values). But the null-record body renders 'No conflicting fields … Apply your changes to continue' and Apply then reports the 403 as 'a network error' (F-4). The expectation text is also wrong against the accepted T-09-17/IN-01 contract: attribution is deliberately disclosed, only the record is withheld."
severity: major

### 3. Two-tab conflict walk — Org design (position edit)
expected: The second save shows the conflict dialog.
result: issue
reported: "org.html has no position-edit surface (per node: toggle, Decisions, Delete; zero inputs) — only create/delete/copy-to-target/import exist, so the walk is not performable as written. Contract-level PASS: a stale POST /api/org/positions from the real page context produced the dialog with a Title/Level diff and Apply persisted."
severity: minor

### 4. Two-tab destructive-delete walk — execution.html (RAID/task/synergy) + org.html (position)
expected: Edit a record in tab A and save, then delete that same record in tab B → tab B shows the destructive-variant dialog (no diff list, delete/cancel actions; the dialog IS the confirmation) and the record still exists until confirm. Deleting an untouched record works in one click with no dialog.
result: issue
reported: "All four destructive dialogs correct (title, attribution, no diff, Cancel + red 'Delete anyway', zero orange), record survives until confirm, untouched delete shows no dialog. But a native window.confirm precedes every delete so a stale delete is two prompts (F-6), and rows deleted via 'Delete anyway' stay on the page (F-2c)."
severity: minor

### 5. FA-1 review — hand-derived CONC-02 truth list
expected: Confirm the hand-derived must_haves decomposition of CONC-02 (stale-write / reapply / per-record granularity / version-less legacy rows / update-vs-delete) is accurate and complete.
result: issue
reported: "Accurate for what it states, incomplete: no per-record-granularity truth (SC3 lives only in the roadmap); no client-side truth for version-less records (the exact hole F-1 fell through); no 409-body clearance truth (the hole CR-01 fell through)."
severity: minor

### 6. FA-2 review — deleted-record dialog copy extends the signed UI-SPEC
expected: Confirm the three fresh EN literals (CONFLICT_TITLE_DELETED / CONFLICT_DELETED_INTRO / CONFLICT_CLOSE_LABEL) are acceptable, or route them through a UI-SPEC amendment.
result: pass
reported: "Accept with a one-line UI-SPEC amendment: keep hardcoded EN via textContent (the signed spec prescribes it — do NOT i18n these three); add the three literals to the Copywriting Contract; voice tweak 'Someone else deleted this'; suppress the contradictory attribution line in the deleted variant (F-7)."

## Summary

total: 6
passed: 1
issues: 5
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "The first concurrent edit of a record that was never edited before is rejected with a 409 (CONC-02; D-02 'no exemptions'; D-09 'legacy records gain protection the moment two people co-edit one')"
  status: failed
  reason: "R7 F-1: both tabs loaded T4 with no version field; A flipped twice (server v2); B's single flip carried no version → 200, server v3 — A's write is gone, no dialog anywhere."
  severity: blocker
  test: 1
  root_cause: "Every record is INSERTed without a version (db/store.js:404-411) and every client call site omits `version` when the held record has none (execution.js:203-204,230,421,815,857,885,919,951,987,1016,1060,1123,1146; org.js:594,960; due-diligence.js:114-116,173-175,248-250,264-266). With no client version the route precheck returns false (server.js:450-455) and the WHERE layer binds this request's own fresh snapshot version (db/store.js:421), which always matches in-process. The server tests enshrine the 'no-version-supplied exemption' (09-06-SUMMARY) so the coverage gate cannot catch it."
  artifacts:
    - path: "db/store.js"
      issue: "records inserted with no version stamp (404-411); fresh-snapshot version bound when client sends none (421)"
    - path: "public/js/execution.js, org.js, due-diligence.js"
      issue: "omit `version` for version-less records at ~20 call sites"
    - path: "test/optimistic-locking-contract.test.js"
      issue: "missing the contract 'a client that loaded a version-less record and sends 0 gets 409 after another writer stamps it'"
  missing:
    - "Send `version: rec.version !== undefined ? rec.version : 0` at every call site (server already treats a missing stored version as 0, server.js:456; zod accepts 0; parseExpectedVersion accepts expectedVersion=0) — or stamp version:0 on INSERT so every GET carries one"
    - "Add the contract test; amend the 09-01 truth list (test 5)"
  debug_session: ""

- truth: "After 'Apply my changes anyway' or 'Delete anyway' succeeds the page shows the server's resulting state (D-03 'form state is never lost' end to end)"
  status: failed
  reason: "R7 F-2: task row still 'To do' while server says doing → next click sends stale v1 → false 'doing vs doing' self-conflict; synergy header stale; RAID row and org node remain in the DOM after Delete anyway; DD select re-renders to 'theirs' while the dialog is open and shows 'requested' after Apply when server holds 'received'."
  severity: major
  test: 1
  root_cause: "The page handler has already consumed the 409 (res.success falsy → no state update) when the dialog's Apply fires a fresh window.fetch and simply closes on success (public/js/transitions.js:455-459; delete variant 337-341). D-05 'no per-page wiring' means no page learns the outcome; DD pages additionally call refresh unconditionally (due-diligence.js:119,253)."
  artifacts:
    - path: "public/js/transitions.js"
      issue: "dialog outcome never propagated to the originating call (337-356, 455-474)"
    - path: "public/js/due-diligence.js"
      issue: "unconditional .then(refresh) re-renders under the open dialog (119, 253)"
  missing:
    - "Resolve the ORIGINAL fetch promise with the reapplied response (hold pending while the dialog is open; resolve with the 409 on Discard) — or dispatch a `ma:conflict-resolved` event the three pages handle; keep D-05"
    - "Remove/guard DD unconditional refresh"
  debug_session: ""

- truth: "The conflict dialog shows a CORRECT field diff for every conflicting write, and never claims 'no conflicting fields' when it cannot tell"
  status: failed
  reason: "R7 F-3/F-5: synergy stage change sends {targetStage} but the record field is `stage` → zero diff rows → 'No conflicting fields … without affecting anything you edited' while the other user changed the stage; same for confirm-current ({}), convert ({toTask,toRaid}), rebaseline ({reason}); per-month phasing {targetM|realizedM} would compare a month cell to the initiative total (code-traced); labels are raw keys ('RealizedM', 'DueDate', 'ReportsToId')."
  severity: major
  test: 1
  root_cause: "Diff is keyed on payload keys that also exist on currentRecord (transitions.js:394-395); label.textContent = field + CSS capitalize (408)."
  artifacts:
    - path: "public/js/transitions.js"
      issue: "payload∩record diff; raw key labels (388-427)"
  missing:
    - "Per-route diff mapping (or diff currentRecord against the client's held copy for the route's known fields); never state 'without affecting anything you edited' when the payload has no record-mirroring key"
    - "Display labels for known keys with a humanised fallback"
  debug_session: ""

- truth: "A caller whose clearance no longer covers the record is told so truthfully and sees the server's real reason on reapply"
  status: failed
  reason: "R7 F-4: currentRecord:null body renders 'No conflicting fields … Apply your changes to continue' (telling an uncleared user to apply a change to a record outside their clearance); Apply then hits 403 and is reported as 'a network error occurred'."
  severity: major
  test: 2
  root_cause: "transitions.js:397-401 has no null-record branch; transitions.js:465 maps every non-409/non-5xx outcome to NETWORK."
  artifacts:
    - path: "public/js/transitions.js"
      issue: "397-401, 460-466"
  missing:
    - "Branch on currentRecord === null ('This record is no longer within your clearance; your change cannot be applied.'); surface the response's own `error` for 4xx"
  debug_session: ""

- truth: "A stale delete is confirmed by the destructive dialog alone, with no stacked native prompt (09-UI-SPEC 'Destructive confirmation')"
  status: failed
  reason: "R7 F-6: every delete handler calls window.confirm before the request (execution.js:222,1053,1139; org.js:586) so a stale delete is confirm() → 409 → dialog."
  severity: minor
  test: 4
  root_cause: "Pre-existing native confirm retained when the destructive dialog was added."
  artifacts:
    - path: "public/js/execution.js, public/js/org.js"
      issue: "native confirm precedes the DELETE"
  missing:
    - "Drop the native confirm when the held record carries a version (the dialog is the safety net), or re-word the spec"
  debug_session: ""

- truth: "The deleted-record variant is internally consistent"
  status: failed
  reason: "R7 F-7: the `deleted` throw carries no actor/time (db/store.js:483) so the variant always renders the fallback 'This record changed since you loaded it.' directly under 'This record was deleted'."
  severity: cosmetic
  test: 6
  root_cause: "Attribution fallback is unconditional in the deleted variant."
  artifacts:
    - path: "public/js/transitions.js"
      issue: "deleted variant attribution line"
  missing:
    - "Suppress the attribution line in the deleted variant (or word it '…was deleted since you loaded it'); title 'Someone else deleted this'; add the three literals to the 09-UI-SPEC Copywriting Contract"
  debug_session: ""

- truth: "Phase documentation is accurate"
  status: failed
  reason: "R7 items 2/3/5: UAT item-2 expectation contradicts accepted T-09-17/IN-01; org position-edit UI gap not recorded in WINDOWS.md; FA-1 truth list lacks per-record-granularity, client-version-less and 409-body-clearance truths."
  severity: minor
  test: 5
  root_cause: "Hand-derived docs not reconciled with the as-built contract."
  artifacts:
    - path: ".planning/WINDOWS.md"
      issue: "missing org position-edit gap"
    - path: ".planning/phases/09-optimistic-locking-conflict-recovery/09-01-PLAN.md"
      issue: "truth list incomplete (lines 25-41, 123-127)"
  missing:
    - "Amend the three docs; record the org position-edit UI gap (candidate for Phase 15)"
  debug_session: ""
