---
phase: 13-content-safety
plan: 02
subsystem: security
tags: [egress, csp, gemini, fonts, runtime-db, admin-setting, SAFE-06]
requires: []
provides:
  - "lib/egress.js: instance egress switch (mode defaults + runtime.db overlay, PRAGMA data_version cache)"
  - "lib/csp.js: headersFor({ egress }) per-request page CSP builder (13-07 extends it)"
  - "GET/POST /api/admin/egress (admin-only, strict schema, audited)"
  - "egress { gemini, huggingface, youtube } booleans in GET /api/settings (public subset)"
  - "aiService.setEgressCheck backstop; { egressDisabled: 'gemini' } 200 marker"
  - "vendored Inter + Outfit woff2 (latin, latin-ext) + OFL texts"
affects: [13-07, 13-08, 13-13, 13-14]
tech-stack:
  added: []
  patterns:
    - "runtime.db app_state singleton for instance-level admin settings"
    - "cache keyed on PRAGMA data_version + in-process generation counter (cross-process correct, one pragma per request)"
    - "refusal as 200 marker so no generic client hook (503 retry / 409 dialog / 403 denial) engages"
key-files:
  created:
    - lib/egress.js
    - lib/csp.js
    - test/egress-settings.test.js
    - test/egress-real-mode.test.js
    - test/helpers/egress-server.js
    - public/vendor/fonts/inter-latin.woff2
    - public/vendor/fonts/inter-latin-ext.woff2
    - public/vendor/fonts/outfit-latin.woff2
    - public/vendor/fonts/outfit-latin-ext.woff2
    - public/vendor/fonts/OFL-Inter.txt
    - public/vendor/fonts/OFL-Outfit.txt
  modified:
    - db/controlStore.js
    - server.js
    - aiService.js
    - validators/settings.js
    - public/css/style.css
    - lib/credentialLockdown.js
    - test/credential-lockdown.test.js
decisions:
  - "PD-8: frame-ancestors stays 'self' (PRD text says 'none'; shipped value is 'self' and the portal frames its own pages) - NEEDS USER CONFIRMATION at phase close"
  - "Variable woff2: one file per family+subset, @font-face declares a weight RANGE (Inter 300-700, Outfit 400-800) instead of one block per weight"
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
---

# Phase 13 Plan 02: Egress switch, per-request CSP, Gemini refusals, vendored fonts Summary

An admin-only instance egress switch (`gemini` / `huggingface` / `youtube`, runtime.db, real-mode default all OFF) now drives the page CSP per request, makes Gemini refuse with a 200 `{egressDisabled}` marker, removes the AI-training upload from real mode (404) and vendors the Google Fonts so no font CDN origin remains anywhere.

## What shipped

| Task | Commit | Content |
| ---- | ------ | ------- |
| 1 (tracer) | 263be46 | lib/egress.js, lib/csp.js, controlStore get/setEgressSettings + runtimeDataVersion, server.js CSP from builder, GET/POST /api/admin/egress, EgressUpdateSchema (strict), aiService.setEgressCheck, tests |
| 2 | 022416a | `{egressDisabled:'gemini'}` marker on /api/ai/insight + /api/rag/upload, assessment empty key, real-mode rag upload 404 middleware (before the /api gate), `egress` in GET /api/settings + PUBLIC_SETTINGS_KEYS |
| 3 | (this commit) | vendored fonts + local @font-face, font CDN origins gone from style.css and CSP, subtests |

The tracer's automated verify (`node --test test/egress-settings.test.js test/egress-real-mode.test.js`) was green on the first run; no human stop needed (brief rule).

## Default CSP strings

dev/demo (all channels on, today's third-party origins; YouTube removed from script-src, fonts CDN removed):

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://img.youtube.com https://i.ytimg.com https://*.huggingface.co; font-src 'self' data:; connect-src 'self' https://huggingface.co https://*.huggingface.co https://cdn-lfs.huggingface.co https://cdn-lfs-us-1.huggingface.co; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://youtube.com; media-src 'self' blob: data: https://*.youtube.com; worker-src 'self' blob:
```

real mode (nothing stored; no `https:` token anywhere):

```
default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self'; media-src 'self' blob: data:; worker-src 'self' blob:
```

## Vendored fonts (one-time developer download, not runtime egress)

Source: Google Fonts CSS2 API for the exact former `@import` URL, Chrome 130 UA; Inter and Outfit are served as variable fonts (one file covers every requested weight), so one file per family+subset. Only `latin` and `latin-ext` kept (EN/DE/CS; ZH uses system fonts as before).

| File | Bytes | sha256 | Source |
| ---- | ----- | ------ | ------ |
| inter-latin.woff2 | 48432 | c940764593d0fe5d596be327ca7558855e018039fb78509aa21921fd3644c3e4 | https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2 |
| inter-latin-ext.woff2 | 85272 | a28eb6d3ccb534ae0c94ca999371df024aab60b08c3c8a5720ee9e32fa0faaa2 | https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7W0Q5n-wU.woff2 |
| outfit-latin.woff2 | 32228 | 92684e4acde79ef07758cd09380b7e01e9824d8b061eddeda046f78c166d7b12 | https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJtEtqUYLknw.woff2 |
| outfit-latin-ext.woff2 | 14760 | 9e38b3f1575daba3435ef09d33a202585ed5bd204bd0a8c744955c750c2b9091 | https://fonts.gstatic.com/s/outfit/v15/QGYvz_MVcBeNP4NJuktqUYLkn8BJ.woff2 |
| OFL-Inter.txt | 4377 | 5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57 | google/fonts ofl/inter/OFL.txt |
| OFL-Outfit.txt | 4389 | c676351bf8576b9aba743cd5eaa8c0e7ee0d51f805d720447b4df4ddb6a2e416 | google/fonts ofl/outfit/OFL.txt |

## Cross-process timing observed

Toggle `POST /api/admin/egress` through process A, then the very next request to process B (cache pre-warmed with the old value): B served the new CSP, 13 ms toggle-plus-request wall time on a loaded host. No restart, no timer; the `PRAGMA data_version` path.

## Deviations from Plan

### Auto-fixed / reordered

**1. [Ordering] `aiService.setEgressCheck` landed in Task 1's commit instead of Task 2**
- **Why:** the Task 1 server.js wiring calls it at boot; leaving it out would have broken server start between the two commits.
- **Commit:** 263be46

**2. [Test shape] Gemini-off outbound proof runs in-process, the rest over child servers**
- Stubbing `global.fetch` requires the app in the test process, so that one subtest boots the app in-process on a temp copy of the databases (positive control included: with Gemini on and a key the stub DOES see the outbound call) while CSP / auth / cross-process / real-mode subtests use child servers from the new `test/helpers/egress-server.js`.

**3. [Design] Weight range instead of per-weight blocks**
- The API serves variable files, so `font-weight: 300 700` / `400 800` ranges replace the per-weight `@font-face` blocks the plan expected; renders identically for every weight the stylesheet used to request.

**4. [Rule 3 - Blocking] Lockdown static allowlist extended with the four woff2 files**
- **Found during:** Task 3 full-suite run - `test/lockdown-asset-allowlist.test.js` (plan 10-09's cross-check) failed twice: `/css/style.css` (linked by login.html / change-password.html) now references `/vendor/fonts/*.woff2`, which a credential-locked host would refuse.
- **Fix:** added the four paths to `LOCKDOWN_STATIC_ALLOWLIST` in `lib/credentialLockdown.js` (keeps the locked login page rendering in the brand fonts, as it did with the CDN fonts) and updated the exact-list assertion in `test/credential-lockdown.test.js` (name + expected array only; no assertion weakened).
- **Files modified:** lib/credentialLockdown.js, test/credential-lockdown.test.js (outside the plan's `files_modified`; the plan's "no other assertion edited" assumed no allowlist impact).

None of the other deviations changes behaviour the plan specified.

## Findings for the orchestrator / later plans

- **Lockdown allowlist grew by the four font files (Rule 3 deviation, see above).** Any later plan that adds a `url()` to `/css/style.css` (or a script/style linked from login.html / change-password.html) must extend `LOCKDOWN_STATIC_ALLOWLIST` and the pinned list in `test/credential-lockdown.test.js` too - `test/lockdown-asset-allowlist.test.js` enforces it.
- **PD-8 (needs user confirmation at phase close):** `frame-ancestors` stays `'self'` although D-13-03's text says `'none'` - the shipped header is `'self'` and `'none'` would break the demo (overview deck, playbook PDF are framed by the portal itself). Cross-origin framing stays refused either way.
- **Clients (13-08):** the `egress` booleans are now in GET /api/settings; real-mode browser features that need Hugging Face (in-browser model) or YouTube are blocked by CSP until an admin opts in - client hiding/graceful degradation is 13-08's job. The Gemini marker is `{ egressDisabled: 'gemini', message }` with HTTP 200; clients must not retry it.
- `PUBLIC_SETTINGS_KEYS` now includes `egress` (booleans only).

## Threat model status

| ID | Status | Evidence |
| -- | ------ | -------- |
| T-13-10 | mitigated | real default off; marker + aiService backstop; subtest asserts zero outbound generativelanguage calls (with positive control) |
| T-13-11 | mitigated | CSP from the switch; real-mode child asserts no http(s) origin; fonts vendored |
| T-13-12 | mitigated | `/api/admin` admin-only; 401/403 subtests; strict schema 400s |
| T-13-13 | mitigated | `egress-settings-changed` event asserted (actor, before/after) |
| T-13-14 | mitigated | cross-process subtest (data_version cache) |
| T-13-15 | mitigated | one pragma per request, memoised header strings (budget re-measure in 13-14) |
| T-13-16 | accepted | sha256 recorded above |

## Known Stubs

None.

## Verification

- `node --test test/egress-settings.test.js test/egress-real-mode.test.js test/rag-upload.test.js test/settings-public-subset.test.js` - green (rag-upload unedited).
- `test/read-policy-coverage`, `test/write-validation-coverage`, `test/auth-route-inventory` - green with the two new routes.
- `grep -rIl 'fonts.googleapis.com|fonts.gstatic.com' public --exclude-dir=vendor --exclude-dir=uploads` - empty.
- Full suite (`node --test`, after the lockdown-allowlist fix): `# tests 1470  # pass 1470  # fail 0`. The first full run had 2 failures (`test/lockdown-asset-allowlist.test.js`, deviation 4), both fixed.
- `git status --porcelain data/ public/sent_emails/` empty at every commit.

## Self-Check: PASSED

All created files exist (lib/egress.js, lib/csp.js, the three test files, four woff2, two OFL texts); commits 263be46, 022416a, 6834f76 present on the worktree branch.
