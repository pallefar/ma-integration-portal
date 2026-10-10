---
phase: 12
slug: data-layer-integrity-performance
status: signed-off-with-gaps
nyquist_compliant: true
deferrals: ["load-40 event-loop budget (runs 2 and 3 of --runs 3)", "Phase 9 walk asset-stamps scenario vs D-12-07 content-hash stamps", "Windows/ubuntu CI execution (first push, CERT-05)"]
suite: { tests: 1445, pass: 1445, fail: 0, runs: 1 }
gate: { verdict: "GATE PASS runs=20 (attempt 4; attempts 1-3 were broken by external host-load spikes, logs kept)", runs: 20, command: "node scripts/test-gate.js --runs 20 --no-soak" }
soak: { verdict: PASS, acknowledged: 8403, lost: 0, audit_rows: 8403, bounded_503: 0, committed_but_unaudited: 0, conflict_lane: "863 acknowledged / 1783 x 409 / 0 x 503", chain: "check 10 verifies, rows=9268", config: "default: 3 processes / 120 s" }
perf: { write: "PASS raid 14.3 ms / task 2.5 ms median, 1.0 audit row per create, 0 per reorder", list_reads: "PASS p95 145.0 / 155.0 / 158.1 ms", load_40: "FAIL run 1 86.3 ms, run 2 112.2 ms, run 3 133.0 ms (budget 100)", pack: "PASS worst p99 11.4 ms, second request 429" }
runner: { pass: 695, fail: 0, lanes: 6, phase12_scenarios: "40 PASS / 0 FAIL (ddPageOneRequest 12, raidPagedApi 6, auditSealFlow 17, contentHashStamps 5)", phase11_and_demo_showcase: "authzRoleMatrix 226, cleanRoom404 38, denialAuditBounded 16, demoShowcaseUnchanged 191 - all PASS" }
phase9_walk: { normal: "320 PASS / 30 FAIL - all 30 are the asset-stamps scenario (numeric hand stamps, superseded by D-12-07)", demo_open: "18 PASS / 0 FAIL" }
smoke: { visits: 12, with_errors: 0, axe_critical_plus_serious: 37, note: "informational (D-12-08)" }
signed: 2026-10-10
plan: 12-14
---

# Phase 12 - Validation (Data-Layer Integrity & Performance)

Signed against the written contract: `.planning/reviews/v3.0/PHASE-12-PRD.md` (acceptance 1-7), ROADMAP Phase 12
success criteria SC1-SC8, requirements DATA-01..06 / QUAL-01 / QUAL-02, the locked decisions D-12-01..08 and the planner
decisions PD-1..PD-31 recorded in the plans (with the plan-checker's revision-1 amendments). Every PASS names a test
file (and test name) or an evidence file. Anything not proven, and the one budget that was missed, is stated in
"Open items" - **nothing was loosened**.

Evidence directory: `.planning/phases/12-data-layer-integrity-performance/evidence/` (`README.md` maps every file to its
acceptance item and gives the regeneration commands). Host: darwin-arm64, 11 CPUs, shared with other sessions (the
1-minute load average swings 6 -> 110 within minutes; budgets were measured only after the load had been under 10 and
the load is printed beside every measurement).

**Headline.** Two items are not green and are handed to the orchestrator with measurements and proposals; everything else
passes with reproducible evidence.

1. **The 40-client event-loop p99 <= 100 ms (PRD acceptance 2, SC2) holds in run 1 of the committed 3-run profile (86.3
   ms) but not in runs 2 and 3 (112.2 / 133.0 ms)** - profiled in `evidence/perf-summary.md` with proposed minimal changes.
2. **The Phase 9 walk (normal lane) shows 30 FAIL, all in the `asset-stamps` scenario**, which pins the numeric hand stamps
   that D-12-07 replaced by content hashes (a conflict between two locked requirements, not a regression of the
   behaviour the scenario protects; Open items 2).

Passing: write latency + one audit row per change, the 10 x 3 list-read p95 (145-158 ms), pack isolation (11.4 ms, 429),
paging / DD one-request, migrations at boot, hash-chained partitions with seal / export / verify / purge, test isolation,
20 consecutive green suite runs, soak (8,403 acknowledged, 0 lost), the Phase 10 runner (695 / 0) and the demo showcase,
the Phase 9 demo-open walk (18 / 0) and the smoke net.

## PRD acceptance

| # | Acceptance | Verdict | Proof |
|---|------------|---------|-------|
| 1 | 1k-task / 5k-RAID deal: create one record -> exactly 1 audit row, median write <= 40 ms; reorder persists with 0 audit rows | PASS | `test/audit-volume.test.js` ("audit-volume (create RAID): one POST /api/raid on the volume deal appends exactly ONE audit row", "(create task)", "(update)", "(reorder): an unmodified read -> write at volume appends 0 rows and a reorder persists with 0 rows"); `test/writedb-dirty-rows.test.js` ("changing one row of 50 appends exactly 1 audit row ... other 49 stored rows byte-identical", "a pure reorder persists the new order with 0 audit rows and no data blob rewritten", both `[versioned]` and `[non-versioned]`); `evidence/perf.log` write-latency: raid median 14.3 ms (p95 18.0), task 2.5 ms, 1.0 audit rows per create, reorder 15.0 ms with 0 rows and order persisted (baseline 85.7 / 96.6 ms, ~6,220 rows) |
| 2 | `GET /api/raid?limit=50` -> `{items,total}`, no params -> unchanged array; DD page makes 1 request; p95 <= 300 ms and event-loop p99 <= 100 ms under the review profiles | **PARTIAL** - paging, DD one-request and p95 PASS; **event-loop p99 FAIL in runs 2-3** | `test/raid-list-query.test.js` ("(a) unparameterized GET /api/raid is BYTE-identical ...", "(d) ?limit=10 -> { items, total }", "(f) restricted visibility is the same through the legacy array and the paged form"); `test/tasks-list-query.test.js` (a)-(h); `test/dd-workspace-batch.test.js` ("(d1) due-diligence.js load() has exactly one fetch", "(d2) executing the real page issues exactly one /api/dd/* request on load"); browser: scenario `ddPageOneRequest` @ real and `raidPagedApi` @ real in `evidence/phase10-walk.log` (the page load issues exactly `["GET /api/dd/workspace"]`, one edit adds `POST /api/dd/request-items` + one `GET /api/dd/workspace`; `?limit=5` -> `{items:5,total:7}`), shots `p12-dd-page-1440.jpg` / `-390.jpg`; `evidence/perf.log` list-reads p95 145.0 / 155.0 / 158.1 ms (baseline p95 483); load-40 p99 86.3 / **112.2 / 133.0** ms - see Open items 1 |
| 3 | Old-version DB files (control / runtime / deal / audit) migrate at boot; a broken migration => not-ready | PASS | `test/schema-migrations.test.js` ("whole app: a version-0 control.db migrates at boot, before any request, and /healthz reports it", "whole app: version-0 runtime.db and demo.db migrate at boot (data intact)", "whole app: a broken control migration keeps the instance listening but not-ready, and fails closed", "a broken migration rolls back, leaves the file at its previous version and is sticky until restart", "whole app: two processes opening the same version-0 file at once run the migration exactly once"); `test/healthz-readiness.test.js` ("boot sweep: a registered version-0 deal file is at version 1 after boot with no request", "boot sweep: a corrupt registered deal file is not-ready immediately after boot", "audit.db is opened and versioned at boot with NO request made (checker B-1)"); `test/audit-legacy-migration.test.js` ("a legacy audit.db migrates at boot: partitions, sealed legacy, chained control log, backup, viewer join", "crash before the audit.db rebuild: not-ready, nothing changed; rerun completes idempotently"); `evidence/verify.log` section 2 (synthetic 20,000-row legacy tree migrated at boot, `audit-verify --all` OK) |
| 4 | Seal => read-only + control event; verify detects a flipped byte; purge refused without sealed export / retention; viewer spans partitions | PASS | `test/audit-lifecycle.test.js` ("(c) sealing an archived deal makes the file read-only and records ONE sha256 control event; re-seal is idempotent", "(f) a flipped byte in a sealed partition fails verify (chain AND sealed-sha), exit 1", "(l) purgeDecision follows the documented refusal order", "(m) a permitted purge records audit-partition-purged BEFORE it deletes the file", "(g, W-3) ... refuses the seal checkpoint-busy with NOTHING changed"); `test/audit-lifecycle-routes.test.js` ("routes (d): purge refusal matrix in order, then a permitted purge ...", "routes (e): a sealed file modified after the seal is refused for export and purge with a tamper event"); `test/audit-partitions.test.js` ("partitions (d) flipping one byte inside a stored row is reported by verifyChain and exits the CLI 1", "(h) the viewer returns a deal's partition rows UNION its control rows, each tagged"); scenario `auditSealFlow` @ real (archive -> seal -> status `sealed:true, writable:false, fileMatchesSeal:true`, repeated seal idempotent, early purge 409 `not-sealed`, viewer `?deal=` rows tagged with the partition, admin audit tab lists them; shot `p12-admin-audit-sealed-1440.jpg`); `evidence/verify.log` section 3 (scratch deal sealed through `scripts/audit-admin.js`, `sealed-sha=match`, export verifies, one-byte edit of the export fails verify, purge `retention-never`) |
| 5 | Pack render does not stall other requests (p99 <= 50 ms); second concurrent pack => 429 | PASS | `test/cpu-isolation.test.js` ("reports-pack isolation (GET /api/reports/pack)", "PD-14 probe: the pack renderer runs INSIDE a worker_thread", "isolatedTask: a second tryAcquire while one is held is refused (never queued)"); `evidence/perf.log` pack-isolation: worst round p99 11.4 ms, rounds 11.4 / 6.8 / 6.3 ms, B = `429 Retry-After=5` in every round (baseline 2,397 ms blocked) |
| 6 | Suite 20x consecutive green; no test touches `data/audit.db` / `runtime.db`; asset stamp == content hash test; workflow file present; smoke harness runs green once | PASS | `evidence/gate.log` (`GATE PASS runs=20`, 1445/1445 in every run, isolation snapshot PASS; sha256 + size of `data/audit.db*`, `data/runtime.db*`, `data/demo.db`, `data/control.db` before and after, with schema-only sentinel files at the audit/runtime paths so the equality is real); `test/test-isolation-guard.test.js` ("a default-path open under the runner fails loudly and creates nothing", "a child that requires server.js with no MA_* overrides dies with the named fix"); `test/asset-cache-bust.test.js` ("every public/*.html is no-cache and every js/css reference carries sha256(served bytes)", "negative control: with the rewrite removed the per-page invariant FAILS"); scenario `contentHashStamps` @ dev (21 pages, 67 stamped references, 26 distinct URLs, every `?v=` equals the first 16 hex of sha256 of the body fetched through the page); `test/ci-workflow.test.js` ("workflow matrix covers ubuntu-24.04 and windows on Node 22", "workflow runs `node --test` and pins its actions by major tag"); `evidence/smoke.log` |
| 7 | `npm run soak` + Phase 9/10 contract suites + Phase 9/10 walks unchanged; demo showcase unchanged | **PARTIAL** - soak, contract suites, runner, demo showcase PASS; Phase 9 walk (normal) 30 FAIL in `asset-stamps` (superseded, Open items 2) | `evidence/soak.log` (8,403 acknowledged, 0 lost, audit 1:1, 0 committed-but-unaudited, 863 conflict-lane acknowledged / 1,783 x 409, chain check 10 verifies at 9,268 rows); **no Phase 8/9/10/11 contract suite was edited**: `git diff --name-status 88cab66 HEAD -- test/` lists only additions plus nine modified files (`accounts-writable-gate`, `real-mode-guards`, `deal-seed`, `deal-wizard-page`, `write-validation-coverage` = isolation blocks; `asset-cache-bust` = the planned replacement of the hand-stamp table; `client-busy-retry` = +3 appended cases; `client-authz-hiding` = one expected-URL line; `db-artifact-exclusion` = partitions gitignore), none of `optimistic-locking-*`, `concurrency-*`, `busy-503-contract`, `clearance-write-paths`, `denial-audit`, `no-get-mutates`, `read-policy-*`; `evidence/phase9-walk.log` (320 PASS / 30 FAIL, all 30 = scenario `asset-stamps`, Open items 2), `evidence/phase9-walk-demo-open.log` (18 PASS / 0 FAIL), `evidence/phase10-walk.log` (695 PASS / 0 FAIL, incl. the Phase 11 scenarios and `demoShowcaseUnchanged` @ dev / demo-open) |

## ROADMAP success criteria

| SC | Verdict | Proof |
|----|---------|-------|
| SC1 one created record -> exactly one audit row, median write <= 40 ms | PASS | acceptance 1 |
| SC2 RAID/task lists page + filter server-side, DD workspace one request, 10x3 p95 <= 300 ms, event-loop p99 <= 100 ms under the 40-client profile | **PARTIAL** (last clause FAIL runs 2-3) | acceptance 2; `evidence/perf-summary.md` |
| SC3 every DB file reports a schema version, old files (incl. legacy audit) migrate at boot, broken migration => not-ready | PASS | acceptance 3 |
| SC4 hash-chained per-deal partitions, seal => SHA-256 control event + read-only, CLI verify, purge refused without sealed export + retention, viewer across partitions | PASS | acceptance 4 |
| SC5 pack leaves others' event-loop p99 <= 50 ms, second concurrent request refused or queued | PASS (refused, 429 - D-12-05) | acceptance 5 |
| SC6 20 consecutive full-suite runs, no test writes audit/runtime, changed asset without a bumped stamp fails, workflow on ubuntu + windows | PASS | acceptance 6; the workflow is verified as text only (Open items 4) |
| SC7 soak (0 lost, 0 committed-but-unaudited) and the Phase 9 contract suite pass unchanged; reorders persist via sequence without audit rows | **PARTIAL** (soak PASS, reorder PASS, Phase 9 contract suites unedited and green; the Phase 9 *walk* `asset-stamps` scenario pins numeric stamps that D-12-07 replaced) | acceptance 7, acceptance 1 |
| SC8 one command runs the browser smoke harness (browser + axe) over the first IL pages; excluded from release zips | PASS | `test/smoke-harness.test.js` ("page registry: the first IL pages + admin Users, each at 1440 and 390", "release exclusion: .gitattributes export-ignores scripts/smoke/", "zero-install: neither Playwright nor axe-core is a repo dependency"); `evidence/smoke.log` |

## Requirements

| ID | Verdict | Proof |
|----|---------|-------|
| DATA-01 | PASS | `test/writedb-dirty-rows.test.js`; `test/audit-volume.test.js`; `evidence/perf.log` write-latency; `evidence/soak.log` |
| DATA-02 | **PARTIAL** | `test/read-collections.test.js` (a)-(o); `test/raid-list-query.test.js`; `test/tasks-list-query.test.js`; `test/read-sets-execution.test.js`; `test/read-sets-org-reports.test.js`; `test/dd-workspace-batch.test.js`; scenarios `ddPageOneRequest`, `raidPagedApi`; list-reads p95 PASS; load-40 p99 gap (Open items 1) |
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
| D-12-02 `readCollections`, hot GET + a few write handlers converted, server-side filter/page, DD workspace | **PARTIAL (recorded planner narrowing, PD-20)** | the conversion inventory below; the p99 clause is Open item 1 |
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
dominant main-thread cost under the 40-client mix (Open item 1).

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
| PD-13 | perf scripts reproduce the review profiles; a budget passes only if it holds in EVERY one of 3 runs | PASS (applied) / **load-40 fails it** | `evidence/perf.log`; `scripts/perf/*` unedited |
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

1. **load-40 reported, not tuned.** The committed script, profile and 100 ms threshold are untouched. Three
   independent fresh-server invocations (`evidence/load40-fresh-invocations.log`) and a `--cpu-prof` of the server under
   the unmodified mix (`evidence/load40-profile*.log`) are diagnostics only and do not replace the assertion.
2. **Evidence run into scratch, shots copied.** The full Phase 10 runner writes ~30 screenshots (1.1 MB) into `--out`;
   it was run into the session scratchpad and only its log and the three `p12-*` shots were kept, so the evidence
   directory stays under the 1,200 KB cap (same as 11-VALIDATION deviation 1).
3. **Gate wrapper.** `scripts/test-gate.js` prints the full TAP stream of every run; the wrapper kept only the summary
   lines (`run i/N`, `# pass/fail/cancelled`, `not ok`, `GATE ...`) and added the before/after sha256 + size snapshot of
   the guarded data files with schema-only sentinel files created at `data/audit.db` / `data/runtime.db` (removed
   afterwards), so "byte-identical" compares real files rather than absence with absence.
4. **Soak scratch.** The default `npm run soak` was used (post-12-02 it writes ~10 MB, not 5 GB).
5. **Smoke axe counts are informational** (D-12-08); the exit code is page errors / failed requests / landmarks.

## Open items

1. **load-40 event-loop p99 <= 100 ms: FAIL in runs 2 and 3 (PRD acceptance 2, SC2, DATA-02).** Measurements, the
   saturated-main-thread profile and the proposed minimal changes are in `evidence/perf-summary.md`; summary: the
   committed 3-run profile grows one deal from 40 to ~6,500 RAID rows (25 % of the mix is `POST /api/raid`); `GET` and
   `POST /api/raid` are 84 % of the main thread; a RAID write still parses and re-serializes the whole loaded lane. The
   orchestrator decides: (1) a single-record write path (store-level), (2) cheap ETag / no re-encode on the 1.7-3 MB
   list, (3) restate the profile (fresh deal per run, or the paged form the converted clients will use).
2. **Phase 9 walk (normal lane): 30 FAIL, all in the `asset-stamps` scenario (PRD acceptance 7 says "Phase 9/10 walks
   unchanged").** `scripts/uat/phase9-scenarios` `asset-stamps` asserts, per page and asset, "one numeric stamp", "stamp
   matches the page on disk" (the hand-edited number in the HTML source) and "stamp > the pre-gap-closure value".
   D-12-07 / 12-03 deliberately replaced numeric hand stamps with serve-time content hashes (`?v=0a15d3862f10cf25`), so
   the three numeric assertions per asset fail (10 assets x 3 = 30) while the "requested" and "200" assertions of the
   same scenario pass. The Phase 9 *intent* (the page requests the current asset version, never a stale one) is
   proven by stronger invariants: `test/asset-cache-bust.test.js`, `test/asset-stamp-unit.test.js` and scenario
   `contentHashStamps` (stamp == sha256 of the served bytes, 67 references). The Phase 9 scenario module belongs to
   plan 09-xx and was not edited here (the runner contract forbids editing another plan's module). Orchestrator
   decision: update that scenario to the content-hash contract (a gap-closure edit), or accept the superseded
   assertions. The other 320 Phase 9 rows pass and `--demo-open` is 18 / 0.
3. **Test-suite flakes under host load (recorded, not hidden).** 20 consecutive green runs were obtained in attempt 4
   (`evidence/gate.log`); attempts 1-3 (`evidence/gate-attempt*.log`) ran 10 / 7 / 6 green runs and were broken by
   external load spikes (1-minute load average 31 / 87 / 105 caused by other sessions' builds, a Docker VM and a
   crash-looping gateway on this machine): `soak-correlator` "a real 2-process smoke run" (its 80 s kill leaves
   orphaned grandchildren holding the test's stdout pipe, so the file hangs ~10 min and the runner reports
   `cancelled`), `accounts-writable parity (B)`, `audit-legacy-migration` "with no control.db at all", `reports-pack`,
   `schema-migrations` "version-0 runtime.db and demo.db migrate at boot" and two login/read-policy HTTP suites.
   Each passes alone (`evidence/gate-run11-flake-alone.log`: 3 of 3, 7 s each). In attempt 4 per-run time stretched
   from 20 s to ~110 s as the host load rose past 400 and the suite stayed green.
4. **CI workflow unexecuted.** `.github/workflows/test.yml` is verified as text; ubuntu-24.04 / windows-latest results
   are unknown until the first push (CERT-05). Sealed-partition read-only access (chmod 0400 / Windows read-only
   attribute) is proven on macOS only.
5. **Accepted residuals (documented in DEPLOYMENT.md):** tail truncation of an unsealed partition is not detectable
   (T-12-73); MNPI rows remain in the control-plane audit after a purge (T-12-124 - TE legal decides retention and
   the purge policy); SC5's "refused or queued" is satisfied as refused (429, D-12-05).
6. **Observation:** the suite opens the committed `data/control.db` under the 12-01 opt-in and `chmodPrivateFile`
   tightens its file mode to 0600; bytes and `git status` are unchanged (mode is not tracked), so the isolation proof
   compares sha256 only.
7. **Axe totals** (37 critical + serious across the six pages at plan 12-07) are Phase 19 input, not gated here.
