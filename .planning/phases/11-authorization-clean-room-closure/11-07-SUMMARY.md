---
phase: 11-authorization-clean-room-closure
plan: 07
subsystem: auth
tags: [authorization, client, capability-map, ux, read-policy, config-surface, vanilla-js, node-test, node-vm]

requires:
  - phase: 11-authorization-clean-room-closure
    provides: "11-01 lib/readPolicy.js accessSummaryFor + ROLE_READ_POLICY; 11-02 admin-only config writes + public settings subset; 11-05 role-aware pulses/notifications; 11-06 POST get-or-create"
provides:
  - "access map on the authenticated GET /api/auth/me (read keys from lib/readPolicy.js + configWrite from ROLE_WRITE_POLICY)"
  - "window.maCan(key) / window.maAccessReady / window.maCanReady(key) in transitions.js"
  - "every client control that would answer 403 in a real deal is hidden (list below), demo store and demo-open unchanged"
  - "test/client-authz-hiding.test.js (server map rows + node:vm client rows per hidden control)"
affects: [11-08, 12, 15]

tech-stack:
  added: []
  patterns:
    - "server-computed capability map consumed by the vanilla client; absent map = show everything (demo-open / demo store)"
    - "hide-and-skip: wait on window.maAccessReady, then neither render the control nor send the request (never a disabled control that still fires)"
    - "client tests: pull the REAL function source out of a client file by name (brace matcher) and run it in node:vm against a recording fake DOM + fetch"

key-files:
  created:
    - test/client-authz-hiding.test.js
  modified:
    - server.js
    - lib/readPolicy.js
    - public/js/transitions.js
    - public/js/employee.js
    - public/js/pmo.js
    - public/js/deal-home.js
    - public/js/leaders.js
    - public/js/admin.js
    - public/js/admin-cms.js
    - public/js/inline-edit.js
    - public/*.html (stamps)
    - test/org-summary.test.js
    - test/admin-users-ui.test.js

key-decisions:
  - "The access map rides only the AUTHENTICATED /api/auth/me response; demo-open and no-session responses are byte-identical to before"
  - "dealBound for the map = !!sess.dealId, the gate's own demo-store leniency predicate; configWrite always follows ROLE_WRITE_POLICY (admin-only) even on the demo store, because 11-02 refuses non-admin config writes there too"
  - "Hide, never disable: a refused role gets no element and no request; a missing/failed probe leaves everything shown (maCan is false only for an explicit false)"
  - "A role without configWrite is routed from the pmo custom-setup wizard straight to the dashboard (its first step could only 403)"
  - "The admin Settings & Survey tab stays (the survey blueprint is lead-writable); only the configuration cards inside it are hidden"

requirements-completed: [AUTHZ-01, AUTHZ-02]

duration: ~95min
completed: 2026-10-10
status: complete
actuals:
  tokens: 25600   # chars/4 over the realized diff (102,399 chars)
  tasks: 3
  commits: 3

coverage:
  - deliverable: "access map on /api/auth/me derived from readPolicy + ROLE_WRITE_POLICY"
    verification:
      - { kind: test, ref: "test/client-authz-hiding.test.js#tracer: /api/auth/me carries the server-computed access map per role in a real deal", status: pass }
      - { kind: test, ref: "test/client-authz-hiding.test.js#the map is derived from lib/readPolicy.js", status: pass }
    human_judgment: false
  - deliverable: "employee / pmo / deal-home / transitions controls hidden and requests skipped"
    verification:
      - { kind: test, ref: "test/client-authz-hiding.test.js#item 2..7 (vm) rows", status: pass }
    human_judgment: false
  - deliverable: "admin console + inline editing hidden for roles without configWrite"
    verification:
      - { kind: test, ref: "test/client-authz-hiding.test.js#item 8 / item 9 rows", status: pass }
    human_judgment: false
  - deliverable: "visual result in a real browser (layout after cards/tabs are hidden)"
    human_judgment: true
    rationale: "Hidden cards and rail groups change layout; no test asserts the rendered look. Plan 11-08's demo/real lanes screenshot it."
---

# Phase 11 Plan 07: Client capability hiding driven by a server-computed access map Summary

**GET /api/auth/me now returns a server-computed `access` map (reads from lib/readPolicy.js, `configWrite` from ROLE_WRITE_POLICY) and every client control that a real-deal role would only get a 403 from is hidden and its request never sent; the demo store and demo-open render exactly as before.**

## Performance

- **Tasks:** 3 of 3 (Task 1 tracer, Tasks 2 and 3 TDD)
- **Commits:** 3 task commits, suite green at each (1124 at base, 1133, 1149, 1158 at head)
- **Files:** 1 new suite, 12 client/server files modified, 18 HTML pages re-stamped

## Accomplishments

- **One source of truth.** `server.js` `GET /api/auth/me` adds `access: { ...readPolicy.accessSummaryFor(role, !!sess.dealId), configWrite: roleAllowedForWrite(role, '/api/settings', 'POST') }` to the authenticated response only. The browser carries no copy of the role table; `window.maCan(key)` is false only for an explicit `false`, so an absent map (demo-open, demo store, failed probe, page without the handshake) shows everything.
- **Tracer proven end to end first** (employee leaderboard hidden, no `GET /api/employees`; demo-open and hrbp still render it) before the expansion tasks; the automated verify and the full suite (1133/1133) passed, per the dispatch's gate policy.
- **Every hiding row asserts both halves** — the element is hidden/not built AND no request was sent — against the real function source run in `node:vm`. Mutation spot-checks (removing a guard) turn the matching rows red.
- **Demo untouched.** With no map every `maCan` is true; demo-open `/api/auth/me` is byte-identical (asserted); an unbound session on the demo store gets every read key true.

## Task Commits

1. **Task 1 (tracer): access map on /api/auth/me, window.maCan, employee leaderboard** — `6c8d985`
2. **Task 2: employee and pmo persona controls (items 2–7 + amendments 2 and 3)** — `1e2fdcb`
3. **Task 3: admin console and inline editing (items 8–9)** — `d7074be`

## Final hidden-control list

`maCan` key = the `access` map key that decides it. "Request not sent" = the route the control would have hit.

| # | File | Control / selector | Key | Route avoided |
|---|------|--------------------|-----|---------------|
| 1 | employee.js `loadLeaderboard` | `#academy-leaderboard-container` → its `.card` ("Acquired Team Leaderboard"), `hidden` + `display:none` | `roster` | GET /api/employees |
| 2a | employee.js `loadEmployeeNotifications` | `#employee-notifications-area` (banner list) | `communications` | GET /api/communications |
| 2b | employee.js `loadEmployeeNotifications` | `#employee-communications-inbox` → its `.card` ("Digital Broadcast Archive") | `communications` | GET /api/communications |
| 3 | employee.js | `#welcome-video-edit-form` submit handler inert (the pen `#edit-welcome-video-pen` is already hidden and unbound since Phase 4 — not re-shown) | `configWrite` | POST /api/settings |
| 4 | pmo.js `loadActiveHrbps` | `#pmo-hrbps-list` → its `.card` ("Integration Leader Role Provisioning Desk", holds `#pmo-hrbp-provision-form` and the delete buttons); `deleteHrbp` and the provision-form submit guarded | `hrbps` | GET/POST/DELETE /api/hrbps |
| 4b | pmo.js `loadWizHrbpsList` + `#wizard-form-hrbp` submit | wizard directory list / add form inert | `hrbps` | GET/POST/DELETE /api/hrbps |
| 4c | pmo.js `loadPmoRecipientOptions` | `#pmo-comm-recipient-select` requests roster / directory only if allowed (a refused one is an empty group) | `roster`, `hrbps` | GET /api/employees, GET /api/hrbps |
| 5 | transitions.js `loadActiveHRBP` | profile-dropdown Integration Leader lookup (`#dropdown-profile-name/-email/-tracks`, `#switch-user-btn`) | `hrbps` | GET /api/hrbps |
| 6a | transitions.js `initializeAiInsightInsight` → `renderAiInsightCard` | `#smol-agent-insight-card` is not built | `ai` | GET /api/ai/insight |
| 6b | transitions.js `GlobalAiInsight.tools.searchPlaybook` | chat still answers; neutral line, no snippets | `rag` | GET /api/rag/search |
| 6c (amend. 3) | transitions.js `GlobalAiInsight.tools.getAcquisitionProgress` | neutral "not available for your role" line — never "Roster is empty" | `roster` | GET /api/employees |
| 7 | deal-home.js `renderDealHome` (`#deal-home`) | "Diligence progress" panel | `dd` | GET /api/dd/summary |
| 7 | deal-home.js | "Organisation" panel + flight-risk nudge | `org` | GET /api/org/summary |
| 7 | deal-home.js | stale-synergy nudge | `synergies` | GET /api/synergies/rollup |
| 8 | admin.js `applyConfigWriteGate` | `.admin-tab-btn[data-tab=courses|slides|pages|translations|menus|banners|media]` and panels `#tab-courses` … `#tab-media`; rail group "Localization" (left empty) | `configWrite` | POST/DELETE /api/courses, /api/slides(+upload), /api/pages, /api/i18n, /api/menus, /api/banners, /api/media |
| 8 | admin.js | `#settings-form` → its `.card` (company profile, AI key, welcome video), `#admin-role-visibility-card`, `#admin-custom-ma-card`, `#admin-db-migration-card` | `configWrite` | POST /api/settings, POST /api/settings/new-ma, POST /api/admin/migrate-db |
| 8 | admin.js | `a[href="/api/admin/download-zip"]` → its `.card` ("Portable IMO App Package") | `configWrite` | GET /api/admin/download-zip (admin-only) |
| 8 | admin.js | header pills `#demo-mode-switcher-container`, `#edit-mode-switcher-container`; a stale `adminEditMode` flag is cleared; a console restored onto a hidden tab falls back to Projects | `configWrite` | POST /api/settings |
| 8 | admin-cms.js DOMContentLoaded | slides / courses / pages / menus / banners editors are not built (projects, departments, processes still load) | `configWrite` | — |
| 9 | inline-edit.js `isAdmin` | click-to-edit of `[data-i18n]` text and the `[data-cms-region]` page bar; the old always-true arrow is gone; re-evaluated when the map settles | `configWrite` | POST /api/i18n, POST /api/pages |
| 9 | transitions.js | `#inline-edit-toggle` ("Edit Content") wrapper hidden app-wide | `configWrite` | — |
| A2 | pmo.js | `#demo-mode-switcher-container` hidden + click guarded (demo-mode POST) | `configWrite` | POST /api/settings |
| A2 | pmo.js `loadPageSettings` | custom-setup wizard (`#pmo-onboarding-wizard`) not routed to; dashboard shown instead. `#wizard-form-specs` submit and `#btn-wiz-finalize` (pmoCustomSetupComplete) guarded | `configWrite` | POST /api/settings |
| A2 | pmo.js `#btn-wiz-finalize` | roster upload loop (`parsedRoster`) follows the roster rule | `roster` | POST /api/employees |
| A2 | transitions.js `checkAndShowAiInsightModal` / `saveSettingsAndComplete` | AI-model setup prompt (`#ai-insight-modal`) is not shown; the `{browserModel}` POST is never sent | `configWrite` | POST /api/settings |
| extra | leaders.js `loadLeaderDashboard` | `#direct-reports-roster` gets a neutral line instead of a failed request | `roster` | GET /api/employees |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] leaders.html roster call (not on the plan list)**
- **Found during:** Task 2 (consumer audit: grep of every `fetch('/api/<refused family>')` in `public/`)
- **Issue:** `public/js/leaders.js` calls `GET /api/employees` on a page with no role gate (`pageAccess` has no `leaders.html` entry), so an employee in a real deal would get a refused request and a "Failed to connect with acquired staff roster" error.
- **Fix:** wait on `maCanReady('roster')`; a refused role gets a neutral line and no request. Demo-open loads as before (asserted).
- **Files:** public/js/leaders.js, public/leaders.html (stamp) — **Commit:** `1e2fdcb`

**2. [Rule 3 - Blocking] Two existing tests pinned a stamp literal this plan had to change**
- **Found during:** Task 2 (full suite) and Task 3
- **Issue:** `test/org-summary.test.js` asserted `deal-home.js?v=1784700004` (its own comment says it tracks the CURRENT stamp); `test/admin-users-ui.test.js` located `admin.js?v=1791700202` by literal.
- **Fix:** org-summary pin moved to the new stamp; admin-users-ui now locates the admin.js tag by regex, so it no longer depends on the value. No assertion weakened.
- **Commits:** `1e2fdcb`, `d7074be`

**3. [Interpretation] Item 3 (welcome-video edit control)**
- The pen `#edit-welcome-video-pen` has been force-hidden and its click binding is `if (false && …)` since Phase 4; the editor is already unreachable. Showing it to an admin would change the showcase, so it is left hidden and only its save is guarded (`window.maCan('configWrite')` before the `POST /api/settings`). Asserted at source level (the handler is a closure inside `DOMContentLoaded`).

**4. [Interpretation] Item 6 (AI insight) split into a gate and a renderer**
- `initializeAiInsightInsight()` now only resolves the portal and waits on `maCanReady('ai')`; the card build moved unchanged into `renderAiInsightCard(portal)`. Behaviour for an allowed role is identical.

**5. [Interpretation] Amendment 2, the AI-model download flow**
- The plan wording says hide/disable the `{browserModel}` POST. The whole setup prompt is not shown to a role without `configWrite` (it could only fail and would re-appear every session), and `saveSettingsAndComplete` additionally refuses to send the POST.

**6. [Addition] `window.maCanReady(key)`**
- A one-line convenience (`maAccessReady.then(() => maCan(key))`) beyond the plan's `maCan` + `maAccessReady`, used by every call site so each does not repeat the wait.

**Total deviations:** 1 auto-added (Rule 2), 1 blocking fix (Rule 3), 4 interpretation notes. **Impact:** none on scope; the leaders.js addition is a one-function change.

## Findings beyond this plan (hand-offs, nothing silently fixed)

- **Employee HR helpdesk ticket form** (`employee.js`, `#hr-inquiry-form` → `POST /api/communications/send`): the write policy has never allowed `employee` (DEFAULT_WRITE_ROLES), so in a real deal the request is a 403, and the handler's `.finally` still shows the success message — a false "ticket filed". This is pre-existing (not caused by Phase 11) and was not on the plan list; it needs a product decision (a self-service allowlist entry vs removing the form). Candidate for 11-08 or the next phase.
- **`due-diligence.html` and `org.html` have no page-level role gate** (transitions.js IN-02 comments: DD/org access was designed around per-deal-member clearance). 11-01's read matrix refuses `employee` `/api/dd` and `/api/org`, so a granted employee member now lands on a page whose every call 403s. Page-level hiding was out of this plan's list; the pages are not touched.
- **`public/js/signage.js`** (kiosk, loads no transitions.js, so no access map) calls `GET /api/employees`; left as is.
- **WINDOWS.md ledger:** not appended from this worktree (a sibling executor shares the file; the orchestrator can fold the two items above into the ledger when it merges).

## Known Stubs

None.

## Threat Flags

None — the map adds booleans to an existing authenticated response; no new endpoint, auth path or file access. T-11-61 (role matrix inferable from the map) is the plan's accepted disposition.

## Threat model status

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-11-60 client hiding mistaken for enforcement | mitigate | Every hidden route stays refused server-side (11-01/02/05/06 suites, unchanged and green); the map is derived from the same tables and never sent back |
| T-11-61 access map reveals the role matrix | accept | Booleans only, asserted per key in the server rows |
| T-11-62 new hiding code introducing HTML sinks | mitigate | Hiding via `hidden`/`style.display` only; no new innerHTML/insertAdjacentHTML; `client-xss-sinks` green |
| T-11-63 demo showcase regression | mitigate | Absent map ⇒ `maCan` true; demo-open `/api/auth/me` asserted byte-identical; every vm row has a demo-open/admin "still renders" twin |

## Verification

- Plan suites: `node --test test/client-authz-hiding.test.js test/asset-cache-bust.test.js test/client-account-surfaces.test.js test/client-xss-sinks.test.js` — green.
- **Full suite: `node --test` → 1158 tests, 1158 pass, 0 fail** (base 1124; +34 in the new file).
- Acceptance: `grep -c "isAdmin = () => true" public/js/inline-edit.js` = 0; `accessSummaryFor` in server.js = 1; `maCan(`/`maCanReady(` present in employee.js, pmo.js, deal-home.js, transitions.js.
- `git status --porcelain data/ public/sent_emails` empty; no STATE.md / ROADMAP.md changes.

## Self-Check: PASSED

- test/client-authz-hiding.test.js present; commits `6c8d985`, `1e2fdcb`, `d7074be` present on the worktree branch.
- Stamp discipline: transitions.js, employee.js, pmo.js, deal-home.js, leaders.js, admin.js, admin-cms.js, inline-edit.js all carry `?v=1791800001` on every page that loads them; `test/asset-cache-bust.test.js` green.
