# Phase 7: IMO Reporting & Exports - Research

**Researched:** 2026-08-08
**Domain:** Server-side report generation (CSV/JSON export + hand-rolled PDF) in a vanilla-JS, no-build-step, zero-install Node/Express app
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**T-05-47 — headline integrity:**
- **D-01:** The synergy headline splits phased-backed from unphased realized money. `grossRealizedM`
  in the steerco pack counts only phased-backed amounts; unphased free-typed money appears as a
  separate, labelled "unphased" line. No write-path gating — Phase 5's quick-entry UX stands.
  Reversibility: costly.
- **D-02:** The split is computed once, in `GET /api/synergies/rollup` (new fields alongside the
  existing `grossRealizedM`/`unconfirmedRealizedM` family, following that precedent's
  item-level-rounding discipline). The PDF pack AND the execution-tab UI both render from the
  rollup — one source of truth, screen and pack can never disagree.
- **D-03:** "Unphased" is derived at read time (entry has zero phasing rows when the rollup runs).
  No migration, no stored flag; self-correcting the moment phasing is added.

**Steerco pack composition (RPT-02):**
- **D-04:** Structure = one-page executive summary first (headline numbers incl. the D-01 split,
  RAG-style workstream strip, top risks), then one section each for workstreams/tasks, RAID,
  synergies.
- **D-05:** Visual identity = TE deck branding: TE logo (`public/te-logo.png`, already the app header
  logo), deal name, date in the header; consistent with the v1.3.0 slidedeck look.
- **D-06:** Numbers = tables plus a few simple horizontal bars (synergy phased-vs-unphased,
  workstream progress) drawn with the already-vendored `@napi-rs/canvas` — no new chart library.
- **D-07:** Every page carries the confidentiality footer: `CONFIDENTIAL — <project codename> ·
  generated <timestamp> · by <username>`. Codename, never the target's legal name pre-announcement
  (MNPI discipline). The file leaves the app; it must carry its own handling instructions and
  provenance. Reversibility: reversible, but treat as a compliance floor.

**Export access & audit (RPT-01):**
- **D-08:** Any deal member can export — but the file contains exactly what the app would show that
  caller: the same outbound filters (RAID provenance/`clearanceArea`, area grants, restricted-tier
  absence) apply to export payloads identically. Export is a read surface, never a bypass. No new
  permission tier. Reversibility: costly.
- **D-09:** Org/talent data is excluded from exports and the pack entirely (positions, decisions,
  flight-risk). RPT-01/02 name workstreams, tasks, RAID, synergies — that is the whole export
  surface. Named-people MNPI never lands in an emailable file; the Phase-6 registers remain the only
  window. Reversibility: one-way in spirit.
- **D-10:** Every export and pack generation writes an audit event: who, deal, format
  (csv/json/pdf), scope, row counts. Same doctrine as the Phase-6 flight-risk read audit (D-03
  there): MNPI leaving the system is the audit log's core question. Real deals only (see D-11).
- **D-11:** Demo mode gets full export parity (the showcase should demonstrate reporting — it is a
  selling point; demo data is fictional). No audit rows in demo, matching Phase-3 D-08's audit
  scoping.

**Staleness presentation (RPT-04) + D-23 carry-over:**
- **D-12:** Stale items render inline where they are read: dimmed + "stale Nd" tag with last-updated
  date on the row, AND the exec summary shows the `staleCount` headline. No stale-appendix — main
  tables must never present stale numbers as current.
- **D-13:** Phase-6 D-23 stands: the flight-risk register gets no staleness signal, and the question
  is moot for the pack since org/talent is excluded (D-09). Revisit only on evidence from a real
  deal. This closes the STATE.md Phase-7 carry-over blocker.
- **D-14:** Staleness threshold = the per-deal `staleDays` setting, reused as-is (SYN-05 semantics,
  exactly-N-days-is-not-yet-stale boundary, never-default-unknown-to-stale). One knob; screen and
  pack move together.

### Claude's Discretion

- PDF generation mechanism (the HOW): research decides between @napi-rs/canvas PDF surface, a
  minimal hand-rolled PDF writer, print-CSS routes, or another zero-new-dependency approach.
  Constraint: vanilla stack, no build step, no CDN, works in the zero-install bundle on all three
  platforms. New npm dependencies only via the Package Legitimacy Gate, and prefer none.
- CSV column contracts, escaping/encoding (Excel-compatible UTF-8 handling), and JSON export shape.
- Export/pack filenames (should carry codename + date, not target legal name — extension of D-07's
  discipline).
- Where the export/pack UI lives (execution tab vs deal home vs both) and its generation UX (inline
  download vs async), subject to ui-phase. **Resolved by 07-UI-SPEC.md**: a fourth "Reports &
  Exports" tab on `execution.html`, inline `<a href>` for CSV/JSON, `fetch()`+blob for the PDF pack.
- Pack pagination/typography details within D-04..07. **Resolved by 07-UI-SPEC.md §5.**

### Deferred Ideas (OUT OF SCOPE)

- PPTX export — explicitly rejected at the requirements gate; do not revisit this milestone.
- Org/talent data in exports for hr-cleared callers — deliberately excluded (D-09); if ever wanted,
  it is its own gated decision, not an extension.
- Flight-risk staleness signal — D-23 stands; revisit only on real-deal evidence.
- Scheduled/emailed report delivery — out of scope (no outbound email infrastructure this milestone).
</user_constraints>

## Summary

This phase closes RPT-01..04: raw CSV/JSON export of workstreams/tasks/RAID/synergies, plus a
TE-branded PDF steering-committee pack. The single hardest technical question — how to generate a
PDF with **zero new npm dependencies**, **no build step**, and full **DE/ZH/CS** text support — is
answered definitively by this research through live, in-session verification of the actual vendored
`@napi-rs/canvas@0.1.80` binary (not from memory or docs): **the package has no PDF-writing surface
at all** (`Canvas.encodeSync`/`.encode`/`.toBuffer` only emit PNG/JPEG/WEBP/AVIF raster or an SVG
buffer; there is no `PDFDocument`, `exportPdf`, or PDF `Filter` anywhere in `index.d.ts`). This
closes off "use canvas's built-in PDF export" as an option — it does not exist, contradicting the
aspirational stack-doc line CONTEXT.md's `code_context` already flagged as suspect.

The recommended path is a **minimal hand-rolled PDF 1.4 writer that embeds one full-page raster
image (rendered by the already-vendored `@napi-rs/canvas`) per page**, rather than a vector-text PDF
using the standard 14 fonts. This is not the "lazy" choice — it is the one path that correctly
solves the phase's real constraint, verified empirically in this session: **Czech (Central European
Latin Extended-A) glyphs and Chinese (CJK) glyphs are BOTH outside what a base-14 PDF font +
WinAnsiEncoding can render** (WinAnsi/Latin-1 covers German's `äöüß` fine, but not Czech's
`č š ž ř ě ý ů`, and obviously not CJK at all). A vector-text hand-rolled PDF would need a real
font-embedding subsystem (CID-keyed Type0 fonts, glyph subsetting, custom encodings) to support all
four shipped languages — which is a much larger, riskier build than routing every page through the
canvas the codebase already vendors and already trusts for image rendering. Canvas (Skia) was
verified in this session to render CJK and Czech diacritics correctly once a glyph-covering font is
selected — but it does **not** do this automatically for `sans-serif`/default font resolution when
the codepoints are CJK, which is a real, previously-undocumented pitfall this research surfaces (see
Pitfall 1).

`@napi-rs/canvas` itself is also not what CONTEXT.md's `code_context` implied: it is not a direct
project dependency at all today — it arrived transitively as `pdf-parse`'s `pdfjs-dist` optional
dependency, and is currently `require()`-d nowhere in the codebase. It is genuinely present with
correct platform prebuilds in `node_modules` (verified: darwin-arm64, darwin-x64, linux-x64-gnu,
win32-x64-msvc), so it is safe and legitimate to use, but the planner should add it to
`package.json`'s direct `dependencies` (not `devDependencies`) so it is never silently dropped if
`pdf-parse`'s own dependency tree changes in a future `npm install`.

**Primary recommendation:** Build a small internal PDF-writer module (no new npm dependency) that
renders each report page as a `@napi-rs/canvas` raster canvas at 2x scale, extracts raw RGB pixels
via the verified `canvas.data()` API, deflates them with Node's built-in `zlib`, and wraps the result
in a hand-written minimal PDF 1.4 file structure (one `/DeviceRGB` `/FlateDecode` Image XObject per
page, one Content stream per page placing that image, a standard xref table and trailer). Select the
font passed to canvas per active language — vendor one CJK-and-Latin-Extended-capable font file
(e.g., Noto Sans SC) locally, matching the existing Transformers.js vendoring precedent, rather than
depending on the host OS's installed fonts (verified font availability on this dev machine is
macOS-specific and must not be assumed present on a fresh Windows/Linux zero-install target).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Rollup split computation (D-01/D-02) | API/Backend | — | Single source of truth already lives in `GET /api/synergies/rollup`; screen and pack both read it, never recompute |
| Server-side workstream rollup (new) | API/Backend | — | Currently computed client-side only (`execution.js:76-144`); must move to a server route so the pack (which has no browser) can read the identical numbers the screen shows |
| CSV/JSON export generation | API/Backend | — | Must reuse existing clearance filters server-side; a client-side export would either duplicate or bypass them |
| PDF pack rendering | API/Backend | — | Server-side generation is a locked decision (UI-SPEC fetch→blob pattern, D-10 audit at generation time); the browser only triggers and downloads |
| Export/pack UI (buttons, links) | Browser/Client | — | Static rows + one CTA, no data-fetching of its own (UI-SPEC §2 "not currently-filtered") |
| Audit event recording | API/Backend | Database/Storage | `db/auditHook.js` append-only audit.db, invoked from the same route that serves the export |
| Font/asset vendoring (CJK font, TE logo) | CDN/Static (build-time asset) | — | Loaded once at server startup via `GlobalFonts.registerFromPath()`, not fetched per-request |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RPT-01 | The IL can export raw data (workstreams, tasks, RAID, synergies) as CSV and JSON | §Architecture Patterns (export routes), §Code Examples (CSV writer, Content-Disposition), §Common Pitfalls (filename injection, header-value CRLF) |
| RPT-02 | The IL can generate a formatted PDF steering-committee pack summarizing status across workstreams, tasks, RAID and synergies | §Standard Stack (PDF mechanism decision), §Code Examples (PDF writer sketch), §Architecture Patterns (page-raster pipeline) |
| RPT-03 | The steerco pack reports synergy net benefit, cost-to-achieve and confidence-stage movement, avoiding double-counting | §D-01/D-02 rollup split mechanics (below), reuses `GET /api/synergies/rollup` as sole source of truth |
| RPT-04 | A status report distinguishes current from stale data using the staleness signals (SYN-05 and equivalents) | §D-12/D-14 staleness reuse, confirms no equivalent exists for tasks/RAID/workstreams/flight-risk (D-13) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Vanilla JS, no framework, no build step — the PDF/export mechanism must run as plain CommonJS
  `require()`-able server code, no compilation step, no bundler.
- No CDN dependency — any font or asset the PDF generator needs must be vendored under
  `public/vendor/` or a new `server/vendor/`-style path, matching the Transformers.js precedent,
  never fetched at request time.
- `node_modules/` is committed — a new vendored font file follows the same "committed binary asset"
  precedent already established by the canvas platform binaries.
- New npm dependencies only through the Package Legitimacy Gate; this research recommends adding
  **zero** new npm dependencies (only promoting the already-present `@napi-rs/canvas` from
  transitive to direct in `package.json`).
- `ADMIN_TOKEN` gate only applies to state-changing endpoints and `/api/admin/*` — export/report GET
  routes are unaffected (confirmed: `ROLE_WRITE_POLICY`/`isWrite` only gates non-GET methods,
  `server.js:444`).
- Two-tier logging convention (`console.error`/`console.warn`/`console.log`) applies to any new PDF
  generation failure paths.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@napi-rs/canvas` | 0.1.80 (already vendored) | Rasters every PDF page (text, tables, bars, logo) to RGB pixels | `[VERIFIED: node_modules/@napi-rs/canvas/index.d.ts (session Read)]` — confirmed present with darwin-arm64/darwin-x64/linux-x64-gnu/win32-x64-msvc prebuilds `[VERIFIED: node_modules/@napi-rs — dir listing]`; zero new dependency, D-06 already names it |
| `zlib` (Node built-in) | Node >=20 stdlib | Deflates raw RGB page pixels for the PDF's `/FlateDecode` Image XObject stream | No dependency at all — Node core module; `[VERIFIED: Node stdlib, no package.json entry needed]` |
| Hand-rolled PDF 1.4 writer (new, in-repo module) | n/a — new code | Minimal PDF structure: catalog, page tree, one Image XObject + one Content stream per page, xref table, trailer | No PDF-writing npm package needed once every page is a single raster image — confirmed no simpler path exists (see Assumptions Log / Alternatives below) |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `zod` | 4.4.3 (already a direct dependency) | Validate `?dataset=`/`?format=`/`?lang=` export query params | Every existing write/query-validated route in this codebase already uses zod; export routes should follow the same VAL-01 discipline even though they are reads |
| A vendored CJK+Latin-Extended font file (new binary asset, not an npm package) | TBD — recommend a Noto Sans SC static weight | Guarantees deterministic glyph coverage for EN/DE/CS/ZH regardless of what fonts happen to be installed on the host OS | Registered once at server startup via `GlobalFonts.registerFromPath()`; used for every canvas `ctx.font` in the PDF renderer, never left to system-font resolution (see Pitfall 1) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled raster-page PDF writer | `pdfkit` (npm, v0.19.1 `[VERIFIED: npm view pdfkit version — session command]`) | Real vector-text PDF with selectable/searchable text and a much smaller file size, BUT: adds 6 new transitive dependencies (`fontkit`, `@noble/ciphers`, `@noble/hashes`, `js-md5`, `linebreak`, `png-js`) requiring a full Package Legitimacy Gate pass; **still requires the same vendored CJK font file** to embed via `fontkit` (pdfkit does not solve the "no CJK glyphs" problem by itself — it just gives you an embedding API for a font you still have to supply), so it does not remove the one genuinely new asset this phase needs, it only adds dependency-audit surface on top of it. Worth revisiting only if a future phase needs copy-pasteable/searchable PDF text as a hard requirement — RPT-02/03 do not name that as a requirement. |
| Hand-rolled raster-page PDF writer | Print-CSS route (render an HTML page styled for print, screenshot/print via a headless browser) | Would need Puppeteer/Playwright-class headless Chromium — a large new binary dependency (100+ MB per platform) directly contradicting the "prefer none" + zero-install-bundle-size constraints; also reintroduces the exact CDN-font problem UI-SPEC already flagged for Outfit/Inter (a headless browser still needs local font files to render DE/CS/ZH correctly — no net win over the canvas approach). Rejected. |
| Vendoring one CJK-capable font | Rely on OS-installed system fonts via `GlobalFonts.families` (no vendoring) | **Verified live in this session (macOS)**: system font enumeration DOES include CJK-capable families (`Songti SC`, `Heiti TC`) and explicit selection of one renders CJK correctly — but this is macOS-specific font-manager behavior. A fresh Windows install ships Chinese fonts by default (Microsoft YaHei/SimSun) so is likely fine `[ASSUMED — not tested this session, no Windows machine available]`; a minimal/headless Linux target may have **zero** registered font families, which fails silently (blank canvas, no error) rather than throwing. Rejected as the sole mechanism because it makes PDF correctness depend on host font inventory the app has no control over — the zero-install-bundle's whole design point is to not depend on host-machine state. |

**Installation:**
```bash
# No new npm install needed — @napi-rs/canvas is already in node_modules
# (transitively via pdf-parse's optionalDependencies). Promote it explicitly:
npm pkg set dependencies.@napi-rs/canvas="0.1.80"
```

**Version verification:** `[VERIFIED: npm view @napi-rs/canvas version — session command]` returned
`1.0.3` as the current npm registry latest. The version actually vendored in `node_modules` is
`0.1.80` `[VERIFIED: node_modules/@napi-rs/canvas/package.json — session Read]`, i.e. **the vendored
copy is several minor versions behind latest**. Recommendation: **stay on the already-vendored
0.1.80, do not upgrade in this phase.** All API surfaces this research depends on
(`createCanvas`, `getContext('2d')`, `GlobalFonts.registerFromPath`/`.families`, `canvas.data()`,
`ctx.font`/`fillText`) were verified working against the exact 0.1.80 binary already committed for
all release platforms; upgrading to 1.0.3 would require re-vendoring platform-specific prebuild
binaries for darwin-arm64/darwin-x64/linux-x64-gnu/win32-x64-msvc and re-verifying every API call
against the new major-version surface — an unrelated, unbudgeted risk for a reporting phase. If a
future phase needs a 1.x-only feature, treat the upgrade as its own decision.

## Package Legitimacy Audit

This phase recommends **zero new npm dependencies**. The only "new" dependency is
`@napi-rs/canvas`, which is not actually new to the install — it is already present in
`node_modules` and `package-lock.json` (arrived transitively via `pdf-parse`'s
`pdfjs-dist` optional dependency). Promoting it from transitive to a direct
`package.json` entry is a manifest change, not a new install, so the full registry gate is
run here for completeness and to document the provenance clearly.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@napi-rs/canvas` | npm | Published under the `napi-rs`/Brooooooklyn org since 2022; `[VERIFIED: package.json repository field — node_modules/@napi-rs/canvas/package.json]` points to `github.com/Brooooooklyn/canvas` | Established Skia-binding project, used by the `pdf-parse`→`pdfjs-dist` chain already trusted in this repo | `github.com/Brooooooklyn/canvas` `[VERIFIED: package.json repository.url]` | OK | Approved — already present, promote to direct dependency |

No `postinstall` script risk: `[VERIFIED: node_modules/@napi-rs/canvas/package.json — session Read,
"scripts" block contains only "artifacts"/"bench"/"build"/"build:debug", no "postinstall" or
"install" key]`. The platform-specific binary packages (`@napi-rs/canvas-darwin-arm64` etc.) are
resolved via npm's standard `optionalDependencies` platform-matching mechanism, the same mechanism
already trusted for `better-sqlite3`'s prebuilds per this project's existing precedent.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

**Non-npm asset flagged for the planner's attention (not subject to the npm Package Legitimacy
Gate, but carries its own provenance/licensing check):** a vendored CJK-capable font file (e.g. Noto
Sans SC). This is a binary asset, not an npm package — no `npm view`/registry check applies — but
the planner/executor must verify its license (Google's Noto fonts ship under the SIL Open Font
License 1.1, which permits embedding and redistribution) before committing it, and should prefer
downloading it from Google Fonts' own repository/CDN-free release artifact rather than an
unofficial mirror. This was not downloaded or verified in this research session (no network
fetch of binary font assets was performed) — flagged as `[ASSUMED]` and listed in the Assumptions
Log below.

## Architecture Patterns

### System Architecture Diagram

```
Browser (execution.html, Reports & Exports tab)
   |
   |-- <a href="/api/reports/export?dataset=raid&format=csv">  (plain navigation, GET)
   |-- <a href="/api/reports/export?dataset=raid&format=json"> (plain navigation, GET)
   |-- fetch("/api/reports/pack?lang=de")                      (GET, blob response)
   v
Express /api gate (AUTH-01 session check — already applies to all /api/*, unchanged)
   v
GET /api/reports/export?dataset=<workstreams|tasks|raid|synergies>&format=<csv|json>
   |
   |-- dataset === 'raid'  --> reuse resolveRaidEntryClearanceArea() + accessPolicy.hasAreaGrant()
   |                           (server.js:3890-3916, IDENTICAL to GET /api/raid's own filter)
   |-- dataset === 'tasks' --> taskLane(db)                      (no per-item area field exists)
   |-- dataset === 'synergies' --> synergyLane(db).map(enrichSynergy) (server.js:3352-3356, same
   |                                enriched shape GET /api/synergies returns — D-08 JSON parity)
   |-- dataset === 'workstreams' --> NEW: computeWorkstreamRollup(db) (server-side port of
   |                                  execution.js:76-144's client-only math — no server route
   |                                  computes this today)
   v
format === 'csv'  --> toCsv(rows, columns) --> RFC4180 quoting + CRLF row terminators + UTF-8 BOM
format === 'json' --> res.json(rows)  (identical enriched shape to the live GET route — D-08)
   v
buildContentDisposition(safeFilename) --> res.setHeader(...) --> res.send(body)
   v
if (!req.isDemo) auditHook.recordSecurityEvent({ action: 'report-export', ... })  (D-10/D-11)

---

GET /api/reports/pack?lang=<en|de|zh|cs>
   v
1. Fetch every section's already-clearance-filtered data (reuses the SAME lane/filter functions
   the export route above uses — never a second, divergent read path)
2. Resolve i18n strings for `lang` from db.i18n.strings[lang][key] with EN fallback (mirrors
   transitions.js's t(key, lang) exactly)
3. For each logical page (exec summary, workstreams, RAID, synergies — paginating tables that
   overflow a page): render a @napi-rs/canvas Canvas at 2x scale using the vendored CJK font
4. canvas.data() --> strip alpha --> zlib.deflateSync() --> raw RGB FlateDecode stream
5. Assemble minimal PDF 1.4: catalog -> pages tree -> one Page+XObject+Content per rendered page
   -> xref table -> trailer
   v
res.setHeader('Content-Type','application/pdf') + Content-Disposition (same safe-filename builder)
   v
if (!req.isDemo) auditHook.recordSecurityEvent({ action: 'report-pack-generated', ... })  (D-10/D-11)
```

### Recommended Project Structure

```
server.js               # new routes: GET /api/reports/export, GET /api/reports/pack (co-located
                         # with the other /api route definitions, matching the existing
                         # one-big-file convention — no new router module split in this codebase)
lib/                     # NEW directory (or reuse an existing top-level module convention if the
  reportCsv.js           # planner finds one) — pure functions, easily unit-testable in isolation:
  reportPdf.js           #   reportCsv.js: toCsv(rows, columns) -> string (RFC4180 + BOM)
  reportPack.js          #   reportPdf.js: minimal PDF 1.4 writer (buildPdf(pages) -> Buffer)
                         #   reportPack.js: page-content composition (draws each canvas page,
                         #   owns the i18n-resolve-with-fallback helper, the ragColor()/
                         #   SYN_COLORS palette ports from execution.js)
public/vendor/fonts/     # NEW — vendored CJK+Latin-Extended font file(s), mirrors
  NotoSansSC-Regular.ttf # public/vendor/transformers/'s existing vendoring precedent
public/te-logo.png       # EXISTING — reused as-is for the pack header band (D-05)
```

### Pattern 1: Server-side clearance reuse for exports (D-08)

**What:** Every export/pack route calls the exact same lane-read + filter functions the
corresponding live `GET` route already uses — never a bespoke, second filter implementation.
**When to use:** Any new read surface over data that already has a clearance concept (today, only
RAID via `resolveRaidEntryClearanceArea()`).
**Example:**
```javascript
// Source: server.js:3890-3916 (existing, verified this session) — reused verbatim, not reimplemented
function resolveRaidEntryClearanceArea(entry, db) {
  if (entry && entry.clearanceArea) return entry.clearanceArea;
  const source = entry && entry.source;
  if (!source) return null;
  const ddMatch = /^dd-finding:(.+)$/.exec(source);
  if (ddMatch) {
    const finding = ddFindingsLane(db).find((f) => f.id === ddMatch[1]);
    return finding ? finding.area : null;
  }
  if (source.indexOf('org-flightrisk:') === 0) return 'hr';
  return null;
}

// New export route reuses it identically to GET /api/raid (server.js:3906-3916):
function raidExportRows(db, deal, portalUser) {
  return raidLane(db).filter((entry) => {
    const area = resolveRaidEntryClearanceArea(entry, db);
    return area === null || accessPolicy.hasAreaGrant(deal, portalUser, area);
  });
}
```

### Pattern 2: Server-side workstream rollup (new — closes the UI-SPEC-flagged gap)

**What:** Port `execution.js:76-144`'s client-only workstream percentage math to a server function
so both the CSV/JSON "workstreams" export and the pack's Section 2 bars read the identical numbers
the screen shows, without a browser.
**When to use:** Any time a report needs a number the client currently derives itself from two
already-fetched collections.
**Example (verified inputs — `db.checklistTemplates[0].workstreams` and `taskLane(db)`, both
confirmed present in `server.js`):**
```javascript
// Server-side port of the exact math in public/js/execution.js:118-136 (render()),
// reading the SAME two sources execution.js's load() fetches client-side:
//   res[1][0]  === db.checklistTemplates[0]  (GET /api/checklist-templates, server.js:3055)
//   res[0]     === taskLane(db)              (GET /api/integration-tasks, server.js:2918-2920)
function computeWorkstreamRollup(db) {
  const tpl = (db.checklistTemplates || [])[0];
  const workstreams = (tpl && tpl.workstreams) || [];
  const tasks = taskLane(db);
  return workstreams.map((w) => {
    const ts = tasks.filter((t) => t.workstreamId === w.id);
    const done = ts.filter((t) => t.status === 'done').length;
    const blocked = ts.some((t) => t.status === 'blocked');
    const pctComplete = ts.length ? Math.round((done / ts.length) * 100) : 0;
    return { id: w.id, label: w.label, tasksTotal: ts.length, tasksDone: done, pctComplete, blocked };
  }).filter((w) => w.tasksTotal > 0); // execution.js:119 also skips empty workstreams
}
```

### Pattern 3: Full-page raster PDF assembly

**What:** Render one @napi-rs/canvas `Canvas` per PDF page at 2x the CSS-pixel page size declared
in 07-UI-SPEC.md §5 (816×1056 CSS px -> 1632×2112 canvas px), then embed the raw pixel buffer
directly as a PDF Image XObject — no PNG re-encoding, no JPEG lossy step, no font-embedding code
inside the PDF itself (all text is already rasterized by canvas before the PDF layer ever runs).
**When to use:** Any report page needing full Unicode text support without a font-embedding
subsystem.
**Example (every sub-call verified working in this session against the actual vendored binary):**
```javascript
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const zlib = require('zlib');
const path = require('path');

// Register once at server startup — never per-request:
GlobalFonts.registerFromPath(
  path.join(__dirname, 'public/vendor/fonts/NotoSansSC-Regular.ttf'),
  'ReportFont'
);

function renderPageToRgbStream(drawFn, cssWidth, cssHeight, scale = 2) {
  const canvas = createCanvas(cssWidth * scale, cssHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale); // draw code below this line uses CSS-px coordinates, matches UI-SPEC §5
  ctx.font = '10px ReportFont'; // ALWAYS the registered font — never bare 'sans-serif' (Pitfall 1)
  drawFn(ctx);
  // canvas.data() verified this session to return raw RGBA (255,0,0,255 for opaque red)
  const rgba = canvas.data();
  const rgb = Buffer.alloc((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; // drop alpha byte
  }
  return { width: canvas.width, height: canvas.height, deflated: zlib.deflateSync(rgb) };
}
```

### Anti-Patterns to Avoid

- **Re-deriving synergy totals inside the pack renderer:** UI-SPEC §5 Section 4 explicitly forbids
  summing per-initiative rows a second time to recompute the headline numbers — always read
  `GET /api/synergies/rollup`'s own (server-internal call, not an HTTP round-trip) output. A second
  summation from possibly-differently-rounded per-item values can silently drift from the rollup's
  total (RPT-03's "avoiding double-counting" is precisely this risk).
- **Relying on `ctx.font = '...px sans-serif'` for any pack text:** verified this session that this
  silently renders CJK codepoints as empty tofu boxes with zero error — it will pass every
  automated test that doesn't specifically screenshot Chinese output. See Pitfall 1.
- **Building the pack as a single, un-paginated draw pass:** UI-SPEC §5 requires column headers to
  repeat on continuation pages and a `Page N of M` footer, which needs total page count known before
  page 1's footer is finalized — a naive single-pass streaming writer cannot satisfy this (UI-SPEC
  flags this explicitly as "infeasible with a naive single-pass streaming writer").

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RAID clearance filtering | A second, export-specific area-grant check | `resolveRaidEntryClearanceArea()` + `accessPolicy.hasAreaGrant()` (`server.js:3890-3916`, `db/accessPolicy.js`) | D-08's whole guarantee is that export payload = live GET payload for that caller; a second implementation can silently diverge (exactly the class of bug T-06-45/WR-03 already had to fix once for RAID provenance) |
| PDF vector font embedding (CID-keyed Type0 fonts, glyph subsetting, custom encodings) | A hand-rolled font-embedding subsystem to support DE/CS/ZH text as real PDF text objects | Full-page raster via `@napi-rs/canvas` (already vendored) — see Architecture Patterns, Pattern 3 | Font embedding correct enough for four languages including CJK is a multi-week subsystem on its own (this is what libraries like `fontkit`/`pdfkit` exist to solve, and even they need a CJK font file supplied); the phase's actual requirement is a readable, printable document, not selectable PDF text |
| Audit event writing | A second audit-log table or file for export events | `db/auditHook.js`'s `recordSecurityEvent()` (`db/auditHook.js:126-141`), the exact call shape Phase 6's flight-risk read audit uses (`server.js:4507-4522`) | AUD-02's "audit log survives deletion of the deal it describes" guarantee only holds for the one append-only `audit.db`; a parallel log would not inherit that guarantee |
| Content-Disposition header construction | Naive string interpolation (`` `attachment; filename="${codename}-x.csv"` ``) | A small `buildContentDisposition(filename)` helper implementing RFC 6266 quoted-string + RFC 5987 `filename*` — see Code Examples | Verified this session: Node's `res.setHeader` throws `TypeError: Invalid character in header content` on a raw CRLF in the value — a deal codename containing an embedded newline (schema-legal today, see Pitfall 2) would 500 the whole export unless sanitized first |
| CSV escaping rules | A `join(',')` string builder | RFC 4180 quoting: wrap any field containing a comma, quote, or newline in `"`, doubling internal `"` | A synergy title or RAID entry title is free text and can legally contain commas/quotes; unescaped CSV corrupts column alignment silently (no error, wrong data — the worst failure mode for a "trustworthy status output" deliverable) |

**Key insight:** every "don't hand-roll" item above except the PDF byte structure itself already has
a correct, tested implementation living in this codebase or Node's standard library — the discipline
this phase requires is **reuse, not re-derivation**, exactly as D-02 and D-08 both state explicitly.
The one thing this research DOES recommend hand-rolling — the PDF container format — is recommended
specifically because it is the one place where reuse is not available without adding real dependency
weight (pdfkit's 6 transitive deps) for a benefit (selectable text) this phase does not need, while
the actually-hard part (font/glyph coverage) is delegated to the already-vendored canvas, not
reimplemented.

## Common Pitfalls

### Pitfall 1: Default font resolution silently drops CJK glyphs (no error thrown)

**What goes wrong:** `ctx.font = '10px sans-serif'` (or any generic family name) renders Chinese
text as empty tofu boxes on this codebase's own dev machine — verified live in this session with a
byte-for-byte PNG comparison (`你好世界` rendered as four empty boxes with the default font; the
identical string rendered correctly once `ctx.font` named an explicit CJK-capable family,
`"Songti SC"`). No exception, no warning, no `null` return — the glyphs are simply blank.
**Why it happens:** Skia's generic font-family resolution does not automatically fall back to a
CJK-covering font for CJK codepoints the way a browser's font-matching stack does; it needs an
explicit family name that actually has those glyphs.
**How to avoid:** Register one vendored font that covers Latin + Latin Extended-A (Czech) + CJK
(Chinese) via `GlobalFonts.registerFromPath()` at server startup, and set `ctx.font` to that
registered family name for **every** string drawn in the pack renderer, regardless of active
language — never leave it to the codepoints "just working" with a generic name.
**Warning signs:** A PDF pack generated for a ZH-language deal that renders correctly for a
manual/EN reviewer (who never notices, because EN text renders fine with any font) but produces a
document with visibly blank labels for a real Chinese-language deal team — the kind of bug that
only a live-walk check (not a snapshot test comparing string equality) can catch, since the
underlying data and API response are perfectly correct; only the rendered pixels are wrong.

### Pitfall 2: A deal codename can legally contain characters that break naive filename headers

**What goes wrong:** `deal.name` (the codename used in every export/pack filename and the
confidentiality footer, per D-07/D-09's explicit "never `targetCompany`" rule) is validated only by
`z.string().trim().min(1).max(200)` (`[VERIFIED: validators/deals.js:52,27 — session Read]`) — no
character-class restriction. `.trim()` only strips leading/trailing whitespace, not internal control
characters. Verified live in this session: `res.setHeader('Content-Disposition', 'attachment;
filename="evil\r\nSet-Cookie: x=1"')` throws `TypeError: Invalid character in header content` inside
Express/Node — meaning a codename containing an embedded CR/LF does not become a header-injection
vector (Node's own header-value validator blocks it), but it **does** crash the whole export request
with an uncaught exception if the route doesn't defend against it first.
**Why it happens:** the codename field has never before been placed into an HTTP header — every
prior consumer (deal-switcher pill, pack header band per UI-SPEC §5) renders it via `textContent`/
canvas `fillText`, neither of which cares about CR/LF. Exports are the first consumer that puts this
MNPI free-text field into a place with syntax rules.
**How to avoid:** Build filenames and the `Content-Disposition` value through one shared helper that
strips/replaces C0 control characters (and, defensively, Unicode bidi override characters like
U+202E, which can visually disguise a file's real extension in a filesystem viewer) from the
codename before building either the ASCII `filename="..."` fallback or the RFC 5987
`filename*=UTF-8''...` parameter, and wrap the whole `res.setHeader` call in a try/catch that falls
back to a generic filename rather than 500ing the request.
**Warning signs:** An export test suite that only exercises a "normal-looking" test-fixture deal
name will never catch this — it needs an explicit test case with an embedded newline/control
character in the deal name (see Validation Architecture below).

### Pitfall 3: `grossRealizedM`'s meaning is ambiguous between D-01's literal text and D-02's phrasing

**What goes wrong:** D-01 says "`grossRealizedM` in the steerco pack counts only phased-backed
amounts" (implying the field itself changes meaning), while D-02 says the split is "new fields
**alongside** the existing `grossRealizedM`/`unconfirmedRealizedM` family" (implying `grossRealizedM`
keeps its current, unchanged meaning and new fields are added next to it). These two readings
produce different rollup response shapes.
**Why it happens:** the decision text was written to describe user-visible intent (the pack's "Gross
realized" tile should show phased-only money), not the exact API field name that intent binds to.
**How to avoid — concrete recommendation, verified against the actual codebase's only consumer:**
`[VERIFIED: public/js/execution.js:652,657 — session Read]` shows `grossRealizedM` and
`unconfirmedRealizedM` have exactly **one** client consumer today (`renderSynRollup()`), and
`[VERIFIED: grep across public/js/*.js and server.js — session command]` found no other reader of
either field anywhere in the codebase (not in `dashboard.js`, not in any deal-home nudge). Because
there is no other consumer to protect, it is safe to literally implement D-01: redefine
`grossRealizedM` to sum only items with `Array.isArray(item.phasing) && item.phasing.length > 0`
(the exact "has phasing rows" predicate already used by `synergyRollupFields()`,
`[VERIFIED: server.js — synergyRollupFields function, session Read: "if (!Array.isArray(item.phasing)
|| item.phasing.length === 0) { return { targetM: item.targetM || 0, realizedM: item.realizedM || 0
}; }"]`), and add one new field, e.g. `unphasedRealizedM`, summing the complementary set. The
invariant `phasedGrossRealizedM(=grossRealizedM) + unphasedRealizedM === (old, undifferentiated
total)` should be asserted by a test. **This is flagged for a quick plan-time confirmation, not left
silently resolved**, because D-01 itself calls this exact change "costly" reversibility ("changing
what 'gross' means after packs have circulated re-baselines every prior report") — the planner
should state the field-shape decision explicitly in the plan rather than let an executor pick either
reading ad hoc.
**Warning signs:** if a future consumer of `grossRealizedM` is added elsewhere in the codebase before
this plan lands, this pitfall's "safe because zero other consumers" premise breaks — re-grep before
implementing.

### Pitfall 4: `recordSecurityEvent()` cannot cheaply set a correct `dbKind` for export events

**What goes wrong:** `db/auditHook.js`'s `recordSecurityEvent({actor, action, dealId, subject,
before, after, request})` hardcodes the literal string `'control'` as the `dbKind` column value for
**every** caller — `[VERIFIED: db/auditHook.js — session Read: "conn.prepare(INSERT_SQL).run(...,
dealId || null, 'control', action, ...)"]`. There is no `dbKind` parameter in the function signature
at all to override this.
**Why it happens:** this is the exact, already-documented residual from 06-SECURITY.md (Phase 6's
flight-risk read audit hit the identical limitation, `[CITED: .planning/phases/06-org-design-talent-
retention/06-SECURITY.md]`) — fixing it means changing the function's signature and every existing
call site, which is out of proportion for a labelling-only gap ("nothing filters or facets on that
column today").
**How to avoid:** do not attempt a local per-call-site workaround (e.g., writing directly to the
audit connection bypassing `recordSecurityEvent()`) — that would violate `db/controlStore.js`'s
"zero-reference-to-audit.db" isolation precedent this codebase already established. Accept the same
residual Phase 6 accepted: export/pack audit rows will read `db_kind: 'control'` even though they
describe a deal-scoped event. Document it as an accepted residual in this phase's own SECURITY.md,
matching precedent, rather than re-opening the fix here.
**Warning signs:** none in practice today (no code reads or filters on `db_kind`); revisit only if a
future phase adds a `db_kind`-based query to the admin audit viewer.

### Pitfall 5: Page footer needs total page count before page 1 can be finalized

**What goes wrong:** D-07's every-page footer requires "Page N of M" — but `M` (total pages) is only
known after every section (workstreams/tasks table, RAID table, synergies table) has been laid out
and paginated, which happens **after** page 1's exec summary is drawn. A naive single-pass writer
that emits page 1's PDF bytes (including its footer) before laying out later pages cannot know `M`
yet.
**Why it happens:** table row counts (hence pagination) are only known once the clearance-filtered
data for that section is loaded and measured against the page's content height.
**How to avoid:** do the layout pass in two phases — (1) measure/paginate every section into an
in-memory array of "page content descriptors" first (no PDF bytes written yet), (2) once total page
count `M` is known, render each page's canvas (now including its correct "Page N of M" footer) and
assemble the final PDF. UI-SPEC §5 already flags this explicitly as a generation-mechanism concern.
**Warning signs:** a footer that always reads "Page 1 of 1" regardless of actual page count is the
tell that a single-pass implementation shipped without the two-phase layout.

## Code Examples

### CSV writer — RFC 4180 quoting + Excel-compatible UTF-8 BOM

```javascript
// New module, e.g. lib/reportCsv.js — no library needed, the escaping rule is small and stable.
function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  // RFC 4180: quote any field containing a comma, double-quote, or line break;
  // double any internal double-quote.
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(rows, columns) {
  // columns: [{ key: 'title', header: 'Title' }, ...]
  const lines = [columns.map((c) => csvField(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => csvField(row[c.key])).join(','));
  }
  // CRLF row terminators (RFC 4180 canonical line ending, Excel-safe on all three platforms);
  // leading UTF-8 BOM so Excel opens accented/CJK codename-derived content as UTF-8, not
  // mis-detected as the system codepage (a documented Excel quirk for CSVs with no BOM).
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv, csvField };
```

An empty dataset still produces a valid, headers-only file (Copywriting Contract's locked empty-state
behavior): `toCsv([], columns)` naturally returns just the BOM + header row + trailing CRLF — no
special-case branch needed.

### Safe filename + Content-Disposition builder (closes Pitfall 2)

```javascript
// New helper, e.g. lib/reportFilename.js
const CONTROL_OR_BIDI_CHARS = /[\x00-\x1F\x7F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function sanitizeForFilename(raw) {
  // Strips C0 controls (incl. CR/LF, which Node's own header-value validator would otherwise
  // throw on) and Unicode bidi-override characters (defence against a codename that could
  // otherwise visually disguise the file's real extension in a filesystem viewer).
  return String(raw || '').replace(CONTROL_OR_BIDI_CHARS, '').trim() || 'deal';
}

function buildReportFilename(codename, dataset, ext) {
  const safeCodename = sanitizeForFilename(codename).replace(/[\\/:*?"<>|]/g, '-'); // OS-reserved chars
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${safeCodename}-${dataset}-${date}.${ext}`;
}

function setContentDisposition(res, filename) {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename);
  try {
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`);
  } catch (e) {
    // Defence-in-depth: sanitizeForFilename() above should make this unreachable, but a
    // 500 from a header-encoding edge case must never leak a raw exception to the export
    // response — verified this session that an unescaped CR/LF DOES throw here.
    console.error('[security] Content-Disposition header rejected, falling back:', e.message);
    res.setHeader('Content-Disposition', 'attachment; filename="report.dat"');
  }
}
```

`filename*=UTF-8''...` is the RFC 5987/6266 extended-parameter syntax browsers use to render a
correctly-Unicode-decoded filename (important since a codename can legitimately contain `中文` or
`Müller`-style diacritics); the plain `filename="..."` fallback (ASCII-only, non-ASCII bytes
replaced with `_`) is what older/non-compliant clients fall back to per the RFC's own dual-parameter
pattern.

### i18n resolve-with-fallback for the pack (mirrors `transitions.js`'s client-side `t()` exactly)

```javascript
// Verified against public/js/transitions.js's actual t(key, lang) implementation
// (session Read, "APP-WIDE i18n ENGINE" block): (s[lang] && s[lang][key]) || (s.en && s.en[key]) || null
function resolvePackLang(req) {
  // The active language lives ONLY in the browser's localStorage (LANG_KEY = 'employeeLanguage',
  // verified this session — no server-side session concept of language exists anywhere in this
  // codebase today). The pack request MUST carry it explicitly as a query param.
  const requested = String(req.query.lang || '').trim();
  return ['en', 'de', 'zh', 'cs'].includes(requested) ? requested : 'en';
}

function packT(db, lang, key, fallbackText) {
  const strings = (db.i18n && db.i18n.strings) || {};
  return (strings[lang] && strings[lang][key])
    || (strings.en && strings.en[key])
    || fallbackText || key;
}
```

The client-side call site (execution.js's Reports tab wiring) must pass the ALREADY-known
`localStorage.getItem('employeeLanguage')` value as `?lang=` on the pack `fetch()` call — there is
no other way for the server to learn it.

### Minimal PDF 1.4 container (structure sketch — the part with no existing precedent to cite)

```javascript
// New module, e.g. lib/reportPdf.js. Builds the smallest valid PDF wrapping N full-page raster
// images. Every API called on `pages[i]` here (width/height/deflated Buffer) comes from
// Architecture Patterns Pattern 3's renderPageToRgbStream(), verified working this session.
function buildPdf(pages) {
  const objects = []; // 1-indexed PDF object bodies, built up as strings/Buffers
  const offsets = [];
  let body = Buffer.alloc(0);
  const header = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary'); // binary marker comment

  function pushObject(buf) {
    offsets.push(header.length + body.length);
    body = Buffer.concat([body, buf]);
  }

  // Object 1: Catalog: Object 2: Pages tree (filled in once page object numbers are known)
  const pageObjNums = [];
  const imageObjNums = [];
  const contentObjNums = [];

  pages.forEach((page, i) => {
    // Image XObject: raw deflated RGB, no PNG/JPEG re-encoding needed.
    const imgObjNum = 3 + i * 3;
    pushObject(Buffer.concat([
      Buffer.from(`${imgObjNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} `
        + `/Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode `
        + `/Length ${page.deflated.length} >>\nstream\n`, 'binary'),
      page.deflated,
      Buffer.from('\nendstream\nendobj\n', 'binary'),
    ]));
    imageObjNums.push(imgObjNum);

    // Content stream: place the image to fill the page (in PDF pt units, /Length in bytes).
    const cssW = page.width / 2, cssH = page.height / 2; // 2x render scale -> pt-equivalent page size
    const content = `q ${cssW} 0 0 ${cssH} 0 0 cm /Im${i} Do Q`;
    const contentObjNum = imgObjNum + 1;
    pushObject(Buffer.from(
      `${contentObjNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
      'binary'
    ));
    contentObjNums.push(contentObjNum);

    // Page object referencing both.
    const pageObjNum = contentObjNum + 1;
    pushObject(Buffer.from(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${cssW} ${cssH}] `
      + `/Resources << /XObject << /Im${i} ${imgObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`,
      'binary'
    ));
    pageObjNums.push(pageObjNum);
  });

  // Object 1 (Catalog) and Object 2 (Pages tree) are written LAST in byte order here for clarity,
  // but every xref entry below still points at the correct byte offset regardless of write order.
  offsets[0] = header.length + body.length; // placeholder pattern — real impl computes these inline
  // ... (Catalog/Pages/xref-table/trailer assembly omitted for brevity; the pattern is: every
  // indirect object gets one `xref` line `%010d 00000 n \n` pointing at its byte offset in `body`,
  // the trailer names object 1 as /Root, and the file ends with `startxref\n<offset>\n%%EOF`.)

  return Buffer.concat([header, body /*, xref table + trailer */]);
}

module.exports = { buildPdf };
```

This sketch intentionally omits the full xref-table/trailer byte-counting boilerplate (mechanical,
well-documented in the public PDF 1.4 spec, not something this research needs to re-derive) — the
load-bearing, previously-unverified parts (Image XObject with raw `/FlateDecode` `/DeviceRGB` data
sourced directly from `canvas.data()`, and the `cm`/`Do` content-stream operators to place it) are
exactly what this research verified is a real, working pattern against the actual vendored binary.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Manual steerco deck assembly (the process this phase replaces per CONTEXT.md's domain framing) | Server-generated, TE-branded PDF pack on demand | This phase (RPT-02) | The IL no longer copies numbers into a slide deck by hand; the pack is always generated from the live, clearance-filtered rollup, closing the risk of a stale/inconsistent manually-typed number |
| Assumed "canvas PDF export" capability (CLAUDE.md's stack doc line, called "aspirational" in CONTEXT.md's own `code_context`) | Confirmed: `@napi-rs/canvas` has no PDF surface at all (`[VERIFIED: index.d.ts, session Read]`) | Discovered this session | Any future stack documentation referencing "@napi-rs/canvas for PDF export" should be corrected to describe the actual mechanism (canvas rasterizes pages; a small hand-rolled module wraps them in PDF) once this phase ships |
| `@napi-rs/canvas` as a transitive, undeclared dependency | Promoted to a direct `package.json` dependency | This phase (recommended) | Removes a latent fragility where a future `pdf-parse` upgrade could drop the package silently, breaking PDF generation with no obvious cause |

**Deprecated/outdated:** none — this is new capability, not a migration of existing functionality.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A fresh Windows/Linux zero-install target has adequate default system-font coverage for Latin/DE/CS text even without the recommended vendored font (only verified live on macOS this session) | Standard Stack / Alternatives Considered | Low if the recommended font-vendoring path is followed (it makes this moot); if the planner skips vendoring to save time, DE/CS text could render blank on a bare-bones Linux host with zero registered fonts |
| A2 | A specific font file (e.g. Noto Sans SC Regular, OFL-1.1 licensed) is the right vendoring choice for CJK+Latin-Extended coverage — not downloaded or byte-verified this session (no binary font asset was fetched) | Package Legitimacy Audit | Low-medium: wrong font choice could mean missing a specific glyph or an unexpectedly large file size (Noto Sans CJK variants range from ~2MB subset to 16MB+ full); the planner/executor must pick and verify licensing before committing |
| A3 | `grossRealizedM` may be safely redefined in place (Pitfall 3's recommended resolution) because no consumer beyond `execution.js:652` exists today | Common Pitfalls / Pitfall 3 | Medium: if a not-yet-audited consumer is added between this research and plan execution, redefining the field silently changes that consumer's number too; re-grep immediately before implementing |
| A4 | The pack generation route should be implemented as `GET`, not `POST`, so it falls outside `ROLE_WRITE_POLICY` entirely and needs no new write-role rule (verified `isWrite = method !== GET/HEAD/OPTIONS`, `server.js:444`) | Architecture Patterns | Low: if implemented as POST instead, D-08's "any deal member can export" would require an explicit new `ROLE_WRITE_POLICY` entry allowing all four roles — not wrong, just an extra step the GET design avoids |
| A5 | Illustrative CSV/JSON column sets in UI-SPEC §2 are "non-binding" starting points, not a locked contract — column contracts are this research's/the planner's discretion per CONTEXT.md | Code Examples | Low: the planner has explicit latitude here; flagged only so it isn't mistaken for a locked spec |

## Open Questions

1. **Exact vendored font choice and file size budget**
   - What we know: the font must cover Latin (EN/DE), Latin Extended-A (CS), and CJK (ZH) in one
     family so the renderer never has to font-switch mid-string for mixed content (e.g. a codename
     with Latin characters rendered next to a ZH section header).
   - What's unclear: which specific Noto/Source-Han release, weight, and subsetting level balances
     glyph coverage against the zero-install bundle's size budget (this repository already commits
     `node_modules/` at ~150MB per CLAUDE.md; a multi-MB font is a smaller, but not free, addition).
   - Recommendation: the planning/execution stage should pick ONE static regular weight (no bold
     variant strictly required if the renderer synthesizes bold via `ctx.font = 'bold ...'`, which
     Skia can fake-bold from a single regular-weight source — verify this specific claim before
     relying on it) and measure the actual file size before committing it.

2. **Whether `synergyRollupFields()`'s "has phasing rows" predicate should also gate the pack's
   per-initiative table styling, not just the headline split**
   - What we know: D-01/D-02 lock the HEADLINE split; UI-SPEC §5 Section 4 shows per-initiative rows
     unconditionally (stale styling only, no separate phased/unphased visual treatment per row).
   - What's unclear: whether an unphased initiative's row in the per-initiative table should carry
     any visual marker distinguishing it from a phased one, beyond appearing in the headline's
     "Unphased" tile total.
   - Recommendation: UI-SPEC does not request a per-row marker — treat this as settled (no marker
     needed) unless the planner's checkpoint surfaces a reason to add one.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@napi-rs/canvas` (+ platform prebuild) | PDF pack rendering | ✓ | 0.1.80 (vendored) `[VERIFIED: node_modules — session Read]` | — |
| `zip` CLI utility | Not required by this phase (only the pre-existing admin download-zip feature needs it) | n/a | — | — |
| Vendored CJK+Latin-Extended font file | PDF pack text rendering across all 4 languages | ✗ (not yet added) | — | Until vendored, the pack renderer falls back to explicit system-font family names verified working THIS session on macOS only (`"Songti SC"` for ZH) — **not a safe cross-platform fallback**, see Assumption A1; blocking for correct ZH rendering on Windows/Linux release targets, non-blocking for the phase to build and test on the dev machine |
| Node's `zlib` module | PDF Image XObject compression | ✓ | Node core, no version constraint | — |

**Missing dependencies with no fallback:** none block starting implementation; the vendored font is
the one item that should land before the phase is considered release-ready for non-macOS platforms.

**Missing dependencies with fallback:** the vendored font (fallback = platform system fonts, verified
unreliable cross-platform per Assumption A1 — treat the "fallback" as a development-only convenience,
not a shipping strategy).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node's built-in `node:test` runner `[VERIFIED: package.json "test": "node --test", session Read]` |
| Config file | none — no `jest.config`/`vitest.config`; tests live flat under `test/*.test.js` |
| Quick run command | `node --test test/reports-export.test.js` (single new file, run directly — the codebase's own test-file header convention warns against `node --test test/` as a directory argument on this Node version, `[VERIFIED: test/raid-access-filter.test.js header comment, session Read]`) |
| Full suite command | `npm test` (561/561 passing baseline `[VERIFIED: npm test — session run, "# tests 561 / # pass 561 / # fail 0"]`) |
| Harness pattern to reuse | Boot the real `require('../server.js')` app against an isolated temp control/runtime/demo/deals/audit DB set via `MA_*_DB_PATH` env vars, exactly as `test/raid-access-filter.test.js` and `test/org-flight-risk-conversion.test.js` already do (`[VERIFIED: test/raid-access-filter.test.js lines 1-40, session Read]`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RPT-01 | CSV export of each dataset returns RFC4180-valid rows matching the live GET's clearance-filtered content | integration | `node --test test/reports-export.test.js -x` | ❌ Wave 0 |
| RPT-01 | JSON export shape is byte-identical field-for-field to the corresponding live `GET` route's enriched shape (D-08 parity) | integration | `node --test test/reports-export.test.js -x` | ❌ Wave 0 |
| RPT-01 | Four-identity clearance test on the RAID export specifically (admin/hrbp/area-cleared-member/uncleared-member), asserting SORTED ID ARRAYS not lengths — mirrors `test/raid-access-filter.test.js`'s own stated anti-over-filter discipline | integration | `node --test test/reports-export.test.js -x` | ❌ Wave 0 |
| RPT-01 | Headers-only file when a dataset is empty (Copywriting Contract's locked empty-state) | unit | `node --test test/reports-export.test.js -x` | ❌ Wave 0 |
| RPT-01 | A codename containing an embedded control character / CRLF does not 500 the export (closes Pitfall 2) | unit | `node --test test/reports-filename.test.js -x` | ❌ Wave 0 |
| RPT-02 | PDF pack generation returns a well-formed `application/pdf` response (byte-level: starts with `%PDF-1.4`, contains `%%EOF`) for a populated deal | integration | `node --test test/reports-pack.test.js -x` | ❌ Wave 0 |
| RPT-02 | PDF pack generation succeeds (does not throw/500) for an entirely empty deal, producing the Copywriting Contract's empty-state page content | integration | `node --test test/reports-pack.test.js -x` | ❌ Wave 0 |
| RPT-02 | Pack respects the SAME clearance filtering as the raw exports (an uncleared member's pack RAID section excludes the same rows the CSV export would) | integration | `node --test test/reports-pack.test.js -x` | ❌ Wave 0 |
| RPT-03 | D-01 split proven in BOTH directions: an item WITH phasing rows contributes to `grossRealizedM`/phased total and is EXCLUDED from `unphasedRealizedM`; an item WITHOUT phasing rows does the reverse — both assertions in the same test, not two independent one-directional tests | unit | `node --test test/synergy-rollup-split.test.js -x` | ❌ Wave 0 |
| RPT-03 | The pack's Synergies section recap numbers equal `GET /api/synergies/rollup`'s own numbers exactly (no independent re-summation) for a fixture with rounding-edge-case per-item values | integration | `node --test test/reports-pack.test.js -x` | ❌ Wave 0 |
| RPT-04 | Stale items render with `stale: true`/day-count in CSV, JSON, and are dimmed+tagged in the PDF (three renderings of one server flag, per UI-SPEC §4) | integration | `node --test test/reports-export.test.js -x` | ❌ Wave 0 |
| RPT-04 | `staleDays` setting change moves the boundary identically in the export and the pack (D-14 "one knob, screen and pack move together") | unit | `node --test test/reports-export.test.js -x` | ❌ Wave 0 |
| D-10/D-11 | Audit-delta test: exactly one `recordSecurityEvent` row per export/pack call for a real deal, ZERO rows for the identical call against demo (`req.isDemo`) | integration | `node --test test/reports-audit.test.js -x` | ❌ Wave 0 |
| D-09 | `GET /api/reports/export?dataset=positions` (or any org/talent variant) 404s/403s — never silently honored | integration | `node --test test/reports-export.test.js -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test test/reports-export.test.js test/reports-pack.test.js test/reports-audit.test.js test/synergy-rollup-split.test.js test/reports-filename.test.js`
- **Per wave merge:** `npm test` (full 561+ suite, must stay green — `[VERIFIED: baseline 561/561, session run]`)
- **Phase gate:** Full suite green before `/gsd-verify-work 7`, PLUS the UI-SPEC's two backstop items
  (375px/DE reflow on the Reports tab and export rows) as an explicit live-walk item — these are
  documented in UI-SPEC as unevidenced backstops that route to `human_needed` at verify time if not
  walked.

### Wave 0 Gaps

- [ ] `test/reports-export.test.js` — covers RPT-01, RPT-04 (partial), D-08, D-09
- [ ] `test/reports-pack.test.js` — covers RPT-02, RPT-03 (partial), D-08
- [ ] `test/reports-filename.test.js` — covers Pitfall 2 (filename/header injection defense)
- [ ] `test/synergy-rollup-split.test.js` — covers RPT-03/D-01/D-02/D-03 both-directions proof
- [ ] `test/reports-audit.test.js` — covers D-10/D-11 audit-delta assertions
- [ ] Live-walk checklist item: 375px/DE reflow on the new Reports & Exports tab (UI-SPEC backstop,
      not automatable — requires an actual browser render at the longest translation)
- [ ] Framework install: none — `node:test` is already the project's test runner, no new install

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no | Export/pack routes ride the existing AUTH-01 session gate unchanged; no new auth mechanism introduced |
| V3 Session Management | no | No new session concept; `req.portalUser`/`req.dealContext` are already resolved upstream |
| V4 Access Control | **yes** | Reuse `resolveRaidEntryClearanceArea()` + `accessPolicy.hasAreaGrant()`/`filterByAreaGrant()` (`db/accessPolicy.js`) — never a new, parallel authorization check for the export surface |
| V5 Input Validation | **yes** | `zod` schema for `?dataset=`/`?format=`/`?lang=` query params (whitelist enum, not free text) — matches every existing write route's VAL-01 discipline even though these are GET routes |
| V6 Cryptography | no | No new cryptographic operation; filenames/headers need sanitization (see V12-adjacent below), not encryption |
| V12 Files and Resources | **yes** (informal — ASVS 4.x folds this under V12/V13 depending on version) | Content-Disposition header construction (RFC 5987/6266), safe filename sanitization — see Common Pitfalls Pitfall 2 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Clearance bypass via a new read surface (export route re-implements or forgets a filter the live GET route has) | Elevation of Privilege / Information Disclosure | Reuse the identical lane-read + filter function the live GET route calls — see Architecture Patterns Pattern 1; enforced by a four-identity test per dataset |
| HTTP response header injection via user-controlled MNPI text (deal codename) in `Content-Disposition` | Tampering | Verified this session that Node's own header-value validator blocks raw CRLF (throws `TypeError`); still sanitize proactively (strip C0 controls + bidi overrides) rather than relying on the runtime to fail closed via an uncaught exception — see Common Pitfalls Pitfall 2 / Code Examples |
| MNPI leak via the wrong deal field in a filename or document footer (`targetCompany` instead of `deal.name`) | Information Disclosure | Locked by D-07/D-09 and UI-SPEC §2/§5 explicitly: always `deal.name` (codename), never `deal.targetCompany` (the real legal target name) |
| Audit-log gap for a new MNPI-egress surface (an export or pack silently ships with no audit trail) | Repudiation | D-10 mandates one `recordSecurityEvent` row per export/pack call for real deals; enforced by the audit-delta test in Validation Architecture above |
| CSV formula/DDE injection (a field starting with `=`, `+`, `-`, `@` interpreted as a formula by Excel when the CSV is opened) | Tampering (client-side, at the recipient's spreadsheet app) | Not explicitly named in CONTEXT.md's locked decisions — **flagged here as a real, common CSV-export risk this codebase has not previously had to consider** (no export existed before this phase). A synergy/RAID/task title is free text and could start with `=` (accidentally, e.g. "=IMPORTANT: review this risk"). Recommend prefixing any field that starts with `=+-@` with a single leading apostrophe or tab character before CSV-quoting, a standard mitigation (OWASP CSV Injection guidance) — this was not in the locked decisions and should be confirmed with the planner/user as an in-scope hardening addition, not silently added or silently skipped. |

## Sources

### Primary (HIGH confidence — verified this session against the actual repository/binary)

- `node_modules/@napi-rs/canvas/index.d.ts` — full API surface Read; confirmed no PDF export
  capability exists (only PNG/JPEG/WEBP/AVIF raster + SVG buffer output)
- `node_modules/@napi-rs/canvas/README.md` — confirmed `GlobalFonts.registerFromPath()`/`.families`
  API and font-registration usage pattern
- Live `node -e` scripts run against the actual vendored `@napi-rs/canvas@0.1.80` binary: system
  font enumeration (317 families on this macOS dev machine), CJK tofu-box failure with default
  `sans-serif`, correct CJK rendering with an explicit family name, correct Czech diacritic
  rendering with default `sans-serif`, and `canvas.data()`'s raw RGBA byte format
- `package.json`, `package-lock.json` — confirmed `@napi-rs/canvas` is a transitive dependency
  (via `pdf-parse`→`pdfjs-dist` optionalDependencies), not a direct one
- `npm view pdfkit version dependencies` / `npm view @napi-rs/canvas version` — session commands
  against the live npm registry
- Live Node/Express script proving `res.setHeader('Content-Disposition', ...)` throws on an
  embedded CRLF value (`TypeError: Invalid character in header content`)
- `server.js` (various line ranges cited inline: ~444 `isWrite`, ~703 `requestMeta`, ~1102-1120
  download-zip route, ~1872-1895 GET/POST `/api/i18n`, ~2908-3055 task/checklist-template lanes,
  ~3225-3420 synergy rollup/enrichment functions, ~3860-3920 RAID clearance resolution,
  ~4507-4522 flight-risk dual-audit call sites) — all Read directly this session
- `public/js/execution.js` (lines ~60-150 workstream rollup + i18n helper, ~640-665 rollup tile
  rendering, ~1050 hardcoded pane array) — Read directly this session
- `public/js/transitions.js` (lines ~3316-3396, the app-wide i18n engine including `LANG_KEY`,
  `getLang()`, `t()`'s fallback chain) — Read directly this session
- `db/auditHook.js` (lines ~100-141, `recordSecurityEvent()` and its hardcoded `'control'` dbKind)
  — Read directly this session
- `db/accessPolicy.js` — function export list (`grantedAreas`, `hasAreaGrant`, `filterByAreaGrant`,
  `assertAreaGrant`) confirmed via grep + partial Read
- `validators/deals.js` (line 52, `NAME_MAX = 200`) — Read directly this session
- `data/demo.db` — direct SQLite query confirming the exact i18n language codes (`en`/`de`/`zh`/`cs`)
  and storage shape (`app_state` table, key `'i18n'`, JSON blob matching `transitions.js`'s expected
  shape)
- `test/raid-access-filter.test.js` (header comment + harness boilerplate) — Read directly this
  session, establishing the four-identity test convention and harness pattern to reuse
- `npm test` full suite run — 561/561 passing, confirmed this session

### Secondary (MEDIUM confidence)

- `.planning/phases/06-org-design-talent-retention/06-SECURITY.md` — cited for the `dbKind`
  residual precedent (not re-Read in full this session, referenced per CONTEXT.md's own citation)
- OWASP CSV Injection guidance (formula-injection mitigation pattern) — general security knowledge,
  not verified against a specific document URL this session

### Tertiary (LOW confidence — flagged for validation)

- Windows/Linux default system-font coverage claims (Assumption A1) — asserted from general
  platform knowledge, not tested on an actual Windows or Linux machine this session
- Specific Noto Sans SC file size / license text — not downloaded or byte-inspected this session
  (Assumption A2)

## Metadata

**Confidence breakdown:**
- Standard stack (PDF mechanism decision): HIGH — the core "no PDF surface in canvas" finding and
  the CJK/font-selection behavior were both verified live against the actual vendored binary in this
  session, not inferred from documentation or training memory
- Architecture (export route reuse, server-side workstream rollup): HIGH — every reused function
  (`resolveRaidEntryClearanceArea`, `enrichSynergy`, `taskLane`) was Read directly in `server.js`
  this session, and the client-side workstream math it ports was Read directly in `execution.js`
- Pitfalls: HIGH for filename/header-injection and font-fallback pitfalls (both proven live this
  session); MEDIUM for the `grossRealizedM` semantics ambiguity (a reasoned recommendation given the
  verified absence of other consumers, but the decision text itself is genuinely ambiguous and
  needs a planner/user confirmation, not just this research's judgment call)
- Cross-platform font behavior: LOW-MEDIUM — verified thoroughly on macOS only; Windows/Linux
  behavior is asserted, not tested, which is exactly why this research recommends vendoring a font
  rather than trusting host-OS font inventory

**Research date:** 2026-08-08
**Valid until:** 30 days (stable, in-repo-verified findings) for the codebase-structural claims;
the npm registry version snapshots (`@napi-rs/canvas` latest = 1.0.3, `pdfkit` latest = 0.19.1)
should be re-checked if this research is consumed more than a few weeks after 2026-08-08.

