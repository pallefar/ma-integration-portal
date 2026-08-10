# Phase 3: Deal Isolation, Audit Log & Write Validation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-31
**Phase:** 3-deal-isolation-audit-log-write-validation
**Areas discussed:** Deal lifecycle & switching, Existing data's fate, Audit log scope & access, Validation strictness

---

## Deal lifecycle & switching

| Option | Description | Selected |
|--------|-------------|----------|
| Session-bound (Recommended) | Deal selection stored server-side on the user's session row; multi-user-safe; demo resolves to demo.db | ✓ |
| Global active deal | Today's activate-project pattern server-wide — MNPI cross-exposure risk on shared host | |
| URL-scoped deals | /api/deals/<id>/… on every path — touches every frontend fetch | |

**User's choice:** Session-bound

| Option | Description | Selected |
|--------|-------------|----------|
| IL creates, admin deletes (Recommended) | admin+hrbp create; delete/archive admin-only, audit retained | ✓ |
| Admin-only for both | Tightest control, IL asks admin per acquisition | |
| IL for both | Most autonomous, gives non-admin destructive power over MNPI stores | |

**User's choice:** IL creates, admin deletes

| Option | Description | Selected |
|--------|-------------|----------|
| Per-deal member list (Recommended) | Username allowlist in control DB; resolver refuses non-members; admin always allowed | ✓ |
| All deal-ops roles see all deals | Simplest, but every future lead sees every pre-announcement target | |
| Defer to Phase 4 | No membership this phase | |

**User's choice:** Per-deal member list

| Option | Description | Selected |
|--------|-------------|----------|
| Switcher + create form (Recommended) | Header/sidebar deal switcher + minimal create-deal form, separate from demo Projects UI | ✓ |
| Extend admin Projects tab | Less new UI but mixes MNPI deals into demo console | |
| API-only this phase | Smallest scope, IL can't practically work a deal | |

**User's choice:** Switcher + create form

---

## Existing data's fate

| Option | Description | Selected |
|--------|-------------|----------|
| All demo; deals start empty (Recommended) | Everything incl. Custom-M&A lane → demo.db; users/settings → control; deals start clean | ✓ |
| Custom lane seeds first deal | Preserves Custom-M&A typed work but risks demo artifacts in a real deal | |
| Rename only, split later | Smallest migration, muddies isolation | |

**User's choice:** All demo; deals start empty

| Option | Description | Selected |
|--------|-------------|----------|
| Templates only (Recommended) | Schema + checklistTemplates/assessmentTemplates/processCatalog/i18n; no demo people/CMS | ✓ |
| Completely empty | Purest but unusable until templates rebuilt | |
| Full demo copy minus people | Familiar but demo showcase pages inside a real deal | |

**User's choice:** Templates only

| Option | Description | Selected |
|--------|-------------|----------|
| Commit demo.db only (Recommended) | control.db auto-created on first boot; deals gitignored | |
| Commit demo.db + control.db | Both committed — zero-install simplest | ✓ (initial) |
| Commit nothing, seed on boot | Cleanest repo, fragile zero-install | |

**User's choice (initial):** Commit demo.db + control.db
**Notes:** Follow-up surfaced the consequence that control.db would carry the live sessions table (permanent dirty tree; session rows in `git archive` zips).

| Option | Description | Selected |
|--------|-------------|----------|
| Split runtime state out (Recommended) | control.db committed but near-static (accounts/settings/registry); sessions & churn → gitignored runtime.db | ✓ |
| Commit as-is, accept churn | Permanent dirty diff; session rows ship in zips | |
| Back to demo.db-only commit | Original recommendation | |

**User's final choice:** Commit demo.db + near-static control.db; runtime churn in gitignored runtime.db; deals/*.db never in git/zips.

---

## Audit log scope & access

| Option | Description | Selected |
|--------|-------------|----------|
| Deal + control writes (Recommended) | Deal writes + control-plane security events (lifecycle, membership, roles, revocations, break-glass); demo unaudited | ✓ |
| Deal writes only | AUD-01's letter; membership changes/break-glass leave no trail | |
| Everything incl. demo | Uniform but flooded with demo churn | |

**User's choice:** Deal + control writes

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated audit.db (Recommended) | Central append-only, gitignored, zip-excluded, outlives deals (AUD-02 by construction) | ✓ |
| Inside runtime.db | One less file; mixes compliance record with disposable state | |
| Per-deal + archive-on-delete | AUD-02 depends on delete-time copy never failing | |

**User's choice:** Dedicated audit.db

| Option | Description | Selected |
|--------|-------------|----------|
| Admin viewer this phase (Recommended) | Admin-only filterable table (deal/user/date) in admin console | ✓ |
| Storage-only this phase | No UI until Phase 7 | |
| Admin + IL for their deal | Adds deal-scoped read path Phase 4 would re-check | |

**User's choice:** Admin viewer this phase

| Option | Description | Selected |
|--------|-------------|----------|
| Full before/after rows (Recommended) | Complete row JSON both sides; self-contained reconstruction | ✓ |
| Changed-fields diff only | Compact; reconstruction requires replaying diffs | |
| Action-level only | Fails AUD-01's before/after requirement | |

**User's choice:** Full before/after rows

---

## Validation strictness

| Option | Description | Selected |
|--------|-------------|----------|
| zod (Recommended) | Pure-JS declarative schemas, Package Legitimacy Gate, committed to node_modules | ✓ |
| Hand-rolled helpers | Zero new deps but 60 specs in a home-grown DSL | |
| Planner decides | Defer to research | |

**User's choice:** zod

| Option | Description | Selected |
|--------|-------------|----------|
| Strip unknown, reject invalid (Recommended) | Unknown keys dropped; type/required/length violations 400 | ✓ |
| Strict reject on unknown | Max rigor, breaks pages on any forgotten field | |
| Allow-through, validate known | Unvetted keys keep reaching stored blobs | |

**User's choice:** Strip unknown, reject invalid

| Option | Description | Selected |
|--------|-------------|----------|
| One pipeline, same rules (Recommended) | Identical validation everywhere; demo permanently regression-tests the rules | ✓ |
| Strict deals, warn-only demo | Modes drift; enforced path under-exercised | |
| Deals only this phase | VAL-01 knowingly unmet | |

**User's choice:** One pipeline, same rules

| Option | Description | Selected |
|--------|-------------|----------|
| Sanitize write + render (Recommended) | HTML-tagged fields sanitized at write; plain-text otherwise; textContent discipline stays | ✓ |
| Write-time only | Single choke point; legacy rows unprotected | |
| Render-time only | Stored MNPI keeps carrying live payloads | |

**User's choice:** Sanitize write + render

## Claude's Discretion

- Audit capture mechanism (triggers vs middleware vs store-layer hook)
- Control-DB vs runtime-DB exact table split beyond sessions/churn
- Deal id format, deals/ layout, WAL/backup per deal file
- Split-migration mechanics (Phase-1 verify-gate precedent expected)
- Demo-mechanic hard-gating mechanism (route guard vs resolver refusal)

## Deferred Ideas

- Deal-scoped audit views for ILs (Phase 4+)
- Audit retention/rotation + tamper-evidence hash chaining (v2 / shared host)
- Workstream-lead role taxonomy (Phase 4 planning, carried in STATE.md)
