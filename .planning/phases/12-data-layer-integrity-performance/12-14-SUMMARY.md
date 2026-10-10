---
phase: 12-data-layer-integrity-performance
plan: 14
subsystem: testing
tags: [evidence, perf, soak, gate, smoke, validation]
status: partial
requirements: [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, QUAL-01, QUAL-02]
actuals:
  tokens: 0
  tasks: 1
  commits: 1
---

# Phase 12 Plan 14: Evidence and sign-off - SUMMARY (PARTIAL, written incrementally)

**Status: PARTIAL - resume at Task 2, evidence run `gate` (re-run from scratch).** Task 1 is done (with one budget gap);
the Task 2 scenario module is written and green; the remaining Task 2 evidence runs and Task 3 are not done yet.

## Done

| Item | Result | Where |
|---|---|---|
| Task 1: `npm run perf -- --assert` on the final tree (host load 9 at start) | 3 of 4 budgets PASS; **load-40 FAIL** (run 1 86.3 ms, runs 2/3 112.2 / 133.0 ms vs 100) | `evidence/perf.log`, `evidence/perf-summary.md`, commit `a86c8df` |
| load-40 gap analysis (not loosened) | state growth across `--runs 3` + saturated single main thread; POST+GET /api/raid = 84 % of the loop; proposals in `perf-summary.md` | `evidence/load40-fresh-invocations.log`, `evidence/load40-profile*.log`, `evidence/diagnostics/` |
| Task 2 scenario module `scripts/uat/phase10-scenarios/data-phase12.js` | 4 scenarios, 45 PASS / 0 FAIL on its own (real + dev lanes) | not yet committed at the time of this note |
| Gate attempt 1 (`test-gate --runs 20 --no-soak`) | runs 1-10 green (1445/1445 each, ~20 s); run 11 hit `soak-correlator` "a real 2-process smoke run" under host load 30 (612 s, cancelled); isolation snapshot PASS | `evidence/gate.log` |

## Not done yet

- gate re-run to `GATE PASS runs=20`, soak, smoke, Phase 10 runner (all lanes), Phase 9 walks (normal + `--demo-open`),
  verify.log (soak check 10, legacy-migration rehearsal, store-driven sealed scratch deal + `audit-verify --all`),
  `evidence/README.md`, `12-VALIDATION.md`, final full-suite count.

## Product findings

1. **load-40 budget gap** - see `evidence/perf-summary.md` (measurements, profile, proposed minimal changes).
2. **soak-correlator hang under host load** - `test/soak-correlator.test.js` "a real 2-process smoke run" kills the soak child
   at 80 s but its orphaned grandchildren keep the test process's stdout pipe open, so the file hangs ~10 min and the
   runner reports `cancelled`. Needs a quiet host to pass; not reproducible alone (see `evidence/gate-run11-flake-alone.log`).
3. Running the suite tightens the committed `data/control.db` file MODE to 0600 (bytes and git status unchanged; the
   accounts-writable-gate / real-mode-guards suites open it under the 12-01 opt-in and `chmodPrivateFile` tightens).
