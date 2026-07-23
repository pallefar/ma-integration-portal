# Feature Research

**Domain:** M&A integration / IMO software — four capability gaps (due diligence workspace, synergy value capture, IMO reporting & exports, org design & talent retention)
**Researched:** 2026-07-23
**Confidence:** MEDIUM (cross-checked against Midaxo, DealRoom/data-room vendors, SecureDocs, Devensoft, and PMO/consulting practice guides — no single-source claims below are presented as fact without corroboration; exact vendor UI specifics are LOW confidence and flagged inline)

This research covers only the four new capability areas named in scope. It deliberately does not re-examine people-integration, deal sourcing, valuation, or screening — those are out of scope or already covered by the existing app.

---

## Area 1: Due Diligence Workspace

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| DD request list by functional area, with owner + due date + status | Every M&A tool in this category (Midaxo, DealRoom, Datasite) leads with a structured request tracker, not a flat document pile — deal teams expect to filter "what's outstanding" by function | LOW | Reuse the `checklistTemplates` → `integrationTasks` pattern: DD is the same shape as a task with a functional-area tag, just earlier in the lifecycle and pre-close |
| Standard functional-area taxonomy | Universal ~10-category convention: Corporate, Financial, Legal, Tax, HR/Employees, Customers, Suppliers/Vendors, IP, Real Estate/Facilities, Operations/IT — deal teams recognize this structure instantly and will judge the tool as incomplete if it invents its own | LOW | Seed as a template, editable per-project (mirrors `assessmentTemplates` seeding pattern) |
| Findings register with severity + owner + status | Diligence produces findings, not just answered/unanswered requests; every vendor (Midaxo explicitly) frames findings as first-class records with an assigned owner and mitigation plan, "no spreadsheets required" | LOW–MED | This is the single most important table-stakes item — it's also explicitly named in PROJECT.md as extending the existing remediation linkage |
| Findings → Day-1 task / RAID linkage | The existing `POST /api/integration-tasks/from-remediation` already does assessment-red-flag → task; DD findings are the same problem shape (a finding needs a remediation owner and a due date) | LOW (extend, don't rebuild) | This is explicitly called out in PROJECT.md as the natural spine — a finding should be convertible to an `integrationTasks` entry AND/OR a `raidEntries` risk/issue with a back-reference to the source finding |
| Document tracking (received / outstanding / under review) per request | Basic completeness signal every DD tracker in market provides; Midaxo/DealRoom show this as a real-time dashboard | LOW | Does not require a full document management system — a status enum + optional file reference is sufficient; the app doesn't need to become a VDR |
| Simple document reference/upload against a request | DD requests are meaningless without evidence of what was actually provided | LOW–MED | Existing `public/uploads/` pattern (already used for slides/media) extends cleanly; no need for a dedicated VDR engine |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Findings-to-multiple-outcomes routing (task, RAID risk, RAID issue, or "no action") | Real DD findings aren't all remediation tasks — some are pure risks to monitor, some are deal-breakers, some are non-issues; a single dropdown at finding-resolution time ("convert to: Task / Risk / Issue / Close, no action") is more realistic than force-fitting everything into one linkage | MED | Extends the existing remediation endpoint rather than replacing it — add a `sourceType`/`sourceId` back-reference field to both `integrationTasks` and `raidEntries` |
| DD progress rollup by functional area (% requests closed, count of open findings by severity) | This is the thing an IL actually reports upward before Day 1 — "Legal is 90% done, HR flagged 3 high findings" — and it's cheap to compute from the request list + findings register once they exist | LOW | Feeds directly into the IMO reporting area (Area 3) — build the data model here, surface it there |
| Findings carried into the steerco pack automatically | Differentiator vs. spreadsheet-based DD trackers, which require manual re-typing into the board deck each week | LOW (once Area 3 exists) | Direct dependency: Area 3 needs Area 1's data model finalized first |

### Anti-Features (deliberately NOT building)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Full virtual data room (per-document watermarking, granular per-file view/download/print permission matrix, external counterparty logins) | Real tools like SecureDocs/Datasite/DealRoom are built around this and it looks "complete" | This is a single-IL laptop tool with local file storage and no external-party access model; building VDR-grade document security is a multi-month project orthogonal to the stated user (one IL, not opposing counsel/bankers/target-side users) — and it duplicates what TE almost certainly already licenses (Datasite/Intralinks) for the actual deal | Clean-room segregation should be a coarse **need-to-know role/tag on findings and requests** (e.g., "core team only" vs "extended team"), not document-level ACLs. See below. |
| External/counterparty user accounts (target-side or advisor logins) | "Clean room" and "DD request list" both imply the other side needs access to respond | Real DD Q&A/document exchange happens in TE's existing licensed VDR provider, not this tool; adding external identity is a major auth/security scope increase for a single-operator app, and conflicts with the foundation decision to make auth mandatory and role-scoped internally | The DD workspace tracks TE's *internal* view of DD (what we asked, what we got, what we found) — it is a diligence tracker, not a document exchange platform |
| Document version control / redlining | Feels necessary once you're storing documents | Out of scope for a status-tracking tool; this is legal-workflow software (Devensoft has a separate "legal workflow" module for exactly this reason — it's not bundled with synergy/PMI) | Store a reference/link + optional single latest file; leave version history to the source system |
| OCR/AI auto-extraction of findings from uploaded documents | Midaxo's "Madi" AI agent does this and it's the flashiest capability in the space | High complexity, needs a document-AI pipeline the app doesn't have, and is unnecessary for a single IL manually reviewing a known-size deal (dozens, not thousands, of documents) | Manual finding entry with a good enough form (functional area, severity, description, owner) is sufficient at this scale |

### Standard Data Model

```
ddRequestLists (per-project)
├── functionalArea: enum (Corporate, Financial, Legal, Tax, HR, Customers, Suppliers, IP, Real Estate, Operations)
├── requests[]
│   ├── id, title, description
│   ├── owner (internal, e.g. workstream lead)
│   ├── status: enum (not_started | requested | received | under_review | closed)
│   ├── dueDate, receivedDate
│   ├── documentRef (optional, uploads path)
│   ├── accessTier: enum (core_team | extended_team) — the "clean room" segregation field
│   └── notes

ddFindings (per-project)
├── id, functionalArea, requestId (optional back-ref)
├── severity: enum (critical | high | medium | low)
├── description, discoveredBy, discoveredDate
├── status: enum (open | routed | closed)
├── routedTo: { type: task | raid_risk | raid_issue | none, id: <ref> }
└── accessTier: enum (core_team | extended_team)
```

**Clean-room segregation, concretely:** not a VDR permission matrix — a per-record `accessTier` field (`core_team` vs `extended_team`) plus a role check at read time. This is the realistic need-to-know control for a small internal deal team (e.g., "only the 4 people who know the target's identity pre-announcement see the DD register"; everyone else sees nothing until Day 1). This maps naturally onto the mandatory-auth-with-roles foundation work already planned.

---

## Area 2: Synergy Value Capture

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Baseline value per initiative (pre-deal cost/revenue line the synergy acts on) | Every synergy tracking framework (BCG, L.E.K., Midaxo, Devensoft) starts from a baseline — "target vs realized" without a baseline is not credible to a CFO or steerco | LOW | Add `baseline` field to `synergyInitiatives`; this is the #1 gap named in PROJECT.md |
| Phasing / ramp over time (not a single target number) | Synergies "fully phase in" to run-rate typically by year 3 post-close in DCF practice; a single €M pair can't represent a ramp | MED | Add a `phasing[]` array of `{ period, plannedValue, realizedValue }` — monthly or quarterly cadence; this is the standard synergy-tracker row shape across every vendor reviewed |
| Cost-to-achieve (CTA) per initiative | Universally tracked alongside gross benefit — the standard invariant is **net benefit = gross benefit − cost to achieve**, and a rule-of-thumb budget is 1.0–1.2× annual run-rate synergy value | LOW | Add `costToAchieve` field; net benefit becomes a computed field, not stored data (avoid drift) |
| Owner per initiative | Named accountability is called out everywhere as the single biggest determinant of whether a synergy actually lands — "no owner, no weekly cadence, no leading indicators" is cited as exactly why synergies stall | Already exists on `synergyInitiatives` presumably | Verify field exists; if not, trivial add |
| Confidence / stage field (idea → validated → committed → captured) | This is the standard 3–4 gate progression in every synergy-tracking methodology reviewed (BCG's stage-gate, Devensoft's "confidence" field) — a synergy register without a maturity stage looks like a wishlist, not a plan | MED | Enum field `stage: idea | validated | committed | captured`; each stage transition should be a deliberate action (not free-text), because steerco reporting depends on being able to say "€X of validated synergy, €Y still idea-stage" |
| Link from synergy initiative to the tasks that deliver it | PROJECT.md explicitly requires this; industry practice ties every value line to actions (e.g. "account coverage, pipeline, conversion" for revenue synergies) — a synergy with no delivering tasks is unfalsifiable | LOW–MED | `synergyInitiatives.deliveredByTaskIds[]` referencing `integrationTasks`; mirror the existing findings→task linkage pattern rather than invent new plumbing |
| Category/type field (cost vs. revenue synergy) | Cost and revenue synergies have fundamentally different leading indicators (revenue needs pipeline/conversion tracking; cost needs headcount/contract actuals) — treating them identically is a known failure mode | LOW | Probably already exists on `synergyInitiatives` ("by category") per PROJECT.md validated section |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Auto-computed net benefit + variance (planned vs. realized run-rate, this period and cumulative) | Removes manual recalculation that plagues spreadsheet trackers; enables the steerco waterfall chart (period variance) without rebuilding numbers each week | LOW–MED | Pure derived data from baseline + phasing + CTA — no new input burden on the IL |
| Rollup by category/workstream (total planned vs. realized, count by stage) | This is exactly the "top 5 synergy levers by value" and "total value: planned vs realized run-rate" content every steerco pack template calls for | LOW | Feeds Area 3 directly |
| Stage-gate history (when did this initiative move idea→validated→committed?) | Lets the IL show momentum over time in a steerco pack ("3 initiatives promoted to committed this month") — cheap if stage transitions are timestamped events rather than an overwritten field | LOW | Small append-only log; reuse audit-log foundation work being built anyway |

### Anti-Features (deliberately NOT building)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Full financial-modelling engine (scenario/sensitivity analysis, Monte Carlo on synergy ranges) | "Synergies valuation" literature goes deep into DCF-grade modelling | This is finance/corp-dev tooling, not IMO execution tooling — TE's corp-dev team almost certainly has a real financial model elsewhere; duplicating it here creates two sources of truth for the same number | The app tracks the plan-vs-actual execution view (baseline, phasing, CTA, stage) — it does not replace the valuation model that produced the original deal thesis |
| Automated ERP/GL integration to pull "actual" realized synergy numbers | Would be the gold standard of "proof source" | No TE IT dependency is permitted this milestone (explicit constraint); this is exactly the kind of integration deferred to a later milestone | IL manually enters realized values from a monthly finance close report; add a free-text/optional-link "proof source" field instead of a data pipe |
| Synergy approval workflow with SLA timers / multi-step sign-off chains | Enterprise M&A platforms (per research) route synergy entries through configurable approval chains | Over-engineered for a single IL who both proposes and reports synergies — there's no multi-approver chain to model when the primary user is one person | A simple stage field the IL sets directly is sufficient; if TE later wants finance sign-off, that's a role-permission question for the foundation work, not a workflow engine |

### Standard Data Model

```
synergyInitiatives (extend existing)
├── id, title, category (cost | revenue), workstream, owner   [existing]
├── baseline: number                                            [NEW]
├── costToAchieve: number                                       [NEW]
├── stage: idea | validated | committed | captured               [NEW]
├── stageHistory[]: { stage, changedAt, changedBy }              [NEW]
├── phasing[]: { period (e.g. "2026-Q3"), plannedValue, realizedValue }  [NEW]
├── deliveredByTaskIds[]: ref -> integrationTasks                [NEW]
├── proofSource: text (optional, e.g. "Aug finance close report")  [NEW]
└── (computed, not stored) netBenefit = sum(phasing.plannedValue) - costToAchieve
    (computed, not stored) realizedToDate = sum(phasing.realizedValue)
```

---

## Area 3: IMO Reporting & Exports

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Steering-committee pack generation (single export covering plan, RAID, synergies) | Every mature PMI vendor markets this as the payoff feature — "collapses chaos into one CFO-grade dashboard" — and PROJECT.md explicitly names this as replacing manual deck assembly | MED–HIGH | This is the headline deliverable of the whole milestone; build the rollups (Areas 1–2 data + existing RAID/tasks) first, then the export layer |
| Status rollup across workstreams (RAG status per workstream, key changes since last report) | Universal steerco content — "status report with RAG status and key changes" is named across every IMO governance reference found | LOW–MED | Compute from existing `integrationTasks` (group by workstream, % complete, overdue count) — no new entity needed, just aggregation |
| RAID summary (open risks/issues by severity, decisions log, dependency map) | Named as core recurring IMO artifact everywhere reviewed; the app already has `raidEntries` — this is purely a reporting view, not new data | LOW | Reuse `raidEntries` as-is; group by type/severity/workstream for the pack |
| Synergy summary (planned vs. realized run-rate, top levers, cost to achieve) | Standard weekly synergy-dashboard content per every source reviewed | LOW (once Area 2 exists) | Direct dependency on Area 2's phasing/stage data |
| At least one real export format (PDF and/or PPTX, plus CSV/JSON data export) | PROJECT.md flags this as a hard gap — "the app currently has import but no export endpoint at all" across ~90 endpoints; this is close to a blocker-level finding, not a nice-to-have | MED | PDF is the higher-value target (steerco packs are consumed as PDF/PPT in practice); CSV/JSON export of raw entities (tasks, RAID, synergies) is lower effort and should ship alongside as a "data export" safety valve independent of the pretty pack |
| Configurable reporting period / "as of" date on every report | Steerco packs are point-in-time snapshots ("status as of [date]"); without this, a generated report silently drifts as live data changes underneath it | LOW | Snapshot the aggregation at generation time rather than rendering live-only; store generated packs so past reports remain reproducible |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| DD findings rollup folded into the pack pre-close, replaced by synergy/execution rollup post-close | Most PMI tools are integration-only and don't unify DD-stage and execution-stage reporting in one pack template — TE's own lifecycle-gap analysis is exactly this seam | MED | Natural consequence of building Area 1 and Area 3 on a shared "generate pack" mechanism with phase-aware sections |
| Cadence-aware pack variants (weekly workstream-lead view vs. monthly steerco/board view) | Practice consistently distinguishes a detailed weekly operating view from a stripped-down monthly board view ("board-level exports strip operational noise — net benefit, cost to achieve, confidence delta only") | MED | Two export templates sharing the same aggregation layer: full (weekly) and executive-summary (monthly/board) |
| Historical pack archive (compare this week's steerco pack to last week's) | Lets the IL show trend ("3 risks closed since last week") without manually diffing decks — cheap once packs are snapshotted rather than always-live | LOW (given snapshotting above) | Store generated packs as records, not just files, so a simple list/diff view is possible later |

### Anti-Features (deliberately NOT building)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Native PPTX generation with TE branding/template fidelity | "Steerco pack" strongly implies PowerPoint in most people's mental model | Building a pixel-faithful PPTX generator (charts, TE brand template, custom layouts) is a disproportionate engineering investment for a vanilla-JS/no-build-step stack with no existing document-generation library; also the fastest way to blow the "no framework" constraint by pulling in a heavy PPTX toolchain | Generate a well-structured PDF (via existing print-to-PDF/HTML-to-PDF patterns already used for other exports in this app) and a clean data export (CSV/JSON); PDF is print-ready and steerco-usable even if it isn't editable-in-PowerPoint |
| Live dashboard subscriptions / scheduled auto-emailed reports | "Weekly dashboard" cadence in practice literature implies automation | The app has no mail-sending infrastructure beyond the existing communications/broadcast feature, and scheduled background jobs are new operational surface area (cron, retry, failure handling) disproportionate to a single-IL tool | The IL manually clicks "generate pack" on their own cadence; if TE wants push-scheduling later, it's a follow-on to the comms system already in the app, not new infrastructure now |
| Interactive drill-down BI dashboard (e.g. embedded charting library with live filters) | Vendors like Devensoft/Midaxo market "powerful dashboards" | Adds a charting dependency and real design/maintenance surface for a single-operator tool that mostly needs a static point-in-time report; the app doesn't currently ship a charting library and this milestone's constraint is no new framework/bundler | Simple static summary tables + a small number of hand-rolled SVG/canvas charts (bar for cumulative synergy, a RAG-status grid) is enough to match "board-level export" expectations without a BI stack |

### Steering-Committee Pack — Concrete Content & Cadence

Based on convergent practice across IMO governance guides:

**Cadence structure (three tiers, use the two outer ones):**
- Daily huddle — tactical, workstream-internal — **not** a formal export, out of scope for this feature
- **Weekly integration-leadership report** — IL + workstream leads — detailed operating view
- **Monthly steering-committee pack** — executive/board — summarized, decision-focused view

**Weekly report contents:**
- Workstream RAG status grid (one row per workstream: on-track / at-risk / off-track, % tasks complete, overdue count)
- Key changes since last report (what moved, what's new)
- Open risks/issues by severity (top N, from RAID)
- Decisions needed this week (from RAID decision-type entries)
- Rolling 12-week task look-ahead (upcoming due dates by workstream)
- Synergy snapshot: planned vs. realized run-rate this period, top 5 levers by value

**Monthly steering-committee pack contents (stripped down from weekly):**
- Executive summary: overall RAG, days into integration (Day X of 100), synergy net benefit + cost-to-achieve + confidence-stage mix
- Milestone tracker (Day-1 through Day-100 gates, status)
- Top risks and dependencies only (not the full list)
- Synergy rollup by category (cost/revenue), stage distribution (idea/validated/committed/captured), cumulative realized vs. plan chart
- Decisions required from the steerco this cycle
- (Pre-close only) DD status rollup by functional area, critical/high findings outstanding

**Data sources per section — all should map to existing or newly-extended entities, not new reporting-only tables:**
| Pack section | Source entity |
|---|---|
| Workstream status | `integrationTasks` grouped by workstream |
| Milestones | `checklistTemplates` phase markers / Day-1-100 roadmap |
| Risks/issues/decisions | `raidEntries` |
| Synergy rollup | `synergyInitiatives` (extended per Area 2) |
| DD status (pre-close only) | `ddRequestLists` / `ddFindings` (new, per Area 1) |

---

## Area 4: Org Design & Talent Retention

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Org structure / role mapping beyond a flat employee list | "Job mapping" is described as *the* foundational activity for comparing positions across both companies and building the merged job architecture — a flat list can't represent reporting lines, overlaps, or gaps | MED | New `orgRoles` entity: role, level, reporting-to, function, mapped-from (acquirer role / target role), status (retained/redundant/new/TBD) |
| Role selection / redundancy decision tracking | Named directly in PROJECT.md; practice is explicit that redundancy decisions must be made and communicated fast (within one week of determination) to avoid rumor-driven attrition | MED | Each `orgRoles` entry needs a decision field (`retained | redundant | at_risk | TBD`) + decision date + notified date, so the tool can flag "decided but not yet communicated" as its own risk state |
| Key-talent flight-risk register | Explicitly named; acquired-employee attrition roughly doubles post-close (documented 32–36% → 55–71% in studied cases) with leadership-layer loss being most damaging — this is a distinct, prioritized list, not a generic employee field | LOW–MED | New `flightRiskRegister` entity (or an extension of `employees`): person, criticality/succession flag, risk level, retention action, owner, review date |
| Link between org design and existing `employees` data | Avoid a second, disconnected roster; the app already has an employee list (per STRUCTURE.md/`employees`-shaped data used across dashboard/employee portal) | LOW | `orgRoles` and `flightRiskRegister` should reference existing employee IDs where the person is known, not duplicate name/contact fields |

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Two-stage org design (stabilization design now, transformation/synergy redesign later) | Practice explicitly recommends this staged approach to reduce retention risk vs. a single "final" redesign done too early | MED | Model as a `designStage` field (`stabilization | transformation`) on the org structure so the same tool tracks both passes without being rebuilt |
| Flight-risk scoring from existing HR-adjacent data (comp-vs-market flag, performance rating, tenure, succession-plan flag) rather than a bespoke score | Practice explicitly recommends using existing data non-invasively rather than new data collection or surveillance | MED | Feed from fields already likely present in `employees` (role, tenure) plus a small set of manually-entered flags (critical-role, succession-plan-in-place) — avoid inventing a "risk algorithm" that looks more scientific than the input data supports |
| Redundancy communication tracker (decision date → notification date, with an overdue flag past 1 week) | Turns a well-known best practice ("tell them within a week") into an operational nudge inside the tool itself — cheap and directly actionable for a single IL | LOW | Simple date-diff + banner, reusing the existing banner/notification system already in the app |

### Anti-Features (deliberately NOT building)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Full HRIS-grade org-chart visual builder (drag-and-drop boxes, auto-layout, print-to-scale org charts) | Feels like the "complete" version of org design software | Disproportionate UI investment for a vanilla-JS app with no charting/graph-layout library, and duplicates what TE's actual HRIS (Workday/SAP, explicitly deferred this milestone) will eventually own | A structured table/list view (role, level, reports-to, mapped status) is sufficient for an IL's decision-making; a simple indented/tree list view is enough visual structure without a layout engine |
| Compensation/severance calculation engine | Redundancy decisions naturally raise "what does this cost" | This is payroll/legal/finance territory with jurisdiction-specific rules (notice periods, severance formulas) — high liability if gotten wrong, and squarely HR/Legal's system of record, not IMO's | Track the decision and status only; link out to or note that a severance case is being handled in HR's existing process, don't calculate figures |
| Automated flight-risk prediction (ML model scoring departure probability) | KPMG/WTW research on attrition rates makes "predictive risk scoring" sound achievable | No training data, no ML infrastructure, and a false sense of precision is worse than an honest manual risk list for a single deal's population (dozens to low hundreds of people, not enough data to model anything) | Manual risk-level assignment (High/Medium/Low) by the IL/HR lead using a short checklist of known factors (critical role, comp gap, tenure, succession gap) — a rubric, not a model |
| External/self-service access for affected employees to see their own status | Feels transparent and employee-centric | Redundancy/flight-risk data is exactly the MNPI-adjacent, high-sensitivity content the foundation's mandatory-auth/audit-log work exists to protect; employee self-service to their own "at risk" status is a legal and trust minefield before any HR/Legal sign-off process exists | Keep this IL/HR/Legal-role-only, gated by the same role-based access foundation work covers everything else this milestone |

### Standard Data Model

```
orgRoles (per-project)
├── id, title, function, level
├── reportsToRoleId (self-referencing, for hierarchy)
├── mappedFromAcquirer / mappedFromTarget (which legacy role(s) this maps from)
├── mappedEmployeeId (ref -> employees, if filled)
├── designStage: stabilization | transformation
├── decision: retained | redundant | at_risk | tbd
├── decisionDate, notifiedDate
└── notes

flightRiskRegister (per-project)
├── id, employeeId (ref -> employees)
├── riskLevel: high | medium | low
├── criticalRole: boolean, successionPlanInPlace: boolean
├── retentionAction (text), actionOwner
├── reviewDate
└── notes
```

---

## Feature Dependencies

```
[Area 1: DD findings register]
    └──requires──> existing remediation linkage (POST /api/integration-tasks/from-remediation)
                       └──extends to──> [raidEntries] AND [integrationTasks] (finding routes to either)

[Area 2: Synergy phasing/baseline/CTA/stage]
    └──requires──> existing synergyInitiatives entity (extend, don't replace)
    └──enables──> [Area 2: synergy→task linkage] (needs integrationTasks to exist, which it does)

[Area 3: IMO reporting pack]
    └──requires──> [Area 1 data model] (for pre-close DD rollup section)
    └──requires──> [Area 2 data model] (for synergy rollup section)
    └──requires──> existing raidEntries + integrationTasks (status/RAID rollups)
    └──requires──> Foundation: audit log + mandatory auth (packs may contain MNPI; must be access-gated)

[Area 4: Org design + flight risk]
    └──requires──> existing employees entity (reference, don't duplicate)
    └──enhances──> [Area 3 reporting] (org/redundancy status could appear in steerco pack later, not required this milestone)

[Foundation: mandatory auth + roles + audit log]
    └──gates──> [Area 1 clean-room accessTier enforcement]
    └──gates──> [Area 4 flight-risk/redundancy visibility]
    └──gates──> [Area 3 pack access] (packs likely contain synergy €, redundancy counts — MNPI-adjacent)
```

### Dependency Notes

- **Area 3 (reporting) is the last area to build, by data dependency**, even though it's the headline deliverable: its rollups need Area 1's DD data model and Area 2's synergy phasing/stage fields to exist first, or the pack ships with two of five sections empty. Sequence Areas 1 and 2 before Area 3 in the roadmap.
- **Area 1 and Area 2 do not depend on each other** and can be built in parallel — they both extend independent existing entities (RAID/tasks vs. synergyInitiatives).
- **Area 4 is the most independent** of the four — it touches `employees` but not RAID/tasks/synergies, and nothing else in this milestone depends on it. It's the safest area to defer or descope if the milestone needs to shrink, without blocking the other three.
- **All four areas depend on the Foundation work being done first**, per PROJECT.md's own "foundation first" decision — this is not a new finding, just confirmation that the sequencing logic already agreed on holds for these four specifically: DD clean-room segregation, flight-risk/redundancy visibility, and steerco pack contents all involve the most sensitive data in the app (pre-announcement target identity, valuations, retention lists, named org decisions), which is exactly why mandatory auth + audit log must land first.

---

## MVP Definition

### Launch With (v1 of this milestone, after Foundation)

- [ ] DD request list + findings register with functional-area taxonomy and findings→task/RAID routing — the extension of the existing remediation linkage is cheap and is explicitly named as the intended spine
- [ ] Clean-room `accessTier` field (core_team/extended_team) on DD requests/findings, enforced by role — the minimum viable version of need-to-know segregation
- [ ] Synergy baseline, cost-to-achieve, and stage (idea/validated/committed/captured) fields added to `synergyInitiatives` — the highest-value, lowest-complexity extension of an existing entity
- [ ] Synergy phasing array (planned/realized per period) — this is what actually fixes the "single €M pair" problem named in PROJECT.md
- [ ] Synergy → delivering-tasks linkage
- [ ] CSV/JSON data export of tasks, RAID, and synergies — closes the "no export at all" gap with the lowest possible effort, independent of the fancier pack
- [ ] Basic org role-mapping table (role, level, reports-to, mapped employee, decision status) — table stakes for Area 4, doesn't need a visual org chart

### Add After Validation (v1.x)

- [ ] Generated PDF steering-committee pack (weekly operating view + monthly executive view) — once Areas 1 and 2's data models are proven with real deal data, build the rollup/export layer
- [ ] Flight-risk register with rubric-based risk levels and redundancy-communication-overdue flagging
- [ ] Historical pack archive / snapshot comparison ("what changed since last week")
- [ ] Two-stage org design tracking (stabilization vs. transformation design pass)

### Future Consideration (v2+, likely a later milestone)

- [ ] Cadence-aware automated pack scheduling/emailing — defer until the manual "generate pack" flow is proven and TE has decided on hosting/email infrastructure
- [ ] Any AI-assisted document/finding extraction — defer until DD volume on a real deal shows manual entry is actually a bottleneck (unlikely at "one IL, one deal" scale)
- [ ] Interactive BI-style dashboard — defer indefinitely unless the static reports prove insufficient; adding a charting dependency is a stack decision bigger than this milestone

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| DD request list + functional-area taxonomy | HIGH | LOW | P1 |
| DD findings register + routing to task/RAID | HIGH | LOW–MED | P1 |
| Clean-room accessTier field + role enforcement | HIGH (compliance-driven) | LOW | P1 |
| Synergy baseline + cost-to-achieve fields | HIGH | LOW | P1 |
| Synergy phasing/ramp array | HIGH | MED | P1 |
| Synergy confidence stage-gating | HIGH | MED | P1 |
| Synergy → task linkage | MED–HIGH | LOW–MED | P1 |
| CSV/JSON raw data export | HIGH (closes a named gap) | LOW | P1 |
| Org role mapping table + redundancy decision status | HIGH | MED | P1 |
| Steerco PDF pack generation | HIGH | MED–HIGH | P2 |
| Flight-risk register | MED–HIGH | LOW–MED | P2 |
| Pack cadence variants (weekly vs. monthly view) | MED | MED | P2 |
| Historical pack archive/diff | MED | LOW | P3 |
| Two-stage org design tracking | MED | LOW | P3 |
| Redundancy-communication overdue nudge | MED | LOW | P3 |
| Native PPTX export | LOW (nice but not required) | HIGH | P3 (or never) |
| Full VDR/document ACL system | LOW (duplicates licensed tools) | HIGH | Not planned |
| Automated flight-risk ML scoring | LOW (false precision at this data scale) | HIGH | Not planned |

**Priority key:**
- P1: Must have for this milestone
- P2: Should have, add once P1 areas are proven on a real deal
- P3: Nice to have, defer to a later milestone

## Competitor Feature Analysis

| Feature | Midaxo | Devensoft | DealRoom / SecureDocs (VDR-focused) | Our Approach |
|---------|--------|-----------|---------------------------------------|--------------|
| DD request/findings tracking | Bundled in VDR + AI summarization ("Madi") | Bundled as a due-diligence module (separate from PMI module) | Core product (VDR-first, workflow-light) | Findings-first, no VDR — findings route directly into existing task/RAID entities; skip the AI-extraction layer entirely at this scale |
| Synergy tracking | KPIs/milestones tied to post-deal initiatives, one shared workspace with deal pipeline | Dedicated synergy-tracking module with dashboards + ROI, tied to workstreams/tasks | Not a core focus (VDR-first vendors don't typically do value tracking) | Extend existing `synergyInitiatives` with baseline/phasing/CTA/stage — same conceptual shape as Devensoft's module, without a separate module/subscription |
| Clean-room / access segregation | VDR-grade permissioning | Not the focus (integration-stage tool) | Core strength (4-tier: none/view/download/full; watermarking; tiered pre/post-LOI access) | Coarse 2-tier accessTier flag, not a permission matrix — deliberately smaller scope, appropriate to a single-IL internal tool, not a counterparty-facing VDR |
| Reporting/export | Real-time dashboards, CFO-grade rollups | Dashboards + ROI analysis across modules | Not the focus | PDF pack + CSV/JSON export; no PPTX, no BI dashboard — matches the "board pack strips noise to net benefit/CTA/confidence" pattern from practice literature without vendor-grade dashboard tooling |
| Org design / talent retention | Not a named module in reviewed sources | Workstream/sub-workstream modeling (HR workstream can hold this) but no dedicated flight-risk feature found | Not the focus | Purpose-built role-mapping + flight-risk register — this is the one area where none of the three reviewed vendors have an obvious dedicated feature, making it a genuine differentiator for TE if built well |

## Sources

- [Midaxo M&A Due Diligence Software](https://www.midaxo.com/platform/m-a-due-diligence) — findings management, AI agent "Madi", checklist workflows, real-time dashboards
- [Midaxo M&A Software 2026 guide](https://www.midaxo.com/blog/what-is-m-a-software-in-2026)
- [Midaxo Synergy Tracking](https://www.midaxo.com/platform/integration-value/track-synergies)
- [EthosData / data-rooms.org / datarooms.com.hk — DD data room checklist structures](https://www.ethosdata.com/blog/due-diligence-data-room-checklist/)
- [CT Acquisitions — Data Clean Room 2026 guide](https://ctacquisitions.com/data-clean-room/)
- [SecureDocs security overview](https://www.securedocs.com/hubfs/SD_Downloadable%20Assets/SD_Security_2.pdf) — access tiers, watermarking, audit trail
- [Umbrex Post-Merger Integration Playbook 2025 — Synergy Identification, Tracking & Reporting](https://umbrex.com/resources/post-merger-integration-playbook-2025/synergy-identification-tracking-reporting/)
- [BCG — Capturing Value from Synergy in PMI: Four Essential Steps](https://www.bcg.com/publications/2025/value-from-synergy-pmi-four-essential-steps)
- [L.E.K. Consulting — Achieving Synergies Post Merger](https://www.lek.com/insights/ei/achieving-synergies-post-merger)
- [Devensoft Synergy Tracking](https://www.devensoft.com/platform/synergy-tracking/) and [Devensoft workstream/sub-workstream documentation](https://devensoft.freshdesk.com/support/solutions/articles/5000792338-creating-workstreams)
- [NMS Consulting — Post-merger integration synergy tracker template](https://nmsconsulting.com/post-merger-integration-synergy-tracker/)
- [Umbrex — Governance & Integration Management Office (IMO)](https://umbrex.com/resources/post-merger-integration-playbook-2025/governance-integration-management-office-imo/)
- [NMS Consulting — IMO Setup Guide for M&A Integration Governance](https://nmsconsulting.com/ma-integration-governance-imo-setup-guide/)
- [CT Acquisitions — Best Post-Merger Integration Software 2026 (10-vendor comparison)](https://ctacquisitions.com/best-pmi-software-100-day-integration/)
- [WTW — 5 tips for organizational design and talent selection in M&A](https://www.wtwco.com/en-US/insights/2022/02/5-tips-for-getting-organizational-design-and-talent-selection-right-in-m-and-a)
- [WTW — Why job mapping is critical to a successful M&A](https://www.wtwco.com/en-us/insights/2024/07/why-job-mapping-is-critical-to-a-successful-m-and-a)
- [KPMG — Talent flight: overlooked risks during M&A](https://kpmg.com/kpmg-us/content/dam/kpmg/pdf/2023/talent-flight-overlooked-risks-during-m-a.pdf)
- Project context: `/Users/karstenhaldan/M&A/.planning/PROJECT.md`, `/Users/karstenhaldan/M&A/.planning/codebase/STRUCTURE.md`

---
*Feature research for: M&A integration / IMO software — four capability gaps*
*Researched: 2026-07-23*
