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
  // 13-13 (D-13-03 final state): the default header is the strict ENFORCING policy.
  assert.deepStrictEqual(all['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
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
    // IN-A02: no recognised key -> 400, no runtime.db write, no audit row (asserted below: exactly 1 row)
    const empty = await s.request('/api/admin/egress', { method: 'POST', body: {}, token: 'admin' });
    assert.strictEqual(empty.status, 400);
    assert.deepStrictEqual(empty.body, { error: 'No egress key supplied' });
    assert.deepStrictEqual((await s.request('/api/admin/egress', { token: 'admin' })).body.stored, {}, 'nothing was stored');

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

test('fonts are vendored: no font-CDN reference under public/ (outside vendor/ + uploads/), no CSP lists one, woff2 + OFL texts present', () => {
  const root = path.join(__dirname, '..', 'public');
  const offenders = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (dir === root && (ent.name === 'vendor' || ent.name === 'uploads')) continue;
        walk(full);
      } else if (/\.(html?|css|js|json|svg|txt|md)$/i.test(ent.name)) {
        const txt = fs.readFileSync(full, 'utf8');
        if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(txt)) offenders.push(path.relative(root, full));
      }
    }
  })(root);
  assert.deepStrictEqual(offenders, []);

  const bools = [false, true];
  for (const gemini of bools) for (const huggingface of bools) for (const youtube of bools) {
    const policy = headersFor({ egress: { gemini, huggingface, youtube } })['Content-Security-Policy'];
    assert.ok(!/googleapis|gstatic/.test(policy), policy);
  }

  const dir = path.join(root, 'vendor', 'fonts');
  for (const f of ['inter-latin.woff2', 'inter-latin-ext.woff2', 'outfit-latin.woff2', 'outfit-latin-ext.woff2', 'OFL-Inter.txt', 'OFL-Outfit.txt']) {
    assert.ok(fs.statSync(path.join(dir, f)).size > 1000, `${f} present`);
  }
  for (const f of ['inter-latin.woff2', 'outfit-latin-ext.woff2']) {
    assert.strictEqual(fs.readFileSync(path.join(dir, f)).subarray(0, 4).toString('latin1'), 'wOF2');
  }
  const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
  assert.ok(!/@import\s+url\(\s*['"]?https?:/.test(css), 'no remote @import in style.css');
  for (const f of ['inter-latin', 'inter-latin-ext', 'outfit-latin', 'outfit-latin-ext']) {
    assert.ok(css.includes(`/vendor/fonts/${f}.woff2`), `style.css references ${f}`);
  }
});

test('dev: GET /api/settings exposes the effective egress booleans to a non-admin and never the key', async () => {
  const dir = fs.mkdtempSync(path.join(DIR, 'settings-'));
  const s = await startServer({ dir, mode: 'dev' });
  try {
    const res = await s.request('/api/settings', { token: 'hrbp' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.egress, { gemini: true, huggingface: true, youtube: true });
    assert.ok(!('geminiApiKey' in res.body));
    // the vendored fonts and the stylesheet that declares them are served by the portal itself
    const font = await fetch(`${s.base}/vendor/fonts/inter-latin.woff2`);
    assert.strictEqual(font.status, 200);
    assert.ok((await font.arrayBuffer()).byteLength > 1000);
    await s.request('/api/admin/egress', { method: 'POST', body: { gemini: false }, token: 'admin' });
    const after = await s.request('/api/settings', { token: 'hrbp' });
    assert.deepStrictEqual(after.body.egress, { gemini: false, huggingface: true, youtube: true });
  } finally {
    await s.stop();
  }
});

test('aiService backstop: with the egress check false each Gemini function takes its local fallback and never calls fetch', async () => {
  const aiService = require('../aiService');
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = (...a) => { calls.push(String(a[0])); return Promise.reject(new Error('fetch must not be called')); };
  aiService.setEgressCheck(() => false);
  try {
    const plan = await aiService.generate100DayPlan({
      targetCompany: 'Backstop Co', scores: { culture: 3, talent: 3, value: 3 }, responses: {}, questions: [], apiKey: 'sk-present',
    });
    assert.ok(typeof plan === 'string' && plan.length > 0);
    const review = await aiService.reviewPdfContent({ pdfText: 'Integration policy text.', fileName: 'p.pdf', apiKey: 'sk-present' });
    assert.ok(review && typeof review === 'object');
    const insight = await aiService.generateSmolInsight({ portal: 'employee', apiKey: 'sk-present' });
    assert.ok(insight);
    assert.deepStrictEqual(calls, []);
  } finally {
    global.fetch = realFetch;
    aiService.setEgressCheck(() => true);
  }
});

test('dev, gemini off: insight / rag upload answer the 200 marker, assessment uses the local plan - zero outbound Gemini calls', async () => {
  const dir = fs.mkdtempSync(path.join(DIR, 'inproc-'));
  require('./helpers/egress-server').seedDevDir(dir);
  Object.assign(process.env, {
    MA_CONTROL_DB_PATH: path.join(dir, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
    MA_DEMO_DB_PATH: path.join(dir, 'demo.db'),
    MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
    MA_DEALS_DIR: path.join(dir, 'deals'),
  });
  delete process.env.DEMO_OPEN;
  process.env.ADMIN_TOKEN = '';
  const { listenLocal } = require('./helpers/listen-local');
  const store = require('../db/store.js');
  const dbFiles = require('../db/dbFiles.js');
  const sessionsDb = require('../db/sessions.js');
  const { ensureUser } = require('./helpers/seed-identity.js');
  const controlStore = require('../db/controlStore.js');
  const app = require('../server.js');
  const rt = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  const ctl = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
  const demo = store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);
  ensureUser(ctl, { username: 'egress-admin2', role: 'admin' });
  const cookie = `ma_session=${sessionsDb.createSession(rt, { username: 'egress-admin2', role: 'admin', ttlMs: 3600000 })}`;
  controlStore.setSecretSettings({ geminiApiKey: 'sk-test-not-real' });

  const realFetch = global.fetch;
  const outbound = [];
  global.fetch = (u, init) => {
    const url = String(u);
    if (/^http:\/\/127\.0\.0\.1/.test(url)) return realFetch(u, init);
    outbound.push(url);
    return Promise.reject(new Error('stubbed outbound fetch'));
  };
  const server = await listenLocal(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (p, method, body) => {
    const res = await fetch(base + p, {
      method, headers: { Cookie: cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  const gemini = () => outbound.filter((u) => /generativelanguage\.googleapis\.com/.test(u));
  const PDF = { fileName: 'policy.pdf', fileData: 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64') };
  const ragCount = () => demo.prepare('SELECT COUNT(*) AS n FROM ragUploads').get().n;
  try {
    // positive control: with gemini ON and a key, the stub DOES see the outbound call
    const on = await call('/api/ai/insight?portal=employee', 'GET');
    assert.strictEqual(on.status, 200);
    assert.ok(gemini().length >= 1, 'positive control: gemini on + key -> an outbound call is attempted');
    outbound.length = 0;

    const off = await call('/api/admin/egress', 'POST', { gemini: false });
    assert.strictEqual(off.status, 200);

    const rows = ragCount();
    const ins = await call('/api/ai/insight?portal=employee', 'GET');
    assert.strictEqual(ins.status, 200);
    assert.strictEqual(ins.body.egressDisabled, 'gemini');
    assert.ok(ins.body.message);
    const up = await call('/api/rag/upload', 'POST', PDF);
    assert.strictEqual(up.status, 200);
    assert.strictEqual(up.body.egressDisabled, 'gemini');
    assert.strictEqual(ragCount(), rows, 'nothing is written when Gemini is off');
    const qs = demo.prepare('SELECT data FROM questions LIMIT 3').all().map((r) => JSON.parse(r.data).id);
    const responses = Object.fromEntries(qs.map((id) => [id, 4]));
    const asm = await call('/api/assessment', 'POST', { responses });
    assert.ok(asm.status === 200 || asm.status === 201, `assessment status ${asm.status}: ${JSON.stringify(asm.body)}`);
    assert.deepStrictEqual(gemini(), [], 'zero outbound Gemini calls with gemini off');
  } finally {
    global.fetch = realFetch;
    await new Promise((r) => server.close(r));
  }
});
