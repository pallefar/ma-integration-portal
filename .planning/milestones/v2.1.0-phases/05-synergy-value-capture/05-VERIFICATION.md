---
phase: 05-synergy-value-capture
verified: 2026-08-06T11:23:00Z
status: passed
score: 114/116 must-haves verified (2 backstop truths verified via prior live browser walk, recorded not re-derived)
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "MUST NOT let stage counts be inflatable by a write that bypasses the gate — no route, and no field on any other route, may set the stage without passing the same D-08 gate evaluation the dedicated stage route applies (Plan 03 prohibition, SYN-03)."
    status: failed
    reason: >
      Live-proven exploit: POST /api/synergies (the CREATE branch — no `id` in the body) accepts
      an arbitrary client-supplied `stage` value with ZERO gate evaluation. server.js's create
      branch (`stage: SYN_STAGES.includes(b.stage) ? b.stage : SYN_STAGES[0]`) never calls
      stageGateFailure() the way the dedicated POST /api/synergies/:id/stage route does. A single
      authenticated request from any role with write access to /api/synergies (admin, hrbp, or
      pmo per ROLE_WRITE_POLICY) — for example
      `POST /api/synergies {title, category, stage:'captured', realizedM:2.5, targetM:2.5}` —
      creates a brand-new initiative that is immediately reported as `stage:'captured'` with an
      arbitrary realized value of $2.5M, no owner, no phased target, and no arrived-month
      evidence whatsoever. Because the initiative has zero phasing rows, D-04's derived-rollup
      guard (which only engages once `item.phasing.length > 0`) never triggers, so `realizedM`
      and `targetM` are accepted verbatim on create. That fabricated figure flows directly into
      `GET /api/synergies/rollup`'s `grossRealizedM` — the exact steerco-facing headline number
      D-18/D-21 exist to make trustworthy — and into the per-item stage badge the whole SYN-03
      confidence-stage UI is built around. Reproduced against the real running app.js/server.js
      with a real hrbp session and a real deal (not a mock), status 201, confirmed via the
      response body and independently via a second request that also forged `realizedM`/`targetM`.
    artifacts:
      - path: "server.js"
        issue: "POST /api/synergies create branch (~line 3507-3538) accepts b.stage / b.realizedM / b.targetM without any stageGateFailure() evaluation or D-04 phasing-length guard, unlike every other stage-setting path in the file."
      - path: "validators/workstream.js"
        issue: "SynergyUpsertSchema's `stage: z.enum(SYN_STAGES).optional()` is unconditionally accepted on create — there is no refine() restricting a non-idea stage to only the update branch or requiring gate satisfaction."
    missing:
      - "Force the create branch to always assign SYN_STAGES[0] ('idea') regardless of any client-supplied b.stage — mirroring the update branch's existing '400 on any stage key' refusal — OR run stageGateFailure() against the constructed item before honoring any b.stage beyond idea, exactly as the dedicated stage route does."
      - "Regression test proving a create request carrying stage:'captured' (with or without a forged realizedM/targetM) either is refused or is silently downgraded to 'idea' server-side, and that the forged realized value can never reach GET /api/synergies/rollup's grossRealizedM."
---

# Phase 5: Synergy Value Capture Verification Report

**Phase Goal:** Synergy tracking reflects a real, trusted value-capture program instead of a single target-vs-realized pair.
**Verified:** 2026-08-06T11:23Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Roadmap Success Criteria (the contract)

| # | Success Criterion | Status | Evidence |
|---|---|---|---|
| 1 | A synergy initiative shows a baseline, a phased/ramped target over time, and realized value tracked period-by-period against that phasing | ✓ VERIFIED | `generatePhasingRows()`/`RAMP_CURVES`/`monthHasArrived()` (server.js:3084-3169), dedicated `POST /:id/generate-phasing` and `POST /:id/phasing/:month` routes read; D-24 interpolation math matches the spec exactly; D-04 derived-rollup guard confirmed on the update branch (`server.js:3444-3450`); D-06 arrived-month gate confirmed on the phasing sub-route (`server.js:3668-3671`). Full UI grid (locked span vs input tags, expand-state, mobile windowing) present in `public/js/execution.js`/`public/execution.html`. |
| 2 | A synergy initiative records its cost-to-achieve alongside its target value | ✓ VERIFIED | `costPlannedM`/`costExpectedMonth` on the upsert, `POST /:id/cost-entries` + `DELETE /:id/cost-entries/:eid` (server.js:3557+), `synergyCostFields()` (netBenefit = realized − costIncurred, not clamped at zero, matching D-21). `renderCostSection()` present client-side with the plain dated-list (not grid) UI. |
| 3 | A synergy initiative moves through confidence stages (idea → validated → committed → captured), and its prior baseline is preserved — not overwritten — when values change | ⚠️ PARTIALLY VERIFIED — see BLOCKER gap | The dedicated `POST /:id/stage` route (server.js:3697) correctly runs cumulative `stageGateFailure()`, refuses an unrecognized-stage advance with 409 (CR-02 fix), requires a non-empty trimmed reason for backward moves (D-09), and `pushBaseline()` correctly derives version from max-not-length and deep-copies `targetCurve` (D-12/D-14 — verified: baseline v1 is stamped once at first `generate-phasing` call and never re-stamped). **However**, this entire gate machinery has a live-proven bypass: the CREATE branch of `POST /api/synergies` (no `id`) accepts an arbitrary `stage` value including `captured`, plus an arbitrary `realizedM`/`targetM`, with zero gate evaluation — see the BLOCKER gap above. |
| 4 | A synergy initiative can be linked to the integration task(s) that deliver it | ✓ VERIFIED | `taskIds[]` on the initiative, `resolveSynergyTaskIds()` validates existence + dedupes + preserves order before any mutation (server.js:3325-3335+); D-23 zero-side-effect boundary confirmed by reading the task-completion path — no code path in server.js reads task status to compute realized value or stage. `renderTaskProgress()` renders a non-interactive "N of M tasks done" indicator client-side (no click handler/cursor/hover, confirmed by source read). |
| 5 | An initiative that hasn't been confirmed recently is visibly flagged as stale rather than presented as current | ✓ VERIFIED | `isSynergyStale()` (server.js:3310) — strictly-greater-than boundary, `nowMs` supplied by caller (single-clock-per-request, D-16/D-17 adjacency guarantee), `synergyStaleDays()` reader defaults to 30 and is capped at 365 (WR-03 fix confirmed in code). `GET /api/synergies/rollup` returns `unconfirmedRealizedM`/`staleCount`/`mine.staleCount` computed from the same enriched array (D-18/D-19/D-21). Client renders the stale badge, the always-present confirm-current button (own dedicated no-field route, `ConfirmCurrentSchema`), and the deal-home nudge (`renderStaleSynergyNudge()` in `public/js/deal-home.js`, confirmed to be authored independently of the DD-02 nudge and gated to only run inside `renderDealHome()`, which is called only for deal-bound sessions — D-19's "real-deal-only by design" scope note is accurate). |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| SYN-01 | 01, 08 | Phased/ramped target + period-by-period realized value | ✓ SATISFIED | See SC#1. Forward-booking prohibition confirmed enforced on the dedicated sub-route and the base-upsert D-04 guard; the create-branch gap (below) does not touch the *phased* forward-booking path specifically, since an initiative with zero phasing rows was always independently-writable by design (D-04's stated exception) — but see the compounding note under SYN-03. |
| SYN-02 | 04 | Cost-to-achieve alongside target value | ✓ SATISFIED | See SC#2. |
| SYN-03 | 02, 03, 06 | Confidence stage-gates, baseline history preserved | ✗ GAP — see BLOCKER | Gate machinery on the *dedicated* stage/rebaseline routes is real and well-tested (D-08/D-09/D-12/D-13/D-14/D-15 all directly confirmed in source). The *creation* path is not gated at all, which undermines the "moves through confidence stage-gates" guarantee at its root: an initiative can appear at `captured` having never moved through anything. |
| SYN-04 | 04, 07 | Task linkage | ✓ SATISFIED | See SC#4. |
| SYN-05 | 05, 07 | Staleness signal | ✓ SATISFIED | See SC#5. |

**REQUIREMENTS.md traceability table** (lines 127-131) marks all five as "Complete" — SYN-01/02/04/05 are confirmed; SYN-03 is not fully warranted as Complete given the live-proven gap above.

### The Confirmed Blocker (live-reproduced, not inferred)

Reproduced directly against the real `server.js`/`db/` stack (isolated temp control/runtime/demo/deals databases, a real `hrbp` session bound to a real deal — the identical test harness shape `test/synergy-stage.test.js` itself uses):

```
POST /api/synergies
{ "title": "Forged captured initiative", "category": "cost",
  "stage": "captured", "realizedM": 2.5, "targetM": 2.5 }

→ 201 { success: true, initiative: {
    stage: "captured", realizedM: 2.5, targetM: 2.5, owner: "", phasing: undefined, ... } }
```

No owner. No phased target. No arrived-month realized value. No baseline entry. None of D-08's stated gates ran. This value flows straight into `GET /api/synergies/rollup`'s `grossRealizedM` on the very next request. This is precisely the failure class the Plan 03 prohibition names ("stage counts inflatable by a write that bypasses the gate") and is a direct hit against the phase's own stated purpose ("an ungated stage label is decoration").

**This looks like an oversight, not a deliberate design choice** — nothing in 05-CONTEXT.md's 25 decisions, 05-RESEARCH.md, or any plan's objective/must_haves discusses gating the *create* path; every D-08 discussion assumes stage-setting only happens through the dedicated `/stage` route, and the base-upsert *update* branch is explicitly gated (`if (b.stage !== undefined) return 400`) — the create branch was evidently missed by that same guard.

### Baseline History / Authz (D-12/D-13/D-14/D-15) — spot-checked directly in source

- `pushBaseline()` (server.js:3234): version derived from `Math.max(...entry.version)`, never array length or index — confirmed.
- Deal-case (v1) stamped exactly once, guarded by `item.baselines.length === 0` inside `generate-phasing` — confirmed never re-stamped by a later regeneration.
- `isAdminOrIlRequest()` (server.js:495) is the re-baseline route's first statement, before the 404 lookup — confirmed no existence oracle. WR-01 fix (excluding the break-glass `X-Admin-Token` identity via `sessionId !== null`) is present in the referenced function.
- D-13 forced re-baseline on run-rate/curve-shape change once `committed`: confirmed in the base-upsert update branch (server.js:3474-3486), correctly ordered `pushBaseline()` *before* field mutation.

### Code-Review Fix Verification (05-REVIEW-FIX.md, 8 findings)

All 8 claimed fixes were spot-checked directly against current `server.js`/`validators/settings.js`/`scripts/migrate-synergy-stages.js` source (not trusted from the fix report's narrative):

| Finding | Verified in code |
|---|---|
| CR-01 (unbounded horizon) | ✓ Three independent clamps confirmed: schema (not read directly, but referenced), `synergyHorizonYears()` `Math.min(Math.max(n,1),15)`, and a second clamp inside `generatePhasingRows()` itself (`Math.min(Math.max(horizonYears\|0,0),15)`) |
| CR-02 (unrecognized-stage bypass) | ✓ `currentOrdinal === undefined` guard confirmed at the top of `POST /:id/stage`, returns 409 (the follow-up commit `2ef2dc4` changing 500→409 is HEAD) |
| CR-03 (regen-on-captured silent invalidation) | ✓ `demoteToSatisfiedStage()` confirmed, called from `generate-phasing`, records an "Automatic demotion" baseline entry |
| WR-01 (break-glass identity) | ✓ `isAdminOrIlRequest()` present at line 495 (not fully re-read line-by-line, but function exists at the claimed location and is used correctly by the rebaseline route) |
| WR-02 (Infinity→null corruption) | ✓ `roundSynergyMoney()`'s `!isFinite(n)` guard confirmed; create/update branch's local `num` closure confirmed replaced by `const num = roundSynergyMoney` |
| WR-03 (unbounded staleDays) | ✓ `synergyStaleDays()`'s `Math.min(n, 365)` confirmed |
| WR-04 (migration skips customSynergyInitiatives) | ✓ `SYNERGY_LANE_TABLES = ['synergyInitiatives', 'customSynergyInitiatives']` confirmed in `scripts/migrate-synergy-stages.js`, looped in the migration transaction |
| WR-05 (always-editable header realized input) | Not independently re-verified in this pass (summary claim only, moderate confidence — client-side, low blast radius) |

### Backstop Truths (2 total — `verification: backstop`)

Per the state-of-phase brief, both were already verified live by the orchestrator in a real browser and are recorded here as evidence, not re-derived:

1. **Plan 01** — "A card expanded by the user stays expanded after `renderSynergy()` rebuilds `#syn-list` wholesale in response to an unrelated edit on a different card." → ✓ VERIFIED (live: expand card A, edit card B, A stays expanded).
2. **Plan 07** — "The Synergy Tracker tab's initial load renders without a broken or misleading interim state." → ✓ VERIFIED (live: ~500ms load, no broken interim state).

### Anti-Patterns / Test Suite

- `npm test`: 373/373 passing on a clean re-run (one earlier run reported 372/373 — re-run came back clean; this reads as timing-sensitive test flakiness, not a regression, but is worth a note for whoever next touches date-boundary-dependent synergy tests, e.g. `monthHasArrived()`/staleness-boundary tests that compute against `Date.now()`).
- No `TBD`/`FIXME`/`XXX` markers found in the phase's modified files during this pass.
- `git log` confirms HEAD `2ef2dc4` matches the state-of-phase brief; REVIEW-FIX commits (`5e1e26c`, `123302d`, `808300b`, `f1a15eb`, `69d9869`, `9337591`, `b95cde0`, `8b2356e`) are all present in history.

### D-19 Scope Note (confirmed, not a gap)

`renderStaleSynergyNudge()` lives in `public/js/deal-home.js` and is called only from `renderDealHome()`, which per its own doc comment is invoked by `dashboard.js`'s deal-bound branch — i.e. it renders only for real-deal sessions, never for the demo showcase. This matches the state-of-phase brief's expectation exactly: a deliberate scope note, not a gap.

### SYN-03 `unclassified` Edge-Probe (confirmed, not silently resolved)

05-03-PLAN.md's objective section carries the flagged assumption verbatim: the edge-probe returned an `unclassified` row for SYN-03 with probe text "unclassified — review manually," and the plan explicitly records this as an **unresolved planner judgment call** ("that coverage is the planner's judgment, not a probe resolution — a reviewer should confirm no SYN-03 edge remains unexamined") rather than marking it covered. Reading it as-is: this reads as an open item for a human reviewer, and the BLOCKER finding above is arguably exactly the kind of edge this flagged assumption was warning about — a state-machine transition (creation as an implicit "stage-setting" act) not covered by the probe's data-shape categories.

## Human Verification Required

None — the blocker found is server-side, code-provable, and was live-reproduced against the real running stack in this verification pass; no UI/UX judgment call is needed to confirm it.

## Gaps Summary

One BLOCKER: the `POST /api/synergies` create branch does not run D-08's stage gate (or any gate at all) before accepting a client-supplied `stage`, and simultaneously accepts an arbitrary `realizedM`/`targetM` on the same unphased-initiative request (per D-04's stated, otherwise-correct exception for zero-phasing-row initiatives). Combined, a single authenticated write from any role with synergy write access can fabricate a fully "captured, $X.XM realized" initiative with zero evidence, and that fabricated figure immediately appears in the steerco-facing rollup total. This directly contradicts Plan 03's own stated prohibition and undermines Success Criterion #3 and the phase's stated goal of a "trusted value-capture program." Every other verified truth, artifact, key link, and prohibition across all 8 plans held up under direct source inspection, REVIEW-FIX spot-checks, and the full (373/373) test suite — this is a narrow but structurally significant gap, not a broad implementation failure.

**Recommended fix (for the next planning pass):** force the create branch to ignore any client-supplied `b.stage` (mirroring the update branch's existing outright refusal), or gate it through `stageGateFailure()` exactly as the dedicated `/stage` route does, plus a regression test proving the forged-value path is closed end-to-end (including that it can never reach `GET /api/synergies/rollup`'s totals).

---

_Verified: 2026-08-06T11:23Z_
_Verifier: Claude (gsd-verifier)_

## Gap Closure (G-05-01) — resolved 2026-08-06

The single BLOCKER gap this report found was fixed and live-re-verified before
the phase advanced.

- **Fix:** commit `0170087` — `POST /api/synergies`'s create branch now calls
  `stageGateFailure({...item, stage: SYN_STAGES[0]}, item.stage)`, walking every
  intervening ordinal. The baseline-stage argument is load-bearing: passing the
  item as-is makes `fromOrdinal === toOrdinal` so the loop body never runs — a
  silent no-op that reads like a gate (the same trap that made CR-03's
  originally-suggested patch do nothing).
- **Regression test:** `test/synergy-stage.test.js` — `synergy-stage-gate
  (G-05-01)`. Proven to FAIL against the pre-fix `server.js` (stashed the fix,
  1 failure; restored, 374/374 green).
- **Live re-verification (orchestrator, booted server):** the forged create now
  returns **400**, and `GET /api/synergies/rollup`'s `grossRealizedM` stays
  **0.9 → 0.9** (pre-fix it moved 0.9 → 3.4). Ordinary creation is unaffected:
  a normal create still returns 201 at stage `idea`.
- **Contract strengthened:** because the create branch persists no
  `runRateM`/`startMonth`/`phasing`, a gated stage is now STRUCTURALLY
  unreachable at create time regardless of payload — `committed`/`captured`
  must be earned via `/stage` once the initiative actually has phasing.

Score after closure: **116/116** must-haves verified (the 2 `verification:
backstop` truths were confirmed by the orchestrator's live browser walk).
