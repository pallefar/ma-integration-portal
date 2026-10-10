---
phase: 12-data-layer-integrity-performance
plan: 07
subsystem: testing
tags: [playwright, axe-core, smoke, browser-test, a11y, release-exclusion]
requires:
  - phase: 12-01
    provides: isolation guard / real-lane conventions reused by the harness
provides:
  - "npm run smoke: one-command real-Chromium + axe-core smoke net over 6 pages x 2 widths in the real-deal lane"
  - "scripts/smoke/pages.js page registry later UI phases append to"
  - ".gitattributes export-ignore for scripts/smoke/ (git archive release zips exclude it)"
affects: [phase-19-accessibility, phase-21-release-exclusions, every-later-ui-phase]
tech-stack:
  added: []
  patterns:
    - "tools resolved from the host (env path -> npx cache -> global npm root), never from repo node_modules, never installed"
    - "axe injected via page.evaluate (CDP) so the served CSP is not bypassed"
key-files:
  created:
    - scripts/smoke/run.js
    - scripts/smoke/pages.js
    - scripts/smoke/README.md
    - .gitattributes
    - test/smoke-harness.test.js
  modified:
    - package.json
key-decisions:
  - "axe counts informational in Phase 12 (exit code = page errors, failed same-origin requests, missing landmarks); --fail-on-axe exists for Phase 19"
  - "Pre-existing site-wide CSP console.error (Google Fonts @import) is an explicit KNOWN_CONSOLE allow-list entry in pages.js, reported as a note, so a regression elsewhere still fails the run"
  - "login has landmarks: [] because public/login.html ships no <main>; recorded as a finding, not papered over"
patterns-established:
  - "Later phases add pages by appending plain objects to scripts/smoke/pages.js only"
status: complete
actuals:
  tokens: 11000
  tasks: 2
  commits: 2
---

# Phase 12 Plan 07: Browser Smoke Harness Summary

**`npm run smoke` boots an isolated MA_MODE=real server, signs the admin and a synthetic Integration Lead in through the real login page, and visits six pages at 1440 and 390 in Chromium printing axe-core critical/serious counts, with Playwright/axe-core resolved from the host and the whole directory export-ignored from release zips.**

## What was built

- `scripts/smoke/run.js` - `resolveTool` (PLAYWRIGHT_PATH/AXE_CORE_PATH, then `~/.npm/_npx/*/node_modules/<tool>`, then `npm root -g`; package-name + loadability check; prints resolved path and version; missing -> exit 2 with the README fix). Isolated server on a free port with a `mkdtemp` MA_DATA_DIR, `bootstrap-admin` with a generated one-time secret, admin sign-in + forced rotation through `/login.html` and `/change-password.html`, IL account (`hrbp`) and synthetic deal created through the admin API, IL signs in through the login page, rotates, selects the deal. Per page x width: pageerror / console.error / same-origin >= 400 collection (per-page allow-lists), final-URL check (a redirect fails), landmark check, `axe.run` critical/serious counts, optional JPEG via `--out`. Exit 0 / 1 / 2. Cleanup in `finally` and on SIGINT/SIGTERM/SIGHUP; refuses to start below 1 GB free in `os.tmpdir()`; sha256 guard over `data/demo.db`, `data/control.db` (+ `-wal`) and a `git status -- data public/sent_emails` comparison.
- `scripts/smoke/pages.js` - registry: `login` (anonymous), `dashboard`, `execution`, `due-diligence`, `org` (il), `admin-users` (admin, opens `#admin-tab-btn-users` via `afterLoad`), each `[1440, 390]`.
- `scripts/smoke/README.md`, `.gitattributes` (`scripts/smoke/ export-ignore`), `package.json` `"smoke"`, `test/smoke-harness.test.js` (6 tests, never launches a browser).

## Live run (Task 2 verification)

`PLAYWRIGHT_PATH=<npx cache>/playwright AXE_CORE_PATH=<host-local>/axe-core npm run smoke` - exit 0:

```
tools: playwright 1.62.1 (~/.npm/_npx/e41f203b7505f1fb/node_modules/playwright, via PLAYWRIGHT_PATH); axe-core 4.11.1 (~/cv/node_modules/axe-core, via AXE_CORE_PATH)
isolated real-deal server up (temp MA_DATA_DIR, MA_MODE=real)

page           width  axe critical  axe serious  page errors  failed req  landmarks
-------------  -----  ------------  -----------  -----------  ----------  ---------
login          1440   0             1            0            0           ok
login          390    0             1            0            0           ok
dashboard      1440   2             3            0            0           ok
dashboard      390    2             2            0            0           ok
execution      1440   2             2            0            0           ok
execution      390    2             2            0            0           ok
due-diligence  1440   1             2            0            0           ok
due-diligence  390    1             2            0            0           ok
org            1440   1             2            0            0           ok
org            390    1             2            0            0           ok
admin-users    1440   1             2            0            0           ok
admin-users    390    1             2            0            0           ok

12 page x width visit(s); 0 with errors; axe critical+serious total 37 (informational).
isolation: committed data/*.db sha256 unchanged; git status data/ + public/sent_emails/ unchanged.
```

Rules behind the counts (same at both widths unless noted): critical `select-name` on every IL page and admin-users (dashboard 2, execution 3, due-diligence 1, org 5, admin-users 1 nodes); critical `label` on dashboard and execution (1 node); serious `color-contrast` on all six (3 / 4 / 18 / 52 / 11 / 20 nodes), serious `label-title-only` on five IL/admin pages, serious `link-in-text-block` on dashboard at 1440. These are Phase 19 input - nothing here gates on them.

Other demonstrated paths:

- Missing tool: with `AXE_CORE_PATH` unset (axe-core is not in the npx cache) the CLI printed `smoke: cannot run - missing tool(s): axe-core (set AXE_CORE_PATH)` plus the fix, exit 2. The test additionally proves the both-missing case hermetically (empty HOME, empty PATH).
- `--fail-on-axe --pages login`: exit 1 (2 serious).
- SIGINT mid-run: exit 130, temp dir removed, server child gone (this exposed the Playwright signal-handler bug below).
- No secret in output: grep for the generated-password prefix is 0; every printed line also passes through a redactor holding the generated secrets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Playwright's own SIGINT handler pre-empted cleanup**
- **Found during:** Task 2 verification (SIGINT demo)
- **Issue:** `chromium.launch` default `handleSIGINT: true` calls `process.exit()` immediately, leaving the server child and temp dir behind.
- **Fix:** launch with `handleSIGINT/SIGTERM/SIGHUP: false`; the harness's own handlers close the browser, stop the server, remove the temp dir, then exit 130/143/129. Re-proved: temp dir gone, no stray server.
- **Commit:** 5bee2fd

**2. [Rule 1 - Bug] A half-installed npx-cache Playwright was picked first**
- **Found during:** Task 2 (running without PLAYWRIGHT_PATH)
- **Issue:** `~/.npm/_npx/9833c18b2d85bc59/node_modules/playwright` has a `package.json` but throws "Unexpected end of input" on load; sorted first, it broke auto-resolution.
- **Fix:** `resolveTool` accepts `verify`/`onSkip`; the CLI verifies each candidate loads (Playwright exposes `chromium`; axe has `axe.min.js`) and prints a "skipping ... not loadable" warning. Unit-tested.
- **Commit:** 5bee2fd

### Judgement calls

- **Console allow-list (plan listed only a response allow-list).** Every page logs one `console.error` because `public/css/style.css` `@import`s Google Fonts and the served CSP (`server.js`) rejects it. Failing the run on that would make the "exit 0" criterion unreachable and hide new errors; so `pages.js` carries a documented `KNOWN_CONSOLE` allow-list, matches are printed as notes, and deleting the entry re-arms the check. server.js/style.css were not touched (not this plan's files).
- **axe-core source.** The orchestrator brief said axe-core was absent and to install a pinned copy into a scratch dir. A pre-existing copy exists at the host-local path the plan names (axe-core 4.11.1, file dated 2026-03-20, well over two weeks old), so nothing was installed and no scratch directory exists. The repo gains no dependency (static test asserts it).
- **Login via the real page** (per plan) rather than the API-cookie shortcut the phase-10 runner uses; sessions are carried to per-width contexts through `storageState`.

## Known Stubs

None.

## Findings handed to later phases (not fixed here)

- Google Fonts `@import` in `public/css/style.css` is blocked by the CSP on every page (one console.error per load). Allow-listed in `pages.js`.
- `public/login.html` has no `<main>`/`<header>`/`<nav>` landmark (`landmarks: []` for login).
- 37 axe critical+serious violations across the six pages (rules listed above) - Phase 19 input.
- `~/.npm/_npx/9833c18b2d85bc59` holds a corrupt playwright copy (host-local, harmless now that the resolver skips it).
- Test flake seen once in the first full-suite run: `test/concurrency-busy-retry.test.js` "CONC-01 (end-to-end)" asserted `201 !== 503` while the machine was under load; passes alone and in the second full run (1311/1311). The file is not touched by this plan.

## Threat model dispositions

T-12-60 mitigated (secrets never printed + redactor; grep 0), T-12-61 mitigated (temp MA_DATA_DIR, sha256 guard, `git status` guard, all unchanged), T-12-62 accepted (host-local pre-existing tools, package-name + loadability check, versions printed), T-12-63 mitigated (`.gitattributes` export-ignore; test proves `git archive --worktree-attributes HEAD scripts` contains no `scripts/smoke`).

## Verification

- `node --test test/smoke-harness.test.js` 6/6; full `node --test` 1311/1311, 0 failures (base 1305 + 6 new).
- `git status --porcelain -- data public/sent_emails` empty at both commits.

## Commits

- b6b168b feat(12-07): browser smoke tracer - isolated real-lane server, login-page sign-in, axe counts at 1440/390
- 5bee2fd feat(12-07): full IL page set + admin Users, export-ignore, static guard test, README

## Self-Check: PASSED

Files found: scripts/smoke/run.js, scripts/smoke/pages.js, scripts/smoke/README.md, .gitattributes, test/smoke-harness.test.js; commits b6b168b and 5bee2fd present.
