---
phase: quick-260810-erm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - server.js
  - lib/reportCsv.js
  - public/js/transitions.js
  - public/js/signage.js
  - public/js/admin.js
  - public/signage.html
  - public/admin.html
  - public/*.html   # 18 files carrying transitions.js?v= — bump the cache stamp
  - test/task-access-filter.test.js   # new
  - test/reports-export.test.js
  - test/org-dd-read-audit.test.js    # new (or extend audit-security-events.test.js)
  - test/client-xss-sinks.test.js     # new (source-level asserts)
autonomous: true
requirements: [F-1, F-2, F-3, F-4, F-5]
estimate:
  tokens: 90000
  raw_tokens: 55000
  tasks: 4
  confidence: med

must_haves:
  truths:
    - "A deal member cleared only for 'legal' receives ZERO rows for an hr-flight-risk-converted task via GET /api/integration-tasks, GET /api/reports/export?dataset=tasks, and the PDF pack; an unrestricted (source=manual) task stays visible to every identity."
    - "Deleting a converted task's originating dd-finding never declassifies the task — the stamped clearanceArea is preferred over source-parsing, exactly like the RAID twin."
    - "The three stored-string client sinks (bookmark href/icon/title, signage roster name/role/department/badge, admin question edit textarea) render attacker text as inert literal, and a javascript: bookmark URL is neutralized."
    - "Every changed client file's ?v= cache stamp is bumped so a browser holding the pre-fix copy cannot keep running vulnerable code."
    - "A CSV export field whose first NON-whitespace character is a formula trigger (e.g. ' =1+1', '\\t=SUM(A1)') is apostrophe-guarded; a numeric column value is never apostrophe-prefixed."
    - "A successful or denied MNPI read of GET /api/org/decisions, GET /api/org/positions?state=target, and GET /api/dd/findings writes exactly one real-deal audit row per read and ZERO rows in demo."
  artifacts:
    - server.js  # resolveTaskClearanceArea + reportTaskRows + convert-site stamps + rollup filter + read-audit calls
    - lib/reportCsv.js  # first-non-whitespace formula guard
    - public/js/transitions.js
    - public/js/signage.js
    - public/js/admin.js
    - test/task-access-filter.test.js
  key_links:
    - "resolveTaskClearanceArea(task, db) stamp-first precedence → reportTaskRows(db, deal, portalUser) → all three task read exits + computeWorkstreamRollup"
    - "convert-site clearanceArea stamp ↔ resolveTaskClearanceArea prefers the stamp over source-parsing"
    - "changed client file ↔ its ?v= cache stamp"
---

<objective>
Remediate the code-fixable findings from the milestone-close whole-codebase Fable 5 security review (3 auditors): two HIGH bugs (server task-lane clean-room bypass; three client stored-string→innerHTML XSS sinks) plus three lower-severity bugs (false-disclosure copy — now a no-op; CSV formula-injection whitespace bypass; MNPI read-audit asymmetry). All are clear bugs against the app's own written contracts; demo-vs-real DEPLOYMENT decisions are OUT of scope.

Purpose: The RAID twins are already clearance-filtered (resolveRaidEntryClearanceArea + reportRaidRows). Converted TASKS carry the identical MNPI titles (`${employeeName} — retention risk mitigation`, a DD finding.title) through the UNfiltered task lane. This mirrors the existing RAID machinery exactly onto tasks — strictly stronger, reuses proven code — and closes the remaining XSS/CSV/audit gaps.

Output: Task-lane clearance parity with RAID; three client sinks escaped + cache-stamped; CSV whitespace-bypass closed; MNPI read forensics on three more routes; proving tests for every fix; full suite green with zero regressions.
</objective>

<execution_context>
@$HOME/.claude/gsd-core/workflows/execute-plan.md
</execution_context>

<context>
@.planning/STATE.md
@server.js
@lib/reportCsv.js
@public/js/transitions.js
@public/js/signage.js
@public/js/admin.js
@public/js/org.js
@public/js/due-diligence.js
@test/raid-access-filter.test.js
@test/reports-export.test.js
@test/reports-pack.test.js
@test/org-flight-risk-audit.test.js

# Ground truth gathered while planning (line anchors are approximate — anchor on the quoted unique strings, not the numbers):
# - taskLane(db)                              server.js ~2925
# - computeWorkstreamRollup(db)               server.js ~2941 (uses `const tasks = taskLane(db)` ~2947; called ONLY at export ~5644 and pack ~5805, both req-bearing)
# - GET /api/integration-tasks                server.js ~2963 (`res.json(taskLane(db))`)
# - resolveRaidEntryClearanceArea(entry, db)  server.js ~4050 — MIRROR THIS EXACTLY
# - reportRaidRows(db, deal, portalUser)      server.js ~4075 — MIRROR THIS EXACTLY
# - flight-risk convert TASK create           server.js ~4834 (title `${employeeName} — retention risk mitigation`, source `org-flightrisk:<id>`, workstreamId 'ws_hr')
# - flight-risk convert RAID create            server.js ~4855 already stamps `clearanceArea: 'hr'` (the pattern to copy)
# - dd-finding convert TASK create             server.js ~5398 (title `finding.title`, source `dd-finding:<id>`, workstreamId from DD_AREA_WORKSTREAM)
# - dd-finding convert RAID create             server.js ~5419 already stamps `clearanceArea: finding.area` (the pattern to copy)
# - GET /api/org/positions (target branch)     server.js ~4170 (D-07 exact-match target gate)
# - GET /api/org/decisions                     server.js ~4585 (hr-grant gate, no audit today)
# - GET /api/org/flight-risk                    server.js ~4677 — the read-audit PATTERN to mirror (denied + success, requestMeta(req))
# - GET /api/dd/findings (list)                 server.js ~5276 (filterByAreaGrant, no audit today)
# - GET /api/dd/findings/:id                    server.js ~5285 (ddAreaRefused handles denial)
# - export tasks branch                         server.js ~5654 (`rows = taskLane(db)` + stale "No per-item clearance concept" comment to replace)
# - pack tasks                                  server.js ~5806 (`const tasks = taskLane(db)` — feeds model.tasks, hasAnyData, audit rowCounts.tasks)
# - recordSecurityEvent shape                   db/auditHook.js ~126 (writes unconditionally given an actor; NO internal demo gate)
# - requestMeta(req)                            server.js ~720
# - module.exports.resolveRaidEntryClearanceArea  server.js ~6796 (export the two new task fns beside it)
# - escapeHtml in transitions.js ~2410; in admin.js ~1220; signage.js has NONE
# - 18 html files carry `transitions.js?v=1784900001`; signage.html carries `signage.js?v=1784300020`; admin.html carries `admin.js?v=1784700001`
</context>

<tasks>

<task type="tracer">
  <name>Task 1: Server task-lane clean-room filter — mirror the RAID machinery onto tasks (FIX 1 HIGH + FIX 3)</name>
  <files>server.js, test/task-access-filter.test.js, test/reports-export.test.js</files>
  <read_first>
server.js resolveRaidEntryClearanceArea (~4050) and reportRaidRows (~4075) are the EXACT templates. Both convert routes already stamp the RAID twin's clearanceArea (org-flightrisk RAID ~4855 `clearanceArea: 'hr'`; dd-finding RAID ~5439 `clearanceArea: finding.area`). test/raid-access-filter.test.js is the harness to clone (four identities: admin, karen/hrbp, pmo_legal single-area, pmo_hr single-area; assertions are SORTED ID ARRAYS never lengths, catching over-filter and under-filter with one assertion).
  </read_first>
  <action>
Add `resolveTaskClearanceArea(task, db)` immediately below resolveRaidEntryClearanceArea, structurally identical: prefer a stamped `task.clearanceArea` FIRST; else parse `task.source` — `dd-finding:<id>` resolves to that finding's `.area` via ddFindingsLane(db) (null if the finding is gone), `org-flightrisk:<id>` resolves to the fixed 'hr' area, anything else (including empty/absent source, e.g. source==='manual') resolves to null = unrestricted. A `[security]` comment must explain: stamp-first means deleting the origin record can never DEclassify a converted task (fail-closed), and null=unrestricted keeps ordinary manual tasks visible to the whole deal team.

Add `reportTaskRows(db, deal, portalUser)` immediately below reportTaskClearanceArea's helper, structurally identical to reportRaidRows: return taskLane(db).filter where `resolveTaskClearanceArea(task, db) === null || accessPolicy.hasAreaGrant(deal, portalUser, area)`. This is the SINGLE clearance-filtered task read; a `[security]` comment must state it is the one path all title-emitting task exits call.

Stamp `clearanceArea` at BOTH convert TASK-creation sites, mirroring the already-stamped RAID twins: the org-flightrisk convert task object (~4834) gains `clearanceArea: 'hr'`; the dd-finding convert task object (~5398) gains `clearanceArea: finding.area`. `[security]` comment on each, matching the RAID twin's WR-03 wording.

Route ALL THREE title-emitting task exits through reportTaskRows: GET /api/integration-tasks (~2965 `res.json(reportTaskRows(db, controlStore.getDeal(req.dealContext.dealId), req.portalUser))`); the export tasks branch (~5657 `rows = reportTaskRows(db, deal, req.portalUser)`) — and REPLACE its now-false stale comment ("No per-item clearance concept exists on tasks today — every deal member sees every task") with a `[security]` comment stating tasks are now clearance-filtered identically to RAID; the pack tasks var (~5806 `const tasks = reportTaskRows(db, deal, req.portalUser)`) so model.tasks, hasAnyData and audit rowCounts.tasks all reflect the caller's cleared set automatically.

Close FIX 3 (count-inference) at the rollup: change `computeWorkstreamRollup(db)` to `computeWorkstreamRollup(db, deal, portalUser)` and inside swap `const tasks = taskLane(db)` for `const tasks = reportTaskRows(db, deal, portalUser)`; update BOTH call sites (export ~5644, pack ~5805) to pass `(db, deal, req.portalUser)`. This keeps the single rollup implementation but makes it caller-aware exactly like reportRaidRows, and preserves server↔client rollup parity (execution.js computes its rollup over the now-filtered /api/integration-tasks). A `[security]` comment must note a hidden hr-retention task no longer inflates the ws_hr count for an uncleared viewer.

DOCUMENTED ACCEPTED RESIDUAL (write it into a comment at the deal-home nudge, do NOT change code there): the deal-home aggregate nudge counts (tasks_overdue / tasks_blocked, server.js ~5570) and the existing raidHigh nudge count stay UNfiltered — they are aggregate integers across all workstreams with no title/name, and this exactly matches the existing accepted treatment of the analogous raidHigh count nudge sitting beside them. Note it; do not "fix" it.

Export both new functions beside `module.exports.resolveRaidEntryClearanceArea` (~6796): `module.exports.resolveTaskClearanceArea` and `module.exports.reportTaskRows`, so the unit cases can call them without booting HTTP.

FIX 3 (false-disclosure copy) is a VERIFICATION only, no code change: public/js/org.js:918 and public/js/due-diligence.js:326-329 already read "…visible only to members cleared for this register/area" and already mention both the Day-1 task AND the RAID entry; FIX 1 makes that sentence TRUE for tasks (it was only true for RAID before). Confirm the wording is now accurate and that test/raid-access-filter.test.js test (j) stays green (it asserts the corrected copy is present and "whole deal team" is absent — both still hold). No edit to those two client files.
  </action>
  <verify>
    <automated>node --test test/task-access-filter.test.js test/raid-access-filter.test.js test/reports-export.test.js test/reports-pack.test.js</automated>
  </verify>
  <behavior>
New test/task-access-filter.test.js (clone raid-access-filter.test.js's isolated-temp-DB harness and four-identity fixture):
- Seed one manual task (source=manual, unrestricted), one dd-finding→task conversion in 'legal', one dd-finding→task conversion in 'financial', one flight-risk→task conversion (fixed 'hr').
- admin AND karen(hrbp) receive ALL FOUR tasks via GET /api/integration-tasks (sorted-id array, not length — the over-filter guard).
- pmo_legal (legal only) receives the manual + legal-provenance task, EXCLUDES the financial and hr tasks. pmo_hr (hr only) receives the manual + hr-provenance task, EXCLUDES legal and financial.
- The SAME exclusion holds for GET /api/reports/export?dataset=tasks (csv id set == json id set == the caller's /api/integration-tasks id set) AND for the PDF pack (assert the pack-generation audit row's after.rowCounts.tasks equals the caller's own /api/integration-tasks length — mirror reports-pack test (b)'s CSV-vs-audit-count parity technique, since the PDF is a raster).
- WR-03 parity: after DELETE of the financial finding, admin still receives the financial-provenance task, and pmo_legal/pmo_hr STILL do not — deletion never declassifies (proves stamp-first).
- Rollup count parity: seed a checklist template with ws_hr; convert a flight-risk to a task; assert GET /api/reports/export?dataset=workstreams shows ws_hr with the task counted for pmo_hr/admin but NOT counted (or the row absent) for pmo_legal — the F-3 close.
- Unit cases via app.resolveTaskClearanceArea: empty source→null, absent source→null, live dd-finding→area, orphaned dd-finding→null, org-flightrisk:*→'hr', unrecognised prefix→null, stamped clearanceArea wins over an orphaned source, stamped clearanceArea wins over a still-live differing source.
In test/reports-export.test.js: update the STALE comment on test (k) ("the three datasets with NO per-item clearance concept … tasks …") — tasks now has a conditional clearance concept; the test's own fixture uses only unrestricted manual tasks so the identical-set assertion still holds, but the comment must no longer claim tasks are unconditionally unfiltered.
  </behavior>
  <done>
resolveTaskClearanceArea + reportTaskRows added and exported; both convert TASK sites stamp clearanceArea; all three title-emitting exits + computeWorkstreamRollup route through reportTaskRows; new test/task-access-filter.test.js passes with the four-identity + unit + rollup + WR-03 cases; raid/reports-export/reports-pack suites stay green. `[security]`-prefixed comments explain each mitigation.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Client stored-string XSS — escape three innerHTML sinks + neutralize javascript: URLs + bump cache stamps (FIX 2 HIGH)</name>
  <files>public/js/transitions.js, public/js/signage.js, public/js/admin.js, public/signage.html, public/admin.html, public/*.html (18 transitions.js refs), test/client-xss-sinks.test.js</files>
  <read_first>
transitions.js renderQuickLink (~1396) interpolates item.href/item.icon/item.title RAW; renderQuickGroup interpolates `${label}` RAW; the bookmark items originate from GET /api/menus (write ACL admin/hrbp/pmo) and render in ANY user's chrome on EVERY page. escapeHtml is defined at ~2410 — VERIFY it is in the same/enclosing function scope as renderQuickLink before relying on it (function declarations hoist only within their own containing function; if it is declared in a different inner function, it is NOT reachable at ~1396). signage.js row (~296-307) interpolates emp.name/emp.role/emp.department/emp.badge RAW and the file has NO escaper. admin.js edit view (~375) interpolates `${q.text}` RAW into a <textarea>; the list view (~288) already uses escapeHtml (defined ~1220, same IIFE). The prior XSS fix (quick 260806-x2j) established that every changed client file MUST get a bumped ?v= cache stamp.
  </read_first>
  <action>
transitions.js: escape item.icon and item.title with escapeHtml in renderQuickLink, escape `${label}` in renderQuickGroup. For item.href, escaping alone does NOT stop a `javascript:`/`data:` scheme — add a small `safeUrl(u)` helper (adjacent to renderQuickLink) that returns the string only when it is a relative path, a `#`-anchor, or an http/https absolute URL, else returns `'#'`; wrap href as `escapeHtml(safeUrl(item.href))`. If VERIFY shows escapeHtml is not in scope at renderQuickLink, add a local hoisted `function escapeHtml` (identical body to the ~2410 one) inside renderQuickLink's own enclosing function rather than reaching across scopes. Do not change the static portalCatalog/allResources/generalItems entries' behavior (they are trusted literals; escaping them is harmless and fine).

signage.js: add a small `function escapeHtml(s)` helper near the top of the module's IIFE (same 5-replace body as transitions.js/admin.js) and wrap emp.name, emp.role, emp.department and emp.badge in the leaderboard row template literal. Leave `${emp.points || 0}` (numeric) and the boolean `emp.isLeader` ternary as-is.

admin.js: change the edit-view textarea interpolation `${q.text}` (~375) to `${escapeHtml(q.text)}`, matching the list view at ~288. No new helper needed (escapeHtml at ~1220 is in scope).

Cache stamps: bump every changed client file's ?v=. Replace `transitions.js?v=1784900001` → `transitions.js?v=1784900002` across ALL 18 html files (identical-string replace_all); `signage.js?v=1784300020` → `signage.js?v=1784300021` in public/signage.html; `admin.js?v=1784700001` → `admin.js?v=1784700002` in public/admin.html.
  </action>
  <verify>
    <automated>node --test test/client-xss-sinks.test.js && grep -rc "transitions.js?v=1784900001" public --include="*.html" | grep -v ':0' | grep -v '^$' && echo "STALE STAMP FOUND" || echo "all transitions stamps bumped"</automated>
  </verify>
  <behavior>
New test/client-xss-sinks.test.js — source-level asserts (readFileSync + regex/includes), the established pattern for this framework-less client (see raid-access-filter test i/j/k):
- transitions.js renderQuickLink source calls escapeHtml on item.title and item.icon, and wraps item.href in both escapeHtml and safeUrl (assert the safeUrl helper exists and rejects a `javascript:` scheme — a focused string test on safeUrl if it is exported, else assert the source contains the scheme allowlist).
- signage.js defines escapeHtml and the leaderboard row template escapes emp.name / emp.role / emp.department (assert no raw `${emp.name}` remains in that template).
- admin.js edit-view textarea uses `${escapeHtml(q.text)}` and no raw `${q.text}` remains in the activateInlineEdit template.
- Cache stamps: public/signage.html's signage.js stamp != '1784300020'; public/admin.html's admin.js stamp != '1784700001'; zero html files still carry `transitions.js?v=1784900001`.
Keep any literal a negative-grep looks for OUT of the escaped `<action>`/comment bodies to avoid self-invalidation.
  </behavior>
  <done>
All three sinks render attacker text inert; a javascript: bookmark href resolves to '#'; every changed client file's ?v= is bumped (18 transitions refs + signage + admin); test/client-xss-sinks.test.js passes; grep confirms no stale transitions stamp remains.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: CSV formula-injection whitespace bypass (FIX 4 LOW)</name>
  <files>lib/reportCsv.js, test/reports-export.test.js</files>
  <read_first>
lib/reportCsv.js csvField (~46) apostrophe-guards only when `s[0]` is a trigger char, so a leading space/tab (`" =1+1"`, `"\t=SUM(A1)"`) bypasses it — spreadsheets strip leading whitespace before formula detection. The WR-01 number-skip (`typeof value !== 'number'`) must survive so a computed negative like -5 is never apostrophe-prefixed. The existing T-07-05 formula-injection assertions live in test/reports-export.test.js.
  </read_first>
  <action>
In csvField, change the trigger test from `s[0]` to the first NON-whitespace character: compute the first non-whitespace char (e.g. `const firstNonWs = s.replace(/^\s+/, '').charAt(0)`) and guard when `typeof value !== 'number' && firstNonWs && FORMULA_TRIGGER_CHARS.has(firstNonWs)`. The apostrophe still goes at the VERY FRONT of the whole string (`s = "'" + s`) so the entire cell is forced to text regardless of the stripped leading whitespace. Keep the number-skip exactly. Update the FORMULA_TRIGGER_CHARS/csvField comment block with a `[security]`-style note explaining the leading-whitespace-strip bypass this closes (spreadsheets trim leading whitespace before deciding a cell is a formula).
  </action>
  <verify>
    <automated>node --test test/reports-export.test.js</automated>
  </verify>
  <behavior>
Extend the T-07-05 CSV assertions in test/reports-export.test.js (require lib/reportCsv and call csvField directly — it is exported):
- csvField(' =1+1') and csvField('\t=SUM(A1)') and csvField('  @cmd') each begin with an apostrophe.
- csvField('=1+1') (no leading whitespace) still guarded (regression).
- csvField(-5) and csvField(5) (numbers) are NOT apostrophe-prefixed.
- A plain leading-space non-trigger value (' hello') is unchanged (no spurious apostrophe).
  </behavior>
  <done>
csvField guards on the first non-whitespace char, preserves the number-skip, and the extended reports-export assertions pass.
  </done>
</task>

<task type="auto">
  <name>Task 4: MNPI read-audit asymmetry — audit three more read routes, real-deal only (FIX 5 MEDIUM)</name>
  <files>server.js, test/org-dd-read-audit.test.js (new, or extend test/audit-security-events.test.js)</files>
  <read_first>
GET /api/org/flight-risk (~4677) is the read-audit PATTERN: it records BOTH a denial (`org-flightrisk-access-denied`) and a success (`org-flightrisk-read`) via auditHook.recordSecurityEvent with `actor: req.portalUser, dealId: req.dealContext.dealId, subject: null, before/after: null, request: requestMeta(req)`. recordSecurityEvent (db/auditHook.js ~126) writes unconditionally given an actor — so the "zero in demo" requirement must be enforced at the CALL SITE with `if (!req.isDemo)`, matching the Phase-7 export/pack audit gating. Three routes leave no trail today: GET /api/org/decisions (~4585, hr-grant gated), GET /api/org/positions?state=target (~4170, target branch only), GET /api/dd/findings (~5276, filterByAreaGrant subset). test/dd-findings.test.js asserts audit DELTAS filtered by action name (`dd-access-denied`) — additive new action names are safe for those. test/org-flight-risk-audit.test.js is the harness to clone.
  </read_first>
  <action>
Add read-audit calls, each gated `if (!req.isDemo)`, mirroring the flight-risk shape (requestMeta(req), actor req.portalUser, dealId req.dealContext.dealId, before/after null):
- GET /api/org/decisions: on the hr-grant denial, record `org-decisions-access-denied` (subject null); on success, record `org-decisions-read` (subject = req.query.positionId || null).
- GET /api/org/positions: ONLY on the TARGET branch — on the target denial record `org-positions-target-access-denied`; on a successful target read record `org-positions-target-read`. Do NOT audit current-state reads (open tier — auditing every current-state read is noise, not MNPI).
- GET /api/dd/findings (list): on success record `dd-findings-read` (subject = req.query.area || 'all'). This route returns a per-caller cleared subset and never 403s, so there is no denial branch to add here.
- GET /api/dd/findings/:id: after ddAreaRefused passes, record `dd-finding-read` (subject = req.params.id) on success. (ddAreaRefused already owns the denial path — do not touch it.)
Add a one-line `[security]` comment on each, and carry the same accepted `db_kind:'control'` labelling residual note the flight-risk route already documents. Do NOT add a demo guard to the existing flight-risk route (out of scope; don't touch working code).
  </action>
  <verify>
    <automated>node --test test/org-dd-read-audit.test.js && node --test</automated>
  </verify>
  <behavior>
New test/org-dd-read-audit.test.js (clone org-flight-risk-audit.test.js harness; query rows via auditHook.queryAudit filtered by the new action names):
- A cleared (hr-granted) real-deal GET /api/org/decisions writes exactly one `org-decisions-read` row; an uncleared member's 403 writes exactly one `org-decisions-access-denied` row.
- A cleared real-deal GET /api/org/positions?state=target writes one `org-positions-target-read`; an uncleared 403 writes one `org-positions-target-access-denied`; a GET /api/org/positions (current) writes ZERO position-read rows.
- A real-deal GET /api/dd/findings writes one `dd-findings-read`; GET /api/dd/findings/:id (cleared) writes one `dd-finding-read`.
- A DEMO request to each of the above writes ZERO new audit rows (the real-deal-only gate).
Then run the FULL suite (`node --test`): if any pre-existing test asserts a TOTAL audit-row delta (not an action-filtered one) across one of these routes, update it to account for the new intended read rows — action-filtered delta assertions (e.g. dd-findings.test.js's `dd-access-denied` counts) are unaffected.
  </behavior>
  <done>
Three routes audit denied+successful MNPI reads in real deals and nothing in demo; new test proves each action name and the demo-zero invariant; full suite green.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| uncleared deal member → task read exits | An area-scoped member requesting /api/integration-tasks, /api/reports/export?dataset=tasks, or the PDF pack must not receive a task republished from a source they are not cleared for. |
| admin/hrbp/pmo menu-writer → any user's chrome | A GET /api/menus bookmark payload renders in every other user's quick-nav on every page. |
| user-authored free text → spreadsheet | An exported CSV field opened in Excel/Sheets can be evaluated as a formula. |
| MNPI read → audit trail | A read of decisions/target-org/DD-findings about named people must be forensically recorded in real deals. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-ERM-01 | Information Disclosure | task lane (integration-tasks / export / pack) | high | mitigate | resolveTaskClearanceArea + reportTaskRows mirror the RAID filter; both convert sites stamp clearanceArea; all three exits + rollup routed through the filter (Task 1) |
| T-ERM-02 | Elevation of Privilege | source-deletion declassification | high | mitigate | stamp-first precedence — deleting the origin dd-finding never widens a converted task's audience (Task 1, WR-03 parity) |
| T-ERM-03 | Tampering (stored XSS) | transitions.js bookmark sink | high | mitigate | escapeHtml on href/icon/title + safeUrl scheme allowlist + cache-stamp bump (Task 2) |
| T-ERM-04 | Tampering (stored XSS) | signage.js roster sink | high | mitigate | add escapeHtml, wrap name/role/department/badge + cache-stamp bump (Task 2) |
| T-ERM-05 | Tampering (stored XSS) | admin.js question edit sink | medium | mitigate | escapeHtml(q.text) in the edit textarea + cache-stamp bump (Task 2) |
| T-ERM-06 | Tampering | CSV formula injection via leading whitespace | low | mitigate | guard first non-whitespace trigger char, keep number-skip (Task 3) |
| T-ERM-07 | Repudiation | MNPI reads (decisions/target-org/DD-findings) unaudited | medium | mitigate | recordSecurityEvent on denied+successful reads, real-deal only (Task 4) |
| T-ERM-08 | Information Disclosure | deal-home aggregate nudge counts | low | accept | count-only integers, no title/name; matches the existing accepted raidHigh nudge-count residual (documented in Task 1) |
</threat_model>

<verification>
- Capture the actual baseline first: `node --test` (bare — NOT `node --test test/`) should report the task brief's 655/655 (or the current true count) BEFORE any change.
- After all tasks: `node --test` reports the baseline count PLUS the new tests, zero failures, zero regressions.
- `grep -rc "transitions.js?v=1784900001" public --include="*.html"` returns 0 matches (all 18 stamps bumped); signage.html and admin.html stamps changed.
- `[security]`-prefixed comments accompany each server mitigation and the CSV guard, explaining the mitigation strategy (not just the risk), per project convention.
- WAL trap discipline: no `.db` write is intended by this change — if any test leaves a tracked `.db` dirty, `PRAGMA wal_checkpoint(TRUNCATE)` and diff against HEAD before committing; commit ONLY the source/test files, never `git add -A`, and leave ` M .claude/CLAUDE.md` untouched.
</verification>

<success_criteria>
- A legal-only member gets zero rows for an hr-flight-risk-converted task across all three exits and the rollup; deletion never declassifies (Task 1 tests green).
- Three client sinks render attacker input inert, javascript: URLs neutralized, every changed client file cache-stamped (Task 2 tests green).
- CSV whitespace-prefixed formula payloads are apostrophe-guarded; numbers are not (Task 3 tests green).
- Denied and successful MNPI reads on three routes are audited in real deals and silent in demo (Task 4 tests green).
- Full suite green with zero regressions; four coherent file-scoped commits (server-clearance; client-XSS; csv-guard; read-audit), each self-contained and independently green.
</success_criteria>

<output>
Four atomic commits (one per task / coherent group), file-scoped (never `git add -A`, exclude ` M .claude/CLAUDE.md`):
- `fix(security): clearance-filter the task lane, mirroring the RAID machinery (F-1/F-3)`
- `fix(security): escape three stored-string client sinks + bump cache stamps (F-2)`
- `fix(security): guard CSV formula injection past leading whitespace (F-4)`
- `fix(security): audit MNPI reads on decisions/target-org/DD-findings (F-5)`

Create `.planning/quick/260810-erm-milestone-security-remediation-task-lane/260810-erm-SUMMARY.md` when done.
</output>
