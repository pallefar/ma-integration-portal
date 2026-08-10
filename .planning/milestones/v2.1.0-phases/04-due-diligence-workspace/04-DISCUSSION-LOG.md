# Phase 4: Due Diligence Workspace - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-02
**Phase:** 4-due-diligence-workspace
**Areas discussed:** Clean-room access model, Wizard shape & flow, DD lists & findings structure, Assessment gating in wizard, VDR reference & access grants, DD request lifecycle, Deal home page, Assessment owner nudges, DD request-list seeding, DD contributor model, Deal archive behavior, Wizard validation UX

All 12 areas were selected by the user across three rounds; in every question the user took the recommended option.

---

## Clean-room access model

| Option | Description | Selected |
|--------|-------------|----------|
| Per-deal area grants | Member record grows ddAreas:[] — no new global roles; extends Ph3 members[] allowlist | ✓ |
| Global workstream-lead roles | ws_lead_* roles + per-deal mapping | |
| Two-tier clean room | Members see all DD or none | |

Also: grants by **IL + admin** (vs admin-only); denial UX = **area invisible + audited** (vs visible-but-locked). Resolves the ws-lead taxonomy parked since Phase 2: no new global roles.

---

## Wizard shape & flow

| Option | Description | Selected |
|--------|-------------|----------|
| Basics+Team+Assessments core mandatory | Scope/timeline/VDR skippable-with-nudge | ✓ |
| All 7 mandatory | Everything before setup completes | |
| Basics+Team only | Assessments optional | |

Also: **create early, resume later** (vs all-or-nothing); **full-page flow** with step rail (vs stepped modal).

---

## DD lists & findings structure

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated DD area list | Legal/Financial/Tax/HR/IT/Commercial/Operations/Compliance-ESG | ✓ |
| Reuse 8 ws_* workstreams | One taxonomy everywhere | |
| Configurable per deal | IL edits list in wizard | |

Also: **RAID-consistent severity** (vs RAG); **one-click bidirectional conversion** via from-remediation (vs manual with copy assist).

---

## Assessment gating in wizard

| Option | Description | Selected |
|--------|-------------|----------|
| Create + assign, track on deal home | Mandatory step creates instances w/ owners+dates; deal usable immediately | ✓ |
| Hard gate | Deal locked until assessments completed | |
| Optional step | Skippable kickoff | |

Also: **all three instances** created (acquirer + target + IL readiness) vs target-only vs IL-picks.

---

## VDR reference & access grants

| Option | Description | Selected |
|--------|-------------|----------|
| Per request-item links | Item carries URL + folder ref; area view aggregates | ✓ |
| Per functional area | One link per area | |
| Both levels | Area default + item overrides | |

Also: **structured grant records** as D-08 security events (vs free-text note).

---

## DD request lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Full request flow | open → requested → received → reviewed → closed + blocked flag | ✓ |
| Simple three-state | open → in-progress → done | |

Also: **overdue computed + surfaced** (vs manual flag).

---

## Deal home page

| Option | Description | Selected |
|--------|-------------|----------|
| Deal-aware dashboard | Existing dashboard adapts when deal-bound | ✓ |
| Dedicated deal-home page | New page; dashboard stays demo-only | |

Also: **no activity feed this phase** (upholds Ph3 D-10 deferral of IL-scoped audit reads).

---

## Assessment owner nudges

| Option | Description | Selected |
|--------|-------------|----------|
| In-app only | Badge + banner via existing banner system | ✓ |
| None | IL chases manually | |

---

## DD request-list seeding

| Option | Description | Selected |
|--------|-------------|----------|
| Seeded standard checklist | ~8–15 curated items per area via D-06 template mechanism; IL prunes | ✓ |
| Empty lists | IL builds from scratch | |

---

## DD contributor model

| Option | Description | Selected |
|--------|-------------|----------|
| Area-cleared members contribute | Write within granted area; IL+admin everywhere; all audited | ✓ |
| IL/admin only | Members read-only | |

---

## Deal archive behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only freeze, members keep access | Post-close reference; writes 403 | ✓ |
| IL/admin read-only | Members lose visibility | |
| Hidden until unarchived | Admin-only | |

---

## Wizard validation UX

| Option | Description | Selected |
|--------|-------------|----------|
| Validate on step-advance | Server zod errors inline; step hard-blocks; one rule set | ✓ |
| Live client + server backstop | Duplicated rules for as-you-type feedback | |

---

## Claude's Discretion

- Seeded DD checklist content per area (researcher sources, planner locks)
- DD collection naming/shape in the deal DB (blob-per-row convention)
- Wizard step-rail + deal-home panel visual details
- ddAreas grant management UI inside the existing admin Deals tab

## Deferred Ideas

- IL-scoped audit/activity feed on deal home (Ph3 D-10 deferral upheld)
- Email notifications (needs real mail infra — shared-host milestone)
- Configurable per-deal DD area taxonomy
- Live client-side wizard validation
