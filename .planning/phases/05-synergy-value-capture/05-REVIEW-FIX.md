---
phase: 05-synergy-value-capture
fixed_at: 2026-08-06T00:00:00Z
review_path: .planning/phases/05-synergy-value-capture/05-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 5: Synergy Value Capture — Code Review Fix Report

**Fixed at:** 2026-08-06
**Source review:** .planning/phases/05-synergy-value-capture/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 8 (3 Critical + 5 Warning; no Info findings exist)
- Fixed: 8
- Skipped: 0

Every fix was applied inside an isolated git worktree (`/tmp/sv-05-reviewfix-JlXe0J`,
branch `gsd-reviewfix/05-65479`), verified with `npm test` (node:test, 358/358 at the
starting commit `b1f2770`) after every single commit, and fast-forwarded back onto
`main`. Each of the three Criticals carries a regression test that was proven to
**fail against the pre-fix code** (temporarily reverted the source change, re-ran the
test, confirmed the failure, then restored the fix) before being committed — not just
written and assumed correct. The same before/after proof was done for every Warning
too.

## Fixed Issues

### CR-01: Unbounded `synergyHorizonYears` setting allows any pmo/hrbp/admin caller to crash the shared Node process

**Files modified:** `validators/settings.js`, `server.js`, `test/synergy-phasing.test.js`
**Commit:** `5e1e26c`
**Applied fix:** Bounded `synergyHorizonYears` to `[1, 15]` at three layers — the zod
schema (`z.number().min(1).max(15)`), the `synergyHorizonYears(db)` reader (defensive
clamp for values already stored before the schema shipped), and `generatePhasingRows()`
itself (a third independent clamp, since the settings route is not the only way a value
could reach that function). Live-verified: `generatePhasingRows(1, '2026-01', 'linear',
2000)` now returns 180 rows (15 years × 12), not 24,000. `POST /api/settings
{synergyHorizonYears: 2000}` now returns 400. Three regression tests added (2 unit + 1
HTTP), all proven to fail pre-fix.

### CR-02: Stage-gate ordinal comparison silently bypasses every D-08 gate when `item.stage` is unrecognized

**Files modified:** `server.js`, `test/synergy-stage.test.js`
**Commit:** `123302d`
**Applied fix:** Added an explicit `currentOrdinal === undefined` guard at the top of
`POST /api/synergies/:id/stage`, before the same-stage no-op check — an unrecognized
current stage now fails closed with `500` and a clear message, instead of silently
falling into the backward-move branch (which required only a reason string and never
ran `stageGateFailure()`). The regression test seeds a raw `synergyInitiatives` row
with no `stage` key (simulating a pre-migration/WR-04 row) directly via SQLite, then
replays the review's exact exploit payload (`{targetStage: 'captured', reason: 'x'}`)
and asserts it is refused — proven to return `200` with `stage: 'captured'` against the
pre-fix code, and `500` with the stage unchanged after the fix.

### CR-03: Regenerating phasing on a `captured` initiative silently invalidates the captured-stage invariant with no gate re-check

**Files modified:** `server.js`, `test/synergy-stage.test.js`
**Commit:** `808300b`
**Applied fix:** **Adapted from the review's literal suggestion** — the review's shown
patch (`stageGateFailure(item, item.stage)`) is a no-op when `item.stage` already
equals the target, since `stageGateFailure`'s internal loop only walks ordinals
*strictly between* `fromOrdinal` and `toOrdinal`; calling it with `from === to` always
returns `null` regardless of whether the gate actually holds. Implemented a new
`demoteToSatisfiedStage(item)` helper instead: it walks the ordinal down from the
item's current stage, probing `stageGateFailure({...item, stage: SYN_STAGES[ord-1]},
SYN_STAGES[ord])` one ordinal at a time (which *does* correctly isolate a single
stage's own gate), stopping at the highest stage whose gate still passes against the
item's post-regeneration fields. `generate-phasing` now calls this after recomputing
the rollup and, if the item demotes, records an "Automatic demotion" baseline entry
(mirroring D-09's reasoned-demotion pattern) before applying the new stage. Live-tested
end-to-end: an initiative taken to `captured` with a real arrived-month realized value,
then regenerated with the same ramp inputs, is now demoted to `committed` (its
`committed` gate — owner + phased target — is unaffected by the regen) with
`realizedM: 0` and a baseline entry stating the automatic demotion; proven to fail
pre-fix (stayed `captured`).
**Verification note:** flagged `requires human verification` in the "requires deeper
sign-off" sense noted below — this fix's logic (walking down to the highest
still-satisfied stage, rather than a single-level demotion) is materially more complex
than the review's literal one-line suggestion, and while it is covered by a
before/after-proven regression test, a human should sanity-check the demotion
semantics against a live multi-stage scenario before this ships to a real deal.

### WR-01: `isAdminOrIlRequest()`'s own comment claims it excludes the X-Admin-Token break-glass identity — it does not

**Files modified:** `server.js`, `test/synergy-stage.test.js`
**Commit:** `f1a15eb`
**Applied fix:** Chose to implement the exclusion (the review's second option) rather
than just fixing the comment, since D-15 explicitly requires an *attributed human
role* and the codebase's security posture is maximalist by standing instruction.
`isAdminOrIlRequest()` now also checks `req.portalUser.sessionId !== null` — the
break-glass token path always sets `sessionId: null`, while every real session
(`db/sessions.js`'s `findSession()`) always carries a non-null `sessionId`. Exported
the function for direct pure-function unit testing (constructed `req` objects covering
break-glass/admin-session/hrbp-session/pmo/null), avoiding the need to stand up a
second `ADMIN_TOKEN`-configured HTTP test harness.

### WR-02: `roundSynergyMoney()` silently corrupts stored data to `null` on numeric overflow

**Files modified:** `server.js`, `test/synergy-cost.test.js`
**Commit:** `69d9869`
**Applied fix:** **Extended beyond the review's literal scope** — the review's fix
patches `roundSynergyMoney()` only, but `POST /api/synergies`'s own local `num` closure
(used for `targetM`/`realizedM`/`runRateM`/`costPlannedM` on both the create and update
branches) independently duplicated the exact same pre-fix buggy contract rather than
delegating to the shared helper, so patching `roundSynergyMoney()` alone would have
left that route's fields still vulnerable. Fixed `roundSynergyMoney()` to reject
non-finite results (`!isFinite(n)` check before rounding) AND replaced the local `num`
closure with `const num = roundSynergyMoney;`, eliminating the duplicate
implementation entirely. Verified `'1e400'` (well within `SynMoneyUnion`'s 20-char cap)
now rounds to `0` everywhere it flows — create, update, and cost-entries — never
`Infinity`/`null`.

### WR-03: `synergyStaleDays` has no upper bound — an admin/hrbp/pmo caller can permanently suppress the staleness governance signal

**Files modified:** `validators/settings.js`, `server.js`, `test/synergy-staleness.test.js`
**Commit:** `9337591`
**Applied fix:** Capped the schema and the reader at 365 days
(`z.number().max(365)` and `Math.min(n, 365)`). **Deliberately did NOT add a schema
floor** (unlike CR-01's horizon bound) — `test/synergy-staleness.test.js` legitimately
relies on setting `synergyStaleDays` to a sub-1-day fractional value (e.g.
`0.0000000001`) to make a just-created item read as stale without waiting real
wall-clock time; the reader's pre-existing `configured > 0` check already handles the
near-zero direction per its own comment, so only the previously-unbounded top end
needed a cap. Confirmed this preserves D-17's "30-day default, per-deal configurable"
decision — only the ceiling changed.

### WR-04: `scripts/migrate-synergy-stages.js` does not migrate the `customSynergyInitiatives` lane

**Files modified:** `scripts/migrate-synergy-stages.js`, `test/synergy-stage.test.js`
**Commit:** `b95cde0`
**Applied fix:** Chose the review's first option (migrate both lanes) over the second
(fail loudly) — this closes the gap at the source rather than only detecting it, and
CR-02's fail-closed guard remains as defense-in-depth for any row this migration still
somehow misses. Introduced `SYNERGY_LANE_TABLES = ['synergyInitiatives',
'customSynergyInitiatives']` and looped the existing per-row migration logic over both
tables inside the same transaction; `rowsMigrated`/`rowsSkipped` are now summed across
both lanes. Did not wire the script into server startup (the review's "consider"-level
suggestion) — scoped to the script + its tests per the task's explicit instruction, and
CR-02's runtime guard already covers any operator who upgrades without re-running it.
Two new tests seed a legacy row directly into `customSynergyInitiatives` via raw SQLite
(never through the app) and prove both single-run migration and second-run idempotency
for that lane specifically, alongside a same-run sanity check that the
`synergyInitiatives` lane is still migrated too.

### WR-05: The header-level "Realized $M" input is always rendered and editable even after phasing rows exist, and always fails when used

**Files modified:** `public/js/execution.js`, `test/synergy-phasing.test.js`
**Commit:** `8b2356e`
**Applied fix:** Gated the header input's presence on
`!(Array.isArray(s.phasing) && s.phasing.length > 0)` — the exact same condition
`server.js`'s D-04 guard enforces — rendering a read-only `$X` figure instead once
phasing rows exist. This required also null-guarding the click-wiring (the input may no
longer exist in the DOM) and rescoping the wiring's `querySelector` to `.syn-head
.syn-realized-input` so it can never mistakenly bind to a per-month `.syn-detail` grid
cell when a card is both phased and expanded. Updated one pre-existing source-level
test (`synergy-phasing (source c)`) whose slice-boundary string literal was made stale
by this change, so the suite stayed green throughout.

## Skipped Issues

None — all 8 in-scope findings were fixed.

---

_Fixed: 2026-08-06_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
