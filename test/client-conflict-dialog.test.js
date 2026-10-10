// CONC-02/D-05/Pitfall-1/Pitfall-11/T-09-14/T-09-16 (Phase 9 Plan 03): behavioral
// proof of the shared conflict-recovery dialog's wrapper-detected 409 branch in
// public/js/transitions.js — that a 409 is never machine-retried, that an
// unrelated 409 opens no dialog, and that a second conflict re-renders one
// overlay in place rather than stacking a second one.
//
// Built on test/client-busy-retry.test.js's own harness (Plan 04, Phase 8):
// the same sentinel-delimited `ma-fetch-wrapper` region is extracted and run
// through node:vm against a minimal stubbed browser global set. That harness's
// `document` stub only records appendChild/removeChild calls — this file's
// dialog assertions need a real (if tiny) DOM tree with class selectors, event
// listeners and a `.click()` convenience, so this file builds its own richer
// `document`/`createElement` stub rather than importing the other file's.
//
// This test's "second writer" is a scripted fake window.fetch returning a
// queued response sequence — correct here because this proves CLIENT control
// flow (dialog render/re-render, fetch call count/shape), not SQLite locking;
// the real cross-process proof lives in
// test/optimistic-locking-cross-process.test.js (Plan 01).
//
// node:test — Node's built-in runner. Run via `node --test
// test/client-conflict-dialog.test.js` (or bare `node --test`). Never `node
// --test test/` (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const path = require('path');

function extractWrapperRegion() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'transitions.js'), 'utf8');
  const beginMarker = 'ma-fetch-wrapper:begin';
  const endMarker = 'ma-fetch-wrapper:end';
  const beginIdx = src.indexOf(beginMarker);
  const endIdx = src.indexOf(endMarker);
  assert.ok(beginIdx >= 0 && endIdx > beginIdx, 'expected ma-fetch-wrapper:begin/end sentinels in transitions.js');
  const afterBeginLineStart = src.indexOf('\n', beginIdx) + 1;
  const beforeEndLineStart = src.lastIndexOf('\n', endIdx);
  return src.slice(afterBeginLineStart, beforeEndLineStart);
}

const WRAPPER_SRC = extractWrapperRegion();

// ---- Minimal DOM: text nodes + elements with class selectors, listeners,
// and a real parent/child tree (needed for querySelectorAll + textContent
// aggregation, which the dialog's own attribution-rendering relies on). ----

function createTextNode(text) {
  const node = {
    nodeType: 3,
    parentNode: null,
    _text: text === undefined || text === null ? '' : String(text),
  };
  Object.defineProperty(node, 'textContent', {
    get() { return node._text; },
    set(v) { node._text = v === undefined || v === null ? '' : String(v); },
  });
  return node;
}

function createElement(tag) {
  const el = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    style: {},
    attributes: {},
    children: [],
    parentNode: null,
    disabled: false,
    type: undefined,
    _classes: new Set(),
    _listeners: {},
  };
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._classes).join(' '); },
    set(v) { el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(el, 'textContent', {
    get() { return el.children.map((c) => c.textContent).join(''); },
    set(v) {
      el.children = [];
      const t = createTextNode(v);
      t.parentNode = el;
      el.children.push(t);
    },
  });
  el.classList = {
    add(c) { el._classes.add(c); },
    remove(c) { el._classes.delete(c); },
    contains(c) { return el._classes.has(c); },
  };
  el.appendChild = (child) => {
    if (child.parentNode && child.parentNode.children) {
      const idx = child.parentNode.children.indexOf(child);
      if (idx >= 0) child.parentNode.children.splice(idx, 1);
    }
    child.parentNode = el;
    el.children.push(child);
    return child;
  };
  el.removeChild = (child) => {
    const idx = el.children.indexOf(child);
    if (idx >= 0) el.children.splice(idx, 1);
    child.parentNode = null;
    return child;
  };
  el.setAttribute = (k, v) => { el.attributes[k] = v; };
  el.getAttribute = (k) => el.attributes[k];
  el.addEventListener = (type, fn) => { (el._listeners[type] = el._listeners[type] || []).push(fn); };
  el.removeEventListener = (type, fn) => {
    if (el._listeners[type]) el._listeners[type] = el._listeners[type].filter((f) => f !== fn);
  };
  el.dispatchEvent = (evt) => { (el._listeners[evt.type] || []).forEach((fn) => fn(evt)); };
  el.click = () => el.dispatchEvent({ type: 'click', target: el });
  return el;
}

function makeDocument() {
  const body = createElement('body');
  const docListeners = {};
  const document = {
    body,
    createElement,
    createTextNode,
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (docListeners[type]) docListeners[type] = docListeners[type].filter((f) => f !== fn);
    },
    dispatchEvent(evt) { (docListeners[evt.type] || []).forEach((fn) => fn(evt)); },
    // 09-11 (HP12): how many listeners of a type are currently attached.
    listenerCount(type) { return (docListeners[type] || []).length; },
    // Supports only simple ".class" selectors — the only shape this dialog's
    // markup (or these tests) ever need.
    querySelectorAll(selector) {
      const cls = String(selector).replace(/^\./, '');
      const out = [];
      (function walk(node) {
        if (node.nodeType === 1 && node._classes && node._classes.has(cls)) out.push(node);
        (node.children || []).forEach(walk);
      })(body);
      return out;
    },
  };
  return document;
}

function buildSandbox(fetchImpl) {
  const document = makeDocument();
  const location = { href: 'https://example.test/execution.html', origin: 'https://example.test', pathname: '/execution.html' };
  const window = { fetch: fetchImpl, location };
  const storageData = {};
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null; },
    setItem(k, v) { storageData[k] = String(v); },
  };
  const sandbox = { window, location, document, localStorage, URL, Headers, setTimeout, console };
  vm.createContext(sandbox);
  vm.runInContext(WRAPPER_SRC, sandbox);
  return { sandbox, document };
}

// A fake Response: `.json()`/`.clone().json()` both resolve to the same
// in-hand body object (no stream to consume twice, unlike a real Response —
// faithful enough for this control-flow proof).
function makeResponse(opts) {
  const res = Object.assign({}, opts);
  res.ok = opts.status >= 200 && opts.status < 300;
  res.headers = opts.headers || new Headers();
  res.json = () => Promise.resolve(opts.body);
  res.clone = () => res;
  return res;
}

// Scripted fake origFetch: returns the next response in a queue (staying on
// the last entry if over-called) and records each call's input/init.
function makeFakeFetch(responses) {
  const calls = [];
  const impl = (input, init) => {
    calls.push({ input, init: init || {} });
    const idx = Math.min(calls.length - 1, responses.length - 1);
    return Promise.resolve(responses[idx]);
  };
  return { calls, impl, responses };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
async function flushAll(times) {
  for (let i = 0; i < (times || 6); i++) await flush();
}

// 09-11: the caller's promise is now HELD while the dialog is open (GD-4), so
// a test must capture it, interact with the dialog, then await the outcome.
// track() records whether/with-what the promise settled and how many times.
function track(p) {
  const state = { settled: false, value: undefined, error: undefined, count: 0 };
  p.then((v) => { state.settled = true; state.value = v; state.count++; },
    (e) => { state.settled = true; state.error = e; state.count++; });
  return state;
}

// A fetch fake routed by a handler(callIndex, input, init) -> Response | Promise
// (rejecting for a network failure); records every call.
function makeRoutedFetch(handler) {
  const calls = [];
  const impl = (input, init) => {
    const idx = calls.length;
    calls.push({ input, init: init || {} });
    try { return Promise.resolve(handler(idx, input, init || {})); } catch (e) { return Promise.reject(e); }
  };
  return { calls, impl };
}

const conflictOf = (over) => Object.assign({
  conflict: true,
  currentVersion: 4,
  currentRecord: { id: 'rec1', title: 'Their title' },
  changedBy: 'karen',
  changedAt: new Date().toISOString(),
}, over || {});

test('client-conflict-dialog: a 409 with the conflict marker renders exactly one overlay; the wrapper makes no retry attempt of its own', async () => {
  const conflictBody = {
    conflict: true,
    currentVersion: 4,
    currentRecord: { id: 'rec1', title: 'Their title', notes: 'Their notes' },
    changedBy: 'karen',
    changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictBody })]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', { method: 'POST', body: JSON.stringify({ id: 'rec1', version: 1, title: 'My title' }) });
  const outcome = track(p);
  await flushAll();

  assert.strictEqual(fake.calls.length, 1, 'D-05/Pitfall 11: the wrapper must never itself re-fire a 409 request — the only re-fire path is a user click');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1);
  assert.strictEqual(outcome.settled, false, 'GD-4: the caller\'s promise is held while the dialog is open');

  document.querySelectorAll('.conflict-btn-discard')[0].click();
  const res = await p;
  assert.strictEqual(res, fake.responses[0], 'discard resolves the caller with the original 409');
});

test('client-conflict-dialog: a 409 without the conflict marker renders no dialog and returns the response untouched', async () => {
  const fake = makeFakeFetch([makeResponse({ status: 409, body: { error: 'Cannot generate an empty steerco pack' } })]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('/api/reports/steerco-pack', { method: 'POST', body: '{}' });

  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0, 'Pitfall 1: an unrelated 409 must open no dialog');
  assert.strictEqual(res.status, 409, 'the original response must still reach the caller');
  const body = await res.json();
  assert.strictEqual(body.error, 'Cannot generate an empty steerco pack', 'the original body must still be readable by the caller');
});

test('client-conflict-dialog: clicking apply issues exactly one further fetch, carrying the fresh version, otherwise byte-identical', async () => {
  const originalPayload = { id: 'rec1', version: 1, title: 'My title', notes: 'My notes' };
  const conflictBody = {
    conflict: true,
    currentVersion: 9,
    currentRecord: { id: 'rec1', title: 'Their title', notes: 'Their notes' },
    changedBy: 'karen',
    changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([
    makeResponse({ status: 409, body: conflictBody }),
    makeResponse({ status: 200, body: { ok: true } }),
  ]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', { method: 'POST', body: JSON.stringify(originalPayload) });
  await flushAll();
  const applyBtn = document.querySelectorAll('.conflict-btn-apply')[0];
  assert.ok(applyBtn, 'expected an apply button on the rendered dialog');
  applyBtn.click();
  await flushAll();
  assert.strictEqual(await p, fake.responses[1], 'apply resolves the caller with the reapplied 2xx response');

  assert.strictEqual(fake.calls.length, 2, 'expected exactly one further fetch after the apply click');
  const firstBody = JSON.parse(fake.calls[0].init.body);
  const secondBody = JSON.parse(fake.calls[1].init.body);
  assert.strictEqual(secondBody.version, 9, "the second call must carry the server's fresh version");
  assert.notStrictEqual(firstBody.version, secondBody.version, 'the stale version must not be resubmitted');
  delete firstBody.version;
  delete secondBody.version;
  assert.deepStrictEqual(firstBody, secondBody, 'every field other than version must be byte-identical to the original');
});

test('client-conflict-dialog: apply on a query-parameter route rewrites expectedVersion in the URL, not the body', async () => {
  const conflictBody = {
    conflict: true,
    currentVersion: 7,
    currentRecord: { id: 'rec1', title: 'Their title' },
    changedBy: 'karen',
    changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([
    makeResponse({ status: 409, body: conflictBody }),
    makeResponse({ status: 200, body: { ok: true } }),
  ]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/widgets/rec1?expectedVersion=3', { method: 'PATCH', body: JSON.stringify({ title: 'My title' }) });
  await flushAll();
  const applyBtn = document.querySelectorAll('.conflict-btn-apply')[0];
  applyBtn.click();
  await flushAll();
  assert.strictEqual(await p, fake.responses[1]);

  assert.strictEqual(fake.calls.length, 2);
  assert.strictEqual(fake.calls[1].input, '/api/widgets/rec1?expectedVersion=7', 'the fresh version must land in the URL query parameter');
  assert.strictEqual(fake.calls[1].init.body, fake.calls[0].init.body, 'the body must be untouched — this route carries its version precondition in the URL');
});

test('client-conflict-dialog: clicking discard issues no further fetch and removes the overlay', async () => {
  const conflictBody = {
    conflict: true,
    currentVersion: 2,
    currentRecord: { id: 'rec1', title: 'Their title' },
    changedBy: 'karen',
    changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictBody })]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', { method: 'POST', body: JSON.stringify({ id: 'rec1', version: 1, title: 'My title' }) });
  await flushAll();
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1);

  const discardBtn = document.querySelectorAll('.conflict-btn-discard')[0];
  discardBtn.click();
  await flushAll();
  assert.strictEqual(await p, fake.responses[0], 'discard resolves the caller with the original 409');

  assert.strictEqual(fake.calls.length, 1, 'discard must never issue a further fetch');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0, 'discard must remove the overlay');
});

test('client-conflict-dialog: a second conflict on reapply leaves exactly one overlay, refreshes theirs, and never touches mine', async () => {
  const firstConflict = {
    conflict: true,
    currentVersion: 3,
    currentRecord: { id: 'rec1', title: 'Their v3 title' },
    changedBy: 'karen',
    changedAt: new Date().toISOString(),
  };
  const secondConflict = {
    conflict: true,
    currentVersion: 4,
    currentRecord: { id: 'rec1', title: 'Their v4 title' },
    changedBy: 'priya',
    changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([
    makeResponse({ status: 409, body: firstConflict }),
    makeResponse({ status: 409, body: secondConflict }),
  ]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', { method: 'POST', body: JSON.stringify({ id: 'rec1', version: 1, title: 'My title' }) });
  const outcome = track(p);
  await flushAll();
  const applyBtn = document.querySelectorAll('.conflict-btn-apply')[0];
  applyBtn.click();
  await flushAll();

  assert.strictEqual(outcome.settled, false, 'the caller stays held through a second conflict');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1, 'T-09-14/T-09-16: a second conflict must never stack a second overlay');
  const mine = document.querySelectorAll('.conflict-diff-mine')[0];
  const theirs = document.querySelectorAll('.conflict-diff-theirs')[0];
  assert.ok(mine && theirs, 'expected a re-rendered diff row');
  assert.strictEqual(mine.textContent, 'My title', "the user's own column must never be cleared or reset on a second conflict");
  assert.strictEqual(theirs.textContent, 'Their v4 title', 'the server-side column must refresh to the newest conflict data');
  const banner = document.querySelectorAll('.conflict-modal-error');
  assert.strictEqual(banner.length, 1, 'the inline error banner must appear on the re-rendered dialog');

  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, fake.responses[0], 'discard after a re-render still resolves the ORIGINAL 409');
});

// ---------------------------------------------------------------------------
// CONC-02/D-08 (Phase 9, Plan 06): the stale-delete confirmation variant —
// selected from the intercepted request's DELETE method. Same 409 body
// shape as the edit-conflict tests above; the fixtures below carry no
// currentRecord field diffs since this variant renders no diff list.
// ---------------------------------------------------------------------------

test('client-conflict-dialog: a 409 on a DELETE renders the destructive stale-delete variant with no diff-list element and a delete button', async () => {
  const conflictBody = {
    conflict: true,
    conflictKind: 'version',
    currentVersion: 4,
    currentRecord: { id: 'rec1', title: 'Their title' },
    changedBy: 'karen',
    changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictBody })]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid/rec1?expectedVersion=1', { method: 'DELETE' });
  await flushAll();

  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1);
  assert.strictEqual(document.querySelectorAll('.conflict-diff-row').length, 0, 'the stale-delete variant must render no diff-list rows');
  const deleteBtn = document.querySelectorAll('.conflict-btn-delete');
  assert.strictEqual(deleteBtn.length, 1, 'expected exactly one .conflict-btn-delete on the rendered dialog');
  assert.strictEqual(deleteBtn[0].textContent, 'Delete anyway');
  const cancelBtn = document.querySelectorAll('.conflict-btn-discard');
  assert.strictEqual(cancelBtn.length, 1);
  assert.strictEqual(cancelBtn[0].textContent, 'Cancel');
  cancelBtn[0].click();
  assert.strictEqual(await p, fake.responses[0]);
});

test('client-conflict-dialog: clicking "Delete anyway" issues exactly one further fetch, whose URL carries the fresh expectedVersion and is otherwise unchanged', async () => {
  const conflictBody = {
    conflict: true,
    conflictKind: 'version',
    currentVersion: 6,
    currentRecord: { id: 'rec1', title: 'Their title' },
    changedBy: 'karen',
    changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([
    makeResponse({ status: 409, body: conflictBody }),
    makeResponse({ status: 200, body: { success: true } }),
  ]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid/rec1?expectedVersion=1', { method: 'DELETE' });
  await flushAll();
  const deleteBtn = document.querySelectorAll('.conflict-btn-delete')[0];
  assert.ok(deleteBtn, 'expected a delete button on the rendered dialog');
  deleteBtn.click();
  await flushAll();
  assert.strictEqual(await p, fake.responses[1], 'Delete anyway resolves the caller with the DELETE response');

  assert.strictEqual(fake.calls.length, 2, 'expected exactly one further fetch after the delete click');
  assert.strictEqual(fake.calls[1].input, '/api/raid/rec1?expectedVersion=6', 'the fresh version must land in the URL query parameter, every other part of the URL unchanged');
  assert.strictEqual(deleteBtn.textContent, 'Deleting…', 'the button must swap to the in-flight label');
  assert.strictEqual(deleteBtn.disabled, true, 'the button must disable while the resubmit is in flight');
});

test('client-conflict-dialog: clicking "Cancel" on the stale-delete variant issues no further fetch and removes the overlay', async () => {
  const conflictBody = {
    conflict: true,
    conflictKind: 'version',
    currentVersion: 3,
    currentRecord: { id: 'rec1', title: 'Their title' },
    changedBy: 'karen',
    changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictBody })]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid/rec1?expectedVersion=1', { method: 'DELETE' });
  await flushAll();
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1);

  const cancelBtn = document.querySelectorAll('.conflict-btn-discard')[0];
  cancelBtn.click();
  await flushAll();
  assert.strictEqual(await p, fake.responses[0], 'Cancel resolves the caller with the original 409');

  assert.strictEqual(fake.calls.length, 1, 'cancel must never issue a further fetch — the record is kept, nothing is sent');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0, 'cancel must remove the overlay');
});

test('client-conflict-dialog: a second conflict on the delete resubmission leaves exactly one overlay in the document, with the destructive-variant chrome intact', async () => {
  const firstConflict = {
    conflict: true, conflictKind: 'version', currentVersion: 3,
    currentRecord: { id: 'rec1', title: 'Their v3 title' },
    changedBy: 'karen', changedAt: new Date().toISOString(),
  };
  const secondConflict = {
    conflict: true, conflictKind: 'version', currentVersion: 4,
    currentRecord: { id: 'rec1', title: 'Their v4 title' },
    changedBy: 'priya', changedAt: new Date().toISOString(),
  };
  const fake = makeFakeFetch([
    makeResponse({ status: 409, body: firstConflict }),
    makeResponse({ status: 409, body: secondConflict }),
  ]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid/rec1?expectedVersion=1', { method: 'DELETE' });
  const outcome = track(p);
  await flushAll();
  const deleteBtn = document.querySelectorAll('.conflict-btn-delete')[0];
  deleteBtn.click();
  await flushAll();

  assert.strictEqual(outcome.settled, false, 'the caller stays held through a second conflict on the delete');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1, 'a second conflict on the delete resubmission must never stack a second overlay');
  assert.strictEqual(document.querySelectorAll('.conflict-btn-delete').length, 1, 'the re-rendered dialog must still be the destructive variant');
  const banner = document.querySelectorAll('.conflict-modal-error');
  assert.strictEqual(banner.length, 1, 'the inline error banner must appear on the re-rendered dialog');

  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, fake.responses[0]);
});

test('client-conflict-dialog: a stale-delete 409 body with no actor and no time renders the attribution fallback sentence', async () => {
  const conflictBody = {
    conflict: true, conflictKind: 'version', currentVersion: 2,
    currentRecord: { id: 'rec1', title: 'Their title' },
    changedBy: null, changedAt: null,
  };
  const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictBody })]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid/rec1?expectedVersion=1', { method: 'DELETE' });
  await flushAll();

  const attribution = document.querySelectorAll('.conflict-modal-attribution')[0];
  assert.ok(attribution, 'expected an attribution element');
  assert.strictEqual(attribution.textContent, 'This record changed since you loaded it.');
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  await p;
});

// ---------------------------------------------------------------------------
// GD-4 / D-03 / D-05 (Phase 9 gap closure, plan 09-11): HELD-PROMISE conflict
// sessions. The caller's fetch promise stays pending while the dialog is open
// and settles exactly once with the outcome of the user's decision — so every
// page's existing success handler reflects the server's state (R7 F-2).
// ---------------------------------------------------------------------------

const RAID_FLIP = (v) => ({ method: 'POST', body: JSON.stringify({ id: 'rec1', version: v === undefined ? 1 : v, status: 'doing' }) });

test('HP1: a marker 409 holds the caller\'s promise pending with exactly one overlay', async () => {
  const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictOf() })]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const outcome = track(sandbox.window.fetch('/api/raid', RAID_FLIP()));
  await flushAll();

  assert.strictEqual(outcome.settled, false, 'the promise must not settle while the dialog is open');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1);
});

test('HP2: Apply success resolves the ORIGINAL promise with the reapplied 200 Response (identity); exactly 2 fetches', async () => {
  const ok = makeResponse({ status: 200, body: { success: true, entry: { id: 'rec1', status: 'doing', version: 5 } } });
  const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictOf() }), ok]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
  await flushAll();
  document.querySelectorAll('.conflict-btn-apply')[0].click();
  const res = await p;

  assert.strictEqual(res, ok, 'the caller must receive the very Response the reapply produced');
  assert.strictEqual((await res.json()).entry.version, 5, 'the body must still be readable by the page handler');
  assert.strictEqual(fake.calls.length, 2);
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0);
});

test('HP3: Discard resolves the ORIGINAL 409 Response (body still readable); exactly 1 fetch', async () => {
  const first = makeResponse({ status: 409, body: conflictOf({ currentVersion: 2 }) });
  const fake = makeFakeFetch([first]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
  await flushAll();
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  const res = await p;

  assert.strictEqual(res, first);
  assert.strictEqual((await res.json()).conflict, true, 'the conflict body must still be readable');
  assert.strictEqual(fake.calls.length, 1);
});

test('HP4: Escape and an overlay-background click each resolve the held promise with the original 409', async () => {
  for (const how of ['escape', 'overlay']) {
    const first = makeResponse({ status: 409, body: conflictOf() });
    const fake = makeFakeFetch([first]);
    const { sandbox, document } = buildSandbox(fake.impl);

    const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
    await flushAll();
    if (how === 'escape') {
      document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    } else {
      const overlay = document.querySelectorAll('.conflict-modal-overlay')[0];
      overlay.dispatchEvent({ type: 'click', target: overlay });
    }
    assert.strictEqual(await p, first, how + ' must resolve with the original 409');
    assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0);
    assert.strictEqual(fake.calls.length, 1);
  }
});

test('HP5: DELETE — Delete anyway resolves with the DELETE Response; Cancel resolves with the original 409', async () => {
  {
    const okDel = makeResponse({ status: 200, body: { success: true } });
    const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictOf({ conflictKind: 'version' }) }), okDel]);
    const { sandbox, document } = buildSandbox(fake.impl);
    const p = sandbox.window.fetch('/api/raid/rec1?expectedVersion=1', { method: 'DELETE' });
    await flushAll();
    document.querySelectorAll('.conflict-btn-delete')[0].click();
    assert.strictEqual(await p, okDel);
    assert.strictEqual(fake.calls.length, 2);
    assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0);
  }
  {
    const first = makeResponse({ status: 409, body: conflictOf({ conflictKind: 'version' }) });
    const fake = makeFakeFetch([first]);
    const { sandbox, document } = buildSandbox(fake.impl);
    const p = sandbox.window.fetch('/api/raid/rec1?expectedVersion=1', { method: 'DELETE' });
    await flushAll();
    document.querySelectorAll('.conflict-btn-discard')[0].click();
    assert.strictEqual(await p, first);
    assert.strictEqual(fake.calls.length, 1);
  }
});

test('HP6 (third writer): Apply -> fresh 409 re-renders in place with the banner, promise stays pending; next Apply resolves once', async () => {
  const third = makeResponse({ status: 409, body: conflictOf({ currentVersion: 6, currentRecord: { id: 'rec1', status: 'blocked' } }) });
  const ok = makeResponse({ status: 200, body: { success: true } });
  const fake = makeRoutedFetch((i) => [
    makeResponse({ status: 409, body: conflictOf({ currentVersion: 4, currentRecord: { id: 'rec1', status: 'open' } }) }),
    third, ok,
  ][i]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
  const outcome = track(p);
  await flushAll();
  document.querySelectorAll('.conflict-btn-apply')[0].click();
  await flushAll();

  assert.strictEqual(outcome.settled, false);
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1);
  assert.strictEqual(document.querySelectorAll('.conflict-modal-error').length, 1, 'the changed-again banner must be present');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-error')[0].textContent,
    "That didn't go through — the record changed again. Your edits are still here; review the fresh values below and try again.");
  assert.strictEqual(document.querySelectorAll('.conflict-diff-theirs')[0].textContent, 'blocked', 'theirs must show the newest value');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-mine')[0].textContent, 'doing', 'mine must be unchanged');
  document.querySelectorAll('.conflict-btn-apply')[0].click();
  const res = await p;
  assert.strictEqual(res, ok);
  assert.strictEqual(JSON.parse(fake.calls[2].init.body).version, 6, 'the second reapply carries the NEWEST version');
  assert.strictEqual(outcome.count, 1, 'settled exactly once');
});

test('HP7 (network retry): Apply -> fetch rejects -> network banner, still pending, Apply enabled again; next Apply resolves once', async () => {
  const ok = makeResponse({ status: 200, body: { success: true } });
  const fake = makeRoutedFetch((i) => {
    if (i === 0) return makeResponse({ status: 409, body: conflictOf() });
    if (i === 1) throw new Error('network down');
    return ok;
  });
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
  const outcome = track(p);
  await flushAll();
  document.querySelectorAll('.conflict-btn-apply')[0].click();
  await flushAll();

  assert.strictEqual(outcome.settled, false);
  const banner = document.querySelectorAll('.conflict-modal-error')[0];
  assert.ok(banner && /a network error occurred/.test(banner.textContent), 'network banner expected');
  const apply2 = document.querySelectorAll('.conflict-btn-apply')[0];
  assert.strictEqual(apply2.disabled, false, 'Apply must be enabled again');
  apply2.click();
  assert.strictEqual(await p, ok);
  assert.strictEqual(outcome.count, 1);
});

test('HP8 (double click): two synchronous Apply clicks send exactly one extra fetch; same for Delete anyway', async () => {
  {
    const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictOf() }), makeResponse({ status: 200, body: {} })]);
    const { sandbox, document } = buildSandbox(fake.impl);
    const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
    await flushAll();
    const btn = document.querySelectorAll('.conflict-btn-apply')[0];
    btn.click();
    btn.click();
    await p;
    await flushAll();
    assert.strictEqual(fake.calls.length, 2, 'a second Apply click while in flight must send nothing');
  }
  {
    const fake = makeFakeFetch([makeResponse({ status: 409, body: conflictOf({ conflictKind: 'version' }) }), makeResponse({ status: 200, body: {} })]);
    const { sandbox, document } = buildSandbox(fake.impl);
    const p = sandbox.window.fetch('/api/raid/rec1?expectedVersion=1', { method: 'DELETE' });
    await flushAll();
    const btn = document.querySelectorAll('.conflict-btn-delete')[0];
    btn.click();
    btn.click();
    await p;
    await flushAll();
    assert.strictEqual(fake.calls.length, 2, 'a second Delete anyway click while in flight must send nothing');
  }
});

test('HP9 (queue): a second conflict is queued FIFO, not rendered over the first nor labelled "changed again"; each promise gets ITS OWN response', async () => {
  const r1Conflict = makeResponse({ status: 409, body: conflictOf({ currentRecord: { id: 'r1', title: 'R1 theirs' } }) });
  const r2Conflict = makeResponse({ status: 409, body: conflictOf({ currentRecord: { id: 'r2', title: 'R2 theirs' } }) });
  const r2Ok = makeResponse({ status: 200, body: { success: true, which: 'r2' } });
  const fake = makeRoutedFetch((i) => (i === 0 ? r1Conflict : i === 1 ? r2Conflict : r2Ok));
  const { sandbox, document } = buildSandbox(fake.impl);

  const p1 = sandbox.window.fetch('/api/raid', { method: 'POST', body: JSON.stringify({ id: 'r1', version: 1, title: 'mine 1' }) });
  await flushAll();
  const p2 = sandbox.window.fetch('/api/raid', { method: 'POST', body: JSON.stringify({ id: 'r2', version: 1, title: 'mine 2' }) });
  const o2 = track(p2);
  await flushAll();

  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1, 'the second conflict must not stack an overlay');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-error').length, 0, 'R1 must NOT be labelled "changed again"');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-theirs')[0].textContent, 'R1 theirs');

  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p1, r1Conflict, 'R1 must resolve with ITS OWN 409');
  await flushAll();

  assert.strictEqual(o2.settled, false, 'R2 is still held');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1, 'R2\'s dialog opens when R1 settles');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-error').length, 0, 'R2 opens fresh with no banner');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-theirs')[0].textContent, 'R2 theirs');

  document.querySelectorAll('.conflict-btn-apply')[0].click();
  assert.strictEqual(await p2, r2Ok, 'R2 must resolve with ITS OWN reapplied 200');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0);
});

test('HP10 (cap): with 20 queued behind an open dialog one more marker 409 resolves immediately with its own 409 and renders nothing', async () => {
  const responses = [];
  const fake = makeRoutedFetch((i) => {
    const r = makeResponse({ status: 409, body: conflictOf({ currentRecord: { id: 'r' + i, title: 'T' + i } }) });
    responses.push(r);
    return r;
  });
  const { sandbox, document } = buildSandbox(fake.impl);

  const held = [];
  for (let i = 0; i < 21; i++) { // 1 active + 20 queued
    held.push(track(sandbox.window.fetch('/api/raid', { method: 'POST', body: JSON.stringify({ id: 'r' + i, version: 1, title: 'm' + i }) })));
    await flushAll(3);
  }
  assert.ok(held.every((h) => !h.settled), 'all 21 conflicts are held');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1);

  const overflow = track(sandbox.window.fetch('/api/raid', { method: 'POST', body: JSON.stringify({ id: 'r21', version: 1, title: 'm21' }) }));
  await flushAll();

  assert.strictEqual(overflow.settled, true, 'the overflow conflict must resolve immediately');
  assert.strictEqual(overflow.value, responses[21], 'with its OWN 409');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1, 'and open nothing');
  assert.ok(held.every((h) => !h.settled), 'the held 21 are unaffected');
});

test('HP11 (settle-once): a stale Apply/Discard handler of an already-settled session sends nothing and does not resolve again', async () => {
  const first = makeResponse({ status: 409, body: conflictOf() });
  const fake = makeFakeFetch([first]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
  const outcome = track(p);
  await flushAll();
  const applyBtn = document.querySelectorAll('.conflict-btn-apply')[0];
  const discardBtn = document.querySelectorAll('.conflict-btn-discard')[0];
  discardBtn.click();
  await flushAll();
  assert.strictEqual(outcome.count, 1);

  applyBtn.click();
  discardBtn.click();
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  await flushAll();

  assert.strictEqual(fake.calls.length, 1, 'a stale handler must send nothing');
  assert.strictEqual(outcome.count, 1, 'must not resolve again');
  assert.strictEqual(outcome.value, first);
});

test('HP12 (cleanup): after the last session settles there are zero overlays and zero document keydown listeners', async () => {
  const fake = makeRoutedFetch((i) => (i < 2 ? makeResponse({ status: 409, body: conflictOf() }) : makeResponse({ status: 200, body: {} })));
  const { sandbox, document } = buildSandbox(fake.impl);

  const p1 = sandbox.window.fetch('/api/raid', RAID_FLIP());
  await flushAll();
  const p2 = sandbox.window.fetch('/api/raid', RAID_FLIP());
  await flushAll();
  assert.strictEqual(document.listenerCount('keydown'), 1, 'one listener while a dialog is shown');

  document.querySelectorAll('.conflict-btn-discard')[0].click();
  await p1;
  await flushAll();
  assert.strictEqual(document.listenerCount('keydown'), 1, 'the next queued dialog now owns the one listener');
  document.querySelectorAll('.conflict-btn-apply')[0].click();
  await p2;
  await flushAll();

  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0);
  assert.strictEqual(document.listenerCount('keydown'), 0);
});

test('HP13 (deleted variant): a conflictKind "deleted" 409 on a POST -> Close resolves with the original 409', async () => {
  const first = makeResponse({ status: 409, body: conflictOf({ conflictKind: 'deleted' }) });
  const fake = makeFakeFetch([first]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
  const outcome = track(p);
  await flushAll();
  assert.strictEqual(outcome.settled, false);
  assert.strictEqual(document.querySelectorAll('.conflict-btn-apply').length, 0, 'the deleted variant has no Apply');
  const close = document.querySelectorAll('.conflict-btn-discard')[0];
  assert.strictEqual(close.textContent, 'Close');
  close.click();

  assert.strictEqual(await p, first);
  assert.strictEqual(fake.calls.length, 1);
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0);
});

test('client-conflict-dialog: a 503 on a same-origin /api write still takes the pre-existing busy-retry path, undisturbed by the 409 work', async () => {
  const fake = makeFakeFetch([
    makeResponse({ status: 503, headers: new Headers({ 'Retry-After': '0' }) }),
    makeResponse({ status: 200, body: { ok: true } }),
  ]);
  const { sandbox, document } = buildSandbox(fake.impl);

  // Swap in a recording, immediately-firing fake per the harness's own
  // documented caveat (test/client-busy-retry.test.js) — the sandbox uses
  // the real setTimeout otherwise.
  const scheduled = [];
  sandbox.setTimeout = (fn, ms) => { scheduled.push(ms); return setTimeout(fn, 0); };

  const res = await sandbox.window.fetch('/api/pulses', { method: 'POST', body: '{}' });

  assert.strictEqual(fake.calls.length, 2, 'the initial attempt plus exactly one retry — the 409 work must not have disturbed the 503 path');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0, 'a 503 must never open the conflict dialog');
});

// ---------------------------------------------------------------------------
// SC6 / GD-6 / GD-7 / GD-8 / GD-10 (Phase 9 gap closure, plan 09-13): the
// dialog tells the truth. DT1-DT14 prove, in node:vm, that a payload whose keys
// do not mirror the record's field names still yields a correct diff (R7 F-3),
// that a record withheld by clearance is never rendered (F-4), that the
// reapply-failure banner carries the server's real reason (F-4), that labels
// are display labels (F-5) and that the deleted variant carries no
// attribution line it cannot back (F-7).
// ---------------------------------------------------------------------------

const MODAL_TEXT = (document) => document.querySelectorAll('.conflict-modal')
  .map((m) => m.textContent).join('\n');
const countOf = (haystack, needle) => haystack.split(needle).length - 1;
const NEUTRAL = 'This record changed since you loaded it.';

test('DT1 (tracer): a synergy stage conflict shows ONE "Stage" row: mine = the requested stage, theirs = the server stage', async () => {
  const first = makeResponse({ status: 409, body: conflictOf({
    conflictKind: 'version', currentVersion: 2,
    currentRecord: { id: 's1', stage: 'committed' },
  }) });
  const fake = makeFakeFetch([first]);
  const { sandbox, document } = buildSandbox(fake.impl);

  const p = sandbox.window.fetch('/api/synergies/s1/stage', {
    method: 'POST', body: JSON.stringify({ targetStage: 'validated', version: 1 }),
  });
  await flushAll();

  const rows = document.querySelectorAll('.conflict-diff-row');
  assert.strictEqual(rows.length, 1, 'exactly one diff row');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-label')[0].textContent, 'Stage');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-mine')[0].textContent, 'validated');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-theirs')[0].textContent, 'committed');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-empty').length, 0, 'no neutral panel when a row is present');
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, first);
});

// Opens a dialog for `url`/`payload` against the given 409 body and returns the
// handles a test needs. Every caller must settle the held promise itself.
async function openDialogFor(url, payload, bodyOver, method) {
  const first = makeResponse({ status: 409, body: conflictOf(Object.assign({ conflictKind: 'version' }, bodyOver || {})) });
  const fake = makeFakeFetch([first]);
  const { sandbox, document } = buildSandbox(fake.impl);
  const p = sandbox.window.fetch(url, { method: method || 'POST', body: JSON.stringify(payload) });
  await flushAll();
  return { p, first, fake, sandbox, document };
}

test('DT2: confirm-current {version} (no payload field) -> the neutral panel exactly once, Apply offered, the retired sentence nowhere', async () => {
  const { p, first, document } = await openDialogFor('/api/synergies/s1/confirm-current', { version: 1 },
    { currentRecord: { id: 's1', stage: 'idea' } });

  assert.strictEqual(document.querySelectorAll('.conflict-diff-row').length, 0);
  const text = MODAL_TEXT(document);
  assert.strictEqual(countOf(text, NEUTRAL), 1, 'the neutral sentence appears exactly once');
  assert.ok(document.querySelectorAll('.conflict-btn-apply').length === 1, 'Apply my changes anyway is still offered');
  assert.ok(!text.includes('No conflicting fields'), 'retired sentence (part 1)');
  assert.ok(!text.includes('without affecting anything you edited'), 'retired sentence (part 2)');
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, first);
});

test('DT3: payloads that name no record field (convert, rebaseline, cost-entry add) all render the neutral panel and still offer Apply', async () => {
  const cases = [
    ['/api/dd/findings/f1/convert', { toTask: true, toRaid: false, version: 2 }, { id: 'f1', title: 'Finding', toTask: false, toRaid: false }],
    ['/api/org/flight-risk/r1/convert', { toTask: true, toRaid: true, version: 2 }, { id: 'r1', riskLevel: 'high', toTask: false, toRaid: false }],
    ['/api/synergies/s1/rebaseline', { reason: 'x', version: 1 }, { id: 's1', reason: 'old', stage: 'idea' }],
    ['/api/synergies/s1/cost-entries', { date: '2026-03-01', amountM: 1, version: 1 }, { id: 's1', date: 'd', amountM: 9, costEntries: [] }],
  ];
  for (const [url, payload, record] of cases) {
    const { p, first, document } = await openDialogFor(url, payload, { currentRecord: record });
    assert.strictEqual(document.querySelectorAll('.conflict-diff-row').length, 0, url + ': no rows');
    assert.strictEqual(countOf(MODAL_TEXT(document), NEUTRAL), 1, url + ': neutral panel once');
    assert.strictEqual(document.querySelectorAll('.conflict-btn-apply').length, 1, url + ': Apply offered');
    document.querySelectorAll('.conflict-btn-discard')[0].click();
    assert.strictEqual(await p, first);
  }
});

test('DT4: a per-month phasing conflict compares the month CELL with the same cell on the server — never the initiative total', async () => {
  const { p, first, document } = await openDialogFor('/api/synergies/s1/phasing/2026-03', { realizedM: 2.5, version: 1 }, {
    currentRecord: { id: 's1', realizedM: 9.9, phasing: [{ month: '2026-02', realizedM: 4, targetM: 4 }, { month: '2026-03', realizedM: 1, targetM: 2 }] },
  });

  const rows = document.querySelectorAll('.conflict-diff-row');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(document.querySelectorAll('.conflict-diff-label')[0].textContent, 'Realized (M) · 2026-03');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-mine')[0].textContent, '2.5');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-theirs')[0].textContent, '1', 'theirs is the 2026-03 cell, not the 9.9 total');
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, first);
});

test('DT5: a month row missing on the server renders theirs as (empty)', async () => {
  const { p, first, document } = await openDialogFor('/api/synergies/s1/phasing/2026-03', { targetM: 3, version: 1 }, {
    currentRecord: { id: 's1', targetM: 7, phasing: [{ month: '2026-02', realizedM: 4, targetM: 4 }] },
  });

  assert.strictEqual(document.querySelectorAll('.conflict-diff-row').length, 1);
  assert.strictEqual(document.querySelectorAll('.conflict-diff-label')[0].textContent, 'Target (M) · 2026-03');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-theirs')[0].textContent, '(empty)');
  assert.ok(document.querySelectorAll('.conflict-diff-theirs')[0].classList.contains('conflict-diff-value-empty'));
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, first);
});

test('DT6: diff labels are display labels from a fixed table, with a humanised fallback for an unknown key', async () => {
  const record = { id: 'x', realizedM: 1, dueDate: '2026-01-01', reportsToId: 'p1', someNewField: 'a', grossRealizedM: 3 };
  const payload = { id: 'x', version: 1, realizedM: 2, dueDate: '2026-02-02', reportsToId: 'p2', someNewField: 'b', grossRealizedM: 4 };
  const { p, first, document } = await openDialogFor('/api/raid', payload, { currentRecord: record });

  const labels = document.querySelectorAll('.conflict-diff-label').map((l) => l.textContent);
  assert.deepStrictEqual(labels, ['Realized (M)', 'Due date', 'Reports to', 'Some new field', 'Gross realized (M)']);
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, first);
});

test('DT7: a mapped field whose mine and theirs are equal is still rendered with both values', async () => {
  const { p, first, document } = await openDialogFor('/api/synergies/s1/stage', { targetStage: 'validated', version: 1 },
    { currentRecord: { id: 's1', stage: 'validated' } });

  assert.strictEqual(document.querySelectorAll('.conflict-diff-row').length, 1);
  assert.strictEqual(document.querySelectorAll('.conflict-diff-mine')[0].textContent, 'validated');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-theirs')[0].textContent, 'validated');
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, first);
});

test('DT14: neutral panel + a body with no attribution -> the fallback sentence appears once; the attribution line is omitted', async () => {
  const { p, first, document } = await openDialogFor('/api/synergies/s1/confirm-current', { version: 1 },
    { currentRecord: { id: 's1', stage: 'idea' }, changedBy: null, changedAt: null });

  assert.strictEqual(countOf(MODAL_TEXT(document), NEUTRAL), 1, 'never the same sentence twice in one dialog');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-attribution').length, 0, 'the attribution element is omitted, not blank');
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  assert.strictEqual(await p, first);
});

const WITHHELD = 'This record is no longer within your clearance; your change cannot be applied.';

test('DT8: a withheld record (currentRecord null) on a POST -> attribution + the clearance sentence, no rows, no Apply, one Close that settles with the original 409', async () => {
  const { p, first, fake, document } = await openDialogFor('/api/raid', { id: 'rec1', version: 1, status: 'doing' },
    { currentRecord: null, changedBy: 'karen', changedAt: new Date().toISOString() });

  const text = MODAL_TEXT(document);
  assert.ok(text.includes(WITHHELD), 'withheld sentence');
  assert.ok(text.includes('Changed by karen'), 'attribution stays visible (T-09-17 accepted)');
  assert.strictEqual(document.querySelectorAll('.conflict-diff-row').length, 0, 'T-09-51: no field values');
  assert.strictEqual(document.querySelectorAll('.conflict-btn-apply').length, 0, 'no Apply');
  const buttons = document.querySelectorAll('.btn');
  assert.strictEqual(buttons.length, 1, 'exactly one button');
  assert.strictEqual(buttons[0].textContent, 'Close');
  buttons[0].click();
  assert.strictEqual(await p, first, 'the held promise settles with the original 409');
  assert.strictEqual(fake.calls.length, 1, 'nothing re-sent');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 0);
});

test('DT9: the same withheld body on a DELETE -> withheld sentence, no Delete anyway, one Close', async () => {
  const { p, first, document } = await openDialogFor('/api/raid/rec1?expectedVersion=1', undefined,
    { currentRecord: null, changedBy: 'karen', changedAt: new Date().toISOString() }, 'DELETE');

  assert.ok(MODAL_TEXT(document).includes(WITHHELD));
  assert.strictEqual(document.querySelectorAll('.conflict-btn-delete').length, 0, 'T-09-51: no destructive action');
  const buttons = document.querySelectorAll('.btn');
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].textContent, 'Close');
  buttons[0].click();
  assert.strictEqual(await p, first);
});

// A reapply answered by `reapplyRes`, after a first marker 409 on /api/raid.
async function reapplyWith(reapplyRes) {
  const fake = makeRoutedFetch((i) => (i === 0 ? makeResponse({ status: 409, body: conflictOf() }) : reapplyRes));
  const { sandbox, document } = buildSandbox(fake.impl);
  const p = sandbox.window.fetch('/api/raid', RAID_FLIP());
  const outcome = track(p);
  await flushAll();
  document.querySelectorAll('.conflict-btn-apply')[0].click();
  await flushAll();
  return { p, outcome, fake, document };
}

test('DT10: Apply refused with 403 {error} -> banner carries the server reason (trailing period removed); a 403 is not a network error; promise still pending', async () => {
  const { p, outcome, document } = await reapplyWith(makeResponse({ status: 403, body: { error: 'You are not cleared for that due-diligence area.' } }));

  const banner = document.querySelectorAll('.conflict-modal-error')[0];
  assert.ok(banner, 'banner expected');
  assert.strictEqual(banner.textContent,
    "That didn't go through — You are not cleared for that due-diligence area. Your edits are still here; review the fresh values below and try again.");
  assert.ok(!/network error/.test(banner.textContent));
  assert.strictEqual(outcome.settled, false, 'the caller stays held');
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  await p;
});

test('DT11: Apply refused with a 4xx carrying no error text -> "the server refused the change"', async () => {
  const { p, document } = await reapplyWith(makeResponse({ status: 400, body: {} }));

  const banner = document.querySelectorAll('.conflict-modal-error')[0];
  assert.strictEqual(banner.textContent,
    "That didn't go through — the server refused the change. Your edits are still here; review the fresh values below and try again.");
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  await p;
});

test('DT12: Apply answered by a 409 WITHOUT the marker -> that error text in the banner; no second session opens', async () => {
  const { p, fake, document } = await reapplyWith(makeResponse({ status: 409, body: { error: 'Unrecognized stage.' } }));

  const banner = document.querySelectorAll('.conflict-modal-error')[0];
  assert.ok(banner && banner.textContent.includes('Unrecognized stage. Your edits are still here'), banner && banner.textContent);
  assert.ok(!/network error/.test(banner.textContent));
  assert.strictEqual(document.querySelectorAll('.conflict-modal-overlay').length, 1, 'still one dialog');
  assert.strictEqual(fake.calls.length, 2);
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  await p;
});

test('DT12b: the server reason is capped at 200 characters and rendered as text', async () => {
  const long = '<b>' + 'x'.repeat(400) + '</b>';
  const { p, document } = await reapplyWith(makeResponse({ status: 400, body: { error: long } }));

  const banner = document.querySelectorAll('.conflict-modal-error')[0];
  const reason = banner.textContent.slice("That didn't go through — ".length, banner.textContent.length - '. Your edits are still here; review the fresh values below and try again.'.length);
  assert.ok(reason.length <= 200, 'reason length ' + reason.length);
  assert.ok(reason.startsWith('<b>xxx'), 'markup is shown as literal text');
  document.querySelectorAll('.conflict-btn-discard')[0].click();
  await p;
});

test('DT13: a conflictKind "deleted" 409 on a POST -> title "Someone else deleted this", the existing intro, no attribution element, one Close', async () => {
  const { p, first, document } = await openDialogFor('/api/raid', { id: 'rec1', version: 1, status: 'doing' },
    { conflictKind: 'deleted', currentRecord: null, changedBy: null, changedAt: null });

  assert.strictEqual(document.querySelectorAll('.conflict-modal-title')[0].textContent, 'Someone else deleted this');
  assert.strictEqual(document.querySelectorAll('.conflict-modal-attribution').length, 0, 'a deleted row carries no actor/time to attribute');
  assert.ok(MODAL_TEXT(document).includes('Someone else deleted this record before your change could be saved.'), 'existing intro kept');
  assert.ok(!MODAL_TEXT(document).includes(NEUTRAL), 'no contradictory fallback line');
  const buttons = document.querySelectorAll('.btn');
  assert.strictEqual(buttons.length, 1);
  assert.strictEqual(buttons[0].textContent, 'Close');
  buttons[0].click();
  assert.strictEqual(await p, first);
});

test('DT-src: the retired empty-diff sentence occurs nowhere in the wrapper region source', () => {
  assert.ok(!WRAPPER_SRC.includes('No conflicting fields'), 'sentence start must be gone');
  assert.ok(!WRAPPER_SRC.includes('without affecting anything you edited'), 'sentence middle must be gone');
  assert.ok(!/CONFLICT_EMPTY_DIFF/.test(WRAPPER_SRC), 'the constant itself must be deleted');
});
