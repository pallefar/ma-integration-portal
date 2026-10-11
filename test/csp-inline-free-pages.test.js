// SAFE-02 (D-13-03, plan 13-10): the seven app pages carry NO inline code.
//
// An enforced `script-src 'self' 'wasm-unsafe-eval'` policy (no 'unsafe-inline')
// blocks every inline <script> block, every inline `on*=` handler attribute and
// every `javascript:` URL. Those had to leave the HTML first. This is the static
// gate that keeps them out:
//   * assertInlineFree(page) — comment-stripped scan of the HTML for an inline
//     <script> (no src), an `on*=` attribute on any tag, a `javascript:` URL and
//     `srcdoc`;
//   * the page's former inline blocks are external files under /js/pages/,
//     referenced with `?v=` so the serve-time content-hash stamp applies, and
//     those files must not re-create inline handlers via string markup;
//   * served through the app (isolated MA_* temp block) each page references
//     `/js/pages/<file>?v=<16 hex>` and the stamp equals sha256(served body).
//
// node:test — run via `node --test test/csp-inline-free-pages.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { listenLocal } = require('./helpers/listen-local');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-csp-inline-free-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const app = require('../server.js');

const sha16 = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);

// page -> the external files (in document order) that replaced its inline code.
const OWNED = {
  'dashboard.html': ['dashboard-1.js', 'dashboard-2.js'],
  'index.html': ['index-1.js'],
  'insights.html': ['insights-1.js'],
  'overview.html': ['overview-1.js'],
  'playbook.html': ['playbook-1.js'],
  'signage.html': ['signage-1.js'],
  'admin.html': ['admin-actions.js'],
};

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

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

// [security] WR-B06 (Phase 13 review, Part B): the browser decodes character
// references inside attribute values and drops tab/newline anywhere in a URL, so
// `&#106;avascript:`, `&#x6A;avascript:` and `java&Tab;script:` all execute. The
// scheme test runs on the DECODED, whitespace/control-free text.
const NAMED_ENTITIES = { tab: '\t', newline: '\n', colon: ':', lpar: '(', rpar: ')', sol: '/', quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' };
function decodeEntities(s) {
  return s.replace(/&#x([0-9a-f]+);?/gi, (m, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff) || 0xfffd))
    .replace(/&#(\d+);?/g, (m, d) => String.fromCodePoint(Math.min(Number(d), 0x10ffff) || 0xfffd))
    .replace(/&([a-z]+);/gi, (m, n) => (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, n.toLowerCase()) ? NAMED_ENTITIES[n.toLowerCase()] : m));
}
const compactScheme = (s) => decodeEntities(s).replace(/[\u0000- \u007f- ­​]/g, '');

// Returns the list of violations for an HTML source (empty = inline-free).
function inlineViolations(html) {
  const src = stripComments(html);
  const v = [];
  // inline <script>: an opening tag that has no src attribute. An external
  // script must come from /js/ or /vendor/ - a `data:`/`blob:`/remote src is
  // inline (or third-party) code by another name (WR-B06).
  const scriptRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = scriptRe.exec(src)) !== null) {
    const srcAttr = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[1]);
    if (!srcAttr) { v.push(`inline <script${m[1]}>`); continue; }
    const url = compactScheme(srcAttr[1] || srcAttr[2] || srcAttr[3] || '');
    if (!/^\/(?:js|vendor)\//.test(url)) v.push(`<script src> outside /js/ and /vendor/: ${url.slice(0, 60)}`);
  }
  // inline handler attributes: any `on<name>=` attribute inside a start tag,
  // whitespace- OR slash-separated (`<img/onerror=…>`, the R1-03 trick)
  const tagRe = /<[a-zA-Z][^>]*>/g;
  while ((m = tagRe.exec(src)) !== null) {
    const attrs = m[0].replace(/"[^"]*"|'[^']*'/g, '""'); // values out of the way
    const h = attrs.match(/[\s/]on[a-z]+\s*=/i);
    if (h) v.push(`inline handler ${h[0].trim()} in ${m[0].slice(0, 80)}`);
  }
  if (/javascript:/i.test(compactScheme(src))) v.push('javascript: URL');
  if (/\bsrcdoc\s*=/i.test(src)) v.push('srcdoc attribute');
  return v;
}

function assertInlineFree(htmlPath) {
  const v = inlineViolations(fs.readFileSync(htmlPath, 'utf8'));
  assert.deepStrictEqual(v, [], `${path.basename(htmlPath)} carries inline code:\n  ` + v.join('\n  '));
}

// External files must not rebuild inline handlers / javascript: URLs as markup.
function externalViolations(js) {
  const v = [];
  const markupHandler = /<[a-zA-Z][^>]*[\s/]on[a-z]+\s*=/;
  if (markupHandler.test(js)) v.push('string markup with an inline on*= handler');
  if (/\.setAttribute\(\s*['"`]on/i.test(js)) v.push('setAttribute of an on* handler attribute');
  if (/["'`]\s*javascript\s*:/i.test(js) || /href\s*=\s*["']?\s*javascript:/i.test(js)) v.push('javascript: URL in a string');
  return v;
}

test('negative control: the scanner catches an inline block, a handler, a javascript: link and srcdoc', () => {
  const bad = '<html><body><script>1</script><button onclick="x()">b</button><a href="javascript:void(0)">a</a><iframe srcdoc="x"></iframe></body></html>';
  const v = inlineViolations(bad);
  assert.ok(v.some((x) => /inline <script/.test(x)));
  assert.ok(v.some((x) => /inline handler/.test(x)));
  assert.ok(v.some((x) => /javascript:/.test(x)));
  assert.ok(v.some((x) => /srcdoc/.test(x)));
  assert.deepStrictEqual(inlineViolations('<script src="/js/a.js?v=1"></script><!-- <script>1</script> onclick="x" --><button data-action="go">b</button>'), []);
  assert.ok(externalViolations('el.innerHTML = \'<a onclick="x()">\';').length > 0);
  assert.deepStrictEqual(externalViolations('el.addEventListener("click", function(){ if (a.onclick) {} });'), []);
});

test('negative control (WR-B06): slash-separated handlers, entity/tab-obfuscated schemes and non-/js/ script sources are caught', () => {
  const probes = [
    ['<img/onerror="alert(1)" src=x>', /inline handler/],
    ['<svg/onload=alert(1)>', /inline handler/],
    ['<a href="&#106;avascript:alert(1)">a</a>', /javascript:/],
    ['<a href="&#x6A;avascript:alert(1)">a</a>', /javascript:/],
    ['<a href="&#X6a;avascript&#58;alert(1)">a</a>', /javascript:/],
    ['<a href="java&Tab;script:alert(1)">a</a>', /javascript:/],
    ['<a href="java&NewLine;script&colon;alert(1)">a</a>', /javascript:/],
    ['<a href=" javascript:alert(1)">a</a>', /javascript:/],
    ['<script src="data:text/javascript,alert(1)"></script>', /outside \/js\//],
    ['<script src="https://cdn.example/x.js"></script>', /outside \/js\//],
    ['<script src=//cdn.example/x.js></script>', /outside \/js\//],
    ['<script src="blob:https://x/1"></script>', /outside \/js\//],
  ];
  for (const [html, re] of probes) {
    const v = inlineViolations(html);
    assert.ok(v.some((x) => re.test(x)), `must be caught: ${html} (got ${JSON.stringify(v)})`);
  }
  assert.deepStrictEqual(inlineViolations('<script src="/vendor/transformers/transformers.min.js"></script><script src="/js/pages/a.js?v=1"></script><img src="/a.png" data-on="x" alt="online=yes">'), []);
  // An external script that rebuilds a handler without quotes, or via setAttribute, is caught too.
  assert.ok(externalViolations("el.innerHTML = '<img src=x onerror=alert(1)>';").length > 0);
  assert.ok(externalViolations("el.setAttribute('onclick', 'x()');").length > 0);
  assert.ok(externalViolations('el.setAttribute( "onload" , f);').length > 0);
});

for (const [page, files] of Object.entries(OWNED)) {
  test(`${page}: no inline <script>, no on*= handler, no javascript: URL, no srcdoc`, () => {
    assertInlineFree(path.join(PUBLIC, page));
  });

  test(`${page}: the former inline code is external under /js/pages/ with a ?v= stamp, in order`, () => {
    const html = stripComments(fs.readFileSync(path.join(PUBLIC, page), 'utf8'));
    const refs = [];
    const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) refs.push(m[1]);
    let last = -1;
    for (const f of files) {
      const idx = refs.findIndex((r) => r.startsWith(`/js/pages/${f}?v=`));
      assert.ok(idx > -1, `${page} must reference /js/pages/${f}?v=`);
      assert.ok(idx > last, `${page}: /js/pages/${f} is out of order`);
      last = idx;
      const file = path.join(PUBLIC, 'js', 'pages', f);
      assert.ok(fs.existsSync(file), `public/js/pages/${f} must exist`);
      const v = externalViolations(fs.readFileSync(file, 'utf8'));
      assert.deepStrictEqual(v, [], `public/js/pages/${f}: ` + v.join('; '));
    }
  });

  test(`${page}: served through the app, each external file is stamped sha256(body) and 200 javascript`, async () => {
    const res = await fetch(`${base}/${page}`);
    assert.strictEqual(res.status, 200);
    const html = await res.text();
    for (const f of files) {
      const m = html.match(new RegExp(`/js/pages/${f.replace(/\./g, '\\.')}\\?v=([0-9a-f]{16})\\b`));
      assert.ok(m, `${page} must serve /js/pages/${f}?v=<16 hex>`);
      const a = await fetch(`${base}/js/pages/${f}?v=${m[1]}`);
      assert.strictEqual(a.status, 200);
      assert.match(a.headers.get('content-type') || '', /javascript/);
      const body = Buffer.from(await a.arrayBuffer());
      assert.strictEqual(m[1], sha16(body), `${f}: stamp must equal sha256(served body)`);
    }
    assert.deepStrictEqual(inlineViolations(html), [], `${page} as served must be inline-free`);
  });
}

// ---------------------------------------------------------------------------
// Behaviour-preserving replacements named by the plan
// ---------------------------------------------------------------------------
function jsRefs(page) {
  const html = stripComments(fs.readFileSync(path.join(PUBLIC, page), 'utf8'));
  const refs = [];
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) if (m[1].startsWith('/js/')) refs.push(m[1]);
  return refs;
}

test('signage.html: /js/safe-html.js?v= is the FIRST /js/ script, exactly once, and [data-i18n-html] renders through MASafeHtml', () => {
  const refs = jsRefs('signage.html');
  assert.ok(refs.length > 0);
  assert.ok(refs[0].startsWith('/js/safe-html.js?v='), `first /js/ script must be safe-html.js, got ${refs[0]}`);
  assert.strictEqual(refs.filter((r) => r.startsWith('/js/safe-html.js')).length, 1);
  const js = fs.readFileSync(path.join(PUBLIC, 'js', 'pages', 'signage-1.js'), 'utf8');
  assert.ok(/MASafeHtml\.render\(/.test(js), 'signage-1.js must render data-i18n-html through MASafeHtml.render');
  assert.ok(!/\.(?:inner|outer)HTML\s*=/.test(js), 'signage-1.js must not assign inner/outerHTML');
});

test('admin.html: handlers are data-action delegates in /js/pages/admin-actions.js, loaded after ted-launcher.js', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'admin.html'), 'utf8');
  assert.match(html, /id="btn-admin-view-pmo"[^>]*data-action="open-pmo"/);
  assert.match(html, /id="btn-admin-launch-doom"[^>]*data-action="launch-ted"/);
  const refs = jsRefs('admin.html');
  const ted = refs.findIndex((r) => r.startsWith('/js/ted-launcher.js'));
  const act = refs.findIndex((r) => r.startsWith('/js/pages/admin-actions.js'));
  assert.ok(ted > -1 && act > ted, 'admin-actions.js must load after ted-launcher.js');
  const js = fs.readFileSync(path.join(PUBLIC, 'js', 'pages', 'admin-actions.js'), 'utf8');
  assert.ok(/'\/pmo\.html'/.test(js) && /window\.launchDoomProtocol\(\)/.test(js));
});

test('dashboard.html: print button is data-action="print" (handled in dashboard-2.js); the slide anchors are href="#" under the [data-html-slide] delegate', () => {
  const html = fs.readFileSync(path.join(PUBLIC, 'dashboard.html'), 'utf8');
  assert.match(html, /<button[^>]*data-action="print"/);
  const slides = html.match(/<a\b[^>]*\bdata-html-slide=/g) || [];
  assert.strictEqual(slides.length, 8, `expected the eight Working-in-a-Matrix slide anchors, found ${slides.length}`);
  for (const a of slides) assert.match(a, /\bhref="#"/, `slide anchor must be href="#": ${a.slice(0, 80)}`);
  const js = fs.readFileSync(path.join(PUBLIC, 'js', 'pages', 'dashboard-2.js'), 'utf8');
  assert.ok(/data-action="print"/.test(js) && /window\.print\(\)/.test(js));
  // the delegate that handles [data-html-slide] clicks must preventDefault (so href="#" never navigates)
  const tr = fs.readFileSync(path.join(PUBLIC, 'js', 'transitions.js'), 'utf8');
  assert.match(tr, /closest\('\[data-html-slide\]'\);\s*if \(t\) \{ e\.preventDefault\(\)/);
});
