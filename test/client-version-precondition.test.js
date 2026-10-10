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
// whose consequent assigns into a request body or URL. The consequent is the
// brace-matched block when the guard is followed by `{`, otherwise the single
// statement up to its `;`.
function conditionalVersionIdioms(src) {
  const out = [];
  const guard = /if\s*\(([^)]*version\s*!==\s*undefined[^)]*)\)\s*/g;
  const intoRequest = /\b(?:body|payload|[A-Za-z]*Body)\.version\s*=|expectedVersion|\b(?:url|[A-Za-z]*Url|path|href)\s*\+=/;
  let m;
  while ((m = guard.exec(src)) !== null) {
    const rest = m.index + m[0].length;
    let consequent;
    if (src[rest] === '{') {
      const close = braceMatch(src, rest);
      consequent = src.slice(rest, close === -1 ? rest + 400 : close + 1);
    } else {
      const semi = src.indexOf(';', rest);
      consequent = src.slice(rest, semi === -1 ? rest + 200 : semi + 1);
    }
    if (intoRequest.test(consequent)) out.push(m[0] + consequent.slice(0, 80));
  }
  return out;
}

function countOf(src, token) {
  return (src.match(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
}

test('client-version-precondition (C3): no conditional-version idiom in execution.js / org.js / due-diligence.js, and maVersionOf at every call site', () => {
  // Lines such as `if (res.initiative && res.initiative.version !== undefined) item.version = res.initiative.version;`
  // sync held STATE from a response and are not violations (C3 header).
  const files = ['execution.js', 'org.js', 'due-diligence.js'];
  files.forEach((f) => {
    const src = readPublicJs(f);
    assert.deepStrictEqual(conditionalVersionIdioms(src), [], `${f}: a conditional version idiom omits the precondition for a never-edited record (R7 F-1, D-02, D-09)`);
  });
  const exec = countOf(readPublicJs('execution.js'), 'maVersionOf(');
  const org = countOf(readPublicJs('org.js'), 'maVersionOf(');
  const dd = countOf(readPublicJs('due-diligence.js'), 'maVersionOf(');
  assert.ok(exec >= 13, `execution.js must call maVersionOf( at >= 13 sites (found ${exec})`);
  assert.ok(org >= 2, `org.js must call maVersionOf( at >= 2 sites (found ${org})`);
  assert.ok(dd >= 4, `due-diligence.js must call maVersionOf( at >= 4 sites (found ${dd})`);
});

test('client-version-precondition (C4): no other public/js file writes to an existing versioned record', () => {
  // Every (file, endpoint) pair outside the three swept pages must be classified
  // here. All four are create / read only (no edit or delete of an existing
  // record). A new writer elsewhere fails until it is added AND swept.
  const allow = [
    'deal-home.js::/api/synergies/rollup',
    'deal-wizard.js::/api/integration-tasks/instantiate',
    'deal-wizard.js::/api/dd/request-items/instantiate',
    'assessments.js::/api/integration-tasks/from-remediation'
  ];
  const swept = new Set(['execution.js', 'org.js', 'due-diligence.js']);
  const endpoint = /\/api\/(?:raid|integration-tasks|synergies|org\/positions|org\/flight-risk|dd\/request-items|dd\/findings|dd\/vdr-links)[A-Za-z0-9_\-/.]*/g;
  const found = new Set();
  (function walk(dir, rel) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      if (e.isDirectory()) {
        if (e.name === 'vendor') return;
        walk(path.join(dir, e.name), rel + e.name + '/');
      } else if (e.name.endsWith('.js') && !swept.has(rel + e.name)) {
        const src = fs.readFileSync(path.join(dir, e.name), 'utf8');
        (src.match(endpoint) || []).forEach((m) => found.add(rel + e.name + '::' + m));
      }
    });
  })(PUBLIC_JS, '');
  const unclassified = Array.from(found).filter((p) => allow.indexOf(p) === -1).sort();
  assert.deepStrictEqual(unclassified, [], 'a public/js file outside the three swept pages references a versioned route; classify it (read/create only) or sweep it onto window.maVersionOf');
  const stale = allow.filter((p) => !found.has(p));
  assert.deepStrictEqual(stale, [], 'allow-list entries that no longer exist should be removed so the guard stays exact');
});

test('client-version-precondition (C3a): the task status-flip handler sends maVersionOf unconditionally and re-reads after a conflict', () => {
  const src = readPublicJs('execution.js');
  const handler = handlerAfter(src, "row.querySelector('.ex-status').addEventListener('click'");
  assert.ok(/maVersionOf\(/.test(handler), 'the task flip must send window.maVersionOf(task)');
  assert.deepStrictEqual(conditionalVersionIdioms(handler), [], 'no conditional-version guard in the task flip (R7 F-1)');
  assert.ok(/reloadAfterConflict\(/.test(handler), 'the task flip must have a non-success branch calling reloadAfterConflict( (GD-5)');
});
