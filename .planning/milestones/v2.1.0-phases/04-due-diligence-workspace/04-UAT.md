---
status: complete
gaps_resolved: 2
phase: 04-due-diligence-workspace
source:
  - 04-01-SUMMARY.md
  - 04-02-SUMMARY.md
  - 04-03-SUMMARY.md
  - 04-04-SUMMARY.md
  - 04-05-SUMMARY.md
  - 04-06-SUMMARY.md
  - 04-07-SUMMARY.md
  - 04-08-SUMMARY.md
started: 2026-08-02T16:40:00Z
updated: 2026-08-02T19:00:00Z
coverage_mode: coverage
auto_covered: 45
human_checkpoints: 10
driven_by: orchestrator (Playwright, live server on :3403)
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running server, clear ephemeral state, start from scratch. Server boots without errors, SQLite opens, and a primary query returns live data.
result: pass
evidence: Graceful shutdown left no WAL/SHM sidecars and tracked DBs byte-unchanged. Cold boot logged RAG init + port bind with zero errors. Login as karen succeeded; `GET /api/deals` returned `[]` and `GET /api/employees` returned live seeded demo data.

### 2. DD workspace renders only cleared areas (04-01 D4)
expected: One section per CLEARED area, textContent-only, with no client-side list of uncleared areas. Uncleared areas absent from the DOM entirely.
result: pass
evidence: pmo granted `["legal","hr"]` only. Cleared areas Legal + HR rendered. The 6 uncleared areas (Financial, Tax, Commercial, Operations, Compliance/ESG) returned ZERO occurrences in `document.documentElement.innerHTML` — absent, not greyed/locked/zero-counted. `GET /api/dd/request-items` returned 20 of 80 items, areas `["legal","hr"]` only. A write to uncleared `tax` returned 403 "You are not cleared for that due-diligence area."

### 3. Clean-room grants panel in admin console (04-02 D5)
expected: Real Deals tab exposes a 'Clean-room grants' panel (admin + hrbp) that reads/writes the grants route, textContent-only.
result: pass
evidence: Visible to karen (hrbp). Opened `#grants-panel-overlay` rendering a member x area grid (karen + pmo, 8 areas each, 16 checkboxes) with per-member Save. Checked Legal + HR for pmo, saved; `GET /api/deals/:id/grants` then returned `pmo: ddAreas ["legal","hr"]` — panel proven to both read and write the route.

### 4. Load standard checklist control (04-03 D5)
expected: Visible only while the workspace has zero request items; materialises the template and surfaces created/skipped counts as a textContent-only status line, wording skipped as 'outside your clearance' without naming any area.
result: pass
evidence: Control visible at zero items; after clicking, `#dd-checklist-status` rendered "Loaded 80 request items from the standard checklist." (visible, display:block) and the control correctly disappeared. Skipped count legitimately absent — karen is cleared for all 8 areas, so nothing was skipped.

### 5. Findings section per area (04-04 D6)
expected: A findings section per rendered area with create/convert controls, textContent-only.
result: pass
evidence: As pmo (2 cleared areas): 2 Findings sections, 2 "Add finding" controls. Created a legal finding (201); a finding in uncleared `tax` was refused 403. After reload the finding rendered with its "Create RAID entry" convert control.

### 6. VDR reference editor and render-time scheme re-check (04-05 D7)
expected: Per-item VDR editor, per-area reference list, admin/hrbp-only grant form. A stored URL is re-checked for scheme AT RENDER TIME before ever becoming an anchor.
result: pass
evidence: Editor fields present ("Data room URL (https://…)", "Folder / index reference", "Label (optional)"). Write-time: `javascript:alert(1)` rejected 400 "Data room URL must use http or https." Render-time defence-in-depth PROVEN — saved a valid https URL, then corrupted the stored value directly in `data/deals/<id>.db` to `javascript:alert(document.domain)`. On reload the API still served the hostile value, yet ZERO anchors carried it and the string appeared nowhere in raw HTML; the label still rendered as inert text. The 5 `javascript:` anchors on the page are pre-existing `void(0)` nav placeholders, unrelated. Admin-only grant form correctly NOT visible to pmo.

### 7. Wizard field error renders visibly and hard-blocks (04-07 D2)
expected: A validation failure renders the server's own field-path message next to the offending field and hard-blocks the step, VISIBLY (the wave-7 defect).
result: pass
evidence: Whitespace-only Deal name + valid Target company -> Next. `.wiz-field-error[data-field=name]` carried "Deal name is required." with computedDisplay `"block"`, inline display `"block"`, `offsetParent` non-null, bounding height > 0, and `body.innerText` contained the message. Still hard-blocked at "Step 1 of 7". The wave-7 invisible-error defect stays fixed in a live browser.

### 8. Deal created early, survives interruption (04-07 D3)
expected: The deal is created once basics and team are complete (D-05); an interruption after that point never loses the deal.
result: pass
originally: issue (G-04-8, major) — resolved by 04-10-PLAN.md and re-verified live 2026-08-02
post_fix_evidence: "Live browser walk on :3405 after the fix. Reloading mid-wizard now RESUMES at Step 3 of 7 (was Step 1) with exactly ONE deal and the copy 'Resuming setup for Project Atlas (Orion Components AB) — completed steps are skipped.' The planner's second duplicate path (Back from step 3, then Next, no reload) also produced no extra deal. 'Start a different deal instead' returned a clean Step 1 and correctly created a genuinely distinct second deal, so an intentional second deal is not blocked. Dedup is createdBy-pinned with exact string equality — its failure mode is an extra deal, never a resume into someone else's or the wrong deal."
reported: "Re-entering the wizard after an interruption creates a DUPLICATE deal and silently re-binds the session to the new one, orphaning the original."
severity: major
original_evidence: `GET /api/deals` = 0 before step 2, 1 after (created, active, members karen+pmo, session bound) — the literal claim holds and the deal is never lost. But reloading mid-wizard restarts at "Step 1 of 7" with no resume affordance, and re-walking steps 1-2 produced a SECOND deal: `deal_msc1wlvu62ced9fc` and `deal_msc1xn4g4ec9a1ed`, both named "Project Meridian" with the same target. The session re-bound to the new one, stranding the first. The admin console then showed two indistinguishable "Project Meridian" rows with identical controls. Root cause is not inferred: `server.js` `POST /api/deals` calls `controlStore.createDeal()` unconditionally with no dedup or in-progress check, and `public/js/deal-wizard.js` sets `state.dealId = null` on every page load with no attempt to detect an existing incomplete setup. The intended recovery path (deal home's "Setup incomplete — resume setup") exists but the wizard itself does not guard against re-creation.

### 9. Readiness-assessment step is mandatory (04-07 D4)
expected: Mandatory; assigns all three instances with an owner and a due date each before the flow continues.
result: pass
evidence: Next with empty fields hard-blocked at "Step 3 of 7" with visible errors. After filling all three, `GET /api/assessment-status` showed acquirer-org (karen, 2026-09-15), target-org (pmo, 2026-09-20), integration-leader (karen, 2026-09-25) — all pending, correct fixed rollup order — and the flow advanced to step 4.

### 10. Steps 4-6 skippable with visible nudge (04-07 D5)
expected: Steps 4-6 can be skipped with a visible nudge and still end on a usable deal.
result: pass
originally: issue (G-04-10, major) — resolved by 04-09-PLAN.md and re-verified live 2026-08-02
post_fix_evidence: "Verified twice. (1) Server-level against a running server: the patched Finish payload `{ complete: true }` left `setup.steps` BYTE-IDENTICAL (scope/timeline/ddKickoff all still null, prior timestamps unchanged) while `setup.complete` flipped true; an explicit `{ step: 'ddKickoff' }` still stamps, so the normal path is intact. (2) Live browser walk: skipping steps 4, 5 and 6 then Finish produced THREE OUTSTANDING rows — Integration Scope, Timeline Markers AND Data Room & DD Kickoff (the last falsely DONE pre-fix) — with the 'Setup incomplete — resume setup' nudge intact."
reported: "A SKIPPED step 6 is recorded as DONE. The setup checklist under-reports outstanding work on the last-skipped step."
severity: major
original_evidence: The nudge itself works — deal home showed "Setup incomplete — resume setup" plus a DONE/OUTSTANDING checklist, and the deal was fully usable. But having skipped steps 4, 5 AND 6, the checklist read OUTSTANDING for Integration Scope and Timeline Markers yet DONE for Data Room & DD Kickoff. Server state confirms: `setup.steps.scope = null`, `timeline = null`, but `ddKickoff = { at: "2026-08-02T17:07:54.633Z", by: "karen" }` — stamped at the exact moment "Finish & go to dashboard" was clicked. `public/js/deal-wizard.js:582` posts `{ step: 'ddKickoff', complete: true }` on Finish, conflating "mark the whole setup complete" with "mark the ddKickoff step done". The IL will never be nudged to complete data-room / DD kickoff setup.

### 11. Owner nudge names counts only (04-08 D10)
expected: An owner with open/overdue assigned DD items sees an in-app badge and a dismissible banner naming COUNTS ONLY — never an area, item title, or another person. Dismissal is session-scoped, not permanent.
result: pass
evidence: Assigned pmo 3 open items (2 with past due dates). `#dd-nudge-badge` rendered "3"; `#dd-nudge-banner` read "You have 3 open due-diligence items assigned to you, 2 overdue." Counts correct. Leak scan for area names, item titles and usernames returned EMPTY for both badge and banner. Dismiss wrote `dd_nudge_dismissed` to sessionStorage ONLY (localStorage null); banner stayed dismissed across a same-session reload, and RETURNED after clearing sessionStorage — session-scoped, not permanent, proven in both directions.

## Summary

total: 11
passed: 9
issues: 2 (both resolved 2026-08-02 by 04-09 / 04-10, re-verified live)
pending: 0
skipped: 0

## Auto-Covered (not presented)

45 deliverables across the 8 summaries were classified `auto_passed` by
`uat classify-coverage` — deterministically covered by the 230-test suite.
04-06 (wizard backend) was `all_auto_covered: true`.

## Observations (not gaps)

- **Raw field name in step-3 error copy (cosmetic).** Step 1 renders "Deal name is required." but step 3 renders "dueDate is required." — the camelCase field path leaks into user-facing copy. Inconsistent humanisation, no functional impact.
- **Header user chip is stale on the first navigation after a session change (pre-existing).** After switching karen -> pmo, the header briefly showed "Karen / Integration Leader" while the session and all data were correctly pmo-scoped; it self-corrected on reload. This is the previously documented `transitions.js` localStorage handshake race, not introduced by this phase and not a data-exposure issue.
- **A session bound to a deleted deal locks the user out with no recovery path.** Encountered from leftover UAT state: every route 403s "You are not a member of that deal", including `/api/auth/status`. Only reachable by deleting a deal file out from under a live session (the archive flow force-releases bound sessions), so it is an artifact of manual cleanup rather than a product defect — noted for awareness only.

## Gaps

- gap_id: G-04-8
  truth: "The deal is created once basics and team are complete (D-05); an interruption after that point never loses the deal"
  status: resolved
  resolved_by: 04-10-PLAN.md
  resolved_at: 2026-08-02
  reason: "User reported: Re-entering the wizard after an interruption creates a duplicate deal and silently re-binds the session to the new one, orphaning the original."
  severity: major
  test: 8
  artifacts: []
  missing: []
  resolution_evidence: "Live browser walk on :3405 (orchestrator-driven, post-fix). Created 'Project Atlas' through steps 1-2, then RELOADED mid-wizard: the wizard resumed at Step 3 of 7 (was Step 1 pre-fix) with exactly ONE deal and visible copy 'Resuming setup for Project Atlas (Orion Components AB) — completed steps are skipped.' The second duplicate path the planner found (Back from step 3, then Next, no reload) also produced NO extra deal. The 'Start a different deal instead' escape hatch returned a clean Step 1 with cleared fields and correctly created a genuinely distinct second deal ('Project Vega'), proving a legitimately-intended second deal is not blocked. Dedup key is createdBy-pinned with exact string equality, so its failure mode is an extra deal, never a resume into another deal."

- gap_id: G-04-10
  truth: "Steps 4-6 can be skipped with a visible nudge and still end on a usable deal"
  status: resolved
  resolved_by: 04-09-PLAN.md
  resolved_at: 2026-08-02
  reason: "User reported: A skipped step 6 is recorded as DONE, so the setup checklist under-reports outstanding work."
  severity: major
  test: 10
  artifacts: []
  missing: []
  resolution_evidence: "Verified twice by the orchestrator. (1) Server-level, against a running server: posting the patched Finish payload { complete: true } left the setup.steps object BYTE-IDENTICAL — scope/timeline/ddKickoff all still null, prior steps' timestamps unchanged — while setup.complete flipped true; an explicit { step: 'ddKickoff' } still stamps, so the normal path is intact. (2) Live browser walk end-to-end: skipping steps 4, 5 and 6 then clicking Finish produced THREE OUTSTANDING rows on the deal home (Integration Scope, Timeline Markers, AND Data Room & DD Kickoff — the last of which falsely read DONE pre-fix), with the 'Setup incomplete — resume setup' nudge intact."
