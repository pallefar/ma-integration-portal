---
phase: 09-optimistic-locking-conflict-recovery
plan: 07
subsystem: testing
tags: [node:test, sqlite, optimistic-locking, structural-scan, cross-process, soak, validation-contract]

# Dependency graph
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "Plans 01-06's complete CONC-02 contract across all 10 VERSIONED_COLLECTIONS routes (RAID, integration tasks, synergy initiatives, DD findings/request-items, org positions/flight-risks — both POST and DELETE), the conflictBody()/conflictIfStale()/parseExpectedVersion() server contract, db/store.js's version-checked WHERE clause, and the client showConflictDialog() component with its destructive-delete variant"
provides:
  - "A generic structural coverage gate (test/optimistic-locking-contract.test.js, Part 1) that scans server.js's LIVE source for any route resolving a versioned-lane record and calling writeDb() without a conflictIfStale() precheck — no hand-maintained route list, a small reasoned allow-list instead"
  - "Both-directions live inventory cross-check (Part 2): VERSIONED_COLLECTIONS ⊆ ARRAY_COLLECTIONS (existing) plus every lane helper's referenced collection resolves back into VERSIONED_COLLECTIONS (new), plus the demo/custom dual-lane-count assertion"
  - "The missing custom-lane (demoMode:false) dual-lane proof for RAID/tasks/synergies (Part 3) — the prior six plans' tests only ever exercised the demo lane"
  - "Cross-collection concurrency proof extended to integration tasks and synergy initiatives (test/optimistic-locking-cross-process.test.js), plus one cross-collection case proving the version predicate does not serialize unrelated collections"
  - "A conflict-aware scripts/soak.js: a dedicated per-worker conflict lane racing a shared RAID record under real multi-process load, classifying 409 as its own outcome (neither acknowledged nor lost), verified by version-count reconciliation, final-content-matches-last-winner, and audit-trail membership"
  - "09-VALIDATION.md filled and signed off (nyquist_compliant: true, wave_0_complete: true) against the seven plans as actually executed"
affects: []

# Actuals (#2632)
actuals:
  tokens: 18718
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Generic route-handler structural scan (findVersionedLaneWriteHandlers): regex-matched app.(post|put|patch|delete)(...) declarations + character-index brace matching to isolate each handler body, then a content check for a versioned-lane call plus writeDb( — the SAME recipe test/busy-503-contract.test.js established, generalized to a full live-route inventory instead of an enumerated marker list"
    - "Reasoned allow-list as the exemption mechanism, cross-checked against the live scan itself (every entry must correspond to a real found-and-still-unguarded route, or the test fails) — a list of deliberately EXEMPT routes, not a hand-maintained list of PROTECTED ones"
    - "Conflict-lane load generator: a dedicated per-worker-process racer against ONE shared record, holding its own cached version and refreshing it only on its OWN acknowledged write — the only way a load generator that otherwise only creates new rows can ever produce a genuine multi-process version conflict"
    - "Audit reconciliation by SET MEMBERSHIP, not row COUNT, when a versioned row is also re-touched (content-unchanged) by unrelated concurrent writes — db/store.js's whole-object snapshot-diff visits every row of every versioned collection on every writeDb() call (Plan 01's own 'untouched row' fast-path fix), so a raw audit-row count for one record over-counts even with zero violations; membership on a unique per-write marker is immune to that"

key-files:
  created: []
  modified:
    - test/optimistic-locking-contract.test.js
    - test/optimistic-locking-cross-process.test.js
    - scripts/soak.js
    - .planning/phases/09-optimistic-locking-conflict-recovery/09-VALIDATION.md

key-decisions:
  - "Part 1's allow-list carries 7 entries, not the plan's named 5 categories (instantiate/from-remediation/copy-to-target/import/decisions) — the live scan also caught DELETE /api/employees/:id, which reads orgPositionsLane(db) only as a pre-delete occupancy guard and writes an unrelated collection (employees/customEmployees). Classified and reasoned explicitly rather than narrowing the scan to dodge it — narrowing the scan to fit a pre-decided allow-list would have reintroduced exactly the 'hand-maintained list' failure mode D-06 exists to close."
  - "Kept tests 1-44 and their per-plan structural checks (16/25/35/44) rather than deleting them once Part 1's generic scan superseded their coverage — those tests also lock in T-09-19/T-09-27's ddAreaRefused-before-conflictIfStale anti-enumeration ordering and the positionGraphFailure-ordering rule, concerns the generic writeDb-precedence scan does not itself express. Organized (added Part 1-4 section headers) rather than replaced, per the plan's own read_first framing ('which this task organizes rather than replaces')."
  - "scripts/soak.js's conflict lane targets a SINGLE shared RAID record across all worker processes (not one record per worker) — a per-worker record would never contend with a sibling worker's own record, and this harness's whole point is real cross-PROCESS contention, not per-process load."
  - "Soak Check 8 (409-to-audit reconciliation) redesigned mid-implementation from a raw row-count comparison to a set-membership comparison after a live smoke run exposed the real reason a count comparison cannot work here: EVERY writeDb() call from ANY route (including the unrelated pulses lane) revisits every row of every VERSIONED_COLLECTIONS table, and Plan 01's own 'untouched row' fast-path fix rewrites (and therefore re-audits) a versioned row even when its content did not change — so the shared RAID record accumulates many audit 'update' rows that are content-identical echoes, not genuine conflict-lane commits. Verified against a unique per-write marker instead of a count, which is immune to the echo phenomenon and still correctly fails if a conflict ever secretly committed or an acknowledged write ever secretly vanished."

patterns-established:
  - "The allow-list self-audit pattern: an exemption list is only trustworthy if the SAME test that enforces it also asserts every entry still corresponds to a real, still-unguarded route — otherwise a stale entry (a route later fixed, or removed) silently widens the exemption for nothing."

requirements-completed: [CONC-02]

coverage:
  - id: D1
    description: "A generic structural scan over server.js's live source (not a hand-maintained route list) fails the suite when a new route resolves a versioned-collection record and calls writeDb() without a conflictIfStale() precheck; a 7-entry reasoned allow-list is the only exemption, and the allow-list itself is cross-checked against the live scan so a stale entry cannot silently persist."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (Part 1, structural coverage gate)"
        status: pass
      - kind: other
        ref: "manual temporary-breakage proof: a route added referencing raidLane(db)+writeDb(db) with no precheck made Part 1 fail with the offending route named in the assertion message; reverted, Part 1 passed again (see Deviations/Issues below for the observed failure text)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both-directions live inventory cross-check: VERSIONED_COLLECTIONS is a real ARRAY_COLLECTIONS subset with both demo/custom lanes present (existing test, retained), plus a NEW reverse check that every lane helper's own referenced db.<collection> resolves back into VERSIONED_COLLECTIONS, and that raidLane/taskLane/synergyLane each resolve to exactly 2 collection keys."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (Part 2, structural + reverse direction)"
        status: pass
      - kind: other
        ref: "manual temporary-breakage proof: removing customRaidEntries from VERSIONED_COLLECTIONS (with the size guard adjusted to avoid a require-time crash) made BOTH Part 2 tests fail with distinct, clear messages; reverted, both passed again"
        status: pass
    human_judgment: false
  - id: D3
    description: "Part 3's per-collection real-behavior proof now covers the custom (demoMode:false) lane for RAID entries, integration tasks and synergy initiatives — the three dual-lane collections whose real-deal (non-demo) writes were previously unproven, verified by reading the deal's own SQLite table directly (not just via the API) to confirm the row lives in the custom* table and not the demo one."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (Part 3, dual-lane 1/2/3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Part 4's negative control (the two pre-existing unrelated 409s carry no conflict marker) asserted as live behavior, not a source grep — unchanged from plans 01/02, grouped under an explicit Part 4 heading."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (tests 4 and 15, referenced under the Part 4 heading)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Per-record granularity proven by real spawned OS processes on THREE collections (RAID, integration tasks, synergy initiatives), plus one cross-collection case proving the version predicate does not serialize unrelated collections beyond Phase 8's own per-file write lock."
    requirement: "CONC-02"
    verification:
      - kind: e2e
        ref: "test/optimistic-locking-cross-process.test.js (7 subtests: 3 RAID from plan 01, 2 integration-task, 1 synergy-initiative, 1 cross-collection — re-run twice with zero flakes)"
        status: pass
    human_judgment: false
  - id: D6
    description: "scripts/soak.js's reconciliation classifies 409 as its own outcome class under sustained real multi-process load: a dedicated conflict lane per worker races a shared RAID record; the record's version reconciles exactly against the acknowledged-write count; its final content matches the acknowledged write with the highest reported version; and the audit trail's membership set (by unique per-write marker, not a raw row count) proves nothing acknowledged is missing and nothing conflicted ever committed."
    requirement: "CONC-02"
    verification:
      - kind: e2e
        ref: "npm run soak (SOAK_DURATION_MS=15000, SOAK_PROCESSES=3 — smoke config; run twice, zero lost writes, zero violations both times, ~110-115 conflict-lane acknowledged / ~240 conflicted per run)"
        status: pass
    human_judgment: false
  - id: D7
    description: "09-VALIDATION.md filled and signed off against the seven plans as actually executed: an 18-row per-task verification map (one row per task across all seven plans), the Wave 0 requirements confirmed complete, five Manual-Only Verifications recorded with reasons, and the sign-off checklist genuinely satisfied."
    requirement: "CONC-02"
    verification:
      - kind: other
        ref: "grep -c '{' .planning/phases/09-optimistic-locking-conflict-recovery/09-VALIDATION.md returns 0 (no placeholder tokens); manual cross-check that all 35 referenced threat IDs (T-09-01 through T-09-35) exist in one of the seven plans' threat registers"
        status: pass
    human_judgment: false

# Metrics
duration: ~40min (including the pre-implementation read of all six prior SUMMARYs, server.js's ~35 route bodies, and db/store.js/auditHook.js's diff/audit mechanics)
completed: 2026-08-11
status: complete
---

# Phase 9 Plan 7: The Coverage Gate — Structural Scan, Cross-Collection Proof, Conflict-Aware Soak Summary

**Turned the accumulated per-plan contract into a self-enforcing gate: a generic character-index structural scan over `server.js`'s live source (mirroring `test/busy-503-contract.test.js`'s own recipe) now fails the suite by default when a future route mutates a versioned-collection record without a `conflictIfStale()` precheck, both directions of the collection inventory are cross-checked, the demo-only test gap for RAID/tasks/synergies' custom lane is closed, the cross-process proof grew to three collections plus a cross-collection case, and `scripts/soak.js` gained a dedicated conflict lane that produces and correctly reconciles genuine 409s under real sustained multi-process load.**

## Performance

- **Duration:** ~40 min end to end (commits span 09:49-10:02 local time; includes substantial upfront reading of all six prior plan SUMMARYs, `server.js`'s full route inventory, and `db/store.js`/`db/auditHook.js`'s diff/audit internals before writing any code)
- **Tasks:** 3
- **Files modified:** 4 (2 test files extended, 1 script extended, 1 planning doc filled)

## Accomplishments

- **Part 1 (structural coverage gate):** a NEW generic scan (`findVersionedLaneWriteHandlers`) walks every `app.(post|put|patch|delete)(...)` handler in `server.js` via the same brace-matching isolation `test/busy-503-contract.test.js` uses, finds every one that resolves a record from a versioned lane helper and calls `writeDb(`, and asserts a `conflictIfStale(` precheck precedes it — no hand-maintained route list. A 7-entry allow-list (create-only routes, the append-only org-decisions route, and one route the live scan itself surfaced — `DELETE /api/employees/:id`, which only reads `orgPositionsLane` as an occupancy guard) is the sole exemption mechanism, and it is cross-checked against the live scan so a stale entry cannot silently persist.
- **Part 2 (inventory cross-check, both directions):** the existing `VERSIONED_COLLECTIONS ⊆ ARRAY_COLLECTIONS` + dual-lane-presence test is retained; a NEW reverse-direction test confirms every lane helper's own referenced `db.<collection>` resolves back into `VERSIONED_COLLECTIONS`, and that `raidLane`/`taskLane`/`synergyLane` each resolve to exactly 2 collection keys (the demo lane plus its `custom*` shadow).
- **Part 3 (dual-lane proof):** three new tests exercise `demoMode:false` for RAID entries, integration tasks and synergy initiatives — the six prior plans' tests only ever ran against the demo lane, so real-deal (non-demo) writes on these three collections were previously unproven by this suite. Each test confirms, by reading the deal's own SQLite table directly, that the row lives in the `custom*` table and not the demo one.
- **Cross-process proof extended:** `test/optimistic-locking-cross-process.test.js`'s `CHILD_SCRIPT` was generalized to take its target collection as an argv entry (was hardcoded to `raidEntries`), and gained same-record/different-record pairs for integration tasks and synergy initiatives, plus one cross-collection case (two children racing DIFFERENT collections both commit, proving the version predicate does not serialize unrelated work beyond Phase 8's own per-file write lock).
- **Conflict-aware soak:** `scripts/soak.js` gained a dedicated conflict lane per worker process, racing every sibling worker against ONE shared RAID entry (the pre-existing pulses-only load can never produce a conflict — it only ever creates new rows). 409 is now its own outcome class in the reconciliation, verified by version-count reconciliation, final-content-matches-last-winner, and audit-trail set-membership (redesigned mid-implementation from a row-count comparison after a live smoke run exposed why a count cannot work — see Deviations).
- Hardened `test/optimistic-locking-cross-process.test.js` against the intermittent "unable to open database file" flake documented in this session's context: every temp deal-db file now lives inside the test's own `TMP_DIR` rather than the shared system `os.tmpdir()` root, plus a retry-on-open wrapper around every migration/connection-open call including inside the spawned child process.
- `09-VALIDATION.md` filled and signed off (`nyquist_compliant: true`, `wave_0_complete: true`) against an 18-row per-task verification map spanning all seven plans, with five Manual-Only Verifications recorded (one approved, four still-pending per-page spot-checks each plan's own SUMMARY had already flagged).

## Task Commits

Each task was committed atomically:

1. **Task 1: The coverage gate — no future route ships unprotected** - `fdac74a` (test)
2. **Task 2: Cross-collection concurrency proof and a conflict-aware soak** - `5d188f8` (test)
3. **Task 3: Fill and sign off the phase validation contract** - `f6d1090` (docs)

## Files Created/Modified

- `test/optimistic-locking-contract.test.js` - Part 1 structural coverage gate (`findVersionedLaneWriteHandlers`, `VERSIONED_WRITE_ALLOWLIST`), Part 2 reverse-direction cross-check, Part 3 dual-lane tests (52 tests total, up from 47)
- `test/optimistic-locking-cross-process.test.js` - generalized `CHILD_SCRIPT`/`spawnRaceChild` for a `collection` argv entry, 4 new tests (7 total, up from 3), TMP_DIR-scoped `tempDbPath()` + `openWithRetry()` flake hardening
- `scripts/soak.js` - `createSharedConflictRecord()`, `runConflictLane()`, `runWorkerLoad()` now runs it concurrently with the pulses lanes, `verify()` gained checks 6-9 for the conflict outcome class
- `.planning/phases/09-optimistic-locking-conflict-recovery/09-VALIDATION.md` - filled from draft to signed-off, all frontmatter flags genuinely satisfied

## Decisions Made

- **Allow-list grew to 7 entries, not the plan's named 5** — the live scan itself surfaced `DELETE /api/employees/:id` (reads `orgPositionsLane` only as an occupancy guard, writes an unrelated collection). Classified and reasoned rather than narrowing the scan's own matching logic to dodge it.
- **Kept tests 1-44 and their per-plan structural checks rather than deleting them** — those tests lock in ordering invariants (T-09-19/T-09-27's `ddAreaRefused`-before-`conflictIfStale`, `positionGraphFailure` ordering) the generic Part 1 scan does not itself express. Organized under new Part 1-4 headings rather than replaced.
- **The soak's conflict lane targets ONE shared record across ALL worker processes**, not one record per worker — the harness's entire point is real cross-process contention.
- **Check 8 (409-to-audit reconciliation) redesigned from a row count to set membership** — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, found via the plan's own smoke-verification step] `scripts/soak.js`'s Check 8 initially compared a raw audit row COUNT against the conflict lane's acknowledged-write count, which is structurally wrong given this codebase's write model**
- **Found during:** Task 2's own smoke verification (`SOAK_DURATION_MS=15000 npm run soak`) — the very first run reported `raidUpdateAuditRows=1257` against `conflictAcknowledged=112`, an ~11x overcount.
- **Issue:** `db/store.js`'s `writeDb()` visits EVERY row of EVERY `VERSIONED_COLLECTIONS` table on EVERY call (the whole-object snapshot-diff design), and Plan 01's own "untouched row" fast-path fix rewrites — and therefore re-audits — a versioned row even when its OWN content did not change. Since the pulses lane runs concurrently and calls `writeDb()` far more often than the conflict lane, the shared RAID record accumulated many content-identical "echo" audit rows from unrelated writes, not just genuine conflict-lane commits. A raw count comparison would have failed this check on every run regardless of correctness.
- **Fix:** Redesigned the check to verify by SET MEMBERSHIP on a unique per-write marker (`notes` field) instead: every acknowledged conflict-lane write's marker must appear at least once in the audit trail, and no CONFLICTED (409-rejected) write's marker may ever appear there. Immune to the echo phenomenon since it checks presence, not count, while still correctly failing if a conflict ever secretly committed or an acknowledged write ever secretly vanished.
- **Files modified:** `scripts/soak.js`
- **Verification:** Re-ran the smoke soak twice after the fix — both runs PASS with zero lost writes, zero violations, genuine conflicts present (~110-115 acknowledged / ~240 conflicted per 15s run at 3 processes).
- **Committed in:** `5d188f8` (Task 2 commit — the check was corrected before the first commit of this task, so no separate fix-up commit was needed)

---

**Total deviations:** 1 auto-fixed (Rule 1, correctness — a verification check that would have false-failed on every run). No scope creep.

### Documented Tool Mismatch (not an auto-fix — Task 3's `<verify>` names a nonexistent gsd-tools schema)

**Task 3's `<verify>` block names `node "$HOME/.claude/gsd-core/bin/gsd-tools.cjs" query frontmatter.validate .planning/phases/09-optimistic-locking-conflict-recovery/09-VALIDATION.md --schema validation`.** The installed `gsd-tools` only defines four `frontmatter.validate` schemas: `plan`, `plan-gap-closure`, `summary`, `verification` — no `validation` schema exists (confirmed by reading `$HOME/.claude/gsd-core/bin/lib/frontmatter.cjs`'s `FRONTMATTER_SCHEMAS` object directly). The closest name, `verification`, requires an entirely different field set (`phase`, `verified`, `status`, `score`) belonging to a DIFFERENT document type (`/gsd-verify-work`'s own VERIFICATION.md output), not this phase-level validation-contract document. This matches the exact class of plan-text/tool mismatch every prior plan in this phase independently documented (Plan 04's `test/dd-clearance.test.js` reference to a file that does not exist). Substituted the acceptance criteria's own literal, explicit check instead: `grep -c '{' .planning/phases/09-optimistic-locking-conflict-recovery/09-VALIDATION.md` returns `0` — confirmed — satisfying "contains no remaining `{placeholder}` token" exactly as worded. Did not attempt to add a `validation` schema to `gsd-core`'s shared tooling — that is out of this plan's scope (a shared, project-external tool, not a phase deliverable) and would be Rule 4 (architectural) territory regardless.

## Issues Encountered

None beyond the deviation and tool mismatch documented above.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

- Phase 9 (`09-optimistic-locking-conflict-recovery`) is now complete across all 7 plans / 18 tasks / 6 waves. The full suite is green at 775/775, up from the 766/766 baseline this plan's worktree forked from.
- The structural coverage gate is now self-enforcing: any future route added to `server.js` that mutates a `VERSIONED_COLLECTIONS` record without a `conflictIfStale()` precheck will fail `npm test` by default, with the offending route named in the assertion message — no further phase or plan needs to remember to extend a hand-maintained list.
- `scripts/soak.js`'s conflict lane is now a permanent, reusable fixture — any future phase that wants to prove a NEW write path's behavior under real multi-process contention (not just RAID) can add a second lane following the exact same pattern (`createSharedConflictRecord`-style helper + `runConflictLane`-style racer + membership-based audit reconciliation).
- **Manual verification still pending** (not merge-blocking, but recommended before this phase's UAT closes): the four per-page two-tab browser spot-checks named in `09-VALIDATION.md`'s Manual-Only Verifications table (integration-task/synergy-initiative edit surfaces on `execution.html`, `due-diligence.html`'s finding/request-item surfaces, `org.html`'s position surface, and the destructive-delete two-tab walk on `execution.html`/`org.html`) — each was independently deferred by its own originating plan's SUMMARY (09-02 D10, 09-04 D7, 09-05 D8, 09-06 D3) and none has yet been performed. Plan 03's own required checkpoint (the conflict dialog's rendering/interaction walk) IS approved.

## Self-Check: PASSED

- FOUND: test/optimistic-locking-contract.test.js (52 tests, all passing)
- FOUND: test/optimistic-locking-cross-process.test.js (7 tests, all passing)
- FOUND: scripts/soak.js (conflict lane present, `grep -c "409"` returns 14)
- FOUND: .planning/phases/09-optimistic-locking-conflict-recovery/09-VALIDATION.md (no placeholder tokens, `status: validated`, `nyquist_compliant: true`, `wave_0_complete: true`)
- FOUND commit: fdac74a (Task 1)
- FOUND commit: 5d188f8 (Task 2)
- FOUND commit: f6d1090 (Task 3)
- npm test: 775/775 passing

---
*Phase: 09-optimistic-locking-conflict-recovery*
*Completed: 2026-08-11*
