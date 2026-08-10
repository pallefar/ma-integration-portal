---
phase: quick-260810-erm
plan: 01
subsystem: security
tags: [xss, csv-injection, audit-log, clean-room, access-control, express, sqlite]

# Dependency graph
requires:
  - phase: 06-org-design-talent-retention
    provides: resolveRaidEntryClearanceArea()/reportRaidRows() (the RAID clearance-filter machinery this plan mirrors onto tasks) and GET /api/org/flight-risk (the read-audit pattern this plan extends to three more routes)
  - phase: 07-reports-exports
    provides: GET /api/reports/export, GET /api/reports/pack, lib/reportCsv.js's csvField() formula-injection guard, and the report-export/report-pack-generated real-deal-only audit-scoping precedent
provides:
  - resolveTaskClearanceArea() + reportTaskRows() — the task-lane twin of the RAID clearance filter, closing the F-1 clean-room bypass
  - Three escaped client sinks (transitions.js bookmark href/icon/title, signage.js leaderboard roster row, admin.js question edit textarea) closing the F-2 stored-XSS findings
  - A leading-whitespace-aware CSV formula-injection guard in lib/reportCsv.js, closing the F-4 bypass
  - Read-audit trails on GET /api/org/decisions, GET /api/org/positions?state=target, GET /api/dd/findings, and GET /api/dd/findings/:id, closing the F-5 asymmetry
affects: [org-design-talent-retention, reports-exports, milestone-security-review]

# Actuals (#2632)
actuals:
  tokens: 23200
  tasks: 4
  commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Task-lane clean-room filtering mirrors the RAID clean-room filter exactly (stamp-first-then-parse precedence, single shared clearance-filtered read function all title-emitting exits route through)"
    - "Client-side XSS closure = local escapeHtml (scoped correctly, never a cross-scope reach) + scheme-allowlist safeUrl for any href sourced from stored data"
    - "CSV formula-injection guard checks the first NON-whitespace character, not the literal first character, since spreadsheets strip leading whitespace before formula detection"
    - "MNPI read-audit: recordSecurityEvent on both denial and success halves, gated `if (!req.isDemo)`, matching the export/pack audit-scoping precedent"

key-files:
  created:
    - test/task-access-filter.test.js
    - test/client-xss-sinks.test.js
    - test/org-dd-read-audit.test.js
  modified:
    - server.js
    - lib/reportCsv.js
    - public/js/transitions.js
    - public/js/signage.js
    - public/js/admin.js
    - public/admin.html
    - public/signage.html
    - test/reports-export.test.js
    - test/dd-grants.test.js
    - "public/*.html (18 files carrying the transitions.js ?v= cache stamp)"

key-decisions:
  - "resolveTaskClearanceArea/reportTaskRows are structurally identical to their RAID twins on purpose — one proven pattern applied twice, not a parallel reimplementation that could drift"
  - "computeWorkstreamRollup(db) became computeWorkstreamRollup(db, deal, portalUser) — REQUIRED, not optional — closing the count-inference side channel (T-ERM-03) that a title-only filter would have left open"
  - "The deal-home nudge counts (tasks_overdue/tasks_blocked, raidHigh) stay deliberately UNfiltered — aggregate integers with no title/name attached, matching the pre-existing accepted raidHigh residual; documented in-code, not changed"
  - "transitions.js gets its own LOCAL escapeHtml inside buildQuickNav rather than reaching across to the one at ~2410 (verified via a brace-depth trace: that copy is scoped to a sibling function, initGlobalTeodorChatbot, and is not reachable from renderQuickLink)"
  - "dd-findings.test.js's dd-access-denied action-filtered assertions were correctly unaffected — only a route asserting a TOTAL (unfiltered) audit-row delta would have needed updating, and none exists for these four routes"

requirements-completed: [F-1, F-2, F-3, F-4, F-5]

coverage:
  - id: D1
    description: "Task-lane clean-room parity with RAID — a member cleared only for one DD area gets zero rows for an out-of-area converted task across GET /api/integration-tasks, the CSV/JSON export, the PDF pack, and the workstream rollup count; deleting the originating finding never declassifies"
    requirement: "F-1"
    verification:
      - kind: integration
        ref: "test/task-access-filter.test.js#task-access-filter (a)-(l)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Three stored-string client sinks (bookmark href/icon/title, signage roster fields, admin question textarea) render attacker text as inert literal; a javascript: bookmark URL neutralizes to '#'; every changed client file's cache stamp is bumped"
    requirement: "F-2"
    verification:
      - kind: unit
        ref: "test/client-xss-sinks.test.js#client-xss-sinks (a)-(j)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Count-inference closure — the workstream rollup's per-workstream task count no longer leaks the existence of a hidden MNPI task to an uncleared caller via the ws_hr tasksTotal number"
    requirement: "F-3"
    verification:
      - kind: integration
        ref: "test/task-access-filter.test.js#task-access-filter (h)"
        status: pass
    human_judgment: false
  - id: D4
    description: "CSV formula-injection guard closes the leading-whitespace bypass (' =1+1', '\\t=SUM(A1)') while preserving the number-typed skip"
    requirement: "F-4"
    verification:
      - kind: unit
        ref: "test/reports-export.test.js#reports-export (csvField unit) T-ERM-06"
        status: pass
    human_judgment: false
  - id: D5
    description: "MNPI read-audit parity — denied and successful reads of org decisions, target-org positions, and DD findings write exactly one real-deal audit row each and zero rows in demo"
    requirement: "F-5"
    verification:
      - kind: integration
        ref: "test/org-dd-read-audit.test.js#org-dd-read-audit (a)-(i)"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-08-10
status: complete
---

# Quick Task 260810-erm: Milestone Security Remediation (Task Lane) Summary

**Mirrors the proven RAID clean-room filter onto the task lane (closing an MNPI title leak through converted Day-1 tasks), escapes three client stored-XSS sinks with a scheme-allowlisted safeUrl for bookmark hrefs, closes a leading-whitespace CSV formula-injection bypass, and adds MNPI read-audit trails to three previously-silent org/DD routes — all four fixes from the milestone-close Fable 5 whole-codebase security review.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-08-10
- **Tasks:** 4
- **Files modified:** 29 (across 4 commits)

## Accomplishments

- **F-1 (HIGH) — Task-lane clean-room bypass closed.** Added `resolveTaskClearanceArea(task, db)` and `reportTaskRows(db, deal, portalUser)`, structurally identical to the existing `resolveRaidEntryClearanceArea`/`reportRaidRows` RAID twins (stamp-first-then-parse precedence, single shared filtered-read function). Routed all three title-emitting task exits (`GET /api/integration-tasks`, the export `dataset=tasks` branch, the PDF pack) plus `computeWorkstreamRollup` through it. Stamped `clearanceArea` at both convert-task sites (flight-risk → fixed `'hr'`; dd-finding → `finding.area`), mirroring their existing RAID-entry stamps.
- **F-3 (count-inference) closed in the same pass** — `computeWorkstreamRollup` is now caller-aware (`db, deal, portalUser` required), so a hidden hr-retention task can no longer inflate the `ws_hr` `tasksTotal` count for an uncleared viewer.
- **F-2 (HIGH) — three stored-XSS sinks escaped.** `transitions.js`'s quick-nav bookmark renderer (href/icon/title, sourced from `GET /api/menus`, rendered in every user's chrome on every page) now escapes all three fields and wraps the href in a new `safeUrl` scheme allowlist (relative/hash/query/http(s) only — a `javascript:`/`data:` URL resolves to `'#'`). `signage.js`'s lobby leaderboard roster row (name/role/department/badge) gained an `escapeHtml` helper — this file had none before. `admin.js`'s question edit-view textarea now escapes `q.text`, matching its own list-view sibling. Bumped the `?v=` cache stamp on every changed client file: all 18 HTML files carrying `transitions.js`, plus `signage.html` and `admin.html`.
- **F-4 (LOW) — CSV formula-injection whitespace bypass closed.** `csvField()` in `lib/reportCsv.js` now guards on the first NON-whitespace character rather than the literal `s[0]`, since spreadsheet applications strip leading whitespace before deciding a cell is a formula. The apostrophe still prepends to the very front of the string; the number-typed skip is unchanged.
- **F-5 (MEDIUM) — MNPI read-audit asymmetry closed.** Added `recordSecurityEvent` calls, each gated `if (!req.isDemo)`, on `GET /api/org/decisions` (denial + success), `GET /api/org/positions` (target branch only — denial + success), `GET /api/dd/findings` (success only — the route silently narrows rather than 403ing), and `GET /api/dd/findings/:id` (success only — `ddAreaRefused()` already owns the pre-existing denial path).
- **FIX 3 (false-disclosure copy) verified, not edited** — `public/js/org.js` and `public/js/due-diligence.js` already read "…visible only to members cleared for this register/area"; F-1 makes that sentence true for tasks (it was previously only true for RAID). `raid-access-filter (j)` stayed green, confirming no edit was needed.

## Task Commits

1. **Task 1: Server task-lane clean-room filter — mirror the RAID machinery onto tasks (FIX 1 HIGH + FIX 3)** - `15b2a86` (fix)
2. **Task 2: Client stored-string XSS — escape three innerHTML sinks + neutralize javascript: URLs + bump cache stamps (FIX 2 HIGH)** - `0644c7b` (fix)
3. **Task 3: CSV formula-injection whitespace bypass (FIX 4 LOW)** - `b5e111a` (fix)
4. **Task 4: MNPI read-audit asymmetry — audit three more read routes, real-deal only (FIX 5 MEDIUM)** - `646208e` (fix)

**Plan metadata:** this SUMMARY.md + STATE.md update (docs commit, following this document)

## Files Created/Modified

- `server.js` - `resolveTaskClearanceArea`/`reportTaskRows` added; convert-site stamps; three task exits + rollup routed through the filter; four new `recordSecurityEvent` call sites
- `lib/reportCsv.js` - `csvField()`'s formula-trigger check moved to the first non-whitespace character
- `public/js/transitions.js` - local `escapeHtml` + `safeUrl` inside `buildQuickNav`; `renderQuickLink`/`renderQuickGroup` now escape every interpolated field
- `public/js/signage.js` - new `escapeHtml` helper; leaderboard roster row escapes name/role/department/badge
- `public/js/admin.js` - edit-view textarea now escapes `q.text`
- `public/admin.html`, `public/signage.html`, and 18 other `public/*.html` files - bumped `?v=` cache stamps
- `test/task-access-filter.test.js` (new) - 12 tests: four-identity parity, CSV/pack parity, WR-03 deletion-never-declassifies, rollup count parity, unit cases, source-level delegation guards
- `test/client-xss-sinks.test.js` (new) - 10 tests: source-level escaping asserts + executable `safeUrl` proof + cache-stamp checks
- `test/org-dd-read-audit.test.js` (new) - 9 tests: per-route audit-row-delta proofs, demo-zero gate, source-level grep guard
- `test/reports-export.test.js` - extended csvField unit test for the whitespace-bypass fix; updated the now-stale "no per-item clearance concept" comment on test (k)
- `test/dd-grants.test.js` - relaxed a test that pinned admin.js's exact cache-stamp digits (this plan legitimately bumped it again)

## Decisions Made

- Mirrored the RAID filter's exact shape onto tasks rather than writing a parallel implementation — one proven, previously-reviewed pattern, applied twice.
- Made `computeWorkstreamRollup`'s `deal`/`portalUser` parameters REQUIRED (not optional-with-fallback) to make the count-inference closure structurally impossible to skip at a future call site.
- Kept the deal-home nudge counts (`tasks_overdue`/`tasks_blocked`) unfiltered by design, matching the pre-existing accepted `raidHigh` residual — documented in a `[security]` comment rather than "fixed," since fixing it alone (without revisiting the RAID precedent it mirrors) would be an inconsistent half-measure.
- Declared a local `escapeHtml` inside `transitions.js`'s `buildQuickNav` instead of reaching across to the chatbot-scoped copy at ~2410, after confirming via a brace-depth trace that the two functions are true siblings (both nested in the same outer callback but not in each other) — function declarations don't hoist across sibling scopes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated a pre-existing test that pinned admin.js's exact cache-stamp value**
- **Found during:** Task 2 full-suite regression run
- **Issue:** `test/dd-grants.test.js` asserted `admin\.js\?v=1784700001` verbatim — a value this very task's own F-2 fix legitimately bumps to `1784700002`. The pinned-digit assertion was itself the bug: it couldn't survive any future legitimate cache-stamp bump.
- **Fix:** Changed the assertion to `admin\.js\?v=\d+` (proves a cache-stamped reference exists, not its literal digits) — the same relaxation pattern `test/client-xss-sinks.test.js` (i)/(j) use for the same two files.
- **Files modified:** `test/dd-grants.test.js`
- **Verification:** `node --test test/dd-grants.test.js` green; full suite green afterward.
- **Committed in:** `0644c7b` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for the full suite to pass after the legitimate F-2 cache-stamp bump. No scope creep — the fixed test's own subject (a cache-stamped admin.js reference) is unchanged; only its over-specific assertion was relaxed.

## Issues Encountered

- One full-suite run (before the final commit) showed 686/687 with a single failure that left no reproducible trace on immediate re-run; two subsequent full runs were 687/687 clean. This matches the task brief's documented "known synergy-phasing flake under concurrency" — confirmed transient, not attributable to any change in this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All four Fable 5 milestone-close findings (F-1 through F-5) are closed in code with proving tests; full suite is green at 687/687 (baseline 655 + 32 new tests), zero regressions.
- No `.db` file was touched by this task (WAL-trap discipline confirmed clean via `git status --short -- '*.db' '*.db-wal' '*.db-shm'`).
- Ready to resume the milestone-close gate chain: code-review → Fable verifier → secure-phase → phase complete → milestone close, per the standing playbook.

---
*Phase: quick-260810-erm*
*Completed: 2026-08-10*
