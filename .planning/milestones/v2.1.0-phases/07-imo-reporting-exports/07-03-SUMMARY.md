---
phase: 07-imo-reporting-exports
plan: 03
subsystem: api
tags: [pdf, canvas, font-vendoring, cjk, i18n, zero-new-dependencies]

# Dependency graph
requires:
  - phase: 07-imo-reporting-exports
    plan: 01
    provides: lib/ CommonJS module shape precedent (lib/sanitizeHtml.js), the phase's export architecture this plan's substrate will eventually sit alongside
provides:
  - lib/reportPdf.js — renderPageToRgbStream(drawFn, cssWidth, cssHeight, scale) and buildPdf(pages), the hand-rolled PDF 1.4 writer the steerco pack (RPT-02/03) will call
  - public/vendor/fonts/NotoSansSC-Regular.otf + OFL.txt — a provenance-recorded, licensed glyph-covering font (Latin + Latin Extended-A + CJK in one file)
  - @napi-rs/canvas as a direct pinned package.json dependency (was transitive via pdf-parse)
  - test/reports-pdf.test.js — pixel-level non-tofu proof (Chinese/German/Czech) + PDF structural proof (xref offset resolution, page count, deflate round-trip)
affects: [07-04-through-07-06 (the steerco pack layout/composition plans build directly on buildPdf/renderPageToRgbStream and the registered MAReportFont family)]

# Actuals (#2632)
actuals:
  tokens: 6735
  tasks: 2
  commits: 2

tech-stack:
  added:
    - "@napi-rs/canvas 0.1.80 (promoted from transitive to direct dependency — zero new npm install)"
    - "Noto Sans SC Regular (SIL OFL 1.1), vendored binary asset, not an npm package"
  patterns:
    - "Every PDF page is a single full-page raster image (canvas at 2x scale -> raw RGBA -> alpha-stripped RGB -> zlib deflate -> /DeviceRGB /FlateDecode Image XObject) — no vector PDF text, no font-embedding subsystem, because the vendored font's glyph coverage is already solved by canvas"
    - "buildPdf(pages) takes a fully-materialised page array, never a streaming/incremental append — forces the two-pass measure-then-render layout the every-page footer contract needs (07-RESEARCH.md Pitfall 5)"
    - "Every indirect PDF object's cross-reference offset is recorded at append time against the real assembled buffer, never derived after the fact from string lengths"
    - "ctx.font must always name the explicitly registered vendored family (MAReportFont) — never a generic family name, which silently renders CJK as blank tofu with no error (07-RESEARCH.md Pitfall 1)"

key-files:
  created:
    - lib/reportPdf.js
    - test/reports-pdf.test.js
    - public/vendor/fonts/NotoSansSC-Regular.otf
    - public/vendor/fonts/OFL.txt
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Font choice: Noto Sans SC Regular (static OTF, one weight, one file) from notofonts/noto-cjk's official GitHub release Sans2.004, asset 18_NotoSansSC.zip — NOT the Google Fonts variable-font release (NotoSansSC[wght].ttf, 17.7MB, exceeds the ~10MB budget flagged in 07-RESEARCH.md Open Question 1). The static Regular OTF is 8,331,336 bytes, under budget."
  - "No bold weight vendored. Verified live (node -e script, see below) that @napi-rs/canvas synthesizes a usable bold from the single vendored regular weight for both a Chinese phrase and a mixed Chinese/German string — resolving 07-RESEARCH.md's explicit 'verify this specific claim before relying on it' flag."
  - "package-lock.json's root dependency block also normalized 'zod': '^4.4.3' -> '4.4.3' as an incidental side effect of the required lockfile-only sync — this brings the lock in line with package.json's own already-unpinned-caret value (a pre-existing drift, not introduced by this plan), not a new decision to pin zod differently."
  - "node_modules/.package-lock.json (npm's internal bookkeeping file, tracked in git) was touched by `npm install --package-lock-only` even though it changes zero actual installed files (only added optionalDependencies platform-package bookkeeping entries for platforms not installed here) — reverted via `git checkout -- node_modules/.package-lock.json` to keep the node_modules gate (`git status --porcelain node_modules/` empty) literal, per the plan's explicit verification requirement."

patterns-established:
  - "lib/ CommonJS module shape (JSDoc header explaining the WHY, 'use strict', named function declarations, one module.exports) — lib/sanitizeHtml.js's precedent, now shared by three modules (reportCsv.js, reportFilename.js, reportPdf.js)"
  - "public/vendor/<asset-family>/ + an accompanying licence file — the Transformers.js vendoring precedent, now shared by a second vendored binary asset family (fonts)"

requirements-completed: [RPT-02]

coverage:
  - id: D17
    description: "The registered vendored font renders real, non-blank Chinese, German (umlaut/eszett) and Czech (caron/ring) glyphs — proven by a pixel-level non-white-pixel-count assertion, not string equality"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pdf.test.js#reports-pdf glyph coverage (a)-(c)"
        status: pass
    human_judgment: false
  - id: D18
    description: "The SAME Chinese phrase rendered under a generic 'sans-serif' family name produces materially fewer non-white pixels than under the registered vendored family — the tofu pitfall, proven live rather than assumed fixed"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pdf.test.js#reports-pdf glyph coverage (d)"
        status: pass
    human_judgment: false
  - id: D19
    description: "Bold text synthesizes correctly from the single vendored regular weight (no bold file vendored) for both CJK and Latin glyphs in the same string"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pdf.test.js#reports-pdf glyph coverage (e)"
        status: pass
    human_judgment: false
  - id: D20
    description: "buildPdf(pages) produces a buffer beginning with the %PDF-1.4 header and ending with the %%EOF marker, containing exactly one /Type /Page object per requested page"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pdf.test.js#reports-pdf minimal PDF 1.4 writer (g)-(h)"
        status: pass
    human_judgment: false
  - id: D21
    description: "Every cross-reference table offset resolves to a real object header at that exact byte position, for a multi-page document"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pdf.test.js#reports-pdf minimal PDF 1.4 writer (i)-(j)"
        status: pass
    human_judgment: false
  - id: D22
    description: "The deflated image stream round-trips to the exact width*height*3 byte length implied by the page's pixel dimensions, and the bytes embedded in the PDF are byte-identical to what renderPageToRgbStream produced"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pdf.test.js#reports-pdf minimal PDF 1.4 writer (k)"
        status: pass
    human_judgment: false
  - id: D23
    description: "A zero-page buildPdf() call is rejected with a clear error rather than producing an unopenable file; non-positive page dimensions and a non-function drawFn are also rejected"
    requirement: "RPT-02"
    verification:
      - kind: unit
        ref: "test/reports-pdf.test.js#reports-pdf minimal PDF 1.4 writer (f), (l)"
        status: pass
    human_judgment: false
  - id: D24
    description: "The written PDF is valid to an independent, non-repo PDF renderer, not just this repo's own byte-parsing test — verified by generating a real two-page sample and rendering it through macOS Quick Look/PDFKit"
    verification:
      - kind: manual_procedural
        ref: "ad hoc node -e script writing a sample PDF + `qlmanage -t` thumbnail generation, visually confirmed by the executor this session"
        status: pass
    human_judgment: true
    rationale: "This repo's own tests parse the PDF byte structure back out (the correct, load-bearing proof for CI), but a byte-correct-per-spec file could still be malformed in a way only a real PDF consumer would reject; an independent renderer opening it and showing real (non-tofu) glyphs is the strongest available confirmation short of a human clicking through the eventual pack UI, which is out of this plan's scope (no UI was built here)"

duration: ~55min
completed: 2026-08-09
status: complete
---

# Phase 7 Plan 3: PDF Pack Substrate — Font Vendoring, Direct Canvas Dependency, Minimal PDF 1.4 Writer Summary

**A hand-rolled PDF 1.4 writer (`lib/reportPdf.js`) that turns @napi-rs/canvas-rasterized pages into a valid multi-page PDF with zero new npm dependencies, backed by a provenance-recorded vendored font (Noto Sans SC Regular, 8.3MB, SIL OFL 1.1) that renders Chinese, German and Czech as real glyphs — proven by a pixel-level test, not left to a human noticing blank labels later.**

## Performance

- **Duration:** ~55 min (Tasks 1-2)
- **Completed:** 2026-08-09
- **Tasks:** 2
- **Files modified/created:** 6 (2 new lib/test modules, 2 vendored font-family assets, 2 manifest files)

## Accomplishments

- Resolved 07-RESEARCH.md's Open Question A2 (exact font choice/size budget) with a concrete, provenance-recorded pick: **Noto Sans SC Regular**, a single static OTF covering Latin + Latin Extended-A (Czech) + CJK (Chinese) in one file, downloaded from the upstream `notofonts/noto-cjk` GitHub release `Sans2.004` (asset `18_NotoSansSC.zip`), not an unofficial mirror.
  - **Upstream URL:** `https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/18_NotoSansSC.zip`
  - **File:** `public/vendor/fonts/NotoSansSC-Regular.otf`
  - **Byte size:** 8,331,336 bytes (~8.3MB — under the ~10MB budget 07-RESEARCH.md flagged)
  - **SHA-256:** `faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9`
  - **Licence:** SIL Open Font License 1.1, full text at `public/vendor/fonts/OFL.txt` (permits embedding and redistribution)
  - **Magic bytes verified:** `4f54 544f` (`OTTO` — a valid CFF-flavoured OpenType font, not an HTML error page saved with a font extension)
  - **No bold weight vendored** — verified live (ad hoc `node -e` script, results recorded in Deviations/Decisions below) that `@napi-rs/canvas` synthesizes a usable bold from the single regular weight for both pure-CJK and mixed-CJK/Latin strings.
- Promoted `@napi-rs/canvas` from a transitive `pdf-parse`→`pdfjs-dist` optional dependency to a direct pinned `package.json` dependency (`0.1.80`, the exact version already vendored — no upgrade). Ran `npm install --package-lock-only` to sync `package-lock.json`, then confirmed `git status --porcelain node_modules/` was non-empty (an npm-internal bookkeeping file, `node_modules/.package-lock.json`, had been rewritten with zero actual file changes) and reverted that one file via `git checkout --` so the committed dependency tree is byte-for-byte unchanged.
- Built `lib/reportPdf.js`: `renderPageToRgbStream(drawFn, cssWidth, cssHeight, scale)` rasters one page at 2x scale, fills opaque white, scales the drawing context to CSS-pixel coordinates, sets the default font to the registered vendored family, strips the alpha channel from the raw RGBA pixel buffer, and returns the pixel dimensions plus a zlib-deflated RGB stream. `buildPdf(pages)` assembles a complete PDF 1.4 `Buffer` from a fully-materialised page array — catalog, page tree, one Image XObject + Content stream + Page object per page, a cross-reference table whose offsets are recorded at append time against the real buffer, and a trailer — rejecting a zero-page call outright rather than emitting an unopenable file.
- `test/reports-pdf.test.js` (14 tests across two suites): pixel-level proof that Chinese/German/Czech render as real glyphs under the registered font; proof that the same Chinese phrase under a generic `sans-serif` name renders as near-empty tofu (07-RESEARCH.md Pitfall 1, verified live rather than assumed); proof that bold synthesizes correctly; and full PDF structural proofs — header/EOF markers, exact page-object count, every xref offset resolving to a real object header, deflate round-trip byte-length parity, byte-identical embedded stream content, and rejection of a zero-page call and invalid dimensions.
- Independently confirmed the writer's output beyond this repo's own test suite: generated a real two-page sample PDF with mixed Chinese/German/Czech text and rendered it through macOS's own Quick Look (PDFKit) — it opened cleanly and showed real Chinese and German glyphs (including correctly bolded Chinese) rather than tofu boxes.

## Task Commits

Each task was committed atomically:

1. **Task 1: Vendor a glyph-covering font, promote the canvas binding, prove no tofu** - `744b1d9` (feat)
2. **Task 2: The minimal PDF 1.4 writer** - `601eedf` (feat)

## Files Created/Modified

- `public/vendor/fonts/NotoSansSC-Regular.otf` — vendored glyph-covering font (Latin + Latin Extended-A + CJK), SIL OFL 1.1
- `public/vendor/fonts/OFL.txt` — the accompanying licence text
- `package.json` — `@napi-rs/canvas` promoted to a direct pinned dependency (`0.1.80`)
- `package-lock.json` — lockfile-only sync recording the new direct dependency edge
- `test/reports-pdf.test.js` — glyph-coverage pixel proofs (Task 1) + PDF structural proofs (Task 2)
- `lib/reportPdf.js` — `renderPageToRgbStream`, `buildPdf`, `REPORT_FONT_FAMILY` (`MAReportFont`)

## Decisions Made

- Noto Sans SC Regular (static OTF, single weight) chosen over the Google Fonts variable-font release specifically because the variable release is 17.7MB — over the ~10MB budget 07-RESEARCH.md flagged — while the official `notofonts/noto-cjk` static-OTF release's Regular weight is 8.3MB, comfortably under it.
- No bold weight vendored; canvas's bold synthesis from the single regular weight was verified live to render both a pure-CJK phrase and a mixed CJK/Latin string correctly before relying on it (07-RESEARCH.md's own "verify this specific claim" flag).
- The vendored font is registered once at `lib/reportPdf.js` module load under the family name `MAReportFont`, resolved relative to `__dirname` (works from any working directory, including inside the release bundles). Registration failure logs via the `[security]` prefix convention and rethrows — a pack silently rendered in a fallback font is worse than one that fails to generate, per the plan's explicit instruction.
- `buildPdf(pages)` intentionally exposes no streaming/incremental page-append interface — only a fully-materialised array — so a future pack-composition plan cannot accidentally build the "Page 1 of 1 regardless of real total" bug 07-RESEARCH.md Pitfall 5 describes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `npm install --package-lock-only` touched `node_modules/.package-lock.json`**
- **Found during:** Task 1, immediately after running the lockfile-only sync
- **Issue:** npm's own internal bookkeeping file inside the committed `node_modules/` tree (`node_modules/.package-lock.json`) was rewritten to add `optionalDependencies` platform-package entries (Android, additional Linux arm/musl variants) that are not installed on this machine — even though zero actual package files changed on disk. This would have made `git status --porcelain node_modules/` non-empty, failing the plan's explicit verification gate.
- **Fix:** Reverted the single file via `git checkout -- node_modules/.package-lock.json` after confirming no other file under `node_modules/` had changed. `package.json` and `package-lock.json` (the top-level manifest files) retain the new direct dependency edge.
- **Files modified:** none beyond the revert itself (no net change)
- **Commit:** folded into `744b1d9` (the revert happened before staging, so it never entered a commit)

Package-lock's incidental `zod` caret normalization (documented as a key-decision above, not a bug) and the missing-bold-weight verification (also a key-decision, performed proactively per the plan's own instruction) are not deviations — both were explicitly anticipated by the plan text itself.

## Issues Encountered

None beyond the node_modules bookkeeping-file revert documented above. The full test suite showed one transient failure on a single `npm test` run (a known flake in `test/synergy-phasing.test.js` per project history, unrelated to any file this plan touched) that did not reproduce on an immediate re-run; both runs were 598 tests total, with the flake run showing 597/598 and the clean re-run showing 598/598.

## User Setup Required

None — no external service configuration required. The font is a committed repository asset; no environment variable or manual step is needed for it to be found (path resolved relative to `lib/reportPdf.js`'s own `__dirname`).

## Next Phase Readiness

- `lib/reportPdf.js`'s `renderPageToRgbStream`/`buildPdf`/`REPORT_FONT_FAMILY` exports are ready for the pack composition plan (07-04+) to build page layouts against, using `MAReportFont` for every string drawn.
- The two-pass (measure-then-render) contract `buildPdf` enforces is the interface the pack's page-count/footer logic must follow — there is no shortcut available that would reintroduce 07-RESEARCH.md Pitfall 5.
- Font provenance (URL, size, SHA-256, licence) is fully recorded above for any future audit or licence-compliance review.
- No outstanding manual verification debt for this plan's own scope: the pixel-level tofu proof, the PDF structural proof, and an independent-renderer confirmation were all completed. The eventual pack's live in-app UI walkthrough remains 07-04+'s responsibility (no UI was built in this plan).

---
*Phase: 07-imo-reporting-exports*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 6 created/modified files confirmed present on disk (`lib/reportPdf.js`, `test/reports-pdf.test.js`, `public/vendor/fonts/NotoSansSC-Regular.otf`, `public/vendor/fonts/OFL.txt`, `package.json`, `package-lock.json`); both task commit hashes (`744b1d9`, `601eedf`) confirmed present in `git log --oneline --all`.
