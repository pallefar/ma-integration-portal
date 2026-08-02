---
status: testing
phase: 03-deal-isolation-audit-log-write-validation
source: [03-VERIFICATION.md]
started: 2026-08-02T04:55:00Z
updated: 2026-08-02T04:55:00Z
---

## Current Test

number: 1
name: Deal switcher round trip — demo → real deal → demo
expected: |
  Logged in as admin (or karen/IL): use the header deal switcher to switch into a
  real deal. Every panel re-reads under the deal binding — the page shows the
  empty, template-only deal workspace (no demo employees/projects/Custom-M&A
  content). Switch back to "Demo showcase" and the full demo content returns.
  No console errors during either switch.
awaiting: user response

## Tests

### 1. Deal switcher round trip — demo → real deal → demo
expected: Switch into a real deal from the header switcher; page renders the empty template-only deal workspace (no demo data). Switch back to Demo showcase; demo content returns. Zero console errors.
result: [pending]

### 2. Employee sees no deal chrome
expected: Log in as employee-demo (password TEdemo!2026). The header deal switcher and any real-deal UI are not visible anywhere; the employee experience is unchanged demo-only.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

## Notes

Already verified by orchestrator Playwright passes this session (not repeated here):
switcher renders + visually distinct, dropdown lists Demo showcase + "+ New real deal",
create-deal modal opens with isolation notice, audit viewer renders + actor filter works,
zero console errors in all passes. The two tests above are the only remaining
browser-only items from 03-04's end-of-phase checkpoint (STATE.md blocker line).
