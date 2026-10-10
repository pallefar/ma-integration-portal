---
phase: 12-data-layer-integrity-performance
plan: 15
subsystem: testing
tags: [test-gate, github-actions, node-test, soak, zero-install]

requires:
  - phase: 08-concurrency-storage-foundation
    provides: scripts/soak.js (SOAK_PROCESSES / SOAK_DURATION_MS / SOAK_WRITE_INTERVAL_MS contract, exit 0 = acknowledged-write invariant held)
provides:
  - "`npm run test:gate`: suite N times (default 2) + light soak smoke, last line `GATE PASS runs=<N>` / `GATE FAIL at run <i>|soak`"
  - ".github/workflows/test.yml: node --test on ubuntu-24.04 + windows-latest, Node 22, read-only token, no install step"
  - "test/ci-workflow.test.js: static workflow assertions + gate --help / bad-args / recursion-guard cases"
affects: [12-14 (uses `npm run test:gate -- --runs 20` as the 20-consecutive-green evidence), 12-07 (adds `smoke` script next to test:gate in package.json), 12-09 (adds `perf` script), Phase 21 release engineering (SHA-pin actions), CERT-05 (first real workflow run on push)]

actuals:
  tokens: 4300
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Verdict-line contract: every gate invocation ends with exactly one machine-checkable line so a backgrounded log can be asserted on"
    - "Green = child exit code 0 AND a parsed `# fail 0` summary line (a missing summary is a failure)"
    - "NODE_TEST_CONTEXT guard for any scripts/ file whose basename starts with `test-` (node --test auto-discovers those)"

key-files:
  created:
    - scripts/test-gate.js
    - .github/workflows/test.yml
    - test/ci-workflow.test.js
  modified:
    - package.json

key-decisions:
  - "Kept the plan's filename scripts/test-gate.js and added a NODE_TEST_CONTEXT guard instead of renaming, because `node --test` auto-discovers `test-*.js` and would otherwise recurse (see Deviations 1)"
  - "Soak smoke defaults are the light, disk-safe set (2 processes, 6000 ms, 400 ms write interval) and remain overridable from the caller's environment"
  - "cancelled > 0 in the TAP summary is treated as a failed run, in addition to fail != 0 and a non-zero exit code"

patterns-established:
  - "Static workflow assertions: comments are stripped before matching, so prose in the YAML cannot satisfy or break an assertion"

requirements-completed: [DATA-06]

coverage:
  - id: D1
    description: "`npm run test:gate` runs the suite N times then a soak smoke and ends with an assertable GATE PASS/FAIL line"
    requirement: DATA-06
    verification:
      - kind: integration
        ref: "node scripts/test-gate.js --runs 2 -> GATE PASS runs=2 (run 1/2 pass=1272 fail=0; run 2/2 pass=1272 fail=0; soak exit 0)"
        status: pass
      - kind: unit
        ref: "test/ci-workflow.test.js#test-gate --help ... / rejects bad arguments ... / no-op when the node test runner launches it"
        status: pass
    human_judgment: false
  - id: D2
    description: "GitHub Actions workflow runs node --test on ubuntu-24.04 + windows with Node 22, read-only token, zero-install"
    requirement: DATA-06
    verification:
      - kind: unit
        ref: "test/ci-workflow.test.js#workflow ... (5 static text assertions)"
        status: pass
    human_judgment: true
    rationale: "The workflow is verified as text only. Real ubuntu/windows execution happens on the first push (CERT-05); Phase 12 does not claim those results."

duration: 25min
completed: 2026-10-10
status: complete
---

# Phase 12 Plan 15: Test Gate and CI Workflow Summary

**`npm run test:gate` runs the full suite N times plus a light multi-process soak and ends in a machine-checkable `GATE PASS runs=<N>` line, and `.github/workflows/test.yml` runs `node --test` on ubuntu-24.04 + windows with Node 22, a read-only token and no install step.**

## Performance

- **Duration:** about 25 min
- **Tasks:** 2 of 2 (Task 1 tracer, Task 2 TDD)
- **Files:** 3 created, 1 modified

## Accomplishments

- `scripts/test-gate.js`: flags `--runs N` (default 2), `--no-soak`, `--help`. Runs `node --test --test-reporter=tap` N times sequentially, streams the output through while keeping a bounded tail, and parses the `# pass` / `# fail` / `# cancelled` summary. A run is green only when the exit code is 0, the run did not time out, `# fail` parsed as 0 and `# cancelled` is 0 or absent. A missing summary line is a failure. Then runs `scripts/soak.js` with the light settings and requires exit 0.
- Every invocation ends in one verdict line: `GATE PASS runs=<N>`, `GATE FAIL at run <i>`, `GATE FAIL at soak`, `GATE FAIL bad arguments` (exit 2), or `GATE SKIP ...` (see Deviations 1).
- `package.json`: one new script, `"test:gate": "node scripts/test-gate.js"`; dependencies and other scripts untouched.
- `.github/workflows/test.yml`: triggers push + pull_request; `permissions: contents: read`; concurrency group per ref with cancel-in-progress; job `node-test` with `fail-fast: false`, matrix `[ubuntu-24.04, windows-latest]`, `timeout-minutes: 20`; steps `actions/checkout@v4`, `actions/setup-node@v4` (node-version 22), `node --version`, `node --test`. No install step, no secrets, comments record the major-tag pinning (T-12-03) and that first execution is on first push (CERT-05).
- `test/ci-workflow.test.js`: 9 cases. Gate: `--help` (flags present, no verdict line, no suite run started), bad-args (four variants exit 2 with `GATE FAIL bad arguments` last), recursion guard, package.json script. Workflow (text, comments stripped): triggers, read-only token and no secrets, ubuntu-24.04 pinned (not -latest) + windows- + Node 22 + fail-fast false, `node --test` step with all actions pinned `@vN`, no npm/pnpm/yarn install and no package-manager cache.

## Gate output (demonstrated once end to end)

`node scripts/test-gate.js --runs 2` (same as `npm run test:gate`), on this worktree after both task commits:

```
run 1/2: pass=1272 fail=0 (59353 ms)
run 2/2: pass=1272 fail=0 (130664 ms)
soak smoke: processes=2 durationMs=6000 writeIntervalMs=400
soak: load phase complete — acknowledged=94 refused=0 unexpected=0 | conflict-lane: acknowledged=13 conflict409=13 refused503=0
soak: PASS — acknowledged-write invariant held under sustained real load.
soak smoke: exit 0
GATE PASS runs=2
```

exit 0. The tracer's own verify (`--runs 1 --no-soak`) ended `run 1/1: pass=1267 fail=0 (32055 ms)` / `GATE PASS runs=1`. The 130 s second run reflects sibling executors contending for the same disk and CPU; the suite normally takes about 30 s.

`node scripts/test-gate.js --help` prints:

```
Usage: node scripts/test-gate.js [--runs N] [--no-soak] [--help]
...
Flags:
  --runs N     number of full-suite runs, integer >= 1 (default 2)
  --no-soak    skip the soak smoke (suite runs only)
  --help       print this text and exit 0 without running anything
```

Full-suite result at the final code state: `pass=1272 fail=0` (base 1262 + 9 new ci-workflow cases + 1 for the discovered gate file's `GATE SKIP`). `git status --porcelain` was empty after the gate run (nothing under data/ or public/sent_emails/), and the soak scratch directory was removed.

## Task Commits

1. **Task 1 (tracer): test-gate script, `test:gate` script, `--help` case** — `fd67c1b` (feat)
2. **Task 2: workflow + static assertions** — `f2aa9ed` (feat). RED was observed first: 5 workflow cases failed with the file absent, then 9/9 passed once it was created.

The tracer feedback gate was run per the dispatch policy: the tracer's automated verify was re-run end to end (it passed) and execution continued without an interactive checkpoint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `node --test` auto-discovers scripts/test-gate.js and would recurse without end**
- **Found during:** Task 1, before the first gate run
- **Issue:** Node's default test discovery runs any file whose basename starts with `test-`. The plan-mandated name `scripts/test-gate.js` therefore gets launched by `npm test` / `node --test` with no arguments, which would start the gate, which starts the suite, which launches the gate again. Confirmed with a scratch-directory experiment: the discovered run sees `NODE_TEST_CONTEXT=child-v8`.
- **Fix:** Kept the filename (other plans reference it) and added a guard in `main()`: after `--help` and argument validation, if `NODE_TEST_CONTEXT` is set the script prints `GATE SKIP (...)` and exits 0. The gate also deletes `NODE_TEST_CONTEXT` from the env it passes to its own child suite. A test pins the behaviour (`GATE SKIP`, no `run i/N` line). Consequence: the suite count includes this file as one passing entry.
- **Files modified:** scripts/test-gate.js, test/ci-workflow.test.js
- **Commit:** `fd67c1b`

**2. [Rule 2 - Hardening] Soak smoke uses the light settings, not 20 s**
- **Found during:** Task 1
- **Issue:** The plan says `SOAK_PROCESSES=2 SOAK_DURATION_MS=20000`; the dispatch's disk gotcha (host disk at 96%) requires the light set.
- **Fix:** Defaults are `SOAK_PROCESSES=2 SOAK_DURATION_MS=6000 SOAK_WRITE_INTERVAL_MS=400`, applied only when the variable is unset, so `SOAK_DURATION_MS=20000 npm run test:gate` restores the plan's value.
- **Commit:** `fd67c1b`

**3. [Rule 2 - Hardening] Explicit TAP reporter, dual-format parse, cancelled counted as failure**
- **Issue:** The plan says only "parse the TAP summary". Node picks the reporter from TTY-ness, and a cancelled test is not a `fail`.
- **Fix:** The child is started with `--test-reporter=tap`, the parser also accepts the spec reporter's `ℹ fail N` form, and `# cancelled` > 0 fails the run (T-12-05).
- **Commit:** `fd67c1b`

### Scope additions (small)

- Test cases beyond the plan's `--help` case: bad-args, recursion guard, and the package.json script entry. All are cheap, none run the suite.

## Issues Encountered

- `audit-security-events` (known flake, historically about 1 run in 5) did not trip in the 3 full suite runs made here (tracer run + 2 gate runs).
- This worktree lacks the 12-01 `[test-isolation]` guard (parallel plan); the gate worked unchanged and the worktree stayed clean of tracked changes.

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths or schema changes. The workflow is read-only and secret-free (T-12-03 accepted, SHA pinning deferred to Phase 21); the gate's verdict requires a parsed `# fail 0` (T-12-05 mitigated).

## Notes for dependent plans

- 12-14: invoke as `npm run test:gate -- --runs 20` (backgrounded, redirect to a log, append `EXIT=$?`), then assert the log's last non-EXIT line is `GATE PASS runs=20`. A `GATE SKIP` line means the gate was started by the test runner and did nothing.
- 12-07 / 12-09: add `smoke` / `perf` to package.json scripts next to `test:gate`; no conflict with this plan's single added line.
- The workflow has not executed anywhere yet. Its verdict on ubuntu-24.04 and windows-latest is unknown until the first push.

## Self-Check: PASSED

- FOUND: scripts/test-gate.js, .github/workflows/test.yml, test/ci-workflow.test.js, package.json `test:gate`
- FOUND commits: fd67c1b, f2aa9ed
- `git status --porcelain data/ public/sent_emails/` empty; STATE.md and ROADMAP.md untouched
