---
phase: 09-optimistic-locking-conflict-recovery
plan: 08
subsystem: concurrency / optimistic locking (gap closure)
status: complete
tags: [conc-02, gap-closure, r7-f1, version-precondition, playwright-harness]
requires: [09-01..09-07 conflict machinery]
provides:
  - window.maVersionOf (client precondition helper)
  - conflictIfStale() requirePrecondition opt-in + VERSION_REQUIRED_MESSAGE (400 versionRequired)
  - scripts/uat/phase9-walk.js Playwright two-context harness + scenario loader
  - test/helpers/held-version.js (23-route table, installHeldVersionFetch)
affects: [09-09 (per-family opt-in), 09-10 (fold into conflictIfStale), 09-11..09-16 (scenario modules)]
tech-stack:
  added: []
  patterns: [fail-closed non-demo predicate (req.isDemo !== true), opt-in rollout flag removed by 09-10]
key-files:
  created:
    - test/optimistic-locking-precondition.test.js
    - test/client-version-precondition.test.js
    - test/helpers/held-version.js
    - scripts/uat/phase9-walk.js
    - scripts/uat/phase9-scenarios/f1-raid.js
    - .planning/phases/09-optimistic-locking-conflict-recovery/evidence/09-08/ (results.json, walk.log, raid-f1-1440.png, raid-f1-390.png)
  modified:
    - server.js
    - public/js/transitions.js
    - public/js/execution.js
    - scripts/soak.js
    - test/optimistic-locking-contract.test.js
    - test/dd-findings.test.js
key-decisions:
  - "Opt-in requirePrecondition on the two RAID routes only (GD-2); universal rule is plan 09-10."
  - "Fail-closed predicate req.isDemo !== true (GD-1b): deal-bound or context-less requests are strict, demo store lenient."
  - "versionRequired 400 body is exactly {error, versionRequired} (T-09-37)."
requirements-completed: [CONC-02]
duration: ~1h
completed: 2026-10-10
actuals:
  tokens: 60000
  tasks: 3
  commits: 4
---

# Phase 9 Plan 08: RAID first-co-edit precondition (R7 F-1 tracer) Summary

A never-edited RAID entry's first concurrent status flip or delete is now caught end-to-end: the client always sends `window.maVersionOf(held)` (0 for a version-less record), a precondition-less RAID write/delete is refused 400 `{error, versionRequired}` in every non-demo request, and a real two-browser walk shows the conflict dialog where R7 saw a silent clobber.

## Accomplishments

- **Client:** `window.maVersionOf(rec)` inside the `ma-fetch-wrapper` region of transitions.js (non-negative integer else 0); RAID status flip and RAID delete in execution.js send it unconditionally (the two conditional-omit branches are gone).
- **Server:** `VERSION_REQUIRED_MESSAGE` + a precondition-required branch in `conflictIfStale()` (`opts.requirePrecondition` AND record AND `req.isDemo !== true` -> 400 `{error, versionRequired:true}`), wired on POST /api/raid (update branch) and DELETE /api/raid/:id. Demo store stays lenient; nothing stamped on INSERT/read/boot (D-09).
- **Harness:** `scripts/uat/phase9-walk.js` boots an isolated copy-of-data server (five MA_* paths, DEMO_OPEN/ADMIN_TOKEN removed), creates a deal with karen+pmo, opens per-tab logged-in deal-selected contexts, records every non-GET /api call and native dialog, sha256-checks the committed data/demo.db* + data/control.db*, and auto-loads scenario modules from `scripts/uat/phase9-scenarios/`.
- **Scenarios:** `raid-f1`, `raid-delete-f1`, `api-version-required` (module `f1-raid.js`).
- **Test infra:** `test/helpers/held-version.js` (23-route table cross-checked against server.js by H1, `installHeldVersionFetch()` only fills ABSENT preconditions); installed in dd-findings only.
- **Tests added:** P1-P7, H1-H2 (optimistic-locking-precondition), C1-C2 (client-version-precondition).

## Verification

| Check | Result |
|---|---|
| P3 red before server change | observed: `expected 400, actual 200` (then green) |
| P5 + C2 red before delete change | observed failing (then green) |
| H1 negative | with `POST /api/dd/findings/:id/convert` removed from the table: `server.js routes calling conflictIfStale( that test/helpers/held-version.js does not list: POST /api/dd/findings/:id/convert` (restored) |
| `node --test` (full suite) | 791 tests, 791 pass, 0 fail (baseline 779) |
| `node --test test/optimistic-locking-cross-process.test.js` | pass, file unmodified |
| client-busy-retry / client-conflict-dialog / client-xss-sinks | 29/29 pass |
| CR-01 (c) arming test | pass (arming block untouched, still before any return) |
| `SOAK_DURATION_MS=15000 npm run soak` | PASS: acknowledged=1225 missing=0 mismatched=0, 0 committed-but-unaudited, audit 1:1 (1225/1225), conflict lane 107 acked / 242 x 409, version reconciles 1 -> 108 |
| Walk (all 3 scenarios) | 20 PASS / 0 FAIL incl. `data-integrity` (2 committed DB files identical); evidence in `evidence/09-08/` |

Walk PASS rows required by the plan: raid-f1 "B request carries version 0", "B response 409 conflict:true", "one overlay", "status row present", "fit at 390"; raid-delete-f1 "DELETE carries expectedVersion=0", "409 stale-delete dialog", "entry survives Cancel"; both api-version-required refusals; data-integrity.

Flakes observed (R5-02, all passed on isolated re-run, none reproduced in the final full runs): baseline run 2 failures (not identified); one run with synergy-staleness (m) + write-validation (a); one run with deal-wizard (u). Final full run 791/791.

## Task Commits

| Task | Commit | Description |
|---|---|---|
| 1a (tracer) | `6884e2c` | maVersionOf + server versionRequired branch + RAID flip + P1-P4 + repaired contract (1)/(3)/(36)/Part 3 + dd-findings (j) |
| 1b (tracer) | `a0215cf` | Playwright harness + raid-f1 scenario |
| 2 | `8b7b41a` | RAID delete precondition, P5-P7, C1-C2, contract (43), raid-delete-f1 + api-version-required scenarios |
| 3 | `eb6155e` | held-version helper, H1-H2, dd-findings install, soak baseline `version: 0` |

## Deviations from Plan

**1. [Ordering] Test repairs landed with the change that breaks them, not in Task 3.**
- The gotcha "suite green at every commit" conflicts with the plan placing the six repairs in Task 3 while the server change lands in Task 1. Repaired contract (1)/(3)/(36)/Part 3 and dd-findings (j) in commit `6884e2c` with an explicit `version: 0` (no assertion about stale writes weakened) and contract (43) in `8b7b41a` (the DELETE opt-in is what breaks it). Task 3 still adds `installHeldVersionFetch()` to dd-findings and the helper per plan; (j) keeps its explicit `version: 0`.

**2. [Observation] contract (43) did not fail after the Task 1 server change** (it only breaks once DELETE opts in, Task 2) — it was repaired in Task 2 accordingly. The plan's "six tests" are therefore five at Task 1 plus (43) at Task 2.

**3. [Tracer gate] No human-verify checkpoint.** Auto mode flags read `false`, so the interactive tracer gate would normally STOP. The tracer's `<verify>` is fully automated (node test + Playwright walk), plan frontmatter is `autonomous: true`, and the orchestrator instructed complete execution; both verifies were re-run after commit 1b and again at the end (all PASS), which is the gate's purpose (no expansion on a broken foundation).

**4. [Scope-adjacent] Evidence directory** `.planning/phases/09-.../evidence/09-08/` added (results.json, walk.log, two screenshots, ~245 KB) so the walk is reproducible proof; plan did not name a location.

**Total deviations:** 4 (1 ordering, 1 observation, 1 gate interpretation, 1 evidence artifact). **Impact:** none on behaviour or scope.

## Known Stubs

None.

## Threat Flags

None. T-09-36/37 mitigated (P3/P5 exact-key-set assertions); T-09-39 mitigated (data-integrity PASS, temp copies only); T-09-40 mitigated (H1/H2, helper not installed by explicit-contract suites).

## Notes for downstream plans

- The harness's scenario runner and `ctx` API (`openTab`, `waitDialog`, `fitCheck`, `shot`, `check`, `api`, `seeder`, `deal`) are stable; add a new module per plan, never edit another plan's module. Identify dialog rows by mine/theirs values, not labels.
- `raid-f1`'s status row reads `mine == theirs` because both tabs flip open -> mitigating; it still proves detection (409 + dialog), and A's write survives.
- `requirePrecondition` is deliberately an opt-in on exactly two routes; 09-09 extends, 09-10 folds into `conflictIfStale()` and deletes the option.

## Self-Check: PASSED

- Files found: test/optimistic-locking-precondition.test.js, test/client-version-precondition.test.js, test/helpers/held-version.js, scripts/uat/phase9-walk.js, scripts/uat/phase9-scenarios/f1-raid.js.
- Commits found: 6884e2c, a0215cf, 8b7b41a, eb6155e.
- No .db / -wal / -shm staged or committed; `git status` shows no data/ changes.
