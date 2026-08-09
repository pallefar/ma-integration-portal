// RPT-01 (07-01 Task 3): D-10/D-11 proof — the audit ledger gains EXACTLY
// one row per successful REAL-deal RAID CSV export, EXACTLY zero rows for
// the byte-identical request against demo, and EXACTLY zero rows on a 400
// dataset refusal (nothing was exported). Proven as a before/after ROW-COUNT
// DELTA against the real audit.db connection, never by reading the code.
//
// node:test — run via `node --test test/reports-audit.test.js` (or
// `npm test`). Never `node --test test/` (the directory argument is
// mis-parsed on this Node version).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reports-audit-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-reports-audit-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function getRaw(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Cookie: cookieHeader(token) } : {}),
    body: JSON.stringify(body || {}),
  });
}
function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`, members: ['admin'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}
async function createManualRaid(base, adminToken, title) {
  const res = await postJSON(base, '/api/raid', adminToken, { title, type: 'risk', severity: 'medium' });
  const { entry } = await res.json();
  return entry;
}
function auditRowCount() {
  const conn = auditHook.getAuditConnection();
  return conn.prepare('SELECT COUNT(*) c FROM audit_log').get().c;
}
function latestAuditRow() {
  const conn = auditHook.getAuditConnection();
  return conn.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();
}
function dataRowCountFromCsv(csvText) {
  const body = csvText.replace(/^\uFEFF/, '');
  const lines = body.split('\r\n').filter((l) => l.length > 0);
  return lines.length - 1; // drop the header row
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('reports-audit (a): one successful REAL-deal RAID CSV export increases the audit row count by EXACTLY one, with the correct action/actor/deal id/after-value (D-10)', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rpaa');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    await createManualRaid(base, adminToken, 'A risk');
    await createManualRaid(base, adminToken, 'A second risk');

    const before = auditRowCount();
    const res = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', adminToken);
    assert.strictEqual(res.status, 200);
    const csvText = await res.text();
    const after = auditRowCount();

    assert.strictEqual(after - before, 1, 'exactly one audit row must be written per successful real-deal export');
    const row = latestAuditRow();
    assert.strictEqual(row.action, 'report-export');
    assert.strictEqual(row.actor_username, 'admin');
    assert.strictEqual(row.deal_id, deal.id);
    const afterValue = JSON.parse(row.after_json);
    assert.strictEqual(afterValue.format, 'csv');
    assert.strictEqual(afterValue.rowCount, dataRowCountFromCsv(csvText));
  } finally {
    server.close();
  }
});

test('reports-audit (b): the byte-identical request against DEMO increases the audit row count by EXACTLY zero, while still returning 200 with a valid CSV body — demo keeps full export parity and gains no audit rows (D-11)', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const adminToken = newSession('admin', 'admin'); // never bound to a deal -> resolves to demo.db

    const before = auditRowCount();
    const res = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', adminToken);
    assert.strictEqual(res.status, 200, 'demo must retain full export parity');
    const csvText = await res.text();
    assert.ok(csvText.includes('ID,Type,Severity'), 'demo must still return a valid CSV body');
    const after = auditRowCount();

    assert.strictEqual(after - before, 0, 'demo must gain ZERO audit rows for the identical export request');
  } finally {
    server.close();
  }
});

test('reports-audit (c): a 400 dataset refusal writes no audit row, since nothing was exported', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rpac');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

    const before = auditRowCount();
    const res = await getRaw(base, '/api/reports/export?dataset=positions&format=csv', adminToken);
    assert.strictEqual(res.status, 400);
    const after = auditRowCount();

    assert.strictEqual(after - before, 0, 'a 400 refusal must write no audit row');
  } finally {
    server.close();
  }
});
