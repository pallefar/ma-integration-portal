---
phase: 12-data-layer-integrity-performance
plan: 05
subsystem: database
tags: [sqlite, better-sqlite3, read-path, list-query, paging, clearance, perf, optimistic-locking]

requires:
  - phase: 12-data-layer-integrity-performance
    provides: "12-02 dirty-row writeDb + statement cache + volume seeder; 12-04 instrumented-server perf harness"
  - phase: 11-authorization-clean-room-closure
    provides: "raidRow provenance rule, assertRecordVisibleOr404 before conflictIfStale, store CR-01 backstop, byte-identical 404 bodies"
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "per-record version WHERE clause and the structural rule that every json_extract line carries a bound ?"
provides:
  - "db/store.js readCollections(names): partial whole-object read with throwing accessors for every unloaded collection and a partial-snapshot writeDb"
  - "db/store.js readSingleton(key) and readProjection(collection, fields): light { id, seq, raw, f } rows with bound JSON paths"
  - "lib/listQuery.js parseListQuery / applyListFilters / sendList: server-side filter + paging with a non-breaking bare-array default"
  - "server.js: raidLaneName, clearanceAreaFromProvenance, raidRowVisible, areaVisibleTo, RAID_READ_SET, RAID_LIST_SPEC; GET/POST/DELETE /api/raid on the proportional path"
  - "scripts/perf/list-reads.js (R5 10x3) and scripts/perf/load-40.js (R2 40-client) with the PRD baselines printed beside every measurement"
affects: [12-09, 12-10, 12-11, 12-14]

actuals:
  tokens: 62000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "read only the lane set a route needs: readCollections(SET), unloaded keys are throwing accessors, never empty arrays"
    - "list responses assembled from stored raw JSON ('[' + raws.join(',') + ']') — byte-identical to res.json(parsed) because data is exactly JSON.stringify(item)"
    - "order of operations for any list: visibility -> filters -> total -> page (no existence oracle)"
    - "one provenance rule (clearanceAreaFromProvenance) behind both the in-memory and the projection read shapes"

key-files:
  created:
    - lib/listQuery.js
    - test/read-collections.test.js
    - test/raid-list-query.test.js
    - scripts/perf/list-reads.js
    - scripts/perf/load-40.js
    - scripts/perf/lib/scratch-deal.js
  modified:
    - db/store.js
    - server.js

key-decisions:
  - "Unparameterized GET /api/raid is assembled from stored raw JSON; byte identity asserted against JSON.stringify of rows read independently from the deal file (PD-10)"
  - "A readCollections() object never re-upserts a singleton it did not change (raw-text compare, refreshed post-commit) — a lane lookup that only reads settings can no longer overwrite a concurrent settings change"
  - "raidLaneName() sits beside raidLane() instead of inside it: optimistic-locking-contract source-scans raidLane's body for exactly its two collection keys"
  - "`phase` is not a RAID list parameter: the spec lists only status/owner/workstream/q (+limit/offset); anything else is ignored like any unknown key"

patterns-established:
  - "createScratch(): read-only backup() copies of the committed DBs, MA_* temp paths, >= 1 GB precondition, cleanup on finally + SIGINT/SIGTERM"

requirements-completed: [DATA-02, DATA-01]

duration: ~75min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 05: Proportional read path (RAID lane) Summary

**`readCollections` / `readProjection` and a server-side list query now serve the RAID lane: `GET /api/raid` reads one lane through a light projection (bare array byte-identical when unparameterized, `{ items, total }` with `?limit=`, clearance applied before filter/total/page) and `POST`/`DELETE /api/raid` load four collections instead of 43 — with two committed scripts that reproduce the R5 10x3 and R2 40-client profiles against the PRD baselines.**

## Performance

- **Tasks:** 3 (Task 1 `type="tracer"`; its automated verify re-ran green before expansion)
- **Files:** 6 created, 2 modified
- **Suite:** 1305 at base -> **1332/1332** (+15 read-collections, +12 raid-list-query), 0 failures, no flake seen

## Measured numbers (honest caveat first)

**This host was saturated for the whole measurement window** (1-min load average 38-200 on 11 CPUs — another session's Next.js build and several executors' suites). Absolute numbers below are inflated 2-5x and swing run to run; the before/after pair were taken back to back on the same tree layout (`PERF_SERVER_ROOT` pointing at a symlinked copy of the base `server.js`; `db/` is the current one, so "before" = wave 1 merged, pre-12-05). The PRD budgets are asserted in 12-14 on a quiet host; this plan converts only the RAID lane (tasks, org and employees reads are still `readDb()`), so **the p95 and event-loop budgets are NOT expected to be met by this plan alone**.

### R5 10 users x 3 list reads (`scripts/perf/list-reads.js`, 1k tasks / 5k RAID / 200 positions, hrbp)

PRD/R5 baseline: p50 322 ms, p95 483 ms. Budget: p95 <= 300 ms.

| Round (host load) | Before (base tree) p50 / p95 / eld p99 | After (this plan) p50 / p95 / eld p99 |
|---|---|---|
| 1 | 366 / 378 / 183 ms | 382 / 393 / 127 ms |
| 2 | 359 / 370 / 200 ms | 319 / 334 / 140 ms |
| 3 | 348 / 358 / 223 ms | 725 / 752 / 615 ms (host spike) |
| later run, load ~100 (x3) | 590 / 627 · 549 / 588 · 592 / 619 | 963 / 991 · 761 / 800 · 606 / 647 |

Reading it: 20 of the 30 requests in the round (tasks, positions) are still full `readDb()` and the raid response still carries the 1.7 MB array when unparameterized (gzip dominates), so the round is essentially unchanged — expected. The round is 1/3 converted.

Single requests, sequential, unloaded-ish (median of 9):

| Route | Before | After | Payload |
|---|---|---|---|
| GET /api/raid (unparameterized) | 33.1 ms | 30.8 ms | 1,696,528 B (identical bytes) |
| GET /api/raid?limit=50 | 42.1 ms (param ignored) | **14.2 ms** | **16,784 B** (was 1,696,528 B) |

The paged raid read is the lever the UI can pull (a 100x smaller payload, 3x faster even on a loaded host); the unparameterized form stays byte-identical on purpose.

### R2 40-client profile (`scripts/perf/load-40.js`, 40 closed-loop clients, 45/15/10/25/5 mix, 5 ms eld resolution)

R2 baseline: event-loop p99 1,921 ms. Budget: p99 <= 100 ms. (20 s runs; the committed default is 45 s.)

| Run (host load) | Before (base tree) | After (this plan) |
|---|---|---|
| back to back, load ~85-115 | 245 rps · eld p99 120 ms (hb 120, max 150) · GET /api/raid p50 226 / p95 387 ms · POST /api/raid p50 84 / p95 156 ms | **275 rps · eld p99 116 ms (hb 116, max 144)** · GET /api/raid p50 214 / p95 346 ms · POST /api/raid p50 68 / p95 130 ms |
| earlier, load ~40-60 (one starved sample each) | 38 rps · eld p99 1,562 ms | 207 rps · eld p99 259 ms |
| later, load ~100-200 (starved) | — | 10 s server stalls, ERR responses: discarded as host starvation |

Reading it: the pre-12-05 tree already carries 12-02's dirty-row writes, which is most of the distance from the review's 1,921 ms (the 1,562 ms single sample was taken in a starved window and is not comparable to the 120 ms back-to-back one). 12-05's own contribution on this profile is modest and within host noise (+12 % throughput, ~-4 ms eld p99, POST p50 84 -> 68 ms): the mix is dominated by the three list reads still on `readDb()` (employees, tasks) and by the 1-3k-row unparameterized RAID array the clients ask for. The p99 <= 100 ms budget is **not yet met** (115.8 ms under load ~90); it lands with the remaining read conversions (12-09/12-10/12-11) and is asserted in 12-14 on a quiet host.

## Route-level conversion inventory

| Route | Before | After |
|---|---|---|
| GET /api/raid | `readDb()` (43 reads) + `reportRaidRows` | `readSingleton('settings')` + `readProjection(lane, [...])` (+ `readProjection('ddFindings', ['id','area'])` only when an unstamped `dd-finding:` provenance is present) |
| POST /api/raid (create/update) | `readDb()` | `readCollections(RAID_READ_SET)` = settings, raidEntries, customRaidEntries, ddFindings |
| DELETE /api/raid/:id | `readDb()` | `readCollections(RAID_READ_SET)` |
| reportRaidRows consumers (CSV export, PDF pack) | `readDb()` | unchanged (still `readDb()`; same provenance rule via `resolveRaidEntryClearanceArea` -> `clearanceAreaFromProvenance`) |
| every other route | `readDb()` | unchanged — 12-09/12-10/12-11 apply the same mechanism |

## Accomplishments

- **Store read API** (`db/store.js`): `readCollections(names)` reads only the named collections with the same row shapes as `readDb()`; every other known key is a non-enumerable accessor whose get *and* set throw `CollectionNotLoadedError` (code `COLLECTION_NOT_LOADED`, naming the key) so an unloaded lane is never an empty array. `JSON.stringify`, `Object.keys`, spread and `Object.assign` do not trip it. `writeDb()` on such an object diffs and writes only the loaded collections and refuses an own enumerable value for an unloaded one. `readSingleton`, `readProjection` (field names regex-validated, JSON paths bound as parameters, statement cached per connection/collection/fields).
- **List query** (`lib/listQuery.js`): zod-validated `limit` 1..200, `offset` >= 0 only with `limit`, enum/owner/workstream/`q` bounds; non-string (array/object) values are 400; unknown keys ignored. `q` is a case-insensitive Unicode substring over title and notes evaluated in JavaScript.
- **Clearance first** (T-12-40/41): `raidRowVisible` is the one per-row predicate; visibility runs before filters, `total` and paging, so `total` and `?q=` can never confirm a restricted entry exists (tested for an uncleared pmo, a legal-only and an hr-only member, stamped, unstamped-legacy and orphan provenance).
- **Write handlers on the read set**: Phase 9/11 semantics untouched (404 before 409, version WHERE, CR-01 echo filtering) — the named suites pass unedited.
- **Perf scripts**: both reproduce the review profiles on `backup()` copies of the committed DBs, print the baseline beside every number, support `--runs`/`--assert` (any run missing the budget fails), clean up on finally and SIGINT/SIGTERM.

## Task Commits

1. **Task 1 (tracer): read API + GET /api/raid list query** - `a1951a1` (feat)
2. **Task 2: RAID filters/oracle/400 proofs + POST/DELETE on the read set** - `3b83a42` (feat)
3. **Task 3: R5 10x3 and R2 40-client perf scripts** - `cb39cbb` (feat)

**Plan metadata:** committed with this SUMMARY (docs).

Tracer gate (autonomous policy for this dispatch): Task 1's `<verify>` (read-collections, raid-list-query, raid-access-filter, full suite) re-ran green before expansion — "Tracer verified end-to-end — expanding".

## Decisions Made

- Raw-JSON array assembly for the unparameterized form (PD-10); byte identity is asserted, not assumed, against rows read independently from the deal file.
- `findingAreaOf` stays exact for odd data: an existing finding with no `area` resolves to `undefined` (restricted unless granted, as before), a missing finding to `null`; non-string `clearanceArea`/`source` are judged from the parsed record, never the projection scalar.
- A singleton read through `readCollections()` and left unchanged is not re-upserted (raw-text compare, refreshed after commit). `readDb()` objects keep the unconditional upsert exactly as before.

## Deviations from Plan

### Auto-fixed / judgement calls

**1. [Rule 3 - Blocking] `test/raid-access-filter.test.js` (h) pins the old delegation textually**
- **Issue:** (h) requires the `GET /api/raid` handler body to contain `reportRaidRows(` and `reportRaidRows`'s body to contain `resolveRaidEntryClearanceArea`. The plan makes GET stop calling `reportRaidRows` and says the suite must pass unchanged.
- **Fix:** `reportRaidRows` still calls `resolveRaidEntryClearanceArea` and now ends in the same `areaVisibleTo()` tail `raidRowVisible()` uses; the GET handler carries an in-body comment naming `reportRaidRows()` and the shared rule. The suite passes unedited, but (h) now proves only the text, not delegation. **Recommend:** a later plan updates (h) to assert `raidRowVisible(`; the real equivalence is proven by raid-list-query (a)/(f) (paged and legacy forms agree with an independent re-statement of the rule for five identities).
- **Files:** server.js. **Commit:** a1951a1

**2. [Rule 2 - Critical] Unchanged-singleton skip in `writeDb()`**
- **Issue:** a RAID write now loads `settings` for the lane choice; the existing unconditional singleton upsert would rewrite it from a possibly stale copy on every RAID write (pre-existing hazard, now more visible).
- **Fix:** `readCollections()` records each loaded singleton's stored text; `writeDb()` skips an unchanged one and refreshes the record post-commit. Tested (read-collections (h)). **Commit:** a1951a1

**3. [Plan intent] `writeDb()` restricts on `__loaded`, not on `__snapshot` keys**
- A hand-built object with an empty `__snapshot` keeps today's behaviour (full walk); only a `readCollections()` object narrows. **Commit:** a1951a1

**4. [Plan intent] Added `scripts/perf/lib/scratch-deal.js`** (not in `files_modified`) — the setup both scripts share; the SIGINT/SIGTERM handlers deliberately stay in each script (the plan's verify greps for them there). **Commit:** cb39cbb

**5. [Ordering] Filter functions landed with the tracer**
- `applyListFilters` and the `status/owner/workstream/q` handling are in the Task 1 commit (the GET handler is one unit); Task 2's commit carries the POST/DELETE conversion and the filter / oracle / 400 / write-semantics tests.

**6. [Interpretation] `phase` is not a RAID list parameter**
- PD-12 lists `phase` among recognised keys "from the route's enums"; RAID has no phase concept, so the RAID spec omits it (ignored, tested). 12-09 lists it for tasks via the spec.

**Total deviations:** 6, none architectural; no contract (Phase 8/9/10/11) changed.

## Issues Encountered

- Host saturation (load average up to 200) made every absolute number noisy; one 20 s load-40 run saw a 10 s server stall (`rss 32 MB`, ERR responses) — a starved host, not the code; re-run recorded above.
- `better-sqlite3` read-only opens of the committed WAL databases can create `-shm`/`-wal` sidecars in `data/`; `createScratch()` removes the ones it created and they are gitignored. The committed `demo.db` / `control.db` sha256 are unchanged (`63d552c4...a805a8` / `e83f049e...854a72`, equal to HEAD blobs).

## Verification

| Check | Result |
|---|---|
| read-collections / raid-list-query | 15 / 12 passing |
| raid-access-filter, clearance-write-paths, optimistic-locking-contract / -precondition, denial-audit, no-get-mutates | pass, **zero edits** |
| structural rule: every `json_extract` line carries a bound `?` | pass |
| `grep -c raidRowVisible server.js` / `grep -c RAID_READ_SET server.js` | 4 / 3 |
| Full suite | 1305 -> **1332/1332**, 0 failures |
| `grep -cE "process\.(once\|on)\(.SIG(INT\|TERM)"` list-reads.js / load-40.js | 2 / 2 |
| `git status --porcelain -- data public/sent_emails` | empty |

## Known Stubs

None.

## Threat Flags

None. No new endpoint or trust boundary: `GET /api/raid` gained optional query parameters (T-12-40, T-12-43, T-12-44 mitigations in place and tested); perf scripts fork servers against `os.tmpdir()` scratch only and open the committed databases read-only (T-12-45/46).

## Next Phase Readiness

- 12-09/12-10/12-11 can reuse `readCollections(SET)`, `readProjection`, `parseListQuery`/`applyListFilters`/`sendList` and the `clearanceAreaFromProvenance` + `areaVisibleTo` pair for the task lane (`resolveTaskClearanceArea` is theirs).
- 12-14: `node scripts/perf/list-reads.js --runs 3 --assert` and `node scripts/perf/load-40.js --runs 3 --assert` are the budget gates (run on a quiet host).
- A later plan should update `test/raid-access-filter.test.js` (h) to assert `raidRowVisible(` (see Deviation 1).

---
*Phase: 12-data-layer-integrity-performance*
*Completed: 2026-10-10*

## Self-Check: PASSED

- Created files exist: lib/listQuery.js, test/read-collections.test.js, test/raid-list-query.test.js, scripts/perf/list-reads.js, scripts/perf/load-40.js, scripts/perf/lib/scratch-deal.js
- Commits present: a1951a1, 3b83a42, cb39cbb
- Final full-suite run after the last code commit (cb39cbb): `# tests 1332 / # pass 1332 / # fail 0`
