---
phase: 10-accounts-identity
plan: 06
subsystem: client-auth-ui
tags: [login, change-password, account-menu, sessions, playwright, mnpi, a11y]

requires:
  - phase: 10-accounts-identity
    provides: "10-01: GET /api/auth/mode {mode, demoOpen, accountsWritable}; 10-03: GET/DELETE /api/auth/sessions, mustChangePassword in login + /api/auth/me"
provides:
  - "mode-aware login page: no demo credential in markup, panel built only when /api/auth/mode says dev or demo-open, no redirect without a session"
  - "standalone /change-password.html (forced + voluntary), disabled with a start-real-deal note when accountsWritable is not true"
  - "transitions.js: 403 {mustChangePassword:true} marker and /api/auth/me handshake redirect to /change-password.html; account-menu loader"
  - "deal-switcher.js asks /api/auth/me first and never requests /api/deals without a session (WINDOWS #4)"
  - "header-menu Change password + My sessions (any role) at 1440 and 390 px, accountsWritable-aware"
  - "scripts/uat/phase10-walk.js Playwright runner with six lanes and a control.db + -wal sha256 guard"
affects: [10-05, 10-07, 10-08, 10-09, phase-11]

actuals:
  tokens: 27500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "policy objects on window (maLoginPolicy, maChangePasswordPolicy, maAccountMenuPolicy) so node:vm tests exercise the exact shipped decision logic with a bare sandbox"
    - "fail-closed mode probe: a missing/failed /api/auth/mode body means no demo panel and no account writes"
    - "runner lanes boot one child per lane; scenario modules declare __lanes and only ever add"

key-files:
  created:
    - public/js/login.js
    - public/change-password.html
    - public/js/change-password.js
    - public/js/account-menu.js
    - public/css/account.css
    - scripts/uat/phase10-walk.js
    - scripts/uat/phase10-scenarios/login-modes.js
    - scripts/uat/phase10-scenarios/forced-change-and-loop.js
    - scripts/uat/phase10-scenarios/self-service.js
    - test/client-account-surfaces.test.js
    - .planning/phases/10-accounts-identity/evidence/ (JPEG shots, results.json, walk.log)
  modified:
    - public/login.html
    - public/js/transitions.js
    - public/js/deal-switcher.js

key-decisions:
  - "The account menu mounts into BOTH the profile dropdown and .sidebar-footer; at 390 px the dropdown was reachable, so the sidebar copy is a redundancy next to Logout, not a necessity"
  - "The profile dropdown is closed when a modal opens (removes .show / .open) so it is not left behind the scrim"
  - "Throwaway user (not the shared admin) is used for the change-password submit so scenarios sharing a lane never fight over the admin password"
  - "Runner git-status guard is scoped to `-- data` (evidence screenshots under .planning legitimately change the tree)"

patterns-established:
  - "client policy object + vm test; the DOM binding exits early when `document` is absent"
  - "evidence screenshots are taken before any secret is typed (T-10-43)"

requirements-completed: [ACCT-06, ACCT-07, ACCT-04]

coverage:
  - id: D1
    description: "Real-mode login page shows no demo credentials (no panel, no password text in DOM); dev and demo-open show the panel; demo-open anonymous login page stays put for 4 s"
    requirement: ACCT-07
    verification:
      - kind: e2e
        ref: "scripts/uat/phase10-walk.js realLoginHasNoDemoCredentials/devLoginShowsDemoPanel/demoOpenLoginStays (5 lane runs)"
        status: pass
      - kind: unit
        ref: "test/client-account-surfaces.test.js (login.html, maLoginPolicy truth table)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Forced change-password: temp-password login lands on /change-password.html, /index.html bounces back, 12-char rule, change lands on /; 403 marker + handshake client redirects proven with vm harness"
    requirement: ACCT-04
    verification:
      - kind: e2e
        ref: "scripts/uat/phase10-walk.js forcedChangeLandsOnChangePassword"
        status: pass
      - kind: unit
        ref: "test/client-account-surfaces.test.js (fetch-wrapper 403 cases, handshake cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "WINDOWS #4: cookie-less demo-open tab makes <= 2 navigations in 6 s and no /api/deals request"
    requirement: ACCT-07
    verification:
      - kind: e2e
        ref: "scripts/uat/phase10-walk.js demoOpenAnonymousNoLoop"
        status: pass
      - kind: unit
        ref: "test/client-account-surfaces.test.js (deal-switcher cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Self-service: My sessions lists own sessions with This device marked and ends another session (other context bounced to login); Change password modal works; both fit 390 px with scrollWidth <= 390"
    requirement: ACCT-06
    verification:
      - kind: e2e
        ref: "scripts/uat/phase10-walk.js selfServiceSessions"
        status: pass
    human_judgment: false
  - id: D5
    description: "accountsWritable:false (committed control.db): Change password disabled + note, sessions list without End buttons, change-password page disabled; committed control.db and -wal unchanged"
    requirement: ACCT-06
    verification:
      - kind: e2e
        ref: "scripts/uat/phase10-walk.js selfServiceReadOnly (dev-committed lane)"
        status: pass
      - kind: unit
        ref: "test/client-account-surfaces.test.js (maAccountMenuPolicy, maChangePasswordPolicy truth tables)"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-10-10
status: complete
---

# Phase 10 Plan 06: Client account surfaces Summary

**Login page honest about its mode (no credentials in real mode, no demo-open redirect loop), a standalone forced change-password screen with client redirects on login/handshake/403 marker, and shared header-menu "Change password" and "My sessions" that work at 390 px and degrade to a read-only note when the committed control.db is active - all proven in real Chromium across six runner lanes.**

## Performance

- **Duration:** ~70 min
- **Completed:** 2026-10-10
- **Tasks:** 3 (1 tracer + 2 auto)
- **Files:** 13 changed vs base (10 created, 3 modified) plus evidence
- **Suite:** 945 base -> 966, 0 failures; `git status --porcelain data/` empty; full runner 94/94 PASS

## Accomplishments

- **Login (D-10-08c, T-10-38):** `login.html` lost its demo block and inline script. `login.js` exposes `maLoginPolicy` and builds the demo panel with DOM nodes only when `/api/auth/mode` is dev or demo-open; a failed probe renders nothing. A signed-in user is routed through `landingFor()`; with no session it never redirects, in any mode.
- **WINDOWS #4 (T-10-40):** `deal-switcher.js` fetches `/api/auth/me` first and skips `/api/deals` without a session, and the login page no longer bounces to `/`. Browser proof: a cookie-less demo-open tab on `/execution.html` stayed on it with 2 navigations in 6 s and made no `/api/deals` request.
- **Forced rotation, client half (D-10-05, T-10-41):** `change-password.html/js` (standalone, no app chrome); `transitions.js` adds a 403 `mustChangePassword === true` branch in the fetch wrapper (returns the original response) and a handshake redirect. Proven by vm harness (the 10-05 gate is not in this wave's base) and in-browser through the handshake path.
- **Self-service (D-10-07, T-10-39):** `account-menu.js` + `account.css`; modals reuse `.deal-modal`; Escape/overlay close, focus in/out, Tab trap; sessions rendered with `textContent` only (a source test forbids HTML-string sinks in the three new files).
- **accountsWritable gating (D-10-01):** the same truth table in `change-password.js` and `account-menu.js`; false/failed probe disables Change password, hides End-session buttons and shows the start-real-deal note. Proven on the committed-control lane with the control.db + -wal guard.
- **Runner:** lanes `real`, `real-handcopied`, `dev`, `demo-open`, `dev-committed`, `demo-committed`; real lane runs bootstrap-admin and exposes `adminLogin()` (one forced rotation per lane run), `preBootstrapUserCount`, `newPage`, `api`, `login`, `shot`. Guard hashes `data/control.db` + `-wal` (absent == empty) around committed lanes and again around the whole run.

## Task Commits

1. **Task 1 (tracer): mode-aware login + Playwright runner** - `f378577`
2. **Task 2: forced change-password screen, redirects, deal-switcher loop fix** - `35e2825`
3. **Task 3: header-menu Change password + My sessions, accountsWritable-aware** - `266e181`

## Tracer feedback gate

The tracer `<verify>` (client test file + the three login scenarios across five lane runs) was re-run end-to-end after the tracer commit and passed (54/54) before any expansion task - the autonomous form of the gate. Auto mode is not flagged in config, which would normally make this an interactive `checkpoint:human-verify`; the plan is `autonomous: true`, run by the wave orchestrator that expects a committed SUMMARY, and the verification is fully automated, so no human checkpoint was returned. Flagged so the orchestrator can decide whether a human look is wanted (the screenshots are in `.planning/phases/10-accounts-identity/evidence/`).

## Deviations from Plan

### Auto-fixed / intent-preserving

**1. [Plan intent] Extra scenario `selfServiceReadOnly` (dev-committed lane)**
- The plan's must-have for accountsWritable:false had only vm-level proof listed in Task 3's scenario text. A browser scenario was added so the disabled/no-End-button behaviour is shown on the committed-control lane (and that lane is exercised by a scenario that signs in).
- **Files:** scripts/uat/phase10-scenarios/self-service.js - **Commit:** 266e181

**2. [Plan intent] 390 px padding on login.html and change-password.html**
- The cards were edge-to-edge at 390 px (fit, but cramped). A `@media (max-width:480px)` rule adds body padding. Visual only.
- **Files:** public/login.html, public/change-password.html - **Commit:** 35e2825

**3. [Plan intent] Dropdown closed on modal open**
- Discovered in the 1440 screenshot: the profile dropdown stayed open behind the scrim. `openModal()` removes `.show`/`.open`.
- **Files:** public/js/account-menu.js - **Commit:** 266e181

**4. [Plan intent] Runner `git status` guard scoped to `data/`**
- The plan says "git status --porcelain captured before/after"; evidence shots are written under `.planning/`, which would always differ. The guard is `git status --porcelain -- data`.
- **Files:** scripts/uat/phase10-walk.js - **Commit:** f378577

### Notes
- No STATE.md, ROADMAP.md, server.js, committed `data/*.db` or any page's `?v=` stamp was touched. New stamps used as specified: deal-switcher 1791700101, account-menu 1791700102, account.css 1791700103, login.js 1791700104, change-password.js 1791700105. 10-07 Task 3 owns the scripted transitions.js bump and cache-bust registration.
- The `real-handcopied` lane was smoke-booted once (it boots in real mode at this base; the boot guard that refuses published demo credentials is 10-05's) with a temporary scenario that was removed; no scenario currently targets it.

## Issues Encountered

- First Task 2 run threw "Execution context was destroyed" in a `page.evaluate` poll during the handshake redirect; the scenario helper now polls `page.url()` instead. Test-harness only.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. No new endpoints; new client surface reads `/api/auth/mode`, `/api/auth/me`, `/api/auth/sessions`, `/api/auth/change-password`, all existing.

## Follow-ups for later plans / orchestrator

- **10-05 merge:** once the server 403 gate lands, `forcedChangeLandsOnChangePassword` still passes by construction (login routing + handshake); it would also be worth one scenario that calls a non-allowed API as a must-change user and asserts the 403 marker produces the redirect in a real browser (only vm-proven here).
- **10-07 Task 3** must bump transitions.js on all 18 pages (the deal-switcher and account-menu loader stamps inside transitions.js are new in this plan) and register the new assets in `test/asset-cache-bust.test.js`.
- The 10-03 follow-up about a busy audit append after account create (temp password lost on a silent retry) is not exercised by anything shipped here; the admin Users-tab modal (a later plan) is where that decision lands.
- Dev/demo login still shows the published demo password in the panel by design (maintained showcase); real mode ships none of it in the DOM, though `login.js` source carries the constant (it is public in the repo).

## Self-Check: PASSED

- Created files exist: public/js/login.js, public/change-password.html, public/js/change-password.js, public/js/account-menu.js, public/css/account.css, scripts/uat/phase10-walk.js, scripts/uat/phase10-scenarios/{login-modes,forced-change-and-loop,self-service}.js, test/client-account-surfaces.test.js
- Commits `f378577`, `35e2825`, `266e181` present on `worktree-agent-a8f22b98089996a26`
- Acceptance greps: `TEdemo` in login.html = 0; `<script>` in login.html = 0; `deal-switcher.js?v=1791700101` in transitions.js = 1; `mustChangePassword` in transitions.js >= 2; `innerHTML` in account-menu.js = 0; `accountsWritable` in account-menu.js = 3 and change-password.js = 4
- Full suite 966/966; runner 94 PASS / 0 FAIL; `git status --porcelain data/` empty
