// ISO-01 / ISO-03 / D-01 / D-02 / D-03: proves the deal registry control
// plane on top of Plan 03's resolver — an Integration Lead (hrbp) or admin
// can create a deal, select it, and have their very next request land in
// that deal's OWN database file; a non-member can neither select nor even
// SEE a deal they are excluded from (T-03-17: the mere existence of a
// pre-announcement target is MNPI); malformed create bodies are rejected
// with the existing single-string 400 shape and unknown keys are stripped
// (VAL-01 first instance, D-13).
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp trio of control.db/runtime.db/demo.db via the
// MA_CONTROL_DB_PATH/MA_RUNTIME_DB_PATH/MA_DEMO_DB_PATH/MA_DEALS_DIR env var
// overrides (db/dbFiles.js) — the SAME pattern test/deal-resolver.test.js
// establishes, set BEFORE requiring any module that resolves one of those
// path constants.
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
const Database = require('better-sqlite3');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-deal-registry-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deal-registry-split-'));
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
const sessionsDb = require('../db/sessions.js');

const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

// Seed real accounts directly (ARRAY_COLLECTIONS no longer carries `users` as
// of Phase 3 Task 2 — see test/deal-resolver.test.js's identical rationale).
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

const app = require('../server.js');

function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('deal-registry (a): hrbp creates a deal via POST /api/deals; a template-only deal database file is provisioned', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/deals`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Alpha', targetCompany: 'Alpha Co' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.success);
    assert.match(body.deal.id, /^deal_[a-z0-9]+$/i);
    assert.ok(body.deal.members.includes('karen'), 'the creator must be auto-added as a member (D-03)');

    const dealPath = dbFiles.dealDbPath(body.deal.id);
    assert.ok(fs.existsSync(dealPath), 'creating a deal must provision its own database file');
    const conn = new Database(dealPath, { readonly: true, fileMustExist: true });
    try {
      const checklistCount = conn.prepare('SELECT COUNT(*) AS c FROM checklistTemplates').get().c;
      assert.ok(checklistCount > 0, 'a new deal database must inherit the template collections (D-06)');
      const employeeCount = conn.prepare('SELECT COUNT(*) AS c FROM employees').get().c;
      assert.strictEqual(employeeCount, 0, 'a new deal database must start with ZERO demo-derived employee rows (D-06)');
    } finally {
      conn.close();
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-registry (b): selecting a created deal makes the very next write land in that deal\'s own file, not demo.db', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const createRes = await fetch(`http://127.0.0.1:${port}/api/deals`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Bravo', targetCompany: 'Bravo Co' }),
    });
    const { deal } = await createRes.json();

    const selectRes = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    assert.strictEqual(selectRes.status, 200);
    const selectBody = await selectRes.json();
    assert.ok(selectBody.success);
    assert.strictEqual(selectBody.deal.id, deal.id);

    // The NEXT request on this session must write into deal.id's own file.
    const writeRes = await fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bravo Sales' }),
    });
    assert.strictEqual(writeRes.status, 200);

    const dealPath = dbFiles.dealDbPath(deal.id);
    const conn = new Database(dealPath, { readonly: true, fileMustExist: true });
    let foundInDeal;
    try {
      const rows = conn.prepare('SELECT data FROM departments').all().map((r) => JSON.parse(r.data));
      foundInDeal = rows.some((d) => d.name === 'Bravo Sales');
    } finally {
      conn.close();
    }
    assert.ok(foundInDeal, 'the department write must land in the selected deal\'s own database file, verified by direct SQL');

    const demoConn = new Database(dbFiles.DEMO_DB_PATH, { readonly: true, fileMustExist: true });
    let foundInDemo;
    try {
      const rows = demoConn.prepare('SELECT data FROM departments').all().map((r) => JSON.parse(r.data));
      foundInDemo = rows.some((d) => d.name === 'Bravo Sales');
    } finally {
      demoConn.close();
    }
    assert.strictEqual(foundInDemo, false, 'the department write must NOT appear in demo.db');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-registry (c): selecting null returns the session to demo on the very next request', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const createRes = await fetch(`http://127.0.0.1:${port}/api/deals`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Charlie', targetCompany: 'Charlie Co' }),
    });
    const { deal } = await createRes.json();
    await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: deal.id }),
    });
    await fetch(`http://127.0.0.1:${port}/api/departments`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Charlie Sales' }),
    });

    const backToDemo = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: null }),
    });
    assert.strictEqual(backToDemo.status, 200);
    const backBody = await backToDemo.json();
    assert.strictEqual(backBody.deal, null);

    const readRes = await fetch(`http://127.0.0.1:${port}/api/departments`, { headers: { Cookie: cookieHeader(token) } });
    const depts = await readRes.json();
    assert.ok(!depts.some((d) => d.name === 'Charlie Sales'), 'after unbinding, the next request must resolve to demo.db, not the deal file');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-registry (d): a non-member is refused select with 403 and their prior binding is left unchanged', async () => {
  registerDeal({ id: 'deal_pmoown1', name: 'PMO Own Deal', targetCompany: 'PmoOwn Co', members: ['pmo'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });
  registerDeal({ id: 'deal_notpmo1', name: 'Not PMO Deal', targetCompany: 'NotPmo Co', members: ['karen'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });

  const token = newSession('pmo', 'pmo');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    // pmo binds to a deal they ARE a member of first, so we can prove the
    // refusal below leaves this binding untouched.
    const bindRes = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal_pmoown1' }),
    });
    assert.strictEqual(bindRes.status, 200);

    const refusedRes = await fetch(`http://127.0.0.1:${port}/api/deals/select`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealId: 'deal_notpmo1' }),
    });
    assert.strictEqual(refusedRes.status, 403, 'a non-member select must be refused');

    const sess = sessionsDb.findSession(runtimeConn, token);
    assert.strictEqual(sess.dealId, 'deal_pmoown1', 'the prior binding must be left completely unchanged by a refused select');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-registry (e): a non-member\'s GET /api/deals response contains no trace of the excluded deal', async () => {
  registerDeal({ id: 'deal_secret1', name: 'Secret Target', targetCompany: 'Secretive Industries', members: ['karen'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });

  const token = newSession('pmo', 'pmo');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/deals`, { headers: { Cookie: cookieHeader(token) } });
    assert.strictEqual(res.status, 200);
    const list = await res.json();
    const serialized = JSON.stringify(list);
    assert.ok(!list.some((d) => d.id === 'deal_secret1'), 'the excluded deal\'s id must not appear in the list');
    assert.ok(!serialized.includes('Secret Target'), 'the excluded deal\'s name must not appear anywhere in the response');
    assert.ok(!serialized.includes('Secretive Industries'), 'the excluded deal\'s target company must not appear anywhere in the response');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-registry (f): deal creation is refused for employee, allowed for hrbp and admin', async () => {
  const employeeToken = newSession('employee-demo', 'employee');
  const hrbpToken = newSession('karen', 'hrbp');
  const adminToken = newSession('admin', 'admin');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const postDeal = (token, name) => fetch(`http://127.0.0.1:${port}/api/deals`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, targetCompany: name + ' Co' }),
    });

    const employeeRes = await postDeal(employeeToken, 'Employee Attempt');
    assert.strictEqual(employeeRes.status, 403, 'employee must be refused deal creation (D-02)');

    const hrbpRes = await postDeal(hrbpToken, 'Hrbp Deal F');
    assert.strictEqual(hrbpRes.status, 200, 'hrbp must be allowed to create a deal (D-02)');

    const adminRes = await postDeal(adminToken, 'Admin Deal F');
    assert.strictEqual(adminRes.status, 200, 'admin must be allowed to create a deal (D-02)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, employeeToken);
    sessionsDb.deleteSession(runtimeConn, hrbpToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('deal-registry (g): malformed create bodies are rejected 400 with a single-string error; an unknown key is silently stripped', async () => {
  const token = newSession('karen', 'hrbp');
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const post = (body) => fetch(`http://127.0.0.1:${port}/api/deals`, {
      method: 'POST',
      headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const missingName = await post({ targetCompany: 'Missing Name Co' });
    assert.strictEqual(missingName.status, 400);
    const missingNameBody = await missingName.json();
    assert.strictEqual(typeof missingNameBody.error, 'string', 'the 400 body must be a single string, not an array');
    assert.match(missingNameBody.error, /name/i);

    const wrongMembersType = await post({ name: 'Wrong Members', targetCompany: 'Wrong Co', members: 'not-an-array' });
    assert.strictEqual(wrongMembersType.status, 400);
    const wrongMembersBody = await wrongMembersType.json();
    assert.match(wrongMembersBody.error, /members/i);

    const overLongName = await post({ name: 'x'.repeat(201), targetCompany: 'Over Long Co' });
    assert.strictEqual(overLongName.status, 400);
    const overLongBody = await overLongName.json();
    assert.match(overLongBody.error, /name/i);

    const withUnknownKey = await post({ name: 'Stripped Key Deal', targetCompany: 'Stripped Co', evilField: '<script>alert(1)</script>' });
    assert.strictEqual(withUnknownKey.status, 200);
    const strippedBody = await withUnknownKey.json();
    assert.strictEqual(strippedBody.deal.evilField, undefined, 'an unknown key must be silently stripped, never stored');

    const registryRow = controlConn.prepare('SELECT data FROM deals WHERE id = ?').get(strippedBody.deal.id);
    assert.ok(!JSON.parse(registryRow.data).evilField, 'the stripped key must not be present in the persisted control.db registry row either');
  } finally {
    sessionsDb.deleteSession(runtimeConn, token);
    server.close();
  }
});

test('deal-registry: source exports the documented validators/deals.js surface', () => {
  const v = require('../validators/deals.js');
  ['CreateDealSchema', 'SelectDealSchema', 'DealMembersSchema', 'DeleteConfirmSchema', 'validateBody', 'formatIssues'].forEach((k) => {
    assert.notStrictEqual(v[k], undefined, `validators/deals.js must export ${k}`);
  });
});
