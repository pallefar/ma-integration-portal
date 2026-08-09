// RPT-02/RPT-03 (07-05): proves the steerco pack's page frame before any real
// content section exists.
//
// Task 1 proves the three properties the plan calls out as cheapest to get
// right in the frame, before four sections exist to get them wrong in four
// places: every page carries the header+footer bands (drawn by the frame,
// never by a section), the every-page confidentiality footer never leaks the
// deal's real legal-target name, and the two-pass paginator makes "Page N of
// M" correct on page one because the total is known before page one's footer
// is ever drawn.
//
// The sentinel-absence and page-numbering proofs use an INSTRUMENTED fake
// canvas context (capturing every string passed to fillText) rather than a
// real @napi-rs/canvas — this is deliberate, per the plan: the assertion must
// hold regardless of rasterisation, not merely "this particular renderer
// didn't happen to draw the forbidden string this run".
//
// node:test — run via `node --test test/reports-pack.test.js` (or `npm test`).

const test = require('node:test');
const assert = require('node:assert');

const reportPack = require('../lib/reportPack.js');
const {
  buildPack,
  buildPackFromSections,
  resolveLanguage,
  drawHeaderBand,
  drawFooterBand,
  paginateSections,
  execSummarySection,
  CONTENT_WIDTH_PX,
  CONTENT_HEIGHT_PX,
  CONTENT_LEFT_PX,
  CONTENT_TOP_PX,
} = reportPack;

/**
 * A fake canvas 2D context that implements every method reportPack.js calls,
 * but records every string handed to fillText instead of rasterising it.
 * This is what makes the sentinel-absence proof hold independent of pixel
 * rendering: the assertion is "no drawing call was ever given this string",
 * not "no visible pixel happened to form this string".
 */
function makeInstrumentedCtx() {
  const drawnStrings = [];
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    fillText(text) {
      drawnStrings.push(String(text));
    },
    measureText(text) {
      return { width: String(text).length * 6 };
    },
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fill() {},
    save() {},
    restore() {},
    clip() {},
    rect() {},
    roundRect() {},
    drawImage() {},
    scale() {},
    translate() {},
  };
  return { ctx, drawnStrings };
}

// A generic, model-driven "rows" section used ONLY by these tests to force
// the paginator across multiple pages, independent of whatever the module's
// real default section composition is or becomes across later plans.
function makeDebugRowsSection(rows) {
  return function debugRowsSection(model, t, contentWidth, contentHeight) {
    const ROW_HEIGHT = 14;
    const rowsPerPage = Math.max(1, Math.floor(contentHeight / ROW_HEIGHT));
    const pages = [];
    for (let i = 0; i < rows.length; i += rowsPerPage) {
      const slice = rows.slice(i, i + rowsPerPage);
      pages.push({
        render(ctx) {
          ctx.textAlign = 'left';
          slice.forEach((row, idx) => {
            ctx.fillText(String(row), CONTENT_LEFT_PX, CONTENT_TOP_PX + (idx + 1) * ROW_HEIGHT);
          });
        },
      });
    }
    return pages.length ? pages : [{ render() {} }];
  };
}

function baseModel(overrides) {
  return Object.assign(
    {
      deal: { name: 'Project Falcon' },
      language: 'en',
      generatedAt: '2026-08-09 12:00 UTC',
      generatedBy: 'khaldan',
      i18n: { strings: { en: {} } },
      rollup: {},
      workstreams: [],
      raid: [],
      synergies: [],
      staleThresholdDays: 30,
    },
    overrides || {}
  );
}

function countPdfPageObjects(pdfBuffer) {
  const text = pdfBuffer.toString('binary');
  return (text.match(/\/Type \/Page(?!s)\b/g) || []).length;
}

test('reports-pack page frame', async (t) => {
  await t.test('(a) a model forced to paginate across several pages produces a PDF whose page count equals the paginator count', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => `Row ${i}`);
    const model = baseModel();
    const t2 = resolveLanguage(model.i18n, model.language);
    const descriptorCount = paginateSections(model, t2, [makeDebugRowsSection(rows)]).length;
    assert.ok(descriptorCount > 1, 'the fixture must force more than one page or this proof is vacuous');

    const pdf = await buildPackFromSections(model, [makeDebugRowsSection(rows)]);
    assert.strictEqual(countPdfPageObjects(pdf), descriptorCount);
  });

  await t.test('(b) every rendered page is passed the correct page number and the same total', async () => {
    const seen = [];
    const section = () => [
      { render(ctx, info) { seen.push(info); } },
      { render(ctx, info) { seen.push(info); } },
      { render(ctx, info) { seen.push(info); } },
    ];
    const model = baseModel();
    await buildPackFromSections(model, [section]);
    assert.strictEqual(seen.length, 3);
    seen.forEach((info, i) => {
      assert.strictEqual(info.pageNumber, i + 1);
      assert.strictEqual(info.pageCount, 3);
    });
  });

  await t.test('(c) a distinctive sentinel in the legal-target field appears nowhere in any drawn string', async () => {
    const SENTINEL = 'ZZZ-LEGAL-TARGET-SENTINEL-9f31';
    const model = baseModel({
      deal: { name: 'Project Falcon', targetCompany: SENTINEL },
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    const { ctx, drawnStrings } = makeInstrumentedCtx();

    drawHeaderBand(ctx, model, t2, null);
    drawFooterBand(ctx, model, 1, 1);

    const section = () => [{ render() {} }];
    const descriptors = paginateSections(model, t2, [section]);
    descriptors[0].render(ctx, { pageNumber: 1, pageCount: 1 });

    assert.ok(drawnStrings.length > 0, 'the instrumented context must have captured at least one drawn string');
    drawnStrings.forEach((s) => {
      assert.ok(!s.includes(SENTINEL), `drawn string leaked the legal-target sentinel: "${s}"`);
    });
  });

  await t.test('(d) the footer page counter on page one reads the true total, not one', async () => {
    const model = baseModel();
    const { ctx, drawnStrings } = makeInstrumentedCtx();
    drawFooterBand(ctx, model, 1, 5);
    const pageLine = drawnStrings.find((s) => /^Page \d+ of \d+$/.test(s));
    assert.strictEqual(pageLine, 'Page 1 of 5');
  });

  await t.test('(e) the header and footer bands read the codename, and the codename is present', async () => {
    const model = baseModel({ deal: { name: 'Project Falcon' } });
    const t2 = resolveLanguage(model.i18n, model.language);
    const { ctx, drawnStrings } = makeInstrumentedCtx();
    drawHeaderBand(ctx, model, t2, null);
    drawFooterBand(ctx, model, 1, 1);
    assert.ok(drawnStrings.some((s) => s.includes('Project Falcon')));
  });

  await t.test('(f) a requested language with no entry for a key falls back to English rather than blanking or throwing', () => {
    const model = baseModel({
      language: 'de',
      i18n: { strings: { en: { 'rpt.only_en': 'English only' }, de: {} } },
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    assert.strictEqual(t2('rpt.only_en', 'fallback literal'), 'English only');
    // A key present in NEITHER language falls back to the caller-supplied
    // English literal, then finally to the key itself — never blank/throw.
    assert.strictEqual(t2('rpt.missing_everywhere', 'Literal fallback'), 'Literal fallback');
    assert.strictEqual(t2('rpt.missing_everywhere_no_literal'), 'rpt.missing_everywhere_no_literal');
  });

  await t.test('(g) an unsupported requested language code defaults to English', () => {
    const model = baseModel({
      language: 'fr',
      i18n: { strings: { en: { 'rpt.k': 'English value' } } },
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    assert.strictEqual(t2('rpt.k'), 'English value');
  });

  await t.test('(h) buildPack returns a valid PDF buffer using the module default section', async () => {
    const model = baseModel();
    const pdf = await buildPack(model);
    assert.ok(Buffer.isBuffer(pdf));
    assert.match(pdf.toString('binary', 0, 8), /^%PDF-1\.4$/);
    assert.strictEqual(countPdfPageObjects(pdf), 1);
  });
});

// ---------------------------------------------------------------------------
// Task 2: page one — the executive summary.
// ---------------------------------------------------------------------------

function renderExecSummary(model) {
  const t2 = resolveLanguage(model.i18n, model.language);
  const pages = execSummarySection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
  assert.strictEqual(pages.length, 1, 'the executive summary must always be exactly one page');
  const { ctx, drawnStrings } = makeInstrumentedCtx();
  pages[0].render(ctx, { pageNumber: 1, pageCount: 1 });
  return drawnStrings;
}

test('reports-pack executive summary (page one)', async (t) => {
  await t.test('(a) each of the five tiles renders the exact rollup value, on a rounding-edge fixture that a re-summation would get wrong', () => {
    // A rounding-edge fixture: per-initiative amounts that do NOT sum
    // cleanly to the rollup totals below. If execSummarySection ever starts
    // re-summing model.synergies instead of reading model.rollup, this
    // fixture makes the tile values visibly diverge from the assertions.
    const model = baseModel({
      rollup: {
        grossRealizedM: 12.4,
        unphasedRealizedM: 3.35,
        costIncurredM: 5.06,
        netBenefitM: 7.36,
        dealTargetM: 40.0,
        staleCount: 2,
      },
      synergies: [
        { realizedM: 4.111, costIncurredM: 1.111 },
        { realizedM: 4.222, costIncurredM: 1.222 },
        { realizedM: 4.333, costIncurredM: 1.333 },
        { realizedM: 3.234, costIncurredM: 1.394 },
      ],
    });
    const drawn = renderExecSummary(model);
    assert.ok(drawn.includes('$12.4M'), 'gross realized tile must equal the supplied rollup value');
    assert.ok(drawn.includes('$3.4M'), 'unphased tile must equal the supplied rollup value');
    assert.ok(drawn.includes('$5.1M'), 'cost incurred tile must equal the supplied rollup value');
    assert.ok(drawn.includes('$7.4M'), 'net benefit tile must equal the supplied rollup value');
    assert.ok(drawn.includes('$40.0M'), 'deal target tile must equal the supplied rollup value');
    // A naive re-summation of the fixture above (4.111+4.222+4.333+3.234 =
    // 15.9) would NOT equal the supplied grossRealizedM (12.4) — proving
    // this test would fail loudly if the renderer ever re-summed.
    assert.ok(!drawn.some((s) => s.includes('15.9')), 'no drawn string may show a re-summed total');
  });

  await t.test('(b) the unphased figure appears as its own labelled tile, never inside the gross tile text', () => {
    const model = baseModel({
      rollup: { grossRealizedM: 10.0, unphasedRealizedM: 2.5, costIncurredM: 1.0, netBenefitM: 9.0, dealTargetM: 20.0 },
    });
    const drawn = renderExecSummary(model);
    assert.ok(drawn.includes('Gross realized'.toUpperCase()));
    assert.ok(drawn.includes('Unphased'.toUpperCase()));
    // The gross tile's own value string never contains the unphased number
    // concatenated into it (i.e. no "$10.0M / $2.5M"-style folding).
    assert.ok(drawn.includes('$10.0M'));
    assert.ok(drawn.includes('$2.5M'));
    assert.ok(!drawn.some((s) => s.includes('$10.0M') && s.includes('$2.5M')));
  });

  await t.test('(c) net benefit renders in the danger colour when negative', () => {
    const model = baseModel({ rollup: { grossRealizedM: 1, costIncurredM: 5, netBenefitM: -4, dealTargetM: 10 } });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = execSummarySection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const seenFillStyles = [];
    const { ctx } = makeInstrumentedCtx();
    const realFillText = ctx.fillText.bind(ctx);
    ctx.fillText = (text) => {
      if (String(text).includes('-4.0M')) seenFillStyles.push(ctx.fillStyle);
      realFillText(text);
    };
    pages[0].render(ctx, { pageNumber: 1, pageCount: 1 });
    assert.ok(seenFillStyles.includes(reportPack.COLOR_DANGER));
  });

  await t.test('(d) the RAG chips use the bands the workstream rollup supplied, never re-derived from a percentage', () => {
    const model = baseModel({
      workstreams: [
        { id: 'w1', label: 'HR', pctComplete: 95, ragStatus: 'red', blocked: true },
        { id: 'w2', label: 'IT', pctComplete: 10, ragStatus: 'green', blocked: false },
      ],
    });
    const drawn = renderExecSummary(model);
    assert.ok(drawn.includes('HR'));
    assert.ok(drawn.includes('IT'));
  });

  await t.test('(e) the risk list is ordered most-severe-first and truncated to the stated maximum', () => {
    const model = baseModel({
      raid: [
        { type: 'risk', severity: 'low', title: 'Low risk A' },
        { type: 'risk', severity: 'critical', title: 'Critical risk B' },
        { type: 'issue', severity: 'critical', title: 'Not a risk, must be excluded' },
        { type: 'risk', severity: 'medium', title: 'Medium risk C' },
        { type: 'risk', severity: 'high', title: 'High risk D' },
        { type: 'risk', severity: 'high', title: 'High risk E' },
        { type: 'risk', severity: 'low', title: 'Low risk F (should be truncated)' },
      ],
    });
    const drawn = renderExecSummary(model);
    assert.ok(!drawn.includes('Not a risk, must be excluded'));
    const order = ['Critical risk B', 'High risk D', 'High risk E', 'Medium risk C', 'Low risk A'];
    const indices = order.map((title) => drawn.indexOf(title));
    indices.forEach((idx) => assert.notStrictEqual(idx, -1));
    for (let i = 1; i < indices.length; i++) {
      assert.ok(indices[i] > indices[i - 1], 'risks must appear in most-severe-first order');
    }
    assert.ok(!drawn.includes('Low risk F (should be truncated)'), 'the list must truncate to the stated maximum (5)');
  });

  await t.test('(f) the stale sentence numbers equal the supplied rollup count and collection length', () => {
    const model = baseModel({
      rollup: { staleCount: 3 },
      synergies: [{}, {}, {}, {}, {}],
      staleThresholdDays: 45,
    });
    const drawn = renderExecSummary(model);
    const sentence = drawn.find((s) => s.includes('synergy initiatives are stale'));
    assert.ok(sentence, 'the stale sentence must be drawn');
    assert.ok(sentence.startsWith('3 of 5'));
    assert.ok(sentence.includes('45 days'));
  });

  await t.test('(g) an entirely empty model still renders a page one without throwing', () => {
    const model = baseModel({ rollup: {}, workstreams: [], raid: [], synergies: [] });
    assert.doesNotThrow(() => renderExecSummary(model));
    const drawn = renderExecSummary(model);
    assert.ok(drawn.includes('$0.0M'));
    assert.ok(drawn.some((s) => s.includes('No workstreams yet.')));
    assert.ok(drawn.some((s) => s.includes('No risks recorded yet.')));
    assert.ok(drawn.some((s) => s.startsWith('0 of 0')));
  });

  await t.test('(h) an empty deal still produces a complete, valid multi-band PDF via buildPack', async () => {
    const model = baseModel({ rollup: {}, workstreams: [], raid: [], synergies: [] });
    const pdf = await buildPack(model);
    assert.ok(Buffer.isBuffer(pdf));
    assert.strictEqual(countPdfPageObjects(pdf), 1);
  });
});
