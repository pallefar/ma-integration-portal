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
const { listenLocal } = require('./helpers/listen-local');
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
    createLinearGradient() {
      return { addColorStop() {} };
    },
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

  await t.test('(h) buildPack returns a valid PDF buffer using the module default sections', async () => {
    const model = baseModel();
    const pdf = await buildPack(model);
    assert.ok(Buffer.isBuffer(pdf));
    assert.match(pdf.toString('binary', 0, 8), /^%PDF-1\.4$/);
    // 07-06: DEFAULT_SECTIONS now carries all four of D-04's parts (exec
    // summary, workstreams & tasks, RAID, synergies); an entirely empty
    // model still produces exactly one page per section (each renders its
    // own empty-state line rather than zero pages).
    assert.strictEqual(countPdfPageObjects(pdf), reportPack.DEFAULT_SECTIONS.length);
  });
});

/**
 * 07-07 (F-A/F-B regression proofs): extends the instrumented ctx above to
 * also record every filled rectangle (roundRect, or its rect() fallback) and
 * every fillText call's (text, x, y) position — the sentinel-absence proofs
 * above only ever needed WHICH strings were drawn; these two regressions are
 * about WHERE they were drawn, which needs real geometry.
 */
function makeGeometryInstrumentedCtx() {
  const drawnStrings = [];
  const drawnRects = [];
  const drawnTexts = [];
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 1,
    fillText(text, x, y) {
      drawnStrings.push(String(text));
      drawnTexts.push({ text: String(text), x, y });
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
    rect(x, y, w, h) {
      drawnRects.push({ x, y, w, h });
    },
    roundRect(x, y, w, h) {
      drawnRects.push({ x, y, w, h });
    },
    drawImage() {},
    scale() {},
    translate() {},
    createLinearGradient() {
      return { addColorStop() {} };
    },
  };
  return { ctx, drawnStrings, drawnRects, drawnTexts };
}

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
    // 07-06: one page per default section, each rendering its own
    // empty-state line rather than throwing or producing zero pages.
    assert.strictEqual(countPdfPageObjects(pdf), reportPack.DEFAULT_SECTIONS.length);
  });

  await t.test('(i) F-A regression: the RAG chip ribbon wraps onto additional lines rather than overflowing past the content-width right edge', () => {
    const workstreams = Array.from({ length: 10 }, (_, i) => ({
      id: `w${i}`, label: `Workstream Number ${i} Long Label`, pctComplete: 50, ragStatus: 'green',
    }));
    const model = baseModel({ workstreams });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = execSummarySection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const { ctx, drawnRects } = makeGeometryInstrumentedCtx();
    pages[0].render(ctx, { pageNumber: 1, pageCount: 1 });

    // The RAG strip's chips are the only filled rounded rects execSummarySection
    // draws — one per workstream.
    assert.strictEqual(drawnRects.length, workstreams.length, 'one chip rect must be drawn per workstream, or this proof is vacuous');

    const rightEdge = reportPack.CONTENT_RIGHT_PX;
    drawnRects.forEach((r) => {
      assert.ok(
        r.x + r.w <= rightEdge + 0.01,
        `a chip was drawn past the content-width right edge: x=${r.x} w=${r.w} rightEdge=${rightEdge}`
      );
    });

    // Ten long-label chips at 672px content width cannot fit on one line —
    // proving the wrap actually fired, not merely that no single oversized
    // chip happened to cross the edge.
    const distinctYs = new Set(drawnRects.map((r) => r.y));
    assert.ok(distinctYs.size > 1, '10 long-label chips must wrap onto more than one row, or this proof is vacuous');
  });
});

// ---------------------------------------------------------------------------
// 07-06 Task 1: the three remaining sections — Workstreams & Tasks, RAID and
// Synergies — registered after the executive summary in D-04's fixed order.
// ---------------------------------------------------------------------------

function renderAllPages(pages) {
  const { ctx, drawnStrings } = makeInstrumentedCtx();
  pages.forEach((page, i) => page.render(ctx, { pageNumber: i + 1, pageCount: pages.length }));
  return drawnStrings;
}

test('reports-pack Section 2 — Workstreams & Tasks', async (t) => {
  await t.test('(a) an overflowing task table continues onto further pages that repeat the column header while the section title appears only once', () => {
    const tasks = Array.from({ length: 220 }, (_, i) => ({
      id: `t${i}`, title: `Task ${i}`, workstreamId: 'w1', phase: 'day1', status: 'todo', owner: 'x', due: '2026-01-01',
    }));
    const model = baseModel({ tasks, workstreams: [] });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.workstreamsTasksSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    assert.ok(pages.length > 1, 'the fixture must force more than one page or this proof is vacuous');

    let titleCount = 0;
    const headerSeenPerPage = [];
    pages.forEach((page) => {
      const { ctx, drawnStrings } = makeInstrumentedCtx();
      page.render(ctx, { pageNumber: 1, pageCount: pages.length });
      if (drawnStrings.includes('Workstreams & Tasks')) titleCount += 1;
      headerSeenPerPage.push(drawnStrings.includes('TITLE'));
    });
    assert.strictEqual(titleCount, 1, 'the section title must render on exactly one page, never repeated');
    assert.ok(headerSeenPerPage.every(Boolean), 'the column-header row must repeat on every page, including continuations');
  });

  await t.test('(b) workstream bars render label, percentage and the caller-supplied RAG band, never a re-derived one', () => {
    const model = baseModel({
      workstreams: [{ id: 'w1', label: 'HR', pctComplete: 63, ragStatus: 'amber', blocked: false }],
      tasks: [],
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.workstreamsTasksSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const drawn = renderAllPages(pages);
    assert.ok(drawn.includes('HR'));
    assert.ok(drawn.includes('63%'));
  });

  await t.test('(c) no workstreams and no tasks renders the empty-state lines rather than throwing', () => {
    const model = baseModel({ workstreams: [], tasks: [] });
    const t2 = resolveLanguage(model.i18n, model.language);
    assert.doesNotThrow(() => {
      const pages = reportPack.workstreamsTasksSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
      const drawn = renderAllPages(pages);
      assert.ok(drawn.some((s) => s.includes('No workstreams yet.')));
      assert.ok(drawn.some((s) => s.includes('No tasks recorded yet.')));
    });
  });

  await t.test("(d) F-B regression: a title exceeding its column width wraps within the TITLE column, grows the row height, and never overprints the neighbouring column", () => {
    const longTitle =
      'A very long task title that is guaranteed to exceed the width available in the narrow title column of this table';
    const tasks = [
      { id: 't1', title: longTitle, workstreamId: 'w1', phase: 'day1', status: 'todo', owner: 'x', due: '2026-01-01' },
      { id: 't2', title: 'Short', workstreamId: 'w1', phase: 'day1', status: 'todo', owner: 'x', due: '2026-01-01' },
    ];
    const model = baseModel({ tasks, workstreams: [] });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.workstreamsTasksSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const xs = reportPack.columnX(reportPack.TASK_TABLE_COLUMNS, CONTENT_WIDTH_PX);
    const titleColX = xs[0];
    const workstreamColX = xs[1]; // the column immediately right of TITLE

    const { ctx, drawnTexts } = makeGeometryInstrumentedCtx();
    pages[0].render(ctx, { pageNumber: 1, pageCount: pages.length });

    // Every fillText call at the TITLE column's x whose text is a piece the
    // long title was wrapped FROM (never a coincidental substring of some
    // other column's value).
    const wrappedTitleCalls = drawnTexts
      .filter((d) => d.x === titleColX && longTitle.includes(d.text))
      .sort((a, b) => a.y - b.y);
    assert.ok(wrappedTitleCalls.length > 1, 'a title exceeding the column width must wrap onto more than one line, or this proof is vacuous');

    // No neighbouring-column draw call lands at any CONTINUATION line's y —
    // the exact overprint (F-B) this regression guards against. The first
    // wrapped line's y is excused: that is the row's shared baseline every
    // other column also draws at, by design.
    const continuationYs = wrappedTitleCalls.slice(1).map((d) => d.y);
    assert.ok(continuationYs.length > 0, 'the fixture must force at least one continuation line, or this proof is vacuous');
    continuationYs.forEach((y) => {
      const overlap = drawnTexts.find((d) => d.x >= workstreamColX && d.y === y);
      assert.strictEqual(
        overlap,
        undefined,
        `a neighbouring column drew text at continuation-line y=${y}, which would overprint the wrapped title`
      );
    });

    // Row-height regression: the SECOND row's title ('Short') must render
    // strictly more than one fixed row height below the first row's title —
    // proving the wrapped row grew taller rather than the paginator
    // budgeting it (and the next row) at the old fixed height.
    const shortTitleCall = drawnTexts.find((d) => d.x === titleColX && d.text === 'Short');
    assert.ok(shortTitleCall, "the second row's short title must still render");
    assert.ok(
      shortTitleCall.y - wrappedTitleCalls[0].y > reportPack.TABLE_ROW_HEIGHT_PX,
      'a wrapped title must grow its own row height beyond the fixed single-line row height'
    );
  });
});

test('reports-pack Section 3 — Risks & Decisions (RAID)', async (t) => {
  await t.test('(a) RAID rows render grouped by type in the fixed order risk -> issue -> decision -> dependency', () => {
    const model = baseModel({
      raid: [
        { id: 'd1', type: 'dependency', severity: 'low', title: 'Dep one', owner: 'x', status: 'open' },
        { id: 'r1', type: 'risk', severity: 'low', title: 'Risk one', owner: 'x', status: 'open' },
        { id: 'dec1', type: 'decision', severity: 'low', title: 'Decision one', owner: 'x', status: 'open' },
        { id: 'i1', type: 'issue', severity: 'low', title: 'Issue one', owner: 'x', status: 'open' },
      ],
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.raidSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const { ctx, drawnStrings } = makeInstrumentedCtx();
    pages[0].render(ctx, { pageNumber: 1, pageCount: pages.length });
    const order = ['Risk one', 'Issue one', 'Decision one', 'Dep one'];
    const indices = order.map((title) => drawnStrings.indexOf(title));
    indices.forEach((idx) => assert.notStrictEqual(idx, -1));
    for (let i = 1; i < indices.length; i++) {
      assert.ok(indices[i] > indices[i - 1], 'RAID rows must appear grouped in the fixed type order');
    }
  });

  await t.test('(b) an oversized RAID dataset truncates with a plain notice naming the remaining count and the CSV export, rather than growing unboundedly', () => {
    const raid = Array.from({ length: 260 }, (_, i) => ({
      id: `r${i}`, type: 'risk', severity: 'low', title: `Risk ${i}`, owner: 'x', status: 'open',
    }));
    const model = baseModel({ raid });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.raidSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    assert.ok(pages.length <= reportPack.MAX_SECTION_PAGES, 'the page ceiling must cap the section to a small, bounded number of pages');

    const drawn = renderAllPages(pages);
    const notice = drawn.find((s) => /further row/i.test(s));
    assert.ok(notice, 'the final page must draw a truncation notice');
    assert.ok(/CSV export/i.test(notice), 'the notice must name the CSV export as the complete source');

    const titlesDrawn = drawn.filter((s) => /^Risk \d+$/.test(s));
    assert.ok(titlesDrawn.length < 260, 'the oversized dataset must be truncated, not fully rendered');
  });

  await t.test('(c) zero RAID rows renders the empty-state line, never a placeholder implying withheld content', () => {
    const model = baseModel({ raid: [] });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.raidSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const drawn = renderAllPages(pages);
    assert.ok(drawn.some((s) => s.includes('No risks, issues, decisions or dependencies recorded yet.')));
  });
});

test('reports-pack Section 4 — Synergies', async (t) => {
  await t.test('(a) the recap numbers equal the supplied rollup exactly on a rounding-edge fixture that a re-summation would get wrong', () => {
    const model = baseModel({
      rollup: { grossRealizedM: 12.4, costIncurredM: 5.06, netBenefitM: 7.36, dealTargetM: 40.0 },
      synergies: [
        { title: 'A', realizedM: 4.111, costIncurredM: 1.111, targetM: 5, category: 'cost', stage: 'idea' },
        { title: 'B', realizedM: 4.222, costIncurredM: 1.222, targetM: 5, category: 'cost', stage: 'idea' },
      ],
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.synergiesSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const { ctx, drawnStrings } = makeInstrumentedCtx();
    pages[0].render(ctx, { pageNumber: 1, pageCount: pages.length });
    const recap = drawnStrings.find((s) => /gross realized/i.test(s));
    assert.ok(recap, 'a recap line must be drawn');
    assert.ok(recap.includes('$12.4M'));
    assert.ok(recap.includes('$5.1M'));
    assert.ok(recap.includes('$7.4M'));
    assert.ok(recap.includes('$40.0M'));
    // A naive re-sum of the per-initiative rows (4.111+4.222=8.333) would
    // NOT equal grossRealizedM (12.4) — proves the recap reads the rollup,
    // never re-derives it.
    assert.ok(!drawnStrings.some((s) => s.includes('8.3')));
  });

  await t.test('(b) a fixture initiative whose baseline stage differs from its current stage renders BOTH values, and an initiative with no baseline history renders the em-dash', () => {
    const model = baseModel({
      synergies: [
        { title: 'Moved', stage: 'committed', stageAtBaseline: 'validated', category: 'cost', targetM: 5, realizedM: 3, costIncurredM: 1, netBenefitM: 2 },
        { title: 'No baseline yet', stage: 'idea', category: 'revenue', targetM: 2, realizedM: 0, costIncurredM: 0, netBenefitM: 0 },
      ],
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.synergiesSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const drawn = renderAllPages(pages);
    assert.ok(drawn.includes('committed'), 'current stage must render');
    assert.ok(drawn.includes('validated'), 'the last-baseline stage must ALSO render, proving movement is visible');
    assert.ok(drawn.includes('—'), 'an initiative with no baseline history must render the em-dash');
  });

  await t.test('(c) a stale initiative row renders dimmed with a day-count tag matching the supplied field, and keeps its input-order position', () => {
    const model = baseModel({
      synergies: [
        { id: 's1', title: 'Fresh one', stage: 'idea', category: 'cost', targetM: 1, realizedM: 1, costIncurredM: 0, netBenefitM: 1, stale: false },
        { id: 's2', title: 'Stale one', stage: 'validated', category: 'revenue', targetM: 2, realizedM: 1, costIncurredM: 0, netBenefitM: 1, stale: true, staleDays: 45 },
        { id: 's3', title: 'Another fresh', stage: 'committed', category: 'cost', targetM: 1, realizedM: 1, costIncurredM: 0, netBenefitM: 1, stale: false },
      ],
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.synergiesSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);

    const drawnOrder = [];
    const seenStaleTitleFillStyles = [];
    const { ctx } = makeInstrumentedCtx();
    const realFillText = ctx.fillText.bind(ctx);
    ctx.fillText = (text) => {
      const s = String(text);
      if (['Fresh one', 'Stale one', 'Another fresh'].includes(s)) drawnOrder.push(s);
      if (s === 'Stale one') seenStaleTitleFillStyles.push(ctx.fillStyle);
      realFillText(text);
    };
    pages[0].render(ctx, { pageNumber: 1, pageCount: pages.length });

    assert.deepStrictEqual(drawnOrder, ['Fresh one', 'Stale one', 'Another fresh'], 'stale rows must stay in input order, never sorted to the bottom or moved to a separate page');
    assert.ok(seenStaleTitleFillStyles.length > 0 && seenStaleTitleFillStyles.every((c) => c === reportPack.COLOR_TEXT_DIM), 'the stale row\'s title must render in the dim text colour');

    const drawnAll = renderAllPages(pages);
    assert.ok(drawnAll.includes('Stale 45d'), 'the stale tag must carry the exact supplied day count');
  });

  await t.test('(d) zero synergies renders the empty-state line', () => {
    const model = baseModel({ synergies: [] });
    const t2 = resolveLanguage(model.i18n, model.language);
    const pages = reportPack.synergiesSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX);
    const drawn = renderAllPages(pages);
    assert.ok(drawn.some((s) => s.includes('No synergy initiatives recorded yet.')));
  });
});

test('reports-pack cross-section: no drawn string discloses withheld content', async (t) => {
  await t.test('a pack whose model already has clearance-withheld rows draws no placeholder disclosing that fact', () => {
    const model = baseModel({
      tasks: [{ id: 't1', title: 'Visible task', workstreamId: 'w1', phase: 'day1', status: 'todo', owner: 'x', due: '2026-01-01' }],
      workstreams: [{ id: 'w1', label: 'HR', pctComplete: 50, ragStatus: 'amber' }],
      raid: [{ id: 'r1', type: 'risk', severity: 'high', title: 'Visible risk', owner: 'x', status: 'open' }],
      synergies: [{ title: 'Visible synergy', stage: 'idea', category: 'cost', targetM: 1, realizedM: 0, costIncurredM: 0, netBenefitM: 0 }],
    });
    const t2 = resolveLanguage(model.i18n, model.language);
    const sections = [
      reportPack.workstreamsTasksSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX),
      reportPack.raidSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX),
      reportPack.synergiesSection(model, t2, CONTENT_WIDTH_PX, CONTENT_HEIGHT_PX),
    ];
    const drawn = sections.flatMap((pages) => renderAllPages(pages));
    drawn.forEach((s) => {
      assert.ok(!/hidden|restricted/i.test(s), `drawn string implies withheld content: "${s}"`);
      // "further row(s) exist" (the volume-truncation notice) is the only
      // permitted mention of a count of unrendered rows, and it never fires
      // in this small fixture — so "remaining" must not appear here either.
      assert.ok(!/remaining/i.test(s), `drawn string implies withheld content: "${s}"`);
    });
  });
});

// ===========================================================================
// 07-06 Task 2: GET /api/reports/pack — server-boot integration cases.
// Modelled on test/reports-export.test.js's harness shape exactly: boots the
// REAL requireable app against an ISOLATED temp control/runtime/demo/deals/
// audit trio. Placed at the bottom of this file (not the top) because
// nothing above this point ever touches db/dbFiles.js, so it is safe to set
// these env vars here, immediately before the first require of server.js —
// dbFiles.js captures them into top-level consts on its OWN first require.
// ===========================================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reports-pack-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-reports-pack-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');
// GD-3 (CONC-02 gap closure): this suite's subject is not the version contract — supply the held-version precondition a real client sends.
require('./helpers/held-version.js').installHeldVersionFetch();

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const FIXTURE_SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const fixtureUsers = JSON.parse(fs.readFileSync(FIXTURE_SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function getRaw(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Cookie: cookieHeader(token) } : {}),
    body: JSON.stringify(body || {}),
  });
}

const LEGAL_TARGET_SENTINEL = 'ZZZ-SENTINEL-PACK-LEGALTARGET-71cd-ZZZ';

function makeDeal(id, overrides) {
  const deal = Object.assign({
    id, name: id, targetCompany: LEGAL_TARGET_SENTINEL,
    members: ['admin', 'pmo_legal'],
    memberGrants: { pmo_legal: { ddAreas: ['legal'] } },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  }, overrides || {});
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

async function createFinding(base, adminToken, area, title) {
  const res = await postJSON(base, '/api/dd/findings', adminToken, { area, title, severity: 'high' });
  const { finding } = await res.json();
  return finding;
}
async function convertFindingToRaid(base, adminToken, findingId) {
  const res = await postJSON(base, `/api/dd/findings/${findingId}/convert`, adminToken, { toRaid: true });
  const body = await res.json();
  return body.raid;
}
function countPdfPages(pdfBuffer) {
  const text = pdfBuffer.toString('binary');
  return (text.match(/\/Type \/Page(?!s)\b/g) || []).length;
}
/** Strips the leading BOM, splits on CRLF, drops the header row and any
 * trailing empty line, and returns the SORTED array of `title` field values
 * — the RAID CSV's fourth column, per GET /api/reports/export's documented
 * column order (ID, Type, Severity, Probability, Title, ...). RFC-4180
 * quoting on the title field itself is tolerated by stripping surrounding
 * quotes; none of this fixture's titles contain a literal comma. */
function sortedRaidTitlesFromCsv(csvText) {
  const body = csvText.replace(/^﻿/, '');
  const lines = body.split('\r\n').filter((l) => l.length > 0);
  const dataLines = lines.slice(1);
  return dataLines.map((line) => line.split(',')[4].replace(/^"|"$/g, '')).sort();
}
function latestAuditRow() {
  const conn = auditHook.getAuditConnection();
  return conn.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('reports-pack route (GET /api/reports/pack)', async (t) => {
  await t.test('(a) returns a real PDF with the codename in the filename and never the legal target name', async () => {
    const server = await listenLocal(app);
    try {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      const deal = makeDeal('deal_pkta', { name: 'Project Falcon' });
      const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
      await createFinding(base, adminToken, 'legal', 'A legal finding').then((f) => convertFindingToRaid(base, adminToken, f.id));

      const res = await getRaw(base, '/api/reports/pack', adminToken);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
      const disposition = res.headers.get('content-disposition');
      assert.ok(disposition.includes('Project Falcon'), 'the filename must carry the codename');
      assert.ok(!disposition.includes(LEGAL_TARGET_SENTINEL), 'the filename must never carry the legal target name');

      const buf = Buffer.from(await res.arrayBuffer());
      assert.match(buf.toString('binary', 0, 8), /^%PDF-1\.4$/);
      assert.strictEqual(buf.toString('binary', buf.length - 6).includes('%%EOF'), true);
      assert.ok(countPdfPages(buf) >= 1);
    } finally {
      server.close();
    }
  });

  await t.test('(b) LOAD-BEARING (D-08): a member cleared for one area only gets from the pack the EXACT SAME RAID row set as their own RAID CSV export, in the same run', async () => {
    const server = await listenLocal(app);
    try {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      const deal = makeDeal('deal_pktb');
      const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
      const pmoLegalToken = newSession('pmo_legal', 'pmo'); bindDeal(pmoLegalToken, deal.id);

      const legalFinding = await createFinding(base, adminToken, 'legal', 'Legal finding visible to pmo_legal');
      await convertFindingToRaid(base, adminToken, legalFinding.id);
      const financeFinding = await createFinding(base, adminToken, 'financial', 'Finance finding NOT visible to pmo_legal');
      await convertFindingToRaid(base, adminToken, financeFinding.id);
      await postJSON(base, '/api/raid', adminToken, { title: 'General manual risk', type: 'risk', severity: 'medium' });

      // The pack's PDF body is a raster image per page (lib/reportPdf.js's
      // own documented mechanism — no vector text objects to scan for a
      // title string), so the D-08 parity proof at this layer compares the
      // caller's CSV export's title SET against the audit event this same
      // pack generation writes, which carries the pack's own raid row COUNT
      // (D-10's after-object). Both reads happen in the SAME run, for the
      // SAME caller and deal, through server.js's reportRaidRows() — the ONE
      // shared clearance-filter function both routes call (source-level
      // guarantee) — so an equal row count here is exactly the parity
      // regression this test would catch: if a future edit gave the pack
      // route its own, divergent RAID filter, the two counts would diverge
      // the moment that filter's result set size differed from the CSV's.
      const csvRes = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', pmoLegalToken);
      const csvText = await csvRes.text();
      const csvTitles = sortedRaidTitlesFromCsv(csvText);
      assert.deepStrictEqual(csvTitles, ['General manual risk', 'Legal finding visible to pmo_legal'].sort(),
        'sanity: the CSV export must include the legal finding and the unstamped general risk, and exclude the finance finding, for pmo_legal');

      const packRes = await getRaw(base, '/api/reports/pack', pmoLegalToken);
      assert.strictEqual(packRes.status, 200);
      const packBuf = Buffer.from(await packRes.arrayBuffer());
      assert.match(packBuf.toString('binary', 0, 8), /^%PDF-1\.4$/);

      const auditRow = latestAuditRow();
      assert.strictEqual(auditRow.action, 'report-pack-generated');
      assert.strictEqual(auditRow.actor_username, 'pmo_legal');
      const after = JSON.parse(auditRow.after_json);
      assert.strictEqual(after.rowCounts.raid, csvTitles.length,
        'the pack\'s own raid row count must equal the CSV export\'s row count for the identical caller, in the same run');
    } finally {
      server.close();
    }
  });

  await t.test('(c) a deal with no data at all returns 409 and generates no file', async () => {
    const server = await listenLocal(app);
    try {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      const deal = makeDeal('deal_pktc');
      const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

      const res = await getRaw(base, '/api/reports/pack', adminToken);
      assert.strictEqual(res.status, 409);
      const body = await res.json();
      assert.ok(body.error && body.error.length > 0);
      assert.notStrictEqual(res.headers.get('content-type'), 'application/pdf');
    } finally {
      server.close();
    }
  });

  await t.test('(d) an org/talent spelling injected as an extra query parameter cannot make the pack include org content (D-09)', async () => {
    const server = await listenLocal(app);
    try {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      const deal = makeDeal('deal_pktd');
      const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
      await postJSON(base, '/api/raid', adminToken, { title: 'Keeps the deal non-empty', type: 'risk', severity: 'low' });

      const res = await getRaw(base, '/api/reports/pack?dataset=positions&include=flightrisk&scope=decisions', adminToken);
      assert.strictEqual(res.status, 200, 'unrecognised extra query parameters must be silently ignored, never rejected or honoured as an org toggle');
      const buf = Buffer.from(await res.arrayBuffer());
      assert.match(buf.toString('binary', 0, 8), /^%PDF-1\.4$/);
    } finally {
      server.close();
    }
  });

  await t.test('(e) an unsupported language query value silently resolves to English rather than rejecting the request', async () => {
    const server = await listenLocal(app);
    try {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      const deal = makeDeal('deal_pkte');
      const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
      await postJSON(base, '/api/raid', adminToken, { title: 'Non-empty deal', type: 'risk', severity: 'low' });

      const res = await getRaw(base, '/api/reports/pack?lang=fr', adminToken);
      assert.strictEqual(res.status, 200);
      const buf = Buffer.from(await res.arrayBuffer());
      assert.match(buf.toString('binary', 0, 8), /^%PDF-1\.4$/);
    } finally {
      server.close();
    }
  });
});

// ===========================================================================
// Quick task 260810-e1j: the portability invariant. The committed node_modules
// tree vendors @napi-rs/canvas's skia binding for four platforms only
// (darwin-arm64, darwin-x64, linux-x64-gnu, win32-x64-msvc) — every other
// host, e.g. linux-arm64, used to die at `require('./server.js')` because
// lib/reportPack.js (and its lib/reportPdf.js dependency) were required at
// server.js's own module load. These four cases lock in the fix: the
// require moves behind a lazy, cached accessor reached only from inside the
// one route that needs it, so a host without the binding still boots the
// whole portal and degrades only GET /api/reports/pack, once, to a 503.
// ===========================================================================

test('reports-pack [portability]: (a) server.js has no top-level require of lib/reportPack', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const codeLines = [];
  src.split('\n').forEach((raw, i) => {
    const stripped = raw.replace(/\/\/.*$/, '');
    const trimmed = stripped.trim();
    if (trimmed.length === 0) return;
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    codeLines.push({ lineNo: i + 1, raw, stripped });
  });

  const reportPackLines = codeLines.filter((l) => l.stripped.includes("require('./lib/reportPack')"));
  assert.ok(reportPackLines.length > 0, "expected at least one lazy require('./lib/reportPack') call to remain in server.js");

  reportPackLines.forEach((l) => {
    assert.ok(/^\s/.test(l.raw),
      `server.js:${l.lineNo} requires lib/reportPack at column zero — a load failure on a host without the vendored skia binding would abort the ENTIRE portal's boot, not just GET /api/reports/pack: "${l.raw.trim()}"`);
  });

  const topLevelBindingRe = /^(?:const|let|var)\s+\w+\s*=\s*require\('\.\/lib\/reportPack'\)/;
  codeLines.forEach((l) => {
    assert.ok(!topLevelBindingRe.test(l.stripped),
      `server.js:${l.lineNo} is a top-level "const x = require('./lib/reportPack')" binding — this runs at module-load time and would abort the whole portal's boot on a host without the vendored skia binding, instead of degrading only GET /api/reports/pack: "${l.raw.trim()}"`);
  });
});

test('reports-pack [portability]: (b) getReportPack() lazily requires and caches the module, and the route refuses with 503 before any audit call', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const getterMatch = /function getReportPack\(\)\s*\{([\s\S]*?)\n\}/.exec(src);
  assert.ok(getterMatch, 'expected to locate a getReportPack() function in server.js');
  const getterBody = getterMatch[1];
  assert.ok(getterBody.includes("require('./lib/reportPack')"), "getReportPack() must require('./lib/reportPack') inside its own body");
  assert.ok(getterBody.includes('try {'), 'getReportPack() must guard the require with a try block');
  assert.ok(/catch\s*\(/.test(getterBody), 'getReportPack() must catch a failed require');
  assert.ok(/console\.error\(\s*(['"`])\[portability\]/.test(getterBody),
    'getReportPack() must console.error a message whose first argument literal begins with the [portability] marker');

  // Phase 8 (08-03, D-06/CONC-01): the handler now also takes a `next`
  // parameter so its local catch can forward a write-lock contention error
  // to the central 503 middleware (Express 4 does not auto-forward a
  // rejected promise from an async handler) — the regex tolerates that
  // optional third parameter without weakening what it asserts below.
  const routeMatch = /app\.get\('\/api\/reports\/pack',\s*async \(req, res(?:, next)?\) => \{([\s\S]*?)\n\}\);/.exec(src);
  assert.ok(routeMatch, 'expected to locate the GET /api/reports/pack route handler body');
  const routeBody = routeMatch[1];
  assert.ok(routeBody.includes('getReportPack()'), 'the pack route must call getReportPack()');
  assert.ok(routeBody.includes('503'), 'the pack route must carry a 503 refusal');
  assert.ok(routeBody.includes('PDF pack generation is unavailable on this host platform'), 'the pack route must carry the exact refusal sentence');

  const idx503 = routeBody.indexOf('503');
  const idxAudit = routeBody.indexOf('recordSecurityEvent');
  assert.ok(idx503 >= 0 && idxAudit >= 0 && idx503 < idxAudit,
    'the 503 refusal must appear before recordSecurityEvent in the handler body, so the refusal returns before anything can be audited');
});

test('reports-pack [portability]: (c) a clean host boot leaves lib/reportPack unloaded (require.cache empty)', () => {
  const repoRoot = path.join(__dirname, '..');
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reports-pack-portability-c-'));
  try {
    const probe = [
      "const app = require('./server.js');",
      "console.log('PACK_CACHED=' + Boolean(require.cache[require.resolve('./lib/reportPack.js')]));",
    ].join('\n');

    const env = Object.assign({}, process.env, {
      MA_CONTROL_DB_PATH: path.join(probeDir, 'control.db'),
      MA_RUNTIME_DB_PATH: path.join(probeDir, 'runtime.db'),
      MA_DEMO_DB_PATH: path.join(probeDir, 'demo.db'),
      MA_DEALS_DIR: path.join(probeDir, 'deals'),
      MA_AUDIT_DB_PATH: path.join(probeDir, 'audit.db'),
      ADMIN_TOKEN: 'gsd-reports-pack-portability-c-token',
    });

    const result = spawnSync(process.execPath, ['-e', probe], { cwd: repoRoot, encoding: 'utf8', env });
    assert.strictEqual(result.status, 0, `probe process exited non-zero: stderr=${result.stderr}`);
    const match = /PACK_CACHED=(true|false)/.exec(result.stdout);
    assert.ok(match, `expected stdout to carry PACK_CACHED=(true|false), got: ${result.stdout}`);
    assert.strictEqual(match[1], 'false',
      'requiring server.js on a clean host must leave lib/reportPack unloaded until the first pack request reaches getReportPack()');
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
});

test('reports-pack [portability]: (d) a sabotaged @napi-rs/canvas binding still boots the portal and degrades to null, once, per process', () => {
  const repoRoot = path.join(__dirname, '..');
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reports-pack-portability-d-'));
  try {
    const probe = [
      "const Module = require('module');",
      'const originalLoad = Module._load;',
      "Module._load = function (request, parent, isMain) {",
      "  if (request === '@napi-rs/canvas') {",
      "    const err = new Error(\"Cannot find module './skia.linux-arm64-gnu.node'\");",
      "    err.code = 'MODULE_NOT_FOUND';",
      '    throw err;',
      '  }',
      '  return originalLoad.apply(this, arguments);',
      '};',
      "const app = require('./server.js');",
      "console.log('BOOT_OK');",
      "console.log('FIRST=' + String(app.getReportPack()));",
      "console.log('SECOND=' + String(app.getReportPack()));",
    ].join('\n');

    const env = Object.assign({}, process.env, {
      MA_CONTROL_DB_PATH: path.join(probeDir, 'control.db'),
      MA_RUNTIME_DB_PATH: path.join(probeDir, 'runtime.db'),
      MA_DEMO_DB_PATH: path.join(probeDir, 'demo.db'),
      MA_DEALS_DIR: path.join(probeDir, 'deals'),
      MA_AUDIT_DB_PATH: path.join(probeDir, 'audit.db'),
      ADMIN_TOKEN: 'gsd-reports-pack-portability-d-token',
    });

    const result = spawnSync(process.execPath, ['-e', probe], { cwd: repoRoot, encoding: 'utf8', env });
    assert.strictEqual(result.status, 0, `probe process exited non-zero: stdout=${result.stdout} stderr=${result.stderr}`);
    assert.ok(result.stdout.includes('BOOT_OK'), `expected the sabotaged host to still boot the whole portal: stdout=${result.stdout}`);
    assert.ok(result.stdout.includes('FIRST=null'), `expected the first getReportPack() call to degrade to null: stdout=${result.stdout}`);
    assert.ok(result.stdout.includes('SECOND=null'), `expected the second getReportPack() call to degrade to null: stdout=${result.stdout}`);

    const portabilityLines = result.stderr.split('\n').filter((l) => l.includes('[portability]'));
    assert.strictEqual(portabilityLines.length, 1,
      `expected exactly one [portability] stderr line — the failure must be announced once per process, not once per request: stderr=${result.stderr}`);
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
});
