---
phase: 04-due-diligence-workspace
plan: 06
subsystem: api
tags: [express, better-sqlite3, zod, assessment, wizard, audit-log, mnpi]

# Dependency graph
requires:
  - phase: 04-due-diligence-workspace (Plan 02)
    provides: the recordSecurityEvent()/before-after audit call shape (the deal-setup-update event mirrors it), the '/api/deals' ROLE_WRITE_POLICY entry (admin+hrbp) the two new deal routes inherit unchanged
  - phase: 04-due-diligence-workspace (Plan 05)
    provides: the most recent route+validator authoring pattern (validators/dd.js as the structural exemplar), the DD request-item/instantiate/finding/convert routes exercised end-to-end by Task 3's D-09 proof
  - phase: 03-deal-isolation-audit-validation (Plan 04)
    provides: db/controlStore.js's createDeal()/getDeal() and db/resolver.js's isControlPlanePath() coverage of /api/deals*, both extended (not replaced) by this plan
requires_todo:
  - .planning/todos/pending/new-deal-setup-wizard.md (WIZ-01's source — the user's own 7-step wizard proposal)
provides:
  - "server.js route POST /api/assessment-instances/assign — creates a pending (score-less) assessmentInstances row with an owner and a due date"
  - "server.js modification to POST /api/assessment-instances — an optional instanceId completes a pending row IN PLACE (never a second row)"
  - "server.js: latestAssessInstanceFor() now considers submitted rows only; GET /api/assessment-status reports each template's pending instances and orders bySubject via the new WIZARD_ASSESSMENT_SUBJECTS declared list"
  - "server.js routes POST /api/deals/wizard/basics (validate-only echo) and POST /api/deals/:id/setup (stamps one of six setup steps, recomputes complete, records a deal-setup-update security event)"
  - "db/controlStore.js: createDeal() extended with six optional basics fields + a setup skeleton; new updateDealSetup(dealId, patch); both exported"
  - "validators/wizard.js — new module: WizardBasicsSchema, DealSetupSchema, DEAL_SETUP_STEPS, DEAL_TYPES, both schemas registered"
  - "validators/assessment.js — AssignAssessmentSchema registered; AssessmentInstanceSchema extended with optional instanceId"
  - "validators/deals.js — CreateDealSchema extended with the same six basics fields WizardBasicsSchema declares"
  - "test/deal-wizard.test.js — 19 integration tests covering the whole create-early, assign/complete-by-id, resume, and D-09 no-hard-lock flow"
affects: [04-07-PLAN, 04-08-PLAN]

# Actuals (#2632)
actuals:
  tokens: 16896
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Complete-by-id-in-place: an 'assign' route creates a lightweight pending row (no scorer call, no score field at all — a pending row is identified by ABSENCE of a score, never a zero); the existing submission route grows an optional id that promotes that SAME row rather than adding a second write path — the D-24 shape any future 'assign now, fill in later' flow in this app should follow."
    - "Create-early setup skeleton: createDeal() stamps its OWN two steps done at creation time (basics/team) and leaves the rest null, so a half-finished wizard is a queryable, resumable STATE on the deal record rather than a rollback condition — updateDealSetup() does a SHALLOW merge into deal.setup, with the caller (the route handler) computing the fully-merged steps object first, mirroring setDealMemberGrants()'s 'caller computes, store just persists' shape."
    - "Declared-order report reshaping: WIZARD_ASSESSMENT_SUBJECTS is a fixed list the rollup re-keys its per-subject output against AFTER building it in whatever order the templates array happens to be in — insertion-order re-keying (not a re-derivation) is the mechanism, so a report's order can be pinned to a business-declared list independent of any DB/array ordering."

key-files:
  created:
    - validators/wizard.js
    - test/deal-wizard.test.js
  modified:
    - server.js
    - db/controlStore.js
    - validators/assessment.js
    - validators/deals.js

key-decisions:
  - "[Rule 1 - Bug] WIZARD_ASSESSMENT_SUBJECTS declared as ['acquirer-org', 'target-org', 'integration-leader'], not the plan interface-contract's literal 'il' — verified live against data/demo.db's actual seeded IL readiness template (atpl_il_readiness) before writing the constant; using 'il' would have silently excluded the real template from the declared-order sort."
  - "latestAssessInstanceFor() filters to status === 'submitted' exactly (no fallback for a missing status field) — verified live that every row in the committed data/demo.db already carries status:'submitted' (only the frozen, no-longer-read db.json fixture lacks it), so the strict check matches the plan's interface contract with no backward-compat branch needed."
  - "POST /api/deals/:id/setup's stamped step value carries an OPTIONAL data key ({at, by, data?}) beyond the interface contract's literal {at, by} — DealSetupSchema already accepts a bounded data record and discarding it after validating it would be dead weight; the acceptance criteria's own tests do not depend on this, so it is additive, not a deviation from any tested behavior."
  - "DealSetupDataSchema's value union includes a bounded string[] branch (not just string|number|boolean|null) — the scope step's natural payload (a workstream-id selection) is an array; discovered via a failing test (payload accepted per the plan's spirit, rejected by an overly-narrow first draft of the schema) and widened before commit."
  - "test/deal-wizard.test.js's synthetic template source is built directly AT dbFiles.DEMO_DB_PATH (this suite's own isolated temp file) rather than the committed data/demo.db — every session in the suite is deal-bound (never demo-lane), so this path is only ever read by createDealDatabase()'s template-copy pass, never written; pointing at the real committed demo.db instead would have risked a bug in this plan's code corrupting the actual showcase database."

patterns-established:
  - "Pending-row-by-absence, not-by-sentinel: a row's 'not yet done' state is expressed by which keys are ABSENT (no responses, no score fields) rather than a status enum value alone plus zeroed fields — makes an accidental zero-as-real-result bug structurally impossible to introduce by a future code path that forgets to check status."
  - "declared-order re-keying after building an unordered map: build once (with existing template-array-order logic completely unchanged), then re-key the same object literal into a fixed reporting order as a SEPARATE final step — isolates the 'what the data says' computation from the 'how it's presented' ordering, so a future report reordering never risks touching the actual satisfied/gatesSummary logic."

requirements-completed: [WIZ-01]

coverage:
  - id: D1
    description: "A readiness assessment can be ASSIGNED — created with an owner, a due date and a pending status, carrying no answers — kicking off all three readiness assessments before anyone has answered anything"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (a): assigning an instance produces a pending row with an owner and a due date and no score fields"
        status: pass
    human_judgment: false
  - id: D2
    description: "Completing a pending assessment updates that same instance by id (status -> submitted, answers/scores attached) and never creates a second instance row"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (c): completing it by id promotes the same row and leaves the lane length unchanged"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (e): completing an already-submitted instance by id is refused with a 400"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (f): completing an unknown instance id returns 404"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (g): a submission with no instanceId still creates a new row exactly as before"
        status: pass
    human_judgment: false
  - id: D3
    description: "The readiness rollup keeps working with pending instances present: a pending instance never counts as satisfied/never contributes a score, and is reported separately with owner+dueDate"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (b): the status rollup reports the pending instance while satisfied stays false"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (d): the rollup then reports satisfied true with the score present and the pending array empty"
        status: pass
    human_judgment: false
  - id: D4
    description: "A deal is created and audited after the wizard's basics and team steps alone; the remaining steps are recorded as an incomplete setup checklist rather than rolled back"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (h): creating a deal through the basics-plus-team payload returns the basics fields and a setup skeleton with basics/team stamped and the rest null"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (o): a failed database provisioning rolls back the registry row — never an orphaned entry pointing at a missing file"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (r): a second session for the same user resumes a skipped setup step without recreating the deal"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every wizard step's payload is validated by the same server-side schema pipeline every other write route uses, with no second client-side rule set; an empty/malformed body is refused with a 400 naming the field, and no partial setup state is stored"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (i): a create missing a required basics field is refused with a 400 and creates neither a registry row nor a deal database file"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (j): the basics validate-only route returns 200 for a valid payload and 400 for an invalid one, creating nothing in either case"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (l): posting an unknown step name is refused with a 400"
        status: pass
      - kind: other
        ref: "node scripts/list-unvalidated-routes.js exits 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "Completing exactly the mandatory core (basics + team) produces a usable deal; setup progress records which steps are outstanding, and completes once every step is stamped"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (k): posting a setup step stamps only that step and leaves the others untouched"
        status: pass
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (m): the deal becomes complete once every mandatory step is stamped"
        status: pass
    human_judgment: false
  - id: D7
    description: "Due diligence is usable the moment the deal exists: no route refuses work because a readiness assessment is unfinished"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (q): D-09 — with three assessments still pending, DD request/finding/convert all succeed; nothing is blocked on an unfinished assessment"
        status: pass
    human_judgment: false
  - id: D8
    description: "The three readiness assessment instances are reported in a fixed acquirer, target, Integration Lead order derived from a declared list, regardless of assignment order"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (s): the status rollup subject order is acquirer, target, Integration Lead regardless of assignment order"
        status: pass
    human_judgment: false
  - id: D9
    description: "Wizard routes are restricted to admin/IL (hrbp) — a pmo session is refused"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (n): a pmo session is refused both new wizard routes"
        status: pass
    human_judgment: false
  - id: D10
    description: "The full server-side wizard walk — validate, create-early, bind, inherit seeded templates, assign all three assessments, instantiate checklists, complete setup — works end to end over real HTTP"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (p): the full ordered wizard walk ends with setup complete and three pending readiness assessments outstanding"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-08-02
status: complete
---

# Phase 4 Plan 6: New-Deal Setup Wizard Server Side (WIZ-01) Summary

**Assign-then-complete-in-place readiness assessments (never a duplicate instance), a deal that exists and is audited after its mandatory core alone and remembers exactly which of six setup steps are still outstanding, and one shared zod validation pipeline for every wizard step — proven end to end through the real HTTP stack, including proof that due diligence is never blocked on an unfinished assessment.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3 (all completed)
- **Files modified:** 6 (2 created, 4 modified)
- **Commits:** 3 task commits + this docs commit

## Accomplishments

- Built `POST /api/assessment-instances/assign` (`server.js`): creates a `status: 'pending'` `assessmentInstances` row carrying an `owner` and a `dueDate` — no scorer is ever called and no score field is ever set, so a pending row is distinguishable from a real result by the ABSENCE of a score, never a zero (T-04-33).
- Extended `POST /api/assessment-instances` with an optional `instanceId` that completes that SAME pending row in place — finds it, refuses (400) unless its status is `pending`, mutates it with the scorer's output and `status: 'submitted'`, and writes once. Zero second-row path: `test/deal-wizard.test.js` proves the lane length is unchanged across assign-then-complete.
- `latestAssessInstanceFor()` now skips any row whose `status` is not `submitted`, so a pending row can never feed a score, band or compatibility calculation. `GET /api/assessment-status` reports each template's pending instances (`{id, owner, dueDate}`, sorted by due date then id) alongside the existing submitted-only `satisfied`/`latestInstance`, and now orders its `bySubject` output via a new declared `WIZARD_ASSESSMENT_SUBJECTS` list rather than template array order.
- Built the create-early deal setup surface: `createDeal()` (`db/controlStore.js`) now accepts six optional basics fields and stamps a `setup` skeleton whose `basics`/`team` steps are already done by the create call itself; new `updateDealSetup(dealId, patch)` mirrors `updateDealMembers()`'s read-modify-write/throw-when-missing contract. `POST /api/deals/wizard/basics` is a persist-nothing validate-only echo (D-07 — one shared rule set for the wizard's first step); `POST /api/deals/:id/setup` stamps one of six steps, recomputes `complete`, and records a `deal-setup-update` security event with before/after.
- New `validators/wizard.js` (`WizardBasicsSchema`, `DealSetupSchema`, both registered) and extensions to `validators/assessment.js` (`AssignAssessmentSchema`) and `validators/deals.js` (`CreateDealSchema`'s six basics fields, kept in exact bound-for-bound sync with `WizardBasicsSchema`).
- Proved the whole flow — including a forced provisioning-failure rollback (deals directory made read-only mid-test) and a resume-with-a-new-session case — through 19 integration tests in `test/deal-wizard.test.js`, against a synthetic but real-shaped template source built directly at the suite's isolated temp `demo.db` path so the REAL, unmodified `POST /api/deals` route seeds correctly without ever touching the actually-committed showcase database.

## Task Commits

Each task was committed atomically:

1. **Task 1: Assigned-but-unfinished readiness assessments** - `f7ba9f9` (feat)
2. **Task 2: Create-early deal setup state on the deal record** - `c0d39ff` (feat)
3. **Task 3: The full create-early, resume-later flow proven end to end** - `2fdaa8c` (test)

## Files Created/Modified

- `validators/wizard.js` (new) - `WizardBasicsSchema`, `DealSetupSchema`, `DEAL_SETUP_STEPS`, `DEAL_TYPES`, both schemas registered into `WRITE_SCHEMAS`
- `test/deal-wizard.test.js` (new) - 19 integration tests: assign/complete-by-id (a-g), create-early setup state (h-o), the full end-to-end walk plus D-09/resume/subject-order proofs (p-s)
- `server.js` (modified) - `POST /api/assessment-instances/assign`, the `instanceId` completion branch on `POST /api/assessment-instances`, `latestAssessInstanceFor()`'s submitted-only filter, `WIZARD_ASSESSMENT_SUBJECTS` + `GET /api/assessment-status`'s pending/ordered-bySubject changes, `POST /api/deals/wizard/basics`, the extended `POST /api/deals` handler, `POST /api/deals/:id/setup`, `require('./validators/wizard')`
- `db/controlStore.js` (modified) - `createDeal()` extended with six basics fields + the `setup` skeleton, new `updateDealSetup()`, `DEAL_SETUP_STEPS`, both exported
- `validators/assessment.js` (modified) - `AssignAssessmentSchema` (registered), `AssessmentInstanceSchema.instanceId` (optional)
- `validators/deals.js` (modified) - `CreateDealSchema` extended with the six basics fields

## Decisions Made

- **`WIZARD_ASSESSMENT_SUBJECTS` uses `'integration-leader'`, not the plan text's literal `'il'`** (Rule 1 auto-fix) — verified live against `data/demo.db`'s actual seeded IL readiness template before writing the constant.
- **`latestAssessInstanceFor()` filters strictly on `status === 'submitted'`**, with no legacy fallback — verified every row in the live committed `data/demo.db` already carries `status: 'submitted'` (only the frozen, no-longer-read `db.json` fixture lacks it).
- **The stamped setup-step value carries an optional `data` key** beyond the interface contract's literal `{at, by}` shape — `DealSetupSchema` already validates a bounded `data` record; discarding it after validating would be dead weight, and no acceptance criterion depends on its absence.
- **`DealSetupDataSchema`'s value union includes a bounded `string[]` branch** — discovered via a failing test when the scope step's natural workstream-selection payload (an array) was rejected by an overly narrow first draft; widened before commit.
- **The test suite's synthetic template source lives directly at `dbFiles.DEMO_DB_PATH`** (the suite's own isolated temp file), not a separate fixture path and not the real committed `data/demo.db` — every session in the suite is deal-bound, so this path is only ever read (never written) by `createDealDatabase()`'s template-copy pass, and Task 3's walk needed the REAL, unmodified `POST /api/deals` route (not a test-only bypass) to naturally pick it up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `WIZARD_ASSESSMENT_SUBJECTS`'s plan-specified `'il'` value does not match the real seeded template's subject**
- **Found during:** Task 1 (declaring the constant per the plan's interface contract)
- **Issue:** The plan's interface contract literally specifies `['acquirer-org', 'target-org', 'il']`. The actual seeded IL readiness template (`atpl_il_readiness`, both in `data/demo.db` and every deal's copy of it via `db/dealSeed.js`) carries `subject: 'integration-leader'`, not `'il'` — verified with a direct query against the live database before writing any code. Using `'il'` verbatim would have silently excluded the real template from the declared-order sort, falling through to the "any subject not on the list" append-at-end branch instead of sorting third as intended.
- **Fix:** Declared `WIZARD_ASSESSMENT_SUBJECTS = ['acquirer-org', 'target-org', 'integration-leader']`, with an inline comment documenting the verified discrepancy.
- **Files modified:** `server.js`
- **Verification:** `test/deal-wizard.test.js#deal-wizard (s)` asserts the exact declared order comes back correctly for the real template subject value.
- **Committed in:** `f7ba9f9` (Task 1 commit)

**2. [Rule 3 - Blocking] `DealSetupDataSchema`'s first draft rejected the scope step's natural array payload**
- **Found during:** Task 2 (writing test (k), posting a `scope` step with `data: { workstreams: [...] }`)
- **Issue:** The first draft of `DealSetupDataSchema` was a scalar-only record (`string | number | boolean | null`), which 400ed the workstream-id array a scope-selection payload naturally is.
- **Fix:** Widened the value union to include a bounded `string[]` branch (capped at 50 elements of max-60-char strings — D-13's "no unbounded string/array" still holds).
- **Files modified:** `validators/wizard.js`
- **Verification:** `test/deal-wizard.test.js#deal-wizard (k)` passes with the array payload; `npm test` green throughout.
- **Committed in:** `c0d39ff` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 3 blocking-fix)
**Impact on plan:** Both fixes are narrow and necessary — the first prevents a real subject from silently falling out of the declared report order, the second lets the scope step actually carry the array-shaped payload the wizard's own design calls for. No scope creep; no architectural change.

## Issues Encountered

None beyond the two auto-fixed deviations above. The end-to-end Task 3 walk (via the real, unmodified `POST /api/deals` route) required refactoring the test suite's synthetic template source to live at `dbFiles.DEMO_DB_PATH` rather than a separate fixture file — this was a test-infrastructure adjustment, not a production-code deviation, and is documented under "Decisions Made" above rather than as a Rule 1-4 fix.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The assign/complete-by-id pattern and the create-early setup-state pattern are both stable, reusable shapes for any later plan that needs "assigned but not yet done" work tracking or "usable immediately, resumable later" multi-step state on a deal record.
- The wizard's server-side surface (assign/complete/status-with-pending, wizard/basics validate-only, deal/:id/setup) is fully proven over real HTTP and ready for a frontend wizard UI plan (04-07 or 04-08) to build against — no server-side gaps remain for the 7-step flow described in `.planning/todos/pending/new-deal-setup-wizard.md`.
- No blockers for the next plan.

---
*Phase: 04-due-diligence-workspace*
*Completed: 2026-08-02*

## Self-Check: PASSED

All files created/modified by this plan exist on disk and all three task commits are present in git history:

- FOUND: validators/wizard.js
- FOUND: test/deal-wizard.test.js
- FOUND: server.js
- FOUND: db/controlStore.js
- FOUND: validators/assessment.js
- FOUND: validators/deals.js
- FOUND commit: f7ba9f9 (Task 1)
- FOUND commit: c0d39ff (Task 2)
- FOUND commit: 2fdaa8c (Task 3)

`npm test` = 203/203 (184 baseline + 19 new). `node scripts/list-unvalidated-routes.js` exits 0. `node -e "require('./server.js')"` boots clean.
