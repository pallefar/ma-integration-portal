---
status: testing
phase: 02-mandatory-auth-roles
source: [02-VERIFICATION.md]
started: 2026-07-31T20:30:00Z
updated: 2026-07-31T20:30:00Z
---

## Current Test

number: 1
name: Client redirects to /login.html on a 401 read
expected: |
  With auth enforced (DEMO_OPEN unset), open any portal page (e.g. /dashboard.html)
  in a real browser without a valid session. The page's API reads receive
  401 {authRequired:true} and the fetch wrapper redirects the browser to
  /login.html instead of silently rendering a blank/empty page. After login,
  the same page loads normally. An expired session mid-use also redirects
  rather than blanking.
awaiting: user response

## Tests

### 1. Client redirects to /login.html on a 401 read
expected: With auth enforced (DEMO_OPEN unset), visiting a portal page without a valid session redirects to /login.html on the first 401 read (no blank page, no redirect loop on /login.html itself). Wired in public/js/transitions.js:37-47; needs a real browser to prove navigation.
result: [pending]

### 2. Demo bundle stays open under fail-closed default
expected: Booting via start.command (macOS) / start.bat (Windows) sets DEMO_OPEN=1, so the demo showcase loads with NO login prompt — all pages and API reads work unauthenticated, exactly as before Phase 2. Static grep confirms DEMO_OPEN=1 in both launchers; needs an actual OS shell boot to prove live behavior.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
