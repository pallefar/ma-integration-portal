// RPT-02 (07-03 Task 1 + Task 2): proves the two hardest, previously-unverified
// properties of the hand-rolled PDF pack substrate before any pack layout code
// is written.
//
// Task 1 proves the glyph-coverage half of 07-RESEARCH.md's Pitfall 1: a
// generic font family name silently renders Chinese as empty tofu boxes with
// NO exception, NO warning, and NO null return — a snapshot test that only
// compares strings would pass right through this bug. If this test ever
// starts failing, it means the pack would ship with blank Chinese labels for
// a real Chinese-language deal team.
//
// Task 2 proves the PDF container half: every cross-reference offset in a
// buildPdf() output resolves to a real object header at that exact byte
// position, using the two-pass (measure-then-render) interface the every-page
// "Page N of M" footer contract requires.
//
// node:test — run via `node --test test/reports-pdf.test.js` (or `npm test`).

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const zlib = require('zlib');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { renderPageToRgbStream, buildPdf, REPORT_FONT_FAMILY } = require('../lib/reportPdf.js');

const FONT_PATH = path.join(__dirname, '..', 'public', 'vendor', 'fonts', 'NotoSansSC-Regular.otf');
const TEST_FONT_FAMILY = 'ReportsPdfTestFont';

const registered = GlobalFonts.registerFromPath(FONT_PATH, TEST_FONT_FAMILY);
assert.ok(registered, 'vendored font must register successfully from public/vendor/fonts/');

function countNonWhitePixels(canvas) {
  const rgba = canvas.data();
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i] !== 255 || rgba[i + 1] !== 255 || rgba[i + 2] !== 255) count++;
  }
  return count;
}

function drawStringAndCountPixels(text, font) {
  const canvas = createCanvas(400, 80);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.font = font;
  ctx.fillText(text, 10, 40);
  return countNonWhitePixels(canvas);
}

test('reports-pdf glyph coverage', async (t) => {
  await t.test('(a) Chinese phrase renders real glyphs under the registered vendored font', () => {
    const pixels = drawStringAndCountPixels('战略并购整合方案', `24px ${TEST_FONT_FAMILY}`);
    assert.ok(
      pixels > 200,
      `Chinese text rendered only ${pixels} non-white pixels under the registered font — ` +
        'if this fails, the pack would ship with blank Chinese labels.'
    );
  });

  await t.test('(b) German phrase (umlauts + eszett) renders real glyphs under the registered vendored font', () => {
    const pixels = drawStringAndCountPixels('Größe: Müller Straße', `20px ${TEST_FONT_FAMILY}`);
    assert.ok(
      pixels > 200,
      `German text rendered only ${pixels} non-white pixels under the registered font — ` +
        'if this fails, the pack would ship with blank German labels.'
    );
  });

  await t.test('(c) Czech phrase (carons + ring) renders real glyphs under the registered vendored font', () => {
    const pixels = drawStringAndCountPixels('Příliš žluťoučký kůň úpěl ďábelské ódy', `16px ${TEST_FONT_FAMILY}`);
    assert.ok(
      pixels > 200,
      `Czech text rendered only ${pixels} non-white pixels under the registered font — ` +
        'if this fails, the pack would ship with blank Czech labels.'
    );
  });

  await t.test(
    '(d) the SAME Chinese phrase under a generic family name renders materially fewer pixels (the tofu pitfall)',
    () => {
      const withRegisteredFont = drawStringAndCountPixels('战略并购整合方案', `24px ${TEST_FONT_FAMILY}`);
      const withGenericFamily = drawStringAndCountPixels('战略并购整合方案', '24px sans-serif');
      assert.ok(
        withGenericFamily < withRegisteredFont * 0.5,
        `Generic "sans-serif" rendered ${withGenericFamily} non-white pixels vs ${withRegisteredFont} for the ` +
          'explicitly-registered vendored font. This is 07-RESEARCH.md Pitfall 1: a generic font family name ' +
          'can silently render Chinese as empty tofu boxes with no error — if this assertion ever stops holding, ' +
          'the pack renderer may have started relying on a generic family name and would ship with blank Chinese labels.'
      );
    }
  );

  await t.test('(e) bold synthesis from the single vendored regular weight still renders non-blank glyphs', () => {
    const pixels = drawStringAndCountPixels('战略Müller', `bold 24px ${TEST_FONT_FAMILY}`);
    assert.ok(
      pixels > 200,
      `Synthesized bold rendered only ${pixels} non-white pixels — only one regular weight is vendored ` +
        '(see 07-03-SUMMARY.md), relying on the graphics library to fake-bold it; if this fails, bold pack ' +
        'headings would render blank.'
    );
  });
});

// --- Task 2: the minimal PDF 1.4 writer ------------------------------------

/**
 * Parses the xref table out of a buildPdf() buffer by following its own
 * trailer -> startxref -> xref chain (never assuming a fixed offset), and
 * returns { totalObjects, entries: [{ objNum, offset, type }] } for every
 * entry after the reserved free-list head (object 0).
 */
function parseXref(buf) {
  const text = buf.toString('binary');
  const startxrefMatch = /startxref\n(\d+)\n%%EOF\n?$/.exec(text);
  assert.ok(startxrefMatch, 'buffer must end with startxref/<offset>/%%EOF');
  const xrefOffset = Number(startxrefMatch[1]);

  const xrefHeaderMatch = /^xref\n(\d+) (\d+)\n/.exec(text.slice(xrefOffset));
  assert.ok(xrefHeaderMatch, `no "xref\\n0 N\\n" header found at the offset startxref points to (${xrefOffset})`);
  const firstObjNum = Number(xrefHeaderMatch[1]);
  const totalObjects = Number(xrefHeaderMatch[2]);
  const entriesStart = xrefOffset + xrefHeaderMatch[0].length;

  const entries = [];
  for (let i = 0; i < totalObjects; i++) {
    const lineStart = entriesStart + i * 20;
    const line = text.slice(lineStart, lineStart + 20);
    const entryMatch = /^(\d{10}) (\d{5}) ([nf]) \n$/.exec(line);
    assert.ok(entryMatch, `xref entry ${i} is not a well-formed 20-byte entry: ${JSON.stringify(line)}`);
    entries.push({ objNum: firstObjNum + i, offset: Number(entryMatch[1]), type: entryMatch[3] });
  }
  return { totalObjects, entries };
}

test('reports-pdf minimal PDF 1.4 writer', async (t) => {
  await t.test('(f) buildPdf rejects a zero-page call with a clear error, never producing an unopenable file', () => {
    assert.throws(() => buildPdf([]), /non-empty array/);
  });

  await t.test('(g) a one-page document begins with the version header and ends with the EOF marker', () => {
    const page = renderPageToRgbStream(
      (ctx) => {
        ctx.fillStyle = '#000000';
        ctx.font = `20px ${REPORT_FONT_FAMILY}`;
        ctx.fillText('One page', 10, 30);
      },
      200,
      100
    );
    const pdf = buildPdf([page]);
    assert.match(pdf.toString('binary', 0, 8), /^%PDF-1\.4$/);
    assert.match(pdf.toString('binary', pdf.length - 6), /%%EOF\n?$/);
  });

  await t.test('(h) a three-page document contains exactly three /Type /Page objects', () => {
    const pages = [1, 2, 3].map((n) =>
      renderPageToRgbStream(
        (ctx) => {
          ctx.fillStyle = '#000000';
          ctx.font = `16px ${REPORT_FONT_FAMILY}`;
          ctx.fillText(`Page ${n} of 3`, 10, 20);
        },
        200,
        100
      )
    );
    const pdf = buildPdf(pages);
    const text = pdf.toString('binary');
    const pageObjectCount = (text.match(/\/Type \/Page(?!s)\b/g) || []).length;
    assert.strictEqual(pageObjectCount, 3, 'expected exactly one /Type /Page object per requested page');
  });

  await t.test('(i) every cross-reference offset resolves to a real object header at that exact byte position', () => {
    const pages = [1, 2, 3].map(() =>
      renderPageToRgbStream(
        (ctx) => {
          ctx.fillStyle = '#000000';
          ctx.font = `16px ${REPORT_FONT_FAMILY}`;
          ctx.fillText('Xref proof page', 10, 20);
        },
        200,
        100
      )
    );
    const pdf = buildPdf(pages);
    const { totalObjects, entries } = parseXref(pdf);
    assert.ok(totalObjects > 1, 'expected more than the reserved free-list head object');

    for (const entry of entries) {
      if (entry.type === 'f') continue; // the reserved free-list head, not a real object
      const headerAtOffset = pdf.toString('binary', entry.offset, entry.offset + 40);
      assert.match(
        headerAtOffset,
        new RegExp(`^${entry.objNum} 0 obj`),
        `xref offset ${entry.offset} for object ${entry.objNum} does not land on a matching object header ` +
          `(found: ${JSON.stringify(headerAtOffset)})`
      );
    }
  });

  await t.test('(j) the trailer names the catalog object as /Root and matches the real object count', () => {
    const page = renderPageToRgbStream((ctx) => {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 10, 10);
    }, 100, 50);
    const pdf = buildPdf([page]);
    const text = pdf.toString('binary');
    const trailerMatch = /trailer\n<< \/Size (\d+) \/Root (\d+) 0 R >>/.exec(text);
    assert.ok(trailerMatch, 'trailer must name /Size and /Root');
    const { totalObjects } = parseXref(pdf);
    assert.strictEqual(Number(trailerMatch[1]), totalObjects, '/Size must match the xref table object count');
    assert.strictEqual(Number(trailerMatch[2]), 1, '/Root must reference the catalog object (object 1)');
  });

  await t.test('(k) the deflated image stream round-trips back to the exact pixel byte length implied by the page dimensions', () => {
    const page = renderPageToRgbStream((ctx) => {
      ctx.fillStyle = '#FF0000';
      ctx.fillRect(0, 0, 50, 50);
    }, 100, 50);
    const inflated = zlib.inflateSync(page.deflated);
    assert.strictEqual(inflated.length, page.width * page.height * 3, 'RGB (alpha-stripped) byte length must be width*height*3');

    const pdf = buildPdf([page]);
    const { entries } = parseXref(pdf);
    const imageEntry = entries.find((e) => e.type === 'n' && e.objNum === 3); // first page's image object (obj 1=catalog, 2=pages tree, 3=first image)
    assert.ok(imageEntry, 'expected an image XObject at object 3');
    const streamStartMatch = /stream\n/.exec(pdf.toString('binary', imageEntry.offset, imageEntry.offset + 300));
    assert.ok(streamStartMatch, 'image object must declare a stream');
    const streamStart = imageEntry.offset + streamStartMatch.index + streamStartMatch[0].length;
    const embeddedDeflated = pdf.subarray(streamStart, streamStart + page.deflated.length);
    assert.deepStrictEqual(embeddedDeflated, page.deflated, 'the embedded stream bytes must be byte-identical to the deflated buffer renderPageToRgbStream produced');
  });

  await t.test('(l) renderPageToRgbStream rejects non-positive dimensions and a non-function drawFn', () => {
    assert.throws(() => renderPageToRgbStream(() => {}, 0, 100), /positive/);
    assert.throws(() => renderPageToRgbStream(() => {}, 100, -1), /positive/);
    assert.throws(() => renderPageToRgbStream('not a function', 100, 100), /drawFn/);
  });
});
