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
  'insights.html': ['insights-1.js'],
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

// Returns the list of violations for an HTML source (empty = inline-free).
function inlineViolations(html) {
  const src = stripComments(html);
  const v = [];
  // inline <script>: an opening tag that has no src attribute
  const scriptRe = /<script\b([^>]*)>/gi;
  let m;
  while ((m = scriptRe.exec(src)) !== null) {
    if (!/\bsrc\s*=/.test(m[1])) v.push(`inline <script${m[1]}>`);
  }
  // inline handler attributes: any `on<name>=` attribute inside a start tag
  const tagRe = /<[a-zA-Z][^>]*>/g;
  while ((m = tagRe.exec(src)) !== null) {
    const attrs = m[0].replace(/"[^"]*"|'[^']*'/g, '""'); // values out of the way
    const h = attrs.match(/\son[a-z]+\s*=/i);
    if (h) v.push(`inline handler ${h[0].trim()} in ${m[0].slice(0, 80)}`);
  }
  if (/javascript\s*:/i.test(src)) v.push('javascript: URL');
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
  const markupHandler = /<[a-zA-Z][^>]*\son[a-z]+\s*=/;
  if (markupHandler.test(js)) v.push('string markup with an inline on*= handler');
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
