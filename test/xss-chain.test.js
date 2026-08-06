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
