// RPT-02 (07-03 Task 2): the minimal PDF 1.4 writer the steerco pack rests on.
//
// 07-RESEARCH.md settled the mechanism: @napi-rs/canvas has NO PDF-writing
// surface at all, and a vector-text PDF using the standard 14 fonts cannot
// render Czech Latin Extended-A or Chinese glyphs without a font-embedding
// subsystem. So every page is rendered as a single full-page raster image
// (canvas already solves the genuinely hard part — glyph coverage — once a
// vendored, explicitly-named font is registered) and wrapped in a
// hand-written minimal PDF 1.4 container: one /DeviceRGB /FlateDecode Image
// XObject per page, one Content stream placing it, a page tree, a catalog,
// a cross-reference table and a trailer.
//
// The critical correctness property: every xref offset below is the REAL
// byte position of its object in the assembled buffer, recorded as each
// object is appended — never derived after the fact from string lengths (a
// mixed binary-and-text buffer makes character-length arithmetic wrong in
// exactly the cases that matter, per 07-RESEARCH.md's own warning).
//
// buildPdf() intentionally takes a fully-materialised array of already-
// rendered pages, not a streaming/incremental append interface: the every-
// page "Page N of M" footer contract (07-UI-SPEC.md §5) needs the total page
// count known before page 1's footer is drawn, which requires a two-pass
// caller (measure/paginate everything first, then render each page) — see
// 07-RESEARCH.md Pitfall 5. An incremental-append interface would invite the
// bug by making the wrong usage the easy one.
'use strict';

const path = require('path');
const zlib = require('zlib');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');

// The registered family name every pack-renderer draw call must use. Never
// leave ctx.font on a generic family like 'sans-serif' — 07-RESEARCH.md
// Pitfall 1 verified live that Skia's generic font-family resolution does
// NOT fall back to a CJK-covering font for CJK codepoints; it silently
// renders empty tofu boxes with no exception, no warning, no null return.
const REPORT_FONT_FAMILY = 'MAReportFont';

const FONT_PATH = path.join(__dirname, '..', 'public', 'vendor', 'fonts', 'NotoSansSC-Regular.otf');

// Registered ONCE at module load, never per-request (07-RESEARCH.md Pattern
// 3). A pack silently rendered in a fallback font is worse than a pack that
// fails to generate at all, because the failure would only ever be visible
// to a reader of Chinese — so registration failure logs and rethrows rather
// than letting the module load succeed with unreliable glyph coverage.
(function registerReportFont() {
  let registered = false;
  try {
    registered = GlobalFonts.registerFromPath(FONT_PATH, REPORT_FONT_FAMILY);
  } catch (err) {
    console.error(`[security] lib/reportPdf.js failed to register the vendored report font from ${FONT_PATH}: ${err.message}`);
    throw err;
  }
  if (!registered) {
    const err = new Error(
      `GlobalFonts.registerFromPath returned false for ${FONT_PATH} — refusing to continue rather than let the ` +
        'pack renderer silently fall back to a generic font family (see 07-RESEARCH.md Pitfall 1: CJK glyphs ' +
        'render as blank tofu boxes with no error under a generic family name).'
    );
    console.error(`[security] ${err.message}`);
    throw err;
  }
})();

/**
 * Renders one report page to a raw RGB (alpha-stripped), zlib-deflated pixel
 * stream ready to embed as a PDF /DeviceRGB /FlateDecode Image XObject.
 *
 * The canvas is created at cssWidth*scale x cssHeight*scale device pixels,
 * filled opaque white, then the drawing context is scaled so `drawFn` can
 * work entirely in CSS-pixel coordinates matching 07-UI-SPEC.md §5's page
 * geometry. `ctx.font` defaults to the registered vendored family — drawFn
 * may override the size but should never rename the family.
 *
 * @param {(ctx: import('@napi-rs/canvas').SKRSContext2D) => void} drawFn
 * @param {number} cssWidth
 * @param {number} cssHeight
 * @param {number} [scale=2]
 * @returns {{ width: number, height: number, deflated: Buffer }}
 */
function renderPageToRgbStream(drawFn, cssWidth, cssHeight, scale = 2) {
  if (typeof drawFn !== 'function') {
    throw new TypeError('renderPageToRgbStream requires a drawFn(ctx) callback');
  }
  if (!(cssWidth > 0) || !(cssHeight > 0)) {
    throw new RangeError('renderPageToRgbStream requires positive cssWidth and cssHeight');
  }
  if (!(scale > 0)) {
    throw new RangeError('renderPageToRgbStream requires a positive scale');
  }

  const pixelWidth = Math.round(cssWidth * scale);
  const pixelHeight = Math.round(cssHeight * scale);

  const canvas = createCanvas(pixelWidth, pixelHeight);
  const ctx = canvas.getContext('2d');

  // Opaque white background — a PDF page with no explicit background would
  // otherwise carry whatever the alpha-stripped canvas default produces.
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);

  ctx.scale(scale, scale);
  ctx.font = `10px ${REPORT_FONT_FAMILY}`;

  drawFn(ctx);

  // canvas.data() returns raw RGBA bytes. No PNG/JPEG re-encoding step: the
  // bytes go straight from the canvas to the PDF stream, per 07-RESEARCH.md
  // Pattern 3.
  const rgba = canvas.data();
  const rgb = Buffer.alloc((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
  }

  return { width: pixelWidth, height: pixelHeight, deflated: zlib.deflateSync(rgb) };
}

/**
 * Assembles a complete PDF 1.4 file (as a Buffer) from an array of already-
 * rendered pages (each the return value of renderPageToRgbStream). Requires
 * the FULL array up front — this is the two-pass layout contract: the caller
 * must finish measuring/paginating every section, learn the total page
 * count, and only then render each page (now with a correct "Page N of M"
 * footer) before calling buildPdf. There is no incremental/streaming
 * page-append alternative.
 *
 * @param {Array<{ width: number, height: number, deflated: Buffer }>} pages
 * @returns {Buffer}
 */
function buildPdf(pages) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(
      'buildPdf requires a non-empty array of already-rendered pages (each from renderPageToRgbStream). ' +
        'buildPdf never accepts a streaming/incremental page-append call — see 07-RESEARCH.md Pitfall 5.'
    );
  }

  const HEADER = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');
  let body = Buffer.alloc(0);
  const offsetByObjNum = new Map();

  // Appends one indirect object's already-fully-formed bytes to the body,
  // recording ITS TRUE byte offset at append time — never computed after the
  // fact from string lengths, which would be wrong the instant a binary
  // (non-ASCII-length) stream is mixed into the buffer.
  function appendObject(objNum, buf) {
    offsetByObjNum.set(objNum, HEADER.length + body.length);
    body = Buffer.concat([body, buf]);
  }

  const CATALOG_OBJ = 1;
  const PAGES_OBJ = 2;
  let nextObjNum = 3;
  const pageObjNums = [];

  pages.forEach((page, i) => {
    if (!page || !(page.width > 0) || !(page.height > 0) || !Buffer.isBuffer(page.deflated)) {
      throw new Error(`buildPdf: page index ${i} is missing width/height/deflated — did it come from renderPageToRgbStream?`);
    }

    const imgObjNum = nextObjNum++;
    const contentObjNum = nextObjNum++;
    const pageObjNum = nextObjNum++;

    // Image XObject: the raw deflated RGB stream, no PNG/JPEG re-encoding.
    const imageHeader = Buffer.from(
      `${imgObjNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${page.deflated.length} >>\nstream\n`,
      'binary'
    );
    const imageFooter = Buffer.from('\nendstream\nendobj\n', 'binary');
    appendObject(imgObjNum, Buffer.concat([imageHeader, page.deflated, imageFooter]));

    // Content stream: place the image to fill the page. The page was
    // rendered at `scale`x device pixels for a cssWidth/cssHeight page, so
    // the point-unit page size is the pixel size divided back by that
    // scale — recovered here as width/height halves (renderPageToRgbStream's
    // default scale is 2), matching 07-RESEARCH.md's own sketch.
    const ptWidth = page.width / 2;
    const ptHeight = page.height / 2;
    const contentOps = `q ${ptWidth} 0 0 ${ptHeight} 0 0 cm /Im${i} Do Q`;
    const contentBuf = Buffer.from(
      `${contentObjNum} 0 obj\n<< /Length ${contentOps.length} >>\nstream\n${contentOps}\nendstream\nendobj\n`,
      'binary'
    );
    appendObject(contentObjNum, contentBuf);

    // Page object: media box in points, referencing both objects above.
    const pageBuf = Buffer.from(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent ${PAGES_OBJ} 0 R /MediaBox [0 0 ${ptWidth} ${ptHeight}] ` +
        `/Resources << /XObject << /Im${i} ${imgObjNum} 0 R >> >> /Contents ${contentObjNum} 0 R >>\nendobj\n`,
      'binary'
    );
    appendObject(pageObjNum, pageBuf);

    pageObjNums.push(pageObjNum);
  });

  const pagesTreeBuf = Buffer.from(
    `${PAGES_OBJ} 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`,
    'binary'
  );
  appendObject(PAGES_OBJ, pagesTreeBuf);

  const catalogBuf = Buffer.from(`${CATALOG_OBJ} 0 obj\n<< /Type /Catalog /Pages ${PAGES_OBJ} 0 R >>\nendobj\n`, 'binary');
  appendObject(CATALOG_OBJ, catalogBuf);

  // Cross-reference table: one 20-byte entry per object number 0..N-1 (object
  // 0 is always the reserved free-list head). Every entry after 0 is filled
  // from offsetByObjNum, recorded at the TRUE append-time byte position.
  const totalObjects = nextObjNum; // object numbers 1..nextObjNum-1 are used
  const xrefOffset = HEADER.length + body.length;

  function xrefEntry(offset, type) {
    // 10-digit offset + space + 5-digit generation + space + type + space + LF = 20 bytes exactly.
    return `${String(offset).padStart(10, '0')} 00000 ${type} \n`;
  }

  let xref = `xref\n0 ${totalObjects}\n`;
  xref += xrefEntry(0, 'f');
  for (let objNum = 1; objNum < totalObjects; objNum++) {
    const offset = offsetByObjNum.get(objNum);
    if (offset === undefined) {
      throw new Error(`buildPdf: internal error — object ${objNum} was never written to the body`);
    }
    xref += xrefEntry(offset, 'n');
  }

  const trailer =
    `trailer\n<< /Size ${totalObjects} /Root ${CATALOG_OBJ} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([HEADER, body, Buffer.from(xref, 'binary'), Buffer.from(trailer, 'binary')]);
}

module.exports = { renderPageToRgbStream, buildPdf, REPORT_FONT_FAMILY };
