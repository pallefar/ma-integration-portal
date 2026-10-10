---
phase: 12-data-layer-integrity-performance
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, audit, write-amplification, optimistic-locking, perf]

requires:
  - phase: 08-concurrency-storage-foundation
    provides: "audit append as the final step inside the deal `.immediate` transaction (CR-01); multi-process WAL model; npm run soak"
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "per-record version WHERE clause, conflict disambiguation, CR-01 conflict-body filtering (conflictVisibleRecord)"
  - phase: 11-authorization-clean-room-closure
    provides: "11-03 store backstop (CLEARANCE_SCOPED / PROVENANCE_SCOPED) — untouched"
provides:
  - "dirty-row writeDb(): a write and its audit trail proportional to what changed (one change -> one audit row; reorder -> seq only, 0 rows)"
  - "per-connection prepared-statement cache (WeakMap conn -> sql -> Statement) used by readDb and writeDb"
  - "auditHook.countAudit({ dealId, rowId, collection, action }) — the count API 12-08 re-implements across partitions"
  - "scripts/perf/lib/volume-deal.js seedVolumeDeal() — the 1k/5k/200 review-profile seeder"
  - "scripts/perf/write-latency.js — median/p95/max write latency + audit rows per change at volume (--assert gates the budget)"
affects: [12-05, 12-08, 12-09, 12-14, soak, DEPLOYMENT.md]

actuals:
  tokens: 18400
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "post-commit snapshot refresh: baseline (__snapshot/__seq) mutated only after the .immediate transaction returns"
    - "non-enumerable __seq sibling of __snapshot — id -> stored seq, never inside the id -> raw map"
    - "untouched = string-equal to prior raw, else canonical re-serialization equal (parse only on the changed branch)"

key-files:
  created:
    - scripts/perf/lib/volume-deal.js
    - scripts/perf/write-latency.js
    - test/writedb-dirty-rows.test.js
    - test/audit-volume.test.js
  modified:
    - db/store.js
    - db/auditHook.js

key-decisions:
  - "An untouched row is also recognised when its serialized form equals the canonical re-serialization of its prior raw (not just string-equal) — a non-canonical stored form (key order / whitespace from another serializer) must not be mistaken for a change and version-bumped + audited on every write"
  - "Singleton (app_state) upserts left as-is: they carry no audit rows and are out of scope for D-12-01 / D-06; 14 ms median already beats the 40 ms budget"
  - "countAudit lands in Task 2 (as the plan's file list says); Task 1's suite counts through queryAudit with a fresh deal per test"

patterns-established:
  - "Audit counting in tests goes through auditHook.countAudit/queryAudit only — never raw SQL on audit.db"
  - "Perf scripts: MA_* temp dir first, resolved-path self-check, >=1 GB free precondition, cleanup in finally + SIGINT/SIGTERM"

requirements-completed: [DATA-01, DATA-06]

duration: 15min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 02: Dirty-row writeDb Summary

**writeDb() now UPDATEs and audits only rows whose serialized form changed, persists reorders with a seq-only UPDATE, and refreshes the caller's baseline only after commit — one create at 1k-task/5k-RAID volume appends 1 audit row (was 6,2xx) in ~14 ms (was ~72-74 ms), with every Phase 8/9/11 contract suite passing unedited.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-10-10T17:17:00Z
- **Completed:** 2026-10-10T17:32:00Z
- **Tasks:** 3 (1 tracer, 1 tdd, 1 auto)
- **Files modified:** 6 (2 modified, 4 created)

## Measured numbers

All on this host, isolated MA_* temp trio, deal seeded to 1,000 tasks / 5,000 RAID / 200 positions in the lanes
the deal's own settings select (`scripts/perf/write-latency.js`, hrbp member, sequential creates).

| Measure | PRD / R5-01 baseline | Base code, same host (n=7) | After this plan (n=21) |
|---|---|---|---|
| POST /api/raid median | 85.7 ms | 74.2 ms (p95 80.0) | **13.7 ms** (p95 17.9, max 23.9) |
| POST /api/integration-tasks median | 96.6 ms | 71.6 ms (p95 79.7) | **14.0 ms** (p95 16.4, max 17.4) |
| Audit rows per create (RAID) | ~6,220 | 6,207 | **1.0** |
| Audit rows per create (task) | ~6,223 | 6,217 | **1.0** |
| Audit rows per reorder (reverse first 10 RAID) | n/a | 6,220 (65.0 ms) | **0** (14.7 ms, order persisted) |
| audit.db after 48 creates + 1 reorder | 37.8 MB after 6 writes | 137,758 KB after 20 creates + 1 reorder | **1,050 KB** |

The <= 40 ms budget is asserted in 12-14 (`--assert` exists now). A second post-change run (the signal-handler
check) printed a 15.8 ms task median under sibling-executor load — same order of magnitude.

HTTP proof (test/audit-volume.test.js, run against the base store.js to confirm it discriminates): create RAID
6,201 !== 1, create task 6,202 !== 1, update 6,202 !== 1, no-op write 6,202 !== 0 — all pass at 1 / 1 / 1 / 0.

### Soak

`SOAK_DURATION_MS=20000 SOAK_WRITE_INTERVAL_MS=250 npm run soak` — PASS (934 acked, 0 lost, audit 1:1).

Default `npm run soak` (3 processes, 120 s) — **PASS**, exit 0:

```
soak: load phase complete — acknowledged=8155 refused=0 unexpected=0 | conflict-lane: acknowledged=772 conflict409=1627 refused503=0
  [PASS] no unexpected outcomes: none
  [PASS] every acknowledged write present in the final database and exact: acknowledged=8155 missing=0 mismatched=0
  [PASS] no cleanly-refused write left anything committed: refused=0 committedButUnaudited=0 committedAndAudited=0
  [PASS] PRAGMA integrity_check ok on every touched file: deal=ok, control=ok, audit=ok
  [PASS] audit trail matches acknowledged writes one-to-one: acknowledged=8155 auditRows=8155 missingFromAudit=0 duplicateInAudit=0 extraInAudit=0
  [PASS] conflict-probe version reconciles exactly: initialVersion=1 conflictAcknowledged=772 expectedFinalVersion=773 actualFinalVersion=773
  [PASS] 409 outcome reconciles with the audit trail by membership: auditUpdateRows=773 missingFromAuditTrail=0 leakedConflictedIntoAudit=0
soak: PASS — acknowledged-write invariant held under sustained real load.
```

**Audit file size at default soak: ~9.5 MB** (sampled db+wal near the end of the 120 s run; 8,155 audit rows, one per
acknowledged write). Carry-in row 18 (11-08 F-5) recorded the same default soak writing 6.78 M rows / 5.5 GB in 90 s.
That carry-in is resolved by this plan; `SOAK_WRITE_INTERVAL_MS=250` is no longer needed for disk safety.

## Accomplishments

- `db/store.js writeDb()` rewritten per D-12-01: unchanged rows get no data UPDATE and no audit delta; a moved row
  gets `UPDATE <c> SET seq = ? WHERE id = ?` (0 rows if a concurrent writer deleted it — CR-02, no resurrection);
  changed non-versioned rows UPDATE and audit only when the statement changed a row; changed versioned rows go
  through the Phase 9 version WHERE / conflict path with that code unmoved; deletes audit only when a row was deleted.
- The untouched-versioned-row re-UPDATE + delta branch (R5-01/R1-07) and the "UPDATE unconditionally ... deliberate,
  not a missed optimization" paragraph are gone; the doc comment and file header describe the new per-item rule and
  why seq-only preserves CR-01/CR-02. The audit append is still the FINAL step inside the same `.immediate`
  transaction, and the `[security]` CR-01 comment block is retained verbatim.
- Snapshot baseline refresh generalised from FA-4: inserts, changed rows, re-seq'd rows and deleted ids are applied to
  `__snapshot`/`__seq` only after commit, so a rolled-back write never mutates the caller's baseline and a second
  `writeDb()` on one `readDb()` object writes and audits only new changes (and no longer re-INSERTs).
- Per-connection prepared-statement cache + lazy per-collection prepare: a collection with no delta prepares nothing.
- `readDb()` selects `id, seq, data` and stamps a non-enumerable `__seq` (id -> stored seq) beside `__snapshot`,
  whose id -> raw shape is unchanged.
- `countAudit`, `seedVolumeDeal`, `write-latency.js` (with disk precondition, path self-check and signal-safe cleanup;
  SIGTERM mid-run verified: exit 143, scratch removed).

## Task Commits

1. **Task 1 (tracer): dirty-row writeDb** - `b7d0755` (feat) — also adds test/writedb-dirty-rows.test.js (17 tests)
2. **Task 2: volume seeder + HTTP proof + countAudit** - `701021b` (test)
3. **Task 3: write-latency script (+ soak runs)** - `65b7d59` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

Tracer gate (autonomous policy for this dispatch): re-ran the tracer's `<verify>` end-to-end — the named Phase 8/9
suites plus the full `node --test` — green before any expansion task. test/writedb-dirty-rows.test.js was also run
against the base `store.js` to confirm it discriminates: 16 of 17 fail there (the 17th, rollback-leaves-baseline,
passes on base because base never refreshed on insert).

## Files Created/Modified

- `db/store.js` - dirty-row writeDb(), `__seq` bookkeeping in readDb(), statement cache, post-commit refresh
- `db/auditHook.js` - `countAudit()` (parameterised COUNT; nothing else changed)
- `scripts/perf/lib/volume-deal.js` - review-profile seeder, applies server.js's taskLane/raidLane rule
- `scripts/perf/write-latency.js` - latency + amplification measurement, `--assert`, `--n=`
- `test/writedb-dirty-rows.test.js` - store-level proofs for a versioned and a non-versioned collection
- `test/audit-volume.test.js` - HTTP proof at full volume

## Decisions Made

- **Canonical-form untouched check (small extension of the plan).** The plan compares `serialized === priorRaw`.
  A stored raw in a non-canonical form (an object with integer-like keys reordered by JSON round-trip, or text
  written by another serializer) would then read as "changed" on every write and be version-bumped and audited
  forever. The prior raw is parsed anyway on the changed branch (needed for the stored version), so
  `JSON.stringify(JSON.parse(priorRaw)) === candidate` is free and treats that row as untouched. The common path
  (string-equal) still never parses — checker I-3.
- **No post-commit refresh when an UPDATE changed 0 rows** (concurrently deleted non-versioned row): nothing was
  written or audited, the row stays in the baseline, and a retry on the same object is again a harmless no-op.
- **Singletons untouched.** `settings`/`i18n`/`menus` etc. are still upserted unconditionally on every write. They
  produce no audit rows and D-06 scoped them out of optimistic locking; at 14 ms median the latency budget is met
  with margin. Noted for 12-05/12-09 if the read/write split makes them worth gating.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test deal id rejected by dealDbPath()**
- **Found during:** Task 2 (test/audit-volume.test.js first run)
- **Issue:** `deal_audit_volume` fails `DEAL_ID_RE = /^deal_[a-z0-9]+$/i` (no underscore after the prefix)
- **Fix:** id renamed `deal_auditvolume`
- **Files modified:** test/audit-volume.test.js
- **Committed in:** 701021b (never committed in the broken form)

---

**Total deviations:** 1 auto-fixed (1 bug in my own test fixture). **Impact on plan:** none.

The one plan-adjacent addition (canonical-form untouched check) is recorded under Decisions Made, not as a
deviation — it narrows when a row counts as changed and cannot make a changed row look untouched.

## Issues Encountered

- Shared scratchpad, shared disk (19 GB free, 96 %): kept scratch bounded — the "before" measurement used `--n=7`
  (still ~138 MB of audit rows), and every scratch directory was removed; `git status --porcelain data/
  public/sent_emails/` is empty.
- No known-flake (`audit-security-events`) occurrence in the three full-suite runs.

## Verification

| Check | Result |
|---|---|
| `node --test test/writedb-dirty-rows.test.js` | 17/17 |
| writedb-merge, concurrent-write, concurrency-busy-retry, optimistic-locking-contract / -cross-process / -precondition, audit-log, audit-security-events, clearance-write-paths | pass, **zero edits** (`git diff --stat 88cab66 HEAD -- test/` shows only the two new files) |
| Structural rules (every `json_extract` line carries a bound `?`; lane-helper bodies; no-get-mutates) | pass unedited |
| Full suite | 1262 at base -> **1284/1284** (+17 writedb-dirty-rows, +5 audit-volume), 0 failures |
| `npm run soak` (default) | PASS, exit 0 (verdict lines above) |
| `grep -cE "process\.(once\|on)\(.SIG(INT\|TERM)" scripts/perf/write-latency.js` | 2 |
| `git status --porcelain -- data` / `public/sent_emails` | empty |

## Known Stubs

None.

## Threat Flags

None. No new network endpoint, auth path, file-access pattern or trust-boundary schema change; the plan's T-12-10..16
mitigations are all in place (audit delta for every INSERT / changed UPDATE / DELETE that changed a row and still the
final in-transaction step; untouched rows never UPDATEd; seq-only by id; versioned branch and conflictVisibleRecord
unchanged; post-commit refresh; MA_* path self-check; >= 1 GB precondition + signal-safe cleanup).

## Next Phase Readiness

- 12-08 (audit partitions): `countAudit`/`queryAudit` are the only counting paths the new suites use — re-implement
  them across partitions and both suites pass without edits.
- 12-14: `node scripts/perf/write-latency.js --assert` is the budget gate (<= 40 ms median, 1.0 rows/create, 0/reorder).
- 12-05/12-09: GET handlers still use full `readDb()`; write handlers likewise — the p95 read budget is theirs.
- For the orchestrator: 11-CARRY-INS.md row 18 is resolved by this plan (not edited here — outside this plan's file list).

---
*Phase: 12-data-layer-integrity-performance*
*Completed: 2026-10-10*

## Self-Check: PASSED

- Created files exist: scripts/perf/lib/volume-deal.js, scripts/perf/write-latency.js, test/writedb-dirty-rows.test.js, test/audit-volume.test.js
- Commits exist: b7d0755, 701021b, 65b7d59
- Final full-suite run after the last code commit (65b7d59): `# tests 1284 / # pass 1284 / # fail 0` (exit 0)
