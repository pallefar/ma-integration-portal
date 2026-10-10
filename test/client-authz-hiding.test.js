// D-11-01 / D-11-02 / AUTHZ-01 / AUTHZ-02 (Phase 11, plan 11-07) — the user-facing half:
// the server computes an `access` map on GET /api/auth/me from the SAME tables the
// gate enforces (lib/readPolicy.js for reads, ROLE_WRITE_POLICY for configuration
// writes), and every client control that would now answer 403 is hidden — never
// merely disabled, and never with a request still sent.
//
// Two halves, one file:
//   * server rows — the real app against isolated MA_* temp stores, a real deal
//     fixture, a real session per role (the committed data/*.db is never opened);
//   * client rows — node:vm (the pattern of test/client-account-surfaces.test.js):
//     the REAL handshake from public/js/transitions.js builds window.maCan /
//     window.maAccessReady from a stubbed /api/auth/me body, and the REAL function
//     source is pulled out of each client file and run against a recording fake
//     DOM + fetch, so a "hidden" row asserts both the hidden element and that no
//     request was sent.
//
// node:test — run via `node --test test/client-authz-hiding.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-client-authz-hiding-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

// A real, seeded demo.db built in the temp dir only (same recipe as
// test/personal-data-reads.test.js).
const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_DB_PATH = path.join(TMP, `legacy-source-${crypto.randomBytes(4).toString('hex')}.db`);
runMigration(path.join(__dirname, '..', 'db.json'), SOURCE_DB_PATH);
const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP });

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const app = require('../server.js');
const readPolicy = require('../lib/readPolicy');
const { createDealFixture, demoSession } = require('./helpers/deal-fixture');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const PUBLIC = path.join(__dirname, '..', 'public');
const readPublic = (...segs) => fs.readFileSync(path.join(PUBLIC, ...segs), 'utf8');

// ============================================================ server: the map
const MEMBERS = [
  { username: 'ah-admin', role: 'admin' },
  { username: 'ah-hrbp', role: 'hrbp' },
  { username: 'ah-pmo', role: 'pmo' },
  { username: 'ah-emp', role: 'employee' },
];

async function withServer(fn) {
  const server = await listenLocal(app);
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function me(base, cookie) {
  const res = await fetch(`${base}/api/auth/me`, cookie ? { headers: { cookie } } : undefined);
  return { status: res.status, json: await res.json() };
}

const READ_KEYS = Object.keys(readPolicy.accessSummaryFor('admin', true));

test('tracer: /api/auth/me carries the server-computed access map per role in a real deal', async () => {
  const fx = createDealFixture({ controlConn, runtimeConn, dealId: 'deal_ahmap', members: MEMBERS });
  await withServer(async (base) => {
    const emp = (await me(base, fx.cookie('ah-emp'))).json;
    assert.strictEqual(emp.authEnabled, true);
    assert.ok(emp.access && typeof emp.access === 'object', 'authenticated response carries `access`');
    assert.strictEqual(emp.access.roster, false, 'employee: roster refused -> leaderboard hidden');
    assert.strictEqual(emp.access.communications, false);
    assert.strictEqual(emp.access.configWrite, false);
    assert.strictEqual(emp.access.hrbps, false);
    assert.strictEqual(emp.access.ai, false);
    assert.strictEqual(emp.access.rag, false);

    const hrbp = (await me(base, fx.cookie('ah-hrbp'))).json;
    assert.strictEqual(hrbp.access.roster, true);
    assert.strictEqual(hrbp.access.hrbps, true, 'hrbp keeps the Integration Leader directory');
    assert.strictEqual(hrbp.access.configWrite, false, 'hrbp may not write configuration');

    const pmo = (await me(base, fx.cookie('ah-pmo'))).json;
    assert.strictEqual(pmo.access.roster, true);
    assert.strictEqual(pmo.access.hrbps, false, 'pmo is refused the Integration Leader directory');
    assert.strictEqual(pmo.access.configWrite, false);

    const admin = (await me(base, fx.cookie('ah-admin'))).json;
    for (const k of READ_KEYS.concat('configWrite')) {
      assert.strictEqual(admin.access[k], true, `admin: ${k} must be true`);
    }
  });
});

test('the map is derived from lib/readPolicy.js — one source of truth, no second table', async () => {
  const fx = createDealFixture({ controlConn, runtimeConn, dealId: 'deal_ahsrc', members: MEMBERS });
  await withServer(async (base) => {
    for (const m of MEMBERS) {
      const { access } = (await me(base, fx.cookie(m.username))).json;
      const expected = readPolicy.accessSummaryFor(m.role, true);
      for (const k of READ_KEYS) assert.strictEqual(access[k], expected[k], `${m.role}.${k}`);
      assert.strictEqual(access.configWrite, m.role === 'admin', `${m.role}.configWrite`);
      // booleans only — no data rides on the map (T-11-61)
      for (const [k, v] of Object.entries(access)) assert.strictEqual(typeof v, 'boolean', `${m.role}.${k}`);
    }
  });
});

test('a session bound to no deal (the demo store): every read key true, configWrite still follows the write table', async () => {
  const cookie = demoSession({ controlConn, runtimeConn, username: 'ah-demo-emp', role: 'employee' });
  const adminCookie = demoSession({ controlConn, runtimeConn, username: 'ah-demo-admin', role: 'admin' });
  await withServer(async (base) => {
    const emp = (await me(base, cookie)).json;
    for (const k of READ_KEYS) assert.strictEqual(emp.access[k], true, `demo store employee ${k}`);
    assert.strictEqual(emp.access.configWrite, false);
    const adm = (await me(base, adminCookie)).json;
    assert.strictEqual(adm.access.configWrite, true);
  });
});

test('demo-open and no-session responses are unchanged (no access map)', async () => {
  await withServer(async (base) => {
    process.env.DEMO_OPEN = '1';
    try {
      const open = await me(base);
      assert.deepStrictEqual(open.json, { authEnabled: false, user: null });
    } finally {
      delete process.env.DEMO_OPEN;
    }
    const anon = await me(base);
    assert.deepStrictEqual(anon.json, { authEnabled: true, user: null });
  });
});

// ================================================================ client: vm
const TRANSITIONS_SRC = readPublic('js', 'transitions.js');

/** The real-login handshake IIFE (it owns window.maCan / maAccessReady / maCanReady). */
function handshakeSource() {
  const begin = TRANSITIONS_SRC.indexOf('// Real-login handshake');
  const end = TRANSITIONS_SRC.indexOf('/**\n * TE Connectivity M&A Integration Portal - Transitions Manager');
  assert.ok(begin >= 0 && end > begin, 'expected the handshake region in transitions.js');
  return TRANSITIONS_SRC.slice(begin, end);
}

/**
 * Runs the real handshake against a stubbed /api/auth/me and returns the sandbox
 * `window` once maAccessReady has settled. `meBody === Error` simulates a failed probe.
 */
async function bootWindow(meBody, pathname) {
  const store_ = {};
  const window = { location: { pathname: pathname || '/employee.html', href: '' } };
  const el = () => ({ style: {}, addEventListener() {}, appendChild() {}, setAttribute() {} });
  const sandbox = {
    window,
    console,
    Promise,
    setTimeout,
    localStorage: {
      getItem: (k) => (k in store_ ? store_[k] : null),
      setItem: (k, v) => { store_[k] = String(v); },
    },
    document: { getElementById: () => null, querySelector: () => null, createElement: el, body: { appendChild() {} } },
    fetch: (url) => {
      if (url !== '/api/auth/me') return Promise.reject(new Error('unexpected fetch ' + url));
      if (meBody === Error) return Promise.reject(new Error('probe down'));
      return Promise.resolve({ json: () => Promise.resolve(meBody) });
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(handshakeSource(), sandbox);
  await window.maAccessReady;
  return window;
}

/** Brace-matching extractor that skips strings, template literals and comments. */
function extractBlock(src, header) {
  const start = src.indexOf(header);
  assert.ok(start >= 0, `could not find "${header}" in the client source`);
  let i = src.indexOf('{', start);
  assert.ok(i >= 0, `no body for "${header}"`);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (c === '\'' || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (c === '`') {
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '`') break;
        if (src[i] === '$' && src[i + 1] === '{') {
          // nested expression: recurse by extracting its balanced braces
          let d = 0;
          for (i++; i < src.length; i++) {
            if (src[i] === '{') d++;
            else if (src[i] === '}') { d--; if (d === 0) break; }
          }
        }
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`unbalanced braces extracting "${header}"`);
}

/** A recording fake DOM element. */
function fakeEl(extra) {
  const el = {
    style: {},
    hidden: false,
    innerHTML: '',
    textContent: '',
    children: [],
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { el.children.push(c); return c; },
    addEventListener() {},
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
  return Object.assign(el, extra || {});
}

/** fetch recorder: `routes` maps a URL prefix to a JSON body. */
function recordingFetch(routes) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' });
    const key = Object.keys(routes || {}).find((k) => String(url).startsWith(k));
    const body = key ? routes[key] : {};
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
  fn.calls = calls;
  return fn;
}

/**
 * Evaluates the named blocks (function/class source pulled out of `src`) inside
 * one sandbox sharing `globals`, and returns the sandbox so a row can call them.
 */
function loadBlocks(src, headers, globals, returnNames) {
  const sandbox = Object.assign({ console, Promise, setTimeout, clearTimeout }, globals);
  vm.createContext(sandbox);
  const code = headers.map((h) => extractBlock(src, h)).join('\n');
  vm.runInContext(`${code}\n;__exports = { ${returnNames.join(', ')} };`, sandbox);
  return sandbox.__exports;
}

const EMPLOYEE_SRC = readPublic('js', 'employee.js');

// -------------------------------------------------------- handshake: the helpers
test('maCan is false ONLY for an explicit false; absent map / unknown key / failed probe show everything', async () => {
  const w = await bootWindow({ authEnabled: true, user: { role: 'employee' }, access: { roster: false, dd: true } });
  assert.strictEqual(typeof w.maCan, 'function');
  assert.strictEqual(w.maCan('roster'), false);
  assert.strictEqual(w.maCan('dd'), true);
  assert.strictEqual(w.maCan('someFutureKey'), true, 'an unlisted key never hides a control');
  assert.strictEqual(await w.maCanReady('roster'), false);
  assert.strictEqual(await w.maCanReady('dd'), true);

  const open = await bootWindow({ authEnabled: false, user: null });
  assert.strictEqual(open.__portalAccess, null, 'demo-open: no map');
  assert.strictEqual(open.maCan('roster'), true);
  assert.strictEqual(await open.maCanReady('configWrite'), true);

  const down = await bootWindow(Error);
  assert.strictEqual(down.maCan('roster'), true, 'a failed probe settles ready and shows everything');
  assert.strictEqual(await down.maCanReady('roster'), true);

  const junk = await bootWindow({ authEnabled: true, user: { role: 'admin' }, access: 'nope' });
  assert.strictEqual(junk.__portalAccess, null, 'a non-object map is ignored');
});

test('login.html never waits on a probe: maAccessReady is already resolved there', async () => {
  const w = await bootWindow(Error, '/login.html');
  assert.strictEqual(typeof w.maCan, 'function');
  assert.strictEqual(w.maCan('roster'), true);
});

// ------------------------------------------- item 1: employee academy leaderboard
function leaderboardHarness(win) {
  const container = fakeEl();
  const card = fakeEl();
  container.closest = (sel) => (sel === '.card' ? card : null);
  const fetchImpl = recordingFetch({
    '/api/employees': [
      { id: 'e1', name: 'Ada', role: 'Eng', points: 30, badge: 'New Recruit', completedLessons: [] },
      { id: 'e2', name: 'Bob', role: 'Eng', points: 90, badge: 'New Recruit', completedLessons: ['l1'] },
    ],
  });
  const ex = loadBlocks(EMPLOYEE_SRC, ['function canReady(', 'function hideSection(', 'function loadLeaderboard('], {
    window: win,
    fetch: fetchImpl,
    document: { getElementById: (id) => (id === 'academy-leaderboard-container' ? container : null), createElement: () => fakeEl() },
    localStorage: { getItem: () => null },
    TRANSLATIONS: { en: {} },
    escapeHtml: (s) => String(s),
  }, ['loadLeaderboard']);
  return { container, card, fetchImpl, loadLeaderboard: ex.loadLeaderboard };
}

test('tracer (vm): access.roster === false hides the leaderboard card and sends no GET /api/employees', async () => {
  const win = await bootWindow({ authEnabled: true, user: { role: 'employee' }, access: { roster: false } });
  const h = leaderboardHarness(win);
  h.loadLeaderboard('e1');
  await win.maAccessReady;
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.card.hidden, true, 'the card holding the leaderboard is hidden');
  assert.strictEqual(h.card.style.display, 'none');
  assert.deepStrictEqual(h.fetchImpl.calls, [], 'no request is sent');
  assert.strictEqual(h.container.children.length, 0);
});

test('tracer (vm): with no access map (demo-open) the leaderboard fetches and renders as today', async () => {
  const win = await bootWindow({ authEnabled: false, user: null });
  const h = leaderboardHarness(win);
  h.loadLeaderboard('e1');
  await win.maAccessReady;
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(h.fetchImpl.calls.map((c) => c.url), ['/api/employees']);
  assert.strictEqual(h.card.hidden, false);
  assert.strictEqual(h.container.children.length, 2, 'both roster rows render');
});

test('tracer (vm): a role the map allows (hrbp) still gets its leaderboard', async () => {
  const win = await bootWindow({ authEnabled: true, user: { role: 'hrbp' }, access: { roster: true } });
  const h = leaderboardHarness(win);
  h.loadLeaderboard('e1');
  await win.maAccessReady;
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.fetchImpl.calls.length, 1);
  assert.strictEqual(h.container.children.length, 2);
});
