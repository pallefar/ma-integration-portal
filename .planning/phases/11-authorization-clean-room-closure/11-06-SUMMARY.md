---
phase: 11-authorization-clean-room-closure
plan: 06
subsystem: auth
tags: [authorization, no-get-mutates, get-or-create, write-policy, validation, clean-room, instrumentation, node-test]

requires:
  - phase: 11-authorization-clean-room-closure
    provides: "11-01 ROLE_READ_POLICY + test/helpers/deal-fixture.js + route-inventory.js; 11-02 admin-only config surface"
provides:
  - "POST /api/employees/get-or-create (zod EmployeeGetOrCreateSchema, exact POST-only self-service write rule); the GET route is gone"
  - "real-deal roster-refused roles resolve ONLY their own account-derived roster record (selfRosterId)"
  - "test/no-get-mutates.test.js: statement-level + fs instrumentation over every registered GET route in two lanes, with negative controls"
  - "AUTHZ-04 second clause proven: only GET/POST/PUT/PATCH/DELETE routes exist and every write route has a registered schema"
affects: [11-07, 11-08]

requirements-completed: [AUTHZ-04]

actuals:
  tokens: 13100
  tasks: 3
  commits: 3

key-files:
  created:
    - test/get-or-create-post.test.js
    - test/no-get-mutates.test.js
  modified:
    - server.js
    - validators/people.js
    - lib/readPolicy.js
    - public/js/employee.js
    - public/employee.html
    - test/read-policy-matrix.test.js

key-decisions:
  - "A role the read policy refuses /api/employees resolves only the record whose id is derived from the session identity (sha256 of the username); a supplied empId or name is never a lookup key and supplied ids never become roster rows"
  - "Restricted callers' self-declared isLeader / leaderRole / buddy* are not honoured and the display name comes from the account, not the request"
  - "download-zip is driven with the zip binary stubbed; the handler's temp-archive lifecycle (write under os.tmpdir(), delete after send) is asserted, not skipped"

duration: 40min
completed: 2026-10-10
status: complete
---

# Phase 11 Plan 06: No GET changes state (AUTHZ-04) Summary

**`GET /api/employees/get-or-create` is now a zod-validated, policy-gated `POST` scoped to the caller's own account-derived roster record, and an instrumented test drives all 58 registered GET routes (real-deal admin and demo-store admin) and fails on any SQL or filesystem write outside the append-only audit trail.**

## Performance

- **Tasks:** 3 completed (1 tracer, 1 auto/tdd, 1 auto)
- **Commits:** 3 production/test commits (+ this SUMMARY)
- **Suite:** 1088 at base -> 1101/1101 green at the final commit (0 failures at every commit; `node --test`, ~39 s)
- **Files:** 2 created, 6 modified

## Accomplishments

- **Tracer (Task 1) end to end.** `validators/people.js` registers `EmployeeGetOrCreateSchema` (every field optional and bounded; unknown keys such as `points`/`badge`/`completedLessons` are stripped). `server.js`: an exact, POST-only `ROLE_WRITE_POLICY` self-service rule for all four roles (no widening: it was reachable by every role as a GET), the route registration changed from `app.get` to `app.post` reading `req.body`. `public/js/employee.js initializeEmployee()` now POSTs JSON; the `employee.js` cache-bust stamp in `public/employee.html` went `1784500006 -> 1784500007`.
- **Amendment 1 closed.** The temporary all-roles `/api/employees/get-or-create` READ rule that 11-01 placed ahead of `/api/employees` is removed from `lib/readPolicy.js`; the two assertions in `test/read-policy-matrix.test.js` that mentioned it were updated (a deal-bound employee now meets the roster rule's 403 on the GET path, staff reach the router's 404).
- **Amendment 5 (BINDING) implemented.** When `req.isDemo !== true` and the caller's role is refused `/api/employees` by the read policy, the route resolves only the caller's own roster record: the id is `emp_acct_` + the first 20 hex chars of `sha256('roster-self:' + username)`. A supplied `empId` (a colleague's, or another account's derived id) and a supplied `name` are never lookup keys; one row per account, whatever is supplied. The record's display name comes from the account, and self-declared `isLeader` / `leaderRole` / `buddyName` / `buddyEmail` are not honoured. admin / hrbp / pmo and the whole demo store keep the original behaviour (empId then case-insensitive name matching).
- **Instrumented no-GET-mutates test (Task 2).** better-sqlite3 `Statement.prototype.run/get/all/iterate` and `Database#exec` plus the fs write APIs are wrapped before `server.js` loads. Every registered GET route (the 55 `/api` GETs plus `/`, `/healthz`, `*`; 65 concrete URLs once the four report datasets x two formats are expanded) is driven sequentially in two lanes and any write recorded while a request is in flight is reported with route, file and SQL.
- **AUTHZ-04 second clause (Task 3).** No route is registered on a method outside GET/POST/PUT/PATCH/DELETE, every write route has a registered schema (`findUnvalidatedWriteRoutes`, the same source write-validation-coverage uses), and `scripts/list-unvalidated-routes.js` exits 0 as a child process against a throwaway data set.

## Task Commits

1. **Task 1 (tracer): get-or-create becomes a POST end to end** — `5d712dd`
2. **Task 2: instrumented no-GET-mutates test** — `f66fd9c`
3. **Task 3: write-method + validation sweep** — `d6eba04`

## Allowlists (explicit, never silent skips)

| Write | Allowed because |
|-------|-----------------|
| `INSERT` into `MA_AUDIT_DB_PATH` from any GET | by-design read-audit (`recordSecurityEvent`: org positions/decisions/flight-risk, DD request items/findings, reports export/pack). INSERT-only: an `UPDATE`/`DELETE` there is a violation (control-tested). 16 INSERTs observed in the real run, so the allowlist is live. |
| `GET /api/admin/download-zip`: file `os.tmpdir()/ma-app-<digits>.zip` | temp export archive, deleted after sending. The `zip -r` shell-out is stubbed with a one-file writer (the real binary would archive the whole checkout and make the suite slow and environment dependent); the test asserts the archive existed in both lanes and is gone afterwards. |

Everything else (any other SQL write on any file, any other fs write) fails the test.

## Measured results

- Real-deal admin: 65 GETs over 58 routes, status histogram `{200: 65}` after seeding one DD finding, one DD request item and one RAID entry through the API (so the by-id DD readers and the report pack do real work; an empty deal answers the pack 409).
- Demo-store admin: 65 GETs over 58 routes, `{200: 61, 403: 4}`; the four 403s are the DD/org readers that fail closed on a null deal (`grantedAreas` returns `[]` when there is no resolved deal) and are driven with `x` ids. A 5xx anywhere fails the test, so no drive is vacuous.
- No outbound network from any GET: `global.fetch` is wrapped and `/api/ai/insight` ran on the "no Gemini key" local fallback.
- **Reverted-fix proof (Task 2 acceptance criterion):** with `app.post('/api/employees/get-or-create'` temporarily switched back to `app.get(` in the worktree (not committed, restored with `git checkout -- server.js`), `test/no-get-mutates.test.js` failed naming the route, e.g. `SQL write to .../deals/deal_nogetmut.db during GET /api/employees/get-or-create [real-deal admin]: INSERT INTO employees ...`.
- **Other GET writers found: none.** The planner scan was right: get-or-create was the only GET handler that wrote; the instrumented drive and the static `writeDb()` scan over `app.get` bodies both came back clean. No other `server.js` region was touched, so the 11-03 / 11-04 / 11-05 regions are untouched.

## server.js regions touched

Only the two regions this plan claims: the `ROLE_WRITE_POLICY` self-service block (one new exact rule after `/api/employees/uncomplete-lesson`) and the get-or-create handler (plus the new `selfRosterId()` helper directly above it). Nothing in the task/RAID routes, the error-middleware block, the consolidated /api gate, `GET /api/notifications` or `/api/pulses`.

## Deviations from Plan

### Judgment calls

**1. [Tracer gate] No interactive human-verify checkpoint after the tracer commit**
- The dispatch's tracer policy for this run says to re-run the tracer's automated `<verify>` end to end and continue if it passes. Re-ran the four plan suites plus the read-policy matrix/coverage and path-canonical suites and then the whole suite (1093/1093) before starting Task 2. Passed; expansion proceeded.

**2. [Rule 2 - amendment 5] Restricted callers' leader / buddy attributes and display name are not honoured**
- **Found during:** Task 1 design.
- **Issue:** Resolving only the caller's own record is not sufficient if the same caller can still write self-declared `isLeader`, `leaderRole` and `buddy*` values onto a roster row that staff read, or name the row anything they like.
- **Fix:** In the restricted lane the new row takes its name from the account and the leader / buddy fields get their defaults. The plan text says "behaviour otherwise unchanged" for everything but name matching; amendment 5 (BINDING, wins over plan text) is the basis.
- **Files:** server.js — **Commit:** `5d712dd`

**3. [Plan vs. reality] "Existing test files this plan touches: none" — one was edited**
- `test/read-policy-matrix.test.js` asserted the amendment-1 rule (`roleAllowedForRead('employee', '/api/employees/get-or-create') === true` and a matrix row with `deny: []`). Removing the rule as amendment 1 requires meant updating exactly those two lines (11-01's own hand-off note flagged this). No other existing test was edited.
- **Commit:** `5d712dd`

**4. [Rule 3 - hermeticity] The reporter script is exercised against a throwaway data set**
- The plan's Task 3 verify command runs `node scripts/list-unvalidated-routes.js` directly, which boots `server.js` against whatever the default paths resolve to — the committed `data/*.db`. The in-test child-process run sets the `MA_*` paths to a temp directory instead, so the committed databases are never opened; `git status --porcelain data/` is empty.

### Behaviour worth knowing (not a deviation)

- **Intentional change for the real-deal employee portal.** In a real deal, the employee portal's welcome link `?empId=<roster id>&name=...` no longer binds the page to that roster record for an `employee`-role account; the page gets the account's own derived record. Lesson completion is `DEMO_ONLY_PREFIXES`-refused in real deals anyway, so the roster record's points/lessons were never live there. A legitimate link-to-record binding (HRBP assigns a roster record to an account) would need an explicit linkage field; that is a future decision, not a fallback to name matching.
- The demo lane is byte-for-byte the old behaviour; the tracer test proves 201 then 200 with the same profile on the seeded demo store. (An empty temp `demo.db` makes this handler 500 on missing `settings`, exactly as the GET did; tests seed the demo store from `db.json` via the migration + split the other gate suites use.)
- `app.get('*')` is in the GET inventory and is driven with a non-file SPA path; it serves `index.html` and writes nothing.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint or auth path beyond the intended GET -> POST move; the change narrows what a restricted role can resolve.

## Threat model status

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-11-50 GET get-or-create bypassed write policy + validation (R3 F-2) | mitigate | route is POST with zod schema + exact write-policy rule; GET removed (404 demo / 403 deal-bound employee, nothing created — asserted) |
| T-11-51 future GET handler that writes | mitigate | statement-level instrumentation over every registered GET, two lanes, negative controls (statement, fs, end-to-end), driven-route-count == inventory size, static `writeDb()` scan |
| T-11-52 get-or-create as roster lookup by name/empId | mitigate | restricted roles resolve only the account-derived record; asserted for supplied colleague empId, name-only, derived-id-of-another-account, and leader flags |
| T-11-53 cross-site GET-triggered writes | mitigate | the only GET writer removed; the write needs a JSON POST (not sendable by a plain link/img) |
| T-11-54 employee portal welcome-flow regression | mitigate | client updated in the same commit (`method: 'POST'` + JSON body), stamp bumped, demo lane proven end to end; plan 11-08 still drives the portal live in both lanes |

## Hand-off notes

- **11-07 (employee.js, W3):** `initializeEmployee()` is now the POST at ~line 2197; the file's `?v=` stamp is `1784500007` — bump it again when you edit the file.
- **11-08:** the employee-portal live drive should assert, in a real deal, that an employee-role session with a supplied colleague `empId` shows its own derived profile (id prefix `emp_acct_`) and no colleague data.
- **11-03 / 11-04 / 11-05:** adding a GET route that writes state now fails `test/no-get-mutates.test.js` (and the static scan if it calls `writeDb`); any new GET route must also have a `ROLE_READ_POLICY` rule (11-01).

## Self-Check: PASSED

- test/get-or-create-post.test.js and test/no-get-mutates.test.js present; validators/people.js, server.js, lib/readPolicy.js, public/js/employee.js, public/employee.html, test/read-policy-matrix.test.js modified
- commits `5d712dd`, `f66fd9c`, `d6eba04` present on the worktree branch
- `grep -c "app.get('/api/employees/get-or-create'" server.js` = 0, `grep -c "app.post('/api/employees/get-or-create'" server.js` = 1; employee.js stamp `1784500007`
- full suite `node --test`: 1101 tests, 1101 pass, 0 fail
- no STATE.md / ROADMAP.md / data/*.db / public/sent_emails changes
