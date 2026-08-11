---
status: testing
phase: 09-optimistic-locking-conflict-recovery
source: [09-VERIFICATION.md]
started: 2026-08-11T09:05:00Z
updated: 2026-08-11T09:05:00Z
---

## Current Test

number: 1
name: Two-tab conflict walk — Execution Hub (integration tasks + synergy initiatives)
expected: |
  Edit the same task/initiative in two tabs; the second save shows the conflict
  dialog with a correct field diff. Editing two DIFFERENT records shows no dialog.
awaiting: user response

## Tests

### 1. Two-tab conflict walk — Execution Hub (integration tasks + synergy initiatives)
expected: Tab B shows the conflict dialog with a correct field diff on the same-record case; no dialog on the different-record case.
result: [pending]

### 2. Two-tab conflict walk — Due Diligence (findings + request items)
expected: The second save shows the conflict dialog with the area-filtered currentRecord (an uncleared caller sees the attribution fallback, never field values from an uncleared area).
result: [pending]

### 3. Two-tab conflict walk — Org design (position edit)
expected: The second save shows the conflict dialog.
result: [pending]

### 4. Two-tab destructive-delete walk — execution.html (RAID/task/synergy) + org.html (position)
expected: Edit a record in tab A and save, then delete that same record in tab B → tab B shows the destructive-variant dialog (no diff list, delete/cancel actions; the dialog IS the confirmation) and the record still exists until confirm. Deleting an untouched record works in one click with no dialog.
result: [pending]

### 5. FA-1 review — hand-derived CONC-02 truth list
expected: Confirm the hand-derived must_haves decomposition of CONC-02 (stale-write / reapply / per-record granularity / version-less legacy rows / update-vs-delete) is accurate and complete.
result: [pending]

### 6. FA-2 review — deleted-record dialog copy extends the signed UI-SPEC
expected: Confirm the three fresh EN literals (CONFLICT_TITLE_DELETED / CONFLICT_DELETED_INTRO / CONFLICT_CLOSE_LABEL) are acceptable, or route them through a UI-SPEC amendment.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps

