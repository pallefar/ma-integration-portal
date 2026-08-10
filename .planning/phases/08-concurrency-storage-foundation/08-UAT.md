---
status: testing
phase: 08-concurrency-storage-foundation
source: [08-VERIFICATION.md]
started: 2026-08-11T00:00:00Z
updated: 2026-08-11T00:00:00Z
---

## Current Test

number: 1
name: Demo showcase visual click-through (08-05 human-check)
expected: |
  Open the running portal in a browser against the committed demo data and click
  through the dashboard, a workstream view, and one save. The demo showcase looks
  and behaves exactly as it did before Phase 8 — the storage change is invisible
  by design.
awaiting: user response

## Tests

### 1. Demo showcase visual click-through (08-05 human-check)
expected: Dashboard, a workstream view, and one save all look and behave exactly as before Phase 8 — the storage change is invisible by design. (`node server.js`, browse the demo.)
result: [pending]

### 2. Live save-under-contention behavior (08-04 human-check)
expected: With a second process holding the write lock (start `npm run soak` alongside, or hold a lock via a scratch script): a save during brief contention completes with no visible interruption (silent retry); a sustained hold produces the "Server is busy — your change was not saved" toast with the form still populated, nothing discarded.
result: [pending]

### 3. Silent-retry transparency prohibition (08-04, judgment tier)
expected: When retries are exhausted, the user is plainly told the change was not saved and no page/form state is discarded — the silent auto-retry never hides a persistent save failure. (Code + tests support this; policy requires human confirmation, never a silent pass.)
result: [pending]

### 4. Commit/BEGIN-IMMEDIATE boundary (08-05 backstop edge)
expected: Under real multi-process contention, a writer whose COMMIT lands at the same instant a second writer issues BEGIN IMMEDIATE against the same file: the second acquires the lock cleanly and both writes persist — no merge-away, no error. (The soak exercises this window statistically with zero violations across thousands of writes; confirming the soak PASS output as representative evidence is an acceptable human disposition here.)
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
