// T-X2J-01..09: closes the three-link stored-XSS chain proven live against
// current `main` by two independent Fable 5 security reviews (260806-x2j).
//
// Group (a) — F1, Task 1: public/js/leaders.js's Leaders Portal roster
// (`renderDirectReports`) and Buddy chat bubble (`appendMessageBubble`) both
// assign attacker-reachable `/api/employees` fields to `innerHTML`. This is a
// browser `DOMContentLoaded` IIFE and is not requireable (mirrors
// test/deal-wizard-page.test.js's own source-inspection idiom), so its
// escaping guarantees are asserted at source level, not via a DOM harness.
//
// Group (b) — F2, Task 2: the shared handler-strip regex is duplicated
// across THREE independent files — lib/sanitizeHtml.js (server-side,
// write-time), public/js/page-layout.js and public/js/transitions.js
// (client-side, render-time) — and all three required a leading `[\s/]`
// class (not `\s` alone) to stop the slash-separated `<img/onerror=...>`
// bypass. Proven four ways: neutralization, benign-markup survival, a
// db.json corpus differential (zero divergences across every shipped
// content value), and an anti-drift guard mirroring test/dd-findings.test.js's
// RAID_LEVELS three-copy check.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEADERS_JS_PATH = path.join(ROOT, 'public', 'js', 'leaders.js');
const SANITIZE_HTML_PATH = path.join(ROOT, 'lib', 'sanitizeHtml.js');
const PAGE_LAYOUT_PATH = path.join(ROOT, 'public', 'js', 'page-layout.js');
const TRANSITIONS_PATH = path.join(ROOT, 'public', 'js', 'transitions.js');
const DB_JSON_PATH = path.join(ROOT, 'db.json');

const leadersJs = fs.readFileSync(LEADERS_JS_PATH, 'utf8');

// ===========================================================================
// Group (a) — Task 1 — F1: public/js/leaders.js source-level escaping proof
// ===========================================================================

test('xss-chain (a1): no bare interpolation of the employee name identifier survives in leaders.js', () => {
  // A bare `${emp.name}` (not wrapped in escapeHtml(...)) reaching innerHTML
  // is the exact F1 sink the reviewer proved live. Any surviving match here
  // is a live regression, not a style nit.
  const bareName = /\$\{emp\.name\}/g;
  const matches = leadersJs.match(bareName) || [];
  assert.strictEqual(matches.length, 0, `found ${matches.length} unescaped interpolation(s) of emp.name — every use must be wrapped in escapeHtml(...)`);
});

test('xss-chain (a2): no bare interpolation of the employee role identifier survives in leaders.js', () => {
  const bareRole = /\$\{emp\.role\}/g;
  const matches = leadersJs.match(bareRole) || [];
  assert.strictEqual(matches.length, 0, `found ${matches.length} unescaped interpolation(s) of emp.role — every use must be wrapped in escapeHtml(...)`);
});

test('xss-chain (a3): no bare interpolation of the name-indexed-at-zero avatar-initial expression survives in leaders.js', () => {
  // Matches `${emp.name[0]}` or the null-guarded `${(emp.name || '')[0]}`
  // shape ONLY when it is NOT already wrapped by escapeHtml(...).
  const bareIndexed = /\$\{(?!escapeHtml\()[^}]*emp\.name[^}]*\[0\]\}/g;
  const matches = leadersJs.match(bareIndexed) || [];
  assert.strictEqual(matches.length, 0, `found ${matches.length} unescaped interpolation(s) of the name-indexed-at-zero avatar initial — must be wrapped in escapeHtml(...)`);
});

test('xss-chain (a4): escapeHtml is referenced at least four times inside the roster + buddy-chat template region', () => {
  // 3 in renderDirectReports (avatar initial, name, role) + at least 1 in
  // appendMessageBubble (both branches now escape, closing the asymmetry).
  const templateRegionStart = leadersJs.indexOf('function renderDirectReports');
  const templateRegionEnd = leadersJs.indexOf('function escapeHtml(str)');
  assert.ok(templateRegionStart > -1 && templateRegionEnd > templateRegionStart, 'could not locate the roster/buddy-chat template region in leaders.js');
  const region = leadersJs.slice(templateRegionStart, templateRegionEnd);
  const calls = region.match(/escapeHtml\(/g) || [];
  assert.ok(calls.length >= 4, `expected at least 4 escapeHtml(...) call sites in the roster/buddy-chat template region, found ${calls.length}`);
});

test('xss-chain (a5): the escapeHtml helper itself coerces its argument rather than calling .replace directly on it', () => {
  // A raw `str.replace(...)` throws on null/undefined and stringifies a
  // number/array via implicit coercion inconsistently — the plan's
  // "missing or non-string name does not throw" behavior requires the
  // helper to coerce FIRST (String(str == null ? '' : str)), not call
  // .replace() on the bare parameter.
  const helperMatch = leadersJs.match(/function escapeHtml\(str\) \{[\s\S]*?\n  \}/);
  assert.ok(helperMatch, 'could not locate the escapeHtml function body in leaders.js');
  const body = helperMatch[0];
  assert.ok(!/return str\s*\n?\s*\.replace/.test(body), 'escapeHtml must not call .replace directly on the bare "str" parameter — coerce non-string/null/undefined first');
  assert.ok(/String\(str == null \? '' : str\)/.test(body) || /String\(str/.test(body), 'escapeHtml must coerce its argument via String(...) before the replace chain');
});

test('xss-chain (a6): escapeHtml neutralizes markup when treated as a pure function (behavioral proof, source-extracted)', () => {
  // Extract and eval the helper in isolation (no DOM/module boundary — it is
  // a pure string function) to prove it actually neutralizes markup and
  // survives null/undefined/non-string input without throwing.
  const helperMatch = leadersJs.match(/function escapeHtml\(str\) \{[\s\S]*?\n  \}/);
  assert.ok(helperMatch, 'could not locate the escapeHtml function body in leaders.js');
  // eslint-disable-next-line no-new-func
  const escapeHtml = new Function(`${helperMatch[0]}\nreturn escapeHtml;`)();
  assert.strictEqual(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
  assert.doesNotThrow(() => escapeHtml(undefined));
  assert.doesNotThrow(() => escapeHtml(null));
});

// ===========================================================================
// Group (b) — Task 2 — F2: three-copy sanitizer separator-class widening
// ===========================================================================

const { sanitizeHtml } = require(SANITIZE_HTML_PATH);
const pageLayoutJs = fs.readFileSync(PAGE_LAYOUT_PATH, 'utf8');
const transitionsJs = fs.readFileSync(TRANSITIONS_PATH, 'utf8');

// (b1) Neutralization — six variants of the slash-separated handler shape.
// The forward slash is a valid HTML attribute separator; the pre-fix regex
// required whitespace before the handler name, so `<img/onerror=...>` (and
// its quoting/case/doubled-slash variants) passed through untouched.
const BYPASS_VARIANTS = [
  { label: 'unquoted, single slash', payload: '<img/onerror=alert(1)>' },
  { label: 'double-quoted, single slash', payload: '<img/onerror="alert(1)">' },
  { label: "single-quoted, single slash", payload: "<img/onerror='alert(1)'>" },
  { label: 'unquoted, doubled slash', payload: '<img//onerror=alert(1)>' },
  { label: 'mixed-case handler name, unquoted, single slash', payload: '<img/OnErRor=alert(1)>' },
  { label: 'mixed-case handler name, double-quoted, single slash', payload: '<svg/OnLoad="alert(1)">' },
];

test('xss-chain (b1): lib/sanitizeHtml.js neutralizes all six slash-separated handler bypass variants', () => {
  for (const { label, payload } of BYPASS_VARIANTS) {
    const result = sanitizeHtml(payload);
    assert.ok(!/on\w+\s*=/i.test(result), `bypass NOT neutralized (${label}): input=${JSON.stringify(payload)} output=${JSON.stringify(result)}`);
  }
});

test('xss-chain (b1-whitespace): the pre-existing whitespace-separated shapes stay neutralized after widening the class', () => {
  const whitespaceVariants = [
    '<img src=x onerror=alert(1)>',
    '<img src=x onerror="alert(1)">',
    "<img src=x onerror='alert(1)'>",
  ];
  for (const payload of whitespaceVariants) {
    const result = sanitizeHtml(payload);
    assert.ok(!/on\w+\s*=/i.test(result), `pre-existing whitespace-separated bypass regressed: input=${JSON.stringify(payload)} output=${JSON.stringify(result)}`);
  }
});

// (b2) Benign survival — an over-aggressive regex that eats a legitimate
// attribute would be its own bug, so this half of the proof is not optional.
const BENIGN_STRINGS = [
  { label: 'paragraph with a class attribute', value: '<p class="foo">Hello</p>' },
  { label: 'anchor with a rooted path href', value: '<a href="/playbook/hr-ma-guidebook.pdf">Guide</a>' },
  { label: 'checkbox input with an id', value: '<input type="checkbox" id="chk-1">' },
  { label: 'real shipped i18n string containing a strong tag (en/intexc.buddy_li1)', value: '<strong>Mentor Selection Criteria:</strong> High performers with at least 3 years at TE.' },
];

test('xss-chain (b2): ordinary markup round-trips byte-identical through the widened sanitizer', () => {
  for (const { label, value } of BENIGN_STRINGS) {
    const result = sanitizeHtml(value);
    assert.strictEqual(result, value, `benign markup was altered (${label}): input=${JSON.stringify(value)} output=${JSON.stringify(result)}`);
  }
});

// (b3) Corpus differential — every string value shipped in db.json (i18n
// strings across en/de/zh/cs, plus the 3 page bodies) must sanitize
// byte-identically before and after the widened separator class. The
// FROZEN_PRE_FIX_SANITIZE function below is the exact pre-fix regex chain
// (whitespace-only separator), inlined so this comparison never drifts if
// lib/sanitizeHtml.js changes again later.
function frozenPreFixSanitize(value) {
  const s = typeof value === 'string' ? value : '';
  return s
    .replace(/<\/?(?:script|iframe|object|embed|form|meta|base|link)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/(=\s*["']?\s*)(?:javascript|vbscript)\s*:/gi, '$1');
}

test('xss-chain (b3): db.json corpus differential — zero divergences between the widened and pre-fix sanitizer across every shipped content value', () => {
  const db = JSON.parse(fs.readFileSync(DB_JSON_PATH, 'utf8'));
  const corpus = [];

  const langs = Object.keys(db.i18n && db.i18n.strings ? db.i18n.strings : {});
  for (const lang of langs) {
    for (const [key, value] of Object.entries(db.i18n.strings[lang])) {
      if (typeof value === 'string') corpus.push({ source: `i18n.${lang}.${key}`, value });
    }
  }
  for (const page of db.pages || []) {
    if (page.body && typeof page.body === 'object') {
      for (const [lang, value] of Object.entries(page.body)) {
        if (typeof value === 'string') corpus.push({ source: `pages.${page.slug}.body.${lang}`, value });
      }
    } else if (typeof page.body === 'string') {
      corpus.push({ source: `pages.${page.slug}.body`, value: page.body });
    }
  }

  assert.ok(corpus.length >= 3000, `corpus walk found only ${corpus.length} string values — expected at least 3,000; the walk may be silently empty`);

  const divergences = [];
  for (const { source, value } of corpus) {
    const before = frozenPreFixSanitize(value);
    const after = sanitizeHtml(value);
    if (before !== after) divergences.push({ source, before, after });
  }

  assert.strictEqual(divergences.length, 0, `${divergences.length} shipped content value(s) diverged after widening the separator class (first: ${JSON.stringify(divergences[0])}) — this is a genuine content regression to inspect, not test noise`);
});

// (b4) Anti-drift — mirrors test/dd-findings.test.js's RAID_LEVELS three-copy
// guard: extract the handler-strip replace lines from all three files and
// assert they stay byte-identical (after trimming indentation) forever.
function extractHandlerStripLines(sourceText) {
  return sourceText
    .split('\n')
    .filter((line) => line.includes('.replace(') && line.includes('on\\w+'))
    .map((line) => line.trim());
}

test('xss-chain (b4): all three sanitizer copies carry byte-identical handler-strip rules (anti-drift)', () => {
  const fromSanitizeHtml = extractHandlerStripLines(fs.readFileSync(SANITIZE_HTML_PATH, 'utf8'));
  const fromPageLayout = extractHandlerStripLines(pageLayoutJs);
  const fromTransitions = extractHandlerStripLines(transitionsJs);

  const namedSequences = {
    'lib/sanitizeHtml.js': fromSanitizeHtml,
    'public/js/page-layout.js': fromPageLayout,
    'public/js/transitions.js': fromTransitions,
  };
  for (const [file, lines] of Object.entries(namedSequences)) {
    assert.strictEqual(lines.length, 3, `expected exactly 3 handler-strip replace lines in ${file}, found ${lines.length}`);
    for (const line of lines) {
      assert.ok(line.includes('[\\s/]on\\w+'), `${file} handler-strip line does not carry the widened [\\s/] separator class: ${line}`);
    }
  }

  assert.deepStrictEqual(
    fromPageLayout,
    fromSanitizeHtml,
    'public/js/page-layout.js and lib/sanitizeHtml.js are independent hand-maintained copies of the same handler-strip rule that must be kept in sync by hand — they have drifted apart',
  );
  assert.deepStrictEqual(
    fromTransitions,
    fromSanitizeHtml,
    'public/js/transitions.js and lib/sanitizeHtml.js are independent hand-maintained copies of the same handler-strip rule that must be kept in sync by hand — they have drifted apart',
  );
});
