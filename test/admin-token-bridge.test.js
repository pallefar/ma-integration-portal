// CR3-02 / CR3-03 (v3.0.0-rc.1 client review, pre-release quick fix).
//
// The browser break-glass bridge is gone and a session can no longer be raised
// by the X-Admin-Token header:
//   * static rows  - nothing under public/ (vendor excluded) reads, writes or
//     prompts for the persisted admin token; the fetch wrapper region neither
//     prompts nor touches web storage; the sign-in page clears the previous
//     user's browser state before redirecting;
//   * client rows  - public/js/client-storage.js clearForNewSession() under
//     node:vm: a stale `admin_token` and every other per-user key go, only the
//     language preference survives, no network call is made;
//   * runtime rows - the real app against isolated MA_* temp stores: a valid
//     session cookie wins over the header (a pmo session carrying the VALID
//     token is refused exactly as without it, on the /api gate AND on the
//     handlers that re-check isAdminRequest inline); the token alone (no
//     cookie, or a cookie that is not a live session) behaves exactly as
//     before, DEMO_OPEN included (T-13-13's attributed `admin-token` actor).
//
// node:test - run via `node --test test/admin-token-bridge.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-admin-token-bridge-'));
const BREAK_GLASS = 'bridge-test-break-glass-token';
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN']) delete process.env[key];
process.env.ADMIN_TOKEN = BREAK_GLASS; // read once at server.js load

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
ensureUser(controlConn, { username: 'bridge-admin', role: 'admin' });
ensureUser(controlConn, { username: 'bridge-pmo', role: 'pmo' });

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const ROOT = path.join(__dirname, '..');
const readRoot = (...segs) => fs.readFileSync(path.join(ROOT, ...segs), 'utf8');
const newSession = (username, role) => sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 60 * 60 * 1000 });

// ============================================================ static rows

function walkPublic(visit) {
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir).sort()) {
      if (name === 'vendor' || name === 'node_modules') continue;
      const full = path.join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (fs.statSync(full).isDirectory()) { walk(full, r); continue; }
      if (/\.(js|html)$/.test(name)) visit(r, fs.readFileSync(full, 'utf8'));
    }
  })(path.join(ROOT, 'public'), '');
}

test('CR3-02 static: no persisted admin token, token prompt or X-Admin-Token header remains anywhere under public/', () => {
  const offenders = [];
  walkPublic((rel, src) => {
    if (/\badmin_token\b/.test(src)) offenders.push(`${rel}: admin_token`);
    if (/admin token required/i.test(src)) offenders.push(`${rel}: "Admin token required" prompt`);
    if (/x-admin-token/i.test(src)) offenders.push(`${rel}: X-Admin-Token`);
    if (/maybePromptForToken/.test(src)) offenders.push(`${rel}: maybePromptForToken`);
  });
  assert.deepStrictEqual(offenders, []);
});

test('CR3-02 static: the fetch-wrapper region of transitions.js never prompts and never touches web storage', () => {
  const src = readRoot('public', 'js', 'transitions.js');
  const a = src.indexOf('// ma-fetch-wrapper:begin');
  const b = src.indexOf('// ma-fetch-wrapper:end');
  assert.ok(a !== -1 && b > a, 'wrapper region markers must exist');
  const region = src.slice(a, b)
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n'); // code only
  assert.ok(!/\bprompt\s*\(/.test(region), 'the wrapper must not open a prompt');
  assert.ok(!/\blocalStorage\b|\bsessionStorage\b/.test(region), 'the wrapper must not read or write web storage');
});

test('CR3-03 static: login.js clears the previous browser state on a successful sign-in, before the redirect; login.html loads client-storage.js first', () => {
  const js = readRoot('public', 'js', 'login.js');
  const call = js.indexOf('MAClientStorage.clearForNewSession()');
  const redirect = js.indexOf('window.location.href = policy.landingFor(res.user, must)');
  assert.ok(call !== -1 && redirect !== -1 && call < redirect, 'clearForNewSession() must run before the post-login redirect');
  const html = readRoot('public', 'login.html');
  const cs = html.search(/<script src="\/js\/client-storage\.js\?v=[^"]+"><\/script>/);
  const lg = html.search(/<script src="\/js\/login\.js\?v=[^"]+"><\/script>/);
  assert.ok(cs !== -1 && lg !== -1 && cs < lg, 'client-storage.js must be loaded before login.js');
});

// ============================================================ client rows

function memStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    get length() { return m.size; },
    key(i) { const k = Array.from(m.keys())[i]; return k === undefined ? null : k; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(String(k), String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    _keys() { return Array.from(m.keys()); },
  };
}

function loadClientStorage(local, session) {
  const fetchCalls = [];
  const ctx = {
    window: {},
    localStorage: local,
    sessionStorage: session,
    caches: { keys: () => Promise.resolve([]), delete: () => Promise.resolve(true) },
    navigator: { serviceWorker: { getRegistrations: () => Promise.resolve([]) } },
    fetch: (url, opts) => { fetchCalls.push({ url, opts }); return Promise.resolve({ ok: true }); },
    setTimeout, clearTimeout, URL,
  };
  vm.runInNewContext(readRoot('public', 'js', 'client-storage.js'), ctx);
  return { api: ctx.window.MAClientStorage, fetchCalls };
}

test('CR3-03 client: clearForNewSession removes a stale admin_token and every per-user key, keeps only the language preference, makes no request', async () => {
  const local = memStorage({
    employeeLanguage: 'de', admin_token: 'stale-secret', pmo_tasks_state: '{}', welcome_kit_orders: '[]',
    active_demo_role: 'pmo', ilStretchTasks: '[]', coachingChecklist: '{}', 'ai-insight_downloaded': '1',
  });
  const session = memStorage({ nudge: '1' });
  const env = loadClientStorage(local, session);
  await env.api.runLegacyCleanupOnce(); // settle the load-time clean-up (it sets its own flag)
  assert.strictEqual(typeof env.api.clearForNewSession, 'function');
  const removed = env.api.clearForNewSession();
  assert.ok(removed >= 7, `removed ${removed} keys`);
  assert.deepStrictEqual(local._keys(), ['employeeLanguage']);
  assert.strictEqual(local.getItem('employeeLanguage'), 'de');
  assert.strictEqual(local.getItem('admin_token'), null);
  assert.strictEqual(session.length, 0);
  assert.strictEqual(env.fetchCalls.length, 0, 'a new session must not trigger a logout request');
});

test('CR3-03 client: clearForNewSession shares clearOnLogout\'s allowlist and never throws on unavailable storage', () => {
  const throwing = {
    get length() { throw new Error('denied'); },
    key() { throw new Error('denied'); },
    getItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
    clear() { throw new Error('denied'); },
  };
  const env = loadClientStorage(throwing, throwing);
  assert.doesNotThrow(() => env.api.clearForNewSession());
  assert.deepStrictEqual(Array.from(env.api.LANGUAGE_KEYS), ['employeeLanguage']);
});

// ============================================================ runtime rows

async function call(base, p, { cookieToken, token, method, body } = {}) {
  const headers = {};
  if (cookieToken) headers.Cookie = `ma_session=${cookieToken}`;
  if (token) headers['X-Admin-Token'] = token;
  const init = { method: method || 'GET', headers };
  if (body !== undefined) { init.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`${base}${p}`, init);
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch (e) { /* keep text */ }
  return { status: res.status, body: parsed };
}

test('CR3-02 runtime: a valid session cookie wins over X-Admin-Token - a pmo session carrying the VALID token is refused every admin route with the existing 403', async () => {
  const server = await listenLocal(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const pmo = newSession('bridge-pmo', 'pmo');
    const admin = newSession('bridge-admin', 'admin');

    // control: pmo alone is refused, the token alone (no cookie) is the attributed break-glass admin
    const pmoAlone = await call(base, '/api/admin/users', { cookieToken: pmo });
    assert.strictEqual(pmoAlone.status, 403);
    assert.strictEqual((await call(base, '/api/admin/users', { token: BREAK_GLASS })).status, 200, 'token alone still works');

    // the vulnerable composition: pmo cookie + valid token
    const withToken = await call(base, '/api/admin/users', { cookieToken: pmo, token: BREAK_GLASS });
    assert.strictEqual(withToken.status, 403, 'a session must never be elevated by the header');
    assert.deepStrictEqual(withToken.body, pmoAlone.body, 'the refusal is the existing one, byte for byte');
    const flip = await call(base, '/api/admin/egress', { cookieToken: pmo, token: BREAK_GLASS, method: 'POST', body: { youtube: false } });
    assert.strictEqual(flip.status, 403);
    assert.deepStrictEqual((await call(base, '/api/admin/egress', { token: BREAK_GLASS })).body.stored, {}, 'nothing was stored by the refused call');

    // handlers that re-check isAdminRequest() inline apply the same precedence
    const settingsPmo = await call(base, '/api/settings', { cookieToken: pmo });
    const settingsPmoToken = await call(base, '/api/settings', { cookieToken: pmo, token: BREAK_GLASS });
    assert.strictEqual(settingsPmoToken.status, settingsPmo.status);
    assert.deepStrictEqual(settingsPmoToken.body, settingsPmo.body, 'the admin-only settings view is not handed to a pmo session carrying the token');

    // an admin session is still an admin, with or without the header; a WRONG token never matters
    assert.strictEqual((await call(base, '/api/admin/users', { cookieToken: admin })).status, 200);
    assert.strictEqual((await call(base, '/api/admin/users', { cookieToken: admin, token: BREAK_GLASS })).status, 200);
    assert.strictEqual((await call(base, '/api/admin/users', { cookieToken: pmo, token: 'not-the-token' })).status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CR3-02 runtime: the token is honoured only when there is no LIVE session - an unknown or expired cookie does not mask it', async () => {
  const server = await listenLocal(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const bogus = await call(base, '/api/admin/users', { cookieToken: 'not-a-live-session-token', token: BREAK_GLASS });
    assert.strictEqual(bogus.status, 200, 'script use with a leftover cookie jar keeps working');
    const gone = newSession('bridge-pmo', 'pmo');
    sessionsDb.deleteAllSessionsForUser(runtimeConn, 'bridge-pmo');
    assert.strictEqual((await call(base, '/api/admin/users', { cookieToken: gone, token: BREAK_GLASS })).status, 200);
    assert.strictEqual((await call(base, '/api/admin/users', { cookieToken: gone })).status, 401, 'and without the token the dead session is still refused');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('CR3-02 runtime: DEMO_OPEN token-only behaviour is unchanged (T-13-13 - POST /api/admin/egress is 200 for the token, 403 for anonymous)', async () => {
  const server = await listenLocal(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.DEMO_OPEN = '1';
  try {
    assert.strictEqual((await call(base, '/api/admin/egress', { method: 'POST', body: { youtube: false } })).status, 403);
    assert.strictEqual((await call(base, '/api/admin/egress', { method: 'POST', body: { youtube: false }, token: 'not-the-token' })).status, 403);
    const ok = await call(base, '/api/admin/egress', { method: 'POST', body: { youtube: true }, token: BREAK_GLASS });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  } finally {
    delete process.env.DEMO_OPEN;
    await new Promise((resolve) => server.close(resolve));
  }
});
