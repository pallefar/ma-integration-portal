---
phase: 10-accounts-identity
verified: 2026-10-10T13:38:23Z
verified_against: bb71baf
status: gaps_found
score: 15/16 must-haves verified
behavior_unverified: 0
overrides_applied: 0
verification: automated — Fable-reviewed per standing directive (2026-08-08)
suite: { runs: 2, tests: 1055, pass: 1055, fail: 0, skipped: 0 }
runners:
  phase10_walk: "179 PASS / 1 FAIL (the one FAIL is the self-defeating assertion in gap 1; every product check passed)"
  phase9_walk: "350 PASS / 0 FAIL"
  phase9_walk_demo_open: "18 PASS / 0 FAIL"
  soak_15s: "PASS — acknowledged=824 lost=0 audit 1:1, conflict lane 73 acked / 178 real 409s, version reconciles"
  verifier_probes: "probe.js 164/170 (6 probe-side errors re-run as probe2.js 13/13), probe-ui.js 38/38 (Chromium 1440 + 390)"
committed_data: "data/control.db e83f049e… / data/demo.db 63d552c4… unchanged; git blob == HEAD blob; `git status --porcelain -- data` empty before and after every run"
gaps:
  - truth: "PRD acceptance 6 — the phase's Playwright acceptance runner (scripts/uat/phase10-walk.js) is green on HEAD"
    status: partial
    reason: "The WR-C01 browser check added by the review fixer (1d92eb8) can never pass: scripts/uat/phase10-scenarios/users-tab.js:78-83 (takeTempPassword) masks #au-temp-password to '••••' for the T-10-45 screenshot, then line 117-118 asserts the input still equals the original secret. The runner therefore exits 1 on HEAD (179 PASS / 1 FAIL), and 10-VALIDATION.md's signed '179 PASS / 0 FAIL' no longer reproduces. The product behaviour it was meant to prove is correct (verified by the verifier's own Chromium run, 38/38 at 1440 and 390: Escape, scrim corner and overlay-beside-box clicks all leave the temp-password modal open with the value intact; only 'I have saved it' closes it)."
    artifacts:
      - path: "scripts/uat/phase10-scenarios/users-tab.js"
        issue: "lines 78-83 mask the value before lines 115-118 compare against the unmasked secret — assertion is self-defeating"
      - path: ".planning/phases/10-accounts-identity/10-VALIDATION.md"
        issue: "runner: { pass: 179, fail: 0 } is stale against HEAD (actual 179/1)"
    missing:
      - "Compare the input against the masked sentinel ('••••'), or take the screenshot after the sticky check and mask afterwards, so the check asserts `inputValue === '••••'` (value intact means: not blanked by onClose)"
      - "Re-run `PLAYWRIGHT_PATH=… node scripts/uat/phase10-walk.js` and refresh evidence/results.json + the runner line in 10-VALIDATION.md"
deferred:
  - truth: "D-10-10 / PRD acceptance 5b — compression ≥ 1.8.2 re-committed in node_modules"
    addressed_in: "Phase 21"
    evidence: "REQUIREMENTS.md:124 REL-02 ('gated by the supply-chain age check until 2026-10-11T11:17Z and lands no later than Phase 21 — Phase 10 plan 10-08 records DEFERRED-REL-02'); 10-08-SUMMARY.md §DEFERRED-REL-02 (verdict too-new, gate date, sha512, follow-up owner); DEPLOYMENT.md Known limitations; installed tree is compression@1.8.1 and nothing in the phase depends on 1.8.2"
human_verification: []
---

# Phase 10: Accounts & Identity — Verification Report

**Phase Goal:** Real people can be given real accounts and a real-deal host cannot run on published credentials — the first half of the trust foundation, and the mode contract everything else relies on.
**Verified:** 2026-10-10T13:38:23Z against `bb71baf` (60 commits since `943fe2f`; every commit hash cited in the nine SUMMARYs exists)
**Status:** gaps_found — all product must-haves verified; one evidence-tooling defect (gap 1)
**Re-verification:** No — initial verification
**Method:** goal-backward from ROADMAP SC1–5, PRD acceptance 1–6, locked decisions D-10-01..10 and ACCT-01..07 / COLLAB-02 / OPS-08. SUMMARY claims were not used as evidence; every row below cites code the verifier read or a run the verifier executed in its own process on isolated temp directories (umask 022).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence (verifier's own) |
|---|-------|--------|---------------------------|
| 1 | SC1 — admin creates/disables/re-enables, sets roles, resets passwords from the console; disable/role change binds on the user's NEXT request; every action audited | ✓ VERIFIED | `server.js:1304-1422` (create / list / reset / PATCH, each with inline `refuseNonAdmin` + `refuseCommittedControlWrite`), `db/controlStore.js:173-199` (`updateAccountGuarded`, BEGIN IMMEDIATE), `server.js:378-396` (`resolveSessionIdentity` re-reads role+disabled per request, revokes on disabled). probe.js A10–A18: create → temp pw (20 chars, unambiguous alphabet), mass-assigned `hash/salt/mustChangePassword/disabled` stripped by zod, PATCH role seen on the same cookie's next `/api/auth/me`, disable → 401 next request + sessions deleted + login refused, re-enable needs fresh sign-in, reset revokes sessions, audit.db carries `user-create/user-update/user-password-reset/password-change/session-end-own/bootstrap-admin` with no temp password or hash string. Browser: phase10-walk `usersTabLifecycle` 31/32 (the 1 FAIL is gap 1) + probe-ui.js 38/38. |
| 2 | SC2 — bootstrap CLI as service user; `start-real-deal.*` boot `MA_MODE=real` on own gitignored dir seeded without demo accounts; committed `control.db`/`demo.db` never written; `git status` clean | ✓ VERIFIED | `db/dbFiles.js:62-93` (mode resolution, refuses `REAL`/`prod`, `real`+`DEMO_OPEN`, `MA_DATA_DIR == data/`), `db/realDataDir.js:96-126` (seed: users+deals emptied, integrity_check, atomic link publish, 0700), `db/dbFiles.js:291-297` (openDbFile throws on a committed path in real mode), `start-real-deal.command:29-35` / `.bat:36-42` (export MA_MODE=real, clear DEMO_OPEN), `.gitignore:79 data/real/`. probe.js A1–A7: empty dir boots, 0 users / 0 deals seeded, demo.db copied, bootstrap refuses argv/short/demo/non-TTY, creates `admin` mustChangePassword with `scrypt$n=131072,r=8,p=1$…`, refuses when users exist, `cli:<os-user>` audit row, password never echoed. Lane E: 12 boot refusals (committed dir, `data/real/..`, trailing slash, relative `data`, symlinked dir, symlinked control.db, `MA_CONTROL_DB_PATH`/`MA_DEMO_DB_PATH` committed via override, `./data/../data`). Committed blobs == HEAD blobs after everything; `git status --porcelain -- data` empty. |
| 3 | SC3 — no account verifies the demo password in real mode; server serves only login/change-password/healthz if one does; login page shows demo creds only in demo-open/dev; real-deal creation on the committed control path refused outside real mode | ✓ VERIFIED | `lib/credentialLockdown.js` (boot scan + login-time `noteDemoLogin`, canonical-path allowlist, 403 never 503), mounted `server.js:229-243` before body parsers/static; `public/js/login.js:28-41` policy; `server.js:1512-1524` POST /api/deals refusal. probe.js lane C (hand-copied committed control.db): banner logged; 29 path probes — `/`, `/index.html`, `/LOGIN.html`, `/login.html/`, `//login.html`, `/js/transitions.js`, `/healthz/`, `/api/auth/../admin/users`, `/api/auth/..%2Fadmin/users`, `/api/auth%2F..%2Fadmin/users`, `/api/auth/%2e%2e/…`, `/API/auth/mode` all 403/404; only the 7 allowlisted assets, `/healthz`, `/api/auth/*` serve; each of the 4 demo accounts signs in → forced mustChange → fenced → rotates; lockdown persists until the LAST offender rotates, then lifts; restart stays clean. Lane B: dev on committed control.db → change-password / admin users / reset / PATCH / POST /api/deals all 403 `committedControlDb` / `realModeRequired`; demo admin+karen still log in, no rehash written (hash unchanged, -wal empty). Screenshots: `login-real-1440/390` no panel; `login-dev-1440` panel present; lockdown page 1440/390. |
| 4 | SC4 — 8 wrong passwords don't lock a colleague behind the same proxy; temp passwords force a change at first login; hashes upgrade transparently; any user changes password and ends own sessions from the UI | ✓ VERIFIED | `lib/loginThrottle.js` (per-key sliding window, bounded 10 000, prune), `server.js:905-940, 981-1011` (account key `u:<name>` + source key `ip:<req.ip>`, uniform ceiling WR-01), `:815-820` fence, `:1027-1036` lazy rehash, `lib/passwords.js:110-114` never-downgrade. probe.js A21: 9 wrong for `zed` → 429 + Retry-After, `bob` from the same IP → 200; probe2: admin2 vs unknown name → identical status/body/Retry-After sequence; per-source keyed on `X-Forwarded-For` under TRUST_PROXY=1 (56 distinct names from 10.1.1.1 → 429, 10.2.2.2 unaffected, throttled source blocked even with the right password). probe2 A25: planted legacy bare-hex+salt hash verifies and is rewritten to N=131072 (salt null); planted stronger p=2 hash verifies and is NOT downgraded. Self-service: `GET/DELETE /api/auth/sessions` keyed by caller, foreign id → 404, own other session ended, `current` flagged, no `tokenHash` serialised (A17); UI `account-menu.js` + screenshots `sessions-1440/390`, `change-password-modal-390`, read-only variants on committed db. |
| 5 | SC5 — new DB files 0600 in 0700 directories under any umask | ✓ VERIFIED | `db/dbFiles.js:176-329` (mkdir 0700 + chmod, create 0600 before SQLite opens so -wal/-shm inherit, re-tighten after schema; strict/fatal in real mode). probe.js A19 under umask 022: every file in the real data dir (control/runtime/audit/demo + `-wal`/`-shm`, `deals/deal_*.db` created via POST /api/deals) is 0600, every dir 0700. `test/file-modes.test.js` 9 tests ran (0 skipped on darwin; `skip` flag is win32-only). |
| 6 | PRD acceptance 1 — empty `data/real` boots with zero users, `/api/auth/mode` real, no demo creds on login page, bootstrap creates admin, git clean, committed sha256 unchanged | ✓ VERIFIED | probe.js A1–A7, lane Z; phase10-walk `realEmptyDirBootstrap` PASS + `data-integrity` rows PASS. |
| 7 | PRD acceptance 2 — create → temp login → forced change → role/disable next request; last-admin guard; audit; no hash/salt in any response | ✓ VERIFIED | probe.js A8–A20 incl. last-admin demote 409 `lastAdmin`, self-disable 409, demoted admin cannot re-promote itself (403 on the very next request), 6-round concurrent mutual-disable race never left zero enabled admins; `/api/auth/me`, login, listing, create, reset responses grep-clean of `hash`/`salt`. |
| 8 | PRD acceptance 3 — hand-copied committed control.db serves only login/auth/healthz | ✓ VERIFIED | probe.js lane C (above); phase10-walk `handCopiedControlDbLockdown` PASS. |
| 9 | PRD acceptance 4 — alice×9 ≠ bob; Secure cookie under TRUST_PROXY+https; N=2^17 + lazy rehash | ✓ VERIFIED | probe.js A21–A23: `; Secure` only with `X-Forwarded-Proto: https` behind TRUST_PROXY=1 or with https `PUBLIC_BASE_URL`, never on plain http even with ENABLE_HSTS=1; HSTS `max-age=31536000` without includeSubDomains; shared-source warning logged; probe2 rehash. `test/auth-transport.test.js` 11 tests. |
| 10 | PRD acceptance 5 — 5a file modes PASS (required); 5b compression ≥ 1.8.2 | ✓ VERIFIED (5a) / deferred (5b) | 5a: truth 5. 5b: installed `compression@1.8.1`, `package.json ^1.8.1`; deferral recorded in REQUIREMENTS.md:124, 10-08-SUMMARY.md §DEFERRED-REL-02, 10-REVIEW-CLIENT.md WR-C02, DEPLOYMENT.md Known limitations; grep shows nothing in the tree depends on 1.8.2 behaviour. Deferred, not counted as a gap (see `deferred`). |
| 11 | PRD acceptance 6 — suite green (≥ 878 base); demo launchers + `node server.js` dev flow unchanged; Playwright smoke at 1440/390 | ✗ PARTIAL → gap 1 | `node --test` ×2: **1055/1055, 0 fail, 0 skipped** both runs. `start.command:30`/`start.bat:40` still `DEMO_OPEN=1`, never `MA_MODE`; dev lane boots on committed files fail-closed (lane B). Playwright smoke: login/change-password/My sessions/Users tab at 1440+390 all PASS in substance, but the runner exits 1 because of the self-defeating assertion in `users-tab.js:117-118` (gap 1). |
| 12 | Mode contract (D-10-01) holds against path/symlink/override variants; `MA_*_PATH` overrides still win | ✓ VERIFIED | Lane E 12/12 refusals; `MA_CONTROL_DB_PATH` temp override honoured in lanes B/F (dbFiles.js:105-109); `set-admin-password.js`/`bootstrap-admin.js` both refuse a committed path (`[security] real-deal mode refuses…`). |
| 13 | COLLAB-02 — role/disabled re-read per request, no re-login | ✓ VERIFIED | `server.js:378-396`, `:779`, `:1098`; probe.js A12; `test/session-identity-reread.test.js`. |
| 14 | mustChangePassword fence on EVERY gated route incl. spelling variants | ✓ VERIFIED | `server.js:358, 706-709, 815-820` (most-restrictive across `pathForms`). probe.js A8: 18 fence probes (GET/HEAD/OPTIONS/PATCH/POST, `/api/deals/`, `/api//deals`, `/api/Deals`, `/api/d%65als`, `change-password/../deals`, `change-password%2F..%2Fdeals`, `/api/auth/change-password/x`) all 403 `{mustChangePassword:true}` or 404; only `/api/auth/change-password` (and its trailing-slash form, which then fails closed at VAL-01 with no schema) passes; `/api/auth/me` carries the flag; old cookie dead after rotation. Client: `transitions.js:1057-1066, 1280-1281`, `login.js:38-40`. |
| 15 | CR-01 — case/encoding/slash variants cannot bypass the admin prefix, demo-only, control-plane or lockdown tables | ✓ VERIFIED | `server.js:93` case-sensitive routing, `:205-218` non-canonical `/api` mount → JSON 404, `lib/requestPath.js`, `db/resolver.js:94-100`, `lib/credentialLockdown.js:116-121`. probe.js A15 as hrbp: `/api/Admin/users`, `/API/admin/users`, `/api/admin/users/`, `/api/admin%2Fusers`, `/api/%61dmin/users`, `//api/admin/users`, `/api//admin/users`, `/api/admin/download-zip/`, `/api/admin/audit` → all 403/404. `test/path-canonical-gate.test.js` 8 tests loop every table × variant × role. |
| 16 | Phase 9 behaviours intact; concurrency invariants intact | ✓ VERIFIED | phase9-walk 350/0, `--demo-open` 18/0 (WINDOWS #4 loop closed: `deal-switcher.js:131-142`, `login.js:108-118`; probe lane F: anonymous `/api/auth/me` authEnabled:false, `/api/deals` 401, `/api/admin/users` and `/api/auth/sessions` never open under DEMO_OPEN). `SOAK_DURATION_MS=15000 npm run soak` PASS (824 acked / 0 lost / audit 1:1 / 178 real 409s reconcile). |

**Score:** 15/16 truths verified (0 present-but-behavior-unverified; truth 11 partial → gap 1)

### Locked Decisions (D-10-01..10)

| Decision | Status | Evidence |
|----------|--------|----------|
| D-10-01 Mode contract | ✓ | truths 2, 12; `db/dbFiles.js`, `db/realDataDir.js`, `server.js:80` (called before `app` exists) |
| D-10-02 bootstrap-admin | ✓ | `scripts/bootstrap-admin.js` (argv refused before any DB open :48-57, env/TTY :82-91, create-if-none :134-140, `--force-reset-admin` re-hashes + revokes :148-171, `cli:<os-user>` role `cli` :173-179, defaults MA_MODE=real :199); `set-admin-password.js:60-66` re-pointed. probe.js A3–A7, A24; probe2 A26 |
| D-10-03 User CRUD | ✓ | `server.js:1304-1422`, `validators/users.js` (charset `[a-z0-9._-]{3,40}`, reserved names, z.object strips unknown keys), no DELETE route exists (`grep app.delete('/api/admin/users` → none); `publicAccount()` allowlist `db/controlStore.js:135-147` |
| D-10-04 Next-request role/disable | ✓ | truth 13 |
| D-10-05 Rotation gate + scrypt 2^17 + lazy rehash + min 12 | ✓ | truths 4, 9, 14; `lib/passwords.js:35, 210-221` |
| D-10-06 Throttle, Secure cookie, HSTS, docs, ADMIN_TOKEN warning | ✓ | truths 4, 9; DEPLOYMENT.md:130-158 documents TRUST_PROXY/PUBLIC_BASE_URL/ENABLE_HSTS/HSTS_INCLUDE_SUBDOMAINS; `server.js:300` reworded ADMIN_TOKEN warning |
| D-10-07 Header-menu Change password + My sessions @390 | ✓ | `public/js/account-menu.js`, `transitions.js:1286-1289` loader; screenshots `sessions-390`, `change-password-modal-390`, `committed-readonly-menu-390` (no overflow); API truth 4 |
| D-10-08 Demo creds unusable; /api/auth/mode; WINDOWS #4 | ✓ | truths 3, 16; `server.js:1079-1087`; WINDOWS.md #4 status `fixed` |
| D-10-09 0600/0700 under any umask | ✓ | truth 5 |
| D-10-10 compression ≥1.8.2 + docs | ◐ docs ✓ / bump DEFERRED-REL-02 | DEPLOYMENT.md §Three modes/§Real-deal first run/§Credential lockdown/§Files at rest; README.md:23-29; deferral recorded (see `deferred`) |

Decision-coverage gate (`check.decision-coverage-verify`): returned `could-not-parse` (CONTEXT.md bullets use `**D-10-0N**` inline bold, which the parser does not recognise) — non-blocking; coverage was established manually above, 10/10 honoured (D-10-10's dependency half explicitly deferred).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `db/dbFiles.js` | mode resolution, committed-path refusal, 0600/0700 | ✓ VERIFIED | 354 lines, exported + required by server/realDataDir/CLIs |
| `db/realDataDir.js` | first-boot seed without demo accounts | ✓ VERIFIED | wired `server.js:80`, `bootstrap-admin.js:112` |
| `lib/passwords.js` | self-describing scrypt, verify/rehash policy | ✓ VERIFIED | used by login, change-password, admin routes, both CLIs, lockdown scan |
| `lib/loginThrottle.js` | per-key sliding window | ✓ VERIFIED | `server.js:907-914` |
| `lib/credentialLockdown.js` | boot/login lockdown + allowlist | ✓ VERIFIED | `server.js:229-243`; `test/lockdown-asset-allowlist.test.js` pins assets ↔ pages |
| `lib/requestPath.js` | canonical path forms | ✓ VERIFIED | gate, resolver, lockdown, 404 pre-filter |
| `validators/users.js` | zod schemas registered | ✓ VERIFIED | required from server.js; VAL-01 coverage test green |
| `scripts/bootstrap-admin.js`, `scripts/set-admin-password.js` | CLIs | ✓ VERIFIED | executed in probes |
| `db/controlStore.js` (getAccount/createAccount/updateAccountGuarded/publicAccount/listAccounts) | guarded writes | ✓ VERIFIED | |
| `db/sessions.js` (listSessionsForUser/endOwnSession/publicSessionId/recordLogin/lastLogins) | | ✓ VERIFIED | |
| `public/login.html`, `public/js/login.js`, `public/change-password.html`, `public/js/change-password.js` | mode-aware pages | ✓ VERIFIED | no demo password in HTML; only in `login.js` behind policy |
| `public/js/account-menu.js`, `public/css/account.css` | self-service UI | ✓ VERIFIED | loaded by transitions.js |
| `public/js/admin-users.js`, `public/css/admin-users.css`, `public/admin.html` Users tab | admin console | ✓ VERIFIED | `admin.html:9, 1214` (`?v=1791700201/1791700301`) |
| `public/js/deal-switcher.js`, `public/js/transitions.js` | loop fix + 403/401 handling | ✓ VERIFIED | |
| `start-real-deal.command`, `start-real-deal.bat` | MA_MODE=real, clear DEMO_OPEN | ✓ VERIFIED | `start.*` unchanged (`DEMO_OPEN=1`) |
| `DEPLOYMENT.md`, `README.md` | three modes, bootstrap, proxy vars, file modes | ✓ VERIFIED | doc claims spot-checked against code (throttle numbers, HSTS flag, lockdown remedy, data/real exclusion from download-zip `server.js:1833`) |
| `scripts/uat/phase10-walk.js` + `phase10-scenarios/*.js` | acceptance runner | ⚠️ one self-defeating assertion | gap 1 |
| `node_modules/compression` ≥ 1.8.2 | D-10-10 | deferred | 1.8.1 installed; DEFERRED-REL-02 |

### Key Link Verification

`gsd query verify.key-links` reported several "not found" rows that are tool-format artefacts (non-file `from:` descriptions, a stale `?v=` stamp after the review bumps); each was traced by hand:

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `server.js:80` | `db/realDataDir.js` | `ensureRealDataDir()` before `app` | WIRED | |
| `server.js:995,1155` | `lib/passwords.js` | `verifyPassword` / `hashPassword` / `dummyVerify` / `checkNewPassword` | WIRED | |
| `/api` gate `server.js:779` | `controlStore.getAccount` | `resolveSessionIdentity` | WIRED | per request |
| gate `server.js:815` | `req.portalUser.mustChangePassword` | `gatePolicy.mustChangeAllows` | WIRED | |
| `db/dbFiles.js:298-310` | `ensurePrivateDir` / `chmodPrivateFile` | inside `openDbFile` | WIRED | |
| `transitions.js:1286-1289` | `/js/account-menu.js?v=1791700102` | injected loader | WIRED | |
| `transitions.js:1063-1066, 1280` | `/change-password.html` | 403 marker + `/api/auth/me` handshake | WIRED | |
| `admin.html:1214` | `admin-users.js?v=1791700301` | script tag (stamp bumped by 070bd55/1d92eb8; plan's expected `…200` is stale, not a defect) | WIRED | |
| `test/helpers/seed-identity.js` | 13 suites | require | WIRED | suite green under strict identity |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| Users tab table | `GET /api/admin/users` | `controlStore.listAccounts()` + `sessions.lastLogins()` | yes (screenshots show created rows + last sign-in) | ✓ FLOWING |
| My sessions list | `GET /api/auth/sessions` | runtime.db sessions by caller | yes | ✓ FLOWING |
| Login demo panel | `GET /api/auth/mode` | `dbFiles.IS_REAL_MODE` / `DEMO_OPEN` | yes | ✓ FLOWING |
| Temp password modal | create/reset response | server-generated | yes (never persisted client-side) | ✓ FLOWING |

### Behavioral Spot-Checks (verifier's own runs, isolated temp dirs)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite | `node --test` ×2 | 1055/1055, 0 fail, 0 skipped, both runs | ✓ PASS |
| Adversarial API/CLI/boot probe | `node scratchpad/probe.js` (lanes real, real+proxy, dev-committed, real-handcopied, boot refusals, demo-open) | 164/170; 6 probe-side errors (my salt encoding, `salt===null` vs absent, timing-sensitive compare, `MA_MODE=''` defaulting the CLI to real, p/N at the 256 MiB ceiling) re-run as probe2.js → 13/13 | ✓ PASS |
| Sticky temp-password modal (create + reset) at 1440 and 390 | `node scratchpad/probe-ui.js` (Chromium) | 38/38 | ✓ PASS |
| 2 MB username at login (login is UNVALIDATED_BY_DESIGN) | probe A27 | 401, server stays up | ✓ PASS (see residual risk 1) |

### Probe Execution (phase runners)

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| `scripts/uat/phase10-walk.js` | `PLAYWRIGHT_PATH=… node scripts/uat/phase10-walk.js --out <tmp>` (6 lanes) | 179 PASS / 1 FAIL — `usersTabLifecycle@real: Escape and a scrim click leave the temp-password modal open with the value intact` (self-defeating assertion, gap 1); data-integrity rows PASS | FAILED (tooling) |
| `scripts/uat/phase9-walk.js` | normal lane | 350 PASS / 0 FAIL | PASS |
| `scripts/uat/phase9-walk.js --demo-open` | demo-open lane | 18 PASS / 0 FAIL | PASS |
| `npm run soak` | `SOAK_DURATION_MS=15000` | PASS (824/0/1:1; conflict lane reconciles) | PASS |

### Requirements Coverage

| Requirement | Source plans | Status | Evidence |
|-------------|-------------|--------|----------|
| ACCT-01 | 10-03, 10-07, 10-09 | ✓ SATISFIED | truths 1, 7 |
| ACCT-02 | 10-01, 10-08, 10-09 | ✓ SATISFIED | truth 2 |
| ACCT-03 | 10-01, 10-08, 10-09 | ✓ SATISFIED | truths 2, 12 |
| ACCT-04 | 10-05, 10-06, 10-09 | ✓ SATISFIED | truths 4, 14 |
| ACCT-05 | 10-05, 10-08, 10-09 | ✓ SATISFIED | truths 4, 9 |
| ACCT-06 | 10-03, 10-06, 10-07, 10-09 | ✓ SATISFIED | truth 4 |
| ACCT-07 | 10-01, 10-05, 10-06, 10-09 | ✓ SATISFIED | truth 3 |
| COLLAB-02 | 10-02, 10-03, 10-09 | ✓ SATISFIED | truth 13 |
| OPS-08 | 10-04, 10-09 | ✓ SATISFIED | truth 5 |

No orphaned requirements: REQUIREMENTS.md maps exactly these nine to Phase 10 and every one is claimed by a plan.

### Test Quality Audit

| Test file | Linked | Tests | Asserts | Skipped | Circular | Assertion level | Verdict |
|-----------|--------|-------|---------|---------|----------|-----------------|---------|
| user-admin, bootstrap-admin, credential-lockdown, forced-rotation, login-throttle, password-rehash, path-canonical-gate, real-mode-boot, real-mode-guards, self-sessions, session-identity-reread, file-modes, launcher-mode, lockdown-asset-allowlist, admin-users-ui, client-account-surfaces, auth-transport, db-artifact-exclusion | ACCT-01..07, COLLAB-02, OPS-08 | 160 | 738 | 0 on POSIX (file-modes `skip` is win32-only; the two "skip" words in credential-lockdown/password-rehash are prose) | none — the 11 files using `copyFileSync`/`writeFileSync` copy fixture DBs for isolation; expected values are independent (sha256 before/after, HTTP status/body, stat modes) | value/behavioral (HTTP sequences, DB rows, file modes, byte-identical committed files) | PASS |

**Disabled tests on requirements:** 0. **Circular patterns:** 0. **Insufficient assertions:** 0.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` in any phase-touched file (the only hits are pre-existing task `status: 'todo'` literals and a comment about an "unscaled placeholder" assessment value in server.js:3291, unrelated) | — | — |
| `scripts/uat/phase10-scenarios/users-tab.js` | 78-83 / 117-118 | assertion compares a masked input against the unmasked secret | ⚠️ Warning → gap 1 | runner red on HEAD |

### Residual Risks (not gaps — recorded for Phase 11/20 and the milestone audit)

1. **Unbounded username length at login.** `POST /api/auth/login` is `UNVALIDATED_BY_DESIGN` (validators/index.js:274) and the JSON limit is 50 MB, so the throttle key `u:<username>` is unbounded in length (count is bounded at 10 000, per-source backoff caps growth to ~50 keys per source per 15 min). A 2 MB username was accepted (401) and the server stayed up. Suggest a hard cap (e.g. 256 chars → 400) when Phase 20 revisits limits.
2. **scrypt memory ceiling edge.** `boundsOk` admits N·r exactly at 256 MiB (e.g. N=262144, r=8) which Node refuses, so such a hand-tuned hash returns not-ok (login 401) rather than verifying — already noted in `lib/passwords.js`/10-REVIEW.md WR-02; a future cost bump must raise `MAXMEM`.
3. **Lockdown offender set keyed by username only.** An offender that is later *disabled* stays in the set until it rotates (admin routes are unreachable during lockdown anyway, so the documented remedy — sign in as each offender and rotate, or start from an empty data dir — remains the only path). Behaviour is fail-closed; just note that disabling does not lift the lockdown.
4. **Dev/demo on the committed files tightens them to 0600 and leaves 0-byte `-wal`/`-shm` sidecars** (gitignored; mode bits are invisible to git; main-file hash unchanged). Cosmetic.
5. **IN-C04 (backlog):** the real-deal lane still renders demo chrome (DEMO badge, demo switcher, client-side role selector) — grants no access (server role wins, re-proven by truth 15).
6. **`updateUser()` scans all user rows** to find by username (controlStore.js:117-119) — fine at ≤ ~50 accounts; `getAccount`/`updateAccountGuarded` use the PK.
7. **Decision-coverage gate cannot parse this CONTEXT.md's bullet format** — manual coverage done; consider the `- **Decision:**` format next phase.

### Human Verification Required

None. The visual judgement at 1440/390 (login real/dev/demo-open/committed, forced-change screen, change-password modal, My sessions, Users tab, add-user and temp-password modals, lockdown page) was performed by the verifier on the fresh evidence run and on its own Chromium run, per the standing Fable-review directive (2026-08-08): no horizontal overflow at 390, all strings EN, `.deal-modal` shell reused, no credential visible in any evidence shot. No `<human-check>` blocks exist in the nine plans. No `10-UAT.md` exists, so nothing to update.

### Gaps Summary

All five ROADMAP success criteria, PRD acceptance 1–4, 5a and the locked decisions are achieved in code and were re-proven by the verifier's own runs; D-10-10's dependency bump is a recorded, legitimate deferral (DEFERRED-REL-02, gate clears 2026-10-11T11:17Z) with nothing depending on it. The single gap is in the phase's own acceptance tooling: the WR-C01 browser check added after the evidence run (`1d92eb8`) masks the temp-password input before asserting it is unchanged, so `scripts/uat/phase10-walk.js` exits 1 on HEAD and 10-VALIDATION.md's "179 PASS / 0 FAIL" is stale. The guarded behaviour itself is correct (38/38 in the verifier's Chromium run at both widths, create and reset paths). Fix the assertion (compare against the masked sentinel or screenshot-then-check), re-run the runner, refresh `evidence/results.json` and the runner line in 10-VALIDATION.md.

---

_Verified: 2026-10-10T13:38:23Z — verifier: Claude (gsd-verifier, Fable 5.1); nothing committed, no source files modified; probe scripts live in the session scratchpad only; the one repo artefact a probe created (`data/real/`, gitignored, from `MA_MODE=''` defaulting the CLI to real) was removed._
