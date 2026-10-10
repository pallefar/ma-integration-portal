# R3 — Module inventory & "admin can disable parts of the app" design

Lane R3 of the v3.0 production-readiness review. Read-only; one isolated server run on port 4313
(temp copies of `demo.db`/`control.db`, killed afterwards, 0 listeners left). All `file:line`
references are against the working tree at `56ca821`.

## 0. Verdict in five lines

1. **Nothing in the app today lets an admin disable a module server-side.** Every existing
   "hide" mechanism is client-side cosmetic (sidebar/landing-card removal, CMS page bodies) and —
   VERIFIED live — every one of them is writable by `pmo`/`hrbp`, not just `admin`.
2. The server already has the exact pattern a module gate needs: a boundary-safe prefix table
   checked once inside the consolidated `/api` gate (`DEMO_ONLY_PREFIXES`, `server.js:478-491`,
   applied at `:574-576`) plus live-route-inventory coverage tests
   (`test/auth-route-inventory.test.js:36-50`, `validators/index.js:289-305`).
3. The one structural gap: **`express.static` serves every page and script to anyone**
   (`server.js:175-189`, mounted before the `/api` gate at `:527`) — VERIFIED: anonymous
   `GET /due-diligence.html`, `/admin.html`, `/org.html`, `/deal-wizard.html`, `/js/admin.js` all
   `200`. Data is API-gated, so this is not an MNPI leak today, but a module switch that only
   gates `/api` leaves the page shell, its JS and its hard-coded links reachable.
4. Nav is NOT hand-written per page: `transitions.js` injects one sidebar (`:1404-1508`) from two
   literal catalogs (`portalCatalog :1410`, `resourceItems :1426`) plus a role map (`:1418-1424`);
   the quick-nav (`:1922-2010`) repeats the lists; CMS `menus.sidebar` overrides them
   (`applyMenuOverrides :2013-2079`). Deal-workflow pages (DD, Org) have no sidebar entry at all —
   they are reached only from deal-home tiles (`deal-home.js:166,224`). This is good news: three
   JS sites + one tagging sweep cover all client navigation.
5. Recommended shape: a **global, control.db-backed module registry**, admin-only writes under
   `/api/admin/*`, enforced in the `/api` gate for every method, a static page guard before
   `express.static`, one `modules` payload on `/api/auth/me`, and a coverage test that turns red
   when any `/api` route or `public/*.html` is unmapped. Tracer bullet = the `synergies` module.

## 1. Module inventory (proposed ids)

146 `/api` routes registered (`grep -c "app\.(get|post|put|patch|delete)\('/api/" server.js` = 146,
brief's "~146" confirmed). All 146 are assigned below; routes with no natural owner are listed in
§1.2. Service worker: **N/A** — `public/sw.js:1-33` is a self-unregistering kill-switch and
`transitions.js:1198-1215` unregisters any SW and purges `caches` on every page; nothing registers
`sw.js` (grep: 0 hits). No cached module asset can survive.

| id | Pages / client JS | Nav, tiles, CTAs that surface it | API routes (server.js) | Collections (db/collections.js) · seeds | Roles · mode | Exports / pack / chat / i18n |
|---|---|---|---|---|---|---|
| **core** (not switchable) | `login.html`; `dashboard.html` shell + `deal-home.js`; `deal-wizard.html`/`.js`; `deal-switcher.js`; `admin.html` shell + `admin.js` (Deals/Audit/System tabs); `transitions.js` | sidebar Admin link `:1498,2158`; header deal switcher (`deal-switcher.js:7-11` sole creation path); `/` → `overview.html` (`server.js:168-171`); `login.html:52,62` → `/` | `/api/auth/*` (4, `:646-782`), `/api/deals*` (9, `:860-1178`; grants `:1072,1098,1150` shared DD/Org), `/api/admin/*` (6, `:1179-1286,2391,2429`), `/api/settings` GET/POST (`:1534-1604`), `/api/i18n` (2, `:2036-2062`), `/api/menus` (2, `:2063-2080`), `/api/notifications` (1, `:6016` — aggregator, must become module-aware), `/healthz :783` | control.db `users`,`deals`,`app_state` (`db/control-schema.sql:29,37,50`); runtime.db sessions; audit.db; `settings`,`i18n`,`menus` singletons | all roles; both modes | audit viewer (`admin.html:67`), reports i18n `rpt.*` |
| **dd** Due Diligence workspace | `due-diligence.html`, `due-diligence.js` | deal-home tile `deal-home.js:166` (fed by `/api/dd/summary`), setup step `ddKickoff` (`deal-home.js:47`, `deal-wizard.js:565-588`), admin Deals-tab grants editor (`admin.js:2686-2707`) | `/api/dd/*` (14, `:5423-5928`) | `ddFindings`,`ddRequestItems`,`ddRequestTemplates`; seed `ddRequestTemplates` (`db/dealSeed.js:31`) | admin/hrbp/pmo write (`:332`), reads clearance-filtered (`db/accessPolicy.js:104`); real-deal | none exported (D-23); no i18n (hard-coded EN); conversion → tasks `:5823-5876` |
| **org** Org design & talent | `org.html`, `org.js` | deal-home tile `deal-home.js:224` (`/api/org/summary`), flight-risk nudge `:456` | `/api/org/*` (13, `:4458-5361`) | `orgPositions`,`orgDecisions`,`orgFlightRisks` (+reads `employees`) | `hr` area grant (`accessPolicy.js:42`); real-deal | excluded from exports (D-23); conversion → tasks/RAID `:5176-5233` |
| **tasks** Workstreams & tasks | `execution.html` pane `#ex-pane-tasks :207`, `execution.js` | sidebar "Execution Hub" `transitions.js:1486`; notifications `tasks_overdue/blocked` `:6043-6047`; quick-nav none | `/api/integration-tasks*` (5, `:3135-3287`), `/api/checklist-templates` (1, `:3288`) | `integrationTasks`,`customIntegrationTasks`,`checklistTemplates`; seed `checklistTemplates` | admin/hrbp/pmo write; both modes | CSV `tasks`,`workstreams` (`:6089`), pack `workstreamsTasksSection` (`lib/reportPack.js:826`); i18n `exec.*`; target of dd/org/assessment conversions and synergy `taskIds` (`:3578-3600`) |
| **raid** RAID log | `execution.html` `#ex-pane-raid :239` | notifications `raid_high :6048` | `/api/raid*` (3, `:4368,4375,6053`) | `raidEntries`,`customRaidEntries` | admin/hrbp/pmo; both | CSV `raid`, pack `raidSection :947`; org `linkedRaidIds :5107` |
| **synergies** Value capture | `execution.html` `#ex-pane-synergy :224`, `execution.js` (tab list `:1166`) | deal-home stale-synergy nudge `deal-home.js:441,457` | `/api/synergies*` (11, `:3652-4215`) | `synergyInitiatives`,`customSynergyInitiatives`; demo seed `scripts/seed-synergy-demo.js` | admin/hrbp/pmo (rebaseline admin+IL `:630`); both | CSV `synergies`, pack `synergiesSection :1121` **and** exec-summary stale chip `:374,493-497`; settings `synergyStaleDays/HorizonYears` (`validators/settings.js:107,115`) |
| **reports** CSV + steerco PDF pack | `execution.html` `#ex-pane-reports :260`, links `:265-279`; `execution.js:1233` | — | `/api/reports/export :6089`, `/api/reports/pack :6265` | reads tasks/raid/synergies lanes (`:6297-6299`) | any session (GET), audited | `lib/reportCsv.js`, `reportPack.js`, `reportPdf.js`; i18n `rpt.*` (`scripts/seed-reports-i18n.js`) |
| **assessments** Readiness assessments & survey | `assessments.html`/`.js`, `assess-charts.js`; `survey.html` + `app.js` | sidebar `:1482,1491`; dashboard links `dashboard.js:2423,2442`; `execution.html:189`; deal-home readiness panel `:439,453`; wizard step `assessments` (`deal-wizard.js:427`); notifications `assessment_pending/reassess_il :6020-6031`; chatbot `transitions.js:3051`; admin cards `admin.html:745,760` | `/api/assessment` (2), `/api/assessments` (2), `/api/assessment-templates` (1), `/api/assessment-instances*` (4), `/api/assessment-status` (1), `/api/questions*` (5), `/api/integration-tasks/from-remediation :3255` (conversion) | `assessments`,`customAssessments`,`assessmentInstances`,`customAssessmentInstances`,`assessmentTemplates`,`questions`; seed `assessmentTemplates` | employee may POST own (`:308-309`); both | i18n `assess.*`,`survey.*`; template `published` flag `:2779-2796` |
| **people** Roster (employees, Integration Leaders) | admin tabs `employees`,`hrbp` (`admin.html:80-81`); `leaders.html`/`.js`; `signage.html`/`.js` (kiosk, no `transitions.js`) | dashboard `teams` widget `dashboard.html:687`; chatbot `transitions.js:2412,3085`; org.js reads | `/api/employees` (7 incl. `get-or-create :6567`, `complete/uncomplete-lesson`, `award-merit`), `/api/hrbps` (3) | `employees`,`customEmployees`,`hrbps`,`customHrbps` | writes admin/hrbp/pmo except self-service lessons; mostly demo | i18n `leaders.*`,`signage.*` |
| **academy** Employee portal & onboarding | `employee.html`, `employee.js` (3663 lines), `ted-launcher.js` → `synergy-quest.js` (TEd game) | portal catalog `:1411`, role switcher `:1914`; dashboard `welcomekit`,`coach`,`pulses`,`changecurve` widgets | `/api/courses*` (5), `/api/lessons` (1), `/api/pulses` (2), `/api/employees/{complete,uncomplete}-lesson`, `award-merit` (DEMO_ONLY `:478-483`) | `courses`,`pulses` | employee self-service; demo-only mechanics | settings `welcomeVideo*`,`doom*` (`validators/settings.js:74-86`); i18n `video.*`,`pulse.*`,`hero.*`,`tab.*` |
| **comms** Communications & alerts | admin tabs `communication`,`banners`?(no: CMS) `admin.html:85`; dashboard `communicationdesk :912`; employee/pmo `comm.*` | — | `/api/communications*` (3, `:6863-6932`), `/api/alerts*` (3, `:6766-6813`) | `communications`,`customCommunications`,`alerts`,`customAlerts`; **writes HTML to `public/sent_emails/` `:6883,6901,6915`** (static, unauthenticated; prior H-06 covers git hygiene only) | admin/hrbp/pmo; both | i18n `comm.*` |
| **dept-process** Dept action modules & process catalog | admin tabs `modules`,`departments`,`processes` (`admin.html:72-74`); dashboard `modules`,`roadmap` widgets; `pmo.html` Process Integration tab | — | `/api/modules*` (3, `:6392-6443` — **name clash** with the proposed app-module registry), `/api/departments*` (3), `/api/processes*` (3) | `modules`,`departments`,`processCatalog`; seed `processCatalog` | admin/hrbp/pmo; both | i18n `pmo.*` (99 keys) |
| **knowledge-ai** Playbook, RAG, chatbot, AI insight | `playbook.html` (+`/playbook/hr-ma-guidebook.pdf`), unified assistant in `transitions.js` (`initGlobalTeodorChatbot`), admin "AI RAG PDF Trainer" `admin.html:680` | sidebar resources `:1429-1430`, quick-nav `:1928-1929`, 11 `/playbook.html` literals in `transitions.js` | `/api/rag/search :1287`, `/api/rag/upload :1299`, `/api/ai/insight :2450` | `ragUploads`; corpus = `playbook.html` sections (`ragService.js:62-74`) + uploads (`:194-196`) | any session | i18n `playbook.*`; `aiService.js:463` |
| **cms** Pages, banners, media, slides, inline edit | `admin-cms.js`, `page-layout.js`, `page-cms.js`, `inline-edit.js`, `banners.js`; admin tabs `pages`,`banners`,`media`,`slides`,`menus`,`translations` | slide launchers `transitions.js:2083-2125`; bookmarks `:1998-2009`; landing cards `index.html:341` | `/api/pages*` (3), `/api/banners*` (3), `/api/media*` (3), `/api/slides*` (4), `/api/projects*` (4, legacy demo virtualization `:1743-1826`) | `pages`,`banners`,`media`,`slides`,`projects`,`activeProjectId`; uploads under `public/uploads/` (static) | admin/hrbp/pmo write | `page.published` honoured only by `page-layout.js:80` |
| **showcase** Demo deck & role portals | `overview.html` (+`overview-deck/`), `index.html` role cards `:52-80`, `insights.html`, `pmo.html`/`pmo.js`, `supporting.html`, `capability-hub.html`, `integration-excellence.html`, `dashboard.js` demo widgets (2448 lines), easter egg `:1502` | sidebar Overview/Role Showcase/Insights `:1469-1480`, portals group, role switcher `:1739,1903-1919`, quick-nav General `:1931-1935` | `/api/settings/time-travel :1477` (DEMO_ONLY), `/api/settings/new-ma :1607`, `/api/dashboard/reorder-widgets :1522` | `customSettings` lane (`demoMode===false` → `custom*` collections, `:1542-1549,2259-2368`) | demo | i18n `dashboard.*`(195),`caphub.*`,`intexc.*`,`supporting.*`,`landing.*` |

### 1.2 Routes with no obvious module owner (decide explicitly)

`/api/settings/new-ma :1607` (resets custom-M&A lane + wipes `sent_emails`), `/api/admin/migrate-db :2391`
(legacy db.json migration), `/api/admin/download-zip :1261` (source archive), `/api/dashboard/reorder-widgets :1522`,
`/api/projects/* :1743-1826`, `/api/employees/get-or-create :6567`, `/api/notifications :6016`,
`/api/lessons :2026`. Proposal: first five → `showcase`; `get-or-create` → `academy`; `notifications` → core
(filtered by module); `lessons` → `academy`.

### 1.3 Side-findings from the inventory (not previously reported in `.planning/security/`)

- **F-1 · HIGH vs the v3.0 requirement · VERIFIED.** Every existing visibility control is writable by
  non-admins: `POST /api/settings` and `POST /api/menus` fall through to `DEFAULT_WRITE_ROLES`
  (`server.js:334-340`). Live: logged in as `pmo` → `POST /api/settings {"roleVisibility":{"leaders":false},"floatingMenuEnabled":false}`
  → `200`; `POST /api/menus {"sidebar":[{"href":"/execution.html","visible":false}]}` → `200`.
  A `pmo` user can therefore hide (or un-hide) portals for everyone. Any new module switch must sit
  under the `/api/admin` prefix (`:297`, admin for ALL methods `:586`).
- **F-2 · MEDIUM · VERIFIED.** `GET /api/employees/get-or-create` writes (`:6594,6600+`) — a GET, so it
  bypasses `ROLE_WRITE_POLICY` and `validationMiddleware` (both keyed on write methods `:578,320`).
  Live as `employee-demo`: `GET …get-or-create?empId=r3probe&name=R3%20Probe…` → `201` with a new
  roster row. Lesson for the design: a module gate must be **path-based and method-agnostic**.
- **F-3 · MEDIUM · code-traced.** `comms` writes dispatched HTML into `public/sent_emails/` and returns
  `/sent_emails/<file>` (`:6883,6901,6915`); `express.static` serves it with no session. In a real deal
  a communication names the target. Prior H-06 (`HISTORY-SUPPLYCHAIN-REVIEW.md:179`) covers only the
  gitignore aspect. Same class: `public/uploads/` (`:1941,2172`).
- **F-4 · LOW.** `/api/modules` already means *departmental action modules* (`admin.html:72`,
  `server.js:6392`). The app-module registry must not reuse the word in a URL — use `/api/app-modules`.

## 2. Existing enable/disable/visibility mechanisms

| # | Mechanism | Defined / applied | Controls | Who can change | Enforcement | Interaction with a module switch |
|---|---|---|---|---|---|---|
| M1 | `settings.roleVisibility` ("Demo Role Visibility") | schema `validators/settings.js:51-56,84`; UI `admin.html:426-473`; applied `transitions.js:2128-2151` | removes portal sidebar links + role-switcher options per role | admin **and hrbp/pmo** (F-1) | **cosmetic** — UI text itself says "Hidden portals stay reachable by direct URL" (`admin.html:433`) | keep as demo presentation; must not be mistaken for the switch. Lives in the per-db `settings` singleton → per-deal in real mode (`db/dealSeed.js:96-102` creates it empty). |
| M2 | `settings.floatingMenuEnabled`, `doomGloballyEnabled`, `doomUnlockXp` | `validators/settings.js:85-87`; `transitions.js:2134-2138`; `employee.js` | quick-nav tab; TEd game unlock | admin/hrbp/pmo | cosmetic (`doom*` read server-side `:5×` only to compute unlock) | fold the TEd/quick-nav toggles into `academy`/`showcase` module flags or leave as-is |
| M3 | CMS `menus.sidebar[].visible/roleScope`, `menus.landingCards`, `menus.bookmarks` | `POST /api/menus :2068`; `applyMenuOverrides :2013-2079`; `index.html:341`; `:1998-2009` | remove/rename/reorder sidebar links; add custom links; landing cards; bookmarks | admin/hrbp/pmo | cosmetic; admin-authored custom hrefs could point at a disabled page | the switch must run **after** `applyMenuOverrides` and the bookmark render, or sweep `[data-module]` + href→module map |
| M4 | Page CMS `pages[].published` + layout blocks | `page-layout.js:71-80`; `/api/pages :2081` | replaces a page's CMS region | admin/hrbp/pmo | cosmetic; unpublished page still loads with static markup | irrelevant to API access |
| M5 | Client `pageAccess` role allow-list | `transitions.js:689-743` | redirects a role away from a page to `/` | code only | client-only (comment says so `:693-696,709-710`); DD/Org deliberately absent `:712-728` | reuse its shape for the server-side static guard, but key on module not role |
| M6 | Sidebar role map `portalItemsByRole` / resources / Assessments+Execution guards | `transitions.js:1418-1431,1481-1494` | which links a role sees | code only | cosmetic | the natural place to add `data-module` on every link |
| M7 | `DEMO_ONLY_PREFIXES` | `server.js:478-491`, gate `:574-576`; test `demo-only-gating.test.js:171` | 403s showcase mechanics inside a real deal | code only | **server-side, method-aware, boundary-safe** | THE template for the API gate; extend the same table shape with a `module` field |
| M8 | `ROLE_WRITE_POLICY` + `DEFAULT_WRITE_ROLES` | `:296-351`, gate `:586-589` | who may write per prefix; admin-only for `/api/admin` all methods | code only | server-side | registry writes go under `/api/admin/app-modules` → admin-only for free |
| M9 | Per-deal clean-room grants (`memberGrants[].ddAreas`, `hr` area) | `db/accessPolicy.js:38-118`; `/api/deals/:id/grants :1072-1149` | per-record DD/Org visibility | admin | server-side | orthogonal; grants stay core (shared by `dd` and `org`) |
| M10 | Custom-M&A lane (`settings.demoMode===false` → `custom*` collections) and demo `projects` scoping | `:1542-1549,1594-1599,2259-2368`; `db/store.js:164-167` | which shadow collection a demo read/write hits | admin/hrbp/pmo | server-side data routing, not access control | legacy showcase virtualisation; a module switch must be independent of lane/project |
| M11 | `assessmentTemplates[].published` | `:2779-2796,6020` | hides a template from non-admin lists | admin/hrbp/pmo | server-side filter | per-template, not per-module |

Conflict to resolve: M1 and M3 can *un-hide* nothing a module switch hid, but they can hide core
links (e.g. a CMS menu row with `visible:false` on `/dashboard.html`). The switch must never be
the only thing between a user and the admin console: the pinned admin link is already excluded from
overrides (`:2033-2035,2156-2165`) — keep that exclusion rule for all core links.

## 3. Coupling map and the core set

| Module | Inbound references (must degrade when OFF) | Degrade rule |
|---|---|---|
| dd | deal-home tile + `/api/dd/summary` (`deal-home.js:440,454`) — a 403 JSON body is passed straight into `renderDiligence`, whose `summary.areas` check (`:154-159`) then renders the misleading text "No due-diligence areas available yet." (VERIFIED by code); wizard step `ddKickoff` + `/api/dd/request-templates`,`/instantiate` (`deal-wizard.js:565-588`); setup checklist stays "Outstanding" forever (`deal-home.js:47,76-78`; `controlStore.js:135,210-212`); admin grants editor (`admin.js:2686-2707`) exposes DD areas; `dd/findings/:id/convert` writes tasks | panel shows "Due diligence is disabled by your administrator"; wizard step rendered as *not applicable* and `hasOutstandingSetupStep` must ignore it; grants editor hides DD areas but keeps `hr` (org) |
| org | deal-home tile/nudge (`:442,455-456`); flight-risk convert writes tasks + RAID (`:5176-5233`); reads `/api/employees` | same panel rule; conversion routes are under `/api/org` so they close with it |
| tasks | synergy `taskIds` (`:3578-3600,3807-3820`, UI `execution.js:654`); conversions from dd/org/assessments (`:5823,5176,3255`); notifications `:6043-6047`; CSV `tasks`/`workstreams`; pack section `reportPack.js:826`; checklist instantiate in wizard `deal-wizard.js:501` | conversion routes must ALSO check the *target* module (`writesTo:['tasks']`) → 403; pack/CSV omit; notifications filtered; synergy task-link UI hidden |
| raid | notifications `:6048`; CSV/pack `:947`; org `linkedRaidIds` | omit sections; filter notifications |
| synergies | deal-home nudge `:441,457`; pack section `:1121` **plus** exec-summary stale chip `:374,493-497`; CSV `synergies`; admin settings fields | omit section AND chip; `dataset=synergies` → 403 |
| reports | depends on tasks/raid/synergies | pack builds only enabled sections; if all three off → 409-style "nothing to report" (precedent `:6265` empty-deal refusal) |
| assessments | deal-home readiness panel `:439,453`; wizard step `assessments` (`deal-wizard.js:427`) + `/assign :2797`; notifications `:6020-6031`; chatbot `:3051`; dashboard/execution links; `from-remediation` → tasks | panel/step N/A; notifications filtered; chatbot answer branch disabled |
| people | org.js reads employees; chatbot `:2412,3085`; signage kiosk; dashboard teams widget | org keeps working on its own collections; chatbot branches skip |
| academy / comms / dept-process / cms / knowledge-ai | dashboard widgets; employee portal; chatbot (RAG/AI); CMS menus/slides/bookmarks; `sent_emails`/`uploads` static files | widget/tab/menu suppression; static artifact guard |
| showcase | `/` → `overview.html` (`server.js:168`); index role cards; role switcher; demo widgets on `dashboard.html` | when OFF, `/` must route to `/dashboard.html` (or `/login.html`) — today hard-coded |

**Core (never disableable):** auth (`/api/auth/*`, `login.html`), the admin console shell + `/api/admin/*`
(+ the pinned sidebar link), deal registry/switcher/wizard shell (`/api/deals*`, `deal-wizard.html`,
`deal-switcher.js`), `dashboard.html` shell + `deal-home.js`, `/api/settings` GET/POST, `/api/i18n`,
`/api/menus`, `/api/notifications`, `/healthz`, `transitions.js`/`banners.js`, the app-module registry itself.

## 4. Design proposal (vanilla JS, no build step)

### 4.1 Registry — one server-side source of truth

New file `db/appModules.js` (sibling of `db/collections.js`, same "throw at load if inconsistent" style):

```js
const APP_MODULES = {
  dd:          { label: 'Due Diligence', pages: ['due-diligence.html'], api: [{ prefix: '/api/dd' }],
                 assets: ['js/due-diligence.js'], dependsOn: [], writesTo: ['tasks'] },
  synergies:   { label: 'Synergy Value Capture', pages: [], api: [{ prefix: '/api/synergies' }], … },
  // … tasks, raid, reports, org, assessments, people, academy, comms, dept-process, knowledge-ai, cms, showcase
};
const CORE_API = [{ prefix: '/api/auth' }, { prefix: '/api/deals' }, { prefix: '/api/admin' }, { prefix: '/api/settings', exact: true }, …];
const CORE_PAGES = ['login.html', 'admin.html', 'dashboard.html', 'deal-wizard.html', 'index.html'];
```

Prefix entries reuse the exact `{ prefix, exact?, methods? }` shape of `DEMO_ONLY_PREFIXES`
(`server.js:478-483`) and `pathMatchesPrefix` (`:292-294`). Special-case entries with a dynamic
segment (e.g. `/api/integration-tasks/from-remediation` belongs to `assessments`, not `tasks`) are
listed **before** the broader prefix, mirroring the first-match rule already documented at `:312-318`.

**State**: control.db `app_state` row `appModules` via `controlStore.getControlSettings()`-style
accessors (`db/controlStore.js:465-477` is the exact pattern; schema `db/control-schema.sql:50`).
Shape stores only what is disabled — `{"disabled":{"synergies":{"by":"admin","at":"…","reason":"…"}}}` —
so *absent key ⇒ enabled* and every existing deployment upgrades with zero migration. Read through a
small in-process cache invalidated on write (control.db is one file; Phase-8 multi-process serialisation
means other processes re-read on their next request — add a `version` column check or simply re-read per
request: one indexed `SELECT` per request is negligible next to the existing session lookup `:550`).

**Scope — recommendation: GLOBAL (deployment-wide) now, per-deal later as an additive override.**
Why: (a) the user's ask is operational ("admin disables parts of the app"); (b) the static page guard
runs before any deal is resolved — a static GET carries no deal context (`resolver.dealResolverMiddleware`
runs only inside the `/api` gate `:554`); (c) per-deal state would have to live in the deal DB's
`settings` singleton, which `hrbp`/`pmo` can write (F-1) — the wrong ACL; (d) one payload for the
client regardless of deal switch. **Cost of the per-deal alternative**: session+deal resolution on every
static request, a demo.db copy of the state, a deal picker in the admin UI, payload refetch on
`POST /api/deals/select`, and duplicated tests per deal kind — roughly 2× the tracer plan. Per-role scope
is already covered by `ROLE_WRITE_POLICY`/clearance grants; do not add a third role matrix.

### 4.2 Enforcement layers

(a) **API gate** — inside the consolidated gate, immediately after identity resolution and
**before** the `isOpenMode` short-circuit (`server.js:560-563`), so demo-open honours it too:
`const mod = moduleOfApiPath(fullPath); if (mod && isDisabled(mod)) return res.status(403).json({ error: 'This module is disabled by your administrator.', moduleDisabled: mod });`
Method-agnostic (F-2 lesson). Fixed body, body-marker discipline as `conflict:true` (`:367-387`), never
auto-retried by the client wrapper. Conversion routes additionally check `writesTo` inline (the two
existing `isAdminRequest` inline narrowings at `:607-612,630-632` are the precedent for "the flat table
cannot express it, so the handler does").

(b) **Static page guard** — `app.use()` registered *before* `express.static` (`:175`): normalise
(`decodeURIComponent`, `path.posix.normalize`, lower-case, strip query), map basename → module via
`APP_MODULES[*].pages` + `assets`; if disabled → `403` with a tiny inline HTML "module disabled" page
(no data, no module list). Include a test with case/encoding variants (`/DUE-DILIGENCE.HTML`,
`/due%2Ddiligence.html`, `//due-diligence.html`) — macOS/Windows file systems are case-insensitive, so a
case-sensitive guard would be bypassable there. Extensionless fallback (`:7169-7180`) is unaffected.
Static module artifacts (`sent_emails/`, `uploads/`) should move behind authenticated routes anyway (F-3).

(c) **Client suppression from ONE payload** — add `modules: { disabled: ['synergies', …] }` to
`GET /api/auth/me` (`:696-731`; already fetched on every page by `transitions.js:750`, `deal-switcher.js`,
`dashboard.js`). Expose `window.__appModules` and one function `applyModuleSuppression()` that removes
every element carrying `data-module="<id>"` whose module is disabled, and runs again after
`applyMenuOverrides` and the bookmark render (hook at `:2153-2155`). Tag sites: sidebar template
(`:1469-1505`), quick-nav catalogs (`:1925-1935`), deal-home panels (`deal-home.js:166,224,440-457`),
dashboard widgets (`dashboard.html:210-912` already have `data-widget` — add `data-module`), execution tabs
(`execution.html:200-260`, `execution.js:1166`), admin rail buttons (`admin.html:56-96`), index cards
(`index.html:52-80`). In the fetch wrapper (`transitions.js:579-586`) add a 403 branch keyed on
`body.moduleDisabled` → one non-stacking toast (reuse the `activeGiveUpToast` pattern `:63-70`), no redirect.

(d) **Service worker** — none registers; add a one-line test that `public/*.html` and `public/js/*.js`
contain no `serviceWorker.register(` so this stays true.

(e) **Exports / pack / RAG / chatbot / notifications** — `reports` builds its section list from enabled
modules (`buildPackFromSections` already exists, `reportPack.js:28`); `dataset=` outside enabled
modules → 403; `/api/notifications` filters items by `type`→module; chatbot branches (`:3051,3064,3085,3364`)
skip disabled sources; `aiService`/`ragService` are only reachable via `/api/rag|ai` (knowledge-ai).

(f) **Cross-module links** — every `href` into a module page goes through the same `data-module`
sweep; wizard steps `assessments`/`ddKickoff` render as *not applicable* and
`controlStore.hasOutstandingSetupStep` (`:210-212`) ignores steps of disabled modules.

### 4.3 Semantics, audit, defaults, lock-out, demo

- **Hide vs block**: both. API and pages are *blocked* (403); UI is *hidden*. Data is **retained** —
  disabling never deletes rows; re-enabling restores everything, including links held by other modules
  (`taskIds`, `linkedTaskIds` are plain ids, so nothing dangles).
- **Audit**: every toggle → `auditHook.recordSecurityEvent({ actor: req.portalUser, action: 'app-module-toggle', subject: moduleId, before: {enabled}, after: {enabled, reason}, request: requestMeta(req) })`
  (`db/auditHook.js:157-172` refuses anonymous actors — good). Reason text required by the zod schema.
- **Defaults / upgrade**: absent ⇒ enabled; unknown id in stored state ⇒ ignored with a boot warning;
  an *unmapped* `/api` route at runtime ⇒ follow the VAL-01 precedent and fail closed with a loud 500
  (`validators/index.js:329-332`), and the coverage test (4.4) makes that unreachable in CI.
- **Lock-out**: `CORE_*` ids rejected with 400 on write; the admin console, auth and the registry routes
  are structurally uncatalogued (not in `APP_MODULES`); a CLI `scripts/app-modules.js --enable <id>`
  (pattern: `scripts/set-admin-password.js`) is the break-glass path; `X-Admin-Token` works as today.
- **Demo mode**: the gate applies in both modes (same control.db). The demo launchers run `DEMO_OPEN=1`
  with no session, so toggling there needs a login or `ADMIN_TOKEN` — document it. Demo Role Visibility
  (M1) stays a presentation control. Ship the showcase modules **enabled** by default; the real-deal
  launcher (`start-real-deal.*`) may ship a `MA_DISABLED_MODULES=showcase,academy` env seed applied
  once on first boot (recorded in the same audit trail as actor `system`).

### 4.4 Coverage test (the gate that keeps the map honest)

`test/app-module-coverage.test.js`, modelled 1:1 on `test/auth-route-inventory.test.js:36-50`
(`app._router.stack` walk) and `validators/index.js:289-305`:

1. every `/api` route template resolves to exactly one module or `CORE_API` (`PUBLIC_API_PATHS` included);
2. every `public/*.html` is in some module's `pages` or `CORE_PAGES`;
3. every registry prefix matches at least one live route (the `demo-only-gating (e)` rule, `:171`);
4. live: disable each module in turn on an ephemeral server, hit every route in it → `403` with
   `moduleDisabled`, hit one core route → not 403, then re-enable and assert the audit row exists;
5. static: `GET` each module page (plus case/encoding variants) → 403 while disabled.

### 4.5 Admin console UX sketch

New rail group under **System** (`admin.html:94-97`): `data-tab="app-modules"` "Modules", hidden until
`window.__portalUser.role === 'admin'` exactly like the Audit tab (`admin.html:62-68`,
`admin.js:2864-2866`). One row per module: label · status pill · **toggle** · "Also affects:" chips
derived from `dependsOn`/`writesTo` and the §3 table (e.g. Tasks → "DD→task conversion, synergy task
links, reports Tasks section, overdue nudges") · "Data: retained" note · last changed by/at/reason ·
confirm dialog (reuse the `.deal-modal` shell, Phase-9 precedent) requiring a reason. Core rows are
listed read-only with a lock icon so the admin sees what cannot be switched. Live preview: the rail's
own buttons carry `data-module`, so disabling `cms` greys its own tabs immediately.

## 5. Feasibility traces (read-only)

### 5.1 `dd` — every line that changes, and what would still leak

Server: registry entry `{ prefix: '/api/dd', module: 'dd' }` closes all 14 routes (`:5423-5928`) in the
gate (`:574` neighbourhood); page guard entry `due-diligence.html` + `js/due-diligence.js`. Client:
`deal-home.js:150-171` (`renderDiligence`, link rows at `:166`) and `:440,454` (summary fetch → panel) get
`data-module="dd"` and a disabled-state panel instead of the "No due-diligence areas available yet." text; `deal-wizard.js:561-612` step marked N/A; `deal-home.js:41-48` checklist and
`controlStore.js:210-212` skip the step; `admin.js:2590-2707` hides DD area checkboxes but keeps `hr`.
**Would still leak after only the API gate**: (1) the page shell + JS (static, VERIFIED 200 anonymous);
(2) the deal-home tile link text "Due diligence" and the wizard step; (3) admin grants editor vocabulary
(area names, not MNPI); (4) `GET /api/deals` (`:970-972`) returns the whole stored deal row via
`controlStore.listDealsForUser` (`db/controlStore.js:107-112`), so `memberGrants[].ddAreas` ids stay visible
to members (VERIFIED by code; ids only, not MNPI); (5) an
admin-authored CMS bookmark/menu href to `/due-diligence.html` (page guard covers it); (6) historical
`dd-*` audit rows remain visible to admins (correct). Nothing in CSV/pack/RAG/notifications/i18n
references DD — clean by construction (D-23).

### 5.2 `synergies` — the better tracer (more couplings, no clearance logic)

Server: `{ prefix: '/api/synergies', module: 'synergies' }` closes 11 routes (`:3652-4215`); `reports`
must drop `synergiesSection` (`reportPack.js:1121`) **and** the exec-summary stale chip (`:374,493-497`)
and reject `dataset=synergies` (`:6089-6095`). Client: `execution.html:224` pane + its tab button and
`execution.js:1166` tab array; `deal-home.js:441,457` nudge; admin settings fields
`synergyStaleDays/HorizonYears` (`validators/settings.js:107,115`, UI in `admin.js`); i18n `exec.*`
synergy labels are harmless. **Would still leak after only the API gate**: (1) the Synergy tab button
(hard-coded markup) and an empty pane; (2) the exec-summary chip text "0 of 0 synergy initiatives are
stale"; (3) CSV link `dataset=synergies` → today a 200 headers-only file (`reportCsv.js:79-84`) — must
become 403; (4) `taskIds` on tasks are inert ids; (5) `scripts/seed-synergy-demo.js` only touches demo.db.
No static page is synergy-specific (it lives inside `execution.html`), so the page guard is not involved —
which is exactly why it is the right first slice.

## 6. Phasing

1. **Plan A — tracer (M):** `db/appModules.js` + control.db state + `GET /api/app-modules` /
   `POST /api/admin/app-modules` (zod schema, reason required, audit event) + API-gate check +
   `/api/auth/me` payload + fetch-wrapper 403 branch + coverage test parts 1,3,4 + wire `synergies`
   end-to-end (tab, nudge, pack/CSV). Proves the contract live.
2. **Plan B — all modules & pages (L):** static page guard + variant tests; `data-module` tagging sweep
   across the eight sites in §4.2(c); notifications filter; wizard/checklist N/A; `writesTo` checks on the
   four conversion routes; admin "Modules" tab; coverage parts 2 and 5; `/` fallback when `showcase` is off.
3. **Plan C — showcase/demo & static artifacts (M):** move `sent_emails/` and `uploads/` behind
   authenticated routes; `MA_DISABLED_MODULES` first-boot seed for the real-deal launcher; CLI recovery
   script; DEPLOYMENT.md section; demo-open behaviour test.
4. **Plan D — optional per-deal overrides (M):** `deals.<id>.modules` additive AND-merge, deal picker in
   the Modules tab, payload refresh on deal select.

## Top actions for v3.0

1. **Put every visibility/menu/settings write behind admin** or accept that `pmo` can hide portals for all
   users (F-1) — `server.js:296-340` add explicit entries for `/api/settings`, `/api/menus`, `/api/pages`,
   `/api/banners` (S).
2. **Build Plan A** — registry, gate, payload, audit, coverage test, `synergies` tracer (M).
3. **Static page guard before `express.static`** with normalisation + variant tests; move `sent_emails/`
   and `uploads/` out of the anonymous static tree (F-3) (M).
4. **Close the GET-that-writes hole** `GET /api/employees/get-or-create :6567` → POST with a schema, or
   gate it by role explicitly (F-2) (S).
5. **Plan B tagging sweep + admin Modules tab** (L).
6. **Rename nothing, but reserve the URL** `/api/app-modules` and document the clash with `/api/modules` (S).
7. **`/` landing when `showcase` is off** → route to `/dashboard.html` for the Integration Leader
   (`server.js:168-171`) — small, high-visibility for the key persona (S).

## What I did not cover

- I did not run Playwright; client-side rendering claims are code-traced (the `renderDiligence` 403 case
  was read to the line, not executed in a browser).
- I did not audit every one of `dashboard.js`'s 2448 lines or `employee.js`'s 3663 lines for additional
  hard-coded links; the `data-module` sweep is designed so that misses show up as leaks caught by tests,
  not by reading.
- Role reachability per route is derived from `ROLE_WRITE_POLICY` and clearance code, not re-proven live
  for all 146 routes (prior phases' tests cover that).
- Per-deal override semantics (Plan D) are sketched, not designed.
- The Integration Leader persona focus (lane-mate's topic) only appears here as the `/` landing action.
