// SAFE-02 / D-13-03 (Phase 13, plan 13-11): the first-party overview decks and the handlers that
// transitions.js generates at runtime must run under script-src 'self' (no 'unsafe-inline').
//
// What is asserted:
//   1. each public/overview-deck/*.html in DECKS is inline-free (no <script> without src, no on*=
//      attribute, no javascript: URL), loads its code from /js/overview-deck/<deck>.js at the
//      former position, and the SERVED page carries a 16-hex content-hash stamp equal to
//      sha256(GET <that url>) (the Phase-12 invariant extends to the deck scripts);
//   2. transitions.js generates no inline handler and no javascript: URL: sidebar launchers use
//      href="#" (their listeners call preventDefault), the quick-nav hover is a CSS :hover rule,
//      the survey-scores modal close button is wired with addEventListener, and the sidebar
//      slide-link builder (addSlide) builds its icon/label with textContent (D-13-02);
//   3. a client-JS-wide static gate: no string literal under public/js (vendor excluded) carries an
//      inline handler attribute or a javascript: URL.
//
// node:test — run via `node --test test/csp-inline-free-decks.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { listenLocal } = require('./helpers/listen-local');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DECK_DIR = path.join(PUBLIC, 'overview-deck');
const DECK_JS_DIR = path.join(PUBLIC, 'js', 'overview-deck');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-csp-inline-free-decks-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const app = require('../server.js');

const sha16 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

let server;
let base;
test.before(async () => {
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------- inline-free checker ---

// [security] WR-B06 (Phase 13 review, Part B): attribute values are judged the way
// the browser reads them - character references decoded, tab/newline/controls
// dropped - so `&#106;avascript:` / `java&Tab;script:` cannot pass as text.
const NAMED_ENTITIES = { tab: '\t', newline: '\n', colon: ':', lpar: '(', rpar: ')', sol: '/', quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&#x([0-9a-f]+);?/gi, (m, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff) || 0xfffd))
    .replace(/&#(\d+);?/g, (m, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff) || 0xfffd))
    .replace(/&([a-z]+);/gi, (m, n) => (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, n.toLowerCase()) ? NAMED_ENTITIES[n.toLowerCase()] : m));
}
const compactScheme = (s) => decodeEntities(s).replace(/[\u0000- \u007f- ­​]/g, '');

/** Violations of the strict policy in one HTML document (comments are ignored). */
function inlineViolations(html) {
  const out = [];
  const body = html.replace(/<!--[\s\S]*?-->/g, '');
  const scriptRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = scriptRe.exec(body)) !== null) {
    const srcAttr = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    if (!srcAttr) { out.push('inline <script> (no src): ' + m[0]); continue; }
    const url = compactScheme(srcAttr[1] || srcAttr[2] || srcAttr[3] || '');
    if (!/^\/(?:js|vendor)\//.test(url)) out.push('<script src> outside /js/ and /vendor/: ' + url.slice(0, 60));
  }
  const tagRe = /<[a-zA-Z][^>]*>/g;
  while ((m = tagRe.exec(body)) !== null) {
    const attrs = m[0].replace(/"[^"]*"|'[^']*'/g, '""');
    const handler = /[\s/]on[a-z]+\s*=/i.exec(attrs);
    if (handler) out.push('inline handler attribute ' + handler[0].trim() + ' in ' + m[0].slice(0, 80));
    const urlAttr = /\b(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
    let u;
    while ((u = urlAttr.exec(m[0])) !== null) {
      if (/^javascript:/i.test(compactScheme(u[1] || u[2] || u[3] || ''))) out.push('javascript: URL in ' + m[0].slice(0, 80));
    }
  }
  return out;
}

// Every first-party deck page; the set is also cross-checked against the directory listing below,
// so a deck added later without a gate entry fails.
const DECKS = ['agenda', 'deck', 'easter-egg', 'slide5', 'slide6', 'working-in-a-matrix'];

test('DECKS lists every public/overview-deck/*.html', () => {
  const onDisk = fs.readdirSync(DECK_DIR).filter((f) => f.endsWith('.html')).map((f) => f.replace(/\.html$/, '')).sort();
  assert.deepStrictEqual(onDisk, DECKS.slice().sort());
});

test('checker self-test: it flags inline scripts, handlers and javascript: URLs and passes external scripts', () => {
  assert.strictEqual(inlineViolations('<script src="/js/a.js?v=1"></script><a href="#">x</a>').length, 0);
  assert.strictEqual(inlineViolations('<script>var a=1;</script>').length, 1);
  assert.strictEqual(inlineViolations('<button onclick="x()">y</button>').length, 1);
  assert.strictEqual(inlineViolations('<a href="javascript:void(0)">y</a>').length, 1);
  assert.strictEqual(inlineViolations('<!-- <script>var a=1;</script> --><p>ok</p>').length, 0);
});

test('checker negative control (WR-B06): slash-separated handlers, encoded schemes and non-/js/ script sources are caught', () => {
  for (const html of [
    '<img/onerror="alert(1)" src=x>',
    '<svg/onload=alert(1)>',
    '<a href="&#106;avascript:alert(1)">a</a>',
    '<a href="&#x6A;avascript:alert(1)">a</a>',
    '<a href="java&Tab;script:alert(1)">a</a>',
    '<a href=javascript:alert(1)>a</a>',
    '<script src="data:text/javascript,alert(1)"></script>',
    '<script src="https://cdn.example/x.js"></script>',
  ]) assert.ok(inlineViolations(html).length >= 1, `must be caught: ${html}`);
  assert.strictEqual(inlineViolations('<script src="/js/overview-deck/deck.js?v=1"></script><a href="agenda.html" title="on=x">x</a>').length, 0);
});

for (const deck of DECKS) {
  test(`deck ${deck}.html is inline-free, loads /js/overview-deck/${deck}*.js, and is served with content-hash stamps`, async () => {
    const file = path.join(DECK_DIR, deck + '.html');
    const html = fs.readFileSync(file, 'utf8');
    assert.deepStrictEqual(inlineViolations(html), [], `${deck}.html source`);
    const refs = [];
    const re = /<script\b[^>]*\bsrc\s*=\s*["'](\/js\/overview-deck\/[A-Za-z0-9_.\-]+\.js)(?:\?v=[A-Za-z0-9_.\-]+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) refs.push(m[1]);
    assert.ok(refs.length >= 1, `${deck}.html must load its code from /js/overview-deck/`);
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(PUBLIC, ref)), `${ref} must exist`);
      assert.ok(fs.existsSync(path.join(DECK_JS_DIR, path.basename(ref))));
    }

    const res = await fetch(`${base}/overview-deck/${deck}.html`);
    assert.strictEqual(res.status, 200);
    const served = await res.text();
    assert.deepStrictEqual(inlineViolations(served), [], `${deck}.html as served`);
    for (const ref of refs) {
      const stamped = new RegExp(ref.replace(/[.]/g, '\\.') + '\\?v=([0-9a-f]{16})["\']').exec(served);
      assert.ok(stamped, `${ref} must carry a 16-hex stamp in the served page`);
      const asset = await fetch(`${base}${ref}?v=${stamped[1]}`);
      assert.strictEqual(asset.status, 200);
      assert.strictEqual(stamped[1], sha16(Buffer.from(await asset.arrayBuffer())), `${ref} stamp == sha256(served body)`);
    }
  });
}

// ----------------------------------------------------------- transitions.js templates ---

const TRANSITIONS = fs.readFileSync(path.join(PUBLIC, 'js', 'transitions.js'), 'utf8');

test('transitions.js sidebar survey and easter-egg launchers carry href="#" (not javascript:void(0))', () => {
  assert.match(TRANSITIONS, /<a href="#" class="sidebar-link" id="sidebar-survey-link"/);
  assert.match(TRANSITIONS, /<a href="#" class="sidebar-link sidebar-egg" data-html-slide="\/overview-deck\/easter-egg\.html"/);
  const wired = /sidebarSurveyLink\.addEventListener\('click', \(e\) => \{\s*(?:\/\/[^\n]*\n\s*)*e\.preventDefault\(\);/.exec(TRANSITIONS);
  assert.ok(wired, 'the survey link click handler must call preventDefault');
});

test('transitions.js quick-nav/notification hover is a CSS rule, not generated onmouseover/onmouseout', () => {
  assert.doesNotMatch(TRANSITIONS, /onmouseover|onmouseout/);
  assert.match(TRANSITIONS, /class="sidebar-notif-item"/);
  const css = fs.readFileSync(path.join(PUBLIC, 'css', 'style.css'), 'utf8');
  assert.match(css, /\.sidebar-notif-item:hover\s*\{\s*background:\s*rgba\(233,\s*131,\s*0,\s*0\.08\)/);
});

test('survey-scores modal close button has no inline handler and is wired with addEventListener', () => {
  assert.doesNotMatch(TRANSITIONS, /ai-insight-modal-close"[^>]*onclick/);
  assert.match(TRANSITIONS, /id="survey-scores-modal-close"/);
  assert.match(TRANSITIONS, /getElementById\('survey-scores-modal-close'\);[\s\S]{0,200}addEventListener\('click'/);
});

/** Source of `const <name> = (...) => { ... };` by brace matching from the arrow's opening brace. */
function functionBody(src, name) {
  const start = src.indexOf('const ' + name + ' = ');
  assert.ok(start >= 0, `could not locate ${name}`);
  const open = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced braces in ' + name);
}
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('addSlide (sidebar slide-link builder) uses href="#", textContent for icon + label and no HTML-string sink (D-13-02)', () => {
  const body = stripJsComments(functionBody(TRANSITIONS, 'addSlide'));
  assert.doesNotMatch(body, /javascript:/);
  assert.match(body, /a\.href = '#'/);
  assert.match(body, /iconEl\.textContent = /);
  assert.match(body, /labelEl\.textContent = /);
  assert.doesNotMatch(body, /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/, 'no HTML-string sink in addSlide');
  assert.match(body, /e\.preventDefault\(\);\s*window\.openHtmlSlide\(/);
});

// ---------------------------------------------------- client-JS-wide static gate (SAFE-02) ---

/** Every .js file under public/js (vendored code lives in public/vendor, never here; excluded defensively). */
function clientJsFiles(dir = path.join(PUBLIC, 'js')) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (ent.name !== 'vendor') out.push(...clientJsFiles(full)); }
    else if (ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Recorded allowlist: exact trimmed code lines that mention `javascript:` ON PURPOSE because they are
// scheme GUARDS (they reject or skip such URLs), not producers of one. Comment-only lines are skipped
// separately. Anything else naming `javascript:` in public/js fails the gate.
const JAVASCRIPT_SCHEME_GUARD_LINES = new Set([
  "if (href.indexOf('javascript:') === 0) return '';", // transitions.js tokenOf: javascript: hrefs carry no menu token
]);

// WR-B06: no quote is required after `=` (an unquoted `onerror=alert(1)` runs just
// the same) and a slash separator counts (`<img/onerror=…>`); a handler set by
// name through setAttribute('on…') is the same thing built by DOM.
const HANDLER_ATTR_IN_STRING = /[\s"'`/]on[a-z]+\s*=/;
const HANDLER_SET_ATTRIBUTE = /\.setAttribute\(\s*['"`]on/i;

test('client JS tree: no string literal carries an inline handler attribute or a javascript: URL', () => {
  const files = clientJsFiles();
  assert.ok(files.length >= 30, 'expected the shipped client scripts under public/js');
  const hits = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (/^(?:\/\/|\/\*|\*)/.test(trimmed)) return; // comment-only line
      if (HANDLER_ATTR_IN_STRING.test(line)) hits.push(`${rel}:${idx + 1}: inline handler attribute: ${trimmed.slice(0, 120)}`);
      if (HANDLER_SET_ATTRIBUTE.test(line)) hits.push(`${rel}:${idx + 1}: setAttribute of an on* handler: ${trimmed.slice(0, 120)}`);
      // WR-B06: judged decoded + whitespace-free (`'&#106;avascript:'` in a markup string).
      if (/javascript:/i.test(compactScheme(line)) && !JAVASCRIPT_SCHEME_GUARD_LINES.has(trimmed)) {
        hits.push(`${rel}:${idx + 1}: javascript: URL: ${trimmed.slice(0, 120)}`);
      }
    });
  }
  assert.deepStrictEqual(hits, [], 'inline handlers / javascript: URLs found:\n  ' + hits.join('\n  '));
});

test('client JS gate self-test: the handler pattern catches the shapes transitions.js used to generate', () => {
  assert.ok(HANDLER_ATTR_IN_STRING.test(`<button class="x" onclick="document.getElementById('a').style.display='none'">`));
  assert.ok(HANDLER_ATTR_IN_STRING.test(`'<a style="" onmouseover="this.style.background=\\'x\\'" onmouseout="...">'`));
  assert.ok(!HANDLER_ATTR_IN_STRING.test(`btn.onclick = function () {}`));
  assert.ok(!HANDLER_ATTR_IN_STRING.test(`a.addEventListener('click', fn)`));
  // WR-B06 negative controls: the shapes the quoted-only pattern missed.
  assert.ok(HANDLER_ATTR_IN_STRING.test(`'<img src=x onerror=alert(1)>'`));
  assert.ok(HANDLER_ATTR_IN_STRING.test('`<img/onerror=alert(1)>`'));
  assert.ok(HANDLER_SET_ATTRIBUTE.test(`el.setAttribute('onclick', handlerSrc)`));
  assert.ok(HANDLER_SET_ATTRIBUTE.test('el.setAttribute( "onload" , f)'));
  assert.ok(!HANDLER_SET_ATTRIBUTE.test(`el.setAttribute('data-on', 'x')`));
  assert.ok(/javascript:/i.test(compactScheme(`el.innerHTML = '<a href="&#106;avascript:alert(1)">x</a>';`)));
  assert.ok(/javascript:/i.test(compactScheme(`'<a href="java&Tab;script:alert(1)">'`)));
});
