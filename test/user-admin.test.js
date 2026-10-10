// ACCT-01 / COLLAB-02 (Phase 10, plan 03): admin user management and the
// per-request identity re-read.
//
// Boots the REAL app in dev mode against an ISOLATED temp control/runtime/
// demo/audit set (MA_* overrides, set BEFORE server.js is required). The temp
// control.db is a copy of the committed one — it carries exactly one admin
// ('admin'), which makes the last-admin guard cases deterministic. The
// committed data/*.db files are never opened.
//
// Throttle note: /api/auth/login allows 8 attempts per minute per source IP and
// this file runs in ONE process, so interactive logins are kept to a minimum —
// every identity that does not need to prove the login path uses a session
// created directly on runtime.db (test/helpers/seed-identity.js).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-user-admin-'));
fs.copyFileSync(path.join(REPO, 'data', 'control.db'), path.join(TMP, 'control.db'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const { sessionAs } = require('./helpers/seed-identity.js');
const app = require('../server.js');

const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

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

function cookieOf(token) { return 'ma_session=' + token; }
function adminCookie() {
  return cookieOf(sessionAs(runtimeConn, controlConn, { username: 'admin', role: 'admin' }));
}
async function api(method, route, { cookie, body } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, json, headers: res.headers };
}
function sessionCookieFrom(res) {
  const raw = res.headers.get('set-cookie') || '';
  const m = raw.match(/ma_session=([^;]+)/);
  return m ? 'ma_session=' + m[1] : null;
}

// --- Task 1 tracer: create -> temp-password login -> role change, same cookie ---

test('tracer: admin creates a user, the user signs in with the temp password, a role change binds on the next request with the same cookie', async () => {
  const admin = adminCookie();

  const created = await api('POST', '/api/admin/users', {
    cookie: admin, body: { username: 'alice', name: 'Alice Example', role: 'pmo' },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  assert.strictEqual(created.headers.get('cache-control'), 'no-store');
  assert.strictEqual(created.json.user.username, 'alice');
  assert.strictEqual(created.json.user.role, 'pmo');
  assert.strictEqual(created.json.user.mustChangePassword, true);
  assert.strictEqual(typeof created.json.tempPassword, 'string');
  assert.ok(created.json.tempPassword.length >= 12);

  const login = await api('POST', '/api/auth/login', {
    body: { username: 'alice', password: created.json.tempPassword },
  });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  const aliceCookie = sessionCookieFrom({ headers: login.headers });
  assert.ok(aliceCookie, 'login must set the session cookie');

  let me = await api('GET', '/api/auth/me', { cookie: aliceCookie });
  assert.strictEqual(me.json.user.role, 'pmo');

  // pmo may write a default-tier route: anything but the role-gate 403.
  let write = await api('POST', '/api/raid', { cookie: aliceCookie, body: {} });
  assert.notStrictEqual(write.status, 403, 'pmo must pass the role gate');

  const patched = await api('PATCH', '/api/admin/users/alice', { cookie: admin, body: { role: 'employee' } });
  assert.strictEqual(patched.status, 200, JSON.stringify(patched.json));
  assert.strictEqual(patched.json.user.role, 'employee');

  // Same cookie, no re-login: the new role binds immediately (COLLAB-02).
  write = await api('POST', '/api/raid', { cookie: aliceCookie, body: {} });
  assert.strictEqual(write.status, 403, 'the demoted user must be refused on its very next request');
  me = await api('GET', '/api/auth/me', { cookie: aliceCookie });
  assert.strictEqual(me.json.user.role, 'employee');
});

test('account surfaces are never open under DEMO_OPEN=1 and need the admin role', async () => {
  process.env.DEMO_OPEN = '1';
  try {
    for (const [method, route, body] of [
      ['GET', '/api/admin/users'],
      ['POST', '/api/admin/users', { username: 'mallory', name: 'Mallory', role: 'admin' }],
      ['PATCH', '/api/admin/users/admin', { role: 'employee' }],
    ]) {
      const res = await api(method, route, { body });
      assert.strictEqual(res.status, 401, `${method} ${route} must 401 anonymously even with DEMO_OPEN=1`);
    }
  } finally {
    delete process.env.DEMO_OPEN;
  }
  const emp = cookieOf(sessionAs(runtimeConn, controlConn, { username: 'emp-gate', role: 'employee' }));
  const res = await api('POST', '/api/admin/users', {
    cookie: emp, body: { username: 'mallory', name: 'Mallory', role: 'admin' },
  });
  assert.strictEqual(res.status, 403);
});
