---
phase: 08-concurrency-storage-foundation
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, control-plane, audit, concurrency]

# Dependency graph
requires:
  - phase: 08-01
    provides: "busy_timeout 1000ms shared pragma contract, writeDb() .immediate precedent, isBusyError() predicate, central 503 middleware"
provides:
  - "db/auditHook.js's writeAuditBatch() acquiring its write lock up front via .immediate, no-swallow contract intact under contention"
  - "db/controlStore.js's five read-modify-write functions (updateUser, updateDealSetup, updateDealMembers, setDealMemberGrants, archiveDeal) each wrapped in a single .immediate transaction with the read inside the locked section"
  - "test/control-plane-serialization.test.js — real multi-process proof that concurrent control-plane edits to the same deal survive"
affects: [08-03, 08-04, 08-05]

# Actuals (#2632)
actuals:
  tokens: 6900
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The same .immediate transaction-variant change applied a third and fourth time (db/auditHook.js, db/controlStore.js x5) — one storage-layer serialization contract reused everywhere a write happens, not reinvented per module."
    - "A caller-side retry loop with a short synchronous Atomics.wait yield between rounds — the practical technique for proving eventual convergence of a 'replace wholesale' API's concurrent callers, without changing that API's merge semantics."

key-files:
  created:
    - test/control-plane-serialization.test.js
  modified:
    - db/auditHook.js
    - db/controlStore.js

key-decisions:
  - "getDeal()/getUser()-equivalent reads were kept as literal calls (or inlined manual SELECTs, for updateUser) INSIDE each wrapped transaction body rather than passed in from outside — this is what makes the read part of the same locked section instead of just moving the code without closing the race."
  - "Did not add field-level merging to updateDealMembers()'s `members` array (explicitly out of scope per the plan) — it still replaces `members` wholesale with whatever the caller passes. The new test proves this is safe for concurrent ADDITIVE callers only when the caller retries on a fresh read (documented at length in the test file's own header, since this was non-obvious during implementation — see Issues Encountered)."
  - "test/control-plane-serialization.test.js's member-race test uses a short synchronous Atomics.wait(2ms) yield between each of 60 rounds per child, rather than a bare tight loop — a tight loop let one child's whole round budget run as a single OS-scheduler burst before the other process was ever scheduled, which made the test genuinely flaky (observed failures during development, not merely theoretical)."

patterns-established:
  - "Every db/controlStore.js read-modify-write pair follows updateDealMembers()'s canonical shape: capture `const conn = controlConn()` once, wrap the read+write in `conn.transaction((args) => {...}).immediate`, invoke with the original arguments — the same shape 08-PATTERNS.md specified, now applied 5x."

requirements-completed: [CONC-01]

coverage:
  - id: D1
    description: "writeAuditBatch()'s transaction acquires its write lock up front via .immediate; no try/catch was added, so a busy append still throws uncaught and fails the whole request (D-10's no-swallow contract holds under contention)."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "node --test test/audit-log.test.js test/audit-security-events.test.js (15/15 pass) + node -e structural no-catch check in PLAN.md's own <verify> block"
        status: pass
    human_judgment: false
  - id: D2
    description: "db/controlStore.js's five read-modify-write functions (updateUser, updateDealSetup, updateDealMembers, setDealMemberGrants, archiveDeal) each wrap their SELECT-then-UPDATE pair in one .immediate transaction with the read inside the locked section; external contracts (params, return values, throw-when-missing messages) unchanged."
    requirement: "CONC-01"
    verification:
      - kind: unit
        ref: "node --test test/deal-registry.test.js test/dd-grants.test.js test/deal-lifecycle.test.js (30/30 pass, no source edits to those tests) + node -e .immediate count check (10 found, >=5 required)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two real OS processes concurrently adding a DIFFERENT member to the same deal both survive; two real OS processes concurrently granting a DIFFERENT DD area to different users on the same deal both survive."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "test/control-plane-serialization.test.js#control-plane-serialization (a) and (b) — real spawned node:child_process instances, verified stable across 5 consecutive local runs"
        status: pass
    human_judgment: false
  - id: D4
    description: "A caller contended by a real second OS process holding control.db's write lock throws a SqliteError with a SQLITE_BUSY* code once the busy-wait is exhausted, never a partial/silent update."
    requirement: "CONC-01"
    verification:
      - kind: integration
        ref: "test/control-plane-serialization.test.js#control-plane-serialization (c)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Full suite green, no regressions; no committed data/ file dirtied by the new test."
    verification:
      - kind: other
        ref: "npm test (692/692 pass) + node scripts/wal-checkpoint.js && git status --porcelain data/ (empty)"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-08-10
status: complete
---

# Phase 8 Plan 2: Audit Batch and Control-Plane Serialization Summary

**Closed 08-RESEARCH.md's Pitfall 4 / Open Question 1 — `db/controlStore.js`'s five direct-SQL read-modify-write functions (membership, DD-clearance grants, deal setup, archival, user credentials) now acquire `BEGIN IMMEDIATE` up front instead of racing an unguarded SELECT against a later UPDATE, and `db/auditHook.js`'s audit batch append does the same while keeping its no-swallow contract intact under contention.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-08-10T21:05:00Z (approx)
- **Completed:** 2026-08-10T22:00:00Z (approx)
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments

- `db/auditHook.js`'s `writeAuditBatch()` transaction now uses the `.immediate` variant — the same one-line change `db/store.js`'s `writeDb()` took in plan 08-01 — with a new `[security]`-prefixed comment explaining the D-10 reasoning (why a busy audit append must fail the whole request, and why the client's retry after a 503 is safe). No try/catch was added; the file's existing no-swallow contract is unchanged. `recordSecurityEvent()` was left untouched (bare autocommit, no `BEGIN` to choose a mode for).
- `db/controlStore.js`'s five read-modify-write functions — `updateUser`, `updateDealSetup`, `updateDealMembers`, `setDealMemberGrants`, `archiveDeal` — each now capture `controlConn()` once and wrap their read+write in a single `.immediate` transaction, with the read moved INSIDE the locked section. Every external contract (parameters, return value, throw-when-missing error text, not-an-upsert semantics) is unchanged. A doc-comment on each function references D-09 and explains why the wrap exists.
- `test/control-plane-serialization.test.js` (new) proves the fix with REAL spawned `node:child_process` instances, never an in-process Promise/timer simulation (RESEARCH.md Pitfall 3):
  - **(a)** Two children each repeatedly add a DIFFERENT member to the SAME deal via `updateDealMembers()` — a retry-with-fresh-read loop over 60 rounds with a short synchronous yield between rounds, converging to a final state where BOTH members are present.
  - **(b)** Two children each grant a DIFFERENT DD area to a DIFFERENT username via `setDealMemberGrants()` — converges deterministically (the function's internal `{...deal.memberGrants}` spread merges per-username keys, so the atomic total-ordering alone is sufficient).
  - **(c)** A caller contended by a real second OS process holding `control.db`'s write lock (via a raw `BEGIN IMMEDIATE`, mirroring `test/concurrency-busy-retry.test.js`'s lock-holder technique) throws a `SqliteError` with a `SQLITE_BUSY*` code once the busy-wait is exhausted — and the deal is left completely unchanged, proving no partial update.
- Full suite: 692/692 pass, zero regressions. `git status --porcelain data/` empty after `node scripts/wal-checkpoint.js` — no committed database file was dirtied by the new test.

## Task Commits

Each task was committed atomically:

1. **Task 1: Audit batch acquires its lock up front, and still never swallows** - `83e816d` (feat)
2. **Task 2: Control-plane read-modify-write pairs become single immediate transactions** - `27a7827` (feat)

## Files Created/Modified

- `db/auditHook.js` - `writeAuditBatch()`'s transaction changed to the `.immediate` variant; `[security]` comment added explaining D-10's no-swallow-under-contention reasoning
- `db/controlStore.js` - `updateUser()`, `updateDealSetup()`, `updateDealMembers()`, `setDealMemberGrants()`, `archiveDeal()` each wrapped in a single `.immediate` transaction with the read moved inside; doc comments reference D-09
- `test/control-plane-serialization.test.js` (new) - real multi-process proof: concurrent member additions survive, concurrent DD-area grants survive, a contended caller throws rather than silently applying a partial update

## Decisions Made

- Kept the internal `getDeal()` calls (and, for `updateUser`, the manual `SELECT` that finds the account row by username) literally INSIDE each wrapped transaction body rather than reading outside and passing the value in — this is what makes the read part of the same locked section, closing the actual race (a read left outside the transaction would have re-opened the exact window this plan exists to close).
- Did NOT add field-level merging to `updateDealMembers()`'s `members` array, per the plan's explicit scope boundary — it still replaces `members` wholesale with whatever the caller passes; the atomicity fix protects every OTHER field of the deal blob from being clobbered by a stale `{...deal}` spread, not the `members` array's own content. See "Issues Encountered" below for why this made the concurrency test itself non-trivial to design.
- `test/control-plane-serialization.test.js`'s member-race test uses a synchronous `Atomics.wait(sab, 0, 0, 2)` yield after each of 60 rounds per child (a throwaway `SharedArrayBuffer`, no new dependency) rather than a bare tight loop. A tight loop let one child's entire round budget run as a single uninterrupted OS-scheduler burst before the other process was ever scheduled a first time, which measurably produced test failures during development (see Issues Encountered) — the yield forces real interleaving between the two processes throughout the whole round budget.

## Deviations from Plan

None - plan executed exactly as written. The `[security]` comment on `db/auditHook.js` and the D-09 doc comments on `db/controlStore.js` were explicitly requested by the plan's own `<action>` text, not an addition beyond scope.

## Issues Encountered

- **The member-addition concurrency test initially failed twice during development**, both times with one child's addition silently missing from the final state — exactly the bug class this plan closes, but manifesting inside my OWN test harness rather than in `db/controlStore.js`. Root cause: `updateDealMembers()`'s external contract replaces `members` WHOLESALE with whatever array the caller passes (by design — see the plan's own "do not add field-level merging" instruction); a caller that computes its desired array from a plain read taken BEFORE calling `updateDealMembers()` can still race against another caller's commit that lands in the gap between that read and the call. The atomicity fix protects `updateDealMembers()`'s OWN internal read (used to preserve every OTHER field), not the `members` array's content, which is fundamentally a caller-supplied value. Fixed by having each child retry over many rounds, always re-reading fresh and re-asserting the union — a monotonically non-decreasing sequence of commits that self-heals any transient loss, PROVIDED both processes get real OS-scheduler interleaving throughout the whole round budget (the second failure, with no early exit but still no yield, showed 30 tight-loop rounds each running as one uninterrupted burst wasn't enough — adding a 2ms `Atomics.wait` yield after every round fixed it, verified stable across 5 consecutive runs). This is documented at length in the test file's own header comment so a future reader does not mistake it for flakiness.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `db/auditHook.js` and `db/controlStore.js` both now acquire their write locks up front, joining `db/store.js`'s `writeDb()` from plan 08-01 — every explicit multi-statement write transaction in the app now follows the same `.immediate` serialization contract (D-09's full scope for these two files).
- `test/control-plane-serialization.test.js` exists as the artifact named in 08-PATTERNS.md's file classification table, alongside plan 08-01's `test/concurrency-busy-retry.test.js`.
- No blockers. Plans 08-03 (server.js local try/catch re-throw-guard audit pass) and 08-04 (client-side busy retry) can proceed independently — this plan touched only `db/auditHook.js`, `db/controlStore.js`, and the new test file, none of which those plans' `files_modified` lists overlap with.

---
*Phase: 08-concurrency-storage-foundation*
*Completed: 2026-08-10*

## Self-Check: PASSED

- FOUND: db/auditHook.js, db/controlStore.js, test/control-plane-serialization.test.js
- FOUND: commit 83e816d (Task 1), commit 27a7827 (Task 2) in `git log --oneline`
