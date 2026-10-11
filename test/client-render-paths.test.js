// SAFE-01 client half, part 2 (Phase 13, plan 13-09, D-13-02 / PD-39).
//
// Every enumerated client render path that turns stored or message-sourced markup
// into DOM must build that DOM from the MASafeHtml allowlist (public/js/safe-html.js)
// or from createElement/textContent - never from an HTML-string sink. This test is
// the static gate that keeps it so:
//
//   * ENUMERATED_PATHS is the table of render paths (file + anchor + kind). For
//     each, the enclosing function / callback / file is extracted with a brace
//     counter over a LEXED copy of the source (comments, string bodies, template
//     text and regex literals blanked), and the region must contain no
//     innerHTML/outerHTML/srcdoc assignment, insertAdjacentHTML, document.write,
//     setHTMLUnsafe, createContextualFragment, DOMParser.parseFromString,
//     importNode/adoptNode or insertAdjacentElement call (WR-B02); `uses` is
//     judged on code only, and markup paths must call MASafeHtml literally.
//     Reads of `.innerHTML` (no `=`) and clearing assignments of an empty string
//     literal are allowed - neither can carry markup.
//   * The scanner is proven by a negative control on synthetic source.
//   * The remaining sink surface (everything in public/js outside the enumerated
//     paths) is counted per file and printed - "not enumerated", bounded by the
//     strict CSP of D-13-03 (13-13), never silently ignored. The count is printed,
//     not pinned: sibling plans in the same phase legitimately move it.
//
// node:test - run via `node --test test/client-render-paths.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');
const readJs = (rel) => fs.readFileSync(path.join(PUBLIC_JS, rel), 'utf8');

// ------------------------------------------------------------------ lexer
// Returns { code, mask }: same length as the source, newlines preserved.
//   code - comments blanked, everything else (string text included) intact
//   mask - additionally string bodies, template text and regex bodies blanked
// Template-literal ${ ... } expressions stay visible in both (they are code).
function lex(src) {
  const n = src.length;
  const code = src.split('');
  const mask = src.split('');
  const blank = (arr, from, to) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'new', 'throw', 'yield', 'await']);

  function scanTemplate(i) {
    // src[i] is the opening backtick; returns the index after the closing one.
    let k = i + 1;
    while (k < n) {
      const c = src[k];
      if (c === '\\') { blank(mask, k, Math.min(k + 2, n)); k += 2; continue; }
      if (c === '`') return k + 1;
      if (c === '$' && src[k + 1] === '{') {
        blank(mask, k, k + 2);
        const close = scanCode(k + 2, true);
        blank(mask, close, close + 1);
        k = close + 1;
        continue;
      }
      blank(mask, k, k + 1);
      k++;
    }
    return n;
  }

  // Scans code from `i`. When untilBrace, returns the index of the `}` that
  // closes the enclosing ${ ; otherwise returns n.
  function scanCode(i, untilBrace) {
    let depth = 0;
    let lastSig = '';
    let lastWord = '';
    while (i < n) {
      const c = src[i];
      const d = src[i + 1];
      if (c === '/' && d === '/') {
        let e = src.indexOf('\n', i);
        if (e < 0) e = n;
        blank(code, i, e); blank(mask, i, e);
        i = e;
        continue;
      }
      if (c === '/' && d === '*') {
        let e = src.indexOf('*/', i + 2);
        e = e < 0 ? n : e + 2;
        blank(code, i, e); blank(mask, i, e);
        i = e;
        continue;
      }
      if (c === '\'' || c === '"') {
        let k = i + 1;
        while (k < n && src[k] !== c && src[k] !== '\n') { if (src[k] === '\\') k++; k++; }
        blank(mask, i + 1, k);
        i = k + 1;
        lastSig = 'str'; lastWord = '';
        continue;
      }
      if (c === '`') {
        i = scanTemplate(i);
        lastSig = 'str'; lastWord = '';
        continue;
      }
      if (c === '/') {
        const regexOk = lastSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSig) || (lastWord && REGEX_AFTER_WORD.has(lastWord));
        if (regexOk) {
          let k = i + 1;
          let inClass = false;
          while (k < n && src[k] !== '\n') {
            const r = src[k];
            if (r === '\\') { k += 2; continue; }
            if (r === '[') inClass = true;
            else if (r === ']') inClass = false;
            else if (r === '/' && !inClass) break;
            k++;
          }
          blank(mask, i + 1, k);
          i = k + 1;
          while (i < n && /[a-z]/i.test(src[i])) i++;
          lastSig = 'rx'; lastWord = '';
          continue;
        }
      }
      if (c === '{') depth++;
      else if (c === '}') {
        if (untilBrace && depth === 0) return i;
        depth--;
      }
      if (/[A-Za-z0-9_$]/.test(c)) {
        let k = i;
        while (k < n && /[A-Za-z0-9_$]/.test(src[k])) k++;
        lastWord = src.slice(i, k);
        lastSig = 'w';
        i = k;
        continue;
      }
      if (!/\s/.test(c)) { lastSig = c; lastWord = ''; }
      i++;
    }
    return n;
  }

  scanCode(0, false);
  return { code: code.join(''), mask: mask.join('') };
}

// ------------------------------------------------------------- sink scan
// Returns [{ kind, index }] for HTML-string sinks in a lexed source slice.
// `file` (relative to public/js) exempts safe-html.js from the parser-call rule:
// it is the one module allowed to call DOMParser.parseFromString (it parses into
// an inert document and BUILDS the output; test/safe-html-policy.test.js pins
// that parsed nodes are never re-attached).
//
// [security] WR-B02 (Phase 13 review, Part B): besides the classic string sinks,
// every other way of turning a string into LIVE nodes is a sink - setHTMLUnsafe,
// Range.createContextualFragment, iframe srcdoc, DOMParser output (inert only
// inside the parser document; adopted/imported nodes carry live on* and
// javascript: URLs), importNode/adoptNode and insertAdjacentElement (the
// re-attachment half of the DOMParser-adopt shape).
function findSinks(lexed, from, to, file) {
  const out = [];
  const mask = lexed.mask.slice(from, to);
  const patterns = [
    { kind: 'innerHTML/outerHTML assignment', re: /\.\s*(?:innerHTML|outerHTML)\s*\+?=(?!=)/g, assign: true },
    { kind: 'insertAdjacentHTML', re: /\.\s*insertAdjacentHTML\s*\(/g },
    { kind: 'document.write', re: /\bdocument\s*\.\s*write(?:ln)?\s*\(/g },
    { kind: 'setHTMLUnsafe', re: /\bsetHTMLUnsafe\s*\(/g },
    { kind: 'createContextualFragment', re: /\bcreateContextualFragment\s*\(/g },
    { kind: 'srcdoc assignment', re: /\.\s*srcdoc\s*=(?!=)/g, assign: true },
    { kind: 'importNode/adoptNode', re: /\b(?:importNode|adoptNode)\s*\(/g },
    { kind: 'insertAdjacentElement', re: /\binsertAdjacentElement\s*\(/g },
  ];
  if (file !== 'safe-html.js') patterns.push({ kind: 'DOMParser.parseFromString', re: /\bparseFromString\s*\(/g });
  for (const p of patterns) {
    let m;
    while ((m = p.re.exec(mask)) !== null) {
      const end = from + m.index + m[0].length;
      // A clearing assignment of an empty string literal cannot carry markup.
      if (p.assign && /^\s*(?:''|""|``)/.test(lexed.code.slice(end, end + 12))) continue;
      out.push({ kind: p.kind, index: from + m.index });
    }
  }
  // Bracket form: el['innerHTML'] = ... (the key is a string, blanked in mask).
  const bracket = /\[\s*(['"`])(?:innerHTML|outerHTML|srcdoc)\1\s*\]\s*\+?=(?!=)/g;
  const codeSlice = lexed.code.slice(from, to);
  let b;
  while ((b = bracket.exec(codeSlice)) !== null) out.push({ kind: 'bracket innerHTML/outerHTML/srcdoc assignment', index: from + b.index });
  return out.sort((a, c) => a.index - c.index);
}

// Region of `anchor` (a literal found in comment-stripped code; must be unique):
// from the anchor to the brace that closes the first `{` after it. anchor null =
// the whole file.
function regionOf(lexed, anchor) {
  if (anchor === null) return { from: 0, to: lexed.code.length };
  const at = lexed.code.indexOf(anchor);
  assert.ok(at >= 0, `anchor not found: ${anchor}`);
  assert.strictEqual(lexed.code.indexOf(anchor, at + anchor.length), -1, `anchor is not unique: ${anchor}`);
  const open = lexed.mask.indexOf('{', at + anchor.length);
  assert.ok(open >= 0, `no body after anchor: ${anchor}`);
  let depth = 0;
  for (let i = open; i < lexed.mask.length; i++) {
    const c = lexed.mask[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { from: at, to: i + 1 }; }
  }
  throw new Error(`unbalanced braces after anchor: ${anchor}`);
}

// WR-B02: `uses` is judged on the MASKED region (string bodies, template text
// and comments blanked), so a token inside a string literal cannot satisfy it;
// a render-kind entry must contain the literal renderer CALL.
const RENDER_CALL_RE = /\bMASafeHtml\s*\.\s*(?:render|toFragment)\s*\(/;
function regionVerdict(lexed, from, to, entry) {
  const sinks = findSinks(lexed, from, to, entry.file);
  const body = lexed.mask.slice(from, to);
  const uses = (entry.uses || ['MASafeHtml', 'textContent', 'createElement']).filter((tok) => body.includes(tok));
  const renderCall = RENDER_CALL_RE.test(body);
  return { sinks, uses, renderCall };
}

function scanEntry(entry) {
  const lexed = lex(readJs(entry.file));
  const { from, to } = regionOf(lexed, entry.anchor);
  const { sinks, uses, renderCall } = regionVerdict(lexed, from, to, entry);
  const lineOf = (idx) => lexed.code.slice(0, idx).split('\n').length;
  return { lexed, from, to, sinks, uses, renderCall, lines: sinks.map((s) => `${entry.file}:${lineOf(s.index)} ${s.kind}`) };
}

// ----------------------------------------------------------- the gate table
// kind: 'function' (anchor = `function name(`), 'callback' (anchor = the call
// whose callback is the apply block), 'file' (anchor null = whole file).
// `uses` = any-of tokens the region must contain (it renders through one of them),
// judged on code only (strings/comments blanked). `render: true` = the region
// renders stored MARKUP and must contain the literal MASafeHtml.render( or
// MASafeHtml.toFragment( call (WR-B02).
const ENUMERATED_PATHS = [
  // CMS pages: block renderer + legacy body (13-06), page-cms region, banners
  { file: 'page-layout.js', anchor: null, kind: 'file', render: true, uses: ['MASafeHtml.render'], note: 'CMS page blocks + legacy body (13-06)' },
  { file: 'page-cms.js', anchor: null, kind: 'file', render: true, uses: ['MASafeHtml.toFragment'], note: 'CMS page region' },
  { file: 'banners.js', anchor: null, kind: 'file', uses: ['textContent'], note: 'banner title/message are textContent only' },
  // HTML-slide launchers (13-03): overlay + admin slide list
  { file: 'transitions.js', anchor: 'function openHtmlSlide(', kind: 'function', uses: ['textContent'], note: 'slide overlay title/label (13-03)' },
  { file: 'admin-cms.js', anchor: 'function renderSlides(', kind: 'function', uses: ['textContent'], note: 'admin slide list rows' },
  { file: 'admin-cms.js', anchor: 'function loadSlides(', kind: 'function', uses: ['textContent'], note: 'admin slide list load failure' },
  // chatbot messages (T-13-80)
  { file: 'transitions.js', anchor: 'function addMessageBubble(', kind: 'function', render: true, uses: ['MASafeHtml.render'], note: 'chatbot bubble' },
  // i18n apply: [data-i18n] bold pass + [data-i18n-html] (T-13-81)
  { file: 'transitions.js', anchor: 'window.applyPortalI18n = function', kind: 'function', render: true, uses: ['MASafeHtml.render'], note: 'app-wide i18n apply' },
  { file: 'transitions.js', anchor: "querySelectorAll('[data-i18n-html]').forEach(", kind: 'callback', uses: ['setMarkup'], note: '[data-i18n-html] apply block' },
  // AI insight card: model/RAG output (13-09 addition, found by 13-08)
  { file: 'transitions.js', anchor: 'function fetchSmolInsight(', kind: 'function', render: true, uses: ['MASafeHtml.render'], note: 'AI insight card' },
  { file: 'transitions.js', anchor: 'function setSmolInsightError(', kind: 'function', uses: ['textContent'], note: 'AI insight error state' },
  // inline click-to-edit: editI18n restore, startPage, endPage restore, edit bar (T-13-81)
  { file: 'inline-edit.js', anchor: null, kind: 'file', render: true, uses: ['MASafeHtml'], note: 'inline editing (editI18n, startPage, endPage, renderBar)' },
  // lesson body (T-13-82)
  { file: 'employee.js', anchor: 'function openLessonModal(', kind: 'function', render: true, uses: ['MASafeHtml.render'], note: 'lesson modal' },
  // recommended-modules card on the IL/admin dashboard: pmo-writable module records,
  // playbookLink -> href through MASafeHtml.safeHref (CR-B01, Phase 13 review Part B)
  { file: 'dashboard.js', anchor: 'function renderActionModules(', kind: 'function', uses: ['MASafeHtml.safeHref'], note: 'recommended-modules card (CR-B01)' },
];

// Owned and gated by plan 13-11 in the same wave (it rewrites these functions);
// listed so the table is the complete enumeration, not scanned here.
const GATED_ELSEWHERE = [
  { file: 'transitions.js', anchor: 'addSlide', owner: '13-11', note: 'sidebar slide-link builder (label/icon)' },
];

for (const entry of ENUMERATED_PATHS) {
  const label = entry.anchor === null ? '(whole file)' : entry.anchor.replace(/\($/, '');
  test(`render path: ${entry.file} ${label} has no HTML-string sink`, () => {
    const r = scanEntry(entry);
    assert.deepStrictEqual(r.lines, [], `HTML-string sink(s) on an enumerated render path:\n  ${r.lines.join('\n  ')}`);
    assert.ok(r.uses.length > 0, `region must render via ${(entry.uses || ['MASafeHtml', 'textContent', 'createElement']).join(' | ')}`);
    if (entry.render) assert.ok(r.renderCall, 'a markup render path must call MASafeHtml.render( or MASafeHtml.toFragment( literally');
  });
}

function walkJs(visit) {
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === 'vendor' || name === 'node_modules') continue;
      const full = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) { walk(full, r); continue; }
      if (name.endsWith('.js')) visit(r, fs.readFileSync(full, 'utf8'));
    }
  })(PUBLIC_JS, '');
}

test('no client regex sanitizer remains in public/js (stripDangerousHtml and the on*= strip rules are gone)', () => {
  const offenders = [];
  walkJs((rel, src) => {
    const { code } = lex(src);
    if (/\bstripDangerousHtml\b/.test(code)) offenders.push(`${rel}: stripDangerousHtml`);
    code.split('\n').forEach((line, i) => {
      if (line.includes('.replace(') && line.includes('on\\w+')) offenders.push(`${rel}:${i + 1}: handler-strip replace rule`);
    });
  });
  assert.deepStrictEqual(offenders, [], `client regex sanitizer remnants:\n  ${offenders.join('\n  ')}`);
});

test('gated-elsewhere entries are listed (13-11 owns the sidebar slide-link builder)', () => {
  for (const g of GATED_ELSEWHERE) {
    const { code } = lex(readJs(g.file));
    assert.ok(code.includes(g.anchor), `${g.file}: expected to still define ${g.anchor} (owned by ${g.owner})`);
  }
});

// ------------------------------------------------- not-enumerated inventory
// Counts the same sink patterns across every public/js file (vendor excluded).
// These are NOT silently ignored and NOT fixed here: each is bounded by the
// strict CSP (D-13-03 / plan 13-13) and by D-13-03's "exhaustive audit deferred".
test('not-enumerated sink inventory (printed per file; bounded by the CSP, D-13-03)', () => {
  const rows = [];
  walkJs((rel, src) => {
    const lexed = lex(src);
    const sinks = findSinks(lexed, 0, lexed.code.length, rel);
    const byKind = {};
    sinks.forEach((x) => { byKind[x.kind] = (byKind[x.kind] || 0) + 1; });
    if (sinks.length) rows.push({ file: rel, count: sinks.length, byKind });
  });
  const total = rows.reduce((n, r) => n + r.count, 0);
  const lines = rows.sort((a, c) => c.count - a.count || a.file.localeCompare(c.file))
    .map((r) => `  ${String(r.count).padStart(4)}  ${r.file}  ${JSON.stringify(r.byKind)}`);
  console.log(`not-enumerated client sinks (public/js, excluding vendor): ${total} in ${rows.length} file(s)\n${lines.join('\n')}`);
  // Enumerated whole-file entries must contribute nothing to the inventory.
  for (const e of ENUMERATED_PATHS.filter((x) => x.anchor === null)) {
    assert.ok(!rows.some((r) => r.file === e.file), `${e.file} is an enumerated whole-file path and must have no sinks`);
  }
  assert.ok(Number.isInteger(total) && total >= 0);
});

// ------------------------------------------- URL attribute gate (WR-B04)
// [security] WR-B04 / CR-B01 (Phase 13 review, Part B): escaping stops an
// attribute breakout but not a `javascript:` scheme. Every value interpolated
// at the START of an href/src/action/formaction/poster attribute in markup must
// be BOTH scheme-checked and escaped - `escapeHtml(safeLink(v))` and friends -
// and every `.href =` / `.src =` / `setAttribute('href'|'src'|…, v)` must take a
// string literal, a template with a fixed same-origin / http(s) / mailto prefix,
// or the result of a scheme check. Values that are provably not stored data
// (constants, blob: URLs, a same-host-filtered navigation, a data object that is
// not a DOM node) are listed in URL_ATTR_EXEMPT with the reason; a stale
// exemption fails too, so the list cannot rot.
const URL_ATTRS = 'href|src|action|formaction|poster';
const ESCAPERS = '(?:escapeHtml|esc|cmsEsc|escN)';
const CHECKERS = '(?:safeLink|safeUrl|safeVdrUrl|safeHref|playbookHref|(?:window\\.)?MASafeHtml\\.safeHref)';
const SAFE_MARKUP_EXPR = new RegExp(`^\\s*${ESCAPERS}\\(\\s*${CHECKERS}\\(`);
const SAFE_PROP_EXPR = new RegExp(`^\\s*(?:${CHECKERS}\\(|${ESCAPERS}\\(\\s*${CHECKERS}\\()`);
const SAFE_LITERAL_PREFIX = /^(?:\/(?![/\\])|#|\?|mailto:|https?:\/\/[\w.-]+\/|[\w-]+\.html\b)/i;

const URL_ATTR_EXEMPT = [
  { file: 'transitions.js', expr: 'item.href', reason: 'renderSideLink: portalCatalog / resource constants in the same function, never stored data' },
  { file: 'transitions.js', expr: 'PDF', reason: "openPlaybookSlide: PDF is the constant '/playbook/hr-ma-guidebook.pdf'" },
  { file: 'transitions.js', expr: 'escN(it.href)', reason: 'notification panel: it.href values are server constants (server.js notifications builder), escaped' },
  { file: 'transitions.js', expr: 'customHref', reason: 'applyMenuOverrides: local variable holding the MASafeHtml.safeHref() result (WR-B04)' },
  { file: 'transitions.js', expr: 'safeUrl', reason: 'openHtmlSlide: local variable holding the http(s)-checked URL (13-03)' },
  { file: 'transitions.js', expr: 'href', reason: 'applyMenuOverrides tokenOf: detached anchor used only to read pathname/hash, never rendered' },
  { file: 'transitions.js', expr: 'destination', reason: 'page-exit transition: only same-host link targets are intercepted' },
  { file: 'transitions.js', expr: "roleHomePages[newRole] || '/'", reason: 'role switch: constant role -> home-page map' },
  { file: 'due-diligence.js', expr: 'safe', reason: 'VDR links: local variable holding the safeVdrUrl() result' },
  { file: 'execution.js', expr: 'url', reason: 'report export: URL.createObjectURL(blob) download anchor' },
  { file: 'dashboard.js', expr: 'config.src', reason: 'welcome-kit customizer: constant layoutConfigs image paths' },
  { file: 'pages/index-1.js', expr: 'data.href', reason: 'landing role cards: constant roleData map in the same file' },
  { file: 'overview-deck/working-in-a-matrix.js', expr: 's.img', reason: 'static deck scenario table in the same file' },
  { file: 'admin-cms.js', expr: "form.querySelector('#cms-m-href').value.trim()", reason: 'menu editor: writes the plain data object `it`, not a DOM attribute (server urlField validates it)' },
  { file: 'login.js', expr: 'policy.landingFor(me.user, me.user.mustChangePassword === true)', reason: 'post-login redirect: constant role landing map (role-policy.js)' },
  { file: 'login.js', expr: 'policy.landingFor(res.user, must)', reason: 'post-login redirect: constant role landing map (role-policy.js)' },
];

// Returns [{ file, kind, expr, line }] for URL-attribute writes that are not
// provably safe. `exempt` is consulted by the caller.
function findUrlAttrWrites(rel, src) {
  const lexed = lex(src);
  const code = lexed.code;
  const mask = lexed.mask;
  const lineOf = (idx) => code.slice(0, idx).split('\n').length;
  const out = [];
  // (a) markup: attr="${ expr }" - the expression decides the scheme.
  const tpl = new RegExp(`\\b(?:${URL_ATTRS})\\s*=\\s*["']\\$\\{`, 'gi');
  let m;
  while ((m = tpl.exec(code)) !== null) {
    let i = m.index + m[0].length;
    let depth = 1;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
    }
    const expr = code.slice(start, i - 1).trim();
    if (!SAFE_MARKUP_EXPR.test(expr)) out.push({ file: rel, kind: 'markup interpolation', expr, line: lineOf(m.index) });
  }
  // (a2) markup by concatenation: attr="' + expr + '…
  const cat = new RegExp(`\\b(?:${URL_ATTRS})\\s*=\\s*["']['"]\\s*\\+\\s*`, 'gi');
  while ((m = cat.exec(code)) !== null) {
    const rest = code.slice(m.index + m[0].length, m.index + m[0].length + 200);
    const expr = (/^(.*?)\s*\+\s*['"`]/.exec(rest) || [null, rest.split('\n')[0]])[1].trim();
    if (!SAFE_MARKUP_EXPR.test(expr)) out.push({ file: rel, kind: 'markup concatenation', expr, line: lineOf(m.index) });
  }
  // (b) DOM: el.href = expr / el.src = expr / setAttribute('href', expr)
  const judgeProp = (idx, rhsStart, kind) => {
    const rhs = code.slice(rhsStart).split(/[;\n]/)[0].trim().replace(/\)\s*$/, (s) => (kind === 'setAttribute' ? '' : s)).trim();
    const q = rhs.charAt(0);
    if (q === '\'' || q === '"') { if (!/^['"]\s*javascript:/i.test(rhs)) return; }
    else if (q === '`') {
      const lit = rhs.slice(1).split('${')[0];
      if (!rhs.includes('${') || SAFE_LITERAL_PREFIX.test(lit)) return;
    } else if (SAFE_PROP_EXPR.test(rhs)) return;
    out.push({ file: rel, kind, expr: rhs, line: lineOf(idx) });
  };
  const prop = new RegExp(`\\.\\s*(?:${URL_ATTRS}|formAction)\\s*=(?!=)`, 'g');
  while ((m = prop.exec(mask)) !== null) judgeProp(m.index, m.index + m[0].length, 'property assignment');
  const sa = new RegExp(`\\bsetAttribute\\(\\s*(['"])(?:${URL_ATTRS}|xlink:href)\\1\\s*,`, 'gi');
  while ((m = sa.exec(code)) !== null) judgeProp(m.index, m.index + m[0].length, 'setAttribute');
  return out;
}

test('URL attribute gate (WR-B04): every href/src/action write from data is scheme-checked (and escaped in markup)', () => {
  const offenders = [];
  const used = new Set();
  walkJs((rel, src) => {
    for (const hit of findUrlAttrWrites(rel, src)) {
      const ex = URL_ATTR_EXEMPT.findIndex((e) => e.file === rel && e.expr === hit.expr);
      if (ex >= 0) { used.add(ex); continue; }
      offenders.push(`${hit.file}:${hit.line} ${hit.kind}: ${hit.expr}`);
    }
  });
  assert.deepStrictEqual(offenders, [], `unchecked URL attribute write(s) - wrap in escapeHtml(safeLink(...)) / MASafeHtml.safeHref:\n  ${offenders.join('\n  ')}`);
  const stale = URL_ATTR_EXEMPT.filter((e, i) => !used.has(i)).map((e) => `${e.file}: ${e.expr}`);
  assert.deepStrictEqual(stale, [], `stale URL_ATTR_EXEMPT entries:\n  ${stale.join('\n  ')}`);
});

test('URL attribute gate negative control (WR-B04): the review sinks and their shapes are caught; safe forms pass', () => {
  const bad = [
    'function a(m){ return `<a href="${m.playbookLink || \'/playbook.html\'}">x</a>`; }',
    'function a(m){ return `<a href="${escapeHtml(m.playbookLink)}">x</a>`; }',
    'function a(l){ return `<a href="${cmsEsc(l.playbookLink)}">x</a>`; }',
    'function a(url){ return `<video src="${url}"></video>`; }',
    "function a(it){ return '<a href=\"' + it.href + '\">x</a>'; }",
    'function a(link, it){ link.href = it.href; }',
    "function a(el, v){ el.setAttribute('href', v); }",
    "function a(el, v){ el.setAttribute('src', escapeHtml(v)); }",
    'function a(f, v){ f.action = v; }',
    "function a(a){ a.href = 'javascript:void(0)'; }",
    'function a(a, v){ a.href = `${v}/x`; }',
  ];
  for (const src of bad) assert.strictEqual(findUrlAttrWrites('probe.js', src).length, 1, `must be caught: ${src}`);
  const ok = [
    'function a(m){ return `<a href="${escapeHtml(safeLink(m.playbookLink))}">x</a>`; }',
    'function a(l){ return `<a href="${cmsEsc(window.MASafeHtml.safeHref(l.x))}">x</a>`; }',
    'function a(i){ return `<a href="${escapeHtml(safeUrl(i.href))}">x</a>`; }',
    "function a(a){ a.href = '/login.html'; a.src = '/js/x.js?v=1'; }",
    'function a(a, e){ a.href = `mailto:${e}`; a.src = `/api/x/${e}`; }',
    'function a(a, v){ a.href = MASafeHtml.safeHref(v); }',
    "function a(a, v){ a.setAttribute('href', playbookHref(v)); }",
    'function a(a, v){ a.textContent = v; a.className = v; }',
  ];
  for (const src of ok) assert.deepStrictEqual(findUrlAttrWrites('probe.js', src), [], `must pass: ${src}`);
});

// --------------------------------------------------------- negative control
test('scanner negative control: reports real sinks, ignores strings/comments/regex/reads/empty clears', () => {
  const bad = [
    'function f(){ x.innerHTML = y; }',
    'function g(){ x.outerHTML += y; }',
    'function h(){ x.insertAdjacentHTML("beforeend", y); }',
    'function k(){ document.write(y); }',
    'function m(){ x["innerHTML"] = y; }',
    'function t(){ x.innerHTML = `<b>${y}</b>`; }',
  ];
  for (const src of bad) {
    const lexed = lex(src);
    const { from, to } = regionOf(lexed, `function ${src.charAt(9)}(`);
    assert.strictEqual(findSinks(lexed, from, to).length, 1, `sink must be reported: ${src}`);
  }
  const ok = [
    'function a(){ var s = "x.innerHTML = y"; }',
    "function a(){ var s = 'document.write(1)'; }",
    'function a(){ /* x.innerHTML = y */ }',
    'function a(){ // x.innerHTML = y\n var q = 1; }',
    'function a(){ var s = el.innerHTML; var c = el.innerHTML === "x"; }',
    'function a(){ el.innerHTML = ""; el.innerHTML = \'\'; }',
    'function a(){ var r = /"x.innerHTML = y/g; }',
    'function a(){ var s = `x.innerHTML = y`; }',
  ];
  for (const src of ok) {
    const lexed = lex(src);
    const { from, to } = regionOf(lexed, 'function a(');
    assert.strictEqual(findSinks(lexed, from, to).length, 0, `must not be reported: ${src}`);
  }
  // A regex literal holding a quote must not derail the lexer for later code.
  const tricky = lex('var q = s.replace(/"/g, "&quot;");\nfunction z(){ x.innerHTML = y; }');
  const reg = regionOf(tricky, 'function z(');
  assert.strictEqual(findSinks(tricky, reg.from, reg.to).length, 1, 'sink after a quote-bearing regex is still found');
});

// WR-B02 negative controls: every false-pass probe shape from the Phase 13 review
// (Part B) is reported by the hardened matcher, inside an enumerated-style region.
test('scanner negative control (WR-B02): the review probe shapes are all caught', () => {
  const probes = [
    ['setHTMLUnsafe', 'function p(){ el.setHTMLUnsafe(html); }'],
    ['createContextualFragment', 'function p(){ el.append(document.createRange().createContextualFragment(html)); }'],
    ['DOMParser.parseFromString', "function p(){ el.append(...new DOMParser().parseFromString(html,'text/html').body.childNodes); }"],
    ['srcdoc assignment', 'function p(){ fr.srcdoc = html; }'],
    ['bracket innerHTML/outerHTML/srcdoc assignment', "function p(){ fr['srcdoc'] = html; }"],
    ['insertAdjacentElement', "function p(){ el.insertAdjacentElement('beforeend', parsed.firstElementChild); }"],
    ['importNode/adoptNode', 'function p(){ el.appendChild(document.importNode(tpl, true)); }'],
    ['importNode/adoptNode', 'function p(){ el.appendChild(document.adoptNode(parsed.body)); }'],
    ['innerHTML/outerHTML assignment', 'function p(){ el.innerHTML = html; }'],
  ];
  for (const [kind, src] of probes) {
    const lexed = lex(src);
    const { from, to } = regionOf(lexed, 'function p(');
    const kinds = findSinks(lexed, from, to, 'some-page.js').map((x) => x.kind);
    assert.ok(kinds.includes(kind), `probe must be reported as ${kind}: ${src} (got ${JSON.stringify(kinds)})`);
  }
  // parseFromString is exempt ONLY in safe-html.js (the inert-parse renderer).
  const dp = lex("function p(){ var d = new DOMParser().parseFromString(s, 'text/html'); }");
  const r = regionOf(dp, 'function p(');
  assert.strictEqual(findSinks(dp, r.from, r.to, 'safe-html.js').length, 0);
  assert.strictEqual(findSinks(dp, r.from, r.to, 'dashboard.js').length, 1);
  // Prose and strings naming the new sinks are not hits.
  const prose = lex('function p(){ var s = "el.setHTMLUnsafe(x); fr.srcdoc = y"; /* importNode( */ }');
  const pr = regionOf(prose, 'function p(');
  assert.strictEqual(findSinks(prose, pr.from, pr.to, 'x.js').length, 0);
});

test('scanner negative control (WR-B02): `uses` ignores strings; render-kind needs the literal renderer call', () => {
  const entry = { file: 'x.js', uses: ['MASafeHtml', 'textContent', 'createElement'] };
  // A token that only appears inside a string literal does not satisfy `uses`.
  const strOnly = lex('function p(){ var s = "createElement textContent MASafeHtml"; el.append(node); }');
  let reg = regionOf(strOnly, 'function p(');
  assert.deepStrictEqual(regionVerdict(strOnly, reg.from, reg.to, entry).uses, []);
  // An unrelated createElement satisfies `uses` but NOT the render-kind call.
  const unrelated = lex('function p(){ var d = document.createElement("div"); d.className = "x"; }');
  reg = regionOf(unrelated, 'function p(');
  const v = regionVerdict(unrelated, reg.from, reg.to, entry);
  assert.deepStrictEqual(v.uses, ['createElement']);
  assert.strictEqual(v.renderCall, false);
  // The renderer named only in a string is not a call either.
  const fake = lex('function p(){ log("MASafeHtml.render(el, v)"); }');
  reg = regionOf(fake, 'function p(');
  assert.strictEqual(regionVerdict(fake, reg.from, reg.to, entry).renderCall, false);
  // The real call is.
  const real = lex('function p(){ window.MASafeHtml.render(el, v); }');
  reg = regionOf(real, 'function p(');
  assert.strictEqual(regionVerdict(real, reg.from, reg.to, entry).renderCall, true);
});
