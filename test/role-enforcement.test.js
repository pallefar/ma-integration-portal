// AUTH-02 + AUTH-04 (D-04/D-05, D-11): every write endpoint enforces the
// caller's role via ONE consolidated ROLE_WRITE_POLICY capability check
// (T-02-06, Elevation of Privilege), and a signed-in user's identity/role is
// resolvable server-side on every request. Role is read EXCLUSIVELY from
// req.portalUser.role, itself resolved from the server-side sessions-table
// lookup (or the D-11 attributed admin-token identity) — never from a
// client-supplied header/body/cookie field the caller controls. This is the
// concrete mitigation for privilege escalation via a tampered role claim.
//
// ISO-01 (Phase 3): the live app now reads/writes exclusively through
// control.db/runtime.db/demo.db (db/dbFiles.js), never a single legacy file.
// This test boots the REAL requireable app (`require('../server.js')`)
// against an ISOLATED temp trio of those three files — never the live,
// committed data/control.db etc — by setting the MA_CONTROL_DB_PATH /
// MA_RUNTIME_DB_PATH / MA_DEMO_DB_PATH / MA_DEALS_DIR env var overrides
// (db/dbFiles.js) BEFORE requiring ANY module that resolves one of those
// path constants at require time. The temp trio itself is produced by the
// SAME re-runnable split scripts/split-db-into-control-demo-deals.js already
// uses in production, seeded from db.json via the established
// migrate-db-json-to-sqlite.js runner (same fixture test/concurrent-write.test.js
// uses) — this reuses tested infrastructure rather than hand-rolling a
// second seeding path.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.
// `node --test test/` does NOT work on this project's target Node version
// (v22.18.0) — it errors with "Cannot find module '.../test'".

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-role-enforcement-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-role-enforcement-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH); // seeds the full non-account fixture data, single-file legacy shape (`users` is no longer part of db/collections.js's ARRAY_COLLECTIONS as of Phase 3 Task 2 — see below)

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR }); // fans out to TMP_DIR/{control,demo,runtime}.db — the exact paths the env overrides above point to

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Phase 3 Task 2: accounts are a control.db-native table reached only
// through db/controlStore.js — they are no longer part of ARRAY_COLLECTIONS,
// so neither runMigration() nor runSplit() above touches them anymore (by
// design, see db/collections.js). Seed control.db's `users` table directly
// from db.json's own `users` array (real salt/hash pairs, the exact fixture
// every other test in this suite already trusts) so login-adjacent
// assertions (WR-01/WR-02) have real accounts to authenticate against.
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

// ADMIN_TOKEN is captured ONCE as a module-load-time constant inside
// server.js (`const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';`) — it must
// be set BEFORE require('../server.js') below, not inside an individual
// test(), or the D-11 test's header would be compared against an empty
// string no matter what value it sends.
const TEST_ADMIN_TOKEN = 'test-role-enforcement-admin-token-secret';
process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN;

const app = require('../server.js');

function cookieHeader(token) {
  return `ma_session=${token}`;
}

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
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
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody/revoke-sessions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(res.status, 403, 'hrbp writing to /api/admin/* must be rejected with 403 (role, not auth)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// --- AUTH-02 (integration): employee -> 403 on a non-self-service write ---

test('AUTH-02 (integration): an employee session writing to a non-self-service route gets 403', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'employee-demo', role: 'employee', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/questions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'x', dimension: 'y' }),
    });
    assert.strictEqual(res.status, 403, 'employee writing outside the self-service allowlist must be rejected with 403');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// --- AUTH-02 (integration): employee IS allowed on the self-service allowlist ---

test('AUTH-02 (integration): an employee session IS allowed to write to a self-service route', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'employee-demo', role: 'employee', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/pulses`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.notStrictEqual(res.status, 403, 'employee must NOT be rejected on the self-service allowlist for role reasons');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// --- AUTH-02 (integration): admin session is never blocked for role reasons ---

test('AUTH-02 (integration): an admin session writing to an /api/admin/* route is not 403', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody/revoke-sessions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.notStrictEqual(res.status, 403, 'admin must never be rejected for role reasons — admin is allowed everywhere');
    assert.strictEqual(res.status, 200, 'the admin-only route itself must actually execute for an admin caller');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// --- D-11: X-Admin-Token resolves to an ATTRIBUTED identity, not anonymous ---

test('D-11: an X-Admin-Token request resolves to the attributed admin-token identity and is allowed on admin routes', async () => {
  const server = await listenLocal(app);
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
  const token = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`, {
      headers: { Cookie: cookieHeader(token) },
    });
    const body = await res.json();
    assert.strictEqual(body.user.username, 'admin', 'the resolved identity must carry the correct username');
    assert.strictEqual(body.user.role, 'admin', 'the resolved identity must carry the correct role');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('AUTH-04: role is read exclusively server-side — a client-supplied role claim (header/body) is never honored', async () => {
  // hrbp session, but the caller ALSO tries to claim admin via a body field
  // and a custom header — neither must be able to escalate the write.
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody/revoke-sessions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'X-Role': 'admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin' }),
    });
    assert.strictEqual(res.status, 403, 'a client-supplied role claim must never override the server-side session role');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// --- CR-01: employee must NOT be able to DELETE assessments/instances -----

test('CR-01 (unit): roleAllowedForWrite rejects employee on DELETE /api/assessments/:id and /api/assessment-instances/:id, but allows the POST self-service routes', () => {
  assert.strictEqual(
    app.roleAllowedForWrite('employee', '/api/assessments/xyz', 'DELETE'), false,
    'employee must be rejected on DELETE /api/assessments/:id (admin cleanup, plural CRUD route)'
  );
  assert.strictEqual(
    app.roleAllowedForWrite('employee', '/api/assessment-instances/xyz', 'DELETE'), false,
    'employee must be rejected on DELETE /api/assessment-instances/:id (admin cleanup per its own inline comment)'
  );
  assert.strictEqual(
    app.roleAllowedForWrite('employee', '/api/assessment', 'POST'), true,
    'employee must still be allowed to POST /api/assessment (own submission) — no regression'
  );
  assert.strictEqual(
    app.roleAllowedForWrite('employee', '/api/assessment-instances', 'POST'), true,
    'employee must still be allowed to POST /api/assessment-instances (self-submission) — no regression'
  );
  assert.strictEqual(
    app.roleAllowedForWrite('admin', '/api/assessments/xyz', 'DELETE'), true,
    'admin must still be allowed to DELETE /api/assessments/:id — no regression for the intended cleanup role'
  );
});

test('CR-01 (integration): an employee session gets 403 on DELETE /api/assessments/:id', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'employee-demo', role: 'employee', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/assessments/does-not-exist`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(res.status, 403, 'employee DELETE on /api/assessments/:id must be rejected with 403 (role), not fall through to the handler');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('CR-01 (integration): an employee session gets 403 on DELETE /api/assessment-instances/:id', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'employee-demo', role: 'employee', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/assessment-instances/does-not-exist`, {
      method: 'DELETE',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(res.status, 403, 'employee DELETE on /api/assessment-instances/:id must be rejected with 403 (role), not fall through to the handler');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// --- CR-02: a non-admin session must NOT be able to GET /api/admin/* ------

test('CR-02 (integration): a non-admin (employee) session gets 403 on GET /api/admin/download-zip', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'employee-demo', role: 'employee', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/download-zip`, {
      method: 'GET',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(res.status, 403, 'a non-admin session must be rejected with 403 on GET /api/admin/download-zip, not allowed through on session-existence alone');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('CR-02 (integration): an hrbp session also gets 403 on GET /api/admin/download-zip (admin-only read, not just admin-only write)', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/download-zip`, {
      method: 'GET',
      headers: { Cookie: cookieHeader(token) },
    });
    assert.strictEqual(res.status, 403, 'hrbp must be rejected with 403 on GET /api/admin/download-zip — /api/admin/* requires admin for ALL methods, reads included');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

// --- WR-01: change-password must revoke this user's OTHER outstanding sessions ---

test('WR-01 (integration): a successful password change revokes the caller\'s prior sessions and issues a fresh one', async () => {
  // Seeded fixture password (see 02-CONTEXT.md D-10) — shared demo credential.
  const DEMO_PASSWORD = 'TEdemo!2026';
  const oldToken = sessionsDb.createSession(runtimeConn, { username: 'pmo', role: 'pmo', ttlMs: 12 * 60 * 60 * 1000 });
  const callerToken = sessionsDb.createSession(runtimeConn, { username: 'pmo', role: 'pmo', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/change-password`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(callerToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: DEMO_PASSWORD, newPassword: DEMO_PASSWORD }),
    });
    assert.strictEqual(res.status, 200, 'the password change itself must succeed for the correct current password');

    assert.strictEqual(
      sessionsDb.findSession(runtimeConn, oldToken), null,
      'a DIFFERENT prior session for this user must be revoked by a successful password change (WR-01)'
    );

    const setCookieHeader = res.headers.get('set-cookie') || '';
    const newTokenMatch = setCookieHeader.match(/ma_session=([^;]+)/);
    assert.ok(newTokenMatch, 'change-password must issue a fresh session cookie for the current caller');
    assert.ok(
      sessionsDb.findSession(runtimeConn, newTokenMatch[1]),
      'the freshly issued session for the CURRENT caller must be valid — the caller is not logged out by their own change'
    );
  } finally {
    sessionsDb.deleteSession(runtimeConn, oldToken);
    server.close();
  }
});

// --- WR-02: change-password must throttle repeated attempts like login ----

test('WR-02 (integration): repeated change-password attempts are throttled (429) after 8 tries/minute, mirroring /api/auth/login', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    let lastStatus = null;
    for (let i = 0; i < 9; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/change-password`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: 'definitely-wrong', newPassword: 'irrelevant-value' }),
      });
      lastStatus = res.status;
    }
    assert.strictEqual(lastStatus, 429, 'the 9th attempt within a minute must be throttled (429), mirroring the login throttle');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('AUTH-04 (D-02): an isOpenMode request is not gated on role/session at all (req.portalUser === null, never consulted)', async () => {
  const originalDemoOpen = process.env.DEMO_OPEN;
  process.env.DEMO_OPEN = '1';
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    // No cookie, no X-Admin-Token at all — under DEMO_OPEN an unbound
    // request always resolves to demo.db (D-01), so the gate sets
    // req.portalUser = null and returns next() BEFORE the role check ever
    // runs, so even a write route must not 401 or 403 here.
    //
    // WR-03: /api/admin/users/:username/revoke-sessions is now a
    // CONTROL_PLANE_PATH (resolves to control.db, never demo.db regardless
    // of DEMO_OPEN — mirroring the existing /api/admin/audit precedent), so
    // it is no longer a valid probe for "DEMO_OPEN resolves to demo and
    // bypasses auth" — use /api/admin/migrate-db instead, an ordinary
    // (non-control-plane) admin write route. A valid body is required since
    // CR-02's fix means validationMiddleware now runs even under DEMO_OPEN.
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/migrate-db`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'postgres' }),
    });
    assert.notStrictEqual(res.status, 401, 'DEMO_OPEN must bypass the session requirement entirely');
    assert.notStrictEqual(res.status, 403, 'DEMO_OPEN must bypass the role check entirely (req.portalUser is null, not consulted)');
    assert.strictEqual(res.status, 200, 'the route must actually execute under DEMO_OPEN with no session at all');
  } finally {
    if (originalDemoOpen === undefined) delete process.env.DEMO_OPEN;
    else process.env.DEMO_OPEN = originalDemoOpen;
    server.close();
  }
});
