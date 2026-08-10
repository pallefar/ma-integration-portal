---
phase: 07-imo-reporting-exports
plan: 07
subsystem: i18n
tags: [i18n, pdf, wal-checkpoint, live-walk, pack-rendering, pagination]

# Dependency graph
requires:
  - phase: 07-imo-reporting-exports
    plan: 06
    provides: "The complete steerco pack renderer (all four D-04 sections) and GET /api/reports/pack this plan seeds translations for and walks live end to end"
provides:
  - "scripts/seed-reports-i18n.js — the idempotent, add-only reports/pack translation seed (en/de/zh/cs) with a truncating WAL checkpoint, proven by a real tracked-file byte diff (1302528 -> 1310720 bytes)"
  - "test/reports-i18n.test.js — derives its key list FROM SOURCE (execution.html's data-i18n attributes + reportPack.js's t()/header-tuple resolver calls), so a key the interface uses but the seed forgot fails this test rather than passing silently"
  - "A closed Plan 07-04 gap: syn.rollup_unphased (the Synergy tab's 'Unphased' rollup tile) was never seeded until this plan"
  - "The signed-off Phase-7 closing live walk: showcase regression clean, 5-tile synergy rollup, 8-file export integrity, codename-only filenames, real (non-tofu) Chinese glyphs in the pack, every-page confidentiality footer, both directions of the clean-room contract proven on a scratch real deal, 6-page/112-task pagination with header repeat and no split rows, exact audit-row deltas (real vs. demo), zero console errors throughout"
  - "Two live-walk-found and live-walk-fixed PDF rendering defects (F-A: RAG chip ribbon clipped at the page edge; F-B: long task titles overprinting neighbouring columns), closed via a wrapText() line wrapper and a paginateRowsByHeight() row packer that budgets pages against the same wrapped heights it renders"
affects: ["Milestone close — Phase 7 is the last phase of this milestone; the wrap-never-clip/measure-before-paginate pattern and the add-only-seed-with-WAL-diff-proof convention are the two reusable patterns this closing plan leaves for any future report or PDF surface"]

# Actuals (#2632)
actuals:
  tokens: 9700
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "wrapText()/paginateRowsByHeight() measure-then-render contract: pass-one layout uses a throwaway @napi-rs/canvas measuring context to get real font metrics for row-height budgeting, and pass-two drawing wraps the identical way, so header-repeat/no-split-row pagination can never disagree with what is actually drawn"
    - "Add-only i18n seed with WAL-checkpoint-diff proof: a seed script that only inserts missing (language, key) pairs, ends with PRAGMA wal_checkpoint(TRUNCATE), and is verified by diffing the TRACKED database file against HEAD rather than trusting a clean working tree — a clean tree is explicitly rejected as evidence because a WAL-mode write can land only in the ignored sidecar"
    - "Translation key lists derived from source (regex over data-i18n attributes and t()/resolver call sites), never authored from memory, so a seed script and its proof test cannot silently drift from what the interface actually renders"

key-files:
  created:
    - scripts/seed-reports-i18n.js
    - test/reports-i18n.test.js
  modified:
    - data/demo.db
    - lib/reportPack.js
    - test/reports-pack.test.js

key-decisions:
  - "Translation strategy followed 07-UI-SPEC.md's carry-verbatim-or-ship-English convention: rpt.pack_tile_gross/cost/net/target and rpt.pack_col_severity carry their meaning-identical translations verbatim from the Synergy/RAID tabs' existing keys; every other new key (~40) ships English only and relies on the app's existing fallback-to-English contract in both public/js/transitions.js and lib/reportPack.js's resolveLanguage() — authoring real translations for all of them was out of the ~10-15-label budget this convention exists to cap."
  - "The confidentiality footer's hardcoded line (drawFooterBand) stays outside the i18n system entirely, by design (T-07-22) — the leading 'CONFIDENTIAL' word is a handling instruction, not interface copy, and must never vary by language."
  - "DOCUMENTED DEFERRAL, out of this plan's declared file scope: the pack button's in-flight label ('Generating pack…'), its failure message, and the pack route's 409 empty-deal error text are plain JS string literals in public/js/execution.js and server.js with no data-i18n attribute or t()-resolver call at all — there is no key in source to seed. Wiring them requires exposing a new global translate accessor from transitions.js and deciding how a JSON error response carries a caller's language: an interface change beyond scripts/seed-reports-i18n.js / data/demo.db / test/reports-i18n.test.js and beyond a same-task auto-fix. Recorded in the seed script's own header comment as the canonical source of truth for this gap."
  - "Walk finding F-A fixed by wrapping the executive-summary RAG chip ribbon onto additional rows (advancing layout from the final wrapped row) rather than truncating or shrinking chip text, so no workstream name is ever cut."
  - "Walk finding F-B fixed by measuring the Workstreams & Tasks table's TITLE column against its own column width during layout (not at draw time), growing the row height to match, so the paginator's page-break budget and the renderer's actual output are always the same wrapped height — never a race between the two passes."

patterns-established:
  - "A section with variable-height rows (wrapped text, wrapped chip strips) computes its wrapped height ONCE during the measuring pass and hands that same height to both the paginator and the renderer — never re-wrapping independently in each pass."

requirements-completed: [RPT-01, RPT-02, RPT-03, RPT-04]

coverage:
  - id: D1
    description: "Every reports/pack string introduced across Plans 07-01..07-06 (tab label, dataset labels, format labels, section/column/tile labels, stale tag, unphased rollup tile) resolves to a non-empty value in all four shipped languages, with no key resolving to its own key name"
    requirement: RPT-01
    verification:
      - kind: unit
        ref: "test/reports-i18n.test.js"
        status: pass
    human_judgment: false
  - id: D2
    description: "The seed is add-only per language (a collision would halt for investigation, not overwrite) and idempotent (re-running leaves the database unchanged), proven via a truncating WAL checkpoint plus a real byte diff of the tracked database file against HEAD (1302528 -> 1310720 bytes) rather than a clean-working-tree claim"
    requirement: RPT-01
    verification:
      - kind: integration
        ref: "node scripts/seed-reports-i18n.js && git diff --stat HEAD -- data/demo.db (07-07-PLAN.md Task 1 <verify>)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Rule-1 fix: the stale-row 'Stale {N}d' tag was hardcoded English with no t() resolver call, unlike every sibling string in the same pack section; now threaded through t() via rpt.pack_stale_tag"
    requirement: RPT-04
    verification:
      - kind: unit
        ref: "test/reports-i18n.test.js"
        status: pass
    human_judgment: false
  - id: D4
    description: "Two live-walk-found PDF rendering defects (F-A chip ribbon clipped past the page edge, F-B long task titles overprinting neighbouring columns) are fixed via wrapText()/paginateRowsByHeight() and proven both by targeted regression assertions and by real rasters"
    requirement: RPT-02
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js (F-A: no chip rect drawn past CONTENT_RIGHT_PX, 10-workstream fixture wraps onto more than one row; F-B: oversized-title continuation lines draw no text in the neighbouring column's x-range, row grows past the fixed single-line height)"
        status: pass
      - kind: other
        ref: "real @napi-rs/canvas rasters of both fixed pages, visually confirmed defect-free (scratchpad evidence, not committed)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The demonstration showcase (overview, role selector, Integration Leader dashboard, PMO console, employee portal, admin console, academy) renders fully with zero console errors, and the Execution Hub's three pre-existing tabs still switch correctly with the synergy rollup now showing FIVE tiles (Unphased as its own tile, not folded into Gross realized)"
    requirement: RPT-04
    verification: []
    human_judgment: true
    rationale: "Regression-freedom across the whole showcase and a five-tile visual rollup are only verifiable by a human walking the live UI with the console open — no automated test asserts either."
  - id: D6
    description: "All eight raw-data downloads (CSV+JSON x 4 datasets) open correctly in a spreadsheet application with columns aligned, non-Latin characters rendering (not mojibake), no cell evaluated as a formula, and every filename carries the deal CODENAME and date with the real legal company name in NO filename"
    requirement: RPT-01
    verification: []
    human_judgment: true
    rationale: "File-open visual/spreadsheet-rendering correctness and filename-content inspection require a human opening each of the eight downloaded files."
  - id: D7
    description: "The Chinese pack renders real CJK glyphs (not empty tofu boxes) in section titles, column headings and stat-tile labels when opened in a real PDF viewer; the German pack's longer labels are not clipped by any column"
    requirement: RPT-02
    verification: []
    human_judgment: true
    rationale: "The tofu failure mode passes every automated string comparison and every existing test — it is only visible to a human opening the rendered PDF in a real viewer, per the plan's own explicit framing."
  - id: D8
    description: "Every page of the pack, including continuation pages of long tables, carries the confidentiality footer (CONFIDENTIAL, deal CODENAME, generation timestamp, generating username, a page counter with a TRUE total) and the TE logo header band; the target's real legal company name appears nowhere in the document"
    requirement: RPT-02
    verification: []
    human_judgment: true
    rationale: "Scrolling the whole rendered document and confirming per-page footer/header content is a human visual-inspection task by the plan's own design."
  - id: D9
    description: "The clean-room contract holds in BOTH directions on a scratch real deal (FALCON): no org/talent content (position, org decision, flight-risk entry, named retention-list person) leaks into any pack or export for a one-area-cleared member, AND the risks-and-decisions section is non-empty for the fully-cleared administrator — an over-filter is equally a failure. The one-area member's RAID pack section and CSV contain the same entries as each other and fewer than the administrator's, with no placeholder implying hidden entries"
    requirement: RPT-02
    verification: []
    human_judgment: true
    rationale: "Both failure directions require a human searching real generated files for seeded names and comparing section contents across two identities on a real deal — the exact class of failure this plan's threat register (T-07-35) names as invisible to any test suite."
  - id: D10
    description: "A table large enough to overflow one page (112 tasks/RAID entries, scratch deal) continues onto further pages across 6 total pages, the column-header row repeats on every continuation page, and no page break splits a row"
    requirement: RPT-02
    verification:
      - kind: other
        ref: "live walk step 11 on scratch deal FALCON, visually confirmed against the rendered PDF (scratchpad evidence, not committed)"
        status: pass
    human_judgment: true
    rationale: "Confirming header repetition and no-split-row behaviour at real volume on a live-generated document is a visual PDF-inspection step, distinct from the unit-level pagination assertions in test/reports-pack.test.js."
  - id: D11
    description: "Real-deal exports and pack generations each produce exactly one audit row naming the actor, deal and format; the identical demo-mode exports and packs produce zero audit rows"
    requirement: RPT-02
    verification:
      - kind: integration
        ref: "test/reports-audit.test.js (pre-existing, re-confirmed during the walk against live real-deal and demo activity)"
        status: pass
    human_judgment: false

duration: ~55min (Task 1: ~12min; live walk + two-defect find/fix/re-prove cycle: ~43min)
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 7: Reports/Pack i18n Seed and the Phase-Closing Live Walk Summary

**Seeded every Reports & Exports / steerco-pack string into all four shipped languages with a WAL-checkpoint-proven database diff, then closed Phase 7 with a blocking live walk that found and fixed two PDF pagination/wrapping defects (chip-ribbon clipping and title overprinting) before user sign-off.**

## Performance

- **Duration:** ~55min (Task 1 seed + proof, then the live walk and its find→fix→re-prove cycle)
- **Completed:** 2026-08-09
- **Tasks:** 2 (Task 1: auto; Task 2: checkpoint:human-verify, gate=blocking)
- **Files modified:** 5 (scripts/seed-reports-i18n.js [new], test/reports-i18n.test.js [new], data/demo.db, lib/reportPack.js, test/reports-pack.test.js)

## Accomplishments

- **Task 1 — the reports/pack i18n seed** (`scripts/seed-reports-i18n.js`, `data/demo.db`, `test/reports-i18n.test.js`): scanned `execution.html`'s `data-i18n` attributes and `lib/reportPack.js`'s `t()`/header-tuple resolver call sites to derive the full key list from source rather than memory — the Reports & Exports tab label, four dataset labels, two format labels, both pack section groups, the pack card copy, and every label the pack renderer resolves (section titles, column headings, stat-tile labels, the stale tag, the stale-count sentence). Wrote an add-only, idempotent seed mirroring `scripts/seed-org-demo.js`'s shape, closed with a truncating WAL checkpoint, and proved the write landed in the TRACKED file — not just the ignored sidecar — via a real byte diff (1,302,528 → 1,310,720 bytes). Also closed a standing Plan 07-04 gap: `syn.rollup_unphased` (the Synergy tab's "Unphased" tile) had never been seeded. Fixed a Rule-1 bug found in the same pass: the stale-row "Stale {N}d" tag was hardcoded English with no `t()` call, unlike every sibling string in its section.
- **Task 2 — the blocking phase-closing live walk**: a fresh agent ran the full 12-step evidence walk (showcase regression, 5-tile synergy rollup, 8-file export integrity, codename-only filenames, real-glyph Chinese pack check, every-page footer, both directions of the clean-room contract on scratch deal FALCON, 112-task/6-page pagination with header repeat and no split rows, exact audit-row deltas real-vs-demo, zero console errors throughout). The walk found two real defects the green test suite could not see: **F-A** — the executive-summary RAG chip ribbon clipped its last chip past the page's right edge once a deal had enough workstreams to fill a row; **F-B** — a long task title in the Workstreams & Tasks table overprinted the WORKSTREAM/PHASE columns and the row beneath it, because row height was never measured against wrapped text. Both were fixed in the same session (`wrapText()` line wrapper + `paginateRowsByHeight()` height-based row packer, sharing one throwaway `@napi-rs/canvas` measuring context so pass-one layout and pass-two drawing can never disagree), proven by two new regression tests AND by re-rendering real PDF rasters of both pages. The walk was then re-run against the fix and the **user approved** the gate.

## Task Commits

Each task was committed atomically:

1. **Task 1: Seed the reports translation keys in all four languages** — `4fe6a90` (feat)
2. **Task 2 fix, found during the walk: wrap the chip ribbon and task-table titles instead of clipping/overprinting** — `4506923` (fix)

## Files Created/Modified

- `scripts/seed-reports-i18n.js` — new: idempotent, add-only i18n seed for all Reports/pack keys across four languages, truncating WAL checkpoint, documented translation-route rationale and the documented deferral (pack in-flight/failure/409 text) in its header comment
- `test/reports-i18n.test.js` — new: derives its key list from source (not from the seed script's own list) and asserts every key resolves non-empty in all four languages with no key resolving to its own name
- `data/demo.db` — the new translation rows, WAL-checkpointed into the tracked file
- `lib/reportPack.js` — `rpt.pack_stale_tag` threaded through `t()` (i18n fix); `wrapText()` and `paginateRowsByHeight()` added; `execSummarySection`'s chip ribbon now wraps rather than clips; the Workstreams & Tasks table's TITLE column wraps within its column width and grows row height accordingly
- `test/reports-pack.test.js` — two new regression tests: no chip rect drawn past `CONTENT_RIGHT_PX` (with a 10-workstream fixture proving multi-row wrap), and an oversized title's continuation lines draw no text in the neighbouring column's x-range while the row grows past the fixed single-line height

## Decisions Made

- Translation route followed 07-UI-SPEC.md's carry-verbatim-or-ship-English convention: `rpt.pack_tile_gross/cost/net/target` and `rpt.pack_col_severity` carry meaning-identical translations verbatim from the Synergy/RAID tabs; the remaining ~40 new keys ship English-only, relying on the existing fallback-to-English contract in both `transitions.js` and `reportPack.js`'s `resolveLanguage()`.
- The confidentiality footer line stays outside the i18n system by design (T-07-22) — its leading "CONFIDENTIAL" word is a handling instruction, not interface copy, and must never vary by language.
- **Documented deferral**, recorded in the seed script's own header comment: the pack button's in-flight label, its failure message, and the pack route's 409 empty-deal error text carry no `data-i18n` attribute or `t()`-resolver call at all — there is no key in source to seed. Wiring them would require exposing a new global translate accessor from `transitions.js` and deciding how a JSON error response carries a caller's language — an interface change beyond this plan's declared file scope and beyond a same-task auto-fix.
- F-A fixed by wrapping the chip ribbon onto additional rows (never truncating/shrinking chip text), advancing layout from the final wrapped row so later content accounts for the extra height automatically.
- F-B fixed by measuring text against the TITLE column's own width during the layout pass (not at draw time) and growing row height to match, so the paginator's page-break budget and the renderer's actual drawn output share the identical wrapped height.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale-row tag hardcoded English with no i18n resolver call**
- **Found during:** Task 1, deriving the key list from source
- **Issue:** `lib/reportPack.js`'s `drawSynergyRow()` drew the "Stale {N}d" tag as a raw hardcoded string, unlike every sibling label in the same synergies section, which all resolve through `t()`.
- **Fix:** Threaded `t` into `drawSynergyRow()` and added `rpt.pack_stale_tag` to the seed and the proof test.
- **Files modified:** `lib/reportPack.js`, `scripts/seed-reports-i18n.js`, `test/reports-i18n.test.js`
- **Verification:** `node --test test/reports-i18n.test.js` — key resolves in all four languages.
- **Commit:** `4fe6a90` (Task 1's commit)

**2. [Rule 1 - Bug] Chip ribbon clipped past the page edge (F-A, found live during the phase walk)**
- **Found during:** Task 2's live walk, step 7 (narrow-width/German reflow was clean; the chip-ribbon overflow was found separately during the Chinese-pack tofu/pagination pass on a deal with more workstreams than the earlier fixtures exercised)
- **Issue:** `execSummarySection`'s RAG workstream chip strip drew chips left-to-right with no wrap check, so the last chip in a full row clipped mid-word off the page's right edge once enough workstreams existed to fill one row.
- **Fix:** Chips now wrap onto additional rows once a chip would cross the content-width right edge; layout advances from the final wrapped row so later content (top risks, stale sentence) accounts for the extra height automatically.
- **Files modified:** `lib/reportPack.js`, `test/reports-pack.test.js`
- **Verification:** New regression test asserts no chip rect is ever drawn past `CONTENT_RIGHT_PX`, and a 10-workstream fixture actually wraps onto more than one row; also confirmed via a real rendered raster.
- **Commit:** `4506923`

**3. [Rule 1 - Bug] Long task titles overprinting neighbouring columns (F-B, found live during the phase walk)**
- **Found during:** Task 2's live walk, step 11 (pagination at volume on scratch deal FALCON)
- **Issue:** The Workstreams & Tasks table's TITLE column never measured a title against its own column width before drawing, so a sufficiently long title overprinted the WORKSTREAM/PHASE columns and the row beneath it, and the paginator's page-break budget disagreed with what was actually drawn.
- **Fix:** Added `wrapText()` (a `measureText`-based greedy line wrapper) and `paginateRowsByHeight()` (a height-based row packer); a throwaway `@napi-rs/canvas` measuring context gives pass-one layout real font metrics even though `paginateSections` never hands a section a live drawing context, so pass-one row-height decisions and pass-two drawn output can never disagree. Header-repeat/no-split-row pagination remained correct against the new variable row heights.
- **Files modified:** `lib/reportPack.js`, `test/reports-pack.test.js`
- **Verification:** New regression test asserts an oversized title's continuation lines draw no text in the neighbouring column's x-range and the row grows past the fixed single-line height; confirmed via real rendered rasters of both affected pages.
- **Commit:** `4506923`

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bug fixes; two found only by the live human walk, exactly the class of defect this plan's blocking checkpoint exists to catch)
**Impact on plan:** All three fixes necessary for correctness (i18n completeness, and two real PDF rendering defects that a green test suite could not see). No scope creep — F-A/F-B are structural fixes to the pack renderer this phase already owns, not new functionality.

## Issues Encountered

None beyond the three auto-fixed deviations documented above. Full suite: 650/650 after this plan (648 after Task 1's seed + i18n fix, 650 after the F-A/F-B fix), zero regressions.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

This is the last plan of the last phase (Phase 7) of the current milestone. The checkpoint's live walk found, fixed, and re-proved two PDF rendering defects before the user approved the gate — no outstanding blockers remain from this plan.

**Documented deferral carried forward** (recorded in `scripts/seed-reports-i18n.js`'s header, not scheduled to any plan): the pack button's in-flight label, its failure message, and the pack route's 409 empty-deal error text have no i18n wiring at all. Wiring them is an interface change (new translate accessor exposed from `transitions.js`, plus a decision on how a JSON error response carries a caller's language) beyond this plan's scope — a candidate for a future quick task or milestone.

**Walk-documented, non-blocking observations** (not defects): the demo showcase's own export/pack footer shows a blank codename (no deal row exists in demo — D-11 audit-scoping parity is intact; demo genuinely produces zero audit rows and this is expected, not a bug). `rpt.*` interface labels ship English-fallback for DE/ZH per the documented convention above, except the pack tile/severity labels carrying verbatim-translated meaning, which render translated as designed.

Milestone-level: Phase 7 (IMO Reporting & Exports) is now complete pending the orchestrator's own final gates (ROADMAP status flip owned by the orchestrator, not this plan).

---
*Phase: 07-imo-reporting-exports*
*Completed: 2026-08-09*

## Self-Check: PASSED

All created files (`scripts/seed-reports-i18n.js`, `test/reports-i18n.test.js`) and this SUMMARY.md confirmed present on disk; both task/fix commit hashes (`4fe6a90`, `4506923`) confirmed present in `git log --oneline --all`.
