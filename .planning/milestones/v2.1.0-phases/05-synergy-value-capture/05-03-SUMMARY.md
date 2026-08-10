---
phase: 05-synergy-value-capture
plan: 03
subsystem: api
tags: [express, zod, synergy-tracker, stage-gates, baseline-history, authz, sqlite]

# Dependency graph
requires:
  - phase: 05-synergy-value-capture (plan 02)
    provides: "SYN_STAGES four-value confidence-stage vocabulary (idea/validated/committed/captured), all three independent copies cut over"
provides:
  - "STAGE_ORDER + stageGateFailure(): D-08's cumulative hard gates (committed requires owner+phased target, captured requires realized value in an arrived month), evaluated across every intervening ordinal on a multi-step advance"
  - "POST /api/synergies/:id/stage: the ONLY route that may move an initiative's stage — same-stage no-op, gated forward move, reasoned (D-09) backward move; base upsert refuses a `stage` key outright (no bypass)"
  - "pushBaseline(): append-only baseline snapshot (D-12), version derived from the highest existing version, deep-copies item.phasing into targetCurve so a stored baseline can never drift"
  - "POST /api/synergies/:id/rebaseline: explicit re-baseline act, restricted to admin+hrbp via isAdminOrIlRequest() (D-15), role guard runs BEFORE the 404 lookup (no existence oracle) — proven by a four-identity 200/200/403/403 test using the identical payload"
  - "generate-phasing stamps baseline v1 ('the deal case') the first time an initiative gets a phased target; never re-stamped, renumbered or reordered afterwards (D-14)"
  - "Base upsert: a run-rate/curve-shape change on a committed-or-later initiative requires a reason and forces a pre-change baseline snapshot (D-13); below committed the same fields stay ordinary edits"
affects: [05-04 cost-to-achieve, 05-05 staleness/rollup, 05-06 stage-control-UI (client rewrite required — the old status-cycle handler in execution.js now 400s against the base upsert bypass block), 05-07 rollup reporting, Phase 7 RPT-03 (variance against deal case)]

# Actuals (#2632)
actuals:
  tokens: 11045   # chars/4 over the plan's realized diff (server.js + validators/workstream.js + test/synergy-stage.test.js), d31c9c1..HEAD
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Cumulative stage-gate evaluation: stageGateFailure() walks every ordinal between current and target (not just the target's own), so a multi-step jump (idea -> captured) cannot skip an intervening gate — D-08's own stated requirement, verified by test rather than left to route-handler discipline"
    - "Inline role-narrowing on a dynamic :id sub-route, mirroring isAdminRequest()/POST /api/deals/:id/members precedent: ROLE_WRITE_POLICY's flat prefix table grants the coarse '/api/synergies' role set (admin+hrbp+pmo); isAdminOrIlRequest() narrows FURTHER inside the handler for D-15 specifically, deliberately excluding the X-Admin-Token break-glass path isAdminRequest() accepts"
    - "Version-from-max-not-length: pushBaseline() derives the next version from the highest existing baselines[].version, never array length — a defensive choice against a hypothetical future baseline-deletion path silently reusing a version number (T-05-16)"
    - "Pre-change snapshot ordering: both the stage route's demotion branch and the base upsert's D-13 forced re-baseline call pushBaseline() BEFORE mutating item.stage/runRateM/curveShape — the baseline pins what was superseded, not what replaced it"

key-files:
  created: []
  modified:
    - server.js
    - validators/workstream.js
    - test/synergy-stage.test.js

key-decisions:
  - "The stage route's demotion branch was implemented inline in Task 1's commit (mirroring pushBaseline()'s eventual shape exactly), then refactored in Task 2's commit to call the newly-defined pushBaseline() — a behavior-neutral consolidation once the shared function existed, keeping each task's diff scoped to what that task's own tests required"
  - "Base upsert's runRateM/curveShape fields were previously accepted by SynergyUpsertSchema but never actually applied by the update-branch handler (schema/handler had drifted) — added the missing item.runRateM/item.curveShape assignment as part of Task 2 (Rule 2: this is what D-13's own behavior block requires to be testable at all, and what the schema already anticipated)"
  - "generate-phasing's deal-case stamp reads item.phasing AFTER the fresh rows are generated (not before) — the deal case pins the just-generated ramp, matching D-14's 'stamped when its first phased target is generated' wording exactly, not the pre-generation empty state"

patterns-established:
  - "Defence-in-depth unit assertion for an HTTP-unreachable state: stageGateFailure() is exported directly so a hand-constructed item object (future-month-only realized value) can prove the captured gate still refuses it, even though no normal write path can ever produce that state (Plan 01's own arrival gate already blocks it) — the plan's own objective text called this out explicitly as 'asserted here anyway as a defence in depth'"

requirements-completed: [SYN-03]

coverage:
  - id: D1
    description: "D-08 cumulative hard stage gates: committed requires a non-empty owner AND a phased target (positive run-rate + start month); captured requires realized value in at least one arrived month; every intervening ordinal is evaluated on a multi-step advance; a refused advance leaves the persisted stage unchanged (verified via GET readback, not just the response)"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-gate (a)-(e)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-09 reasoned backward stage movement: no reason and a whitespace-only reason both 400 with zero baseline entries appended; a real reason succeeds, changes the stage, and appends a baseline entry carrying that reason and the PRE-CHANGE stage; a same-stage request is a 200 no-op with no state change, no baseline entry and no lastConfirmedAt stamp"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage-gate (f)-(h)"
        status: pass
    human_judgment: false
  - id: D3
    description: "T-05-13: the base upsert refuses a `stage` key outright (400, stored stage unchanged) — the dedicated stage route is the ONLY path that can move a stage, closing the bypass the gate would otherwise be pointless against"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-stage (f)"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-15 re-baseline authz: POST /api/synergies/:id/rebaseline with the IDENTICAL payload returns 200 for admin and hrbp, 403 for pmo and employee; baselines.length is unchanged after each 403; the 403 fires for an unknown initiative id too, proving the role guard runs before the 404 lookup (no existence oracle) — the CR-01-class two-identity proof this codebase has needed at the review gate in four consecutive phases"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-baseline (a), (b)"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-12 baseline deep copy: a baseline's targetCurve is captured by value at snapshot time — mutating a live phasing row afterwards through the per-month route leaves the stored baseline's targetCurve unchanged"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-baseline (e)"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-14 pinned deal case: version 1 is stamped the first time generate-phasing runs; three successive re-baselines never move, renumber, replace or touch the entry at index 0 (same id, version, timestamp and reason survive every later re-baseline); a later entry's version is derived from the highest existing version, not the array length"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-baseline (d)"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-13 forced re-baseline once committed: a run-rate/curve-shape change on a committed-or-later initiative without a reason 400s with zero baselines appended; the same change with a reason succeeds and appends exactly one baseline pinning the PRE-CHANGE run-rate; below committed the identical field change needs no reason and appends no baseline"
    requirement: SYN-03
    verification:
      - kind: unit
        ref: "test/synergy-stage.test.js#synergy-baseline (c), (f), (g)"
        status: pass
    human_judgment: false

duration: ~16min (session start to Task 2 commit; Task 1 commit to Task 2 commit was ~5.5min)
completed: 2026-08-06
status: complete
---

# Phase 5 Plan 3: Stage Gates, Baseline History and Re-baseline Authz Summary

**SYN-03's server half: cumulative D-08 hard stage gates, D-09 reasoned backward movement, an append-only D-12/D-14 baseline-snapshot model with a pinned deal case, D-13 forced re-baselining once committed, and D-15's admin+hrbp-only re-baseline authz proven by a four-identity 200/200/403/403 test.**

## Performance

- **Duration:** ~16 min (session start to final task commit; Task 1 commit 09:14:13 -> Task 2 commit 09:19:40, ~5.5 min between them)
- **Started:** 2026-08-06T09:04:58+02:00 (approx, following Plan 02's completion commit)
- **Completed:** 2026-08-06T09:19:40+02:00
- **Tasks:** 2
- **Files modified:** 3 (server.js, validators/workstream.js, test/synergy-stage.test.js)

## Accomplishments
- `STAGE_ORDER` (derived from `SYN_STAGES`, never a fifth hand-written vocabulary copy) and `stageGateFailure(item, targetStage)` — evaluates every gate between the current and target ordinal, not only the target's own, so a jump straight to `captured` cannot skip the `committed` gate
- `POST /api/synergies/:id/stage` — same-stage is a no-op 200; a forward move runs the gate and 400s with its exact refusal reason (the string the client alerts verbatim); a backward move requires a non-empty trimmed reason (D-09) and records it, with the pre-change stage, in the initiative's baseline history; stamps `lastConfirmedAt` on any real change (D-16)
- Base upsert refuses a `stage` key outright (400) — no alternative route can move a stage past the gate (T-05-13)
- `pushBaseline(item, req, reason)` — the single append-only baseline-entry constructor used by every write path that creates one (stage demotion, forced re-baseline, explicit re-baseline, the deal-case stamp); version derived from the highest existing version (never array length, T-05-16); `targetCurve` is a deep copy of `item.phasing`, proven by a mutate-after-snapshot test
- `isAdminOrIlRequest(req)` — admin+hrbp only, reads only the server-resolved `req.portalUser.role`, deliberately excludes the `X-Admin-Token` break-glass path `isAdminRequest()` accepts
- `POST /api/synergies/:id/rebaseline` — role guard is the handler's first statement (before the 404 lookup, no existence oracle per T-05-17); requires a non-empty trimmed reason; proven by a four-identity test sending the byte-identical payload (admin 200, hrbp 200, pmo 403, employee 403)
- `generate-phasing` stamps baseline v1 ("the deal case") the first time an initiative gets a phased target; a `.length === 0` guard stops any later regeneration from creating a competing v1
- Base upsert gained a D-13 forced-re-baseline branch: a `runRateM`/`curveShape` change on a committed-or-later initiative requires a reason and snapshots the pre-change state via `pushBaseline()` before applying; the same fields also became directly editable via the base upsert for the first time (previously only `generate-phasing` could set them) — a Rule 2 addition, since D-13's own behavior block requires this path to exist
- `StageChangeSchema` and `RebaselineSchema` registered; optional `reason` added to `SynergyUpsertSchema`
- `test/synergy-stage.test.js`: 16 new tests (8 per task) covering every bullet in both tasks' behavior blocks, plus a defence-in-depth captured-gate assertion made directly against the exported `stageGateFailure()` for a state the normal write path can never produce

## Task Commits

Each task was committed atomically:

1. **Task 1: Stage-gate route — gated advance, reasoned demotion** — `a67c2b8` (feat)
2. **Task 2: Baseline history, the pinned deal case, and re-baseline authz** — `1473e23` (feat)

_Both tasks were `tdd="true"` at the task level — tests were written alongside the implementation and run to green before each commit, per this plan's own task-level (not file-level) TDD granularity, matching Plan 02's precedent._

## Files Created/Modified
- `server.js` — `STAGE_ORDER`, `stageGateFailure()`, `pushBaseline()`, `isAdminOrIlRequest()`, `POST /api/synergies/:id/stage`, `POST /api/synergies/:id/rebaseline`, base-upsert stage-bypass block + D-13 forced-re-baseline branch + newly-wired `runRateM`/`curveShape` editability, `generate-phasing`'s deal-case stamp, `STAGE_ORDER`/`stageGateFailure` exports
- `validators/workstream.js` — `StageChangeSchema`, `RebaselineSchema` (+ `registerSchema()` calls), optional `reason` field on `SynergyUpsertSchema`, both new schemas exported
- `test/synergy-stage.test.js` — 16 new tests across two named groups (`synergy-stage-gate` for Task 1, `synergy-baseline` for Task 2), plus one existing test (`synergy-stage (f)`) rewritten to match the new stage-bypass-blocked contract

## Decisions Made
- The stage route's demotion branch was written inline in Task 1 (matching `pushBaseline()`'s eventual shape exactly) then refactored to call `pushBaseline()` in Task 2, once that function existed — a behavior-neutral consolidation, not a second baseline-append implementation
- `runRateM`/`curveShape` were schema-accepted on the base upsert since Plan 01 but never actually applied by the update-branch handler; wiring them in was necessary for D-13's own behavior block to be testable and is a strict extension (no prior working flow relied on them being silently ignored)
- `generate-phasing`'s deal-case stamp snapshots `item.phasing` AFTER the fresh rows are generated, matching D-14's "stamped when its first phased target is generated" wording exactly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Wired `runRateM`/`curveShape` into the base upsert's update branch**
- **Found during:** Task 2 (implementing D-13's forced re-baseline)
- **Issue:** `SynergyUpsertSchema` has accepted `runRateM`/`curveShape` as optional fields since Plan 01 ("accepted here too since the base upsert schema is the one place every synergy field is validated"), but the actual `POST /api/synergies` update-branch handler never applied either field — only the dedicated `generate-phasing` route could set them. D-13's behavior block explicitly requires "a post-commitment `runRateM` change... returns 200" through the base upsert, which was impossible without this wiring.
- **Fix:** Added `if (b.runRateM !== undefined) item.runRateM = num(b.runRateM);` and `if (b.curveShape !== undefined) item.curveShape = b.curveShape;` to the update branch, placed after the D-13 gate check (so the pre-change snapshot captures the OLD value before these lines run).
- **Files modified:** `server.js`
- **Verification:** `test/synergy-stage.test.js#synergy-baseline (f)`/(g) both exercise this path directly; full suite green (285/285)
- **Committed in:** `1473e23` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Necessary for an already-scoped acceptance criterion (D-13's behavior block) to be reachable at all. No scope creep — the fields were already schema-validated and semantically expected to exist by the plan text itself.

## Issues Encountered
- Initial version of the D-12 deep-copy test (`synergy-baseline (e)`) used `runRateM: 12` with `startMonth: '2020-01'`, which rounds the ramp's first-month `targetM` to 0.0 (linear curve's month-1 attainment is too small at that run-rate to survive one-decimal rounding) — the sanity assertion (`originalTargetM > 0`) failed. Fixed by raising the fixture's `runRateM` to 240, which guarantees a non-trivial nonzero first-month value regardless of the exact interpolation math. No production code was affected — this was a test-fixture-only fix.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SYN-03's server-side gates, reasoned demotions, baseline snapshots, pinned deal case and re-baseline authz are all in place and test-proven — Plan 06 (stage-control UI) can build the client against a contract that already refuses every bypass it might otherwise be tempted to route around
- **Known transient client breakage (in scope for Plan 06, not this plan):** `public/js/execution.js`'s existing click-to-cycle stage handler (line ~377) still POSTs `{id, stage: next}` to the base upsert, which this plan now refuses with 400 — this plan's `files_modified` list scoped it to `server.js`/`validators/workstream.js`/the test file only, and the phase's own artifact roster assigns `renderStageControl()` (the gated pill-and-caret replacement) to Plan 06. Until Plan 06 lands, clicking the old stage badge in the live UI will silently no-op (the handler's `.then()` has no `else` branch, per the existing pattern noted in 05-PATTERNS.md) rather than crash.
- `pushBaseline()` is the single choke point every future baseline-appending write should call (cost-to-achieve or task-linkage changes in Plans 04/05 that might someday want baseline-adjacent history should route through it, not reimplement the version-derivation/deep-copy logic)
- Phase 7's RPT-03 (variance against deal case) can now read `baselines[0]` with the same immutability guarantee this plan's tests prove

---
*Phase: 05-synergy-value-capture*
*Completed: 2026-08-06*

## Self-Check: PASSED

All modified files confirmed present on disk; both task commits (`a67c2b8`, `1473e23`) confirmed in `git log`.
