// RPT-01 (07-01 Task 3): unit and integration proof for
// lib/reportFilename.js — the concrete closure of 07-RESEARCH.md's
// Pitfall 2: a deal codename can legally contain CR/LF, a null byte, or a
// bidi-override character, and has never before been placed into an HTTP
// header. Node's own res.setHeader() throws on a raw CR/LF in a header
// value — a hostile codename must sanitise BEFORE reaching setHeader, not
// rely on that throw as the defence.
//
// node:test — run via `node --test test/reports-filename.test.js` (or
// `npm test`). Never `node --test test/` (the directory argument is
// mis-parsed on this Node version).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { sanitizeForFilename, buildReportFilename } = require('../lib/reportFilename');

// ============================================================= Unit-level ===

test('reports-filename (a): a codename containing a carriage return and a line feed sanitises to a value free of both', () => {
  const result = sanitizeForFilename('evil\r\nSet-Cookie: x=1');
  assert.ok(!result.includes('\r'), 'result must not contain a carriage return');
  assert.ok(!result.includes('\n'), 'result must not contain a line feed');
});

test('reports-filename (b): a codename containing a null byte sanitises to a value free of it', () => {
  const result = sanitizeForFilename('proj\x00ect');
  assert.ok(!result.includes('\x00'), 'result must not contain a null byte');
});

test('reports-filename (c): a codename containing a right-to-left override character sanitises to a value free of it', () => {
  const result = sanitizeForFilename('proj‮ect');
  assert.ok(!result.includes('‮'), 'result must not contain the bidi-override character');
});

test('reports-filename (d): a codename that is entirely control characters falls back to the generic literal rather than producing an empty filename', () => {
  const result = sanitizeForFilename('\r\n\x00\x1F');
  assert.strictEqual(result, 'deal', 'an all-control-character codename must fall back to the generic literal, never an empty string');
});

test('reports-filename (e): a codename containing a forward slash and a colon has them replaced so the value cannot escape a directory or collide with a drive prefix', () => {
  const filename = buildReportFilename('proj/../etc:passwd', 'raid', 'csv');
  assert.ok(!filename.includes('/'), 'the built filename must not contain a forward slash');
  assert.ok(!filename.includes(':'), 'the built filename must not contain a colon');
  assert.match(filename, /^proj-\.\.-etc-passwd-raid-\d{4}-\d{2}-\d{2}\.csv$/, 'the locked shape ({codename}-{dataset}-{date}.{ext}) must still hold with the reserved characters replaced');
});

// =========================================================== Integration ===
// On the Task 1 harness: request a real RAID CSV export for a deal whose
// codename embeds a hostile value, proving the whole route survives it.

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-reports-filename-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-reports-filename-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

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
function makeDeal(id, name) {
  const deal = {
    id, name, targetCompany: `${id} Co`, members: ['admin'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('reports-filename (f): a deal codename embedding a CRLF pair followed by a header-looking string does not 500 the export, the Content-Disposition header parses as a single value, and the response carries no second header named by the injected string', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptf', 'evil\r\nX-Injected-Header: pwned');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

    const res = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', adminToken);
    assert.strictEqual(res.status, 200, 'a hostile codename must never 500 the export');
    const disposition = res.headers.get('content-disposition');
    assert.ok(disposition, 'Content-Disposition must still be present');
    assert.ok(!disposition.includes('\r') && !disposition.includes('\n'), 'the header value itself must carry no raw CR/LF');
    assert.strictEqual(res.headers.get('x-injected-header'), null, 'no second header named by the injected string may exist on the response');
  } finally {
    server.close();
  }
});

test('reports-filename (g): a non-ASCII codename produces BOTH a quoted ASCII fallback parameter and an RFC 5987 extended parameter in the same Content-Disposition header value', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_rptg', 'Müller-中文');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);

    const res = await getRaw(base, '/api/reports/export?dataset=raid&format=csv', adminToken);
    assert.strictEqual(res.status, 200);
    const disposition = res.headers.get('content-disposition');
    assert.match(disposition, /filename="[^"]*"/, 'expected a quoted ASCII filename fallback parameter');
    assert.match(disposition, /filename\*=UTF-8''/, "expected an RFC 5987 extended filename*=UTF-8'' parameter");
  } finally {
    server.close();
  }
});
