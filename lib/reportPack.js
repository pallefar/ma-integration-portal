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
//     raid: [ ...clearance-filtered, enriched RAID entries... ],
//     synergies: [ ...clearance-filtered, enriched synergies... ],
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

const DEFAULT_SECTIONS = [execSummarySection];

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
  SUPPORTED_LANGUAGES,
  RAID_SEVERITY_COLOR,
  RAID_SEVERITY_ORDER,
  RAG_BAND_COLOR,
  COLOR_DANGER,
  COLOR_DARK_TEAL,
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
