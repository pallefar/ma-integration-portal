---
phase: 11-authorization-clean-room-closure
part: B (client-side capability hiding + access map)
reviewed: 2026-10-10T16:10:00Z
depth: deep
base: 63bb2af
head: fd918b3 (plans 11-01..11-07 merged; 11-08 not started)
reviewer: Claude Fable 5.1 (gsd-code-reviewer, second-opinion model)
files_reviewed: 24
files_reviewed_list:
  - lib/readPolicy.js (accessSummaryFor / ACCESS_PROBES)
  - server.js (GET /api/auth/me only)
  - public/js/transitions.js
  - public/js/employee.js
  - public/js/pmo.js
  - public/js/deal-home.js
  - public/js/leaders.js
  - public/js/admin.js
  - public/js/admin-cms.js
  - public/js/inline-edit.js
  - public/js/dashboard.js
  - public/admin.html, assessments.html, capability-hub.html, dashboard.html, deal-wizard.html, due-diligence.html, employee.html, execution.html, index.html, insights.html, integration-excellence.html, leaders.html, org.html, overview.html, playbook.html, pmo.html, supporting.html, survey.html
  - test/client-authz-hiding.test.js
  - test/org-summary.test.js, test/admin-users-ui.test.js (the two loosened pins)
findings:
  critical: 0
  warning: 7
  info: 7
  total: 14
status: issues_found
---

# Phase 11 — Code Review, Part B: client capability hiding and the access map

**Scope.** `git diff 63bb2af..HEAD -- public lib/readPolicy.js test/client-authz-hiding.test.js`, plus `GET /api/auth/me` in `server.js` and `lib/readPolicy.js accessSummaryFor`. Server-side authorization (11-01..11-06) is the sibling reviewer's `11-REVIEW.md` and is not re-reviewed here; where a client finding has a server-side root I say so and stop.

**Method.** Code trace of every `fetch(` in `public/js/*.js` and inline HTML against `ROLE_READ_POLICY` / `ROLE_WRITE_POLICY` / `DEMO_ONLY_PREFIXES`, then a live Playwright walk (Chromium headless, Playwright 1.62.1 from the npx cache) against an **isolated `MA_MODE=real` child server** in a mkdtemp `MA_DATA_DIR` (committed `data/*.db` never opened, no `new-ma`, all processes killed), seeded through `test/helpers/deal-fixture.js` with one real deal and five bound sessions: `admin`, `hrbp`, `pmo` (hr+it clearance), `pmo-nc` (member with **no** clearance), `employee` (member even granted `hr`). Every page in `public/` was loaded per role twice: once in a fresh context (first-ever navigation) and once in a persistent context after `/` had run the handshake. Every non-2xx `/api` response, console error and page error was logged. A second lane (`DEMO_OPEN=1`, temp copies of demo/control) checked the showcase. Raw evidence: scratchpad `out/results.json`, `out/results2.json` (not committed).

## Executive verdict

The mechanism is sound: `/api/auth/me` derives the map from the same tables the gate enforces, the browser holds no role table, `maCan` is false only for an explicit `false`, the probe settles on failure, and the demo-open response is byte-identical. For the **legitimate role-on-its-own-pages** combinations the walk is clean for `employee` on the employee portal and every content page, for `pmo` on pmo/execution/DD/org/dashboard, for `hrbp` on the admin console, and for the uncleared member everywhere (0 refused requests — the DD/org handlers filter rather than refuse, so `maCan('dd'/'org') === true` is correct for them).

Two things undercut the "no control that would 403 is shown" claim and need fixing before this phase closes:

1. The client page gate the plan relied on does not hold for `admin.html`, `pmo.html`, `dashboard.html`, `supporting.html`, `employee.html`: `transitions.js` *derives the role from the path* for those five pages before checking it, so any role can open them, and the admin/pmo loaders that were deliberately left ungated ("those pages are role-gated") fire refused requests and throw (`comms.filter is not a function`, `hrbps.forEach is not a function`). An employee opening `/admin.html` produces six 403s and ten console errors.
2. The employee HR-helpdesk ticket is refused server-side (`role-write`) and the portal shows "Inquiry Received!" anyway — a false success on the one write an acquired employee is most likely to rely on.

Plus a legitimate-role regression (`assessments.html` fires three refused `/api/assessment-instances` requests for `hrbp` and `pmo` on every load), two ungated pages (`due-diligence.html`, `org.html`) whose stated reason for having no gate is now false, and one cache-bust miss (`dashboard.js` was changed by 11-05 and its stamp was not bumped — the guard test does not track that file).

No MNPI leak was found in the client changes; nothing relies on hiding for authorization; no new HTML sink was introduced.

---

## CRITICAL

None.

## HIGH

### WR-C01 — The client page gate is bypassed by path-based role detection, so the ungated admin/pmo loaders still fire refused requests for employee and pmo
**Status:** VERIFIED (live, both fresh and persistent contexts)
**File:** `public/js/transitions.js:1197-1207` (role detection) and `:1210-1263` (gate); ungated loaders `public/js/admin.js:965` (`loadHrbps`), `:523` (`loadAssessmentsHistory`), `:769` (`loadEmployees`), `:1734` (`loadCommunications`); `public/js/admin-cms.js:1182/983` (projects, processes); `public/js/pmo.js:894` (`loadPmoCommunications`).
**Scenario.** `transitions.js` sets `activeRole = 'admin'` whenever the path contains `admin.html` (likewise `pmo.html → 'pmo'`, `dashboard.html → 'hrbp'`, `employee.html → 'employee'`, `supporting.html → 'supporting'`) *before* the `pageAccess` check, so for those five pages the check is a tautology. The 11-07 plan and summary treat `admin.html` as "reachable by admin and hrbp" and `pmo.html` as "admin and pmo" and therefore left `admin.js`'s and `pmo.js`'s staff loaders ungated. In a real deal:
- `employee` → `/admin.html`: **6 × 403** (`/api/assessments`, `/api/employees`, `/api/hrbps`, `/api/communications`, `/api/projects`, `/api/processes`), page not redirected, 10 console errors incl. `TypeError: assessments.slice is not a function` (admin.js:532).
- `employee` → `/pmo.html`: **403 `/api/communications`**, `TypeError: comms.filter is not a function` (pmo.js:898).
- `pmo` → `/admin.html`: **403 `/api/hrbps`**, `TypeError: hrbps.forEach is not a function` (admin.js:974). Both visits succeeded in the persistent context *after* the handshake had stored the true role (`storedRole=employee/pmo`), proving the gate is not merely racing the probe.
- Also: on a **fresh** context (first navigation, no stored role) the gate defaults to `'admin'` and lets an employee load `execution.html` (5 × 403), `assessments.html`, `survey.html`, `playbook.html`, `deal-wizard.html` once; in the persistent context these five do redirect to `/`.
**Why it matters.** Each refused request writes a rate-bounded `access-denied` row (verified: `audit_log` rows with `reason:"role-read"`, `count`, `folded`) — a handful of page loads by one curious employee produces a steady trickle keyed on six different routes; the console-error noise makes the pages look broken; and T-11-60's "every hidden route is refused server-side" holds (no leak) but the plan's own success criterion ("no control that would 403 is offered") does not.
**Fix direction.** Make the page gate use the server-verified role and stop deriving it from the path (the path-derivation is a demo persona convenience — keep it only when `window.__portalAccess` is null / `authEnabled:false`): after the handshake, if `me.user.role` is not in `pageAccess[page]`, redirect. Additionally gate the loaders themselves (defence in depth, same pattern as 11-07): `admin.js loadHrbps/loadEmployees/loadAssessmentsHistory/loadCommunications` on `maCanReady('hrbps'|'roster'|'assessmentsList'|'communications')`, `admin-cms.js` projects/processes on `'projects'|'processes'`, `pmo.js loadPmoCommunications` on `'communications'`. Add live rows to `test/client-authz-hiding.test.js` for employee→admin.html and pmo→admin.html.
**Touches:** PRD acceptance 1 (employee 403 list is now reached from the UI), D-11-01, D-11-05 (denial audit volume), plan 11-07 must-have "no control that would now answer 403 is shown".

### WR-C02 — Employee HR-helpdesk ticket shows "Inquiry Received!" after a server 403
**Status:** VERIFIED (live)
**File:** `public/js/employee.js:1954-1973` (`#hr-inquiry-form` submit → `POST /api/communications/send`, `.catch(console.error).finally(show success)`).
**Scenario.** Real deal, `employee` fills the helpdesk form → `POST /api/communications/send` → **403** `{reason:"role-write"}` (DEFAULT_WRITE_ROLES has never included `employee`) → the form hides and the success card renders: *"Inquiry Received! Your local Integration Leader will review this ticket and get back to you within 24 hours."* Nothing was filed; the IL never sees it. Pre-existing in origin (not introduced by Phase 11) but it is now the only visible write on the employee portal and the executors flagged it without a fix.
**Why it matters.** An acquired employee's "I have a question about my contract / retention" goes into a black hole with a confirmation. In an integration this is a retention and trust issue, not a cosmetic one.
**Fix direction (product decision, two valid answers).** (a) Keep the feature: add an exact `POST /api/communications/send` self-service rule for `employee` whose handler **forces** `sender`/`senderRole`/`recipientType:'hrbp'` from the session (never the body) and drops the free `recipientEmail`; expose it as `access.helpdesk` from `roleAllowedForWrite(role,'/api/communications/send','POST')`. (b) Remove the form in real deals: hide `#hr-inquiry-form`'s card on `!maCan('helpdesk')`. In **either** case the handler must check `res.ok` and render an error state instead of `.finally(success)` — a 503/409 today also shows success.
**Touches:** AUTHZ-02 (self-service allowlist), D-11-02 spirit, plan 11-07 "Findings beyond this plan".

## MEDIUM

### WR-C03 — `assessments.html` fires three refused `/api/assessment-instances` requests per load for hrbp and pmo
**Status:** VERIFIED (live: `rv-hrbp`, `rv-pmo`, `rv-pmo-nc`, `rv-emp` all 3 × 403)
**File:** `public/js/assessments.js:101` (one `GET /api/assessment-instances?templateId=…` per template inside `loadAll()`); policy `lib/readPolicy.js:77` (`ADMIN_ROLES`).
**Scenario.** `assessments.html` is on `pageAccess` for admin/pmo/hrbp. The read policy makes `/api/assessment-instances` admin-only ("matches the handler's existing admin-only guard"), so every IL and workstream lead gets 3 × 403 on every visit; the scorecard silently falls back to `assessment-status` (no trend). Before Phase 11 the handler answered 401 in locked-down deployments, so the *client* behaviour is old, but the page is now on the hidden-control contract and the executors' consumer audit missed it (the grep was for the refused *families*, and `assessment-instances` is a family of its own).
**Fix direction.** Add `assessmentInstances: '/api/assessment-instances'` to `ACCESS_PROBES` and gate the per-template fetch on `maCanReady('assessmentInstances')` (fall back to status as today, without the request). Separately for the sibling reviewer: if the IL is meant to see instance trends (PRD: "hrbp all deal data"), widen the rule to LEAD_ROLES instead.
**Touches:** D-11-01, acceptance 1/6 (denial audit noise), plan 11-07 list completeness.

### WR-C04 — `due-diligence.html` and `org.html` have no page gate and their stated reason no longer holds
**Status:** VERIFIED (live: `employee` → `/due-diligence.html` 3 × 403 `dd/areas, dd/vdr-links, dd/summary`; `/org.html` 3 × 403 `org/positions, org/capabilities, employees`; even for an employee granted the `hr` area)
**File:** `public/js/transitions.js:1233-1249` (IN-02 comments), `public/js/due-diligence.js:49-63,604`, `public/js/org.js:180-187`.
**Scenario.** The comments justify the missing entries with "a pmo/employee deal member legitimately granted an area must be able to reach this page". After 11-01 the read policy refuses `employee` on `/api/dd` and `/api/org` regardless of grants, so the justification is false for `employee`; the page is a wall of 403s. The sidebar/CMS menu may still link these pages for every role (not verified — menus are data).
**Fix direction.** Gate both pages on the capability, not the role: in the handshake (or in each page's own `/api/auth/me` call) redirect to `/` with the existing `access_denied_message` when `maCan('dd')` / `maCan('org')` is false. Update the two IN-02 comments. Keep pmo reachable (clearance filtering already yields an empty workspace for `pmo-nc`: 0 refused requests, verified).
**Touches:** D-11-01, plan 11-07 "Findings beyond this plan" item 2.

### WR-C05 — `public/js/dashboard.js` changed (11-05) without a `?v=` bump; the cache-bust guard does not track it
**Status:** VERIFIED (`git diff 63bb2af..HEAD -- public/js/dashboard.js` = 6 lines; `public/dashboard.html:1397` still `/js/dashboard.js?v=1784700001`, identical at `63bb2af`)
**File:** `public/dashboard.html:1397`, `test/asset-cache-bust.test.js` `FROZEN`/`NEW_ASSETS` tables (dashboard.js, employee.js, pmo.js, deal-home.js, leaders.js, admin.js, admin-cms.js, inline-edit.js are all absent from the tables).
**Scenario.** 11-05's fallbacks (`p.timestamp || p.day`, `p.employeeName || 'Anonymous'`) are what stop a real-deal pmo's aggregate pulse rows rendering "Invalid Date" and a blank header. A browser holding the 30-day-cached old `dashboard.js` keeps the bug. The 11-07 summary's claim "every changed public/js file has a bumped stamp" is true for 11-07's own files only. The guard test could not catch it because it only checks assets in its frozen table — the eight files 11-07 touched are equally untracked, so the next edit to any of them is equally unprotected.
**Fix direction.** Bump `dashboard.js` to `1791800001` on `dashboard.html`; add the Phase-11 client files to `NEW_ASSETS` (or land the Phase 12 content-hash stamp sooner). Until then the stamp rule is a convention, not a guard.
**Touches:** plan 11-07 must-have 5; CLAUDE.md cache-bust discipline.

### WR-C06 — Test suite cannot detect a client/server capability-key drift; two source-level rows are weakly anchored
**Status:** PLAUSIBLE (code reading of `test/client-authz-hiding.test.js`)
**File:** `test/client-authz-hiding.test.js:376-385` (hand-written `ME_*` fixtures), `:567-581` (`guardBefore`), `:910-924` (`guarded`).
**Scenario.** The vm rows assert against hand-typed maps (`roster`, `communications`, …). Nothing ties the key literals used by the client (`maCan('roster')`, `canReady('communications')`, …; nine keys in use) to `Object.keys(accessSummaryFor())`. Rename or drop a probe in `lib/readPolicy.js` and every vm row still passes while the live client sees `undefined` → `maCan` true → the control is shown again and the request fires. The server rows use `READ_KEYS` from the real function but never cross-check the client. `guardBefore()` slices from `Math.max(lastIndexOf('addEventListener(', at), 0)` — if the handler marker is not found it scans from the top of the file, so any earlier `canNow('configWrite')` satisfies it; `guarded()` likewise accepts a guard string inside a comment. The rows are otherwise genuinely two-sided (hidden AND no request) and mutation-sensitive per the summary.
**Fix direction.** One row: collect every `maCan(Ready)?\('(\w+)'\)` / `canReady\('(\w+)'\)` / `canNow\('(\w+)'\)` literal under `public/js` and assert each is in `Object.keys(accessSummaryFor('admin', true)).concat('configWrite')`. Anchor `guardBefore`/`guarded` on the *specific* handler opening (`hrForm.addEventListener('submit'` etc.) and strip comments before searching.
**Touches:** plan 11-07 artifact "server access-map rows + node:vm client rows".

### WR-C07 — Targeted communications to a real-deal employee are now invisible to them, while the staff UIs still offer employees as recipients
**Status:** PLAUSIBLE (hide verified live; sender side by code trace)
**File:** `public/js/employee.js:3264-3290` (hides `#employee-notifications-area` and the broadcast archive on `!maCan('communications')`); `public/js/pmo.js:778-790`, `public/js/dashboard.js:2198`, `public/js/admin.js:1619` (recipient pickers still list the roster).
**Scenario.** D-11-01 refuses `employee` all of `/api/communications` (contract-conformant — "NOT communications"). The employee portal's *personal* inbox (`c.recipientEmail === employeeEmail`) was the only place an IL's message to one employee surfaced in-app. Now the IL/PMO "send to employee" flow still succeeds, is logged, and is never seen. Functionality silently lost on the receiving side with no signal on the sending side.
**Fix direction.** Product call for 11-08 / next phase: either an "own messages" projection (`GET /api/communications/mine`, server-filtered by the session's email, all roles — the pulses precedent from 11-05) or a sender-side note ("real-deal employees do not receive in-app messages; email is sent"). Not a client bug per se; recorded so it is not lost.
**Touches:** D-11-01, D-11-06 (personal-data pattern).

## LOW

### IN-C01 — The Day pill / Time Machine is shown in real deals for every role; its POST is demo-only
**Status:** VERIFIED (`#time-machine-trigger` visible on all 19 pages × 5 roles in the real lane)
**File:** `public/js/transitions.js:2365`, `:2942` (`POST /api/settings/time-travel`, `DEMO_ONLY_PREFIXES`).
Pre-existing (Phase 3). Clicking it in a real deal animates, POSTs, gets a 403 `demo-only`, logs "Time travel synchronization failed" and removes the overlay. Hide the container when `window.__portalAccess` is present and the deal is bound (`me.dealId`), or add a `demoOnly`/`timeTravel` key.

### IN-C02 — `signage.html` (kiosk) 403s and throws for an employee in a real deal
**Status:** VERIFIED (`rv-emp` → 403 `/api/employees`, `TypeError: employees.filter is not a function` at signage.js:123)
**File:** `public/js/signage.js:119`. Loads no `transitions.js`, so no map. Executors listed it as left as-is. Either load the handshake or guard on `Array.isArray`.

### IN-C03 — Flash-before-hide and click-before-map-settles
**Status:** PLAUSIBLE
**File:** `public/js/admin.js:2925-2927` (`applyConfigWriteGate` runs after the probe), `public/js/transitions.js:2352` (edit toggle hidden after the probe), `public/js/pmo.js:415-417` (`canNow` returns true while `__portalAccess` is still null).
The config tabs, settings card and "Edit Content" pill render first and disappear when `/api/auth/me` returns (one network round-trip after DOMContentLoaded; not observed in the walk because measurements were taken after settle). A click landing in that window sends the request and meets the server 403 — correct outcome, slightly ugly. Cosmetic; a `hidden` default on the config tabs in `admin.html` plus un-hiding for `configWrite` would remove the flash.

### IN-C04 — Logged-in demo store (dev lane, no `DEMO_OPEN`) now hides config controls from hrbp/pmo
**Status:** VERIFIED (`me:rv-demo-hrbp.access.configWrite === false` on the demo store; demo-open lane unchanged: switcher/hrbps card/edit toggle/leaderboard all visible, `/api/auth/me` = `{authEnabled:false,user:null}`)
Consequence of D-11-02 (`configWrite` always follows ROLE_WRITE_POLICY — the server refuses those writes on the demo store too), so the client is consistent. But the showcase *with logins* (`karen`/`pmo` demo accounts) changed: no demo-mode switcher on `pmo.html`, no CMS tabs or inline editing for `karen`. 11-08's demo lanes should exercise the logged-in dev lane, not only demo-open, so the user sees this before release.

### IN-C05 — 11-06 welcome-link `?empId=` binding change: acceptable; URL `name` still drives the greeting
**Status:** VERIFIED (employee with `?empId=emp_3&name=Colleague%20X` → greeting "Welcome…, Colleague X!" while the roster record is the account-derived one)
**File:** `public/js/employee.js:13,1495-1497` (textContent — no sink), `:2227` (POST body still sends the URL `empId`/`name`; server ignores them for employee).
Judgement: the MNPI-safe choice (a supplied `empId` can no longer resolve a colleague's record) and nothing real-deal was lost (lesson completion is demo-only). The greeting is reflected URL text via `textContent` (not XSS). Residual: an HRBP's roster row and the employee's own `emp_acct_*` row never link — a future explicit linkage field, as 11-06 says.

### IN-C06 — Academy lesson checkboxes in a real deal would POST a demo-only route
**Status:** PLAUSIBLE (not reproducible in the walk: a fresh real deal has no courses, so no `.academy-lesson-checkbox` rendered)
**File:** `public/js/employee.js:2471` (`/api/employees/complete-lesson`, `DEMO_ONLY_PREFIXES`). Pre-existing Phase 3 behaviour; if an admin seeds courses into a real deal, every tick is a 403. Out of 11-07's "now 403" scope; note for the module switch (Phase 15).

### IN-C07 — Demo-open `admin.html` redirects to `/login.html` (401 on `/api/deals`)
**Status:** VERIFIED in the demo-open lane; **pre-existing, not Phase 11** (`CONTROL_PLANE_PATHS` and the wrapper's `authRequired` redirect and `loadDeals()` on load all exist at `63bb2af`).
`/api/deals` is control-plane and never open, `admin.js` calls it on every load, the fetch wrapper redirects on the 401. Flagging because 11-08's demo-lane screenshots will hit it and should not attribute it to this phase.

---

## Refused-request matrix (real deal, observed)

Fresh context = first navigation with no stored role (gate defaults to `admin`); persistent = after `/` ran the handshake. `–` = page not reachable for the role (redirected to `/`). Counts are distinct non-2xx `/api` responses on load.

| Page | employee (fresh) | employee (persistent) | pmo | pmo, no clearance | hrbp | admin |
|---|---|---|---|---|---|---|
| `/` | 0 | 0 | 0 | 0 | 0 | 0 |
| `dashboard.html` | 0 | 0 (deal home: 2 panels) | 0 (4 panels) | 0 (4 panels) | 0 | 0 |
| `employee.html` | 0 | 0 | 0 | 0 | 0 | 0 |
| `pmo.html` | **1** (`communications`) | **1** (`communications`) | 0 | 0 | 0 | 0 |
| `admin.html` | **6** (`assessments, employees, hrbps, communications, projects, processes`) | **6** | **1** (`hrbps`) | **1** (`hrbps`) | 0 | 0 |
| `assessments.html` | 3 (`assessment-instances`×3) | – | **3** | **3** | **3** | 0 |
| `execution.html` | 5 (`integration-tasks, checklist-templates, synergies, raid, synergies/rollup`) | – | 0 | 0 | 0 | 0 |
| `due-diligence.html` | **3** (`dd/areas, dd/vdr-links, dd/summary`) | **3** | 0 | 0 | 0 | 0 |
| `org.html` | **3** (`org/positions, org/capabilities, employees`) | **3** | 0 | 0 | 0 | 0 |
| `leaders.html` | 0 (neutral line) | 0 | 0 | 0 | 0 | 0 |
| `supporting.html` | 0 | 0 | 0 | 0 | 0 | 0 |
| `survey.html` | 0 | – | 0 | 0 | 0 | 0 |
| `playbook.html` | 0 | – | 0 | 0 | 0 | 0 |
| `insights/overview/capability-hub/integration-excellence.html` | 0 | 0 | 0 | 0 | 0 | 0 |
| `deal-wizard.html` | 0 | – | 0 (–) | 0 (–) | 0 | 0 |
| `signage.html` | **1** (`employees`) | n/a | 0 | 0 | 0 | 0 |
| Interaction: helpdesk submit | **POST 403, UI success** | | | | | |

Access map observed (`/api/auth/me`): employee all-false; pmo all-true except `hrbps`, `configWrite`; hrbp all-true except `configWrite`; admin all-true; unbound (demo-store) sessions all reads true, `configWrite` by role. Every value boolean. Demo-open: `{authEnabled:false,user:null}`.

## Checked and sound

- `accessSummaryFor(role, !!sess.dealId)` matches the gate's leniency predicate: `req.isDemo` is exactly "no deal binding" (`db/resolver.js:102-104`) and none of the 14 probe paths is control-plane, so no key disagrees with the gate for a bound session; `configWrite` is deliberately deal-independent and the write gate is too.
- `window.maCan` is false only for explicit `false`; unknown key, absent map, non-object map and a rejected probe all show everything (`.catch` at `transitions.js:1329`; vm rows cover each).
- `maAccessReady` is created synchronously in `<head>` before any page script's DOMContentLoaded, so no call site can observe it undefined; `login.html` short-circuits.
- One source of truth: the client carries no role table; every hidden control keys on a server boolean (nine keys in use, all present in `ACCESS_PROBES` + `configWrite`).
- Hiding is `hidden` + `display:none` or "not built"; no `innerHTML`/`insertAdjacentHTML` added with server data (dashboard.js change keeps `escapeHtml`; leaders.js uses `textContent`).
- The map is advisory only: every route a hidden control would have hit is refused server-side (observed 403s above) — hiding is never relied on for authorization; the map leaks booleans only.
- Session expiry mid-page: any `/api` 401 `authRequired` redirects via the fetch wrapper; `/api/auth/me` with `user:null` redirects.
- Stale `adminEditMode` is cleared for a role without `configWrite` (verified live: hrbp with the flag pre-set → `'false'`, no `cms-inline-on`).
- Deal home for an uncleared pmo member: all four panels, 0 refused requests (DD/org handlers filter by grant rather than 403).
- `inline-edit.js` `isAdmin = () => true` is gone; re-evaluated when the map settles; demo-open edits as before.
- pmo custom-setup wizard: pmo/hrbp routed to the dashboard, admin keeps the wizard; demo-open unchanged.
- `?v=` stamps: `transitions.js` on all 18 pages, `inline-edit.js` loader, `employee.js`, `pmo.js`, `deal-home.js`, `leaders.js`, `admin.js`, `admin-cms.js` all at `1791800001`.
- The two test edits are legitimate: `org-summary` re-pins to the current stamp as its own comment requires; `admin-users-ui` still asserts load order, just by regex.
- Demo-open lane: `/api/auth/me` byte-identical, leaderboard, inbox, helpdesk form, pmo switcher, IL desk, edit toggle and AI card all visible as before; 0 refused requests on `/`, `employee.html`, `pmo.html`, `dashboard.html`, `leaders.html`.
- Chatbot tools (`searchPlaybook`, `getAcquisitionProgress`) and the AI-model prompt are gated per amendments 2/3 (vm rows read the real source).

## Not covered

- Server-side correctness of the policy tables, the 404-vs-409 clean-room paths, `get-or-create` scoping and the denial-audit bound — Part A (`11-REVIEW.md`).
- CMS menu data: whether the sidebar links `due-diligence.html` / `org.html` / `execution.html` for employees in a real deal (menus are data, not code; relevant to WR-C04's reach).
- Visual layout after cards/tabs are hidden (11-08's screenshot lanes); mobile widths.
- The lesson-checkbox path (IN-C06) could not be exercised — no courses in a fresh real deal.
- The logged-in dev lane (`karen`/`pmo` accounts on the demo store) was checked only at the `/api/auth/me` level, not walked.
- `signage.html` under demo-open; `change-password.html` / `login.html` (unchanged by this phase).

_Reviewed: 2026-10-10_
_Reviewer: Claude Fable 5.1 (gsd-code-reviewer, Part B)_
_Depth: deep (code trace + isolated live Playwright walk)_
