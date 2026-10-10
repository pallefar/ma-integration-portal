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
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    insertBefore(c) { el.children.unshift(c); return c; },
    remove() {},
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
  const ex = loadBlocks(EMPLOYEE_SRC, ['function canReady(', 'function hideSection(', 'function hideCardOf(', 'function loadLeaderboard('], {
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

// ---------------------------------------------------------------- shared helpers
const tick = () => new Promise((r) => setImmediate(r));
async function settle(win) {
  await win.maAccessReady;
  for (let i = 0; i < 6; i++) await tick();
}
const urls = (f) => f.calls.map((c) => c.url);

// Access fixtures: what the server sends per persona.
const ME_EMPLOYEE = { authEnabled: true, user: { role: 'employee' }, access: {
  synergies: false, raid: false, tasks: false, roster: false, communications: false, org: false, dd: false,
  reports: false, hrbps: false, projects: false, processes: false, assessmentsList: false, ai: false, rag: false,
  configWrite: false } };
const ME_PMO = { authEnabled: true, user: { role: 'pmo' }, access: Object.assign({}, ME_EMPLOYEE.access, {
  synergies: true, raid: true, tasks: true, roster: true, communications: true, org: true, dd: true, reports: true,
  projects: true, processes: true, assessmentsList: true, ai: true, rag: true }) };
const ME_HRBP = { authEnabled: true, user: { role: 'hrbp' }, access: Object.assign({}, ME_PMO.access, { hrbps: true }) };
const ME_ADMIN = { authEnabled: true, user: { role: 'admin' }, access: Object.assign({}, ME_HRBP.access, { configWrite: true }) };
const ME_OPEN = { authEnabled: false, user: null };

// --------------------------------------- item 2: employee communications inbox
function notificationsHarness(win) {
  const notifyArea = fakeEl();
  const notifyList = fakeEl();
  const inbox = fakeEl();
  const inboxCard = fakeEl();
  inbox.closest = (sel) => (sel === '.card' ? inboxCard : null);
  const byId = {
    'employee-notifications-area': notifyArea,
    'employee-notifications-list': notifyList,
    'employee-communications-inbox': inbox,
  };
  const fetchImpl = recordingFetch({
    '/api/communications': [
      { recipientType: 'all', recipientEmail: 'x', template: 'welcome', subject: 'Hi', sender: 'PMO', senderRole: 'PMO', body: 'b', timestamp: '2026-01-01T00:00:00Z', htmlEmailPath: '/e.html' },
    ],
  });
  const ex = loadBlocks(EMPLOYEE_SRC, [
    'function canReady(', 'function hideSection(', 'function hideCardOf(', 'function loadEmployeeNotifications(',
  ], {
    window: win,
    fetch: fetchImpl,
    document: { getElementById: (id) => byId[id] || null, createElement: () => fakeEl() },
    localStorage: { getItem: () => null },
    TRANSLATIONS: { en: {} },
    escapeHtml: (s) => String(s),
    getEmployeeTemplateColor: () => '#000',
    getEmployeeTemplateLabel: () => 'L',
  }, ['loadEmployeeNotifications']);
  return { notifyArea, notifyList, inbox, inboxCard, fetchImpl, run: () => ex.loadEmployeeNotifications({ name: 'Alex Doe', email: 'a@b.c' }) };
}

test('item 2 (vm): access.communications === false hides the notification banner and the broadcast archive, no GET /api/communications', async () => {
  const win = await bootWindow(ME_EMPLOYEE);
  const h = notificationsHarness(win);
  h.run();
  await settle(win);
  assert.deepStrictEqual(urls(h.fetchImpl), []);
  assert.strictEqual(h.notifyArea.hidden, true);
  assert.strictEqual(h.notifyArea.style.display, 'none');
  assert.strictEqual(h.inboxCard.hidden, true, 'the card that holds the archive is hidden');
  assert.strictEqual(h.inboxCard.style.display, 'none');
});

test('item 2 (vm): staff and demo-open still read and render the communications inbox', async () => {
  for (const meBody of [ME_PMO, ME_OPEN]) {
    const win = await bootWindow(meBody);
    const h = notificationsHarness(win);
    h.run();
    await settle(win);
    assert.deepStrictEqual(urls(h.fetchImpl), ['/api/communications']);
    assert.strictEqual(h.inboxCard.hidden, false);
    assert.ok(h.inbox.children.length >= 1, 'the archive renders the matched broadcast');
  }
});

// ---------------------------------------- item 3: welcome-video edit control
test('item 3 (source): the welcome-video editor stays out of the page and its save is inert without configWrite', () => {
  assert.ok(/if \(editVideoPen\) editVideoPen\.style\.display = 'none';/.test(EMPLOYEE_SRC), 'the pen is hidden (Phase 4)');
  const submitAt = EMPLOYEE_SRC.indexOf("videoEditForm.addEventListener('submit'");
  assert.ok(submitAt > 0);
  const postAt = EMPLOYEE_SRC.indexOf("fetch('/api/settings', {", submitAt);
  assert.ok(postAt > submitAt);
  const guardAt = EMPLOYEE_SRC.indexOf("window.maCan('configWrite')", submitAt);
  assert.ok(guardAt > submitAt && guardAt < postAt, 'the configWrite guard precedes the POST /api/settings in the submit handler');
});

// ------------------------------------ items 4 + amendment 2: pmo.js controls
const PMO_SRC = readPublic('js', 'pmo.js');
const PMO_HELPERS = ['function canReady(', 'function canNow(', 'function hideSection(', 'function hideCardOf('];

function pmoHrbpsHarness(win) {
  const container = fakeEl();
  const card = fakeEl();
  container.closest = (sel) => (sel === '.card' ? card : null);
  const fetchImpl = recordingFetch({
    '/api/hrbps': [{ id: 'h1', name: 'Karen P', email: 'k@te.com', role: 'hrbp', supportingTeams: ['Munich'], assignedTracks: ['culture'] }],
  });
  const ex = loadBlocks(PMO_SRC, PMO_HELPERS.concat('function loadActiveHrbps('), {
    window: win,
    fetch: fetchImpl,
    hrbpsListContainer: container,
    document: { createElement: () => fakeEl() },
    escapeHtml: (s) => String(s),
    deleteHrbp() {},
  }, ['loadActiveHrbps']);
  return { container, card, fetchImpl, run: ex.loadActiveHrbps };
}

test('item 4 (vm): pmo without the Integration Leader directory loses the whole provisioning desk and sends no /api/hrbps request', async () => {
  const win = await bootWindow(ME_PMO);
  const h = pmoHrbpsHarness(win);
  h.run();
  await settle(win);
  assert.deepStrictEqual(urls(h.fetchImpl), []);
  assert.strictEqual(h.card.hidden, true);
  assert.strictEqual(h.card.style.display, 'none');
});

test('item 4 (vm): hrbp, admin and demo-open still load the directory', async () => {
  for (const meBody of [ME_HRBP, ME_ADMIN, ME_OPEN]) {
    const win = await bootWindow(meBody);
    const h = pmoHrbpsHarness(win);
    h.run();
    await settle(win);
    assert.deepStrictEqual(urls(h.fetchImpl), ['/api/hrbps']);
    assert.strictEqual(h.card.hidden, false);
    assert.strictEqual(h.container.children.length, 1);
  }
});

test('item 4 (vm): the broadcast recipient picker requests only the directories the map allows', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody);
    const select = fakeEl();
    const fetchImpl = recordingFetch({ '/api/employees': [], '/api/hrbps': [] });
    const ex = loadBlocks(PMO_SRC, PMO_HELPERS.concat('function loadPmoRecipientOptions('), {
      window: win,
      fetch: fetchImpl,
      pmoRecipientSelect: select,
      document: { createElement: () => fakeEl() },
    }, ['loadPmoRecipientOptions']);
    ex.loadPmoRecipientOptions();
    await settle(win);
    return { urls: urls(fetchImpl), select };
  };
  assert.deepStrictEqual((await run(ME_PMO)).urls, ['/api/employees'], 'pmo: roster yes, directory no');
  assert.deepStrictEqual((await run(ME_HRBP)).urls.sort(), ['/api/employees', '/api/hrbps']);
  assert.deepStrictEqual((await run(ME_EMPLOYEE)).urls, []);
  assert.deepStrictEqual((await run(ME_OPEN)).urls.sort(), ['/api/employees', '/api/hrbps']);
});

function pmoPageSettingsHarness(win, settings) {
  const wizard = fakeEl();
  const dash = fakeEl();
  const calls = { wizard: 0, renderAll: 0 };
  const fetchImpl = recordingFetch({ '/api/settings': settings });
  const ex = loadBlocks(PMO_SRC, PMO_HELPERS.concat('function loadPageSettings('), {
    window: win,
    fetch: fetchImpl,
    document: { getElementById: (id) => ({ 'pmo-onboarding-wizard': wizard, 'pmo-dashboard-content': dash }[id] || null) },
    localStorage: { getItem: () => null, setItem() {} },
    defaultTasks: {},
    defaultBlockers: [],
    switcherIndicator: null,
    switcherText: null,
    switcherContainer: null,
    dayBadge: null,
    initOnboardingWizard() { calls.wizard++; },
    updateDashboardCompanyLabels() {},
    renderAll() { calls.renderAll++; },
    loadActiveHrbps() {},
    loadPmoCommunications() {},
  }, ['loadPageSettings']);
  return { wizard, dash, calls, fetchImpl, run: ex.loadPageSettings };
}

test('amendment 2 (vm): a non-admin is routed to the dashboard, never to a custom-setup wizard it could only 403 on', async () => {
  const win = await bootWindow(ME_PMO);
  const h = pmoPageSettingsHarness(win, { demoMode: false, targetCompany: '' });
  h.run();
  await settle(win);
  assert.strictEqual(h.calls.wizard, 0, 'wizard not initialised');
  assert.strictEqual(h.wizard.style.display, 'none');
  assert.strictEqual(h.dash.style.display, 'block');
  assert.strictEqual(h.calls.renderAll, 1);
});

test('amendment 2 (vm): admin and demo-open still get the wizard exactly as today', async () => {
  for (const meBody of [ME_ADMIN, ME_OPEN]) {
    const win = await bootWindow(meBody);
    const h = pmoPageSettingsHarness(win, { demoMode: false, targetCompany: '' });
    h.run();
    await settle(win);
    assert.strictEqual(h.calls.wizard, 1);
    assert.strictEqual(h.wizard.style.display, 'block');
    assert.strictEqual(h.dash.style.display, 'none');
  }
});

/**
 * Removes // and block comments from JS source, leaving string / template
 * literal contents intact (so a guard written only inside a comment, or a URL
 * containing //, cannot fool a source row). WR-C06 (Phase 11 review).
 */
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) break; i = e - 1; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) break; i = e + 1; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) if (src[j] === '\\') j++;
      out += src.slice(i, j + 1);
      i = j;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * WR-C06: the guard must sit inside the SPECIFIC handler (anchored on its
 * opening, which must be unique), before `needle`, in code — not in a comment
 * and not anywhere earlier in the file.
 */
function guardedInHandler(src, opening, needle, guard) {
  const first = src.indexOf(opening);
  assert.ok(first >= 0, `could not find the handler opening ${opening}`);
  assert.strictEqual(src.indexOf(opening, first + 1), -1, `the handler opening ${opening} must be unique`);
  const body = stripComments(extractBlock(src, opening));
  const at = body.indexOf(needle);
  assert.ok(at > 0, `${needle} is not inside the ${opening} handler`);
  return body.slice(0, at).includes(guard);
}

test('amendment 2 (source): every POST /api/settings in pmo.js is behind a configWrite guard; the roster upload follows the roster rule', () => {
  const guardBefore = (opening, needle) => guardedInHandler(PMO_SRC, opening, needle, "canNow('configWrite')");
  // demo-mode switcher: the click handler is guarded and the control is hidden
  assert.ok(guardBefore("switcherContainer.addEventListener('click'", 'body: JSON.stringify({ demoMode: nextDemoMode })'), 'switcher click is guarded');
  assert.ok(/canReady\('configWrite'\)\.then\(ok => \{ if \(!ok\) hideSection\(switcherContainer\); \}\)/.test(PMO_SRC), 'switcher is hidden');
  // custom-setup wizard step 1 and the finalize call (pmoCustomSetupComplete)
  assert.ok(guardBefore("specsForm.addEventListener('submit'", 'targetCompany: document.getElementById'), 'wizard specs submit is guarded');
  assert.ok(guardBefore("finalizeBtn.addEventListener('click'", 'body: JSON.stringify({ pmoCustomSetupComplete: true })'), 'finalize is guarded');
  assert.ok(/parsedRoster\.length > 0 && canNow\('roster'\)/.test(PMO_SRC), 'roster upload follows the roster rule');
});

// ------------------------------------------- items 5, 6 + amendment 2/3: transitions.js
const TR_HELPERS_NONE = [];

function trGlobals(win, overrides) {
  const calls = { fade: 0, injected: 0 };
  const g = Object.assign({
    window: win,
    localStorage: { getItem: () => null, setItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: () => fakeEl(), createElement: () => fakeEl(), querySelector: () => null },
    setTimeout: (f) => { f(); return 0; },
    fadeOutModal() { calls.fade++; },
    injectAiInsightModal() { calls.injected++; },
    triggerConfettiBlast() {},
  }, overrides || {});
  return { g, calls };
}

test('item 5 (vm): the profile-dropdown Integration Leader lookup is skipped for a role refused /api/hrbps', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody);
    const fetchImpl = recordingFetch({
      '/api/settings': { targetCompany: 'Target Co' },
      '/api/hrbps': [{ name: 'Karen P', email: 'k@te.com', assignedTracks: ['culture'] }],
    });
    const { g } = trGlobals(win, {
      fetch: fetchImpl,
      localStorage: { getItem: (k) => (k === 'active_demo_role' ? 'hrbp' : null), setItem() {} },
    });
    const ex = loadBlocks(TRANSITIONS_SRC, ['function hbpInitials(', 'function loadActiveHRBP('], g, ['loadActiveHRBP']);
    ex.loadActiveHRBP();
    await settle(win);
    return urls(fetchImpl).sort();
  };
  assert.deepStrictEqual(await run(ME_PMO), ['/api/settings'], 'pmo: no /api/hrbps');
  assert.deepStrictEqual(await run(ME_EMPLOYEE), ['/api/settings']);
  assert.deepStrictEqual(await run(ME_HRBP), ['/api/hrbps', '/api/settings']);
  assert.deepStrictEqual(await run(ME_OPEN), ['/api/hrbps', '/api/settings']);
});

test('item 6 (vm): the AI-insight panel and its request are absent for a role refused /api/ai/insight', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody);
    win.location.pathname = '/';
    const main = fakeEl();
    const inserted = [];
    main.insertBefore = (c) => { inserted.push(c); return c; };
    main.firstChild = null;
    const fetchImpl = recordingFetch({ '/api/ai/insight': { success: true, insight: 'ok' } });
    const { g } = trGlobals(win, {
      fetch: fetchImpl,
      document: {
        getElementById: () => null,
        createElement: () => fakeEl(),
        querySelector: (sel) => (sel === '.main-content' || sel === 'main' ? main : fakeEl()),
        head: { appendChild() {} },
      },
      makeBannerDismissible() {},
    });
    const ex = loadBlocks(TRANSITIONS_SRC, [
      'function initializeAiInsightInsight(', 'function renderAiInsightCard(', 'function fetchSmolInsight(',
    ], g, ['initializeAiInsightInsight']);
    ex.initializeAiInsightInsight();
    await settle(win);
    return { urls: urls(fetchImpl), inserted: inserted.length };
  };
  const emp = await run(ME_EMPLOYEE);
  assert.deepStrictEqual(emp.urls, [], 'no GET /api/ai/insight');
  assert.strictEqual(emp.inserted, 0, 'no card injected');
  for (const meBody of [ME_PMO, ME_OPEN]) {
    const ok = await run(meBody);
    assert.deepStrictEqual(ok.urls, ['/api/ai/insight?portal=pmo']);
    assert.strictEqual(ok.inserted, 1);
  }
});

test('item 6 / amendment 3 (vm): chatbot — no RAG snippet search and no roster call for a refused role, and no false "Roster is empty"', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody);
    const fetchImpl = recordingFetch({
      '/api/rag/search': { success: true, results: [{ chapter: 'C', title: 'T', text: 'x' }] },
      '/api/employees': [{ points: 10, completedLessons: ['a'] }, { points: 130, completedLessons: [] }],
    });
    const { g } = trGlobals(win, { fetch: fetchImpl });
    const ex = loadBlocks(TRANSITIONS_SRC, ['class GlobalAiInsight'], g, ['GlobalAiInsight']);
    const insight = new ex.GlobalAiInsight(() => {});
    const rag = await insight.tools.searchPlaybook('culture');
    const prog = await insight.tools.getAcquisitionProgress();
    return { urls: urls(fetchImpl), rag, prog };
  };
  const emp = await run(ME_EMPLOYEE);
  assert.deepStrictEqual(emp.urls, [], 'no request for either tool');
  assert.ok(!/Roster is empty/i.test(emp.prog), 'a neutral message, never a false "empty"');
  assert.ok(/not available for your role/.test(emp.prog));
  assert.ok(/not available for your role/.test(emp.rag), 'the chat still answers, just without snippets');
  const staff = await run(ME_PMO);
  assert.strictEqual(staff.urls.length, 2);
  assert.ok(staff.urls.some((u) => u.startsWith('/api/rag/search?q=')));
  assert.ok(/Roster has 2 employees/.test(staff.prog));
  assert.ok(/Retrieved 1 playbook rules/.test(staff.rag));
});

test('amendment 2 (vm): the AI-model setup prompt and its {browserModel} POST need configWrite', async () => {
  const prompt = async (meBody) => {
    const win = await bootWindow(meBody);
    win.location.pathname = '/index.html';
    const fetchImpl = recordingFetch({ '/api/settings': { browserModel: 'none' } });
    const { g, calls } = trGlobals(win, { fetch: fetchImpl });
    const ex = loadBlocks(TRANSITIONS_SRC, ['function checkAndShowAiInsightModal('], g, ['checkAndShowAiInsightModal']);
    ex.checkAndShowAiInsightModal();
    await settle(win);
    return { urls: urls(fetchImpl), injected: calls.injected };
  };
  const pmo = await prompt(ME_PMO);
  assert.deepStrictEqual(pmo.urls, [], 'pmo: no settings probe');
  assert.strictEqual(pmo.injected, 0, 'pmo: no prompt');
  for (const meBody of [ME_ADMIN, ME_OPEN]) {
    const ok = await prompt(meBody);
    assert.deepStrictEqual(ok.urls, ['/api/settings']);
    assert.strictEqual(ok.injected, 1, 'the prompt still appears for admin and in demo-open');
  }

  const save = async (meBody) => {
    const win = await bootWindow(meBody);
    const fetchImpl = recordingFetch({ '/api/settings': { success: true } });
    const { g, calls } = trGlobals(win, { fetch: fetchImpl });
    const ex = loadBlocks(TRANSITIONS_SRC, ['function saveSettingsAndComplete('], g, ['saveSettingsAndComplete']);
    ex.saveSettingsAndComplete('lamini-78m', { querySelector: () => null });
    await settle(win);
    return { calls: fetchImpl.calls, fade: calls.fade };
  };
  const denied = await save(ME_PMO);
  assert.deepStrictEqual(denied.calls, [], 'no POST /api/settings');
  assert.strictEqual(denied.fade, 1, 'the modal still closes');
  const allowed = await save(ME_ADMIN);
  assert.deepStrictEqual(allowed.calls.map((c) => c.method + ' ' + c.url), ['POST /api/settings']);
});

// ------------------------------------------------------- item 7: deal-home.js
function dealHomeHarness(win) {
  const container = fakeEl();
  const sandbox = {
    window: win,
    console,
    Promise,
    document: {
      getElementById: (id) => (id === 'deal-home' ? container : null),
      createElement: () => fakeEl(),
      querySelector: () => fakeEl(),
    },
  };
  const fetchImpl = recordingFetch({
    '/api/deals': [{ id: 'd1', setup: { steps: {} } }],
    '/api/assessment-status': { bySubject: {} },
    '/api/dd/summary': { areas: [] },
    '/api/synergies/rollup': { mine: { staleCount: 0 } },
    '/api/org/summary': { open: null },
  });
  sandbox.fetch = fetchImpl;
  vm.createContext(sandbox);
  vm.runInContext(readPublic('js', 'deal-home.js'), sandbox);
  return { container, fetchImpl, render: () => win.renderDealHome('d1') };
}

function titlesOf(node, out) {
  out = out || [];
  if (node && typeof node.className === 'string' && node.className.includes('deal-home-section-title')) out.push(node.textContent);
  ((node && node.children) || []).forEach((c) => titlesOf(c, out));
  return out;
}

test('item 7 (vm): deal home drops the DD, organisation and synergy panels (and their requests) for a refused role', async () => {
  const win = await bootWindow(ME_EMPLOYEE);
  const h = dealHomeHarness(win);
  h.render();
  await settle(win);
  assert.deepStrictEqual(urls(h.fetchImpl).sort(), ['/api/assessment-status', '/api/deals']);
  const titles = titlesOf(h.container);
  assert.ok(titles.includes('Setup checklist'));
  assert.ok(!titles.includes('Diligence progress'));
  assert.ok(!titles.includes('Organisation'));
});

test('item 7 (vm): staff and demo-open keep every panel and all five requests', async () => {
  for (const meBody of [ME_PMO, ME_OPEN]) {
    const win = await bootWindow(meBody);
    const h = dealHomeHarness(win);
    h.render();
    await settle(win);
    assert.deepStrictEqual(urls(h.fetchImpl).sort(), [
      '/api/assessment-status', '/api/dd/summary', '/api/deals', '/api/org/summary', '/api/synergies/rollup',
    ]);
    const titles = titlesOf(h.container);
    for (const t of ['Setup checklist', 'Readiness assessments', 'Diligence progress', 'Organisation']) {
      assert.ok(titles.includes(t), `${t} renders`);
    }
  }
});

// ------------------------------------------- leaders page (beyond the plan list)
test('leaders.js: a role refused the roster gets a neutral line and no request; demo-open loads as before', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody);
    const reports = fakeEl();
    const fetchImpl = recordingFetch({ '/api/employees': [{ id: 'emp_3', name: 'Emma', isLeader: true, leaderRole: 'Local HR' }, { id: 'e9', name: 'Zed' }] });
    const sandbox = {
      window: win, console, Promise, fetch: fetchImpl,
      localStorage: { getItem: () => null, setItem() {} },
      document: {
        getElementById: (id) => (id === 'direct-reports-roster' ? reports : fakeEl()),
        addEventListener(ev, cb) { sandbox.__ready = cb; },
        createElement: () => fakeEl(),
        querySelectorAll: () => [],
      },
    };
    vm.createContext(sandbox);
    try { vm.runInContext(readPublic('js', 'leaders.js'), sandbox); sandbox.__ready(); } catch (e) { /* the rest of the page boot is not under test */ }
    await settle(win);
    return { urls: urls(fetchImpl), reports };
  };
  const emp = await run(ME_EMPLOYEE);
  assert.deepStrictEqual(emp.urls, []);
  assert.match(emp.reports.textContent, /not available for your role/);
  const open = await run(ME_OPEN);
  assert.deepStrictEqual(open.urls, ['/api/employees']);
});

// ============================================== item 8: admin console (admin.js)
const ADMIN_SRC = readPublic('js', 'admin.js');
// What hrbp/pmo may still use on admin.html, and what only an admin may configure.
const CONFIG_TABS = ['courses', 'slides', 'pages', 'translations', 'menus', 'banners', 'media'];
const KEPT_TABS = ['projects', 'deals', 'modules', 'departments', 'processes', 'employees', 'hrbp', 'communication', 'system'];

function adminGateHarness(win, opts) {
  const o = Object.assign({ editMode: false }, opts);
  const btns = {};
  const panels = {};
  CONFIG_TABS.concat(KEPT_TABS).forEach((k) => { btns[k] = fakeEl(); panels[k] = fakeEl(); });
  const groupOf = (keys) => {
    const g = fakeEl();
    g.querySelectorAll = (sel) => (sel === '.admin-tab-btn' ? keys.map((k) => btns[k]) : []);
    return g;
  };
  const groups = {
    workspace: groupOf(['projects']),
    deals: groupOf(['deals']),
    content: groupOf(['courses', 'modules', 'departments', 'processes', 'slides', 'pages']),
    people: groupOf(['employees', 'hrbp']),
    engagement: groupOf(['communication', 'banners']),
    localization: groupOf(['translations', 'menus', 'media']),
    system: groupOf(['system']),
  };
  const settingsCard = fakeEl();
  const settingsForm = fakeEl({ closest: (s) => (s === '.card' ? settingsCard : null) });
  const zipCard = fakeEl();
  const zipLink = fakeEl({ closest: (s) => (s === '.card' ? zipCard : null) });
  const named = {
    'settings-form': settingsForm,
    'admin-role-visibility-card': fakeEl(),
    'admin-custom-ma-card': fakeEl(),
    'admin-db-migration-card': fakeEl(),
    'demo-mode-switcher-container': fakeEl(),
    'edit-mode-switcher-container': fakeEl(),
  };
  CONFIG_TABS.concat(KEPT_TABS).forEach((k) => { named['tab-' + k] = panels[k]; });
  const store_ = o.editMode ? { adminEditMode: 'true' } : {};
  const classRemoved = [];
  const projectsClicks = { n: 0 };
  btns.projects.click = () => { projectsClicks.n++; };
  const document = {
    getElementById: (id) => named[id] || null,
    querySelectorAll: (sel) => {
      if (sel === '.admin-rail-group') return Object.keys(groups).map((k) => groups[k]);
      const m = /^\.admin-tab-btn\[data-tab="([a-z]+)"\]$/.exec(sel);
      return m && btns[m[1]] ? [btns[m[1]]] : [];
    },
    querySelector: (sel) => {
      if (sel === 'a[href="/api/admin/download-zip"]') return zipLink;
      if (sel === '.admin-tab-btn[data-tab="projects"]') return btns.projects;
      if (sel === '.admin-tab-btn.active') return o.activeKey ? btns[o.activeKey] : btns.projects;
      return null;
    },
    body: { classList: { remove: (c) => classRemoved.push(c) } },
  };
  const ex = loadBlocks(ADMIN_SRC, ['function applyConfigWriteGate('], {
    window: win,
    document,
    localStorage: { getItem: (k) => (k in store_ ? store_[k] : null), setItem: (k, v) => { store_[k] = String(v); } },
  }, ['applyConfigWriteGate']);
  return { btns, panels, groups, named, settingsCard, zipCard, store_, classRemoved, projectsClicks, run: ex.applyConfigWriteGate };
}

test('item 8 (vm): the configuration/content tabs, cards and header pills are hidden; the deal and survey tabs stay', async () => {
  const win = await bootWindow(ME_HRBP, '/admin.html');
  const h = adminGateHarness(win, { editMode: true });
  h.run();
  for (const k of CONFIG_TABS) {
    assert.strictEqual(h.btns[k].hidden, true, `${k} tab button hidden`);
    assert.strictEqual(h.panels[k].hidden, true, `${k} panel hidden`);
    assert.strictEqual(h.btns[k].style.display, 'none');
  }
  for (const k of KEPT_TABS) {
    assert.notStrictEqual(h.btns[k].hidden, true, `${k} tab button stays`);
    assert.notStrictEqual(h.panels[k].hidden, true, `${k} panel stays`);
  }
  assert.strictEqual(h.groups.localization.hidden, true, 'a rail group left empty is hidden with its tabs');
  for (const g of ['workspace', 'deals', 'content', 'people', 'engagement', 'system']) {
    assert.notStrictEqual(h.groups[g].hidden, true, `${g} rail group stays`);
  }
  assert.strictEqual(h.settingsCard.hidden, true, 'the settings form card (AI key, company profile)');
  assert.strictEqual(h.named['admin-role-visibility-card'].hidden, true);
  assert.strictEqual(h.named['admin-custom-ma-card'].hidden, true);
  assert.strictEqual(h.named['admin-db-migration-card'].hidden, true, 'database configuration');
  assert.strictEqual(h.zipCard.hidden, true, 'the admin-only package download');
  assert.strictEqual(h.named['demo-mode-switcher-container'].hidden, true);
  assert.strictEqual(h.named['edit-mode-switcher-container'].hidden, true);
  assert.strictEqual(h.store_.adminEditMode, 'false', 'a stale edit-mode flag is cleared');
  assert.deepStrictEqual(h.classRemoved, ['admin-edit-active']);
});

test('item 8 (vm): a console restored onto a hidden panel falls back to Projects', async () => {
  const win = await bootWindow(ME_HRBP, '/admin.html');
  const h = adminGateHarness(win, { activeKey: 'menus' });
  h.run();
  assert.strictEqual(h.projectsClicks.n, 1);
});

test('item 8 (source): the gate runs only when the map says configWrite is false, and every config save is guarded', () => {
  assert.ok(/window\.maCanReady\('configWrite'\)\.then\(\(ok\) => \{ if \(!ok\) applyConfigWriteGate\(\); \}\)/.test(ADMIN_SRC),
    'applyConfigWriteGate is wired to the access map, and only runs when it is refused');
  const guarded = (opening, needle) => guardedInHandler(ADMIN_SRC, opening, needle, "window.maCan('configWrite')");
  assert.ok(guarded("settingsForm.addEventListener('submit'", "fetch('/api/settings', {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify(payload)"), 'settings save');
  assert.ok(guarded("switcherContainer.addEventListener('click'", 'body: JSON.stringify({ demoMode: nextDemoMode })'), 'demo-mode switcher');
  assert.ok(guarded("roleVisibilityForm.addEventListener('submit'", 'roleVisibility: {'), 'role visibility save');
  assert.ok(guarded("btnResetCustomMa.addEventListener('click'", "fetch('/api/settings/new-ma'"), 'reset custom M&A');
  assert.ok(guarded("dbMigrationForm.addEventListener('submit'", "fetch('/api/admin/migrate-db'"), 'database migration');
});

test('item 8 (vm): admin-cms.js builds the slides/courses/pages/menus/banners editors only with configWrite', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody, '/admin.html');
    const fetchImpl = recordingFetch({
      '/api/projects': { projects: [] },
      '/api/menus': { sidebar: [], landing: [], bookmarks: [] },
    });
    const listeners = {};
    const sandbox = {
      window: win,
      console,
      Promise,
      fetch: fetchImpl,
      setTimeout,
      localStorage: { getItem: () => null, setItem() {} },
      document: {
        addEventListener(ev, cb) { listeners[ev] = cb; },
        getElementById: () => fakeEl(),
        querySelector: () => fakeEl(),
        querySelectorAll: () => [],
        createElement: () => fakeEl(),
        body: fakeEl(),
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(readPublic('js', 'admin-cms.js'), sandbox);
    assert.strictEqual(typeof listeners.DOMContentLoaded, 'function');
    listeners.DOMContentLoaded();
    await settle(win);
    return urls(fetchImpl).sort();
  };
  const lead = await run(ME_HRBP);
  assert.deepStrictEqual(lead, ['/api/departments', '/api/processes', '/api/projects'],
    'hrbp: only the panels a deal lead may edit are loaded');
  for (const meBody of [ME_ADMIN, ME_OPEN]) {
    const full = await run(meBody);
    for (const u of ['/api/slides', '/api/courses', '/api/pages', '/api/menus', '/api/banners']) {
      assert.ok(full.includes(u), `${u} loads for admin / demo-open`);
    }
  }
});

// ================================================== item 9: inline-edit.js
function inlineEditHarness(win, opts) {
  const o = Object.assign({ editMode: true }, opts);
  const listeners = {};
  const state = { inlineOn: null, prevented: false };
  const document = {
    readyState: 'complete',
    addEventListener(ev, cb) { listeners[ev] = cb; },
    getElementById: () => null,
    createElement: () => fakeEl(),
    createRange: () => ({ selectNodeContents() {} }),
    querySelector: () => null,
    body: {
      classList: { toggle(name, on) { if (name === 'cms-inline-on') state.inlineOn = !!on; } },
      getAttribute: () => null,
      appendChild() {},
    },
  };
  win.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  const sandbox = {
    window: win,
    console,
    Promise,
    document,
    setTimeout,
    clearTimeout,
    fetch: () => Promise.reject(new Error('no network in this row')),
    localStorage: { getItem: (k) => (k === 'adminEditMode' && o.editMode ? 'true' : null) },
  };
  vm.createContext(sandbox);
  vm.runInContext(readPublic('js', 'inline-edit.js'), sandbox);
  const i18nEl = fakeEl({
    isContentEditable: false,
    hasAttribute: () => false,
    getAttribute: () => 'some.key',
    matches: () => false,
    focus() {},
    removeEventListener() {},
  });
  const click = () => {
    state.prevented = false;
    const e = {
      target: { closest: () => i18nEl },
      preventDefault() { state.prevented = true; },
      stopPropagation() {},
    };
    try { listeners.click(e); } catch (err) { /* editing internals are not under test */ }
    return state.prevented;
  };
  return { state, click, i18nEl };
}

test('item 9 (vm): click-to-edit is inert without configWrite, and still works in demo-open and for admin', async () => {
  const denied = inlineEditHarness(await bootWindow(ME_HRBP, '/index.html'));
  assert.strictEqual(denied.state.inlineOn, false, 'the cms-inline-on class is not applied');
  assert.strictEqual(denied.click(), false, 'a click is not intercepted into an editor');

  const adminH = inlineEditHarness(await bootWindow(ME_ADMIN, '/index.html'));
  assert.strictEqual(adminH.state.inlineOn, true);
  assert.strictEqual(adminH.click(), true);

  const open = inlineEditHarness(await bootWindow(ME_OPEN, '/index.html'));
  assert.strictEqual(open.state.inlineOn, true, 'demo-open: the presenter edits exactly as before');
  assert.strictEqual(open.click(), true);
});

test('item 9 (vm): the access map settling after init re-evaluates edit mode', async () => {
  // Load inline-edit.js BEFORE the probe settles (a window whose maAccessReady is still pending).
  let release;
  const win = { maCan: () => true, location: { pathname: '/' }, maAccessReady: new Promise((r) => { release = r; }) };
  const h = inlineEditHarness(win);
  assert.strictEqual(h.state.inlineOn, true, 'before the map arrives the default is the showcase');
  win.maCan = (k) => k !== 'configWrite';
  release();
  await tick();
  await tick();
  assert.strictEqual(h.state.inlineOn, false, 'once the map says configWrite is false the flag is cleared');
});

test('item 9 (source): the unconditional always-true admin check is gone', () => {
  const src = readPublic('js', 'inline-edit.js');
  assert.ok(!/isAdmin = \(\) => true/.test(src));
  assert.ok(/window\.maCan === 'function' \? window\.maCan\('configWrite'\)/.test(src));
});

test('inline-edit.js is loaded with a bumped stamp by transitions.js', () => {
  assert.ok(/\/js\/inline-edit\.js\?v=1791800001/.test(TRANSITIONS_SRC));
  assert.ok(!/inline-edit\.js\?v=1783577700/.test(TRANSITIONS_SRC));
});

test('transitions.js: the app-wide Edit Content toggle is not offered without configWrite', () => {
  assert.ok(/window\.maCanReady\('configWrite'\)\.then\(function \(ok\) \{\s*if \(ok\) return;\s*editWrap\.style\.display = 'none';/.test(TRANSITIONS_SRC));
});

// ======================================================================
// Phase 11 review fixes (11-REVIEW-CLIENT.md, FIXER C)
// ======================================================================

/** A fetch that records every call and never settles (nothing downstream renders). */
function pendingFetch(passThrough) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' });
    const key = Object.keys(passThrough || {}).find((k) => String(url).startsWith(k));
    if (key) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(passThrough[key]) });
    return new Promise(() => {});
  };
  fn.calls = calls;
  return fn;
}

/** A permissive fake DOM node: any property is itself, any call returns itself. */
function anyEl() {
  const store = {};
  const p = new Proxy(function () {}, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'length') return 0;
      if (k === 'forEach' || k === 'map' || k === 'filter') return () => [];
      return p;
    },
    set(t, k, v) { store[k] = v; return true; },
    apply() { return p; },
  });
  return p;
}

// ---------------------------------------- WR-C01 / WR-C04: the page gate itself
/** The page-gate IIFE + the real-login handshake, run together against a stubbed /api/auth/me. */
function pageGateSource() {
  const begin = TRANSITIONS_SRC.indexOf('// Access Control redirection check');
  const end = TRANSITIONS_SRC.indexOf('/**\n * TE Connectivity M&A Integration Portal - Transitions Manager');
  assert.ok(begin >= 0 && end > begin, 'expected the page-gate + handshake region in transitions.js');
  return TRANSITIONS_SRC.slice(begin, end);
}

/**
 * Boots the page gate on `pathname`. `stored` seeds localStorage (a returning
 * browser). `meBody === 'pending'` leaves the probe unanswered, so a row can
 * observe what the SYNCHRONOUS check did before the server answered.
 */
async function bootPage(pathname, meBody, stored) {
  const ls = Object.assign({}, stored || {});
  const ss = {};
  const window = { location: { pathname, href: '' } };
  const sandbox = {
    window,
    console,
    Promise,
    setTimeout: () => 0,
    localStorage: {
      getItem: (k) => (k in ls ? ls[k] : null),
      setItem: (k, v) => { ls[k] = String(v); },
      removeItem: (k) => { delete ls[k]; },
    },
    sessionStorage: { getItem: (k) => (k in ss ? ss[k] : null), setItem: (k, v) => { ss[k] = String(v); } },
    document: { getElementById: () => null, querySelector: () => null, createElement: () => fakeEl(), body: { appendChild() {} } },
    fetch: (url) => {
      if (url !== '/api/auth/me') return Promise.reject(new Error('unexpected fetch ' + url));
      if (meBody === 'pending') return new Promise(() => {});
      return Promise.resolve({ json: () => Promise.resolve(meBody) });
    },
  };
  vm.createContext(sandbox);
  const syncHref = (() => { vm.runInContext(pageGateSource(), sandbox); return window.location.href; })();
  if (meBody !== 'pending') await window.maAccessReady;
  return { window, ls, ss, syncHref };
}

test('WR-C01 (vm): the page gate uses the SERVER-VERIFIED role — employee and pmo are sent home from admin.html, employee from pmo.html', async () => {
  for (const [page, meBody] of [['/admin.html', ME_EMPLOYEE], ['/pmo.html', ME_EMPLOYEE], ['/admin.html', ME_PMO]]) {
    const b = await bootPage(page, meBody);
    assert.strictEqual(b.syncHref, '', `${page}: a first-ever visit is not decided by the path-derived persona alone`);
    assert.strictEqual(b.window.location.href, '/', `${meBody.user.role} on ${page} is redirected after the handshake`);
    assert.match(b.ss.access_denied_message, new RegExp(meBody.user.role.toUpperCase()), 'the existing access-denied toast names the verified role');
    assert.strictEqual(b.ls.active_demo_role, meBody.user.role);
    assert.strictEqual(b.ls.ma_auth_role_verified, '1');
  }
});

test('WR-C01 (vm): the roles a page is for keep it (hrbp + admin on admin.html, pmo on pmo.html, hrbp on dashboard.html)', async () => {
  for (const [page, meBody] of [['/admin.html', ME_HRBP], ['/admin.html', ME_ADMIN], ['/pmo.html', ME_PMO], ['/dashboard.html', ME_HRBP], ['/employee.html', ME_EMPLOYEE]]) {
    const b = await bootPage(page, meBody);
    assert.strictEqual(b.window.location.href, '', `${meBody.user.role} stays on ${page}`);
  }
});

test('WR-C01 (vm): a returning browser with a verified role is gated synchronously, before any page loader runs', () => {
  return (async () => {
    const emp = await bootPage('/admin.html', 'pending', { ma_auth_role_verified: '1', active_demo_role: 'employee' });
    assert.strictEqual(emp.syncHref, '/', 'redirected before the probe answered');
    assert.strictEqual(emp.ls.active_demo_role, 'employee', 'the path never overwrites a verified role');
    const hrbp = await bootPage('/employee.html', 'pending', { ma_auth_role_verified: '1', active_demo_role: 'hrbp' });
    assert.strictEqual(hrbp.syncHref, '/');
  })();
});

test('WR-C01 (vm): demo-open keeps the path-derived personas exactly as before and clears a stale verified flag', async () => {
  const b = await bootPage('/admin.html', ME_OPEN, { ma_auth_role_verified: '1', active_demo_role: 'admin' });
  assert.strictEqual(b.window.location.href, '');
  assert.strictEqual(b.ls.ma_auth_role_verified, undefined, 'auth off => the verified flag is cleared');
  const fresh = await bootPage('/employee.html', ME_OPEN, { active_demo_role: 'hrbp' });
  assert.strictEqual(fresh.window.location.href, '', 'demo persona: opening employee.html makes you the employee');
  assert.strictEqual(fresh.ls.active_demo_role, 'employee');
  const pmoPage = await bootPage('/pmo.html', ME_OPEN, { active_demo_role: 'employee' });
  assert.strictEqual(pmoPage.window.location.href, '');
});

test('WR-C04 (vm): due-diligence.html and org.html are gated on the dd / org capability, not a role', async () => {
  for (const page of ['/due-diligence.html', '/org.html']) {
    const emp = await bootPage(page, ME_EMPLOYEE);
    assert.strictEqual(emp.window.location.href, '/', `employee (dd/org refused) is sent home from ${page}`);
    for (const meBody of [ME_PMO, ME_HRBP, ME_ADMIN, ME_OPEN]) {
      const ok = await bootPage(page, meBody);
      assert.strictEqual(ok.window.location.href, '', `${(meBody.user && meBody.user.role) || 'demo-open'} keeps ${page}`);
    }
  }
});

test('WR-C04 (source): the two stale IN-02 "a pmo/employee member must reach this page" justifications are gone', () => {
  const region = pageGateSource();
  assert.ok(!/pmo\/employee deal member legitimately granted an area must be able to\s*\/\/\s*reach this page/.test(region));
  assert.ok(/const pageCapability = \{ 'due-diligence\.html': 'dd', 'org\.html': 'org' \};/.test(region));
});

// ------------------------------- WR-C01: the staff loaders behind the page gate
test('WR-C01 (vm): admin.js staff loaders wait on the access map and fire only the reads the role may make', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody, '/admin.html');
    const fired = [];
    const ex = loadBlocks(ADMIN_SRC, [
      'function whenReadable(', 'function loadAssessmentsHistory(', 'function loadEmployees(',
      'function loadHrbps(', 'function loadCommunications(',
    ], {
      window: win,
      fetchAssessmentsHistory() { fired.push('assessments'); },
      fetchEmployeesRoster() { fired.push('employees'); },
      fetchHrbpsList() { fired.push('hrbps'); },
      fetchCommunicationsLedger() { fired.push('communications'); },
    }, ['loadAssessmentsHistory', 'loadEmployees', 'loadHrbps', 'loadCommunications']);
    ex.loadAssessmentsHistory(); ex.loadEmployees(); ex.loadHrbps(); ex.loadCommunications();
    await settle(win);
    return fired.sort();
  };
  assert.deepStrictEqual(await run(ME_EMPLOYEE), [], 'employee: no staff read is attempted');
  assert.deepStrictEqual(await run(ME_PMO), ['assessments', 'communications', 'employees'], 'pmo: no /api/hrbps');
  for (const meBody of [ME_HRBP, ME_ADMIN, ME_OPEN]) {
    assert.deepStrictEqual(await run(meBody), ['assessments', 'communications', 'employees', 'hrbps']);
  }
});

test('WR-C01 (source): each admin.js staff loader really goes through its capability key', () => {
  const pairs = [
    ['function loadAssessmentsHistory(', "whenReadable('assessmentsList', fetchAssessmentsHistory)"],
    ['function loadEmployees(', "whenReadable('roster', fetchEmployeesRoster)"],
    ['function loadHrbps(', "whenReadable('hrbps', fetchHrbpsList)"],
    ['function loadCommunications(', "whenReadable('communications', fetchCommunicationsLedger)"],
  ];
  for (const [header, call] of pairs) assert.ok(extractBlock(ADMIN_SRC, header).includes(call), `${header} -> ${call}`);
  assert.ok(/function fetchHrbpsList\(\) \{\s*fetch\('\/api\/hrbps'\)/.test(ADMIN_SRC), 'the request itself lives only in the gated body');
});

test('WR-C01 (vm): the admin broadcast recipient picker requests only the directories the map allows', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody, '/admin.html');
    const fetchImpl = recordingFetch({ '/api/employees': [], '/api/hrbps': [] });
    const ex = loadBlocks(ADMIN_SRC, ['function loadRecipientDropdownOptions('], {
      window: win, fetch: fetchImpl, specificRecipientSelect: fakeEl(), document: { createElement: () => fakeEl() },
    }, ['loadRecipientDropdownOptions']);
    ex.loadRecipientDropdownOptions();
    await settle(win);
    return urls(fetchImpl).sort();
  };
  assert.deepStrictEqual(await run(ME_PMO), ['/api/employees']);
  assert.deepStrictEqual(await run(ME_EMPLOYEE), []);
  assert.deepStrictEqual(await run(ME_OPEN), ['/api/employees', '/api/hrbps']);
});

test('WR-C01 (vm): admin-cms.js loads projects / processes only for a role that may read them', async () => {
  const win = await bootWindow(ME_EMPLOYEE, '/admin.html');
  const fetchImpl = recordingFetch({});
  const listeners = {};
  const sandbox = {
    window: win, console, Promise, fetch: fetchImpl, setTimeout,
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      addEventListener(ev, cb) { listeners[ev] = cb; },
      getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [],
      createElement: () => fakeEl(), body: fakeEl(),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(readPublic('js', 'admin-cms.js'), sandbox);
  listeners.DOMContentLoaded();
  await settle(win);
  assert.deepStrictEqual(urls(fetchImpl), ['/api/departments'], 'employee: no /api/projects, no /api/processes');
});

test('WR-C01 (vm): pmo.js communications ledger — refused role loses the card and sends no request; staff and demo-open load it', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody, '/pmo.html');
    const ledger = fakeEl();
    const card = fakeEl();
    ledger.closest = (sel) => (sel === '.card' ? card : null);
    const fetchImpl = pendingFetch();
    const ex = loadBlocks(PMO_SRC, PMO_HELPERS.concat('function loadPmoCommunications(', 'function fetchPmoCommunications('), {
      window: win, fetch: fetchImpl, pmoCommLedgerContainer: ledger, pmoCommLedgerCount: null,
    }, ['loadPmoCommunications']);
    ex.loadPmoCommunications();
    await settle(win);
    return { urls: urls(fetchImpl), card };
  };
  const emp = await run(ME_EMPLOYEE);
  assert.deepStrictEqual(emp.urls, []);
  assert.strictEqual(emp.card.hidden, true);
  for (const meBody of [ME_PMO, ME_OPEN]) {
    const ok = await run(meBody);
    assert.deepStrictEqual(ok.urls, ['/api/communications']);
    assert.notStrictEqual(ok.card.hidden, true);
  }
});

/** Runs a whole page script with a permissive DOM and returns the requests it made on boot. */
async function bootPageScript(file, meBody, pathname, passThrough) {
  const win = await bootWindow(meBody, pathname);
  const fetchImpl = pendingFetch(passThrough);
  const listeners = {};
  const doc = anyEl();
  doc.addEventListener = (ev, cb) => { listeners[ev] = cb; };
  const sandbox = { window: win, console, Promise, fetch: fetchImpl, setTimeout: () => 0, clearTimeout() {}, document: doc,
    localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} } };
  vm.createContext(sandbox);
  vm.runInContext(readPublic('js', file), sandbox);
  if (listeners.DOMContentLoaded) listeners.DOMContentLoaded();
  await settle(win);
  return urls(fetchImpl);
}

test('WR-C04 (vm): due-diligence.js and org.js send no request for a role refused dd / org; pmo and demo-open load as before', async () => {
  const me = { '/api/auth/me': { authEnabled: true, user: { role: 'pmo' }, dealId: 'd1' } };
  assert.deepStrictEqual(await bootPageScript('due-diligence.js', ME_EMPLOYEE, '/due-diligence.html', me), []);
  assert.deepStrictEqual(await bootPageScript('org.js', ME_EMPLOYEE, '/org.html', me), []);
  for (const meBody of [ME_PMO, ME_OPEN]) {
    const dd = await bootPageScript('due-diligence.js', meBody, '/due-diligence.html', me);
    // 12-10 (D-12-02): the page's one DD request is the workspace batch (was /api/dd/areas + 17 more).
    assert.deepStrictEqual(dd, ['/api/auth/me', '/api/dd/workspace']);
    const org = await bootPageScript('org.js', meBody, '/org.html', me);
    assert.deepStrictEqual(org.sort(), ['/api/auth/me', '/api/employees', '/api/org/capabilities', '/api/org/positions']);
  }
});

test('WR-C01 (vm): execution.js waits for the map — a role refused the task lane sends nothing on a first-ever visit', async () => {
  assert.deepStrictEqual(await bootPageScript('execution.js', ME_EMPLOYEE, '/execution.html'), []);
  for (const meBody of [ME_PMO, ME_OPEN]) {
    assert.deepStrictEqual((await bootPageScript('execution.js', meBody, '/execution.html')).sort(), [
      '/api/checklist-templates', '/api/integration-tasks', '/api/raid', '/api/synergies', '/api/synergies/rollup',
    ]);
  }
});

// ---------------------------------------------- WR-C02: employee HR helpdesk
test('WR-C02 (server): `helpdesk` follows the write table — an employee is refused POST /api/communications/send, staff are not', async () => {
  const fx = createDealFixture({ controlConn, runtimeConn, dealId: 'deal_ahhelp', members: MEMBERS });
  const demoEmp = demoSession({ controlConn, runtimeConn, username: 'ah-demo-help-emp', role: 'employee' });
  await withServer(async (base) => {
    const access = async (cookie) => (await me(base, cookie)).json.access;
    assert.strictEqual((await access(fx.cookie('ah-emp'))).helpdesk, false, 'employee, real deal');
    assert.strictEqual((await access(demoEmp)).helpdesk, false, 'employee, demo store: writes follow the same table');
    for (const u of ['ah-pmo', 'ah-hrbp', 'ah-admin']) assert.strictEqual((await access(fx.cookie(u))).helpdesk, true, u);
    // the map agrees with the gate: the employee's ticket POST is refused before the handler
    const res = await fetch(`${base}/api/communications/send`, {
      method: 'POST',
      headers: { cookie: fx.cookie('ah-emp'), 'content-type': 'application/json' },
      body: JSON.stringify({ sender: 'x', subject: 's', body: 'b', recipientType: 'hrbp', template: 'custom' }),
    });
    assert.strictEqual(res.status, 403);
  });
});

function helpdeskHarness(win, response) {
  const form = fakeEl();
  const card = fakeEl();
  form.closest = (sel) => (sel === '.card' ? card : null);
  const btn = fakeEl({ textContent: 'Submit to Integration Leader', disabled: false });
  form.querySelector = (sel) => (sel === 'button[type="submit"]' ? btn : fakeEl());
  const success = fakeEl();
  success.style.display = 'none';
  form.style.display = 'block';
  const created = {};
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({ url: String(url), method: (init && init.method) || 'GET' });
    if (response === Error) return Promise.reject(new Error('network down'));
    return Promise.resolve({ ok: response >= 200 && response < 300, status: response, json: () => Promise.resolve({}) });
  };
  const ex = loadBlocks(EMPLOYEE_SRC, [
    'function canReady(', 'function hideSection(', 'function hideCardOf(', 'function gateHelpdesk(',
    'function submitHelpdeskTicket(', 'function helpdeskErrorBox(',
  ], {
    window: win,
    fetch: fetchImpl,
    hrForm: form,
    hrSuccess: success,
    name: 'Alex',
    TRANSLATIONS: { en: {} },
    localStorage: { getItem: () => null },
    document: {
      getElementById: (id) => (id === 'hr-form-error-message' ? created.err || null : null),
      createElement: () => { created.err = fakeEl(); return created.err; },
    },
  }, ['gateHelpdesk', 'submitHelpdeskTicket']);
  return { form, card, btn, success, created, calls, ex };
}

test('WR-C02 (vm): a refused / failed ticket never shows "Inquiry Received!" — the form stays and an honest error is shown', async () => {
  for (const status of [403, 409, 503, Error]) {
    const h = helpdeskHarness(await bootWindow(ME_OPEN), status);
    await h.ex.submitHelpdeskTicket({ preventDefault() {} });
    assert.strictEqual(h.success.style.display, 'none', `HTTP ${status}: no success card`);
    assert.strictEqual(h.form.style.display, 'block', 'the form (and the typed question) stays');
    assert.ok(h.created.err, 'an error line is rendered');
    assert.match(h.created.err.textContent, /could not be sent .* contact your Integration Leader directly/);
    assert.strictEqual(h.created.err.style.display, 'block');
    assert.strictEqual(h.btn.disabled, false, 'the button is usable again');
    assert.strictEqual(h.btn.textContent, 'Submit to Integration Leader');
  }
});

test('WR-C02 (vm): an accepted ticket (demo-open) keeps the success path', async () => {
  const h = helpdeskHarness(await bootWindow(ME_OPEN), 200);
  await h.ex.submitHelpdeskTicket({ preventDefault() {} });
  assert.deepStrictEqual(h.calls.map((c) => c.method + ' ' + c.url), ['POST /api/communications/send']);
  assert.strictEqual(h.success.style.display, 'block');
  assert.strictEqual(h.form.style.display, 'none');
});

test('WR-C02 (vm): the helpdesk card is hidden for a role the `helpdesk` capability refuses, kept for demo-open and staff', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody);
    const h = helpdeskHarness(win, 200);
    h.ex.gateHelpdesk(h.form);
    await settle(win);
    return h.card;
  };
  const refused = await run(Object.assign({}, ME_EMPLOYEE, { access: Object.assign({}, ME_EMPLOYEE.access, { helpdesk: false }) }));
  assert.strictEqual(refused.hidden, true);
  assert.strictEqual(refused.style.display, 'none');
  for (const meBody of [ME_OPEN, Object.assign({}, ME_PMO, { access: Object.assign({}, ME_PMO.access, { helpdesk: true }) })]) {
    assert.notStrictEqual((await run(meBody)).hidden, true);
  }
});

// ------------------------------------- WR-C03: assessments.html instance list
test('WR-C03 (server): `assessmentInstances` mirrors the admin-only read rule; hrbp is refused the route itself', async () => {
  const fx = createDealFixture({ controlConn, runtimeConn, dealId: 'deal_ahinst', members: MEMBERS });
  await withServer(async (base) => {
    for (const m of MEMBERS) {
      const { access } = (await me(base, fx.cookie(m.username))).json;
      assert.strictEqual(access.assessmentInstances, m.role === 'admin', `${m.role}.assessmentInstances`);
    }
    const res = await fetch(`${base}/api/assessment-instances?templateId=x`, { headers: { cookie: fx.cookie('ah-hrbp') } });
    assert.strictEqual(res.status, 403, 'the key agrees with the gate');
  });
});

test('WR-C03 (vm): assessments.js does not request the instance list for a role refused it, and still renders from the status rollup', async () => {
  const SRC = readPublic('js', 'assessments.js');
  const run = async (meBody) => {
    const win = await bootWindow(meBody, '/assessments.html');
    const fetchImpl = recordingFetch({
      '/api/assessment-templates': [{ id: 't1', subject: 'company' }, { id: 't2', subject: 'leader' }],
      '/api/assessment-status': { bySubject: { company: { latestInstance: { templateId: 't1', overallScore: 3 } } } },
      '/api/pulses': [],
      '/api/assessment-instances': [{ templateId: 't1', overallScore: 4, demoDay: 1 }],
    });
    const state = { templates: [], status: {}, pulses: [], instancesByTpl: {} };
    const ex = loadBlocks(SRC, ['function loadAll('], { window: win, fetch: fetchImpl, state }, ['loadAll']);
    await ex.loadAll();
    return { urls: urls(fetchImpl), state };
  };
  const ME_HRBP_NOINST = Object.assign({}, ME_HRBP, { access: Object.assign({}, ME_HRBP.access, { assessmentInstances: false }) });
  const lead = await run(ME_HRBP_NOINST);
  assert.ok(!lead.urls.some((u) => u.startsWith('/api/assessment-instances')), 'no refused request');
  assert.strictEqual(JSON.stringify(lead.state.instancesByTpl.t1), JSON.stringify([{ templateId: 't1', overallScore: 3 }]), 'status-rollup fallback');
  for (const meBody of [Object.assign({}, ME_ADMIN, { access: Object.assign({}, ME_ADMIN.access, { assessmentInstances: true }) }), ME_OPEN]) {
    const full = await run(meBody);
    assert.strictEqual(full.urls.filter((u) => u.startsWith('/api/assessment-instances?templateId=')).length, 2);
    assert.strictEqual(full.state.instancesByTpl.t1[0].overallScore, 4);
  }
});

// ---------------------------------------------- IN-C01: Day pill / Time Machine
test('IN-C01 (server): `timeTravel` is true only on the demo store for a role the write table lists — never in a real deal', async () => {
  const fx = createDealFixture({ controlConn, runtimeConn, dealId: 'deal_ahtime', members: MEMBERS });
  await withServer(async (base) => {
    for (const m of MEMBERS) {
      assert.strictEqual((await me(base, fx.cookie(m.username))).json.access.timeTravel, false, `real deal ${m.role}`);
    }
    for (const role of ['admin', 'hrbp', 'pmo', 'employee']) {
      const cookie = demoSession({ controlConn, runtimeConn, username: 'ah-tt-' + role, role });
      assert.strictEqual((await me(base, cookie)).json.access.timeTravel, role !== 'employee', `demo store ${role}`);
    }
    // the key agrees with the gate: a deal-bound admin's time-travel POST is refused (demo-only)
    const res = await fetch(`${base}/api/settings/time-travel`, {
      method: 'POST',
      headers: { cookie: fx.cookie('ah-admin'), 'content-type': 'application/json' },
      body: JSON.stringify({ day: 30 }),
    });
    assert.strictEqual(res.status, 403);
  });
});

test('IN-C01 (vm): maHideUnless hides the element for a refused key and leaves it for demo-open', async () => {
  const refused = await bootWindow(Object.assign({}, ME_ADMIN, { access: Object.assign({}, ME_ADMIN.access, { timeTravel: false }) }));
  const pill = fakeEl();
  await refused.maHideUnless('timeTravel', pill);
  assert.strictEqual(pill.hidden, true);
  assert.strictEqual(pill.style.display, 'none');
  const open = await bootWindow(ME_OPEN);
  const pill2 = fakeEl();
  await open.maHideUnless('timeTravel', pill2);
  assert.strictEqual(pill2.hidden, false);
  assert.strictEqual(pill2.style.display, undefined);
});

test('IN-C01 (source): the Day pill is gated right where it is mounted, and a day click never posts without timeTravel', () => {
  assert.ok(/headerToolsContainer\.insertBefore\(timeMachineContainer, headerToolsContainer\.firstElementChild\);[\s\S]{0,600}?window\.maHideUnless\('timeTravel', timeMachineContainer\);/.test(TRANSITIONS_SRC));
  const at = TRANSITIONS_SRC.indexOf("dayButtons.forEach(btn => {");
  assert.ok(at > 0);
  const handler = TRANSITIONS_SRC.slice(at, TRANSITIONS_SRC.indexOf('triggerWormhole(day);', at));
  assert.ok(handler.includes("if (!window.maCan('timeTravel')) return;"));
});

// ---------------------------------------------------- IN-C02: signage kiosk
function signageHarness(meBody, employeesStatus, employeesBody) {
  const calls = [];
  const fetchImpl = (url) => {
    calls.push(String(url));
    if (url === '/api/settings') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ timeTravelDay: 8 }) });
    if (url === '/api/auth/me') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(meBody) });
    if (url === '/api/employees') {
      return Promise.resolve({ ok: employeesStatus === 200, status: employeesStatus, json: () => Promise.resolve(employeesBody) });
    }
    return Promise.reject(new Error('unexpected ' + url));
  };
  const leaderboard = fakeEl();
  const completion = fakeEl();
  const xp = fakeEl();
  const rendered = { leaderboard: null, calendar: 0, events: 0, errors: [] };
  const ex = loadBlocks(readPublic('js', 'signage.js'), [
    'async function loadSettingsAndStats(', 'async function loadSignageRoster(', 'function renderLeaderboardUnavailable(',
  ], {
    fetch: fetchImpl,
    console: { log() {}, warn() {}, error: (...a) => rendered.errors.push(a.join(' ')) },
    document: { createElement: () => fakeEl() },
    leaderboardContainer: leaderboard,
    completionRateEl: completion,
    teamXpEl: xp,
    timelineDayText: null,
    timelineBarFill: null,
    renderLeaderboard: (list) => { rendered.leaderboard = list; },
    renderCalendar: () => { rendered.calendar++; },
    renderEvents: () => { rendered.events++; },
  }, ['loadSettingsAndStats']);
  return { calls, leaderboard, completion, xp, rendered, run: ex.loadSettingsAndStats };
}

test('IN-C02 (vm): signage does not request the roster when the map refuses it, and shows a neutral board', async () => {
  const h = signageHarness({ authEnabled: true, user: { role: 'employee' }, access: { roster: false } }, 403, { error: 'x' });
  await h.run();
  assert.deepStrictEqual(h.calls, ['/api/settings', '/api/auth/me'], 'no GET /api/employees');
  assert.strictEqual(h.completion.textContent, '—');
  assert.strictEqual(h.leaderboard.children[0].textContent, 'Leaderboard not available.');
  assert.strictEqual(h.rendered.calendar, 1, 'the calendar still renders');
  assert.deepStrictEqual(h.rendered.errors, [], 'nothing throws');
});

test('IN-C02 (vm): a refused or non-array roster body is never iterated (no "employees.filter is not a function")', async () => {
  const h = signageHarness({ authEnabled: true, user: null }, 401, { error: 'Login required.', authRequired: true });
  await h.run();
  assert.deepStrictEqual(h.rendered.errors, []);
  assert.strictEqual(h.rendered.leaderboard, null);
  assert.strictEqual(h.completion.textContent, '—');
  const junk = signageHarness({ authEnabled: false, user: null }, 200, { not: 'an array' });
  await junk.run();
  assert.deepStrictEqual(junk.rendered.errors, []);
});

test('IN-C02 (vm): demo-open loads and renders the kiosk roster exactly as before', async () => {
  const h = signageHarness({ authEnabled: false, user: null }, 200, [{ points: 10, completedLessons: ['a'] }, { points: 20, completedLessons: [] }]);
  await h.run();
  assert.deepStrictEqual(h.calls, ['/api/settings', '/api/auth/me', '/api/employees']);
  assert.strictEqual(h.rendered.leaderboard.length, 2);
  assert.strictEqual(String(h.xp.textContent), '30');
});

// ------------------------------- WR-C07: sender-side note in the composers
function inboxNoteAnchor() {
  const inserted = [];
  const parent = {
    querySelector: (sel) => (sel === '.ma-employee-inbox-note' ? inserted.find((n) => n.className === 'ma-employee-inbox-note') || null : null),
    insertBefore: (n) => { inserted.push(n); return n; },
  };
  return { anchor: { parentNode: parent, nextSibling: null }, inserted };
}

test('WR-C07 (vm): a real-deal composer shows "Employees can\'t read in-app messages yet." once, as text; demo store and demo-open show nothing', async () => {
  const bound = await bootWindow(Object.assign({}, ME_HRBP, { dealId: 'deal_x' }));
  const a = inboxNoteAnchor();
  await bound.maAddEmployeeInboxNote(a.anchor);
  await bound.maAddEmployeeInboxNote(a.anchor);
  assert.strictEqual(a.inserted.length, 1, 'one note, never duplicated');
  assert.strictEqual(a.inserted[0].textContent, "Employees can't read in-app messages yet.");
  assert.ok(!a.inserted[0].innerHTML, 'textContent only');
  assert.ok(!/maAddEmployeeInboxNote[\s\S]{0,900}innerHTML/.test(handshakeSource().slice(handshakeSource().indexOf('window.maAddEmployeeInboxNote'))), 'no HTML sink in the note helper');
  for (const meBody of [Object.assign({}, ME_HRBP, { dealId: null }), ME_OPEN]) {
    const w = await bootWindow(meBody);
    const b = inboxNoteAnchor();
    await w.maAddEmployeeInboxNote(b.anchor);
    assert.strictEqual(b.inserted.length, 0);
  }
});

test('WR-C07 (source): the three recipient pickers (IL desk, PMO desk, admin dispatcher) carry the note', () => {
  assert.ok(readPublic('js', 'dashboard.js').includes('window.maAddEmployeeInboxNote(hrbpRecipientType);'));
  assert.ok(PMO_SRC.includes('window.maAddEmployeeInboxNote(pmoRecipientType);'));
  assert.ok(ADMIN_SRC.includes('window.maAddEmployeeInboxNote(recipientTypeSelect);'));
});

// ------------------------------------- IN-C03: no flash of the config tabs
test('IN-C03 (source): admin.html ships exactly the configuration/content tabs (and the Localization group) hidden', () => {
  const html = readPublic('admin.html');
  for (const k of CONFIG_TABS) {
    assert.ok(html.includes(`<button class="admin-tab-btn" data-tab="${k}" data-config-only style="display:none;">`), `${k} starts hidden`);
  }
  for (const k of KEPT_TABS) {
    assert.ok(new RegExp(`<button class="admin-tab-btn[^"]*"[^>]*data-tab="${k}"(?![^>]*data-config-only)[^>]*>`).test(html), `${k} is not config-only`);
  }
  assert.ok(/<div class="admin-rail-group" data-config-only style="display:none;">\s*<span class="admin-rail-label">Localization<\/span>/.test(html));
  assert.strictEqual((html.match(/data-config-only/g) || []).length, CONFIG_TABS.length + 1);
});

test('IN-C03 (vm): the hidden-by-default tabs are revealed for configWrite (and demo-open), left hidden otherwise', async () => {
  const run = async (meBody) => {
    const win = await bootWindow(meBody, '/admin.html');
    const els = [fakeEl(), fakeEl()];
    els.forEach((e) => { e.style.display = 'none'; });
    const ex = loadBlocks(ADMIN_SRC, ['function revealConfigTabs('], {
      window: win,
      document: { querySelectorAll: (sel) => (sel === '[data-config-only]' ? els : []) },
    }, ['revealConfigTabs']);
    if (await win.maCanReady('configWrite')) ex.revealConfigTabs();
    return els;
  };
  for (const meBody of [ME_ADMIN, ME_OPEN]) {
    (await run(meBody)).forEach((e) => { assert.strictEqual(e.style.display, ''); assert.strictEqual(e.hidden, false); });
  }
  (await run(ME_HRBP)).forEach((e) => assert.strictEqual(e.style.display, 'none'));
  assert.ok(/window\.maCanReady\('configWrite'\)\.then\(\(ok\) => \{ if \(ok\) revealConfigTabs\(\); \}\);/.test(ADMIN_SRC), 'wired to the map');
  assert.ok(/\} else \{\s*revealConfigTabs\(\);\s*\}/.test(ADMIN_SRC), 'no map helper at all => revealed at once');
});

// ------------------------------------ WR-C06: client/server capability-key drift
/** Every capability-key literal the client code asks about, with where. */
function clientCapabilityKeys() {
  const PATTERNS = [
    /\b(?:maCan|maCanReady|canReady|canNow|readable|whenReadable|maHideUnless)\(\s*'([A-Za-z]\w*)'/g,
    /\baccess\.([A-Za-z]\w*)\s*===\s*false/g,
  ];
  const found = new Map();
  const dir = path.join(PUBLIC, 'js');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        if (!found.has(m[1])) found.set(m[1], new Set());
        found.get(m[1]).add(f);
      }
    }
  }
  return found;
}

test('WR-C06: every capability key the client asks about is a key the server actually serves on /api/auth/me', async () => {
  const fx = createDealFixture({ controlConn, runtimeConn, dealId: 'deal_ahdrift', members: MEMBERS });
  await withServer(async (base) => {
    const served = new Set(Object.keys((await me(base, fx.cookie('ah-admin'))).json.access));
    // the served map is exactly the read probes + the named write capabilities
    assert.deepStrictEqual([...served].sort(), READ_KEYS.concat('configWrite', 'helpdesk', 'timeTravel').sort());
    const used = clientCapabilityKeys();
    assert.ok(used.size >= 12, `expected the client to use the access map widely (found ${used.size} keys)`);
    for (const k of ['roster', 'configWrite', 'helpdesk', 'timeTravel', 'assessmentInstances', 'dd', 'org', 'tasks']) {
      assert.ok(used.has(k), `sanity: the client uses ${k}`);
    }
    for (const [k, files] of used) {
      assert.ok(served.has(k), `client key '${k}' (${[...files].join(', ')}) is not served by /api/auth/me — ` +
        'a renamed/dropped probe would make maCan() return true and re-show a control that only 403s');
    }
  });
});

test('WR-C02 (source): the submit handler is wired to submitHelpdeskTicket and the old .finally(success) is gone', () => {
  assert.ok(EMPLOYEE_SRC.includes("hrForm.addEventListener('submit', submitHelpdeskTicket);"));
  const body = extractBlock(EMPLOYEE_SRC, 'function submitHelpdeskTicket(');
  assert.ok(!/\.finally\(/.test(body), 'success must not be shown unconditionally');
  assert.ok(/if \(!res \|\| !res\.ok\) throw/.test(body), 'res.ok is checked before the success card');
});
