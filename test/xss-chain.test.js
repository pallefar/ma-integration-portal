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
const { inertViolations } = require('./helpers/html-inert.js');
const { parseDocument } = require('htmlparser2');
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
  // 13-01 (SAFE-01): re-pointed from a regex-on-output assertion to the
  // structural checker (parse + walk against lib/htmlPolicy.js) — the output
  // must contain no on* attribute and no non-allowlisted element/URL.
  for (const { label, payload } of BYPASS_VARIANTS) {
    const result = sanitizeHtml(payload);
    assert.deepStrictEqual(inertViolations(result), [], `bypass NOT neutralized (${label}): input=${JSON.stringify(payload)} output=${JSON.stringify(result)}`);
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
    assert.deepStrictEqual(inertViolations(result), [], `pre-existing whitespace-separated bypass regressed: input=${JSON.stringify(payload)} output=${JSON.stringify(result)}`);
  }
});

// (b2) Benign survival — an over-aggressive regex that eats a legitimate
// attribute would be its own bug, so this half of the proof is not optional.
// 13-01 (SAFE-01): the parser policy (lib/htmlPolicy.js) is allowlist-only, so
// two shapes the regex era let through are no longer "ordinary markup":
//  - `<input type="checkbox" id=…>` — `input` is on the PRD never-allowed list
//    (and `id` is never allowed, DOM clobbering); asserted below as REMOVED;
//  - `<a href="/rooted/path">` is kept but now carries the forced
//    rel="noopener noreferrer" — asserted structurally, not byte-identical.
const BENIGN_STRINGS = [
  { label: 'paragraph with a class attribute', value: '<p class="foo">Hello</p>' },
  { label: 'real shipped i18n string containing a strong tag (en/intexc.buddy_li1)', value: '<strong>Mentor Selection Criteria:</strong> High performers with at least 3 years at TE.' },
  { label: 'list with inline formatting', value: '<ul><li><b>One</b></li><li><em>Two</em></li></ul>' },
  { label: 'table with a header cell', value: '<table><tbody><tr><th scope="col">A</th><td colspan="2">B</td></tr></tbody></table>' },
];

test('xss-chain (b2): ordinary markup round-trips byte-identical through the parser sanitizer', () => {
  for (const { label, value } of BENIGN_STRINGS) {
    const result = sanitizeHtml(value);
    assert.strictEqual(result, value, `benign markup was altered (${label}): input=${JSON.stringify(value)} output=${JSON.stringify(result)}`);
  }
});

test('xss-chain (b2-policy): a rooted-path anchor keeps its href with the forced rel; a checkbox input (never-allowed) is removed', () => {
  const a = parseDocument(sanitizeHtml('<a href="/playbook/hr-ma-guidebook.pdf">Guide</a>')).children[0];
  assert.strictEqual(a.name, 'a');
  assert.strictEqual(a.attribs.href, '/playbook/hr-ma-guidebook.pdf');
  assert.strictEqual(a.attribs.rel, 'noopener noreferrer');
  const out = sanitizeHtml('<input type="checkbox" id="chk-1">');
  assert.deepStrictEqual(inertViolations(out), []);
  assert.strictEqual(parseDocument(out).children.filter((n) => n.name === 'input').length, 0, 'input must be removed');
});

// (b3) Corpus differential — every string value shipped in db.json (i18n
// strings across en/de/zh/cs, plus the 3 page bodies) must sanitize
// byte-identically before and after the widened separator class. The
// FROZEN_PRE_FIX_SANITIZE function below is the exact pre-fix regex chain
// (whitespace-only separator), inlined so this comparison never drifts if
// lib/sanitizeHtml.js changes again later.
//
// 13-01 (SAFE-01): the regex-era sanitizer is retired, so the differential is
// re-pointed at BEHAVIOUR: a divergence is a shipped value whose parsed
// structure (element tree, attributes, text) differs before vs after
// sanitizeHtml(). Serialization-only differences (`&` -> `&amp;`,
// `<br>` -> `<br />`) are not divergences — the DOM is identical. The 24
// shipped playbook checklist strings that embed `<input type="checkbox">`
// are the one documented, ASSERTED exception: `input` is on the PRD
// never-allowed list, so the parser removes it (the dictionary is not
// server-tagged, PD-5 — the removal happens at render via MASafeHtml, 13-09).
function canonicalDom(html, dropInputs) {
  const walk = (nodes) => nodes.map((n) => {
    if (n.type === 'text') return { t: n.data };
    if (n.name) return { e: n.name, a: Object.entries(n.attribs || {}).sort(), c: walk(n.children || []) };
    return { o: n.type };
  }).filter((n) => !(dropInputs && n.e === 'input'));
  const merge = (arr) => {
    const out = [];
    for (const x of arr) {
      if (x.c) x.c = merge(x.c);
      if (x.t !== undefined && out.length && out[out.length - 1].t !== undefined) out[out.length - 1].t += x.t;
      else out.push(x);
    }
    return out;
  };
  return JSON.stringify(merge(walk(parseDocument(String(html)).children)));
}

test('xss-chain (b3): db.json corpus differential — zero structural divergences between shipped content and its sanitized form (documented checkbox exception asserted exactly)', () => {
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
  const explainedCheckboxOnly = [];
  for (const { source, value } of corpus) {
    const after = sanitizeHtml(value);
    if (canonicalDom(after, false) === canonicalDom(value, false)) continue;
    if (canonicalDom(after, false) === canonicalDom(value, true)) { explainedCheckboxOnly.push(source); continue; }
    divergences.push({ source, before: value, after });
  }

  assert.strictEqual(divergences.length, 0, `${divergences.length} shipped content value(s) diverged structurally under the parser sanitizer (first: ${JSON.stringify(divergences[0])}) — this is a genuine content regression to inspect, not test noise`);
  // The documented exception, pinned exactly so a new checkbox string (or a new
  // divergence class hiding behind this exception) fails loudly.
  assert.strictEqual(explainedCheckboxOnly.length, 24, `expected exactly 24 shipped checkbox-bearing playbook strings, found ${explainedCheckboxOnly.length}`);
  for (const source of explainedCheckboxOnly) {
    assert.ok(/^i18n\.[a-z]{2}\.playbook\.(culture_milestone|talent_checklist)_\d+$/.test(source), `unexpected checkbox-bearing source: ${source}`);
  }
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

// 13-01 (SAFE-01): lib/sanitizeHtml.js no longer carries a regex copy (it is
// the vendored parser driven by lib/htmlPolicy.js), so this guard loses that
// leg and keeps ONLY the page-layout.js <-> transitions.js client-copy parity.
// Plans 13-06 and 13-09 retire those two client copies (MASafeHtml replaces
// them); this test is then removed with them.
test('xss-chain (b4): the two remaining client sanitizer copies carry byte-identical handler-strip rules (anti-drift) and lib/sanitizeHtml.js carries none', () => {
  const fromSanitizeHtml = extractHandlerStripLines(fs.readFileSync(SANITIZE_HTML_PATH, 'utf8'));
  assert.strictEqual(fromSanitizeHtml.length, 0, 'lib/sanitizeHtml.js must not carry a regex handler-strip rule — it is the parser sanitizer');

  const fromPageLayout = extractHandlerStripLines(pageLayoutJs);
  const fromTransitions = extractHandlerStripLines(transitionsJs);

  const namedSequences = {
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
    fromTransitions,
    fromPageLayout,
    'public/js/transitions.js and public/js/page-layout.js are independent hand-maintained copies of the same handler-strip rule that must be kept in sync by hand — they have drifted apart',
  );
});
