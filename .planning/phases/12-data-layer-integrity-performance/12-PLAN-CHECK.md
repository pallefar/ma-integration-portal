---
status: superseded
note: plan-checker report, not a plan; amendments applied to the plans
---

# Phase 12 — Plan Check (pre-execution)

**Phase:** 12 Data-Layer Integrity & Performance
**Plans checked:** 14 (12-01 .. 12-14), 6 waves
**Checker verdict:** ISSUES FOUND — 1 BLOCKER, 9 WARNING, 5 INFO
**Date:** 2026-10-10

Method: goal-backward against ROADMAP SC1-8, PHASE-12-PRD acceptance 1-7, DATA-01..06 / QUAL-01/02, D-12-01..08, then each
flagged seam verified against the real code (db/store.js, db/auditHook.js, db/dbFiles.js, db/audit-schema.sql, server.js,
scripts/soak.js, test/no-get-mutates.test.js, test/optimistic-locking-contract.test.js, test/asset-cache-bust.test.js).
Dimensions 8 (Nyquist), 11 (research), 12 (patterns), 7c (tier map): SKIPPED — no RESEARCH.md / PATTERNS.md (PRD express
path). Every task has files/action/verify(`<automated>`)/done; all `<verify>` commands are runnable; tracer-first and
reversibility ratings present (12-14 carries none: INFO).

---

## BLOCKER

### B-1 [requirement_coverage / context_compliance] The audit family is never opened at boot — "migrates at boot" and "not-ready" cannot be delivered for audit.db (SC3, PRD acceptance 3, D-12-03)

Plans: 12-06 (Task 2 `bootOpen`), 12-08 (Task 1 `getPartitionConnection`), 12-13 (Tasks 1-2; `files_modified` has no server.js).

Evidence (code, not plan claims):
- server.js boot (lines ~1529-1544) opens only `initDb(DEMO_DB_PATH)`, runtime and control. `db/auditHook.js getAuditConnection()` is
  lazy (`if (!auditConn) auditConn = openDbFile(...)`); nothing at require time calls it; the credential-lockdown scan records no event.
- 12-06 `bootOpen` wraps exactly: `ensureRealDataDir`, the lockdown scan, `initDb(DEMO)`, `getRuntimeConnection()+prune`. Audit is not listed.
  12-06's own text: "The audit family is registered here with no migrations".
- 12-13 truths/behaviours assert "runs at boot", "child server boot -> audit.db user_version 1", and "boot with
  MA_TEST_AUDIT_MIGRATION_FAIL_AT=rebuild -> /healthz 503 not-ready (family audit ...)". With no eager open, a booted child that
  receives no request leaves audit.db at version 0 and `/healthz` reports ready. The tests as written cannot pass, or the executor
  will improvise an unplanned server.js edit.
- Worse, the first open then happens lazily inside a request — for a deal write via `getPartitionConnection -> getAuditConnection`,
  i.e. INSIDE the deal file's `.immediate` transaction (store.js applyWrite) — so a minutes-long migration of an 80 MB-5 GB file
  would hold the deal write lock and block the event loop mid-request, and a failure surfaces as a per-request 5xx instead of a
  boot-time not-ready.

Fix (paste into the amendments file):
```
AMEND 12-06 Task 2 <action>: add `auditHook.getAuditConnection()` to the bootOpen sequence as
`bootOpen('audit', () => auditHook.getAuditConnection())`, executed after the control-plane open and before listen().
It must be a require-time/boot statement (never first-use). A DbNotReadyError there is logged and the process keeps
listening so /healthz reports it (same wrapper rule). Add behaviour: "a booted child with no request has audit.db at
LATEST('audit') and /healthz lists versions.audit". Add server.js region "boot statements: audit open" to 12-06's owned regions.
AMEND 12-13 files_modified: no server.js change needed once 12-06 lands the eager open; add to 12-13 Task 1 <read_first>
"server.js boot block bootOpen('audit')" and to acceptance_criteria: "`node -e` child boot with no request -> audit.db
user_version = 1 and audit.db.pre-v1.bak present".
AMEND 12-08 Task 1 <action>: getPartitionConnection must NOT be the first opener of audit.db in a process; assert
`auditHook.isAuditOpen()` (or equivalent) is true at that point, else throw a DbNotReadyError-style error rather than migrating
inside a deal transaction.
```

---

## WARNING

### W-1 [scope_sanity] 12-01 modifies 18 files (blocker threshold 15) and ten plans exceed the 100,000-token smart-zone budget
`estimate-check --calibrated`: budget 100,000. Over: 12-02 (110k), 12-04 (120k), 12-05 (140k), 12-06 (130k), 12-08 (150k), 12-09 (115k),
12-10 (105k), 12-12 (140k), 12-13 (145k), 12-14 (120k); all `confidence: low`. 12-01's 11 test files are one mechanical edit
(MA_* temp block) but are still 11 context-loads. Files/plan also: 12-08 (13), 12-06 (12). Not a blocker (each plan is 2-3 tasks,
tracer-first, each task independently verifiable) but quality risk is real for 12-08, 12-12, 12-13.
Fix: split 12-01 Task 2 into its own plan (12-01b) or have Task 2 process the guard-flagged files in two batches with a commit between;
for 12-08 and 12-13 keep the task boundaries but instruct the executor to commit per task and write the SUMMARY incrementally.

### W-2 [verification_derivation] Legacy-audit migration at real volume (80 MB - 5 GB) is never actually measured, and disk is never checked
12-13 Task 2 rehearses "when data/audit.db exists on this machine ... if absent record 'not available on this host'". Executors run
in an isolated worktree; the 86 MB gitignored `data/audit.db` lives only in the main checkout, so the rehearsal will be recorded as
unavailable and the acceptance still passes. Time, WAL growth and disk for the migration (VACUUM INTO backup + partition copy +
rebuilt audit.db + WAL of the DROP/RENAME rebuild ~ 3-4x file size; this host has 8.5 GB free) are therefore unproven. No plan
states a free-space precondition; none caps soak/perf scratch volume or guarantees cleanup on the failure path.
Fix:
```
AMEND 12-13 Task 2 <action>: replace the real-data-only rehearsal with a generated volume fixture:
`scripts/perf/lib/legacy-audit-volume.js` builds a v0 audit.db in a mkdtemp dir with N rows (default 300,000 rows of ~1 KB,
~1,000 deal ids, 5% control rows; N configurable via --rows) and the matching control.db; the rehearsal times the migration on
it and on a copy of data/audit.db when present. Acceptance: duration, peak WAL size and free-space delta recorded in SUMMARY.
AMEND 12-06 db/migrate.js (backup:true path): before VACUUM INTO, `fs.statfsSync(dir)`; refuse (DbNotReadyError reason
'insufficient-disk-for-migration') when free bytes < 3 x file size + 64 MB. 12-13 DEPLOYMENT.md must state the 3x rule.
AMEND 12-02 T3 / 12-05 T3 / 12-04 T3 / 12-07 T1: temp dirs are removed in a finally AND on SIGINT/SIGTERM (not only at normal exit);
no script may start when `df` free space < 1 GB.
```

### W-3 [key_links_planned] Seal path does not check the checkpoint result; cross-process cached connections can leave a non-checkpointed WAL under a recorded SHA-256 (D-12-04)
12-12 Task 1: `wal_checkpoint(TRUNCATE)` -> close -> chmod 0400 -> `sha256(main file)`. `PRAGMA wal_checkpoint(TRUNCATE)` returns
`busy=1` when another connection (the server process holds a cached RW partition connection; the CLI `audit-admin.js seal` is a
second process) has an open read snapshot; the WAL is then not folded into the main file and the later last-connection close
changes the sealed file => `sealed-sha=MISMATCH` / "modified-after-seal" false tamper signal, purge permanently refused.
Fix:
```
AMEND 12-12 Task 1 <action> sealPartitionFile: read the checkpoint row; if busy !== 0 or log !== checkpointed, retry (3 x 250 ms),
then fail the seal with reason 'checkpoint-busy' (409, event audit-partition-seal-refused) WITHOUT chmod/hash. Behaviour added:
"seal while a second process holds an open read transaction on the partition is refused and leaves the file writable and unsealed".
Add acceptance: sha256 recorded == sha256 recomputed after both connections close.
```

### W-4 [dependency_correctness] 12-13 rerun re-opens an already-sealed 0400 `legacy.db` through read-write `openDbFile`
12-13 action: per target "open the partition with `dbFiles.openDbFile(auditPartitionPath(target), ...)`, read MAX(legacy_id)". On
the crash-rerun the legacy partition is 0400 (sealed before the injected failure). RW open of a read-only WAL file falls back to
read-only semantics; `conn.exec(schema)`/pragma behaviour is unspecified and the crash test is exactly the case that exercises it.
Fix: "For a target whose file exists, read MAX(legacy_id)/sealed state with `openDbFileReadOnly`; open RW only when rows remain to
append (and then the partition cannot be sealed, by construction). Add to the crash-rehearsal behaviour: legacy.db mode still 0400
and byte-identical after the rerun."

### W-5 [requirement_coverage] Deal files migrate lazily, not "at boot" (PRD acceptance 3, SC3)
12-06 PD-6 / Task 2: "a version-0 deal file migrates on the first request bound to that deal". SC3/acceptance 3 say every file,
including deal files, migrates at boot and a broken migration keeps the instance not-ready. With stamp-only baselines this is
harmless today, but the first non-baseline deal migration will run inside a request (on the resolver's open), under a held
connection cache, and its failure only becomes visible after traffic hits that deal.
Fix: either (preferred) add a bounded boot sweep `for (deal of controlStore.listDeals() where status != 'deleted') openDbFile`
inside `bootOpen('deals')` wrapped to catch DbNotReadyError per deal (readiness lists failing deals only as `deal`), or record in
12-VALIDATION.md and PROJECT.md Key Decisions that deal-file migration is first-open by decision PD-6 and that SC3 is satisfied
for the demo/control/runtime/audit files at boot and for deal files at first open. The second option needs a user-visible
acknowledgement because it narrows a locked success criterion.

### W-6 [task_completeness] Verify chains exceed the executor's 10-minute foreground limit
12-14 Task 2 `<automated>` chains `phase10-walk.js` (all lanes) + `test-gate.js --runs 20` + `npm run soak` (2 min) + du. The
20x suite alone is 20 x (several minutes). 12-14 Task 1 (`npm run perf -- --assert`: write + list-reads x3 + load-40 45 s x3 +
pack x3) is also multi-minute. A foreground tool call is capped at 10 minutes; the executor will time out or silently truncate.
Fix:
```
AMEND 12-14 Task 1/2 <action>: "Run each long command with run_in_background (or nohup ... > evidence/<name>.log 2>&1 &) and poll
the log; the `<automated>` command is split into one verify per evidence item: (a) perf --assert, (b) gate --runs 20 --no-soak,
(c) soak, (d) smoke, (e) walks. Each is individually <= 10 min or backgrounded with a `until grep -q 'DONE' log` wait."
Same for 12-01 Task 3 (soak smoke inside test:gate) and 12-13 Task 2.
```
Also: every `<automated>` begins `cd "/Users/karstenhaldan/M&A"` (absolute main-checkout path). Phase 11 shipped with the same
convention, but in an isolated worktree this tests the MAIN tree, not the executor's changes. Replace with
`cd "$(git rev-parse --show-toplevel)"` in all 14 plans, or add a one-line orchestrator note that executors must substitute their worktree root.

### W-7 [dependency_correctness] Wave 3 server.js hunks are adjacent, not just disjoint; ordering rule and constant placement are unspecified
Region table (function/route names; line numbers are current):

| Plan | Regions owned in server.js |
|---|---|
| 12-08 | `app.get('/api/admin/audit'` (~2108), download-zip `-x` string (~2133), new handler in error chain after 12-06's DbNotReadyError |
| 12-09 | `app.get('/api/assessment-status'` (~3874), `taskLane`..`app.post('/api/integration-tasks/from-remediation'` incl. `resolveTaskClearanceArea`/`reportTaskRows` (~3998-5360), `/api/checklist-templates` (4210), synergies (4218-5218), `portalNowMs`+`/api/notifications` (7114-7185), `/api/employees` (7592) |
| 12-10 | `// Due Diligence workspace (DD-01/DD-04)` (6459) .. `app.get('/api/dd/summary'` end (~7113) |
| 12-11 | `orgPositionsLane` (5518) .. `app.get('/api/org/summary'` end (~6458), `ReportExportQuerySchema`+`/api/reports/export` (7229), data-read lines of `/api/reports/pack` (7405) |

Pairs that touch consecutive lines: 12-11 org summary (ends ~6458) / 12-10 DD marker (6459); 12-10 dd/summary end (~7113) / 12-09
`// In-app notifications` marker (7114). Git three-way merge treats touching hunks as a conflict. 12-09 also calls its
region "reportTaskRows (~5266-5303)" which sits inside the RAID area that 12-05 (wave 2) already edited — fine because 12-05 is merged first.
No plan relies on a same-wave sibling (12-09 / 12-11 only mention it informationally). `depends_on`/waves are consistent
(01,02,03,04 -> W1; 05[02,04], 06[01,04], 07[01] -> W2; 08[02,05,06], 09[05,07], 10[05], 11[05,04] -> W3; 12[08] -> W4; 13[12,06] -> W5; 14[all] -> W6).
Fix:
```
AMEND wave-3 execution note (all four plans): merge strictly in order 12-08, 12-09, 12-10, 12-11 and run `node --test` after each
merge; place every new `const *_READ_SET` / `app.<builder>` exposure immediately adjacent to the handler it serves, never in the
top-of-file constants area or the module.exports tail. 12-10 and 12-11 must leave one untouched blank/comment line before their
region marker so hunks are not touching.
AMEND 12-10 depends_on: add "12-03" (its due-diligence.js change relies on serve-time stamping; asset-cache-bust is in its verify).
```

### W-8 [context_compliance] D-12-02 write-handler conversion and "dashboards" are narrowed by PD-20 without a recorded decision
D-12-02 (locked): "convert the hot GET handlers (raid, integration-tasks, notifications, synergies/rollup, dd/*, org/*, reports,
dashboards) and write handlers that only need a few collections". PD-20 (12-09) limits write conversions to RAID, tasks, DD
items/findings and org positions; every other write keeps `readDb()` (136 call sites remain, ~30 converted). "dashboards" is
never mapped to a named route (12-09 treats assessment-status/employees as the stand-in). All named budgets are still covered
(40-client mix = raid/tasks/employees/POST raid/healthz), so this is not a phase-goal failure — but it is a silent narrowing of a locked decision.
Fix: add to 12-09 a one-paragraph "D-12-02 conversion inventory" that lists the GET/POST routes converted, the routes
intentionally left on `readDb()` with the budget rationale, and states which route(s) "dashboards" resolves to; mirror it into
12-VALIDATION.md. If the user wants literal compliance, add a task converting `GET /api/alerts`, `/api/pulses`,
`/api/communications` read paths to `readCollections`.

### W-9 [task_completeness] 12-04 worker fallback trigger covers only `@napi-rs/canvas`
12-04 Task 1: process-mode fallback "ONLY if the tracer shows `@napi-rs/canvas` cannot load inside a worker_thread". Task 2 adds
pdf-parse (pdfjs-dist, which itself polyfills through `@napi-rs/canvas` and may start its own worker) in a thread; a failure there
has no stated path and Task 2 has no tracer. Fix: "If either worker module fails to load or run inside a worker_thread
(`Module did not self-register`, pdfjs fake-worker import error), `createIsolatedTask({ mode: 'process' })` is used for that
task; the SUMMARY records the mode per task."

---

## INFO

- **I-1** 12-14 has no `<reversibility>` (evidence-only plan). Add `reversible`.
- **I-2** 12-13 PD-25: audit.db hash columns are nullable. State appendChained behaviour when the head row has `row_hash IS NULL`
  (raw-inserted or rollback-release row): recommended "chain from the genesis for 'control' and have verifyChain report that
  row as `unchained-row` once", otherwise the first chained row after a raw insert has an undefined `prev_hash`.
- **I-3** 12-02 Task 3 write-latency is measured at wave 1 while handlers still use full `readDb()`; the first representative
  number appears only in 12-14. Local micro-benchmark on this host (5,000 x ~460 B rows): parse 3.6 ms, stringify 2.2 ms, second
  parse 3.5 ms, so the <=40 ms budget is plausible, but running `write-latency.js` (no assert) in 12-09 Task 3 gives wave-3 warning time.
  Also compare `candidate === priorRaw` BEFORE `JSON.parse(priorRaw)` for versioned rows (current code parses first).
- **I-4** 12-07 verify hard-codes `AXE_CORE_PATH=/Users/karstenhaldan/cv/node_modules/axe-core` (exists, v4.11.1). Acceptable for this host
  (D-12-08 allows a documented external install); README must say it is a host-local path.
- **I-5** 12-01's guard merges after three other wave-1 plans create new test files. Orchestrator should run the full suite once
  after the wave-1 merge (before starting wave 2); any new suite lacking its MA_* block will fail loudly with `[test-isolation]`.

---

## What was verified as correct (no finding)

1. **Atomicity seam (PD-1/PD-3).** store.js writeDb already calls the audit append as the last statement inside the deal `.immediate`
   transaction on a different connection; a throw there rolls the deal write back (better-sqlite3), so a 503/409 still means
   "nothing persisted". Retargeting that call to the partition connection keeps the invariant; the residual (deal COMMIT fails after
   the partition commit -> audited-but-uncommitted row) is unchanged from Phase 8 and soak check 4 detects it. Two writers: head read
   under BEGIN IMMEDIATE linearises appenders across processes (12-08 Task 3 proves with 300 rows / 2 processes + soak check 10).
2. **Lock order.** deal -> partition only. seal (partition only, event after release), export/verify/viewer (read-only), purge (sealed
   => appends already refused), migration #1 (audit.db -> partition; nothing takes partition -> audit.db) — no cycle. The only
   hazard is B-1 (migration nested inside a deal transaction when audit is first-opened lazily).
3. **Denial rows (PD-2).** `recordSecurityEvent` rows incl. Phase 11 `access-denied` (rate-bounded auditor, folded counts) stay in
   audit.db with `deal_id`; the viewer joins by `deal_id`; no partition file is created by a probe; seal/verify/purge concern
   partitions only. Existing tests that read audit.db rows directly (reports-pack, reports-audit, task-access-filter, bootstrap-admin,
   real-mode-guards, denial-audit, db-file-layout) read control rows only, so they stay green. The soak's check 8 uses set
   membership of markers, so removing the untouched-row re-audit (12-02) does not break it.
4. **Contracts preserved.** Phase 8 503/Retry-After untouched (new 503s carry `retryable:false`, client peeks only when `clone` exists);
   Phase 9 version WHERE, conflictVisibleRecord and structural test (`function raidLane(db) {`, every `json_extract` line carries `?`) are
   explicitly kept (raidLaneName/taskLaneName siblings, bound JSON path); Phase 10 path gate untouched; Phase 11 clean-room: one shared
   predicate for list + report paths, clearance before filter/paging, no total/q oracle; demo.db/control.db are never written
   (PD-5 implied version, Task 3 sha256 guard); no new runtime dependency; Playwright/axe stay outside node_modules; `.gitattributes`
   did not exist so export-ignore is a pure add. `AUDIT_DIR` derives from `dirname(MA_AUDIT_DB_PATH)`, and all 71 audit-isolating
   suites use per-test temp dirs (verified by grep), so partitions never leave the temp tree.
5. **Budgets asserted, none loosened.** write median <= 40 ms (N=21, rows-per-change = 1, reorder = 0), 10x3 p95 = sorted[28] <= 300 ms
   x3 runs, 40-client eld p99 <= 100 ms x3 runs (resolution 5 ms), pack eld p99 <= 50 ms x3 rounds + second request 429, DD = 1
   `/api/dd/*` request in the browser — all in `npm run perf -- --assert` (12-09) executed by 12-14 with the explicit "never edit a
   budget" rule. Measurement is reproducible on a laptop: byte-copied committed DBs via read-only backup, mkdtemp, temp dirs removed
   (see W-2 for the disk preconditions that are missing).
6. **Soak volume.** The 5 GB audit file came from the pre-12-02 write amplification; every soak/perf run in the plans happens after
   12-02's dirty-row writes (12-01's `test:gate` soak is only run with `--no-soak`), so scratch volume is MBs. Soak scratch is
   `os.tmpdir()` and removed in main()'s finally.

---

## Requirement -> plan coverage

| Requirement | Plans (requirements frontmatter) | Delivering task(s) | Status |
|---|---|---|---|
| DATA-01 | 12-02, 12-05, 12-09 | 12-02 T1-T3 (dirty-row, volume proof, latency), 12-14 T1 | Covered |
| DATA-02 | 12-05, 12-09, 12-10, 12-11 | readCollections/paging 12-05 T1-T2; tasks/notifications 12-09 T1-T2; DD workspace 12-10 T1; org/reports 12-11 | Covered (see W-8) |
| DATA-03 | 12-06, 12-13 | 12-06 T1-T2 (control/runtime/deal), 12-13 T1-T2 (audit) | **Gap: audit boot (B-1)**, deal lazy (W-5) |
| DATA-04 | 12-08, 12-12, 12-13 | chain+seam 12-08; seal/export/purge 12-12; legacy+control chain+DEPLOYMENT 12-13 | Covered (W-3, W-4) |
| DATA-05 | 12-04 | 12-04 T1-T3 | Covered (W-9) |
| DATA-06 | 12-01, 12-02, 12-06, 12-08 | guard+workflow+gate 12-01; healthz test 12-06; soak/Phase 9 unchanged 12-02/12-08 | Covered |
| QUAL-01 | 12-03 | 12-03 T1-T2 | Covered |
| QUAL-02 | 12-07 | 12-07 T1-T2 | Covered |

## ROADMAP SC -> plan

| SC | Plans | Verdict |
|---|---|---|
| SC1 one audit row, median <= 40 ms | 12-02, 12-14 T1 | OK |
| SC2 paging/filter, DD one request, 10x3 p95, eld p99 | 12-05, 12-09, 12-10, 12-11, 12-14 | OK |
| SC3 schema versions, legacy audit migrates at boot, broken => not-ready | 12-06, 12-13 | **B-1, W-5** |
| SC4 partitions, seal SHA event + read-only, CLI verify, purge refusal, viewer across | 12-08, 12-12, 12-13 | OK (W-3/W-4) |
| SC5 pack p99 <= 50 ms, second refused/queued | 12-04, 12-14 | OK (refused/429) |
| SC6 20x green, no data/audit.db|runtime.db writes, stamp test, workflow | 12-01, 12-03, 12-14 | OK (W-6) |
| SC7 soak + Phase 9 suite unchanged; reorder via seq | 12-02, 12-08, 12-14 | OK |
| SC8 smoke harness, excluded from zips | 12-07, 12-14 | OK |

## Decision coverage (D-12-01..08)

| Decision | Plans | Verdict |
|---|---|---|
| D-12-01 dirty rows | 12-02 | Full |
| D-12-02 reads | 12-05, 12-09, 12-10, 12-11 | Full for named routes; PD-20 narrowing (W-8) |
| D-12-03 versions/migrations | 12-06, 12-13 | Partial until B-1 fixed |
| D-12-04 partitions | 12-08, 12-12, 12-13 | Full (seal additionally requires archived/absent deal — PD-7, compatible with the decision) |
| D-12-05 CPU isolation | 12-04 | Full |
| D-12-06 test signal | 12-01, 12-06 | Full |
| D-12-07 cache-bust | 12-03 | Full |
| D-12-08 smoke | 12-07 | Full |

## Region-disjointness per parallel wave

**Wave 1 (12-01..12-04)**
| File | 12-01 | 12-02 | 12-03 | 12-04 |
|---|---|---|---|---|
| db/dbFiles.js | `assertTestIsolation` + openDbFile call | - | - | - |
| db/store.js | - | writeDb/readDb | - | - |
| db/auditHook.js | - | `countAudit` | - | - |
| server.js | - | - | `/`, static block, SPA catch-all | `getReportPack`, `/api/reports/pack`, `/api/rag/upload` |
| public/js/transitions.js | - | - | - | `attemptFetch` 503 branch |
| test files | 11 guard-flagged suites (+ new) | new only | asset-cache-bust rewrite (+ new) | client-busy-retry append (+ new) |
| package.json | `test:gate` | - | - | - |
Disjoint. (01's edits to writedb-merge / concurrent-write tests are block-only; 12-02 consumes them unchanged.)

**Wave 2 (12-05..12-07)**: 12-05 = store.js read API + RAID region (`raidLane`..`app.get/post('/api/raid'`, `app.delete('/api/raid/:id'`);
12-06 = dbFiles.js, db/migrate.js, readiness.js, `/healthz`, error chain (404 -> new -> busy), boot statements; 12-07 = scripts/smoke,
package.json, .gitattributes. Disjoint.

**Wave 3 (12-08..12-11)**: see W-7 table. Disjoint but with two touching-hunk pairs; db/* is only edited by 12-08.

**Waves 4-6** are single-plan waves (12-12, 12-13, 12-14): no parallelism.

## Recommendation

1 blocker (B-1) must be amended before execution; W-2, W-3, W-5, W-6, W-7 should be amended in the same revision (all are small,
text-level plan edits). The remaining warnings can be recorded as executor notes. Once B-1 is fixed the set will deliver the
phase goal: the seams the planner flagged (atomicity, lock order, denial rows, budgets, merge safety, contract preservation) hold up
against the code.
