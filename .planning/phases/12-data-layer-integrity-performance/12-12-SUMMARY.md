---
phase: 12-data-layer-integrity-performance
plan: 12
subsystem: database
tags: [audit, sealing, sha256, partitions, retention, export, cli, tamper-evidence]

requires:
  - phase: 12-08
    provides: "hash-chained per-deal audit partitions, AuditPartitionSealedError, viewer, audit-verify CLI"
provides:
  - "db/auditLifecycle.js: seal / status / export / purge orchestration (no dependency on auditHook; injected event recorder)"
  - "admin routes GET .../audit, POST .../audit/seal, GET .../audit/export, POST .../audit/purge under /api/admin/deals/:id"
  - "scripts/audit-admin.js (list | status | seal | export --out | purge --confirm), actor cli:<os-user>"
  - "scripts/audit-verify.js: sealed-sha=match|MISMATCH|no-event and --jsonl <export>"
  - "auditHook.findControlEvents / listPartitions"
affects: [12-13]

requirements-completed: [DATA-04]

actuals:
  tokens: 78000
  tasks: 3
  commits: 3

key-files:
  created:
    - db/auditLifecycle.js
    - scripts/audit-admin.js
    - test/audit-lifecycle.test.js
    - test/audit-lifecycle-routes.test.js
  modified:
    - db/auditHook.js
    - server.js
    - validators/deals.js
    - scripts/audit-verify.js

key-decisions:
  - "PD-7 revision 1 (W-3) implemented as written: checkpoint result checked before AND after the seal row, 3 x 250 ms retries, refuse checkpoint-busy with no chmod/hash"
  - "A repeated seal never launders modified bytes: seal event exists + file hash differs => modified-after-seal + tamper event"
  - "One orchestration (sealPartition / exportPartition / purgePartition) behind both the routes and the CLI; events injected so db/auditLifecycle.js never requires auditHook (12-13 can call it inside a sync up())"
  - "Purge decision order: no-partition, not-sealed, modified-after-seal, no-sealed-export, retention-never, retention-not-elapsed (the plan's five plus a defensive no-partition)"

duration: ~95min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 12: Audit partition lifecycle Summary

**An admin (route) or host operator (CLI) can seal a closed deal's audit trail into a read-only, SHA-256-recorded file, export it as self-verifying JSONL, and — only after a sealed export exists and the legal retention period has elapsed — purge it; every step is a control-plane event and nothing ever purges on its own.**

## Accomplishments

### Task 1 (tracer) — seal end to end (`031351b`)

- `db/auditLifecycle.js` (requires dbFiles, auditChain, fs, crypto only): `fileSha256`,
  `sealPartitionFile` (synchronous), `partitionStatus`, `sealPartition`, `REFUSAL_MESSAGES`.
- **W-3 / PD-7 revision 1:** `wal_checkpoint(TRUNCATE)` is read as `{busy, log, checkpointed}`;
  only `busy === 0 && checkpointed === log` counts. Checked BEFORE the seal row (nothing
  appended on refusal) and AFTER it (seal row committed, no chmod, no hash); 3 x 250 ms
  retries via `Atomics.wait`; reason `checkpoint-busy` -> 409 with the PD-7 sentence + an
  `audit-partition-seal-refused` event. Verified empirically on this host that a second
  connection holding a read snapshot yields `busy: 1` even when its snapshot sits at the WAL
  end, so the second-process reader case is a real reproduction, not a simulation.
- `POST /api/admin/deals/:id/audit/seal`; `auditHook.findControlEvents` / `listPartitions`;
  `scripts/audit-verify.js` compares a sealed partition's file hash with the latest
  `audit-partition-sealed` event (audit.db opened read-only).

### Task 2 — export, purge, retention, CLI (`498e4df`)

- Export: header line `{type:'ma-audit-export', version:1, partition, sealedSha256, rowCount,
  headHash, exportedAt}` + one JSON line per row, batches of 500 with a `setImmediate` yield,
  hash of exactly the bytes written, `audit-partition-exported` recorded after the last byte
  (an aborted client records nothing; a failed event after headers-sent destroys the
  connection rather than delivering an un-evented export). `Cache-Control: no-store`,
  attachment, `application/x-ndjson`.
- Purge: `purgeDecision` pure + `purgePartition`; `audit-partition-purged` is recorded BEFORE
  any unlink (proved with a recorder that checks the file still exists at record time);
  refusals record `audit-partition-purge-refused` (+ `audit-partition-tamper-detected` for
  modified-after-seal); unlink failure -> `audit-partition-purge-failed` + generic 500.
- `MA_AUDIT_RETENTION_DAYS`: unset / empty / `never` / any invalid value (warned once) => never;
  positive integer => days from the seal EVENT time. `app.auditClock` test seam is gated on
  `!dbFiles.IS_REAL_MODE` (asserted structurally).
- `scripts/audit-verify.js --jsonl <file>`: standalone chain walk from the header's partition
  genesis; detects an edited, deleted, reordered or truncated line and a wrong row count / head.
- `scripts/audit-admin.js`: `list | status [--json] | seal --confirm | export --out | purge
  --confirm`; exit 0 / 1 (refused, reason printed) / 2 (usage, failure); never overwrites an
  export; export file 0600.

### Task 3 — CLI walkthrough on an isolated real-mode host (this commit)

Fixture: `MA_MODE=real MA_DATA_DIR=<scratch>`, one deal with 4 audited writes through
store + runWithDb, archived via controlStore (scratch script outside the repo). Transcript
(`<W>` = the scratch data dir; deal id shortened to `deal_mv2q…`):

```
$ audit-admin.js status deal_mv2q…
partition      deal_mv2q…   exists yes   rows 4   sealed no (writable=yes)
exports        0   retention never (MA_AUDIT_RETENTION_DAYS unset)
purge          refused: not-sealed
control events: (none)           deal state     archived                        exit=0

$ audit-admin.js seal deal_mv2q… --confirm deal_mv2q…
SEALED deal_mv2q… rows=5 head=2392dd5a…de881a sha256=2bd39c63…d201            exit=0

$ audit-verify.js --deal deal_mv2q…
OK <W>/audit/deal_mv2q….db rows=5 head=2392dd5a…de881a sealed=yes sealed-sha=match   exit=0

$ audit-admin.js export deal_mv2q… --out <W>/../x.jsonl
EXPORTED deal_mv2q… -> x.jsonl rows=5 sha256=e0f010ed…c32e sealedSha256=2bd39c63…d201   exit=0

$ audit-verify.js --jsonl x.jsonl
OK x.jsonl jsonl partition=deal_mv2q… rows=5 head=2392dd5a…de881a sha256=e0f010ed…c32e   exit=0

$ audit-admin.js purge deal_mv2q… --confirm deal_mv2q…
REFUSED retention-never: No retention period is configured, so the audit trail is never purged.   exit=1

$ MA_AUDIT_RETENTION_DAYS=1 audit-admin.js purge deal_mv2q… --confirm deal_mv2q…
REFUSED retention-not-elapsed: The retention period for this audit trail has not elapsed. (eligible 2026-10-11T18:35:53.974Z)   exit=1

$ audit-admin.js status deal_mv2q…
sealed yes   sealed at 2026-10-10T18:35:53.974Z   file == seal yes   exports 1
purge refused: retention-never
control events:
  18:35:53  audit-partition-sealed          by cli:karstenhaldan {"sha256":"2bd39c63…","rows":5,"headHash":"2392dd5a…"}
  18:35:58  audit-partition-exported        by cli:karstenhaldan {"exportSha256":"e0f010ed…","sealedSha256":"2bd39c63…","rows":5,…}
  18:36:01  audit-partition-purge-refused   by cli:karstenhaldan {"reason":"retention-never"}
  18:36:02  audit-partition-purge-refused   by cli:karstenhaldan {"reason":"retention-not-elapsed"}
```

The export event's `exportSha256` equals the `sha256=` printed by `audit-verify --jsonl`;
the sealed file is `-r--------`, the export `-rw-------`. A permitted purge is not run in the
walkthrough (the CLI has no clock seam by design); it is proved by
`test/audit-lifecycle-routes.test.js` (d) and `test/audit-lifecycle.test.js` (m).

**Ergonomics fix found by the walkthrough:** the `-wal`/`-shm` sidecars a read-only opener
leaves beside a sealed file inherit its 0400 mode (SQLite creates sidecars with the main
file's bits). `purgePartitionFile` now clears the mode of each of the three files before
unlinking — harmless on POSIX (unlink needs the directory), required on Windows.

## Verification

- `node --test` full suite on the final tree: **1429 tests, 1429 pass, 0 fail**
  (1407 baseline + 10 lifecycle Task 1 + 5 lifecycle Task 2 + 7 routes).
- Must-pass-unchanged suites green: audit-security-events (e: `/api/admin/audit*` GET-only),
  write-validation-coverage, read-policy-coverage, auth-route-inventory, denial-audit,
  busy-503-contract, no-get-mutates, deal-lifecycle, audit-partitions.
- Refusal matrix proven: not-sealed, modified-after-seal, no-sealed-export, retention-never
  (unset / never / invalid spellings), retention-not-elapsed (29 days) then allowed (31 days).
  A flipped byte fails `audit-verify` (row-hash-mismatch + sealed-sha=MISMATCH, exit 1); an
  edited JSONL line fails `--jsonl` (line=3 row-hash-mismatch); a truncated one fails too.
- `git status --porcelain data/ public/sent_emails/` empty at every commit; no
  STATE.md / ROADMAP.md edits.

## Deviations from Plan

**1. [Rule 2 - Missing critical] Re-seal tamper guard.** The plan's idempotent re-seal would
have recorded a NEW `audit-partition-sealed` event with the modified file's hash if a sealed
file was edited and then "sealed again". `sealPartition` now compares the file with the
existing seal event first and refuses `modified-after-seal` (+ tamper event). Tested
(`lifecycle (f)`).

**2. [Rule 2] Extra refusal reason codes and events.** `no-partition` (seal / export / purge on
a missing file) and `audit-partition-export-refused` for an export refusal — every lifecycle
step stays a control event; the plan listed five purge reasons.

**3. [Rule 1] Status of a corrupt sealed file.** `partitionStatus` reports a read-only file
with a recorded seal that SQLite can no longer read as sealed + hash-mismatched rather than
throwing, so purge/export answer `modified-after-seal` instead of a 500.

**4. Seam names.** The W-3 checkpoint-after-seal-row case is driven through a `checkpoint`
test seam on `sealPartitionFile` (deterministic) in addition to the real second-process
reader case, which exercises the pre-check refusal.

**5. CLI reads the deal registry read-only** (`SELECT data FROM deals` on control.db opened
read-only) instead of requiring `controlStore`, so the CLI never migrates or creates
control.db while a server may be running.

## Open items (recorded, not claimed)

- Read-only open of a sealed 0400 WAL partition (viewer, verify, export) is proven on macOS
  (this host) only; the ubuntu/windows proof is the CI workflow's first run.
- `audit-verify` prints `sealed-sha=no-event` (exit 0, chain intact) for a sealed file with no
  recorded seal event — the PD-7 crash window; a repeated seal repairs it. A stricter
  exit code is a policy call for 12-13 / TE legal.
- DEPLOYMENT.md handling of export files and the retention variable is 12-13's deliverable.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register (T-12-110..117 each have a named test above). New surface:
one export route streaming the MNPI trail (admin-only, sealed-only, no-store, event-hashed)
and one host CLI.

## Self-Check: PASSED

- db/auditLifecycle.js, scripts/audit-admin.js, test/audit-lifecycle.test.js,
  test/audit-lifecycle-routes.test.js: present.
- Commits `031351b`, `498e4df` exist on the worktree branch; the Task 3 commit follows this file.
