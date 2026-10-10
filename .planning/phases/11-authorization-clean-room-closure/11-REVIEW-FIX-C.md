---
phase: 11-authorization-clean-room-closure
part: C (client findings of 11-REVIEW-CLIENT.md)
fixed_at: 2026-10-10
review_path: .planning/phases/11-authorization-clean-room-closure/11-REVIEW-CLIENT.md
base: d927233e1aba6776ebcbb223f2d4fa677357d90b
iteration: 1
findings_in_scope: 14
fixed: 10
fixed_partial: 1        # IN-C03 (rail tabs fixed; header-pill residual deferred)
accepted: 1             # IN-C05
deferred: 2             # IN-C06 -> Phase 15, IN-C07 -> CERT-03 / Phase 20
documented_only: 1      # IN-C04 (no code by decision; note for the 11-08 evidence)
status: all_addressed
suite: "node --test -> 1232 tests, 1232 pass, 0 fail (base 1181)"
---

# Phase 11: Client review fix report (FIXER C)

**Source review:** `11-REVIEW-CLIENT.md` (Fable, Part B), WR-C01..WR-C07 and IN-C01..IN-C07.
**Worktree branch:** `worktree-agent-a268a2c8f78ef18a3`, base `d927233`.
**Final suite:** `node --test` gives **1232 / 1232 pass** (the base had 1181). The suite was green at every commit. `git status --porcelain data/ public/sent_emails/` was empty at every commit.

## Disposition per finding

| Finding | Disposition | Commit | What changed |
|---|---|---|---|
| WR-C01 | **fixed: needs a human check of the reachability changes below** | `104a75e` | The page gate now uses the server-verified role. Staff loaders are gated too, as a second layer. |
| WR-C02 | **fixed** (real employee helpdesk channel **deferred to Phase 22**) | `cb68e20` | New `helpdesk` key. The form is hidden for roles that may not use it. `res.ok` decides success, otherwise an honest error is shown. |
| WR-C03 | **fixed** | `b36ce5e` | New `assessmentInstances` probe key. The per-template fetch is skipped for roles that are refused it. |
| WR-C04 | **fixed** | `104a75e` | `due-diligence.html` / `org.html` are gated on `maCan('dd'/'org')`. Both loaders wait for the access map. The stale IN-02 comments are replaced. |
| WR-C05 | **fixed** | `d2f3b25` | The `dashboard.js` stamp is bumped. Every Phase-11 client file is now in the cache-bust guard table. |
| WR-C06 | **fixed** | `3b96d69` | A live client/server key-drift row. The guard rows are anchored to the specific handler and ignore comments. |
| WR-C07 | **fixed (sender-side note)**. Employee "own messages" projection **deferred to Phase 22** | `140f8b2` | One note under each of the three recipient pickers, shown only in real-deal sessions. |
| IN-C01 | **fixed** | `0b3e068` | New `timeTravel` key. The Day pill is hidden and its click handler is guarded. |
| IN-C02 | **fixed** | `75bfc24` | The signage probe skips refused roster requests and checks `Array.isArray`. The board shows a neutral state instead. |
| IN-C03 | **fixed (rail tabs)**. Residual **deferred to Phase 15** | `6df61b5` | The config rail tabs and the Localization group start hidden. They are revealed when `configWrite` is granted. |
| IN-C04 | **documented, no code (by decision)** | — | Note for the 11-08 evidence: see "For the 11-08 evidence executor". |
| IN-C05 | **accepted** | — | Reviewer judgement stands. The `?empId=` binding is the MNPI-safe choice, and the greeting is reflected through `textContent` (no sink). The roster↔account linkage field remains future work, as 11-06 says. |
| IN-C06 | **deferred to Phase 15 (module switch)** | — | The lesson checkbox POSTs to a demo-only route. Not reachable in a fresh real deal (no courses). This belongs with the per-module enable/disable work. |
| IN-C07 | **deferred to CERT-03 / Phase 20** | — | See the reason below. |

## Fixed issues

### WR-C01: Client page gate bypassed by path-based role detection (+ ungated staff loaders)
**Files:** `public/js/transitions.js`, `public/js/admin.js`, `public/js/admin-cms.js`, `public/js/pmo.js`, `public/js/execution.js` (plus `due-diligence.js` / `org.js` under WR-C04), 18 pages (stamps), `test/client-authz-hiding.test.js`, `test/asset-cache-bust.test.js`
**Commit:** `104a75e`

**Fix applied:**
- **Authoritative check after the handshake.** Once `/api/auth/me` answers, `transitions.js` re-runs `pageAccess` with `me.user.role`, never the persona derived from the path. If the role is not allowed, it sends the user to `/` with the existing access-denied toast. The helpers `window.maPageAllowed` and `window.maDenyPage` are explicit globals.
- **Synchronous check for a returning browser.** The handshake stores `ma_auth_role_verified='1'` next to the verified `active_demo_role`. Once that flag is set, the path no longer overwrites the role, so the synchronous check redirects before any page loader runs. Demo-open (auth off), no session, and logout all clear the flag, so the showcase keeps its path-derived personas.
- **Second layer, same pattern as 11-07:** each loader waits for the access map before its first request.
  - `admin.js`: `loadAssessmentsHistory`, `loadEmployees`, `loadHrbps` and `loadCommunications` go through `whenReadable('assessmentsList'|'roster'|'hrbps'|'communications', …)`. The recipient picker only requests the directories the role is allowed to read.
  - `admin-cms.js`: projects and processes wait on `'projects'` / `'processes'`.
  - `pmo.js`: `loadPmoCommunications` waits on `'communications'`. A refused role loses the ledger card.
  - `execution.js`: the first load waits on `'tasks'`. This closes the reviewer's "fresh context: employee → execution.html, 5 × 403" case.
- No new probe keys were needed: `projects`, `processes` and `assessmentsList` already existed in `ACCESS_PROBES`. No `ROLE_READ_POLICY` / `ROLE_WRITE_POLICY` row was touched.

**Tests:** vm rows run the real page-gate block and the handshake together:
- employee and pmo are sent home from `admin.html`; employee is sent home from `pmo.html`;
- the intended roles stay;
- a returning employee or hrbp is redirected synchronously;
- demo-open is unchanged and the stale flag is cleared.

There are also loader rows for `admin.js`, the admin recipient picker, `admin-cms.js`, the `pmo.js` ledger and `execution.js`.

**Mutation checks (each turned rows red):**
- removing the handshake gate (2 rows);
- forcing the path derivation back on (1 row);
- ungating `whenReadable` (1 row);
- ungating `execution.js` (1 row).

**Needs a human check — reachability changes.** I followed the decision as written ("redirect when the verified role is not in `pageAccess[page]`"). For the five pages whose role used to come from the path (`admin`, `pmo`, `dashboard`, `supporting`, `employee`.html), the existing `pageAccess` entries are now enforced for logged-in sessions. The live walk measured these redirects for verified roles:

| Role | Newly sent home from | Previously |
|---|---|---|
| employee | `dashboard.html`, `supporting.html` (plus `pmo.html`, `admin.html`, which is the actual fix) | reachable; 0 refused requests on dashboard/supporting |
| pmo | `admin.html` (the fix) | reachable, 1 × 403 |
| hrbp (Integration Leader) | `employee.html`, `pmo.html`, `supporting.html` | reachable, 0 refused requests |

These match the sidebar each role already gets (`portalItemsByRole`: hrbp → dashboard only, employee → employee only). They do change what the IL can open by URL or from the role-showcase cards.

To reverse any one of them, add the role to that page's `pageAccess` entry in `transitions.js`. That has **no effect on the demo showcase**, because those five entries always pass for demo personas (the role is derived from the page itself). The same applies to the logged-in demo store (`karen` / `pmo` dev accounts). Please confirm, or name the roles to add back.

### WR-C02: Employee HR-helpdesk ticket shows "Inquiry Received!" after a server 403
**Files:** `server.js` (`GET /api/auth/me` only), `public/js/employee.js`, `public/employee.html` (stamp), `test/client-authz-hiding.test.js`
**Commit:** `cb68e20`

**Fix applied:**
- The access map gains `helpdesk: roleAllowedForWrite(role, '/api/communications/send', 'POST')`. It reads the same write table the gate uses, so it is false for an employee in every mode.
- `#helpdesk-section` (the card holding `#hr-inquiry-form`) is hidden when `!maCan('helpdesk')`.
- The submit handler is now `submitHelpdeskTicket`:
  - it shows success only when `res.ok`;
  - 403, 409, 503 (after the Phase-8 retries) and network failures keep the form and the typed question, re-enable the button, and show a `role="alert"` line (`textContent`): "Your question could not be sent — please contact your Integration Leader directly."
- Demo-open (no access map, POST allowed) keeps the success path.

**Deferred:** the real employee helpdesk channel (a self-service write that takes the sender from the session) is **Phase 22**.

**Tests:**
- server row: employee false (real deal and demo store), staff true, and the employee's POST really gets 403;
- vm rows: 403/409/503/network never show success, 200 does, and the card hides on `helpdesk:false`;
- source row: `.finally(` is gone.

**Mutation checks (each turned rows red):** removing the `res.ok` check (2 rows), dropping the card gate (1 row), forcing the server key to `true` (1 row).

### WR-C03: `assessments.html` fires three refused `/api/assessment-instances` requests per load
**Files:** `lib/readPolicy.js` (`ACCESS_PROBES` only), `public/js/assessments.js`, `public/assessments.html` (stamp), test
**Commit:** `b36ce5e`

**Fix applied:**
- New key `assessmentInstances: '/api/assessment-instances'`. It maps to the existing admin-only rule; no rule was changed and the read rule was **not** widened.
- `loadAll()` waits on `maCanReady('assessmentInstances')`. A refused role (hrbp/pmo in a real deal) issues no instance request and falls back to the status-rollup view.

**Tests:** a server row (key equals `role === 'admin'`; hrbp gets 403 on the route) and a vm row (no request, rollup fallback; admin and demo-open still fetch both templates). Mutation-checked.

**Open question for the orchestrator (no change made):** should the IL see instance trends ("hrbp all deal data")? If so, the rule would need to widen to `LEAD_ROLES`. That is a server-policy decision outside my scope, and the 11-08 drift test pins the rows.

### WR-C04: `due-diligence.html` / `org.html` have no page gate
**Files:** `public/js/transitions.js` (`pageCapability`), `public/js/due-diligence.js`, `public/js/org.js`, stamps, tests
**Commit:** `104a75e` (grouped with WR-C01: same gate)

**Fix applied:**
- `pageCapability = { 'due-diligence.html': 'dd', 'org.html': 'org' }` is evaluated in `maPageAllowed`. An employee (dd/org refused) is sent home with the access-denied message.
- pmo, both cleared and uncleared, keeps the page. The server filters per area.
- Both page scripts wait on `maCanReady('dd')` / `maCanReady('org')` before their first request, so a redirected page sends nothing.
- The two IN-02 comments are replaced with the current reasoning.

**Tests:** vm rows (employee redirected; pmo, hrbp, admin and demo-open stay; the whole DD/org scripts send zero requests for an employee and the expected requests for pmo and demo-open) and a source row (stale wording gone). Mutation-checked through the handshake-gate mutation.

### WR-C05: `dashboard.js` changed without a `?v=` bump; the guard does not track it
**Files:** `public/dashboard.html`, `test/asset-cache-bust.test.js`
**Commit:** `d2f3b25`

**Fix applied:**
- `dashboard.js?v=1784700001` is now `1791800101`.
- `FROZEN` gains dashboard, employee, pmo, deal-home, leaders, admin, admin-cms, inline-edit, assessments and signage. Each has its v2.1.0 stamp and the stamp(s) just before Phase 11 as floors.
- The floors for transitions, DD, org and execution were raised to the 11-07 / 63bb2af values these fixes replaced.
- A header note says every client file a phase touches must be added to the table in the same commit, until Phase 12's content-hash stamping replaces it.

**Mutation check:** reverting the dashboard stamp turns the row red.

**Stamp policy used:** every `public/js/*.js` file I changed carries `?v=1791800101` on every page that loads it. Files changed by several of my commits were bumped once, relative to the base.

### WR-C06: The suite cannot detect client/server capability-key drift; two rows weakly anchored
**Files:** `test/client-authz-hiding.test.js`
**Commit:** `3b96d69`

**Fix applied:**
- **New row:** it collects every literal passed to `maCan`, `maCanReady`, `canReady`, `canNow`, `readable`, `whenReadable` and `maHideUnless`, plus every `access.X === false`, across `public/js/*.js`. Each one must be a key the server actually serves: the live `/api/auth/me` for an admin bound to a real deal. The served map must equal the read probes plus `configWrite`, `helpdesk` and `timeTravel`.
- **Re-anchored rows:**
  - `guardBefore` (pmo.js, amendment 2) and `guarded` (admin.js, item 8) now take the specific handler opening (for example `specsForm.addEventListener('submit'`), require it to be unique, and brace-match its body.
  - Comments are stripped (string-aware) before searching. A guard that sits in a comment, or anywhere earlier in the file, no longer satisfies them.

**Mutation checks:**
- renaming probe `dd` → `ddArea` in `readPolicy.js`: only the new row fails, which shows the gap was real;
- commenting out the pmo wizard guard: the re-anchored row fails, where the old one would have passed.

### WR-C07: Targeted comms to real-deal employees are invisible to them
**Files:** `public/js/transitions.js`, `public/js/dashboard.js`, `public/js/pmo.js`, `public/js/admin.js`, test
**Commit:** `140f8b2`

**Fix applied:**
- `window.__portalDealId` comes from `me.dealId`.
- `window.maAddEmployeeInboxNote(anchor)` adds the line "Employees can't read in-app messages yet." once per composer:
  - only when the session is bound to a real deal;
  - via `textContent`, with `data-i18n="comms.employee_inapp_unavailable"`. There is no dictionary entry yet; the English text stays as the fallback until a translation is added through the existing i18n editor.
- Each site is one line under the recipient-type select: the IL desk (`dashboard.js`), the PMO desk (`pmo.js`) and the admin dispatcher (`admin.js`). That is well under the 12-line budget.
- Demo store and demo-open show nothing.

**Deferred:** the employee "own messages" projection (`GET /api/communications/mine`) goes to **Phase 22**.

**Tests:** a vm row (real deal shows exactly one note, as text; demo store and demo-open show none) and a source row (the three call sites). Mutation-checked.

### IN-C01: Day pill / Time Machine shown in real deals
**Files:** `server.js` (`/api/auth/me`), `public/js/transitions.js`, test
**Commit:** `0b3e068`

**Fix applied:**
- `timeTravel: !sess.dealId && roleAllowedForWrite(role, '/api/settings/time-travel', 'POST')`. This is the same `DEMO_ONLY_PREFIXES` plus write-table decision the gate makes.
- New explicit global `window.maHideUnless(key, el)`. The pill is hidden where it is mounted, and a day click returns early without `timeTravel`.
- Demo-open has no map, so the pill is unchanged. On the logged-in demo store, admin/hrbp/pmo keep it. **A logged-in demo employee now loses it**: their POST was always a 403 (the employee is not on the write rule).

**Tests:**
- server row: false for every role in a real deal; true on the demo store except for the employee; a deal-bound admin's POST gets 403;
- vm and source rows.

**Mutation check:** forcing the key to true fails the server row.

### IN-C02: `signage.html` returns 403 and throws for an employee
**Files:** `public/js/signage.js`, `public/signage.html` (stamp), test
**Commit:** `75bfc24`

**Fix applied:**
- The kiosk calls the public `/api/auth/me` itself and skips `GET /api/employees` when `access.roster === false`.
- A non-OK response, a failed request or a non-array body returns `null` and is never iterated.
- In that case the board shows a neutral state: em-dash statistics, a `textContent` line "Leaderboard not available.", and the calendar and events still render.
- Demo-open is unchanged.

**Tests:** vm rows for a refused map (no request, neutral board, no error), a 401 or non-array body (nothing thrown) and demo-open (same as today). Mutation-checked for both the probe and the `Array.isArray` guard.

### IN-C03: Flash before the config tabs hide (rail tabs)
**Files:** `public/admin.html`, `public/js/admin.js`, test
**Commit:** `6df61b5`

**Fix applied:**
- The seven config/content rail tabs and the all-config Localization group now ship with `data-config-only style="display:none;"`.
- `revealConfigTabs()` shows them when `maCanReady('configWrite')` is true (admin, demo-open), or immediately when no map helper exists.
- The existing `applyConfigWriteGate` wiring line is unchanged.

**Tests:** a source row (exactly the config tabs and the group are hidden by default; the kept tabs are not) and a vm row (revealed for admin and demo-open, still hidden for hrbp).

**Residual, deferred to Phase 15 (module switch, which reworks admin-console visibility):** the header pills (`#demo-mode-switcher-container`, `#edit-mode-switcher-container`, with inline `display:flex` that other code drives) and the cards inside the Settings tab, which is not active at load, keep the one-round-trip flash. A click in that window still goes to a guarded handler, and the server refuses it either way.

## Not fixed in code

### IN-C04: Logged-in demo store hides config controls from hrbp/pmo
By decision there is no code change: this is D-11-02, and the client is consistent with the server. The full note is in the 11-08 hand-off section below.

### IN-C05: `?empId=` binding change
**Accepted.** The reviewer verified it is the MNPI-safe choice and that nothing real-deal was lost.

### IN-C06: Academy lesson checkboxes POST a demo-only route
**Deferred to Phase 15 (module switch).**
- **Reason:** it cannot be reached in a fresh real deal (no courses). The fix belongs to the per-module enable/disable work: the academy is a demo-mechanics module there.

### IN-C07: Demo-open `admin.html` redirects to `/login.html`
**Deferred to CERT-03 / Phase 20 (release certification).**
- **Reason:** this predates Phase 11 (present at `63bb2af`). `/api/deals` is a control-plane route and is never open. Fixing it means deciding how the demo lane presents the admin console: either skip `loadDeals()` in demo-open, or stop the fetch wrapper's 401 redirect for that one call. That is a demo-lane presentation decision for the release-certification walk, not an authorization defect.
- The live walk confirms it is the **only** refused request left in the whole matrix.

## Live confirmation (Playwright, isolated)

**Setup:**
- one process;
- every `MA_*` path in a fresh temp directory, built from `db.json` with the suite's own migrate/split recipe; committed `data/*.db` never opened, temp directory removed afterwards;
- one real deal with five bound sessions: admin, hrbp, pmo (hr+it), pmo without clearance, and employee (granted `hr`);
- Chromium headless (the npx-cache Playwright), 19 pages.

**Lanes:**
- each role on each page in a **fresh** context (first-ever visit);
- each role in a **persistent** context (`/` first, then every page);
- an anonymous **demo-open** lane on 10 pages.

**Result:**
- **205 visits.**
- **Exactly 1** visit had a refused `/api` request: `[demo-open] admin.html → /login.html: GET /api/deals 401`. That is IN-C07, deferred.
- **0** page errors.
- employee on `admin.html`, `pmo.html`, `due-diligence.html`, `org.html` and `execution.html`: redirected to `/` with **zero refused requests**, in both fresh and persistent contexts.
- pmo on `admin.html`: redirected with zero refused requests.
- pmo and uncleared pmo keep `pmo.html`, `execution.html`, `due-diligence.html` and `org.html` with zero refused requests.
- `assessments.html` for hrbp/pmo: zero refused requests (was 3 each).
- `signage.html` for employee: zero refused requests (was 1, plus a TypeError).
- Helpdesk card: hidden for the employee, visible for pmo/admin and in demo-open.
- Day pill: visible in 0 real-deal visits and in all 9 demo-open visits that mount it.

## For the 11-08 evidence executor (IN-C04 and related)

**Logged-in demo store (dev lane, `karen` / `pmo` accounts, not `DEMO_OPEN`):** compared with the open showcase, these now follow the server tables. All are consistent with D-11-02 and the write table.
- No config tabs, settings cards, CMS editors or inline "Edit Content" for `karen` (hrbp) or `pmo`.
- No demo-mode switcher on `pmo.html` for `pmo`.
- A logged-in demo **employee** has no helpdesk card (their POST is refused) and no Day pill (their time-travel POST is refused).
- Page reachability follows the verified role (WR-C01 table above): `karen` cannot open `employee.html`, `pmo.html` or `supporting.html`, and `pmo` cannot open `admin.html`.
- **The demo-open lane is unchanged.** Have the demo-lane screenshots exercise the logged-in dev lane too, so the user sees this before release.

**IN-C07:** `admin.html` in demo-open redirects to `/login.html`. This predates Phase 11; do not attribute it to this phase.

**Access map keys:** `/api/auth/me` `access` now also carries `helpdesk` and `timeTravel` (write capabilities) and `assessmentInstances` (read probe). If DEPLOYMENT.md "Roles and what they can read" lists the access map, add them. No `ROLE_READ_POLICY` / `ROLE_WRITE_POLICY` row was changed.

## Edits to existing tests (named, none weakened)

- **`test/asset-cache-bust.test.js`**: `FROZEN` gained 10 assets, and the floors of transitions, execution, org and due-diligence were raised. Strictly stronger.
- **`test/client-authz-hiding.test.js`**:
  - the `amendment 2 (source)` and `item 8 (source)` rows were re-anchored on the specific handler with comments stripped. Strictly stronger: the same five plus three guards are still asserted.
  - All other additions are new rows; no existing assertion was relaxed.
- No other existing test file was edited. Phase 8/9/10 suites pass unchanged.

## Hand-offs to FIXER S (files I did not touch)

- **`public/js/deal-home.js`** is now in the cache-bust guard table, with floor 1784700004 and current stamp 1791800001. If the deal-record projection changes it, bump its stamp on `dashboard.html` past 1791800001 and update the `org-summary.test.js` pin, as 11-07 did.
- **`server.js`**: I edited only the `GET /api/auth/me` handler (the `helpdesk` and `timeTravel` keys and their comment). A merge with FIXER S's server changes should not overlap that region.
- No other server-side edit is needed for these findings.

## Environment note

During the WR-C02 mutation checks the disk filled up (ENOSPC, 0 bytes free). One mutation run could not restore `public/js/employee.js`, leaving the `gateHelpdesk` body empty. I noticed it right away and restored the line by hand. I then confirmed the file is intact, re-ran the mutation and the suite, and only then committed `cb68e20`. No corrupted content was committed.

The space is held by `$TMPDIR/gsd-soak-szcBuT` (5.4 GB, a stale soak run) and `$TMPDIR/jest_dx` (4.2 GB). Neither is mine and I deleted neither; the only temp directory I removed was my own leftover test directory. Please clear them if they are no longer needed.

---

_Fixed: 2026-10-10_
_Fixer: Claude (gsd-code-fixer, FIXER C)_
_Iteration: 1_
