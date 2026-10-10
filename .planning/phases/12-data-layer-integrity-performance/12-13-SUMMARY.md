---
phase: 12-data-layer-integrity-performance
plan: 13
subsystem: database
tags: [audit, migration, hash-chain, partitions, sealing, mnpi, retention, rehearsal]

requires:
  - phase: 12-06
    provides: "migration runner (backup: true, PD-28 disk rule), eager audit.db open at boot"
  - phase: 12-08
    provides: "auditChain appendChained/verifyChain (PD-30 head rule), per-deal partitions, audit-verify"
  - phase: 12-12
    provides: "db/auditLifecycle.js sealPartitionFile (sync, no auditHook), seal/export/purge, audit-admin CLI"
provides:
  - "audit family migration #1 (db/migrations/audit/001-partition-legacy.js): legacy audit.db -> per-deal partitions + sealed legacy.db + chained control log, at boot"
  - "audit.db schema v1 (legacy_id, prev_hash, row_hash; nullable by PD-25)"
  - "recordSecurityEvent / control writeAuditBatch append chained (genesis 'control') — incl. Phase 11 access-denied rows"
  - "scripts/perf/lib/legacy-audit-volume.js + scripts/perf/legacy-audit-migration.js synthetic-volume rehearsal"
  - "DEPLOYMENT.md: audit layout, tamper evidence, MNPI purge path, retention (TE legal), upgrade/rollback, residuals"
affects: [12-14]

requirements-completed: [DATA-03, DATA-04]

tech-stack:
  added: []
  patterns:
    - "idempotent cross-file import keyed by legacy_id (MAX(legacy_id) = resume watermark; completeness COUNT = COUNT DISTINCT = source rows asserted)"
    - "possibly-sealed 0400 targets are only ever probed through openDbFileReadOnly; RW open only when rows remain"

key-files:
  created:
    - db/migrations/audit/001-partition-legacy.js
    - test/fixtures/legacy-audit-v0.sql
    - test/audit-legacy-migration.test.js
    - test/audit-control-chain.test.js
    - scripts/perf/lib/legacy-audit-volume.js
    - scripts/perf/legacy-audit-migration.js
  modified:
    - db/audit-schema.sql
    - db/auditHook.js
    - scripts/audit-verify.js
    - DEPLOYMENT.md

key-decisions:
  - "Old table is renamed aside (audit_log_v0) and the v1 table built under the final name `audit_log` — appendChained is hard-wired to that table name, so the events continue the same chain with no duplicate append code"
  - "v1 DDL is frozen inside the migration module (released-migration rule); db/audit-schema.sql is the live copy for fresh files"
  - "AUTOINCREMENT high-water mark of the legacy file is carried into sqlite_sequence so ids are never reused after the swap"
  - "peak_scratch_mb in the rehearsal counts only audit.db(+wal/shm), .pre-v1.bak and audit/*; the boot's own demo.db/runtime.db seed is reported separately (tree_peak_mb)"

duration: ~25min
completed: 2026-10-10
status: complete

actuals:
  tokens: 25600
  tasks: 3
  commits: 4
---

# Phase 12 Plan 13: Audit migration #1 Summary

**A legacy single audit.db now migrates AT BOOT into per-deal hash-chained partitions plus a sealed 0400 `legacy.db`, audit.db is rebuilt as the chained control-plane log, every later control event (including Phase 11 `access-denied` rows from several processes) is chained, and DEPLOYMENT.md documents the MNPI purge path with retention owned by TE legal.**

## Commits

| Task | Commit | What |
| ---- | ------ | ---- |
| 1 (tracer) | `5892799` | migration #1, audit-schema v1, chained control appends, fixture, test/audit-legacy-migration.test.js (boot migration, B-1, crash rerun, W-4, I-2, fresh install) |
| 2 | `f050407` | test/audit-control-chain.test.js, audit-verify --all docs + verify-all/tamper/guard tests, synthetic generator + rehearsal, completeness assertion moved onto the open connection |
| 3 | `04aca49` | DEPLOYMENT.md section (7 points + residuals) |

## What was built

### Migration #1 (`db/migrations/audit/001-partition-legacy.js`, `backup: true`)

- Rows with `db_kind='deal' AND deal_id IS NOT NULL` move; target = that deal's partition when the
  deal is registered in control.db (read-only `SELECT id FROM deals`; missing control.db => none),
  else `legacy`. Everything else stays in audit.db with its deal_id.
- Imports are batched (2,000), `legacy_id` = original id, chained through `appendChained`, chain
  verified, and `COUNT(legacy_id) = COUNT(DISTINCT legacy_id) = source rows` asserted per partition.
- **W-4:** an existing target is probed with `openDbFileReadOnly` (watermark + sealed state); it is
  opened read-write only when rows remain; sealed + rows remaining throws
  `legacy-sealed-incomplete` (not-ready, nothing written). `legacy` is sealed through
  `auditLifecycle.sealPartitionFile('legacy', { actor: system:migration })`, which reports an
  already sealed read-only file without opening it writable — so the crash rerun leaves it
  byte-identical (asserted by sha256 and mtime).
- audit.db swap in the runner's single transaction: drop old indexes + triggers, rename aside,
  create v1 table WITH indexes and both append-only triggers, copy control rows with original ids
  (chained, genesis `control`), append `audit-migrated` + the legacy `audit-partition-sealed`
  event (deal_id `legacy`, so `audit-verify` finds its sha), verify the chain, drop the old table.
- `MA_TEST_AUDIT_MIGRATION_FAIL_AT=rebuild` throws before the rebuild (ignored when MA_MODE=real).

### Chained control appends (`db/auditHook.js`)

`recordSecurityEvent` and control-kind `writeAuditBatch` go through
`appendChained(conn, rows, { partitionId: 'control' })`. Phase 11's denial auditor writes through
`recordSecurityEvent` (server.js `write:`), so no 11-04 / server.js edit was needed.

### I-2 rule

A raw hashless row is reported once as `unchained-row` (audit-verify exit 1); the next chained
append links to the last row that HAS a hash (PD-30 rule already in auditChain). Proved with a real
raw insert + a child `recordSecurityEvent` + `audit-verify --all`.

## Synthetic-volume rehearsal (PD-31 / checker W-2)

`node scripts/perf/legacy-audit-migration.js` (default 150,000 rows) on a generated v0 tree in a temp
dir; the developer's real data/audit.db was never opened. Full-size run (log outside the repo, EXIT=0):

| Metric | Measured |
| ------ | -------- |
| rows / source file | 150,000 / 158.3 MB (1,000 deal ids, 800 registered) |
| boot with migration (`duration_ms`) | 6,441 ms (plain boot of the migrated tree 145 ms => migration ~6.3 s) |
| peak WAL | 5.3 MB |
| peak scratch (audit.db + .bak + partitions + sidecars) | 512.3 MB (tree incl. boot seed 513.7 MB) |
| free-space delta (whole run incl. the generated source) | 516.8 MB |
| peak scratch / file size | **3.24** (incremental over the source file: 354 MB = 2.24x) |
| rows moved | 114,105 into 800 partitions, 28,270 into legacy.db, 7,625 kept in audit.db — all equal to the generator's expected counts (`accounting=OK`) |
| `audit-verify --all` | 802 files OK (800 partitions + legacy + audit.db), exit 0 |
| extrapolation to 5 GB (linear, NOT measured) | migration ~3.4 min, peak scratch ~16.2 GB, peak WAL ~0.2 GB; 12-06 rule needs 3 x 5 GB + 64 MB = 15.1 GB free |

20k-row run (the plan's quick verify): 21.1 MB, 2.1 s boot, peak scratch 81.8 MB (3.88 x — fixed
per-partition overhead of ~45-53 KB per file dominates at 800 tiny partitions), verify OK.

**Gap for the orchestrator (reported, nothing loosened).** The literal peak-scratch / file-size
ratio is 3.24 at full size and 3.88 at 20k rows, above 3. The 12-06 rule (3 x size + 64 MB free)
is about space *in addition to* the file already on disk: incremental use was 2.24 x (full size) and
~2.9 x (20k, 60.7 MB over a 21.1 MB file), so the rule held in both measured cases, but the margin
is thin for a legacy file spread over very many tiny deals (fixed per-partition cost). The 5 GB
extrapolated incremental (~11 GB) is within the 15.1 GB rule.

Guards verified: `--rows 300001` exits 2 before anything is written; a deliberately bad env
(`MA_AUDIT_DIR=<repo>/data/audit`) exits 2 with "refusing to spawn — MA_AUDIT_DIR ... outside the
temp tree" before generating; no `gsd-12-13-rehearsal-*` directory was left behind after any run
(checked); `git status --porcelain data public/sent_emails` empty.

## Deviations from Plan

**1. [Rule 1 - Bug] Control-row copy used an open iterator while inserting on the same connection**
- Found during: Task 1 (better-sqlite3: "This database connection is busy executing a query")
- Fix: paged by id (LIMIT 1000) — also bounds memory for a large control log
- Files: db/migrations/audit/001-partition-legacy.js (in `5892799`)

**2. [Plan detail] Table name during rebuild**
- The plan describes creating `audit_log_v1`; `appendChained` is hard-wired to `audit_log`, so the
  old table is renamed aside (`audit_log_v0`) and the new one built as `audit_log`. Same atomicity
  (one transaction, triggers created with the table), no duplicated chain code.

**3. [Plan detail] audit-verify --all already covered audit.db**
- 12-12's verifier already listed audit.db with partitionId `control`; only its header/docs changed
  (audit.db is no longer "UNCHAINED until 12-13").

**4. [Rule 2 - correctness] Per-partition completeness assertion + sequence carry-over**
- Not in the plan text: after each import `COUNT(legacy_id) = COUNT(DISTINCT legacy_id) = source
  rows` is asserted (loss/duplication fails the migration), and the old AUTOINCREMENT high-water
  mark is carried into `sqlite_sequence` so ids are never reused. The assertion originally opened a
  second read-only connection per partition, which left a stray -shm/-wal per file and inflated
  scratch; it now reads the already-open connection (rehearsal peak scratch fell 110 -> 82 MB at 20k).

**5. Task 2 test cases landed with the Task 1 test file**
- The crash/rerun, W-4 and I-2 cases were written alongside the tracer in
  test/audit-legacy-migration.test.js (commit `5892799`); Task 2 added verify --all, tamper and
  rehearsal-guard cases and test/audit-control-chain.test.js.

**6. Not changed (out of owned list)**
- db/migrate.js header still says the audit family has "none yet"; server.js untouched (no boot
  hook was required).

## Test results

- Targeted: audit-legacy-migration (9 cases), audit-control-chain (2), denial-audit, audit-log,
  audit-security-events, schema-migrations, healthz-readiness, db-file-layout, audit-partitions,
  audit-lifecycle*, bootstrap-admin, real-mode-guards, reports-audit, deployment-role-matrix,
  no-get-mutates — all pass unchanged.
- Full suite after Task 1: 1441/1441. Final full suite (before the docs-only Task 3 commit):
  1445 tests, 1444 pass, 1 fail = `cpu-isolation` "a job past timeoutMs is terminated" — a known
  load flake (host load average ~24); re-run alone: test/cpu-isolation.test.js 22/22 pass.
  Baseline was 1434; +11 new tests.

## Known Stubs

None.

## Threat Flags

None new. T-12-120..128 are mitigated as planned: backup + legacy_id idempotency + verify-before-commit
(120), chained control audit (121/122, two-process proof), triggers inside the swap transaction (123,
asserted), rehearsal cap/floor/cleanup (125/127), read-only probe of sealed targets (128), backup 0600 (126).
T-12-124 (control-plane residue after a purge) is accepted and listed in DEPLOYMENT.md.

## Self-Check: PASSED

- db/migrations/audit/001-partition-legacy.js, db/audit-schema.sql, test/fixtures/legacy-audit-v0.sql,
  test/audit-legacy-migration.test.js, test/audit-control-chain.test.js,
  scripts/perf/lib/legacy-audit-volume.js, scripts/perf/legacy-audit-migration.js, DEPLOYMENT.md: present.
- Commits `5892799`, `f050407`, `04aca49` present; no data/*.db, public/sent_emails, STATE.md or ROADMAP.md change.
