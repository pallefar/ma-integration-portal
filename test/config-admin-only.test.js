// AUTHZ-02 / D-11-02 (Phase 11, plan 11-02): the instance CONFIGURATION and
// CONTENT surface is admin-only. PRD acceptance 2: pmo and hrbp sessions get
// 403 on POST /api/settings, /api/menus, /api/pages, /api/banners,
// /api/slides, /api/slides/upload, /api/media, /api/i18n, /api/courses (and
// their DELETE siblings), under every spelling variant, while admin still
// succeeds — and the demo time-travel showcase control keeps working for
// staff on the demo store.
//
// Boots the REAL requireable app against an isolated temp control/runtime/
// demo/deals/audit set (MA_* paths); the committed data/*.db is never opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-config-admin-only-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = '';
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  ensureUser(controlConn, { username, role });
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

/** Every spelling variant the CR-01 review named (copied from test/path-canonical-gate.test.js). */
function variants(p) {
  const segs = p.split('/');
  const out = new Set();
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  const join = (arr) => arr.join('/');
  out.add(p.toUpperCase());
  out.add('/API' + p.slice(4));
  out.add(p.replace(/^\/api\//, '/api//'));
  out.add(p + '/');
  out.add(p + '//');
  if (segs.length >= 3) {
    out.add(join([...segs.slice(0, 2), cap(segs[2]), ...segs.slice(3)]));
    out.add(join([...segs.slice(0, -1), cap(segs[segs.length - 1])]));
    const first = segs[2];
    if (first) {
      const enc = '%' + first.charCodeAt(0).toString(16).toUpperCase();
      out.add(join([...segs.slice(0, 2), enc + first.slice(1), ...segs.slice(3)]));
    }
  }
  if (segs.length >= 4) {
    out.add(join(segs.slice(0, -1)) + '%2F' + segs[segs.length - 1]);
    out.add(join(segs.slice(0, -1)) + '%2f' + segs[segs.length - 1]);
  }
  out.delete(p);
  return Array.from(out);
}

// Bodies are deliberately plausible: the gate refuses BEFORE validation, so a
// 403 here proves the role check ran first, and the admin "not 403" rows prove
// the same route is reachable by the one role allowed.
const WRITES = [
  { method: 'POST', path: '/api/settings', body: { targetCompany: 'HACKED CO', geminiApiKey: 'stolen-key', browserModel: 'evil/model' } },
  { method: 'POST', path: '/api/settings/new-ma', body: {} },
  { method: 'POST', path: '/api/menus', body: { sidebar: [] } },
  { method: 'POST', path: '/api/pages', body: { slug: 'cfg-probe', title: { en: 'Probe' } } },
  { method: 'POST', path: '/api/banners', body: { id: 'cfg-banner', message: { en: 'hello' } } },
  { method: 'POST', path: '/api/slides', body: { id: 'cfg-slide', title: 'x' } },
  { method: 'POST', path: '/api/slides/upload', body: { filename: 'x.html', content: '<p>x</p>' } },
  { method: 'POST', path: '/api/media', body: { filename: 'x.png', data: 'AAAA' } },
  { method: 'POST', path: '/api/i18n', body: { lang: 'en', key: 'cfg.probe', value: 'x' } },
  { method: 'POST', path: '/api/courses', body: { title: { en: 'Probe course' } } },
  { method: 'POST', path: '/api/courses/x/lessons', body: { title: { en: 'Lesson' } } },
  { method: 'DELETE', path: '/api/pages/x', body: null },
  { method: 'DELETE', path: '/api/banners/x', body: null },
  { method: 'DELETE', path: '/api/slides/x', body: null },
  { method: 'DELETE', path: '/api/media/x', body: null },
  { method: 'DELETE', path: '/api/courses/x', body: null },
];

const READS = ['/api/settings', '/api/menus', '/api/pages', '/api/banners', '/api/slides', '/api/media', '/api/i18n', '/api/courses'];

async function call(base, token, method, urlPath, body) {
  const opts = { method, headers: { Cookie: cookieHeader(token) } };
  if (body !== null && body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  return fetch(`${base}${urlPath}`, opts);
}

async function snapshot(base, adminToken) {
  const out = {};
  for (const p of READS) {
    const res = await call(base, adminToken, 'GET', p, null);
    out[p] = { status: res.status, body: await res.json().catch(() => null) };
  }
  return out;
}

async function assertNonAdminRefused(base, label, adminToken, nonAdminToken, role) {
  const before = await snapshot(base, adminToken);
  for (const w of WRITES) {
    const res = await call(base, nonAdminToken, w.method, w.path, w.body);
    assert.strictEqual(res.status, 403, `${label}: ${role} ${w.method} ${w.path} must be 403, got ${res.status}`);
  }
  const after = await snapshot(base, adminToken);
  assert.deepStrictEqual(after, before, `${label}: a refused ${role} write must leave every config/content collection untouched`);
}

test('config-admin-only (a): pmo and hrbp get 403 on every config/content write on the DEMO store; nothing stored changes', async () => {
  const adminToken = newSession('cfg-admin-a', 'admin');
  const hrbpToken = newSession('cfg-hrbp-a', 'hrbp');
  const pmoToken = newSession('cfg-pmo-a', 'pmo');
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await assertNonAdminRefused(base, 'demo', adminToken, hrbpToken, 'hrbp');
    await assertNonAdminRefused(base, 'demo', adminToken, pmoToken, 'pmo');
  } finally {
    for (const t of [adminToken, hrbpToken, pmoToken]) sessionsDb.deleteSession(runtimeConn, t);
    server.close();
  }
});

test('config-admin-only (b): the same matrix is 403 inside a REAL deal (member hrbp/pmo), and the deal store is untouched', async () => {
  const deal = {
    id: 'deal_cfgb', name: 'Cfg B', targetCompany: 'Cfg B Co', members: ['cfg-hrbp-b', 'cfg-pmo-b', 'cfg-admin-b'],
    memberGrants: {}, status: 'active', createdBy: 'cfg-admin-b', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const adminToken = newSession('cfg-admin-b', 'admin'); bindDeal(adminToken, deal.id);
  const hrbpToken = newSession('cfg-hrbp-b', 'hrbp'); bindDeal(hrbpToken, deal.id);
  const pmoToken = newSession('cfg-pmo-b', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await assertNonAdminRefused(base, 'deal', adminToken, hrbpToken, 'hrbp');
    await assertNonAdminRefused(base, 'deal', adminToken, pmoToken, 'pmo');
  } finally {
    for (const t of [adminToken, hrbpToken, pmoToken]) sessionsDb.deleteSession(runtimeConn, t);
    server.close();
  }
});

test('config-admin-only (c): admin is NOT refused on any of the same writes (demo and real deal)', async () => {
  const deal = {
    id: 'deal_cfgc', name: 'Cfg C', targetCompany: 'Cfg C Co', members: ['cfg-admin-c'],
    memberGrants: {}, status: 'active', createdBy: 'cfg-admin-c', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const demoAdmin = newSession('cfg-admin-c', 'admin');
  const dealAdmin = newSession('cfg-admin-c2', 'admin'); bindDeal(dealAdmin, deal.id);
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [label, token] of [['demo', demoAdmin], ['deal', dealAdmin]]) {
      for (const w of WRITES) {
        // POST /api/settings/new-ma is exercised through the policy table below, never live:
        // its handler deletes comm_*.html files from the repo's real public/sent_emails/
        // directory (not a temp path), which a test must never do.
        if (w.path === '/api/settings/new-ma') continue;
        const res = await call(base, token, w.method, w.path, w.body);
        assert.notStrictEqual(res.status, 403, `${label}: admin ${w.method} ${w.path} must not be refused (got ${res.status})`);
        assert.notStrictEqual(res.status, 401, `${label}: admin ${w.method} ${w.path} must stay authenticated`);
      }
    }
    assert.strictEqual(app.roleAllowedForWrite('admin', '/api/settings/new-ma', 'POST'), true, 'admin must pass the policy table for new-ma');
    for (const role of ['hrbp', 'pmo', 'employee']) {
      assert.strictEqual(app.roleAllowedForWrite(role, '/api/settings/new-ma', 'POST'), false, `${role} must not pass the policy table for new-ma`);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, demoAdmin);
    sessionsDb.deleteSession(runtimeConn, dealAdmin);
    server.close();
  }
});

test('config-admin-only (d): no spelling variant of POST /api/settings or /api/pages lets a pmo session through', async () => {
  const pmoToken = newSession('cfg-pmo-d', 'pmo');
  const adminToken = newSession('cfg-admin-d', 'admin');
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = await snapshot(base, adminToken);
    let checked = 0;
    for (const canonical of ['/api/settings', '/api/pages']) {
      for (const v of variants(canonical)) {
        const res = await call(base, pmoToken, 'POST', v, { targetCompany: 'VARIANT', slug: 'variant-probe', title: { en: 'v' } });
        assert.ok(res.status === 403 || res.status === 404,
          `pmo POST ${v} must be 403 or 404 — never a 2xx (got ${res.status})`);
        checked++;
      }
    }
    assert.ok(checked >= 14, `expected a broad variant sweep, got ${checked}`);
    const after = await snapshot(base, adminToken);
    assert.deepStrictEqual(after, before, 'no variant spelling may have stored anything');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('config-admin-only (e): the demo time-travel showcase control keeps working for admin, hrbp and pmo on the demo store', async () => {
  const tokens = [
    ['admin', newSession('cfg-admin-e', 'admin')],
    ['hrbp', newSession('cfg-hrbp-e', 'hrbp')],
    ['pmo', newSession('cfg-pmo-e', 'pmo')],
  ];
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [role, token] of tokens) {
      const res = await call(base, token, 'POST', '/api/settings/time-travel', { day: 60 });
      assert.strictEqual(res.status, 200, `${role} must still drive the demo time-travel control`);
      const body = await res.json();
      assert.strictEqual(body.timeTravelDay, 60);
    }
  } finally {
    for (const [, t] of tokens) sessionsDb.deleteSession(runtimeConn, t);
    server.close();
  }
});

test('config-admin-only (f): time-travel stays refused inside a real deal (demo-only) and employee is refused on the demo store', async () => {
  const deal = {
    id: 'deal_cfgf', name: 'Cfg F', targetCompany: 'Cfg F Co', members: ['cfg-hrbp-f'],
    memberGrants: {}, status: 'active', createdBy: 'cfg-hrbp-f', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  const hrbpToken = newSession('cfg-hrbp-f', 'hrbp'); bindDeal(hrbpToken, deal.id);
  const empToken = newSession('cfg-emp-f', 'employee');
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const inDeal = await call(base, hrbpToken, 'POST', '/api/settings/time-travel', { day: 60 });
    assert.strictEqual(inDeal.status, 403, 'time-travel is a showcase mechanic — refused inside a real deal');
    const asEmployee = await call(base, empToken, 'POST', '/api/settings/time-travel', { day: 60 });
    assert.strictEqual(asEmployee.status, 403, 'the staff-only time-travel rule must not open to employee');
  } finally {
    sessionsDb.deleteSession(runtimeConn, hrbpToken);
    sessionsDb.deleteSession(runtimeConn, empToken);
    server.close();
  }
});
