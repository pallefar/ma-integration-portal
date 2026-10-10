---
phase: 11-authorization-clean-room-closure
plan: 01
subsystem: auth
tags: [authorization, read-policy, role-gate, fail-closed, clean-room, express, node-test]

requires:
  - phase: 10-accounts-identity
    provides: "lib/requestPath.js canonical path forms (CR-01), per-request account re-read (D-10-04), session deal binding"
provides:
  - "lib/readPolicy.js: ROLE_READ_POLICY table + readRuleFor / roleAllowedForRead / readAllowsForms / accessSummaryFor"
  - "server.js consolidated /api gate evaluates the read policy for GET/HEAD/OPTIONS whenever req.isDemo !== true (fail-closed, demo store lenient)"
  - "app.gatePolicy.readAllows(role, forms, canonical) and req.gatePathCanonical"
  - "test/helpers/deal-fixture.js (createDealFixture / demoSession) and test/helpers/route-inventory.js (listApiRoutes / uncoveredGetRoutes / concretePath)"
  - "fail-the-build coverage gate over the live GET route inventory"
affects: [11-02, 11-03, 11-04, 11-05, 11-06, 11-07, 11-08]

actuals:
  tokens: 10500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "explicit role-per-read-route table, no default rule (unlisted => refused for any non-demo request)"
    - "canonical-anchored, most-restrictive verdict over pathForms"
    - "coverage test over app._router.stack that fails the build on an unlisted GET route or a dead/shadowed rule"

key-files:
  created:
    - lib/readPolicy.js
    - test/helpers/deal-fixture.js
    - test/helpers/route-inventory.js
    - test/read-policy-coverage.test.js
    - test/read-policy-matrix.test.js
  modified:
    - server.js
    - test/path-canonical-gate.test.js
    - test/org-positions.test.js

key-decisions:
  - "Read verdict is anchored on the canonical rule and refuses if ANY spelling that has a rule of its own refuses; a spelling with no rule inherits the canonical verdict (so admin is not refused on /api/Admin/users)"
  - "Gate skips the read check only when req.isDemo === true; control-plane resolutions (/api/deals*, /api/admin*, /api/auth/sessions) and deal-bound resolutions are strict"
  - "/api/employees/get-or-create gets an exact all-roles rule ahead of the STAFF /api/employees rule (amendment 1); plan 11-06 removes it when the route becomes a POST"

patterns-established:
  - "Adding a GET /api route without a ROLE_READ_POLICY rule fails test/read-policy-coverage.test.js"
  - "Authorization suites build a real-deal fixture with createDealFixture({controlConn, runtimeConn, dealId, members}); deal ids must match deal_[a-z0-9]+"

requirements-completed: [AUTHZ-01]

duration: 45min
completed: 2026-10-10
status: complete
---

# Phase 11 Plan 01: Explicit read policy (ROLE_READ_POLICY) Summary

**Fail-closed, canonical-path-anchored ROLE_READ_POLICY gate: a real-deal `employee` is now refused 403 on synergies, RAID, tasks, roster, communications, org, DD, reports and the other staff-only GET families, while the demo store and every CMS/learning read are unchanged, and a coverage test fails the build on any unlisted GET route.**

## Performance

- **Tasks:** 3 completed (1 tracer, 2 auto/tdd)
- **Files:** 5 created, 3 modified
- **Suite:** 1069/1069 green at the final commit (0 failures at every commit)

## Accomplishments

- `lib/readPolicy.js` — ordered `{prefix, exact?, roles, why}` table in the same boundary-safe shape as ROLE_WRITE_POLICY, no default rule, `readAllowsForms` canonical-anchored verdict, and `accessSummaryFor(role, dealBound)` (one source of truth for plan 11-07; `dealBound=false` returns every key true).
- Gate wiring in `server.js` (after the write/admin role check, before `validationMiddleware`): GET/HEAD/OPTIONS judged as GET, refused with `403 { error: 'Your role cannot view this information.' }` when the request did not resolve to the demo store and the role is not allowed.
- Tracer proven end to end first (`employee` -> `/api/synergies` and `/api/synergies/rollup` 403, admin/hrbp/pmo 200, unbound employee on the demo store 200), then every GET family narrowed to the PRD matrix.
- Coverage gate: every registered GET route has a rule, a synthetic `/api/zz-unlisted-probe` is reported uncovered, every rule governs at least one route (shadowed rules count as dead), every route path is lowercase, and a deal-bound pmo GET (and HEAD) to an unlisted path is 403 not 404.
- Variant loop: `ROLE_READ_POLICY x variants` in `test/path-canonical-gate.test.js` loops over the whole table (new rules covered for free) with every role, every spelling variant, plus HEAD and OPTIONS.
- Table-driven real-deal role x route matrix (40 rows x 4 roles) and a demo-store lenient control.

## Final ROLE_READ_POLICY table (first match wins)

| Rule | Roles | Why |
|------|-------|-----|
| `/api/admin` | admin | account roster, audit log, archive download (CR-02) |
| `/api/auth/sessions` | all | every role manages its own sessions (D-10-07) |
| `/api/deals` (exact) | all | list is membership-filtered (deal switcher) |
| `/api/deals` | admin, hrbp | per-deal member grants (matches inline handler guard) |
| `/api/synergies` | admin, hrbp, pmo | synergy financials (R1-05) |
| `/api/integration-tasks` | staff | task lane titles can name the target |
| `/api/checklist-templates` | staff | feed the task lane |
| `/api/raid` | staff | RAID register |
| `/api/org` | staff | org design / retention (MNPI) |
| `/api/dd` | staff | DD workspace (handlers still apply clearance) |
| `/api/reports` | staff | exports and pack aggregate all datasets |
| `/api/employees/get-or-create` (exact) | all | amendment 1 — removed by 11-06 |
| `/api/employees` | staff | named roster |
| `/api/communications` | staff | can name affected populations |
| `/api/projects` | staff | target/project names |
| `/api/processes` | staff | deal operating model |
| `/api/assessments` | staff | named results list |
| `/api/ai/insight` | staff | third-party egress of portal data |
| `/api/rag/search` | staff | deal uploads are indexed |
| `/api/assessment-instances` | admin | matches handler's admin-only guard |
| `/api/hrbps` | admin, hrbp | colleague emails (D-11-06) |
| `/api/assessment/latest`, `/api/assessment-templates`, `/api/assessment-status` | all | org-level / templates / names stripped |
| `/api/settings` | all | 11-02 returns a public subset to non-admins |
| `/api/departments`, `/api/modules`, `/api/questions` | all | non-sensitive |
| `/api/slides`, `/api/courses`, `/api/lessons`, `/api/i18n`, `/api/menus`, `/api/pages`, `/api/banners`, `/api/media` | all | CMS / learning reads |
| `/api/notifications` | all | 11-05 gates task/RAID nudges |
| `/api/alerts` | all | alerts |
| `/api/pulses` | all | 11-05 projects personal data |

(`staff` = admin, hrbp, pmo.)

## Measured break counts

- After Task 1 (mechanism, every family at today's effective roles except synergies): 0 failures (1059/1059).
- After Task 2 (coverage + variant loop): 0 failures (1066/1066).
- After narrowing in Task 3, before fixing: **1 pre-existing test broke** — `org-positions.test.js (e)` (matches the planner's measurement of 1) — plus **1 of my own new tests** (the variant loop, see Deviations 2). Both fixed in the same commit; final 1069/1069.

## Task Commits

1. **Task 1 (tracer): mechanism, fail-closed gate, employee -> synergies** — `3f6c823`
2. **Task 2: coverage gate + ROLE_READ_POLICY x variants** — `a763dc9`
3. **Task 3: narrow every family to the PRD matrix + org-positions fix** — `b224424`

## Deviations from Plan

### Judgment calls

**1. [Tracer gate] No interactive human-verify checkpoint after the tracer commit**
- The tracer protocol says an interactive (non-auto) run stops for a `checkpoint:human-verify`. This plan is `autonomous: true`, was dispatched as a parallel wave executor with an explicit instruction to complete and commit, and the tracer's `<verify>` is fully automated. I applied the autonomous half of the gate instead: re-ran the tracer's verify end to end (the matrix test plus the full suite) before any expansion task. It passed (1059/1059), so expansion proceeded.

### Auto-fixed issues

**2. [Rule 1 - plan assertion too strong] Variant loop: allowed role vs non-routable spellings**
- **Found during:** Task 3 (full suite after narrowing)
- **Issue:** The new live variant test asserted "an allowed role is never gate-refused for any spelling". `/api/employees/Get-or-create` is refused for `employee`: its raw form has no exact rule of its own but matches the broader STAFF `/api/employees` prefix, so the most-restrictive verdict refuses. That is the safe direction (the Phase 10 CR-01 property) and the spelling is not routable anyway (`case sensitive routing`, no path decoding at match time -> 404), so nothing legitimate is lost.
- **Fix:** The test now requires "not refused by the gate" only for spellings the router actually dispatches to the handler (trailing slash / `//`, which collapse to the canonical form); case and %-encoded spellings are still required to be refused for refused roles and are never required to be served for allowed roles. The most-restrictive verdict was deliberately NOT loosened.
- **Files:** test/path-canonical-gate.test.js
- **Commit:** `b224424`

**3. [Rule 1 - test validity] org-positions (f) also migrated off the employee-role "uncleared" member**
- After narrowing, `(f)` still passed, but only because the role gate (not the clearance check) produced its 403. Moved to the same pmo-role `pmo-uncleared` account as (e) so it keeps proving what its name says. (e) additionally asserts an employee deal member gets 403 with no position data on `GET /api/org/positions`, as planned.
- **Files:** test/org-positions.test.js — **Commit:** `b224424`

**4. [Rule 3 - fixture constraint] deal ids**
- `dealDbPath()` accepts only `deal_[a-z0-9]+`; the fixture and test ids follow that (no underscores after the prefix).

### Behaviour worth knowing (not a deviation)

- **Control-plane paths are strict even for an unbound session.** `db/resolver.js` classifies `/api/deals*`, `/api/admin*` and `/api/auth/sessions` as `control` (`req.isDemo` false) regardless of deal binding, so the read policy applies to them in the "demo" lane too. Their refusals are the same statuses as before (CR-02 carve-out / the handler's own inline guard; only the 403 message differs for `/api/deals/:id/grants`). The matrix's demo test asserts exactly this split.
- The demo-lane tests run against the empty temp `demo.db` (every suite's isolation), so a few handlers log `Unhandled route error ... timeTravelDay/targetCompany` (500 on missing settings). This is pre-existing and unrelated to the gate; those assertions only require that the read gate never refuses the demo store.

## Hand-off notes for later plans

- 11-06 must delete the `/api/employees/get-or-create` rule when the route becomes a POST (the test matrix row `/api/employees/get-or-create?empId=x` and the coverage "no dead rules" test will flag it if the route disappears first).
- 11-07 consumes `accessSummaryFor(role, dealBound)` — probe paths are fixed in `ACCESS_PROBES`; do not copy the table client-side.
- Any plan adding a GET `/api/...` route must add a `ROLE_READ_POLICY` rule in the same commit or `test/read-policy-coverage.test.js` fails (this is the point).
- Plans 11-02/11-03 touch `server.js` handler regions only; the gate/table mechanism is complete here.

## Known Stubs

None.

## Threat Flags

None — no new network endpoint, auth path or schema surface; the change only restricts existing reads.

## Threat model status

| Threat | Disposition | Status |
|--------|-------------|--------|
| T-11-01 unlisted/gap route | mitigate | no default rule, fail-closed for non-demo; coverage test fails the build |
| T-11-02 spelling variants | mitigate | canonical-anchored most-restrictive verdict; variant loop over the whole table |
| T-11-05 demo showcase regression | mitigate | demo-lane matrix test: no role is refused by the read gate on the demo store |
| T-11-06 HEAD/OPTIONS bypass | mitigate | judged as GET by the same check; asserted live for every refused role and rule |

## Self-Check: PASSED

- lib/readPolicy.js, test/helpers/deal-fixture.js, test/helpers/route-inventory.js, test/read-policy-coverage.test.js, test/read-policy-matrix.test.js present
- commits `3f6c823`, `a763dc9`, `b224424` present on the worktree branch
- no STATE.md / ROADMAP.md / data/*.db changes
