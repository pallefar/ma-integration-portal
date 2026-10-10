// ACCT-04 / D-10-05 (Phase 10, plan 05, Task 1 tracer): a session whose account
// still carries mustChangePassword is fenced to /api/auth/me, /api/auth/logout
// and /api/auth/change-password until the password is replaced. The client
// redirect (plan 10-06) is UX; this server gate is the control.
//
// Boots the REAL app in dev mode against an ISOLATED temp control/runtime/demo/
// audit set (MA_* overrides, set BEFORE server.js is required). The committed
// data/*.db files are never opened.
//
// Throttle note: this file performs three interactive logins, well under the
// per-source budget; the admin identity is a directly-created session.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const REPO = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-forced-rotation-'));
fs.copyFileSync(path.join(REPO, 'data', 'control.db'), path.join(TMP, 'control.db'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'TRUST_PROXY']) delete process.env[key];

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

test('tracer: a temp-password session is fenced to me/logout/change-password until it rotates', async () => {
  const admin = 'ma_session=' + sessionAs(runtimeConn, controlConn, { username: 'admin', role: 'admin' });

  const created = await api('POST', '/api/admin/users', {
    cookie: admin, body: { username: 'rotator', name: 'Rota Tor', role: 'pmo' },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.json));
  const temp = created.json.tempPassword;
  assert.strictEqual(typeof temp, 'string');

  // Sign in with the temp password: login itself succeeds and says so.
  const login = await api('POST', '/api/auth/login', { body: { username: 'rotator', password: temp } });
  assert.strictEqual(login.status, 200, JSON.stringify(login.json));
  assert.strictEqual(login.json.mustChangePassword, true);
  const fenced = sessionCookieFrom(login);
  assert.ok(fenced, 'login must set a session cookie');

  // Every other gated /api request is refused with the marker.
  for (const [method, route] of [['GET', '/api/raid'], ['GET', '/api/auth/sessions'], ['POST', '/api/raid']]) {
    const res = await api(method, route, { cookie: fenced, body: method === 'POST' ? {} : undefined });
    assert.strictEqual(res.status, 403, `${method} ${route} must be fenced`);
    assert.strictEqual(res.json.mustChangePassword, true, `${method} ${route} must carry the marker`);
  }

  // /api/auth/me stays reachable and reports the flag.
  const me = await api('GET', '/api/auth/me', { cookie: fenced });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.json.user.mustChangePassword, true);

  // Logout is allowed.
  const out = await api('POST', '/api/auth/logout', { cookie: fenced });
  assert.strictEqual(out.status, 200);

  // Sign in again and rotate.
  const login2 = await api('POST', '/api/auth/login', { body: { username: 'rotator', password: temp } });
  assert.strictEqual(login2.status, 200, JSON.stringify(login2.json));
  const cookie2 = sessionCookieFrom(login2);
  const newPassword = 'rotated-Passphrase-42';
  const changed = await api('POST', '/api/auth/change-password', {
    cookie: cookie2, body: { currentPassword: temp, newPassword },
  });
  assert.strictEqual(changed.status, 200, JSON.stringify(changed.json));
  const fresh = sessionCookieFrom(changed);
  assert.ok(fresh, 'change-password must re-issue a session cookie');

  // The fresh session is no longer fenced.
  const raid = await api('GET', '/api/raid', { cookie: fresh });
  assert.notStrictEqual(raid.status, 403, JSON.stringify(raid.json));
  const me2 = await api('GET', '/api/auth/me', { cookie: fresh });
  assert.strictEqual(me2.json.user.mustChangePassword, false);

  // The old (pre-rotation) cookie was revoked with the other sessions.
  const stale = await api('GET', '/api/raid', { cookie: cookie2 });
  assert.strictEqual(stale.status, 401);
});

test('an ordinary session (no mustChangePassword) is never fenced', async () => {
  const emp = 'ma_session=' + sessionAs(runtimeConn, controlConn, { username: 'plain-emp', role: 'employee' });
  const res = await api('GET', '/api/raid', { cookie: emp });
  assert.notStrictEqual(res.status, 403, JSON.stringify(res.json));
});
