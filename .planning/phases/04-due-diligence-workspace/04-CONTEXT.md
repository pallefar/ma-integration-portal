# Phase 4: Due Diligence Workspace - Context

**Gathered:** 2026-08-02
**Status:** Ready for planning

<domain>
## Phase Boundary

A new deal enters the app through a guided setup wizard (WIZ-01: basics, team/access, readiness-assessment kickoff, scope, timeline, VDR/DD kickoff), and the IL runs due diligence inside it: per-area DD request lists (DD-01), a findings register (DD-02) converting into Day-1 tasks/RAID via the existing `from-remediation` linkage (DD-03), server-side clean-room need-to-know with audited denials (DD-04), and VDR link-outs with recorded access grants — never document storage (DD-05).

Requirements: DD-01..05 + WIZ-01. Everything rides on the Phase-3 foundation: session-bound resolver, per-deal member allowlist, append-only audit, one zod validation pipeline.

</domain>

<decisions>
## Implementation Decisions

### Clean-room access model (resolves the ws-lead taxonomy parked since Phase 2)
- **D-01:** Need-to-know is modeled as **per-deal area grants on the member record** — each deal member entry grows a `ddAreas: []` list. NO new global roles (the ws_lead_* taxonomy question is closed: not needed). — **Reversibility:** costly — the grant shape lives in control.db deal records and every DD read path filters on it; switching to global roles later means migrating grants and rewriting the resolver-adjacent checks.
- **D-02:** Grants/revokes are made by **IL + admin**, deal-scoped; every grant/revoke is recorded as a D-08 security event in the audit log.
- **D-03:** A member without need-to-know for an area experiences **invisibility, not a lock**: uncleared areas are omitted from list responses server-side (no enumeration — consistent with Phase 3's uniform-403 anti-enumeration stance); direct API probes get the uniform 403 and the **denial itself is audited** (DD-04's explicit wording).

### New-deal setup wizard (WIZ-01)
- **D-04:** v1-mandatory wizard core: **deal basics → team/access → readiness-assessment kickoff**. Workstream scope, timeline markers, and VDR/DD kickoff are skippable-with-nudge, completable later from the deal-home setup checklist.
- **D-05:** **Create early, resume later** — the deal is created (and audited) after Basics+Team; remaining steps become a setup checklist on the deal home with a "Setup incomplete" banner. No all-or-nothing wizard transaction.
- **D-06:** The wizard is a **full-page flow** (IL/admin only) with a step rail; "+ New real deal" in the switcher navigates there. Model on the demo side's existing intake-wizard pattern. The Phase-3 minimal create-deal modal is superseded by this flow.
- **D-07:** Wizard validation: **validate on step-advance** — "Next" submits the step, server zod errors render inline next to their fields (error strings already name field paths), step hard-blocks until valid. One validation source of truth; no duplicated client-side rule set.

### Readiness assessments in the wizard (the user's core ask)
- **D-08:** The assessment step is **mandatory and creates all three instances** — acquirer-org readiness + target-org readiness + IL readiness — with owners and due dates assigned in the wizard. Templates are already seeded into every deal by Phase 3's D-06 template-only seeding; the wizard instantiates them.
- **D-09:** Gating is **create + assign, track on deal home** — the deal is usable (DD can start) immediately; the deal home shows assessment completion prominently until done. NO hard lock on assessment completion (diligence is time-critical).

### DD lists & findings structure
- **D-10:** Functional areas use a **dedicated DD area list**: Legal, Financial, Tax, HR, IT, Commercial, Operations, Compliance/ESG. This is the clean-room access unit and the list-organization unit. Areas map to ws_* workstreams at conversion time. — **Reversibility:** costly — the area id is baked into grants, request items, findings, and audit rows; changing taxonomy later is a data migration.
- **D-11:** Findings carry **RAID-consistent severity** (critical/high/medium/low) so converted findings pass severity straight into RAID entries.
- **D-12:** Conversion (DD-03) is **one-click, linked both ways**: buttons on a finding create a pre-filled Day-1 task and/or RAID entry via the existing `from-remediation` linkage; the finding keeps references to what it spawned and vice versa, so DD closure is traceable.
- **D-13:** New deals get a **seeded standard DD request checklist** (curated common M&A diligence items, ~8–15 per area) via the D-06 template mechanism; the IL prunes/extends per deal. Never start the IL from a blank page (34-task integration-checklist precedent).
- **D-14:** Request items use the **full request lifecycle**: open → requested → received → reviewed → closed, plus a `blocked` flag. "Received vs reviewed" is the backlog signal ILs track hardest.
- **D-15:** **Overdue is computed** (due date vs status), never a manual flag — highlighted in area lists and rolled up on the deal home ("3 overdue in Legal").
- **D-16:** Contributor model: **area-cleared members contribute** — any member with the area grant can add/edit items and findings in that area and update status on items they own; IL+admin everywhere. Every write is audited regardless.

### VDR references & access grants (DD-05)
- **D-17:** VDR links attach **per request-item** (URL + folder/index ref); area views aggregate their items' links. The app never stores documents.
- **D-18:** VDR access grants are **structured records** — {who, VDR area/folder ref, granted-by, date, note} — written as D-08 security events so the audit trail shows who was given data-room access to what, when.

### Deal home & notifications
- **D-19:** The deal home is the **existing dashboard page adapting when deal-bound** (no new route — the resolver already knows the binding): setup checklist, assessment completion, DD progress by area with overdue rollup, replacing demo-only panels.
- **D-20:** **No activity feed this phase** — an IL-visible feed would require IL-scoped audit reads, explicitly deferred at Phase 3's D-10 (admin-only audit viewer this milestone). Deal home shows status rollups only.
- **D-21:** Owner nudges are **in-app only** — badge + banner (reusing the existing banner system) for assigned owners while their items are open/overdue. No email until real infra exists (sent_emails/ is a demo mock; shared-host milestone).

### Deal archive behavior
- **D-22:** Archived deals become a **read-only freeze with member access retained** — cleared members keep read access for post-close reference; writes are refused (the Phase-3 resolver already refuses archived-deal binds for writes). Audit trail unaffected (survives even deletion).

### Research-resolved decisions (added 2026-08-02 at /gsd-plan-phase 4, after 04-RESEARCH.md surfaced code-level conflicts)
- **D-23:** Area grants are stored as a **NEW additive `deal.memberGrants: { [username]: { ddAreas: [] } }` map**, with `deal.members` left as the flat `string[]` it is today. This is the binding reading of D-01 ("need-to-know on the member record"): the grant is keyed by the same username `members` already uses. Research verified 4+ call sites treat `members` as `string[]` (`db/controlStore.js` `isDealMember()`, `db/resolver.js` bind check, `sessions.releaseSessionsForDeal()`, `public/js/deal-switcher.js`, `public/js/admin.js` member editor) with **no test coverage of the shape assumption** — a shape change could pass the suite and break them at runtime. D-01's `ddAreas` list is unchanged in substance; only its storage location is now pinned. — **Reversibility:** reversible — additive field, no migration of existing deal records.
- **D-24:** Assigned-but-unfinished readiness assessments (D-08/D-09) **extend the existing `assessmentInstances` collection** with `owner`, `dueDate` and `status: 'pending' | 'submitted'`, plus a new assign route that creates a response-less pending instance which the existing submit route later completes **by id** (never creating a second instance). Rejected: a parallel `assessmentAssignments` collection (would force the `/api/assessment-status` rollup to merge two collections at read time). The existing rollup keeps working with one status branch. Research verified `POST /api/assessment-instances` (server.js ~2363) today always scores from `responses` and hard-sets `status: 'submitted'` — a pending instance is genuinely new capability, not a config tweak.
- **D-25:** The DD-area → `ws_*` workstream mapping used at conversion time (D-12) is locked as a single hard-coded constant, mirroring `REMEDIATION_WS` (server.js ~2630): Legal→`ws_legal`, Financial→`ws_finance`, **Tax→`ws_finance`** (no dedicated tax workstream exists), HR→`ws_hr`, IT→`ws_it`, Commercial→`ws_sales`, Operations→`ws_ops`, **Compliance/ESG→`ws_legal`** (that workstream's label is already "Legal & Compliance"). Rejected: Compliance/ESG→`ws_imo`. — **Reversibility:** reversible — the mapping only decides which workstream a converted task/RAID entry lands under; it is a field value, changeable post-hoc.
- **D-26:** RAID's severity enum is **extended to `['low','medium','high','critical']`** so D-11's "severity passes straight into RAID" holds literally — no lossy `critical`→`high` downgrade at conversion. Research verified the enum is currently 3-level AND **duplicated, not shared**, in two places (`server.js` ~2752 and `validators/workstream.js` ~139); both copies must move together. Strictly additive — no existing RAID entry could hold `critical`, so no data migration.

### Claude's Discretion
- Exact seeded DD checklist content per area (researcher should source a standard M&A diligence request list; planner locks the item set).
- DD data placement inside the deal database (new collections in the deal file — naming/shape follows the blob-per-row convention).
- Wizard step-rail UI details and deal-home panel layout (vanilla-JS conventions, existing glassmorphism styles).
- How `ddAreas` grants interact with the admin Deals tab UI (extend the existing tab).

### Folded Todos
- **new-deal-setup-wizard** (`.planning/todos/pending/new-deal-setup-wizard.md`) — the WIZ-01 7-step proposal from the user's 2026-08-02 request ("when a new deal is created, it should go through the new deal assemment of of the company so like a new deal setup… we have a wizard for new deals"). Folded as this phase's wizard scope; refined by D-04..D-09.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Wizard scope
- `.planning/todos/pending/new-deal-setup-wizard.md` — WIZ-01 7-step wizard proposal with implementation notes (user request, folded into this phase; D-04..D-09 refine it)

### Phase-3 foundation this phase builds on
- `.planning/phases/03-deal-isolation-audit-log-write-validation/03-CONTEXT.md` — the 15 locked Phase-3 decisions (resolver, membership, audit, validation) this phase extends
- `.planning/phases/03-deal-isolation-audit-log-write-validation/03-03-SUMMARY.md` — resolver/controlStore/DEMO_ONLY architecture as built
- `.planning/phases/03-deal-isolation-audit-log-write-validation/03-05-SUMMARY.md` — audit hook + D-08 security-event call-site pattern to extend for grants/denials
- `.planning/phases/03-deal-isolation-audit-log-write-validation/03-06-SUMMARY.md` — validation pipeline + how new write routes register schemas (coverage test WILL fail any unvalidated new route)

### Requirements
- `.planning/REQUIREMENTS.md` — DD-01..DD-05 exact wording (esp. DD-04 "access decisions audited", DD-05 "records the reference and access grant")
- `.planning/ROADMAP.md` — Phase 4 goal + success criteria (incl. criterion 0, the wizard flow)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `db/controlStore.js` — deal records with `members[]` allowlist; D-01 extends member entries with `ddAreas`
- `db/resolver.js` — bind-time membership refusal + `CONTROL_PLANE_PATHS`; area-level filtering layers on top (bind = deal-level, area = row/route-level)
- `db/auditHook.js` + D-08 security-event call sites in server.js — pattern for grant/revoke/denial audit events
- `validators/` — per-domain zod module pattern (deals.js is the exemplar); new DD/wizard routes need schemas or `test/write-validation-coverage.test.js` fails the suite
- `db/dealSeed.js` — D-06 allowlist-direction template seeding; DD request-list templates and (already) assessment templates ride this
- Assessment suite — `assessmentTemplates`/`assessmentInstances`, `POST /api/assessment-instances` (server.js ~2363), templates already seeded per deal
- `POST /api/integration-tasks/from-remediation` (server.js ~2634) — the DD-03 conversion spine
- Banner system + sidebar badge patterns — D-21 nudges
- Demo intake wizard (admin Projects) — D-06 full-page wizard precedent
- `public/js/deal-switcher.js` — "+ New real deal" entry point to repoint at the wizard page

### Established Patterns
- Blob-per-row collections in the deal DB; new DD collections follow it
- textContent-only rendering + write-time sanitizeHtml for any HTML-tagged field (D-15 Ph3)
- Uniform 403 anti-enumeration (Ph3 WR-02 fix) — D-03 denial behavior must match
- Cache-stamp `?v=` bump convention when JS files change (currently 1784600003 for transitions.js)

### Integration Points
- Deal-bound dashboard adaptation (D-19) hooks where demo panels render today
- Wizard writes flow through the consolidated /api gate → validation pipeline → audit hook automatically
- Area grants checked server-side in DD routes (list filtering + uniform 403), NOT in the resolver bind itself (bind stays deal-level)

</code_context>

<specifics>
## Specific Ideas

- User's verbatim ask (2026-08-02): "when a new deal is created, it should go through the new deal assemment of of the company so like a new deal setup, please ensure this is added and we have a wizard for new deals, think about what can be there from an app perspective" — the assessment step is the wizard's centerpiece, not an afterthought (D-08/D-09).
- MNPI codename discipline in the wizard's basics step: encourage a project codename over the target's real name pre-announcement (helper text, not enforcement).

</specifics>

<deferred>
## Deferred Ideas

- **IL-scoped audit/activity feed on the deal home** — deferred again (Phase 3 D-10 deferral upheld by D-20); candidate for the shared-host milestone or a later phase.
- **Email notifications for owners** — needs real mail infra; shared-host milestone (D-21 keeps nudges in-app).
- **Configurable per-deal DD area taxonomy** — rejected for v1 (D-10 fixed list); revisit only if a real deal demands it.
- **Live client-side wizard validation rules** — rejected duplicate rule set (D-07); revisit if step-advance feedback feels too slow in UAT.

</deferred>

---

*Phase: 4-Due Diligence Workspace*
*Context gathered: 2026-08-02*
