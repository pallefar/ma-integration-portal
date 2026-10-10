---
phase: 13-content-safety
plan: 04
subsystem: http-caching / client-storage
tags: [SAFE-07, cache-control, clear-site-data, service-worker, localStorage]
requires: []
provides:
  - "no-store middleware on every /api response (before the body parsers)"
  - "Clear-Site-Data on logout + window.MAClientStorage (clearOnLogout, runLegacyCleanupOnce)"
  - "self-unregistering sw.js stub; manifest.json removed"
affects: [server.js, public/js/transitions.js, public/js/change-password.js, public/change-password.html, lib/credentialLockdown.js]
key-files:
  created: [public/js/client-storage.js, test/caching-safe07.test.js]
  modified: [server.js, public/js/transitions.js, public/js/change-password.js, public/change-password.html, lib/credentialLockdown.js, public/sw.js, test/credential-lockdown.test.js]
  deleted: [public/manifest.json]
key-decisions:
  - "LANGUAGE_KEYS = ['employeeLanguage'] (grep-proven; every LANG_KEY / localStorage language use resolves to that one key)"
  - "LEGACY_CACHE_NAMES = [] (git history: no caches.open() was ever shipped)"
status: complete
actuals:
  tokens: 60000
  tasks: 2
  commits: 2
---

# Phase 13 Plan 04: SAFE-07 caching safety Summary

`/api` responses are `Cache-Control: no-store` at every status (middleware sits before `express.json`), logout answers
`Clear-Site-Data: "cache", "storage"` and the client clears sessionStorage / localStorage (language key preserved) / Cache
Storage / service workers, and page loads no longer delete the Transformers model cache.

## Commits

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | `c654c7c` | no-store middleware, logout Clear-Site-Data, `public/js/client-storage.js`, transitions/change-password wiring, lockdown allowlist, `test/caching-safe07.test.js`, `test/credential-lockdown.test.js` allowlist pin |
| 2 | `614a131` | per-load cache wipe removed, `sw.js` stub, `manifest.json` deleted, Task 2 test rows |

Tracer gate: Task 1 `<verify>` (`caching-safe07`, `lockdown-asset-allowlist`, `credential-lockdown`) green before Task 2 started.

## Status -> route -> header matrix (live app, MA_* temp stores)

| Status | Route | Cache-Control |
|--------|-------|---------------|
| 200 | GET /api/auth/mode | no-store |
| 400 | POST /api/auth/login (malformed JSON, body-parser) | no-store |
| 401 | GET /api/raid (no session) | no-store |
| 403 | POST /api/raid (employee session) | no-store |
| 404 | DELETE /api/raid/:id (unknown id, admin) | no-store |
| 409 | POST /api/raid (stale version, real optimistic-lock conflict) | no-store |
| 500 | POST /api/raid with a 51 MiB body (see "Observation" below) | no-store |
| 500 | GET /api/__safe07__/boom (synthetic thrower spliced after the middleware; real final 500 handler) | no-store |
| 503 | GET /api/__safe07__/busy (synthetic `SQLITE_BUSY`; real central 503 middleware, `Retry-After: 1` unchanged) | no-store |

Logout: `POST /api/auth/logout` -> `Clear-Site-Data: "cache", "storage"`, `Cache-Control: no-store`, session cookie cleared,
session revoked (next request 401).

12-CARRY-INS row 4 (per-caller ETag without Cache-Control) is closed by the middleware.

## LANGUAGE_KEYS / LEGACY_CACHE_NAMES evidence

- `grep -rhoE "localStorage\.(get|set|remove)Item\(...)" public` -> 20 distinct literal keys; the only language key is
  `employeeLanguage` (`LANG_KEY = 'employeeLanguage'` in banners.js, inline-edit.js, transitions.js; 31 literal uses). Dynamic
  keys (`KEY` in dashboard.html, `localTasksKey`, `te_leader_checklist_*`) are non-language and are cleared at logout.
  Final `LANGUAGE_KEYS = ['employeeLanguage']`.
- `git log --all -S"caches.open" -- public/js public/sw.js public/index.html` -> no commits; `git log -- public/sw.js` -> one
  commit (`94eb08b`, initial) whose worker only ever *deleted* caches. Final `LEGACY_CACHE_NAMES = []`
  (identical declaration in `public/sw.js` and `public/js/client-storage.js`, asserted equal by a test).
- `MODEL_CACHE_NAMES = ['transformers-cache']` (Transformers.js default `cacheKey`) is never deleted by the legacy path;
  logout deliberately clears every cache including it (acceptance 5).

## manifest.json removal proof

`grep -rIn "manifest\.json" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=vendor --exclude-dir=.planning --exclude-dir=.claude`
-> only `test/caching-safe07.test.js` (this plan's own assertion); no `rel="manifest"` anywhere under `public/`. Deleted with
`git rm`; a test walks `public/` (excluding vendor) and asserts nothing references it.

## Deviations from Plan

**1. [Rule 3 - test pin] `test/credential-lockdown.test.js` edited** — it pins the exact allowlist ("exactly the seven public
names"); now eight incl. `/js/client-storage.js`. Only the list literal and test title changed (plan anticipated this:
"edited only if it pins the same list"). `test/lockdown-asset-allowlist.test.js` needed no edit (it derives from the single
source list and passed unchanged).

**2. [Observation, not fixed] oversized body answers 500, not 413** — `body-parser` raises `PayloadTooLargeError` (status
413); the existing final error handler in server.js maps every unmatched error to a fixed 500. Pre-existing, unrelated to
caching and out of this plan's scope; the no-store header is present on that response (matrix row above). Candidate for a
quick task (map `err.status === 413` to a 413 with the fixed body) — not logged to WINDOWS.md (no stub/skip).

**3. [Test mechanics] 500/503 provocation** — no real route reaches a generic 500 or a busy 503 deterministically without a
cross-process lock holder, so two throwaway routes are spliced into the live router immediately after the no-store layer in the
test only; the real no-store middleware, central 503 middleware and final 500 handler still run.

**4. [Test mechanics] 413 row** — body-parser reads the whole request off the socket before answering (an early-abort probe
hangs), so the test really sends 51 MiB + 1 KiB.

**5. [Note] non-canonical `/API/...` 404** — answered by the CR-01 guard before the new middleware (PD-26); carries a fixed
`{error:'Not found'}` body, no data. Not changed (that guard is outside this plan's region).

## Auto-mode / checkpoints

None. Tracer gate re-ran the automated verify (green), no human stop per executor brief.

## Known Stubs

None.

## Threat Flags

None. `runLegacyCleanupOnce({ legacyCacheNames })` accepts an override used only by the unit test; the model cache name is
filtered out regardless and any script on the page can already call `caches.delete` (no new capability).

## Self-Check

- `public/js/client-storage.js` present; `public/manifest.json` absent; commits `c654c7c`, `614a131` present.
- `test/caching-safe07.test.js` 18/18 pass; full suite `node --test`: tests 1477, pass 1477, fail 0, skipped 0 (EXIT=0).

## Self-Check: PASSED
