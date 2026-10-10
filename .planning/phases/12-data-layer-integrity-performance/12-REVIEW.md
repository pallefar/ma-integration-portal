---
phase: 12-data-layer-integrity-performance
reviewed: 2026-10-10T00:00:00Z
depth: deep
scope: PART A — data/audit core (plans 12-02, 12-06, 12-08, 12-12, 12-13)
range: 63bb2af..e76c29c
model: Claude Fable 5.1 (second-opinion reviewer, different model than the executors)
suite_baseline: 1445 (per e76c29c)
files_reviewed: 20
files_reviewed_list:
  - db/store.js
  - db/auditHook.js
  - db/auditChain.js
  - db/auditLifecycle.js
  - db/audit-partition-schema.sql
  - db/audit-schema.sql
  - db/migrate.js
  - db/readiness.js
  - db/dbFiles.js
  - db/migrations/audit/001-partition-legacy.js
  - db/migrations/audit-partition/001-baseline.js
  - db/migrations/control/001-baseline.js
  - db/migrations/deal/001-baseline.js
  - db/migrations/runtime/001-baseline.js
  - scripts/audit-verify.js
  - scripts/audit-admin.js
  - server.js (boot region 80-105/1615-1708, lifecycle routes 2282-2426, error middleware 9162-9254)
  - test/audit-chain-multiprocess.test.js
  - test/writedb-dirty-rows.test.js (211-267)
  - test/audit-partitions.test.js (166-198), test/audit-legacy-migration.test.js (236-246)
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 12 (Part A — Data/Audit Core): Code Review Report

**Reviewed:** 2026-10-10 · **Depth:** deep (code trace + two live probes on an isolated `mkdtemp` instance; no committed `data/*.db` touched, `git status data/` clean after) · **Range:** `63bb2af..e76c29c` · **Suite baseline:** 1445

Severity mapping used below: CRITICAL/HIGH → `CR-` (must fix before this ships), MEDIUM → `WR-`, LOW → `IN-`. Each finding is marked VERIFIED (reproduced) or PLAUSIBLE (code trace).

## Executive verdict

The core mechanics are sound and better than the plans promise in several places: the dirty-row merge cannot clobber an untouched row, the audit append is genuinely the last statement inside the deal's `BEGIN IMMEDIATE`, lock order is acyclic (deal→partition, control→audit.db, migration audit.db→partition, seal/purge sequential), the committed `demo.db`/`control.db` are provably not written at boot (probe B), and the purge gate is fail-closed with retention defaulting to never and no timer.

One HIGH control-integrity bug is verified: because `DEAL_ID_RE` is case-insensitive and the host filesystem is case-insensitive (macOS/APFS and Windows — today's laptop-local deployment), an admin can seal, export and purge an **active** deal's audit partition by spelling its id in a different case. The `deal-active` guard, the event attribution and the "there is no unseal" guarantee are all bypassed, and the active deal's every subsequent write fails with the fixed 409 "This deal is closed". Three MEDIUMs follow: a durability gap in the "succeed or fail together" invariant under power loss (`synchronous=NORMAL`), a fail-open deal classification in migration #1 that irreversibly seals live deals' history into `legacy.db`, and an unaudited partial export path.

---

## CRITICAL / HIGH

### CR-01 — Case-variant partition id seals/exports/purges an ACTIVE deal's trail (HIGH, VERIFIED)

**Files:** `db/dbFiles.js:139` (`DEAL_ID_RE = /^deal_[a-z0-9]+$/i`), `db/dbFiles.js:147-152` (`auditPartitionPath`), `server.js:2298-2303` (`auditPartitionIdOf`), `server.js:2309-2313` (`dealState` via `controlStore.getDeal(id)`), `db/auditLifecycle.js:623` (`deal-active` guard), `db/auditHook.js:142-152`.

**Scenario:** `newId('deal')` mints lowercase ids and SQLite `WHERE id = ?` is case-sensitive, but `DEAL_ID_RE` carries `/i` and `path.join(AUDIT_DIR, id + '.db')` on a case-insensitive filesystem resolves `dEaL_Mv2…` and `deal_mv2…` to the **same file**. For the variant id the route's `dealState()` finds no registry row → `'absent'` → the `deal-active` refusal is skipped, `fs.existsSync(file)` is true, `sealPartitionFile` appends a `partition-seal` row to the active deal's partition and chmods it `0400`. All lifecycle events (`audit-partition-sealed`, later `-exported`, `-purged`) are filed under the variant `deal_id`, so the real deal's status shows `sealed: true, sealedSha256: null, fileMatchesSeal: null`, and `verify --all` reports `sealed-sha=no-event`. With `MA_AUDIT_RETENTION_DAYS` set, the same variant can export and then **purge** the active deal's trail without the deal ever being archived.

**Repro (probe A, isolated temp instance, this macOS host):**
```
deal deal_mv2rjdhc0066a362 status active
variant id dEaL_Mv2rJdHc0066A362 passes DEAL_ID_RE true same file on this FS true
route dealState for variant = absent (real id = active)
seal outcome sealed  → real partition mode now 400
active deal write after variant seal -> AuditPartitionSealedError
status(real id): sealed true sealedSha256 null fileMatchesSeal null
```
Also confirmed the repo's own `data/` directory is case-insensitive (`data/.CaseProbe_x` ≡ `data/.caseprobe_x`).

**Impact:** an admin (or anyone holding an admin session) can (a) deny-of-service every write to an active deal with a 409 that tells the team the deal is closed, (b) seal/export/purge MNPI history while the deal is live, (c) split the attribution so the real id has a sealed file with no seal event — the T-12-110 "never launder a modified file" logic then has nothing to compare against. This is the exact class D-12-04/T-12-111 ("only a closed deal's trail is sealed; explicit, confirmed admin action") exists to prevent.

**Fix direction:** make the partition/deal id canonical and case-sensitive at every entry: drop `/i` from `DEAL_ID_RE` (minted ids are lowercase; add a one-line test that `newId('deal')` output matches the strict regex), or lowercase-and-compare in `auditPartitionIdOf`/`auditPartitionPath` and refuse any id that is not byte-identical to a registry row when a file exists for it. Independently, `sealPartition` should resolve the deal through the registry **by file identity** (realpath of the partition) rather than by the caller's spelling, and `lifecycleStatus` should flag "sealed file, no seal event" as a tamper signal rather than `null`. Note `dealDbPath` shares the regex; the resolver only binds registry ids so it is not exploitable there today, but the strict regex closes it for free.

**Contract violated:** D-12-04 (seal only a closed deal; no unseal; purge only after sealed export + retention), PD-7, T-12-111, 12-12 refusal matrix (`deal-active` first).

---

## MEDIUM

### WR-01 — "Deal write and audit row succeed or fail together" does not survive power loss with `synchronous=NORMAL` (PLAUSIBLE)

**Files:** `db/dbFiles.js:487` (`synchronous = NORMAL` for every family incl. audit/partition), `db/store.js:815-838` and `db/auditHook.js:241-251` (invariant text), `12-08-SUMMARY.md` point 5 ("never a committed-but-unaudited one").

**Scenario:** the partition append commits (its WAL frames are in the page cache, not fsynced — NORMAL in WAL mode fsyncs only at checkpoint), then the deal file commits. On OS crash/power loss the kernel flushes dirty pages in arbitrary order: the deal's WAL frames can reach disk while the partition's do not. Result after restart: a committed MNPI row with **no audit row** — the direction Phase 8 CR-01 closed for process crashes and that the code comments now describe as impossible. Process crashes are handled correctly (ordering); only media-level durability is at issue, and the soak's 1:1 reconciliation cannot observe a power loss.

**Fix direction:** open the `audit` and `audit-partition` families with `PRAGMA synchronous = FULL` (append-only, one fsync per audited write — cheap on SSD; `openDbFile` already branches on `family`), so the audit commit is durable before the deal's commit begins. Alternatively document the residual honestly in 12-08-SUMMARY/DEPLOYMENT and accept it. **Contract:** 08-SECURITY/08-CONTEXT "a 503 means nothing persisted; the audit row and the write land together", D-12-04 PD-1.

### WR-02 — Migration #1 fails OPEN on deal classification: an unreadable/absent `control.db` seals every deal's history into `legacy.db` forever (PLAUSIBLE; the absent case is tested as intended)

**Files:** `db/migrations/audit/001-partition-legacy.js:117-137` (`loadExistingDealIds`: `if (!fs.existsSync(file)) return ids;` and `catch (e) { return ids; }` on the read-only open), `:214-223` (rows of "non-existing" deals → `importPartition('legacy')` → `sealPartitionFile('legacy')` 0400), `test/audit-legacy-migration.test.js:236-246`.

**Scenario:** any failure to read the registry (control.db locked by another process at boot, a transient `SQLITE_BUSY` on the read-only open, a mis-set `MA_CONTROL_DB_PATH` on the upgraded host, or the registry simply not yet present) is indistinguishable from "all deals were deleted". Every live deal's pre-upgrade history is then appended to `legacy.db` and **sealed** (read-only, never written again; "there is no unseal"). The viewer still finds the rows (legacy keeps `deal_id`), but each live deal's own partition starts empty, so its later seal/export/purge — the legal deal-end record — omits its entire pre-upgrade history, and nothing can move the rows back. The accounting assertions cannot catch this because the counts still match.

**Fix direction:** make classification fail closed: if audit.db holds any movable row and the registry cannot be read (missing file, open error, `no such table`), throw → `migration-failed`/not-ready, nothing written. Treat "registry present with a readable `deals` table" as the only authority. Keep the "no control.db" test but invert its expectation. **Contract:** D-12-04 (per-deal partitions), 12-13 PD-22, acceptance 4 (export of the sealed deal state).

### WR-03 — An aborted export of a sealed partition leaves no audit trace (PLAUSIBLE)

**Files:** `server.js:2354-2385` (export route), `db/auditLifecycle.js:497-525` (`exportPartition`: refusal events are recorded, success is recorded after the last byte, **abort records nothing**), no read-audit covers `/api/admin/deals/:id/audit/export` (grep: only org/DD read-audits exist).

**Scenario:** an admin streams 99% of a deal's full MNPI before/after history and drops the connection before `res.end()`; `result.aborted` returns without any `recordEvent`. Repeatable without limit; `lifecycleStatus.events` shows nothing. The design note "an aborted client records nothing" was written for the *hash* (correct — a partial file has no meaningful sha), not for the *attempt*.

**Fix direction:** record `audit-partition-export-started` (actor, ip) inside `onReady` before the first byte, and `audit-partition-export-aborted` with `bytes` on abort; keep `-exported` with the sha after the last byte. **Contract:** D-12-04 / T-12-113 ("every export is a control event"), Phase 7 D-23 lineage ("every export audited").

---

## LOW

### IN-01 — Unauthenticated `/healthz` publishes the number of deal files on the host (PLAUSIBLE)
`server.js:1630` returns `readiness: snap` on the 200 path too; `db/readiness.js:79-89` emits `versions.deal.files` = count of registered deal databases opened at boot (plus `audit-partition.files`). T-12-52 removes paths and ids but a live count of acquisitions on a pre-announcement host is itself sensitive. Fix: return only `{status, ready}` unauthenticated; move `readiness` detail behind the admin gate.

### IN-02 — `audit-chain-multiprocess` cannot fail if the two children never actually overlap (test quality)
`test/audit-chain-multiprocess.test.js:106-140` asserts contiguity and a valid chain but never asserts interleaving (`busyRetries > 0` or alternating `row_id` prefixes). If scheduling serialises the children, the fork-the-chain regression it exists to catch is not exercised. Fix: assert at least one busy retry or that both labels appear in the first N rows; or hold a shared barrier so both children start their loops simultaneously.

### IN-03 — Canonical-form collision for a non-numeric `legacy_id` (PLAUSIBLE, unreachable today)
`db/auditChain.js:73-75` `legacyOrNull` → `Number(v)` → `NaN` → `JSON.stringify` emits `null`, so a stored `legacy_id` of `'abc'` hashes identically to `NULL` (two different rows, one hash). Only reachable if a raw INSERT puts text into the INTEGER column; today every `legacy_id` is a source `id`. Fix: hash the stored value as text (`textOrNull`) or reject non-integers in `appendChained`.

---

## Checked and sound

- **Dirty-row merge (12-02):** untouched detection is string-equal OR `JSON.stringify(JSON.parse(priorRaw)) === candidate` (key-order/whitespace safe); seq-only `UPDATE … WHERE id` for pure moves (0 rows if concurrently deleted — no resurrection); non-versioned changed rows UPDATE by id, audited only on `changes > 0`; versioned rows keep the Phase 9 WHERE exactly; delete pass is scoped to this request's own snapshot; baseline refresh only after COMMIT. Test at `writedb-dirty-rows.test.js:211-247` genuinely proves another connection's committed change to an untouched row survives. `conflictVisibleRecord` (09 CR-01 clearance filter) is unchanged on both conflict throws. `readCollections` throws on get/set of unloaded keys, `writeDb` refuses a payload carrying an unloaded collection, unchanged singletons are not re-upserted (stale-copy write closed).
- **Atomicity/locks (12-08):** partition append is the last statement inside the deal's `.immediate` body on a different connection; `getAuditConnection()` is pre-opened outside the deal lock (PD-29) and `getPartitionConnection` throws rather than first-opening audit.db; lock order deal→partition, control→audit.db, migration audit.db→partition (boot only), seal/purge sequential — no cycle; sealed check (`last.action === 'partition-seal'`) and head read both happen under `BEGIN IMMEDIATE`. Retry safety for busy/sealed/I/O-before-commit holds (`audit-partitions.test.js:166-198`). The documented residual (deal COMMIT fails after partition commit) is correctly stated for process-level failures — see WR-01 for the media-level caveat.
- **Hash chain:** canonical JSON array of strings/nulls is unambiguous (apart from IN-03); genesis bound to the partition id and derived from the filename in the verifier; PD-30 head rule and `unchained-row` reporting correct; tail truncation of an unsealed partition and re-hashed edits by a data-dir writer are acknowledged residuals in DEPLOYMENT.md §2.
- **Seal/export/verify/purge (12-12):** idempotent seal with crash repair; `checkpoint-busy` refused without chmod/hash; T-12-110 re-seal laundering refused on both read-only and hand-chmodded paths; export only of a sealed, hash-matching file, event after the last byte, `res.destroy()` on mid-stream failure; purge refusal order correct, retention default never (typo → never, warned once), event recorded BEFORE unlink, structural test proves no timer; `chmodPrivateFile` is tightening-only so a 0400 seal survives a later open; `openDbFileReadOnly` for every viewer/verifier path (no GET writes); partition ids validated before any `path.join` (no traversal); CLI actor `cli:<os-user>` cannot collide with an account.
- **Migrations/readiness (12-06/12-13):** forward-only, contiguous ids validated at load, version re-read under the write lock, 3×size+64 MB free-space precondition enforced before `VACUUM INTO`, sticky not-ready per path, fixed `retryable:false` 503 body, `/healthz` never carries a path or deal id. **VERIFIED (probe B, on copies):** committed `demo.db`/`control.db` → `quick_check ok`, `{version:1, implied:true, committed:true}`, `user_version` stays 0, 0 WAL bytes, SHA-256 unchanged; both files already carry the WAL header so the `journal_mode` pragma does not write. Migration #1 rerun idempotency via `MAX(legacy_id)` watermark + distinct-count assertion is correct; sealed legacy is only ever probed read-only (W-4); atomic rename-aside/rebuild keeps triggers present at every visible instant; `MA_MIGRATIONS_DIR` refused under `MA_MODE=real`.
- **Routes:** admin-only under `/api/admin` prefix with case-sensitive routing + `pathForms()`; `audit-lifecycle-routes.test.js:150-171` covers 401/403 for hrbp/pmo/employee/anonymous; `confirm === id` on seal/purge; Express 4 guarantees `req.body` is `{}` without a JSON body.

## Not covered

- Part B plans (12-01/03/04/05/07/09/10/11/14/15), the admin audit viewer UI, `public/js/*`.
- Windows behaviour (read-only attribute, unlink-while-open) — code trace only.
- Live ENOSPC / `SQLITE_FULL` during a partition append, and the 80 MB–5 GB migration — not run (disk nearly full, as instructed); relied on 12-13's synthetic rehearsal numbers.
- Two-process deadlock/livelock under sustained contention — relied on the existing two-process tests and the soak's check 10; no soak was run in this review.
- `--jsonl` verifier beyond reading; `scripts/perf/*`.

---

_Reviewed: 2026-10-10 · Reviewer: Claude Fable 5.1 (gsd-code-reviewer, adversarial second opinion) · Depth: deep_
