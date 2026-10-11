// SAFE-07 / D-13-06 (Phase 13, plan 13-04): /api responses are never stored by
// the browser, logout clears client caches and storage, and page loads stop
// wiping legitimate caches.
//
//   * server rows — the real app against isolated MA_* temp stores (the
//     committed data/*.db is never opened): a status -> route -> header matrix
//     proving `Cache-Control: no-store` on every /api status incl. parser
//     errors, and the exact `Clear-Site-Data` value on logout;
//   * client rows — public/js/client-storage.js run under node:vm against
//     stub localStorage / sessionStorage / caches / service-worker /
//     fetch (the pattern of test/client-authz-hiding.test.js);
//   * static rows — source assertions on transitions.js, change-password.*,
//     sw.js and the removed manifest.json.
//
// node:test — run via `node --test test/caching-safe07.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-caching-safe07-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const fixtureUsers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db.json'), 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const ROOT = path.join(__dirname, '..');
const readRoot = (...segs) => fs.readFileSync(path.join(ROOT, ...segs), 'utf8');

function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`, members: ['admin', 'employee-demo'],
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, 0, deal.status, JSON.stringify(deal));
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}
function newSession(username, role, dealId) {
  const token = sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
  if (dealId) sessionsDb.bindSessionDeal(runtimeConn, token, dealId);
  return token;
}
const cookie = (token) => ({ Cookie: `ma_session=${token}` });
function postJSON(base, p, token, body) {
  return fetch(`${base}${p}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? cookie(token) : {}),
    body: JSON.stringify(body || {}),
  });
}

// The two provocation routes for the statuses no real route reaches
// deterministically (a thrown error and SQLite contention). They are spliced
// into the live router immediately AFTER the no-store middleware, so the real
// no-store middleware, the real central 503 middleware and the real final 500
// handler all run — only the thrower is synthetic.
function installProvocationRoutes() {
  const stack = app._router.stack;
  // The middleware under test is registered immediately before express.json.
  const jsonIdx = stack.findIndex((l) => l && l.name === 'jsonParser');
  assert.ok(jsonIdx > 0, 'express.json must be present in the live router');
  const idx = jsonIdx - 1;
  const src = stack[idx].handle.toString();
  assert.ok(/res\.setHeader\('Cache-Control', 'no-store'\)/.test(src) && /startsWith\('\/api\/'\)/.test(src), 'the layer immediately before express.json must be the /api no-store middleware');
  app.get('/api/__safe07__/boom', (req, res, next) => next(new Error('safe07 deterministic 500')));
  app.get('/api/__safe07__/busy', (req, res, next) => next(Object.assign(new Error('safe07 busy'), { code: 'SQLITE_BUSY' })));
  const added = stack.splice(stack.length - 2, 2);
  stack.splice(idx + 1, 0, ...added);
}

// A body just over express.json's 50 MiB limit. body-parser decides from the
// Content-Length header but first reads the request off the socket, so the whole
// body is really sent (an early-abort shortcut would hang the request).
async function oversizedRequest(base, token) {
  const res = await fetch(`${base}/api/raid`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, cookie(token)),
    body: Buffer.alloc(51 * 1024 * 1024 + 1024, 0x20),
  });
  await res.arrayBuffer();
  return { status: res.status, cacheControl: res.headers.get('cache-control') };
}

// ============================================================ server rows

test('SAFE-07 (a): every /api status — 200/400/401/403/404/409/413(500)/500/503 — carries Cache-Control: no-store', async () => {
  installProvocationRoutes();
  const server = await listenLocal(app);
  const matrix = [];
  const originalConsoleError = console.error;
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_safe07');
    const admin = newSession('admin', 'admin', deal.id);
    const employee = newSession('employee-demo', 'employee', deal.id);
    const record = async (status, label, res) => {
      matrix.push({ status: res.status, route: label, cacheControl: res.headers.get('cache-control') });
      assert.strictEqual(res.status, status, `${label} must answer ${status}`);
    };

    await record(200, 'GET /api/auth/mode', await fetch(`${base}/api/auth/mode`));
    await record(400, 'POST /api/auth/login (malformed JSON)', await fetch(`${base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username": ',
    }));
    await record(401, 'GET /api/raid (no session)', await fetch(`${base}/api/raid`));
    await record(403, 'POST /api/raid (employee)', await postJSON(base, '/api/raid', employee, { title: 'x', type: 'risk', severity: 'low' }));
    await record(404, 'DELETE /api/raid/:id (unknown id, admin)', await fetch(`${base}/api/raid/safe07-no-such-id?version=0`, { method: 'DELETE', headers: cookie(admin) }));

    const created = await postJSON(base, '/api/raid', admin, { title: 'Original', type: 'risk', severity: 'medium' });
    assert.strictEqual(created.status, 201);
    const { entry } = await created.json();
    const edit = await postJSON(base, '/api/raid', admin, { id: entry.id, title: 'First edit', version: 0 });
    assert.strictEqual(edit.status, 200);
    await record(409, 'POST /api/raid (stale version)', await postJSON(base, '/api/raid', admin, { id: entry.id, title: 'Stale', version: 0 }));

    const over = await oversizedRequest(base, admin);
    matrix.push({ status: over.status, route: 'POST /api/raid (body over the 50 MiB limit)', cacheControl: over.cacheControl });
    assert.ok(over.status === 413 || over.status === 500, `an oversized body must be refused (got ${over.status})`);

    console.error = () => { /* the final handler logs the synthetic error */ };
    await record(500, 'GET /api/__safe07__/boom (thrown error)', await fetch(`${base}/api/__safe07__/boom`));
    const busy = await fetch(`${base}/api/__safe07__/busy`);
    await record(503, 'GET /api/__safe07__/busy (SQLITE_BUSY)', busy);
    assert.strictEqual(busy.headers.get('retry-after'), '1', 'the Phase 8 503 contract is unchanged');
  } finally {
    console.error = originalConsoleError;
    await new Promise((resolve) => server.close(resolve));
  }

  const seen = new Set(matrix.map((m) => m.status));
  for (const status of [200, 400, 401, 403, 404, 409, 500, 503]) {
    assert.ok(seen.has(status), `status ${status} must be exercised`);
  }
  for (const m of matrix) {
    assert.strictEqual(m.cacheControl, 'no-store', `${m.status} ${m.route} must carry Cache-Control: no-store (got ${m.cacheControl})`);
  }
  if (process.env.SAFE07_PRINT_MATRIX) console.log(JSON.stringify(matrix, null, 2));
});

test('SAFE-07 (a): static assets are not forced to no-store (the middleware is /api-only)', async () => {
  const server = await listenLocal(app);
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/css/style.css`);
    assert.strictEqual(res.status, 200);
    assert.notStrictEqual(res.headers.get('cache-control'), 'no-store');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SAFE-07 (b): POST /api/auth/logout answers Clear-Site-Data "cache", "storage" and clears the session cookie', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const token = newSession('admin', 'admin');
    const res = await postJSON(base, '/api/auth/logout', token, {});
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('clear-site-data'), '"cache", "storage"');
    assert.strictEqual(res.headers.get('cache-control'), 'no-store');
    const setCookie = res.headers.get('set-cookie') || '';
    assert.ok(/ma_session=;/.test(setCookie) || /Max-Age=0/i.test(setCookie) || /Expires=Thu, 01 Jan 1970/i.test(setCookie), `the session cookie must be cleared (got: ${setCookie})`);
    const after = await fetch(`${base}/api/raid`, { headers: cookie(token) });
    assert.strictEqual(after.status, 401, 'the session row is revoked server-side');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('SAFE-07 (b) / WR-B01: DELETE /api/auth/sessions/:id sends Clear-Site-Data only when the ended session is the caller\'s own', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const mine = newSession('pmo', 'pmo');
    newSession('pmo', 'pmo'); // a second device of the same user
    const list = await (await fetch(`${base}/api/auth/sessions`, { headers: cookie(mine) })).json();
    const current = list.find((s) => s.current);
    const other = list.find((s) => !s.current);
    assert.ok(current && other, 'two own sessions are listed, one current');

    const endOther = await fetch(`${base}/api/auth/sessions/${encodeURIComponent(other.id)}`, { method: 'DELETE', headers: cookie(mine) });
    assert.strictEqual(endOther.status, 200);
    assert.strictEqual((await endOther.json()).endedCurrent, undefined);
    assert.strictEqual(endOther.headers.get('clear-site-data'), null, 'ending ANOTHER device must not wipe this browser');

    const endMine = await fetch(`${base}/api/auth/sessions/${encodeURIComponent(current.id)}`, { method: 'DELETE', headers: cookie(mine) });
    assert.strictEqual(endMine.status, 200);
    assert.strictEqual((await endMine.json()).endedCurrent, true);
    assert.strictEqual(endMine.headers.get('clear-site-data'), '"cache", "storage"');
    assert.strictEqual(endMine.headers.get('cache-control'), 'no-store');
    const after = await fetch(`${base}/api/auth/sessions`, { headers: cookie(mine) });
    assert.strictEqual(after.status, 401, 'the session row is revoked server-side');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ============================================================ client rows

const CLIENT_SRC = readRoot('public', 'js', 'client-storage.js');

function memStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] === undefined ? null : Array.from(m.keys())[i]; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(String(k), String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    _keys() { return Array.from(m.keys()); },
  };
}

function loadClientStorage({ local, session, cacheNames, regs, fetchImpl }) {
  const deleted = [];
  const names = new Set(cacheNames || []);
  const registrations = (regs || []).map((scriptURL) => ({
    active: { scriptURL },
    unregistered: false,
    unregister() { this.unregistered = true; return Promise.resolve(true); },
  }));
  const fetchCalls = [];
  const ctx = {
    window: {},
    localStorage: local,
    sessionStorage: session,
    caches: {
      keys: () => Promise.resolve(Array.from(names)),
      delete: (n) => { deleted.push(n); return Promise.resolve(names.delete(n)); },
    },
    navigator: { serviceWorker: { getRegistrations: () => Promise.resolve(registrations) } },
    fetch: (url, opts) => {
      fetchCalls.push({ url, opts });
      return fetchImpl ? fetchImpl(url, opts) : Promise.resolve({ ok: true });
    },
    setTimeout, clearTimeout, URL,
  };
  vm.runInNewContext(CLIENT_SRC, ctx);
  return { api: ctx.window.MAClientStorage, ctx, deleted, names, registrations, fetchCalls };
}

test('client-storage: exports the frozen lists and the two entry points', () => {
  const { api } = loadClientStorage({ local: memStorage(), session: memStorage() });
  assert.deepStrictEqual(Array.from(api.LANGUAGE_KEYS), ['employeeLanguage']);
  assert.deepStrictEqual(Array.from(api.MODEL_CACHE_NAMES), ['transformers-cache']);
  assert.ok(Array.isArray(api.LEGACY_CACHE_NAMES));
  assert.ok(!api.LEGACY_CACHE_NAMES.includes('transformers-cache'));
  assert.strictEqual(typeof api.clearOnLogout, 'function');
  assert.strictEqual(typeof api.runLegacyCleanupOnce, 'function');
  assert.ok(Object.isFrozen(api) && Object.isFrozen(api.LANGUAGE_KEYS));
});

test('client-storage: clearOnLogout leaves only employeeLanguage, empties sessionStorage and Cache Storage, unregisters every worker', async () => {
  const local = memStorage({ employeeLanguage: 'de', adminEditMode: 'true', active_demo_role: 'admin', 'ai-insight_downloaded': '1' });
  const session = memStorage({ nudge: '1', dismissed: '1' });
  const env = loadClientStorage({
    local, session,
    cacheNames: ['transformers-cache', 'some-other-cache'],
    regs: ['http://localhost/sw.js', 'http://localhost/other-worker.js'],
  });
  await env.api.runLegacyCleanupOnce(); // settle the load-time clean-up
  await env.api.clearOnLogout();
  assert.deepStrictEqual(local._keys(), ['employeeLanguage']);
  assert.strictEqual(local.getItem('employeeLanguage'), 'de');
  assert.strictEqual(session.length, 0);
  assert.strictEqual(env.names.size, 0, 'every Cache Storage entry — the model cache included — is deleted at logout');
  assert.ok(env.registrations.every((r) => r.unregistered), 'every service-worker registration is unregistered');
  assert.strictEqual(env.fetchCalls.length, 1);
  assert.strictEqual(env.fetchCalls[0].url, '/api/auth/logout');
  assert.strictEqual(env.fetchCalls[0].opts.method, 'POST');
});

test('client-storage: the language snapshot is taken BEFORE the logout request (a Clear-Site-Data wipe during fetch cannot lose it)', async () => {
  const local = memStorage({ employeeLanguage: 'zh', adminEditMode: 'true' });
  const env = loadClientStorage({
    local, session: memStorage({ a: '1' }),
    fetchImpl: () => { local.clear(); return Promise.resolve({ ok: true }); }, // simulates `Clear-Site-Data: "storage"`
  });
  await env.api.runLegacyCleanupOnce();
  local.setItem('employeeLanguage', 'zh'); local.setItem('adminEditMode', 'true'); // legacy flag write must not matter
  await env.api.clearOnLogout();
  assert.deepStrictEqual(local._keys(), ['employeeLanguage']);
  assert.strictEqual(local.getItem('employeeLanguage'), 'zh');
});

test('client-storage: a failed logout request still clears the browser and restores the language key', async () => {
  const local = memStorage({ employeeLanguage: 'cs', active_demo_role: 'pmo' });
  const session = memStorage({ x: '1' });
  const env = loadClientStorage({
    local, session, cacheNames: ['transformers-cache'], regs: ['/sw.js'],
    fetchImpl: () => Promise.reject(new Error('offline')),
  });
  await env.api.runLegacyCleanupOnce();
  local.setItem('active_demo_role', 'pmo');
  await env.api.clearOnLogout();
  assert.deepStrictEqual(local._keys(), ['employeeLanguage']);
  assert.strictEqual(local.getItem('employeeLanguage'), 'cs');
  assert.strictEqual(session.length, 0);
  assert.strictEqual(env.names.size, 0);
});

test('client-storage: with no language preference set, nothing is invented at logout', async () => {
  const local = memStorage({ adminEditMode: 'true' });
  const env = loadClientStorage({ local, session: memStorage() });
  await env.api.runLegacyCleanupOnce();
  await env.api.clearOnLogout();
  assert.deepStrictEqual(local._keys(), []);
});

// ============================================================ static rows (Task 1)

test('static: the logout link uses href="#" + preventDefault and calls MAClientStorage.clearOnLogout; no javascript: URL remains there', () => {
  const src = readRoot('public', 'js', 'transitions.js');
  const i = src.indexOf("a.href = '#';");
  assert.ok(i !== -1, "the logout link must be built with a.href = '#'");
  const block = src.slice(i, i + 1600);
  assert.ok(/preventDefault\(\)/.test(block), 'the click handler must call preventDefault()');
  assert.ok(/MAClientStorage\.clearOnLogout\(\)/.test(block), 'the click handler must call MAClientStorage.clearOnLogout()');
  assert.ok(/getElementById\('client-storage-js'\)/.test(src) && /\/js\/client-storage\.js\?v=/.test(src), 'client-storage.js is loaded through the id-guarded dynamic loader');
});

// WR-B01: the third sign-out path — "End this session" on the current session in
// the account menu. The REAL endSession() from account-menu.js runs under node:vm
// beside the REAL client-storage.js; the DELETE stub simulates the server's
// Clear-Site-Data by wiping localStorage when the response lands.
function extractFunction(src, name) {
  const at = src.indexOf(`function ${name}(`);
  assert.ok(at >= 0, `${name} not found`);
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

async function runEndSession({ withClientStorage, endedCurrent, current }) {
  const local = memStorage({ employeeLanguage: 'de', active_demo_role: 'admin', pmo_tasks_state: '{}' });
  const session = memStorage({ dismissed: '1' });
  const names = new Set(['transformers-cache', 'other']);
  const calls = [];
  let loads = 0;
  const ctx = {
    localStorage: local,
    sessionStorage: session,
    caches: { keys: () => Promise.resolve(Array.from(names)), delete: (n) => Promise.resolve(names.delete(n)) },
    navigator: { serviceWorker: { getRegistrations: () => Promise.resolve([]) } },
    fetch: (url, opts) => {
      calls.push(`${(opts && opts.method) || 'GET'} ${url}`);
      if (opts && opts.method === 'DELETE') {
        if (endedCurrent) local.clear(); // Clear-Site-Data: "storage" in a secure context
        return Promise.resolve({ status: 200, json: () => Promise.resolve(endedCurrent ? { success: true, endedCurrent: true } : { success: true }) });
      }
      return Promise.resolve({ ok: true, status: 200 });
    },
    setTimeout, clearTimeout, URL,
    location: { href: '/dashboard.html' },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  if (withClientStorage) {
    vm.runInContext(CLIENT_SRC, ctx);
    await ctx.MAClientStorage.runLegacyCleanupOnce(); // settle the load-time clean-up (sets its flag)
  }
  const src = extractFunction(readRoot('public', 'js', 'account-menu.js'), 'endSession');
  ctx.__errorEl = { style: {}, textContent: '' };
  ctx.__load = () => { loads++; return Promise.resolve(); };
  const endSession = vm.runInContext(`(function () { var errorEl = __errorEl; var load = __load; ${src}; return endSession; })()`, ctx);
  endSession({ id: 's1', current }, { disabled: false });
  for (let i = 0; i < 50 && ctx.location.href !== '/login.html' && loads === 0; i++) await new Promise((r) => setImmediate(r));
  return { local, session, names, calls, loads, href: ctx.location.href };
}

test('account-menu (WR-B01): ending the current session clears the browser like logout and keeps the language key', async () => {
  const r = await runEndSession({ withClientStorage: true, endedCurrent: true, current: true });
  assert.strictEqual(r.href, '/login.html');
  assert.deepStrictEqual(r.local._keys(), ['employeeLanguage']);
  assert.strictEqual(r.local.getItem('employeeLanguage'), 'de', 'the language preference survives the server wipe');
  assert.strictEqual(r.session.length, 0);
  assert.strictEqual(r.names.size, 0, 'Cache Storage is emptied');
  assert.deepStrictEqual(r.calls, ['DELETE /api/auth/sessions/s1', 'POST /api/auth/logout']);
});

test('account-menu (WR-B01): without MAClientStorage it still leaves for /login.html; ending another device clears nothing', async () => {
  const bare = await runEndSession({ withClientStorage: false, endedCurrent: true, current: true });
  assert.strictEqual(bare.href, '/login.html');
  assert.strictEqual(bare.local.getItem('employeeLanguage'), 'de');
  const other = await runEndSession({ withClientStorage: true, endedCurrent: false, current: false });
  assert.strictEqual(other.href, '/dashboard.html');
  assert.strictEqual(other.loads, 1, 'the list is reloaded');
  assert.deepStrictEqual(other.local._keys().sort(), ['active_demo_role', 'employeeLanguage', 'ma.legacyCleanup.v1', 'pmo_tasks_state']);
  assert.strictEqual(other.session.length, 1);
});

test('static: account-menu.js "End this session" calls MAClientStorage.clearOnLogout() before navigating to /login.html', () => {
  const src = extractFunction(readRoot('public', 'js', 'account-menu.js'), 'endSession');
  const clear = src.indexOf('MAClientStorage.clearOnLogout()');
  const nav = src.indexOf("window.location.href = '/login.html'");
  assert.ok(clear !== -1 && nav !== -1, 'both the clearing call and the navigation are present');
  assert.ok(/\.then\(leave, leave\)/.test(src), 'navigation runs after clearing settles, on success or failure');
  assert.ok(src.indexOf("localStorage.getItem(k)") < src.indexOf("fetch('/api/auth/sessions/"), 'language snapshot precedes the DELETE');
});

test('static: change-password.js calls clearOnLogout and change-password.html loads client-storage.js before change-password.js', () => {
  assert.ok(/MAClientStorage\.clearOnLogout\(\)/.test(readRoot('public', 'js', 'change-password.js')));
  const html = readRoot('public', 'change-password.html');
  const a = html.indexOf('/js/client-storage.js?v=');
  const b = html.indexOf('/js/change-password.js?v=');
  assert.ok(a !== -1 && b !== -1 && a < b, 'client-storage.js must load before change-password.js');
});

test('static: /js/client-storage.js is on the single credential-lockdown static allowlist', () => {
  const { LOCKDOWN_STATIC_ALLOWLIST } = require('../lib/credentialLockdown');
  assert.ok(LOCKDOWN_STATIC_ALLOWLIST.includes('/js/client-storage.js'));
});

test('static: the no-store middleware sits before the body parsers in server.js', () => {
  const src = readRoot('server.js');
  const mw = src.indexOf("res.setHeader('Cache-Control', 'no-store');\n  }\n  next();");
  const json = src.indexOf("app.use(express.json({ limit: '50mb' }));");
  assert.ok(mw !== -1 && json !== -1 && mw < json, 'the no-store middleware must be registered before express.json');
});

// ============================================================ Task 2 rows

test('legacy clean-up: deletes only legacy cache names and /sw.js registrations, never the model cache, and only once (flag)', async () => {
  const local = memStorage();
  const env = loadClientStorage({
    local, session: memStorage(),
    cacheNames: ['transformers-cache', 'old-app-v1', 'unrelated-cache'],
    regs: ['http://localhost/sw.js', 'http://localhost/other-worker.js'],
  });
  await env.api.runLegacyCleanupOnce(); // settle the load-time run: the shipped list is empty
  assert.deepStrictEqual(env.deleted, [], 'the shipped LEGACY_CACHE_NAMES is empty — nothing is deleted at load');
  assert.strictEqual(local.getItem('ma.legacyCleanup.v1'), '1', 'the once-per-browser flag is set');
  assert.strictEqual(env.registrations[0].unregistered, true, 'the /sw.js registration is unregistered');
  assert.strictEqual(env.registrations[1].unregistered, false, 'a registration for another script is left alone');

  // Re-arm the flag and pass a legacy list that (wrongly) also names the model cache.
  local.removeItem('ma.legacyCleanup.v1');
  await env.api.runLegacyCleanupOnce({ legacyCacheNames: ['old-app-v1', 'transformers-cache'] });
  assert.deepStrictEqual(env.deleted, ['old-app-v1'], 'only the legacy name goes; the model cache is protected even if listed');
  assert.deepStrictEqual(Array.from(env.names).sort(), ['transformers-cache', 'unrelated-cache']);

  // Second run: flag set -> does nothing.
  env.names.add('old-app-v1');
  await env.api.runLegacyCleanupOnce({ legacyCacheNames: ['old-app-v1'] });
  assert.deepStrictEqual(env.deleted, ['old-app-v1'], 'a second run is a no-op because of the flag');
  assert.ok(env.names.has('old-app-v1'));
});

test('static: transitions.js makes no Cache Storage delete/enumerate call and no per-load worker unregister', () => {
  const src = readRoot('public', 'js', 'transitions.js');
  assert.strictEqual((src.match(/caches\.delete\(/g) || []).length, 0);
  assert.strictEqual((src.match(/caches\.keys\(/g) || []).length, 0);
  assert.ok(!/getRegistrations\(/.test(src), 'no per-load service-worker unregister loop');
  assert.ok(/MAClientStorage\.runLegacyCleanupOnce\(\)/.test(src), 'the guarded one-time clean-up replaces it');
});

test('static (IN-B02): transitions.js reloads a page restored from the back/forward cache', () => {
  const src = readRoot('public', 'js', 'transitions.js');
  assert.match(src, /window\.addEventListener\('pageshow', \(e\) => \{ if \(e\.persisted\) window\.location\.reload\(\); \}\);/);
});

test('static: no other page script wipes Cache Storage', () => {
  const dir = path.join(ROOT, 'public', 'js');
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'client-storage.js')
    .filter((f) => /caches\.(delete|keys)\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepStrictEqual(offenders, []);
});

test('static: public/sw.js is a self-unregistering stub — no fetch listener, no blanket cache delete', () => {
  const src = readRoot('public', 'sw.js');
  assert.ok(!/addEventListener\(\s*['"]fetch['"]/.test(src), 'sw.js must not intercept requests');
  assert.ok(/addEventListener\(\s*['"]install['"]/.test(src) && /skipWaiting\(\)/.test(src));
  assert.ok(/self\.registration\.unregister\(\)/.test(src));
  assert.ok(/LEGACY_CACHE_NAMES\.indexOf\(key\)/.test(src), 'only legacy cache names are deleted');
  assert.ok(!/transformers-cache/.test(src.replace(/\/\/.*$/gm, '')), 'the model cache is never named in executable code');
});

test('static: sw.js and client-storage.js carry the same LEGACY_CACHE_NAMES', () => {
  const sw = /const LEGACY_CACHE_NAMES = (\[[^\]]*\]);/.exec(readRoot('public', 'sw.js'));
  const cs = /var LEGACY_CACHE_NAMES = Object\.freeze\((\[[^\]]*\])\);/.exec(CLIENT_SRC);
  assert.ok(sw && cs, 'both declarations must be found');
  assert.deepStrictEqual(JSON.parse(sw[1].replace(/'/g, '"')), JSON.parse(cs[1].replace(/'/g, '"')));
});

test('static: public/manifest.json is gone and nothing under public/ references it', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'manifest.json')));
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'vendor' || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(html|js|css|json)$/.test(e.name) && /rel=["']manifest["']|manifest\.json/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(ROOT, full));
    }
  };
  walk(path.join(ROOT, 'public'));
  assert.deepStrictEqual(offenders, []);
});
