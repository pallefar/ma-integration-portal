---
phase: 10-accounts-identity
status: SECURED
threats_total: 59
threats_closed: 59
threats_open: 0
asvs_level: 1
block_on: high
audited: 2026-10-10
audited_head: bb71baf
auditor: Claude Fable 5.1 (gsd-security-auditor)
suite: 1055/1055 (npm test, re-run by the auditor)
---

# Phase 10 — Accounts & Identity: Security Gate

**Verdict: SECURED.** Every threat declared in the `<threat_model>` blocks of plans 10-01..10-09 (58 `T-10-NN` ids + `T-10-SC`; `T-10-42` is declared twice — transfer in 10-06, mitigate in 10-07 — and counted once) resolves to CLOSED with a control located in code on `main` at `bb71baf`, or an accepted/transferred risk whose record is present and still valid. No declared mitigation is absent. Four unregistered flags are recorded below; the highest is MEDIUM (below the HIGH block threshold), so `threats_open` is 0.

Method: adversarial stance (every mitigation assumed absent until found); SUMMARY/REVIEW claims were not trusted — each control was opened in the source; the full suite was re-run by the auditor (1055 pass / 0 fail). Code-review fixes CR-01, WR-01, WR-02, WR-C01, IN-01, IN-02, IN-C01..C03 were each re-verified in code, not from the review's own `status:` lines.

## Threat register

| ID | Category | Sev | Disposition | Evidence (file:line / record) | Verdict |
|----|----------|-----|-------------|-------------------------------|---------|
| T-10-01 | Info disclosure — real-mode writes into committed data/*.db | high | mitigate | `db/dbFiles.js:62-85` resolveModeConfig refuses MA_DATA_DIR == data; `:292-297` openDbFile throws on committed path in real mode (realpath-aware `:144-164`); `db/realDataDir.js:31-38,99-102` refuseCommitted before any open; tests `real-mode-boot.test.js:102,116`, `real-mode-guards.test.js:212,219` | CLOSED |
| T-10-02 | EoP — demo accounts carried into real mode | high | mitigate | `db/realDataDir.js:111-116` seed empties `users`,`deals` on a temp copy, integrity-checked, atomically published; `real-mode-boot.test.js:74` (demo pw → 401), `:89` (0 users) | CLOSED |
| T-10-03 | Info disclosure — bootstrap password on argv | high | mitigate | `scripts/bootstrap-admin.js:48-58,189-193` parseArgv rejects any non-flag before run(); `scripts/set-admin-password.js:121-125`; secret from env or no-echo TTY `:82-91`; `bootstrap-admin.test.js` | CLOSED |
| T-10-04 | Spoofing/repudiation — unattributed first admin | medium | mitigate | `scripts/bootstrap-admin.js:144,173-179` actor `cli:<os-user>`; `validators/users.js:22` charset excludes `:`; `bootstrap-admin.test.js:192` | CLOSED |
| T-10-05 | Tampering — invalid MA_MODE silently dev | high | mitigate | `db/dbFiles.js:66-76` throws on any value but unset/'real' and on real+DEMO_OPEN; `server.js:345-347` isOpenMode requires `!IS_REAL_MODE`; `real-mode-guards.test.js:203,208` | CLOSED |
| T-10-06 | Info disclosure — download-zip ships data/real | high | mitigate | `server.js:1931` `-x "data/real/*"`; `.gitignore:79`; `db-artifact-exclusion.test.js:64` (see UF-1 for the non-default MA_DATA_DIR edge) | CLOSED |
| T-10-07 | Tampering — crafted hash forcing huge scrypt params | low | mitigate | `lib/passwords.js:55-73` boundsOk N≤2^20 pow2, r≤32, p≤16, 128·N·r≤256MiB → not-ok; `bootstrap-admin.test.js:104` | CLOSED |
| T-10-08 | Info disclosure — login timing unknown vs known | low | mitigate (+accepted legacy residual) | `server.js:994-998` dummyVerify at CURRENT_PARAMS; `lib/passwords.js:178-188`; residual recorded `passwords.js:29-31,106-109`; IN-02 additive delay removed `server.js:1002-1007` | CLOSED |
| T-10-09 | Info disclosure — hash written to committed control.db (dev) | medium | mitigate | `server.js:1143-1148` change-password 403 when isCommittedControlDbActive (`dbFiles.js:172-174`); `real-mode-guards.test.js:122,145` | CLOSED |
| T-10-10 | DoS — lockout recovery via shared token | medium | mitigate | `scripts/bootstrap-admin.js:145-148,166-171` `--force-reset-admin` host-local, revokes admin sessions; DEPLOYMENT.md:167-169 | CLOSED |
| T-10-11 | EoP — lenient per-request re-read for tests | high | mitigate | `test/helpers/seed-identity.js:32-36` ensureUser throws on role mismatch; `server.js:378-396` no snapshot fallback | CLOSED |
| T-10-12 | Tampering — fixtures writing committed control.db | low | accept | rationale still valid: suites delete `MA_*` and boot on temp copies (`user-admin.test.js:31`, `credential-lockdown.test.js:43`, `file-modes.test.js:31`); `real-mode-boot.test.js:116` byte-compare | CLOSED (accepted) |
| T-10-13 | EoP — anonymous user CRUD under DEMO_OPEN | critical | mitigate | `db/resolver.js:54,61-64` exact `/api/admin/users` + prefixes are control-plane, evaluated over all canonical forms `:94-98`; `user-admin.test.js:126-138`, `self-sessions.test.js:176` | CLOSED |
| T-10-14 | EoP — demoted/disabled user keeps privileges | high | mitigate | `server.js:378-396` role/disabled re-read per request, disabled → sessions swept; `server.js:1411` disable deletes sessions; `user-admin.test.js:78,232`, `session-identity-reread.test.js:101` | CLOSED |
| T-10-15 | Tampering — mass assignment on PATCH | high | mitigate | `validators/users.js:39-46` plain z.object; `validators/index.js:48-52` req.body = result.data; `user-admin.test.js:282-294` hash byte-identical | CLOSED |
| T-10-16 | DoS — last admin lockout, concurrent demotions | high | mitigate | `db/controlStore.js:173-199` guard inside `.immediate` txn, SELF_DISABLE; `server.js:1397-1405`; `user-admin.test.js:253` | CLOSED |
| T-10-17 | Info disclosure — hash/salt/temp pw in responses or audit | high | mitigate | `db/controlStore.js:135-147` publicAccount allowlist; `server.js:1299-1302` audit view; `:1336,1382` no-store; `user-admin.test.js:52` deep body scan; `self-sessions.test.js:188` | CLOSED |
| T-10-18 | Spoofing — collision with 'admin-token'/system actors | medium | mitigate | `validators/users.js:18-23` RESERVED_USERNAMES, charset `[a-z0-9._-]`; `user-admin.test.js:301` | CLOSED |
| T-10-19 | Info disclosure/tampering — other users' sessions | high | mitigate | `db/sessions.js:171-205` derived publicSessionId, endOwnSession keyed by username; `server.js:1210,1232-1235` foreign id → 404; `self-sessions.test.js:152,188,202` | CLOSED |
| T-10-20 | Repudiation — account changes unattributed | medium | mitigate | `server.js:1332-1335,1379-1381,1413-1416,1241-1244` security events with actor + requestMeta; `user-admin.test.js:78` | CLOSED |
| T-10-21 | Info disclosure — credential writes to committed control.db (admin routes) | medium | mitigate | `server.js:1279-1283` refuseCommittedControlWrite on create `:1307`, reset `:1368`, patch `:1393` | CLOSED |
| T-10-22 | DoS — per-request PK SELECT | low | accept | `db/controlStore.js:66-70` single indexed PK lookup; rationale valid | CLOSED (accepted) |
| T-10-23 | Info disclosure — world-readable DB files | high | mitigate | `db/dbFiles.js:216-232` 0700 dirs, `:244-266` 0600 files, `:300-310,322` create-then-chmod + sidecars; `file-modes.test.js:94,389` under umask 022 | CLOSED |
| T-10-24 | Info disclosure — sidecar created before main tightened | medium | mitigate | `db/dbFiles.js:303-308` file created 0600 before SQLite opens; `:309-310,322` pre-existing sidecars chmodded; `file-modes.test.js:115` | CLOSED |
| T-10-25 | Info disclosure — Windows ACLs | low | accept | DEPLOYMENT.md:100-105 (user-profile ACL + disk encryption); `dbFiles.js:206-207` | CLOSED (accepted) |
| T-10-26 | DoS — chmod failure aborting dev/demo boot | medium | mitigate | `db/dbFiles.js:256-264` EPERM/EROFS on pre-existing non-strict → one warning; strict (real) fatal `:247`; `file-modes.test.js:152,184,261,285` | CLOSED |
| T-10-27 | EoP — temp password as permanent credential | high | mitigate | `server.js:815-820` 403 fence before demo-only/role checks, allow-set `:358` evaluated over every form `:707-709`; public paths `:352` carry no data; `forced-rotation.test.js:64-112` (GET/POST, /api/auth/sessions, /api/raid) | CLOSED |
| T-10-28 | DoS — one user's failures lock out team behind proxy | high | mitigate | `server.js:907-914` separate account/source throttles; `login-throttle.test.js:188` alice×9 / bob | CLOSED |
| T-10-29 | Spoofing — online guessing | medium | mitigate | `server.js:907-909` 5 free then exponential to 5 min/account; `:911-914` 50/15 min per source; `lib/loginThrottle.js:80-99` | CLOSED |
| T-10-30 | Info disclosure — enumeration via throttle/timing | medium | mitigate | `server.js:983-985` key = submitted name; `:920-924` uniform ceiling (WR-01); `:935-940` identical 429 body + Retry-After; `login-throttle.test.js:149` | CLOSED |
| T-10-31 | DoS — unbounded throttle map | medium | mitigate | `lib/loginThrottle.js:62-78,115-116` prune + cap; `server.js:909,913` maxEntries 10000; `login-throttle.test.js:108,115` | CLOSED |
| T-10-32 | Info disclosure — cookie over plain HTTP behind TLS proxy | high | mitigate | `server.js:947-953` Secure when req.secure or https PUBLIC_BASE_URL, independent of HSTS `:197-201`; `:958-964` both cookie headers | CLOSED |
| T-10-33 | Spoofing — X-Forwarded-For with CIDR TRUST_PROXY | medium | transfer | DEPLOYMENT.md:135-138 integer hop count; `.planning/REQUIREMENTS.md:124,242` REL-02 → Phase 21 | CLOSED (transferred) |
| T-10-34 | EoP — real host on published demo credentials | critical | mitigate | `server.js:229-243` boot scan + middleware before body parsers/static (`:245,272`); `lib/credentialLockdown.js:100-129` allowlist/`/api/auth/`/healthz only, canonical-only match; login-time detection `server.js:1016-1020`; clear on rotation `:1170`; `credential-lockdown.test.js:197,230` | CLOSED |
| T-10-35 | DoS — lockdown 403 retried as contention | low | mitigate | `lib/credentialLockdown.js:125,127` 403 never 503 | CLOSED |
| T-10-36 | Tampering — lazy rehash writing committed control.db | medium | mitigate | `server.js:1027` guarded by isCommittedControlDbActive; `password-rehash.test.js:105` | CLOSED |
| T-10-37 | Repudiation — misleading ADMIN_TOKEN warning | low | mitigate | `server.js:299-301` truthful text; `test/auth-transport.test.js` greps it | CLOSED |
| T-10-38 | Info disclosure — demo creds on real login page | high | mitigate | `public/login.html:44-46` no credential markup; `public/js/login.js:30-34` panel only for dev/demoOpen, fail closed; `client-account-surfaces.test.js:29,42`; evidence `login-real-1440.jpg` | CLOSED |
| T-10-39 | XSS — sessions API strings into DOM | high | mitigate | auditor grep: no `innerHTML/outerHTML/insertAdjacentHTML/document.write` in `account-menu.js`, `login.js`, `change-password.js`, `admin-users.js`; `client-account-surfaces.test.js:64` | CLOSED |
| T-10-40 | DoS — demo-open redirect loop | medium | mitigate | `public/js/deal-switcher.js:136-145` no /api/deals without a user; `client-account-surfaces.test.js:64,150`; scenario `scripts/uat/phase10-scenarios/forced-change-and-loop.js` | CLOSED |
| T-10-41 | EoP — must-change user navigating around screen | medium | mitigate | server control = T-10-27 (`server.js:815`); client redirect UX only `client-account-surfaces.test.js:134` | CLOSED |
| T-10-42 | Info disclosure — stale cached client | low | transfer (10-06) → mitigate (10-07) | stamp 1791700100 on 18 pages (`7bc8d42`); `test/asset-cache-bust.test.js:58-65` NEW_ASSETS incl. login/change-password/account-menu | CLOSED |
| T-10-43 | Info disclosure — evidence shots with secrets | low | mitigate | scenarios generate per-run creds (`scripts/uat/phase10-walk.js:289` env-only); auditor grep of `evidence/` for `TEdemo|tempPassword|ma_session=` → no match | CLOSED |
| T-10-44 | Stored XSS → admin via Users table | high | mitigate | auditor grep (no HTML sinks in `admin-users.js`); `admin-users-ui.test.js:51`; server charset/length `validators/users.js:19-26` | CLOSED |
| T-10-45 | Info disclosure — temp password lingering | medium | mitigate | `public/js/admin-users.js:223-230,257` read-only input, blanked on every close, sticky modal (WR-C01); scenario masks before shot (`phase10-scenarios/users-tab.js:6,76`); no storage/log sinks | CLOSED |
| T-10-46 | EoP — non-admin using the Users tab | low | mitigate | `admin-users.js:590` tab shown only on server-confirmed admin; server admin-only every method `server.js:433,834-837,1273-1277` | CLOSED |
| T-10-47 | Repudiation — console actions unattributed | low | mitigate | tab calls only the audited 10-03 routes (T-10-20); `user-admin.test.js:78` audit rows | CLOSED |
| T-10-SC | Tampering — compression@1.8.2 into committed tree | high | mitigate (gate branch: nothing installed) | `node_modules/compression` last touched `04e5146`, `package.json:18` `^1.8.1`, lock unchanged vs Phase-9 close (auditor diff); DEFERRED-REL-02 `10-08-SUMMARY.md:96` | CLOSED |
| T-10-48 | DoS — compression leak GHSA-vc2v-76pw-4v95 | high | mitigate → transfer on deferral | transfer record present: `.planning/REQUIREMENTS.md:124` (gate 2026-10-11T11:17Z, lands ≤ Phase 21), `:242` REL-02 Pending; `DEPLOYMENT.md:203-207` known limitation; `10-REVIEW-CLIENT.md` WR-C02 | CLOSED (transferred) |
| T-10-49 | EoP — real launcher not selecting real mode | high | mitigate | `start-real-deal.command:29,35`, `start-real-deal.bat:36,42` (MA_MODE=real, DEMO_OPEN cleared — IN-C01); `launcher-mode.test.js:23,50,61` | CLOSED |
| T-10-50 | Spoofing — TRUST_PROXY as subnet | medium | mitigate | DEPLOYMENT.md:135-138; `launcher-mode.test.js:105` doc↔code | CLOSED |
| T-10-51 | Info disclosure — docs steering to shared token | low | mitigate | DEPLOYMENT.md:180-187 "optional break-glass, discouraged"; `server.js:300` | CLOSED |
| T-10-52 | Info disclosure — shots/logs with passwords or cookies | medium | mitigate | `evidence/README.md:10`; auditor grep clean; `phase10-walk.js:159-160` strips inherited secrets from child env | CLOSED |
| T-10-53 | Tampering — evidence runs mutating committed DBs | high | mitigate | `scripts/uat/phase10-walk.js:94-109,424-427` sha256 (main exact, -wal normalised) + `git status --porcelain -- data` before/after → FAIL | CLOSED |
| T-10-54 | Repudiation — sign-off claiming unproven items | medium | mitigate | `10-VALIDATION.md:20` rule, `:108-115` Open items section names the unproven human-judgment item | CLOSED |
| T-10-55 | DoS — targeted lockout (MITIGATE + ACCEPT) | medium | mitigate + accept | cap ≤ 5 min `server.js:905-924` (now uniform, WR-01); backoff log `:930-934`; shared-source warning `:134-158`; DEPLOYMENT.md:135-143 requires TRUST_PROXY; recovery `lib/loginThrottle.js:22-30`; residual accepted and visible via the log line; `login-throttle.test.js:125,149` | CLOSED |
| T-10-56 | Info disclosure — admin role via Retry-After ceiling | low | accept | rationale now stronger: ceiling uniform for every name (`server.js:920-924`), channel removed; `login-throttle.test.js:149` | CLOSED (accepted) |
| T-10-57 | Info disclosure — dev/demo continuing on untightened file | low | accept | `db/dbFiles.js:198-205,256-262` `[security]` warning, real mode fatal; `file-modes.test.js:152,285` | CLOSED (accepted) |
| T-10-58 | Tampering — runner lanes writing committed control.db (WAL trap) | high | mitigate | `phase10-walk.js:24-31,103-109,368` hashes control.db AND control.db-wal per lane; all account writes 403 server-side on committed control | CLOSED |

## Focus checks requested by the orchestrator

- **Committed-file write protection.** Real mode: three independent refusals (mode resolution, ensureRealDataDir, openDbFile) all realpath-aware. Non-real: `isCommittedControlDbActive()` is the single predicate behind change-password, lazy rehash, user create/patch/reset, deal create and both CLIs, and it also drives the client's `accountsWritable` flag — one rule, verified at each site.
- **Lockdown completeness.** Middleware is mounted after the security headers and before body parsers, `/` and `express.static` (`server.js:185-243,245,272`); allowlist is one frozen constant, served only on the exact canonical spelling; `/api/auth/` passes only when every spelling stays under it; `lockdown-asset-allowlist.test.js` fails on asset drift either direction.
- **mustChangePassword fence.** Enforced inside the single `/api` gate for every method (writes and reads; HEAD/OPTIONS included because the fence precedes the `isWrite` branch), over every canonical form; the only non-`/api` routes are `/` and `/healthz` (`server.js:265,1425`) plus static assets — no data path escapes the gate.
- **Session revocation.** Disable → sessions swept (`:1411` and on next request `:384-386`); reset → swept (`:1378`); own change-password → all others swept, current re-issued (`:1186-1191`); CLI rotation/force-reset → swept (`bootstrap-admin.js:169-170`, `set-admin-password.js:105-106`). Role change is bound by per-request re-read (declared design, D-10-04), not by revocation — matches the register.
- **Throttle enumeration/timing.** Account key is the submitted name; ceiling, body and header uniform for known/unknown/disabled/admin (WR-01); one scrypt per attempt (dummyVerify); IN-02 additive delay removed.
- **CLI secrets/permissions.** Both scripts refuse positional argv before any DB open, read env or no-echo TTY, default `MA_MODE=real`, refuse the committed control.db, never log the password, audit `cli:<os-user>` with role `cli`.
- **MA_DATA_DIR / traversal.** `path.resolve` + realpath identity; `MA_DATA_DIR=../data` and symlinked `data/real → data` both hit the committed-path refusals (`real-mode-guards.test.js:212,219`); deal ids still pinned to `DEAL_ID_RE` before `path.join`.
- **umask / modes.** Create-then-chmod; sidecars inherit 0600 because the main file is 0600 before SQLite opens it; proven under umask 022 in a child process (`file-modes.test.js:89-389`).
- **Canonicalisation gate-vs-router divergence.** Analysed for a new bypass: `case sensitive routing` is set before the router is lazily created (`server.js:93`), so the router dispatches raw case-sensitively and `strict routing` off only tolerates a trailing slash — which `tidy()` strips. Every gate decision is monotone in the restrictive direction (`roleAllows`/`mustChangeAllows` require *every* form; `isAdminPath`/`isDemoOnly`/control-plane fire on *any* form; dot segments, bad escapes and backslashes 404 before identity resolution), and non-canonical mount spellings 404 at app level (`:210-218`). Therefore the gate can only be stricter than any single spelling the router could dispatch — a divergence can yield a false 403/404, never a false allow. Live-proven across case / `//` / `%2F` / encoded-letter / trailing-slash × GET+HEAD × four roles + anonymous (`path-canonical-gate.test.js:225-297`). No bypass found.

## Unregistered flags

Severity-ranked. None is HIGH, so none counts toward `threats_open`.

| # | Sev | Finding | Where | Recommendation |
|---|-----|---------|-------|----------------|
| UF-1 | **MEDIUM** | A **non-default `MA_DATA_DIR` inside the repo tree** (e.g. `data/prod`, `realdata/`) is neither gitignored (`.gitignore:79` covers only `data/real/`) nor excluded from the admin download-zip (`server.js:1931` static `-x "data/real/*"`; the flat `data/*.db` pattern does not recurse). DEPLOYMENT.md:58 states the `MA_DATA_DIR` folder "is gitignored", which is only true for the default. Needs two operator choices to matter (custom in-repo dir + `git add -A` or an admin export), and the admin already sees the MNPI in the UI — hence medium, not high. | `server.js:1931`, `.gitignore:79`, `db/dbFiles.js:78-82`, DEPLOYMENT.md:58 | Refuse (or at least `[security]`-warn) in `resolveModeConfig` when a real-mode `dataDir` lies under `REPO_ROOT` but is not `data/real`; derive the zip exclusion from `dbFiles.DATA_DIR` instead of a literal; correct the DEPLOYMENT.md sentence. Track as a `/gsd-quick` or fold into Phase 11/12 ops hardening. |
| UF-2 | LOW | Real-mode chrome still shows demo badge / project switcher / client role selector (grants nothing — server role wins). Already recorded as IN-C04 backlog in `10-REVIEW-CLIENT.md`. | shared header | Keep in backlog for the mode-aware chrome work (Phase 19/20). |
| UF-3 | INFO | Login handler comment says the account lookup is "a PK read" but `controlStore.findUser()` is a full-table scan (`server.js:982` → `db/controlStore.js:55-57`); `getAccount()` is the PK read. Timing impact is negligible against the scrypt derivation; hygiene only. | `server.js:975-982` | Swap to `getAccount(submitted)` when next touching the handler. |
| UF-4 | INFO | New unauthenticated surface `GET /api/auth/mode` (10-01) returns only `mode`, `demoOpen`, `accountsWritable` with `no-store` (`server.js:1079-1087`); lockdown 403 page (10-05) is a fixed string echoing no request data (`lib/credentialLockdown.js:51-58`). Both map to T-10-38/T-10-34 posture; informational. | — | None. |

Side observation carried from WR-02 (no action in this phase): `boundsOk()` admits `N·r` exactly at the 256 MiB ceiling, which Node's scrypt then refuses — verify returns not-ok (fail closed), so a future cost bump must raise `MAXMEM` with it.

## Accepted / transferred risk log (Phase 10)

| ID | Disposition | Record | Still valid |
|----|-------------|--------|-------------|
| T-10-08 (legacy-hash timing residual) | accept | `lib/passwords.js:29-31,106-109` | yes — real mode creates only new-format hashes and locks down copied demo accounts |
| T-10-12 | accept | suites use `MA_*` temp paths | yes |
| T-10-22 | accept | PK lookup on ≤ ~50 rows | yes |
| T-10-25 | accept | DEPLOYMENT.md:100-105 | yes |
| T-10-33 / T-10-50 | transfer | REQUIREMENTS.md REL-02 (Phase 21) + DEPLOYMENT.md:135-138 | yes |
| T-10-48 / T-10-SC | transfer on deferral | REQUIREMENTS.md:124,242; DEPLOYMENT.md:203-207; 10-08-SUMMARY.md §DEFERRED-REL-02; gate clears 2026-10-11T11:17Z | yes — bump must land via REL-02 or an earlier `/gsd-quick`; D-10-10 is NOT delivered by Phase 10 |
| T-10-55 residual | accept | `lib/loginThrottle.js:22-30`, DEPLOYMENT.md:135-143 | yes — ≤ 5-min re-triggerable backoff on a known name on an internal host, visible in the `[security]` log |
| T-10-56 | accept | uniform ceiling removed the channel | yes (stronger than planned) |
| T-10-57 | accept | `db/dbFiles.js:198-205` | yes |

## Proof re-run by the auditor

`npm test` on `bb71baf`: **1055 tests, 1055 pass, 0 fail** (20.5 s). Suites relied on above: `path-canonical-gate`, `credential-lockdown`, `lockdown-asset-allowlist`, `forced-rotation`, `login-throttle`, `user-admin`, `self-sessions`, `session-identity-reread`, `real-mode-boot`, `real-mode-guards`, `file-modes`, `bootstrap-admin`, `password-rehash`, `launcher-mode`, `asset-cache-bust`, `client-account-surfaces`, `admin-users-ui`, `db-artifact-exclusion`, `demo-only-gating`, `auth-transport`. Evidence directory grepped for `TEdemo|tempPassword|ma_session=` — no match. No source file was modified by this audit.
