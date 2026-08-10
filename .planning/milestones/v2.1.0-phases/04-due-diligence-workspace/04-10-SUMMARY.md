---
phase: 04-due-diligence-workspace
plan: 10
subsystem: api
tags: [sqlite, wizard, dedup, node-test, vanilla-js]

# Dependency graph
requires:
  - phase: 04-due-diligence-workspace (04-09)
    provides: an honest `setup.steps` object (completion-only Finish never fabricates a step stamp) — the hard prerequisite for this plan's resume cursor
provides:
  - "controlStore.hasOutstandingSetupStep()/findUnfinishedDealFor() — the server-side duplicate-create guard"
  - "POST /api/deals resuming the caller's own unfinished deal (resumed: true) instead of minting a duplicate"
  - "The wizard's resume-on-entry bootstrap, firstOutstandingWizardStep() cursor, enterWizardStep() single non-linear entry path, and an already-created-deal guard on Back-then-Next"
  - "primeAssignedFromStatus() — resume-safe readiness-assessment step (never double-assigns)"
  - "A resume notice + 'Start a different deal instead' escape hatch"
affects: []

# Actuals (#2632)
actuals:
  tokens: 5176
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A server-side duplicate-create guard keyed on createdBy + exact name + exact target + an outstanding setup step — the safe-direction dedup key (a mismatch always yields a harmless extra deal, never a wrong-deal resume)"
    - "enterWizardStep() as the SINGLE non-linear wizard entry path (resume bootstrap, the already-created-deal guard, and the create-success path all route through it), so the review step's counts are correct wherever it lands"
    - "TDD-first regression proof: writing the live-HTTP dedup cases, stashing only the source fix (keeping the new tests), confirming the exact failure mode, then restoring the fix"

key-files:
  created: []
  modified:
    - db/controlStore.js
    - server.js
    - public/js/deal-wizard.js
    - public/deal-wizard.html
    - test/deal-wizard.test.js
    - test/deal-wizard-page.test.js

key-decisions:
  - "The dedup key is createdBy + exact name + exact target + hasOutstandingSetupStep() — never fuzzy-matched, never cross-user, and never keyed on name alone (a FINISHED deal is excluded, per test (ac), so a genuinely new deal sharing a name with a long-closed one is never blocked)"
  - "enterWizardStep(n) is the one function every non-linear jump (resume bootstrap, the step-2 guard, the create-success path) routes through — it always primes the assigned-assessment set and template list before running the target step's own loader, so the review step's counts are correct regardless of which step a resume lands on"
  - "Resume is deliberately NOT gated on the deal's `complete` flag — after 04-09 an operator can legitimately finish the wizard with steps still outstanding, and the deal home's 'Setup incomplete — resume setup' link points at exactly that case; gating on `complete` would re-create the deal, the very bug being fixed"
  - "showResumeNotice() also hides #wiz-back-3, covering BOTH resume entry points (the bootstrap and the create-success-resumed path) from one place, since resume semantics are identical in both — steps 1-2 are already recorded and are not re-walked"

requirements-completed: [WIZ-01]

coverage:
  - id: D1
    description: "Posting the identical basics-and-team payload twice returns the SAME deal and creates nothing (no new registry row, no new deal database file) the second time, carrying a resumed flag the first response does not"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (aa): posting the identical basics-and-team payload twice returns the SAME deal and creates nothing the second time"
        status: pass
    human_judgment: false
  - id: D2
    description: "A create with a different deal name (same target) is still a genuinely new deal — the guard is not over-broad"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (ab): a create with a different deal name is still a genuinely new deal"
        status: pass
    human_judgment: false
  - id: D3
    description: "Once every setup step is stamped (finished), an identical payload creates a NEW deal — the dedup key is an unfinished setup, not the name alone"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard.test.js#deal-wizard (ac): once every setup step is stamped, an identical payload creates a new deal"
        status: pass
    human_judgment: false
  - id: D4
    description: "The wizard declares a resume notice and a 'Start a different deal instead' restart control, and the create call is guarded against re-posting once this wizard session already has a deal"
    requirement: "WIZ-01"
    verification:
      - kind: unit
        ref: "test/deal-wizard-page.test.js#deal-wizard-page: the wizard declares a resume notice and a restart control"
        status: pass
      - kind: unit
        ref: "test/deal-wizard-page.test.js#deal-wizard-page: the create call is guarded by an already-created-deal check"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live browser walk: reloading mid-wizard resumes the same deal at the first outstanding step (never a duplicate), the resume notice names the deal, Back is hidden, the escape hatch genuinely starts a different deal, and the recovery path from the deal home's 'resume setup' link lands on the correct outstanding step"
    verification: []
    human_judgment: true
    rationale: "This gap (G-04-8) and its sibling (G-04-10) were both found by a live UAT that every source test in this phase already passed through — source-green code shipped a real duplicate-deal bug once already in this phase. The executor has no browser; the plan's own Task 2 human-check explicitly reserves this walk for the user, per the execution context's division of labor."

# Metrics
duration: 45min
completed: 2026-08-02
status: complete
---

# Phase 04 Plan 10: Wizard Resume-Instead-Of-Duplicate Summary

**A server-side duplicate-create guard (createdBy + exact name + exact target + outstanding setup) plus a client-side resume-on-entry bootstrap close G-04-8: re-entering the wizard now resumes the caller's own unfinished deal at its first outstanding step instead of minting a second, indistinguishable copy.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `db/controlStore.js` gained `hasOutstandingSetupStep(deal)` (mirrors `deal-home.js`'s own `done = steps[step.id] != null` check) and `findUnfinishedDealFor({ createdBy, name, targetCompany })` — the first non-archived, unfinished deal matching all three, or `null`.
- `server.js`'s `POST /api/deals` now looks up `findUnfinishedDealFor()` before ever calling `createDeal()`. A match returns the EXISTING deal with `resumed: true`, creating no registry row, provisioning no database file, and recording no security event. D-05 create-early is untouched: no match still creates on the very first successful basics-and-team post.
- `public/js/deal-wizard.js` gained the full resume machinery: `state.deal` (paired with `state.dealId`), `firstOutstandingWizardStep(deal)`, `primeAssignedFromStatus()` (pre-marks already-satisfied/pending templates so a resume at the assessment step never double-assigns), `enterWizardStep(n)` (the single non-linear entry path), an `if (state.deal)` guard on the step-2 submit handler (closes the reload-free Back-then-Next duplicate path), and `showResumeNotice()`/the "Start a different deal instead" escape hatch wired to `#wiz-resume-restart`.
- `public/deal-wizard.html` gained the resume notice markup (teal informational register, not error red) and its cache stamp moved `?v=1784800001` → `?v=1784800002`.
- Six new regression tests (three live-HTTP dedup cases, two page-source assertions, plus the two new route-inventory entries) — `npm test` = 239/239, `node scripts/list-unvalidated-routes.js` exits 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: The server refuses to create a second copy of an unfinished deal** - `a506544` (fix)
2. **Task 2: The wizard resumes an unfinished deal instead of restarting** - `acff4d6` (fix)

_Both tasks were TDD-ordered for their live-HTTP cases: (aa)/(ab)/(ac) were written first, verified against pre-fix code by stashing only `db/controlStore.js` and `server.js` (keeping the new test file), then the fix was restored._

## Files Created/Modified
- `db/controlStore.js` - `hasOutstandingSetupStep()` and `findUnfinishedDealFor()`, exported alongside the existing deal helpers
- `server.js` - `POST /api/deals` resumes an existing unfinished deal (`resumed: true`) before ever calling `createDeal()`
- `public/js/deal-wizard.js` - resume-on-entry bootstrap, `firstOutstandingWizardStep()`, `enterWizardStep()`, the already-created-deal guard, `primeAssignedFromStatus()`, the already-assigned static status row in `loadAssessmentTemplates()`, `showResumeNotice()`/`hideResumeNotice()`, and the `#wiz-resume-restart` escape hatch
- `public/deal-wizard.html` - resume notice + restart control markup, `.wiz-resume-notice` style rule, cache stamp bumped to `?v=1784800002`
- `test/deal-wizard.test.js` - three new live-HTTP cases: (aa) identical payload twice → same deal, nothing created; (ab) different name → genuinely new deal; (ac) finished setup → identical payload creates a new deal
- `test/deal-wizard-page.test.js` - two new `ENDPOINTS` entries (`/api/auth/me`, `/api/assessment-status`) and two new source assertions (resume-surface markup ids, the `if (state.deal) {` create-call guard)

## Decisions Made
- Followed the plan's locked design exactly: resume the session's bound unfinished deal using `setup.steps` as the cursor, rather than any client-side "have I already submitted this" flag or a server-side idempotency-key scheme.
- `showResumeNotice()` hides `#wiz-back-3` itself (rather than duplicating that line at both call sites) since both the bootstrap-resume path and the create-success-resumed path need the identical hide, and resume semantics are the same in both.
- `enterWizardStep()` always runs `primeAssignedFromStatus()` + `loadAssessmentTemplates()` before branching on the target step, even for steps (3, 5) that need neither extra loader — this keeps `state.templates`/`state.assignedTemplateIds` correct for the review step's counts no matter where a resume lands, at the cost of one harmless extra fetch pair per jump.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None. The TDD gate ran cleanly and was reported honestly: with `db/controlStore.js`/`server.js` stashed back to pre-fix code, test (aa) genuinely FAILED (`deal_msc5irnp977632cd` returned instead of the expected `deal_msc5irng5af6844e` — the literal duplicate-deal bug), while (ab) and (ac) already PASSED pre-fix. This is expected, not a weakness: pre-fix code always creates a brand-new deal on every POST, so "a different name creates a new deal" and "a finished deal doesn't block a new create" trivially hold under the OLD, always-create behavior — their regression value is protecting the NEW dedup guard from becoming over-broad, not proving the duplicate bug itself (which only (aa) does).

## User Setup Required
None — no external service configuration required.

## Next Phase Readiness
- Source-level work for G-04-8 is complete and proven: `npm test` = 239/239, `node scripts/list-unvalidated-routes.js` exits 0, `data/` confirmed clean by direct WAL inspection (all sidecars were 0-byte, pre-existing SQLite connection artifacts from running the route-validation script against the real `data/` dir — not writes; removed for tidiness; `git status --short data/` and `git diff --stat` on the tracked `.db` files both confirm no tracked content changed).
- **G-04-8 is NOT yet closed** per this plan's own `<verification>` section — the live browser walk (Task 2's `human-check`) is deliberately deferred to the user, who has no browser access delegated to this executor run. That walk (duplicate repro, resume-at-first-outstanding-step, the escape hatch, and the G-04-10 re-confirmation) is the only remaining step before this gap can be marked closed in `04-UAT.md`.
- G-04-10 (the sibling gap, closed by 04-09) is re-confirmed end-to-end by the same live walk, per the plan's Task 2 human-check item 3.

---
*Phase: 04-due-diligence-workspace*
*Completed: 2026-08-02*

## Self-Check: PASSED

All modified files and both task commits (`a506544`, `acff4d6`) verified present via `git log --oneline --all`.
