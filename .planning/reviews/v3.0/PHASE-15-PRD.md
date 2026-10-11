# Phase 15 — Module Control — Core — PRD / locked decisions (orchestrator, 2026-10-11)

Input for `/gsd-plan-phase 15 --prd` (research/UI-spec skipped, as 10–14; D-15-09 is the UI contract). Requirements: MOD-01,
MOD-02, MOD-07 (coverage + live clauses; its presets clause closes at 16 SC4), MOD-08 — the owner's ask, verbatim: "need to
ensure that admin can disable part of the app". Depends on 14 (plan from its CLOSED head: staticGuard 14-05, `/api/files`
14-01, unmount/DEMO_ONLY rows 14-07, `customLane` reveal 14-08) and 11. Evidence: R3 §0–6, R6 §5 + G1–G12, D-V3-2,
PLAN-REVIEW PR-04/05/06 + risk 9, 11-CARRY-INS rows 7–9, D-13-05, D-14-06, memory `ma-windows-path-spelling-guards`.

## Problem (measured by the review, re-verified on HEAD ef1c2b7)
No server-side module concept. server.js has **162** `/api` method-routes on 129 templates (POST 74, GET 60, DELETE 27, PATCH 1;
R3's 146 is stale; Phase 14 → 164) plus `/` (:409) and `*` (:9474), both hard-wired to showcase pages; 21 pages, 8 nested HTML
and 47 `public/js` scripts are served sessionless (:507, :547). 0/162 routes and 0/21 pages belong to a module; every hide is
cosmetic; a denied page goes to `/` (transitions.js:1329), the deck. The gate (:1079-1197, open-mode pass :1125) and
`gatePolicy` (:1003) have no module rule; `/api/modules` = action modules (R3 F-4); `/api/auth/me` (:1453) carries a
booleans-only `access` map; the committed control.db refuses writes in dev/demo (:1660); egress state lives in runtime.db.

## Locked decisions
**D-15-01 Inventory: 15 switchable ids + core** (routes post-14). `dd` 16 (+`POST /api/deals/:id/vdr-grants`), `org` 13,
`tasks` 5, `raid` 3, `synergies` 11, `reports` 2, `assessments` 16 (+`POST /api/integration-tasks/from-remediation`), `people`
6 (employees, hrbps), `academy` 12 (courses, lessons, pulses, employees/get-or-create|*-lesson|award-merit), `comms` 7
(+files/communications), `dept-process` 9 (`/api/modules`, departments, processes), `playbook` 0, `assistant` 3 (rag/*,
ai/insight), `cms` 15 (pages, banners, media, slides, files/media|slides), `showcase` 8 (time-travel, new-ma, migrate-db,
reorder-widgets, projects). Each owns its pages (showcase: overview, index, insights, pmo, supporting, capability-hub,
integration-excellence; people: leaders, signage; academy: employee) and dirs (`/overview-deck/`, `/playbook/`,
`/vendor/transformers/` assistant, `/slides/` + demo `/uploads/` cms, demo `/sent_emails/` comms); `execution.html/.js` = ANY of
tasks|raid|synergies|reports. **knowledge-ai is split**: `playbook` (static, non-MNPI) vs `assistant` (on every page, reads
other modules' data, can leave the host) — an IL keeps the guidebook and drops the bot; cost one id/row/test. **Core, never
off (41 routes post-15):** auth + login/change-password; admin console (`/api/admin/{users,deals,audit,egress,csp-violations}*`);
deal registry (`/api/deals*` but vdr-grants) + wizard; deal home (dashboard.html); the registry; settings (exact), i18n, menus,
notifications, csp-report; `/healthz`, `/`, `*`; shared assets; the 21 scripts core pages load (a 404 would break them).
**D-15-02 One declarative map, CI-checked.** `lib/appModules.js` (self-validating at load): `MODULES` {id, label, requires,
affects, pages, anyOfPages, scripts, dirs}; `CORE_ROUTES` = exact `METHOD template` (no route is silently core); `MODULE_RULES`
= exact templates, then boundary-safe prefixes, method-agnostic (R3 F-2), via `templateToRegex` (validators/index.js:263).
`findUnmappedRoutes(app)` / `findUnmappedFiles()` back `scripts/list-unmapped-modules.js` and the coverage test; drafted from
`listApiRoutes()` + a `public/` walk, then classified; measured on this proposal: 0 unmapped, 0 dead rules, 0 overlaps.
**D-15-03 Dependencies: refuse-with-reason, never cascade.** One hard edge: `org requires people` (the incumbent picker and
flight-risk rows use the roster, org.js:181). Disabling people with org on ⇒ 409 `{error, moduleDependency:true,
blockedBy:['org']}`; enabling org with people off ⇒ the same with `blockedBy:['people']`; no `conflict` marker; nothing written
or audited. Soft `affects` (e.g. "DD → task conversion") are previewed, never blocking. Why: each state stays one explicit
audited decision; cascade needs cascade tracking, inherited reasons and ambiguous re-enable (R6 §5). Preview: `GET
/api/admin/app-modules/:id/impact?enabled=` → `{allowed, blockedBy, closes{pages,scripts,api}, affects, dataRetained:true,
current}`; no record counts (cross-deal reads).
**D-15-04 State, freshness, audit.** control.db `app_state` key `appModules` (no migration): `{v:1, rev, modules:{<id>:
{enabled, reason, changedBy, changedAt}}, known:[ids], seed:null}`; absent ⇒ ON in every mode this phase; 16 writes `seed` and
reads `known` (upgrade-added ids) — it only seeds. Unknown/core ids ignored; unparseable or `v` > 1 ⇒ every switchable module
OFF until the CLI repairs it. Writes 403 `{…, committedControlDb:true}` on the committed control.db (`accountsWritable` rule),
so the demo can never hold a disabled module. Not runtime.db (D-13-05's home): egress fails safe, module state would fail OPEN —
wiping runtime.db to sign everyone out would re-open closed modules; control.db is backed up and will hold 16's per-deal row.
Freshness: cache keyed on control.db `PRAGMA data_version` + a generation (lib/egress.js) ⇒ the next request of every process,
no re-login. A change is ONE `BEGIN IMMEDIATE` read-modify-write whose callback first appends `app-module-changed` {actor, id,
before, after {enabled, reason}}: audit failure ⇒ nothing changed (503); write failure ⇒ `app-module-change-failed`.
**D-15-05 API gate (MOD-02).** After the resolver (16's per-deal AND lands here) and the unchanged anonymous 401 / must-change
403: `gatePolicy.moduleBlock(req.gatePathForms)` (the D-14-06 seam; ANY canonical form, CR-01) ⇒ `denyAt(403, 'module-
disabled', {error:'This part of the portal is switched off by your administrator.', moduleDisabled:'<id>'})` before the
open-mode pass, demo-only, role, read, the large-body parse and validation: every method, every role incl. admin and the
token, demo-open included; rate-bounded denial rows; `/api` no-store, no `Location`/`Retry-After`/`conflict`. Real unmounts stay
404 first. An enabled route serving a disabled module's data answers that 403 inline (`/api/reports/export?dataset=synergies`).
**D-15-06 Pages, scripts, `/`.** Rules join `lib/staticGuard.js` over its identity forms (windowsFoldedForms + realpath.native,
lowercased): a disabled module's top-level page (any-of: all off) ⇒ 302 to `homeFor(req)`, no-store, no body; its scripts,
nested HTML and dirs ⇒ 404 `text/plain` + no-store; rules live only while a module is off (all on ⇒ zero fs calls). `homeFor`:
staff `/dashboard.html`; employee `/employee.html` (academy off ⇒ `/dashboard.html`); anonymous `/login.html` (demo-open
`/dashboard.html`). `/` and `*` serve today's files while showcase is on, else 302 home (PR-04). 302 not 404: MOD-03 sends every
link into a disabled page to deal home, incl. bookmarks, e-mailed links (comm template → `/playbook.html`) and CMS hrefs no
client sweep reaches; scripts stay 404 so an iframe never renders deal home.
**D-15-07 Client contract (+ carry-ins 7–9).** The authenticated `/api/auth/me` gains top-level `modules:{disabled}` + `home`
(`access` stays booleans-only); demo-open only when something is off; no-session never. The handshake stores them before its
`authEnabled` return (transitions.js:1395): `maModuleOn(id)`/`maModuleReady(id)`, no payload ⇒ on. Wrapper 403 branch (:1083):
`moduleDisabled` ⇒ record it, re-apply visibility, one non-stacking toast per page, never retry or navigate. `maDenyPage`
(:1329) → `home` (fallback `/`), never denying `home` itself (row 7). Core loaders (dashboard, deal-home, deal-wizard, admin*;
shell chatbot/banners/slides/AI card) check `maModuleOn` first — no request, no denial row — and render empty without throwing.
`data-module="<ids>"` (any-of) elements are default-hidden, revealed when the probe settles (failure ⇒ all); 15 tags its own
surfaces (admin rail tabs, Modules tab, execution tabs, synergies CSV link, deal-home nudge). Row 8: the same reveal for the
IN-C03 remainder (settings card + switcher pills admin.js:2980-2989, Edit Content transitions.js:2484, pmo.js `canNow` :18).
Row 9: access key `lessonProgress` = `!sess.dealId && roleAllowedForWrite(role,'/api/employees/complete-lesson','POST')`
(the `timeTravel` shape) — employee.js offers lesson checkboxes only where it is true.
**D-15-08 Endpoints.** `GET /api/app-modules` (all roles, read rule ALL_ROLES; non-admins `{modules:[{id,label,core,enabled}]}`,
reasons admin-only until 16), `GET /api/admin/app-modules/:id/impact`, `POST /api/admin/app-modules/:id` `{enabled, reason}`
(zod strict, reason 1–500 chars) → `{module, rev}`; core, in `CONTROL_PLANE_PATHS` (resolver.js:48; never deal-bound or open).
Writes need an admin session (`sessionId !== null`): token ⇒ 403 (MOD-08). Unknown 404; core 400 `coreModule`; no-op 409
`moduleUnchanged`; unreadable 409 `moduleStateUnreadable`. `/api/modules` stays dept-process.
**D-15-09 Modules tab.** System group, `data-tab="app-modules"`, default-hidden, admin only, loaded on first open. Rows: label,
purpose, On/Off, switch, Needs/Needed by, Also affects, "Data retained" while off, last change (who, when, reason); core "Always
on". Toggle ⇒ `.deal-modal` confirm fed by the impact route (blocked ⇒ reason, no confirm), reason required ("Recorded in the
audit trail; may be shown to users where this part of the portal used to be"); committed-DB lanes read-only. EN +
`admin.appModules.*` fallback keys; createElement/textContent only; no inline handlers (13-13 gate); keyboard-reachable.
**D-15-10 Break-glass CLI (MOD-08).** `scripts/modules-admin.js list [--json] | enable <id>… --reason <t> | enable --all
--reason <t>` (`--all` repairs an unreadable record). Enable-only: it restores, never restricts. Host access is the authority:
no token; actor `cli:<os-user>`; same orchestration; honours `requires`; MA_MODE defaults to real; refuses the committed control
DB; touches only control.db + audit.db; offline, server up or down. Exit 0 done/no-op; 1 refused (`unknown-module`,
`core-module`, `requires-disabled`, `committed-control-db`, `state-unreadable`); 2 usage or failure (missing reason, busy).
**D-15-11 Tracer = Synergies** (SC1; R3 §5.2: most couplings, no clearance logic, no page of its own — isolates gate, state,
audit, client and derived surfaces). Off ⇒ execution tab/pane, CSV link and deal-home nudge (:312-357) gone; `dataset=synergies`
403; the pack drops `synergiesSection` (reportPack.js:1121) and the stale sentence (:370-498). 16 repeats the pattern.

## Out of scope / deferred
16: the surface sweep (sidebar, quick-nav, tiles, wizard, checklist N/A, notifications, widgets, CMS menus), switched-off tiles
with reason + date, conversions into a disabled module, derived surfaces beyond synergies (tasks/RAID pack + CSV, rollups,
chatbot, RAG playbook), per-deal state (static pages stay instance-level), MOD-06 seed/upgrade defaults, both presets on the
walks. 17: IL cockpit landing. 19: translations. 20: token removal. Future: second approver, scheduling, IL requests, deletion.

## Acceptance
Proof = node --test per decision + Phase 15 scenarios on the Phase 13 runner pattern (real; dev and demo-open on temp DBs;
committed-DB hash guards) + smoke (Modules tab).
1. Coverage: the 167 post-15 method-routes each resolve to exactly one of core (41) or a module (126); every rule matches a
   route; 21 pages, 8 nested HTML, 47 scripts classified; negative controls (unmapped route/page/script, core ∩ module) fail it.
2. Per module (15): every route × method (+HEAD) ⇒ exactly the D-15-05 403 for admin, hrbp, pmo, employee (bound/unbound), the
   token admin and demo-open anonymous; fail-closed anonymous 401; must-change 403; core routes not 403; DB copies
   byte-unchanged; large-body routes unparsed; real unmounts 404; re-enable restores all; two audit rows (actor, reason).
3. Static, per module: canonical page ⇒ 302 home; `/DUE-DILIGENCE.HTML`, `/%64ue-diligence.html`, `//…`, raw `/js/../…`,
   trailing `.`/`%20`, `::$DATA`, `/DUE-DI~1.HTM`, `/js%5Cdue-diligence.js`, `/JS/Due-Diligence.JS` ⇒ 302 home or 404, never
   bytes; scripts/dirs 404; path.win32-simulated matrix + a `win32`-gated live test; all on ⇒ zero guard fs calls.
4. Freshness + refusals: process B on the same temp control.db answers an existing session 403 on its next request after A's
   toggle and a CLI enable in C reaches both; dependency 409 both ways, core 400, unknown 404, no-op 409, committed DB 403,
   token and non-admin 403 — none writes or audits; CLI exit codes per D-15-10, `--all` repairs, works with the server stopped.
5. Tracer walk (Playwright): admin switches Synergies off in the tab (preview, reason) ⇒ the Audit tab shows the row ⇒ the IL's
   open session on its next navigation has no Synergy tab, CSV link or nudge; a forced `/api/synergies` call goes out once (no
   retry or redirect, one toast); CSV 403; pack without section and sentence; re-enable ⇒ back, rows hash-identical.
6. Landing: showcase off ⇒ `/`, `/some/spa/path`, `/overview.html` 302 to each role's home (D-15-06); showcase on ⇒ today's
   stamped overview; no role × module combination loops (≤ 2 navigations).
7. All-off-except-core lane (real + demo-open on a temp DB): login, change-password, deal home, wizard, console (Users, Deals,
   Audit, Modules) with zero uncaught errors, zero core-page requests to disabled modules, ≤ 1 toast; screenshots 1440/768/390.
8. Suite 20× green; soak; Phase 9 walk (+ --demo-open) and 10/13/14 runners unchanged with all on; committed hashes unchanged;
   smoke green, 0 CSP violations; perf budgets unchanged.

## Demo-mode contract
Byte-for-byte: data/demo.db + control.db (never written); the DEMO_OPEN walk (`/` = stamped overview, pages and scripts as
today, `/api/auth/me` = `{authEnabled:false,user:null}`, no extra request on any page — the pinned request lists hold — zero
guard fs calls); demo launchers keep every module on structurally. Listed differences: the logged-in console shows the Modules
tab (read-only on the committed DB); gated controls appear once the probe settles; a page denied to a logged-in role goes to
its home, not `/`; deal-bound lesson checkboxes are not offered.

## Risks / planner notes
- Deliberate amendments (record each): `test/static-guard.test.js` (14-05) "zero fs calls outside real mode" ⇒ "while no rule
  is active"; `test/client-authz-hiding.test.js` READ_KEYS concat + `lessonProgress` (keep :141-153 and the `/` rows
  :1174/:1191/:1212 — their stubs carry no `home`); `test/read-policy-coverage.test.js` + the deployment-role-matrix drift
  test (DEPLOYMENT.md READ row, order-sensitive); `test/no-get-mutates.test.js` (new writer); `test/path-canonical-gate.test.js`
  (module rules, new control-plane paths). Unchanged by design: `test/caching-safe07.test.js` (no new middleware layer).
- CR-01: verdicts over canonical/identity forms only. Windows: pages cannot leave the static root, so identity + the first
  middleware are the defence (simulated matrix + win32 test); the 21/23 Windows smoke asserts a `%5C` disabled script 404s.
- Hot files (serialize waves): server.js, transitions.js, admin.js/admin.html, lib/staticGuard.js, caching-safe07,
  client-authz-hiding. Generate the map from the helper; re-count after 14; never write control.db in dev (WAL trap); a hidden
  default tab (admin Projects = showcase, an execution tab) ⇒ open the first visible; DEPLOYMENT.md gains "Module control".

User confirmation needed: module switches are read-only on the committed demo database (demo and plain dev launchers); the
switch is exercised on a real-deal host or a temp control DB. Default PROCEED (MOD-06 "demo launchers keep everything on",
PR-23 "committed files never written").
