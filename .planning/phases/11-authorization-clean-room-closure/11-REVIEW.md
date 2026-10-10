---
phase: 11-authorization-clean-room-closure
reviewed: 2026-10-10T15:25:00Z
depth: deep
part: A (server-side, plans 11-01..11-06)
base: 63bb2af
head: 91cabc2
reviewer: Claude Fable 5.1 (gsd-code-reviewer, adversarial second opinion)
suite_baseline: 1147/1147 pass (node --test, 55 s)
files_reviewed: 24
files_reviewed_list:
  - server.js
  - lib/readPolicy.js
  - lib/denialAudit.js
  - lib/pulseView.js
  - lib/credentialLockdown.js
  - lib/requestPath.js
  - db/collections.js
  - db/store.js
  - db/resolver.js
  - db/controlStore.js
  - db/accessPolicy.js
  - validators/people.js
  - validators/settings.js
  - validators/wizard.js
  - validators/workstream.js
  - DEPLOYMENT.md
  - test/clearance-write-paths.test.js
  - test/read-policy-matrix.test.js
  - test/read-policy-coverage.test.js
  - test/denial-audit.test.js
  - test/no-get-mutates.test.js
  - test/get-or-create-post.test.js
  - test/helpers/deal-fixture.js
  - test/helpers/route-inventory.js
findings:
  critical: 1
  warning: 4
  info: 5
  total: 10
status: issues_found
---

# Phase 11 (Part A — server side): Adversarial Code Review

**Scope:** `git diff 63bb2af..91cabc2 -- . ':!.planning' ':!node_modules'`, server-side surface of plans 11-01..11-06
(consolidated `/api` gate + `ROLE_READ_POLICY`, admin-only config + public settings subset + deal setup route,
`assertRecordVisibleOr404` / `RecordNotFoundError` on task/RAID/synergy/convert/delete paths, get-or-create → POST,
rate-bounded denial audit, pulses/notifications projection, store/collections backstop, validators, DEPLOYMENT.md, tests).
`/api/auth/me`, client code and plans 11-07/11-08 are Part B.
**Contracts judged against:** PHASE-11-PRD.md (D-11-01..07, acceptance 1–6), 11-CONTEXT.md, 11-AMENDMENTS.md (1–7),
11-01..06 PLAN/SUMMARY, REQUIREMENTS AUTHZ-01..05, R1-02/R1-05/R1-15, 09-SECURITY UF-1/UF-2, 10-REVIEW CR-01.
**Method:** every finding below marked VERIFIED was reproduced on an isolated instance (fresh `mkdtemp` MA_CONTROL/RUNTIME/DEMO/
AUDIT/DEALS paths, `createDealFixture`, port 0 on 127.0.0.1, server closed afterwards; committed `data/*.db` never opened,
`POST /api/settings/new-ma` never called). PLAUSIBLE = code trace only.

## Executive verdict

The mechanisms the phase set out to build are real and mostly sound: the read gate is canonical-path-anchored and fail-closed
(every variant spelling I tried — case, `;param`, `%73`, `//`, trailing slash, OPTIONS/HEAD — got the same 403), the by-id
clean-room guard sits before `conflictIfStale` on every task/RAID write/delete/convert path and answers a byte-identical 404
(body and headers) for missing and invisible records with no measurable timing difference, the config surface is admin-only
under every spelling, the settings subset is a true allowlist, get-or-create is a POST that ignores a supplied `empId`, and
the denial auditor really does fold 25 probes into one row.

**But the phase does not meet AUTHZ-01 / acceptance 1.** The one read rule written as "already filtered" — `GET /api/deals`
(ALL roles, exact) — returns the **unprojected control-plane deal record** to an `employee` member: `setup.steps.basics.data`
with **`dealSizeM`, `signingDate`, `expectedClose`**, the IL's new **`dealSettings.synergyTargetM`** (added by this very phase),
plus `members[]`, `memberGrants` (who is cleared for which clean-room area) and who ran each wizard step. `POST /api/deals/select`
echoes the same record. That is a pre-announcement valuation and a synergy financial handed to the lowest-privilege role in a
real deal — exactly the MNPI class the project constraints name — and the matrix test only asserts `200` for that route, so the
green suite could not see it. **CR-01 must be fixed before this phase closes.**

Two HIGH items are also real: the DD and org by-id refusals still write **one permanent audit row per request** (25 probes → 25
rows), so the D-11-05 flood bound covers the gate but not the clearance denials that are easiest to trigger; and an uncleared
member can **plant** a task/RAID with a `dd-finding:<id>` / `org-flightrisk:` `source` through the ordinary create path, after
which the IL's conversion silently adopts the planted record as the finding's task (verified end to end). Everything else is
MEDIUM/LOW hardening.

---

## CRITICAL

### CR-01: `GET /api/deals` and `POST /api/deals/select` hand an `employee` the full deal registry record (deal size, dates, synergy target, clearance grants)

**Status:** VERIFIED
**Files:** `server.js:1754-1756` (`GET /api/deals` → `controlStore.listDealsForUser` unprojected), `server.js:1732-1750`
(`POST /api/deals/select` echoes `deal`), `db/controlStore.js:219-224` (`listDealsForUser` filters by membership, projects
nothing), `lib/readPolicy.js:39-40` (`{ prefix: '/api/deals', exact: true, roles: ALL_ROLES, why: 'already filtered…' }`),
`server.js:1797-1830` (D-11-02 writes `dealSettings` onto that same record).
**Scenario:** A real-deal `employee` account (any member) calls `GET /api/deals`. The response is the raw control.db deal
row: `targetCompany`, `members[]` (every colleague's username), `memberGrants` (which members hold the `hr` clean-room
grant), `setup.steps.<step>.{at,by,data}` — the wizard payloads, including **`dealSizeM`**, `signingDate`, `expectedClose`,
`currency` — and, new in this phase, **`dealSettings.synergyTargetM`**. Acceptance 1 says the employee gets 403 on
`/api/synergies`; the IL's synergy target is now readable one route over. The read-policy "why" claims membership filtering
is sufficient; it filters *which* deals, not *what* of each deal.
**Repro (isolated instance):**
```
hrbp  POST /api/deals/deal_probe3/setup {step:'basics', data:{targetCompany:'Project Falcon', dealSizeM:850, signingDate:'2026-11-01', expectedClose:'2027-01-15'}}  -> 200
hrbp  POST /api/deals/deal_probe1/setup {dealSettings:{synergyTargetM:42.5, currency:'EUR', day1Date:'2026-12-01'}}             -> 200
emp   GET  /api/deals -> 200 [{"id":"deal_probe3",...,"members":["z-hrbp","z-emp"],"memberGrants":{},
        "setup":{"steps":{"basics":{"at":"…","by":"z-hrbp","data":{"targetCompany":"Project Falcon (NextGen Sensors)","dealSizeM":850,
        "signingDate":"2026-11-01","expectedClose":"2027-01-15","currency":"EUR"}}},"complete":false}}]
emp   GET  /api/deals -> 200 [{...,"memberGrants":{"p-pmohr":{"ddAreas":["hr"]}},"currency":"EUR","day1Date":"2026-12-01","dealSettings":{"synergyTargetM":42.5}}]
emp   POST /api/deals/select {dealId} -> 200 {"success":true,"deal":{ …same record… }}
emp   GET  /api/synergies/rollup -> 403 (control: the policy refuses the front door, not the side door)
```
**Violates:** AUTHZ-01 ("an employee … cannot read synergy financials"), PRD acceptance 1, D-11-01 (employee reads limited to
courses/lessons/own assessment/own pulse/notifications/CMS/own profile), D-11-02 (the new deal-level values were placed on a
record every role can read), project constraint "valuations … are MNPI".
**Fix direction:** Project the deal record per role at the two exits. Non-lead roles (`pmo`, `employee`) need only what the
deal switcher renders (`public/js/deal-switcher.js:140`, `deal-home.js:453`): `{ id, name, targetCompany?, status }` —
decide whether `targetCompany` itself is appropriate for `employee` pre-announcement. `setup`, `members`, `memberGrants`,
`currency`, `day1Date`, `dealSettings`, `createdBy` only to `admin`/`hrbp` (the roles the `/api/deals` prefix rule already
grants). Apply the same projection to the `POST /api/deals/select` echo and to `POST /api/deals/:id/setup`'s `deal:`
response. Add a body-allowlist assertion to `test/read-policy-matrix.test.js:139` (today `{ p: '/api/deals', deny: [], ok200: true }`
only checks the status) and a negative control that `dealSizeM`/`synergyTargetM`/`memberGrants` never appear in an employee's
or pmo's `/api/deals` body.

---

## HIGH

### WR-01: Clearance denials on DD and org by-id routes are NOT rate-bounded — one permanent audit row per probe

**Status:** VERIFIED
**Files:** `server.js:6466-6473` (`refuseDdArea` → `auditHook.recordSecurityEvent` per call), `server.js:6485-6494`
(`ddAreaRefused`, used by every `/api/dd/*/:id` GET/POST/DELETE and the convert route), `server.js:5478`, `5925`, `6044`
(`org-positions-target-access-denied`, `org-decisions-access-denied`, `org-flightrisk-access-denied`, same per-request shape),
`lib/denialAudit.js` (never consulted by these paths).
**Scenario:** An uncleared `pmo` (or any staff member without the `hr` grant) loops `GET /api/dd/findings/<anything>` or
`GET /api/org/flight-risk`. Each request is a 403 clearance denial and each one appends a row to append-only audit.db —
exactly the write amplification D-11-05 names (R1-07/R2-01) and the reason the gate's denials were bounded. The bound
applies to the gate, the resolver, the grants 403, the lockdown and the task/RAID clearance-404, but not to the two
clean-room surfaces whose denials are cheapest to trigger.
**Repro:** uncleared pmo, 25 × `GET /api/dd/findings/probe-<i>` → `dd-access-denied` rows before 0, after **25**.
Control: employee 25 × `GET /api/synergies` → `access-denied` rows +**1**.
**Violates:** AUTHZ-05 ("every 401/403 and clearance-404 … rate-bounded so a probe cannot flood the audit"), D-11-05
("do not add per-request rows"), PRD acceptance 6.
**Fix direction:** Route `refuseDdArea` and the three org denial sites through `recordDenial(req, 403, 'dd-clearance' | 'org-clearance', req.route.path)`
(keyed on the route template, so the id probes fold), keeping the action name `access-denied` with `reason` distinguishing
them; keep the *successful-read* audit on `GET /api/org/positions` (D-03 of Phase 6) as is. Add a bounded-denial test for a
DD and an org by-id probe to `test/denial-audit.test.js`.

### WR-02: An uncleared member can write INTO the clean room by planting a reserved `source`; the IL's conversion then adopts the planted record

**Status:** VERIFIED
**Files:** `server.js:4040-4055` (`POST /api/integration-tasks` create path: `source: String(b.source || 'manual')`),
`server.js:5418-5422` (`POST /api/raid` create path: `source: String(b.source || '')`), `validators/workstream.js:92, 362`
(`source` is an ordinary optional string on both upsert schemas), `server.js:6876-6877` and `6219-6220` (convert routes
dedupe on `find((t) => t.source === source)` — no `clearanceArea` / creator check), `server.js:5249-5262` and `5218-5232`
(the resolvers trust `source` as provenance).
**Scenario:** `pmo` without the `hr` grant knows an hr finding's id (ids travel in URLs, CSVs and screenshots — the phase's
own stance is that authorization must not rest on id secrecy). They `POST /api/integration-tasks {title:'PLANTED', source:'dd-finding:<id>'}`
→ 201. The record is now provenance-restricted (invisible to the planter, visible to hr-cleared members as if it were a
conversion). When the IL later converts the finding, the dedupe finds the planted task by `source`, **returns it as the
finding's task, links `finding.linkedTaskIds` to it and never creates the genuine converted task.** The same works with
`source:'org-flightrisk:anything'` on RAID (stamps the record `hr`-restricted). Net effect: write access into the clean room
from outside it, plus silent hijack of the conversion dedupe. No read leak (the planter cannot see it back), but an integrity
breach of the one lane the phase was closing.
**Repro:**
```
hrbp POST /api/dd/findings {title:'SECRET retention CFO…', area:'hr'}                           -> 201 id=ddfind_X
pmo  POST /api/integration-tasks {title:'PLANTED by uncleared pmo', source:'dd-finding:ddfind_X'} -> 201 task_P
pmo  GET  /api/integration-tasks -> 200, task_P absent (restricted)
pmo  POST /api/raid {title:'PLANTED RAID', type:'risk', severity:'high', source:'org-flightrisk:whatever'} -> 201
hrbp POST /api/dd/findings/ddfind_X/convert {toTask:true,toRaid:true,version:0} -> 200 {task:{id:'task_P', title:'PLANTED by uncleared pmo', …}}
pmohr GET /api/dd/findings/ddfind_X -> linkedTaskIds:['task_P'];  pmohr GET /api/integration-tasks -> contains 'PLANTED'
```
**Violates:** AUTHZ-03 ("filtered by clean-room clearance on … write"), D-11-03 (write-path closure), 09-SECURITY UF-2
(converted-record provenance is trusted but not protected at creation).
**Fix direction:** Reserve the provenance prefixes. On the create paths (and the RAID/task update paths, which already do not
copy `source`), refuse or strip any client `source` matching `/^(dd-finding:|org-flightrisk:|template:|remediation:)/` —
only the convert/instantiate routes may mint them (or require `req.portalUser` to be cleared for the area the source
resolves to, which is the same rule `assertRecordVisibleOr404` applies to updates). In the two convert routes, dedupe only on
records that also carry the matching `clearanceArea` stamp (the convert routes always stamp it; a planted record cannot, since
the schema strips `clearanceArea`). Add a negative test in `test/clearance-write-paths.test.js`: uncleared member creates with a
reserved source → 400, and a convert after a planted-source attempt still mints the genuine record.

---

## MEDIUM

### WR-03: Restricted get-or-create still honours client `role` / `department` / `company` and mints a staff-visible roster row per employee account

**Status:** VERIFIED
**Files:** `server.js:7697-7705` (restricted lane: `role: role || 'Specialist'`, `department`, `company` taken from the body),
`server.js:7637-7645` (`selfRosterId`), `validators/people.js:234-245` (schema bounds length only; not `htmlField`).
**Scenario:** Amendment 5 (binding) requires the restricted caller to resolve "ONLY the caller's own roster record … or a
minimal projection". The implementation correctly ignores `empId`/`name`/`isLeader`/`buddy*`, but a real-deal `employee`
can still create the row with `department:'Executive Board'`, `company:'TE Connectivity'`, `role:'<img src=x onerror=…>'`.
The row lands in the deal's roster lane that `GET /api/employees` (staff) returns. Client renderers escape `role`/`department`
(`admin.js:801`, `dashboard.js:810,2009`, `signage.js:314`), so this is not XSS today, but it is attacker-controlled text in
the IL's roster, one unreviewed row per employee login, and a self-assigned org placement.
**Repro:** employee `POST /api/employees/get-or-create {role:'<img src=x onerror=alert(1)>', department:'Executive Board', company:'TE Connectivity', isLeader:true}`
→ 201 `{employee:{id:'emp_acct_…', name:'p-emp', role:'<img src=x onerror=alert(1)>', department:'Executive Board', company:'TE Connectivity', isLeader:false, …}}`;
hrbp `GET /api/employees` → row present verbatim.
**Violates:** amendment 5 (minimal projection), D-11-04 intent (the write that replaced the GET should not widen what an
employee can author into staff data).
**Fix direction:** In the restricted lane take `role`/`department`/`company` from defaults (or from an existing roster row
the IL linked to the account — the "explicit linkage field" the summary itself names as the future decision), never from the
body; or make the restricted response a projection that does not persist a roster row at all until the IL links one. At minimum
wrap the three fields in `htmlField()` so the sanitizer runs.

### WR-04: Test gaps that let CR-01 / WR-01 / WR-02 pass green

**Status:** VERIFIED (by reading the suites)
**Files:** `test/read-policy-matrix.test.js:139` (`{ p: '/api/deals', deny: [], ok200: true }` — status only, body never
inspected for any role), `test/no-get-mutates.test.js:435` and the real-deal lane (both lanes drive **admin only**, so a
role-conditional write inside a GET — the exact shape the old get-or-create had for restricted callers — would not be seen),
`test/clearance-write-paths.test.js` (no create-path negative for a reserved `source`; the `source` assertions at `:389-418`
only count the IL's own conversions), `test/denial-audit.test.js` (no DD/org by-id denial scenario, so the unbounded path has
no coverage), `test/deal-settings-setup.test.js` (asserts `GET /api/deals` shows `synergyTargetM` for hrbp — never checks it
does *not* for employee).
**Fix direction:** (a) matrix rows for ALL-roles routes should carry a per-role response allowlist (`/api/deals`,
`/api/settings`, `/api/pulses`, `/api/notifications`); (b) drive the no-GET-mutates lanes as `pmo` and `employee` too (the
instrumentation is already role-agnostic); (c) add the reserved-source negative; (d) add bounded-denial assertions for one DD
and one org by-id probe.

---

## LOW

### IN-01: Restricted task ids are echoed to uncleared callers through `GET /api/synergies[].taskIds`

**Status:** VERIFIED
**Files:** `server.js:4569-4600` (`GET /api/synergies` echoes stored `taskIds`), `server.js:4495-4512` (`resolveSynergyTaskIds`
preserves hidden links — correct), 11-03-SUMMARY "ids are not record content".
**Scenario:** IL links an hr-restricted task to an initiative; uncleared pmo reads `/api/synergies` and sees the id. No
content leaks and every by-id route now 404s, but the caller learns that *n* restricted tasks exist and are linked to which
initiatives (a count/existence oracle), and the "Unknown task id" 400 on link confirms the id is one they may not touch.
**Repro:** hrbp `POST /api/synergies {taskIds:[task_hr]}` → 201; pmo `GET /api/synergies` → body contains `task_hr`.
**Fix direction:** filter `taskIds` through `recordVisibleTo` on the read path (and keep the preserved-links write logic), or
accept and record as an AR with the T-ERM-08 count-only residual.

### IN-02: Pulse `employeeName` is still free text — an employee can file a named pulse as a colleague that the IL reads as that colleague's

**Status:** VERIFIED (pre-existing surface; D-11-06 only partially addresses it)
**Files:** `server.js:7949-7962` (`employeeName` from body; `authorUsername` from session — good), `validators/people.js:113-119`.
**Scenario:** employee posts `{employeeName:'Jane Doe (hrbp)', rating:1, comment:'I am quitting, CFO is toxic'}`; hrbp's
`GET /api/pulses` returns it named "Jane Doe (hrbp)" with `authorUsername:'p-emp'`. The dashboard renders `employeeName`
(`public/js/dashboard.js`, Part B to confirm), so the attribution the IL acts on is the forged one unless the UI shows the
author.
**Fix direction:** for real deals derive `employeeName` from the account (as get-or-create now does for `name`), or render
`authorUsername` beside the name for admin/hrbp.

### IN-03: `POST /api/deals/:id/setup` commits the control.db write before the `deal-settings-update` audit event

**Status:** PLAUSIBLE
**Files:** `server.js:1816-1824` (`controlStore.updateDealSettings` then `auditHook.recordSecurityEvent`).
**Scenario:** a busy audit.db throws after the control write committed → central 503 → the client's silent retry re-applies the
same patch → one audited row for two writes, with the first change unaudited. Same pattern as the pre-existing
`/api/deals/:id/members` site, so this is a consistency note against the Phase 8 "audit inside the transaction" rule rather than
a new regression; values are idempotent.
**Fix direction:** either accept (document as AR) or move the control-plane audit append inside `updateDealSettings`'s
`.immediate` transaction the way `db/store.js` does for deal writes.

### IN-04: Exact write rules + trailing slash answer 500 "no registered validation schema"

**Status:** VERIFIED (pre-existing class)
**Files:** `validators/index.js:328-331`, `server.js:479` (`/api/employees/get-or-create` exact rule matched on the tidied form).
**Scenario:** employee `POST /api/employees/get-or-create/` → the gate allows (canonical form matches the exact rule), the
validation middleware looks the schema up by the raw path, finds none and answers 500 with a diagnostic string. Fail-closed,
but a 500 (not 404) and a small "this would be an unvalidated write" oracle; also logs at error level per request.
**Fix direction:** resolve the schema on the canonical path (`req.gatePathCanonical`) or 404 non-canonical spellings before the
schema lookup.

### IN-05: Stale policy rationale

**Status:** VERIFIED
**Files:** `lib/readPolicy.js:47-48` ("the employee portal reads its own tasks via the clearance-filtered notifications nudge")
— false since 11-05 withholds task nudges from employees; 11-05-SUMMARY already flags it. `validators/wizard.js:83`
`day1Date: z.string().max(DATE_MAX)` accepts `'not-a-date'` (consistent with the basics schema, so informational).
**Fix direction:** one-line wording touch; optionally an ISO-date regex on both `day1Date` fields.

---

## Checked and sound

- **Read gate variants:** employee on `/api/Synergies`, `/api/synergies;x`, `/api/%73ynergies`, `/api/synergies?x=1`, `OPTIONS` and `HEAD` all 403 with the fixed body; dot segments / bad escapes / backslash 404 at `server.js:798-800`; `readAllowsForms` most-restrictive rule verified by reasoning on `/api/deals%2Fx` (raw form has no rule, decoded form hits the LEAD prefix → refused).
- **Fail-closed default:** no default rule (`readPolicy.js:110-115`); unlisted path 403 for deal-bound and control-plane resolutions; coverage test fails on an unlisted GET route or a dead rule.
- **Demo leniency scope:** `req.isDemo` is set only by `db/resolver.js:161` for kind `'demo'`, which requires a session with no deal binding (`:102-104`); a bound session can never reach the demo branch; `isOpenMode` additionally requires DEMO_OPEN.
- **Write-policy order:** `/api/settings/time-travel` exact POST precedes the admin-only `/api/settings` prefix and is still demo-only; `POST /api/settings/` (trailing slash) by hrbp → 403; inline `isAdminRequest` guard on `POST /api/settings` is independent of table order.
- **Settings subset:** hrbp `GET /api/settings` returned only allowlisted keys (`targetCompany`, `hasGeminiApiKey`); `publicSettings` strips `geminiApiKey` and `connectionDetails` before the pick; `PUBLIC_SETTINGS_KEYS` is frozen and read-only.
- **Clean-room by-id guard:** uncleared pmo update/status-flip/delete of an hr task and RAID entry, with stale, current and no version → `404 {"error":"Not found"}`, headers identical to the missing-id case (`D2 true`), 12×12 timing samples indistinguishable (~1 ms both); guard precedes `conflictIfStale` on all 6 task/RAID sites and both convert routes check both source-matched records before any lane mutation; hr-cleared pmo still gets the Phase 9 409 with `currentRecord`; store backstop withholds restricted provenance when unarmed (`db/store.js:181-188`); structural scan gate present.
- **Reports/exports/notifications:** uncleared pmo `dataset=tasks|raid` exports contain neither the secret title nor the planted title; `raid_high` count includes restricted entries — the documented T-ERM-08 count-only residual, unchanged.
- **Synergy link:** restricted id refused with the same 400 as an unknown id; hidden existing links preserved on an uncleared edit.
- **Denial audit:** keys are `actor|METHOD|template|reason`, template resolved method-aware over registered layers (`server.js:1560-1577`), 25 identical probes → 1 row, folded counts written on window expiry, 5000-key cap with per-reason overflow, stored path clipped to 256 (anonymous 5000-char path → row of 960 bytes), anonymous role `(anonymous)` satisfies NOT NULL, no swallow (throws reach the central 503 from gate, resolver, lockdown and the 404 error handler), 404 handler ordered above the 503/409 handlers with a `headersSent` guard, resolver denial and gate denial are mutually exclusive (no double count).
- **get-or-create:** GET path gone (employee → 403 from the roster rule, staff → router 404); POST exact rule, all roles, no widening; supplied `empId` of a colleague never resolves; `name` from the account; `isLeader`/`leaderRole`/`buddy*` defaulted; `complete-lesson` in a real deal → demo-only 403.
- **Pulses:** `authorUsername` always from the session (forged body value ignored — stored as `p-emp`); pmo sees only `{rating,type,day}` aggregates sorted day/rating/type; employee sees own only; missing identity → empty list; demo store unprojected.
- **Deal setup route:** employee → 403 (write policy); non-member hrbp → 404 byte-identical to a missing deal; zod bounds enforced (`currency` > 10 chars → 400); `updateDealSettings` copies only the five known keys inside an `.immediate` RMW.
- **Phase 8/9/10 contracts:** 503/409 bodies untouched; version precondition still required (convert without `version` → 400 `versionRequired`); `case sensitive routing` + `pathForms` still the single canonical path; no `try/catch` wraps any of the new `assertRecordVisibleOr404` throw sites.
- **Suite:** 1147/1147 at `91cabc2`.

## Not covered

- `/api/auth/me`, every `public/js/*` change (deal-switcher, dashboard pulse rendering, employee.js POST), plans 11-07/11-08 (hidden-control list, DEPLOYMENT.md "Roles and what they can read" table + drift test — D-11-06's doc requirement is 11-08's deliverable and is absent at this head), the Playwright smoke — Part B.
- Multi-process behaviour of the denial-audit bound (per-process, documented); shared-host soak not re-run.
- Static `public/sent_emails/*` served unauthenticated by `express.static` (R1-06, Phase 14) and the by-design per-read audit row on `GET /api/org/positions` (Phase 6 D-03) — pre-existing, out of this phase's scope.
- Demo-showcase walks (Phase 9/10 UAT) were not re-executed; only the demo-store control requests in the matrix suite were relied on.

---

_Reviewed: 2026-10-10_
_Reviewer: Claude Fable 5.1 (gsd-code-reviewer, adversarial second opinion)_
_Depth: deep — live-verified on an isolated instance_
