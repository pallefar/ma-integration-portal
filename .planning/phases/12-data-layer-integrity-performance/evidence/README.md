# Phase 12 evidence (plan 12-14)

Everything here was produced on the final tree (base `e76c29c` + this plan's commits) by committed scripts. Logs are
`.log` files (gitignored by pattern, force-added) and end with `EXIT=<code>`. Local absolute paths are replaced by
`<repo>` / `<home>` / `<tmp>` / `<scratch>`; no secret, token or real identity appears (synthetic deals and accounts only).
Host: darwin-arm64, 11 CPUs, shared; the 1-minute load average is printed at the start (`HOST:` line) and end of
every run.

| File | What it proves | Acceptance / SC |
|---|---|---|
| `perf.log` | `npm run perf -- --assert`: write latency + audit rows, 10 x 3 list reads x 3 runs, 40-client load x 3 runs, pack isolation. Ends `PERF FAIL load-40` (3 of 4 budgets pass) | acc 1, 2, 5 / SC1, SC2, SC5 |
| `perf-summary.md` | the budget table beside the review baselines and the load-40 gap analysis (where the time goes, proposed minimal changes) | acc 1, 2, 5 |
| `load40-fresh-invocations.log` | diagnostic: three independent fresh-server runs of the unmodified load-40 script (77.1 / 110.9 / 149.8 ms) | acc 2 |
| `load40-profile.log`, `load40-profile-by-route.log` | diagnostic: V8 `--cpu-prof` of the instrumented server under the unmodified mix, fresh deal and 5,300-row deal; main-thread time per handler | acc 2 |
| `diagnostics/profile-load40.js`, `analyze-prof.js`, `by-route.js` | the three tiny scripts that produced the two files above (read-only against the repo; scratch trees under `os.tmpdir()`) | - |
| `diagnostics/verify-scratch-deal.js` | builds a synthetic store-driven deal, archives, seals through `scripts/audit-admin.js`, exports, verifies; used by `verify.log` | acc 4 |
| `gate.log` | `node scripts/test-gate.js --runs 20 --no-soak`: `GATE PASS runs=20` (1445 / 1445 in every run); sha256 + size of `data/audit.db*`, `data/runtime.db*`, `data/demo.db`, `data/control.db` before and after - identical | acc 6 / SC6 |
| `gate-host-load.txt` | host load timeline of the passing gate attempt (the host reached a load average of 400+ from other sessions during it) | - |
| `gate-attempt1-run11-hang.log`, `gate-attempt2-run8-host-load-87.log`, `gate-attempt3-run7-host-load-105.log` | the three earlier gate attempts, kept: runs 1-10 / 1-7 / 1-6 green, then a host load spike broke one run | acc 6 (history) |
| `gate-run11-flake-alone.log` | the test that failed in attempt 1 re-run alone three times: 4/4 pass, 7 s each | acc 6 (flake record) |
| `soak.log` | default `npm run soak` (3 processes, 120 s): 8,403 acknowledged, 0 lost, audit 1:1, 0 committed-but-unaudited, chain verifies | acc 7 / SC7 |
| `smoke.log` | `npm run smoke`: 12 page x width visits, 0 errors, axe totals informational | acc 6 / SC8 |
| `phase10-walk.log` | the full Phase 10 runner over all lanes with the Phase 11 scenarios and the four Phase 12 scenarios (`ddPageOneRequest`, `raidPagedApi`, `auditSealFlow`, `contentHashStamps`): 695 PASS / 0 FAIL | acc 2, 4, 6, 7 |
| `phase9-walk.log` | Phase 9 walk, normal lane: 320 PASS / 30 FAIL - all 30 are the `asset-stamps` scenario's numeric-stamp assertions, superseded by D-12-07 (see 12-14-SUMMARY.md) | acc 7 |
| `phase9-walk-demo-open.log` | Phase 9 walk `--demo-open`: 18 PASS / 0 FAIL | acc 7 |
| `verify.log` | soak check 10 (chain verifies), the synthetic legacy-audit migration rehearsal (`audit-verify --all` over 802 files), and a sealed scratch deal (`sealed-sha=match`, export verifies, a one-byte edit fails) | acc 3, 4 |
| `p12-dd-page-1440.jpg`, `p12-dd-page-390.jpg` | the due-diligence page that issued exactly one `/api/dd/` request | acc 2 |
| `p12-admin-audit-sealed-1440.jpg` | the admin audit tab filtered to a sealed deal's partition | acc 4 |

## Regenerate

All commands run from the repository root. `PLAYWRIGHT_PATH` and `AXE_CORE_PATH` are host-local tools that are not
installed by the repo (see `scripts/smoke/README.md`).

```
npm run perf -- --assert                                  # perf.log   (needs a quiet host: load < 10)
node scripts/test-gate.js --runs 20 --no-soak             # gate.log   (~7 min on a quiet host)
npm run soak                                              # soak.log
PLAYWRIGHT_PATH=<...>/playwright AXE_CORE_PATH=<...>/axe-core npm run smoke
PLAYWRIGHT_PATH=<...>/playwright node scripts/uat/phase10-walk.js --out <scratch dir>   # phase10-walk.log
PLAYWRIGHT_PATH=<...>/playwright node scripts/uat/phase9-walk.js --out <scratch dir>
PLAYWRIGHT_PATH=<...>/playwright node scripts/uat/phase9-walk.js --demo-open --out <scratch dir>
node scripts/perf/legacy-audit-migration.js --rows 20000  # verify.log section 2
node .planning/phases/12-data-layer-integrity-performance/evidence/diagnostics/verify-scratch-deal.js "$(pwd)"
```

The Phase 10 and Phase 9 runners write ~30 screenshots (1.1 MB) into `--out`; point it at a scratch directory and keep
only the log and the three `p12-*` shots, so this directory stays under 1,200 KB.
