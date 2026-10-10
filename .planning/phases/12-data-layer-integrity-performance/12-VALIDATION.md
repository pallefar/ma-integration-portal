---
phase: 12
slug: data-layer-integrity-performance
status: signed-off
nyquist_compliant: true
deferrals: ["Windows/ubuntu CI execution (first push, CERT-05)", "migration #1 boot cost under audit synchronous=FULL+fullfsync scales with partition count (product finding, Open items 5)"]
refreshed: 2026-10-11 (evidence re-run on the post-review-fix tree; original sign-off 2026-10-10 was on the pre-fix tree)
review_remediation: "16 findings in scope (12-REVIEW.md part A + 12-REVIEW-B.md part B): 15 fixed + 1 accepted, each mapped to commit + test below"
suite: { tests: 1459, pass: 1459, fail: 0, runs: 21 }
gate: { verdict: "GATE PASS runs=20 (first attempt on the post-fix tree, 1459/1459 each, soak smoke exit 0, host load 20-55; the four pre-fix attempts are kept as history)", runs: 20, command: "npm run test:gate -- --runs 20" }
soak: { verdict: PASS, acknowledged: 10451, lost: 0, audit_rows: 10451, bounded_503: 0, committed_but_unaudited: 0, conflict_lane: "1003 acknowledged / 2085 x 409 / 0 x 503", chain: "check 10 verifies, rows=11456", config: "default: 3 processes / 120 s" }
perf: { verdict: "PERF PASS (quiet host: load1 4.87, load5 14.71)", write: "PASS raid 13.4 ms / task 5.0 ms median, 1.0 audit row per create, 0 per reorder", list_reads: "PASS p95 115.2 / 108.4 / 103.5 ms", load_40: "PASS p99 93.9 / 89.7 / 90.8 ms, each run on a FRESH deal (budget 100)", pack: "PASS worst p99 9.6 ms, second request 429" }
runner: { pass: 695, fail: 0, lanes: 6, phase12_scenarios: "40 PASS / 0 FAIL (ddPageOneRequest 12, raidPagedApi 6, auditSealFlow 17, contentHashStamps 5)", phase11_and_demo_showcase: "authzRoleMatrix 226, cleanRoom404 38, denialAuditBounded 16, demoShowcaseUnchanged 191 - all PASS" }
phase9_walk: { normal: "350 PASS / 0 FAIL (asset-stamps scenario re-stated to the D-12-07 content-hash contract; check count per asset unchanged)", demo_open: "18 PASS / 0 FAIL" }
smoke: { visits: 12, with_errors: 0, axe_critical_plus_serious: 37, note: "informational (D-12-08)" }
signed: 2026-10-10
plan: 12-14
---

# Phase 12 - Validation (Data-Layer Integrity & Performance)

Signed against the written contract: `.planning/reviews/v3.0/PHASE-12-PRD.md` (acceptance 1-7), ROADMAP Phase 12
success criteria SC1-SC8, requirements DATA-01..06 / QUAL-01 / QUAL-02, the locked decisions D-12-01..08 and the planner
decisions PD-1..PD-31 recorded in the plans (with the plan-checker's revision-1 amendments). Every PASS names a test
file (and test name) or an evidence file. Anything not proven is stated in "Open items" - **no budget was loosened**.
This document was **refreshed on 2026-10-11** after the code-review fixes: the evidence was re-run on the post-fix tree,
the two items that were open at the first sign-off were resolved by orchestrator decision, and the "Review remediation"
section maps every review finding to its fix commit and test.

Evidence directory: `.planning/phases/12-data-layer-integrity-performance/evidence/` (`README.md` maps every file to its
acceptance item and gives the regeneration commands). Host: darwin-arm64, 11 CPUs, shared with other sessions (the
1-minute load average swings 6 -> 110 within minutes; budgets were measured only after the 1-minute load had been under
10 and the 5-minute load under 15, and the load is printed beside every measurement).

**Headline.** Everything the PRD asks to be proven is green on the post-review-fix tree, with reproducible evidence. The
two items that were open at the first sign-off are closed: the 40-client event-loop p99 now holds in every run (93.9 /
89.7 / 90.8 ms, each run on a fresh deal - the profile's real shape) and the Phase 9 walk is 350 / 0 after the
`asset-stamps` scenario was re-stated to the D-12-07 content-hash contract. Two things are reported, not hidden:
**load-40 passes with only 6-10 % margin and only on a quiet host** (Open items 6), and **review fix WR-01's
`synchronous=FULL`+`fullfsync` makes migration #1's one-time boot ~15x slower on an 800-deal tree** (Open items 5, a
product finding with a repro; no budget covers it).

Passing: write latency + one audit row per change (13.4 / 5.0 ms), the 10 x 3 list-read p95 (103-115 ms), the 40-client
event-loop p99 x3 (90-94 ms), pack isolation (9.6 ms, 429), paging / DD one-request, migrations at boot, hash-chained
partitions with seal / export / verify / purge, test isolation, 20 consecutive green suite runs of 1,459 tests, soak
(10,451 acknowledged, 0 lost), the Phase 10 runner (695 / 0) and the demo showcase, the Phase 9 walks (350 / 0 and
demo-open 18 / 0) and the smoke net.

## PRD acceptance

| # | Acceptance | Verdict | Proof |
|---|------------|---------|-------|
| 1 | 1k-task / 5k-RAID deal: create one record -> exactly 1 audit row, median write <= 40 ms; reorder persists with 0 audit rows | PASS (refreshed: raid 13.4 ms, task 5.0 ms median, 1.0 audit rows per create, reorder 0 rows, with WR-01's audit `synchronous=FULL`+`fullfsync` in place) | `test/audit-volume.test.js` ("audit-volume (create RAID): one POST /api/raid on the volume deal appends exactly ONE audit row", "(create task)", "(update)", "(reorder): an unmodified read -> write at volume appends 0 rows and a reorder persists with 0 rows"); `test/writedb-dirty-rows.test.js` ("changing one row of 50 appends exactly 1 audit row ... other 49 stored rows byte-identical", "a pure reorder persists the new order with 0 audit rows and no data blob rewritten", both `[versioned]` and `[non-versioned]`); `evidence/perf.log` write-latency: raid median 13.4 ms (p95 15.2), task 5.0 ms (p95 5.8), 1.0 audit rows per create, reorder 12.7 ms with 0 rows and order persisted (baseline 85.7 / 96.6 ms, ~6,220 rows) |
| 2 | `GET /api/raid?limit=50` -> `{items,total}`, no params -> unchanged array; DD page makes 1 request; p95 <= 300 ms and event-loop p99 <= 100 ms under the review profiles | PASS (refreshed 2026-10-11: event-loop p99 93.9 / 89.7 / 90.8 ms, each run on a fresh deal) | `test/raid-list-query.test.js` ("(a) unparameterized GET /api/raid is BYTE-identical ...", "(d) ?limit=10 -> { items, total }", "(f) restricted visibility is the same through the legacy array and the paged form"); `test/tasks-list-query.test.js` (a)-(h); `test/dd-workspace-batch.test.js` ("(d1) due-diligence.js load() has exactly one fetch", "(d2) executing the real page issues exactly one /api/dd/* request on load"); browser: scenario `ddPageOneRequest` @ real and `raidPagedApi` @ real in `evidence/phase10-walk.log` (the page load issues exactly `["GET /api/dd/workspace"]`, one edit adds `POST /api/dd/request-items` + one `GET /api/dd/workspace`; `?limit=5` -> `{items:5,total:7}`), shots `p12-dd-page-1440.jpg` / `-390.jpg`; `evidence/perf.log` list-reads p95 115.2 / 108.4 / 103.5 ms (baseline p95 483); load-40 p99 **93.9 / 89.7 / 90.8** ms with `scripts/perf/load-40.js` now giving every run its own fresh deal + server (the R2 profile shape; decision 1 of the 12-14 refresh) - the pre-refresh shared-deal numbers (86.3 / 112.2 / 133.0) are in `evidence/perf-summary.md` history |
| 3 | Old-version DB files (control / runtime / deal / audit) migrate at boot; a broken migration => not-ready | PASS | `test/schema-migrations.test.js` ("whole app: a version-0 control.db migrates at boot, before any request, and /healthz reports it", "whole app: version-0 runtime.db and demo.db migrate at boot (data intact)", "whole app: a broken control migration keeps the instance listening but not-ready, and fails closed", "a broken migration rolls back, leaves the file at its previous version and is sticky until restart", "whole app: two processes opening the same version-0 file at once run the migration exactly once"); `test/healthz-readiness.test.js` ("boot sweep: a registered version-0 deal file is at version 1 after boot with no request", "boot sweep: a corrupt registered deal file is not-ready immediately after boot", "audit.db is opened and versioned at boot with NO request made (checker B-1)"); `test/audit-legacy-migration.test.js` ("a legacy audit.db migrates at boot: partitions, sealed legacy, chained control log, backup, viewer join", "crash before the audit.db rebuild: not-ready, nothing changed; rerun completes idempotently"); `evidence/verify.log` section 2 (synthetic 20,000-row legacy tree migrated at boot, `audit-verify --all` OK) |
| 4 | Seal => read-only + control event; verify detects a flipped byte; purge refused without sealed export / retention; viewer spans partitions | PASS | `test/audit-lifecycle.test.js` ("(c) sealing an archived deal makes the file read-only and records ONE sha256 control event; re-seal is idempotent", "(f) a flipped byte in a sealed partition fails verify (chain AND sealed-sha), exit 1", "(l) purgeDecision follows the documented refusal order", "(m) a permitted purge records audit-partition-purged BEFORE it deletes the file", "(g, W-3) ... refuses the seal checkpoint-busy with NOTHING changed"); `test/audit-lifecycle-routes.test.js` ("routes (d): purge refusal matrix in order, then a permitted purge ...", "routes (e): a sealed file modified after the seal is refused for export and purge with a tamper event"); `test/audit-partitions.test.js` ("partitions (d) flipping one byte inside a stored row is reported by verifyChain and exits the CLI 1", "(h) the viewer returns a deal's partition rows UNION its control rows, each tagged"); scenario `auditSealFlow` @ real (archive -> seal -> status `sealed:true, writable:false, fileMatchesSeal:true`, repeated seal idempotent, early purge 409 `not-sealed`, viewer `?deal=` rows tagged with the partition, admin audit tab lists them; shot `p12-admin-audit-sealed-1440.jpg`); `evidence/verify.log` section 3 (scratch deal sealed through `scripts/audit-admin.js`, `sealed-sha=match`, export verifies, one-byte edit of the export fails verify, purge `retention-never`) |
| 5 | Pack render does not stall other requests (p99 <= 50 ms); second concurrent pack => 429 | PASS | `test/cpu-isolation.test.js` ("reports-pack isolation (GET /api/reports/pack)", "PD-14 probe: the pack renderer runs INSIDE a worker_thread", "isolatedTask: a second tryAcquire while one is held is refused (never queued)"); `evidence/perf.log` pack-isolation: worst round p99 9.6 ms, rounds 9.6 / 6.3 / 6.9 ms, B = `429 Retry-After=5` in every round (baseline 2,397 ms blocked) |
| 6 | Suite 20x consecutive green; no test touches `data/audit.db` / `runtime.db`; asset stamp == content hash test; workflow file present; smoke harness runs green once | PASS | `evidence/gate.log` (`GATE PASS runs=20`, 1459/1459 in every run, 2-process soak smoke exit 0, isolation snapshot PASS; sha256 + size of `data/audit.db*`, `data/runtime.db*`, `data/demo.db`, `data/control.db` before and after, with schema-only sentinel files at the audit/runtime paths so the equality is real); `test/test-isolation-guard.test.js` ("a default-path open under the runner fails loudly and creates nothing", "a child that requires server.js with no MA_* overrides dies with the named fix"); `test/asset-cache-bust.test.js` ("every public/*.html is no-cache and every js/css reference carries sha256(served bytes)", "negative control: with the rewrite removed the per-page invariant FAILS"); scenario `contentHashStamps` @ dev (21 pages, 67 stamped references, 26 distinct URLs, every `?v=` equals the first 16 hex of sha256 of the body fetched through the page); `test/ci-workflow.test.js` ("workflow matrix covers ubuntu-24.04 and windows on Node 22", "workflow runs `node --test` and pins its actions by major tag"); `evidence/smoke.log` |
| 7 | `npm run soak` + Phase 9/10 contract suites + Phase 9/10 walks unchanged; demo showcase unchanged | PASS (refreshed 2026-10-11; the Phase 9 walk's `asset-stamps` scenario was deliberately re-stated to the D-12-07 content-hash contract, see Deviations 6) | `evidence/soak.log` (10,451 acknowledged, 0 lost, audit 1:1, 0 committed-but-unaudited, 1,003 conflict-lane acknowledged / 2,085 x 409, chain check 10 verifies at 11,456 rows); **no Phase 8/9/10/11 contract suite was edited**: `git diff --name-status 88cab66 HEAD -- test/` lists additions plus eleven modified files - the nine below, plus `db-file-layout` (a Phase 1 pragma contract, deliberately updated by review fix WR-01 to expect `synchronous=FULL` for the audit kinds) and `soak-correlator` (this refresh: process-group kill + guard test); the nine are (`accounts-writable-gate`, `real-mode-guards`, `deal-seed`, `deal-wizard-page`, `write-validation-coverage` = isolation blocks; `asset-cache-bust` = the planned replacement of the hand-stamp table; `client-busy-retry` = +3 appended cases; `client-authz-hiding` = one expected-URL line; `db-artifact-exclusion` = partitions gitignore), none of `optimistic-locking-*`, `concurrency-*`, `busy-503-contract`, `clearance-write-paths`, `denial-audit`, `no-get-mutates`, `read-policy-*`; `evidence/phase9-walk.log` (350 PASS / 0 FAIL; the 50 `asset-stamps` rows now assert the content-hash contract), `evidence/phase9-walk-demo-open.log` (18 PASS / 0 FAIL), `evidence/phase10-walk.log` (695 PASS / 0 FAIL, incl. the Phase 11 scenarios and `demoShowcaseUnchanged` @ dev / demo-open) |

## ROADMAP success criteria

| SC | Verdict | Proof |
|----|---------|-------|
| SC1 one created record -> exactly one audit row, median write <= 40 ms | PASS | acceptance 1 |
| SC2 RAID/task lists page + filter server-side, DD workspace one request, 10x3 p95 <= 300 ms, event-loop p99 <= 100 ms under the 40-client profile | PASS (event-loop p99 93.9 / 89.7 / 90.8 ms, fresh deal per run; thin margin, quiet host required) | acceptance 2; `evidence/perf-summary.md` |
| SC3 every DB file reports a schema version, old files (incl. legacy audit) migrate at boot, broken migration => not-ready | PASS | acceptance 3 |
| SC4 hash-chained per-deal partitions, seal => SHA-256 control event + read-only, CLI verify, purge refused without sealed export + retention, viewer across partitions | PASS | acceptance 4 |
| SC5 pack leaves others' event-loop p99 <= 50 ms, second concurrent request refused or queued | PASS (refused, 429 - D-12-05) | acceptance 5 |
| SC6 20 consecutive full-suite runs, no test writes audit/runtime, changed asset without a bumped stamp fails, workflow on ubuntu + windows | PASS | acceptance 6; the workflow is verified as text only (Open items 1) |
| SC7 soak (0 lost, 0 committed-but-unaudited) and the Phase 9 contract suite pass unchanged; reorders persist via sequence without audit rows | PASS (soak PASS, reorder PASS, Phase 9 contract suites unedited and green, Phase 9 walk 350 / 0 with the `asset-stamps` scenario re-stated to the D-12-07 contract) | acceptance 7, acceptance 1 |
| SC8 one command runs the browser smoke harness (browser + axe) over the first IL pages; excluded from release zips | PASS | `test/smoke-harness.test.js` ("page registry: the first IL pages + admin Users, each at 1440 and 390", "release exclusion: .gitattributes export-ignores scripts/smoke/", "zero-install: neither Playwright nor axe-core is a repo dependency"); `evidence/smoke.log` |

## Requirements

| ID | Verdict | Proof |
|----|---------|-------|
| DATA-01 | PASS | `test/writedb-dirty-rows.test.js`; `test/audit-volume.test.js`; `evidence/perf.log` write-latency; `evidence/soak.log` |
| DATA-02 | PASS (budget clause met; the D-12-02 conversion narrowing PD-20 stays recorded below) | `test/read-collections.test.js` (a)-(o); `test/raid-list-query.test.js`; `test/tasks-list-query.test.js`; `test/read-sets-execution.test.js`; `test/read-sets-org-reports.test.js`; `test/dd-workspace-batch.test.js`; scenarios `ddPageOneRequest`, `raidPagedApi`; list-reads p95 PASS; load-40 p99 PASS x3 on fresh deals (`evidence/perf.log`) |
| DATA-03 | PASS | `test/schema-migrations.test.js`; `test/healthz-readiness.test.js`; `test/audit-legacy-migration.test.js`; `evidence/verify.log` |
| DATA-04 | PASS | `test/audit-partitions.test.js`; `test/audit-chain-multiprocess.test.js`; `test/audit-lifecycle.test.js`; `test/audit-lifecycle-routes.test.js`; `test/audit-control-chain.test.js`; scenario `auditSealFlow`; `evidence/verify.log`; DEPLOYMENT.md "audit trail" section (MNPI purge path, retention = TE legal) |
| DATA-05 | PASS | `test/cpu-isolation.test.js`; `test/client-busy-retry.test.js` (permanent-503 marker not retried); `evidence/perf.log` pack-isolation |
| DATA-06 | PASS | `test/test-isolation-guard.test.js`; `test/ci-workflow.test.js`; `evidence/gate.log`; `evidence/soak.log`; `test/healthz-readiness.test.js` ("/healthz: a clean boot answers 200 with the readiness object") |
| QUAL-01 | PASS | `test/asset-stamp-unit.test.js`; `test/asset-cache-bust.test.js` (incl. the negative control); scenario `contentHashStamps` |
| QUAL-02 | PASS | `test/smoke-harness.test.js`; `evidence/smoke.log`; `scripts/smoke/README.md` |

## Locked decisions

| Decision | Verdict | Proof |
|----------|---------|-------|
| D-12-01 dirty-row writes; audit inside the immediate transaction; Phase 9 version WHERE preserved | PASS | `test/writedb-dirty-rows.test.js` ("an untouched row never clobbers another writer's committed change to it", "a rolled-back write (version conflict) leaves the caller's baseline and the audit trail untouched"); Phase 8/9 suites unedited and green; `evidence/soak.log` |
| D-12-02 `readCollections`, hot GET + a few write handlers converted, server-side filter/page, DD workspace | **PARTIAL (recorded planner narrowing, PD-20)** | the conversion inventory below; the p99 clause now passes (acceptance 2) |
| D-12-03 `user_version` per file, ordered migrations under BEGIN IMMEDIATE, quick_check, not-ready on `/healthz`, legacy audit = migration #1 | PASS | acceptance 3 |
| D-12-04 per-deal hash-chained partitions, seal / export / verify / purge, never auto-purge, viewer across partitions, MNPI purge path documented | PASS | acceptance 4; `test/audit-lifecycle-routes.test.js` ("routes (g, structural): purge is only reachable from its definition, the purge route and the CLI; no timer callback calls it") |
| D-12-05 worker thread + 1-in-flight guard (429), permanent-503 marker not retried | PASS | acceptance 5 |
| D-12-06 test isolation guard, workflow, test gate, healthz readiness regression | PASS | acceptance 6 |
| D-12-07 content-hash `?v=`, HTML `no-cache`, assets long-cached, test fails without the rewrite | PASS | acceptance 6 |
| D-12-08 smoke harness (Playwright + axe from the host, not in node_modules, export-ignored) | PASS | SC8 |

## D-12-02 conversion inventory (PD-20 - a recorded planner narrowing of D-12-02's write-handler clause, checker W-8)

D-12-02 says "convert the hot GET handlers (raid, integration-tasks, notifications, synergies/rollup, dd/*, org/*,
reports, dashboards) and write handlers that only need a few collections". The plans converted what the PRD budgets
exercise and left the rest on `readDb()` with a stated reason. This is the mirror of `12-09-SUMMARY.md` "D-12-02
inventory evidence" plus the 12-10 / 12-11 conversions.

**Converted (route level)**

| Route(s) | Plan | Read set |
|---|---|---|
| GET/POST/DELETE `/api/raid` (paged + filtered list, byte-identical bare array) | 12-05 | `readSingleton('settings')` + `readProjection(lane)`; writes `RAID_READ_SET` |
| GET `/api/integration-tasks` (paged + filtered), POST/DELETE | 12-09 | `readProjection(taskLane)`; writes `TASK_READ_SET` |
| GET `/api/notifications` | 12-09 | `readCollections` of 4 + `readProjection` (no row parsed) |
| GET `/api/synergies`, `/api/synergies/rollup`, `/api/checklist-templates`, `/api/employees`, `/api/assessment-status` | 12-09 | per-route sets (`SYNERGY_READ_SET`, `SYNERGY_ROLLUP_SET`, `ASSESSMENT_STATUS_SET`, roster lanes) |
| GET `/api/dd/workspace` (new), `/api/dd/*` GETs, request-item / finding create + update | 12-10 | `DD_READ_SET` = settings, ddRequestItems, ddFindings (templates: `ddRequestTemplates`) |
| GET `/api/org/{positions,decisions,flight-risk,summary}`, POST `/api/org/positions` | 12-11 | `ORG_POSITIONS_SET` / `ORG_READ_SET`; roster lane only when `employeeId` is named |
| GET `/api/reports/export`, data assembly of `/api/reports/pack` | 12-11 | `REPORT_SET` (10 keys) |

**Left on `readDb()` (95 call sites at 12-09, one per route; classes per PD-20)**

| Class | Count | Rationale |
|---|---|---|
| (a) cold or multi-lane writes (synergy cost/phasing/stage/rebaseline, org copy/import/decisions/flight-risk, DD delete/instantiate/convert, roster writes, assessment v2 writes, tasks instantiate/from-remediation) | 31 | after 12-02 a write's cost is the changed rows; each touches several lanes where a missed collection is fail-open |
| (b) showcase / CMS / admin-content routes (settings, projects, catalog content, CMS i18n/menus/pages/banners/media, surveys, hrbps, alerts, pulses, communications) | 62 | outside every review profile |
| (c) other reads outside every review profile (`GET /api/assessment-templates`, `GET /api/assessment-instances`) | 2 | not on a budget path |

**"dashboards"** resolves to the deal-home's reads: `/api/synergies/rollup`, `/api/notifications`,
`/api/employees`, `/api/assessment-status` (all converted). `GET /api/alerts`, `/api/pulses`, `/api/communications`
(class b) are the natural first follow-up for literal compliance. **Consequence recorded by this plan's profile:** the
write handlers that were converted still `JSON.parse` / `JSON.stringify` the whole loaded lane per write, which is the
dominant main-thread cost under the 40-client mix. With the profile restated to one fresh deal per run (the R2 shape) the
budget holds with a 6-10 % margin; a RAID create on a much larger lane (the shared-deal profile's 5-6k rows) still costs
~13 ms of main thread, so the single-record write path remains the right next step when lanes of that size are expected
(`evidence/perf-summary.md`, history appendix).

## Planner decisions PD-1..PD-31

| PD | Decision (short) | Verdict | Proof |
|----|------------------|---------|-------|
| PD-1 | partition append is the final statement inside the deal's immediate transaction | PASS | `test/audit-partitions.test.js` "(c) a partition that cannot append rolls the DEAL write back (503 means nothing persisted)" |
| PD-2 | every `recordSecurityEvent` row (incl. `access-denied`) stays in audit.db with `deal_id` | PASS | `test/audit-partitions.test.js` "(f) ... control-kind rows stay in audit.db", "(h) ... no partition is created by a probe" |
| PD-3 | row hash = sha256 over canonical JSON of the row + prev_hash | PASS | `test/audit-partitions.test.js` "(b) the second write links to the first", "(d)"; `evidence/verify.log` |
| PD-4 | `AUDIT_DIR` derivation (MA_AUDIT_DIR, else next to MA_AUDIT_DB_PATH) | PASS | `test/db-artifact-exclusion.test.js`; all audit suites run in temp trees |
| PD-5 | the runner never writes a committed file; implied version 1 | PASS | `test/schema-migrations.test.js` "committed-implied: ...", "whole app: booting against the committed data/control.db reports it implied-v1 and never writes it"; runner `data-integrity` rows |
| PD-6 | fresh file stamped at latest, existing file migrated before the idempotent schema exec | PASS | `test/schema-migrations.test.js` "fresh files of every family are stamped at the family latest version and no up() runs" |
| PD-7 | seal needs an archived/deleted deal; chained seal row; re-seal idempotent and repairing; sealed backstop | PASS | `test/audit-lifecycle.test.js` (a), (c), (e); `test/audit-partitions.test.js` (i) |
| PD-8 | lifecycle routes under `/api/admin/deals/:id/audit...`, never `/api/admin/audit*` | PASS | `test/audit-lifecycle-routes.test.js` "(f) the route inventory" |
| PD-9 | purge refusal order and codes | PASS | `test/audit-lifecycle.test.js` "(l)"; `test/audit-lifecycle-routes.test.js` "(d)" |
| PD-10 | unparameterized list assembled from stored raw JSON, byte-identical | PASS | `test/raid-list-query.test.js` (a), (b); `test/tasks-list-query.test.js` (a), (b) |
| PD-11 | throwing accessors for every unloaded collection | PASS | `test/read-collections.test.js` (b), (c), (m) |
| PD-12 | list query keys; no params => legacy array; invalid => 400 | PASS | `test/raid-list-query.test.js` (g), (j); `test/tasks-list-query.test.js` (d), (f); scenario `raidPagedApi` |
| PD-13 | perf scripts reproduce the review profiles; a budget passes only if it holds in EVERY one of 3 runs | PASS (applied: every one of 3 runs, each on a fresh deal) | `evidence/perf.log`; the only `scripts/perf/load-40.js` change is the fresh-deal-per-run restatement (commit `8d5bed5`) |
| PD-14 | persistent unref'd worker_thread per route; probe decides thread mode | PASS | `test/cpu-isolation.test.js` "PD-14 probe: ..." (x2), "isolatedTask: mode \"process\" is refused loudly" |
| PD-15 | permanent-503 body marker `retryable:false`, client does not retry it | PASS | `test/cpu-isolation.test.js` "GET /api/reports/pack on a host without the canvas binding -> 503 { error, retryable:false } (PD-15)"; `test/client-busy-retry.test.js` |
| PD-16 | workspace carries `mine`; one `/api/dd/` request per load and per refresh | PASS | `test/dd-workspace-batch.test.js` (a), (d1), (d2); scenario `ddPageOneRequest` |
| PD-17 | stamp = first 16 hex of sha256 over the exact served bytes, transitive | PASS | `test/asset-stamp-unit.test.js` ("stampFor == first 16 hex of sha256(served bytes)", "... transitive"); scenario `contentHashStamps` |
| PD-18 | isolation guard inside `openDbFile()` after the real-mode refusal | PASS | `test/test-isolation-guard.test.js` "the real-mode committed-path `[security]` refusal still wins (ordering)"; `evidence/gate.log` isolation snapshot |
| PD-19 | smoke tool resolution order; nothing installed | PASS | `test/smoke-harness.test.js` "resolveTool: env path wins, then the npx cache, then null", "zero-install ..." |
| PD-20 | write-handler conversions limited to RAID, tasks, DD items/findings, org positions; inventory recorded | PASS (recorded narrowing) | the inventory section above |
| PD-21 | soak edit limited to partition reads + check 10 | PASS | `test/soak-correlator.test.js`; `evidence/soak.log` check 10 |
| PD-22 | migration #1 moves deal rows to partitions / `legacy`; backup; idempotent by `legacy_id` | PASS | `test/audit-legacy-migration.test.js` (first case, "with no control.db at all every deal row goes to the sealed legacy partition", crash rerun) |
| PD-23 | workflow actions pinned by major tag; ubuntu-24.04 pinned | PASS (text only) | `test/ci-workflow.test.js` "workflow runs `node --test` and pins its actions by major tag" |
| PD-24 | an audit delta only when a statement changed a row | PASS | `test/writedb-dirty-rows.test.js` "deleting a row a concurrent writer already deleted is a no-op - not resurrected, not audited" |
| PD-25 | audit.db v1 chain columns nullable; hashless row reported once | PASS | `test/audit-legacy-migration.test.js` "I-2: a raw hashless row is reported unchained-row ..." |
| PD-26 | gate green only from exit code AND parsed `# fail 0` | PASS | `test/ci-workflow.test.js` (gate cases); `evidence/gate.log` |
| PD-27 | boot opens EVERY file family (audit, registered deals) before listen | PASS | `test/healthz-readiness.test.js` "audit.db is opened and versioned at boot with NO request made", "boot sweep: ..." |
| PD-28 | backup migration refuses below 3 x size + 64 MB free | PASS | `test/schema-migrations.test.js` "backup migration: refused with insufficient-disk-for-migration ..." |
| PD-29 | audit.db never first-opened inside a deal write | PASS | `test/audit-partitions.test.js` "(g) PD-29 - getPartitionConnection never first-opens audit.db; writeDb pre-opens it outside the deal txn" |
| PD-30 | chain head = most recent row that HAS a hash | PASS | `test/audit-legacy-migration.test.js` "I-2 ..."; `test/audit-control-chain.test.js` |
| PD-31 | migration cost rehearsed on a synthetic v0 audit file, never real data | PASS | `evidence/verify.log` section 2; `12-13-SUMMARY.md` (150,000 rows / 158 MB: 6.4 s boot, peak WAL 5.3 MB, peak scratch 3.24 x) ; `test/audit-legacy-migration.test.js` "rehearsal guards" |

## Deviations & discretion calls (plan 12-14)

1. **load-40 restated to one fresh deal per run (refresh decision 1), not tuned.** `scripts/perf/load-40.js --runs N`
   now re-invokes itself once per run (own scratch, deal, 40-record seed and server). Mix, duration, clients and the
   100 ms threshold are untouched; `--assert` still fails on ANY run over budget. The earlier shared-deal measurements
   (`evidence/load40-fresh-invocations.log`, `evidence/load40-profile*.log`, from the pre-fix tree) are retained as
   diagnostics only and do not replace the assertion.
2. **Evidence run into scratch, shots copied.** The full Phase 10 runner writes ~30 screenshots (1.1 MB) into `--out`;
   it was run into the session scratchpad and only its log and the three `p12-*` shots were kept, so the evidence
   directory stays under the 1,200 KB cap (same as 11-VALIDATION deviation 1).
3. **Gate wrapper.** `scripts/test-gate.js` prints the full TAP stream of every run; the wrapper kept only the summary
   lines (`run i/N`, `# pass/fail/cancelled`, `not ok`, `GATE ...`) and added the before/after sha256 + size snapshot of
   the guarded data files with schema-only sentinel files created at `data/audit.db` / `data/runtime.db` (removed
   afterwards), so "byte-identical" compares real files rather than absence with absence.
4. **Soak scratch.** The default `npm run soak` was used (post-12-02 it writes ~10 MB, not 5 GB).
5. **Smoke axe counts are informational** (D-12-08); the exit code is page errors / failed requests / landmarks.
6. **Phase 9 `asset-stamps` scenario deliberately re-stated (refresh decision 2).** Only
   `scripts/uat/phase9-scenarios/f8-stamps.js` was edited (commit `667285d`). D-12-07 replaced numeric `?v=` hand
   stamps with `?v=<first 16 hex of sha256(served bytes)>`, so its three numeric per-asset assertions ("one numeric
   stamp", "matches the page on disk", "> pre-gap-closure floor") were superseded by the stronger Phase 12 proofs
   (`test/asset-cache-bust.test.js`, scenario `contentHashStamps`). The scenario now asserts, per page and asset:
   requested; exactly one stamp matching `/^[0-9a-f]{16}$/`; the stamp equals the stamp in the page HTML AS SERVED
   (the checked-in HTML still carries legacy numbers, the server rewrites them); the stamp equals the first 16 hex of
   sha256 of the bytes the server returns for that asset URL; and the response was 200. The "requested" and "200"
   assertions are unchanged and the check count per asset stays 5, so the walk total stays 350.
7. **Refresh wrapper waits for a quiet host.** The first refresh perf attempt ran at load1 13.4 / load5 30 and failed
   every budget with a 3-5x host slowdown (`evidence/perf-attempt1-noisy-host.log`, kept). The wrapper then waited for
   load1 < 10 and load5 < 15 before the evidence run; every number in `perf.log` is from that run.
8. **`test/soak-correlator.test.js`: process-group kill (refresh decision 3).** The real 2-process smoke now spawns the
   soak harness `detached` and kills the whole process group on its 80 s watchdog and unconditionally in `finally`; a
   guard test proves a group kill reaps a grandchild (commit `8fbfda7`). The suite is therefore 1,459 tests (1,458 after
   the review fixes + 1 guard).
9. **Review remediation re-measured.** WR-01 (audit `synchronous=FULL` + `fullfsync`) was the one review fix with a
   plausible performance cost; the write-latency budget was re-run on the fixed tree (raid 13.4 ms, task 5.0 ms median)
   and holds. Its one real cost shows up elsewhere: Open items 5.

## Review remediation (12-REVIEW.md part A, 12-REVIEW-B.md part B)

All 16 findings in scope (every severity) were fixed or explicitly accepted by `12-REVIEW-FIX.md`
(base `bf8d710`, suite 1,445 -> 1,458). Every row is on this tree (merge-base verified) and was exercised by the
evidence runs of this refresh. "Mutation-checked" = the fixer proved the test fails with the fix removed.

| Finding | Severity | Fix commit(s) | Regression test |
|---|---|---|---|
| CR-01 case-variant id seals/exports/purges an ACTIVE deal's trail | HIGH | `2a19082` | `test/audit-lifecycle-routes.test.js` (h) (mutation-checked); `routes (b)` updated to 404 |
| WR-01 audit can lag the deal write after power loss | MED | `15d989d`, `d933041` | `test/audit-partitions.test.js` (k); `test/db-file-layout.test.js` updated to `synchronous=2` for audit |
| WR-02 migration #1 fails open on an unreadable deal registry | MED | `739a648` | `test/audit-legacy-migration.test.js` WR-02 x2 (mutation-checked); old fail-open case inverted |
| WR-03 aborted export leaves no trace | MED | `145f5c1` | `test/audit-lifecycle.test.js` (p) |
| IN-01 `/healthz` publishes the deal-file count | LOW | `da61b1a`, `a197b79` | new `test/readiness-snapshot.test.js`; `test/schema-migrations.test.js` updated |
| IN-02 multiprocess chain test cannot detect zero overlap | LOW | `5a36aee` | `test/audit-chain-multiprocess.test.js` (barrier + interleave assertion) |
| IN-03 non-numeric `legacy_id` hashes as `null` | LOW | `8e55a0a` | `test/audit-partitions.test.js` (l) incl. the forged-collision row |
| WR-B01 dot-segment HTML paths bypass the stamper | MED | `c2d8f2a` | `test/asset-cache-bust.test.js` WR-B01 (raw socket; mutation-checked) |
| WR-B02 `npm run perf` can print PERF PASS with a broken 429 guard | MED | `713cbd9` | `test/perf-harness-guards.test.js` WR-B02 |
| WR-B03 second `run()` on a held lease orphans job 1 | MED | `080314d` | `test/cpu-isolation.test.js` WR-B03 |
| IN-B01 worker crashes on a non-cloneable/undefined result | LOW | `85da5c6` | `test/cpu-isolation.test.js` IN-B01 (`spawnCount` stays 1) |
| IN-B02 isolation guard misses a case-variant `data/` spelling | LOW | `0206359` | `test/test-isolation-guard.test.js` IN-B02 |
| IN-B03 `rewriteAsset` corrupts non-UTF-8 bytes | LOW | `437d5bb` | `test/asset-cache-bust.test.js` IN-B03 |
| IN-B04 two read-only opens bypass the `openDbFile` choke point | LOW | `5bbf5bf` | `test/deal-seed.test.js` IN-B04 |
| IN-B05 `scripts/perf/` ships in release zips | LOW | `af1c428` | `test/smoke-harness.test.js` release-exclusion (strengthened) |
| IN-B06 malformed `clearanceArea` hidden from everyone | LOW | **accepted** (fail-closed; `1cde6c9` documents it in DEPLOYMENT.md Known limitations) | n/a (existing suite proves the fail-closed behaviour) |
| (brief) stale `db/migrate.js` header | - | `d142472` | comment only |

Evidence interplay: CR-01/WR-B01/IN-01 touch routes the Phase 10 runner and the Phase 12 scenarios exercise (`auditSealFlow`
uses registered ids only; `contentHashStamps` covers the stamper) - 695 / 0 on this tree. WR-01 is the one fix that
changes a measured path (audit commits), re-measured above. WR-B02 is why `npm run perf` now carries `--assert` and why
the refresh's `PERF PASS` line is meaningful.
## Open items

1. **CI workflow unexecuted.** `.github/workflows/test.yml` is verified as text; ubuntu-24.04 / windows-latest results
   are unknown until the first push (CERT-05). Sealed-partition read-only access (chmod 0400 / Windows read-only
   attribute) is proven on macOS only.
2. **Accepted residuals (documented in DEPLOYMENT.md):** tail truncation of an unsealed partition is not detectable
   (T-12-73); MNPI rows remain in the control-plane audit after a purge (T-12-124 - TE legal decides retention and
   the purge policy); SC5's "refused or queued" is satisfied as refused (429, D-12-05).
3. **Accepted (orchestrator decision, refresh finding 4):** the suite opens the committed `data/control.db` under the
   12-01 opt-in and `chmodPrivateFile` tightens its file mode to 0600; bytes and `git status` are unchanged (mode is not
   tracked), so the isolation proof compares sha256 only. The refresh gate wrapper restores 0644 afterwards.
4. **Axe totals** (37 critical + serious across the six pages at plan 12-07) are Phase 19 input, not gated here.
5. **PRODUCT FINDING - migration #1 boot cost rose ~15x after review fix WR-01 (audit `synchronous=FULL` +
   `fullfsync=ON`).** `node scripts/perf/legacy-audit-migration.js --rows 20000` (800 synthetic deal partitions):
   `migration_ms` **2,010 ms before the fix** (evidence of the original 12-14 run) vs **30,241 and 31,337 ms** on the fixed
   tree, two runs, host load 5-6 (`evidence/verify.log` section 2; extrapolated 5 GB 8.1 min -> ~2 h). Isolated by
   a micro-benchmark (800 partition files, one create + 3 commits each, same machine): `synchronous=NORMAL` 719 ms,
   `FULL + fullfsync` 19,501 ms - one drive-cache flush per commit, so the cost scales with the number of partitions
   / transactions, not with row count (the 12-13 rehearsal of 150,000 rows over few deals is dominated by rows, not
   partitions). No PRD budget covers migration time and a real tree has far fewer than 800 deals, so this is not a
   failed budget - but a one-time boot of a 100-deal legacy tree now costs roughly 2-4 s of fsync instead of ~0.1-0.3 s
   (scaled from the 800-partition measurements), and the 800-deal rehearsal case ~30 s. Possible mitigation (orchestrator's call, not done here): run migration #1 with
   `synchronous=OFF`/`NORMAL` on the new partition connections and finish with one `wal_checkpoint(TRUNCATE)` + fsync per
   file; the pre-migration `.pre-v1.bak` already protects the source. Repro:
   `node scripts/perf/legacy-audit-migration.js --rows 20000` on any quiet host.
6. **load-40 passes with a thin margin and is host-noise sensitive.** 89.7-93.9 ms against 100 ms on a quiet host; the
   same script on a host averaging load 30 lands at 216-244 ms (`evidence/perf-attempt1-noisy-host.log`). The budget is
   met only under the quiet-host rule in `evidence/README.md`. If a future quiet-host run misses, the pre-identified
   next steps are in `evidence/perf-summary.md` (history appendix): a single-record RAID/task write path in the store
   and a cheap `ETag` on the list responses. Test-suite flakes under heavy host load remain possible
   (`concurrency-busy-retry`, `control-plane-serialization` (c), `cpu-isolation` "job past timeoutMs",
   `audit-security-events`, `optimistic-locking-cross-process`); none fired in the 20-run gate or the single run, and
   the `soak-correlator` orphaned-grandchild hang that broke pre-fix gate attempt 1 is fixed (`8fbfda7`).
