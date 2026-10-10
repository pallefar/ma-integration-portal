'use strict';
// SAFE-02 / D-13-03 / PD-25 (plan 13-07): the CSP violation report channel.
//
//   POST /api/csp-report            unauthenticated, application/csp-report +
//                                   application/reports+json, <= 4 KB (413),
//                                   <= 60/min per IP (429), 204, bounded store
//   GET  /api/admin/csp-violations  admin only (401 anonymous, 403 other roles)
//
// Boots the real app in-process against an isolated temp control/runtime/demo/
// deals/audit set (the committed data/*.db is never opened). TRUST_PROXY=1 is
// set BEFORE require('../server.js') so a test can present distinct client
// addresses with X-Forwarded-For (the limiter keys on req.ip).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-csp-report-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'CSP_MODE']) delete process.env[key];
process.env.TRUST_PROXY = '1';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const app = require('../server.js');
const cspReports = require('../lib/cspReports');
const { sessionAs } = require('./helpers/seed-identity');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const COOKIES = {};
for (const role of ['admin', 'hrbp', 'pmo', 'employee']) {
  COOKIES[role] = 'ma_session=' + sessionAs(runtimeConn, controlConn, { username: 'csp-' + role, role });
}

let server;
let base;
test.before(async () => {
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});
test.beforeEach(() => cspReports.clear());

let ipSeq = 10;
function freshIp() { ipSeq += 1; return `10.77.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`; }

async function postReport(body, { ip, type = 'application/csp-report', raw } = {}) {
  const res = await fetch(base + '/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': type, 'x-forwarded-for': ip || freshIp() },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}
function chromium(over = {}) {
  return {
    'csp-report': {
      'document-uri': 'http://127.0.0.1:3000/overview.html?deal=SECRET#frag',
      'violated-directive': "script-src-elem 'self' 'wasm-unsafe-eval'",
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'inline',
      'source-file': 'http://127.0.0.1:3000/overview.html',
      'line-number': 42,
      ...over,
    },
  };
}
async function list(role) {
  const res = await fetch(base + '/api/admin/csp-violations', { headers: role ? { cookie: COOKIES[role] } : {} });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: res.status, json, text };
}

test('tracer: a Chromium-shaped report is accepted anonymously and shows up, query-stripped, in the admin list', async () => {
  const r = await postReport(chromium());
  assert.strictEqual(r.status, 204);
  assert.strictEqual(r.text, '', '204 carries no body');

  const admin = await list('admin');
  assert.strictEqual(admin.status, 200);
  assert.deepStrictEqual(Object.keys(admin.json).sort(), ['count', 'mode', 'violations']);
  assert.strictEqual(admin.json.mode, 'report-only');
  assert.strictEqual(admin.json.count, 1);
  const v = admin.json.violations[0];
  assert.deepStrictEqual(Object.keys(v).sort(), [
    'blockedUri', 'count', 'directive', 'documentPath', 'firstSeen', 'lastSeen', 'lineNumber', 'sourceFile',
  ]);
  assert.strictEqual(v.directive, 'script-src-elem');
  assert.strictEqual(v.blockedUri, 'inline');
  assert.strictEqual(v.sourceFile, 'http://127.0.0.1:3000/overview.html');
  assert.strictEqual(v.lineNumber, 42);
  assert.strictEqual(v.count, 1);
  assert.strictEqual(v.documentPath, '/overview.html', 'documentPath carries no query string or fragment');
  assert.ok(!/SECRET|deal=|frag/.test(admin.text), 'no query string / fragment anywhere in the list');
});

test('the list is admin-only: 401 anonymous, 403 for hrbp / pmo / employee', async () => {
  await postReport(chromium());
  assert.strictEqual((await list(null)).status, 401);
  for (const role of ['hrbp', 'pmo', 'employee']) {
    const r = await list(role);
    assert.strictEqual(r.status, 403, role);
    assert.ok(!/blockedUri|violations/.test(r.text), `${role} 403 body carries no list`);
  }
  assert.strictEqual((await list('admin')).status, 200);
});

test('a body over 4 KB is 413 and stores nothing; a body at the limit is accepted', async () => {
  const over = JSON.stringify(chromium({ 'source-file': 'x'.repeat(5000) }));
  assert.ok(Buffer.byteLength(over) > 4096);
  const big = await postReport(null, { raw: over });
  assert.strictEqual(big.status, 413);
  assert.strictEqual(cspReports.size(), 0, 'nothing stored');

  // pad to exactly 4096 bytes with a valid JSON string
  const base0 = JSON.stringify(chromium({ 'source-file': '' }));
  const pad = 4096 - Buffer.byteLength(base0);
  const atLimit = JSON.stringify(chromium({ 'source-file': 'a'.repeat(pad) }));
  assert.strictEqual(Buffer.byteLength(atLimit), 4096);
  assert.strictEqual((await postReport(null, { raw: atLimit })).status, 204);
  assert.strictEqual(cspReports.size(), 1);

  // one byte more
  const plusOne = JSON.stringify(chromium({ 'source-file': 'a'.repeat(pad + 1) }));
  assert.strictEqual(Buffer.byteLength(plusOne), 4097);
  assert.strictEqual((await postReport(null, { raw: plusOne })).status, 413);
});

test('the 61st report within a minute from one IP is 429; another IP is still accepted', async () => {
  const ip = freshIp();
  for (let i = 0; i < 60; i++) {
    const r = await postReport(chromium({ 'blocked-uri': `https://x${i}.test/a` }), { ip });
    assert.strictEqual(r.status, 204, `report ${i + 1}`);
  }
  const limited = await postReport(chromium({ 'blocked-uri': 'https://x61.test/a' }), { ip });
  assert.strictEqual(limited.status, 429);
  assert.strictEqual(limited.headers.get('retry-after'), '60');
  const other = await postReport(chromium({ 'blocked-uri': 'https://other-ip.test/a' }), { ip: freshIp() });
  assert.strictEqual(other.status, 204);
});

test('101 distinct tuples keep the last 100 (least recently seen evicted); a repeat increments count', async () => {
  const ips = [freshIp(), freshIp()];
  for (let i = 0; i < 101; i++) {
    const r = await postReport(chromium({ 'blocked-uri': `https://host${i}.test/s.js` }), { ip: ips[i < 60 ? 0 : 1] });
    assert.strictEqual(r.status, 204);
  }
  const admin = await list('admin');
  assert.strictEqual(admin.json.count, 100);
  const blocked = admin.json.violations.map((v) => v.blockedUri);
  assert.ok(!blocked.includes('https://host0.test/s.js'), 'the least recently seen tuple is gone');
  assert.ok(blocked.includes('https://host1.test/s.js'));
  assert.ok(blocked.includes('https://host100.test/s.js'));

  // a repeat of an existing tuple bumps count + lastSeen without adding a row
  const ip = freshIp();
  await postReport(chromium({ 'blocked-uri': 'https://host50.test/s.js' }), { ip });
  await postReport(chromium({ 'blocked-uri': 'https://host50.test/s.js' }), { ip });
  const again = await list('admin');
  assert.strictEqual(again.json.count, 100);
  const hit = again.json.violations.find((v) => v.blockedUri === 'https://host50.test/s.js');
  assert.strictEqual(hit.count, 3);
  assert.ok(Date.parse(hit.lastSeen) >= Date.parse(hit.firstSeen));
  assert.strictEqual(again.json.violations[0].blockedUri, 'https://host50.test/s.js', 'most recently seen first');
});

test('application/reports+json: an array with two csp-violation entries and one other type yields two tuples', async () => {
  const body = [
    { type: 'csp-violation', url: 'http://h.test/p', body: { documentURL: 'http://h.test/p?q=1', effectiveDirective: 'script-src-elem', blockedURL: 'inline', sourceFile: 'http://h.test/p', lineNumber: 7 } },
    { type: 'deprecation', body: { id: 'x', message: 'old api' } },
    { type: 'csp-violation', body: { documentURL: 'http://h.test/q', effectiveDirective: 'script-src-attr', blockedURL: 'inline', lineNumber: 9 } },
  ];
  const r = await postReport(body, { type: 'application/reports+json' });
  assert.strictEqual(r.status, 204);
  const admin = await list('admin');
  assert.strictEqual(admin.json.count, 2);
  assert.deepStrictEqual(admin.json.violations.map((v) => v.directive).sort(), ['script-src-attr', 'script-src-elem']);
  const elem = admin.json.violations.find((v) => v.directive === 'script-src-elem');
  assert.strictEqual(elem.documentPath, '/p');
  assert.strictEqual(elem.sourceFile, 'http://h.test/p');
});

test('URL fields are reduced to origin + path; strings are truncated to 200; non-http URIs keep only their scheme', async () => {
  await postReport(chromium({
    'blocked-uri': 'https://x.test/p?deal=SECRET#f',
    'source-file': 'https://x.test/' + 'a'.repeat(500),
  }));
  await postReport(chromium({ 'blocked-uri': 'data:text/javascript;base64,QUJD' + 'A'.repeat(400), 'effective-directive': 'script-src-elem' }));
  const admin = await list('admin');
  assert.ok(!/SECRET|deal=/.test(admin.text));
  const a = admin.json.violations.find((v) => v.blockedUri === 'https://x.test/p');
  assert.ok(a, 'query + fragment dropped from blocked-uri');
  assert.strictEqual(a.sourceFile.length, 200, 'source-file truncated to 200 chars');
  assert.ok(admin.json.violations.some((v) => v.blockedUri === 'data:'), 'a data: URI is reduced to its scheme');
  for (const v of admin.json.violations) {
    for (const k of ['directive', 'blockedUri', 'sourceFile', 'documentPath']) assert.ok(v[k].length <= 200, `${k} bounded`);
  }
});

test('unknown shapes, wrong content types and malformed JSON store nothing', async () => {
  assert.strictEqual((await postReport({ nothing: 'here' })).status, 204);
  assert.strictEqual((await postReport([1, 'two', null], { type: 'application/reports+json' })).status, 204);
  assert.strictEqual((await postReport({ 'csp-report': 'not-an-object' })).status, 204);
  assert.strictEqual((await postReport(chromium(), { type: 'application/json' })).status, 415);
  assert.strictEqual((await postReport(null, { type: 'text/plain', raw: 'hi' })).status, 415);
  assert.strictEqual((await postReport(null, { raw: '{not json' })).status, 400);
  assert.strictEqual(cspReports.size(), 0);
  assert.strictEqual((await list('admin')).json.count, 0);
});

test('only POST is served on /api/csp-report: every other method reaches no handler (404)', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const res = await fetch(base + '/api/csp-report', { method });
    await res.text();
    assert.strictEqual(res.status, 404, `${method} /api/csp-report`);
  }
  assert.strictEqual(cspReports.size(), 0);
});

test('lib/cspReports normalize: both formats, bounded per request', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    type: 'csp-violation', body: { effectiveDirective: 'script-src-elem', blockedURL: `https://b${i}.test/x` },
  }));
  assert.strictEqual(cspReports.normalize('application/reports+json; charset=utf-8', many).length, 20);
  assert.deepStrictEqual(cspReports.normalize('application/csp-report', null), []);
  assert.deepStrictEqual(cspReports.normalize('text/html', chromium()), []);
});
