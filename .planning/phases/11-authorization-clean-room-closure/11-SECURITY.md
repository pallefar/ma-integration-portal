---
phase: 11
slug: authorization-clean-room-closure
status: SECURED
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_total: 44
threats_closed: 44
threats_accepted: 7
threats_open: 0
asvs_level: 1
block_on: high
audited: 2026-10-10
audited_head: e6a5021
auditor: Claude Fable 5.1 (gsd-security-auditor, second-opinion model)
suite: 1258/1258 (node --test, 23 s, re-run by the auditor at e6a5021)
live_probe: 114 checks on an isolated MA_MODE=real instance (101 + 13), 0 open after triage
---

# Phase 11 — Authorization & Clean-Room Closure: Security Gate

**Verdict: SECURED.** All 44 `T-11-xx` threats declared in the `<threat_model>` blocks of plans 11-01..11-08 resolve to
CLOSED (37 mitigations located in code at `e6a5021` and proven by a named test and/or a live request) or CLOSED-accepted
(7 `accept` dispositions whose written rationale is present and still valid — AR-11-01..07). No declared mitigation is
absent, present only in a comment, or present only in a test fixture. The two review rounds' confirmed exploits
(CR-01, WR-01, WR-02, WR-03, IN-01, IN-02, IN-04, WR-C01/C04) were each re-exploited by this audit against the final
code and are closed. Five new findings (SC-01..SC-05) are recorded; the highest is MEDIUM (SC-02, a pre-existing design
seam), below the HIGH block threshold, so `threats_open` is 0.

**Stance and method.** Every mitigation was assumed absent until found in source (file:line) and exercised. SUMMARY,
REVIEW and FIX-report claims were used only as a map, never as evidence. Verification depth: ASVS L1 (control present)
plus L2 placement checks on every clean-room and gate control (the check sits at the boundary before the body is built or
the record mutated). Live checks ran on a fresh `MA_MODE=real` instance (`MA_DATA_DIR` = a `mkdtemp` under the session
scratchpad; the real-mode seed only *reads* the committed `data/control.db` / `data/demo.db`), port 0 on 127.0.0.1,
server closed and temp directory removed afterwards. `POST /api/settings/new-ma` was never called. Committed
`data/demo.db` / `data/control.db` sha256 are identical before and after (`63d552c4…`, `e83f049e…`);
`git status --porcelain -- data public/sent_emails` empty. Playwright 1.62.1 from the pre-existing npx cache (nothing installed).

## Verification performed

| Check | Result |
|-------|--------|
| `node --test` at `e6a5021` (full suite) | 1258 pass / 0 fail (23 s) |
| Live probe 1 (`sec11-probe.js`, scratchpad): 101 checks — gate matrix, variants, HEAD/OPTIONS, config surface, settings subset, deal projection, clean-room 404 matrix, denial bound (gate / DD / org / clearance-404), reserved sources, get-or-create, pulses, exports, busy-audit 503, access map, Playwright page gate (11 role×page visits) | 98 PASS; 3 FAIL triaged below as auditor test-design errors (2) and re-verified (1) |
| Live probe 2 (`sec11-probe2.js`): fresh-actor clearance-404 bound + folded flush, `deal-settings-update` row content, request-body absence in audit rows, synergy write echo residual, unbound-session seam in real mode | 13 PASS / 0 FAIL |
| `git diff 13a6da0..HEAD -- package.json package-lock.json node_modules` | empty (T-11-72) |
| `git diff 13a6da0..HEAD -- public/js` added HTML sinks | one: `leaderboardContainer.innerHTML = ''` (constant string) (T-11-62) |
| `grep -nE "UPDATE\|DELETE FROM" lib/denialAudit.js` (code lines) | none — comments only (T-11-33) |
| Evidence directory grep `TEdemo\|tempPassword\|ma_session=\|@te.com\|@nextgen` | no match (T-11-71) |
| Committed DB sha256 + `git status -- data` before/after audit | unchanged (T-11-70 discipline honoured by this audit too) |

Triage of the 3 initial FAILs: (1) employee `GET /api/admin/audit` answers the *write-policy* fixed body
("cannot perform this action") because the admin-prefix role check precedes the read check — still a 403 with one fixed
string and no data (covered by accepted T-11-03; see note under AR-11-01). (2) `deal-settings-update` rows = 1, not ≥ 2:
my first setup post was a `step: basics` post (action `deal-setup-update`), so one row is exactly right; probe 2 confirms
the row carries actor + before/after. (3) "5 clearance-404 probes → 0 new rows": the `s-pmo|deal|DELETE|/api/raid/:id|clearance-404`
key already had an open 60 s window from the earlier matrix block, so the probes were *folded* — the bound working, exactly
the trap amendment 6 warns about; probe 2 with a fresh actor shows 1 row for 5 probes, 0 rows for 5 missing ids, and the
folded `count: 4` written on flush.

## Threat register

Severity order critical > high > medium > low; `block_on: high`. CLOSED = control found at the stated location, placed
before the body is built / record mutated where that matters, and proven by the named test and/or live check.
CLOSED (accepted) = rationale present and judged still valid (see Accepted-risk register).

| ID | Category | Sev | Disp. | Mitigation location (code) | Proof (test / live) | Status |
|----|----------|-----|-------|----------------------------|---------------------|--------|
| T-11-01 | EoP — read-policy gaps | high | mitigate | `lib/readPolicy.js:33-107` ROLE_READ_POLICY, `:110-115` `readRuleFor` has NO default rule; gate `server.js:898-901` refuses when `req.isDemo !== true` and no rule allows | `test/read-policy-coverage.test.js:39,47,53,68` (unlisted route / dead rule / negative control / live unlisted path 403); live: employee 403 fixed body on 23 routes incl. `/api/zz-unlisted` | CLOSED |
| T-11-02 | EoP — path variants | high | mitigate | `lib/readPolicy.js:138-146` `readAllowsForms` canonical-anchored, refuses if ANY ruled form refuses; `server.js:753-755`, `:799-802` `pathForms` | `test/path-canonical-gate.test.js:304-366` loops the whole table × variants (> 500 probes); live: 8 spellings of `/api/synergies` all 403/404 | CLOSED |
| T-11-03 | Info — 403-vs-404 route oracle | low | accept | fixed strings `server.js:886`, `:900`; record-level 404 at `:8408-8420` | live: both refusal bodies are one fixed key, no data | CLOSED (accepted, AR-11-01) |
| T-11-04 | Info — demo store lenient | low | accept | `db/resolver.js:102-104,161` (`req.isDemo` only for a session with no deal binding); gate `server.js:898` | live: unbound employee reads demo-copy synergies (5 showcase rows); `GET /api/deals` control-plane still strict (`[]`) | CLOSED (accepted, AR-11-02; see SC-02) |
| T-11-05 | DoS/regression — demo reads | medium | mitigate | gate predicate `server.js:898`; no demo branch touched | `test/read-policy-matrix.test.js:69,331`; evidence `phase11-demo.log` 193/0 incl. byte-level diff vs `13a6da0`; Phase 9/10 walks 350/0, 523/0 | CLOSED |
| T-11-06 | Spoofing — HEAD/OPTIONS bypass | medium | mitigate | `server.js:876` `isWrite` excludes GET/HEAD/OPTIONS → `:898` read check applies to all three | `read-policy-coverage.test.js:80`; `path-canonical-gate.test.js:354-359`; live HEAD/OPTIONS → 403 | CLOSED |
| T-11-10 | EoP — config/content writes | high | mitigate | `server.js:457-465` admin-only rules placed before self-service/defaults (first match wins), boundary-safe | `path-canonical-gate.test.js:265`; `deployment-role-matrix.test.js:162`; live hrbp/pmo POST settings/menus/pages/banners/slides/media/i18n/courses → 403; `/api/Settings`, `/api/settings/`, `/api//settings`, `/api/%73ettings` → 403 | CLOSED |
| T-11-11 | Info — settings secrets | high | mitigate | `server.js:2154-2163` `settingsResponseFor` allowlist PICK for every non-admin incl. anonymous; `validators/settings.js:160-177` frozen `PUBLIC_SETTINGS_KEYS`; `publicSettings` `:2135-2144` strips key + connectionDetails first | `test/settings-public-subset.test.js` (a)–(f) incl. secret sentinel + client drift scan; live hrbp keys ⊆ allowlist, admin gets flag never value | CLOSED |
| T-11-12 | Tampering — egress switch | high | mitigate | `server.js:2471-2473` inline `isAdminRequest` guard independent of table order + T-11-10 rules | live hrbp `POST /api/settings {geminiApiKey}` → 403; probe 2: forged key string absent from audit.db | CLOSED |
| T-11-13 | EoP — non-member setup | medium | mitigate | `server.js:1873-1875` `isDealMember` → 404 byte-identical to missing deal | `test/deal-settings-setup.test.js:126`; live `{"error":"Deal not found."}` identical for missing / non-member | CLOSED |
| T-11-14 | DoS — out-of-range values | medium | mitigate | `validators/wizard.js:87-92` DealSettingsSchema (horizon int 1–15, stale positive ≤ 365, ISO day1Date); reader clamps | `deal-settings-setup (c),(e)`; live 99 / 9999 / `not-a-date` → 400 | CLOSED |
| T-11-15 | Repudiation — deal-level changes | low | mitigate | `server.js:1898-1901` `deal-settings-update` with before/after projection | `deal-settings-setup (g)`; probe 2: row `actor b-hrbp`, before `synergyTargetM:null`, after `7.5` | CLOSED |
| T-11-16 | DoS/regression — demo time-travel | medium | mitigate | `server.js:457` exact time-travel rule precedes admin-only `/api/settings`; `:714` DEMO_ONLY | `deal-settings-setup (f)`; live unbound pmo → 200, bound hrbp → 403 demo-only, unbound employee → 403 | CLOSED |
| T-11-20 | Info — 409 oracle (R1-02) | high | mitigate | `server.js:5426-5429` `assertRecordVisibleOr404` called BEFORE `conflictIfStale` at `:4079/4085`, `:4137/4144`, `:5470`, `:7208/7213`, convert `:6309-6310`, `:6973-6974`; filter armed `:5434-5436` | `test/clearance-write-paths.test.js:153,320,324,467` (structural: every by-id site); live: uncleared pmo update/stale/status-flip/delete on hr task + RAID → `404 {"error":"Not found"}`, no record field | CLOSED |
| T-11-21 | Tampering — overwrite/delete restricted | high | mitigate | same guard sites (POST update + both DELETEs) | live: hr task title/status unchanged after 5 probe writes (cleared pmo re-read) | CLOSED |
| T-11-22 | Info — missing vs invisible | medium | mitigate | `server.js:5398-5405` `RecordNotFoundError`; `:8408-8420` ONE central 404 body for both reasons | live: `DELETE /api/raid/raid_missing` and `/api/raid/<hr id>` bodies identical | CLOSED |
| T-11-23 | Info — timing | low | accept | `server.js:5415-5420` one in-memory lane scan both paths | 11-REVIEW 12×12 samples ~1 ms both (not re-measured here) | CLOSED (accepted, AR-11-03) |
| T-11-24 | Info — WHERE-layer echo unarmed (UF-2) | high | mitigate | `db/collections.js:181-186` four task/RAID lanes in CLEARANCE_SCOPED, `:198-222` PROVENANCE_SCOPED + `hasRestrictedProvenance`; `db/store.js:212-219` `conflictVisibleRecord` fail-closed | `clearance-write-paths (Task 3)` `:668,683,737,761,778` (structural gate on every caller) | CLOSED |
| T-11-25 | Info — synergy taskIds oracle | medium | mitigate | `server.js:4555-4580` `resolveSynergyTaskIds` (invisible ≡ unknown, hidden links preserved); `:4645-4661`, `:7309`, `:7458` `synergyLinksVisibleTo` on read/export/pack (IN-01) | `clearance-write-paths:328,494`; live: restricted-id and unknown-id 400 bodies identical; `GET /api/synergies` and synergies export carry no restricted id | CLOSED (count-only write-echo residual → AR-11-09) |
| T-11-26 | DoS/regression — conversions, cleared users, Phase 9 dialog | medium | mitigate | guard is identity-aware (`recordVisibleTo` → `hasAreaGrant`) | `clearance-write-paths:153,382`; optimistic-locking suites green; live: cleared pmo stale version → 409 with `currentRecord`; re-convert dedupes on the genuine task | CLOSED |
| T-11-30 | DoS — audit flooding | high | mitigate | `lib/denialAudit.js:175-230` key = actor\|deal\|method\|route TEMPLATE\|reason[\|action\|subject], ≤ 1 row/key/window; `server.js:1589-1608` template from registered layers; `:1624-1661`; DD subject bounded by `z.enum(DD_AREA_IDS)` (`validators/dd.js:85,144`) | `test/denial-audit.test.js:70,93,129,141,197,227,449,477,520`; live: 26 DD id probes → 2 rows (subject null / hr), 25 flight-risk → 1, 10 org/decisions → 1, 8 path variants → ≤ 2, 5 clearance-404 → 1 | CLOSED |
| T-11-31 | Repudiation — denials unrecorded | medium | mitigate | `denyAt` at every gate exit `server.js:843,866,873,886,900`; resolver `db/resolver.js:154` → `:831`; lockdown `lib/credentialLockdown.js:129` → `server.js:249`; grants inline `:1973`; clearance-404 `:8416-8418`; DD/org `:5566,6011,6128,6557`; folded counts `denialAudit.js:134-163,241-251` | `denial-audit.test.js:570` (gate has no raw 401/403), `:394,449`; probe 2: folded `count:4, folded:true` written on flush | CLOSED (scope note → SC-03) |
| T-11-32 | DoS — window-map growth | medium | mitigate | `denialAudit.js:80` maxKeys 5000, `:201-214` per-reason overflow, `:149-163` idle eviction, `:254-265` unref'd interval | `denial-audit.test.js:141` | CLOSED |
| T-11-33 | Tampering — audit UPDATE | high | mitigate | module issues no SQL (`write` injected `:80-82`); auditor grep: no UPDATE/DELETE statement in code lines | `denial-audit.test.js:176,244` (AUD-02 triggers intact) | CLOSED |
| T-11-34 | Info — bodies/secrets in rows | low | mitigate | `denialAudit.js:95-130` row shape, `:232-238` `shapeRequest` (method/path/ip only); `server.js:1574-1576` | probe 2: forged `AIza…` body string absent from every audit column | CLOSED |
| T-11-35 | Repudiation — per-process bound | low | accept | `denialAudit.js:57-60`; DEPLOYMENT.md:364-372 (crash loss, per process, graceful restart) | `denial-audit.test.js:611` docs test | CLOSED (accepted, AR-11-04) |
| T-11-36 | DoS — busy audit on a denial | low | accept | no catch around `write` (`denialAudit.js:35-38,139,227`); `server.js:8411-8415` | live: second connection holds `BEGIN IMMEDIATE` on audit.db → denial answers **503** after 1080 ms with `Retry-After: 1`, never 200/unaudited 403; after release → 403 + exactly one row | CLOSED (accepted and verified, AR-11-05) |
| T-11-40 | Info — named pulses | medium | mitigate | `lib/pulseView.js:57-67`; `server.js:8035-8039` (`req.isDemo !== true`) | `test/personal-data-reads.test.js:109,163,241`; live: employee own-only, employee2 own-only, pmo own+aggregate, hrbp full | CLOSED |
| T-11-41 | Spoofing — forged authorship | medium | mitigate | `server.js:8066-8069` `authorUsername` from session; `validators/people.js:113-118` strips unknown keys | `personal-data-reads:141`; live body `authorUsername:'s-hrbp'` ignored → stored `s-emp` | CLOSED |
| T-11-42 | Info — re-identification | low | mitigate | `pulseView.js:41-43` aggregate = rating/type/day, `:62-66` re-sorted | live pmo aggregate rows have exactly `day,rating,type`, no comment/name/id/time | CLOSED |
| T-11-43 | Info — counts via notifications | low | mitigate | `server.js:7181-7195` nudges gated on `readPolicy.roleAllowedForRead` (one source of truth) | `personal-data-reads:306,340`; live employee: assessment nudges only; hrbp keeps `tasks_overdue` | CLOSED |
| T-11-44 | DoS/regression — demo dashboards | medium | mitigate | `server.js:8035`, `:7182` strict predicates leave the demo branch untouched | `personal-data-reads:259,355`; evidence demo lanes 193/0 | CLOSED |
| T-11-50 | Tampering — GET get-or-create | medium | mitigate | `server.js:7735` `app.post`; write rule `:476` (exact, POST-only, all roles); schema `validators/people.js` registered | `test/get-or-create-post.test.js:111,137,161`; live GET → employee 403 / staff 404 | CLOSED |
| T-11-51 | Tampering — any GET that writes | medium | mitigate | — (test-borne control) | `test/no-get-mutates.test.js:318,376` (admin + pmo + employee, real and demo lanes), negative controls `:412,436,457`, static `:503` | CLOSED |
| T-11-52 | Info — roster lookup by name | medium | mitigate | `server.js:7751-7768` restricted lane resolves ONLY `selfRosterId(username)`; `:7787-7806` defaults (WR-03) | `get-or-create-post:173,260`; live: colleague `empId`+`name` ignored → own `emp_acct_…`, role/department/company/isLeader server-minted | CLOSED |
| T-11-53 | Tampering — CSRF via GET | medium | mitigate | GET removed; POST goes through `validationMiddleware` (JSON body) | `get-or-create-post:111` (never 2xx in every lane); live GET 403/404 | CLOSED |
| T-11-54 | DoS/regression — employee welcome flow | medium | mitigate | client POST in `public/js/employee.js` (reviewed Part B); stamps in `test/asset-cache-bust.test.js` FROZEN | `get-or-create-post:90` demo tracer; evidence employee lanes 0 refused requests; live Playwright employee → `/employee.html` stays, 0 refused | CLOSED |
| T-11-60 | EoP — hiding mistaken for enforcement | medium | mitigate | `server.js:1194-1208` map computed from `readPolicy.accessSummaryFor` + `roleAllowedForWrite`; no server path reads a client-supplied `access` | `test/client-authz-hiding.test.js:85,115,1684`; live: employee map all-false AND every hidden route refused server-side (matrix above) | CLOSED |
| T-11-61 | Info — access map reveals matrix | low | accept | DEPLOYMENT.md:180-241 documents the table; map is booleans only | `deployment-role-matrix.test.js:120`; live map values all boolean | CLOSED (accepted, AR-11-06) |
| T-11-62 | XSS — new hiding sinks | medium | mitigate | hiding via `hidden`/style (`transitions.js:1316-1320`, `:2454`) | auditor diff `13a6da0..HEAD -- public/js`: only added sink is a constant `innerHTML = ''`; `test/client-xss-sinks.test.js` green | CLOSED |
| T-11-63 | DoS/regression — demo controls | medium | mitigate | `transitions.js:1306-1309` `maCan` false only on explicit `false`; `server.js:1163-1164` demo-open `me` unchanged | `client-authz-hiding:141,282`; evidence demo lanes + baseline diff (only intended 11-02/11-07 deltas) | CLOSED |
| T-11-70 | Tampering — committed DBs during walks | high | mitigate | `scripts/uat/phase10-walk.js:94-115` sha256 (main exact, -wal normalised) + `git status --porcelain -- data`, `:148`, `:368`, `:424-427`; temp copies `:266` | evidence logs: guard PASS lines 4 / 2 / 2; auditor's own before/after hash unchanged | CLOSED |
| T-11-71 | Info — credentials/MNPI in evidence | medium | mitigate | `scripts/uat/phase10-scenarios/authz-phase11.js:20` (passwords local only), `:63` SECRETISH regex, `:516` row check | auditor grep of `evidence/` clean (see SC-05 for a benign path) | CLOSED |
| T-11-72 | Supply chain — Playwright | low | accept | not in package.json; npx cache only | `git diff 13a6da0..HEAD -- package.json package-lock.json node_modules` empty | CLOSED (accepted, AR-11-07) |

**Totals:** 44 threats — 37 CLOSED by mitigation, 7 CLOSED (accepted), 0 OPEN. `threats_open` (OPEN with severity ≥ high) = **0**.

## Review findings — disposition re-check on the final code

| Finding | Fix commit | Re-verified by this audit | Status |
|---------|-----------|---------------------------|--------|
| CR-01 deal record to employee/pmo | `d86cd81` | live: employee `GET /api/deals` / `select` → `{id,name,status}`; pmo → `+targetCompany`; none of dealSizeM/synergyTargetM/memberGrants/members/setup/dates; hrbp full; `lib/dealProjection.js:41-50` fail-closed for unknown role; static exit scan `test/deal-record-projection.test.js:244` | closed |
| WR-01 DD/org denial flood | `5df9fea` | live: 26 DD probes → 2 rows, 25 flight-risk → 1, 10 decisions → 1 | closed |
| WR-02 reserved `source` planting | `9a96835` | live: 6 spellings (incl. case / leading space / admin) → 400; re-convert returns the genuine stamped task, no PLANTED record visible to cleared pmo; `validators/workstream.js:93-100,114,385`; dedupe predicates `server.js:6306,6969` require the server stamp | closed |
| WR-03 get-or-create body fields | `3ba8515` | live: role/department/company/isLeader server-minted; staff roster carries none of the forged values | closed |
| WR-04 test gaps | `95e5ca2` | `read-policy-matrix:293` body allowlists; `no-get-mutates:376` pmo/employee lanes present | closed |
| IN-01 restricted ids via synergies | `2098b73` | live: uncleared GET/export carry no restricted id; residual write-echo verified (AR-11-09) | closed (residual recorded) |
| IN-02 pulse name forgery | `feed9c9` | live: filed as `Alice A`, IL never sees `Jane Doe` | closed |
| IN-03 setup audit after commit | accepted | DEPLOYMENT.md:409-418 Known limitations | accepted (AR-11-08) |
| IN-04 trailing-slash 500 | `72e0616` | live: `get-or-create/` → 200 same record; case / `%67` variants → 403 (write-policy fixed body), never 500; `validators/index.js:344-353` | closed |
| IN-05 stale rationale / day1Date | `dd0b316` | live `not-a-date` → 400; `readPolicy.js:47-48` wording current | closed |
| WR-C01 page gate bypass | `104a75e` | live Playwright: employee → admin/pmo/execution redirected home with 0 refused `/api` and 0 page errors; pmo → admin redirected; hrbp admin/dashboard, pmo execution/DD stay | closed |
| WR-C02 helpdesk false success | `cb68e20` | `client-authz-hiding:1360,1413,1435,1702`; access map `helpdesk:false` for employee (live) | closed (real channel → Phase 22, see SC-04) |
| WR-C03 assessment-instances 403s | `b36ce5e` | live hrbp map `assessmentInstances:false`; `client-authz-hiding:1452,1464` | closed |
| WR-C04 DD/org page gate | `104a75e` | live Playwright: employee → `/due-diligence.html`, `/org.html` redirected, 0 refused | closed |
| WR-C05 stamps / cache-bust table | `d2f3b25` | `test/asset-cache-bust.test.js` green in suite | closed |
| WR-C06 key drift | `3b96d69` | `client-authz-hiding:1684` live key cross-check | closed |
| WR-C07 comms to employees invisible | `140f8b2` | `client-authz-hiding:1605,1622` | closed (own-messages → Phase 22, see SC-04) |
| IN-C01 Day pill in real deals | `0b3e068` | live map `timeTravel:false` bound, `true` only unbound + write rule | closed |
| IN-C02 signage | `75bfc24` | `client-authz-hiding:1566-1587` | closed |
| IN-C03 flash | `6df61b5` partial | `client-authz-hiding:1629,1641`; header-pill residual → Phase 15 | partial (cosmetic) |
| IN-C04 / IN-C05 / IN-C06 / IN-C07 | documented / accepted / deferred / deferred | — | see SC-04 |

## Accepted-risk register (AR-11-nn)

| ID | Threat / finding | Rationale | Accepted by | Still valid |
|----|------------------|-----------|-------------|-------------|
| AR-11-01 | T-11-03 — 403-vs-404 route-existence oracle | route existence is public (static client code); refusal bodies are fixed strings with no data; record existence is handled by the uniform 404. Note: the admin-prefix role check answers first with the write-policy string, so two fixed strings exist — reveals only that a path is admin-prefixed, which the client code already shows | planner 11-01 | yes |
| AR-11-02 | T-11-04 — demo store lenient reads | showcase data only; locked D-11-01; any deal or control-plane resolution is strict. **Caveat (SC-02):** in `MA_MODE=real` the demo copy is *writable* by unbound staff sessions, so the "showcase only" premise relies on operators always selecting a deal before working | planner 11-01 | yes, with the SC-02 caveat carried to Phase 17/23 |
| AR-11-03 | T-11-23 — missing vs invisible timing | both paths are one in-memory lane scan plus an in-memory provenance find; reviewer measured indistinguishable (~1 ms) | planner 11-03 | yes |
| AR-11-04 | T-11-35 — per-process denial bound; crash / graceful-restart loss of pending folded counts | first row of every window is durable; `flushAll` exists but is not wired to SIGTERM (documented as "a graceful restart loses the same pending counts", DEPLOYMENT.md:370); replicas:1 under Option B | planner 11-04 / amendment 7 | yes |
| AR-11-05 | T-11-36 — busy audit.db on a denial → 503 | Phase 8 no-swallow contract; verified live (503 + Retry-After, never a success, count not lost) | planner 11-04 | yes |
| AR-11-06 | T-11-61 — access map reveals the role matrix | matrix is documented in DEPLOYMENT.md and inferable from 403s; booleans only | planner 11-07 | yes |
| AR-11-07 | T-11-72 — Playwright supply chain | pre-existing npx cache, not in package.json, not in the turnkey runtime path; empty dependency diff | planner 11-08 (AR-09-07 precedent) | yes |
| AR-11-08 | IN-03 — `POST /api/deals/:id/setup` (and `/members`) commit before the audit append | idempotent overwrite; a busy-audit 503 triggers the client retry which re-applies and audits; documented DEPLOYMENT.md:409-418; move inside the `.immediate` txn in Phase 20 | FIXER S (orchestrator-delegated) | yes |
| AR-11-09 | T-11-25 / IN-01 residual — synergy WRITE responses and a synergy 409 `currentRecord` echo stored `taskIds` incl. restricted ids to the staff caller who performed that write | count/existence only (ids, never content — verified live: 409 body carries the id, not the title); reaches only a member already editing that initiative; the hidden link must be preserved so it cannot simply be dropped on the write path; rework with the synergy write surface in Phase 18 | named in 11-REVIEW-FIX-S; this audit records it as an AR with an owner phase | yes |
| AR-11-10 | IN-C05 — `?empId=` binding change on the welcome link | MNPI-safe choice; greeting reflects URL text via `textContent` only | FIXER C | yes |
| AR-11-11 | **SC-01** — the deal's legal target name reaches an `employee` through `GET /api/settings` (`targetCompany` is in `PUBLIC_SETTINGS_KEYS`), `GET /api/assessment-status`, and the `company` field of its own `get-or-create` roster row, while the CR-01 deal-record projection withholds `targetCompany` from the same role | **Decision of this audit: acceptable for Phase 11, severity LOW.** PRD D-11-02 defines the public subset by *secrets* (API key, connection details, "secret-ish fields"), and the allowlist is PRD-conformant; the employee portal's shell header renders the target name for the acquired company's own employees by product design; an employee-role account exists in a deal only because the IL added it. The inconsistency with the (stricter) projection must be resolved ONCE in Phase 17 (IL Cockpit & Real-Deal Shell): either withhold the name on every employee-reachable surface or restore it in the projection. Until then `name` (the code name) is what the switcher shows an employee | this audit (orchestrator-delegated decision); confirm at Phase 17 | yes |

Pre-existing residual continued unchanged: T-ERM-08 — `GET /api/notifications` `raid_high` / `tasks_*` counts include clearance-restricted entries for roles that may read the lane (count only, never which record).

## New findings (not in either review)

| ID | Sev | Finding | Evidence | Recommendation |
|----|-----|---------|----------|----------------|
| SC-01 | low | `targetCompany` reaches `employee` via settings / assessment-status / get-or-create `company` while the deal projection withholds it (policy inconsistency, not a PRD breach) | live: employee `GET /api/settings` → `{targetCompany:"NextGen Sensors GmbH", …}` (2 keys); `GET /api/assessment-status` → same; own roster row `company:"NextGen Sensors GmbH"` | accepted for this phase as AR-11-11; one decision in Phase 17 |
| SC-02 | **medium** (pre-existing design, non-blocking) | In `MA_MODE=real` an UNBOUND session (no deal selected) resolves to the writable demo *copy* under `MA_DATA_DIR`; reads there are lenient (D-11-01) and writes are allowed for staff. Anything a staff member types while unbound is readable by every unbound session of every role, including `employee`. T-11-04's "showcase data only" premise therefore depends on operator discipline, not on a control | probe 2: unbound hrbp `POST /api/integration-tasks {title:"typed while unbound: Project Falcon valuation 850m"}` → 201; unbound employee `GET /api/integration-tasks` → 200, row visible | Phase 17/19 (real-deal shell / mode-aware chrome): in real mode make the demo copy read-only for writes (or require a deal binding before any write), and show the "no deal selected" state instead of the showcase. Carry to Phase 23 as a composition seam (real mode × demo leniency) |
| SC-03 | low | Not every authorization refusal is audited. The denial auditor covers the gate, resolver, lockdown, grants-inline, clearance-404 and the DD/org *read* clearance sites, but 20 inline handler `403`s record nothing: org-design WRITE clearance refusals (`server.js:5623,5730,5766,5803,6054,6164,6239,6269` "not cleared to edit the org design / flight-risk register"), IL-only inline role checks (`:5200` rebaseline, `:6042,6155,6234,6263`), `POST /api/deals/:id/members` admin-only (`:1832`), `POST /api/deals/select` non-member (`:1812`), assessment owner (`:3783`). DEPLOYMENT.md:346 ("Every request the server refuses on authorization grounds is written to the audit trail") overstates the implementation; the plan's declared scope (gate/resolver/clearance-404) is met, so T-11-31 stays CLOSED | auditor grep of `status(403)` sites vs. a 12-line context for `recordDenial|recordClearanceDenial|denyAt|refuseDdArea` | one-line change per site: `return denyAt(req, res, 403, 'role-inline' \| 'org-clearance', body)`; fix the DEPLOYMENT.md sentence. Candidate for Phase 12 (audit) or a `/gsd-quick` |
| SC-04 | low (process) | The review deferrals exist only in the fix reports: WR-C02 real employee helpdesk channel → Phase 22, WR-C07 employee own-messages projection → Phase 22, IN-C06 lesson checkbox → Phase 15, IN-C07 demo-open admin.html → Phase 20, IN-C03 header-pill flash → Phase 15, IN-01 write-echo residual → Phase 18. `ROADMAP.md` / `REQUIREMENTS.md` carry no item naming any of them (only the phase headers). A transfer with no record at the destination is how items get lost between milestones | `grep` of ROADMAP/REQUIREMENTS for helpdesk / own-messages / lesson checkbox → no hits | capture each as a backlog line under its target phase (or `/gsd-capture`) before Phase 12 starts; IN-03 is the one deferral that *is* recorded (DEPLOYMENT.md Known limitations) |
| SC-05 | info | `evidence/phase9-walk.log` embeds a local absolute path (`/private/tmp/claude-501/-Users-karstenhaldan-M-A/…/scratchpad/ev-p9/results.json`) — the OS user name in a committed file. No credential, no MNPI | grep of evidence | strip or regenerate before the release-cut evidence sweep |

## Live re-verification results (isolated instance)

Setup: `MA_MODE=real`, fresh `MA_DATA_DIR`, one deal `deal_sec11` with members admin / hrbp (name "Helen IL") / pmo with `hr` grant / pmo without grants / two employees ("Alice A", "Bob B"), a second deal with a non-member hrbp, and two UNBOUND sessions (pmo, employee). Seeded MNPI: wizard basics `dealSizeM 850`, `dealSettings.synergyTargetM 42.5`, deal-db `settings.targetCompany "NextGen Sensors GmbH"`, an `hr` finding "SECRET retention CFO Falcon" converted to a task + RAID entry, a synergy initiative linked to the restricted task, pulses from the IL and an employee.

| Area | Result |
|------|--------|
| CR-01 | employee / pmo `GET /api/deals` and `select` echo: projected, 0 of 13 MNPI markers present; hrbp full; employee setup write → 403 |
| Read matrix (acceptance 1) | employee 403 fixed body on synergies(+rollup), raid, tasks, templates, employees, communications, org/*, dd/*, reports/export+pack, hrbps, assessment-instances, projects, processes, assessments, ai, rag, grants, unlisted; 200 on courses/lessons/notifications/pulses/settings/menus/i18n/assessment-status/deals; HEAD + OPTIONS → 403 |
| Variants | `/api/Synergies`, `/api//synergies/`, `/api/%73ynergies`, `/api/synergies;x`, `/api/synergies/./`, `/api/SYNERGIES/rollup`, `/api/synergies%2Frollup`, `?x=1` → all 403/404; audit rows for the 8 probes ≤ 2 (canonical templates) |
| Config surface | hrbp/pmo POST on 8 config families and 4 spellings → 403; hrbp settings keys ⊆ allowlist; admin flag-not-key |
| Deal setup | non-member hrbp 404 byte-identical to missing; bounds 400; `deal-settings-update` row with actor/before/after |
| Time-travel | unbound pmo 200; bound hrbp 403 demo-only; unbound employee 403 |
| Clean-room | uncleared pmo: update (v0 / stale / no version / status flip), delete (v0 / stale), RAID update/delete → `404 {"error":"Not found"}`; missing-id body identical; restricted record unchanged; synergy link with restricted id ≡ unknown id (400); cleared pmo stale → 409 `currentRecord`; convert by uncleared → 403 (DD gate) |
| Denial bound | gate role-read: fold verified; clearance-404: fresh actor 5 probes → 1 row, flush → `count:4 folded:true`; DD 26 → 2; flight-risk 25 → 1; decisions 10 → 1; anonymous 401 → `(anonymous)` row; no request body in any row |
| Busy audit (T-11-36) | denial under a foreign `BEGIN IMMEDIATE` on audit.db → 503 after 1080 ms, `Retry-After: 1`; afterwards 403 + exactly one row |
| WR-02 | 6 reserved spellings → 400 (incl. admin); free text 201; re-convert adopts the genuine stamped task |
| WR-03 / amendment 5 | own `emp_acct_` row, name from account, server defaults; forged values absent from the staff roster; GET form → employee 403 / staff 404 |
| IN-04 | `get-or-create/` → 200 same record; `Employees` / `%67et` variants → 403, never 500 |
| Pulses | employee own-only (both), pmo own + aggregate `{day,rating,type}`, hrbp full; forged `employeeName` → account name; forged `authorUsername` ignored |
| Exports | uncleared pmo tasks/raid/synergies/workstreams JSON+CSV: no SECRET title, no restricted id; rollup clean; dd/summary no `hr` bucket; pack 200 `application/pdf` (code path `server.js:7450-7458` clearance-filtered; raw-byte scan for the title negative but inconclusive — PDF streams are compressed) |
| Notifications | employee: assessment nudges only; hrbp: `tasks_overdue` present |
| Access map | employee all-false incl. `configWrite/helpdesk/timeTravel`; hrbp `configWrite:false`, `timeTravel:false`, `assessmentInstances:false`; `/api/auth/me` carries no deal record |
| Client gate (Playwright) | employee → `/admin.html`, `/pmo.html`, `/due-diligence.html`, `/org.html`, `/execution.html`: redirected to `/`, 0 refused `/api`, 0 page errors, no MNPI string in DOM; pmo → `/admin.html` redirected; employee `/employee.html`, pmo `/execution.html` + `/due-diligence.html`, hrbp `/dashboard.html` + `/admin.html` stay with 0 refused |

## Composition-seam results

| Seam | Finding |
|------|---------|
| Clean-room (4/6) × optimistic locking (9) × 404 guard + store backstop (11) | Guard precedes `conflictIfStale` at every by-id site (structural test + code); the armed `clearanceFilter` reuses the same `recordVisibleTo` rule, so the WHERE-layer echo matches the precheck; unarmed callers on the four task/RAID lanes fail closed by provenance (`conflictVisibleRecord`). Cleared callers keep the Phase 9 409 unchanged (live). No bypass found. |
| Canonical-path gate (10) × read policy (11) × denial templates | Read verdict is canonical-anchored and most-restrictive; templates are resolved by `layer.regexp.test(canonicalPath)` over lowercase registrations (coverage test enforces lowercase routes), so spelling variants fold into one key (live ≤ 2 rows for 8 variants). Unrouted paths fold into `(unrouted)` — the stored `path` is clipped to 256 chars and is not part of the key. Bounded. |
| Deal-record projection × switcher / members / grants / archive | All 10 registry exits go through `dealForCaller` (static scan test + live list/select); members/grants/archive are admin/hrbp-only by write policy or inline guard, so the projection there is the full record by design; `/api/auth/me` returns `dealId` only. |
| Denial auditor × audit-inside-transaction (8) | In-process: every denial row is written at the gate / resolver / top of a handler / in the 404 error middleware — never inside `writeDb`'s `.immediate` transaction (synchronous better-sqlite3; a `RecordNotFoundError` is thrown before `writeDb` is reached). Cross-process: a denial that meets a busy audit.db is a 503 (live), never a swallowed refusal and never a success. |
| Public settings subset × routes that echo settings | `targetCompany` reaches every role via `GET /api/settings`, `GET /api/assessment-status` and the restricted get-or-create `company` field — SC-01 / AR-11-11 (PRD-conformant, inconsistent with the projection; Phase 17 decides). No secret reaches any non-admin (allowlist verified live; the forged key never appears in a response or an audit row). |
| Export / report / pack × clearance | tasks/raid via `reportTaskRows`/`reportRaidRows`, synergies via `synergyLinksVisibleTo` on export AND pack (`server.js:7309,7458`); live JSON/CSV clean for an uncleared pmo. Pack content not independently proven (compressed PDF). |
| Real mode × demo leniency (new) | SC-02: unbound sessions share a writable, lenient demo copy. |
| Alerts × communications | Checked because `/api/alerts` is ALL_ROLES while `/api/communications` is staff-only: communications dispatch (`/api/communications`, `/send`) mints no alert — the handler comment "Dispatches alert" is stale; alerts come only from `POST /api/alerts` (staff-authored broadcast, intended for every role). No side door. |
| What the lowest roles can still learn | employee: deal code name + status, target name (SC-01), CMS content, departments list, assessment status, own pulses/profile. Uncleared pmo: existence/count of restricted tasks only through (a) the synergy write/409 echo (AR-11-09) and (b) `raid_high` / `tasks_*` counts (T-ERM-08) — never content, never which record. |

## Residual risks to carry into Phase 23 (whole-codebase review)

1. **SC-02** real-mode unbound sessions write to and read from a shared lenient demo copy (operator-discipline control only) — until Phase 17/19 lands a bind-required or read-only demo lane.
2. **SC-03** inline handler 403s outside the denial auditor (org write clearance, IL-only inline checks, members admin-only, select non-member) — repudiation only; DEPLOYMENT.md sentence overstates coverage.
3. **AR-11-09 / T-ERM-08** count-only existence residuals for uncleared members (synergy write echo, notification counts).
4. **AR-11-11 / SC-01** target legal name on employee-reachable surfaces — needs one product decision (Phase 17).
5. **AR-11-04** pending folded denial counts are lost on crash and on graceful restart (`flushAll` not wired to `shutdown()`); per-process bound in multi-process shapes.
6. **AR-11-08** control-plane audit after commit on `/api/deals/:id/setup` and `/members` (Phase 20).
7. Convert-dedupe stamp requirement (WR-02 fix): a pre-T-ERM-01 legacy conversion without a `clearanceArea` stamp gets a second, stamped record on re-convert (duplicate preferred over adopting an unprovable record — documented in 11-REVIEW-FIX-S).
8. **SC-04** six review deferrals with no roadmap record.
9. Static `public/sent_emails/*` served unauthenticated (R1-06, Phase 14) and the by-design per-read audit row on `GET /api/org/positions` (Phase 6 D-03) — pre-existing, out of this phase's scope, noted by the reviewer and unchanged.

## What this audit could not verify

- Report-pack PDF content for an uncleared reader: the code path is the same clearance-filtered readers the exports use, but the PDF's text streams are compressed, so the raw-byte scan proves nothing on its own.
- Missing-vs-invisible timing (T-11-23) was not re-measured; the reviewer's 12×12 measurement and the in-memory code path were relied on.
- Multi-process behaviour of the denial bound, the shared-host soak and the full 205-visit Playwright matrix were not re-run; `soak.log`, `phase10-walk.log` (523/0) and `11-REVIEW-FIX-C.md`'s live confirmation were relied on, and 11 role×page visits were re-driven here.
- Demo-showcase walks (dev and demo-open lanes) were not re-executed; the `phase11-demo.log` byte-level baseline diff against `13a6da0` was relied on.
- The suite count differs from the fix reports (1258 here vs 1232 at `e6a5021`'s merge note); the suite is green at this HEAD, which is what the gate requires.

No implementation file was modified by this audit. The only file written is this document.
