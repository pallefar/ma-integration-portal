'use strict';
// SAFE-06 / D-13-05 (plan 13-02): the admin egress switch - dev/demo behaviour.
//
// Real child servers (test/helpers/egress-server.js) on isolated temp copies of
// the committed databases, so the per-request CSP, the admin route, the
// cross-process cache (PRAGMA data_version) and the audit event are exercised
// over real HTTP. Real-mode defaults live in test/egress-real-mode.test.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { startServer, parseCsp } = require('./helpers/egress-server');
const { headersFor } = require('../lib/csp');
const { createEgress, modeDefaults } = require('../lib/egress');

const YT_FRAME = ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://youtube.com'];
const HF_CONNECT = ['https://huggingface.co', 'https://*.huggingface.co', 'https://cdn-lfs.huggingface.co', 'https://cdn-lfs-us-1.huggingface.co'];

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-egress-'));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

function cspOf(res) { return parseCsp(res.headers.get('content-security-policy')); }
function thirdParty(csp) {
  return Object.values(csp).flat().filter((t) => /^https?:/.test(t));
}

test('lib/csp: builder output per egress key; youtube is never in script-src; no font CDN', () => {
  const all = parseCsp(headersFor({ egress: { gemini: true, huggingface: true, youtube: true } })['Content-Security-Policy']);
  assert.deepStrictEqual(all['frame-src'], ["'self'", ...YT_FRAME]);
  assert.deepStrictEqual(all['connect-src'], ["'self'", ...HF_CONNECT]);
  assert.deepStrictEqual(all['script-src'], ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'"]);
  assert.deepStrictEqual(all['frame-ancestors'], ["'self'"]);
  assert.ok(all['media-src'].includes('https://*.youtube.com'));
  assert.ok(all['img-src'].includes('https://img.youtube.com') && all['img-src'].includes('https://*.huggingface.co'));

  const none = parseCsp(headersFor({ egress: { gemini: false, huggingface: false, youtube: false } })['Content-Security-Policy']);
  assert.deepStrictEqual(thirdParty(none), []);

  const gemOnly = parseCsp(headersFor({ egress: { gemini: true, huggingface: false, youtube: false } })['Content-Security-Policy']);
  assert.deepStrictEqual(thirdParty(gemOnly), [], 'gemini is server-side egress: it adds no browser origin');

  const ytOnly = parseCsp(headersFor({ egress: { gemini: false, huggingface: false, youtube: true } })['Content-Security-Policy']);
  assert.ok(!ytOnly['connect-src'].some((t) => /huggingface/.test(t)));
  assert.ok(!ytOnly['script-src'].some((t) => /^https:/.test(t)));
  // memoised: identical key -> identical object
  assert.strictEqual(headersFor({ egress: { youtube: true } }), headersFor({ egress: { gemini: false, huggingface: false, youtube: true } }));
});

test('lib/egress: mode defaults overlaid with stored booleans; set() is visible immediately', () => {
  assert.deepStrictEqual({ ...modeDefaults(true) }, { gemini: false, huggingface: false, youtube: false });
  assert.deepStrictEqual({ ...modeDefaults(false) }, { gemini: true, huggingface: true, youtube: true });
  let stored = {};
  let version = 1;
  const e = createEgress({
    version: () => version, isReal: true,
    read: () => ({ ...stored }),
    write: (p) => { stored = { ...stored, ...p }; return stored; },
  });
  assert.strictEqual(e.allows('gemini'), false);
  e.set({ gemini: true, youtube: 'yes', bogus: true });
  assert.strictEqual(e.allows('gemini'), true);
  assert.strictEqual(e.allows('youtube'), false, 'a non-boolean never reaches storage');
  assert.deepStrictEqual(stored, { gemini: true });
  // another process commits: the data_version token changes, the value is re-read
  stored = { gemini: false, huggingface: true };
  assert.strictEqual(e.allows('huggingface'), false, 'unchanged token -> cached value');
  version = 2;
  assert.strictEqual(e.allows('huggingface'), true);
  assert.strictEqual(e.allows('gemini'), false);
});

test('dev: default CSP lists today\'s third-party origins; admin toggle changes the NEXT response; auth + validation', async () => {
  const s = await startServer({ dir: DIR, mode: 'dev' });
  try {
    const before = await s.request('/login.html');
    assert.strictEqual(before.status, 200);
    const c0 = cspOf(before);
    assert.deepStrictEqual(c0['frame-src'], ["'self'", ...YT_FRAME]);
    assert.deepStrictEqual(c0['connect-src'], ["'self'", ...HF_CONNECT]);
    assert.ok(!c0['script-src'].some((t) => /^https:/.test(t)), 'no third-party script origin');
    assert.ok(!thirdParty(c0).some((t) => /googleapis|gstatic/.test(t)), 'no font CDN origin');

    // unauthenticated -> 401, non-admin -> 403, nothing changed
    const anon = await s.request('/api/admin/egress', { method: 'POST', body: { youtube: false } });
    assert.strictEqual(anon.status, 401);
    const hrbp = await s.request('/api/admin/egress', { method: 'POST', body: { youtube: false }, token: 'hrbp' });
    assert.strictEqual(hrbp.status, 403);
    const hrbpGet = await s.request('/api/admin/egress', { token: 'hrbp' });
    assert.strictEqual(hrbpGet.status, 403);
    assert.deepStrictEqual(cspOf(await s.request('/login.html'))['frame-src'], ["'self'", ...YT_FRAME]);

    // validation: non-boolean and unknown key -> 400
    const bad1 = await s.request('/api/admin/egress', { method: 'POST', body: { youtube: 'yes' }, token: 'admin' });
    assert.strictEqual(bad1.status, 400);
    const bad2 = await s.request('/api/admin/egress', { method: 'POST', body: { youtub: false }, token: 'admin' });
    assert.strictEqual(bad2.status, 400);

    // admin toggle: next response has no youtube origin; huggingface untouched
    const ok = await s.request('/api/admin/egress', { method: 'POST', body: { youtube: false }, token: 'admin' });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.mode, 'dev');
    assert.strictEqual(ok.body.effective.youtube, false);
    assert.strictEqual(ok.body.effective.huggingface, true);
    assert.deepStrictEqual(ok.body.stored, { youtube: false });
    const after = cspOf(await s.request('/login.html'));
    assert.deepStrictEqual(after['frame-src'], ["'self'"]);
    assert.ok(!after['img-src'].some((t) => /youtube|ytimg/.test(t)));
    assert.ok(!after['media-src'].some((t) => /youtube/.test(t)));
    assert.deepStrictEqual(after['connect-src'], ["'self'", ...HF_CONNECT]);

    const get = await s.request('/api/admin/egress', { token: 'admin' });
    assert.strictEqual(get.status, 200);
    assert.deepStrictEqual(get.body.effective, { gemini: true, huggingface: true, youtube: false });

    // the change is a recorded security event (before/after + actor)
    const audit = new Database(path.join(DIR, 'audit.db'), { readonly: true });
    try {
      const rows = audit.prepare("SELECT actor_username, before_json, after_json FROM audit_log WHERE action = 'egress-settings-changed'").all();
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].actor_username, 'egress-admin');
      assert.strictEqual(JSON.parse(rows[0].before_json).youtube, true);
      assert.strictEqual(JSON.parse(rows[0].after_json).youtube, false);
    } finally { audit.close(); }

    // restore for the cross-process test below
    await s.request('/api/admin/egress', { method: 'POST', body: { youtube: true }, token: 'admin' });
  } finally {
    await s.stop();
  }
});

test('dev: a toggle through process A is visible in process B\'s next response (PRAGMA data_version cache)', async () => {
  const dir = fs.mkdtempSync(path.join(DIR, 'xproc-'));
  const a = await startServer({ dir, mode: 'dev' });
  const b = await startServer({ dir, mode: 'dev' });
  try {
    // warm B's cache with the default
    assert.deepStrictEqual(cspOf(await b.request('/login.html'))['frame-src'], ["'self'", ...YT_FRAME]);
    const t0 = Date.now();
    const r = await a.request('/api/admin/egress', { method: 'POST', body: { youtube: false, huggingface: false }, token: 'admin' });
    assert.strictEqual(r.status, 200);
    const seen = cspOf(await b.request('/login.html'));
    const lagMs = Date.now() - t0;
    assert.deepStrictEqual(seen['frame-src'], ["'self'"], 'process B must serve the new CSP on its very next request');
    assert.deepStrictEqual(seen['connect-src'], ["'self'"]);
    console.log(`# cross-process toggle visible in B after ${lagMs} ms (toggle + next request)`);
    // and back the other way
    await a.request('/api/admin/egress', { method: 'POST', body: { youtube: true }, token: 'admin' });
    assert.deepStrictEqual(cspOf(await b.request('/login.html'))['frame-src'], ["'self'", ...YT_FRAME]);
  } finally {
    await a.stop();
    await b.stop();
  }
});
