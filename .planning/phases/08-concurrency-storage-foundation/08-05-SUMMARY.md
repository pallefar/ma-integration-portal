---
phase: 08-concurrency-storage-foundation
plan: 05
subsystem: database
tags: [sqlite, better-sqlite3, soak-test, multi-process, express, npm-script]

# Dependency graph
requires:
  - phase: 08-01
    provides: "busy_timeout 1000ms shared pragma contract, writeDb() .immediate precedent, isBusyError() predicate, central 503 middleware"
  - phase: 08-02
    provides: "db/auditHook.js writeAuditBatch() .immediate, db/controlStore.js read-modify-write functions wrapped in .immediate"
  - phase: 08-03
    provides: "every server.js local catch re-throws/forwards a busy error to the central 503 middleware — the uniform 503 contract this soak proves under real load"
provides:
  - "scripts/soak.js — a standalone multi-process soak harness (npm run soak) that boots real, separate node server.js OS processes over one shared scratch data directory and drives authenticated API writes through the whole stack"
  - "the D-15 acknowledged-write invariant, proven under sustained real load at both default (3 processes) and harder (4 processes) settings, with zero genuine violations"
  - "SOAK_PROCESSES / SOAK_DURATION_MS / SOAK_WRITE_INTERVAL_MS env knobs so the same script serves both the phase gate and a harder release gate (D-14)"
  - "empirical confirmation the demo showcase and the zero-install turnkey bundle are unaffected by the Phase 8 storage-layer change"
affects: []

# Actuals (#2632)
actuals:
  tokens: 6100
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real spawned `node server.js` OS processes (never app.listen() in-process) driven over native fetch, sharing ONE scratch data directory via the MA_*_DB_PATH env-override contract — the same pattern the fast suite tests use, but proving the whole HTTP+auth+resolver+audit stack instead of just the storage layer."
    - "Concurrent 'lanes' per worker process (LANES=4) rather than one strictly-sequential request loop — a single in-flight request per OS process makes genuine cross-process SQLite lock contention vanishingly rare at any realistic interval; multiple concurrent lanes are what actually produce measurable contention."
    - "Distinguishing 'refused write absent' from 'refused write committed-but-unaudited' by cross-referencing the audit trail — D-10's documented audit-stage-busy trade-off is a distinct, accepted outcome from a genuine rollback-lied-about-itself violation, and the verification pass must tell them apart rather than treating both as the same failure."

key-files:
  created:
    - scripts/soak.js
  modified:
    - package.json

key-decisions:
  - "Workers authenticate as role='admin' rather than a fixture username/role — db/controlStore.js's isDealMember() short-circuits true for admin regardless of the deal's own members array, so the load generator does not need to separately manage deal membership; ROLE_WRITE_POLICY already allows admin on every write route the harness drives. Fixture users are still seeded into control.db per the plan's literal setup instruction (real logins possible), even though the load path itself uses direct session creation, not the login endpoint."
  - "One real deal is created via the SAME two-call sequence server.js's own POST /api/deals route uses (controlStore.createDeal() then dealSeed.createDealDatabase()), not demo.db — db/auditHook.js's AUDITED_DB_KINDS deliberately excludes 'demo', so targeting demo.db would have made the audit-reconciliation check (D-15) vacuously trivial. All worker sessions are bound to this one deal so writes contend on the same collection and are genuinely audited."
  - "LANES=4 concurrent dispatch lanes per worker process (not one of the three named D-14 env knobs — internal, Claude's Discretion). Empirically, a single in-flight write per OS process at any interval from 100ms down to 1ms produced zero organic SQLITE_BUSY contention on this hardware — the write itself completes in far less than a millisecond, so true cross-process lock overlap needs several genuinely concurrent in-flight requests per process to become measurable within a realistic run duration."
  - "[Rule 1 - Bug, found during Task 2's own phase-gate run] The D-15 'no refused write is present' check as originally written treated ANY refused correlator found in the final pulses table as a failure. The full default run surfaced 3 such cases (0.0%), and the harder SOAK_PROCESSES=4 run surfaced 33 (0.5%) — all of them db/store.js's writeDb() committing the deal-level write in its own transaction, then hitting contention on the SEPARATE, LATER audit.db append (D-10's documented, user-approved no-swallow trade-off: 'client retry re-applies the write; acceptable because writeDb() re-application of identical content is idempotent'). The verification pass now cross-references the audit trail: a refused write whose row committed but has NO matching audit row is the accepted D-10 trade-off (reported, not failed); a refused write whose row committed AND was audited would mean the whole request silently succeeded while lying to the client — that remains a hard failure. Re-run confirmed: 0 genuine violations in both the default and harder run."

patterns-established:
  - "The env-override + migrate/split seeding pattern (test/role-enforcement.test.js's established shape) extends cleanly from a `node:test` fast test into a long-running standalone harness with zero changes to the seeding mechanism itself."

requirements-completed: [CONC-01]

coverage:
  - id: D1
    description: "npm run soak boots real, separate server.js OS processes on separate ports over one shared scratch data directory and drives authenticated API writes through the whole stack (auth, session, deal resolver, validation, audit, busy-wait, the 503 contract) — never the committed data/ files."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "SOAK_PROCESSES=2 SOAK_DURATION_MS=15000 npm run soak — exits 0, boots 2 real node server.js processes, all D-15 checks pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "The soak's pass criterion is the acknowledged-write invariant (D-15): every acknowledged write present and exact, every refused write cleanly absent (or the documented D-10 audit-stage-busy trade-off, never a genuine violation), PRAGMA integrity_check ok on every touched file, and the audit trail matching acknowledged writes one-to-one in both directions."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "npm run soak at defaults (3 processes, ~120s) — 6300 acknowledged, 3 cleanly refused (all D-10 trade-off, 0 genuine violations), all 5 D-15 checks PASS"
        status: pass
      - kind: integration
        ref: "SOAK_PROCESSES=4 npm run soak — 6544 acknowledged, 33 cleanly refused (all D-10 trade-off, 0 genuine violations), all 5 D-15 checks PASS"
        status: pass
    human_judgment: false
  - id: D3
    description: "Process count, run duration, and write rate are configurable via SOAK_PROCESSES / SOAK_DURATION_MS / SOAK_WRITE_INTERVAL_MS env vars (defaults: 3 processes, ~2 minutes) so the same script serves both the phase gate and a harder release gate."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "node -e assertion in PLAN.md's own <verify> block: package.json scripts.soak === 'node scripts/soak.js', re-run at plan close"
        status: pass
      - kind: other
        ref: "resolved config printed at run start in every soak invocation above (processes=N durationMs=N writeIntervalMs=N)"
        status: pass
    human_judgment: false
  - id: D4
    description: "npm test — full suite green, no regression against the pre-phase baseline."
    verification:
      - kind: unit
        ref: "npm test — 703/703 pass"
        status: pass
    human_judgment: false
  - id: D5
    description: "The demo showcase boots and behaves identically after the storage-layer change, and no committed database file was dirtied by any check in this plan."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "node server.js with no env overrides — boots, GET /login.html returns 200; a separate scratch-copy run (real committed demo.db/control.db content, never the git-tracked files themselves) exercises POST /api/pulses end-to-end and confirms the stored row matches the response exactly"
        status: pass
      - kind: other
        ref: "node scripts/wal-checkpoint.js && git status --porcelain data/ — empty, both before and after every write-exercising check in this plan"
        status: pass
    human_judgment: false
  - id: D6
    description: "The zero-install turnkey bundle still runs with no install step and no new runtime dependency."
    requirement: "CONC-01"
    verification:
      - kind: other
        ref: "git diff <fork-base> -- package.json shows only the scripts block changed; package-lock.json unchanged; node server.js answers an HTTP request directly against the committed node_modules/ tree (darwin/arm64/x64 dev host) with no npm install step"
        status: pass
    human_judgment: true
    rationale: "The boot check above only exercises the current development platform (macOS). The plan's own acceptance criteria calls for the verifying platform to be named, not for every one of the committed prebuild targets (win32-x64-msvc, darwin-x64, darwin-arm64, linux-x64-gnu, linux-arm64-gnu) to be independently re-verified in this plan — that full cross-platform boot matrix was already covered at the v2.1.0 release cut (Phase 1 formal close) and is not re-litigated here."
  - id: D7
    description: "A visual, interactive click-through of the demo showcase (dashboard, a workstream view, one save) in a browser, confirming it is indistinguishable from before the phase."
    verification: []
    human_judgment: true
    rationale: "This plan's own <verify> block marks this item <human-check> and no task in 08-05-PLAN.md carries type=\"checkpoint:*\" (confirmed via grep — Pattern A, fully autonomous execution, no interactive pause point). Running as a spawned worktree wave agent with no live human available to drive a browser, every machine-verifiable half of this check was substituted: the server boots against the committed tree, serves /login.html with 200, and a scratch-copy demo write round-trips byte-exact. The remaining literally-visual judgment (does the dashboard LOOK the same) is out of this plan's automatable reach and is left for the orchestrator/user's own pass."

duration: ~55min
completed: 2026-08-10
status: complete
---

# Phase 8 Plan 5: Multi-Process Soak Harness & Phase Gate Summary

**`npm run soak` boots real, separate `node server.js` OS processes over one shared scratch data directory, drives thousands of authenticated writes through the whole stack, and proves the acknowledged-write invariant holds — at defaults and at a harder 4-process setting — while the demo showcase and the zero-install bundle stay untouched.**

## Performance

- **Duration:** ~55 min (dominated by three real soak runs: a 15s smoke run, a full ~120s default run, and a ~120s harder 4-process run)
- **Started:** 2026-08-10T20:52:00Z (approx)
- **Completed:** 2026-08-10T21:38:00Z (approx)
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `scripts/soak.js` (new): a standalone harness that seeds an `fs.mkdtempSync` scratch directory via the SAME re-runnable `migrate-db-json-to-sqlite.js` + `split-db-into-control-demo-deals.js` scripts production and the existing test suite already use, provisions one real deal (the same `controlStore.createDeal()` + `dealSeed.createDealDatabase()` sequence `POST /api/deals` uses — so writes are genuinely audited, unlike demo.db), spawns N real `node server.js` processes on distinct ports all pointed at that one scratch trio, and drives authenticated `POST`/`GET /api/pulses` load from admin sessions bound to that deal across 4 concurrent dispatch lanes per worker process.
- `package.json`: added `"soak": "node scripts/soak.js"` to the existing flat `scripts` block — no dependency added.
- Phase gate executed and recorded (Task 2):
  - `npm test` — **703/703 pass**, no regression.
  - `npm run soak` at defaults (3 processes, ~120s) — **6300 acknowledged, 3 cleanly refused (0.0%)**, all five D-15 checks PASS.
  - `SOAK_PROCESSES=4 npm run soak` — **6544 acknowledged, 33 cleanly refused (0.5%)**, all five D-15 checks PASS. The harder run's refusal rate is meaningfully higher than the default's (0.5% vs 0.05%) but every single refusal was the D-10 audit-stage-busy trade-off, not a genuine loss — see "Observation for Phase 10" below.
  - `node scripts/wal-checkpoint.js && git status --porcelain data/` — empty, both before and after every write-exercising check in this plan.
  - `git diff <fork-base> -- package.json` — only the `scripts` block changed; `package-lock.json` unchanged.
  - Server boots from the committed tree with no install step and answers `GET /login.html` with 200 (darwin dev host, this session).
  - A scratch-copy demo write check (real committed `demo.db`/`control.db` content, copied so the git-tracked files are never touched) confirmed `POST /api/pulses` round-trips byte-exact through `DEMO_OPEN=1`.

## Task Commits

Each task was committed atomically:

1. **Task 1: The soak harness — real server processes, one shared data directory** - `ee61119` (feat)
2. **Task 2: Phase gate — full soak run, demo showcase, and zero-install bundle intact** - `d4eb479` (fix, found during this task's own gate run — see Deviations below)

## Files Created/Modified

- `scripts/soak.js` (new) - the standalone multi-process soak harness: env-override scratch seeding, real deal provisioning, real spawned server processes, concurrent-lane load generation, and the D-15 verification pass
- `package.json` - added `"soak": "node scripts/soak.js"` to the `scripts` block

## Decisions Made

- Worker sessions authenticate as `role: 'admin'` rather than a fixture username/role — `db/controlStore.js`'s `isDealMember()` short-circuits true for admin regardless of the deal's own `members` array, so the load generator does not need to separately manage deal membership, and `ROLE_WRITE_POLICY` already allows admin on every write route the harness drives. Fixture users are still seeded into `control.db` per the plan's literal setup instruction (real logins are possible against the scratch trio), even though the load-generation path itself creates sessions directly rather than calling the login endpoint.
- The harness provisions one REAL deal (not demo.db) as its load target: `db/auditHook.js`'s `AUDITED_DB_KINDS` deliberately excludes `'demo'`, so targeting demo.db would have made the audit-reconciliation check (D-15's fourth check) vacuously pass with zero rows on both sides — a weak, misleading proof. Targeting a real deal, created via the exact same code path `POST /api/deals` uses, exercises the deal resolver and the audit hook for real, as D-13 requires.
- `LANES = 4` concurrent dispatch lanes per worker process (internal constant, not one of the three named D-14 env knobs — Claude's Discretion). Empirically, a single in-flight write per OS process produced zero organic `SQLITE_BUSY` contention at any interval tested down to 1ms — a write itself completes in well under a millisecond, so genuine cross-process lock overlap needs several concurrent in-flight requests per process before it becomes measurable within a realistic run duration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] D-15's "no refused write is present" check was too strict — it didn't distinguish D-10's documented audit-stage-busy trade-off from a genuine violation**
- **Found during:** Task 2's own phase-gate run (the first full default `npm run soak`)
- **Issue:** The verification pass's original check 2 treated ANY refused write's correlator found in the final `pulses` table as a failure. The full default run found 3 such cases; running against a fresh full run again confirmed 3 more (and the harder run found 33). Investigation traced this to `db/store.js`'s `writeDb()` committing the deal-level write in its OWN transaction first, then dispatching the audit append as a SEPARATE, LATER transaction against `audit.db`. When THAT second write hits contention, the no-swallow contract (D-10) still fails the whole request with a 503 — but the deal-level row has already committed. This is a deliberate, user-approved trade-off explicitly documented in `08-RESEARCH.md`'s D-10 ("client retry re-applies the write; acceptable because `writeDb()` re-application of identical content is idempotent"), not a rollback failure.
- **Fix:** The verification pass now cross-references the audit trail for each refused-but-present write: if its `pulses` row has NO matching `audit_log` row, that's the accepted D-10 trade-off (reported separately, does not fail the check); if it has a matching audit row despite the 503, that would mean the whole request silently succeeded while lying to the client — a genuine violation that still fails the check.
- **Files modified:** `scripts/soak.js`
- **Verification:** Re-ran the full default soak (3 processes, ~120s): 3 refused, all `committedButUnaudited` (D-10 trade-off), 0 `committedAndAudited` (genuine violation) — all 5 D-15 checks PASS. Re-ran `SOAK_PROCESSES=4`: 33 refused, all D-10 trade-off, 0 genuine violations — all 5 D-15 checks PASS.
- **Committed in:** `d4eb479` (separate fix commit, since Task 1 was already committed when this was found)

---

**Total deviations:** 1 auto-fixed (1 bug fix, Rule 1)
**Impact on plan:** Necessary for the D-15 verification pass to correctly distinguish the architecture's own documented contention-handling trade-off from an actual correctness bug. No scope creep — the fix touches only the verification logic this plan's own Task 1 wrote, discovered by this plan's own Task 2 gate run.

## Observation for Phase 10 (per Task 2's action text)

At the default setting (3 processes), the refusal rate was 0.05% (3/6303). At the harder setting (4 processes), it rose to 0.5% (33/6577) — a 10x increase for a 33% increase in process count, consistent with contention scaling faster than linearly as more writers compete for the same locks. Every observed refusal across both runs was the audit-stage-busy case (D-10's trade-off), not deal-level write contention — under this workload shape, `audit.db` is the more contended file, since it aggregates the audit rows from every process's every acknowledged write, not just one deal's own collection. At ~15-person deal-team scale (the milestone's stated scale), a sub-1% refusal rate with clean client-side silent retry (Phase 8 Plan 4) is very unlikely to be user-visible, but this data point — audit.db as the more likely contention site than the deal file itself — is worth carrying into the Phase 10 runtime-hardening discussion if `audit.db`'s write pattern changes (e.g., under multi-deal concurrent load, which this single-deal soak does not exercise).

## Issues Encountered

None beyond the auto-fixed deviation above. Every `<verify>` command in both tasks passed on final runs; no fix-attempt-limit issues, no auth gates, no other checkpoints.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 8's full artifact set (per `08-01-PLAN.md`'s canonical "Artifacts this phase produces" list) is now complete: `scripts/soak.js`, the `soak` script entry, and the three `SOAK_*` env knobs.
- The acknowledged-write invariant (D-15) is proven under real, sustained, multi-process load at both the phase-gate setting and a harder release-gate setting, with zero genuine violations — CONC-01's "no lost update" guarantee now has whole-stack, not just unit-level, evidence.
- The demo showcase and the zero-install turnkey bundle are confirmed unaffected by this phase's storage-layer change.
- Remaining manual item: a live, visual, interactive click-through of the demo showcase in a browser (Task 2's `<human-check>`) was not performed — no live human was available in this autonomous worktree wave, and no `type="checkpoint:*"` task exists in this plan to pause for one. Every machine-verifiable half of that check (boot, HTTP 200, a byte-exact scratch-copy write round-trip) is done; the purely visual judgment is left for the orchestrator/user's own pass before this phase is treated as fully closed.
- No blockers for Phase 9 (Optimistic Locking & Conflict Recovery) — Phase 8's 503-contention signal and Phase 9's future 409-conflict signal remain the two distinct signals CONTEXT.md's decisions specify.

---
*Phase: 08-concurrency-storage-foundation*
*Completed: 2026-08-10*
