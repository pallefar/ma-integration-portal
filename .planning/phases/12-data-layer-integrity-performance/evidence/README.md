# Phase 12 evidence (plan 12-14, refreshed on the post-review-fix tree)

The logs below were produced on 2026-10-11 on the tree **base `a53d9b3` (all 15 plans + the 16 code-review fixes of
`12-REVIEW-FIX.md`) + this refresh's three commits** (`8d5bed5` load-40 fresh deal per run, `667285d` Phase 9
asset-stamps contract, `8fbfda7` soak-correlator process-group kill). The original 12-14 evidence (2026-10-10) was
produced on the pre-review-fix tree; every log it produced that a review fix could affect was re-run (list below), and
the older diagnostics and gate attempts are kept and labelled as history.

Logs are `.log` files (gitignored by pattern, force-added) and end with `EXIT=<code>`. Local absolute paths are replaced
by `<repo>` / `<home>` / `<tmp>` / `<scratch>`; no secret, token or real identity appears (synthetic deals and accounts
only). Host: darwin-arm64, 11 CPUs, shared with other sessions; the load average is printed at the start (`HOST:` line)
and end of every run.

**Quiet-host rule for budget runs.** A performance budget is only measured when the 1-minute load average is < 10 and
the 5-minute average < 15 (two consecutive checks); `perf.log` starts with the load it started at. A first attempt that
did not wait for the 5-minute average to settle failed every budget on a 3-5x slowed host and is kept as
`perf-attempt1-noisy-host.log`. The gate, soak, smoke, runner and walks are correctness runs and were not held to that
rule (the gate was started after a 900 s wait gave up, at load 20, and ran green at load 20-55).

## Refreshed on the post-fix tree (2026-10-11)

| File | What it proves | Acceptance / SC |
|---|---|---|
| `perf.log` | `npm run perf` (= `run-all.js --assert`): write latency + audit rows, 10 x 3 list reads x 3 runs, 40-client load x 3 runs **each on a fresh deal**, pack isolation. `PERF PASS`, `EXIT=0`: raid 13.4 ms / task 5.0 ms; list p95 115.2 / 108.4 / 103.5; load-40 p99 93.9 / 89.7 / 90.8; pack worst p99 9.6 ms | acc 1, 2, 5 / SC1, SC2, SC5 |
| `perf-attempt1-noisy-host.log` | the same command on a host at load1 13.4 / load5 30: `PERF FAIL write-latency, list-reads, load-40` with a 3-5x host slowdown visible in the informational numbers - kept, not a measurement of the tree | acc 2 (history) |
| `perf-summary.md` | the budget table beside the review baselines, the fresh-deal-per-run restatement, the noisy-host attempt, and the pre-refresh gap analysis as a history appendix | acc 1, 2, 5 |
| `gate.log` | `npm run test:gate -- --runs 20` (20 full-suite runs + the 2-process soak smoke): **`GATE PASS runs=20`**, 1459 / 1459 in every run on the first attempt; sha256 + size of `data/audit.db*`, `data/runtime.db*`, `data/demo.db`, `data/control.db` before and after - identical | acc 6 / SC6 |
| `soak.log` | default `npm run soak` (3 processes, 120 s): 10,451 acknowledged, 0 lost, audit 1:1, 0 committed-but-unaudited, 1,003 conflict-lane acks / 2,085 x 409 / 0 x 503, chain verifies (11,456 rows) | acc 7 / SC7 |
| `smoke.log` | `npm run smoke`: 12 page x width visits, 0 errors, axe totals informational (37 critical+serious) | acc 6 / SC8 |
| `phase10-walk.log` | the full Phase 10 runner over all lanes with the Phase 11 scenarios and the four Phase 12 scenarios (`ddPageOneRequest` 12, `raidPagedApi` 6, `auditSealFlow` 17, `contentHashStamps` 5): **695 PASS / 0 FAIL** | acc 2, 4, 6, 7 |
| `phase9-walk.log` | Phase 9 walk, normal lane: **350 PASS / 0 FAIL**. The `asset-stamps` scenario was deliberately re-stated to the D-12-07 content-hash contract (below) | acc 7 |
| `phase9-walk-demo-open.log` | Phase 9 walk `--demo-open`: 18 PASS / 0 FAIL | acc 7 |
| `verify.log` | soak check 10 (chain verifies), the synthetic 20,000-row legacy-audit migration rehearsal (`audit-verify --all` over 802 files; **`migration_ms` 30,241 vs 2,010 before review fix WR-01** - validation Open items 5), and a sealed scratch deal (`sealed-sha=match`, export verifies, a one-byte edit fails) | acc 3, 4 |
| `p12-dd-page-1440.jpg`, `p12-dd-page-390.jpg` | the due-diligence page that issued exactly one `/api/dd/` request | acc 2 |
| `p12-admin-audit-sealed-1440.jpg` | the admin audit tab filtered to a sealed deal's partition | acc 4 |

### The deliberate Phase 9 scenario edit

`scripts/uat/phase9-scenarios/f8-stamps.js` (`asset-stamps`) is the only Phase 9 module edited. D-12-07 replaced numeric
`?v=` stamps with `?v=<first 16 hex of sha256(served bytes)>`, so three assertions per asset in that scenario ("one numeric
stamp", "matches the page on disk", "> pre-gap-closure floor") were superseded by `test/asset-cache-bust.test.js` and the
`contentHashStamps` scenario. It now asserts, per page and asset: requested; one stamp matching `/^[0-9a-f]{16}$/`; the
stamp equals the one in the page HTML as served; the stamp equals the first 16 hex of sha256 of the bytes the server
returns for that asset URL; and 200. The "requested" and "200" assertions are unchanged and the per-asset check count
(5) is unchanged, so the walk total stays 350.

### Side effects worth knowing

- The suite opens the committed `data/control.db` under the 12-01 opt-in and `chmodPrivateFile` tightens its mode to
  0600 (accepted by the orchestrator). Bytes and `git status` are unchanged; the gate wrapper restores 0644 afterwards
  and compares sha256 only.
- The Phase 10 / Phase 9 runners write ~30 screenshots each into `--out`; only the logs and the three `p12-*` shots are
  kept so this directory stays under the 1,200 KB cap (about 390 KB).

## History (pre-review-fix tree, 2026-10-10 - kept for the record, not refreshed)

| File | What it was |
|---|---|
| `load40-fresh-invocations.log` | three independent fresh-server runs of the shared-deal-era load-40 script (77.1 / 110.9 / 149.8 ms at load ~9) |
| `load40-profile.log`, `load40-profile-by-route.log` | V8 `--cpu-prof` of the instrumented server under the unmodified mix (fresh deal and 5,300-row deal): main-thread time per handler |
| `diagnostics/profile-load40.js`, `analyze-prof.js`, `by-route.js` | the three tiny scripts that produced the two files above |
| `diagnostics/verify-scratch-deal.js` | builds a synthetic store-driven deal, archives, seals through `scripts/audit-admin.js`, exports, verifies; used by `verify.log` (re-run in this refresh) |
| `gate-host-load.txt`, `gate-attempt1-run11-hang.log`, `gate-attempt2-run8-host-load-87.log`, `gate-attempt3-run7-host-load-105.log`, `gate-run11-flake-alone.log` | the four pre-fix gate attempts (10 / 7 / 6 green runs, broken by host-load spikes; attempt 1 by the `soak-correlator` orphaned-grandchild hang that `8fbfda7` fixes) and the flake re-run |

## Regenerate

All commands run from the repository root. `PLAYWRIGHT_PATH` and `AXE_CORE_PATH` are host-local tools that are not
installed by the repo (see `scripts/smoke/README.md`).

```
npm run perf                                              # perf.log   (needs a quiet host: load1 < 10, load5 < 15)
npm run test:gate -- --runs 20                            # gate.log   (~12 min; wrapper adds the data/ sha256 snapshot)
npm run soak                                              # soak.log
PLAYWRIGHT_PATH=<...>/playwright AXE_CORE_PATH=<...>/axe-core npm run smoke
PLAYWRIGHT_PATH=<...>/playwright node scripts/uat/phase10-walk.js --out <scratch dir>   # phase10-walk.log
PLAYWRIGHT_PATH=<...>/playwright node scripts/uat/phase9-walk.js --out <scratch dir>
PLAYWRIGHT_PATH=<...>/playwright node scripts/uat/phase9-walk.js --demo-open --out <scratch dir>
node scripts/perf/legacy-audit-migration.js --rows 20000  # verify.log section 2
node .planning/phases/12-data-layer-integrity-performance/evidence/diagnostics/verify-scratch-deal.js "$(pwd)"
```
