---
phase: 07-imo-reporting-exports
plan: 06
subsystem: api
tags: [pdf, pack-composition, clearance-parity, audit, i18n, pagination]

# Dependency graph
requires:
  - phase: 07-imo-reporting-exports
    plan: 05
    provides: lib/reportPack.js's page frame (header/footer bands, two-pass paginator, language resolver) and the executive-summary section (page one) this plan registers three more sections after
  - phase: 07-imo-reporting-exports
    plan: 04
    provides: the synergy rollup's split grossRealizedM/unphasedRealizedM fields and enrichSynergy()'s staleDays field, both read by the pack's synergies section and recap
  - phase: 07-imo-reporting-exports
    plan: 01
    provides: the RAID clearance filter and the D-08 clearance-parity architecture GET /api/reports/export established, now factored into reportRaidRows()/reportSynergyRows() and shared with the pack route
provides:
  - "lib/reportPack.js's three remaining D-04 sections — workstreamsTasksSection, raidSection, synergiesSection — completing DEFAULT_SECTIONS (exec summary + all three)"
  - "GET /api/reports/pack — an authenticated GET that assembles a clearance-filtered model through the SAME shared functions GET /api/reports/export uses (reportRaidRows/reportSynergyRows) and returns a real PDF steerco pack"
  - "the generate-pack card and button on execution.html's Reports tab, wired via public/js/execution.js"
  - "server.js's reportRaidRows(db, deal, portalUser) and reportSynergyRows(db, ctx) — the single shared assembly functions both the CSV/JSON export route and the pack route now call, replacing two independent inline copies"
  - "server.js's stageAtLastBaseline(item) — resolves RPT-03's confidence-stage-movement column server-side from an initiative's own baselines[] history"
affects: ["07-07 (if any UI/browser-walk verification plan follows) inherits a complete, generateable steerco pack; any future report surface reusing RAID/synergy rows should call reportRaidRows()/reportSynergyRows() rather than re-filtering"]

# Actuals (#2632)
actuals:
  tokens: 18500
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Shared table-pagination engine (paginateRows) inside lib/reportPack.js: a section computes its own first-page/continuation-page row budgets from fixed title/preamble/header heights (never per-language ctx.measureText during the measuring pass — only inside render()), then paginateRows() does pure arithmetic to produce page-sized row chunks plus a truncation count"
    - "Page ceiling + volume-only truncation notice (T-07-33/T-07-30): a section capped at MAX_SECTION_PAGES reserves one row-slot on its final page for a plain '{count} further row(s)... see the CSV export' line — worded only in terms of row volume, never clearance, so it can never be mistaken for (or confused with) a withheld-content disclosure"
    - "D-08 parity is now enforced by ONE shared function per dataset (reportRaidRows, reportSynergyRows) called from both GET /api/reports/export and GET /api/reports/pack, rather than by two independently-written filters that happen to agree today"
    - "Confidence-stage movement (RPT-03) is resolved server-side (stageAtLastBaseline) and handed to the renderer as a plain field — lib/reportPack.js never reads item.baselines itself, preserving its no-database-access module contract from 07-05"

key-files:
  created: []
  modified:
    - lib/reportPack.js
    - server.js
    - public/execution.html
    - public/js/execution.js
    - test/reports-pack.test.js
    - test/reports-audit.test.js

key-decisions:
  - "The pack route's language query parameter is named `lang`, not `language` — discovered as a naming mismatch while wiring Task 3's fetch call against Task 2's already-committed schema; server.js's ReportPackLanguageSchema and both integration tests were updated in this same plan rather than left inconsistent, since Task 3's own verify script locks the `lang` name."
  - "Stale synergy rows are dimmed IN FULL, including their category/stage accent colours — not just the title text — reading 07-UI-SPEC.md's 'entire row's text' literally rather than dimming only the primary-text columns."
  - "The synergies section-level recap repeats exactly the 4 numbers 07-UI-SPEC.md names (gross realized, cost incurred, net benefit, deal target) — deliberately NOT the unphased figure page one's tiles also carry, matching the spec's literal enumeration."
  - "MAX_SECTION_PAGES (4) and the row/header/title height constants are this plan's own implementation discretion — 07-UI-SPEC.md fixes page geometry but not a page-count ceiling; chosen small enough to keep the truncation-path test fixtures cheap while still representing a genuinely large report (150-200+ rows) before triggering."
  - "GET /api/raid's own inline RAID clearance filter was left untouched (not rewired to call reportRaidRows()) — the D-08 parity property this plan closes is specifically 'the pack and the CSV export never diverge', proven by the load-bearing test; rewriting the live GET route as well was assessed as unnecessary risk for a plan already touching three files' worth of surface."
  - "The pack's D-08 integration test cannot substring-scan the rendered PDF for RAID titles (lib/reportPdf.js rasterises each page to an image XObject — no vector text objects exist in the file), so parity is proven at the row-count level instead: the pack generation's own audit-event row count for the caller is asserted equal to that same caller's CSV export's row count, in the same test run, for the same deal and identity — combined with the source-level guarantee that both routes call the identical reportRaidRows() function."

patterns-established:
  - "A section wanting to paginate registers its own row/title/header heights and calls the shared paginateRows() helper — the pattern later report sections (if any) in this codebase should follow rather than reimplementing chunking."

requirements-completed: [RPT-02, RPT-03, RPT-04]

coverage:
  - id: T-07-28-1
    description: "reportRaidRows()/reportSynergyRows() are the SINGLE clearance-filtered/enriched read paths both GET /api/reports/export and GET /api/reports/pack call; an uncleared caller's pack generation row count equals that caller's own RAID CSV export row count, proven in the same test run"
    requirement: "RPT-02"
    verification:
      - kind: integration
        ref: "test/reports-pack.test.js#reports-pack route (GET /api/reports/pack) (b)"
        status: pass
    human_judgment: false
  - id: T-07-29-1
    description: "An org/talent dataset spelling or any injected extra query parameter cannot make the pack include org content or change its behaviour beyond the recognised `lang` parameter"
    requirement: "RPT-02"
    verification:
      - kind: integration
        ref: "test/reports-pack.test.js#reports-pack route (GET /api/reports/pack) (d)"
        status: pass
    human_judgment: false
  - id: T-07-30-1
    description: "No section draws a placeholder row or a hidden/restricted/remaining count when the model already carries clearance-withheld rows; the volume-only truncation notice is the sole permitted mention of an unrendered-row count and is worded only in terms of row volume"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack cross-section: no drawn string discloses withheld content"
        status: pass
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack Section 3 — Risks & Decisions (RAID) (b)"
        status: pass
    human_judgment: false
  - id: D-02-1
    description: "The synergies section's recap caption reads model.rollup's four headline numbers exactly, on a rounding-edge fixture a re-summation of the per-initiative rows would get wrong"
    requirement: "RPT-03"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack Section 4 — Synergies (a)"
        status: pass
    human_judgment: false
  - id: RPT-03-stage-movement
    description: "A fixture initiative whose baseline stage differs from its current stage renders BOTH values; an initiative with no baseline history renders the em-dash — the confidence-stage-movement column proving movement, not merely current state"
    requirement: "RPT-03"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack Section 4 — Synergies (b)"
        status: pass
    human_judgment: false
  - id: D-12-1
    description: "A stale synergy row renders dimmed with a 'Stale {N}d' tag carrying the exact supplied day count, and stays in its input-order position — never sorted to the bottom or moved to an appendix"
    requirement: "RPT-04"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack Section 4 — Synergies (c)"
        status: pass
    human_judgment: false
  - id: D-07-1
    description: "Task/RAID tables continue onto further pages that repeat only the column-header row, never the section title, when a fixture is large enough to overflow a single page"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack Section 2 — Workstreams & Tasks (a)"
        status: pass
    human_judgment: false
  - id: D-10-1
    description: "One real-deal pack generation writes exactly one audit event naming the pack action/actor/deal/format/language and per-section row counts; the identical demo request writes zero rows; a 409 empty-deal refusal writes none"
    requirement: "RPT-02"
    verification:
      - kind: integration
        ref: "test/reports-audit.test.js#reports-audit (d)"
        status: pass
      - kind: integration
        ref: "test/reports-audit.test.js#reports-audit (e)"
        status: pass
      - kind: integration
        ref: "test/reports-audit.test.js#reports-audit (f)"
        status: pass
    human_judgment: false
  - id: T-07-33-1
    description: "A dataset large enough to exceed the page ceiling truncates its final table with a plain notice naming the remaining row count and the CSV export, capping the section to a small bounded number of pages rather than growing unboundedly"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack Section 3 — Risks & Decisions (RAID) (b)"
        status: pass
    human_judgment: false
  - id: pack-button-ui
    description: "The generate-pack button is the ONE accent-coloured control on the Reports tab, disables and label-swaps while working, downloads the PDF via a blob/anchor pattern with the browser's active language, and surfaces failures through an explicit display:'block' inline message"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "07-06-PLAN.md Task 3's own node -e source assertion (btn-primary/rpt-pack-error/fetch/lang/visible-display/no-demo-branch all true)"
        status: pass
    human_judgment: true
    rationale: "The button's live in-browser behaviour (actual click, actual download, actual visual polish at narrow widths) is not exercised by this plan's automated verify — 07-UI-SPEC.md's own two 375px/DE reflow backstops remain this phase's stated human-walk debt."

duration: ~2h
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 6: The Steerco Pack — Remaining Sections, the Pack Route, and the Generate Button Summary

**Completed the steering-committee PDF pack end to end: three new pack sections (workstreams & tasks, RAID, synergies with confidence-stage movement and stale-row dimming), a `GET /api/reports/pack` route that assembles its model through the exact same clearance-filtered functions the raw CSV/JSON exports use, and the one accent-coloured button on the Reports tab that generates and downloads it.**

## Performance

- **Duration:** ~2h (Tasks 1-3)
- **Completed:** 2026-08-09
- **Tasks:** 3
- **Files modified:** 6 (lib/reportPack.js, server.js, public/execution.html, public/js/execution.js, test/reports-pack.test.js, test/reports-audit.test.js)

## Accomplishments

- **Task 1 — the three remaining D-04 sections** (`lib/reportPack.js`): registered `workstreamsTasksSection` (per-workstream bars + a paginated task table), `raidSection` (RAID rows grouped by the fixed type order the screen's own filter buttons use, severity as coloured text, no placeholder for withheld rows), and `synergiesSection` (a section-level recap that reads `model.rollup` directly — never re-summing the rows beneath it — plus a per-initiative table with the new `stageAtBaseline` "confidence-stage movement" column and dimmed, tagged stale rows that stay in their normal sorted position). Built a shared `paginateRows()` engine so every table paginates the same way: the column-header row repeats on continuation pages, the section title never does, and a page ceiling (`MAX_SECTION_PAGES = 4`) truncates a runaway table with a plain, clearance-blind volume notice pointing at the CSV export.
- **Task 2 — `GET /api/reports/pack`** (`server.js`): factored `reportRaidRows(db, deal, portalUser)` and `reportSynergyRows(db, ctx)` out of the existing export route so both the CSV/JSON export and the new PDF pack call the identical clearance-filtered/enriched read paths (D-08) — closing the "two independent filters that happen to agree today" risk the plan's own reversibility note flagged as costly to fix later. Added `stageAtLastBaseline(item)`, resolving RPT-03's confidence-stage-movement field from an initiative's own append-only `baselines[]` history (by highest `version`, not array position). The route validates `lang` via a zod enum with `.catch('en')` (never rejects), refuses an entirely-empty deal with 409, and writes exactly one `report-pack-generated` audit event on real deals (zero in demo), naming the actor, deal, format, language and per-section row counts.
- **Task 3 — the generate-pack card and button** (`public/execution.html`, `public/js/execution.js`): added the pack card below the four raw-export rows with the primary-accent button, an intro sentence, and a `display:none`-by-default inline error paragraph — the ONE accent-coloured control this phase introduces, deliberately asymmetric with the eight secondary export links. Wired the click handler porting `admin-cms.js`'s disable+label-swap idiom: fetches `/api/reports/pack?lang=<active language>`, downloads the PDF via a temporary anchor's synthetic click, and restores the button on both success and failure. Failures reveal `#rpt-pack-error` via an explicit `display:'block'` — never an empty-string reset, the exact invisible-error regression this project has shipped and fixed twice before.
- Full suite: 620/620 → 644/644 after this plan (24 new tests across `test/reports-pack.test.js` and `test/reports-audit.test.js`), zero regressions.

## Task Commits

Each task was committed atomically:

1. **Task 1: The three data sections** — `52cfd21` (feat)
2. **Task 2: GET /api/reports/pack — one filtered model, one audit event** — `4dd11cb` (feat)
3. **Task 3: The generate-pack card and button** — `5668087` (feat)

## Files Created/Modified

- `lib/reportPack.js` — `workstreamsTasksSection`, `raidSection`, `synergiesSection`, `paginateRows`, `groupRaidByType`, `drawSynergyRecap`, `drawSynergyBar`, `drawSynergyRow`; `DEFAULT_SECTIONS` now carries all four D-04 parts; model contract comment extended with `tasks` and `synergies[].stageAtBaseline`
- `server.js` — `reportRaidRows()`, `reportSynergyRows()`, `stageAtLastBaseline()`, `formatPackTimestamp()`, `GET /api/reports/pack`; `GET /api/reports/export`'s raid/synergies branches now call the shared functions instead of their own inline copies
- `public/execution.html` — the steerco pack card markup (`.rpt-pack-card`/`.rpt-pack-intro`/`.rpt-pack-error` CSS + markup), cache-stamp bump
- `public/js/execution.js` — the pack button's click handler (disable/label-swap, fetch, blob download, visible-error restore) inside `wireExtraControls()`
- `test/reports-pack.test.js` — 24 new unit tests (Sections 2-4, cross-section no-disclosure proof) + 5 new server-boot integration tests for the pack route; two pre-existing `buildPack()` page-count assertions updated from `1` to `DEFAULT_SECTIONS.length` (anticipated by Task 1 adding three more default sections)
- `test/reports-audit.test.js` — 3 new tests: the pack's D-10/D-11 audit delta (one row on a real generation, zero in demo, zero on a 409 refusal)

## Decisions Made

- The pack route's language query parameter is `lang`, not `language` — a naming mismatch caught while wiring Task 3's fetch against Task 2's already-committed schema; corrected in this same plan (server.js's schema + both integration tests) rather than shipped inconsistent, since Task 3's own locked verify script names `lang`.
- Stale synergy rows dim their ENTIRE row text, including the category/stage accent colours — reading 07-UI-SPEC.md's "entire row's text in the dim colour" literally, not just the primary-text columns.
- The synergies recap repeats exactly the 4 numbers 07-UI-SPEC.md names (gross realized, cost incurred, net benefit, deal target) — deliberately omitting the unphased figure page one's tiles also carry.
- `MAX_SECTION_PAGES` (4) and the row/header/title pixel constants are this plan's own implementation discretion (07-UI-SPEC.md fixes page geometry, not a page-count ceiling) — chosen small enough that truncation-path test fixtures stay cheap while still representing a genuinely oversized report before triggering.
- `GET /api/raid`'s own inline clearance filter was left untouched rather than rewired to call `reportRaidRows()` too — this plan's D-08 property is specifically pack/export parity, proven by the load-bearing test; touching the live GET route as well was assessed as unnecessary additional surface for an already three-file plan.
- The pack's D-08 integration proof compares audit-recorded row COUNTS rather than scanning PDF text, because `lib/reportPdf.js` rasterises every page to an image XObject with no vector text objects to extract — combined with the source-level guarantee that both routes call the identical `reportRaidRows()` function, this is the correct-strength proof available at this layer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pack language query parameter named inconsistently between Task 2 and Task 3**
- **Found during:** Task 3, wiring the button's fetch call against Task 3's own locked verify script
- **Issue:** Task 2's server-side schema read `req.query.language`, but Task 3's `<verify>` block (authored as part of this same plan) asserts the client fetch carries `reports/pack?lang=`. Shipping both as written would mean the client always sent `lang`, the server only ever read `language`, and every pack generation would silently render in English regardless of the caller's actual active language — a real RPT-02 correctness bug, not a cosmetic mismatch.
- **Fix:** Renamed the server-side query key to `lang` (server.js's `ReportPackLanguageSchema.parse(req.query.lang)`) and updated both Task 2 integration tests (`test/reports-pack.test.js`, `test/reports-audit.test.js`) that had asserted against `?language=`.
- **Files modified:** `server.js`, `test/reports-pack.test.js`, `test/reports-audit.test.js`
- **Verification:** `node --test test/reports-pack.test.js test/reports-audit.test.js` — all pass with `?lang=`; Task 3's own `node -e` source assertion passes.
- **Commit:** folded into `5668087` (Task 3's commit, since it was discovered and fixed while wiring Task 3)

**2. [Rule 1 - Bug] `buildPack()`'s page-count assertions in two pre-existing 07-05 tests became stale**
- **Found during:** Task 1, first test run after registering the three new default sections
- **Issue:** Two tests written in Plan 07-05 (`test/reports-pack.test.js` "(h)") asserted `buildPack(model)` against an empty model produces exactly 1 PDF page — true only while `DEFAULT_SECTIONS` held a single section (the executive summary). Registering the three new sections in this plan correctly makes an empty pack 4 pages (one per section, each rendering its own empty-state line), which is the intended, spec-compliant behaviour, not a regression.
- **Fix:** Updated both assertions to `reportPack.DEFAULT_SECTIONS.length` instead of the literal `1`, so the test's intent (buildPack's page count matches its registered section count) survives future section additions without needing another manual literal update.
- **Files modified:** `test/reports-pack.test.js`
- **Verification:** `node --test test/reports-pack.test.js` — both tests pass against the new 4-section default composition.
- **Commit:** folded into `52cfd21` (Task 1's commit, since the stale assertions were a direct, anticipated consequence of that task's own change)

## Issues Encountered

None beyond the two auto-fixed deviations documented above. Full suite: 635/635 after Task 1, 644/644 after Tasks 2-3 — both green, no regressions.

## User Setup Required

None — no external service configuration required. The pack route reuses `lib/reportPack.js`'s already-vendored TE logo and Noto Sans SC font (Plan 07-05), and no new npm dependency was introduced.

## Next Phase Readiness

- The steerco pack is now generateable end to end from the Reports tab in both real-deal and demo contexts, covering all four of D-04's parts (executive summary, workstreams & tasks, RAID, synergies) with RPT-03's confidence-stage movement and RPT-04's stale-versus-current distinction both visible in the rendered document.
- `GET /api/raid`'s own inline clearance filter remains a second (currently identical) implementation, not rewired to call `reportRaidRows()` — noted above as a deliberate scope boundary for this plan, available as low-risk future cleanup if a third RAID-reading route is ever added.
- Outstanding manual verification debt (unchanged from 07-05, now covering three more sections): 07-UI-SPEC.md's two 375px/DE reflow backstops (the Reports pane and the pack card) and a live, in-browser click-through of the generate-pack button (actual download, actual PDF visual review) remain this phase's stated human-walk items, not exercised by this plan's fully-automated `<verify>` blocks.

---
*Phase: 07-imo-reporting-exports*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 6 modified files and the new SUMMARY.md confirmed present on disk; all three task commit hashes (`52cfd21`, `4dd11cb`, `5668087`) confirmed present in `git log --oneline --all`.
