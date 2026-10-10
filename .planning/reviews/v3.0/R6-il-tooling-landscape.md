# R6 — What an Integration Lead expects from an IMO tool, and how enterprise tools switch modules off

Lane R6 (domain research) for v3.0 · 2026-10-10 · web research + a few read-only repo greps. No app run, no repo edits.
**Evidence tags:** [F] I fetched and read the page · [S] only a search-engine summary of the page (I did not read it) · [M] vendor marketing claim, unverified · [V] verified by me in this repo · [I] my inference (kept to section 7).
**Fetch failures:** every mckinsey.com fetch timed out (9 attempts) so McKinsey statements are [S]; blogs.sap.com 403; web.archive.org blocked; two PDFs (gov.uk RAG guide, BCG 2017) unreadable (no PDF tooling).
**Correction to a common belief:** I found no Datasite acquisition of Midaxo (PitchBook lists Midaxo as a Datasite *competitor*) [S]. Datasite did acquire Ansarada (completed 28 Aug 2024) [S]. Treat Midaxo as independent.

---
## 1. The integration lead's cockpit in practice (Q1)

### 1.1 What guides and tools put in front of the IL (strength = how many independent source families show it)
| Element | Evidence | Reading |
|---|---|---|
| Milestones vs baseline, critical path | Devensoft: milestone burn-down with planned (baseline, "do not change"), forecast, actual [F S8]; DealRoom: timeline, overdue by workstream, due in 7 days [F S10]; EY: "dashboards and executive summaries" of "milestone status and pace" [F S1]; DealRoom dependency-driven dates and Timeline [F S12]; Midaxo Gantt [M S13] | in every tool and guide |
| Status / criticality per workstream (RAG) | Devensoft Status + Criticality columns, values undefined on the page [F S8]; DealRoom suggests custom statuses Delayed / Not Started / At Risk [F S12] | universal; thresholds never standardised (1.3) |
| Day-1 readiness | Deloitte: tiered "ready checkpoints" RCP1 workstream, RCP2 end-to-end process, RCP3 final, across HR/IT/Finance/Legal/Supply chain etc. [F S2]; EY: readiness sessions and simulations in the weeks before close [F S1]; BCG Day-1 checklist by function [S]; Midaxo Day-1 / 100-day playbooks [M S13] | in every guide |
| Synergy tracking vs plan | BCG: baseline, stage gates, IMO + CFO validate, formal reconciliation to finance view, monthly tracking [F S3]; LEK: stage-gate pipeline, one owner + one workstream per synergy, IMO signs off [F S4]; Pritchett: accountable owner, accounting ties costs to GL [F S5]; Midaxo "planned versus actual" [M]; Devensoft financials under each workstream [F S9]; DealRoom synergies are a permission area [F S11] | table stakes; differentiators = finance reconciliation, stage-gate pipeline, cost-to-achieve ("$1 of synergy may require up to $1.50 upfront" [F S3]) |
| Risks / issues / decisions (RAID) | Deloitte "RAID (risk, action, issue, decision) logs" [F S2]; Midaxo: every entry needs owner + review date, "worth raising in a steering meeting" [F S13]; Devensoft Major Issues / Major Risks [F S8]; Smartsheet issue form [F S14]; single decision log [F S42] | table stakes |
| Steering-committee pack / exec reporting | EY three-tier governance SteerCo / IMO / workstreams [F S1]; Pritchett meeting agenda "identify issues/decisions for SC" [F S6]; BCG SteerCo approves stage gates [F S3]; Midaxo/DealRoom one-click reports [M] | table stakes |
| 100-day and beyond scorecard | Smartsheet scorecard at 100 days and one year [F S14]; BCG: track monthly "for the first two to three years" until the last dollar [F S3] | Day 100 is a convention, tracking runs far longer |
| Customer-loss / dis-synergy signals | Deloitte NL: integration director should "uncover risks and dis-synergies, such as potential customer losses due to the deal" [F S44]; BCG: revenue synergies need a pre-deal baseline, initiatives and KPIs [F S3]; McKinsey: revenue synergies most often neglected [S S7] | recognised, rarely a tool tile |
| Talent / retention | Deloitte NL: "Identifying these individuals early and involving them from Day 1 post-deal is crucial", "A robust talent management strategy is indispensable" [F S44]; no platform dashboard I read shows a retention tile [F S8, S10]; no tracking framework found in generic HR sources [S]; EY lists "team motivation" under change management [F S1] | domain-critical, not evidenced as tooling table stakes |
| Workstream taxonomy | functional: Deloitte lists 11 categories (marketing, go-to-market, services, supply chain, procurement, HR, real estate, IT, finance, shared services, legal) [F S2]; Pritchett weekly meeting covers IT, Operations, Marketing, Communication, OD/HR, Finance, Legal, Corp Dev, Day 1, Synergy, Real Estate [F S6]; Midaxo playbook has seven [S]; Devensoft Workstream → SubWorkstream [F S9] | functions are the unit of work; "modules" in tools are lifecycle stages (section 2) |
| Communications | EY step 9: IMO must "effectively communicate the rationale for the decisions" [F S1]; Deloitte Day-1 list has no comms category [F S2] | an IMO duty, rarely a dashboard tile |
| Clean-team / confidentiality status | EY: "integration leader will be responsible for confirming that confidentiality is not violated … prior to transaction close" [F S1]; BCG clean teams [F S3]; tooling evidence is access-control claims only (section 3) | an IL duty with little tooling surface |
| Data hygiene | Midaxo RAID: stale entries turn the log into an archive, items without owner/action are "documentation, not management" [F S13] | recurring IMO failure mode |

**My classification rule** (not from a source): table stakes = appears in at least two independent guides **and** in at least one tool doc or template. *Table stakes* = milestones/critical path, status RAG, Day-1 readiness, synergy vs plan, RAID, SteerCo pack (tool evidence is marketing only), plus weekly cadence and post-Day-100 tracking (guide-only, but consistent across EY, Pritchett and BCG). *Differentiators* = finance-reconciled synergy with cost-to-achieve, retention tracking, customer-loss signals (duty evidenced in guides, absent from tool docs), clearance/insider ledger (duty evidenced by FTC/MAR/EY, no tool doc shows it). A change-since-last-SteerCo delta is my addition; no source shows it.

### 1.2 Cadence evidence
- EY: weekly IMO cadence with workstreams and SteerCo [F S1]. Pritchett: weekly IMO meeting plus 120-minute weekly functional meeting (IMO update 10, team updates 30, issues/decisions for SC 30, cross-cutting 30, wrap-up 20) [F S6].
- BCG: synergy tracking monthly for 2–3 years, then quarterly; plans locked at or before close; measurement principles and approval governance defined up front [F S3]. Pritchett: executive reviews "Periodic (Quarterly/Monthly)" [F S5].
- One firm's template (weekly SteerCo 90 min, monthly sponsor, quarterly board) is not a Deloitte standard [S]; a 31 %-more-synergies claim attributed to a "Deloitte 2025 survey" could not be traced to Deloitte [S] — do not use.
- Day-1 "command center" / daily stand-up appears only in low-authority sources [S]; no Big-4 page I read states a daily cadence.

### 1.3 RAG: no M&A standard
Nothing I read defines Red/Amber/Green thresholds for integration; every guide leaves it to the IMO. The only rigorous public scale is the UK IPA/NISTA delivery-confidence definitions (Green = delivery "highly likely", Red = "appears to be unachievable") from an older guide now listed as withdrawn [S S39]. Practitioner commentary ties "watermelon" reporting (green outside, red inside) to unclear criteria and fear of reporting red, and recommends objective thresholds [S S40, vendor blog].

### 1.4 What the sources say the IL personally owns
Confidentiality/gun-jumping compliance pre-close (EY [F]); integration managers "accelerate integration, provide structure, build social ties, produce early wins" (HBR 2000, abstract only [S S38]); McKinsey: IMO as a "control tower" with dashboards and escalation paths, reporting to a CEO-led steering committee, one full-time accountable leader, IMO of roughly 3–8 FTE [S S7]. Deloitte NL (6 Nov 2025): IMO "headed by the integration director", who also forecasts when synergies materialise for the valuation model; "integrations often require 200 to 350 tasks"; an integration blueprint drafted in the early weeks, at the latest between signing and closing [F S44]. DealRoom's deal-snapshot tile names "M&A owner" and "integration lead" as first-class fields [F S10]. Three-tier model in the guides: executive SteerCo, IMO (the IL), functional workstream leads [F S1]; clean team is a separate fenced role (section 3).

---
## 2. How M&A integration platforms structure the IL home and what admins gate (Q2)

| Platform | Verified | IL home | Admin-gated / configurable |
|---|---|---|---|
| Devensoft | lifecycle tool; Target/Program → Workstream → SubWorkstream → Milestone → Task → SubTask; Financials per workstream [F S9] | Program Dashboard: counts of major issues/risks, open sub-workstreams, delayed milestones; milestone burn-down; Projects/Workstreams/SubWorkstreams tables (owner, forecast end, % complete, criticality, status); Major Issues; Major Risks. No synergy tile on that page [F S8] | Admin guide headings only: User/Role Administration, Permissions, Security, Application Settings, Tab Settings, Custom Properties, "Types of Administrators (Super Admins vs Business Unit Admins)". Whether tabs can be hidden per role is **not stated** [F S9] |
| DealRoom | integration module; pre-made integration templates [S]; dependency-driven dates, custom statuses [F S12] | Progress Dashboard: deal snapshot (name, phase, M&A owner, integration lead), tasks by status, per-workstream donuts, unresolved by priority, due soon, overdue. The page lists **no** synergies, risks or milestones [F S10] | Admin-only Permissions tab: per group, access to Requests, Findings, Data Room folders, **Synergies (value drivers, tracking fields)**, AI Analysis; group visibility hidden/viewable/invite; folder levels View (watermarked) / Download PDF / Download original / Edit; groups are archived, not deleted; article does not mention audit [F S11]. Pipeline Access vs Room Access [F S12] |
| Midaxo | modules M&A Strategy, Pipeline CRM, Due Diligence, Integration & Value (Integrate + Track Synergies), Permissions & audit trail, Workflow, AI, Analytics [F/M S13] | marketing only: playbooks, workstreams, planned-vs-actual value reporting for board [M] | "granular role-based access"; visibility "by project, process, workspace, and document"; "All actions are logged"; ISO 27001 / SOC 2 Type 1 "aligned with" on one page, "ISO 27001 certified" on another, so confirm with the vendor [M/S]. Page does **not** say whether customers can switch modules on or off [F] |
| Smartsheet | templates: Integration Issue Form, Change Management Process, Post-Merger Integration Plan, Integration Scorecard (100 days / one year) [F S14] | templates, not a home | none |
| Asana | no M&A-integration template found; generic transition and change-management templates mention mergers [S] | n/a | n/a |
| Ansarada (Datasite) | checklist + Deal Workflow to Day-1/100-day plan; how diligence findings become tasks is not explained [S S15] | n/a | n/a |
| Datasite / Intapp DealCloud | Datasite: Diligence, Acquire, Prepare, Pipeline, Outreach, Archive, no PMI module found [S]; DealCloud: deal CRM, no native PMI module found, proxy access with audit trail [S] | n/a | n/a |
| Seen once, unverified | MergerWare, Shibumi, BowMerge, eMerger, MangoApps [S/M] | | |

**Finding:** I found no public documentation of an M&A integration platform that lets a tenant administrator switch whole modules on or off. Gating is expressed as per-group / per-resource-type permissions (DealRoom, Midaxo claims) or role/tab settings (Devensoft, headings only). Module availability is probably a licensing matter, but no source says so. Module switching as the user describes it is a pattern of general enterprise platforms (section 5), not of the M&A niche.
**Two axes, not one.** M&A platforms name their *modules* after lifecycle stages (Midaxo: M&A Strategy, Pipeline CRM, Due Diligence, Integration & Value [F S13]; DealRoom: pipeline, diligence, integration [S]); *functions* (HR, IT, Finance, Legal …) are workstreams and, in DealRoom, permission groups [F S11]. General platforms switch the first axis (Azure DevOps services, GitLab project features) and scope data by the second.

---
## 3. Governance and MNPI in integration tooling (Q3)

- **Clean teams are the standard instrument.** FTC Bureau of Competition (20 Mar 2018): share "the least amount of information needed", "mask customer identities and aggregate", clean-team agreements "limit access to competitively sensitive information in data rooms to select individuals", clean teams "should not include any personnel responsible for competitive planning, pricing, or strategy", outputs leaving the clean team are "blinded, aggregated" and counsel-reviewed, protocols are to be designed, "maintained, and audited" and adherence monitored, destruction rules apply once bidding ends [F S17].
- **Operating model.** BCG: independent third-party specialists and/or reassignable employees behind a firewall, aggregated sanitised findings to management; best for baselines, vetting synergy targets, decision options; over-reliance "can dilute accountability" [F S3]. EY: set up legal/regulatory action plans, confidentiality rules and a data-sharing mechanism such as a clean room; IL confirms confidentiality is not violated [F S1].
- **People and walls interact.** Deloitte NL warns that putting key people into clean-room roles "may create regulatory problems" while also stressing that key talent must be identified early and involved from Day 1 [F S44]: retention planning and clean-team membership must be reconciled per person, not per module.
- **Why it is enforced.** FTC record gun-jumping penalty, 7 Jan 2025: $5.6 M, XCL/Verdun/EP Energy; buyer-side people took operational control of pricing, contracts and drilling before closing; 94 days in violation [F S18]. EU gun-jumping fines can reach 10 % of revenue [F S3].
- **Insider-list content (regulatory reference point).** EU MAR Art. 18 requires a list of everyone with access to inside information, with at minimum identity, reason for inclusion, date and time access was obtained, and date drawn up; prompt updates with date/time on change; written acknowledgement of duties; five-year retention [F S19]. UK FCA bulletin 54 says issuers should keep insider lists and require advisers to do the same [S S41]. Which regime binds TE is a legal question I did not research.
- **Access-control patterns seen in tools.** Group-based need-to-know by resource type and folder, view-only watermarked tier, download tiers, hidden group visibility so users cannot see each other [F S11]; project/process/workspace/document scoping [M S13]. VDR audit trails (logins, views, downloads, permission changes, exportable) are described by vendors [S/M]; I found no vendor documentation of clean-team-specific enforcement.
- **Code names and need-to-know** for pre-announcement deals are advisory-firm advice, not a regulatory requirement I could cite [S].
- **Not found:** a US rule requiring corporate issuers to keep insider lists (SEC material I saw is broker-dealer information-barrier exam findings [S S43]).

---
## 4. Production-readiness norms for internal tools holding confidential data (Q4)

OWASP ASVS 5.0.0 (May 2025; chapters V1 Encoding … V6 Authentication, V7 Session, V8 Authorization, V12 Secure Communication, V13 Configuration, V14 Data Protection, V15 Secure Coding & Architecture, V16 Logging) [F S20]. Levels L1/L2/L3 cumulative.
| Area | Norm (control id, level) | Source |
|---|---|---|
| Authentication | password min 8 (15 recommended) 6.2.1 L1; no composition rules 6.2.5; accept 64+ chars 6.2.9; no forced periodic rotation 6.2.10; breached-password check 6.2.12 L2; default accounts removed/disabled 6.3.2 L1; anti-automation documented 6.1.1; **MFA or a combination of single-factor mechanisms 6.3.3 L2** | ASVS V6 [F] |
| Sessions | inactivity timeout and absolute lifetime documented 7.1.1, enforced 7.3.1 / 7.3.2 L2; new token on login 7.2.4; all sessions end when an account is disabled 7.4.2 L1; admins can terminate one/all user sessions 7.4.5 L2. NIST SP 800-63B-4: AAL2 overall timeout SHOULD be ≤ 24 h, inactivity SHOULD be ≤ 1 h; AAL3 ≤ 12 h / 15 min; bearer secrets SHOULD NOT sit in HTML5 Local Storage | ASVS V7 [F]; NIST [F S21] |
| Authorization | function-level 8.2.1 and record-level 8.2.2 explicit permission (L1); rules enforced "at a trusted service layer" 8.3.1 L1; authorization changes applied immediately 8.3.2 L3; field-level 8.2.3 L2; documented rules 8.1.1 | ASVS V8 [F] |
| Audit and logging | each entry who/what/when/where 16.2.1; log all authentication 16.3.1; log failed authorization 16.3.2 (all decisions at L3); logs "cannot be modified" 16.4.2; ship to a logically separate system 16.4.3; no sensitive data in logs 16.2.5. V16 does **not** explicitly name admin/config-change events | ASVS V16 [F] |
| Data protection | classify data and document protection levels 14.1.1 / 14.1.2 L2; no-store caching 14.3.2; clear client storage at session end 14.3.1; no sensitive data in URLs 14.2.1; deletion of outdated data 14.2.7 L3 | ASVS V14 [F] |
| Hardening / transport | debug off in production 13.4.2; no exposed docs/monitoring endpoints 13.4.5; TLS for all client and internal connections 12.2.1 / 12.3.1 | ASVS V12, V13 [F] |
| Dependencies / change | documented risk-based remediation timeframes for vulnerable components 15.1.1 L1; maintained SBOM 15.1.2 L2; atomic check-then-act to avoid TOCTOU 15.4.2 L3 | ASVS V15 [F] |
| Access management | ISO 27001:2022 Annex A 5.15 Access control, 5.18 Access rights, 8.2 Privileged access rights, 8.3 Information access restriction, 8.5 Secure authentication [F S22]; access rights are provisioned, reviewed, modified and removed [control text from memory, not fetched] | ISO |
| Backup / availability | A.8.13 Information backup, 8.14 Redundancy, 5.30 ICT readiness for continuity [F titles S22]; guidance: back up business-critical data, store apart from the source, test restores against agreed recovery times [S, vendor explainer S22]; CIS Controls v8: 11.2 Perform Automated Backups, 11.5 Test Data Recovery [S S23]. **No source gives a numeric uptime or RPO/RTO norm**; the norm is to define and test them | ISO / CIS |
| Change control | A.8.32 Change management, A.8.31 Separation of dev/test/prod [F titles]; guidance: impact assessment, authorisation, testing in a separate environment, rollback and emergency procedure, records [S, explainer] | ISO |
| Monitoring | A.8.15 Logging, A.8.16 Monitoring activities [F titles] | ISO |
| SQLite-specific backup | copying a live database file can yield a corrupt backup ("some old and some new content"); safe on a live DB: `VACUUM INTO`, the Backup API, or `sqlite3_rsync` (3.47+); a plain file copy is safe only with no transaction in progress and the `-wal`/`-journal` file copied with it | SQLite docs [F S45] |

---
## 5. Module / feature switching in enterprise tools (Q5)

| Product | Scope | Hide vs block | Data on disable | Dependencies | Audit / notes |
|---|---|---|---|---|---|
| Azure DevOps (Boards, Repos, Pipelines, Test Plans, Artifacts) | per project; Project Administrators only | "hides it from all project members"; sidebar entry gone after refresh; **doc is silent on REST/API** | "all existing data … remain intact and accessible" on re-enable | not described | doc 214 words, no audit statement [F S24] |
| GitLab project features | per project; Disabled / members / everyone | "not visible and accessible"; but turning off analytics "only removes the Analyze navigation item" and data is still computed and **available through the API**; Repository-disabled API returns **403** and a reporter asked for 404 + reason, no maintainer response seen [F S25] | not stated | explicit: Repository off blocks Merge requests, CI/CD, LFS, Packages; Work items off affects Boards, Service Desk; Milestones reachable from MRs | |
| GitHub issues | per repository | issues feature removed | "any issues that were previously added will be available" if re-enabled | n/a | API behaviour not documented [F S26] |
| Jira Cloud (plan Releases) | per plan, Features toggle | hides tab, fields, markers, roll-ups | "Unsaved data … discarded and … can't be recovered"; saved plan-level data not stated | scheduling falls back to sprint dates; excluded items re-added | [F S27] |
| Google Workspace services | whole org, **per org unit or per group** | "only the services that are turned on for them" | docs silent on data | docs silent | "up to 24 hours"; needs Service Settings admin privilege; no audit mention [F S28] |
| Odoo apps | database-wide | n/a (it is uninstall) | "Uninstalling apps also deletes their database records"; pop-up lists "Apps to Uninstall" and "Documents to Delete"; "Test … on a duplicated database" | uninstall cascades to dependents | no deactivate alternative described [F S29] |
| WordPress 6.5 plugin dependencies | site | dependent cannot be activated while dependency missing | n/a | **refuses** deactivation while dependents are active (cascade vs refuse contrast) | readme-level source [S S30] |
| SAP Switch Framework | system | business function is a switch | n/a | "reversible" flag per business function; only reversible ones can be deactivated; enhancement-package functions were irreversible [S S31] | blog, 403 on fetch |
| AWS Organizations SCPs | org / OU / account | guardrail above role grants | n/a | n/a | SCPs "do not grant any permissions … specify the maximum permissions"; a principal "will not have access … even if they are explicitly granted access through an IAM policy"; management account exempt [F S32] |
| LaunchDarkly | per environment | kill switch "without redeploys" [S] | n/a | n/a | change history; approval requests with chosen reviewers; scheduled changes; history limited to 30 days on the lowest plan [S S34] |
| Salesforce Setup Audit Trail | org | n/a | n/a | n/a | admin config changes only ~180 days, 20 most recent shown, CSV download, no field-level before/after [S S35] |

**Cross-cutting evidence**
- Fowler/Hodgson: four toggle classes (release, experiment, ops, permissioning); permissioning toggles can be "very-long lived" and per-request; toggles are inventory with carrying cost ("toggle debt", expiry dates, caps); every toggle doubles states so test "the toggle configuration which you expect to become live" plus the all-off fallback, not every combination; static configuration in source control preferred unless runtime change is needed [F S33].
- OWASP API5:2023 Broken Function Level Authorization: "deny all access by default, requiring explicit grants to specific roles", one consistent authorization module, do not infer admin-ness from URL path [F S36]. API9:2023 Improper Inventory Management: old/deprecated endpoints "left running", "no retirement plan", keep an inventory [F S36]. ASVS 8.3.1: enforce at a trusted service layer, not client-side [F S20].
- UX of confirmation: reserve for serious/widespread/permanent actions, state the consequence, do not rely on a dialog alone (Primer's guidance, echoing a Nielsen Norman Group piece I did not read) [S S37]. Odoo's blast-radius preview and Azure's slider + confirm are the concrete patterns [F S24, S29].
- Retention after deal: Datasite sells "Archive" that preserves a full record at close [S S16]; FTC expects destruction rules set up front [F S17].

**Observed behaviours, by the sub-questions asked** (all from the table above)
- *Granularity:* switches sit at product-area level inside a container (Azure DevOps services per project [F S24]; GitLab project features [F S25]; Jira features per plan [F S27] and per team-managed project [S]), not per field or record. A middle state exists: GitLab "only project members", GitHub "Collaborators only" instead of off [F S25, S26].
- *Hide vs block:* vendors document the hide; blocking is rarely stated. GitLab is the only one that documents both the leak (analytics data still served by API) and the block (403 on repository endpoints) [F S25]; Azure DevOps and Google are silent on API effect [F S24, S28].
- *Data on disable:* retained and restorable in Azure DevOps, GitHub and GitLab; lost only for unsaved edits in Jira Releases and for Odoo uninstall [F]. Google's page does not say [F S28].
- *Dependencies:* cascade (GitLab, Odoo with preview), refuse (WordPress), fall back (Jira) — three different philosophies, each documented per product.
- *Role interplay:* the switch sits above role grants in AWS SCPs [F S32]; Google scopes by org unit or group *and* separately gates the admin privilege "Service Settings" [F S28]; Azure DevOps makes Project Administrators the only switchers [F S24].
- *Audit:* LaunchDarkly and Salesforce keep change history but with short windows (30 days lowest plan; ~180 days) [S]; Azure and Google pages say nothing on audit [F].
- *Switchboard UX:* single list with a per-row control (Azure slider + confirm; Google On/Off/some-units tri-state; Jira toggle per feature); the one blast-radius preview is Odoo's two-list pop-up [F].

---
## 6. Grounding in this repo (verified by me, deliberately shallow — code lanes own depth)
- [V] Sidebar "disable" today is client-side DOM removal: `public/js/transitions.js:2013-2045` (`applyMenuOverrides`, `if (hidden) { a.remove(); return; }`), driven by `/api/menus` items with `visible:false` or `roleScope` (`server.js:2063-2078`). No server module concept; `/api/menus` and `/api/pages` handlers contain no module check.
- [V] Static HTML pages are served by `express.static` before any gate (`server.js:175`); the only session/role gate is the consolidated `app.use('/api', …)` at `server.js:527`; reads are gated on session existence alone (comment `server.js:262-266`, D-05); writes use the prefix table `ROLE_WRITE_POLICY` (`server.js:296`).
- [V] A precedent for a prefix-table feature gate already exists: `DEMO_ONLY_PREFIXES` / `isDemoOnlyPath` (`server.js:478-491`) refuses showcase-only routes inside a real deal with a 403 ("This showcase-only feature is unavailable inside a real deal.") in that same gate, before the role check (`server.js:574`).
- [V] The `public/` tree has 20 top-level HTML pages (`ls public/*.html`) and the largest client files are `transitions.js` (3,972 lines), `employee.js`, `admin.js`; the registry in G2 would need to own all of them.

---
## 7. Implications for v3.0 (all inference, [I])

### 7.1 What the IL cockpit should answer in one screen
Ranked by how many source families support the question (evidence in 1.1):
1. **Are we on track for Day 1 / Day 100?** Readiness by workstream in tiers (workstream, end-to-end, final), explicit go/no-go state (no source defines the go/no-go mechanic; Deloitte describes none). Table stakes.
2. **What is late or slipping against baseline?** Baseline vs forecast vs actual milestones, overdue, due in 7 days, critical path. Table stakes.
3. **Are we capturing the promised value, and leaking any?** Synergy pipeline by stage, run-rate vs plan, cost-to-achieve, owner, "finance-validated" marker, plus customer-loss / dis-synergy signals. Table stakes for the first half; finance reconciliation, cost-to-achieve and dis-synergies are the differentiators.
4. **What needs my decision or escalation this week?** Open RAID items by owner and age, decisions awaiting SteerCo, stale items (no owner/review date). Table stakes.
5. **Are the people we must keep staying?** Named critical-talent coverage, retention-offer status, flight-risk movement. Differentiator versus PMI tools (none of the dashboards I read has it); per project memory the app already has it (Phase 6), so the job is to surface it in the cockpit, not build it.
6. **Who can see what, and has any wall been crossed?** Clearance ledger (who, why, since when) and denied-access events; exportable in insider-list shape (identity, reason, granted date/time, revoked date/time). Differentiator; EY makes it an IL duty.
7. **What changed since the last SteerCo?** Delta view plus a one-click pack. Table stakes (pack), differentiator (delta).
8. **What is switched off or unmanaged?** Disabled modules and un-owned areas shown explicitly, never as zero or green (7.2 G8).
Also: do not hard-stop at Day 100 (BCG tracks monthly for 2–3 years); a "Day-100 handover to business-as-usual" state is the minimal bridge. RAG needs written, objective criteria per tile (1.3) or it will drift into watermelon reporting.

### 7.2 What the module switch must guarantee
- **G1 Server-side, all methods, reads included, pages included.** Disabled = refused in the single consolidated gate (mirror `DEMO_ONLY_PREFIXES`), plus the static HTML. Hiding the sidebar link is cosmetic. (ASVS 8.3.1; GitLab analytics-via-API; API5/API9; repo 6.)
- **G2 One registry, self-enforcing coverage.** Module = id, label, API prefixes, page files, owned collections, dependencies, reversible flag, "core" flag. A test fails when any `/api` route or `public/*.html` is unowned (OWASP inventory; the project's own coverage-gate precedent in memory, not re-verified).
- **G3 Disable is reversible and never deletes.** Data intact, grants intact, re-enable restores exactly (Azure DevOps, GitHub). Removal/destruction is a separate, audited, previewed action, probably out of scope for v3.0 (Odoo, FTC destruction rules).
- **G4 Dependencies are declared and either cascade-with-preview or refuse-with-reason**, never silent partial states (GitLab, Odoo, WordPress). The switch must also close derived surfaces: exports and PDF pack sections, roll-ups, search, quick-nav, chatbot/RAG ingestion, banners, notifications.
- **G5 The switch is a ceiling above role and clearance** (AWS SCP model): no role, including admin, and no clearance can use a disabled module; only the switchboard and an explicit audited export path remain.
- **G6 Scope decided up front.** Evidence favours the container as scope (project, repository, plan) with an org-level ceiling (Google OU/group). Here: instance level (admin) versus per-deal (IL; the app already has one database per deal). Needs a user decision. Switch *product areas* (lifecycle-stage modules); keep *functions/workstreams* as data and clearance scope, as the market does.
- **G7 Audit the change and the denials.** Who, when, scope, before/after, reason, optional second approver for MNPI modules, in the append-only audit trail; log attempts against disabled modules (ASVS 16.3.2, 16.2.1; LaunchDarkly approvals). Keep retention longer than vendor norms (Salesforce 180 days).
- **G8 Honest cockpit.** A disabled or empty module renders "switched off" or "no data", never 0 risks = green.
- **G9 Deterministic error contract.** Distinct machine-readable marker (e.g. `module_disabled`) with fixed status, never auto-retried (`server.js:370-379` already builds 409 bodies with a `conflict: true` marker so the client never keys on status alone [V]), so open tabs and in-flight forms fail with a clear message; stale client state may be cosmetic but never grants access (Google up to 24 h).
- **G10 Consequence-stating confirmation and reversible/irreversible metadata** (SAP reversibility flag, Odoo preview): show affected pages, routes, record counts, dependents and exports before confirming.
- **G11 Tested presets, not 2^N.** Name a few configurations (full, DD-only, demo, minimum) and test those plus all-on (Fowler).
- **G12 Deny by default for new modules** shipped in an upgrade; existing modules keep current state so upgrades do not change behaviour silently.

### 7.3 Minimum production bar implied by the norms (for the code lanes to test against)
- Target ASVS 5.0 **Level 2** across V6, V7, V8, V14, V16 (L2 is the "standard" level [S]); pull in selected L3 items because the data is MNPI: 8.3.2 (authorization changes apply immediately, which is exactly the module-switch requirement), 14.2.7 (scheduled deletion), 16.3.2 at L3 (log all authorization decisions on sensitive data).
- ASVS makes several things *documentation* requirements (7.1.1 timeouts, 14.1.2 protection levels, 15.1.1 remediation timeframes, 6.1.1 anti-automation): a short security-decisions document is itself part of the bar.
- MFA is an L2 line item (6.3.3 "MFA or a combination of single-factor mechanisms"); with no SSO this milestone, the combination clause is the only non-MFA route and needs a written justification.
- Backups: automated, consistent (not a raw copy of a live WAL database), restored in a drill, with RPO/RTO written down (CIS 11.2/11.5, ISO 8.13, SQLite docs). Change control: ISO 8.32 vocabulary (impact, authorisation, test in separate environment, rollback, record) mapped onto the existing release process.

### 7.4 Decisions to put to the user
1. Switch scope: instance-wide (admin) only, or also per deal (IL)? 2. Granularity: coarse product areas (DD, Execution, Org/Talent, Reports, Training/Assessment, Insights) or finer? 3. Is "disable" enough for v3.0 or is destructive removal wanted? 4. Does the IL get a read-only "what is switched off" view and can they request a switch?

---
## 8. Not covered / weakly supported
McKinsey first-hand text (timeouts); Big-4 daily-cadence norms; GDPR/works-council treatment of named-employee data; which insider-list regime binds TE; vendor admin-console docs for Midaxo (not public); API behaviour of Azure DevOps/GitHub on disabled services; any quantified availability norm.

---
## Sources
S1 EY-Parthenon, Nine steps to setting up an M&A integration program, 15 Jan 2025 — https://www.ey.com/en_us/insights/mergers-acquisitions/nine-steps-to-setting-up-an-m-a-integration-program
S2 Deloitte US, Day One readiness checklist (undated) — https://www.deloitte.com/us/en/services/consulting/articles/mergers-acquisitions-integration-plan-checklist.html
S3 BCG, Capturing Value from Synergy in PMI, 26 Nov 2025 — https://www.bcg.com/publications/2025/value-from-synergy-pmi-four-essential-steps
S4 LEK, Achieving synergies post-merger — https://www.lek.com/insights/ei/achieving-synergies-post-merger
S5 MergerIntegration.com (Pritchett), synergy realization — https://www.mergerintegration.com/synergy-realization-best-practices
S6 MergerIntegration.com, weekly PMI process — https://www.mergerintegration.com/merger-integration-management-process
S7 McKinsey [S only]: https://www.mckinsey.com/capabilities/m-and-a/our-insights/post-close-excellence-in-large-deal-m-and-a ; 2010 IMO paper https://www.mckinsey.com/~/media/McKinsey/Business%20Functions/Organization/Our%20Insights/Merger%20Manager%20Compendium/A%20McKinsey%20perspective%20on%20organizing%20integrations%20to%20create%20value.pdf
S8 Devensoft Program Dashboard — https://support.devensoft.com/knowledge/program-dashboard-overview
S9 Devensoft basics / admin guide — https://support.devensoft.com/knowledge/basics-of-devensoft-ma , https://support.devensoft.com/knowledge/administrators-guide
S10 DealRoom Progress Dashboard — https://support.dealroom.net/en/articles/13401449-overview-of-progress-dashboard
S11 DealRoom Permissions tab — https://support.dealroom.net/en/articles/13216064-overview-of-the-permissions-tab
S12 DealRoom, leveraging for integration — https://support.dealroom.net/en/articles/13216601-leveraging-dealroom-for-integration
S13 Midaxo — https://www.midaxo.com/platform/post-merger-integration , https://midaxo.com/platform , https://www.midaxo.com/whos-it-for/team/it-compliance , https://www.midaxo.com/resources/glossary/raid-log
S14 Smartsheet M&A templates — https://www.smartsheet.com/merger-and-acquisition-templates
S15 Ansarada PMI page [S] — https://www.ansarada.com/deals/post-merger-integration
S16 Datasite products — https://www.datasite.com/en/products/diligence ; Ansarada/Datasite deal — https://www.allens.com.au/insights-news/news/2024/02/allens-advises-capvest-portfolio-company-datasite-on-proposed-acquisition-of-ansarada-group/
S17 FTC Competition Matters, 20 Mar 2018 — https://www.ftc.gov/enforcement/competition-matters/2018/03/avoiding-antitrust-pitfalls-during-pre-merger-negotiations-due-diligence
S18 FTC press release, 7 Jan 2025 — https://www.ftc.gov/news-events/news/press-releases/2025/01/oil-companies-pay-record-ftc-gun-jumping-fine-antitrust-law-violation
S19 Regulation (EU) 596/2014 Art. 18 — https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32014R0596
S20 OWASP ASVS 5.0.0 — https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/en (V6 0x15, V7 0x16, V8 0x17, V12 0x21, V13 0x22, V14 0x23, V15 0x24, V16 0x25)
S21 NIST SP 800-63B-4 — https://pages.nist.gov/800-63-4/sp800-63b/aal/ , https://pages.nist.gov/800-63-4/sp800-63b/session/
S22 ISO 27001:2022 Annex A titles — https://hightable.io/iso-27001-annex-a-controls-list/ ; explainers https://www.isms.online/iso-27001/annex-a-2022/8-13-information-backup-2022/ , https://www.isms.online/iso-27001/annex-a-2022/8-32-change-management-2022/
S23 CIS Controls v8 — https://opensecurityarchitecture.org/frameworks/cis-controls-v8/controls
S24 Azure DevOps — https://learn.microsoft.com/en-us/azure/devops/organizations/settings/set-services?view=azure-devops
S25 GitLab — https://docs.gitlab.com/ee/user/project/settings/ , https://gitlab.com/gitlab-org/gitlab/-/issues/29576
S26 GitHub — https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-issues
S27 Atlassian — https://support.atlassian.com/jira-software-cloud/docs/turn-releases-in-your-plan-on-or-off/
S28 Google Workspace — https://knowledge.workspace.google.com/admin/users/advanced/turn-a-service-on-or-off-for-google-workspace-users
S29 Odoo 18 — https://www.odoo.com/documentation/18.0/applications/general/apps_modules.html
S30 WordPress — https://make.wordpress.org/core/2022/02/24/feature-project-plugin-dependencies/
S31 SAP — https://blogs.sap.com/?p=45473
S32 AWS — https://docs.aws.amazon.com/prescriptive-guidance/latest/security-reference-architecture/organizations-security.html
S33 Hodgson on martinfowler.com — https://martinfowler.com/articles/feature-toggles.html
S34 LaunchDarkly — https://launchdarkly.com/docs/home/releases/change-history , https://launchdarkly.com/docs/home/releases/approval-reviews
S35 Salesforce Setup Audit Trail (third-party summary) — https://gearset.com/blog/salesforce-audit-trail/
S36 OWASP API Security 2023 — https://api-security.owasp.org/editions/2023/en/0xa5-broken-function-level-authorization , https://api-security.owasp.org/editions/2023/en/0xa9-improper-inventory-management
S37 Primer confirmation-dialog guidelines (secondary for NN/g) — https://primer.style/product/components/confirmation-dialog/guidelines
S38 HBR, Ashkenas & Francis, Nov 2000 (abstract) — https://store.hbr.org/product/integration-managers-special-leaders-for-special-times/R00604
S39 UK delivery-confidence guide (older, withdrawn listing) — https://www.gov.uk/government/publications/guide-on-delivery-confidence-assessment
S40 Watermelon reporting commentary — https://eleco.com/pm3/knowledge-centre/is-your-project-a-watermelon-project-or-a-kiwi-fruit/
S41 FCA PMB 54 summary — https://www.bclplaw.com/en-US/events-insights-news/fca-primary-market-bulletin-no54-on-unlawful-disclosure-of-inside-information.html
S42 Mutomorro IMO governance (boutique) — https://mutomorro.com/services/post-merger-integration-consultancy/integration-delivery-programme
S43 SEC OCIE MNPI controls summary — https://corpgov.law.harvard.edu/?p=34563
S44 Deloitte NL, Delivering the promised returns: PMI, 6 Nov 2025 — https://www.deloitte.com/nl/en/Industries/tmt/perspectives/post-merger-integration.html
S45 SQLite, How To Corrupt An SQLite Database File — https://www.sqlite.org/howtocorrupt.html
