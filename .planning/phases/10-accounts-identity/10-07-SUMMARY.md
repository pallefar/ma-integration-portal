---
phase: 10-accounts-identity
plan: 07
subsystem: admin-console-ui
tags: [admin, users-tab, acct-01, temp-password, cache-bust, playwright, mnpi]

requires:
  - phase: 10-accounts-identity
    provides: "10-03: /api/admin/users list/create/PATCH/reset-password, 409 lastAdmin/self-disable; 10-01: GET /api/auth/mode accountsWritable; 10-06: change-password screen, account-menu, runner lanes + ctx.adminLogin()"
provides:
  - "admin console Users tab: list, add user, edit name/role, disable/enable, reset password, one-time temporary-password modal"
  - "window.maAdminUsersPolicy.accountWritesAllowed (fail-closed accountsWritable gate, same truth table as 10-06)"
  - "transitions.js ?v=1791700100 on all 18 pages that load it, applied by one scripted substitution"
  - "test/asset-cache-bust.test.js NEW_ASSETS guard over the six phase-10 assets"
  - "scripts/uat/phase10-scenarios/users-tab.js usersTabLifecycle (32 browser checks)"
affects: [10-08, 10-09, phase-11]

actuals:
  tokens: 11000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "policy object on window so a bare node:vm sandbox exercises the shipped writable decision"
    - "textContent-only rendering enforced by a source test (no HTML-string sink in the file)"
    - "confirm dialog helper whose refusal text stays inside the open modal"

key-files:
  created:
    - public/js/admin-users.js
    - public/css/admin-users.css
    - test/admin-users-ui.test.js
    - scripts/uat/phase10-scenarios/users-tab.js
    - .planning/phases/10-accounts-identity/evidence/users-tab-1440.jpg
    - .planning/phases/10-accounts-identity/evidence/temp-password-modal-1440.jpg
    - .planning/phases/10-accounts-identity/evidence/users-tab-390.jpg
    - .planning/phases/10-accounts-identity/evidence/add-user-modal-390.jpg
    - .planning/phases/10-accounts-identity/evidence/users-tab-results.json
  modified:
    - public/admin.html
    - public/js/admin.js
    - test/asset-cache-bust.test.js
    - "17 further public/*.html pages (transitions.js stamp only)"

key-decisions:
  - "Disable is never rendered on the signed-in admin's own row; Edit and Reset password still are (the server refuses a self-demotion of the last admin with a message, which the modal shows)"
  - "A 409 on create appends a hint that a timed-out earlier attempt may already have created the account, pointing at Reset password (the 10-03 audit-busy follow-up)"
  - "The temporary password input is blanked in the modal's onClose so Done, Escape and an overlay click all clear it"
  - "The stamp bump uses the public/*.html glob (see Deviations) and still touches exactly 18 files"

patterns-established:
  - "evidence shots mask the temporary password in the DOM before capture and wait for the admin.js panel fade to settle"

requirements-completed: [ACCT-01, ACCT-06]

coverage:
  - id: D1
    description: "Admin lists users (username, name, role, status, last sign-in), creates a user and sees the temporary password exactly once with a Copy button, edits role/name, disables and re-enables, resets a password - from the console (PRD acceptance 2, ROADMAP SC1)"
    requirement: ACCT-01
    verification:
      - kind: e2e
        ref: "scripts/uat/phase10-walk.js usersTabLifecycle (32 PASS / 0 FAIL)"
        status: pass
      - kind: unit
        ref: "test/admin-users-ui.test.js"
        status: pass
    human_judgment: false
  - id: D2
    description: "Role change is effective on the user's next request without re-login; disable ends the user's next navigation on /login.html; the only admin cannot demote itself and the server message is shown in the modal"
    requirement: ACCT-01
    verification:
      - kind: e2e
        ref: "usersTabLifecycle (role employee via GET /api/auth/me, /login.html after disable, 'At least one enabled admin must remain.')"
        status: pass
    human_judgment: false
  - id: D3
    description: "Users tab fits 1440 and 390 px with no horizontal scrolling; rows become stacked cards; modals inside the viewport"
    requirement: ACCT-01
    verification:
      - kind: e2e
        ref: "usersTabLifecycle 390px checks (scrollWidth 390 <= 390, modal left 32 / right 358)"
        status: pass
      - kind: manual
        ref: "evidence/users-tab-1440.jpg, users-tab-390.jpg, add-user-modal-390.jpg, temp-password-modal-1440.jpg reviewed"
        status: pass
    human_judgment: false
  - id: D4
    description: "accountsWritable !== true (or a failed probe) renders the list read-only with a start-real-deal note and no Add user / row write action"
    requirement: ACCT-01
    verification:
      - kind: unit
        ref: "test/admin-users-ui.test.js (maAdminUsersPolicy truth table, writable-gate structural assert)"
        status: pass
    human_judgment: false
  - id: D5
    description: "transitions.js carries ?v=1791700100 on all 18 pages; cache-bust test green with the six phase-10 assets registered"
    requirement: ACCT-06
    verification:
      - kind: unit
        ref: "test/asset-cache-bust.test.js (23 tests)"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-10-10
status: complete
---

# Phase 10 Plan 07: Admin console Users tab Summary

**An admin now runs the whole account lifecycle from a Users tab in the admin console - list, add with a one-time temporary password, edit, disable/enable, reset - with server refusals shown in the modal, read-only degradation on the committed demo control.db, and one scripted `transitions.js` stamp bump across all 18 pages.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-10-10
- **Tasks:** 3 (1 tracer + 2 auto)
- **Suite:** 1003 at base -> 1025, 0 failures (full `node --test` run at every commit); runner `usersTabLifecycle` 32/32 PASS; `git status --porcelain data/` empty, committed demo.db/control.db (+ -wal) sha256 unchanged

## Accomplishments

- **Users tab (D-10-03, D-10-10):** an "Access" rail group with a `data-tab="users"` button hidden until `window.__portalUser.role === 'admin'`, and a `#tab-users` panel using the existing switcher and `SECTION_META`. The table (Username / Name / Role / Status / Last sign-in / Actions) is built with `createElement` + `textContent` only; Status shows Active/Disabled plus a "Must change password" badge.
- **One-time temporary password (T-10-45):** the create and reset flows open a modal with the secret in a read-only input, a Copy button (`navigator.clipboard`, falling back to selecting the text), the "Shown once" warning and a Done that clears the value. The value is also blanked on Escape and overlay click via the modal's `onClose`, is never stored client-side, and the source test forbids storage/cookie/console use in the file.
- **Row actions:** Edit sends only changed keys; Disable/Enable and Reset password go through a confirm dialog that names the effect; 404 / 409 (lastAdmin, self-disable, duplicate) / 400 / 403 refusals render in the open modal as text.
- **accountsWritable gate (D-10-01):** `/api/auth/mode` is probed on first open; only `accountsWritable === true` renders Add user and row write actions, otherwise the list is read-only with "Accounts are read-only on the demo database. Start a real-deal host (start-real-deal) ...". A failed probe counts as not writable.
- **Browser proof:** `usersTabLifecycle` (real lane) created alice (pmo), signed her in with the temp password in a second context, forced rotation, role -> Employee visible on her next `/api/auth/me` with no re-login, disable ended her next navigation on `/login.html`, Enable + Reset password re-issued a one-time modal, the previous password stopped working, demoting the only admin showed "At least one enabled admin must remain.", 390 px layout fit, and `/api/admin/audit` held `user-create`, `user-update`, `user-password-reset` rows for alice with actor admin and no temporary password in any row.
- **Cache bust (UF-1, T-10-42):** `transitions.js?v=1791628622` -> `?v=1791700100` on exactly 18 pages (1 line each); `admin.js` -> `1791700202`, `admin-users.js` `1791700200`, `admin-users.css` `1791700201`.

## Task Commits

1. **Task 1 (tracer): Users tab lists accounts and creates one, temp password once** - `502da3a`
2. **Task 2: edit, disable/enable, reset-password + browser lifecycle proof** - `bc2679e`
3. **Task 3: transitions.js stamp bump on 18 pages + cache-bust registration** - `7bc8d42`

## Tracer feedback gate

The tracer `<verify>` (`admin-users-ui`, `client-xss-sinks`, `asset-cache-bust`; 30/30) and then the full suite (1012/1012) were re-run after the tracer was committed and before the expansion task - the autonomous form of the gate. Auto mode is not flagged, so this would normally be an interactive `checkpoint:human-verify`; the plan is `autonomous: true`, run by the wave orchestrator, and verification is fully automated (plus the screenshots above), so no human checkpoint was returned. Flagged for the orchestrator.

## Task 3 findings

- **Empty-array tolerance check (stated before registration, as the plan requires):** NOT tolerated. `test/asset-cache-bust.test.js` ends with a test asserting every FROZEN entry has non-empty `v21` and `before` arrays, and the per-asset ceiling is `Math.max(...[])` = `-Infinity`. Confirmed by reading the test source (a scratch run was unnecessary). The six phase-10 assets are therefore in a separate `NEW_ASSETS` list with a comment that they did not exist at v2.1.0 and have no frozen floor; each is held to "referenced at least once", "one consistent numeric stamp" and the no-unstamped-HTML-reference check. No v2.1.0 values were invented.
- **File count:** 18 files carried `transitions.js?v=1791628622` and now carry `?v=1791700100`: admin, assessments, capability-hub, dashboard, deal-wizard, due-diligence, employee, execution, index, insights, integration-excellence, leaders, org, overview, playbook, pmo, supporting, survey. `public/signage.html` only names transitions.js in a comment and is unchanged (`git diff` empty). The old stamp appears nowhere else under `public/`, `test/`, `scripts/` or `server.js`.
- `transitions.js` `before` now `[1784900002, 1791628622]`; the live stamp `1791700100` is strictly greater.

## Deviations from Plan

### Auto-fixed / intent-preserving

**1. [Plan intent] Stamp-bump command uses the `public/*.html` glob instead of `$(grep -l ...)`**
- **Issue:** the worktree sandbox refuses a command that embeds a command substitution in a perl argument list.
- **Fix:** `perl -pi -e 's/transitions\.js\?v=1791628622/transitions.js?v=1791700100/g' public/*.html` - still ONE command, and the substitution only matches the old stamp, so the resulting diff is exactly the 18 expected files at one line each (verified with `git diff --numstat`).
- **Commit:** 7bc8d42

**2. [Plan intent] `id` attributes on the modal inputs and 4 evidence shots committed**
- The scenario needs stable selectors (`#au-new-username`, `#au-edit-role`, ...); the evidence JPEGs and `users-tab-results.json` were copied into the phase `evidence/` directory as 10-06 did. Not listed in the plan's `files_modified`; no behaviour change.
- **Commit:** bc2679e

**3. [Plan intent] `test/admin-users-ui.test.js` extended in Task 2**
- Added the `reset-password` / `'PATCH'` source asserts and the "no Disable on the own row, row actions gated" structural test once those features existed. **Commit:** bc2679e

**4. [Test harness] Evidence shots wait for the admin.js panel fade**
- The first 1440 capture caught the card mid fade-in; the scenario now waits for `#tab-users.active` plus 600 ms. **Commit:** bc2679e

### Notes
- STATE.md, ROADMAP.md, server.js and committed `data/*.db` were not touched. The context-usage hook reported 88-89% while the token counter showed ~14.9M remaining; the plan was completed in full regardless.

## Issues Encountered

None blocking. The worktree sandbox rejected two compound git/perl invocations (see Deviation 1); they were split into plain commands.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. No new endpoints: the tab calls the existing 10-03 admin routes and `/api/auth/mode`. T-10-44 (textContent-only, enforced by test), T-10-45 (one-time, cleared on close, masked in evidence), T-10-46 (tab hidden unless admin; server remains the control), T-10-47 (audit rows verified by the scenario) and T-10-42 (single scripted bump + guard) are mitigated.

## Follow-ups for later plans / orchestrator

- **Duplicate-on-retry:** if a busy audit append makes `POST /api/admin/users` 503 after the account committed, a silent transitions.js retry gets 409 "username taken" and the temp password is lost. The modal now tells the admin to use Reset password, which is adequate, but the server-side ordering is the 10-03 follow-up and is unchanged.
- **Own-row Reset password** is offered (the plan only forbids Disable); resetting your own password from the console signs the admin out. Decide in review whether to hide it.
- `admin-users.js` is not yet covered by an i18n pass - strings are hardcoded EN by design (D-10-10).

## Self-Check: PASSED

- Created files exist: public/js/admin-users.js, public/css/admin-users.css, test/admin-users-ui.test.js, scripts/uat/phase10-scenarios/users-tab.js, evidence shots + users-tab-results.json
- Commits `502da3a`, `bc2679e`, `7bc8d42` present on `worktree-agent-ab47cb64c65a5835d`
- Acceptance greps: `innerHTML` in admin-users.js = 0; `data-tab="users"` in admin.html = 1; `admin.js?v=1791700202` in admin.html = 1; `transitions.js?v=1791628622` = 0 files; `transitions.js?v=1791700100` = 18 files; signage.html unchanged
- Full suite 1025/1025; usersTabLifecycle 32 PASS / 0 FAIL; `git status --porcelain data/` empty
