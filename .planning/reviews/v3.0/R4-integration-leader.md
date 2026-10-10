# R4 — The Integration Leader's journey (key-focus persona)

Lane R4 of the v3.0 production-readiness review. Written 2026-10-10 against `main` @ `56ca821`.
Persona: role `hrbp`, UI label "Integration Leader", committed account `karen`.
Method: isolated server on :4314 (temp copies of `demo.db`/`control.db`, fail-closed, no `DEMO_OPEN`);
one real deal ("Project Falcon", EUR 180M, Day 1 = 2026-12-01) created and driven end-to-end as
`karen` through the API (`walk.js`, `walk2.js`, `walk3.js` in the lane scratch dir); a second
`admin` session for the membership and stale-edit tests; a `pmo` member session for the
workstream-lead view; Playwright screenshots at 1440/768/390 in EN and DE
(`shot-*.png`, `shot2-*.png` in the scratch dir). Every claim below is **VERIFIED** unless marked
**SUSPECTED**. Severity is judged for "an IL running a real MNPI deal on a shared host".

## 0. Verdict in five lines

1. The deal-running machinery exists and works end-to-end: wizard → 30 checklist tasks + 80 DD
   requests → finding → Day-1 task + RAID (linked, de-duplicated) → synergy → org/retention →
   CSV + 539 KB German steerco PDF → cross-session 409 with attribution. Nothing lost, nothing crashed.
2. But the IL is not the *product's* persona yet: after login she lands on the executive slide deck,
   her sidebar is 70 % demo showcase, and the one deal-aware surface (`#deal-home` on
   dashboard.html) answers "how is setup / DD / org" but not "is this deal healthy and what needs me
   today" — it has no tasks, RAID, synergy numbers, timeline or "what changed".
3. Two "attention" signals are wrong in a real deal: overdue-task notifications run on the **demo
   clock** (frozen at 2026-05-30 for "Day 30"), and `critical` RAID entries never trigger the
   high-severity nudge.
4. The first thing a real IL would do after loading the checklist — assign owners and due dates to
   30 seeded tasks — **cannot be done in the UI** (the hub only cycles status and deletes).
   That alone forces the parallel spreadsheet the core value promises to remove.
5. Demo chrome leaks into the real deal in ways that damage credibility with a senior IL: a
   fabricated "Active Mission … Bulk legacy cohort database roster migration — Due in 4 days"
   banner above her real deal, a "Day 30" badge on a pre-close deal, "$" on a EUR deal, "NextGen"
   process-catalog rows seeded into every new deal.

## 1. Map — what the IL lands on, owns, and sees

| Surface | Fact | Evidence |
|---|---|---|
| Post-login landing | `/` serves `overview.html`, the "M&A HR Integration Enablement" slide deck; "Enter the Portal →" goes to the role showcase `index.html`. No deal-aware landing exists. | `server.js:164-171`, `public/overview.html:63`, `public/login.html:62` |
| IL sidebar (real mode) | Overview · Role Showcase · M&A Insights · Assessments · Execution Hub · Survey · Portals→"Leader Dashboard — Integration Leader Metrics & Sentiment" · Resources (Capability Hub, Integration Excellence, Playbook, Lessons Learned) · Slides (Ask 1, Ask 2) · Admin Console · ⭐ "The Best" easter egg · Logout | `transitions.js:1414,1421,1426-1431,1469-1502`; live DOM dump: `🏠 Overview | 🚪 Role Showcase | 📈 M&A Insights | 🎯 Assessments | ✅ Execution Hub | 📋 Survey | 📊 Leader Dashboard | 🧠 Capability Hub | 🌟 Integration Excellence | 📖 Integration Playbook | 💡 Lessons Learned | 🙋Ask 1 | 🙋Ask 2 | ⚙️ Admin Console | ⭐ The Best` |
| Not in the sidebar | **Due Diligence, Org Design, Deal Wizard.** DD/Org are reachable only via rows/links inside the dashboard deal-home panels; the wizard only via the header deal-switcher "+ New real deal" or admin Deals tab. | `deal-home.js:166,224`; `deal-switcher.js:104-107`; `admin.js:2572`; grep over all html/js finds no other inbound link |
| Header chrome (real mode) | "🧬 HR Module / 🔒 Finance Module / 🔒 Sales Module" tab bar; "Day 30" time-travel badge; "Role: Integration Leader" demo role switcher; language select; three device-preview toggles; "✏️ Edit Content" CMS pill; "REAL DEAL Project Falcon" chip (the only deal-aware element). | `transitions.js:1340,1739,1764-1775,2239`; screenshots `shot-en-*-1440.png` |
| What the IL may write (server-enforced) | Deals (create/select/setup/grants), DD, tasks, RAID, synergies, employees, org positions/flight-risk/decisions, assessments — all 2xx in the walk. **Not**: deal membership (`403 Only admin can manage deal membership.`), admin audit (`403`), `/api/admin/*`. hrbp also holds write ACL on menus/pages (CMS). | `server.js:296-342` (ROLE_WRITE_POLICY), `server.js:975`, `server.js:1957` comment; walk steps 5, 5b, 17 |
| Admin Console as IL | Page is allowed for hrbp (D-02) but the client derives the role from the **path** before the auth handshake, so the IL is painted as "IMO · System Admin", gets the admin role select and admin-only portal links (Employee/Leaders/PMO/Supporting) she will be bounced from; default tab is the demo "M&A Projects" with a DEMO badge; the real-deal "Deals" tab is one of 17. | `transitions.js:680-686,750-754,697`; `shot-en-admin-1440.png` |
| Deal-home (the only deal-bound IL surface) | Four panels: Setup checklist, Readiness assessments, Diligence progress, Organisation; plus two conditional nudges (my stale synergies, my unmitigated flight risks). Fetches `/api/deals`, `/api/assessment-status`, `/api/dd/summary`, `/api/synergies/rollup`, `/api/org/summary`. **No tasks, no RAID, no synergy tiles, no timeline, no activity ("D-20: deliberately NO activity feed").** | `deal-home.js:14-26,438-442,319-321,380-385`; `dashboard.js:17-38`; `shot-en-dashboard-1440.png` |
| Demo vs tool share of what the IL sees | Of 16 sidebar entries, 4 are the deal tool (Assessments, Execution Hub, Leader Dashboard, Admin Console→Deals). Of the 13 dashboard tabs (KPIs, Roadmap, Onboarding, Welcome Kit, Change, Coach, Culture Ways, IL Academy, HR Modules, Academy, Teams, Communication, Process Integration) none is shown in real mode — correctly hidden by `dashboard.js:23`. | `dashboard.html:122-199` |

## 2. The journey, step by step (real-deal mode, as `karen`)

| # | Step | Result | Friction / finding (severity) |
|---|---|---|---|
| 1 | Login | 200; lands on slide deck; deal chip says "Demo" until a deal is selected. `POST /api/deals` does **not** bind the session (`dealId:null` after create; the wizard calls select client-side). | No "your deal" entry point; Day badge already reads "Day 30". (HIGH, see F1/F4) |
| 2 | Wizard, 7 steps | All setup steps 200; "Setup checklist" shows 6× DONE. Members are a comma-separated username textbox (`deal-wizard.js:312`), no picker. | EN-only (0 `data-i18n` in `deal-wizard.html`); at 390 px four elements overflow and the intro text is clipped ("…the new deal. Eve"). (LOW) |
| 3 | Assign people | IL **cannot** change membership after creation: `POST /api/deals/:id/members → 403` (`server.js:975`); wizard copy admits "membership edits live in the admin console, not this wizard" (`deal-wizard.js:701`). IL **can** grant DD areas (`POST …/grants → 200`). | Asymmetric: the IL clears people she cannot invite. Planned for Phase 12, but today it blocks onboarding a workstream lead without an admin. (MEDIUM) |
| 4 | Load checklist | `POST /api/integration-tasks/instantiate → created:30`; **all 30 have `owner:""` and `due:""`**. | No UI to set owner/due/phase on an existing task: `execution.js:117-243` renders status-cycle + ✕ only; owner/due inputs exist only on the *add* form (`:255-276`). Due dates are not derived from `day1Date`/timeline. **Spreadsheet fallback #1.** (HIGH) |
| 5 | DD requests | `instantiate → created:80`; manual item with `dueDate:2026-10-01` returns `overdue:true` (server-computed, wall clock, `server.js:5389`). Nudge banner: "You have 2 open due-diligence items assigned to you, 1 overdue." | Page is one 13,363-px list (81 rows, each with status/date/owner/blocked + a 3-field data-room form + "Save data room link"); no filter by area/status/owner/overdue/mine, no collapse, no bulk update. (MEDIUM) |
| 6 | Finding → Day-1 task + RAID | `POST /api/dd/findings/:id/convert {toTask,toRaid}` → task in `ws_hr`/`day1` (owner copied, `due:""`), RAID `risk`/`critical`; `linkedTaskIds`/`linkedRaidIds` stored; re-click is a no-op by `source` (`server.js:5823-5890`). | Hub shows no provenance for `dd-finding:` tasks — only `remediation:` sources get a chip (`execution.js:169,177`). (LOW) |
| 7 | Overdue task | Owner/due set via API (`due:2026-10-01`, 9 days overdue). Hub renders "📅 2026-10-01" with **no overdue styling**; `/api/notifications` lists only 3 `assessment_pending` items. | `portalNowMs()` returns the demo arc date (`2026-05-01 + 29 d`) whenever `settings.demoMode !== false` — a real deal's settings are `{dealId,name,targetCompany,createdAt}` so **"now" = 2026-05-30** (`server.js:6006-6014`, walk 16c); and `raid_high` filters `severity === 'high'` so `critical` never counts (`server.js:6046`). Two clocks: DD uses wall time, tasks use the demo arc. (HIGH) |
| 8 | Synergy + phasing | Create 201 (`stage:idea`); `generate-phasing` needs `runRateM` (400 until set — the expanded card collects it); stage change uses `targetStage` (validated enum idea/validated/committed/captured). Tracker tiles render. | "$0.0M … DEAL TARGET $4.5M" on a **EUR** deal: `$` is a literal in `execution.js:557,618,705-717` and in export headers `Target ($M)` (`server.js:6153-6165`); `deal.currency` is never read. "Deal target" is the sum of initiatives, not a deal-level target (no such field). (MEDIUM) |
| 9 | Org + retention | Positions (current/target), roster paste-import (CSV/JSON), flight risk (high, mitigation text), `retain` decision with `decidedBy/decidedAt`. `/api/org/summary` two-tier rollup correct. | Best-designed IL module. No retention terms/amount fields on flight-risk (`validators/org.js:168-178`) — SUSPECTED a retention-bonus list still lives in a spreadsheet. In DE the panel is half-translated (see §4). |
| 10 | RAID | Manual `risk/high` 201; filters All/Risk/Issue/Decision/Dependency; status pill cycles. | No due/review date, no `decidedBy/decidedAt` for type `decision` (`validators/workstream.js:350-362`) → there is no deal decision log beyond org decisions. (MEDIUM) |
| 11 | Reports | CSV/JSON for workstreams/tasks/RAID/synergies (BOM, quoted); `GET /api/reports/pack?lang=de` → 200 `application/pdf`, 539 KB. | Pack = "one-page executive summary, then a section each for workstreams and tasks, risks and decisions, and synergies" (`execution.html` copy; column sets `server.js:6104-6170`). **No DD status, no org/retention (by design D-23), no timeline/Day-1 readiness.** For a pre-close deal the steerco pack has nothing to say. (MEDIUM) |
| 12 | Conflicting edit | admin joins + edits RAID → karen's stale save → `409 {conflict:true, conflictKind:"version", changedBy:"admin", changedAt, currentRecord}`; same on the converted task. | Sound. (Dialog itself was Phase-9 UAT'd; not re-walked in a browser here.) |
| 13 | Assessments | IL completes "Integration Leader Readiness" → `assessment-status.satisfied:true`, bell drops to 2. But `GET /api/assessment-instances` → `401 Admin authentication required to list assessment records.` for hrbp in fail-closed mode (`server.js:2916-2918`); the page falls back to the status rollup "no trend" (`assessments.js:101-112`) and logs 9 red 401s per load. | The IL never sees her own records/trend; console noise. (MEDIUM) |
| 14 | 390 px | No horizontal scroll on any page (measured), but the header stack (module tabs, logo, chip, avatar, Day badge, role select, language, device toggles, Edit Content, deal chip) consumes ~470 of 844 px before content on **every** page. | Mostly demo chrome. (MEDIUM for a mobile-first-100-days IL) |
| 15 | Workstream lead (`pmo`, cleared hr+it) | Sees 21/81 DD items (hr, it only), all 32 tasks incl. the HR-cleared converted task, both RAID rows, org summary; cannot create deals (403). | Task/RAID lanes are not clearance-filtered for a cleared member — consistent with Phase-9 design; noted for the module-switch lane, not a defect. |

## 3. Cross-module coherence

**Data flow — does it flow?**
- DD finding → task + RAID: yes, linked both ways (`linkedTaskIds`, `linkedRaidIds`, `source`). ✔
- Flight risk → task/RAID: route exists (`server.js:5176`). ✔ Assessment gaps → tasks (`from-remediation`). ✔
- Synergy ↔ tasks: `taskIds` field exists; card says "No tasks linked yet." ✔ (link UI not exercised — SUSPECTED present in `buildSynDetail`)
- Tasks/RAID/synergies → CSV/pack: ✔. DD → pack: ✘. Org → pack: ✘ (by design). Wizard timeline markers → anything: ✘ (nothing reads `setup.timeline`, `signingDate`, `expectedClose`, `day1Date` after the wizard).

**One place for "is this deal healthy and what needs me today?"** — **No.** Deal-home has setup/assessments/DD/org; the hub has execution/value/RAID; the bell has assessment nags plus two broken nudges. An IL needs three pages and still gets no task/RAID numbers on the home.

**What changed since I last looked?** — Nothing. D-20 forbids an activity feed on deal-home; the audit log is admin-only (`/api/admin/audit → 403` for hrbp). Raw material exists: Phase 9 stamps `version/updatedAt/updatedBy` lazily on every edited record.

**Overdue / at-risk surfacing** — DD: yes (server, wall clock). Tasks: not in the UI; notification uses the demo clock (F2). RAID: no dates at all. Synergies: `staleCount` nudge (works).

**Decision log** — only org decisions (attributed, append-only). RAID `decision` entries carry no decider/date. No deal-level log an IL can hand to a steerco.

**Day-1 readiness** — no concept. The 9 Day-1 tasks sit in a phase bucket; assessment gates (`pmo.gate.day1`) surface on the PMO page, not for the IL.

**100-day position** — none. The only "Day N" is `settings.timeTravelDay || 30` (`transitions.js:2239`), i.e. a demo constant; for Project Falcon (Day 1 in 52 days) it shows "Day 30".

**Where a real IL falls back to a spreadsheet (specific):**
1. Owner/due assignment and re-planning of the 30+ template tasks (no edit UI).
2. Workstream status report: lead, RAG, next milestone, blockers — export has `pctComplete/blocked/ragStatus` but no lead/milestone.
3. DD tracker at 80+ items: filtering, "mine", bulk status, per-item VDR folder tracking.
4. Decision log with decider/date/rationale.
5. Retention list with terms/amounts.
6. Milestone plan: signing → close → Day 1 → Day 100 with dates and countdown.
7. Synergy figures in the deal currency with a deal-level target.
8. The pre-close steerco deck (DD status is not in the pack).

## 4. Demo/real parity risks (evidence)

| # | Leak / risk | Evidence | Sev |
|---|---|---|---|
| P1 | Fabricated demo banners above the real deal: "AI INSIGHT DYNAMIC PMI INSIGHT · RAG CORE … legacy APAC/EMEA employees…" and "PORTRAYING ROLE Integration Leader — Active Mission: Manage employee sentiment, run bulk database cohort mappings… NEXT ACTION · PENDING UPLOAD · Bulk legacy cohort database roster migration · Due in 4 days" | `transitions.js:3278-3279,3480,3729-3733`; `shot-en-dashboard-1440.png` | HIGH (credibility; reads as real work) |
| P2 | "Activate AI Insight AI Brain / TEodor the Duck Coach" modal interrupts the dashboard | `transitions.js:2534-2580`; `shot2-de-dashboard-1440.png` | MEDIUM |
| P3 | "Day 30" badge + time-travel dropdown on a pre-close deal; POST is correctly demo-only (`DEMO_ONLY_PREFIXES`, `server.js:479`) but the UI still offers it | `transitions.js:2239` | MEDIUM |
| P4 | Demo role switcher in header; picking another role bounces to `/` with "🔒 Access Denied… (HRBP)" | `transitions.js:1739,740-741` | LOW |
| P5 | Every new deal is seeded with the demo `processCatalog` (10 rows: "Order-to-Cash … owner: NextGen Sales Operations … Legacy ERP (Sage)") | `db/dealSeed.js` `DEAL_SEED_COLLECTIONS`; `GET /api/processes` in deal ctx returns them (walk2 m); visible via Admin→Processes (SUSPECTED) | LOW |
| P6 | `GET /api/assessment/latest` returns `id:"mock_assess"` inside a real deal | walk3 | LOW (no real-mode consumer found) |
| P7 | Sidebar/landing demo content in real mode: Overview deck, Role Showcase, M&A Insights (3× "NextGen"), Survey, Capability Hub, Integration Excellence, Slides, easter egg | `transitions.js:1469-1502`; `insights.html` | MEDIUM |
| P8 | Mixed language: DD, Org, Wizard, deal-home, conflict dialog have **0** i18n keys (EN by Ph8/9 precedent) while the shell is translated → DE org panel reads "Current headcount … Halten / Versetzen / Im Auswahlverfahren / Freigesetzt / Offen … Unmitigated high/critical flight risks" | i18n store: `dd=0, org=7, deal=0, wizard=0, conflict=0` keys of 1,076; `shot2-de-dashboard-1440.png` | LOW–MEDIUM |
| P9 | Empty real-deal states are honest, not broken ("No readiness assessments assigned yet.", "No positions mapped yet — see the Org page", "No tasks in this phase.") | `deal-home.js:139,157,225`; `execution.js:185` | — (sound) |

## 5. Proposal — the IL Cockpit

Information architecture for the IL's home, in the order a time-poor IL asks the questions.
"Exists" = endpoint verified live in this lane; "wire" = render existing data; "new" = needs data/endpoint.

| Pri | The cockpit answers… | Data | Status |
|---|---|---|---|
| 1 | **Where are we?** Phase (pre-signing / pre-close / Day 1 / 100 days), T-minus to Day 1, Day N of 100, next milestone | `GET /api/deals` → `signingDate, expectedClose, day1Date, setup.timeline` (exists) | wire + small derived `phase` (client or `/api/deals`) |
| 2 | **What needs me today?** overdue DD items (mine), overdue/blocked/unassigned tasks (mine + all), open critical/high RAID, stale synergies, unmitigated flight risks, required assessments | `/api/dd/summary.mine` (exists), `/api/notifications` (exists, **fix clock + critical**), `/api/synergies/rollup.mine.staleCount`, `/api/org/summary.restricted.mine`, `/api/assessment-status` (all exist) | wire; new: tasks-by-owner overdue/unassigned counts (computable from `/api/integration-tasks` once the clock is real) |
| 3 | **Is execution on track?** per-workstream RAG, % done, blocked, lead | `GET /api/reports/export?dataset=workstreams&format=json` → `pctComplete, blocked, ragStatus` (exists) | wire; new: workstream lead/owner field (checklist template `workstreams[]` or `deal.setup.scope`) and milestone |
| 4 | **Are we Day-1 ready?** pre+day1 tasks done/total, blocked, open critical DD findings, Day-1 gates | tasks (exists), `/api/dd/summary` findings (exists), `assessment-status.gates` (exists) | wire; new: explicit go/no-go flag per Day-1 item (optional) |
| 5 | **Diligence status** (pre-close only) | `/api/dd/summary` (exists, already on deal-home) | keep; hide post-close |
| 6 | **Value capture** gross/realized/net vs target | `/api/synergies/rollup` (exists; only nudges are drawn today) | wire tiles; new: `deal.currency` honoured + `synergyTargetM` on the deal |
| 7 | **People & retention** headcount delta, decisions, unmitigated risks | `/api/org/summary` (exists, on deal-home) | keep |
| 8 | **Risks & decisions** open high/critical, oldest open, decisions this week | `/api/raid` (exists) | wire; new: `dueDate`, `decidedBy/decidedAt` on RAID decisions |
| 9 | **What changed since my last visit** | records' `updatedAt/updatedBy` (exist, lazily stamped) | new: per-user `lastSeenAt` + a deal-scoped change list — needs a policy decision against D-20 (recommend: changes to records *I own or am cleared for*, never the admin audit) |
| 10 | **Team & access** members, DD clearances, VDR grants | `/api/deals/:id/grants` (exists) | wire; membership edit = Phase 12 |

**What the IL must NOT see in real-deal mode:** the overview deck as landing, Role Showcase,
M&A Insights radar, Survey, Capability Hub, Integration Excellence, Slides, easter egg, HR/Finance/
Sales module tabs, Day badge/time-travel, role switcher, device-preview toggles, "Edit Content",
gamification/XP, TEd/AI-brain modal, the "Portraying role / Active Mission" banner, the demo
"M&A Projects" admin tab, and an admin identity on admin.html.

**Gaps ranked by "would force a spreadsheet":** (1) task owner/due editing, (2) workstream lead +
RAG with milestone, (3) real clock + critical in attention signals, (4) timeline position,
(5) DD filters/bulk, (6) decision log, (7) deal currency, (8) changed-since, (9) DD in the pack.

## 6. What the IL needs from admin controls (input to the module-switch lane)

Modules a TE IMO would plausibly switch off **per deal**, and why:
- **Demo showcase cluster** (overview deck, role showcase, insights/radar, survey, capability hub,
  integration excellence, slides, easter egg, gamification/XP, TEd chatbot + AI-brain modal,
  time-travel, device toggles, role switcher) — off for every real deal; one switch, not twelve.
- **Employee portal / Academy / Welcome kit / Communications desk** — off pre-close: there are no
  acquired employees as users before announcement (MNPI), and welcome content is wrong pre-Day-1.
- **Org Design & Talent** — off until HR clean-room clearance exists, or for JV deal types.
- **Synergy tracker** — off for tuck-ins tracked in Finance's tool, or until post-signing.
- **Due Diligence** — read-only/archived post-close.
- **Process Integration catalog** — off unless ops integration is in scope (and never seeded with NextGen rows).
- **Required assessments** — the three "Required" gates nag every IL (bell = 3 on day one); per-deal optional.
- **Exports / steerco pack** — restrictable per deal (MNPI egress).
- Existing knobs are global and sidebar-level only: `settings.roleVisibility` (hides portal links,
  `transitions.js:2139-2146`), `floatingMenuEnabled`, `doomGloballyEnabled`, `browserModel`,
  menu overrides (`applyMenuOverrides`, `:2013`). hrbp holds write ACL on menus/pages, so today an
  IL could *change* the nav. Module switches must be **per deal, admin-only, enforced at the route**
  (403 on the module's `/api` prefix), with the sidebar merely reflecting the server's answer.

## Findings register (severity · status)

| ID | Finding | Where | Sev |
|---|---|---|---|
| F1 | No deal-aware landing/cockpit; IL lands on the demo deck; deal-home lacks tasks/RAID/value/timeline | `server.js:168`, `deal-home.js:438-442` | HIGH · VERIFIED |
| F2 | Attention signals wrong in real deals: demo clock for overdue tasks; `critical` RAID never flagged | `server.js:6006-6014,6044-6046` | HIGH · VERIFIED |
| F3 | No UI to set owner/due/phase on existing tasks; 30 seeded tasks arrive unassigned | `execution.js:117-243,255-276` | HIGH · VERIFIED |
| F4 | Fabricated demo banners ("Active Mission… Due in 4 days", "AI Insight… RAG Core") over the real deal | `transitions.js:3278,3480,3729-3733` | HIGH · VERIFIED |
| F5 | IL cannot add/remove members (403) though she grants clearances | `server.js:975`, `deal-wizard.js:701` | MEDIUM · VERIFIED (Ph12 planned) |
| F6 | `$` hard-coded in synergy UI, CSV headers and pack; `deal.currency` unused; "Deal target" = Σ initiatives | `execution.js:557-717`, `server.js:6153-6165` | MEDIUM · VERIFIED |
| F7 | Timeline markers unused; "Day 30" demo badge on a pre-close deal; task dues not derived from Day 1 | `transitions.js:2239` | MEDIUM · VERIFIED |
| F8 | No decision log: RAID decisions lack decider/date; no review dates | `validators/workstream.js:350-362` | MEDIUM · VERIFIED |
| F9 | DD workspace is a 13 k-px unfiltered list at 81 items | `shot-en-dd-1440.png` | MEDIUM · VERIFIED |
| F10 | `GET /api/assessment-instances` 401 for IL in fail-closed mode; 9 console errors; no own-record view | `server.js:2916-2918`, `assessments.js:101-112` | MEDIUM · VERIFIED |
| F11 | Steerco pack/exports omit DD, org, timeline | `execution.html` copy, `server.js:6104-6170` | MEDIUM · VERIFIED |
| F12 | No "changed since I last looked"; audit is admin-only | D-20, `server.js:1233` | MEDIUM · VERIFIED (design) |
| F13 | 390 px header stack ≈ 470 px of chrome before content; wizard overflow at 390 | `shot-en-*-390.png` | MEDIUM · VERIFIED |
| F14 | admin.html paints the IL as "IMO · System Admin" with admin nav | `transitions.js:680-686` | LOW · VERIFIED |
| F15 | EN-only real-deal pages → mixed-language screens in DE/ZH/CS | i18n key counts | LOW · VERIFIED |
| F16 | Demo `processCatalog` (NextGen) seeded into every real deal | `db/dealSeed.js` | LOW · VERIFIED |
| F17 | DD-finding tasks show no provenance in the hub | `execution.js:169` | LOW · VERIFIED |
| F18 | "Edit Content" CMS pill + menu/page write ACL for hrbp in real mode | `transitions.js:1764`, `:1957` | LOW · VERIFIED |

Sound and not re-reported: clearance scoping of DD/org (member `pmo` saw only hr/it), 409 bodies
with attribution, server-computed DD overdue, honest empty states, CSV quoting/BOM, PDF generation.

## Top actions for v3.0 (ranked)

1. **Real-deal shell + IL cockpit** — when `me.dealId` is set: `/` → cockpit; sidebar = Cockpit ·
   Due Diligence · Execution Hub · Org & Talent · Reports · Team & Access; strip all demo chrome
   (P1–P4, P7) and the fabricated banners. Where: `transitions.js` sidebar/header builders
   (~1300–1800, 3270–3740), `server.js:168`, `deal-home.js`. **L**
2. **Fix the attention signals** — real clock when `req.dealContext.dealId` is set (`portalNowMs`),
   include `critical` in `raid_high`, overdue styling + "unassigned" count in the hub, and surface
   task/RAID/DD nudges on the cockpit. `server.js:6009-6050`, `execution.js:166-180`. **S**
3. **Task editing in the hub** — inline edit owner/due/phase/workstream, bulk assign, filter
   unassigned/overdue/mine, provenance chip for `dd-finding:` sources. `execution.js`. **M**
4. **Cockpit panels on existing endpoints** — Execution (workstream RAG from the workstreams
   export JSON or a `/api/workstreams/rollup`), Risks (`/api/raid`), Value tiles
   (`/api/synergies/rollup`), Timeline (`/api/deals` dates). `deal-home.js`. **M**
5. **Timeline & phase** — derive phase/T-minus/Day-N from deal dates; replace the Day badge;
   offer default dues per phase from `day1Date` when instantiating the checklist. **S/M**
6. **Deal currency** end-to-end (`deal.currency` in tracker, CSV headers, pack) + optional
   deal-level synergy target in the wizard. **S**
7. **Decision log** — `decidedBy/decidedAt/dueDate` on RAID decisions (or a `decisions`
   collection), "decisions this week" on the cockpit, section in the pack. **M**
8. **DD workspace ergonomics** — area collapse, filters (status/owner/overdue/mine), bulk status,
   counts in headers. `due-diligence.js`. **M**
9. **Steerco pack v2** — DD summary page (pre-close), Day-1 readiness, timeline; keep org excluded. **M**
10. **IL manages membership** (audited) — Phase 12 scope; unblock before the wizard enhancements. **M**
11. **Own assessment records for deal members** — relax `server.js:2916` to deal members for their
    own instances (or stop the page calling it when locked down). **S**
12. **Admin console for the IL** — stop path-derived role painting (`transitions.js:680`); give the
    IL a scoped "Deal settings" page instead of the 17-tab admin shell. **S**
13. **Mobile header** — collapse the header stack ≤768 px in real mode. **S**
14. **Seed hygiene** — don't copy `processCatalog` demo rows into new deals; neutral template or none. **S**
15. **Language policy for real-deal pages** — either i18n DD/org/wizard/deal-home/conflict
    (~150 keys × 3) or limit the language selector in real mode and say so. **M**

## What I did not cover

- The Phase-9 conflict dialog in a browser (409 verified via API only); the "Synergy link tasks"
  UI; the PDF pack's visual content; ZH/CS screenshots (DE only); 768 px beyond overflow
  measurement; PMO/employee/leaders journeys beyond the cleared-member spot check; CMS editing by
  an IL; survey/pulse features; the TEd chatbot/RAG; accessibility; performance; security
  (other lanes); Phases 12–13 collaborative flows (not built). Server killed; no repo files
  touched except this report.
