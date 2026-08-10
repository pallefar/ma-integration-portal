---
phase: 08-concurrency-storage-foundation
plan: 03
subsystem: database
tags: [express, error-middleware, better-sqlite3, sqlite-busy, coverage-test]

# Dependency graph
requires:
  - phase: 08-01
    provides: "isBusyError(err) predicate + central 503/Retry-After error middleware, both exported on server.js's app object"
provides:
  - "Every server.js try/catch whose try body reaches writeDb()/controlStore.*/sessions.*/dealSeed.createDealDatabase()/recordSecurityEvent() now re-throws (sync) or forwards via next() (async) a busy error instead of converting it to a hand-written 500"
  - "Deal-provisioning's compensating rollback (controlStore.deleteDeal()) still runs before any re-throw — a contention failure during provisioning or during the rollback itself both surface as 503, never a lost registry row"
  - "4 async write/read handlers (rag/upload, assessment, ai/insight, reports/pack) gained an explicit `next` parameter and next(e)/next(err) forwarding, since Express 4 does not auto-forward async rejections"
  - "test/busy-503-contract.test.js — permanent structural + live-contention coverage gate that fails when a future route reopens either hole"
affects: [08-04, 08-05]

# Actuals (#2632)
actuals:
  tokens: 7369
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Local catch re-throw guard: `if (isBusyError(e)) throw e;` (sync handlers) / `if (isBusyError(e)) return next(e);` (async handlers) as the FIRST statement after any compensating action, before the hand-written response"
    - "Character-index brace-depth source scan (not line-based) for structural coverage tests — mirrors test/write-validation-coverage.test.js's discipline of asserting against the live app/source rather than a hand-maintained list"

key-files:
  created:
    - test/busy-503-contract.test.js
  modified:
    - server.js
    - test/reports-pack.test.js

key-decisions:
  - "The nested rollback try/catch inside the deal-provisioning site (controlStore.deleteDeal()) also got its own isBusyError() guard, re-throwing rollbackErr if the ROLLBACK itself hits contention — distinct from the outer guard on the original createDealDatabase() error. Both matter: losing either would let one contention scenario silently fall through to the local 500."
  - "controlStore.getSecretSettings() reads matched the enumeration's broad `controlStore.` prefix (not filtered to writes-only, per PLAN.md's literal instruction) — guarded defensively even though a read is unlikely to raise SQLITE_BUSY under WAL; harmless if never triggered, closes a theoretical gap if it ever is."
  - "GET /api/reports/export (sync) and GET /api/reports/pack (async) were included in the fix scope even though they are read routes — their try bodies reach `recordSecurityEvent()` (an audit write) directly, so they matched the plan's literal enumeration criteria and D-11's uniform-contract intent extends to any storage write, not just POST/PUT/PATCH/DELETE routes."
  - "test/busy-503-contract.test.js's negative-control 500 case uses POST /api/rag/upload with a garbage (non-empty, schema-valid) fileData payload that fails PDF parsing — a genuine, non-contention InvalidPDFException — rather than trying to force a real SQLite non-busy error, keeping the test deterministic and fast."
  - "The live-contention test drives three sequential requests under one held lock rather than test/concurrency-busy-retry.test.js's single-request end-to-end proof, to hit all three required route shapes (plain sync/unguarded, async/Task-1-patched, sync/Task-1-patched) in one harness; HOLD_MS raised to 9000ms after observing one flaky run under concurrent sibling-worktree system load."

patterns-established:
  - "findStorageCatchSites(source) / findAsyncWriteHandlers(source) in test/busy-503-contract.test.js: the SAME brace-depth scan Task 1's own audit pass used, embedded in the permanent test so Task 1's fix scope and the coverage gate's assertion scope can never silently drift apart."

requirements-completed: [CONC-01]

coverage:
  - id: D1
    description: "Every storage-wrapping catch in server.js (9 sites: deal-provisioning + its rollback, RAG upload, media upload, AI insight, assessment's two catches, reports export, reports pack) re-throws or forwards a busy error to the central 503 middleware instead of converting it to a local 500."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "test/busy-503-contract.test.js#busy-503-contract (structural): every storage-wrapping catch in server.js carries the isBusyError() re-throw/forward guard"
        status: pass
      - kind: integration
        ref: "node --test test/deal-registry.test.js test/deal-lifecycle.test.js (rollback ordering preserved)"
        status: pass
    human_judgment: false
  - id: D2
    description: "All 4 async write/read handlers whose catch reaches a storage call (rag/upload, assessment, ai/insight, reports/pack) forward a busy-error rejection to the error chain via next(), since Express 4 does not auto-forward async rejections."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "test/busy-503-contract.test.js#busy-503-contract (structural): every async write handler in server.js forwards a rejection to the error chain"
        status: pass
    human_judgment: false
  - id: D3
    description: "Under real cross-process BEGIN IMMEDIATE contention, three routes — a plain unguarded sync write, an async Task-1-patched write, and a sync Task-1-patched write — all return 503 + Retry-After with no leaked SQLite detail, filesystem path, or db file path."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "test/busy-503-contract.test.js#busy-503-contract (live contention): three routes ... all return 503 + Retry-After under real cross-process contention, never a leaked detail"
        status: pass
    human_judgment: false
  - id: D4
    description: "The coverage gate cannot pass vacuously and cannot pass by turning every error into a 503: the live write-route inventory (app._router.stack) is asserted non-empty, and a negative control proves a validation failure still 400s and a non-contention server error still 500s with its existing body."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "test/busy-503-contract.test.js#busy-503-contract (structural): the live write-route inventory is non-empty"
        status: pass
      - kind: integration
        ref: "test/busy-503-contract.test.js#busy-503-contract (negative control): a validation failure still returns 400, and a non-contention server error still returns the existing generic 500"
        status: pass
    human_judgment: false
  - id: D5
    description: "No committed data/ file was dirtied and no stray artifact was left behind; npm test full suite green with zero regressions, reproduced clean across multiple runs after fixing a timing flake."
    verification:
      - kind: other
        ref: "node scripts/wal-checkpoint.js && git status --porcelain data/ (empty) + npm test x4 consecutive clean runs (694/694 pass)"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-08-10
status: complete
---

# Phase 8 Plan 3: Stop Every Local Catch From Swallowing SQLite Contention Summary

**Every one of the 9 catch sites in server.js that wraps a storage call now re-throws (or forwards, for the 4 async handlers) a SQLITE_BUSY error to the central 503 middleware instead of converting it to a hand-written 500 — with a permanent structural + live-contention test that turns red if a future route reopens the hole.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-08-10T22:44:50+02:00
- **Completed:** 2026-08-10T23:02:34+02:00
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments

- Enumerated `server.js` via a character-index brace-depth scan (not a fixed line-number list) and found 9 try/catch sites whose try body reaches `writeDb(`, `controlStore.`, `sessions.`, `dealSeed.createDealDatabase(`, or `recordSecurityEvent(`: deal-provisioning + its nested rollback, RAG upload (async), media upload, AI insight (async), assessment's AI-fallback catch (async) and its writeDb catch (async), reports export, and reports pack (async).
- Every one of those 9 sites now carries a first-statement `isBusyError()` guard — `throw e;` for sync handlers (Express 4 auto-forwards), `return next(e);` for async handlers (Express 4 does NOT auto-forward async rejections — 4 handlers gained an explicit `next` parameter for this: `rag/upload`, `ai/insight`, `assessment`, `reports/pack`).
- Deal-provisioning's compensating rollback (`controlStore.deleteDeal()`) was preserved and placed correctly: it still runs BEFORE any re-throw, so a half-created deal is never left selectable on a contention failure, and the rollback's own contention is now also caught and forwarded rather than silently swallowed into the outer catch's 500.
- `test/busy-503-contract.test.js` (new, 5 tests): mirrors `test/write-validation-coverage.test.js`'s discipline — structural assertions scan the live `server.js` source (no hand-maintained list), a live-inventory assertion via `app._router.stack`, a real cross-process contention proof driving 3 routes (one plain sync/unguarded, one async/patched, one sync/patched) to 503+Retry-After with no leaked detail, and a negative control proving the gate can still 400/500 for non-contention failures.
- Self-verified the structural gate's RED path: temporarily removed one guard, confirmed the test failed and named the exact offending `server.js` line and call, restored, confirmed clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Stop every local catch from swallowing the contention signal** - `da99560` (feat)
2. **Task 2: Permanent coverage gate for the uniform 503 contract** - `2972837` (test), plus a follow-up flakiness fix `64e35d5` (fix)

## Files Created/Modified

- `server.js` - 9 catch sites gained the `isBusyError()` re-throw/forward guard; 4 async handlers (`rag/upload`, `ai/insight`, `assessment`, `reports/pack`) gained an explicit `next` parameter
- `test/busy-503-contract.test.js` (new) - permanent structural + live-contention coverage gate for the uniform 503 contract
- `test/reports-pack.test.js` - a pre-existing structural regex (`async (req, res) => {`) broke against the new `next` parameter; widened to tolerate the optional third parameter

## Decisions Made

- Guarded the nested deal-provisioning rollback catch (`controlStore.deleteDeal()`) separately from the outer catch — a contention failure on the ROLLBACK itself is a distinct scenario from a contention failure on the original `createDealDatabase()` call, and both needed to surface as 503 rather than fall through to the outer catch's hand-written 500.
- Followed PLAN.md's literal enumeration criteria (any `controlStore.` call, not filtered to writes) rather than hand-classifying read vs write among the 9 matched sites — a defensive guard on a read call (e.g. `controlStore.getSecretSettings()` inside the assessment AI-fallback catch) is harmless if it never fires and closes a theoretical gap if it ever does.
- Included the two GET routes (`/api/reports/export`, `/api/reports/pack`) in the fix scope: their try bodies reach `recordSecurityEvent()` directly (an audit write), matching both the plan's literal criteria and D-11's uniform-contract intent, which is about storage writes reaching the central middleware, not about HTTP method.
- Used a real (non-contention) PDF-parse failure — garbage `fileData` against `POST /api/rag/upload` — as the negative control's 500 case, rather than attempting to force a genuine SQLite constraint/schema error; this exercises the SAME modified catch block the live-contention test exercises, proving the `isBusyError()` guard is selective (busy → 503, everything else → existing behavior unchanged).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `test/reports-pack.test.js`'s route-body regex broken by this plan's own `next` parameter addition**
- **Found during:** Task 1 verification (`npm test` full-suite run)
- **Issue:** A pre-existing structural test asserted the literal source text `async (req, res) => {` for `GET /api/reports/pack` — directly falsified by this plan's addition of a `next` parameter for async-rejection forwarding.
- **Fix:** Widened the regex to `async \(req, res(?:, next)?\) => \{`, tolerating the optional third parameter without weakening any of the test's other assertions (getReportPack() shape, 503-before-audit ordering).
- **Files modified:** `test/reports-pack.test.js`
- **Verification:** `npm test` — 689/689 pass (was 688/689 before the fix)
- **Committed in:** `da99560` (Task 1 commit)

**2. [Rule 1 - Bug] Live-contention test's lock-hold margin too tight under concurrent system load**
- **Found during:** Task 2's own extended verification (running the new test/full suite repeatedly to build confidence)
- **Issue:** One `npm test` run (694 tests) showed 1 failure while this plan ran alongside sibling parallel worktree agents also driving full test runs on the same host. `HOLD_MS=4500` for three sequential ~1000ms-bounded busy-waits left too little scheduling-jitter margin — the held lock could release before the third request's busy-wait even started, turning an expected 503 into an unexpected 200.
- **Fix:** Raised `HOLD_MS` from 4500 to 9000; reproduced clean across 4 consecutive full-suite runs and 2 direct runs of the new test file after the change.
- **Files modified:** `test/busy-503-contract.test.js`
- **Verification:** `node --test test/busy-503-contract.test.js` x2 + `npm test` x4, all clean (694/694)
- **Committed in:** `64e35d5` (follow-up fix commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes, both Rule 1)
**Impact on plan:** Both auto-fixes necessary to keep `npm test` green and the new test suite reliably non-flaky, per this plan's own verification section. No scope creep — both fixes touch only what this plan's own changes broke.

## Issues Encountered

None beyond the two auto-fixed deviations above. All `<verify>` commands from PLAN.md passed on final runs; the deal-registry/deal-lifecycle suites confirmed the rollback ordering was preserved.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-06's claim ("one central middleware covers every write path") is now true and structurally enforced: `test/busy-503-contract.test.js` will fail loudly if a future route wraps a storage call in a local catch without the `isBusyError()` guard, or if a future async write handler forgets to forward its rejections.
- `test/busy-503-contract.test.js` reuses plan 08-01's temp-DB-trio env-override harness and lock-holder child-process pattern, matching the established test-isolation convention (no live `data/*.db` files ever touched by this test).
- No blockers. Plans 08-04 (client-side retry) and 08-05 (soak harness) can rely on every write path — including control-plane and audit-adjacent GET exports — now uniformly surfacing contention as 503 + Retry-After.

---
*Phase: 08-concurrency-storage-foundation*
*Completed: 2026-08-10*

## Self-Check: PASSED

- FOUND: server.js, test/busy-503-contract.test.js, test/reports-pack.test.js
- FOUND: commit da99560 (Task 1), commit 2972837 (Task 2), commit 64e35d5 (follow-up fix) in `git log --oneline`
