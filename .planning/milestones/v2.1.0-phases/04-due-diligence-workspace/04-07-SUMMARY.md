---
phase: 04-due-diligence-workspace
plan: 07
subsystem: ui
tags: [wizard, deal-creation, vanilla-js, wiz-01, mnpi, form-validation]

# Dependency graph
requires:
  - phase: 04-due-diligence-workspace (Plan 06)
    provides: "the server-side wizard write surface this plan's client calls directly: POST /api/deals/wizard/basics (validate-only), the extended POST /api/deals (six basics fields + create-early setup skeleton), POST /api/deals/:id/setup (one of six enum-bounded steps), POST /api/assessment-instances/assign (pending readiness-assessment rows), and GET /api/assessment-status's pending/bySubject shape"
  - phase: 03-deal-isolation-audit-validation (Plan 04)
    provides: "public/js/deal-switcher.js's header switcher + the D-04 minimal create-deal modal this plan supersedes and retires (D-06)"
provides:
  - "public/deal-wizard.html — the seven-step full-page guided flow (step rail, progress bar, seven step panels) that supersedes the Phase-3 minimal create-deal modal"
  - "public/js/deal-wizard.js — the client-side state machine: one submit handler per step wired to the server routes named in the interface contract, document-wide/row-scoped server-error rendering (D-07 — zero duplicated validation rules beyond the browser's own required attribute), zero markup-sink assignment"
  - "public/js/deal-switcher.js and public/js/admin.js repointed so the ONLY path into real-deal creation is the guided wizard (D-06); the retired create-deal modal builder and its window export are removed entirely"
  - "public/js/transitions.js: 'deal-wizard.html' pageAccess entry (admin + hrbp/Integration Lead only)"
  - "test/deal-wizard-page.test.js — 8 source-and-route-inspection tests, including a regression test for the display-visibility defect found during Task 3's live UAT"
affects: [04-08-PLAN]

# Actuals (#2632)
actuals:
  tokens: 17100
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Document-wide field-path error rendering off a single-string server response: the server's `{ error: \"field.path: message\" }` shape (validators/index.js's formatIssues()) is split on '; ' for multiple issues, then on the FIRST ':' per issue for path vs. message; the path's first segment is matched against a `[data-field=\"...\"]` element ANYWHERE in the document (not scoped to the submitting step's own panel), because a later step's write can re-validate an earlier step's field (e.g. step 2's create call re-validates the whole basics-plus-team payload) — the message must land beside the input that actually holds that value, wherever it lives."
    - "Resume-safe sequential batch submission: step 3 assigns three readiness-assessment instances with three separate POST calls (no bulk-assign route exists); state.assignedTemplateIds tracks which have already succeeded, so a retry after a partial mid-batch failure skips the ones that succeeded and never double-assigns a duplicate instance for one that already landed."
    - "Explicit non-empty display value on every error show-path, never an empty-string clear: every error element's stylesheet default is display:none (an empty error node must stay invisible); a show-path clearing an inline `display` override to `''` merely falls back to that stylesheet default instead of becoming visible — the correct show-path assigns a real value ('block'), and only a hide-path may assign 'none'. Found live in Task 3's UAT, not by any of the 7 source tests already written for this plan (they proved the message was fetched and assigned, not that it was visible) — the fix added an explicit VISIBLE_ERROR_DISPLAY constant plus a regression test asserting no `.style.display = ''` show-path remains."

key-files:
  created:
    - public/deal-wizard.html
    - public/js/deal-wizard.js
    - test/deal-wizard-page.test.js
  modified:
    - public/js/deal-switcher.js
    - public/js/admin.js
    - public/js/transitions.js
    - public/admin.html
    - public/assessments.html
    - public/capability-hub.html
    - public/dashboard.html
    - public/due-diligence.html
    - public/employee.html
    - public/execution.html
    - public/index.html
    - public/insights.html
    - public/integration-excellence.html
    - public/leaders.html
    - public/overview.html
    - public/playbook.html
    - public/pmo.html
    - public/supporting.html
    - public/survey.html

key-decisions:
  - "[Rule 1 - Bug, found during Task 3's live UAT] Every error show-path cleared the inline `display` style to `''` instead of assigning an explicit visible value — the message was correctly fetched from the server and written to textContent, but `.wiz-field-error`/`.wizard-step-error`/`.wiz-row-error`'s own stylesheet default (`display:none`) silently won, so a rejected step appeared to do nothing at all. Fixed by introducing a `VISIBLE_ERROR_DISPLAY = 'block'` constant used by all 4 show-paths; hide-paths are unchanged. A source-level regression test was added and verified against the pre-fix commit (4 empty-display assignments found there, 0 in the fixed file)."
  - "The dynamic setup-step URL (`/api/deals/:id/setup`) is built via string concatenation (`'/api/deals/' + state.dealId + '/setup'`), matching this file's own established style rather than a template literal — the plan's interface-contract prose used a template-literal example, but the codebase (deal-switcher.js) mixes both styles freely, and this executor's own route-inventory test (test/deal-wizard-page.test.js) was written to detect either shape via a static-prefix/static-suffix proximity match rather than assuming one."
  - "Workstream ids/labels for step 4's checklist selection (ws_imo/ws_hr/ws_it/ws_finance/ws_legal/ws_sales/ws_ops/ws_comms) are a hardcoded client-side label map — no `GET /api/workstreams` endpoint exists in this codebase to fetch them from, and the DealSetupDataSchema's `data.workstreams` field accepts any bounded string array regardless, so this is presentation-only and carries no server-side coupling."
  - "The Finish control (step 7) stamps the `ddKickoff` step a second time (alongside `complete: true`) rather than inventing a dedicated 'finish' step name — DealSetupSchema's `step` field is a required enum with no 'none'/'finish' member, and server.js's own handler comment already documents this exact 'operator choice to mark the wizard done enough' shape; re-stamping ddKickoff is harmless (idempotent `{at, by}` overwrite) whether or not step 6 already stamped it."

patterns-established:
  - "Explicit-value show/hide pairing for CSS-driven visibility: never toggle a `display` style between an inert value (like `''`) and `'none'` — always pair an explicit visible value ('block'/'inline-block'/etc., matching the element's actual layout need) with an explicit 'none', so clearing to fall back on a stylesheet default is never mistaken for 'making visible'."

requirements-completed: [WIZ-01]

coverage:
  - id: D1
    description: "Choosing to create a new real deal opens the full-page guided wizard with a visible step rail, not the Phase-3 minimal modal (D-06)"
    requirement: "WIZ-01"
    verification:
      - kind: unit
        ref: "test/deal-wizard-page.test.js#deal-wizard-page: the header switcher navigates to the wizard page"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator live Playwright walk (:3401), step 3 of the checkpoint script: header switcher's '+ New real deal' navigates to /deal-wizard.html, no modal"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pressing Next submits the step to the server; a validation failure renders the server's own field-path message next to the offending field and hard-blocks the step, VISIBLY (D-07) — the display-visibility defect found in UAT is fixed"
    requirement: "WIZ-01"
    verification:
      - kind: unit
        ref: "test/deal-wizard-page.test.js#deal-wizard-page: no error-display show-path clears display to an empty string"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator live Playwright walk (:3401) found the ORIGINAL defect (message present in DOM, computed display:none, invisible to the operator) via getComputedStyle/offsetParent inspection"
        status: pass
    human_judgment: true
    rationale: "The regression test proves the specific empty-display defect pattern is eliminated from the source, and a sanity check against the pre-fix commit confirms the test would have caught it — but the fix has NOT been re-verified in a live browser after the change (no browser tool available to this executor). A human/coordinator should re-run the whitespace-only-name repro from the checkpoint to confirm the message now RENDERS, not just that the source pattern is gone."
  - id: D3
    description: "The deal is created once basics and team are complete (D-05); an interruption after that point never loses the deal"
    requirement: "WIZ-01"
    verification:
      - kind: manual_procedural
        ref: "Coordinator live Playwright walk (:3401): after step 2, GET /api/deals showed the new deal with members [karen,pmo,admin], and GET /api/auth/me confirmed the session was bound to it"
        status: pass
    human_judgment: true
    rationale: "Proves an operator-observable, server-state-dependent outcome (session binding) that only a live walk can demonstrate."
  - id: D4
    description: "The readiness-assessment step is mandatory and assigns all three instances with an owner and a due date each before the flow continues"
    requirement: "WIZ-01"
    verification:
      - kind: manual_procedural
        ref: "Coordinator live Playwright walk (:3401): all three rows (Acquirer/Target/Integration Leader Readiness) rendered; after advancing, /api/assessment-status showed each pending:[{owner,dueDate}], satisfied:false, latestInstance:null"
        status: pass
    human_judgment: true
    rationale: "Server-state outcome across three sequential writes, confirmed live."
  - id: D5
    description: "Steps 4-6 can be skipped with a visible nudge and still end on a usable deal"
    requirement: "WIZ-01"
    verification:
      - kind: manual_procedural
        ref: "Coordinator live Playwright walk (:3401): skips on steps 4, 5, 6 all advanced cleanly; step 7 review and Finish redirected correctly"
        status: pass
    human_judgment: true
    rationale: "End-to-end flow behavior, confirmed live."
  - id: D6
    description: "Every wizard endpoint referenced in the client script exists in the live Express route inventory"
    requirement: "WIZ-01"
    verification:
      - kind: integration
        ref: "test/deal-wizard-page.test.js#deal-wizard-page: every endpoint the wizard script references exists in the live route inventory"
        status: pass
    human_judgment: false
  - id: D7
    description: "The wizard never renders an operator-supplied value as markup; only admin/hrbp can reach the page (server-enforced independent of the client gate)"
    requirement: "WIZ-01"
    verification:
      - kind: unit
        ref: "test/deal-wizard-page.test.js#deal-wizard-page: the wizard script assigns no markup sink"
        status: pass
      - kind: unit
        ref: "test/deal-wizard-page.test.js#deal-wizard-page: the page-access map lists deal-wizard.html for admin and hrbp only"
        status: pass
      - kind: manual_procedural
        ref: "Coordinator confirmed POST /api/deals/wizard/basics as a pmo session returned 403 (server-side enforcement independent of the client pageAccess gate)"
        status: pass
    human_judgment: false

duration: ~85min
completed: 2026-08-02
status: complete
---

# Phase 4 Plan 7: New-Deal Setup Wizard Client Side (WIZ-01) Summary

**A seven-step, full-page guided deal-creation wizard replacing the Phase-3 minimal modal, wired end to end to the server's create-early/validate-per-step/assign-readiness-assessments surface — including a live-UAT-caught display-visibility bug (server-rejected steps rendered their error message into the DOM but never made it visible) found and fixed before completion.**

## Performance

- **Duration:** ~85 min
- **Tasks:** 3 (all completed, including the Task 3 checkpoint's live browser UAT run by the coordinator)
- **Files modified:** 22 (3 created, 19 modified — 3 substantive + 16 cache-stamp-only)
- **Commits:** 3 task/fix commits + this docs commit

## Accomplishments

- Built `public/deal-wizard.html`: a standalone full page (execution.html's head/scaffold conventions + pmo.html's wizard header/progress-bar/step-panel structure, extended from 4 to 7 segments) with seven step panels — basics, team & access, readiness assessments, integration scope, timeline markers, data room & DD kickoff, review — an MNPI codename guidance line on step 1, and a need-to-know notice on step 2.
- Built `public/js/deal-wizard.js`: an IIFE state machine (`switchWizStep()` following pmo.js's shape) with one submit handler per step, wired to every endpoint the interface contract names — `POST /api/deals/wizard/basics`, `POST /api/deals`, `POST /api/deals/select`, `GET /api/assessment-templates`, `POST /api/assessment-instances/assign` (three sequential, resume-safe calls), `POST /api/deals/:id/setup` (once per step, `complete: true` on Finish), `GET /api/checklist-templates`/`POST /api/integration-tasks/instantiate`, `GET /api/dd/request-templates`/`POST /api/dd/request-items/instantiate`. D-07's single-source-of-truth validation holds: the only client-side gate is the browser's own `required` attribute; every real rule comes from the server's field-path-prefixed `{ error }` response, rendered document-wide (or row-scoped for step 3's repeated owner/dueDate fields) beside the offending field.
- Repointed the ONLY path into real-deal creation to the wizard (D-06): `public/js/deal-switcher.js`'s header-switcher create item and `public/js/admin.js`'s "+ New Deal" button both navigate to `/deal-wizard.html`; the retired `openCreateDealForm()` modal builder and its `window.openCreateDealForm` export are removed entirely (not left dormant) — a source test proves no executable reference to it remains anywhere under `public/js/`.
- Added `'deal-wizard.html': ['admin', 'hrbp']` to `transitions.js`'s `pageAccess` map, and bumped the `transitions.js` cache stamp to `?v=1784700001` on every one of the 16 HTML pages that load it (plus the dynamically-injected `deal-switcher.js` script tag's own internal stamp) — Phase 3 previously shipped a stale-cache bug by skipping this step once already.
- Wrote `test/deal-wizard-page.test.js` (8 tests, source-and-route-inspection style mirroring `test/auth-route-inventory.test.js`): seven step panels/progress segments declared, every interface-contract endpoint referenced AND proven to exist in the live Express route inventory, zero markup-sink assignment, the switcher navigates to the wizard, no executable reference to the retired global remains, the page-access map is admin+hrbp-only, and — added after the checkpoint's UAT finding — no error show-path clears its `display` to an empty string.
- **Live UAT (Task 3, run by the coordinator via Playwright on `:3401`) found one real bug**: every error show-path cleared the inline `display` override to `''` rather than assigning an explicit visible value, which falls back to the stylesheet's own `display:none` default — a rejected step's message was correctly fetched and written into the DOM (confirmed via `getComputedStyle`/`textContent` inspection) but was never actually visible to the operator. Fixed with an explicit `VISIBLE_ERROR_DISPLAY = 'block'` constant on all 4 show-paths, plus a regression test verified against the pre-fix commit.
- Everything else in the coordinator's 11-step UAT script passed on the first live run: D-05 create-early (deal exists and the session is bound after step 2), D-08/D-24 readiness-assessment assignment (all three rows, pending/unscored/non-gating), skippable steps 4–6, an accurate step-7 review, the Finish redirect, and zero unexpected console errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: The wizard page, step rail and validate-on-advance state machine** - `49f71de` (feat)
2. **Task 2: Repoint the create affordance and prove the wiring by source** - `0cfb15f` (test)
3. **Checkpoint fix: display-visibility bug found in Task 3's live UAT** - `89e0c98` (fix)

## Files Created/Modified

- `public/deal-wizard.html` (new) — the seven-step full-page flow
- `public/js/deal-wizard.js` (new) — the state machine, per-step submit handlers, error rendering (fixed for visibility)
- `test/deal-wizard-page.test.js` (new) — 8 source-and-route-inspection tests
- `public/js/deal-switcher.js` (modified) — create affordance navigates to the wizard; `openCreateDealForm()` and its window export removed
- `public/js/admin.js` (modified) — "+ New Deal" navigates the same way
- `public/js/transitions.js` (modified) — `deal-wizard.html` pageAccess entry; `deal-switcher.js`'s injected cache stamp bumped
- 16 other `public/*.html` files (modified) — `transitions.js` cache-stamp bump only, no content change

## Decisions Made

- **[Rule 1 - Bug] Display-visibility defect on every error show-path** (see Deviations below) — the single substantive deviation from a clean first pass, found by the coordinator's live UAT and fixed before completion.
- **Dynamic setup-step URL built via string concatenation**, matching this file's own established style, not a template literal — the interface contract's prose example used a template literal, but the route-inventory test was written to detect either shape.
- **Workstream ids/labels for step 4 are a hardcoded client-side map** — no `GET /api/workstreams` endpoint exists to source them from, and the server's `data.workstreams` field is an unconstrained bounded-string-array, so this is presentation-only.
- **Finish re-stamps the `ddKickoff` step alongside `complete: true`** rather than inventing a dedicated step name — `DealSetupSchema.step` is a required enum with no "finish" member; server.js's own handler comment documents this exact pattern as intentional.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, found via Task 3 checkpoint UAT] Server error messages were written to the DOM but never visible**
- **Found during:** Task 3's live Playwright UAT (coordinator, `:3401`), whitespace-only Deal name repro
- **Issue:** All 4 error show-paths in `public/js/deal-wizard.js` cleared an error element's inline `display` style to `''`. Since every error element's CSS default is `display:none` (`public/deal-wizard.html`'s `.wiz-field-error`/`.wizard-step-error`/`.wiz-row-error` rules), clearing to `''` removes the inline override and falls back to that stylesheet default — the message was correctly fetched, correctly targeted (`textContent` set on the right `[data-field]` span), and completely invisible. `getComputedStyle` on the live page returned `display: "none"` with `offsetParent: null`.
- **Fix:** Introduced `VISIBLE_ERROR_DISPLAY = 'block'`; all 4 show-paths now assign it explicitly. Hide-paths are unchanged (still assign `'none'` explicitly).
- **Files modified:** `public/js/deal-wizard.js`, `test/deal-wizard-page.test.js`
- **Verification:** New regression test asserts no `.style.display = ''` show-path remains and at least the 4 known show-paths assign a non-empty value; verified against the pre-fix commit (`0cfb15f`) that the test correctly fails there (4 empty-display assignments) and passes on the fix (0). `npm test`: 211/211.
- **Committed in:** `89e0c98`

### Scope note (not a deviation, but broader than the frontmatter's declared `files_modified`)

The plan's frontmatter `files_modified` lists 5 files; Task 1's own instruction text ("bump that file's cache stamp on every page that references it") and Task 2's own instruction text ("bump the cache stamp on every page that references deal-switcher.js") required touching all 16 HTML pages that load `transitions.js`, each a single-line cache-stamp bump with no content change. Following the explicit task text over the narrower frontmatter list to avoid re-shipping Phase 3's exact stale-cache bug.

---

**Total deviations:** 1 auto-fixed (Rule 1 bug, found via live UAT, not by any of this plan's own source tests until the regression test was added after the fact)
**Impact on plan:** Narrow and necessary — a purely visual defect that made every server-side validation failure silently swallow itself from the operator's perspective, directly contradicting the plan's own must-have truth about D-07 error rendering. No architectural change; fixed in the same file, same shape, with a regression test that would have caught it.

## Issues Encountered

- **[Not this plan's scope, recorded per coordinator instruction] `pageAccess` gate races the login-role handshake.** The coordinator observed that on the FIRST navigation after a browser's active role changes, `public/js/transitions.js`'s synchronous access-control check (lines ~145-176) can run against a stale `localStorage.active_demo_role` and render the page; on any subsequent load it redirects correctly. This is a pre-existing, app-wide race affecting every `pageAccess` entry (not something this plan introduced or widened), and it is NOT a security gap: the coordinator directly confirmed `POST /api/deals/wizard/basics` as a `pmo` session returns 403 — every write route the wizard calls is independently role-checked server-side regardless of the client-side page gate, exactly as `deal-switcher.js`'s own header comment already states. Flagged here for a future phase to consider hardening `transitions.js`'s handshake ordering; out of scope for this plan.
- **Post-fix, the display-visibility fix has not been re-verified in a live browser** (see coverage D2's `rationale`) — only via the source-level regression test and a sanity check against the pre-fix commit. A human/coordinator should re-run the whitespace-only-name repro to confirm the message now visibly renders before treating Task 3 as fully closed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The wizard's full client-side surface (page, script, one creation path, page-access gate) is proven both by source/route-inventory tests and by a live coordinator UAT walk (post-fix source verification only, not yet re-run live).
- `04-08-PLAN.md` (`due-diligence workspace` dashboard/summary integration) depends on this plan (`depends_on: ["04-06", "04-07"]`) and can now proceed — the wizard's setup-state surface (`deal.setup.steps`/`.complete`) it will likely read from is exactly what this plan writes through `POST /api/deals/:id/setup`.
- No blockers for the next plan.

---
*Phase: 04-due-diligence-workspace*
*Completed: 2026-08-02*

## Self-Check: PASSED

All files created/modified by this plan exist on disk and all three task commits are present in git history:

- FOUND: public/deal-wizard.html
- FOUND: public/js/deal-wizard.js
- FOUND: test/deal-wizard-page.test.js
- FOUND: public/js/deal-switcher.js
- FOUND: public/js/admin.js
- FOUND: public/js/transitions.js
- FOUND commit: 49f71de (Task 1)
- FOUND commit: 0cfb15f (Task 2)
- FOUND commit: 89e0c98 (checkpoint fix)

`npm test` = 211/211 (210 baseline-at-checkpoint + 1 new regression test, no regression from the 203 pre-plan baseline). `data/control.db-wal` checked clean (no stray WAL sidecar), `data/deals/` empty, `git status` shows no unintended changes.
