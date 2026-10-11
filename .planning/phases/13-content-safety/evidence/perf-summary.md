# Phase 13 / plan 13-14 - Phase 12 performance budgets re-measured on the Phase 13 tree

Command (committed scripts, budgets unchanged): `node scripts/perf/run-all.js --assert` (= `npm run perf`: write-latency,
list-reads `--runs 3`, load-40 `--runs 3` each on a fresh deal, pack-isolation).
Log: `perf.log` (ends `PERF PASS` / `EXIT=0`). Tree: base `ef1c2b7` plus this plan's test-tooling / docs commits only (no
product file differs from the merged Phase 13 tree: strict CSP ENFORCING by default, per-request CSP builder, `no-store`
middleware before the parsers, Windows-spelling first middleware, `urlField` validators, media allowlist).

Host: darwin-arm64, 11 CPUs, shared with other sessions. Started at 1-minute load average **7.74** (5 min 11.61, 15 min
32.32), ended at **8.64** (5 min 10.34, 15 min 28.54); the host load is printed beside every load-40 run in `perf.log`
(7.6 -> 7.7, 7.7 -> 8.4, 8.4 -> 7.6). The Phase 12 quiet-host rule (1-minute load < 10) held for the whole run. No script,
mix, duration, client count or budget was touched.

## Budget table (budget | Phase 12 final | Phase 13 run 1 | run 2 | run 3 | verdict)

| Budget | Phase 12 final (12-14 refresh) | Run 1 | Run 2 | Run 3 | Verdict |
|---|---|---|---|---|---|
| Write median <= 40 ms at 1k tasks / 5k RAID / 200 positions; exactly 1 audit row per create; 0 per reorder | raid 13.4 ms / task 5.0 ms median, 1.0 / 1.0 rows, reorder 0 rows | raid **14.0** ms (p95 15.2, max 18.7, n=21), task **5.0** ms (p95 5.8), audit rows per create **1.0** / **1.0**, reorder **0** rows (13.1 ms, order persisted) | (single measurement) | | **PASS** |
| 10 users x 3 list reads: p95 <= 300 ms, each of 3 runs | p95 115.2 / 108.4 / 103.5 ms | p95 **114.7** ms (p50 105.7) | p95 **115.5** ms (p50 107.6) | p95 **124.1** ms (p50 115.6) | **PASS** x3 |
| 40 clients, each run on a FRESH deal: event-loop p99 <= 100 ms, each of 3 runs | p99 93.9 / 89.7 / 90.8 ms | p99 **97.0** ms (297.2 rps; host load 7.6 -> 7.7) | p99 **94.1** ms (295.6 rps; 7.7 -> 8.4) | p99 **91.1** ms (293.1 rps; 8.4 -> 7.6) | **PASS** x3 |
| Pack render: other requests' event-loop p99 <= 50 ms, second concurrent pack refused (429) | worst round p99 9.6 ms (rounds 9.6 / 6.3 / 6.9), B = 429 Retry-After 5 | round 1: **13.6** ms, B = 429 Retry-After 5 | round 2: **8.1** ms, B = 429 | round 3: **7.0** ms, B = 429 | **PASS** |

Informational numbers printed by the same run: list-reads event loop during the 10 x 3 rounds p99 57.3 / 51.0 / 53.2 ms
(Phase 12: 66.1 / 62.4 / 61.9); `GET /api/raid` single sequential median 13.0 ms (1,696,528 B), `?limit=50` 6.5 ms
(16,784 B), tasks 2.3 ms, positions 0.9 ms; paged form under the 10-user round p95 84.7 ms.

## Reading the numbers (honest margins)

- **Every budget holds in every run.** Nothing was re-run to get here: this is the first and only perf run on the final tree.
- **load-40 is the thin one, as it was in Phase 12.** Run 1 sits 3 % under the 100 ms budget (97.0 ms), runs 2-3 at 94.1 /
  91.1 ms. Phase 12 recorded 93.9 / 89.7 / 90.8 ms on a host at load 4.9-9.1; this run's host load was 7.6-8.4. The
  budget is met only on a quiet host (the Phase 12 caveat stands) and the run-1 value is 3 ms above Phase 12's run 1 on a
  somewhat busier host, which is inside the run-to-run spread seen there (89.7 - 93.9). Phase 13 adds per-request work on
  every response (CSP header assembly from the in-memory egress value + one `PRAGMA data_version`, the `no-store` and
  Windows-spelling middlewares); none of it shows up as a measurable regression in write latency (14.0 vs 13.4 ms) or
  pack isolation (worst round 13.6 ms vs 9.6 ms, budget 50), and list-reads p95 differs by -0.5 / +7.1 / +20.6 ms
  against Phase 12's three runs while the event loop during those rounds is lower (p99 51-57 ms vs 62-66 ms). If a future
  quiet-host run misses, the pre-identified next steps are those in the Phase 12 evidence (a single-record RAID/task write
  path; an `ETag` on list responses).
- **list-reads run 3 (124.1 ms) is the highest of the six runs on record** but is 59 % under its 300 ms budget.

## Migration deal/002 (resanitize-html) duration on the perf volume deal - `migration-002-timing.log`

`node scripts/perf/migration-002-timing.js` (new, export-ignored with the rest of `scripts/perf/`): a real deal seeded from
the demo template (pages, courses, i18n) plus the R5 volume (1,000 tasks, 5,000 RAID, 200 positions), stamped at
`user_version 1`, opened through `openDbFile()` (the boot path). Host load 7.81 / 10.08 / 28.13 at the start.

| Variant | File before | First open (runs 002) | Changed | Second open (v2) |
|---|---|---|---|---|
| A: volume deal exactly as the perf scripts build it (template content only) | 3.05 MiB | **35.8 ms** | 0 values in 0 rows | 2.7 ms |
| B: A + 300 legacy pages (every 4th carries markup the old sanitiser passed) + 150 legacy lessons (every 3rd dirty) | 4.89 MiB | **97.0 ms** | 200 values in 90 rows | 3.0 ms |

The migration reads only the HTML-bearing collections (pages, courses), so the 6,200 volume rows cost nothing; a deal
with 300 pages + 150 lessons pays ~60 ms extra for 200 rewrites. No PRD budget covers migration time; the one-time boot
cost is negligible next to the Phase 12 audit migration (Phase 12 open item 5).
