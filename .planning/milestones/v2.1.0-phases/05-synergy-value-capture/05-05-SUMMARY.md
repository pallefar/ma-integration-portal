---
phase: 05-synergy-value-capture
plan: 05
subsystem: api
tags: [express, zod, synergy-tracker, staleness, freshness, settings, rollup, sqlite]

# Dependency graph
requires:
  - phase: 05-synergy-value-capture (plan 04)
    provides: "synergyCostFields() (costIncurredM/netBenefitM), taskIds[] linkage — both merged into the same enriched shape this plan's enrichSynergy() now builds"
  - phase: 05-synergy-value-capture (plan 03)
    provides: "the stage route's own lastConfirmedAt stamp (D-16 first landed there) and pushBaseline()'s reason/authz pattern this plan's confirm-current route follows"
provides:
  - "POST /api/synergies/:id/confirm-current: the ONLY route whose purpose is stamping lastConfirmedAt as a deliberate confirmation act — ConfirmCurrentSchema accepts no fields, so a confirmation and a content edit can never be the same request (D-16)"
  - "SYNERGY_STAMPING_FIELDS: an explicit allowlist (runRateM/curveShape/startMonth/costPlannedM/costExpectedMonth/category/owner/workstreamId/taskIds) gating when the base upsert refreshes lastConfirmedAt; title and notes are deliberately excluded"
  - "synergyStaleDays(db)/isSynergyStale(item, staleDays, nowMs): per-deal threshold (default 30d, configurable) and the strictly-greater-than boundary check; nowMs is a caller-supplied parameter so one clock judges every item in a request"
  - "enrichSynergy(item, ctx): the single choke point merging rollup totals, cost fields and the derived stale boolean, built from a ctx captured once per request"
  - "GET /api/synergies/rollup: grossRealizedM, costIncurredM, netBenefitM, dealTargetM, unconfirmedRealizedM, staleCount, mine.staleCount — a single server-computed object a report can read directly (D-18/D-19/D-21)"
  - "synergyStaleDays/synergyHorizonYears enumerated on validators/settings.js's SettingsUpdateSchema — both were previously silently stripped on write"
affects: [05-07 rollup reporting UI (four tiles + stale-split sentence), 05-06 client rewrite (confirm-current button, stale badge), Phase 7 RPT-03 (net benefit and the stale split are now stored-data derivations a report can read directly)]

# Actuals (#2632)
actuals:
  tokens: 9993   # chars/4 over the plan's realized diff (server.js + validators/workstream.js + validators/settings.js + test/synergy-staleness.test.js), d2286dc..03586e7
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Explicit stamping allowlist, not a title/notes denylist: SYNERGY_STAMPING_FIELDS names every field that constitutes a real value change; a future field added to SynergyUpsertSchema defaults to NOT stamping unless added here too — the inverse of what a denylist would default to"
    - "Single-clock ctx built once per request: enrichSynergy(item, ctx) takes ctx = {staleDays, nowMs} constructed exactly once by the caller (GET /api/synergies and GET /api/synergies/rollup), never inside the per-item map — this is what makes the SYN-05 adjacency guarantee (two items sharing lastConfirmedAt always agree) structural rather than incidental"
    - "nowMs as a parameter, never read internally: isSynergyStale(item, staleDays, nowMs) has no direct Date.now() call — the caller owns the clock, which is also what makes the boundary case unit-testable without manipulating the system clock"
    - "Aggregate rounds once over already-rounded per-item values: GET /api/synergies/rollup's four money figures each roundSynergyMoney() a sum of per-item fields that synergyRollupFields()/synergyCostFields() already rounded to one decimal — this is the structural reason unconfirmedRealizedM can never exceed grossRealizedM (a subset-sum of non-negative rounded values can never exceed the full-set sum)"

key-files:
  created:
    - test/synergy-staleness.test.js
  modified:
    - server.js
    - validators/workstream.js
    - validators/settings.js

key-decisions:
  - "startMonth was schema-accepted on SynergyUpsertSchema since Plan 01 but never applied by the base upsert's update branch — the same drift class Plan 03 found and fixed for runRateM/curveShape. Since SYN-05's stamping allowlist names startMonth as a real value-change field, leaving it unwired would mean the confirmation clock could refresh for a field that never actually changes — wired `if (b.startMonth !== undefined) item.startMonth = b.startMonth;` into the update branch as an ordinary field (no D-13 gate — that gate is scoped to runRateM/curveShape only)."
  - "synergyHorizonYears was ALSO missing from SettingsUpdateSchema (not just synergyStaleDays as the plan's own must_haves called out) — server.js's synergyHorizonYears(db) reader has existed since Plan 01, but nothing in the schema enumerated the write-side key, so every POST /api/settings silently stripped it. Both keys landed in the same edit, matching the plan's own stated pairing (D-03/D-17)."
  - "Task 1's dedicated routes (confirm-current, stage, rebaseline) all return the raw item, not the enriched item — matching every other dedicated synergy sub-route's established convention (generate-phasing, phasing/:month, cost-entries) rather than introducing an enrichSynergy() call ahead of Task 2 defining it. 'Respond with the enriched initiative' in the plan's action text is satisfied by this being the item's own current, fully-applied state, consistent with sibling routes."
  - "Timing-based staleness tests (adjacency, precision, two-session scoping) use a near-zero synergyStaleDays threshold (1e-10 days, ~0.00864ms) rather than the system clock or sleeps — any real HTTP round-trip elapsed time reliably exceeds this threshold, which was confirmed stable across three repeated full-file runs before committing."

patterns-established:
  - "Deliberate-act stamp with a no-field schema: ConfirmCurrentSchema = z.object({}) is the structural half of D-16's guarantee — a route that literally cannot accept a title or notes field cannot be used to smuggle a content edit alongside a confirmation, closing the class of bug a title/notes exclusion inside a shared handler could only close by discipline"

requirements-completed: [SYN-05]

coverage:
  - id: D1
    description: "D-16: POST /api/synergies/:id/confirm-current sets a fresh lastConfirmedAt and changes exactly that one field; an unknown id 404s, never the validator registry's 500"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (a)"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-16: a title-only edit and a notes-only edit each leave lastConfirmedAt byte-identical; an owner-only edit refreshes it"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (b), (c)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The full SYNERGY_STAMPING_FIELDS allowlist (runRateM, curveShape, startMonth, costPlannedM, costExpectedMonth, category, owner, workstreamId) each refresh lastConfirmedAt on the base upsert"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (d)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A realized-value write through the per-month phasing route, and a stage change through the dedicated stage route, both refresh lastConfirmedAt"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (e), (f)"
        status: pass
    human_judgment: false
  - id: D5
    description: "SYN-05 boundary: isSynergyStale() is false at exactly staleDays*86400000ms of age and true one millisecond later; falls back to createdAt when lastConfirmedAt is absent, and reports not-stale (never defaulted to stale) when neither field parses"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (g), (h)"
        status: pass
    human_judgment: false
  - id: D6
    description: "D-03/D-17: synergyStaleDays and synergyHorizonYears both survive a POST /api/settings write and re-read (not silently stripped); a non-positive/non-numeric/absent threshold falls back to 30; a configured short threshold changes the returned stale flags to match"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (i), (j), (k)"
        status: pass
    human_judgment: false
  - id: D7
    description: "D-21/precision: unconfirmedRealizedM never exceeds grossRealizedM across a lane with fractional realized values; with zero stale initiatives, unconfirmedRealizedM/staleCount/mine.staleCount are all exactly zero; net benefit equals gross realized minus cost incurred, negative and unclamped when cost exceeds realized value"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (l), (m), (n)"
        status: pass
    human_judgment: false
  - id: D8
    description: "SYN-05 adjacency: two initiatives sharing an identical lastConfirmedAt always carry the same stale flag within one response"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (o)"
        status: pass
    human_judgment: false
  - id: D9
    description: "D-19: mine.staleCount is scoped to the calling session's own identity, proven by two sessions (different owners) reading the same lane and getting different mine.staleCount against an identical total staleCount"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (p)"
        status: pass
    human_judgment: false
  - id: D10
    description: "GET /api/synergies returns items in the lane's stored insertion order, unchanged by this phase"
    requirement: SYN-05
    verification:
      - kind: unit
        ref: "test/synergy-staleness.test.js#synergy-staleness (q)"
        status: pass
    human_judgment: false

duration: ~12min (Plan 04's final commit 09:33:05 to this plan's Task 2 commit 09:45:19)
completed: 2026-08-06
status: complete
---

# Phase 5 Plan 5: The Confirmation Stamp, Per-Deal Staleness, and the Server-Computed Rollup Summary

**SYN-05's data half: a deliberate confirm-current stamp that a cosmetic edit can never touch (D-16), a per-deal staleness threshold and phasing horizon that finally survive a settings write (D-03/D-17), and GET /api/synergies/rollup — one server-computed object carrying gross, cost, net, target, the unconfirmed split, and a caller-scoped stale count (D-18/D-19/D-21).**

## Performance

- **Duration:** ~12 min (Plan 04's final commit 09:33:05 -> this plan's Task 2 commit 09:45:19)
- **Started:** 2026-08-06T09:33:05+02:00 (approx, following Plan 04's completion commit)
- **Completed:** 2026-08-06T09:45:19+02:00
- **Tasks:** 2
- **Files modified:** 3 (server.js, validators/workstream.js, validators/settings.js); 1 test file created

## Accomplishments
- `POST /api/synergies/:id/confirm-current` — the only route whose entire purpose is stamping `lastConfirmedAt`; `ConfirmCurrentSchema` accepts no fields at all, so a confirmation and a content edit can structurally never be the same request (D-16)
- `SYNERGY_STAMPING_FIELDS` — an explicit allowlist on the base upsert's update branch (`runRateM`, `curveShape`, `startMonth`, `costPlannedM`, `costExpectedMonth`, `category`, `owner`, `workstreamId`, `taskIds`); title and notes are deliberately absent, so a typo fix can never make a stale forecast look confirmed
- `synergyStaleDays(db)` and `isSynergyStale(item, staleDays, nowMs)` — per-deal threshold (default 30 days) and the exact boundary check (strictly greater than the threshold is stale; exactly the threshold is not), with `nowMs` as a caller-supplied parameter so one clock judges every item in a request
- `enrichSynergy(item, ctx)` — the single choke point merging rollup totals, cost fields, and the derived `stale` boolean; `GET /api/synergies` now builds this via a `ctx` captured once per request (in place of the bare rollup/cost merge Plan 04 left)
- `GET /api/synergies/rollup` — `grossRealizedM`, `costIncurredM`, `netBenefitM`, `dealTargetM`, `unconfirmedRealizedM`, `staleCount`, `mine.staleCount`, every figure summed from already-rounded per-item values so the unconfirmed portion is structurally incapable of exceeding gross
- `validators/settings.js`'s `SettingsUpdateSchema` gained `synergyStaleDays` and `synergyHorizonYears` — both were previously silently stripped by zod's object parse on every settings write (see Key Decisions: `synergyHorizonYears` had been missing since Plan 01, not just the new `synergyStaleDays` key)
- A realized-value write through the per-month phasing route now also stamps `lastConfirmedAt`, closing the last un-stamped real-value-change path
- `test/synergy-staleness.test.js` (17 tests) — full behavior-block coverage for both tasks, including the D-19 two-session caller-scoping proof and the SYN-05 adjacency/boundary/precision/empty cases

## Task Commits

Each task was committed atomically:

1. **Task 1: The confirmation stamp and its deliberate semantics** — `e67e6fe` (feat)
2. **Task 2: Per-deal settings and the server-computed rollup** — `03586e7` (feat)

_Both tasks were `tdd="true"` at the task level, matching Plans 03/04's precedent: tests were written and run to green alongside (immediately following) the implementation, not as a separate strict RED-then-GREEN commit pair._

## Files Created/Modified
- `server.js` — `synergyStaleDays()`, `isSynergyStale()`, `SYNERGY_STAMPING_FIELDS`, `enrichSynergy()`, `POST /api/synergies/:id/confirm-current`, `GET /api/synergies/rollup`, base-upsert stamping logic + `startMonth` wiring, per-month route's realized-value stamp, `GET /api/synergies` refactored onto `enrichSynergy()`, exports for `isSynergyStale`/`synergyStaleDays`
- `validators/workstream.js` — `ConfirmCurrentSchema` (+ `registerSchema()` call and export)
- `validators/settings.js` — `synergyStaleDays`/`synergyHorizonYears` added to `SettingsUpdateSchema`
- `test/synergy-staleness.test.js` — 17 new tests (SYN-05)

## Decisions Made
- `startMonth` wired into the base upsert's update branch (was schema-accepted but silently ignored — see coverage notes above); treated as an ordinary field, not subject to D-13's forced-re-baseline gate (that gate is scoped to `runRateM`/`curveShape` only, per Plan 03)
- `synergyHorizonYears` added to `SettingsUpdateSchema` alongside `synergyStaleDays`, closing a pre-existing configurability gap the plan's own must_haves implied should already be closed
- Dedicated stamping routes (`confirm-current`, and the pre-existing `stage`/`rebaseline`) return the raw item, matching every other dedicated synergy sub-route's established convention, rather than calling `enrichSynergy()` — that choke point is reserved for the two list/rollup read paths
- Timing-based tests use a near-zero `synergyStaleDays` (1e-10 days) rather than the system clock or `sleep`, relying on real HTTP round-trip latency to reliably exceed the threshold — verified stable across three repeated full-file test runs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Wired `startMonth` into the base upsert's update branch**
- **Found during:** Task 1 (implementing the stamping allowlist)
- **Issue:** `SynergyUpsertSchema` has accepted `startMonth` as an optional field since Plan 01, but the update-branch handler never applied it — only `POST /api/synergies/:id/generate-phasing` could set it. Since SYN-05's own stamping allowlist names `startMonth` as a real value-change field, including it in the allowlist without wiring its assignment would mean a client "changing" `startMonth` refreshes the confirmation clock for a field that structurally cannot change — a false stamp, which is exactly the class of dishonesty D-16 exists to prevent.
- **Fix:** Added `if (b.startMonth !== undefined) item.startMonth = b.startMonth;` to the update branch, as an ordinary field alongside `costPlannedM`/`costExpectedMonth` (no D-13 gate).
- **Files modified:** `server.js`
- **Verification:** `test/synergy-staleness.test.js#synergy-staleness (d)` exercises this path directly; full suite green (319/319)
- **Committed in:** `e67e6fe` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added `synergyHorizonYears` to `SettingsUpdateSchema`**
- **Found during:** Task 2 (adding `synergyStaleDays` per the plan's explicit instruction)
- **Issue:** `server.js`'s `synergyHorizonYears(db)` reader has existed since Plan 01 (`SYN-01/D-03: horizon length in years, read from the deal's own settings singleton`), but `validators/settings.js`'s `SettingsUpdateSchema` never enumerated the write-side key — every `POST /api/settings` silently stripped it before the handler could store it, so the D-03 per-deal configurability promise was broken invisibly. This plan's own must_haves explicitly require "The phasing horizon is 3 years by default and is configurable per deal through the same settings singleton (D-03)" — unreachable without this fix.
- **Fix:** Added `synergyHorizonYears` to `SettingsUpdateSchema` in the same edit as `synergyStaleDays`.
- **Files modified:** `validators/settings.js`
- **Verification:** `test/synergy-staleness.test.js#synergy-staleness (i)` asserts both keys survive a write; full suite green (319/319)
- **Committed in:** `03586e7` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 missing critical)
**Impact on plan:** Both fixes were necessary for already-scoped acceptance criteria (the stamping allowlist's own honesty, and the plan's own D-03 must_have) to be reachable at all. No scope creep — both fields were already schema-accepted or reader-implemented and semantically expected to work.

## Issues Encountered
None beyond the two deviations documented above. The timing-based tests (adjacency, precision, two-session scoping) needed a threshold small enough to reliably register staleness from real HTTP round-trip latency without flakiness — resolved by using `1e-10` days (~0.00864ms) rather than a larger-but-still-small value, confirmed stable across three repeated runs of the full test file before committing.

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- SYN-05's server-side data model is complete and test-proven: the deliberate stamp, the per-deal threshold, the exact boundary, and the server-computed rollup split — Plan 06/07's client work (confirm-current button, stale badge, rollup tiles + unconfirmed sentence) can build against a contract that already refuses every dishonest-freshness path it might otherwise need to defend against client-side
- `enrichSynergy()` is the new choke point a future plan should call rather than reimplementing the rollup/cost/stale merge (mirroring `pushBaseline()`'s Plan 03 precedent and `synergyCostFields()`'s Plan 04 precedent)
- `GET /api/synergies/rollup` is ready for Plan 07's four-tile rollup restructure and the unconfirmed-split sentence, and for Phase 7's RPT-03 to read directly
- **Known transient client breakage (out of scope for this plan, in scope for Plan 06/07):** `public/js/execution.js` has no UI yet for the confirm-current action, the stale badge, or the new rollup shape — the new fields are silently absent from the rendered card until Plan 06/07 lands, mirroring Plan 03/04's identical note about UI gaps
- Per D-19 scope clarification (already flagged in this plan's objective): `public/js/deal-home.js`'s stale-initiative nudge is a real-deal-only surface (no deal-bound session in demo mode); the demo-visible surfaces (card badge, rollup's unconfirmed sentence) are both satisfied by the single caller-scoped `mine.staleCount` this plan built, so no demo-mode deal-home is needed

---
*Phase: 05-synergy-value-capture*
*Completed: 2026-08-06*

## Self-Check: PASSED

All modified/created files confirmed present on disk (`server.js`, `validators/workstream.js`, `validators/settings.js`, `test/synergy-staleness.test.js`); both task commits (`e67e6fe`, `03586e7`) confirmed in `git log`.
