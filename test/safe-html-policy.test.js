// SAFE-01 client half (D-13-02, plan 13-06): public/js/safe-html.js — the one
// client renderer for stored HTML — proven at source level.
//
// The renderer is a browser IIFE that needs a DOM, which node does not have
// (the repo is zero-install: no jsdom). So this file proves the properties that
// are checkable without one, and the live-browser half is the smoke net
// (`npm run smoke`) plus the 13-12 browser corpus:
//   * POLICY parity — the client table equals lib/htmlPolicy.js, table for
//     table (T-13-52); the module is loaded in a vm WITHOUT any DOM, which also
//     proves it touches no DOM API at load time;
//   * no-sink scan — safe-html.js never assigns the inner/outer HTML
//     properties, never calls the adjacent-HTML insert method or document
//     write (T-13-51: it builds, never serializes and re-parses);
//   * safeHref — the scheme check used for CTA targets and for <a href> /
//     <img src> inside rendered HTML (vm with Node's URL, no DOM needed);
//   * page-layout.js renders CMS HTML through MASafeHtml (T-13-50) and its
//     regex sanitize() is gone;
//   * script order — every page that loads transitions.js loads
//     /js/safe-html.js?v= exactly once, before every other /js/ script
//     (T-13-53, PD-28).
//
// node:test — run via `node --test test/safe-html-policy.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SAFE_HTML_PATH = path.join(PUBLIC, 'js', 'safe-html.js');
const PAGE_LAYOUT_PATH = path.join(PUBLIC, 'js', 'page-layout.js');
const serverPolicy = require('../lib/htmlPolicy.js');
const safeHtmlSource = fs.readFileSync(SAFE_HTML_PATH, 'utf8');

// Load the module in a vm with NOTHING but a `window` object (and, optionally,
// the URL class + a location) — it must not need a DOM to define itself.
function loadSafeHtml(extra) {
  const sandbox = Object.assign({ window: {} }, extra || {});
  vm.createContext(sandbox);
  vm.runInContext(safeHtmlSource, sandbox, { filename: 'safe-html.js' });
  return sandbox.window.MASafeHtml;
}

// Normalise any policy value to a host-realm, order-independent plain shape
// (arrays of strings sorted; RegExps as "/source/flags"; objects by sorted key).
function normalise(v) {
  if (Array.isArray(v)) {
    const items = Array.from(v, normalise); // Array.from: host-realm array (v may come from a vm realm)
    return items.every((x) => typeof x === 'string') ? items.slice().sort() : items;
  }
  if (v instanceof RegExp || Object.prototype.toString.call(v) === '[object RegExp]') {
    return `/${v.source}/${v.flags}`;
  }
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = normalise(v[k]);
    return out;
  }
  return v;
}

// Replace // and /* */ comments with nothing, string- and template-aware, so a
// sink name that only appears in prose (the [security] header) is not a hit
// and a sink hidden after a quote on the same line is still found.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += c;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += src[i]; i++; }
        out += src[i];
        i++;
      }
      out += q;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// T-13-52 — POLICY parity with lib/htmlPolicy.js
// ---------------------------------------------------------------------------
test('safe-html (parity): MASafeHtml.POLICY equals lib/htmlPolicy.js table for table', () => {
  const api = loadSafeHtml();
  assert.ok(api && typeof api.render === 'function' && typeof api.toFragment === 'function', 'MASafeHtml.render / toFragment must be exposed');
  assert.ok(api.POLICY, 'MASafeHtml.POLICY must be exposed');
  const client = normalise(api.POLICY);
  const server = normalise(serverPolicy);
  assert.deepStrictEqual(Object.keys(client), Object.keys(server), 'POLICY must carry exactly the same tables as lib/htmlPolicy.js');
  for (const key of Object.keys(server)) {
    assert.deepStrictEqual(client[key], server[key], `POLICY.${key} drifted from lib/htmlPolicy.js`);
  }
  // The never-allowed lists must not intersect the allowlists (accidental widen).
  const allowedAttrs = new Set([].concat(api.POLICY.GLOBAL_ATTRIBUTES, ...Object.values(api.POLICY.ALLOWED_ATTRIBUTES)));
  for (const a of api.POLICY.NEVER_ALLOWED_ATTRIBUTES) assert.ok(!allowedAttrs.has(a), `${a} is both allowed and never-allowed`);
  for (const t of api.POLICY.NEVER_ALLOWED_TAGS) assert.ok(!api.POLICY.ALLOWED_TAGS.includes(t), `${t} is both allowed and never-allowed`);
});

test('safe-html (parity): POLICY is deep-frozen plain data', () => {
  const api = loadSafeHtml();
  assert.ok(Object.isFrozen(api.POLICY));
  assert.ok(Object.isFrozen(api.POLICY.ALLOWED_TAGS));
  assert.ok(Object.isFrozen(api.POLICY.ALLOWED_ATTRIBUTES.a));
  assert.ok(Object.isFrozen(api));
});

// ---------------------------------------------------------------------------
// T-13-51 — the renderer builds, it never serializes
// ---------------------------------------------------------------------------
test('safe-html (no-sink): source has no inner/outer HTML assignment, adjacent-HTML insert or document write', () => {
  const code = stripComments(safeHtmlSource);
  assert.ok(code.includes('DOMParser'), 'sanity: comment stripping must not eat the real code (DOMParser missing)');
  assert.ok(code.includes('createElement'), 'sanity: createElement missing after comment stripping');
  const sinks = [
    ['inner HTML property', /\binnerHTML\b/],
    ['outer HTML property', /\bouterHTML\b/],
    ['adjacent-HTML insert', /\binsertAdjacentHTML\b/],
    ['document write', /\bdocument\s*\.\s*write(?:ln)?\b/],
    ['range contextual fragment', /\bcreateContextualFragment\b/],
    ['srcdoc / setHTML-style string parse of a live element', /\bsetHTMLUnsafe\b/],
    ['eval / Function constructor', /\beval\s*\(|\bnew\s+Function\b/],
  ];
  for (const [label, re] of sinks) {
    assert.ok(!re.test(code), `safe-html.js must not use ${label}`);
  }
  // The only way HTML text enters the output is DOMParser; style goes through CSSOM.
  assert.ok(!/setAttribute\(\s*['"]style['"]/.test(code), 'style must be copied through CSSOM, never setAttribute("style")');
});

test('safe-html (load): the module defines itself with no DOM at all', () => {
  assert.doesNotThrow(() => loadSafeHtml());
  const api = loadSafeHtml();
  // Without a DOM the render paths fail loudly (never "succeed" unsafely).
  assert.throws(() => api.toFragment('<p>x</p>'), /no DOM/);
});

// ---------------------------------------------------------------------------
// safeHref — scheme check shared with page-layout CTA targets
// ---------------------------------------------------------------------------
test('safe-html (safeHref): allowlisted schemes and relative URLs pass; script-bearing / protocol-relative / data are refused', () => {
  const api = loadSafeHtml({ URL, location: { origin: 'https://portal.example' } });
  const ok = [
    ['https://a.example/x?y=1#z', 'https://a.example/x?y=1#z'],
    ['http://a.example/', 'http://a.example/'],
    ['/playbook/hr-ma-guidebook.pdf', '/playbook/hr-ma-guidebook.pdf'],
    ['#section-2', '#section-2'],
    ['page.html?x=1', 'page.html?x=1'],
    ['mailto:someone@example.test', 'mailto:someone@example.test'],
    ['tel:+10000000000', 'tel:+10000000000'],
    ['  https://a.example/pad  ', 'https://a.example/pad'],
    ['HTTPS://A.EXAMPLE/UP', 'HTTPS://A.EXAMPLE/UP'],
  ];
  for (const [input, expected] of ok) assert.strictEqual(api.safeHref(input), expected, `safeHref(${JSON.stringify(input)})`);

  const refused = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\u0001script:alert(1)',
    '\u0000javascript:alert(1)',
    'vbscript:msgbox(1)',
    'data:text/html,<script>alert(1)</script>',
    'data:image/png;base64,AAAA',
    '//evil.example/x',
    '\\\\evil.example/x',
    '/\\evil.example/x',
    'file:///etc/passwd',
    'blob:https://a.example/uuid',
    'ftp://a.example/',
    '',
    '   ',
  ];
  for (const input of refused) assert.strictEqual(api.safeHref(input), '', `safeHref(${JSON.stringify(input)}) must be refused`);
  assert.strictEqual(api.safeHref(null), '');
  assert.strictEqual(api.safeHref(undefined), '');
});

// ---------------------------------------------------------------------------
// T-13-50 — the CMS page path renders through MASafeHtml
// ---------------------------------------------------------------------------
test('safe-html (page-layout): CMS HTML renders through MASafeHtml; the regex sanitize() and every HTML-string sink are gone', () => {
  const src = fs.readFileSync(PAGE_LAYOUT_PATH, 'utf8');
  const code = stripComments(src);
  assert.ok(/MASafeHtml\.render/.test(code), 'page-layout.js must call MASafeHtml.render');
  assert.strictEqual((src.match(/const sanitize =/g) || []).length, 0, 'the regex sanitize() must be deleted');
  assert.ok(!/region\.innerHTML\s*=/.test(code), 'region.innerHTML assignment must be gone');
  assert.ok(!/\.(?:inner|outer)HTML\s*=/.test(code), 'no inner/outer HTML assignment anywhere in page-layout.js');
  assert.ok(!/insertAdjacentHTML|document\.write/.test(code), 'no adjacent-HTML insert / document write in page-layout.js');
  assert.ok(!/\.replace\(\s*\/[^)]*on\\w\+/.test(code), 'no handler-strip regex left in page-layout.js');
  // richtext and the legacy body are the only HTML-string consumers; both call render.
  const renderCalls = code.match(/MASafeHtml\.render\(/g) || [];
  assert.ok(renderCalls.length >= 2, `richtext and legacy body must both call MASafeHtml.render (found ${renderCalls.length})`);
  // Fail closed when the renderer is missing (no string fallback).
  assert.ok(/!window\.MASafeHtml/.test(code), 'page-layout.js must fail closed when MASafeHtml is missing');
});

// ---------------------------------------------------------------------------
// T-13-53 — script order (PD-28)
// ---------------------------------------------------------------------------
const SCRIPT_SRC_RE = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

function jsScriptRefs(html) {
  const refs = [];
  let m;
  SCRIPT_SRC_RE.lastIndex = 0;
  while ((m = SCRIPT_SRC_RE.exec(html)) !== null) {
    if (m[1].startsWith('/js/')) refs.push(m[1]);
  }
  return refs;
}

test('safe-html (order): every page that loads transitions.js loads /js/safe-html.js?v= exactly once, before every other /js/ script', () => {
  const pages = fs.readdirSync(PUBLIC).filter((f) => f.endsWith('.html')).sort();
  const withChrome = [];
  const ONLY = new Set(['admin.html', 'capability-hub.html', 'integration-excellence.html', 'playbook.html']); // TASK1-ONLY
  for (const f of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    const refs = jsScriptRefs(html);
    if (!refs.some((r) => r.startsWith('/js/transitions.js'))) continue;
    if (!ONLY.has(f)) continue; // TASK1-ONLY
    withChrome.push(f);
    const safeIdx = refs.map((r, i) => (r.startsWith('/js/safe-html.js?v=') ? i : -1)).filter((i) => i !== -1);
    assert.strictEqual(safeIdx.length, 1, `${f}: expected exactly one /js/safe-html.js?v= reference, found ${safeIdx.length}`);
    assert.strictEqual(safeIdx[0], 0, `${f}: /js/safe-html.js must be the FIRST /js/ script (found at position ${safeIdx[0]}: ${refs.slice(0, safeIdx[0] + 1).join(', ')})`);
    // Parser-blocking: no async/defer/type=module on the tag.
    const tag = html.match(/<script\b[^>]*\/js\/safe-html\.js[^>]*>/i)[0];
    assert.ok(!/\b(?:async|defer)\b|type\s*=\s*["']module/i.test(tag), `${f}: safe-html.js tag must be parser-blocking (no async/defer/module): ${tag}`);
  }
  assert.ok(withChrome.length >= 4, `expected at least 4 pages, found ${withChrome.length}`); // TASK1-ONLY
});
