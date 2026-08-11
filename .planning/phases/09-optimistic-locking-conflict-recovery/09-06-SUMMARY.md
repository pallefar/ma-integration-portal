---
phase: 09-optimistic-locking-conflict-recovery
plan: 06
subsystem: api
tags: [express, sqlite, optimistic-locking, conflict-resolution, vanilla-js, delete]

# Dependency graph
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "Plans 01/02/04/05's conflictBody()/conflictIfStale()/parseExpectedVersion() contract, the version-checked WHERE-clause DELETE predicate already built in db/store.js (plan 01), and plan 03's showConflictDialog()/withFreshVersion() scaffold — including withFreshVersion()'s already-built query-parameter URL rewrite, anticipating this plan"
provides:
  - "Version precondition (query-channel ?expectedVersion=) on all seven in-scope DELETE routes in server.js: RAID, integration tasks, synergy initiatives, org positions, org flight-risk, DD request-items, DD findings"
  - "The stale-delete confirmation dialog variant in showConflictDialog(), selected by request method being DELETE — CONFLICT_TITLE_DELETE/CONFLICT_DELETE_LABEL/CONFLICT_DELETING_LABEL/CONFLICT_CANCEL_LABEL copy literals, .conflict-btn-delete on the pre-existing .btn-danger treatment"
  - "?expectedVersion= threaded through the four client delete call sites that genuinely exist: RAID/task/synergy (execution.js) and org position (org.js)"
affects: ["09-07"]

# Actuals (#2632)
actuals:
  tokens: 11672
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route-level delete precondition: resolve the target record via find() BEFORE mutating (never filter-then-length-compare for a versioned delete), so conflictIfStale() has a real record to check against"
    - "Dialog variant selection by HTTP method (method === 'DELETE'), not by a new server-side field — the destructive and edit variants stay one component reading the same 409 body shape"
    - "Version precheck placed before a route's own business-rule refusal (org positions' direct-reports check), mirroring plan 05's positionGraphFailure() precedent, so a stale-and-blocked delete returns 409 not 400"

key-files:
  created: []
  modified:
    - server.js
    - public/js/transitions.js
    - public/css/style.css
    - public/js/execution.js
    - public/js/org.js
    - public/execution.html
    - public/org.html
    - test/optimistic-locking-contract.test.js
    - test/client-conflict-dialog.test.js

key-decisions:
  - "Org positions' delete precheck is placed BEFORE the pre-existing direct-reports structural check (a 400 refusal), not after — mirroring plan 05's positionGraphFailure() ordering precedent, so a delete that is both stale AND blocked by direct reports returns 409, telling the caller their view is stale (the more fundamental problem) first."
  - "DD's by-id anti-enumeration guard (ddAreaRefused, pre-existing T-04-02/T-04-03) resolves a MISSING request-item/finding to the SAME 403 refusal as an uncleared one — this IS the route's existing not-found response for these two routes (a 403, not a literal 404), left unchanged per the plan's own instruction not to alter existing not-found wording."
  - "The clearanceFilter's 'denied' branch on the two DD delete routes is structurally unreachable via a single HTTP request, for the identical reason plan 04 documented for the POST siblings: ddAreaRefused() already runs first and checks the SAME record's SAME current area. Implemented and wired exactly as specified (real defense-in-depth, reusing the SAME closure the POST siblings pass) and proved structurally (test 44) rather than via an unconstructible HTTP scenario."
  - "[Rule 1] org.js's position-delete handler fires a generic inline error banner on any non-ok response; suppressed it specifically for conflict:true responses so a stale delete doesn't show a redundant/contradictory message stacked behind the new destructive dialog — the dialog is now the sole recovery surface for that case."
  - "MAJOR plan-text/codebase mismatch (matching Plans 01/02/04/05's own precedent, but larger in scope): of the plan's seven named delete call sites across execution.js/org.js/due-diligence.js, only FOUR genuinely exist as client UI today (RAID, task, synergy in execution.js; org position in org.js). Org flight-risk entries have no delete button anywhere in org.js (only Add, the register list, and the convert action), and due-diligence.js has ZERO delete/remove calls of any kind for either request-items or findings — both collections are create/edit/convert-only on the client. Task 1's server-side D-08 protection is fully wired and tested for all seven routes regardless of client UI existence; there is simply no client trigger to thread a version through for org flight-risk delete or either DD collection's delete. Building new delete UI for these three is a product/UX decision outside this plan's stated scope (threading version through EXISTING call sites), not a bug to auto-fix under deviation Rules 1-3."

patterns-established:
  - "A collection's DELETE route can be D-08-protected server-side (proven by an HTTP-level integration test) independently of whether any client page currently exposes a delete affordance for it — the two are not coupled, and a future plan adding delete UI for org flight-risk/DD items inherits the protection for free."

requirements-completed: [CONC-02]

coverage:
  - id: D1
    description: "A stale-version delete on any of the seven in-scope collections (RAID, task, synergy, org position, org flight-risk, DD request-item, DD finding) is rejected 409 with the conflict marker, and the record survives; a current-version delete succeeds; repeating the delete afterwards returns the route's own not-found response (404 for five routes, the DD routes' pre-existing 403 anti-enumeration refusal for the other two) with no conflict field; a negative expectedVersion 400s before any mutation; an omitted expectedVersion still deletes (the storage-layer WHERE clause still guards the cross-process case)."
    requirement: "CONC-02"
    verification:
      - kind: integration
        ref: "test/optimistic-locking-contract.test.js (36-43, 9 new cases covering all seven routes plus the no-version-supplied exemption)"
        status: pass
      - kind: other
        ref: "test/optimistic-locking-contract.test.js (44, structural) — conflictIfStale() precedes the lane mutation in all seven DELETE route bodies, and the two DD routes pass a clearanceFilter matching their POST siblings"
        status: pass
    human_judgment: false
  - id: D2
    description: "The stale-delete dialog variant: title + attribution + a destructive 'Delete anyway' primary and a neutral 'Cancel' secondary, no diff list; the dialog itself is the destructive confirmation (no window.confirm() stacked on it); clicking delete disables the button and swaps to 'Deleting…' while resubmitting with the fresh version via the URL's expectedVersion parameter; a second conflict re-renders the same overlay in place; a not-found on resubmission renders the inline error banner rather than a silent success/failure; cancel sends nothing and closes the dialog."
    requirement: "CONC-02"
    verification:
      - kind: unit
        ref: "test/client-conflict-dialog.test.js (5 new behavioral cases: no diff-list rows + delete button present, the destructive click's single further fetch with the fresh version in the URL, cancel issuing no fetch, one overlay surviving a second conflict on resubmission, the attribution fallback on an actor/time-less body)"
        status: pass
      - kind: other
        ref: "grep gate: awk '/ma-fetch-wrapper:begin/,/ma-fetch-wrapper:end/' public/js/transitions.js | grep -v '^\\s*//' | grep -c 'window.confirm\\|[^.]\\bconfirm(' returns 0"
        status: pass
      - kind: unit
        ref: "test/client-xss-sinks.test.js (10/10, unmodified — no new markup sink)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every client delete call site that genuinely has a UI trigger today threads the version the page holds for that record as ?expectedVersion=: RAID, integration tasks and synergy initiatives in execution.js, and org positions in org.js."
    requirement: "CONC-02"
    verification:
      - kind: other
        ref: "grep -c \"expectedVersion\" public/js/execution.js returns 4 (task, synergy, RAID, cost-entry — the last already wired by plan 02); grep -c \"expectedVersion\" public/js/org.js returns 1 (position — flight-risk has no client delete UI to thread, see Deviations)"
        status: pass
      - kind: manual_procedural
        ref: "two browser tabs on execution.html and org.html — edit a record in tab A, save, then delete that same record in tab B; tab B shows the destructive-variant dialog and the record still exists until confirm is clicked; deleting an untouched record still works in one click with no dialog"
        status: unknown
    human_judgment: true
    rationale: "This autonomous worktree execution has no browser available — same gap Plans 01/02/03/04/05 all carried forward under their own D3/D7/D8/D10-style rationale. Structural (grep-based) and HTTP-level integration tests give high confidence the server contract and client threading logic are correct; the actual visual/interactive two-tab UX (dialog rendering, cancel/confirm click-through, no-dialog on an uncontested delete) has not been human- or browser-verified. Recommend a human spot-check before UAT closes this phase, per the plan's own <verification> section."
  - id: D4
    description: "org flight-risk entries and both DD collections (request-items, findings) have no client-side delete UI in this codebase — their server-side D-08 protection (Task 1) is complete and proven, but there is no client call site to thread a version through, and building new delete UI is outside this plan's stated scope."
    verification:
      - kind: other
        ref: "grep for 'DELETE'/delete/remove across public/js/org.js's flight-risk section and the whole of public/js/due-diligence.js — zero matches beyond the position-delete handler and the flight-risk convert action"
        status: pass
    human_judgment: false

duration: ~9min
completed: 2026-08-11
status: complete
---

# Phase 9 Plan 6: RAID/Task/Synergy/Org/DD Stale-Delete Rejection & the Destructive Dialog Summary

**Closed D-08 end to end: all seven in-scope DELETE routes now reject a stale delete with the same 409 conflict contract Plans 01/02/04/05 built for edits, and the shared conflict dialog gained a destructive "Delete anyway" / "Cancel" variant selected by request method — with the client-side threading limited to the four collections (RAID, task, synergy, org position) that actually have a delete button in this codebase today.**

## Performance

- **Duration:** ~9 min
- **Completed:** 2026-08-11
- **Tasks:** 3
- **Files modified:** 9 (server.js, public/js/transitions.js, public/css/style.css, public/js/execution.js, public/js/org.js, public/execution.html, public/org.html, test/optimistic-locking-contract.test.js, test/client-conflict-dialog.test.js)

## Accomplishments

- All seven in-scope DELETE routes (`/api/raid/:id`, `/api/integration-tasks/:id`, `/api/synergies/:id`, `/api/org/positions/:id`, `/api/org/flight-risk/:id`, `/api/dd/request-items/:id`, `/api/dd/findings/:id`) now resolve the target record before mutating and call `conflictIfStale()` via the query-channel `?expectedVersion=`, reusing the exact `parseExpectedVersion()`/`conflictIfStale()` contract Plans 01/02/04/05 already built — no new server mechanism, only wiring.
- The two DD delete routes pass the same `clearanceFilter` closure as their POST siblings (T-09-27), and org positions' precheck sits before the pre-existing direct-reports structural refusal, mirroring Plan 05's `positionGraphFailure()` ordering precedent.
- `showConflictDialog()` gained the D-08 destructive variant, selected purely from the intercepted request's method (`DELETE`) — no new server field. Title/attribution/actions only, no diff list; a `.conflict-btn-delete` primary on the pre-existing `.btn-danger` treatment; the dialog itself is the confirmation (no `window.confirm()` stacked on it, asserted by a grep gate).
- `withFreshVersion()` needed no changes — Plan 03 had already built its query-parameter URL-rewrite detection anticipating this exact route shape.
- 9 new server-side tests (36-44) covering the stale/current/repeat/negative-version quadruple for every collection, plus 5 new client-side behavioral tests for the destructive dialog. Full suite: 745 → 766/766, zero regressions.
- **Major finding documented, not silently worked around:** of the plan's seven named client delete call sites, only four genuinely exist in this codebase — org flight-risk entries and both DD collections have no delete UI at all on the client today. Threaded version through the four real call sites; the other three are a scope decision, not a bug (see Deviations).

## Task Commits

Each task was committed atomically:

1. **Task 1: Version precondition on all seven in-scope DELETE routes** - `f766be7` (feat)
2. **Task 2: The stale-delete dialog variant** - `dda15a9` (feat)
3. **Task 3: Delete call sites across the three pages** - `a3c7269` (feat)

## Files Created/Modified

- `server.js` - version precondition wired into all seven DELETE routes; the two DD routes' `clearanceFilter` closures; org positions' precheck placed before the direct-reports check
- `public/js/transitions.js` - the D-08 destructive dialog variant in `showConflictDialog()`, selected by `method === 'DELETE'`; new copy constants; `intro` paragraph now conditionally appended (not present in the delete variant)
- `public/css/style.css` - `.conflict-btn-delete` sharing the disabled-state rule with `.conflict-btn-apply`, riding the pre-existing `.btn-danger` color treatment
- `public/js/execution.js` - RAID/task/synergy delete call sites thread the in-memory record's held version; `[Rule 1]`-adjacent nothing here (that fix landed in org.js)
- `public/js/org.js` - org position delete threads `node.position.version`; suppressed the redundant generic error banner on a `conflict:true` response
- `public/execution.html`, `public/org.html` - cache-busting stamps bumped alongside the content change
- `test/optimistic-locking-contract.test.js` - 9 new cases (36-44): stale/current/repeat/negative-version quadruple per collection, the no-version-supplied exemption, and the structural delete-route wiring scan
- `test/client-conflict-dialog.test.js` - 5 new behavioral cases for the destructive variant

## Decisions Made

- **Org positions' version precheck placed before the direct-reports check** (not after), mirroring Plan 05's `positionGraphFailure()` ordering precedent — a request that is both stale and blocked by direct reports returns 409, not 400.
- **DD's pre-existing 403 anti-enumeration refusal IS the "not-found" response** for `DELETE /api/dd/request-items/:id` and `DELETE /api/dd/findings/:id` — a missing item resolves to the same refusal as an uncleared one by design (T-04-02/T-04-03), left completely unchanged per the plan's own instruction.
- **The DD clearanceFilter's "denied" branch is unreachable via a single HTTP request** — identical reasoning to Plan 04's own documented finding for the POST siblings (`ddAreaRefused()` already gates on the same record's same current area before `conflictIfStale()` ever runs). Wired exactly as specified and proven structurally.
- **[Rule 1] Suppressed org.js's generic delete-error banner for conflict responses** — without this, a stale delete would show a confusing extra "Could not delete that position." message stacked behind the new destructive dialog.
- **MAJOR: threaded version through only 4 of the plan's 7 named client call sites** — see Deviations below for the full reasoning. This is a scope decision (matching Plans 01/02/04/05's own smaller-scale precedent for plan-text/codebase mismatches), not an incomplete implementation of what exists.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] org.js's generic delete-error banner double-messaged alongside the new conflict dialog**
- **Found during:** Task 3 (threading version through the org position delete call site)
- **Issue:** The pre-existing position-delete handler shows an inline `showDeleteError(...)` banner for ANY non-ok response (it predates this plan, built to surface the "has direct reports" 400 refusal). A stale-delete 409 is now ALSO a non-ok response, so without a fix the user would see BOTH the correct destructive conflict dialog (rendered as a side effect of the same fetch, by the wrapper) AND a redundant, contradictory generic error banner on the page behind it.
- **Fix:** Skip the generic banner specifically when the response body carries `conflict: true` — the dialog is the sole recovery surface for that case; every other non-ok response (400 direct-reports refusal, 403, etc.) keeps its existing banner behavior unchanged.
- **Files modified:** `public/js/org.js`
- **Verification:** `npm test` clean (766/766); manual code review of the branch confirms the banner path is skipped only for `conflict: true` bodies.
- **Committed in:** `a3c7269` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1, correctness/UX — redundant error messaging). No scope creep.

### Scope Finding (not an auto-fix — documented per SCOPE BOUNDARY guidance)

**Three of the plan's seven named client delete call sites do not exist in this codebase.** The plan's Task 3 `<read_first>` named "the flight-risk delete call site" in `org.js` and DD request-item/finding delete call sites in `due-diligence.js`, expecting to thread version through existing code. Investigation found:

- `public/js/org.js` has exactly ONE `DELETE`-method fetch call: the position delete (now threaded). There is no delete button, no delete handler, and no `DELETE /api/org/flight-risk/` call anywhere in the file — only an Add form, the register list rendering, and the flight-risk-to-task/RAID convert action (`convertFlightRisk()`).
- `public/js/due-diligence.js` has ZERO occurrences of `delete`/`remove`/`DELETE` (case-insensitive) anywhere in the file. Request-items and findings are create-, edit-, and convert-only on the client; nothing ever calls `DELETE /api/dd/request-items/:id` or `DELETE /api/dd/findings/:id`.

This mirrors — at larger scale — the exact class of plan-text/codebase mismatch Plans 01, 02, 04 and 05 each independently found and documented ("the RAID save form"/"the task upsert"/"the synergy save form"/"the flight-risk upsert"/"the position upsert" all turned out to be CREATE-only forms with no edit UI behind them). Here the mismatch is an ENTIRE missing delete affordance, not a misnamed edit form.

**Resolution:** Task 1's server-side work (the D-08 version precondition and, for DD, the `clearanceFilter`) is complete and independently tested for ALL SEVEN routes regardless of client UI existence — a future plan that adds delete UI for org flight-risk entries or DD items inherits full protection with zero further server changes. Threaded version through the four call sites that genuinely exist. Did NOT invent new delete buttons/UI for the other three — building new user-facing delete affordances that were never part of any prior plan's UI-SPEC is a product/UX decision (Rule 4 territory: "new feature," not a bug), outside this plan's stated scope of "thread version through existing call sites." The plan's own acceptance criteria (`grep -c "expectedVersion" public/js/org.js` ≥ 2, `public/js/due-diligence.js` ≥ 2) cannot be met as literally worded without that scope expansion — flagging this explicitly here rather than silently under-delivering or silently expanding scope.

**Impact on plan:** Server-side D-08 closure (this plan's primary objective, and CONC-02's requirement) is 100% complete for all seven collections. Client-side UX closure is complete for the 4 of 7 collections that have a delete UI to protect today.

## Issues Encountered

None beyond the scope finding documented above.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. The three collections without client delete UI are not stubs (nothing was wired to fake/empty data) — they simply have no delete feature in this codebase, a pre-existing condition this plan discovered rather than introduced.

## Next Phase Readiness

- D-08 is fully closed server-side across all ten `VERSIONED_COLLECTIONS`-adjacent delete routes (the seven named in this plan) — Plan 07's coverage gate can extend `test/optimistic-locking-contract.test.js`'s established structural-scan shape (tests 16, 25, 35, and this plan's 44) across the full route inventory with no further server-layer work needed.
- If a future milestone adds delete UI for org flight-risk entries or DD request-items/findings, the server-side D-08 protection and the client-side destructive dialog component are both already complete and require zero further changes — only the new delete button/call site itself.
- **Manual verification pending:** the plan's own `<verification>` section calls for a manual two-tab browser walk on `execution.html` and `org.html` — not performed in this browser-less autonomous run. Recommend a human spot-check before UAT closes this phase, the same recommendation every prior plan in this phase has carried forward.

## Self-Check: PASSED

- FOUND: server.js (7 conflictIfStale() call sites added, 32 total occurrences)
- FOUND: public/js/transitions.js (CONFLICT_TITLE_DELETE and sibling constants, isDelete branch)
- FOUND: public/css/style.css (.conflict-btn-delete rule)
- FOUND: public/js/execution.js (3 new expectedVersion call sites, 4 total)
- FOUND: public/js/org.js (1 expectedVersion call site)
- FOUND: test/optimistic-locking-contract.test.js (9 new tests, 47/47 total passing)
- FOUND: test/client-conflict-dialog.test.js (5 new tests, 12/12 total passing)
- FOUND commit: f766be7 (Task 1)
- FOUND commit: dda15a9 (Task 2)
- FOUND commit: a3c7269 (Task 3)
- npm test: 766/766 passing

---
*Phase: 09-optimistic-locking-conflict-recovery*
*Completed: 2026-08-11*
