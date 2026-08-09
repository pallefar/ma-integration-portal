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
