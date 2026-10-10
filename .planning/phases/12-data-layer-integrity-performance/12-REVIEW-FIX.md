---
phase: 12-data-layer-integrity-performance
fixed_at: 2026-10-10T22:45:00Z
review_path:
  - .planning/phases/12-data-layer-integrity-performance/12-REVIEW.md
  - .planning/phases/12-data-layer-integrity-performance/12-REVIEW-B.md
base: bf8d710
iteration: 1
findings_in_scope: 16
fixed: 15
accepted: 1
deferred: 0
skipped: 0
status: all_fixed
suite_before: 1445
suite_after: 1458
---

# Phase 12: Code Review Fix Report

**Fixed at:** 2026-10-10 · **Source reviews:** `12-REVIEW.md` (Part A: CR-01, WR-01..03, IN-01..03) and `12-REVIEW-B.md` (Part B: WR-B01..03, IN-B01..06) · **Base:** `bf8d710` · **Policy:** fix everything; leave a finding only with a written reason and a named target phase.

**Summary:** 16 findings in scope (all severities). 15 fixed, each with a regression test. 1 accepted as documented (IN-B06, fail-closed by design). Nothing deferred, nothing skipped. The stale `db/migrate.js` header named in the brief is fixed too.

**Where verification ran:** everything ran in this agent's isolated harness worktree (`.claude/worktrees/agent-a5622be1520f9da32`), which carries its own committed `node_modules`. It used `MA_*` temp paths only. `git status --porcelain data/ public/sent_emails/` was empty at every commit.

## Finding → resolution

| Finding | Sev | Resolution | Commit(s) | Regression test |
|---|---|---|---|---|
| CR-01 case-variant id seals/exports/purges an ACTIVE deal's trail | HIGH | **fixed** | `2a19082` | `audit-lifecycle-routes` (h). Mutation-checked: fails without the fix. |
| WR-01 audit can lag the deal write after power loss (`synchronous=NORMAL`) | MED | **fixed** (budget held) | `15d989d`, `d933041` | `audit-partitions` (k); `db-file-layout` updated |
| WR-02 migration #1 fails open on an unreadable registry | MED | **fixed** | `739a648` | `audit-legacy-migration` WR-02 ×2. Mutation-checked. |
| WR-03 aborted export leaves no trace | MED | **fixed** | `145f5c1` | `audit-lifecycle` (p) |
| IN-01 `/healthz` publishes the deal-file count | LOW | **fixed** | `da61b1a`, `a197b79` | new `test/readiness-snapshot.test.js`; `schema-migrations` updated |
| IN-02 multiprocess chain test cannot detect zero overlap | LOW | **fixed** | `5a36aee` | the test itself (barrier + interleave assertion) |
| IN-03 non-numeric `legacy_id` hashes as `null` | LOW | **fixed** | `8e55a0a` | `audit-partitions` (l), including the forged-collision row |
| WR-B01 dot-segment HTML paths bypass the stamper | MED | **fixed** | `c2d8f2a` | `asset-cache-bust` WR-B01 (raw socket). Mutation-checked: `/x/../index.html -> 200` without the fix. |
| WR-B02 `npm run perf` can print PERF PASS with a broken 429 guard | MED | **fixed** | `713cbd9` | `perf-harness-guards` WR-B02 |
| WR-B03 second `run()` on a held lease orphans job 1 | MED | **fixed** | `080314d` | `cpu-isolation` WR-B03 |
| IN-B01 worker crashes on a non-cloneable/undefined result | LOW | **fixed** | `85da5c6` | `cpu-isolation` IN-B01 (`spawnCount` stays 1) |
| IN-B02 isolation guard misses a case-variant `data/` spelling | LOW | **fixed** | `0206359` | `test-isolation-guard` IN-B02 |
| IN-B03 `rewriteAsset` corrupts non-UTF-8 bytes | LOW | **fixed** | `437d5bb` | `asset-cache-bust` IN-B03 |
| IN-B04 two read-only opens bypass the `openDbFile` choke point | LOW | **fixed** | `5bbf5bf` | `deal-seed` IN-B04 |
| IN-B05 `scripts/perf/` ships in release zips | LOW | **fixed** | `af1c428` | `smoke-harness` release-exclusion test, strengthened |
| IN-B06 malformed `clearanceArea` hidden from everyone | LOW | **accepted**: fail-closed is the safe direction and the value can only appear by editing the deal file directly. Documented. | `1cde6c9` | n/a (behaviour already proven by the existing suite) |
| (brief) stale `db/migrate.js` header | — | **fixed** | `d142472` | n/a (comment only) |

## Fixed issues

### CR-01: case-variant partition id seals an active deal's trail
**Files:** `db/dbFiles.js`, `server.js`, `scripts/audit-admin.js`, `scripts/audit-verify.js`, `db/auditHook.js`, `db/controlStore.js` (comment), `test/audit-lifecycle-routes.test.js`

- `DEAL_ID_RE` is now case-sensitive. So are the partition-file regexes in `auditHook.js` and `audit-verify.js`.
- New `dbFiles.resolveAuditPartitionId(raw, isRegistered)` resolves an id by **file identity**. An id is valid only if it either:
  - exactly equals a registered deal id (exact-match registry lookup), or
  - exactly equals a partition basename in an exact-case `readdir` listing (`auditPartitionListed`). It never relies on `existsSync`/`stat`.
- Every other spelling of a deal id or `legacy` gets the uniform `404 {error:'Not found'}`. That happens before any read, write or event. A string that isn't id-shaped at all still gets 400.
- The routes, `audit-admin.js` and `audit-verify.js --deal` all use the same rule.

**Changed existing test:** `routes (b)` expected an unknown well-formed id to return `200 {exists:false}`; it now expects 404, as the decision requires. The test also gained an assertion that a registered deal with no partition file still returns `200 exists:false`.

**Not done:** the review's optional extra ("flag 'sealed file, no seal event' as tamper in `lifecycleStatus`") was left out. The file-identity rule removes the only way to reach that state.

### WR-01: audit durability after power loss
**Files:** `db/dbFiles.js`, `DEPLOYMENT.md`, tests

- `audit` and `audit-partition` connections now open with `synchronous = FULL`, plus `fullfsync = ON`. On macOS a plain `fsync` does not flush the drive cache; elsewhere `fullfsync` does nothing.
- Deal, control and runtime files keep `NORMAL`.
- `DEPLOYMENT.md` §Audit trail now has a "Durability" note with the measured cost.

**Changed existing test:** the Phase-1 contract test in `db-file-layout` asserted `NORMAL` for every kind. It now expects `FULL` for audit (`d933041`).

**Budget:** within. Re-measured with `scripts/perf/write-latency.js` (5,000 RAID / 1,000 tasks / 200 positions):

| Run | `POST /api/raid` median | `POST /api/integration-tasks` median | Budget |
|---|---|---|---|
| before (NORMAL), n=21 | 18.3 ms | 3.1 ms | ≤ 40 ms |
| FULL, n=21 | 19.9 ms | 3.8 ms | ≤ 40 ms |
| FULL + fullfsync, n=21 | 21.7 ms | 9.2 ms | ≤ 40 ms |
| **final tree, `--assert --n=41`** (host load ≈ 55) | **27.6 ms** (p95 39.4) | **8.9 ms** (p95 14.1) | ≤ 40 ms → **PASS** |

One extra run happened while the full suite was running at the same time: RAID median 38.9 ms. That is still inside budget but is contention, not representative. The "stop and keep NORMAL" branch was not needed.

### WR-02: migration #1 fails open
**Files:** `db/migrations/audit/001-partition-legacy.js`, `db/migrate.js`, `db/readiness.js`, `db/dbFiles.js`, `test/audit-legacy-migration.test.js`

- `loadExistingDealIds()` now returns `null` when the registry can't be read: the file is missing, it was created by this boot (the boot opens `control.db` before `audit.db`, which is exactly what a mis-set `MA_CONTROL_DB_PATH` looks like), it fails to open, or its `deals` table can't be queried.
- If movable rows exist in that case, the migration throws `markNotReady` with the new fixed reason `deal-registry-unreadable`.
- A new optional migration `precheck()` hook runs **before** the backup. A refusal therefore writes nothing: no `.pre-v1.bak`, no partition, no `legacy.db`, `audit.db` stays at version 0 with all its rows.
- `dbFiles.createdThisProcess()` records which files `openDbFile` created during this process.

**Changed existing test:** the old fail-open test ("no control.db → everything sealed into legacy") is inverted, as the review asked. A second test was added for an unreadable control.db (not a database file).

Migration #1 is unreleased (v3.0 not cut), so editing it is within authoring rule 2.

### WR-03: export attempts not audited
**Files:** `db/auditLifecycle.js`, `server.js` (comment), `test/audit-lifecycle.test.js`

- `exportPartition` records `audit-partition-export-started` (seal sha, rows) before `onReady` and before the first byte.
- On a client disconnect it records `audit-partition-export-aborted {reason:'client-disconnected', bytes}`. On a thrown write/stream error it records `{reason:'stream-error', bytes}` and then re-throws.
- **Mapping:** the "…-completed" event in the decision is the existing `audit-partition-exported`, still recorded after the last byte. The purge gate already keys on that event. Renaming it would break the Phase-12 purge contract, and adding a second identical "completed" row would only duplicate it.
- Both new actions are listed in `LIFECYCLE_ACTIONS`, so `GET …/audit` status shows them.

### IN-01: `/healthz` file count
**Files:** `db/readiness.js`, `test/readiness-snapshot.test.js`, `test/schema-migrations.test.js`

- `snapshot()` no longer emits `versions.<family>.files`.
- Identical exposed failures collapse to one entry. Otherwise one `{family:'deal',file:'deal',…}` per corrupt deal file would leak the count too.
- `/healthz` keeps its shape and still carries only fixed tokens.

**Changed existing tests:** the two `committed-implied` assertions dropped `files: 1` (`a197b79`).

**Heads-up for the evidence agent:** `data-phase12.js` does not read `files` (grepped), so the change does not affect it.

### IN-02: multiprocess chain test overlap
**File:** `test/audit-chain-multiprocess.test.js`

- Both children print `READY` and block on stdin until the parent releases them together.
- The test then asserts the partition's rowid order switches writer at least twice. If the two writers were serialised it retries on a fresh deal, up to 4 attempts, and fails if they never overlap.
- All original assertions are unchanged (strengthened only).

### IN-03: non-numeric `legacy_id`
**Files:** `db/auditChain.js`, `scripts/audit-verify.js`, `test/audit-partitions.test.js`

- `legacyOrNull()` now throws `AUDIT_INVALID_LEGACY_ID` for anything that isn't a safe integer or null, so an append with such a value is refused and writes nothing.
- `verifyChain` and `--jsonl` verification report `invalid-legacy-id` instead of crashing or passing.
- The test includes a forged row with text `'abc'` carrying the NULL hash. That row verified clean before the fix.

### WR-B01: HTML stamp bypass
**Files:** `server.js`, `test/asset-cache-bust.test.js`

- `htmlRequestVerdict()` makes the HTML middleware terminal for every path that is, or normalises to, `.html`.
- Non-canonical spellings get a `404 text/plain`. That covers dot segments, duplicate slashes, `%2e`/`%2f`/`%5c`, NUL/backslash and undecodable escapes.
- Canonical paths are stamped by `sendHtml()`. They are passed on only when no such file exists (static resolves the identical path and 404s) or for vendored `/vendor/` files, which are never rewritten.
- The raw-socket test covers both verified repros plus 7 more variants.

### WR-B02: perf runner evidence gap
**Files:** `package.json`, `scripts/perf/run-all.js`, `test/perf-harness-guards.test.js`

- `npm run perf` is now `run-all.js --assert`.
- Separately, `run-all.js` fails a script whose output reports a `FAIL:` / `OVER BUDGET` line, a `non-200: N > 0`, or a pack-isolation second request that was not 429. This is `outputFailures()`, exported and unit-tested.
- `run-all.js` now only runs when invoked directly (`require.main` guard), so the test can import it.

### WR-B03: double `run()` on a lease
**File:** `lib/isolatedTask.js` (+ test)

- `run()` rejects with `BusyTaskError` while a job is pending. The first job and its timer are untouched.
- The timeout callback now discards the worker only when its own job is still the pending one.

### IN-B01: worker reply failures
**File:** `lib/workers/serve.js` (+ test)

- The reply is built in `.then()` followed by a single `.catch()` that posts `{id, ok:false, error}`.
- A missing or `undefined` result is an explicit error, and a `DataCloneError` is reported for that job. Neither kills the thread any more.

### IN-B02: case-variant `data/` spelling in the test-isolation guard
**File:** `db/dbFiles.js` (+ test)

- On darwin/win32, every identity is lower-cased before comparison: lexical path, nearest realpath, and the newly added `fs.realpathSync.native`.
- `platform` can be injected, so the test also proves the rule on Linux CI.

### IN-B03: `rewriteAsset` and non-UTF-8 bytes
**File:** `lib/assetStamp.js` (+ test)

- An asset is rewritten only if its UTF-8 decode re-encodes to the same bytes.
- Any other asset is served byte-for-byte with its references left unstamped, and one warning is logged.

### IN-B04: read-only opens outside the choke point
**Files:** `db/dbFiles.js`, `db/dealSeed.js`, `scripts/perf/lib/scratch-deal.js` (+ test)

- New `dbFiles.openReadOnlySnapshot()`: SQLite read-only, `fileMustExist`, test-isolation guard applied, and any `-wal`/`-shm` sidecar the open itself created is removed on `close()`.
- `dealSeed` previously did not clean up those sidecars.
- Both call sites now use the helper. A source assertion checks that neither file still contains a direct `new Database(`.

### IN-B05: perf scripts in release zips
- `scripts/perf/ export-ignore` was added to `.gitattributes`.
- The release-exclusion test now checks the line, `git check-attr`, and that a `git archive` of `scripts/` contains nothing under `scripts/perf`.

## Accepted

### IN-B06: malformed `clearanceArea` is hidden from everyone, admin included
**Reason:** this is the fail-closed direction, and the projection path and the whole-db path already agree on it (the reviewer's own live probe confirmed this). The value can only be produced by writing to the deal file directly, because zod's enum guards the API. Making it visible to admin would trade a diagnosability nuisance for a clearance-model exception.
**Action:** one-line note in `DEPLOYMENT.md` → Known limitations, so an "admin can't see a row" report is diagnosed quickly (`1cde6c9`).
**Target phase:** none needed (accepted, not deferred).

## Changes to existing tests (all deliberate)

| Test | Change | Why |
|---|---|---|
| `audit-lifecycle-routes` (b) | unknown well-formed id: 200 `exists:false` → 404; added a registered-deal-without-partition case (200 `exists:false`) | CR-01 decision ("every other spelling → uniform 404") |
| `audit-legacy-migration` "no control.db" | inverted: was "everything sealed into legacy", now "not-ready, nothing written" | WR-02 (the review explicitly asked to invert it) |
| `db-file-layout` pragma contract | audit expects `synchronous=2` | WR-01 |
| `schema-migrations` committed-implied ×2 | dropped `files: 1` | IN-01 |
| `audit-chain-multiprocess`, `smoke-harness` release exclusion | strengthened only | IN-02, IN-B05 |

## Final suite

```
node --test   (final tree, a197b79)
# tests 1458
# pass 1458
# fail 0
# cancelled 0
# duration_ms 55180
```

- 1445 (baseline) + 13 new tests.
- The first full run on the fix tree had 3 failures. All three were the deliberate contract updates listed above (`db-file-layout`, `schema-migrations` ×2), fixed in `d933041` / `a197b79`.
- No known load-flake fired on the final run. Host load was 29–55 during it.

**Write-latency (WR-01 budget):** RAID median 27.6 ms and tasks median 8.9 ms, against the PRD ≤ 40 ms median budget. `write-latency: PASS — budgets met` with `--assert --n=41`.

---

_Fixed: 2026-10-10_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
