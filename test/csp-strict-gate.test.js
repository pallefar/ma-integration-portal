// SAFE-02 / D-13-03 final state (Phase 13, plan 13-13, PD-46): the WHOLE-TREE inline-code gate.
//
// The default policy is now the enforcing `script-src 'self' 'wasm-unsafe-eval'` (no 'unsafe-inline',
// no eval). Every inline <script>, inline `on*=` handler attribute, `javascript:` URL and `srcdoc`
// that a future page or client module re-introduces would be dead code at best and a policy-rollback
// pressure at worst, so this gate holds the whole shipped tree to the strict policy. It is the union of
// the 13-10 page gate (csp-inline-free-pages) and the 13-11 deck / client-JS gate
// (csp-inline-free-decks) with the HARDENED shapes the Phase 13 client review demanded (WR-B06):
//
//   markup (every public/**/*.html|htm|xhtml|svg except public/vendor and public/uploads; the
//   public/sent_emails/ previews ARE scanned - they are served under the app policy until Phase 14):
//     * a <script> with no src, any case, any whitespace (a newline before `>` included)
//     * an on*= attribute on ANY tag: quoted, unquoted, `<img/onerror=...>` (a slash is a valid
//       separator), directly after a closing quote (`href="x"onclick=y`), any letter case
//     * a `javascript:` URL after HTML-entity decoding (`&#106;`, `&#x6A;`, `&Tab;`, `&NewLine;`,
//       `&colon;`, missing semicolons, leading zeros, double-encoding) and after the URL parser's
//       tab/newline stripping
//     * a `srcdoc` attribute
//     * a <script src> that is not under /js/ or /vendor/ (third-party origin, protocol-relative,
//       data:, blob:, /uploads/...)
//   client JS (public/js/**/*.js and public/sw.js; public/vendor is third-party code and excluded):
//     * an inline handler attribute inside a markup string - NO quote requirement after `=`
//       (`'<img src=x onerror=alert(1)>'`), also across template-literal newlines
//     * `.setAttribute('on...'`
//     * `javascript:` (entity / \u-escape decoded, `'java' + 'script:'` flattened) outside the one
//       recorded scheme-GUARD line
//     * `.srcdoc =` / `setAttribute('srcdoc'` and a `<script src=...>` string outside /js/ /vendor/
//
// Every rule has a NEGATIVE CONTROL: an inline fixture string the matcher must flag (one per shape),
// plus must-pass fixtures so a rule cannot drift into flagging ordinary markup, plus a synthetic
// directory tree that exercises the walker (exclusions and the sent_emails/ inclusion included).
//
// Out of scope by design: public/doom/*.js are never-referenced saved HTML 404 pages (13-REVIEW-CLIENT
// IN-B04, a Phase 14 clean-up); style attributes (style-src keeps 'unsafe-inline'); the ~300 client
// HTML sinks, which are bounded by the policy rather than enumerated (DEPLOYMENT.md Known limitations).
//
// Pure static analysis: no server, no network. node:test - `node --test test/csp-strict-gate.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

// ----------------------------------------------------------------------------- decoding ---

const NAMED_ENTITIES = {
  tab: '\t', newline: '\n', colon: ':', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lpar: '(', rpar: ')', sol: '/', bsol: '\\', semi: ';', comma: ',', period: '.', excl: '!', num: '#',
  percnt: '%', lowbar: '_', hyphen: '-', dash: '-',
};

function fromCodePoint(n) {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
  return String.fromCodePoint(n);
}

/** Decode numeric (with or without `;`, any zero padding) and the scheme-relevant named references; repeat to catch double encoding. */
function decodeEntities(input) {
  let out = String(input);
  for (let i = 0; i < 4; i++) {
    const prev = out;
    out = out
      .replace(/&#x([0-9a-f]+);?/gi, (m, h) => fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);?/g, (m, d) => fromCodePoint(parseInt(d, 10)))
      .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, n.toLowerCase()) ? NAMED_ENTITIES[n.toLowerCase()] : m));
    if (out === prev) break;
  }
  return out;
}

/** Decode JS string escapes that can spell a scheme: \uXXXX, \u{X}, \xHH. */
function decodeJsEscapes(s) {
  return s
    .replace(/\\u\{([0-9a-f]+)\}/gi, (m, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-f]{4})/gi, (m, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/\\x([0-9a-f]{2})/gi, (m, h) => fromCodePoint(parseInt(h, 16)));
}

/** True when the text spells a javascript: URL once the browser's own decoding / scheme normalisation is applied. */
function spellsJavascriptScheme(text) {
  const decoded = decodeEntities(text).replace(/[\t\n\r]/g, '');
  return /javascript\s*:/i.test(decoded);
}

// ------------------------------------------------------------------------- markup scan ---

/** Replace comments with same-length whitespace (newlines kept) so offsets and line numbers survive. `<!-->`, `<!--->` and `--!>` end a comment too. */
function blankComments(html) {
  return html.replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Parse an attribute string into [{ name, value|null }]. A slash or a closing quote separates attributes (browser tokenizer). */
function parseAttributes(attrText) {
  const attrs = [];
  const re = /([^\s\/"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(attrText)) !== null) {
    const value = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : null));
    attrs.push({ name: m[1], value });
  }
  return attrs;
}

const LINE_AT = (src, idx) => src.slice(0, idx).split('\n').length;

// A script src is first-party when it is rooted at /js/ or /vendor/ (a `?v=` content stamp is fine).
const FIRST_PARTY_SCRIPT_SRC = /^\/(?:js|vendor)\/[A-Za-z0-9._\-\/]+(?:\?[A-Za-z0-9._=&\-]*)?$/;

/** Violations of the strict policy in one markup document: [{ line, rule, detail }] (empty = clean). */
function markupViolations(html) {
  const src = blankComments(String(html));
  const out = [];
  const add = (idx, rule, detail) => out.push({ line: LINE_AT(src, idx), rule, detail: String(detail).slice(0, 110) });

  // quote-aware tag scan: attribute text runs to the first `>` outside quotes
  const tagRe = /<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m;
  while ((m = tagRe.exec(src)) !== null) {
    const name = m[1].toLowerCase();
    const attrText = m[2];
    const attrs = parseAttributes(attrText);
    for (const a of attrs) {
      if (/^on[a-z]+$/i.test(a.name)) add(m.index, 'inline-handler', `${a.name}= in ${m[0]}`);
      if (a.name.toLowerCase() === 'srcdoc') add(m.index, 'srcdoc', m[0]);
    }
    // defence in depth: the raw text with quoted values blanked, `on*=` after a space, slash or quote
    const blanked = attrText.replace(/"[^"]*"|'[^']*'/g, '""');
    const raw = /(?:^|[\s\/"'])(on[a-z]+)\s*=/i.exec(blanked);
    if (raw && !attrs.some((a) => /^on[a-z]+$/i.test(a.name))) add(m.index, 'inline-handler', `${raw[1]}= in ${m[0]}`);
    if (/(?:^|[\s\/"'])srcdoc\s*=/i.test(blanked) && !attrs.some((a) => a.name.toLowerCase() === 'srcdoc')) add(m.index, 'srcdoc', m[0]);

    if (name === 'script') {
      const srcAttr = attrs.find((a) => a.name.toLowerCase() === 'src');
      if (!srcAttr || srcAttr.value === null || srcAttr.value.trim() === '') {
        add(m.index, 'inline-script', m[0]);
      } else {
        const v = decodeEntities(srcAttr.value).replace(/[\t\n\r]/g, '').trim();
        if (!FIRST_PARTY_SCRIPT_SRC.test(v) || /(?:^|\/)\.\.(?:\/|$)/.test(v)) add(m.index, 'script-src-origin', `<script src=${JSON.stringify(v)}>`);
      }
    }
  }

  // javascript: anywhere in the document (attributes, text, inline styles), after decoding. Per line for the
  // line number; then once over the whole document, because the URL parser strips a raw tab/newline that
  // sits INSIDE an attribute value, which can split the scheme across two source lines.
  let flagged = false;
  src.split('\n').forEach((text, i) => {
    if (spellsJavascriptScheme(text)) { out.push({ line: i + 1, rule: 'javascript-url', detail: text.trim().slice(0, 110) }); flagged = true; }
  });
  if (!flagged && spellsJavascriptScheme(src)) add(0, 'javascript-url', 'javascript: spelled across a line break inside a value');
  return out;
}

// ---------------------------------------------------------------------- client JS scan ---

// Recorded allowlist: exact trimmed code lines that mention `javascript:` ON PURPOSE because they are
// scheme GUARDS (they reject or skip such URLs), not producers of one. Same entry and same exactness as
// the 13-11 gate; anything else naming `javascript:` in public/js fails.
const JAVASCRIPT_SCHEME_GUARD_LINES = new Set([
  "if (href.indexOf('javascript:') === 0) return '';", // transitions.js tokenOf: javascript: hrefs carry no menu token
]);

const isCommentOnly = (trimmed) => /^(?:\/\/|\/\*|\*)/.test(trimmed);

/** Whole-file passes (multi-line template literals): markup inside a string carrying an on*= handler, no quote required. */
function jsMarkupHandlerHits(js) {
  const hits = [];
  // `<tag` must be followed by whitespace, `/`, `>` or a quote (so `i<n;` and `a<b)` are not tags) and the
  // match is bounded to 400 characters without another `<` or `>` in between.
  const re = /<[a-zA-Z][a-zA-Z0-9-]*(?=[\s\/>"'`])[^<>]{0,400}?[\s\/"'`]on[a-z]{2,}\s*=/g;
  let m;
  while ((m = re.exec(js)) !== null) {
    const before = js.slice(0, m.index);
    const lineStart = before.lastIndexOf('\n') + 1;
    const prefix = js.slice(lineStart, m.index);
    if (isCommentOnly(prefix.trim())) continue; // a comment line quoting a historical shape
    // markup context: the tag starts its line (a template-literal continuation) or follows a string delimiter
    if (prefix.trim() !== '' && !/["'`]/.test(prefix)) continue; // `x <y && onFoo =` style code, not markup
    hits.push({ line: before.split('\n').length, rule: 'handler-in-markup-string', detail: m[0].slice(0, 110) });
  }
  return hits;
}

/** Violations in one client script: [{ line, rule, detail }] (empty = clean). */
function jsViolations(source) {
  const out = [];
  const text = String(source);
  out.push(...jsMarkupHandlerHits(text));
  text.split('\n').forEach((raw, idx) => {
    const trimmed = raw.trim();
    if (isCommentOnly(trimmed)) return;
    const line = idx + 1;
    const add = (rule, detail) => out.push({ line, rule, detail: String(detail).slice(0, 110) });
    // a string that BEGINS with an attribute: `'onclick="x()"'`, `' onerror=alert(1)'` (attribute fragments built apart from the tag)
    if (/["'`]\s*on[a-z]{2,}\s*=\s*(?:\\?["'`]|[A-Za-z(])/i.test(raw)) add('handler-attribute-fragment', trimmed);
    if (/\.\s*setAttribute\(\s*["'`]\s*on[a-z]+\s*["'`]/i.test(raw)) add('setAttribute-handler', trimmed);
    if (/\.\s*setAttribute\(\s*["'`]\s*srcdoc\s*["'`]/i.test(raw) || /\.\s*srcdoc\s*=(?!=)/.test(raw)) add('srcdoc', trimmed);
    // (quoted value: not rooted at /js/ or /vendor/; unquoted value: same) - no backtracking into "optional quote"
    if (/<script\b[^>]*\bsrc\s*=\s*(?:\\?["']\s*(?!\/(?:js|vendor)\/)|(?!\\?["'])(?!\/(?:js|vendor)\/))/i.test(raw)) add('script-src-origin', trimmed);
    const flat = decodeJsEscapes(raw).replace(/["'`]\s*\+\s*["'`]/g, '');
    if (spellsJavascriptScheme(flat) && !JAVASCRIPT_SCHEME_GUARD_LINES.has(trimmed)) add('javascript-url', trimmed);
  });
  return out;
}

// ------------------------------------------------------------------------------ walker ---

const MARKUP_EXT = /\.(?:html?|xhtml|svg)$/i;
const EXCLUDED_TOP_LEVEL = new Set(['vendor', 'uploads']);

/** Files under `root` (relative to it) matching `test`, skipping the top-level directories vendor/ and uploads/. */
function walk(root, test_, skipTop = EXCLUDED_TOP_LEVEL) {
  const found = [];
  (function recur(dir, depth) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (depth === 0 && skipTop.has(ent.name)) continue;
        recur(full, depth + 1);
      } else if (ent.isFile() && test_(ent.name, full)) {
        found.push(path.relative(root, full).split(path.sep).join('/'));
      }
    }
  })(root, 0);
  return found.sort();
}

function scanTree(publicDir) {
  const hits = [];
  const markupFiles = walk(publicDir, (n) => MARKUP_EXT.test(n));
  for (const rel of markupFiles) {
    for (const v of markupViolations(fs.readFileSync(path.join(publicDir, rel), 'utf8'))) hits.push(`${rel}:${v.line}: ${v.rule}: ${v.detail}`);
  }
  const jsRoot = path.join(publicDir, 'js');
  const jsFiles = fs.existsSync(jsRoot) ? walk(jsRoot, (n) => /\.js$/i.test(n), new Set()).map((r) => 'js/' + r) : [];
  if (fs.existsSync(path.join(publicDir, 'sw.js'))) jsFiles.push('sw.js');
  for (const rel of jsFiles) {
    for (const v of jsViolations(fs.readFileSync(path.join(publicDir, rel), 'utf8'))) hits.push(`${rel}:${v.line}: ${v.rule}: ${v.detail}`);
  }
  return { hits, markupFiles, jsFiles };
}

// =============================================================================== tests ===

const rules = (viol) => viol.map((v) => v.rule);
const flags = (fn, input, rule) => fn(input).some((v) => v.rule === rule);

test('the shipped tree: every public/**/*.html|svg (vendor/ and uploads/ excluded, sent_emails/ included) and every client script is inline-free', () => {
  const { hits, markupFiles, jsFiles } = scanTree(PUBLIC);
  // the gate must actually be looking at the tree it claims to
  assert.ok(markupFiles.length >= 28, `expected the 28+ shipped HTML files, scanned ${markupFiles.length}`);
  for (const must of ['index.html', 'login.html', 'admin.html', 'dashboard.html', 'org.html', 'overview-deck/agenda.html',
    'overview-deck/easter-egg.html', 'slides/welcome-slide.html']) {
    assert.ok(markupFiles.includes(must), `${must} must be in the scanned set`);
  }
  assert.ok(markupFiles.some((f) => f.startsWith('sent_emails/')), 'the sent_emails/ previews are scanned (PD-46)');
  assert.ok(!markupFiles.some((f) => f.startsWith('vendor/') || f.startsWith('uploads/')), 'vendor/ and uploads/ are excluded');
  assert.ok(jsFiles.length >= 30, `expected the shipped client scripts, scanned ${jsFiles.length}`);
  assert.ok(jsFiles.includes('js/transitions.js') && jsFiles.includes('js/safe-html.js'));
  assert.deepStrictEqual(hits, [], 'inline code in the shipped tree:\n  ' + hits.join('\n  '));
});

test('the HTML file set is every *.html under public/ except vendor/ and uploads/ (no page can be added ungated)', () => {
  const viaWalk = new Set(walk(PUBLIC, (n) => /\.html$/i.test(n)));
  const viaFind = [];
  (function recur(dir, rel) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) { if (!(rel === '' && EXCLUDED_TOP_LEVEL.has(ent.name))) recur(path.join(dir, ent.name), next); }
      else if (/\.html$/i.test(ent.name)) viaFind.push(next);
    }
  })(PUBLIC, '');
  assert.deepStrictEqual([...viaWalk].sort(), viaFind.sort());
});

// -------- negative controls: markup (each shape MUST be flagged) --------------------------

test('negative control (markup): every inline-code shape is flagged', () => {
  const bad = {
    'inline script': ['<html><body><script>alert(1)</script></body></html>', 'inline-script'],
    'inline script, uppercase tag': ['<SCRIPT>alert(1)</SCRIPT>', 'inline-script'],
    'inline script, newline before >': ['<script\n>alert(1)</script>', 'inline-script'],
    'inline script, type=module without src': ['<script type="module">import("/x.js")</script>', 'inline-script'],
    'inline script, src empty': ['<script src="">alert(1)</script>', 'inline-script'],
    'quoted handler': ['<button onclick="x()">b</button>', 'inline-handler'],
    'single-quoted handler': ["<button onclick='x()'>b</button>", 'inline-handler'],
    'unquoted handler': ['<img src=x onerror=alert(1)>', 'inline-handler'],
    'slash-separated handler (R1-03)': ['<img/onerror=alert(1)>', 'inline-handler'],
    'slash after attribute': ['<img src=x/onerror=alert(1)>x', 'inline-handler'],
    'handler directly after a closing quote': ['<a href="x"onclick=y>a</a>', 'inline-handler'],
    'handler, uppercase': ['<A HREF="#" ONCLICK="x()">a</A>', 'inline-handler'],
    'handler on svg': ['<svg onload=alert(1)></svg>', 'inline-handler'],
    'handler with > inside a quoted value': ['<a title="a>b" onclick="x()">a</a>', 'inline-handler'],
    'handler after a comment end --!>': ['<!-- x --!><img src=x onerror=alert(1)>', 'inline-handler'],
    'handler after an empty comment <!-->': ['<!--><img src=x onerror=alert(1)><!-- tail -->', 'inline-handler'],
    'handler after <!--->': ['<!---><img src=x onerror=alert(1)><!-- tail -->', 'inline-handler'],
    'javascript: URL': ['<a href="javascript:void(0)">a</a>', 'javascript-url'],
    'javascript: URL, uppercase': ['<a href="JAVASCRIPT:alert(1)">a</a>', 'javascript-url'],
    'javascript: &#106; (decimal)': ['<a href="&#106;avascript:alert(1)">a</a>', 'javascript-url'],
    'javascript: &#x6A; (hex)': ['<a href="&#x6A;avascript:alert(1)">a</a>', 'javascript-url'],
    'javascript: padded &#0000106 without semicolon': ['<a href="&#0000106avascript:alert(1)">a</a>', 'javascript-url'],
    'javascript: java&Tab;script': ['<a href="java&Tab;script:alert(1)">a</a>', 'javascript-url'],
    'javascript: java&NewLine;script': ['<a href="java&NewLine;script:alert(1)">a</a>', 'javascript-url'],
    'javascript: javascript&colon;': ['<a href="javascript&colon;alert(1)">a</a>', 'javascript-url'],
    'javascript: raw tab inside the scheme': ['<a href="java\tscript:alert(1)">a</a>', 'javascript-url'],
    'javascript: raw newline inside the scheme': ['<a href="java\nscript:alert(1)">a</a>', 'javascript-url'],
    'javascript: double-encoded &amp;#106;': ['<a href="&amp;#106;avascript:alert(1)">a</a>', 'javascript-url'],
    'javascript: in formaction': ['<button formaction="javascript:alert(1)">b</button>', 'javascript-url'],
    'srcdoc': ['<iframe srcdoc="<p>x</p>"></iframe>', 'srcdoc'],
    'srcdoc, uppercase, unquoted': ['<IFRAME SRCDOC=x></IFRAME>', 'srcdoc'],
    'script from a third-party origin': ['<script src="https://cdn.example.com/x.js"></script>', 'script-src-origin'],
    'script from a protocol-relative origin': ['<script src="//cdn.example.com/x.js"></script>', 'script-src-origin'],
    'script from data:': ['<script src="data:text/javascript,alert(1)"></script>', 'script-src-origin'],
    'script from blob:': ['<script src="blob:https://x/y"></script>', 'script-src-origin'],
    'script from /uploads/': ['<script src="/uploads/x.js"></script>', 'script-src-origin'],
    'script, relative (not rooted at /js/)': ['<script src="js/app.js"></script>', 'script-src-origin'],
    'script, path traversal out of /js/': ['<script src="/js/../uploads/x.js"></script>', 'script-src-origin'],
    'script src spelled with an entity-encoded https:': ['<script src="&#104;ttps://x/y.js"></script>', 'script-src-origin'],
  };
  for (const [label, [html, rule]] of Object.entries(bad)) {
    const v = markupViolations(html);
    assert.ok(v.some((x) => x.rule === rule), `markup control "${label}" must be flagged as ${rule}; got ${JSON.stringify(rules(v))}`);
  }
});

test('markup controls: first-party, comment-only and data-* shapes stay clean (the rules do not drift into flagging ordinary markup)', () => {
  const good = [
    '<script src="/js/app.js?v=0123456789abcdef"></script>',
    '<script src=/js/app.js></script>',
    "<script src='/vendor/transformers/transformers.min.js'></script>",
    '<SCRIPT SRC="/js/pages/dashboard-1.js?v=0123456789abcdef"></SCRIPT>',
    '<!-- <script>1</script> <img onerror=x> javascript:void(0) --><p>ok</p>',
    '<button data-action="go" data-onclick-note="x">b</button>',
    '<a href="#" data-html-slide="/overview-deck/agenda.html" title="onclick=">a</a>',
    '<p>Use the online= form; JavaScript is a language. java script: no.</p>',
    '<a href="/api/export?format=pdf&amp;lang=en">x</a>',
    '<div class="on-air" id="onboarding"></div>',
    '<input type="text" value="on=1" name="online">',
  ];
  for (const html of good) assert.deepStrictEqual(markupViolations(html), [], `must be clean: ${html}`);
});

test('markup line numbers survive comment blanking', () => {
  const v = markupViolations('<p>a</p>\n<!-- multi\nline -->\n<script>1</script>\n');
  assert.strictEqual(v.length, 1);
  assert.strictEqual(v[0].line, 4);
});

// -------- negative controls: client JS ----------------------------------------------------

test('negative control (client JS): every inline-handler / javascript: shape is flagged', () => {
  const bad = {
    'quoted handler in markup string': [`el.innerHTML = '<button onclick="x()">b</button>';`, 'handler-in-markup-string'],
    'unquoted handler in markup string': [`el.innerHTML = '<img src=x onerror=alert(1)>';`, 'handler-in-markup-string'],
    'slash separator in markup string': [`el.innerHTML = '<img/onerror=alert(1)>';`, 'handler-in-markup-string'],
    'handler in a template literal across lines': ['el.innerHTML = `<div class="a"\n  onmouseover="x()">hi</div>`;', 'handler-in-markup-string'],
    'handler built from concatenated parts': [`h = '<a ' + 'onclick="x()"' + '>';`, 'handler-in-markup-string'],
    'handler attribute fragment': [`var attr = 'onclick="doThing()"';`, 'handler-attribute-fragment'],
    'handler attribute fragment, unquoted value': [`var attr = ' onerror=alert(1)';`, 'handler-attribute-fragment'],
    'setAttribute onclick': [`el.setAttribute('onclick', 'x()');`, 'setAttribute-handler'],
    'setAttribute onmouseover, double quotes, spaces': [`el.setAttribute( "onmouseover" , fn );`, 'setAttribute-handler'],
    'javascript: href in a string': [`a.href = 'javascript:void(0)';`, 'javascript-url'],
    'javascript: in markup string': [`h = '<a href="javascript:go()">x</a>';`, 'javascript-url'],
    'javascript: entity-encoded in a string': [`h = '<a href="&#106;avascript:go()">x</a>';`, 'javascript-url'],
    'javascript: hex-entity in a string': [`h = '<a href="&#x6A;avascript:go()">x</a>';`, 'javascript-url'],
    'javascript: java&Tab;script in a string': [`h = '<a href="java&Tab;script:go()">x</a>';`, 'javascript-url'],
    'javascript: concatenated scheme': [`a.href = 'java' + 'script:go()';`, 'javascript-url'],
    'javascript: \\u-escaped scheme': [`a.href = '\\u006aavascript:go()';`, 'javascript-url'],
    'javascript: \\x-escaped scheme': [`a.href = '\\x6aavascript:go()';`, 'javascript-url'],
    'srcdoc property': [`frame.srcdoc = html;`, 'srcdoc'],
    'srcdoc via setAttribute': [`frame.setAttribute('srcdoc', html);`, 'srcdoc'],
    'script tag from a third-party origin in a string': [`h = '<script src="https://cdn.example.com/x.js"></script>';`, 'script-src-origin'],
    'script tag from /uploads/ in a string': [`h = '<script src=/uploads/x.js></script>';`, 'script-src-origin'],
  };
  for (const [label, [js, rule]] of Object.entries(bad)) {
    const v = jsViolations(js);
    assert.ok(v.some((x) => x.rule === rule), `JS control "${label}" must be flagged as ${rule}; got ${JSON.stringify(rules(v))}`);
  }
});

test('client JS controls: ordinary code, comments and the recorded scheme GUARD line stay clean', () => {
  const good = [
    'btn.onclick = function () { go(); };',
    "a.addEventListener('click', fn);",
    'const online = true; var once = 1; if (online === once) {}',
    "el.setAttribute('data-onclick', 'x');",
    "el.setAttribute('class', 'on-air');",
    "// el.innerHTML = '<a onclick=\"x()\">' historical shape, javascript:void(0)",
    "/* javascript: URLs are rejected here */",
    ' * <img src=x onerror=alert(1)> in a block comment',
    "if (href.indexOf('javascript:') === 0) return '';",
    "h = '<script src=\"/js/app.js\"></script>';",
    "const url = '/api/x?online=1&once=2';",
    "x = a === b ? 'on' : 'off'; if (state.onboarding === 'on') {}",
    "if (typeof el.onclick === 'function') {}",
  ];
  for (const js of good) assert.deepStrictEqual(jsViolations(js), [], `must be clean: ${js}`);
  // the guard allowlist is by EXACT content: a near-copy that actually builds a URL is flagged
  assert.ok(flags(jsViolations, "if (href.indexOf('javascript:') === 0) return 'javascript:void(0)';", 'javascript-url'));
});

test('entity decoder and scheme test, unit level', () => {
  for (const s of ['javascript:x', '&#106;avascript:x', '&#x6a;avascript:x', 'java&Tab;script:x', 'java&NewLine;script&colon;x',
    'jav&#x61;script:x', '&#74;avascript:x'.replace('&#74;', '&#106;'), '&amp;#106;avascript:x']) {
    assert.ok(spellsJavascriptScheme(s), `${s} spells javascript:`);
  }
  for (const s of ['https://example.com', 'java script', 'javascript', 'data:text/plain,hi', '#top', 'mailto:a@b.example']) {
    assert.ok(!spellsJavascriptScheme(s), `${s} does not`);
  }
  assert.strictEqual(decodeEntities('&#x41;&#66;&Tab;&colon;'), 'AB\t:');
});

// -------- the walker itself: a synthetic tree ----------------------------------------------

test('walker control: a synthetic public tree is scanned as specified (vendor/ + uploads/ skipped, sent_emails/ + nested pages + js/ + sw.js included)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-csp-strict-gate-'));
  try {
    const put = (rel, body) => {
      const p = path.join(dir, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    };
    put('clean.html', '<p>ok</p><script src="/js/a.js"></script>');
    put('bad-page.html', '<script>1</script>');
    put('nested/deck/bad.html', '<img src=x onerror=alert(1)>');
    put('sent_emails/mail.html', '<a href="&#106;avascript:alert(1)">x</a>');
    put('slides/s.html', '<iframe srcdoc="x"></iframe>');
    put('vendor/lib/bad.html', '<script>1</script>');
    put('uploads/slides/bad.html', '<script>1</script>');
    put('images/bad.svg', '<svg onload="x()"></svg>');
    put('js/ok.js', "el.addEventListener('click', fn);\n");
    put('js/bad.js', "el.innerHTML = '<img src=x onerror=alert(1)>';\n");
    put('js/sub/bad2.js', "a.href = 'javascript:go()';\n");
    put('js/vendor/third-party.js', "a.href = 'javascript:go()';\n"); // only the TOP-level vendor/ is exempt
    put('sw.js', "el.setAttribute('onclick', 'x');\n");
    put('vendor/ok.js', "a.href = 'javascript:go()';\n"); // never scanned: public/vendor is third-party code
    const { hits, markupFiles, jsFiles } = scanTree(dir);
    assert.deepStrictEqual(markupFiles, ['bad-page.html', 'clean.html', 'images/bad.svg', 'nested/deck/bad.html', 'sent_emails/mail.html', 'slides/s.html']);
    assert.deepStrictEqual(jsFiles, ['js/bad.js', 'js/ok.js', 'js/sub/bad2.js', 'js/vendor/third-party.js', 'sw.js']);
    const files = [...new Set(hits.map((h) => h.split(':')[0]))].sort();
    assert.deepStrictEqual(files, ['bad-page.html', 'images/bad.svg', 'js/bad.js', 'js/sub/bad2.js', 'js/vendor/third-party.js',
      'nested/deck/bad.html', 'sent_emails/mail.html', 'slides/s.html', 'sw.js']);
    assert.ok(!hits.some((h) => h.startsWith('vendor/') || h.startsWith('uploads/') || h.startsWith('clean.html') || h.startsWith('js/ok.js')));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }
});
