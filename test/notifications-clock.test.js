// v3.0 R4 F2 (IL-03, server half): attention signals in a REAL deal.
// A real deal's settings singleton has no `demoMode`, so portalNowMs() used
// the frozen demo arc (2026-05-30) and `critical` RAID never counted. These
// tests pin: wall clock for deal-bound requests, `critical` counted by
// raid_high, demo store unchanged (arc clock).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-notifications-clock-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const fixtureUsers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db.json'), 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)').run(user.username, null, i, JSON.stringify(user));
});

let dealSeq = 0;
function makeDeal(id) {
  const deal = { id, name: id, targetCompany: `${id} Co`, members: ['admin'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() };
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)').run(deal.id, dealSeq++, 'active', JSON.stringify(deal));
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}
function session(dealId) {
  const token = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 3600000 });
  if (dealId) sessionsDb.bindSessionDeal(runtimeConn, token, dealId);
  return token;
}
const hdr = (t) => ({ 'Content-Type': 'application/json', Cookie: `ma_session=${t}` });
async function post(base, p, t, body) { return fetch(`${base}${p}`, { method: 'POST', headers: hdr(t), body: JSON.stringify(body) }); }
async function notifications(base, t) { return (await (await fetch(`${base}/api/notifications`, { headers: hdr(t) })).json()).items; }
async function withServer(fn) {
  const server = await listenLocal(app);
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
test.after(() => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

// 2026-07-01 is in the FUTURE on the demo arc (day 30 = 2026-05-30) but in the
// PAST on the wall clock (the suite runs after 2026-10-01) — it separates the clocks.
const DUE = '2026-07-01';

test('notifications-clock (a): a real deal counts a task past its due date on the WALL clock', async () => {
  await withServer(async (base) => {
    const deal = makeDeal('deal_nclocka');
    const t = session(deal.id);
    const r = await post(base, '/api/integration-tasks', t, { title: 'Past-due on the real clock', status: 'todo', due: DUE, workstream: 'ws_imo' });
    assert.strictEqual(r.status, 201);
    const items = await notifications(base, t);
    const overdue = items.find((i) => i.type === 'tasks_overdue');
    assert.ok(overdue && overdue.count >= 1, 'a real deal must flag a task due ' + DUE + ' as overdue (wall clock)');
  });
});

test('notifications-clock (b): an open `critical` RAID entry raises raid_high in a real deal', async () => {
  await withServer(async (base) => {
    const deal = makeDeal('deal_nclockb');
    const t = session(deal.id);
    const r = await post(base, '/api/raid', t, { title: 'Critical risk', type: 'risk', severity: 'critical' });
    assert.strictEqual(r.status, 201);
    const items = await notifications(base, t);
    const high = items.find((i) => i.type === 'raid_high');
    assert.ok(high && high.count >= 1, 'critical must count toward raid_high');
  });
});

test('notifications-clock (c): the DEMO store keeps its arc clock — the same due date is NOT overdue there', async () => {
  await withServer(async (base) => {
    const t = session(null);
    const r = await post(base, '/api/integration-tasks', t, { title: 'Demo-arc task', status: 'todo', due: DUE, workstream: 'ws_imo' });
    assert.ok(r.status === 201 || r.status === 200, 'demo create status ' + r.status);
    const items = await notifications(base, t);
    const overdue = items.find((i) => i.type === 'tasks_overdue');
    assert.ok(!overdue || !(overdue.count >= 1) || true, 'demo store is allowed other overdue seeds; the assertion below is the contract');
    // Contract: the demo lane's own task must not be among the overdue set. Count with and without it.
    const baseline = overdue ? overdue.count : 0;
    const t2 = session(null);
    const r2 = await post(base, '/api/integration-tasks', t2, { title: 'Demo-arc task 2', status: 'todo', due: DUE, workstream: 'ws_imo' });
    assert.ok(r2.status === 201 || r2.status === 200);
    const items2 = await notifications(base, t2);
    const overdue2 = items2.find((i) => i.type === 'tasks_overdue');
    assert.strictEqual(overdue2 ? overdue2.count : 0, baseline, 'adding a task due ' + DUE + ' must not change the demo overdue count (arc clock)');
  });
});
