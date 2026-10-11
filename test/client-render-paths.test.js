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
//     innerHTML/outerHTML assignment, insertAdjacentHTML or document.write call.
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
function findSinks(lexed, from, to) {
  const out = [];
  const mask = lexed.mask.slice(from, to);
  const patterns = [
    { kind: 'innerHTML/outerHTML assignment', re: /\.\s*(?:innerHTML|outerHTML)\s*\+?=(?!=)/g, assign: true },
    { kind: 'insertAdjacentHTML', re: /\.\s*insertAdjacentHTML\s*\(/g },
    { kind: 'document.write', re: /\bdocument\s*\.\s*write(?:ln)?\s*\(/g },
  ];
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
  const bracket = /\[\s*(['"`])(?:innerHTML|outerHTML)\1\s*\]\s*\+?=(?!=)/g;
  const codeSlice = lexed.code.slice(from, to);
  let b;
  while ((b = bracket.exec(codeSlice)) !== null) out.push({ kind: 'bracket innerHTML/outerHTML assignment', index: from + b.index });
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

function scanEntry(entry) {
  const lexed = lex(readJs(entry.file));
  const { from, to } = regionOf(lexed, entry.anchor);
  const sinks = findSinks(lexed, from, to);
  const body = lexed.code.slice(from, to);
  const uses = (entry.uses || ['MASafeHtml', 'textContent', 'createElement']).filter((tok) => body.includes(tok));
  const lineOf = (idx) => lexed.code.slice(0, idx).split('\n').length;
  return { lexed, from, to, sinks, uses, lines: sinks.map((s) => `${entry.file}:${lineOf(s.index)} ${s.kind}`) };
}

// ----------------------------------------------------------- the gate table
// kind: 'function' (anchor = `function name(`), 'callback' (anchor = the call
// whose callback is the apply block), 'file' (anchor null = whole file).
// `uses` = any-of tokens the region must contain (it renders through one of them).
const ENUMERATED_PATHS = [
  // CMS pages: block renderer + legacy body (13-06), page-cms region, banners
  { file: 'page-layout.js', anchor: null, kind: 'file', uses: ['MASafeHtml.render'], note: 'CMS page blocks + legacy body (13-06)' },
  { file: 'page-cms.js', anchor: null, kind: 'file', uses: ['MASafeHtml.toFragment'], note: 'CMS page region' },
  { file: 'banners.js', anchor: null, kind: 'file', uses: ['textContent'], note: 'banner title/message are textContent only' },
  // HTML-slide launchers (13-03): overlay + admin slide list
  { file: 'transitions.js', anchor: 'function openHtmlSlide(', kind: 'function', uses: ['textContent'], note: 'slide overlay title/label (13-03)' },
  { file: 'admin-cms.js', anchor: 'function renderSlides(', kind: 'function', uses: ['textContent'], note: 'admin slide list rows' },
  { file: 'admin-cms.js', anchor: 'function loadSlides(', kind: 'function', uses: ['textContent'], note: 'admin slide list load failure' },
  // chatbot messages (T-13-80)
  { file: 'transitions.js', anchor: 'function addMessageBubble(', kind: 'function', uses: ['MASafeHtml.render'], note: 'chatbot bubble' },
  // i18n apply: [data-i18n] bold pass + [data-i18n-html] (T-13-81)
  { file: 'transitions.js', anchor: 'window.applyPortalI18n = function', kind: 'function', uses: ['MASafeHtml.render'], note: 'app-wide i18n apply' },
  { file: 'transitions.js', anchor: "querySelectorAll('[data-i18n-html]').forEach(", kind: 'callback', uses: ['setMarkup'], note: '[data-i18n-html] apply block' },
  // AI insight card: model/RAG output (13-09 addition, found by 13-08)
  { file: 'transitions.js', anchor: 'function fetchSmolInsight(', kind: 'function', uses: ['MASafeHtml.render'], note: 'AI insight card' },
  { file: 'transitions.js', anchor: 'function setSmolInsightError(', kind: 'function', uses: ['textContent'], note: 'AI insight error state' },
  // inline click-to-edit: editI18n restore, startPage, endPage restore, edit bar (T-13-81)
  { file: 'inline-edit.js', anchor: null, kind: 'file', uses: ['MASafeHtml'], note: 'inline editing (editI18n, startPage, endPage, renderBar)' },
  // lesson body (T-13-82)
  { file: 'employee.js', anchor: 'function openLessonModal(', kind: 'function', uses: ['MASafeHtml.render'], note: 'lesson modal' },
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
    const sinks = findSinks(lexed, 0, lexed.code.length);
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
