// AUD-01 / AUD-02 / D-08 / D-10: proves every control-plane security event
// D-08 names produces exactly one attributed audit row (deal create/archive/
// delete/membership-change, a password change, an admin session-revoke, and
// every break-glass X-Admin-Token use), that the admin-only audit viewer
// (GET /api/admin/audit) is refused for every non-admin role and its three
// filters (deal/user/date-range) each narrow results correctly, that no
// registered route under the audit path accepts a method that could modify
// or remove a row, and that the append-only triggers from Plan 03-01 are
// live in the RUNNING system (not just present in the schema file).
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// isolated temp control/runtime/demo/deals/audit file set, mirroring
// test/deal-resolver.test.js's own pattern — this suite's proofs are about
// route-level HTTP behavior (status codes, filter wiring), not the storage
// layer directly (that is test/audit-log.test.js's job).
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test test/audit-security-events.test.js` (or `npm test`).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-audit-security-events-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
// A break-glass token this suite's own case (b) exercises — never the real,
// live-deployment secret.
const TEST_ADMIN_TOKEN = 'gsd-test-break-glass-token-' + crypto.randomBytes(8).toString('hex');
process.env.ADMIN_TOKEN = TEST_ADMIN_TOKEN;

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const controlStore = require('../db/controlStore.js');
const sessionsDb = require('../db/sessions.js');
const auditHook = require('../db/auditHook.js');

// server.js's own module-level startup opens control.db/runtime.db/demo.db
// via the SAME dbFiles path constants above (which is why the env overrides
// are set BEFORE this require) — no manual pre-creation needed.
const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (accounts are control.db-native as of Phase 3
// Task 2 — no migration/split needed for this suite's purposes, matching
// test/deal-resolver.test.js's identical seeding rationale).
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

function cookieHeader(token) { return `ma_session=${token}`; }

/** Overwrite a seeded account's password with a KNOWN plaintext value, using
 * the exact scrypt+salt scheme server.js's own hashPassword() uses — lets
 * case (a) exercise the real POST /api/auth/change-password route
 * deterministically instead of guessing a fixture's real plaintext. */
function setKnownPassword(username, plaintext) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plaintext), Buffer.from(salt, 'hex'), 32).toString('hex');
  controlStore.updateUser(username, { salt, hash });
}

function listApiRoutes(expressApp) {
  const out = [];
  const stack = (expressApp._router && expressApp._router.stack) || [];
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).filter((m) => layer.route.methods[m]);
      for (const m of methods) {
        if (layer.route.path.startsWith('/api')) {
          out.push({ method: m.toUpperCase(), path: layer.route.path });
        }
      }
    }
  }
  return out;
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('audit-security-events (a): each D-08 control-plane action produces exactly one audit row with the expected action name and subject', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    // --- password-change (self-service, still a D-08 event) ---
    setKnownPassword('karen', 'OldPassw0rd1!');
    const karenToken = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
    const pwRes = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'OldPassw0rd1!', newPassword: 'NewPassw0rd1!' }),
    });
    assert.strictEqual(pwRes.status, 200, 'password-change must succeed with the correct current password');
    const pwRows = auditHook.queryAudit({ actor: 'karen', limit: 500 }).filter((r) => r.action === 'password-change');
    assert.strictEqual(pwRows.length, 1, 'exactly one password-change audit row must exist for karen');
    assert.strictEqual(pwRows[0].row_id, 'karen');

    // --- deal-create (admin + hrbp per D-02; used here as admin) ---
    const adminToken = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Audit Sec Deal', targetCompany: 'Sec Co', members: ['karen'] }),
    });
    assert.strictEqual(createRes.status, 200);
    const { deal } = await createRes.json();
    const createRows = auditHook.queryAudit({ dealId: deal.id }).filter((r) => r.action === 'deal-create');
    assert.strictEqual(createRows.length, 1);
    assert.strictEqual(createRows[0].row_id, deal.id);

    // --- deal-members-update (admin-only) ---
    const membersRes = await fetch(`${base}/api/deals/${deal.id}/members`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: ['karen', 'pmo'] }),
    });
    assert.strictEqual(membersRes.status, 200);
    const membersRows = auditHook.queryAudit({ dealId: deal.id }).filter((r) => r.action === 'deal-members-update');
    assert.strictEqual(membersRows.length, 1);
    assert.strictEqual(membersRows[0].row_id, deal.id);

    // --- deal-archive (admin-only) ---
    const archiveRes = await fetch(`${base}/api/admin/deals/${deal.id}/archive`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: deal.id }),
    });
    assert.strictEqual(archiveRes.status, 200);
    const archiveRows = auditHook.queryAudit({ dealId: deal.id }).filter((r) => r.action === 'deal-archive');
    assert.strictEqual(archiveRows.length, 1);
    assert.strictEqual(archiveRows[0].row_id, deal.id);

    // --- deal-delete (admin-only) ---
    const deleteRes = await fetch(`${base}/api/admin/deals/${deal.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: deal.id }),
    });
    assert.strictEqual(deleteRes.status, 200);
    const deleteRows = auditHook.queryAudit({ dealId: deal.id }).filter((r) => r.action === 'deal-delete');
    assert.strictEqual(deleteRows.length, 1);
    assert.strictEqual(deleteRows[0].row_id, deal.id);

    // --- session-revoke-all (admin offboarding action; self logout is NOT audited) ---
    const revokeRes = await fetch(`${base}/api/admin/users/pmo/revoke-sessions`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken) },
    });
    assert.strictEqual(revokeRes.status, 200);
    const revokeRows = auditHook.queryAudit({ actor: 'admin', limit: 500 }).filter((r) => r.action === 'session-revoke-all' && r.row_id === 'pmo');
    assert.strictEqual(revokeRows.length, 1);

    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
  } finally {
    server.close();
  }
});

test('audit-security-events (b): a break-glass admin-token request produces an event attributed to the token identity, not to a null actor', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const before = auditHook.queryAudit({ actor: 'admin-token', limit: 500 }).length;
    const res = await fetch(`http://127.0.0.1:${port}/api/deals`, { headers: { 'X-Admin-Token': TEST_ADMIN_TOKEN } });
    assert.strictEqual(res.status, 200, 'a valid X-Admin-Token must be accepted');
    const after = auditHook.queryAudit({ actor: 'admin-token', limit: 500 });
    assert.strictEqual(after.length, before + 1, 'exactly one admin-token-use row must be added per token-authenticated request');
    const last = after[after.length - 1];
    assert.strictEqual(last.action, 'admin-token-use');
    assert.strictEqual(last.actor_username, 'admin-token', 'the row must be attributed to the stable token identity, never a null/anonymous actor');
    assert.strictEqual(last.actor_role, 'admin');
  } finally {
    server.close();
  }
});

test('audit-security-events (c): the audit viewer route is 403 for hrbp/pmo/employee and 200 for admin', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const nonAdminRoles = [
      { username: 'karen', role: 'hrbp' },
      { username: 'pmo', role: 'pmo' },
      { username: 'employee-demo', role: 'employee' },
    ];
    for (const { username, role } of nonAdminRoles) {
      const token = sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
      const res = await fetch(`${base}/api/admin/audit`, { headers: { Cookie: cookieHeader(token) } });
      assert.strictEqual(res.status, 403, `${role} must be refused the audit viewer`);
      sessionsDb.deleteSession(runtimeConn, token);
    }
    const adminToken = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
    const adminRes = await fetch(`${base}/api/admin/audit`, { headers: { Cookie: cookieHeader(adminToken) } });
    assert.strictEqual(adminRes.status, 200, 'admin must be able to reach the audit viewer');
    sessionsDb.deleteSession(runtimeConn, adminToken);
  } finally {
    server.close();
  }
});

test('audit-security-events (d): the deal filter, user filter and date-range filter each narrow the result set correctly, ordered by id', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const adminToken = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });

    const createOne = async (name) => {
      const res = await fetch(`${base}/api/deals`, {
        method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, targetCompany: name + ' Co', members: [] }),
      });
      const body = await res.json();
      return body.deal;
    };
    const dealA = await createOne('Filter Deal A');
    await createOne('Filter Deal B');

    // deal filter — must return only rows for dealA
    const dealFilterRows = await (await fetch(`${base}/api/admin/audit?deal=${encodeURIComponent(dealA.id)}`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.ok(dealFilterRows.length > 0, 'the deal filter must return at least the create event');
    assert.ok(dealFilterRows.every((r) => r.deal_id === dealA.id), 'the deal filter must exclude every OTHER deal\'s rows');

    // user filter — must return only rows attributed to admin
    const userFilterRows = await (await fetch(`${base}/api/admin/audit?user=admin`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.ok(userFilterRows.length > 0);
    assert.ok(userFilterRows.every((r) => r.actor_username === 'admin'), 'the user filter must exclude every OTHER actor\'s rows');
    const idsInReturnedOrder = userFilterRows.map((r) => r.id);
    const idsAscending = [...idsInReturnedOrder].sort((a, b) => a - b);
    assert.deepStrictEqual(idsInReturnedOrder, idsAscending, 'results must already be ordered by ascending autoincrement id');

    // date-range filter — a `from` set in the future must exclude every existing row
    const futureFrom = new Date(Date.now() + 60_000).toISOString();
    const futureFilterRows = await (await fetch(`${base}/api/admin/audit?from=${encodeURIComponent(futureFrom)}`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.strictEqual(futureFilterRows.length, 0, 'a from-date in the future must exclude every existing row');

    sessionsDb.deleteSession(runtimeConn, adminToken);
  } finally {
    server.close();
  }
});

test('audit-security-events (e): no registered route under the audit path accepts a method that could modify or remove an audit row', () => {
  const routes = listApiRoutes(app).filter((r) => r.path.startsWith('/api/admin/audit'));
  assert.ok(routes.length > 0, 'the audit route inventory must not be empty — a 0-length list would make this test vacuously pass');
  for (const { method, path } of routes) {
    assert.strictEqual(method, 'GET', `${method} ${path} must not be registered — only a read route may exist under the audit path`);
  }
});

test('audit-security-events (f): a direct attempt to modify or remove an audit row through the audit connection raises (Plan 03-01 triggers are live at runtime, not just in the schema file)', () => {
  const conn = auditHook.getAuditConnection();
  const row = conn.prepare('SELECT id FROM audit_log LIMIT 1').get();
  assert.ok(row, 'precondition: at least one audit row must already exist from an earlier case in this file');
  assert.throws(
    () => conn.prepare('UPDATE audit_log SET action = ? WHERE id = ?').run('tampered', row.id),
    /append-only/i,
    'an UPDATE against a live audit_log row must be rejected by the BEFORE UPDATE trigger'
  );
  assert.throws(
    () => conn.prepare('DELETE FROM audit_log WHERE id = ?').run(row.id),
    /append-only/i,
    'a DELETE against a live audit_log row must be rejected by the BEFORE DELETE trigger'
  );
});
