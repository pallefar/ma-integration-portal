---
phase: 12-data-layer-integrity-performance
plan: 08
subsystem: database
tags: [sqlite, audit, hash-chain, partitions, wal, atomicity, soak]

requires:
  - phase: 12-02
    provides: "proportional audit rows; countAudit/queryAudit as the only audit-count API"
  - phase: 12-06
    provides: "schema versioning + readiness; audit.db opened at server boot (B-1)"
provides:
  - "db/auditChain.js: canonical row, partition-bound genesis, appendChained (BEGIN IMMEDIATE head read), verifyChain, AuditPartitionSealedError"
  - "per-deal audit partitions data/audit/<dealId>.db (0600/0700), schema db/audit-partition-schema.sql, family audit-partition"
  - "auditHook.appendWriteAudit / getPartitionConnection / isAuditOpen / closePartitionConnection; cross-partition queryAudit + countAudit (rows tagged partition)"
  - "scripts/audit-verify.js (<file>|--deal|--all; exit 0/1/2)"
  - "sealed-partition backstop: refusal in appendChained + fixed 409 handler; tightening-only chmodPrivateFile"
  - "soak reads the deal partition and gains check 10 (chain verifies)"
affects: [12-12, 12-13]

actuals:
  tokens: 70000
  tasks: 3
  commits: 3

key-files:
  created:
    - db/auditChain.js
    - db/audit-partition-schema.sql
    - db/migrations/audit-partition/001-baseline.js
    - scripts/audit-verify.js
    - test/audit-partitions.test.js
    - test/audit-chain-multiprocess.test.js
  modified:
    - db/auditHook.js
    - db/dbFiles.js
    - db/store.js
    - db/migrate.js
    - db/readiness.js
    - server.js
    - scripts/soak.js
    - .gitignore
    - test/db-artifact-exclusion.test.js

key-decisions:
  - "PD-1: the partition append is the FINAL statement of the deal's .immediate transaction, run as its own BEGIN IMMEDIATE on the partition's OWN connection (Phase 8 CR-01 mechanism, no cross-file link)"
  - "PD-2: every recordSecurityEvent row (incl. Phase 11 access-denied) stays in audit.db with deal_id; partitions get only writeDb deltas, so a probe can never create a partition file"
  - "PD-29: writeDb opens audit.db before BEGIN IMMEDIATE; getPartitionConnection refuses to be the first opener (DbNotReadyError audit-not-open, no file created)"
  - "Viewer ordering is ts DESC, id DESC within a source and across the merge; offset capped at 100000; row ids are per file so (partition, id) is the identity"

requirements-completed: [DATA-04, DATA-01, DATA-06]

duration: 75min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 08: Hash-chained per-deal audit partitions Summary

**Deal audit rows now live in `data/audit/<dealId>.db`, hash-chained with a partition-bound genesis, appended as the last step of the deal's own transaction so a refused append still rolls the deal write back; the admin viewer spans partitions, `scripts/audit-verify.js` detects a flipped byte, and the 3-process soak passes with the chain verifying.**

## The atomicity argument (in my own words)

Phase 8's contract is "a 503 means NOTHING persisted". That held because the audit append ran
inside the deal file's `BEGIN IMMEDIATE` transaction: a throw from the append unwinds the
transaction body before the deal file commits, so better-sqlite3 rolls the deal write back.
Moving the audit target to a partition file does not change that shape:

1. `writeDb()` opens the deal's `.immediate` transaction (deal write lock held).
2. All row writes run; then, as the LAST statement, `auditHook.appendWriteAudit()` is called.
3. For a deal it calls `appendChained(partitionConn, ...)`, which is its own `BEGIN IMMEDIATE`
   on the partition's own connection. better-sqlite3's no-nesting rule is per connection, so
   this is legal, and there is no cross-file link (WAL gives no cross-file atomicity).
4. If step 3 throws for ANY reason (busy partition, sealed partition, I/O, bad id) the error
   propagates out of the deal transaction body, the deal file never commits, and nothing is
   persisted. The client's identical retry therefore cannot duplicate a row.
5. Order of the two commits: partition commits, then the deal commits. The only residual is a
   disk-level failure of the deal COMMIT after the partition commit: an audited-but-uncommitted
   row, never a committed-but-unaudited one (unchanged from Phase 8; the soak's 1:1 check
   detects both).

Deadlock: lock order is always deal file -> partition, and the partition is innermost. Seal and
the 12-13 migration take only partition/audit locks, so no wait cycle can form. B-1 / PD-29:
the only moment audit.db's own migrations could run under the deal lock was a first open from
inside the transaction; `writeDb()` now calls `getAuditConnection()` before `applyWrite()`
(cache hit in a server, first open outside the lock in CLIs/tests/soak children), and
`getPartitionConnection()` throws instead of opening audit.db itself.

Chain linearisation: each append is BEGIN IMMEDIATE -> read the head row -> insert chained
rows -> commit, so SQLite's single file write lock serialises all appenders in all processes;
the second appender always reads the head the first one committed.

**The test that proves a partition-write failure leaves the deal write unpersisted:**
`test/audit-partitions.test.js` case (c) holds `BEGIN IMMEDIATE` on the partition from a second
connection, performs a deal write, and asserts it throws `SQLITE_BUSY*`, the alert id is ABSENT
from the deal file, the partition has no new row, and an identical retry after the lock is
released succeeds exactly once. Case (i) proves the same for a sealed partition (store-level
`AuditPartitionSealedError`, then HTTP 409 with the fixed body and no audit row).

## Accomplishments

- Task 1 (tracer, `7bb886c`): chain primitives, partition schema + stamp-only baseline,
  dbFiles AUDIT_DIR/auditPartitionPath/openDbFileReadOnly, auditHook routing + connection cache,
  store.js final-step retarget + audit.db pre-open, audit-verify CLI, soak partition reads +
  check 10, `audit-partition` family in migrate.js.
- Task 2 (`323a20e`): sealed-partition 409 handler, viewer proofs (partition UNION control rows,
  no probe-created partitions, ordering/limit/offset), tightening-only chmod test, `data/audit/`
  gitignored + excluded from the download-zip.
- Task 3 (`16239ea`): two-process chain test (2 x 150 audited writes, 300 contiguous rows, valid
  chain, each acknowledged id exactly once); soak run.

## Soak verdict (`SOAK_DURATION_MS=20000 SOAK_WRITE_INTERVAL_MS=250 npm run soak`, 3 processes)

```
soak: load phase complete — acknowledged=913 refused=0 unexpected=0 | conflict-lane: acknowledged=80 conflict409=159 refused503=0
[PASS] every acknowledged write present in the final database and exact: acknowledged=913 missing=0 mismatched=0
[PASS] no cleanly-refused write left anything committed ...: refused=0 committedButUnaudited=0 committedAndAudited=0
[PASS] PRAGMA integrity_check ok on every touched file: deal=ok, control=ok, audit=ok
[PASS] audit trail matches acknowledged writes one-to-one: acknowledged=913 auditRows=913 missingFromAudit=0 duplicateInAudit=0 extraInAudit=0
[PASS] conflict-probe RAID record version reconciles exactly ...: expectedFinalVersion=81 actualFinalVersion=81
[PASS] 409 (conflict) outcome reconciles with the audit trail by membership ...: missingFromAuditTrail=0 leakedConflictedIntoAudit=0
[PASS] audit partition hash chain verifies after multi-process appends: rows=995 head=4c5a2e135ef7...
soak: PASS
```

The shortened duration follows the host-disk/load guidance in the dispatch (not the plan's
default 2 minutes); thresholds and the check set are the plan's.

## Deviations from Plan

**1. [Rule 3 - Blocking] Viewer + soak edits landed in the Task 1 commit.** The plan puts the
cross-partition `queryAudit`/`countAudit` in Task 2 and the soak edit in Task 3, but
test/audit-log.test.js, audit-volume and test/soak-correlator.test.js read deal rows through
those paths and would fail at the Task 1 commit. Moving them forward keeps the suite green at
every commit (the plan's own acceptance bar). Task 2/3 carry the remaining behaviours and tests.

**2. [Rule 2 - Missing critical] `db/readiness.js` `exposedFile()` now returns the literal
`audit-partition` for that family.** A partition basename is a deal id; /healthz is
unauthenticated (T-12-52), so a failure on a partition must not expose it. `db/migrate.js`
FAMILIES gains `audit-partition` (required for versioning); neither file is in the plan's
files_modified list.

**3. [Rule 3] `AuditPartitionSealedError` is re-exported from `db/auditHook.js`** so server.js's
new handler needs no new top-of-file `require` (wave-3 merge protocol keeps that region untouched).

**4. chmod tightening-only landed in Task 1** (db/dbFiles.js was edited once) — test (j) lives in
Task 2 as planned.

**5. Viewer `?deal=` and a rename-detection nicety in the CLI:** when the FIRST row fails its
prev-link the CLI reports `genesis-mismatch` (the renamed/swapped-file signature) instead of a
bare `prev-link-broken`; verifyChain's own reason set is unchanged (`row-hash-mismatch`,
`prev-link-broken`, `unchained-row`).

## Issues Encountered

None blocking. No known load-flake fired in the full-suite runs. The first full run (before
the soak harness edit existed) failed ONLY `soak-correlator` — the expected signal that the
harness had to read the partition (deviation 1).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-12-70..78 are all addressed by the tests named above).
New surface: partition files under AUDIT_DIR (0600/0700, gitignored, zip-excluded) and one
read-only CLI.

## Verification

- `node --test` full suite: **1378 tests, 1378 pass, 0 failures** (1366 at base + 12 new cases:
  10 in audit-partitions, 1 multiprocess, 1 db-artifact-exclusion), run on the final tree.
- committed `data/demo.db` / `data/control.db` untouched; `git status --porcelain data/
  public/sent_emails/` empty at every commit.
- `grep -v '^\s*//' db/store.js | grep -c "appendWriteAudit("` = 1 (single call site).

## Self-Check: PASSED

- db/auditChain.js, db/audit-partition-schema.sql, db/migrations/audit-partition/001-baseline.js,
  scripts/audit-verify.js, test/audit-partitions.test.js, test/audit-chain-multiprocess.test.js: present.
- Commits `7bb886c`, `323a20e`, `16239ea` exist on the worktree branch.
