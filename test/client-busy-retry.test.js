// D-07/D-08/CONC-01 (Phase 8 Plan 04): client half of write-contention handling,
// lives in public/js/transitions.js's existing window.fetch wrapper.
//
// This file evaluates ONLY the sentinel-delimited wrapper region (between the
// `ma-fetch-wrapper:begin` / `ma-fetch-wrapper:end` markers Plan 04's Task 1
// added), not the whole of transitions.js — the rest of that file does heavy
// DOM/page-access work at load time (playbook viewer, quick-nav, access-control
// redirects) that is irrelevant to this retry control flow and would require a
// much larger, less faithful browser stub to even load. Slicing the region and
// running it through node:vm against a minimal stubbed browser global set (a
// plain `window`, a recording `document`, `localStorage`, `location`, the real
// built-in `URL`/`Headers`/`setTimeout`) exercises the exact same source the
// browser runs, with no behavior duplicated by hand.
//
// This test's "second writer" is a scripted fake window.fetch returning a
// queued response sequence — a stub is correct here because this test proves
// CLIENT control flow (retry count, backoff, give-up), not SQLite locking.
// Contrast test/concurrency-busy-retry.test.js (Plan 01), which spawns REAL
// node:child_process instances to prove the storage layer's own busy-wait —
// a single-process simulation of a second SQLite writer deadlocks (verified,
// 08-RESEARCH.md Pitfall 3), so that proof genuinely needs real processes.
// This test has no SQLite in it at all — a fake fetch queue is faithful.
//
// node:test — Node's built-in runner. Run via `node --test
// test/client-busy-retry.test.js` (or bare `node --test`). Never `node --test
// test/` (the directory argument is mis-parsed on this Node version).

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

// Scripted fake origFetch: returns the next response in a queue (staying on
// the last entry if over-called) and records each call with a timestamp, so
// tests can assert both call COUNT and the inter-call timing gap.
function makeFakeFetch(responses) {
  const calls = [];
  const impl = (input, init) => {
    calls.push({ input, init, t: Date.now() });
    const idx = Math.min(calls.length - 1, responses.length - 1);
    return Promise.resolve(responses[idx]);
  };
  return { calls, impl };
}

// Fresh minimal browser-global stub set per test — a plain `window` seeded
// with the fake fetch, a recording `document` (createElement/body.appendChild/
// body.removeChild), a stub `localStorage`, a `location` with origin/href/
// pathname, and the real built-in URL/Headers/setTimeout. Math/Promise/Date
// are already present in any vm.createContext realm (true ECMAScript
// intrinsics) and need no stubbing.
function buildSandbox(fetchImpl) {
  const appended = [];
  const removed = [];
  const document = {
    body: {
      appendChild(el) {
        el.parentNode = document.body;
        appended.push(el);
      },
      removeChild(el) {
        el.parentNode = null;
        removed.push(el);
      },
    },
    createElement(tag) {
      return { tagName: tag, style: {}, textContent: '', parentNode: null };
    },
  };
  const location = { href: 'https://example.test/dashboard.html', origin: 'https://example.test', pathname: '/dashboard.html' };
  const window = { fetch: fetchImpl, location };
  const storageData = {};
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storageData, k) ? storageData[k] : null; },
    setItem(k, v) { storageData[k] = String(v); },
  };
  const sandbox = { window, location, document, localStorage, URL, Headers, setTimeout, console };
  vm.createContext(sandbox);
  vm.runInContext(WRAPPER_SRC, sandbox);
  return { sandbox, appended, removed };
}

test('client-busy-retry: two 503s then 200 — caller sees 200, origFetch called 3 times, no toast', async () => {
  const fake = makeFakeFetch([
    { status: 503, headers: new Headers({ 'Retry-After': '0' }) },
    { status: 503, headers: new Headers({ 'Retry-After': '0' }) },
    { status: 200, headers: new Headers() },
  ]);
  const { sandbox, appended } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('/api/pulses', { method: 'POST', body: '{}' });

  assert.strictEqual(fake.calls.length, 3, 'expected exactly 3 origFetch calls (initial + 2 retries)');
  assert.strictEqual(res.status, 200, 'the caller must see the eventual 200');
  assert.strictEqual(appended.length, 0, 'no give-up toast should be appended when a retry eventually succeeds');
});

test('client-busy-retry: three 503s — caller sees final 503, origFetch called 3 times, exactly one give-up toast', async () => {
  const fake = makeFakeFetch([
    { status: 503, headers: new Headers({ 'Retry-After': '0' }) },
    { status: 503, headers: new Headers({ 'Retry-After': '0' }) },
    { status: 503, headers: new Headers({ 'Retry-After': '0' }) },
  ]);
  const { sandbox, appended, removed } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('/api/pulses', { method: 'POST', body: '{}' });

  assert.strictEqual(fake.calls.length, 3, 'expected exactly 3 origFetch calls (initial + 2 retries, cap reached)');
  assert.strictEqual(res.status, 503, 'the caller must see the final, still-503 response once retries are exhausted');
  assert.strictEqual(appended.length, 1, 'exactly one give-up toast must be appended once retries are exhausted');
  assert.ok(appended[0].textContent.includes('not saved'), 'the give-up toast text must say the change was not saved');
  // D-08: nothing else is cleared/reset/re-navigated — the only DOM mutation
  // is the toast's own append; its timed self-removal has not fired yet.
  assert.strictEqual(removed.length, 0, 'no element should be removed from the document synchronously on give-up');
});

test('client-busy-retry: a 503 on a cross-origin URL is not retried', async () => {
  const fake = makeFakeFetch([
    { status: 503, headers: new Headers() },
  ]);
  const { sandbox, appended } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('https://other-origin.test/api/pulses', { method: 'POST' });

  assert.strictEqual(fake.calls.length, 1, 'a cross-origin 503 must not be retried');
  assert.strictEqual(res.status, 503);
  assert.strictEqual(appended.length, 0, 'no toast for a cross-origin 503 — this wrapper only owns same-origin /api contention');
});

test('client-busy-retry: a 503 on a same-origin non-/api URL is not retried', async () => {
  const fake = makeFakeFetch([
    { status: 503, headers: new Headers() },
  ]);
  const { sandbox, appended } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('/dashboard.html', { method: 'POST' });

  assert.strictEqual(fake.calls.length, 1, 'a same-origin non-/api 503 must not be retried');
  assert.strictEqual(res.status, 503);
  assert.strictEqual(appended.length, 0);
});

test('client-busy-retry: a 500 on a same-origin /api URL is not retried — only 503 is the contention signal', async () => {
  const fake = makeFakeFetch([
    { status: 500, headers: new Headers() },
  ]);
  const { sandbox, appended } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('/api/pulses', { method: 'POST', body: '{}' });

  assert.strictEqual(fake.calls.length, 1, 'a 500 must not trigger the busy-retry branch');
  assert.strictEqual(res.status, 500);
  assert.strictEqual(appended.length, 0, 'no give-up toast for a 500 — it is not the contention signal');
});

test('client-busy-retry: Retry-After: 2 schedules the retry at least 2000ms after the first attempt', async () => {
  const fake = makeFakeFetch([
    { status: 503, headers: new Headers({ 'Retry-After': '2' }) },
    { status: 200, headers: new Headers() },
  ]);
  const { sandbox } = buildSandbox(fake.impl);

  await sandbox.window.fetch('/api/pulses', { method: 'POST', body: '{}' });

  assert.strictEqual(fake.calls.length, 2, 'expected the initial attempt plus exactly one retry');
  const gapMs = fake.calls[1].t - fake.calls[0].t;
  assert.ok(gapMs >= 2000, `expected a recorded gap of at least 2000ms between attempts, got ${gapMs}ms`);
});

test('client-busy-retry: an absurd Retry-After is clamped to 60s — the retry never parks for hours (T-08-12)', async () => {
  const fake = makeFakeFetch([
    { status: 503, headers: new Headers({ 'Retry-After': '999999' }) },
    { status: 200, headers: new Headers() },
  ]);
  const { sandbox } = buildSandbox(fake.impl);

  // Swap the context's setTimeout for a recording, immediately-firing fake
  // (the wrapper resolves `setTimeout` from the context global at call time),
  // so the test observes the SCHEDULED delay without actually waiting for it.
  const scheduledDelays = [];
  sandbox.setTimeout = (fn, ms) => { scheduledDelays.push(ms); return setTimeout(fn, 0); };

  await sandbox.window.fetch('/api/pulses', { method: 'POST', body: '{}' });

  assert.strictEqual(fake.calls.length, 2, 'expected the initial attempt plus exactly one retry');
  assert.strictEqual(scheduledDelays.length, 1, 'expected exactly one scheduled retry wait');
  // 60s clamp + up-to-300ms jitter — never the ~277 hours a raw 999999s header implies.
  assert.ok(scheduledDelays[0] >= 60000 && scheduledDelays[0] <= 60300,
    `expected the scheduled wait to be clamped into [60000, 60300]ms, got ${scheduledDelays[0]}ms`);
});

// D-12-05 / PD-15 (Phase 12, plan 12-04): a 503 whose JSON body carries
// `retryable: false` is a PERMANENT condition (the steerco-pack renderer is
// unavailable on this host platform), not write contention. The wrapper must
// return it at once — one fetch, no retry wait, no "not saved" toast. A plain
// contention 503 (no marker, or no clonable body) keeps the Phase 8 behaviour
// exercised by every case above, unedited.
function cloneableResponse(status, bodyPromiseFactory, headers) {
  return {
    status,
    headers: headers || new Headers({ 'Retry-After': '0' }),
    clone() { return { json: bodyPromiseFactory }; },
  };
}

test('client-busy-retry: a 503 carrying the retryable:false marker is returned at once — 1 fetch, no retry, no toast', async () => {
  const permanent = cloneableResponse(503, () => Promise.resolve({
    error: 'PDF pack generation is unavailable on this host platform', retryable: false,
  }));
  const fake = makeFakeFetch([permanent]);
  const { sandbox, appended } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('/api/reports/pack?lang=en');

  assert.strictEqual(fake.calls.length, 1, 'a permanent 503 must not be retried');
  assert.strictEqual(res.status, 503, 'the caller must get the original 503');
  assert.strictEqual(res, permanent, 'the ORIGINAL response object is returned');
  assert.strictEqual(appended.length, 0, 'no busy/"not saved" toast for a permanent, non-contention 503');
});

test('client-busy-retry: a clonable 503 WITHOUT the marker is still retried exactly as before (marker absent -> unchanged)', async () => {
  const contention = () => cloneableResponse(503, () => Promise.resolve({ error: 'The server is busy' }));
  const fake = makeFakeFetch([contention(), contention(), contention()]);
  const { sandbox, appended } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('/api/pulses', { method: 'POST', body: '{}' });

  assert.strictEqual(fake.calls.length, 3, 'initial + 2 retries');
  assert.strictEqual(res.status, 503);
  assert.strictEqual(appended.length, 1, 'exactly one give-up toast once retries are exhausted');
});

test('client-busy-retry: a 503 whose body is not JSON is treated as contention (peek failure never blocks the retry)', async () => {
  const garbled = () => cloneableResponse(503, () => Promise.reject(new SyntaxError('Unexpected token')));
  const fake = makeFakeFetch([garbled(), { status: 200, headers: new Headers() }]);
  const { sandbox, appended } = buildSandbox(fake.impl);

  const res = await sandbox.window.fetch('/api/pulses', { method: 'POST', body: '{}' });

  assert.strictEqual(fake.calls.length, 2);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(appended.length, 0);
});
