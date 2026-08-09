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
