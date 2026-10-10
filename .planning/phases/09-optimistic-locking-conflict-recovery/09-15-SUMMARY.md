---
phase: 09-optimistic-locking-conflict-recovery
plan: 15
subsystem: client-delivery
tags: [cache-busting, asset-stamps, regression-test, uat-scenario, docs, gap-closure]
requires:
  - phase: 09-optimistic-locking-conflict-recovery
    provides: "09-08..09-14 client changes (execution.js, org.js, due-diligence.js, transitions.js, style.css) that must reach browsers"
provides:
  - "One fresh ?v= stamp (1791625638) for every public/js|css asset changed since v2.1.0, on every page that loads it"
  - "test/asset-cache-bust.test.js: fails on a page with a different stamp, an unstamped tag, or a stamp not newer than the frozen v2.1.0 / pre-bump values"
  - "scripts/uat/phase9-scenarios/f8-stamps.js: `asset-stamps` browser scenario on four pages"
  - "09-01 truth list amended (3 truths), UAT item 2 expectation corrected, WINDOWS ledger entry for the org.html position-edit gap"
affects: [09-16 full walk, phase-12 QUAL-01 (replaces the frozen table with content hashing), phase-18 IL-18]
tech-stack:
  added: []
  patterns:
    - "Frozen per-asset stamp table (v21 + before) as a no-git, release-zip-safe cache-bust guard"
key-files:
  created:
    - test/asset-cache-bust.test.js
    - scripts/uat/phase9-scenarios/f8-stamps.js
  modified:
    - "public/*.html (20 pages: admin, assessments, capability-hub, dashboard, deal-wizard, due-diligence, employee, execution, index, insights, integration-excellence, leaders, login, org, overview, playbook, pmo, signage, supporting, survey)"
    - .planning/phases/09-optimistic-locking-conflict-recovery/09-01-PLAN.md
    - .planning/phases/09-optimistic-locking-conflict-recovery/09-UAT.md
    - .planning/WINDOWS.md
key-decisions:
  - "Single stamp S = 1791625638 (Unix seconds at execution) for all five assets, larger than every existing stamp"
  - "Test collects stamped references only (`/asset?v=...`) plus unstamped HTML src/href attributes; bare mentions in comments are not references"
  - "Scenario derives the expected stamp from the page on disk and asserts it exceeds the asset's pre-gap-closure floor, so it needs no edit at the next bump other than the floor"
requirements-completed: [CONC-02]
duration: 14 min
completed: 2026-10-10
status: complete
actuals:
  tokens: 6500
  tasks: 3
  commits: 3
---

# Phase 9 Plan 15: Cache-bust stamps, regression guard and record accuracy Summary

Every client asset changed since v2.1.0 now carries one new `?v=` stamp on every page, a
file-only regression test fails on any missed page or non-increasing stamp, a real browser
confirms the new URLs are fetched with 200, and the three Phase 9 documentation gaps R7 found are closed.

## Accomplishments

- **Tracer (Task 1):** transitions.js bumped `1784900002 -> 1791625638` in the 18 pages that load it;
  `test/asset-cache-bust.test.js` created; `asset-stamps` scenario created and PASS on execution,
  org and due-diligence.
- **Task 2:** style.css bumped on all 20 pages (login.html leaves its stale `1784500010`, now the same
  stamp as every other page); execution.js, org.js, due-diligence.js bumped in their pages. Frozen table
  and scenario extended to all five assets and `/login.html` (opened anonymously in a fresh context,
  because a signed-in session redirects away from it).
- **Task 3:** 09-01-PLAN.md gained three explicit truths with verbatim test names (additions only,
  38 lines, 0 removed) plus the FA-1 amendment paragraph; 09-UAT.md test 2 `expected:` now states the
  accepted attribution-disclosed / value-withheld contract; WINDOWS.md gained the org.html
  position-edit deviation routed to Phase 18 IL-18 (open_count 2 -> 3).

## git diff --name-only v2.1.0..HEAD -- public/js public/css (recorded per Task 1)

```
public/css/style.css
public/js/due-diligence.js
public/js/execution.js
public/js/org.js
public/js/transitions.js
```

Exactly the five assets in the plan's interface table; the frozen table covers all of them. The
files transitions.js loads dynamically (inline-edit.js, banners.js, deal-switcher.js) are unchanged
since v2.1.0 and were left alone.

## Stamp table

| Asset | v2.1.0 | before bump | after (S) | pages |
|---|---|---|---|---|
| css/style.css | 1784600001 (19), 1784500010 (login) | same | 1791625638 | 20 |
| js/transitions.js | 1784900002 | 1784900002 | 1791625638 | 18 |
| js/execution.js | 1786250900 | 1786433369 | 1791625638 | execution.html |
| js/org.js | 1784900011 | 1786433369 | 1791625638 | org.html |
| js/due-diligence.js | 1784800006 | 1786427686 | 1791625638 | due-diligence.html |

## Verification

- `node --test test/asset-cache-bust.test.js`: 11/11 pass.
- Negative check (Task 1 acceptance): reverting pmo.html's transitions.js stamp made the test fail
  with "referenced with 2 different stamps ... ?v=1784900002: public/pmo.html"; restored, then green.
- `npm test`: 853/853 after Task 1, 861/861 after Task 2, 0 failures.
- `phase9-walk.js --scenario asset-stamps`: 56 PASS / 0 FAIL on execution, org, due-diligence and login,
  plus `data-integrity` PASS (committed data/*.db identical).
- `grep -o "style.css?v=[0-9]*"` prints `style.css?v=1791625638` for login.html and execution.html alike.
- `frontmatter.validate 09-01-PLAN.md --schema plan`: valid. Each new truth's test names grepped verbatim
  in test/ (19/19 found once).
- `windows status`: new open deviation, phase 9, description contains "IL-18".
- `git status` after tests shows no data/ changes.

## Deviations from Plan

None - plan executed exactly as written.

One execution note, not a deviation: the plan names the CR-01 tests `(a)`-`(d)`; the files name them
`CR-01 (a, store-layer backstop)` ... `(d, store-layer parity)`, so those full verbatim prefixes are used.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None - no new network endpoints, auth paths or schema changes. T-09-57 and T-09-41 mitigated
(new stamps + failing test + browser scenario); T-09-58 mitigated (09-01 diff is additions only).

## Commits

- `8107333` fix(09-15): bump transitions.js cache stamp on every page, guarded by asset-cache-bust test
- `5e0a5c7` fix(09-15): bump style.css, execution.js, org.js, due-diligence.js stamps on every page
- `610c68f` docs(09-15): amend 09-01 truth list, correct UAT item 2, record org position-edit gap

## Self-Check: PASSED

- test/asset-cache-bust.test.js, scripts/uat/phase9-scenarios/f8-stamps.js, this SUMMARY: present.
- Commits 8107333, 5e0a5c7, 610c68f present on branch worktree-agent-ab1e0fb4e1e5d4452.
- STATE.md and ROADMAP.md untouched.
