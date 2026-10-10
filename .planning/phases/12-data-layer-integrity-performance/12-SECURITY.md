---
phase: 12
slug: data-layer-integrity-performance
status: SECURED
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_total: 87
threats_closed: 87
threats_accepted: 6
threats_open: 0
asvs_level: 1
block_on: high
audited: 2026-10-10
audited_head: a53d9b3
auditor: Claude Fable 5.1 (gsd-security-auditor, second-opinion model)
suite: 1458/1458 (node --test, 97 s, re-run by the auditor at a53d9b3)
live_probe: 111 checks on isolated instances (probe 1 real-mode 93, probe 2 dev-mode child boots 13, probe 3 real-mode 5) + 2-process soak smoke PASS + download-zip dry run
---

# Phase 12 — Data-Layer Integrity & Performance: Security Gate

**Verdict: SECURED.** All 87 `T-12-nn` threats declared in the `<threat_model>` blocks of plans 12-01..12-15 resolve to
CLOSED: 81 `mitigate` dispositions are located in code at `a53d9b3` (file:line below) and proven by a named test and/or a
live request on an isolated instance, and 6 `accept` dispositions (AR-12-01..06, incl. the fixer's IN-B06) have their
written rationale present and still valid. No declared mitigation is absent, present only in a comment, or present only
in a test fixture. The 16 review findings of `12-REVIEW.md` / `12-REVIEW-B.md` were each re-exploited against the final
tree (CR-01 case variant, WR-01 FULL sync, WR-02 fail-closed boot, WR-03 aborted export, IN-01 /healthz, IN-03
legacy_id, WR-B01 raw dot-segment paths, WR-B02 run-all asserts, WR-B03 double run, IN-B02/B04/B05) and are closed.
Six new findings (SC-01..SC-06) are recorded; the highest is SC-02 at MEDIUM and it is the Phase 11 carry-in #2 seam
(not a Phase 12 threat) reached through a new door, below the HIGH block threshold — so `threats_open` is **0**.

**Stance and method.** Every mitigation was assumed absent until found in source and exercised; SUMMARY, REVIEW and
FIX-report claims were used only as a map. Depth: ASVS L1 (control present) with L2 placement checks on every
clean-room, lifecycle and atomicity control (visibility before filter/total/page; audit append the last statement inside
the deal `.immediate`; refusals before any read, write or event). Live work ran on fresh `mkdtemp` instances under the
session scratchpad: probe 1 and 3 with `MA_MODE=real` + `MA_DATA_DIR`, probe 2 as child boots through
`test/helpers/boot-probe.js`; 127.0.0.1 port 0; every server closed, every temp tree removed, no process left behind.
`POST /api/settings/new-ma` was never called. Committed `data/demo.db` / `data/control.db` sha256 identical before and
after everything (`63d552c4…`, `e83f049e…`); `git status --porcelain -- data public/sent_emails` empty. Nothing installed.

## Verification performed

| Check | Result |
|-------|--------|
| `node --test` at `a53d9b3` (full suite, TAP) | 1458 pass / 0 fail / 0 cancelled (97 s under host load ≈ 37) |
| Live probe 1 (`sec12/probe1.js`, real mode): /healthz, raw HTML paths, clean-room × list/q/total/ETag/workspace/export/pack, 429, partition creation, 52 admin-only spelling probes, CR-01 variants, active-deal abuse, archive→seal→export→purge gates, WR-03 abort, retention matrix, 4 tamper scenarios, PD-30, WR-B03, perf guard, opt-in leak | 88 PASS; 5 FAIL triaged below (2 auditor arithmetic, 1 → SC-01, 2 → SC-02) |
| Live probe 2 (`probe2.js`, child boots): WR-02 absent registry, WR-02 garbage registry + login fail-closed, migration #1 happy path + `audit-verify --all`, dev-mode purge-permitted ordering (event before unlink), control chain after the full lifecycle | 13 PASS / 0 FAIL |
| Live probe 3 (`probe3.js`, real mode): where a member's write lands after the deal is archived | 5 PASS (behaviour confirmed → SC-02) |
| `SOAK_PROCESSES=2 SOAK_DURATION_MS=8000 node scripts/soak.js` | PASS: 175 acked / 0 lost / 0 committedButUnaudited / audit 1:1 / conflict lane 24 acked + 25×409 reconcile / partition chain verifies (201 rows) |
| download-zip `-x` list dry run against `data/audit/*.db`, `data/audit.db.pre-v1.bak`, `data/real/*`, `data/deals/*` | only `data/` (empty dir), `public/`, `server.js` in the archive |
| Evidence sweep `grep -rE "/Users/|/private/tmp|TEdemo|ma_session=|tempPassword|MA_BOOTSTRAP" evidence/` | no match (T-12-131; the Phase 11 SC-05 path leak is absent here) |
| `MA_TEST_*` hooks in non-test code | exactly 3: `MA_TEST_ALLOW_COMMITTED_CONTROL_DB` (inert without `NODE_TEST_CONTEXT`, loses to the real-mode refusal — proven live), `MA_TEST_AUDIT_MIGRATION_FAIL_AT` and `MA_TEST_PACK_WORKER_THROW` (both gated on `MA_MODE !== 'real'`, the latter twice) |

Triage of the 5 initial FAILs in probe 1: (1)+(2) "6003 rows" — `countAudit({dealId})` spans control rows carrying the
deal id too (12 of them: dd-findings-read, report-pack-generated, …); the seal response's `rows: 6004` = 6003 + seal row
confirms the partition itself held exactly what was appended — auditor error. (3) truncated-tail status signal → SC-01.
(4)+(5) a member write / an employee read answered 201/200 after the deal was archived — probe 3 traced both to the
demo copy (archive releases the sessions, which then resolve to the lenient demo lane) → SC-02.

## Threat register

Severity order critical > high > medium > low; `block_on: high`. CLOSED = control found at the stated location, placed
at the right boundary, proven by the named test and/or live check. CLOSED (accepted) = rationale present and still valid.

| ID | Category | Sev | Disp. | Mitigation location (code) | Proof (test / live) | Status |
|----|----------|-----|-------|----------------------------|---------------------|--------|
| T-12-01 | Tampering/Repudiation — tests writing real audit/runtime | high | mitigate | `db/dbFiles.js:383-420` `assertTestIsolation` at the `openDbFile` choke point `:526` (after the real-mode refusal, before any create), lexical + nearest-realpath + native-realpath, case-folded on darwin/win32 `:392-399`; `openReadOnlySnapshot :629` | `test/test-isolation-guard.test.js:64,87,103,160,180,189,217`; 11-04 static scan `test/denial-audit.test.js:593-601`; suite run left `data/*` byte-identical | CLOSED |
| T-12-02 | DoS — guard misfiring in production | medium | mitigate | `db/dbFiles.js:385` returns unless `NODE_TEST_CONTEXT` is a non-empty string | `test-isolation-guard:144`; live: real-mode probe, soak, CLIs all ran with the guard inert | CLOSED |
| T-12-03 | Supply chain — CI actions | low | accept | `.github/workflows/test.yml:23-24` `permissions: contents: read`, `:42-43` `actions/*@v4`, no `secrets.` | `test/ci-workflow.test.js:91,107`; AR-12-04 | CLOSED (accepted) |
| T-12-04 | Info — CI logs | low | accept | suite uses synthetic temp fixtures only (T-12-01 guard enforces) | `ci-workflow:118` no install step; AR-12-05 | CLOSED (accepted) |
| T-12-05 | Repudiation — green gate from a partial run | medium | mitigate | `scripts/test-gate.js:158-170` green ⇔ exit 0 AND `# fail 0` parsed AND no cancelled; `:127-135` recursion guard; one last-line verdict `:116-119` | `ci-workflow:33,44,53,63`; `evidence/gate.log` `GATE PASS runs=20` | CLOSED |
| T-12-10 | Repudiation — change without audit row | high | mitigate | `db/store.js:649,732,740,782` delta per INSERT / changed UPDATE / DELETE with `changes > 0`; `:839-871` append is the LAST statement inside `applyWrite` (`.immediate` `:872`); `db/auditHook.js:253-280` | `writedb-dirty-rows:119,147,182`; `audit-volume:87,105,123`; soak check 4 (audit 1:1) live PASS | CLOSED |
| T-12-11 | Tampering — stale writer clobbers untouched row | high | mitigate | `db/store.js:662-684` untouched ⇒ no data statement; seq-only `UPDATE … SET seq WHERE id` `:609,680` | `writedb-dirty-rows:211` (another connection's committed change survives); `optimistic-locking-cross-process` green | CLOSED |
| T-12-12 | Tampering — lost reorder / resurrection | medium | mitigate | `db/store.js:678-682` seq-only by id (0 rows if deleted); `:733-743` non-versioned UPDATE by id | `writedb-dirty-rows:161,182,249`; `writedb-merge` green | CLOSED |
| T-12-13 | Info — conflict body echo | high | mitigate | `db/store.js:686-732` versioned branch unchanged, `conflictVisibleRecord :213-220` fail-closed on both throws `:715,767` | `clearance-write-paths`, `optimistic-locking-contract` green; `raid-list-query (k)` filtered 409 echo | CLOSED |
| T-12-14 | Repudiation — duplicate rows on 2nd writeDb | low | mitigate | `db/store.js:573-576,892-913` baseline refresh only AFTER commit | `writedb-dirty-rows:269,298` | CLOSED |
| T-12-15 | Tampering — seeder/perf script writing real data | medium | mitigate | `scripts/perf/write-latency.js:61,88-96` MA_* set before require + every resolved path asserted under the scratch dir; `scripts/perf/lib/instrumented-server.js:60-70` `assertScratchEnv` | `perf-harness-guards:35,41`; live: `assertScratchEnv` refused `data/control.db` | CLOSED |
| T-12-16 | DoS — perf scratch on a full disk / left behind | low | mitigate | `write-latency.js:70-73,214` cleanup in `finally` + SIGINT/SIGTERM; `instrumented-server.js:47-57` ≥ 1 GB precondition | `perf-harness-guards:50,62` | CLOSED |
| T-12-20 | Integrity — stale cached client | high | mitigate | `lib/assetStamp.js:56-58,126-174` stamp = sha256(served bytes)[0:16], transitive; `server.js:313-318,365-377` every HTML response rewritten, terminal (WR-B01) | `asset-cache-bust:120,153,205,260` (negative control); `asset-stamp-unit:60,84`; live: `index.html` stamp `f0eabd798b4f0d1d` == hash of served `/js/transitions.js`, 7 non-canonical spellings → 404 | CLOSED |
| T-12-21 | Info — traversal through the rewrite reader | high | mitigate | `lib/assetStamp.js:39,79-88` segment whitelist, `.`/`..` rejected, resolved prefix check before any read; `server.js:321-331,352-363` decode/NUL/backslash/`%2e%2f%5c`/normalise checks | `asset-stamp-unit:172`; `asset-cache-bust:153` (raw socket); live 7 variants → 404 | CLOSED |
| T-12-22 | EoP — rewrite bypassing credential lockdown | medium | mitigate | lockdown middleware `server.js:275` mounted before body parsers and the HTML middleware `:365` | `asset-cache-bust:286` (child, real mode); `lockdown-asset-allowlist` green | CLOSED |
| T-12-23 | DoS — hashing per request | low | mitigate | `lib/assetStamp.js:97-99` rawCache keyed `mtimeMs:size`, `:155-160` resultCache keyed by dep stamps | `asset-stamp-unit:72` ("unchanged file is not re-read") | CLOSED |
| T-12-30 | DoS — pack/pdf-parse freezing the loop | high | mitigate | `lib/isolatedTask.js:165-190` synchronous `tryAcquire`, no queue; `server.js:8236-8240` 429 + `Retry-After`, `:2566-2570` rag 429; render in worker `:8268`, `:2584` | `cpu-isolation:200,323`; `evidence/perf.log` pack p99 11.4 ms; live: concurrent packs → 200 + 429 with Retry-After | CLOSED |
| T-12-31 | DoS — unbounded queue / stuck worker | medium | mitigate | `isolatedTask.js:73` 60 s `timeoutMs`, `:134-138` terminate + settle, next job respawns `:129` | `cpu-isolation:146,156,165` | CLOSED |
| T-12-32 | Info — MNPI model leaving the process | medium | mitigate | worker modules `lib/workers/*.js` require only `worker_threads`/renderer; `report-pack-worker.js` bytes out only | `cpu-isolation:437` banned-require source assertion | CLOSED |
| T-12-33 | Repudiation — pack audit lost | medium | mitigate | `server.js:8283-8294` `report-pack-generated` on the main thread after `lease.run` | `cpu-isolation:215`; live: exactly one event for the one 200 | CLOSED |
| T-12-34 | DoS — client retrying a permanent 503 | low | mitigate | `server.js:8221`, `:9219` `retryable: false`; `public/js/transitions.js:1021-1041` `isPermanentUnavailable` | `client-busy-retry:221,236,248` | CLOSED |
| T-12-35 | EoP — env test hook in production | low | mitigate | `server.js:8267` and `lib/workers/report-pack-worker.js:20` both require `MA_MODE !== 'real'` | `cpu-isolation:448`; auditor grep: no other `MA_TEST_` hook unguarded | CLOSED |
| T-12-36 | DoS — pdf-parse silently in-process | medium | mitigate | `isolatedTask.js:75-77` any non-thread mode throws (never falls back); `pdf-parse` required only in `lib/workers/pdf-text-worker.js:17` (auditor grep of `server.js`/`lib/*.js`: no in-process require) | `cpu-isolation:175,291,456` | CLOSED |
| T-12-37 | DoS — pack perf scratch | low | mitigate | `scripts/perf/pack-isolation.js:64-70,81` cleanup on finally/SIGINT/SIGTERM + `assertEnoughDisk` | `perf-harness-guards:62` | CLOSED |
| T-12-40 | Info — `total`/`q` existence oracle | high | mitigate | `server.js:6028-6055` projection → `raidRowVisible` → filters → `sendList` (total after visibility); `lib/listQuery.js:12-16,145-151` | `raid-list-query:219,232,285`; live: uncleared pmo `?q=SECRET&limit=10` → `{items:[],total:0}`, `?workstream=ws_legal` → 0, hrbp → 2 | CLOSED |
| T-12-41 | Info — second divergent RAID filter | high | mitigate | one predicate `raidRowVisible :5850-5856` used by `reportRaidRows :5933-5938` and the list `:6053` | `raid-list-query (a),(f)` byte identity per identity; `raid-access-filter` green | CLOSED |
| T-12-42 | Integrity — fail-open unloaded collection | high | mitigate | `db/store.js:424-432` non-enumerable throwing accessors; `:549-560` payload with unloaded key refused | `read-collections:104,123,180`; wire body fixed `Internal server error` (REVIEW-B probe) | CLOSED |
| T-12-43 | Tampering — SQL injection via fields/filters | high | mitigate | `db/store.js:371,461-470` identifier regex + bound `'$.'+field`; `lib/listQuery.js:113-132` JS comparison only, `:65-78` zod | `read-collections:250`; `raid-list-query:308`; live: `status=open' OR 1=1--` → 400 | CLOSED |
| T-12-44 | DoS — huge limit/offset | low | mitigate | `listQuery.js:23,39,65-68` `LIMIT_MAX 200`, 9-digit offset | `raid-list-query:308`; live `limit=201` → 400 fixed body | CLOSED |
| T-12-45 | Tampering — perf scripts writing committed DBs | medium | mitigate | `scripts/perf/lib/scratch-deal.js:33-35,88` `openReadOnlySnapshot` + `backup()` copies, data-dir refusal; `instrumented-server.js:60-70` | `perf-harness-guards:31-47`; `deal-seed:217` (IN-B04) | CLOSED |
| T-12-46 | DoS — list-reads scratch | low | mitigate | `scripts/perf/list-reads.js:37-38,132`, `scratch-deal.js:49,64` | `perf-harness-guards:50,62` | CLOSED |
| T-12-50 | Integrity — partially applied migration | high | mitigate | `db/migrate.js:274-281` up() + `user_version` bump in ONE `.immediate` txn, version re-read under the lock | `schema-migrations:147` (two processes once), `:212` (broken rolls back, sticky) | CLOSED |
| T-12-51 | Integrity — serving a corrupt file | high | mitigate | `db/dbFiles.js:497-499` quick_check on open (non-audit), `:530-531,583-594` sticky not-ready; `server.js:9214-9223` 503 `retryable:false`, fixed body | `schema-migrations:232`; `healthz-readiness:130` | CLOSED |
| T-12-52 | Info — /healthz detail | low | mitigate | `db/readiness.js:49-54` basename / `deal` / `audit-partition` only, `:84-105` no counts, de-duplicated; `server.js:1650-1661` | `healthz-readiness:38,52`; `readiness-snapshot:16`; live: no `files`, no path, no `deal_` id; WR-02 503 body path-free | CLOSED (see SC-06) |
| T-12-53 | EoP — `MA_MIGRATIONS_DIR` code loading | medium | mitigate | `db/migrate.js:95-103` `[security]` throw at require time when `MA_MODE=real` | `schema-migrations:403`; live child: exit 1 with `[security] MA_MIGRATIONS_DIR` | CLOSED |
| T-12-54 | Tampering — committed demo/control stamped | high | mitigate | `db/migrate.js:242-265` committed ⇒ never written, baseline implied | `schema-migrations:353,382` (sha before/after); auditor: committed sha unchanged after suite + probes | CLOSED |
| T-12-55 | DoS — busy during migration marked failure | medium | mitigate | `db/migrate.js:284-285` SQLITE_BUSY* propagates unchanged | `busy-503-contract` green | CLOSED |
| T-12-56 | EoP — lockdown scan skipped when control not ready | low | mitigate | `server.js:255-262` `bootOpen` around the scan; every session/login path needs control.db | `schema-migrations:244-283` login not 2xx, no session; live probe 2: login → 503 | CLOSED |
| T-12-57 | DoS/Integrity — audit migration inside a deal txn | high | mitigate | `server.js:1694` `bootOpen('audit')` before listen; `db/auditHook.js:142-145` partition opener refuses to first-open audit.db; `db/store.js:882` pre-open before `BEGIN IMMEDIATE` | `healthz-readiness:76`; `audit-partitions:298`; `audit-legacy-migration:225` | CLOSED |
| T-12-58 | DoS — backup migration exhausting disk | high | mitigate | `db/migrate.js:194-216` 3×size + 64 MB precondition, partial `.bak` removed `:213`, stale `.bak` replaced `:208`, 0600 `:211` | `schema-migrations:298,323,338`; DEPLOYMENT.md:560-565 | CLOSED |
| T-12-59 | Integrity — un-migrated deal served after boot | medium | mitigate | `server.js:1701-1722` boot sweep over registered deal files, never creates a file | `healthz-readiness:97,130` | CLOSED |
| T-12-60 | Info — generated passwords in output | medium | mitigate | `scripts/smoke/run.js:180-188` `redact()` over every `say()`, secrets registered `:447,467,478,485` | auditor grep of `evidence/smoke.log` clean | CLOSED |
| T-12-61 | Tampering — harness touching committed data | medium | mitigate | `smoke/run.js:218-219` `MA_MODE=real` + mkdtemp `MA_DATA_DIR`, `:127-138` sha256 (+-wal) before/after, `:531` git status line | `evidence/smoke.log:75` "sha256 unchanged … unchanged" | CLOSED |
| T-12-62 | Supply chain — Playwright / axe-core | low | accept | resolved only from env path or npx cache `smoke/run.js:57-78`, never installed | `smoke-harness:91,103`; AR-12-03 | CLOSED (accepted) |
| T-12-63 | Info — harness in a release zip | low | mitigate | `.gitattributes:5` `scripts/smoke/ export-ignore` (+ `:8` perf, IN-B05) | `smoke-harness:49` (check-attr + `git archive`) | CLOSED |
| T-12-70 | Repudiation — committed-but-unaudited deal write | high | mitigate | `db/store.js:839-871` append last inside the deal `.immediate`; `db/auditHook.js:253-280` partition append on its own `.immediate` (`auditChain.js:140-163`); WR-01 `dbFiles.js:565-567` audit families `synchronous=FULL` (+fullfsync) | `audit-partitions:166` (busy rolls back), `:478` (FULL); soak check 2/4 live PASS (0 committedButUnaudited); residual direction documented DEPLOYMENT.md:466-473 | CLOSED |
| T-12-71 | Tampering — edit/delete/reorder rows in a partition | high | mitigate | `db/auditChain.js:99-113` canonical row incl. `prev_hash`, `:65-67` partition-bound genesis; `db/audit-partition-schema.sql` NOT NULL hashes + append-only triggers; `scripts/audit-verify.js:106-147` | `audit-partitions:200,235`; live: flipped byte → verify exit 1 + status/export/purge `modified-after-seal`; recomputed chain → `sealed-sha=MISMATCH` exit 1 | CLOSED |
| T-12-72 | Tampering — chain fork from concurrent appenders | high | mitigate | `db/auditChain.js:140-144` head read inside `BEGIN IMMEDIATE` | `audit-chain-multiprocess:124` (barrier + ≥ 2 writer switches, IN-02); soak check 10 live PASS | CLOSED |
| T-12-73 | Tampering — tail truncation of an unsealed partition | medium | accept | sealing records head/rows/SHA `auditLifecycle.js:194-209,221-222`; DEPLOYMENT.md:491-498, 598-602 | AR-12-01; live: truncation of a SEALED file is caught by `audit-verify` and re-seal (see SC-01 for the status surface) | CLOSED (accepted) |
| T-12-74 | DoS — partition files for arbitrary ids | medium | mitigate | `db/auditHook.js:142-152` partitions only from `appendWriteAudit` in a resolved deal context; `recordSecurityEvent :291-319` always targets `control`; `dbFiles.js:160-165` id validated before `path.join` | `audit-partitions:268,341`; live: 52 refused lifecycle probes + variant ids created nothing | CLOSED |
| T-12-75 | Info — partitions readable by other accounts / shipped | high | mitigate | `dbFiles.js:532,541-546` 0700 dir / 0600 file + sidecars; `.gitignore:42` `data/audit/`; `server.js:2523` `-x "data/audit/*"` | `file-modes:94,389`; `db-artifact-exclusion:84`; live: partition 0600; zip dry run excludes `data/audit/*` and `audit.db.pre-v1.bak` | CLOSED |
| T-12-76 | EoP — sealed file re-opened writable by 0600 chmod | medium | mitigate | `dbFiles.js:320-324` tightening-only; `auditChain.js:141-142` seal row refuses every append | `audit-partitions:431,383`; live: append on sealed → `AUDIT_PARTITION_SEALED`, file sha unchanged, 0400 kept | CLOSED |
| T-12-77 | DoS — deal/partition deadlock | medium | mitigate | fixed order deal → partition (partition innermost) `auditHook.js:249-251`; seal/purge take partition/audit locks only | `audit-chain-multiprocess`; soak smoke completed (no hang) | CLOSED |
| T-12-78 | DoS/Integrity — audit.db first-opened inside a deal txn | high | mitigate | `db/store.js:874-882` pre-open; `auditHook.js:143-145` `DbNotReadyError 'audit-not-open'`; `server.js:1694` | `audit-partitions:298`; `healthz-readiness:76` | CLOSED |
| T-12-80 | Info — task total/q oracle | high | mitigate | `server.js:4506-4521` `taskProjectionVisibleRows` before filters/total/page | `tasks-list-query:187,234`; live: pmo `?q=SECRET&limit=10` → total 0, hrbp → 1 | CLOSED |
| T-12-81 | Info — task and RAID rules drifting | high | mitigate | one core `clearanceAreaFromProvenance :5834-5844` behind `raidRowVisible`, `taskRowVisible`, `resolveTaskClearanceArea`, `resolveRaidEntryClearanceArea` | `tasks-list-query:294`; `task-access-filter` + `raid-access-filter` green | CLOSED |
| T-12-82 | Integrity — converted handler missing a collection | high | mitigate | throwing accessors (T-12-42); `TASK_READ_SET :4421` | `read-sets-execution:179,212,308` byte-equality per role | CLOSED |
| T-12-83 | Info — notification counts widened | medium | mitigate | `server.js:7852-7875` role gate + filters unchanged, counts from the light projection | `read-sets-execution:253,282`; `notifications-clock` green | CLOSED |
| T-12-90 | Info — batch endpoint leaking an uncleared area | high | mitigate | `server.js:7215-7244` maps seeded only from `grantedAreas`, rows `filterByAreaGrant` before grouping | `dd-workspace-batch:139,167`; live: pmo (no grant) → `areas:[]`, no keys, no SECRET; pmo+legal → only `legal` | CLOSED |
| T-12-91 | Repudiation — DD reads unaudited | medium | mitigate | `server.js:7237-7242` one `dd-findings-read` (subject `workspace`) per real-deal load | `dd-workspace-batch:189`; live: 2 loads → 2 rows | CLOSED |
| T-12-92 | Info — read-policy gap for the new GET | medium | mitigate | covered by the `/api/dd` rule (`lib/readPolicy.js`) | `dd-workspace-batch:214`; `read-policy-coverage` green; live: employee → 403 | CLOSED |
| T-12-93 | Integrity — converted DD handler missing a collection | high | mitigate | `DD_READ_SET :7141` + throwing accessors | `dd-workspace-batch:366`; every DD suite green | CLOSED |
| T-12-100 | Info — target-state / flight-risk rows to uncleared | high | mitigate | `server.js:6164-6175` hr gate asserted BEFORE the lane is read; `hrClearanceFilter :6002-6004` | `read-sets-org-reports:143,225,321`; `org-access-policy`, `org-positions` green | CLOSED |
| T-12-101 | Info — exports diverging from screen filters | high | mitigate | `server.js:7979-8000` export uses `reportRaidRows`/`reportTaskRows` over `REPORT_SET :7967` | `read-sets-org-reports:407` CSV/JSON byte equality per identity; live: pmo exports carry no SECRET, hrbp's do | CLOSED |
| T-12-102 | Repudiation — read/export audit lost | medium | mitigate | audit calls stay in the routes (`server.js:8283`, export handler) | `org-dd-read-audit`, `org-flight-risk-audit`, `reports-audit` green | CLOSED |
| T-12-103 | Integrity — converted org handler missing a collection | high | mitigate | throwing accessors | `read-sets-org-reports:186,373` | CLOSED |
| T-12-110 | Tampering — editing a sealed partition | high | mitigate | `auditLifecycle.js:221-222` 0400 + hash after every connection closed; `sealPartition :659-669,683-687` re-seal never launders; `partitionStatus :282-285`; `audit-verify.js:64-100` sealed-sha check | `audit-lifecycle:291,355`; `audit-lifecycle-routes:333`; live: flip → tamper events + 409s + exit 1; recompute → exit 1 | CLOSED |
| T-12-111 | Repudiation/Tampering — premature or silent purge | critical | mitigate | `auditLifecycle.js:334-352` refusal order, `:299-313` retention default never (typo → never), `:589` event BEFORE unlink; `server.js:2436-2455` `confirm === id`, admin-only; `audit-admin.js:154-157`; `app.auditClock` ignored in real mode `server.js:2370-2376` | `audit-lifecycle-routes:266,423` (structural no-timer); `audit-lifecycle:454,477`; live: 7 refusals in order, `0`/`-5` → never, real mode ignores the clock; probe 2: event count 1 at the moment of unlink | CLOSED |
| T-12-112 | EoP — non-admin / demo-open on lifecycle routes | high | mitigate | `/api/admin` rows `lib/readPolicy.js:35`, `server.js:563`; `db/resolver.js:52-53` control-plane; `validators/deals.js:138-139`; router case-sensitive `server.js:117` | `audit-lifecycle-routes:150,362`; live: 52 probes (3 roles × 13 forms incl. `/api/Admin`, `//`, `%61dmin`, trailing slash, HEAD, OPTIONS, `/api/admin/audit?deal=`) all 4xx, 0 events; admin on `.../AUDIT/seal` → 404 | CLOSED |
| T-12-113 | Info — export streaming MNPI | high | mitigate | `server.js:2398-2429` admin-only, `exportPartition :508-513` sealed-only, `no-store` + attachment `:2410-2414`, `-exported` with sha after the last byte `:546-549`, `res.destroy()` mid-stream `:2426`; DEPLOYMENT.md:510-516 | `audit-lifecycle-routes:216`; live: unsealed → 409 (no rows), sealed → ndjson/no-store/attachment, event sha == body sha, `--jsonl` verify exit 0 | CLOSED |
| T-12-114 | DoS — large export blocking the loop | medium | mitigate | `auditLifecycle.js:378,418-431` 500-row batches + `setImmediate` yield | `audit-lifecycle:501` (≥ 10 yields / 5,000 rows) | CLOSED (see SC-04) |
| T-12-115 | Tampering — writes during a seal in another process | high | mitigate | `auditChain.js:141-142` seal check inside every append's `BEGIN IMMEDIATE` | `audit-lifecycle:226`; `audit-partitions:383`; live append refused | CLOSED |
| T-12-116 | Repudiation — seal done, event lost | medium | mitigate | `sealPartition :681-692` idempotent re-seal records the missing event once | `audit-lifecycle:270`; live: re-seal `alreadySealed:true`, still one event | CLOSED |
| T-12-117 | Repudiation/Integrity — false tamper from a busy checkpoint | high | mitigate | `auditLifecycle.js:79-102,187,214` checkpoint checked pre AND post, 3×250 ms, `checkpoint-busy` refusal without chmod/hash | `audit-lifecycle:324,355,380` | CLOSED |
| T-12-120 | Repudiation — rows lost/duplicated by migration #1 | high | mitigate | `001-partition-legacy.js:191-244` watermark `MAX(legacy_id)`, `COUNT = COUNT DISTINCT = expected`, `verifyChain` before commit `:233-238,380-382`, accounting `:344-346`; `backup: true :388` | `audit-legacy-migration:112,277,413`; live probe 2: 5 rows → partition 5, `--all` exit 0 | CLOSED |
| T-12-121 | Tampering — editing control events | high | mitigate | `auditHook.js:230,303-318` every control row via `appendChained(…,'control')`; `audit-verify.js --all` | `audit-control-chain:104,133`; live: stripped hashes → `unchained-row` exit 1 | CLOSED |
| T-12-122 | Tampering — control chain fork | high | mitigate | `auditChain.js:140-144` under `BEGIN IMMEDIATE` | `audit-control-chain:104` (two processes incl. denial auditor) | CLOSED |
| T-12-123 | Tampering — triggers absent during the swap | medium | mitigate | `001-partition-legacy.js:308-314` V1_DDL with both triggers created inside the runner's txn | `audit-legacy-migration:172` | CLOSED |
| T-12-124 | Info — MNPI remaining in audit.db after purge | medium | accept | DEPLOYMENT.md:534-548 (§5), TE legal decides | AR-12-02 | CLOSED (accepted) |
| T-12-125 | DoS — long migration at boot | medium | mitigate | runs in `bootOpen('audit')` before listen `server.js:1694`; not-ready on /healthz until done; measured + 5 GB extrapolation DEPLOYMENT.md:573-582 | `audit-legacy-migration:225`; `evidence/perf.log` | CLOSED |
| T-12-126 | Info — backup file with MNPI | medium | mitigate | `migrate.js:211` `.pre-v1.bak` 0600 in the gitignored data dir (`.gitignore:37`, zip `-x data/audit.db*`) | `audit-legacy-migration:211`; live probe 2: bak mode 0600 with 6 rows; zip dry run excludes it; DEPLOYMENT.md:560-562 | CLOSED |
| T-12-127 | DoS — disk exhausted by migration/rehearsal | high | mitigate | PD-28 precondition (T-12-58); `scripts/perf/legacy-audit-migration.js:238-239` cap `MAX_ROWS`, `:84` free-space check, `:205,287-288,351-353` cleanup | `audit-legacy-migration:445`; `schema-migrations:298` | CLOSED |
| T-12-128 | Integrity — rerun writing a sealed 0400 legacy partition | medium | mitigate | `001-partition-legacy.js:196-210` read-only probe, `:223-225` RW only with rows remaining, sealed + remaining → throw | `audit-legacy-migration:277,331` | CLOSED |
| T-12-130 | Tampering — committed/local DBs during evidence runs | high | mitigate | `scripts/uat/phase10-walk.js:94-115,424-427` sha256 (+-wal) + `git status --porcelain -- data` (Phase 11 T-11-70 control reused) | `evidence/gate.log:3,176` snapshot before/after identical; `smoke.log:75`; auditor's own hashes unchanged | CLOSED |
| T-12-131 | Info — credentials/MNPI in committed evidence | medium | mitigate | synthetic deals; `smoke/run.js` redact; runner secrets env-only | auditor grep of `evidence/` for secrets AND absolute paths: no match | CLOSED |
| T-12-132 | Repudiation — budgets tuned to pass | high | mitigate | `scripts/perf/run-all.js:48-104` budgets 40/300/100/50 = PRD; `12-14-SUMMARY.md:21,26` `complete-with-gaps`; `12-VALIDATION.md:4,43,167,182` load-40 FAIL reported, "nothing was loosened" | `git diff --name-status 88cab66 HEAD -- scripts/perf` shows no threshold edit (12-VALIDATION:145) | CLOSED |
| T-12-133 | Supply chain — Playwright / axe-core | low | accept | as T-12-62 | AR-12-03 | CLOSED (accepted) |

**Totals:** 87 threats — 81 CLOSED by mitigation, 6 CLOSED (accepted), 0 OPEN. `threats_open` (OPEN with severity ≥ high) = **0**.

## Review findings — disposition re-check on the final code

| Finding | Fix commit | Re-verified by this audit | Status |
|---------|-----------|---------------------------|--------|
| CR-01 case-variant id seals an active deal | `2a19082` | `dbFiles.js:147` case-sensitive, `:190-196` file identity by exact-case `readdir`; live: `dEaL_…` variant → 404 ×4, nothing recorded, file 0600; `audit-verify --deal <variant>` exit 2; traversal-shaped ids 400/404 | closed |
| WR-01 `synchronous=NORMAL` on audit | `15d989d` | `dbFiles.js:565-567`; live pragma `synchronous` = 2 on audit.db and the partition; DEPLOYMENT.md:466-473 states the surviving direction | closed |
| WR-02 migration #1 fails open | `739a648` | `001-partition-legacy.js:125-171`; live probe 2: absent registry → 503 `deal-registry-unreadable`, v0 kept, 6 rows, no `.bak`, no `audit/`; garbage registry → same + `integrity-check-failed`, login 503 | closed |
| WR-03 aborted export unrecorded | `145f5c1` | `auditLifecycle.js:519-543`; live: socket destroyed at 64 KB of a 12 MB export → `-export-started` 1, `-export-aborted` 1, `-exported` 0 | closed |
| IN-01 /healthz deal-file count | `da61b1a` | `readiness.js:84-105`; live body has no `files` | closed |
| IN-02 multiprocess overlap | `5a36aee` | `audit-chain-multiprocess:62-83,148` barrier + switches ≥ 2 | closed |
| IN-03 non-numeric legacy_id | `8e55a0a` | `auditChain.js:79-88` throws; `audit-partitions:445` | closed |
| WR-B01 dot-segment HTML bypass | `c2d8f2a` | `server.js:352-377`; live raw socket: 7 spellings → 404, canonical → stamped | closed |
| WR-B02 `npm run perf` false PASS | `713cbd9` | `package.json` `--assert`; `run-all.js:118-134` `outputFailures`; `perf-harness-guards:69` | closed |
| WR-B03 double `run()` | `080314d` | `isolatedTask.js:174-176,135`; live: second run → `TASK_BUSY`, first completes, spawnCount 1 | closed |
| IN-B01 worker reply failure | `85da5c6` | `lib/workers/serve.js:29-40` trailing `.catch`; `cpu-isolation:135` | closed |
| IN-B02 case-variant `data/` | `0206359` | `dbFiles.js:387-399`; `test-isolation-guard:103` | closed |
| IN-B03 non-UTF-8 asset | `437d5bb` | `assetStamp.js:104-112`; `asset-cache-bust:180` | closed |
| IN-B04 direct read-only opens | `5bbf5bf` | `dbFiles.js:628-640`; `dealSeed.js:61`; `scratch-deal.js:34`; `deal-seed:217` — one further direct open remains in the perf harness (SC-03) | closed (note) |
| IN-B05 `scripts/perf` shipped | `af1c428` | `.gitattributes:8`; `smoke-harness:49-67` | closed |
| IN-B06 malformed `clearanceArea` hidden from all | accepted `1cde6c9` | DEPLOYMENT.md:651-656 | accepted (AR-12-06) |

## Accepted-risk register (AR-12-nn)

| ID | Threat / finding | Rationale | Accepted by | Still valid |
|----|------------------|-----------|-------------|-------------|
| AR-12-01 | T-12-73 — tail truncation of an UNSEALED partition (and replacement by an older valid copy) is undetectable by the chain alone | sealing at deal end records head hash + row count + file SHA-256 in the chained control log; documented DEPLOYMENT.md:491-498 and §Residuals :598-602; a data-dir writer is outside the control by design | planner 12-08 | yes — note SC-01: for a SEALED file the truncation IS detected by `audit-verify` and by a re-seal, but the status/export/purge surfaces say "not sealed" instead of "tampered" |
| AR-12-02 | T-12-124 — control-plane rows (deal lifecycle, grants, read audits, `access-denied`, seal/export/purge events with deal-registry snapshots) remain in `audit.db` after a purge | by design the lifecycle evidence; DEPLOYMENT.md:534-548 lists the residue and names TE legal as the decider; open item for the milestone, not for this phase | planner 12-13 | yes — must be raised before the first real deal is purged (Phase 23 / release notes) |
| AR-12-03 | T-12-62 / T-12-133 — Playwright + axe-core supply chain | not in `package.json`/`node_modules`, resolved from `PLAYWRIGHT_PATH`/`AXE_CORE_PATH` or the npx cache, versions printed, `scripts/smoke/` export-ignored (AR-09-07 / AR-11-07 precedent) | planners 12-07, 12-14 | yes (`smoke-harness:91`) |
| AR-12-04 | T-12-03 — `actions/checkout@v4`, `actions/setup-node@v4` pinned by major tag | `permissions: contents: read`, no secrets, no install step; fork PRs get the read-only token; SHA pinning recorded for Phase 21 (PD-23) | planner 12-15 | yes — carry the SHA pin to Phase 21 |
| AR-12-05 | T-12-04 — CI logs | the suite touches only synthetic temp fixtures (T-12-01 guard) and no real data dir exists on a runner | planner 12-15 | yes |
| AR-12-06 | IN-B06 — a RAID entry/task with a malformed (`object`/`boolean`) `clearanceArea` is hidden from everyone, admin included | fail-closed; both read paths agree; reachable only by editing the deal file; documented DEPLOYMENT.md:651-656 | fixer (12-REVIEW-FIX) | yes |

Pre-existing residuals continued unchanged and not re-counted here: AR-11-01..11 (Phase 11), T-ERM-08 notification counts.

## New findings (not in either review)

| ID | Sev | Finding | Evidence | Recommendation |
|----|-----|---------|----------|----------------|
| SC-01 | low | **Truncated tail of a SEALED partition is under-reported by the status/export/purge surfaces.** When a data-dir writer removes the trailing rows (incl. the `partition-seal` row) of a sealed 0400 file, `GET /api/admin/deals/:id/audit` answers `sealed:false, fileMatchesSeal:null, purgeBlockedBy:'not-sealed'`, export → 409 `not-sealed`, purge → 409 `not-sealed`, and **no** `audit-partition-tamper-detected` event is written — the surfaces describe a never-sealed trail although a `-sealed` event with a SHA is on record. Only `audit-verify` (exit 1, `sealed-sha=MISMATCH`) and a re-seal attempt (409 `modified-after-seal` + tamper event, no laundering) flag it. Fail-closed throughout (nothing exports, nothing purges), so no MNPI harm; an evidence-quality gap, and the attacker is already outside the documented control (write access to the 0700 data dir) | probe 1 "TAMPER truncate": `{sealed:false, fm:null, sealedSha:true, pb:'not-sealed', ex:'not-sealed', pr:'not-sealed', tamperEventsAdded:0}`; verify exit 1; re-seal 409 + tamper event | in `partitionStatus`/`exportPartition`/`purgeDecision`: when a `-sealed` event exists but the file's last row is not `partition-seal`, report `fileMatchesSeal:false` (tamper) and record `audit-partition-tamper-detected` — the mirror of the CR-01 "optional extra" the fixer left out. `/gsd-quick` or Phase 20; re-check in Phase 23 |
| SC-02 | **medium** (pre-existing design — Phase 11 carry-in #2, non-blocking) | **Archiving a deal silently redirects its members' next writes/reads to the shared, lenient demo copy in real mode.** `POST /api/admin/deals/:id/archive` releases every session bound to the deal (`server.js:2254`); the member's very next `POST /api/raid` answers **201** — the row lands in the writable demo copy under `MA_DATA_DIR`, not in the archived deal file and not in its partition, is **not audited** (demo kind), and an unbound `employee` on the same host reads it back. The client sees a success for a write that never reached the deal. Not a Phase 12 threat (seal/export/purge are unaffected — proven), and the lane itself is the SC-02 seam Phase 17 already owns | probe 3: bound write 201 (`/me dealId` = deal) → archive → `/me dealId` null → write 201 with `deal:[1,1] demo:[6,7] part:[1,1]`; employee `GET /api/raid` 200 contains the text; 0 audit rows carry it | Phase 17 (carry-in #2): real mode has no unbound data lane — after a release the session must land in a "choose a deal" state and data routes must refuse; until then the archive route should answer the released members' next request with a 409/`deal-archived` body rather than a lenient demo 2xx. Add this door to `11-CARRY-INS.md` row 2; re-test in Phase 23 |
| SC-03 | info | One direct `new Database(dealDbPath, { fileMustExist: true })` remains outside the `openDbFile`/`openReadOnlySnapshot` choke points, in `scripts/perf/lib/volume-deal.js:45` (writable, no isolation guard, no pragma contract). It only ever receives a scratch copy produced by `scratch-deal.js` (which refuses any path under `data/`), and `scripts/perf/` is export-ignored | auditor grep `new Database(` across `db lib server.js scripts` | route it through `openDbFile` (it needs the deal schema anyway) or list it beside the IN-B04 exceptions |
| SC-04 | info | The export route's backpressure wait registers a fresh `once('close')` listener on the response per drained chunk (`server.js:2406-2409`); Node printed `MaxListenersExceededWarning: 11 close listeners` during the 12 MB live export. Bounded (one per 500-row batch, released at response end), no functional effect | probe 1 stderr | remove the sibling listener when either `drain` or `close` fires (or use `stream.once` with cleanup); Phase 20 |
| SC-05 | info (pre-existing) | `/api` JSON list responses carry no `Cache-Control`; identity safety rests on the per-caller ETag (verified live: pmo + hrbp's ETag → 200 fresh body, own ETag → 304), so a 304 cannot cross identities, but a shared browser profile on one machine could still replay a cached body across logins | probe 1 "API list carries no Cache-Control" | `Cache-Control: private, no-store` on `/api/*` in the Phase 20 hardening pass |
| SC-06 | info | Unauthenticated `/healthz` still publishes which schema **families** have been opened (an `audit-partition` key appears once any deal has an audited write; `implied:true` marks a dev host). Fixed tokens only — no count, path or id | probe 1 body `versions:{control,deal,runtime,audit}` | when Phase 20 adds `/readyz`, put the `readiness` detail behind the admin gate and leave `/healthz` as `{status, ready}` |

## Live re-verification results (isolated instances)

Setup (probe 1): `MA_MODE=real`, fresh `MA_DATA_DIR`; one deal with members `s12admin` (admin), `s12hrbp` (hrbp),
`s12pmo` (pmo, no grants), `s12pmolegal` (pmo, `legal`), `s12emp` (employee) + an unbound admin session; seeded MNPI: a
`legal` DD finding, a stamped `legal` RAID entry, an unstamped `dd-finding:` RAID entry and a stamped `legal` task, each
titled `ZEBRAFISH-FALCON-SECRET`; three real audited writes + 6,000 chained rows appended to the partition.

| Area | Result |
|------|--------|
| /healthz | 200 `{status, ts, readiness:{ready, failures:[], versions:{control,deal,runtime,audit}}}` — no `files`, no path, no deal id |
| WR-B01 / stamps | `/x/../index.html`, `/vendor/../execution.html`, `/js/../index.html`, `/x/..%2findex.html`, `/%2e%2e/index.html`, `/index%2ehtml`, `//index.html` → 404; `/index.html` → 200, stamp `f0eabd798b4f0d1d` == sha256(served `/js/transitions.js`)[0:16]; no 10-digit hand stamp in the served page |
| Clean-room lists | pmo: `/api/raid` 1 row no SECRET; `?q=SECRET&limit=10` → `{items:[],total:0}`; `?q=zebrafish` → 0; `?workstream=ws_legal` → 0; hrbp and pmo+legal → total 2; tasks: pmo 0 / hrbp 1; `limit=201` → 400 fixed body; `status=open' OR 1=1--` → 400 |
| ETag | pmo with hrbp's ETag → 200 (own body, no SECRET); own ETag → 304 |
| DD workspace | pmo (no grants): `areas:[]`, no area keys, no SECRET; pmo+legal: only `legal` key, SECRET present, no `financial`; employee → 403; exactly 1 `dd-findings-read` per load |
| Exports / pack | pmo raid+tasks × csv+json: no SECRET; hrbp: SECRET present; concurrent packs → 200 (`application/pdf`) + 429 with `Retry-After`; exactly one `report-pack-generated`; employee pack → 403; pmo PDF bytes contain no raw SECRET (compressed streams — inconclusive) |
| Partition | created 0600 by the 3 writes, 3 chained rows, none in audit.db; chain verifies; `synchronous` = 2 (FULL) on audit.db and the partition |
| Admin-only matrix | 3 roles × 13 forms (`/api/Admin`, `/api//admin`, `admin//deals`, trailing slash, `%61dmin`, `/AUDIT/`, HEAD, OPTIONS, `/api/admin/audit?deal=`) + 13 anonymous → all 4xx, 0 lifecycle events, partition untouched; admin on `/AUDIT/seal` → 404 (router case-sensitive) |
| CR-01 | `dEaL_…` variant resolves to the same file on this FS; status/seal/export/purge → 404 `{"error":"Not found"}`; 0 events; file 0600 unsealed; `..%2F..%2Fcontrol` → 404, `deal_%2e%2e` → 400, `legacy`/`Legacy` without file → 404; CLI `--deal <variant>` exit 2 |
| Active-deal abuse | seal → 409 `deal-active` + `-seal-refused`; export → 409 `not-sealed` + `-export-refused`, no rows; purge confirm mismatch / array → 400 (no event); purge → 409 `not-sealed` |
| Archive → seal | archive 200; seal 200 sha256, file 0400, last row `partition-seal`, recorded sha == file sha, one `-sealed` event; re-seal `alreadySealed:true`, same sha, still one event; direct append → `AUDIT_PARTITION_SEALED`, sha unchanged; status `sealed:true, fileMatchesSeal:true, purgeBlockedBy:'no-sealed-export'`, `no-store` |
| WR-03 | socket destroyed after 64 KB of the 12 MB export → `-export-started` 1, `-export-aborted` 1 (`client-disconnected`), `-exported` 0 |
| Export | 200 `application/x-ndjson`, `Cache-Control: no-store`, `attachment; filename="audit-<id>.jsonl"`; `-exported.exportSha256` == sha256(body), `sealedSha256` matches; `audit-verify --jsonl` exit 0 |
| Purge gates | sealed+exported, retention unset → 409 `retention-never`; `=1` → 409 `retention-not-elapsed` + `eligibleAt`; `=0`, `=-5` → never; `app.auditClock` +400 d IGNORED in real mode; 7 `-purge-refused` events; `audit-verify --all` exit 0 `sealed-sha=match` |
| Tamper (sealed file) | flip one byte → `fileMatchesSeal:false`, export/purge 409 `modified-after-seal`, verify exit 1, 2 tamper events; truncate 3 trailing rows → verify exit 1 (sealed-sha), re-seal 409 + tamper event, one `-sealed` event only — but status/export/purge say `not-sealed` (SC-01); edit + recompute every later hash → chain `ok` yet verify exit 1 `sealed-sha=MISMATCH`, `fileMatchesSeal:false`; strip hashes on one audit.db row → verify `unchained-row` exit 1, next append links to the last hashed row (PD-30) |
| WR-B03 | second `run()` on a held lease → `TASK_BUSY`, first job completes, `spawnCount` 1; `tryAcquire` while held → null |
| Guards | `assertScratchEnv` refuses `data/control.db`; `MA_MODE=real` + `MA_CONTROL_DB_PATH=data/control.db` + `MA_TEST_ALLOW_COMMITTED_CONTROL_DB=1` + `NODE_TEST_CONTEXT` → `[security]` refusal, no boot; `MA_MODE=real` + `MA_MIGRATIONS_DIR` → exit 1 |
| Probe 2 (child boots) | legacy v0 audit.db (5 deal rows + 1 control row), no control.db → 503 `deal-registry-unreadable`, body path/id-free, v0 kept, 6 rows, no `.pre-v1.bak`, no `audit/`; garbage control.db → same + `integrity-check-failed`, login 503; registry present → 200, audit v1, partition 5 rows, `.pre-v1.bak` 0600 (6 rows), no `legacy.db`, `--all` exit 0; dev mode: 30-day retention → 409, clock +31 d → 200 purged, `-purged` row count == 1 **at the moment of unlink**, file gone, `-purged` carries `exportSha256`, control chain verifies |
| Probe 3 | see SC-02 |
| Soak smoke (2 processes, 8 s) | 175 acked / 0 lost / 0 mismatched / 0 committedButUnaudited / audit 1:1 / conflict lane 24 acked + 25 × 409 reconcile exactly / integrity ok / partition chain 201 rows verifies |

## Composition-seam results

| Seam | Finding |
|------|---------|
| Audit atomicity (8) × partitions (12) × denial auditor (11) × sealing | Deal deltas go to the partition as the last statement inside the deal `.immediate`; every control-plane row (`recordSecurityEvent`, incl. Phase 11 `access-denied`, DD read audits, lifecycle events) goes to audit.db's own chain and never to a partition — so a sealed deal's denials and lifecycle events are still recorded (live: 7 purge refusals after the seal, partition sha unchanged). A sealed partition refuses the deal write inside the txn (409 fixed body, nothing persisted). FULL sync makes the partition commit durable before the deal's. No bypass found. |
| Read sets × clearance (11) × paging | Visibility runs over the projection before filter, `total` and page in both list routes; the projection path falls back to the parsed row for non-string stamps; `findingAreaOf` resolves missing → null (unrestricted, T-06-45) and absent area → undefined (hidden) exactly like the whole-db path; ETag is per-caller body. Live: no oracle via `q`, `total`, filter, ETag, workspace keys, export, or pack event count. |
| Migrations × committed DBs × real mode | Real mode never opens a committed file (three refusals, live-proven even with the test opt-in); dev mode reports committed v0 files as implied-v1 without writing (suite + hashes). Migration #1 fails closed when the registry is unreadable (two live boots), takes a 0600 WAL-aware backup only after the precheck, and swaps the table with triggers inside one txn. Note for operators: the developer's own gitignored `data/audit.db` (86 MB) will migrate on the next dev boot (needs ~322 MB free; `.pre-v1.bak` is gitignored by `data/audit.db*`). |
| Workers × canvas / pdf-parse DoS | One in-flight per route, 60 s terminate-and-respawn, payload bounded by `express.json 50mb`; the model is clearance-filtered on the main thread before it crosses; the worker requires nothing but its renderer (source-asserted). An authenticated staff member can still pin one core for ≤ 60 s per upload — bounded, not characterised (same as REVIEW-B). |
| Stamper × credential lockdown × demo bundle | Lockdown precedes the HTML middleware; `login.html` is served stamped during lockdown and everything else stays 403 (suite, child process). The demo zip ships hand stamps that are overwritten at serve time; the zip excludes partitions, `.pre-v1.bak`, `data/real` (dry run). |
| Archive route × session release × demo leniency (new) | SC-02: released members fall into the lenient, writable demo lane with a 2xx. |
| Lifecycle id resolution × case-insensitive FS × registry | File identity by exact-case `readdir` + exact registry match at every entry (routes, `audit-admin.js`, `audit-verify --deal`); `getDeal` is a BINARY-collation `WHERE id = ?`; traversal-shaped ids never reach `path.join`. |
| Test-only seams × real mode | `MA_MIGRATIONS_DIR`, `freeBytes` injection, `app.auditClock`, `MA_TEST_PACK_WORKER_THROW` (main + worker), `MA_TEST_AUDIT_MIGRATION_FAIL_AT` are each disabled under `MA_MODE=real`; the isolation opt-in is inert without `NODE_TEST_CONTEXT` and loses to the real-mode refusal. |

## Residual risks to carry into Phase 23 (whole-codebase review)

1. **SC-02 / carry-in #2** — real-mode unbound sessions (now also every member of a just-archived deal) read and write a shared lenient demo copy with 2xx answers and no audit; Phase 17 must land a bind-required state.
2. **SC-01** — status/export/purge surfaces say `not-sealed` for a truncated sealed file; evidence quality only (`audit-verify` and re-seal detect it).
3. **AR-12-02** — control-plane MNPI residue after purge; TE legal decision pending before the first real purge.
4. **AR-12-01** — unsealed-partition tail truncation / older-copy replacement undetectable until sealing; a data-dir writer able to recompute hashes is outside the control (DEPLOYMENT.md §2).
5. **AR-12-04** — CI actions pinned by major tag; the workflow has never executed (first push = CERT-05); SHA pins in Phase 21.
6. **12-14 open item 1** — the 40-client event-loop p99 budget (100 ms) failed in runs 2–3 (112 / 133 ms vs baseline 1,921 ms); reported, not tuned (T-12-132 honoured). A DoS-resilience number, not a declared threat; Phase 23 should re-measure on a quiet host.
7. **WR-01 surviving direction** — after power loss an audit row may exist for a deal write that did not survive (documented DEPLOYMENT.md:466-473); detectable by the soak-style 1:1 reconciliation only.
8. **SC-05 / SC-06 / SC-04** — `/api` cache headers, `/healthz` family keys, export listener hygiene (Phase 20).
9. Pack PDF content for an uncleared reader still not independently provable (compressed streams); the model is the same clearance-filtered readers the exports use (byte-equality suite).

## What this audit could not verify

- Windows behaviour (read-only attribute, unlink-while-open, the CI matrix leg) and Linux-arm64 worker loading — code trace and executor probes on darwin-arm64 only.
- The 80 MB–5 GB legacy migration at real size and live `ENOSPC`/`SQLITE_FULL` during an append — relied on the synthetic rehearsal numbers in DEPLOYMENT.md §6 and the PD-28 unit tests (disk on this host is shared and tight).
- The full 20× gate, the 40-client perf profile and the Playwright smoke run were not re-executed (host load 30–55); `evidence/gate.log`, `perf.log`, `smoke.log` and the 12-VALIDATION sign-off were relied on, and the suite was re-run once (1458/1458) plus a short 2-process soak.
- Pack PDF text for an uncleared reader (compressed) — see residual 9.
- The CI workflow's first real execution (text-verified only, as 12-15 states).

No implementation file was modified by this audit. The only file written is this document; probe scripts, logs and the
TAP output live in the session scratchpad (`…/scratchpad/sec12/`) and every temp data directory was removed.
