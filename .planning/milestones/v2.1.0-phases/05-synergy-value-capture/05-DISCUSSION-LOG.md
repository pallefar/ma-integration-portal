# Phase 5: Synergy Value Capture - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-03 (Phasing model) → 2026-08-06 (remaining areas, resumed from checkpoint)
**Phase:** 05-synergy-value-capture
**Areas discussed:** Phasing model, Stage vocabulary + migration, Baseline history, Staleness rule, Cost-to-achieve (SYN-02), Task linkage (SYN-04)

---

## Phasing model

Discussed 2026-08-03; recorded in the checkpoint rather than as a full option
table. Six decisions (D-01…D-06). The one place the user overrode the
recommendation: **monthly** granularity was chosen over the recommended
**quarterly**, after the 36-rows-per-initiative consequence was stated. The
override drove D-05 (ramp auto-fill) as the mitigation, and D-04 (existing
`targetM`/`realizedM` become derived totals) was chosen on demo-showcase safety
grounds.

---

## Stage vocabulary + migration

### Reconciling SYN-03's 4 stages with the 5 existing statuses

| Option | Description | Selected |
|--------|-------------|----------|
| Replace with the 4 stages | One canonical field. Rows mapped once. Costs: 3 of 5 demo seeds collapse onto `committed`, 2 new i18n keys × 4 langs, 3 retired, demo.db rewritten | ✓ |
| Keep 5, rename to fit | idea → validated → committed → executing → captured. Preserves the demo's 5-colour spread; mixes a confidence axis with an execution state | |
| Two independent fields | Leave `status` untouched, add `confidenceStage`. Zero migration; two axes to sync, nonsense combinations possible | |

**User's choice:** Replace with the 4 stages (D-07)
**Notes:** Costs were stated before the choice, per the standing practice of
surfacing non-obvious downstream costs first.

### Stage gates

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal hard gates | `committed` needs owner + phased target; `captured` needs realized value in an arrived month. Server-enforced | ✓ |
| Advisory only | UI warns, server accepts | |
| No gates | Any stage, any time | |

**User's choice:** Minimal hard gates (D-08)

### Backward stage movement

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, with a required reason | Recorded in history alongside the change | ✓ |
| Yes, silently | Audit log still records it; no in-app explanation | |
| Forward-only | Stages ratchet; needs a separate `dropped` state | |

**User's choice:** Yes, with a required reason (D-09)

### Demo seed handling

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-tune the 5 seeds | Spread across all four stages with believable phasing | ✓ |
| Mechanical map only | Map verbatim; lopsided distribution | |
| Mechanical map + auto-filled phasing | Mechanical stages, real curves | |

**User's choice:** Hand-tune the 5 seeds (D-10)

### Migration approach

| Option | Description | Selected |
|--------|-------------|----------|
| Hard cutover, no compat shim | 4 stages are the only accepted values; legacy rejected | ✓ |
| Read-time coercion shim | Survives an unmigrated database appearing later; permanent dead code | |

**User's choice:** Hard cutover (D-11)
**Notes:** Verified during discussion that `data/deals/` is empty — no real-deal
database exists — which is what makes the cutover safe.

---

## Baseline history

### Form of the history

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit baseline snapshots | `baselines[]` pinning the full prior curve with who/when/why; audit.db stays the forensic record | ✓ |
| Full change log on the initiative | Every change appended; buries the signal in noise | |
| Derive from audit.db | Needs a rowId filter plus a non-admin read path into a compliance control | |

**User's choice:** Explicit baseline snapshots (D-12)

### What creates a new baseline version

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit act + forced after commit | Deliberate any time; forced with a reason once `committed` | ✓ |
| Explicit act only | A committed target could still be edited quietly | |
| Automatic on any target change | Nothing slips through; many low-value versions | |

**User's choice:** Explicit act + forced after commit (D-13)

### Is baseline v1 special

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — v1 pinned as the deal case | Never superseded; variance against both deal case and current | ✓ |
| No — flat version list | v1 is just the oldest | |

**User's choice:** Yes — v1 pinned as the deal case (D-14)

### Who can re-baseline

| Option | Description | Selected |
|--------|-------------|----------|
| IL/admin writes, all deal members read | Server-enforced governance act | ✓ |
| Initiative owner can also re-baseline | Needs the owner-vs-caller comparison CR-01 got wrong | |
| Any deal member, read and write | Least code, least friction | |

**User's choice:** IL/admin writes, all deal members read (D-15)
**Notes:** Asked explicitly rather than left to the planner, because an authz
bug has surfaced at the review gate in four consecutive phases.

---

## Staleness rule

### What resets the clock

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit "confirm current" | `lastConfirmedAt`; not reset by note/title edits | ✓ |
| Period completeness | Stale = latest arrived month has no realized entry; breaks down for idea/validated | |
| Any write stamps `updatedAt` | Cheapest; a typo fix resets the clock | |

**User's choice:** Explicit "confirm current" (D-16)
**Notes:** Confirmed during discussion that no `updatedAt` field exists in the
synergy lane at all — this is greenfield.

### Threshold

| Option | Description | Selected |
|--------|-------------|----------|
| 30 days, deal-configurable | One rule for every stage; matches the monthly cadence | ✓ |
| Stage-dependent defaults | 30d for committed/captured, 90d for idea/validated | |
| 14 days, deal-configurable | Bi-weekly rhythm; more items stale at once | |

**User's choice:** 30 days, deal-configurable (D-17)

### Effect on the numbers

| Option | Description | Selected |
|--------|-------------|----------|
| Flag + split the rollup | "realized $XM, of which $YM unconfirmed" | ✓ |
| Flag only | Totals unchanged | |
| Exclude from the rollup | Strongest incentive; headline jumps | |

**User's choice:** Flag + split the rollup (D-18)

### Owner nudge

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — reuse the Phase 4 deal-home nudge | Existing tested surface (DD-02) | ✓ |
| No — flag in the synergy view only | Smallest blast radius | |

**User's choice:** Yes — reuse the deal-home nudge (D-19)

---

## Cost-to-achieve (SYN-02)

*Raised by Claude after the four pre-selected areas closed — SYN-02 was in scope
but had no decision, and the planner would otherwise have had to guess.*

| Option | Description | Selected |
|--------|-------------|----------|
| Total planned + dated actuals | A list, not a grid; costs are lumpy. Monthly net benefit still computable by bucketing | ✓ |
| Full monthly grid mirroring value | Symmetric with D-01/D-05; doubles the grid the IL maintains | |
| Two totals only | Cheapest; no timing | |

**User's choice:** Total planned + dated actuals (D-20)

### Net benefit in the rollup

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — gross, cost, net | RPT-03 needs it anyway | ✓ |
| Per-initiative only | Rollup stays gross | |

**User's choice:** Yes — gross, cost, net (D-21)

---

## Task linkage (SYN-04)

*Also raised by Claude after the pre-selected areas closed.*

| Option | Description | Selected |
|--------|-------------|----------|
| `taskIds[]` on the initiative | Task model, routes and validator untouched | ✓ |
| `source: 'synergy:<id>'` on the task | Verified problem: `source` is a single string already used for provenance dedupe at `server.js:3006`, so a task could link to only one initiative and would collide with the dedupe | |
| Both directions, denormalized | Fast reads both ways; two places to sync | |

**User's choice:** `taskIds[]` on the initiative (D-22)

### Does task completion feed value or stage

| Option | Description | Selected |
|--------|-------------|----------|
| No — informational + progress only | "4 of 6 tasks done"; value stays deliberate per D-06/D-16 | ✓ |
| Suggest, don't act | Prompt to advance to `captured` when all tasks done | |
| Yes — auto-advance | Stage satisfied by task hygiene rather than confirmed value | |

**User's choice:** No — informational + progress only (D-23)

---

## Claude's Discretion

None delegated — all 23 decisions were chosen explicitly. Normal planner
latitude (grid layout, control placement, internal field shapes) is noted in
CONTEXT.md rather than treated as a delegated decision.

## Deferred Ideas

- Prompting the IL to advance to `captured` when all linked tasks complete —
  considered under D-23, not taken.
- Stage-dependent staleness thresholds — considered under D-17, not taken.
- Outbound clearance-filtering on `/api/raid` — pre-existing Phase 4 hardening
  debt, out of scope here.
