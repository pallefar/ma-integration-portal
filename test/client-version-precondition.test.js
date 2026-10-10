// CONC-02 gap closure (Phase 9, plan 09-08, GD-1, R7 F-1): the CLIENT half of
// the version precondition.
//
//   C1 — behaviour of `window.maVersionOf`, the shared helper, exercised
//        through node:vm over the sentinel-delimited `ma-fetch-wrapper`
//        region of public/js/transitions.js (same extraction approach as
//        test/client-conflict-dialog.test.js).
//   C2 — source-level structure of `renderRaid()` in public/js/execution.js:
//        it sends `maVersionOf(...)` at both write call sites and has no
//        branch that conditionally OMITS the version.
//
// Scope grows in plan 09-12 to every call site in execution.js, org.js and
// due-diligence.js.
//
// node:test — run via `node --test test/client-version-precondition.test.js`.

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const path = require('path');

function extractWrapperRegion() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'transitions.js'), 'utf8');
  const beginIdx = src.indexOf('ma-fetch-wrapper:begin');
  const endIdx = src.indexOf('ma-fetch-wrapper:end');
  assert.ok(beginIdx >= 0 && endIdx > beginIdx, 'expected ma-fetch-wrapper:begin/end sentinels in transitions.js');
  return src.slice(src.indexOf('\n', beginIdx) + 1, src.lastIndexOf('\n', endIdx));
}

function loadHelper() {
  const location = { href: 'https://example.test/execution.html', origin: 'https://example.test', pathname: '/execution.html' };
  const window = { fetch: () => Promise.resolve({}), location };
  const noop = () => {};
  const element = () => ({ style: {}, appendChild: noop, setAttribute: noop, addEventListener: noop, classList: { add: noop, remove: noop } });
  const document = { body: element(), createElement: element, createTextNode: () => ({}), addEventListener: noop, removeEventListener: noop, querySelectorAll: () => [] };
  const localStorage = { getItem: () => null, setItem: noop };
  const sandbox = { window, location, document, localStorage, URL, Headers, setTimeout, console };
  vm.createContext(sandbox);
  vm.runInContext(extractWrapperRegion(), sandbox);
  return window.maVersionOf;
}

test('client-version-precondition (C1): window.maVersionOf returns the held version for a non-negative integer and 0 in every other case', () => {
  const maVersionOf = loadHelper();
  assert.strictEqual(typeof maVersionOf, 'function', 'the wrapper region must define window.maVersionOf');
  assert.strictEqual(maVersionOf({ version: 3 }), 3);
  assert.strictEqual(maVersionOf({ version: 0 }), 0);
  assert.strictEqual(maVersionOf({}), 0, 'absent field -> 0 (D-09)');
  assert.strictEqual(maVersionOf({ version: null }), 0);
  assert.strictEqual(maVersionOf({ version: '2' }), 0, 'a string is not a version');
  assert.strictEqual(maVersionOf({ version: -1 }), 0);
  assert.strictEqual(maVersionOf({ version: 1.5 }), 0);
  assert.strictEqual(maVersionOf({ version: NaN }), 0);
  assert.strictEqual(maVersionOf(null), 0);
  assert.strictEqual(maVersionOf(undefined), 0);
});

function braceMatch(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function functionBody(src, name) {
  const marker = `function ${name}(`;
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `function ${name} not found`);
  const open = src.indexOf('{', start);
  const close = braceMatch(src, open);
  assert.ok(close !== -1, `could not isolate the body of ${name}`);
  return src.slice(open, close + 1);
}

test('client-version-precondition (C2): renderRaid() sends maVersionOf(...) at both write sites and never conditionally omits the version', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'execution.js'), 'utf8');
  const body = functionBody(src, 'renderRaid');
  const uses = body.match(/maVersionOf\(/g) || [];
  assert.ok(uses.length >= 2, `renderRaid() must call maVersionOf( at the status flip and the delete (found ${uses.length})`);
  const conditional = body.match(/if\s*\([^)]*\.version\s*!==\s*undefined[^)]*\)/g) || [];
  assert.deepStrictEqual(conditional, [], 'no branch may conditionally add a version to a request — an omitted precondition is refused in a real deal (R7 F-1)');
});

// ---------------------------------------------------------------------------
// Plan 09-12 — client sweep (GD-1, GD-5, T-09-36, T-09-49).
//
// C3 flags ONLY a guard whose consequent assigns into a request body or URL
// (e.g. `body.version =`, `expectedVersion=`). Legitimate state-sync lines
// such as `res.initiative.version !== undefined` or `item.version = res...`
// are NOT violations.
// ---------------------------------------------------------------------------

const PUBLIC_JS = path.join(__dirname, '..', 'public', 'js');

function readPublicJs(name) {
  return fs.readFileSync(path.join(PUBLIC_JS, name), 'utf8');
}

// Brace-matched body of the first function expression following `anchor`.
function handlerAfter(src, anchor) {
  const a = src.indexOf(anchor);
  assert.ok(a !== -1, `anchor not found: ${anchor}`);
  const open = src.indexOf('{', src.indexOf('function', a));
  const close = braceMatch(src, open);
  assert.ok(close !== -1, `could not isolate the handler after: ${anchor}`);
  return src.slice(open, close + 1);
}

// A conditional-version idiom: an `if (... version !== undefined ...)` guard
// whose consequent assigns into a request body or URL.
function conditionalVersionIdioms(src) {
  const out = [];
  const guard = /if\s*\(([^)]*version\s*!==\s*undefined[^)]*)\)\s*([^;\n{]*;?)/g;
  let m;
  while ((m = guard.exec(src)) !== null) {
    const consequent = m[2] || '';
    if (/\.version\s*=|\bversion\s*:|expectedVersion|(url|path|href)\s*\+=/i.test(consequent)) out.push(m[0]);
  }
  return out;
}

test('client-version-precondition (C3a): the task status-flip handler sends maVersionOf unconditionally and re-reads after a conflict', () => {
  const src = readPublicJs('execution.js');
  const handler = handlerAfter(src, "row.querySelector('.ex-status').addEventListener('click'");
  assert.ok(/maVersionOf\(/.test(handler), 'the task flip must send window.maVersionOf(task)');
  assert.deepStrictEqual(conditionalVersionIdioms(handler), [], 'no conditional-version guard in the task flip (R7 F-1)');
  assert.ok(/reloadAfterConflict\(/.test(handler), 'the task flip must have a non-success branch calling reloadAfterConflict( (GD-5)');
});
