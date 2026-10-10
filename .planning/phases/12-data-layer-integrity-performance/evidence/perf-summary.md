# Phase 12 / plan 12-14 - Task 1: every PRD performance budget on the final tree

Command (committed script, no edits, no flags beyond the plan's): `npm run perf -- --assert`
(= `node scripts/perf/run-all.js --assert`: write-latency, list-reads `--runs 3`, load-40 `--runs 3`, pack-isolation).
Log: `perf.log` (ends `EXIT=1`, last verdict line `PERF FAIL load-40`).

Host: darwin-arm64, 11 CPUs, shared with other sessions. The run waited for 1-minute load < 10 and started at
load 9.07 (end 9.51; `uptime` background of this machine is ~7-9 with nothing of mine running). Base tree `e76c29c`.
No script, profile, threshold or budget was edited (`git diff -- scripts/perf` is empty).

## Budget table (budget | review baseline | run 1 | run 2 | run 3 | verdict)

| Budget (PRD acceptance / SC) | Review baseline | Run 1 | Run 2 | Run 3 | Verdict |
|---|---|---|---|---|---|
| Write median <= 40 ms at 1k tasks / 5k RAID / 200 positions; exactly 1 audit row per create; 0 per reorder (acc. 1, SC1) | POST raid 85.7 ms, task 96.6 ms, ~6,220 audit rows per create | raid **14.3 ms** (p95 18.0, max 21.2, n=21), task **2.5 ms** (p95 4.0), audit rows/create **1.0** / **1.0**, reorder **0** rows (15.0 ms, order persisted) | (single measurement) | | **PASS** |
| 10 users x 3 list reads (unparameterized, 1.7 MB RAID array): p95 <= 300 ms, each of 3 runs (acc. 2, SC2) | p50 322 ms, p95 483 ms | p95 **145.0** ms (p50 130.9) | p95 **155.0** ms (p50 134.9) | p95 **158.1** ms (p50 149.0) | **PASS** x3 |
| 40 clients: event-loop p99 <= 100 ms, each of 3 runs (acc. 2, SC2) | p99 1,921 ms | p99 **86.3** ms (318 rps) | p99 **112.2** ms **OVER** (144 rps) | p99 **133.0** ms **OVER** (106 rps) | **FAIL (gap)** |
| Pack render: other requests' event-loop p99 <= 50 ms, second concurrent pack refused (acc. 5, SC5) | event loop blocked 2,397 ms per pack | round 1: **11.4** ms, B = 429 Retry-After 5 | round 2: **6.8** ms, B = 429 | round 3: **6.3** ms, B = 429 | **PASS** |

Informational numbers printed by the same run: list-reads event loop during the 10x3 rounds p99 67.0 / 49.0 / 100.3 ms;
`GET /api/raid` single sequential median 14.3 ms (1,696,528 B), `?limit=50` 7.4 ms (16,784 B), tasks 2.7 ms, positions 1.2 ms.

## GAP: load-40 (BLOCKED for the orchestrator - nothing loosened)

`PERF FAIL load-40`: run 1 passes (86.3 ms), runs 2 and 3 are over (112.2 / 133.0 ms). Three facts explain the shape;
all are measured, none is an opinion.

1. **Runs 2 and 3 of `--runs 3` are a different workload from run 1.** `scripts/perf/load-40.js` keeps ONE server and ONE
   deal for all runs, and 25 % of the mix is `POST /api/raid`. Run 1 starts with 40 RAID rows and creates 3,654 more; run 2
   therefore starts with ~3,694 rows (and adds 1,596); run 3 starts with ~5,290 (and adds 1,194). The unparameterized
   `GET /api/raid` (45 % of the mix, a locked byte-identical contract) and every `POST /api/raid` grow with the list. Run
   throughput falls 318 -> 144 -> 106 rps in the same invocation. The budget as written ("each of 3 runs") is judged on a
   list the previous run grew to 3.7k-5.3k rows.
2. **Even run 1 is on a knife edge on this host.** Three independent fresh-server invocations of the same script
   (`--runs 1`, `load40-fresh-invocations.log`, host load 8.6 -> 9.4 -> 10.0 while they ran): p99 **77.1** ms (330 rps),
   **110.9** ms (309 rps) OVER, **149.8** ms (270 rps) OVER. A 5.3k-row pre-grown deal measured by the diagnostic harness:
   p99 **216** ms (111 rps).
3. **Where the main-thread time goes** (V8 `--cpu-prof` of the instrumented server child under the unmodified request mix;
   `load40-profile.log`, `load40-profile-by-route.log`, tools in `diagnostics/`). The main thread is saturated (idle 0.5 %),
   so event-loop delay is queueing delay behind per-request main-thread cost:

   | | Fresh deal (run-1 state, 45 s) | Deal at 5,300 rows (run-2/3 state, 20 s) |
   |---|---|---|
   | `GET /api/raid` | 47.0 % of the loop (3.8 ms/request, list growing) | 49.4 % (10.2 ms/request) |
   | `POST /api/raid` | 36.7 % (5.1 ms/request) | 36.4 % (13.3 ms/request) |
   | GC | 5.8 % | 7.2 % |
   | `/api` auth + deal middleware | 4.5 % | 2.5 % |
   | tasks + employees + healthz together | < 2 % | < 1 % |
   | 40-client run | 281 rps, event-loop p99 113.7 ms | 111 rps, p99 216 ms |

   - **POST /api/raid is O(lane size) on the CPU even though the SQL and the audit are O(1):** `readCollections(RAID_READ_SET)`
     `JSON.parse`s every row of both RAID lanes (store.js:406 + :392, ~16 %), then `writeDb()` `JSON.stringify`s every
     loaded item to decide it is untouched (store.js:637, 16 %). At 5k rows that is ~13 ms of main thread per create, which
     is what the 12-02 write-latency script also measures (14.3 ms median) - under a closed loop of 40 clients it is the
     queue.
   - **GET /api/raid (unparameterized) costs a SELECT + `json_extract` x 2 per row + one object per row (store.js:455/:471,
     ~25 %), a `join`, then inside `res.send`: a SHA-1 ETag over the whole 1.7-3 MB body (4.9 % of the loop) and the UTF-8
     encode (4.7 %).** gzip is not on the main thread (zlib 0.6 %).
4. The other three scripts of the run are comfortably inside their budgets on the same quiet window (write 14.3 vs 40 ms,
   10x3 p95 145-158 vs 300 ms, pack 11.4 vs 50 ms): the converted tasks / employees / org reads are not the problem any more.

### Proposed minimal changes (for the orchestrator; no product code was touched here)

In order of distance covered per line changed:

1. **Single-record write path for `POST/DELETE /api/raid`** (and tasks): do the create/update through a one-row store
   operation (read the one row by id for the version / clearance check, INSERT or version-guarded UPDATE it, append the one
   audit row) instead of load-whole-lane + re-serialize-whole-lane. Removes ~36 % of the loop in this mix and all of the
   O(N) growth of write cost; keeps the Phase 8/9/11 contracts if the same `conflictIfStale` / clearance functions run on the
   one row. This is the change that makes D-12-01's "writes proportional to what changed" true for CPU, not only for SQL.
2. **Stop hashing and re-encoding the response body on `GET /api/raid`:** `res.set('ETag', <cheap validator, e.g. lane
   data_version + count>)` or send a pre-built `Buffer` (Express skips `generateETag` when the header is set) - ~9.6 % of
   the loop, byte-identical body.
3. **Decide the profile question explicitly** (12-09 already flagged it): either keep the profile fetching the
   unparameterized list and accept 1/2, or have the profile request `?limit=50` like the converted clients will (Phase 18)
   - `GET /api/raid?limit=50` is 7.4 ms sequential / 16.8 KB. This is a decision about the profile, so it is the
   orchestrator's, not mine; and `--runs 3` on a shared growing deal should be re-stated as "each run on a fresh deal" or the
   budget accepted as "run 1 of 3" - again the orchestrator's call.

Not done here on purpose: editing `scripts/perf/*`, `--runs`, `--seconds`, the mix, or the 100 ms threshold (T-12-132).
