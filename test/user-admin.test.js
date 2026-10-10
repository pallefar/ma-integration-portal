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
const { spawnSync } = require('child_process');
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

const BODIES = []; // every parsed JSON response body, deep-scanned for secrets at the end
const TEMP_PASSWORDS = []; // every temp password this file ever received

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
  if (json !== null) BODIES.push({ method, route, json });
  if (json && typeof json.tempPassword === 'string') TEMP_PASSWORDS.push(json.tempPassword);
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

// --- Task 2: list, reset, disable/enable, last-admin guard, audit, no secrets ---

async function createUser(admin, username, role, extra) {
  const res = await api('POST', '/api/admin/users', {
    cookie: admin, body: { username, name: username + ' name', role, ...(extra || {}) },
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.json));
  return res.json;
}
function userSessionCount(username) {
  return runtimeConn.prepare('SELECT COUNT(*) AS n FROM sessions WHERE username = ?').get(username).n;
}
function storedHash(username) {
  return JSON.parse(controlConn.prepare('SELECT data FROM users WHERE id = ?').get(username).data).hash;
}

test('GET /api/admin/users: admin gets the sorted allowlisted list; other roles 403', async () => {
  const admin = adminCookie();
  await createUser(admin, 'zed', 'employee');
  const list = await api('GET', '/api/admin/users', { cookie: admin });
  assert.strictEqual(list.status, 200);
  assert.ok(Array.isArray(list.json));
  const names = list.json.map((u) => u.username);
  assert.deepStrictEqual(names, [...names].sort());
  for (const u of list.json) {
    assert.deepStrictEqual(
      Object.keys(u).sort(),
      ['createdAt', 'createdBy', 'disabled', 'lastLoginAt', 'mustChangePassword', 'name', 'role', 'username']
    );
  }
  const alice = list.json.find((u) => u.username === 'alice');
  assert.ok(alice.lastLoginAt, 'alice signed in during the tracer, last sign-in must be listed');
  assert.strictEqual(list.json.find((u) => u.username === 'zed').lastLoginAt, null);

  for (const role of ['hrbp', 'pmo', 'employee']) {
    const cookie = cookieOf(sessionAs(runtimeConn, controlConn, { username: `list-${role}`, role }));
    assert.strictEqual((await api('GET', '/api/admin/users', { cookie })).status, 403, role);
  }
});

test('last sign-in is kept in runtime.db account_logins, never in control.db', () => {
  const row = runtimeConn.prepare('SELECT * FROM account_logins WHERE username = ?').get('alice');
  assert.ok(row && row.last_login_at);
  const blob = JSON.parse(controlConn.prepare('SELECT data FROM users WHERE id = ?').get('alice').data);
  assert.ok(!('lastLoginAt' in blob) && !('last_login_at' in blob), 'control.db account blob must not carry a login stamp');
});

test('reset-password: one-time temp password, old password dead, sessions revoked, mustChangePassword', async () => {
  const admin = adminCookie();
  await createUser(admin, 'rita', 'hrbp', { tempPassword: 'initial-Passw0rd' });
  const first = await api('POST', '/api/auth/login', { body: { username: 'rita', password: 'initial-Passw0rd' } });
  assert.strictEqual(first.status, 200);
  const ritaCookie = sessionCookieFrom({ headers: first.headers });
  assert.ok(userSessionCount('rita') >= 1);
  const hashBefore = storedHash('rita');

  const reset = await api('POST', '/api/admin/users/rita/reset-password', { cookie: admin, body: {} });
  assert.strictEqual(reset.status, 200, JSON.stringify(reset.json));
  assert.strictEqual(reset.headers.get('cache-control'), 'no-store');
  assert.strictEqual(typeof reset.json.tempPassword, 'string');
  assert.strictEqual(reset.json.user.mustChangePassword, true);
  assert.notStrictEqual(storedHash('rita'), hashBefore);
  assert.strictEqual(userSessionCount('rita'), 0, 'every target session is deleted');
  assert.strictEqual((await api('GET', '/api/auth/me', { cookie: ritaCookie })).json.user, null);

  const old = await api('POST', '/api/auth/login', { body: { username: 'rita', password: 'initial-Passw0rd' } });
  assert.strictEqual(old.status, 401);
  const fresh = await api('POST', '/api/auth/login', { body: { username: 'rita', password: reset.json.tempPassword } });
  assert.strictEqual(fresh.status, 200);
  assert.strictEqual(fresh.json.mustChangePassword, true);

  assert.strictEqual((await api('POST', '/api/admin/users/nobody-here/reset-password', { cookie: admin, body: {} })).status, 404);
});

test('disable: the live cookie 401s on its next request, sessions are gone, re-enable needs a fresh sign-in', async () => {
  const admin = adminCookie();
  await createUser(admin, 'dora', 'pmo');
  const doraCookie = cookieOf(sessionAs(runtimeConn, controlConn, { username: 'dora', role: 'pmo' }));
  assert.strictEqual((await api('GET', '/api/auth/me', { cookie: doraCookie })).json.user.username, 'dora');
  assert.strictEqual((await api('GET', '/api/menus', { cookie: doraCookie })).status, 200);

  const off = await api('PATCH', '/api/admin/users/dora', { cookie: admin, body: { disabled: true } });
  assert.strictEqual(off.status, 200);
  assert.strictEqual(off.json.user.disabled, true);
  assert.strictEqual(userSessionCount('dora'), 0);
  const denied = await api('GET', '/api/menus', { cookie: doraCookie });
  assert.strictEqual(denied.status, 401);
  assert.strictEqual(denied.json.authRequired, true);

  const on = await api('PATCH', '/api/admin/users/dora', { cookie: admin, body: { disabled: false } });
  assert.strictEqual(on.status, 200);
  assert.strictEqual((await api('GET', '/api/menus', { cookie: doraCookie })).status, 401, 're-enable does not revive old sessions');
});

test('last-admin guard: sole admin cannot demote or disable itself; with a second admin demotion works', async () => {
  const admin = adminCookie();
  const demote = await api('PATCH', '/api/admin/users/admin', { cookie: admin, body: { role: 'pmo' } });
  assert.strictEqual(demote.status, 409);
  assert.strictEqual(demote.json.lastAdmin, true);
  const disable = await api('PATCH', '/api/admin/users/admin', { cookie: admin, body: { disabled: true } });
  assert.strictEqual(disable.status, 409);
  assert.strictEqual(JSON.parse(controlConn.prepare('SELECT data FROM users WHERE id = ?').get('admin').data).role, 'admin');

  await createUser(admin, 'boss2', 'admin');
  const boss2 = cookieOf(sessionAs(runtimeConn, controlConn, { username: 'boss2', role: 'admin' }));
  // Nobody may disable their own account, even with a second admin present.
  const selfOff = await api('PATCH', '/api/admin/users/boss2', { cookie: boss2, body: { disabled: true } });
  assert.strictEqual(selfOff.status, 409);
  assert.match(selfOff.json.error, /own account/);
  assert.notStrictEqual(selfOff.json.lastAdmin, true);

  // With a second enabled admin, demoting the first is fine ...
  const demoteFirst = await api('PATCH', '/api/admin/users/admin', { cookie: boss2, body: { role: 'pmo' } });
  assert.strictEqual(demoteFirst.status, 200, JSON.stringify(demoteFirst.json));
  // ... and now boss2 is the last enabled admin, so the guard holds for it.
  const guarded = await api('PATCH', '/api/admin/users/boss2', { cookie: boss2, body: { role: 'pmo' } });
  assert.strictEqual(guarded.status, 409);
  assert.strictEqual(guarded.json.lastAdmin, true);
  // restore the first admin for the rest of the file
  assert.strictEqual((await api('PATCH', '/api/admin/users/admin', { cookie: boss2, body: { role: 'admin' } })).status, 200);
});

test('PATCH is not a mass-assignment surface: hash/salt/mustChangePassword/username in the body are stripped', async () => {
  const admin = adminCookie();
  await createUser(admin, 'mallory-t', 'employee');
  const hashBefore = storedHash('mallory-t');
  const res = await api('PATCH', '/api/admin/users/mallory-t', {
    cookie: admin,
    body: { hash: 'x', salt: 'y', mustChangePassword: false, username: 'evil', createdBy: 'nobody', role: 'hrbp' },
  });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.user.role, 'hrbp');
  assert.strictEqual(res.json.user.username, 'mallory-t');
  assert.strictEqual(res.json.user.mustChangePassword, true);
  assert.strictEqual(storedHash('mallory-t'), hashBefore, 'stored hash must be byte-identical');
  assert.strictEqual(controlConn.prepare('SELECT 1 FROM users WHERE id = ?').all('evil').length, 0);
  const stored = JSON.parse(controlConn.prepare('SELECT data FROM users WHERE id = ?').get('mallory-t').data);
  assert.strictEqual(stored.createdBy, 'admin');
  assert.strictEqual((await api('PATCH', '/api/admin/users/mallory-t', { cookie: admin, body: {} })).status, 400);
});

test('username validation and duplicates', async () => {
  const admin = adminCookie();
  for (const bad of ['ab', 'A b', '../x', 'admin-token', 'system', 'has:colon', 'x'.repeat(41)]) {
    const res = await api('POST', '/api/admin/users', { cookie: admin, body: { username: bad, name: 'N', role: 'pmo' } });
    assert.strictEqual(res.status, 400, `username ${JSON.stringify(bad)} must be refused`);
  }
  const dup = await api('POST', '/api/admin/users', { cookie: admin, body: { username: 'alice', name: 'Again', role: 'pmo' } });
  assert.strictEqual(dup.status, 409);
  // uppercase input is folded, so it collides with the existing account
  const folded = await api('POST', '/api/admin/users', { cookie: admin, body: { username: 'ALICE', name: 'Again', role: 'pmo' } });
  assert.strictEqual(folded.status, 409);
  const badRole = await api('POST', '/api/admin/users', { cookie: admin, body: { username: 'carol', name: 'C', role: 'root' } });
  assert.strictEqual(badRole.status, 400);
  assert.strictEqual((await api('PATCH', '/api/admin/users/ghost-user', { cookie: admin, body: { role: 'pmo' } })).status, 404);
});

test('temp password policy: real mode requires 12 characters and refuses the published demo password', () => {
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) {
    if (key.startsWith('MA_') || key === 'DEMO_OPEN' || key === 'ADMIN_TOKEN') delete clean[key];
  }
  const dataDir = path.join(TMP, 'real-policy', 'data');
  const script = `
    const app = require('./server.js');
    const store = require('./db/store');
    const dbFiles = require('./db/dbFiles');
    const sessions = require('./db/sessions');
    const controlStore = require('./db/controlStore');
    const passwords = require('./lib/passwords');
    (async () => {
      controlStore.createAccount({ username: 'root', name: 'Root', role: 'admin', hash: await passwords.hashPassword('long-enough-password-1'), disabled: false, mustChangePassword: false });
      const conn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
      const token = sessions.createSession(conn, { username: 'root', role: 'admin', ttlMs: 600000 });
      const server = app.listen(0, '127.0.0.1', async () => {
        const base = 'http://127.0.0.1:' + server.address().port;
        const out = {};
        const post = async (label, tempPassword) => {
          const res = await fetch(base + '/api/admin/users', {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie: 'ma_session=' + token },
            body: JSON.stringify({ username: label, name: label, role: 'pmo', tempPassword }),
          });
          out[label] = res.status;
        };
        await post('short', 'only-11-chr');
        await post('demopw', 'TEdemo!2026');
        await post('okpw', 'twelve-chars-ok');
        process.stdout.write('RESULT ' + JSON.stringify(out) + '\\n');
        server.close();
        process.exit(0);
      });
    })();
  `;
  const res = spawnSync(process.execPath, ['-e', script], {
    cwd: REPO, encoding: 'utf8', timeout: 60000,
    env: { ...clean, MA_MODE: 'real', MA_DATA_DIR: dataDir },
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const line = res.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, res.stdout + res.stderr);
  assert.deepStrictEqual(JSON.parse(line.slice(7)), { short: 400, demopw: 400, okpw: 201 });
});

test('audit: user-create/user-update/user-password-reset rows exist with the admin as actor and carry no secret', () => {
  const auditHook = require('../db/auditHook.js');
  const rows = auditHook.queryAudit({ actor: 'admin', limit: 500 });
  for (const action of ['user-create', 'user-update', 'user-password-reset']) {
    assert.ok(rows.some((r) => r.action === action), `expected a ${action} audit row`);
  }
  const accountRows = rows.filter((r) => ['user-create', 'user-update', 'user-password-reset'].includes(r.action));
  const hashes = controlConn.prepare('SELECT data FROM users').all().map((r) => JSON.parse(r.data).hash).filter(Boolean);
  for (const row of accountRows) {
    const text = JSON.stringify(row);
    assert.ok(!/"hash"|"salt"|tempPassword/i.test(text), `audit row ${row.action} must not carry hash/salt/tempPassword keys`);
    for (const secret of [...hashes, ...TEMP_PASSWORDS]) {
      assert.ok(!text.includes(secret), `audit row ${row.action} must not contain a secret value`);
    }
    if (row.after_json) {
      assert.ok(Object.keys(JSON.parse(row.after_json)).every((k) =>
        ['username', 'name', 'role', 'disabled', 'mustChangePassword'].includes(k)), 'after_json must be the allowlisted projection');
    }
  }
});

function walk(value, visit) {
  if (Array.isArray(value)) { value.forEach((v) => walk(v, visit)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { visit(k, v); walk(v, visit); }
  }
}

test('no response body ever carries a hash/salt key or a stored hash value', () => {
  assert.ok(BODIES.length > 10, 'the scan must have something to scan');
  const hashes = controlConn.prepare('SELECT data FROM users').all().map((r) => JSON.parse(r.data).hash).filter(Boolean);
  assert.ok(hashes.length >= 3);
  for (const { method, route, json } of BODIES) {
    walk(json, (key) => {
      assert.ok(key !== 'hash' && key !== 'salt', `${method} ${route} response carries a '${key}' key`);
    });
    const text = JSON.stringify(json);
    for (const h of hashes) assert.ok(!text.includes(h), `${method} ${route} response contains a stored hash value`);
  }
});
