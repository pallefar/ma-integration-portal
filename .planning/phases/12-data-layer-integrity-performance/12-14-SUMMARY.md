---
phase: 12-data-layer-integrity-performance
plan: 14
subsystem: testing
tags: [evidence, perf, soak, gate, smoke, validation, browser-scenarios, review-remediation]
requires:
  - phase: 12-data-layer-integrity-performance
    provides: "plans 12-01..12-13 and 12-15 merged on the base (perf scripts, test gate, partitions, workspace endpoint, smoke harness) + the 16 code-review fixes (12-REVIEW-FIX.md)"
provides:
  - "scripts/uat/phase10-scenarios/data-phase12.js: four Phase 12 browser/API scenarios plugged into the Phase 10 runner"
  - "evidence/: perf, gate, soak, smoke, runner, Phase 9 walks, audit verify, README mapping every file - REFRESHED on the post-review-fix tree"
  - "12-VALIDATION.md: PRD acceptance 1-7, SC1-8, DATA-01..06 / QUAL-01..02, D-12-01..08, PD-1..PD-31, D-12-02 inventory, review remediation map, open items"
  - "scripts/perf/load-40.js: each run on a fresh scratch deal + server (the R2 profile shape)"
affects: [orchestrator phase-12 verdict, validation/verify of phase 12]
key-files:
  created:
    - scripts/uat/phase10-scenarios/data-phase12.js
    - .planning/phases/12-data-layer-integrity-performance/12-VALIDATION.md
    - .planning/phases/12-data-layer-integrity-performance/evidence/
  modified:
    - scripts/perf/load-40.js
    - scripts/uat/phase9-scenarios/f8-stamps.js
    - test/soak-correlator.test.js
key-decisions:
  - "load-40 restated (orchestrator decision 1): every run on a FRESH scratch deal + server; mix, duration, clients and the 100 ms p99 budget untouched; quiet host required"
  - "Phase 9 asset-stamps scenario deliberately re-stated (orchestrator decision 2) to the D-12-07 content-hash contract; requested/200 assertions kept, check count per asset unchanged so the walk stays 350"
  - "soak-correlator real smoke spawns the harness detached and kills the process group (watchdog + finally) with a guard test (orchestrator decision 3)"
  - "data/control.db 0600 tightening by the suite accepted (finding 4); gate wrapper restores 0644"
requirements-completed: [DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, QUAL-01, QUAL-02]
status: complete
actuals:
  tokens: 150000
  tasks: 3
  commits: 7
refresh_actuals:
  tokens: 85000
  tasks: 4
  commits: 6
---

# Phase 12 Plan 14: Evidence and sign-off - Summary (refreshed 2026-10-11 on the post-review-fix tree)

**Every PRD budget and gate was re-run on the tree that includes the 16 review fixes and is green: `PERF PASS` (load-40 p99 93.9 / 89.7 / 90.8 ms, each run on a fresh deal), `GATE PASS runs=20` at 1,459 / 1,459, soak 10,451 acknowledged / 0 lost, smoke 0 errors, Phase 10 runner 695 / 0, Phase 9 walk 350 / 0 and demo-open 18 / 0. Two things are reported, not hidden: load-40 passes with a 6-10 % margin and only on a quiet host, and review fix WR-01 made migration #1's one-time boot ~15x slower on an 800-deal tree (a product finding with a repro).**

## Results on the post-fix tree (detail in `12-VALIDATION.md` and `evidence/README.md`)

| Item | Result | Evidence |
|---|---|---|
| Write latency at 1k/5k/200 | **PASS** raid 13.4 ms, task 5.0 ms median (budget 40; baseline 85.7 / 96.6), 1.0 audit row per create, reorder 0 rows - with WR-01's audit `synchronous=FULL`+`fullfsync` in place | `perf.log` |
| 10 users x 3 list reads (1.7 MB RAID) | **PASS** p95 115.2 / 108.4 / 103.5 ms (budget 300; baseline 483) | `perf.log` |
| 40-client event-loop p99, **fresh deal per run** | **PASS** 93.9 / 89.7 / 90.8 ms (budget 100; baseline 1,921), host load1 4.9-9.1 | `perf.log`, `perf-summary.md` |
| Pack render isolation | **PASS** worst p99 9.6 ms (budget 50; baseline 2,397 blocked), second pack 429 + Retry-After 5 | `perf.log` |
| Suite 20x (+ 2-process soak smoke) | **PASS** `GATE PASS runs=20`, 1,459 / 1,459 each, first attempt, host load 20-55; data/ sha256 snapshot identical | `gate.log` |
| Soak (default, 3 procs, 120 s) | **PASS** 10,451 acknowledged, 0 lost, audit 1:1, 0 committed-but-unaudited, 1,003 conflict-lane acks / 2,085 x 409 / 0 x 503, chain verifies (11,456 rows) | `soak.log` |
| Smoke | **PASS** 12 visits, 0 errors, axe 37 critical+serious (informational) | `smoke.log` |
| Audit verify | **PASS** soak check 10; synthetic 20k-row legacy migration + `audit-verify --all` over 802 files OK; sealed scratch deal `sealed-sha=match`, export verifies, one-byte edit fails | `verify.log` |
| Phase 10 runner (6 lanes, Phase 11 + Phase 12 scenarios, demo showcase) | **PASS 695 / 0** (Phase 12 scenarios: 40 PASS) | `phase10-walk.log` |
| Phase 9 walk (normal) | **PASS 350 / 0** (asset-stamps re-stated, below) | `phase9-walk.log` |
| Phase 9 walk `--demo-open` | **PASS 18 / 0** | `phase9-walk-demo-open.log` |
| Committed DBs | `data/demo.db`, `data/control.db` sha256 unchanged in every log; `git status --porcelain -- data public/sent_emails` empty at every commit | runner `data-integrity` rows, `gate.log` |

## Tasks and commits (this refresh; the original 12-14 commits are in the table below)

| Task | Commit | Content |
|---|---|---|
| R1 load-40 fresh deal per run (decision 1) | `8d5bed5` | `scripts/perf/load-40.js`: `--runs N` re-invokes itself per run (own scratch, deal, seed, server); load printed beside each run |
| R2 asset-stamps contract (decision 2) | `667285d` | `scripts/uat/phase9-scenarios/f8-stamps.js` only |
| R3 soak-correlator process group (decision 3) | `8fbfda7` | `test/soak-correlator.test.js`: detached spawn + group kill + guard test |
| R4 evidence refresh | `3507386` | `evidence/*.log` + `p12-*.jpg` re-run on the post-fix tree; noisy-host attempt kept |
| R5 docs | next commit | `12-VALIDATION.md` (refresh + review remediation map), `evidence/README.md`, `evidence/perf-summary.md`, this file |

Original 12-14 commits: `a86c8df` (perf), `39864a2` / `5eba124` (scenarios), `6f512c3` / `775c216` / `d16c8c3` (evidence), the
docs commit after it.

## Decisions applied

1. **load-40 (finding 1).** `load-40.js --runs 3` reused one deal, so runs 2-3 measured a RAID list ~15x larger than the R2
   profile. Each run now gets its own mkdtemp scratch, deal, 40-record seed and server (child process per run; the parent
   aggregates; `--assert` fails on any run). Mix, 45 s, 40 clients and the 100 ms budget unchanged. Measured on a quiet host
   (1-minute load 4.87, 5-minute 14.71 at start): 93.9 / 89.7 / 90.8 ms. No main-thread profile was needed because the
   budget held; the pre-refresh profile is kept in `perf-summary.md` (history) with the pre-identified next steps should a
   quiet-host run ever miss.
2. **Phase 9 `asset-stamps` (finding 2).** Deliberate edit of one scenario module. The superseded assertions per asset (one
   numeric stamp / matches the page on disk as a number / > pre-gap floor) are replaced by: one stamp matching
   `/^[0-9a-f]{16}$/`; equals the stamp in the page HTML as served; equals the first 16 hex of sha256 of the bytes the
   server returns for that asset URL. "Requested" and "200" are unchanged. The checked-in HTML still carries legacy numeric
   stamps (the server rewrites them at serve time), which is why "matches the page" compares against the page as served.
   Standalone scenario run: 56 PASS / 0; full walk 350 / 0.
3. **soak-correlator (finding 3).** The real 2-process smoke is spawned `detached` and the group is killed on the 80 s
   watchdog and in `finally`; a guard test spawns a process with a grandchild and proves the group kill reaps it (15.8 s
   file, 5/5).
4. **control.db 0600 (finding 4).** Accepted and noted in the README and validation Open items 3.

## Deviations from Plan

**1. [Evidence quality] First perf attempt on a noisy host failed every budget and was kept, not used.** It started at load1
13.4 / load5 30; write median 67.8 ms, list p95 374-583 ms, load-40 p99 216-244 ms, with its own sequential informational
numbers 3-5x slower than the quiet-host run. The wrapper was changed to wait for load1 < 10 AND load5 < 15 and the quiet-host
run is the evidence. The failed attempt is `evidence/perf-attempt1-noisy-host.log`.

**2. [Evidence form] Gate wrapper and runner outputs** as in the original 12-14: summary lines of the 20 TAP streams plus a
before/after sha256 snapshot with schema-only sentinel files at `data/audit.db` / `data/runtime.db`; screenshots only for the
three `p12-*` shots (evidence dir ~390 KB of a 1,200 KB cap). The gate started after a 900 s wait for quiet gave up (load 20)
and still passed first time; the budget runs are the only ones held to the quiet-host rule.

**3. [Scratchpad hygiene] The shared scratchpad directory held files from earlier sessions; the chain script's `rm -f` of
its own log names removed same-named scratch copies of earlier runs.** The committed evidence copies were unaffected.

No product code (db/, lib/, server.js, public/) was edited. STATE.md and ROADMAP.md were not touched.

## Product findings

1. **Migration #1 boot cost rose ~15x after review fix WR-01 (audit `synchronous=FULL` + `fullfsync=ON`).**
   Repro: `node scripts/perf/legacy-audit-migration.js --rows 20000` (800 deal partitions). `migration_ms`: **2,010** in the
   original evidence run vs **30,241** and **31,337** on the fixed tree (two runs, host load 5-6); extrapolated 5 GB
   8.1 min -> ~2 h. A micro-benchmark of the same shape (800 partition files, one create + 3 commits each, same host):
   `synchronous=NORMAL` 719 ms vs `FULL + fullfsync` 19,501 ms - one drive-cache flush per commit, so the cost scales with
   the number of partitions / transactions, not rows. No PRD budget covers migration time, and a real tree has far fewer
   deals (~100 deals -> roughly 2-4 s instead of ~0.1-0.3 s), so no budget failed; but it changes the boot-time profile that
   12-13 documented (150,000 rows: 6.4 s). Suggested mitigation (orchestrator's call): run migration #1's partition writes
   under `synchronous=OFF`/`NORMAL` and finish each file with one `wal_checkpoint(TRUNCATE)` + fsync; `.pre-v1.bak` already
   protects the source. Evidence: `evidence/verify.log` section 2, `12-VALIDATION.md` Open items 5.
2. **load-40 passes with a thin, host-sensitive margin.** 89.7-93.9 ms vs 100 ms on a quiet host (216-244 ms on a host
   averaging load 30). The profile's three runs are each on a fresh deal, as the R2 profile specified. If a future quiet-host
   run misses, the store-level single-record write path and a cheap list `ETag` are the pre-identified changes
   (`perf-summary.md` history). Open items 6.

## Review remediation (summary; full map in `12-VALIDATION.md`)

16 findings, 15 fixed + 1 accepted (IN-B06, fail-closed by design), each with a regression test: CR-01 `2a19082`, WR-01
`15d989d`/`d933041`, WR-02 `739a648`, WR-03 `145f5c1`, IN-01 `da61b1a`/`a197b79`, IN-02 `5a36aee`, IN-03 `8e55a0a`, WR-B01
`c2d8f2a`, WR-B02 `713cbd9`, WR-B03 `080314d`, IN-B01 `85da5c6`, IN-B02 `0206359`, IN-B03 `437d5bb`, IN-B04 `5bbf5bf`, IN-B05
`af1c428`, IN-B06 accepted `1cde6c9`, stale migrate.js header `d142472`. Modified-test list vs the 12-14 original: `db-file-layout`
(Phase 1 pragma contract, deliberately updated by WR-01) and `soak-correlator` (this refresh).

## Known Stubs

None.

## Threat Flags

None. Evidence runs used `os.tmpdir()` scratch trees only; committed demo/control hashes are unchanged in every log
(T-12-130); logs and shots are synthetic and path-scrubbed (T-12-131; the scrub is a script that fails on residue); no
budget, mix, duration or threshold was edited (T-12-132) - the load-40 change is a profile restatement decided by the
orchestrator and recorded above.

## Self-Check: PASSED

- `evidence/perf.log` ends `PERF PASS` / `EXIT=0`; `gate.log` ends `GATE PASS runs=20` / `EXIT=0`; `soak.log`,
  `smoke.log`, `phase10-walk.log`, `phase9-walk.log`, `phase9-walk-demo-open.log`, `verify.log` end `EXIT=0`.
- `du -sk evidence` ~390 KB (<= 1200); no `/Users/`, user name or scratch path in any log (scrub residue check clean);
  `git status --porcelain -- data public/sent_emails` empty; STATE.md and ROADMAP.md untouched.
- Commits `8d5bed5`, `667285d`, `8fbfda7`, `3507386` exist on the branch.
