// AUTH-02 + AUTH-04 (D-04/D-05, D-11): every write endpoint enforces the
// caller's role via ONE consolidated ROLE_WRITE_POLICY capability check
// (T-02-06, Elevation of Privilege), and a signed-in user's identity/role is
// resolvable server-side on every request. Role is read EXCLUSIVELY from
// req.portalUser.role, itself resolved from the server-side sessions-table
// lookup (or the D-11 attributed admin-token identity) — never from a
// client-supplied header/body/cookie field the caller controls. This is the
// concrete mitigation for privilege escalation via a tampered role claim.
//
// Integration tests boot the real app (require('../server.js')) against a
// TEMP SQLite database seeded from db.json via the established
// migrate-db-json-to-sqlite.js runner (same pattern test/concurrent-write.test.js
// uses) — never the live data/ma-portal.db. Because server.js's own top-level
// `initDb()` call (no path argument) would otherwise reopen the DEFAULT
// data/ma-portal.db and silently discard our temp DB the moment server.js is
// required, db/store.js's exported `initDb` is patched (BEFORE requiring
// server.js) so a no-arg call after we've already opened our own temp path is
// a harmless no-op returning the existing connection — this does not touch
// db/store.js's source, only the in-memory export server.js destructures at
// require time.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.
// `node --test test/` does NOT work on this project's target Node version
// (v22.18.0) — it errors with "Cannot find module '.../test'".

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');

const SOURCE_PATH = path.join(__dirname, '..', 'db.json');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-role-enforcement-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const DB_PATH = tempDbPath('main');
runMigration(SOURCE_PATH, DB_PATH); // seeds admin/karen/pmo/employee-demo + full fixture data

delete require.cache[require.resolve('../db/store.js')];
delete require.cache[require.resolve('../db/sessions.js')];
delete require.cache[require.resolve('../server.js')];

const store = require('../db/store.js');
store.initDb(DB_PATH);
const sessionsDb = require('../db/sessions.js');

// Patch AFTER our own initDb(DB_PATH) call above — server.js's require of
// './db/store' resolves to this SAME cached module instance, so its
// destructured `initDb` binding picks up this wrapper, not the original.
const realInitDb = store.initDb;
store.initDb = function (p) {
  if (!p) return store.getConnection();
  return realInitDb(p);
};

// ADMIN_TOKEN is captured ONCE as a module-load-time constant inside
// server.js (`const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';`) — it must
// be set BEFORE require('../server.js') below, not inside an individual
// test(), or the D-11 test's header would be compared against an empty
// string no matter what value it sends.
const TEST_ADMIN_TOKEN = 'test-role-enforcement-admin-token-secret';
process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN;

const app = require('../server.js');
const conn = store.getConnection();

function cookieHeader(token) {
  return `ma_session=${token}`;
}

test.after(() => {
  cleanupDbFile(DB_PATH);
});

// --- AUTH-02 (unit): roleAllowedForWrite -----------------------------------

test('AUTH-02 (unit): roleAllowedForWrite enforces the coarse capability map', () => {
  assert.strictEqual(
    app.roleAllowedForWrite('employee', '/api/projects'), false,
    'employee must be rejected on a non-self-service route'
  );
  assert.strictEqual(
    app.roleAllowedForWrite('hrbp', '/api/admin/x'), false,
    'hrbp must be rejected on an admin-only route'
  );
  assert.strictEqual(
    app.roleAllowedForWrite('hrbp', '/api/projects'), true,
    'hrbp keeps its existing deal-ops write access — no regression for the default-allow tier'
  );
  assert.strictEqual(
    app.roleAllowedForWrite('employee', '/api/pulses'), true,
    'employee IS allowed on the explicit self-service allowlist'
  );
});

// --- AUTH-02 (integration): hrbp/pmo -> 403 on an admin-only write ---------

test('AUTH-02 (integration): an hrbp session writing to an /api/admin/* route gets 403', async () => {
  const token = sessionsDb.createSession(conn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody/revoke-sessions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(res.status, 403, 'hrbp writing to /api/admin/* must be rejected with 403 (role, not auth)');
  } finally {
    sessionsDb.deleteSession(conn, token);
    server.close();
  }
});

// --- AUTH-02 (integration): employee -> 403 on a non-self-service write ---

test('AUTH-02 (integration): an employee session writing to a non-self-service route gets 403', async () => {
  const token = sessionsDb.createSession(conn, { username: 'employee-demo', role: 'employee', ttlMs: 12 * 60 * 60 * 1000 });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/questions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x', dimension: 'y' }),
    });
    assert.strictEqual(res.status, 403, 'employee writing outside the self-service allowlist must be rejected with 403');
  } finally {
    sessionsDb.deleteSession(conn, token);
    server.close();
  }
});

// --- AUTH-02 (integration): employee IS allowed on the self-service allowlist ---

test('AUTH-02 (integration): an employee session IS allowed to write to a self-service route', async () => {
  const token = sessionsDb.createSession(conn, { username: 'employee-demo', role: 'employee', ttlMs: 12 * 60 * 60 * 1000 });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/pulses`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.notStrictEqual(res.status, 403, 'employee must NOT be rejected on the self-service allowlist for role reasons');
  } finally {
    sessionsDb.deleteSession(conn, token);
    server.close();
  }
});

// --- AUTH-02 (integration): admin session is never blocked for role reasons ---

test('AUTH-02 (integration): an admin session writing to an /api/admin/* route is not 403', async () => {
  const token = sessionsDb.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody/revoke-sessions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.notStrictEqual(res.status, 403, 'admin must never be rejected for role reasons — admin is allowed everywhere');
    assert.strictEqual(res.status, 200, 'the admin-only route itself must actually execute for an admin caller');
  } finally {
    sessionsDb.deleteSession(conn, token);
    server.close();
  }
});

// --- D-11: X-Admin-Token resolves to an ATTRIBUTED identity, not anonymous ---

test('D-11: an X-Admin-Token request resolves to the attributed admin-token identity and is allowed on admin routes', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody/revoke-sessions`, {
      method: 'POST',
      headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN },
    });
    assert.notStrictEqual(res.status, 401, 'a valid X-Admin-Token must not 401 — it is an attributed identity, not an anonymous bypass');
    assert.notStrictEqual(res.status, 403, 'the admin-token identity must never be rejected for role reasons (role: admin)');
    assert.strictEqual(res.status, 200, 'the route must actually execute for a valid admin-token request');
  } finally {
    server.close();
  }
});

// --- AUTH-04: identity resolution + explicit-null in open mode ------------

test('AUTH-04: a request with a valid session exposes req.portalUser.username/.role via /api/auth/me', async () => {
  const token = sessionsDb.createSession(conn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { Cookie: cookieHeader(token) },
    });
    const body = await res.json();
    assert.strictEqual(body.user.username, 'admin', 'the resolved identity must carry the correct username');
    assert.strictEqual(body.user.role, 'admin', 'the resolved identity must carry the correct role');
  } finally {
    sessionsDb.deleteSession(conn, token);
    server.close();
  }
});

test('AUTH-04: role is read exclusively server-side — a client-supplied role claim (header/body) is never honored', async () => {
  // hrbp session, but the caller ALSO tries to claim admin via a body field
  // and a custom header — neither must be able to escalate the write.
  const token = sessionsDb.createSession(conn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody/revoke-sessions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'X-Role': 'admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.strictEqual(res.status, 403, 'a client-supplied role claim must never override the server-side session role');
  } finally {
    sessionsDb.deleteSession(conn, token);
    server.close();
  }
});

test('AUTH-04 (D-02): an isOpenMode request is not gated on role/session at all (req.portalUser === null, never consulted)', async () => {
  const originalDemoOpen = process.env.DEMO_OPEN;
  process.env.DEMO_OPEN = '1';
  const server = app.listen(0);
  try {
    const { port } = server.address();
    // No cookie, no X-Admin-Token at all — under DEMO_OPEN the gate sets
    // req.portalUser = null and returns next() BEFORE the role check ever
    // runs, so even a write route must not 401 or 403 here.
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody/revoke-sessions`, { method: 'POST' });
    assert.notStrictEqual(res.status, 401, 'DEMO_OPEN must bypass the session requirement entirely');
    assert.notStrictEqual(res.status, 403, 'DEMO_OPEN must bypass the role check entirely (req.portalUser is null, not consulted)');
    assert.strictEqual(res.status, 200, 'the route must actually execute under DEMO_OPEN with no session at all');
  } finally {
    if (originalDemoOpen === undefined) delete process.env.DEMO_OPEN;
    else process.env.DEMO_OPEN = originalDemoOpen;
    server.close();
  }
});
