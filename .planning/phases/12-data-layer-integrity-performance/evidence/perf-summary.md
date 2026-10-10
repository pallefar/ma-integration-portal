# Phase 12 / plan 12-14 - every PRD performance budget on the post-review-fix tree (evidence refresh)

Command (committed scripts, budgets unchanged): `npm run perf` (= `node scripts/perf/run-all.js --assert`: write-latency,
list-reads `--runs 3`, load-40 `--runs 3`, pack-isolation).
Log: `perf.log` (ends `PERF PASS` / `EXIT=0`). Tree: the Phase 12 base after the 16 code-review fixes (12-REVIEW-FIX.md)
plus this refresh's two script/test edits (load-40 fresh deal per run; Phase 9 asset-stamps contract).

Host: darwin-arm64, 11 CPUs, shared with other sessions. The run waited until the 1-minute load average was < 10 AND
the 5-minute average < 15 (held for two consecutive checks) and started at load1 4.87 / load5 14.71 (end 6.87 / 12.09);
the load is printed beside every load-40 run (`host load 1/5/15 min`). No script, profile, mix, duration, client count or
budget was loosened; the single script change is the orchestrator-decided "fresh deal per run" (below).

## Budget table (budget | review baseline | run 1 | run 2 | run 3 | verdict)

| Budget (PRD acceptance / SC) | Review baseline | Run 1 | Run 2 | Run 3 | Verdict |
|---|---|---|---|---|---|
| Write median <= 40 ms at 1k tasks / 5k RAID / 200 positions; exactly 1 audit row per create; 0 per reorder (acc. 1, SC1) | POST raid 85.7 ms, task 96.6 ms, ~6,220 audit rows per create | raid **13.4 ms** (p95 15.2, n=21), task **5.0 ms** (p95 5.8), audit rows/create **1.0** / **1.0**, reorder **0** rows (12.7 ms, order persisted) | (single measurement) | | **PASS** |
| 10 users x 3 list reads (unparameterized, 1.7 MB RAID array): p95 <= 300 ms, each of 3 runs (acc. 2, SC2) | p50 322 ms, p95 483 ms | p95 **115.2** ms (p50 106.1) | p95 **108.4** ms (p50 97.2) | p95 **103.5** ms (p50 94.5) | **PASS** x3 |
| 40 clients, EACH RUN ON A FRESH DEAL: event-loop p99 <= 100 ms, each of 3 runs (acc. 2, SC2) | p99 1,921 ms | p99 **93.9** ms (301.6 rps; host load 4.9 -> 7.6) | p99 **89.7** ms (298.4 rps; 7.6 -> 9.1) | p99 **90.8** ms (299.4 rps; 9.1 -> 6.9) | **PASS** x3 |
| Pack render: other requests' event-loop p99 <= 50 ms, second concurrent pack refused (acc. 5, SC5) | event loop blocked 2,397 ms per pack | round 1: **9.6** ms, B = 429 Retry-After 5 | round 2: **6.3** ms, B = 429 | round 3: **6.9** ms, B = 429 | **PASS** |

Informational numbers printed by the same run: list-reads event loop during the 10x3 rounds p99 66.1 / 62.4 / 61.9 ms;
`GET /api/raid` single sequential median 11.7 ms (1,696,528 B), `?limit=50` 6.0 ms (16,784 B), tasks 2.1 ms, positions 0.9 ms;
paged form under the 10-user round p95 74.4 ms.

**Margin note (not a loosening, a caveat):** load-40's three runs sit 6-10 % under the 100 ms budget on a host whose load
was 5-9. It is host-noise sensitive: the same script on a noisy host (below) lands far over, and a quiet host is part of
the evidence contract (`README.md`).

## Decision 1: load-40 runs on a fresh deal (what changed and why)

The committed `scripts/perf/load-40.js --runs 3` reused ONE deal, so with `POST /api/raid` at 25 % of the mix the RAID
list grew 40 -> ~3,700 -> ~5,300 -> ~6,500 rows and runs 2-3 measured a list ~15x larger than the R2 review profile (one
45 s run on a fresh deal). `--runs N` now re-invokes the script once per run, so every run gets its own mkdtemp scratch,
deal, 40-record seed and instrumented server. The mix, duration (45 s), client count (40) and the <= 100 ms p99 budget are
unchanged; `--assert` still fails if ANY run misses it. The previous (shared-deal) numbers - 86.3 / 112.2 / 133.0 ms - are
in the history appendix and are what the old script measures, not what the profile specified.

## Noisy-host attempt (kept, not hidden): `perf-attempt1-noisy-host.log`

The first refresh run started at load1 13.4 / load5 30 (below the "load < ~15" 1-minute floor but on a host that had
averaged 30 for five minutes) and `perf` exited `PERF FAIL write-latency, list-reads, load-40`: raid write median 67.8 ms,
list-read p95 521 / 583 / 374 ms, load-40 p99 244 / 224 / 216 ms. Its own sequential informational numbers show a 3-5x
host slowdown (`GET /api/raid` single median 39.8 ms vs 11.7 ms on the quiet host) and the pack-isolation script printed its
"host is oversubscribed" warning. It is not a measurement of the tree; the quiet-host run above is. The waiting rule
(1-minute < 10 and 5-minute < 15) was added to the refresh wrapper after this attempt.

## History appendix: the pre-refresh gap analysis (shared deal, pre-review-fix tree)

Kept because it explains why the profile was restated and where the main-thread time goes; the diagnostics under
`diagnostics/` and `load40-*.log` are from that tree.

- Shared-deal runs: 86.3 / 112.2 / 133.0 ms (throughput 318 -> 144 -> 106 rps as the list grew).
- Three fresh single-run invocations at load ~9: 77.1 / 110.9 / 149.8 ms (`load40-fresh-invocations.log`) - run 1 is host-noise
  sensitive, which the 89.7-93.9 ms refreshed runs confirm is a thin-margin pass rather than a comfortable one.
- Main thread under the unmodified mix is saturated: `GET /api/raid` 47-49 %, `POST /api/raid` 36-37 % (store.js
  `readCollections` parse of both RAID lanes + `writeDb()` re-stringify of every loaded item, SHA-1 ETag + UTF-8 encode of
  the 1.7-3 MB body), tasks/employees/healthz < 2 % (`load40-profile.log`, `load40-profile-by-route.log`).
- If the fresh-deal run ever misses the budget on a quiet host, the next step is the single-record store write path for
  RAID/task create/update/delete and a cheap `ETag` on the list responses (orchestrator decision; not done here).
