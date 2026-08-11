# Phase 9: Optimistic Locking & Conflict Recovery - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-11
**Phase:** 9-optimistic-locking-conflict-recovery
**Areas discussed:** Conflict granularity, 409 recovery UX, Versioning scope, Version mechanics & edges

---

## Conflict granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Strict record version (Recommended) | One version per record; ANY stale save → 409 even on disjoint fields. Simplest, matches CONC-02's letter, safest for MNPI (no silently-composed state) | ✓ |
| Field-aware conflict | Per-field version map; 409 only when the patched field actually changed. Fewer false conflicts, more machinery, auto-merges nobody reviewed | |
| Hybrid: strict + auto-reapply | Server auto-reapplies provably-disjoint patches on 409. Least friction, most server complexity | |

**User's choice:** Strict record version (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Uniform — same check (Recommended) | Quick actions (kanban flips, toggles) go through the version check. One rule, no exceptions | ✓ |
| Exempt quick actions | Single-field writes last-write-wins. Smoother board feel but reintroduces the silent-clobber class | |

**User's choice:** Uniform — same check (Recommended)

---

## 409 recovery UX

| Option | Description | Selected |
|--------|-------------|----------|
| Compare dialog + one-click reapply (Recommended) | Shared dialog: your value vs server's per changed field; "Apply my changes anyway" / "Discard mine, keep theirs"; form never lost | ✓ |
| Banner + manual redo | Ph8-toast-style banner + refresh keeping unsaved text; user reconciles manually | |
| Per-page tailored dialogs | Each collection's modal gets its own conflict view; best fit, five implementations | |

**User's choice:** Compare dialog + one-click reapply (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — name + time (Recommended) | "Changed by karen 2 min ago" from audit context in the 409 body; viewer already a deal member | ✓ |
| No — just the values | Only conflicting values; simpler payload, loses the most actionable context | |

**User's choice:** Yes — name + time (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Shared component, wrapper-detected (Recommended) | Ph8 fetch wrapper detects 409 (never retries it); one shared dialog renders from the 409 body on every page | ✓ |
| Per-page wiring on the 5 collections | Each edit modal handles its own 409; tighter fit, 5 implementations, future surfaces start unprotected | |

**User's choice:** Shared component, wrapper-detected (Recommended)

---

## Versioning scope

| Option | Description | Selected |
|--------|-------------|----------|
| All co-edited deal-data collections (Recommended) | The 5 CONC-02-named + DD request items, org positions, flight-risk, siblings; coverage-tested like Ph8's 503 gate | ✓ |
| Only the 5 named collections | Exactly CONC-02's list; smallest blast radius, two-tier world with documented exemptions | |
| Literally every writeDb collection | Include CMS/settings singletons; maximal uniformity but demo showcase writes them constantly | |

**User's choice:** All co-edited deal-data collections (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 12 (Recommended) | Membership/grants redesigned by COLLAB-01 anyway; Ph8 already serialized them; carry the wholesale-replace flag forward | ✓ |
| Include control-plane now | Version-check members/grants now; closes the gap immediately but touches paths Phase 12 reshapes | |

**User's choice:** Defer to Phase 12 (Recommended)

---

## Version mechanics & edges

| Option | Description | Selected |
|--------|-------------|----------|
| 409 on stale delete (Recommended) | Stale delete gets the conflict surface with confirm-delete as reapply; second look before destroying MNPI | ✓ |
| Delete always wins | Deletes skip the check; simpler, but can silently erase an unseen update | |

**User's choice:** 409 on stale delete (Recommended)

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy stamp on first write (Recommended) | Missing version = version 0; first write stamps it. No migration, committed DBs untouched (no WAL trap, no bundle churn) | ✓ |
| One-time backfill migration | Boot-time stamp on every record; uniform up front but rewrites committed demo.db | |

**User's choice:** Lazy stamp on first write (Recommended)

---

## Claude's Discretion

- Version field name/location, increment semantics, WHERE-clause enforcement mechanics in `writeDb()` (route precheck vs writeDb-level vs both; the WHERE clause must be load-bearing per CONC-02).
- 409 response body shape; how the client threads versions through forms and quick actions.
- Conflict dialog visual design (native to existing patterns, textContent-only).
- "Apply my changes anyway" client mechanics (re-fire patch with fresh version).
- 503-retry × 409 interplay details (409 branch independent of retry branch).
- Coverage-test mechanics; conversions (finding→RAID/task) are creates — no version precondition.

## Deferred Ideas

- Control-plane conflict detection (members/grants) → Phase 12 COLLAB-01, carrying the Ph8 `updateDealMembers()` wholesale-replace flag.
- Per-field version map / field-aware merge — only if strict-record 409s prove noisy in real use.
- Presence / "someone else is editing" indicators — Phase 12+ if ever.
- Stale-form warning polling — nice-to-have on top of the 409 contract, not this phase.
