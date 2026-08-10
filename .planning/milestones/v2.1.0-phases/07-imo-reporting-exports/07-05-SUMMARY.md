---
phase: 07-imo-reporting-exports
plan: 05
subsystem: api
tags: [pdf, canvas, pack-composition, i18n, confidentiality, two-pass-layout]

# Dependency graph
requires:
  - phase: 07-imo-reporting-exports
    plan: 03
    provides: lib/reportPdf.js — renderPageToRgbStream(drawFn, cssWidth, cssHeight, scale), buildPdf(pages), REPORT_FONT_FAMILY ("MAReportFont") — the pack's substrate
  - phase: 07-imo-reporting-exports
    plan: 04
    provides: the synergy rollup's split grossRealizedM/unphasedRealizedM fields and enrichSynergy()'s staleDays field, which page one's headline tiles and stale sentence read
provides:
  - "lib/reportPack.js — buildPack(model): the pack's public entry, takes an already-assembled, already-clearance-filtered model and returns a PDF Buffer"
  - "the every-page TE-branded header band (D-05) and confidentiality footer (D-07: codename/timestamp/username/page-of-total), drawn by the page frame — no section can render a page without them"
  - "the two-pass paginator (paginateSections + assemblePages) that makes 'Page N of M' correct on page one"
  - "the language resolver (resolveLanguage) mirroring transitions.js's i18n fallback order exactly"
  - "page one: execSummarySection — five headline stat tiles (incl. the D-01 unphased split), the RAG workstream strip, top risks, and the stale-count sentence"
  - "buildPackFromSections(model, sections) — a test/composition seam letting 07-06 (and this plan's own tests) exercise the frame/paginator against a custom section list independent of the module's DEFAULT_SECTIONS"
affects: ["07-06 (the remaining sections — workstreams/tasks, RAID, synergies — plus the export route and button) registers additional sections after execSummarySection and builds the model this plan's buildPack(model) consumes"]

# Actuals (#2632)
actuals:
  tokens: 12400
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Section composer signature: (model, t, contentWidth, contentHeight) => Array<{ render(ctx, {pageNumber, pageCount}) }> — a section measures itself and returns page descriptors; it never calls the PDF page renderer directly, which is what makes the header/footer bands structurally un-droppable (T-07-23)"
    - "Two-pass layout: paginateSections (pass one, no pixels/no PDF bytes) runs every section before assemblePages (pass two) renders any page — the total page count is known before page one's footer is ever drawn"
    - "Every drawn string is captured via an instrumented fake canvas context in tests (fillText interception), not inferred from rasterised pixels — makes the sentinel-absence and page-numbering proofs hold regardless of rasterisation"
    - "buildPack(model) / buildPackFromSections(model, sections) split: the former is the pack's real composition (DEFAULT_SECTIONS), the latter is a test/composition seam so frame-correctness tests never depend on which sections are registered by default as later plans add content"

key-files:
  created:
    - lib/reportPack.js
    - test/reports-pack.test.js

key-decisions:
  - "Model contract is this plan's own to define (07-05 has no route yet): { deal: {name}, language, generatedAt, generatedBy, i18n, rollup, workstreams, raid, synergies, staleThresholdDays }. deal.targetCompany is never read anywhere in this module's source — not gated by a runtime check, but by the field simply never appearing in the code (T-07-22's structural mitigation)."
  - "Task 1 registers a minimal placeholderSection as DEFAULT_SECTIONS so buildPack() is exercisable end-to-end before any content section exists, per the plan's own instruction; Task 2 replaces it with execSummarySection. The frame/paginator's own multi-page/sentinel/footer-numbering tests were written against buildPackFromSections + a test-local debug section from the start, so they remain valid and unaffected by that Task 2 swap — a design chosen specifically so DEFAULT_SECTIONS can keep evolving (07-06 will append more sections) without invalidating the frame's own correctness proofs."
  - "Header and footer both read a single model.generatedAt string (header labels it 'generation date', footer labels it 'generated {timestamp}') rather than two separately-formatted fields — the caller resolves and formats the value server-side once; this module never formats a date/timestamp itself."
  - "RAG workstream strip chip widths are measured per-label via ctx.measureText (real per-language width), not assumed from the English string length — the one place in this page where 07-UI-SPEC.md's i18n overflow rule is directly enforced by the layout code itself rather than by convention."
  - "staleThresholdDays is a new top-level model field (not part of the rollup response GET /api/synergies/rollup returns today) — documented in the module's header comment so Plan 07-06's route knows to supply it (e.g. via the existing synergyStaleDays(db) helper) when assembling the model."

patterns-established:
  - "Section-composer / page-descriptor split for the pack's remaining plans (07-06) to follow: measure-only in pass one, render-only in pass two, page frame owns chrome"

requirements-completed: [RPT-02, RPT-03]

coverage:
  - id: D-05-1
    description: "Every page of a multi-page pack carries the branded header and confidentiality footer — sections cannot opt out because they never call the page renderer directly"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack page frame (a),(b)"
        status: pass
    human_judgment: false
  - id: D-07-1
    description: "The footer/header read only deal.name (codename); a sentinel placed in deal.targetCompany appears in zero drawn strings, proven via an instrumented context so the assertion holds regardless of rasterisation"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack page frame (c),(e)"
        status: pass
    human_judgment: false
  - id: D-05-2
    description: "The page-of-total counter is correct on page one because the two-pass paginator knows the total before page one's footer is drawn"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack page frame (d)"
        status: pass
    human_judgment: false
  - id: D-i18n-1
    description: "The language resolver falls back to English, then the caller-supplied literal, then the key itself; an unsupported requested language code defaults to English"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack page frame (f),(g)"
        status: pass
    human_judgment: false
  - id: D-01-1
    description: "Page one's five headline tiles read exclusively from the supplied rollup — a rounding-edge fixture whose per-initiative amounts do not sum cleanly proves no re-summation occurs; the unphased figure renders as its own tile, never folded into gross"
    requirement: "RPT-03"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack executive summary (page one) (a),(b)"
        status: pass
    human_judgment: false
  - id: D-01-2
    description: "Net benefit renders in the danger colour when negative"
    requirement: "RPT-03"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack executive summary (page one) (c)"
        status: pass
    human_judgment: false
  - id: D-RAG-1
    description: "RAG workstream strip chips use the band the caller's workstream rollup supplied, never re-derived from a percentage; top risks are ordered most-severe-first and truncated to 5; the stale sentence's numbers equal the supplied rollup count and collection length"
    requirement: "RPT-03"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack executive summary (page one) (d),(e),(f)"
        status: pass
    human_judgment: false
  - id: D-empty-1
    description: "A completely empty model (no workstreams, no RAID, no synergies) still renders a valid page one and a valid PDF, never throwing and never a blank page"
    requirement: "RPT-03"
    verification:
      - kind: unit
        ref: "test/reports-pack.test.js#reports-pack executive summary (page one) (g),(h)"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 5: PDF Steerco Pack — Page Frame, Confidentiality Footer, Two-Pass Paginator and the Executive Summary Summary

**Built `lib/reportPack.js`'s frame (TE-branded header, an every-page confidentiality footer that structurally cannot reference the real legal-target name, and a two-pass paginator that makes the "Page N of M" counter correct from page one) plus the executive summary page itself, with every headline number traced to the caller's rollup and never re-summed.**

## Performance

- **Duration:** ~50 min (Tasks 1-2)
- **Completed:** 2026-08-09
- **Tasks:** 2
- **Files created:** 2 (lib/reportPack.js, test/reports-pack.test.js)

## Accomplishments

- Declared 07-UI-SPEC.md §5's page geometry (US Letter 816×1056px/612×792pt, 0.75in margins, 672px content column, 60px header band, 24px footer band) as named constants in one place, never scattered through drawing code.
- Built the language resolver (`resolveLanguage`) mirroring `public/js/transitions.js`'s `applyPortalI18n()` fallback order exactly: requested language → English entry → caller-supplied English literal → the key itself, with the four shipped languages (en/de/zh/cs) validated and anything else defaulting to English.
- Built `drawHeaderBand` (TE logo at its natural 119×68 aspect ratio, right-aligned codename + generation date, the orange accent rule) and `drawFooterBand` (hairline separator, centred `CONFIDENTIAL — {codename} · generated {timestamp} · by {username}`, right-aligned `Page N of M`) — both read exclusively `deal.name`; `deal.targetCompany` never appears anywhere in the module's source, a structural (not runtime-checked) mitigation for T-07-22.
- Built the two-pass paginator: `paginateSections` (pass one, measures every registered section, produces zero pixels/PDF bytes) and `assemblePages`/`renderPageFrame` (pass two, renders each page through the frame once the total is known). Sections only ever produce a `{render(ctx)}` descriptor — they cannot call the page renderer directly, which is what makes a page without the confidentiality mark structurally impossible (T-07-23).
- Exposed `buildPackFromSections(model, sections)` as a deliberate test/composition seam alongside the real `buildPack(model)`, so the frame's own correctness tests (multi-page pagination, per-page numbering, sentinel absence) stay valid independent of whatever `DEFAULT_SECTIONS` evolves into as 07-06 adds more content.
- Built page one, `execSummarySection`: five headline stat tiles (gross realized, unphased, cost incurred, net benefit — danger-coloured when negative, deal target) read exclusively from `model.rollup`; a RAG workstream strip whose chip colours come from the caller's own `ragStatus` band (never re-derived from a percentage) with per-language `ctx.measureText`-sized chips; the top 3–5 risks ordered most-severe-first as coloured text; and the stale-count sentence, with its numbers read from `model.rollup.staleCount` and `model.synergies.length`, never recounted.
- `test/reports-pack.test.js` (18 tests): multi-page pagination proof, per-page number/total proof, an instrumented-fake-context sentinel-absence proof (captures every `fillText` call rather than inspecting pixels), page-one page-of-total proof, English-fallback proof, a rounding-edge fixture proving no re-summation of the five tiles, the unphased-tile-is-its-own-tile proof, the danger-colour-on-negative proof, RAG-band-passthrough proof, severity-ordering-and-truncation proof, stale-sentence-numbers proof, and the empty-deal-still-renders proof.

## Task Commits

Each task was committed atomically:

1. **Task 1: Page frame, confidentiality footer and the two-pass paginator** - `8589583` (feat)
2. **Task 2: Page one — the executive summary** - `cb23c7b` (feat)

## Files Created/Modified

- `lib/reportPack.js` — page geometry, colour/typography constants, `resolveLanguage`, `drawHeaderBand`, `drawFooterBand`, `paginateSections`, `renderPageFrame`, `assemblePages`, `buildPack`, `buildPackFromSections`, `execSummarySection`
- `test/reports-pack.test.js` — frame/paginator proofs (Task 1) + executive-summary proofs (Task 2)

## Decisions Made

- The model contract (`{deal, language, generatedAt, generatedBy, i18n, rollup, workstreams, raid, synergies, staleThresholdDays}`) is this plan's own to define, since 07-05 has no route yet; documented in the module's header comment as the interface Plan 07-06's route must build the model against.
- Task 1's `placeholderSection` (registered as `DEFAULT_SECTIONS` so `buildPack()` was exercisable before any real content existed) was replaced wholesale by `execSummarySection` in Task 2, per the plan's own instruction — this was safe because the frame's own correctness tests were written from the start against `buildPackFromSections` + a test-local section, decoupled from whatever `DEFAULT_SECTIONS` becomes.
- Header and footer both read a single `model.generatedAt` string rather than separate date/timestamp fields — the caller resolves and formats it once server-side; this module never formats a date itself.
- `staleThresholdDays` is a new top-level model field, not currently part of `GET /api/synergies/rollup`'s response — flagged for Plan 07-06 to supply (likely via the existing `synergyStaleDays(db)` helper) when it assembles the model.
- RAG chip widths are measured per-label via `ctx.measureText`, the one place in this page where the i18n "no fixed-width layout box" rule is directly enforced by the layout code rather than left to convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two rounding-edge test fixture values landed on the wrong side of `toFixed(1)`'s floating-point rounding**
- **Found during:** Task 2, first test run
- **Issue:** `costIncurredM: 5.05` and `netBenefitM: 7.35` are not exactly representable in IEEE 754 double precision; both values are stored fractionally below their literal decimal value, so `.toFixed(1)` rounded them down (`5.0`, `7.3`) instead of the intended `5.1`/`7.4`, failing the tile-value assertions.
- **Fix:** Changed the fixture values to `5.06` and `7.36`, which round the intended direction under `toFixed(1)` while still not summing cleanly from the per-initiative fixture rows (the property the test exists to prove).
- **Files modified:** `test/reports-pack.test.js`
- **Commit:** folded into `cb23c7b` (found and fixed before the task's first commit)

## Issues Encountered

None beyond the floating-point rounding fixture fix documented above. Full suite: 611/611 after Task 1, 620/620 after Task 2 — both green, no regressions.

## User Setup Required

None — no external service configuration required. The pack module reads the already-committed `public/te-logo.png` and the vendored font `lib/reportPdf.js` already registers; nothing new to vendor or configure.

## Next Phase Readiness

- `lib/reportPack.js`'s `buildPack(model)` is ready for Plan 07-06 to call once it assembles the clearance-filtered model and adds the remaining sections (workstreams & tasks, RAID, synergies) via the same `(model, t, contentWidth, contentHeight) => Array<{render(ctx)}>` section-composer signature `execSummarySection` establishes.
- The model contract this plan defines (documented in `lib/reportPack.js`'s header comment) is the shape 07-06's export route must build — including the new `staleThresholdDays` field this plan introduces but no existing route currently computes standalone.
- `buildPackFromSections` remains available as a composition/test seam if 07-06 needs to prove section-level behaviour independent of the full default registry.
- No outstanding manual verification debt for this plan's own scope — all `<verify>` blocks are automated (`node --test`), and the full suite (620/620) is green. The pack's live in-app UI walkthrough (opening a real generated PDF from the app) remains 07-06/07-07's responsibility, since no route or button exists yet.

---
*Phase: 07-imo-reporting-exports*
*Completed: 2026-08-09*

## Self-Check: PASSED

Both created files confirmed present on disk (`lib/reportPack.js`, `test/reports-pack.test.js`); both task commit hashes (`8589583`, `cb23c7b`) confirmed present in `git log --oneline --all`.
