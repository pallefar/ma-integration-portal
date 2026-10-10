---
phase: 12-data-layer-integrity-performance
plan: 14
subsystem: testing
tags: [evidence, perf, soak, gate, smoke, validation, browser-scenarios]
requires:
  - phase: 12-data-layer-integrity-performance
    provides: "plans 12-01..12-13 and 12-15 merged on the base (perf scripts, test gate, partitions, workspace endpoint, smoke harness)"
provides:
  - "scripts/uat/phase10-scenarios/data-phase12.js: four Phase 12 browser/API scenarios plugged into the Phase 10 runner"
  - "evidence/: perf, gate, soak, smoke, runner, Phase 9 walks, audit verify, load-40 profile, README mapping every file"
  - "12-VALIDATION.md: PRD acceptance 1-7, SC1-8, DATA-01..06 / QUAL-01..02, D-12-01..08, PD-1..PD-31, D-12-02 inventory, open items"
affects: [orchestrator phase-12 verdict, gap-closure planning for load-40 and the Phase 9 asset-stamps scenario]
key-files:
  created:
    - scripts/uat/phase10-scenarios/data-phase12.js
    - .planning/phases/12-data-layer-integrity-performance/12-VALIDATION.md
    - .planning/phases/12-data-layer-integrity-performance/evidence/ (30 files, 376 KB)
  modified: []
key-decisions:
  - "load-40 reported as a gap with measurements and a profile; no script, profile, mix or threshold touched (T-12-132)"
  - "Phase 9 asset-stamps scenario not edited (another plan's module): the 30 FAIL are reported as a conflict between PRD acceptance 7 and D-12-07"
  - "Gate wrapper keeps only summary lines of the 20 TAP streams and adds a real before/after sha256 snapshot using schema-only sentinel files"
requirements-completed: [DATA-01, DATA-03, DATA-04, DATA-05, DATA-06, QUAL-01, QUAL-02]
requirements-partial: [DATA-02]
status: complete-with-gaps
actuals:
  tokens: 150000
  tasks: 3
  commits: 7
---

# Phase 12 Plan 14: Evidence and sign-off - Summary

**Everything the PRD asks to be proven was run on the final tree and logged: three of four performance budgets, the 20x suite gate, soak, smoke, audit verify, the browser scenarios and the Phase 10 runner pass; two items are not green and are reported with measurements - the 40-client event-loop p99 (runs 2 and 3 of the committed profile) and the Phase 9 walk's numeric-stamp scenario that D-12-07 superseded.**

## Results (one line each; detail in `12-VALIDATION.md` and `evidence/README.md`)

| Item | Result | Evidence |
|---|---|---|
| Write latency at 1k/5k/200 | **PASS** raid 14.3 ms, task 2.5 ms median (budget 40; baseline 85.7 / 96.6), 1.0 audit row per create, reorder 0 rows | `perf.log` |
| 10 users x 3 list reads (unparameterized 1.7 MB RAID) | **PASS** p95 145.0 / 155.0 / 158.1 ms (budget 300; baseline 483) | `perf.log` |
| 40-client event-loop p99 | **FAIL runs 2-3**: 86.3 / 112.2 / 133.0 ms (budget 100; baseline 1,921) | `perf.log`, `perf-summary.md` |
| Pack render isolation | **PASS** worst p99 11.4 ms (budget 50; baseline 2,397 blocked), second pack 429 + Retry-After 5 | `perf.log` |
| Suite 20x | **PASS** `GATE PASS runs=20`, 1445/1445 each; data/audit.db*, runtime.db*, demo.db, control.db sha256 identical before/after | `gate.log` |
| Soak (default, 3 procs, 120 s) | **PASS** 8,403 acknowledged, 0 lost, audit 1:1, 0 committed-but-unaudited, 863 conflict-lane acks / 1,783 x 409, chain verifies (9,268 rows) | `soak.log` |
| Smoke | **PASS** 12 visits, 0 errors, axe 37 critical+serious (informational) | `smoke.log` |
| Audit verify | **PASS** soak check 10; synthetic 20k-row legacy migration + `audit-verify --all` over 802 files OK; scratch deal sealed through `audit-admin.js`, `sealed-sha=match`, export verifies, one-byte edit fails | `verify.log` |
| Phase 10 runner (6 lanes, Phase 11 scenarios, demo showcase, 4 new Phase 12 scenarios) | **PASS 695 / 0** (Phase 12: 40 PASS) | `phase10-walk.log` |
| Phase 9 walk `--demo-open` | **PASS 18 / 0** | `phase9-walk-demo-open.log` |
| Phase 9 walk (normal) | **320 PASS / 30 FAIL** - all 30 = scenario `asset-stamps` (see Product findings 2) | `phase9-walk.log` |
| Final full suite | **1445 / 1445, 0 fail** (`node --test`, 37 s) | this run |
| Committed DBs | `data/demo.db`, `data/control.db` sha256 unchanged in every log; `git status --porcelain -- data public/sent_emails` empty | runner `data-integrity` rows, `gate.log` |

## Tasks and commits

| Task | Commit | Content |
|---|---|---|
| 1 (tracer) perf budgets | `a86c8df` | perf.log, perf-summary.md (budget table + load-40 gap analysis), fresh-invocation and cpu-prof diagnostics |
| 2 scenarios | `39864a2`, `5eba124` | `data-phase12.js` (45 PASS standalone), first gate attempt log |
| 2 evidence | `6f512c3`, `775c216`, `d16c8c3` | gate attempts 2-3 + flake re-run, gate.log (PASS), soak, smoke, runner, walks, verify, README |
| 3 validation + summary | `d16c8c3` + the docs commit after it | 12-VALIDATION.md, this file |

The tracer gate policy was followed: the tracer's verify (the budget run) was re-run end to end - it FAILED on load-40, so
the plan HALTED the tracer item ("do not proceed to expansion on a broken foundation") only in the sense required by
the plan text: the gap was recorded, then Tasks 2-3 continued so the rest of the evidence exists.

## Phase 12 scenarios (`data-phase12.js`)

| Scenario | Lane | What it asserts (all from the account's own page session) |
|---|---|---|
| `ddPageOneRequest` | real | the due-diligence page load issues exactly one `/api/dd/` request (`GET /api/dd/workspace`); one status edit adds exactly `POST /api/dd/request-items` + one `GET /api/dd/workspace`; 390 px reload is again one request; no 401/403/5xx, no page error; shots 1440/390 |
| `raidPagedApi` | real | `?limit=5` -> `{items:5,total}`, no params -> bare array, total == array length, second page disjoint, invalid parameter 400 |
| `auditSealFlow` | real | create -> audited writes -> early purge 409 `not-sealed` -> archive -> seal (sha256) -> status `sealed:true, writable:false, fileMatchesSeal:true` -> idempotent re-seal -> viewer `?deal=` rows tagged with the partition + control `deal-archive` / `audit-partition-sealed` -> admin audit tab lists them; shot 1440 |
| `contentHashStamps` | dev | 21 pages, 67 stamped references, 26 URLs: every `?v=` equals the first 16 hex of sha256 of the body fetched through the page; pages `no-cache`; no unstamped local reference |

## Deviations from Plan

### Plan-text adjustments

**1. [Plan accuracy] `npm run perf -- --assert` cannot pass on this tree, and the plan's Task 1 verify (`PERF PASS`) therefore fails.**
The plan expected `EXIT=0`; the script exits 1 on load-40. Handled as the plan's own failure path: numbers recorded,
profiled, proposals written, nothing edited. See `evidence/perf-summary.md`.

**2. [Evidence form] Gate log is a filtered summary stream.** `scripts/test-gate.js` streams the full TAP of 20 runs
(~10 MB); the wrapper kept `run i/N`, `# pass/fail/cancelled`, `not ok` and `GATE` lines and added the before/after
sha256 + size snapshot. To make "byte-identical" meaningful in a worktree where `data/audit.db` / `runtime.db` do not
exist, schema-only sentinel files were created at those paths for the run and removed after (as 12-01 did).

**3. [Attempts] The gate needed four attempts.** Attempts 1-3 ran 10 / 7 / 6 consecutive green runs and were broken by
external host-load spikes (other sessions' `next build`, a Docker VM and a crash-looping gateway pushed the 1-minute
load average to 31 / 87 / 105; later to 467). The failing tests pass alone. All four logs are kept. Attempt 4 passed
all 20 runs while the load rose past 400 (runs stretched from 20 s to ~110 s).

**4. [Evidence form] Runner output kept as logs plus three shots.** The Phase 10 / Phase 9 runners write ~30
screenshots each into `--out`; they were pointed at a scratch directory and only the logs and the three `p12-*` shots were
copied, to stay under the 1,200 KB evidence cap (376 KB used).

**5. [Addition] `evidence/diagnostics/verify-scratch-deal.js`** (a small script, not a product file) builds the store-driven
sealed scratch deal the plan asks for in `verify.log`; `profile-load40.js`, `analyze-prof.js`, `by-route.js` are the
load-40 diagnostics.

No product code, STATE.md or ROADMAP.md was changed.

## Product findings

1. **load-40 event-loop p99 over budget in runs 2 and 3 (DATA-02 / SC2 / PRD acceptance 2).** Measured and profiled in
   `evidence/perf-summary.md`. Short form:
   - `scripts/perf/load-40.js` keeps one deal across `--runs 3` and 25 % of the mix is `POST /api/raid`; the list grows
     40 -> ~3,700 -> ~5,300 -> ~6,500 rows, so run 2 and 3 measure a much larger list than run 1 (318 -> 144 -> 106 rps).
   - Three fresh single-run invocations: 77.1 / 110.9 / 149.8 ms - run 1 itself is host-noise sensitive.
   - Under the unmodified mix the main thread is saturated (idle 0.5 %). `GET /api/raid` 47-49 % and `POST /api/raid`
     36-37 % of main-thread time; tasks/employees/healthz < 2 %.
   - `POST /api/raid` is O(lane) on the CPU: `readCollections` parses every row of both RAID lanes (store.js:406 + :392,
     ~16 %) and `writeDb()` stringifies every loaded item to find the untouched ones (store.js:637, 16 %) - ~13 ms of main
     thread per create at 5.3k rows. `GET /api/raid` pays SELECT + 2 x `json_extract` + one object per row (store.js:455,
     ~25 %), plus the SHA-1 ETag (4.9 %) and the UTF-8 encode (4.7 %) of the 1.7-3 MB body inside `res.send`.
   - Proposed minimal changes (orchestrator's call): (1) a single-record write path in the store for RAID/task
     create/update/delete; (2) set a cheap `ETag` (or send a Buffer) on the list responses; (3) restate the profile (fresh
     deal per run, or the paged form).
2. **Phase 9 walk (normal) `asset-stamps`: 30 FAIL.** The scenario (`scripts/uat/phase9-scenarios`) asserts for each page
   and asset "one numeric stamp", "stamp matches the page on disk" and "stamp > pre-gap-closure value". With D-12-07 the
   stamp is `?v=<16 hex sha256 prefix of the served bytes>` (e.g. `/css/style.css?v=0a15d3862f10cf25`), so three
   assertions x ten assets fail while "requested" and "200" pass. Repro: `PLAYWRIGHT_PATH=<...> node
   scripts/uat/phase9-walk.js --out <dir>`; filter the log for `FAIL`. Intent is covered by stronger Phase 12 proofs
   (`test/asset-cache-bust.test.js`, `contentHashStamps`). PRD acceptance 7 ("Phase 9 walks unchanged") and D-12-07
   cannot both hold literally; the scenario module is another plan's, so it was not edited.
3. **Suite flakes appear only under heavy host load**, and `test/soak-correlator.test.js` "a real 2-process smoke run"
   can hang the file ~10 min once its 80 s kill leaves orphaned grandchildren holding the test's stdout pipe
   (`evidence/gate-attempt1-run11-hang.log`). It passes alone in 7 s (3 of 3).
4. **The suite tightens the committed `data/control.db` file mode to 0600** (accounts-writable-gate / real-mode-guards
   open it under the 12-01 opt-in; `chmodPrivateFile` is tightening-only). Bytes and git status are unchanged; the
   mode was restored to 0644 in this worktree between runs.

## Known Stubs

None.

## Threat Flags

None. Evidence runs used `os.tmpdir()` scratch trees only; committed demo/control hashes are unchanged in every log
(T-12-130); logs and shots are synthetic and path-scrubbed (T-12-131); no budget, script or threshold was edited (T-12-132).
One earlier commit in this branch (`gate.log`, first version) contains a scratchpad path with the project directory slug;
the file was scrubbed in the final commit.

## Self-Check: PASSED

- `scripts/uat/phase10-scenarios/data-phase12.js`, `12-VALIDATION.md`, `evidence/README.md`, `evidence/gate.log` (ends
  `GATE PASS runs=20` / `EXIT=0`), `evidence/perf.log`, `evidence/soak.log`, `evidence/smoke.log`,
  `evidence/phase10-walk.log`, `evidence/phase9-walk.log`, `evidence/phase9-walk-demo-open.log`, `evidence/verify.log`: present.
- `du -sk evidence` = 376 KB (<= 1200); `git status --porcelain -- data public/sent_emails` empty; STATE.md and ROADMAP.md untouched.
- Self-Check of the plan's Task 2 verify: **NOT all logs end `EXIT=0`** - `phase9-walk.log` ends `EXIT=1` (finding 2);
  Task 1's `PERF PASS` is absent (finding 1). Both are reported, not hidden.
