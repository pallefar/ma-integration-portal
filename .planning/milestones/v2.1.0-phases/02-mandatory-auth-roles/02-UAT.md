---
status: complete
phase: 02-mandatory-auth-roles
source: [02-VERIFICATION.md]
started: 2026-07-31T20:30:00Z
updated: 2026-07-31T21:15:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Client redirects to /login.html on a 401 read
expected: With auth enforced (DEMO_OPEN unset), visiting a portal page without a valid session redirects to /login.html on the first 401 read (no blank page, no redirect loop on /login.html itself). After login, the same page loads normally.
result: pass
source: automated
evidence: |
  Live Playwright run against `PORT=3210 node server.js` (no DEMO_OPEN, fail-closed):
  - GET /api/employees unauthenticated → 401 {"error":"Login required.","authRequired":true}
  - Browser navigate to /dashboard.html → landed on http://localhost:3210/login.html ("TE Connectivity - Sign in")
  - Direct navigate to /login.html → stays on /login.html (no redirect loop)
  - POST /api/auth/login (admin demo account) → 200; re-navigate /dashboard.html → stays, renders "TE Connectivity - Integration Dashboard", no console errors post-login

### 2. Demo bundle stays open under fail-closed default
expected: Booting via start.command (macOS) / start.bat (Windows) sets DEMO_OPEN=1, so the demo showcase loads with NO login prompt — all pages and API reads work unauthenticated.
result: pass
source: automated
evidence: |
  Replicated start.command's exact env line (`export DEMO_OPEN=1`, verified at start.command:30; start.bat:40 has `set "DEMO_OPEN=1"`) with `PORT=3211 node server.js`:
  - GET /api/employees with NO cookie → 200
  - Browser navigate to /dashboard.html → loads directly, zero 401s in console, no login redirect
  - Server log shows the new WR-03 warning: "[security] DEMO_OPEN=1 — ALL /api authentication and authorization is DISABLED. Never set this for a real-deal deployment."
  Not exercised: the launcher's npm-install guard / browser-open lines (unchanged since v1.0.2; out of this phase's diff).

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none]
