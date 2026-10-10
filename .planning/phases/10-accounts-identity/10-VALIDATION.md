---
phase: 10
slug: accounts-identity
status: signed-off
nyquist_compliant: true
deferrals: [DEFERRED-REL-02]
suite: { tests: 1055, pass: 1055, fail: 0, runs: 1 }
soak: { verdict: PASS, acknowledged: 4288, lost: 0, audit_rows: 4288, bounded_503: 21 }
runner: { pass: 184, fail: 0, lanes: 6 }
phase9_walk: { normal: "350 PASS / 0 FAIL", demo_open: "18 PASS / 0 FAIL" }
signed: 2026-10-10
plan: 10-09
---

# Phase 10 - Validation (Accounts & Identity)

Signed against the written contract: `.planning/reviews/v3.0/PHASE-10-PRD.md` (acceptance 1-6),
ROADMAP Phase 10 success criteria SC1-5, requirements ACCT-01..07 / COLLAB-02 / OPS-08 and the
locked decisions D-10-01..D-10-10 in `10-CONTEXT.md`. Every PASS names a test file (and test
name where one exists) or an evidence file. Anything not proven is under "Open items".

Evidence directory: `.planning/phases/10-accounts-identity/evidence/` (README.md maps each
screenshot to its scenario). Runner log: `evidence/phase10-walk.log` (184 PASS / 0 FAIL, six
lanes, committed `data/demo.db` + `data/control.db` (+ `-wal`) sha256 unchanged, `git status
--porcelain -- data` empty). Regression results are recorded in `evidence/README.md`. The
runner and suite figures describe the post-verification re-run (see "Post-verification
correction" below); the soak and Phase 9 walk figures are from the plan 10-09 sign-off run
(re-run independently by the verifier: soak PASS, Phase 9 walk 350/0 and 18/0).

## PRD acceptance

| # | Acceptance | Verdict | Proof |
|---|------------|---------|-------|
| 1 | `MA_MODE=real` on an empty data dir boots with zero users, `/api/auth/mode` says real, login page shows no demo credentials, bootstrap-admin creates the admin, committed DB sha256 and `git status` unchanged | PASS | scenario `realEmptyDirBootstrap` @ real (phase10-walk.log; shots `acceptance1-login-real-1440/-390.jpg`); `test/real-mode-boot.test.js` (mode real / zero accounts / committed files byte-identical); `test/bootstrap-admin.test.js` (creates exactly one admin); runner `data-integrity` rows |
| 2 | Admin creates user -> temp-password login -> forced change -> role change / disable bind on next request; last-admin guard; audit trail; no response carries hash/salt | PASS | `test/user-admin.test.js` ("tracer ...", "disable: the live cookie 401s ...", "last-admin guard ...", "audit: user-create/user-update/user-password-reset rows ...", "no response body ever carries a hash/salt key ..."); `test/forced-rotation.test.js`; scenarios `usersTabLifecycle` (role visible on next `/api/auth/me`, disable ends next navigation, audit rows, no temp password in audit) and `forcedChangeLandsOnChangePassword`; `realEmptyDirBootstrap` asserts the listing has no hash/salt/password key |
| 3 | Real-mode instance on a hand-copied committed control.db serves only login/auth/healthz | PASS | scenario `handCopiedControlDbLockdown` @ real-handcopied (healthz 200, data API 403 credentialLockdown, `/index.html` lockdown page at 1440 and 390 - shots `acceptance3-lockdown-*.jpg`, karen sign-in lands on `/change-password.html`, 13 same-origin responses none >= 400); `test/credential-lockdown.test.js` ("locked: only /healthz, the login page + assets and /api/auth/* are served", "remedy: ...") |
| 4 | alice x9 does not block bob; Secure cookie under TRUST_PROXY+https; N=2^17 hashes + lazy rehash | PASS | `test/login-throttle.test.js` ("HTTP: nine wrong passwords for alice do not block bob; alice stays 429 even with the right password"); `test/auth-transport.test.js` ("cookie: Secure behind TRUST_PROXY + X-Forwarded-Proto https, even with ENABLE_HSTS unset"); `test/password-rehash.test.js` ("new accounts: create, reset and change all produce N=131072 hashes", "legacy hash: a successful sign-in rewrites it to the current format ...") |
| 5a | DB files 0600 / dirs 0700 under umask 022 | PASS | `test/file-modes.test.js` ("file-modes (A) ... 0600 in 0700 directories, sidecars 0600", "(C) a real-mode instance under umask 022 holds only 0700 directories and 0600 files, including a freshly created deal"); ran in both full-suite passes, 0 skipped |
| 5b | `compression` >= 1.8.2 | DEFERRED | **DEFERRED-REL-02** recorded in `10-08-SUMMARY.md` ("DEFERRED-REL-02" section): package-legitimacy gate verdict `SUS` / `too-new`, checked 2026-10-10T12:32Z, gate clears **2026-10-11T11:17Z**; installed tree is `compression@1.8.1`; nothing installed, `package.json`, `package-lock.json`, `node_modules` untouched. Owner: REL-02 / Phase 21, or an earlier `/gsd-quick` once `package-legitimacy check compression` reports OK. Open advisory GHSA-vc2v-76pw-4v95 (HIGH, memory leak on premature close) remains |
| 6 | Suite green (>= 878 base); demo launchers and dev flow unchanged; Playwright smoke at 1440/390 | PASS | `node --test`: 1055/1055, 0 failures, 0 skipped (post-verification re-run; 1038/1038 twice at the original sign-off, before the Phase 10 review fixes added 17 tests); `test/launcher-mode.test.js` (demo launchers never mention `MA_MODE`); runner lanes `dev`, `demo-open`, `dev-committed`, `demo-committed` all PASS; Phase 9 walk 350 PASS and `--demo-open` 18 PASS (no superseded check needed); smoke shots at 1440 and 390: login (`login-real-*`), change password (`forced-change-*`, `change-password-modal-390`), My sessions (`sessions-*`), Users tab (`users-tab-*`) |

## ROADMAP success criteria

| SC | Verdict | Proof |
|----|---------|-------|
| SC1 admin creates/disables/enables, sets roles, resets passwords from the console; disable and role change bind next request; audited | PASS | `test/user-admin.test.js`; `test/admin-users-ui.test.js`; scenario `usersTabLifecycle` (33 checks, evidence `users-tab-1440/-390.jpg`, `temp-password-modal-1440.jpg`) |
| SC2 bootstrap CLI; `start-real-deal.*` boots `MA_MODE=real` on its own data dir without demo accounts; committed DBs never written | PASS | `test/bootstrap-admin.test.js`; `test/real-mode-boot.test.js`; `test/real-mode-guards.test.js`; `test/launcher-mode.test.js`; `test/db-artifact-exclusion.test.js`; runner data-integrity + lane guards |
| SC3 no demo password verifies in real mode; server refuses beyond login/change-password; login shows demo creds only in demo-open/dev; deal creation on the committed control path refused outside real mode | PASS | `test/credential-lockdown.test.js`; `test/lockdown-asset-allowlist.test.js`; scenarios `realLoginHasNoDemoCredentials`, `handCopiedControlDbLockdown`, `devLoginShowsDemoPanel`, `demoOpenLoginStays`; `test/real-mode-guards.test.js` ("guards (A): POST /api/deals and POST /api/auth/change-password are refused 403 on the committed control.db") |
| SC4 8 wrong passwords do not lock out a colleague; temp passwords force a change; hashes upgrade; users change password and end own sessions from the UI | PASS | `test/login-throttle.test.js`; `test/forced-rotation.test.js`; `test/password-rehash.test.js`; `test/self-sessions.test.js`; `test/client-account-surfaces.test.js`; scenario `selfServiceSessions` (`sessions-1440/-390.jpg`, `change-password-modal-390.jpg`) |
| SC5 new DB files 0600 in 0700 directory under any umask | PASS | `test/file-modes.test.js` |

## Requirements

| ID | Verdict | Proof |
|----|---------|-------|
| ACCT-01 | PASS | `test/user-admin.test.js`; `test/admin-users-ui.test.js`; `usersTabLifecycle` |
| ACCT-02 | PASS | `test/bootstrap-admin.test.js` (create-if-none, no argv password, `--force-reset-admin`); `realEmptyDirBootstrap` |
| ACCT-03 | PASS | `test/real-mode-boot.test.js`; `test/real-mode-guards.test.js`; `test/launcher-mode.test.js`; `realEmptyDirBootstrap` |
| ACCT-04 | PASS | `test/forced-rotation.test.js`; `test/password-rehash.test.js`; `forcedChangeLandsOnChangePassword` |
| ACCT-05 | PASS | `test/login-throttle.test.js`; `test/auth-transport.test.js` |
| ACCT-06 | PASS | `test/self-sessions.test.js`; `test/client-account-surfaces.test.js`; `selfServiceSessions`, `selfServiceReadOnly`, `committedControlAccountWritesHidden` |
| ACCT-07 | PASS | `test/credential-lockdown.test.js`; `test/lockdown-asset-allowlist.test.js`; `handCopiedControlDbLockdown`; `realLoginHasNoDemoCredentials` |
| COLLAB-02 | PASS | `test/session-identity-reread.test.js` ("COLLAB-02 grants ...", "COLLAB-02 account ..."); `test/user-admin.test.js` (role change binds with the same cookie); `usersTabLifecycle` |
| OPS-08 | PASS | `test/file-modes.test.js` |

## Locked decisions

| Decision | Verdict | Proof |
|----------|---------|-------|
| D-10-01 mode contract, committed files never written, committed-control writes refused | PASS | `test/real-mode-boot.test.js`; `test/real-mode-guards.test.js` (A)-(D); `test/accounts-writable-gate.test.js`; `committedControlAccountWritesHidden` @ dev-committed + demo-committed (POST `/api/admin/users` -> 403 `committedControlDb`, guard hashes of `data/control.db` + `-wal` unchanged) |
| D-10-02 bootstrap-admin | PASS | `test/bootstrap-admin.test.js` |
| D-10-03 admin user CRUD, no delete, last-admin guard, audited, no hash/salt | PASS | `test/user-admin.test.js` |
| D-10-04 role/disabled re-read per request | PASS | `test/session-identity-reread.test.js`; `test/user-admin.test.js` |
| D-10-05 forced rotation, scrypt N=131072 + lazy rehash, min length 12 in real mode | PASS | `test/forced-rotation.test.js`; `test/password-rehash.test.js`; `test/bootstrap-admin.test.js` ("passwords: checkNewPassword policy ...") |
| D-10-06 per-account + per-source throttle, Secure cookie decoupled from HSTS, proxy docs | PASS | `test/login-throttle.test.js`; `test/auth-transport.test.js`; `test/launcher-mode.test.js` (DEPLOYMENT.md names TRUST_PROXY / PUBLIC_BASE_URL / ENABLE_HSTS) |
| D-10-07 header-menu Change password + My sessions, works at 390 | PASS | `test/self-sessions.test.js`; `test/client-account-surfaces.test.js`; `selfServiceSessions` (390 px checks, `sessions-390.jpg`) |
| D-10-08 demo credentials unusable in real mode; mode-aware login; WINDOWS #4 loop fixed | PASS | `test/credential-lockdown.test.js`; `test/lockdown-asset-allowlist.test.js`; `handCopiedControlDbLockdown`; `realLoginHasNoDemoCredentials`; `demoOpenAnonymousNoLoop` (evidence `demo-open-anonymous-1440.jpg`) |
| D-10-09 0600/0700 under any umask | PASS | `test/file-modes.test.js` |
| D-10-10 compression >= 1.8.2 + DEPLOYMENT.md/README for three modes | DEFERRED (dependency half, DEFERRED-REL-02); docs half PASS | docs half: `test/launcher-mode.test.js` (DEPLOYMENT.md x2, README, launchers). Dependency half: DEFERRED-REL-02 (see acceptance 5b) |

## WINDOWS ledger

**WINDOWS #4** (DEMO_OPEN cookie-less redirect loop) is marked `fixed` (`gsd-tools windows fixed 4`),
citing scenario `demoOpenAnonymousNoLoop` @ demo-open (cookie-less `/execution.html` tab: <= 2
navigations in 6 s, no `/api/deals` request; evidence `demo-open-anonymous-1440.jpg`) and
`demoOpenLoginStays` @ demo-open and demo-committed (login page stays put). Unit proof in
`test/client-account-surfaces.test.js` (deal-switcher cases).

## Deviations & discretion calls

1. **Account writes refused on the committed control.db outside real mode.** D-10-01: dev/demo on
   the committed `data/control.db` answers `accountsWritable:false` and every account write is
   `403 {committedControlDb:true}`; the UI renders no control that could only fail. (`test/accounts-writable-gate.test.js`, `committedControlAccountWritesHidden`.)
2. **Lockdown answers 403, never 503** (D-10-08): a 503 would be silently retried by the busy-retry client.
3. **`MA_MODE` boot refusals:** an unrecognised value, `MA_MODE=real` + `DEMO_OPEN=1`, `MA_DATA_DIR` or
   `MA_CONTROL_DB_PATH` on the committed files all refuse to boot (`test/real-mode-guards.test.js` (C)).
4. **Operator CLIs default `MA_MODE=real` only when run directly** (`require.main`), never on `require()`.
5. **`login.html` inline script externalised** to `public/js/login.js` so the page carries no credential and the lockdown allowlist is exact.
6. **`compression` bump deferred** (DEFERRED-REL-02): gate verdict `too-new`; no package was installed or substituted.
7. **demo-open lane variant (10-09).** The plan's `committedControlAccountWritesHidden` expected an
   admin sign-in in `demo-committed`; under `DEMO_OPEN=1` the server ignores session cookies
   (`/api/auth/me` -> `authEnabled:false, user:null`), so there is no signed-in user and no account
   surface at all. The scenario proves that stronger form there (no `[data-am]` items, admin
   console unreachable cookie-less and no Users tab, change-password page not enabled, POST
   `/api/admin/users` -> 401). The signed-in checks run in `dev-committed`.
8. **Soak harness fix (10-09).** `scripts/soak.js` fabricated `soak-worker-N` sessions with no
   account row; with identity re-read per request (D-10-04) every write was 401. The harness now
   seeds a credential-less admin account per worker via `controlStore.createAccount` (commit `ec75065`).
   Product code untouched; soak PASS afterwards.

## Post-verification correction (2026-10-10)

`10-VERIFICATION.md` (status `gaps_found`, 15/16) found the Phase 10 runner red on HEAD: the
WR-C01 check added by review fix `1d92eb8` compared `#au-temp-password` with the real secret
after the scenario had already masked it to `••••` for the T-10-45 screenshot, so it could never
pass (`phase10-walk.js` exited 1 at 179 PASS / 1 FAIL, so the originally signed "179 PASS / 0
FAIL" no longer reproduced; 179 / 0 was the count before that check existed). The product
behaviour was correct throughout.

Fix `e7a36bf` (`scripts/uat/phase10-scenarios/users-tab.js` only; no product code, no committed
data): the secret is read unmasked and the sticky contract is asserted against the real value,
counting only when the Escape and the scrim click demonstrably reached the page; masking now
happens only inside `shot()`, which refuses to write a screenshot unless the secret is provably
absent from the DOM. Four checks were added to `usersTabLifecycle` (shown once: one DOM
rendering, and a fresh Users listing never carries it; masked in the DOM before the
temp-password screenshot; reset password wiped on Done with no copy left). Each assertion was
mutation-tested against a deliberately broken modal (non-sticky, blank-on-Escape, no wipe on
Done, duplicate rendering) and failed as intended.

Corrected state: `phase10-walk.js` **184 PASS / 0 FAIL** over six lanes (`usersTabLifecycle`
33/33), committed `data/demo.db` + `data/control.db` (+ `-wal`) sha256 unchanged, `git status
--porcelain -- data` empty; `node --test` 1055/1055. All 30 screenshots were re-viewed:
no real credential in any shot.

## Open items

- **DEFERRED-REL-02 (owner: REL-02 / Phase 21, or an earlier `/gsd-quick` from 2026-10-11T11:17Z):**
  bump `compression` to 1.8.2 per the recipe in `10-08-SUMMARY.md`; remove the "compression
  dependency" bullet from DEPLOYMENT.md Known limitations in the same change. `REQUIREMENTS.md`
  REL-02 still says the bump is delivered in Phase 10 and needs its traceability updated
  (orchestrator-owned, not edited here).
- **Human prose review** of DEPLOYMENT.md / README wording (10-08 coverage D4, `human_judgment`): the
  tests assert the contract items and env names, not readability. Merged UI tab label is "Users"
  (verified in `admin.html` `data-tab="users"` and the Users-tab shots).
- **Cosmetic (not blocking):** at 390 px in the read-only (committed-control) Users tab each account
  card still shows an empty "Actions" label (`committed-readonly-users-390.jpg`).
- **Own-row "Reset password"** is offered to the signed-in admin and signs them out on use (10-07
  follow-up); decide in review whether to hide it.
- **Duplicate-on-retry follow-up** (10-03 / 10-07): a busy audit append after account create can lose a
  temp password on a silent retry; the modal points the admin at Reset password.
- **WINDOWS #2 and #3** (Phase 9, org delete/edit surfaces) remain open and are not Phase 10 scope.
