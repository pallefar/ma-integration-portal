// RPT-02/RPT-03 (07-05 Task 1): the steerco pack's page frame — the part that
// makes every subsequent section correct by construction.
//
// This module owns three things no section may own:
//   1. The TE-branded header band (D-05) and the every-page confidentiality
//      footer (D-07) — both are drawn by the PAGE FRAME (renderPageFrame
//      below), never by a section's own body callback. Sections only ever
//      produce a `{ render(ctx) }` descriptor; they cannot call the PDF page
//      renderer directly, so a section literally cannot render a page
//      without the frame's bands on it (T-07-23).
//   2. The two-pass paginator (paginateSections). Pass one measures every
//      registered section against the available content height and returns
//      page descriptors with NO pixels produced and NO PDF bytes written.
//      Only once every section has been measured is the total page count
//      known — THEN pass two (assemblePages/renderPageFrame) renders each
//      page with its correct "Page N of M" footer. A single-pass writer
//      would have to emit page one's footer before later sections were ever
//      measured, so its counter would always read "Page 1 of 1" — the
//      tell-tale of a single-pass implementation (07-RESEARCH.md Pitfall 5,
//      the same one lib/reportPdf.js's buildPdf() was built to make
//      impossible to bypass by accident).
//   3. The language resolver (resolveLanguage), mirroring the EXACT
//      fallback order `public/js/transitions.js`'s applyPortalI18n() uses
//      (requested language -> English -> caller-supplied English literal ->
//      the key itself) so the pack never renders a blank label a browser
//      viewer would have filled in.
//
// Model contract (buildPack(model) / buildPackFromSections(model, sections)):
// this module performs NO database access, NO clearance evaluation and NO
// HTTP work — the caller (the future export route, 07-06) must hand it an
// ALREADY-ASSEMBLED, ALREADY-CLEARANCE-FILTERED model:
//   {
//     deal: { name },            // the CODENAME. deal.targetCompany (the
//                                 // real legal target) must NEVER be read
//                                 // anywhere in this module (T-07-22) — it
//                                 // is a separate field precisely so it can
//                                 // be withheld before announcement.
//     language: 'en'|'de'|'zh'|'cs',
//     generatedAt: '<server-resolved, already-formatted string>',
//     generatedBy: '<server-resolved username>',
//     i18n: db.i18n,             // the SAME { strings: { en: {...}, ... } }
//                                 // store the app's own i18n engine reads.
//     rollup: { grossRealizedM, unphasedRealizedM, costIncurredM,
//               netBenefitM, dealTargetM, staleCount, ... },
//     workstreams: [ ...computeWorkstreamRollup(db) shape... ],
//     tasks: [ ...taskLane(db) shape... ],   // 07-06: no per-item clearance
//                                 // concept exists on tasks (07-02-PLAN.md),
//                                 // so every deal member's model carries the
//                                 // full lane, unfiltered.
//     raid: [ ...clearance-filtered, enriched RAID entries... ],
//     synergies: [ ...clearance-filtered, enriched synergies, each also
//                   carrying `stageAtBaseline` (07-06): the STAGE value from
//                   the item's own last baselines[] entry, resolved
//                   server-side — undefined/falsy when the initiative has no
//                   baseline history, which Section 4 renders as an em-dash.
//                   This module never reads item.baselines directly; the
//                   caller resolves the single value it needs. ],
//     staleThresholdDays: <number>,
//   }
// Timestamp and username are never re-derived here — they must already be
// the values the caller resolved server-side (never a client-supplied
// value), matching the audit event recorded for the same generation.
'use strict';

const path = require('path');
const { loadImage } = require('@napi-rs/canvas');
const { renderPageToRgbStream, buildPdf, REPORT_FONT_FAMILY } = require('./reportPdf');

// ---------------------------------------------------------------------------
// Page geometry (07-UI-SPEC.md §5) — declared once here, never scattered
// through drawing code. Values are CSS pixels at 96dpi; the pt-@-72dpi
// equivalent (what a hand-rolled PDF writer thinks in) is given in the
// comment beside each constant.
// ---------------------------------------------------------------------------
const PAGE_WIDTH_PX = 816; // 612pt — US Letter
const PAGE_HEIGHT_PX = 1056; // 792pt
const MARGIN_PX = 72; // 54pt — 0.75in uniform margin, all sides
const HEADER_HEIGHT_PX = 60; // 45pt
const FOOTER_HEIGHT_PX = 24; // 18pt

const CONTENT_LEFT_PX = MARGIN_PX;
const CONTENT_RIGHT_PX = PAGE_WIDTH_PX - MARGIN_PX;
const CONTENT_WIDTH_PX = CONTENT_RIGHT_PX - CONTENT_LEFT_PX; // 672px / 504pt

const HEADER_TOP_PX = MARGIN_PX;
const HEADER_BOTTOM_PX = HEADER_TOP_PX + HEADER_HEIGHT_PX;
const FOOTER_BOTTOM_PX = PAGE_HEIGHT_PX - MARGIN_PX;
const FOOTER_TOP_PX = FOOTER_BOTTOM_PX - FOOTER_HEIGHT_PX;

// A breathing gap between the header/footer bands and the section body.
// Not one of 07-UI-SPEC.md's binding geometry values (the spec fixes the
// bands themselves, not the gap beside them) — kept as a named constant
// here rather than inlined so it isn't confused with a spec-fixed value.
const BAND_GAP_PX = 12;
const CONTENT_TOP_PX = HEADER_BOTTOM_PX + BAND_GAP_PX;
const CONTENT_BOTTOM_PX = FOOTER_TOP_PX - BAND_GAP_PX;
const CONTENT_HEIGHT_PX = CONTENT_BOTTOM_PX - CONTENT_TOP_PX;

// ---------------------------------------------------------------------------
// Colour palette (07-UI-SPEC.md §Color) — ported values, not re-derived.
// ---------------------------------------------------------------------------
const COLOR_ORANGE = '#E98300';
const COLOR_DARK_TEAL = '#244C5A';
const COLOR_TEXT_DIM = '#94A3B8';
const COLOR_TEXT_PRIMARY = '#1E293B';
const COLOR_BORDER = '#E2E8F0';
const COLOR_DANGER = '#C0392B';
const COLOR_WHITE = '#FFFFFF';

// RAID severity palette — ported verbatim from `execution.html`'s
// `.raid-lvl` rules (low/medium/high) plus the Phase 6 critical addition,
// rendered here as plain coloured TEXT (no filled pill), matching the
// pack's density-first table styling (07-UI-SPEC.md §5).
const RAID_SEVERITY_COLOR = { low: '#3f7a37', medium: '#C77700', high: '#C0392B', critical: '#9C2A17' };
const RAID_SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

// RAG band colours — ported verbatim from `public/js/execution.js`'s
// ragColor() thresholds. The pack strip NEVER re-derives these from a raw
// percentage; it only maps the band name the caller's workstream rollup
// already computed (`ragStatus: 'green'|'amber'|'red'`) onto its hex value.
const RAG_BAND_COLOR = { green: '#3f7a37', amber: '#C77700', red: '#C0392B' };

const LOGO_PATH = path.join(__dirname, '..', 'public', 'te-logo.png');

// The four languages the app itself ships translations for (`admin-cms.js`'s
// LANGS list). Anything else falls back to English rather than guessing.
const SUPPORTED_LANGUAGES = ['en', 'de', 'zh', 'cs'];

/**
 * Returns a `t(key, englishFallback)` lookup function for `requestedLang`,
 * resolving through `i18nStore` (the app's own `db.i18n` shape:
 * `{ strings: { en: {...}, de: {...}, ... } }`) in EXACTLY the order
 * `public/js/transitions.js`'s applyPortalI18n() uses on screen: requested
 * language -> English entry -> caller-supplied English literal -> the key
 * itself. The active language exists only in the browser, so the caller
 * must pass it explicitly here — this resolver never guesses one.
 * @param {{strings?: Record<string, Record<string,string>>}} i18nStore
 * @param {string} requestedLang
 * @returns {(key: string, englishFallback?: string) => string}
 */
function resolveLanguage(i18nStore, requestedLang) {
  const lang = SUPPORTED_LANGUAGES.includes(requestedLang) ? requestedLang : 'en';
  const strings = (i18nStore && i18nStore.strings) || {};
  return function t(key, englishFallback) {
    const byLang = strings[lang] && strings[lang][key];
    if (byLang) return byLang;
    const byEn = strings.en && strings.en[key];
    if (byEn) return byEn;
    if (englishFallback) return englishFallback;
    return key;
  };
}

/** Builds a canvas `font` string, always naming the registered vendored
 * family — never a generic family name (the CJK-tofu pitfall). */
function font(px, weight) {
  return `${weight === 'bold' ? 'bold ' : ''}${px}px ${REPORT_FONT_FAMILY}`;
}

// ---------------------------------------------------------------------------
// Header / footer bands — the D-05/D-07 chrome no section may draw itself.
// ---------------------------------------------------------------------------

/**
 * Draws the every-page TE-branded header band: the logo on the left, and a
 * right-aligned two-line block (codename bold above the generation date) on
 * the right, with the bottom accent rule in TE orange.
 *
 * Reads ONLY `model.deal.name` (the codename). `model.deal.targetCompany`
 * (the real legal target) is never referenced anywhere in this function —
 * T-07-22's mitigation is structural: the field simply never appears in
 * this file's source.
 * @param {*} ctx
 * @param {*} model
 * @param {(key: string, englishFallback?: string) => string} t
 * @param {*} [logo] an already-loaded @napi-rs/canvas Image, or falsy to
 *   skip the logo draw (used by tests that don't load a real image).
 */
function drawHeaderBand(ctx, model, t, logo) {
  const deal = (model && model.deal) || {};
  const codename = String(deal.name || '');

  ctx.save();
  if (logo && logo.width && logo.height) {
    const logoHeight = 28;
    const logoWidth = logoHeight * (logo.width / logo.height);
    const logoY = HEADER_TOP_PX + (HEADER_HEIGHT_PX - logoHeight) / 2;
    ctx.drawImage(logo, CONTENT_LEFT_PX, logoY, logoWidth, logoHeight);
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(12, 'bold');
  ctx.fillStyle = COLOR_DARK_TEAL;
  ctx.fillText(codename, CONTENT_RIGHT_PX, HEADER_TOP_PX + HEADER_HEIGHT_PX / 2 - 2);

  ctx.font = font(8, 'normal');
  ctx.fillStyle = COLOR_TEXT_DIM;
  ctx.fillText(String(model.generatedAt || ''), CONTENT_RIGHT_PX, HEADER_TOP_PX + HEADER_HEIGHT_PX / 2 + 12);

  // D-05: the document-scale echo of the app's own `.main-header` accent
  // underline.
  ctx.fillStyle = COLOR_ORANGE;
  ctx.fillRect(CONTENT_LEFT_PX, HEADER_BOTTOM_PX - 2, CONTENT_WIDTH_PX, 2);
  ctx.restore();
}

/**
 * Draws the every-page confidentiality footer (D-07, mandatory, no
 * exceptions): a hairline separator, the centred confidentiality line
 * (codename + timestamp + username), and the right-aligned "Page N of M"
 * counter. Reads ONLY `model.deal.name` — never `model.deal.targetCompany`
 * (T-07-22). Timestamp and username are read verbatim from the values the
 * caller resolved server-side; this function never derives or reformats
 * them.
 * @param {*} ctx
 * @param {*} model
 * @param {number} pageNumber
 * @param {number} pageCount
 */
function drawFooterBand(ctx, model, pageNumber, pageCount) {
  const deal = (model && model.deal) || {};
  const codename = String(deal.name || '');

  ctx.save();
  ctx.strokeStyle = COLOR_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CONTENT_LEFT_PX, FOOTER_TOP_PX);
  ctx.lineTo(CONTENT_RIGHT_PX, FOOTER_TOP_PX);
  ctx.stroke();

  const textY = FOOTER_TOP_PX + FOOTER_HEIGHT_PX / 2 + 3;
  ctx.font = font(8, 'normal');
  ctx.fillStyle = COLOR_TEXT_DIM;

  const line =
    `CONFIDENTIAL — ${codename} · generated ${String(model.generatedAt || '')} · by ${String(model.generatedBy || '')}`;
  ctx.textAlign = 'center';
  ctx.fillText(line, CONTENT_LEFT_PX + CONTENT_WIDTH_PX / 2, textY);

  ctx.textAlign = 'right';
  ctx.fillText(`Page ${pageNumber} of ${pageCount}`, CONTENT_RIGHT_PX, textY);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Two-pass paginator.
// ---------------------------------------------------------------------------

/**
 * PASS ONE. Runs every registered section composer against the available
 * content box and concatenates their page descriptors, in order. Produces
 * NO pixels and writes NO PDF bytes — this is precisely what makes the
 * total page count knowable before any footer is drawn (see module header
 * comment). Each section composer has the signature
 * `(model, t, contentWidth, contentHeight) => Array<{ render(ctx) }>`.
 * @param {*} model
 * @param {(key: string, englishFallback?: string) => string} t
 * @param {Array<Function>} sections
 * @returns {Array<{render: Function}>}
 */
function paginateSections(model, t, sections) {
  const descriptors = [];
  (sections || []).forEach((sectionFn) => {
    const pages = sectionFn(model, t, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX) || [];
    pages.forEach((page) => descriptors.push(page));
  });
  return descriptors;
}

/**
 * PASS TWO (one page). Renders a single page descriptor through the page
 * frame: header band, then the descriptor's own body callback clipped to
 * the content column between the bands, then the footer band with the now-
 * known page number and total. Sections never call this directly — they
 * only ever produce the `render(ctx)` callback a descriptor carries, which
 * is what makes it structurally impossible for a section to ship a page
 * with no confidentiality mark (T-07-23).
 * @param {{render: Function}} descriptor
 * @param {number} pageNumber
 * @param {number} pageCount
 * @param {*} model
 * @param {(key: string, englishFallback?: string) => string} t
 * @param {*} logo
 * @returns {{width: number, height: number, deflated: Buffer}}
 */
function renderPageFrame(descriptor, pageNumber, pageCount, model, t, logo) {
  return renderPageToRgbStream((ctx) => {
    drawHeaderBand(ctx, model, t, logo);
    ctx.save();
    ctx.beginPath();
    ctx.rect(CONTENT_LEFT_PX, CONTENT_TOP_PX, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    ctx.clip();
    descriptor.render(ctx, { pageNumber, pageCount });
    ctx.restore();
    drawFooterBand(ctx, model, pageNumber, pageCount);
  }, PAGE_WIDTH_PX, PAGE_HEIGHT_PX);
}

// Loaded once, lazily, and cached — mirroring lib/reportPdf.js's
// once-at-load font registration pattern, except the logo is loaded on
// first use rather than at module require time (loadImage is async; the
// module itself has no top-level await).
let logoImagePromise = null;
function loadLogoImage() {
  if (!logoImagePromise) {
    logoImagePromise = loadImage(LOGO_PATH).catch((err) => {
      console.error(`[security] lib/reportPack.js failed to load the TE logo from ${LOGO_PATH}: ${err.message}`);
      throw err;
    });
  }
  return logoImagePromise;
}

/**
 * Runs both passes over `sections` and returns the fully-rendered page
 * array `buildPdf` expects. Exists as its own function (rather than being
 * inlined into buildPack) so tests can exercise the frame/paginator against
 * a throwaway section list without depending on whichever sections are
 * registered as the pack's real default composition.
 * @param {*} model
 * @param {Array<Function>} sections
 * @returns {Promise<Array<{width:number,height:number,deflated:Buffer}>>}
 */
async function assemblePages(model, sections) {
  if (!model || typeof model !== 'object') {
    throw new TypeError('assemblePages requires a model object');
  }
  const logo = await loadLogoImage();
  const t = resolveLanguage(model.i18n, model.language);
  const descriptors = paginateSections(model, t, sections);
  if (!descriptors.length) {
    throw new Error('assemblePages: the registered sections produced zero page descriptors');
  }
  const pageCount = descriptors.length;
  return descriptors.map((descriptor, i) => renderPageFrame(descriptor, i + 1, pageCount, model, t, logo));
}

// ---------------------------------------------------------------------------
// Page 1 — the executive summary (D-04). Always a single page: five
// headline stat tiles (D-01's phased/unphased split as separate tiles), the
// RAG workstream strip, the top risks, and the stale-count sentence.
// ---------------------------------------------------------------------------

/**
 * Page one. Every one of the five headline numbers is read directly from
 * `model.rollup` — this function NEVER sums `model.synergies` to derive any
 * of them. A second summation, in a second code path, over per-item values
 * that were already rounded once by the caller, is exactly the drift
 * RPT-03's avoid-double-counting requirement names and exactly what D-02's
 * one-source-of-truth rule exists to prevent. If you are tempted to add
 * `model.synergies.reduce(...)` anywhere in this function: don't — read the
 * rollup field instead.
 */
function execSummarySection(model, t, contentWidth) {
  const rollup = (model && model.rollup) || {};
  const gross = rollup.grossRealizedM || 0;
  const unphased = rollup.unphasedRealizedM || 0;
  const cost = rollup.costIncurredM || 0;
  const net = rollup.netBenefitM != null ? rollup.netBenefitM : gross - cost;
  const target = rollup.dealTargetM || 0;
  const staleCount = rollup.staleCount || 0;

  const workstreams = Array.isArray(model.workstreams) ? model.workstreams : [];
  const raid = Array.isArray(model.raid) ? model.raid : [];
  const synergies = Array.isArray(model.synergies) ? model.synergies : [];
  const staleThresholdDays = model.staleThresholdDays || 0;

  const topRisks = raid
    .filter((r) => r && r.type === 'risk')
    .slice()
    .sort((a, b) => RAID_SEVERITY_ORDER.indexOf(a.severity) - RAID_SEVERITY_ORDER.indexOf(b.severity))
    .slice(0, 5);

  return [
    {
      render(ctx) {
        let y = CONTENT_TOP_PX;

        // --- Headline stat row (D-01/D-02/RPT-03 — see function comment).
        const tileWidth = contentWidth / 5;
        const tiles = [
          [t('rpt.pack_tile_gross', 'Gross realized'), gross, COLOR_DARK_TEAL],
          [t('rpt.pack_tile_unphased', 'Unphased'), unphased, COLOR_DARK_TEAL],
          [t('rpt.pack_tile_cost', 'Cost incurred'), cost, COLOR_DARK_TEAL],
          [t('rpt.pack_tile_net', 'Net benefit'), net, net < 0 ? COLOR_DANGER : COLOR_DARK_TEAL],
          [t('rpt.pack_tile_target', 'Deal target'), target, COLOR_DARK_TEAL],
        ];
        ctx.textAlign = 'left';
        tiles.forEach(([label, value, color], i) => {
          const tx = CONTENT_LEFT_PX + i * tileWidth;
          ctx.font = font(10, 'bold');
          ctx.fillStyle = COLOR_TEXT_DIM;
          ctx.fillText(String(label).toUpperCase(), tx, y + 10);
          ctx.font = font(20, 'bold');
          ctx.fillStyle = color;
          ctx.fillText(`$${value.toFixed(1)}M`, tx, y + 34);
        });
        y += 56;

        // --- RAG workstream strip: colours are the band the caller's
        // workstream rollup already computed (`ragStatus`) — never
        // re-derived from a raw percentage here. Chip widths are measured
        // per-label via ctx.measureText, never a width assumed from the
        // English string (07-UI-SPEC.md §Internationalisation).
        ctx.font = font(10, 'normal');
        if (workstreams.length) {
          let x = CONTENT_LEFT_PX;
          const chipY = y;
          const chipHeight = 20;
          workstreams.forEach((w) => {
            const label = String((w && w.label) || '');
            const color = RAG_BAND_COLOR[w && w.ragStatus] || RAG_BAND_COLOR.red;
            const textWidth = ctx.measureText(label).width;
            const chipWidth = textWidth + 16;
            ctx.fillStyle = color;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(x, chipY, chipWidth, chipHeight, 12);
            } else {
              ctx.rect(x, chipY, chipWidth, chipHeight);
            }
            ctx.fill();
            ctx.fillStyle = COLOR_WHITE;
            ctx.textAlign = 'left';
            ctx.fillText(label, x + 8, chipY + 14);
            x += chipWidth + 8;
          });
          y += chipHeight + 16;
        } else {
          ctx.fillStyle = COLOR_TEXT_DIM;
          ctx.textAlign = 'left';
          ctx.fillText(t('rpt.pack_no_workstreams', 'No workstreams yet.'), CONTENT_LEFT_PX, y + 10);
          y += 26;
        }

        // --- Top risks: highest severity first, title + severity as
        // coloured text (no filled pill — density-first table styling).
        ctx.font = font(12, 'bold');
        ctx.fillStyle = COLOR_DARK_TEAL;
        ctx.textAlign = 'left';
        ctx.fillText(t('rpt.pack_top_risks', 'Top risks'), CONTENT_LEFT_PX, y + 10);
        y += 20;
        if (topRisks.length) {
          topRisks.forEach((risk) => {
            ctx.font = font(10, 'normal');
            ctx.fillStyle = COLOR_TEXT_PRIMARY;
            ctx.textAlign = 'left';
            ctx.fillText(String(risk.title || ''), CONTENT_LEFT_PX, y + 10);
            ctx.font = font(10, 'bold');
            ctx.fillStyle = RAID_SEVERITY_COLOR[risk.severity] || RAID_SEVERITY_COLOR.medium;
            ctx.textAlign = 'right';
            ctx.fillText(String(risk.severity || '').toUpperCase(), CONTENT_LEFT_PX + contentWidth, y + 10);
            y += 16;
          });
        } else {
          ctx.font = font(10, 'normal');
          ctx.fillStyle = COLOR_TEXT_DIM;
          ctx.textAlign = 'left';
          ctx.fillText(t('rpt.pack_no_risks', 'No risks recorded yet.'), CONTENT_LEFT_PX, y + 10);
          y += 16;
        }
        y += 12;

        // --- Stale-count sentence: both numbers come from the caller's
        // rollup and the supplied collection length — never recounted
        // independently here (D-02/D-12).
        const template = t(
          'rpt.pack_stale_sentence',
          '{staleCount} of {total} synergy initiatives are stale (unconfirmed for more than {staleDays} days).'
        );
        const sentence = template
          .replace('{staleCount}', String(staleCount))
          .replace('{total}', String(synergies.length))
          .replace('{staleDays}', String(staleThresholdDays));
        ctx.font = font(10, 'normal');
        ctx.fillStyle = COLOR_TEXT_PRIMARY;
        ctx.textAlign = 'left';
        ctx.fillText(sentence, CONTENT_LEFT_PX, y + 10);
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Shared table-pagination plumbing for Sections 2-4 (07-06). Each section's
// data may exceed a single page; the column-header row REPEATS at the top of
// every continuation page while the SECTION TITLE does not (07-UI-SPEC.md
// §5) — the footer's page counter is the only other signal that tells a
// reader "still Section X, page 2" apart from "a new section started". A
// page ceiling (T-07-33) bounds how many pages any one section may grow to;
// beyond it, the FINAL page's row budget is reduced by one line to make room
// for a plain truncation notice naming the remaining row count and pointing
// at the CSV export as the complete source (T-07-30: this notice is about
// VOLUME, never clearance — it is drawn identically no matter what the
// caller is or isn't cleared to see, and never worded as "N hidden/
// restricted entries").
// ---------------------------------------------------------------------------
const MAX_SECTION_PAGES = 4;
const SECTION_TITLE_HEIGHT_PX = 22;
const TABLE_HEADER_HEIGHT_PX = 18;
const TABLE_ROW_HEIGHT_PX = 16;
const EMPTY_STATE_HEIGHT_PX = 16;

/**
 * MEASURING-PASS helper (pure arithmetic — no ctx, no pixels): splits `rows`
 * into per-page chunks given how many rows fit on the first page vs every
 * later page. A section computes those row budgets itself from its own
 * fixed title/preamble/header heights, so this helper stays free of any
 * per-section pixel knowledge. Returns the chunk array plus how many
 * trailing rows were dropped to respect `maxPages`.
 * @returns {{chunks: Array<Array<*>>, truncatedCount: number}}
 */
function paginateRows(rows, firstPageBudget, contPageBudget, maxPages) {
  const list = Array.isArray(rows) ? rows : [];
  const firstBudget = Math.max(1, Math.floor(firstPageBudget));
  const contBudget = Math.max(1, Math.floor(contPageBudget));
  const capacity = firstBudget + Math.max(0, maxPages - 1) * contBudget;

  let usable = list;
  let truncatedCount = 0;
  if (list.length > capacity) {
    // Reserve exactly one row-slot (on whichever page ends up last) for the
    // truncation notice line.
    usable = list.slice(0, Math.max(0, capacity - 1));
    truncatedCount = list.length - usable.length;
  }

  const chunks = [usable.slice(0, firstBudget)];
  let idx = chunks[0].length;
  while (idx < usable.length) {
    const next = usable.slice(idx, idx + contBudget);
    chunks.push(next);
    idx += next.length;
  }
  return { chunks, truncatedCount };
}

/** Renders the volume-only truncation notice line (T-07-30/T-07-33). */
function truncationNoticeText(t, remaining) {
  const template = t(
    'rpt.pack_truncation_notice',
    '{count} further row(s) exist in this dataset — see the CSV export for the complete list.'
  );
  return template.replace('{count}', String(remaining));
}

/** Computes each column's left x-coordinate from its fractional width. */
function columnX(columns, contentWidth) {
  let x = CONTENT_LEFT_PX;
  return columns.map((col) => {
    const cx = x;
    x += col.fraction * contentWidth;
    return cx;
  });
}

function drawTableHeader(ctx, columns, xs, y) {
  ctx.font = font(9, 'bold');
  ctx.fillStyle = COLOR_TEXT_DIM;
  ctx.textAlign = 'left';
  columns.forEach((col, i) => {
    ctx.fillText(String(col.headerText || '').toUpperCase(), xs[i], y);
  });
}

/** The 1px hairline row separator (no zebra striping — 07-UI-SPEC.md §5). */
function drawRowHairline(ctx, y, contentWidth) {
  ctx.save();
  ctx.strokeStyle = COLOR_BORDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CONTENT_LEFT_PX, y);
  ctx.lineTo(CONTENT_LEFT_PX + contentWidth, y);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Section 2 — Workstreams & Tasks.
// ---------------------------------------------------------------------------
const TASK_TABLE_COLUMNS = [
  { key: 'title', fraction: 0.28, header: ['rpt.pack_col_title', 'Title'] },
  { key: 'workstreamId', fraction: 0.16, header: ['rpt.pack_col_workstream', 'Workstream'] },
  { key: 'phase', fraction: 0.12, header: ['rpt.pack_col_phase', 'Phase'] },
  { key: 'status', fraction: 0.14, header: ['rpt.pack_col_status', 'Status'] },
  { key: 'owner', fraction: 0.16, header: ['rpt.pack_col_owner', 'Owner'] },
  { key: 'due', fraction: 0.14, header: ['rpt.pack_col_due', 'Due date'] },
];

function resolveColumnHeaders(columns, t) {
  return columns.map((c) => Object.assign({}, c, { headerText: t(c.header[0], c.header[1]) }));
}

/**
 * A per-workstream horizontal bar row (the pack-scale equivalent of
 * `.ex-ws-track`/`.ex-ws-fill`, 07-UI-SPEC.md §5 Section 2): label left,
 * percentage right, fill coloured via the CALLER's own `ragStatus` band
 * (never re-derived from the percentage here — same rule execSummarySection
 * follows for its RAG strip).
 */
function drawWorkstreamBars(ctx, workstreams, t, y, contentWidth, barRowHeight) {
  if (!workstreams.length) {
    ctx.font = font(10, 'normal');
    ctx.fillStyle = COLOR_TEXT_DIM;
    ctx.textAlign = 'left';
    ctx.fillText(t('rpt.pack_no_workstreams', 'No workstreams yet.'), CONTENT_LEFT_PX, y + 10);
    return y + EMPTY_STATE_HEIGHT_PX;
  }
  workstreams.forEach((w) => {
    const label = String((w && w.label) || '');
    const pct = Math.max(0, Math.min(100, (w && w.pctComplete) || 0));
    const color = RAG_BAND_COLOR[w && w.ragStatus] || RAG_BAND_COLOR.red;
    ctx.font = font(10, 'normal');
    ctx.fillStyle = COLOR_TEXT_PRIMARY;
    ctx.textAlign = 'left';
    ctx.fillText(label, CONTENT_LEFT_PX, y + 10);
    ctx.textAlign = 'right';
    ctx.fillText(`${pct}%`, CONTENT_LEFT_PX + contentWidth, y + 10);
    const trackY = y + 14;
    ctx.fillStyle = '#eef2f2';
    ctx.fillRect(CONTENT_LEFT_PX, trackY, contentWidth, 6);
    ctx.fillStyle = color;
    ctx.fillRect(CONTENT_LEFT_PX, trackY, (contentWidth * pct) / 100, 6);
    y += barRowHeight;
  });
  return y;
}

function drawTaskRow(ctx, task, xs, y) {
  ctx.font = font(9, 'normal');
  ctx.fillStyle = COLOR_TEXT_PRIMARY;
  ctx.textAlign = 'left';
  ctx.fillText(String(task.title || ''), xs[0], y);
  ctx.fillText(String(task.workstreamId || ''), xs[1], y);
  ctx.fillText(String(task.phase || ''), xs[2], y);
  ctx.fillText(String(task.status || ''), xs[3], y);
  ctx.fillText(String(task.owner || ''), xs[4], y);
  ctx.fillText(String(task.due || ''), xs[5], y);
}

/**
 * Section 2 — Workstreams & Tasks. A horizontal bar per workstream (page one
 * only — a fixed-size preamble, not paginated), followed by the task table,
 * which paginates independently, repeating only its column-header row on
 * continuation pages (never the section title). No per-item clearance
 * concept exists on tasks (07-02-PLAN.md) — every task in `model.tasks` is
 * rendered, unfiltered.
 */
function workstreamsTasksSection(model, t, contentWidth, contentHeight) {
  const workstreams = Array.isArray(model.workstreams) ? model.workstreams : [];
  const tasks = Array.isArray(model.tasks) ? model.tasks : [];
  const columns = resolveColumnHeaders(TASK_TABLE_COLUMNS, t);
  const xs = columnX(columns, contentWidth);

  const BAR_ROW_HEIGHT = 26;
  const preambleHeight = workstreams.length ? workstreams.length * BAR_ROW_HEIGHT : EMPTY_STATE_HEIGHT_PX;

  const firstPageBudget = Math.floor(
    (contentHeight - SECTION_TITLE_HEIGHT_PX - preambleHeight - TABLE_HEADER_HEIGHT_PX) / TABLE_ROW_HEIGHT_PX
  );
  const contPageBudget = Math.floor((contentHeight - TABLE_HEADER_HEIGHT_PX) / TABLE_ROW_HEIGHT_PX);
  const { chunks, truncatedCount } = paginateRows(tasks, firstPageBudget, contPageBudget, MAX_SECTION_PAGES);

  return chunks.map((chunk, pageIdx) => ({
    render(ctx) {
      let y = CONTENT_TOP_PX;
      if (pageIdx === 0) {
        ctx.font = font(14, 'bold');
        ctx.fillStyle = COLOR_DARK_TEAL;
        ctx.textAlign = 'left';
        ctx.fillText(t('rpt.pack_section_ws_tasks', 'Workstreams & Tasks'), CONTENT_LEFT_PX, y + 12);
        y += SECTION_TITLE_HEIGHT_PX;
        y = drawWorkstreamBars(ctx, workstreams, t, y, contentWidth, BAR_ROW_HEIGHT);
      }
      drawTableHeader(ctx, columns, xs, y + 10);
      y += TABLE_HEADER_HEIGHT_PX;
      if (!tasks.length && pageIdx === 0) {
        ctx.font = font(10, 'normal');
        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.textAlign = 'left';
        ctx.fillText(t('rpt.pack_no_tasks', 'No tasks recorded yet.'), CONTENT_LEFT_PX, y + 10);
        y += TABLE_ROW_HEIGHT_PX;
      }
      chunk.forEach((task) => {
        drawTaskRow(ctx, task, xs, y + 10);
        drawRowHairline(ctx, y + 14, contentWidth);
        y += TABLE_ROW_HEIGHT_PX;
      });
      if (pageIdx === chunks.length - 1 && truncatedCount > 0) {
        ctx.font = font(9, 'italic');
        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.textAlign = 'left';
        ctx.fillText(truncationNoticeText(t, truncatedCount), CONTENT_LEFT_PX, y + 10);
      }
    },
  }));
}

// ---------------------------------------------------------------------------
// Section 3 — Risks & Decisions (RAID).
// ---------------------------------------------------------------------------
const RAID_TABLE_COLUMNS = [
  { key: 'type', fraction: 0.12, header: ['rpt.pack_col_type', 'Type'] },
  { key: 'severity', fraction: 0.12, header: ['rpt.pack_col_severity', 'Severity'] },
  { key: 'title', fraction: 0.42, header: ['rpt.pack_col_title', 'Title'] },
  { key: 'owner', fraction: 0.18, header: ['rpt.pack_col_owner', 'Owner'] },
  { key: 'status', fraction: 0.16, header: ['rpt.pack_col_status', 'Status'] },
];

// Fixed grouping order — mirrors execution.html's own RAID_TYPES filter-
// button order (07-UI-SPEC.md §5 Section 3) so the live filter UI and the
// pack's static grouping always agree. An independent copy, per this
// project's established RAID_LEVELS/RAID_TYPES precedent (server.js).
const RAID_TYPES = ['risk', 'issue', 'decision', 'dependency'];

/** Stable partition into the fixed RAID_TYPES order; any unrecognised type
 * (should not occur in practice) is appended at the end rather than
 * silently dropped. */
function groupRaidByType(raid) {
  const knownSet = new Set(RAID_TYPES);
  const known = RAID_TYPES.reduce((acc, ty) => acc.concat(raid.filter((r) => r && r.type === ty)), []);
  const unknown = raid.filter((r) => !r || !knownSet.has(r.type));
  return known.concat(unknown);
}

function drawRaidRow(ctx, entry, xs, y) {
  ctx.font = font(9, 'normal');
  ctx.fillStyle = COLOR_TEXT_PRIMARY;
  ctx.textAlign = 'left';
  ctx.fillText(String(entry.type || ''), xs[0], y);
  ctx.font = font(9, 'bold');
  ctx.fillStyle = RAID_SEVERITY_COLOR[entry.severity] || RAID_SEVERITY_COLOR.medium;
  ctx.fillText(String(entry.severity || '').toUpperCase(), xs[1], y);
  ctx.font = font(9, 'normal');
  ctx.fillStyle = COLOR_TEXT_PRIMARY;
  ctx.fillText(String(entry.title || ''), xs[2], y);
  ctx.fillText(String(entry.owner || ''), xs[3], y);
  ctx.fillText(String(entry.status || ''), xs[4], y);
}

/**
 * Section 3 — Risks & Decisions. Rows this caller isn't cleared for are
 * already absent from `model.raid` before this function ever runs — it
 * never draws a placeholder row or a "N more" count (T-07-30), because
 * doing so would disclose the existence of restricted content, the exact
 * absence-not-disabled principle Phase 6 established, now extended to a
 * generated document.
 */
function raidSection(model, t, contentWidth, contentHeight) {
  const raid = Array.isArray(model.raid) ? model.raid : [];
  const grouped = groupRaidByType(raid);
  const columns = resolveColumnHeaders(RAID_TABLE_COLUMNS, t);
  const xs = columnX(columns, contentWidth);

  const firstPageBudget = Math.floor((contentHeight - SECTION_TITLE_HEIGHT_PX - TABLE_HEADER_HEIGHT_PX) / TABLE_ROW_HEIGHT_PX);
  const contPageBudget = Math.floor((contentHeight - TABLE_HEADER_HEIGHT_PX) / TABLE_ROW_HEIGHT_PX);
  const { chunks, truncatedCount } = paginateRows(grouped, firstPageBudget, contPageBudget, MAX_SECTION_PAGES);

  return chunks.map((chunk, pageIdx) => ({
    render(ctx) {
      let y = CONTENT_TOP_PX;
      if (pageIdx === 0) {
        ctx.font = font(14, 'bold');
        ctx.fillStyle = COLOR_DARK_TEAL;
        ctx.textAlign = 'left';
        ctx.fillText(t('rpt.pack_section_raid', 'Risks & Decisions'), CONTENT_LEFT_PX, y + 12);
        y += SECTION_TITLE_HEIGHT_PX;
      }
      drawTableHeader(ctx, columns, xs, y + 10);
      y += TABLE_HEADER_HEIGHT_PX;
      if (!grouped.length && pageIdx === 0) {
        ctx.font = font(10, 'normal');
        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.textAlign = 'left';
        ctx.fillText(t('rpt.pack_no_raid', 'No risks, issues, decisions or dependencies recorded yet.'), CONTENT_LEFT_PX, y + 10);
        y += TABLE_ROW_HEIGHT_PX;
      }
      chunk.forEach((entry) => {
        drawRaidRow(ctx, entry, xs, y + 10);
        drawRowHairline(ctx, y + 14, contentWidth);
        y += TABLE_ROW_HEIGHT_PX;
      });
      if (pageIdx === chunks.length - 1 && truncatedCount > 0) {
        ctx.font = font(9, 'italic');
        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.textAlign = 'left';
        ctx.fillText(truncationNoticeText(t, truncatedCount), CONTENT_LEFT_PX, y + 10);
      }
    },
  }));
}

// ---------------------------------------------------------------------------
// Section 4 — Synergies (RPT-03's avoid-double-counting requirement, D-01/D-02).
// ---------------------------------------------------------------------------
const SYN_TABLE_COLUMNS = [
  { key: 'title', fraction: 0.16, header: ['rpt.pack_col_title', 'Title'] },
  { key: 'category', fraction: 0.08, header: ['rpt.pack_col_category', 'Category'] },
  { key: 'stage', fraction: 0.10, header: ['rpt.pack_col_stage', 'Stage'] },
  { key: 'stageAtBaseline', fraction: 0.12, header: ['rpt.pack_col_stage_baseline', 'Stage at last baseline'] },
  { key: 'targetM', fraction: 0.09, header: ['rpt.pack_col_target', 'Target'] },
  { key: 'realizedM', fraction: 0.09, header: ['rpt.pack_col_realized', 'Realized'] },
  { key: 'costIncurredM', fraction: 0.09, header: ['rpt.pack_col_cost_incurred', 'Cost incurred'] },
  { key: 'netBenefitM', fraction: 0.09, header: ['rpt.pack_col_net_benefit', 'Net benefit'] },
  { key: 'bar', fraction: 0.18, header: ['rpt.pack_col_bar', ''] },
];

// Independent copies of server.js's SYN_STAGES / execution.html's `.syn-cat`
// palette — this module never imports server.js (no database access, per
// the module header contract).
const SYN_STAGES = ['idea', 'validated', 'committed', 'captured'];
const SYN_STAGE_COLOR = { idea: '#8a8f92', validated: '#475569', committed: '#C77700', captured: '#3f7a37' };
const SYN_CATEGORY_COLOR = { revenue: '#167987', cost: '#3f7a37' };
// The screen's existing stale-badge palette (`.syn-stale-badge`,
// execution.html) — an amber filled tag, reused here as the pack's "Stale
// {N}d" tag fill.
const STALE_TAG_COLOR = '#C77700';

/**
 * Section-level recap (D-02): repeats the SAME four headline numbers page
 * one's tiles read from `model.rollup` — never re-summed from
 * `model.synergies` here, which is exactly the double-counting drift RPT-03
 * names.
 */
function drawSynergyRecap(ctx, model, t, y) {
  const rollup = (model && model.rollup) || {};
  const gross = rollup.grossRealizedM || 0;
  const cost = rollup.costIncurredM || 0;
  const net = rollup.netBenefitM != null ? rollup.netBenefitM : gross - cost;
  const target = rollup.dealTargetM || 0;
  const template = t(
    'rpt.pack_syn_recap',
    'Rollup recap — gross realized ${gross}M · cost incurred ${cost}M · net benefit ${net}M · deal target ${target}M.'
  );
  const line = template
    .replace('{gross}', gross.toFixed(1))
    .replace('{cost}', cost.toFixed(1))
    .replace('{net}', net.toFixed(1))
    .replace('{target}', target.toFixed(1));
  ctx.font = font(10, 'normal');
  ctx.fillStyle = COLOR_TEXT_DIM;
  ctx.textAlign = 'left';
  ctx.fillText(line, CONTENT_LEFT_PX, y + 8);
  return y + 20;
}

/** The realized-vs-target bar: the same 2-stop gradient `.syn-fill` uses
 * (orange -> green), reproduced as a canvas linear gradient. */
function drawSynergyBar(ctx, x, y, width, targetM, realizedM) {
  const trackHeight = 8;
  ctx.fillStyle = '#eef2f2';
  ctx.fillRect(x, y, width, trackHeight);
  const pct = targetM > 0 ? Math.max(0, Math.min(1, realizedM / targetM)) : 0;
  if (pct > 0) {
    const gradient = ctx.createLinearGradient(x, y, x + width, y);
    gradient.addColorStop(0, COLOR_ORANGE);
    gradient.addColorStop(1, '#3f7a37');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width * pct, trackHeight);
  }
}

/**
 * D-12: stale rows stay in their normal position in this table (never
 * sorted to the bottom, never moved to their own page) — this function
 * never reorders `model.synergies`, so that guarantee is structural, not a
 * behaviour this renderer has to remember. An entire stale row's text
 * (including its category/stage accent colours) renders in the dim colour,
 * with a small filled "Stale {N}d" tag drawn after the title.
 */
function drawSynergyRow(ctx, item, xs, y, contentWidth) {
  const stale = !!item.stale;
  const primaryColor = stale ? COLOR_TEXT_DIM : COLOR_TEXT_PRIMARY;
  const categoryColor = stale ? COLOR_TEXT_DIM : (SYN_CATEGORY_COLOR[item.category] || COLOR_TEXT_PRIMARY);
  const stageColor = stale ? COLOR_TEXT_DIM : (SYN_STAGE_COLOR[item.stage] || COLOR_TEXT_PRIMARY);

  ctx.textAlign = 'left';
  ctx.font = font(9, 'normal');
  ctx.fillStyle = primaryColor;
  const title = String(item.title || '');
  ctx.fillText(title, xs[0], y);

  if (stale) {
    const dayCount = item.staleDays != null ? item.staleDays : 0;
    const tagLabel = `Stale ${dayCount}d`;
    const titleWidth = ctx.measureText(title).width;
    const tagX = xs[0] + titleWidth + 8;
    const tagWidth = ctx.measureText(tagLabel).width + 12;
    ctx.fillStyle = STALE_TAG_COLOR;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(tagX, y - 10, tagWidth, 13, 8);
    } else {
      ctx.rect(tagX, y - 10, tagWidth, 13);
    }
    ctx.fill();
    ctx.fillStyle = COLOR_WHITE;
    ctx.textAlign = 'left';
    ctx.fillText(tagLabel, tagX + 6, y);
  }

  ctx.font = font(9, 'bold');
  ctx.fillStyle = categoryColor;
  ctx.fillText(String(item.category || ''), xs[1], y);
  ctx.fillStyle = stageColor;
  ctx.fillText(String(item.stage || ''), xs[2], y);
  ctx.font = font(9, 'normal');
  ctx.fillStyle = primaryColor;
  ctx.fillText(item.stageAtBaseline ? String(item.stageAtBaseline) : '—', xs[3], y);
  ctx.fillText(`$${(item.targetM || 0).toFixed(1)}M`, xs[4], y);
  ctx.fillText(`$${(item.realizedM || 0).toFixed(1)}M`, xs[5], y);
  ctx.fillText(`$${(item.costIncurredM || 0).toFixed(1)}M`, xs[6], y);
  ctx.fillText(`$${(item.netBenefitM || 0).toFixed(1)}M`, xs[7], y);
  drawSynergyBar(ctx, xs[8], y - 8, contentWidth - (xs[8] - CONTENT_LEFT_PX), item.targetM || 0, item.realizedM || 0);
}

/**
 * Section 4 — Synergies. A section-level recap (never re-derived from the
 * rows below it, D-02) followed by the per-initiative table. Stale
 * initiatives stay in their normal sorted position — this function never
 * reorders `model.synergies` (D-12).
 */
function synergiesSection(model, t, contentWidth, contentHeight) {
  const synergies = Array.isArray(model.synergies) ? model.synergies : [];
  const columns = resolveColumnHeaders(SYN_TABLE_COLUMNS, t);
  const xs = columnX(columns, contentWidth);

  const RECAP_HEIGHT = 20;
  const firstPageBudget = Math.floor(
    (contentHeight - SECTION_TITLE_HEIGHT_PX - RECAP_HEIGHT - TABLE_HEADER_HEIGHT_PX) / TABLE_ROW_HEIGHT_PX
  );
  const contPageBudget = Math.floor((contentHeight - TABLE_HEADER_HEIGHT_PX) / TABLE_ROW_HEIGHT_PX);
  const { chunks, truncatedCount } = paginateRows(synergies, firstPageBudget, contPageBudget, MAX_SECTION_PAGES);

  return chunks.map((chunk, pageIdx) => ({
    render(ctx) {
      let y = CONTENT_TOP_PX;
      if (pageIdx === 0) {
        ctx.font = font(14, 'bold');
        ctx.fillStyle = COLOR_DARK_TEAL;
        ctx.textAlign = 'left';
        ctx.fillText(t('rpt.pack_section_synergies', 'Synergies'), CONTENT_LEFT_PX, y + 12);
        y += SECTION_TITLE_HEIGHT_PX;
        y = drawSynergyRecap(ctx, model, t, y);
      }
      drawTableHeader(ctx, columns, xs, y + 10);
      y += TABLE_HEADER_HEIGHT_PX;
      if (!synergies.length && pageIdx === 0) {
        ctx.font = font(10, 'normal');
        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.textAlign = 'left';
        ctx.fillText(t('rpt.pack_no_synergies', 'No synergy initiatives recorded yet.'), CONTENT_LEFT_PX, y + 10);
        y += TABLE_ROW_HEIGHT_PX;
      }
      chunk.forEach((item) => {
        drawSynergyRow(ctx, item, xs, y + 10, contentWidth);
        drawRowHairline(ctx, y + 14, contentWidth);
        y += TABLE_ROW_HEIGHT_PX;
      });
      if (pageIdx === chunks.length - 1 && truncatedCount > 0) {
        ctx.font = font(9, 'italic');
        ctx.fillStyle = COLOR_TEXT_DIM;
        ctx.textAlign = 'left';
        ctx.fillText(truncationNoticeText(t, truncatedCount), CONTENT_LEFT_PX, y + 10);
      }
    },
  }));
}

const DEFAULT_SECTIONS = [execSummarySection, workstreamsTasksSection, raidSection, synergiesSection];

/**
 * The pack's public entry point. Takes an already-assembled, already-
 * clearance-filtered model (see the module header comment for its shape),
 * runs both layout passes over the registered default sections, and
 * returns a PDF Buffer. Performs no database access, no clearance
 * evaluation and no HTTP work.
 * @param {*} model
 * @returns {Promise<Buffer>}
 */
async function buildPack(model) {
  const pages = await assemblePages(model, DEFAULT_SECTIONS);
  return buildPdf(pages);
}

/**
 * Test/composition seam: identical to buildPack, but against a caller-
 * supplied section list instead of the module's DEFAULT_SECTIONS. Lets
 * tests prove frame/paginator correctness (multi-page layout, footer
 * numbering, the sentinel-absence property) independently of whatever the
 * real default composition evolves into across later plans.
 * @param {*} model
 * @param {Array<Function>} sections
 * @returns {Promise<Buffer>}
 */
async function buildPackFromSections(model, sections) {
  const pages = await assemblePages(model, sections);
  return buildPdf(pages);
}

module.exports = {
  buildPack,
  buildPackFromSections,
  resolveLanguage,
  drawHeaderBand,
  drawFooterBand,
  paginateSections,
  execSummarySection,
  workstreamsTasksSection,
  raidSection,
  synergiesSection,
  DEFAULT_SECTIONS,
  RAID_TYPES,
  SYN_STAGES,
  SYN_STAGE_COLOR,
  SYN_CATEGORY_COLOR,
  MAX_SECTION_PAGES,
  SUPPORTED_LANGUAGES,
  RAID_SEVERITY_COLOR,
  RAID_SEVERITY_ORDER,
  RAG_BAND_COLOR,
  COLOR_DANGER,
  COLOR_DARK_TEAL,
  COLOR_TEXT_DIM,
  COLOR_TEXT_PRIMARY,
  PAGE_WIDTH_PX,
  PAGE_HEIGHT_PX,
  MARGIN_PX,
  HEADER_HEIGHT_PX,
  FOOTER_HEIGHT_PX,
  CONTENT_LEFT_PX,
  CONTENT_RIGHT_PX,
  CONTENT_TOP_PX,
  CONTENT_BOTTOM_PX,
  CONTENT_WIDTH_PX,
  CONTENT_HEIGHT_PX,
};
