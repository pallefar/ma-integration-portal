// SAFE-03 / D-13-04 (b) (Phase 13, plan 13-03): the client half of slide safety.
// Source-level asserts (readFileSync + regex) — the established pattern for this
// framework-less, no-build-step client (see test/client-xss-sinks.test.js).
//
//   Task 1: openHtmlSlide() builds its overlay with createElement/textContent and
//           frames every non-PDF slide with sandbox="allow-scripts" only.
//   Task 3: the admin upload client (accept list, base64 branch, fixed refusal text).
//
// Run via `node --test test/slide-sandbox-client.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const readPublic = (...segments) => fs.readFileSync(path.join(__dirname, '..', 'public', ...segments), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

function openHtmlSlideRegion() {
  const src = readPublic('js', 'transitions.js');
  const start = src.indexOf('function openHtmlSlide(url, label) {');
  const end = src.indexOf('window.openHtmlSlide = openHtmlSlide;');
  assert.ok(start > 0 && end > start, 'expected to locate openHtmlSlide and its window export');
  return src.slice(start, end);
}

test('slide-sandbox-client (a): openHtmlSlide builds the overlay with createElement/textContent — no innerHTML, no HTML string assembly', () => {
  const region = stripComments(openHtmlSlideRegion());
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(region), 'no HTML-parsing sink inside openHtmlSlide');
  assert.ok(/createElement\('iframe'\)/.test(region), 'the frame is created with createElement');
  assert.ok(/title\.textContent\s*=/.test(region), 'the label is set via textContent');
  assert.ok(/frame\.title\s*=\s*text/.test(region), 'the frame title is the raw label property, not markup');
  assert.ok(/closeBtn\.textContent\s*=/.test(region) && /open\.textContent\s*=/.test(region));
});

test('slide-sandbox-client (b): non-PDF slides are framed with sandbox="allow-scripts" and nothing more; PDFs are exempt (PD-17)', () => {
  const region = stripComments(openHtmlSlideRegion());
  const tokens = region.match(/allow-scripts/g) || [];
  assert.strictEqual(tokens.length, 1, 'exactly one allow-scripts in the openHtmlSlide region');
  assert.ok(/setAttribute\('sandbox',\s*'allow-scripts'\)/.test(region), 'sandbox attribute is exactly allow-scripts');
  for (const bad of ['allow-same-origin', 'allow-top-navigation', 'allow-forms', 'allow-popups', 'allow-modals', 'allow-downloads']) {
    assert.ok(!region.includes(bad), `${bad} must never be granted`);
  }
  assert.ok(/if \(!isPdf\) frame\.setAttribute\('sandbox'/.test(region), 'the sandbox is skipped only for a .pdf path');
  assert.ok(/\\\.pdf\$\/i\.test\(u\.pathname\)/.test(region), 'PDF detection looks at the URL path, not the query');
  // the sandbox attribute is set BEFORE src is assigned (the navigation must start sandboxed)
  assert.ok(region.indexOf("setAttribute('sandbox'") < region.indexOf('frame.src ='), 'sandbox is applied before the frame navigates');
});

test('slide-sandbox-client (c): the new-tab link is noopener noreferrer, the URL is http(s)-validated and the delegated click handler prevents default', () => {
  const region = stripComments(openHtmlSlideRegion());
  assert.ok(/open\.rel\s*=\s*'noopener noreferrer'/.test(region));
  assert.ok(/open\.target\s*=\s*'_blank'/.test(region));
  assert.ok(/u\.protocol === 'http:' \|\| u\.protocol === 'https:'/.test(region), 'only http(s) URLs are framed or linked');
  const src = readPublic('js', 'transitions.js');
  const handler = /\[data-html-slide\]'\);\s*\n\s*if \(t\) \{([^}]*)\}/.exec(src);
  assert.ok(handler, 'expected to locate the delegated [data-html-slide] click handler');
  assert.ok(/e\.preventDefault\(\)/.test(handler[1]), 'the delegated handler must call preventDefault()');
});

test('slide-sandbox-client (d): the overview deck still frames deck.html itself (unsandboxed), so its parent.postMessage bridge keeps working; slides it opens go through openHtmlSlide', () => {
  const overview = readPublic('overview.html');
  assert.ok(/<iframe id="deckframe" src="\/overview-deck\/deck\.html"/.test(overview), 'overview.html frames deck.html directly');
  assert.ok(!/id="deckframe"[^>]*sandbox/.test(overview), 'the deck frame itself is not sandboxed (it is first-party markup)');
  assert.ok(/d\.type === 'open-slide'[\s\S]{0,200}window\.openHtmlSlide\(d\.url/.test(overview), 'open-slide messages are routed to openHtmlSlide');
  const deck = readPublic('overview-deck', 'deck.html');
  assert.ok(/parent\.postMessage\(\{type:'open-slide'/.test(deck) && /parent\.postMessage\(\{type:'deck-overlay'/.test(deck));
  // built-in decks opened via openHtmlSlide must not depend on same-origin access
  for (const f of ['slide5.html', 'slide6.html', 'easter-egg.html', 'working-in-a-matrix.html', 'agenda.html']) {
    const html = stripComments(readPublic('overview-deck', f));
    assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB|fetch\(|XMLHttpRequest|parent\.|window\.top|top\.location/.test(html),
      `${f} must not need same-origin storage/network/parent access (it is framed sandboxed)`);
  }
});

// ============================================================ Task 3 (admin) ===
function slideLibraryRegion() {
  const src = readPublic('js', 'admin-cms.js');
  const start = src.indexOf('function renderSlides() {');
  const end = src.indexOf('// ---------- Projects');
  assert.ok(start > 0 && end > start, 'expected to locate the slide library section of admin-cms.js');
  return src.slice(start, end);
}

test('slide-sandbox-client (e): the admin file input accepts exactly the allowlisted slide types', () => {
  const region = slideLibraryRegion();
  const m = /<input type="file"[^>]*id="sl-file"[^>]*accept="([^"]*)"/.exec(region);
  assert.ok(m, 'expected to locate the slide file input');
  assert.deepStrictEqual(m[1].split(',').sort(), ['.htm', '.html', '.jpeg', '.jpg', '.pdf', '.png', '.webp']);
  assert.ok(!/svg/i.test(m[1]), 'SVG is never offered');
});

test('slide-sandbox-client (f): HTML is sent as text, binary types as base64 with the browser type; refusals show the fixed server text via the textContent toast', () => {
  const region = stripComments(slideLibraryRegion());
  assert.ok(/\/\\\.html\?\$\/i\.test\(file\.name\)/.test(region), 'HTML is detected by extension');
  assert.ok(/content: await file\.text\(\)/.test(region), 'HTML keeps the utf8 text contract');
  assert.ok(/readAsDataURL\(file\)/.test(region), 'binary types are read as a data URL');
  assert.ok(/encoding: 'base64'/.test(region) && /type: file\.type/.test(region), 'base64 branch sends encoding and the declared type');
  assert.ok(/dataUrl\.slice\(dataUrl\.indexOf\(','\) \+ 1\)/.test(region), 'only the part after the comma is sent');
  assert.ok(/!res\.ok \|\| !up \|\| !up\.url/.test(region), 'any non-2xx response is a refusal');
  assert.ok(/toast\(\(up && typeof up\.error === 'string' && up\.error\) \|\| 'Upload refused\.', true\)/.test(region),
    'the refusal text falls back to "Upload refused."');
  assert.ok(!/innerHTML[^;\n]*up\.error/.test(region), 'the server error text is never interpolated into markup');
  // the toast itself renders with textContent
  const admin = readPublic('js', 'admin.js');
  const toast = /function showNotification\(msg, isError = false\) \{([\s\S]*?)\n  \}\n/.exec(admin);
  assert.ok(toast && /banner\.textContent = msg;/.test(toast[1]) && !/innerHTML/.test(toast[1]), 'adminToast renders via textContent');
});

test('slide-sandbox-client (g): the slide library list sets label/url/pages via textContent, never interpolating them into markup', () => {
  const region = stripComments(slideLibraryRegion());
  const list = region.slice(region.indexOf('function renderSlides() {'), region.indexOf('function editSlide('));
  assert.ok(/\.cms-row-title'\)\.textContent\s*=/.test(list) && /\.cms-row-sub'\)\.textContent\s*=/.test(list));
  const tpl = /row\.innerHTML = `([\s\S]*?)`;/.exec(list);
  assert.ok(tpl, 'expected to locate the row template');
  assert.ok(!/\$\{/.test(tpl[1]), 'the row template interpolates nothing');
});
