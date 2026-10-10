// ISO-01 / ISO-03 / D-01 / D-03: proves db/resolver.js binds every /api
// request to EXACTLY ONE database file before any route handler runs — the
// structural replacement for the flag-and-shadow-array demoMode switch.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp trio of control.db/runtime.db/demo.db (never the live,
// committed data/*.db) via the MA_CONTROL_DB_PATH/MA_RUNTIME_DB_PATH/
// MA_DEMO_DB_PATH/MA_DEALS_DIR env var overrides (db/dbFiles.js), set BEFORE
// requiring any module that resolves one of those path constants — the same
// pattern test/role-enforcement.test.js establishes. The temp trio is
// produced by the same re-runnable split scripts/split-db-into-control-demo-deals.js
// already uses in production, seeded from db.json via the established
// migrate-db-json-to-sqlite.js runner.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-deal-resolver-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deal-resolver-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
// Phase 11 / 11-04: gate denials are audited — keep them out of data/audit.db.
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH);

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR });

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const resolver = require('../db/resolver.js');
const controlStore = require('../db/controlStore.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const demoConn = store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);

// Seed real accounts directly (ARRAY_COLLECTIONS no longer carries `users` as
// of Phase 3 Task 2 — neither runMigration() nor runSplit() touches accounts
// anymore; see test/role-enforcement.test.js's identical seeding rationale).
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

// Two real deals: karen is a member of deal_alpha1, NOT a member of deal_beta1.
registerDeal({ id: 'deal_alpha1', name: 'Alpha Deal', targetCompany: 'Alpha Co', members: ['karen'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });
registerDeal({ id: 'deal_beta1', name: 'Beta Deal', targetCompany: 'Beta Co', members: ['pmo'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });
registerDeal({ id: 'deal_archived1', name: 'Archived Deal', targetCompany: 'Archived Co', members: ['karen'], status: 'archived', createdBy: 'admin', createdAt: new Date().toISOString() });

createDealDatabase('deal_alpha1', { name: 'Alpha Deal', targetCompany: 'Alpha Co' });
// deal_beta1 and deal_archived1 deliberately have NO on-disk file created here
// — case (c)/(d) assert the resolver never causes one to be created either.

// A distinct marker row in demo.db's employees table and deal_alpha1's own
// employees table — the isolation proof every read-side case checks against.
demoConn.prepare(`INSERT INTO employees (id, project_id, seq, data) VALUES (?, NULL, 0, ?)`)
  .run('emp_demo_marker', JSON.stringify({ id: 'emp_demo_marker', name: 'Demo Marker Employee' }));
const dealAlphaConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_alpha1'), dbFiles.DEAL_SCHEMA_PATH);
dealAlphaConn.prepare(`INSERT INTO employees (id, project_id, seq, data) VALUES (?, NULL, 0, ?)`)
  .run('emp_alpha_marker', JSON.stringify({ id: 'emp_alpha_marker', name: 'Alpha Marker Employee' }));

const app = require('../server.js');

function cookieHeader(token) { return `ma_session=${token}`; }

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('deal-resolver (a): a session with a null deal binding reads demo.db rows and none from a deal file', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/employees`, { headers: { Cookie: cookieHeader(token) } });
    const employees = await res.json();
    assert.ok(employees.some((e) => e.id === 'emp_demo_marker'), 'an unbound session must see the demo marker row');
    assert.ok(!employees.some((e) => e.id === 'emp_alpha_marker'), 'an unbound session must NOT see any deal file\'s rows');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-resolver (b): the same user rebound to a deal they are a member of reads only that deal\'s rows', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, token, 'deal_alpha1');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/employees`, { headers: { Cookie: cookieHeader(token) } });
    const employees = await res.json();
    assert.ok(employees.some((e) => e.id === 'emp_alpha_marker'), 'a session bound to deal_alpha1 must see that deal\'s marker row');
    assert.ok(!employees.some((e) => e.id === 'emp_demo_marker'), 'a deal-bound session must NOT see demo.db\'s rows');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-resolver (c): a session bound to a deal the user is NOT a member of gets 403, and no connection handle for that file is ever created', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, token, 'deal_beta1'); // karen is NOT a member of deal_beta1
  const betaPath = dbFiles.dealDbPath('deal_beta1');
  assert.ok(!fs.existsSync(betaPath), 'precondition: deal_beta1 has no on-disk file yet');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/employees`, { headers: { Cookie: cookieHeader(token) } });
    assert.strictEqual(res.status, 403, 'a non-member deal binding must be refused with 403');
    assert.ok(!fs.existsSync(betaPath), 'the refusal must happen at bind time — no connection/file for deal_beta1 was ever created');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-resolver (d) WR-02: a session bound to a nonexistent or archived deal is refused with a UNIFORM 403 (never a distinguishable 404), never served demo content', async () => {
  // WR-02: resolveDatabase() must not hand back a distinct 404-for-missing
  // vs 403-for-non-member status — that would let a caller enumerate which
  // deal ids exist purely from the status code, exactly what POST
  // /api/deals/select's own uniform-403 anti-enumeration rule (T-03-17)
  // forbids. This is the same rule enforced on EVERY subsequent request a
  // deal-bound session makes, not just at select time.
  const tokenMissing = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, tokenMissing, 'deal_ghost999'); // never registered
  const tokenArchived = sessionsDb.createSession(runtimeConn, { username: 'karen', role: 'hrbp', ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, tokenArchived, 'deal_archived1'); // registered but archived
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const resMissing = await fetch(`http://127.0.0.1:${port}/api/employees`, { headers: { Cookie: cookieHeader(tokenMissing) } });
    assert.strictEqual(resMissing.status, 403, 'a session bound to a nonexistent deal must get the same uniform 403 as a non-member refusal');
    const resArchived = await fetch(`http://127.0.0.1:${port}/api/employees`, { headers: { Cookie: cookieHeader(tokenArchived) } });
    assert.strictEqual(resArchived.status, 403, 'a session bound to an archived deal must also get the same uniform 403');
  } finally {
    sessionsDb.deleteSession(runtimeConn, tokenMissing);
    sessionsDb.deleteSession(runtimeConn, tokenArchived);
    server.close();
  }
});

test('deal-resolver (e) adjacency: two resolutions of the SAME deal share one cached connection; demo vs. deal sessions never share a handle', () => {
  const fakeReqAlphaFirst = { baseUrl: '/api', path: '/employees', portalUser: { username: 'karen', role: 'hrbp', dealId: 'deal_alpha1' } };
  const fakeReqAlphaSecond = { baseUrl: '/api', path: '/employees', portalUser: { username: 'admin', role: 'admin', dealId: 'deal_alpha1' } };
  const fakeReqDemo = { baseUrl: '/api', path: '/employees', portalUser: null };

  const resolvedAlpha1 = resolver.resolveDatabase(fakeReqAlphaFirst);
  const resolvedAlpha2 = resolver.resolveDatabase(fakeReqAlphaSecond);
  const resolvedDemo = resolver.resolveDatabase(fakeReqDemo);

  const connAlpha1 = store.getOrOpenConnection(resolvedAlpha1.dbPath, resolvedAlpha1.schemaPath);
  const connAlpha2 = store.getOrOpenConnection(resolvedAlpha2.dbPath, resolvedAlpha2.schemaPath);
  const connDemo = store.getOrOpenConnection(resolvedDemo.dbPath, resolvedDemo.schemaPath);

  assert.strictEqual(connAlpha1, connAlpha2, 'two sessions bound to the SAME deal must share one cached connection handle');
  assert.notStrictEqual(connAlpha1, connDemo, 'a demo session and a deal session must never be served the same handle');
});

test('deal-resolver (f) ordering: the resolver runs before ROLE_WRITE_POLICY — a demo-only, role-allowed write is refused for the resolved database, not the role', async () => {
  const token = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, token, 'deal_alpha1'); // admin is always a member (D-03)
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    // POST /api/settings/time-travel is demo-only (DEMO_ONLY_PREFIXES) AND
    // admin-allowed by ROLE_WRITE_POLICY (DEFAULT_WRITE_ROLES includes
    // admin) — if role were checked first, this would 200; the resolver's
    // demo-only gate must refuse it BEFORE the role check ever matters.
    const res = await fetch(`http://127.0.0.1:${port}/api/settings/time-travel`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ day: 30 }),
    });
    assert.strictEqual(res.status, 403, 'a demo-only write against a deal-bound (non-demo) session must be refused, even though admin is role-allowed');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-resolver (g) concurrency: two interleaved AsyncLocalStorage-bound contexts never leak into each other', async () => {
  const dealAlphaCtx = { conn: dealAlphaConn, kind: 'deal', dealId: 'deal_alpha1', dbPath: dbFiles.dealDbPath('deal_alpha1') };
  const demoCtx = { conn: demoConn, kind: 'demo', dealId: null, dbPath: dbFiles.DEMO_DB_PATH };

  async function readInsideContext(ctx, expectedMarkerId, forbiddenMarkerId) {
    return store.runWithDb(ctx, async () => {
      // An await point BETWEEN bind and read — the exact interleave that
      // would leak state if the ALS context did not follow this async chain.
      await new Promise((resolve) => setImmediate(resolve));
      const db = store.readDb();
      return { hasExpected: db.employees.some((e) => e.id === expectedMarkerId), hasForbidden: db.employees.some((e) => e.id === forbiddenMarkerId) };
    });
  }

  const [alphaResult, demoResult] = await Promise.all([
    readInsideContext(dealAlphaCtx, 'emp_alpha_marker', 'emp_demo_marker'),
    readInsideContext(demoCtx, 'emp_demo_marker', 'emp_alpha_marker'),
  ]);

  assert.strictEqual(alphaResult.hasExpected, true, 'the deal-bound context must still see its own marker row after the interleave');
  assert.strictEqual(alphaResult.hasForbidden, false, 'the deal-bound context must NOT see the demo marker row (no cross-request leak)');
  assert.strictEqual(demoResult.hasExpected, true, 'the demo-bound context must still see its own marker row after the interleave');
  assert.strictEqual(demoResult.hasForbidden, false, 'the demo-bound context must NOT see the deal marker row (no cross-request leak)');
});

test('deal-resolver: source exports the documented AsyncLocalStorage/resolver surface', () => {
  assert.ok(store.requestDbStorage, 'db/store.js must export requestDbStorage');
  assert.strictEqual(typeof store.getOrOpenConnection, 'function');
  assert.strictEqual(typeof store.runWithDb, 'function');
  assert.strictEqual(typeof store.closeAllConnections, 'function');
  assert.strictEqual(typeof resolver.resolveDatabase, 'function');
  assert.strictEqual(typeof resolver.dealResolverMiddleware, 'function');
  assert.strictEqual(typeof resolver.DealAccessError, 'function');
  assert.ok(resolver.CONTROL_PLANE_PATHS instanceof Set);
});

test('deal-resolver WR-03: isControlPlanePath() covers revoke-sessions and download-zip, mirroring the /api/admin/audit precedent', () => {
  assert.strictEqual(resolver.isControlPlanePath('/api/admin/users/somebody/revoke-sessions'), true, 'revoke-sessions must be treated as control-plane — it never touches the resolved deal database');
  assert.strictEqual(resolver.isControlPlanePath('/api/admin/download-zip'), true, 'download-zip must be treated as control-plane — it touches the filesystem directly, never readDb()/writeDb()');
  // Precedent + unrelated admin paths still behave as before.
  assert.strictEqual(resolver.isControlPlanePath('/api/admin/audit'), true);
  assert.strictEqual(resolver.isControlPlanePath('/api/admin/migrate-db'), false, 'a route that DOES call readDb()/writeDb() must still be gated on the resolved deal binding');
});

test('deal-resolver WR-03 (integration): an admin session bound to an archived deal can still reach revoke-sessions instead of 403ing on the stale binding', async () => {
  const adminToken = sessionsDb.createSession(runtimeConn, { username: 'admin', role: 'admin', ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, adminToken, 'deal_archived1'); // archived — would 403 for any non-control-plane route (WR-02)
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/nobody-real/revoke-sessions`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
    });
    assert.strictEqual(res.status, 200, 'revoke-sessions must stay reachable regardless of the admin\'s own stale deal binding (WR-03)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});
