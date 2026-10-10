// DD-04 / D-08 / D-11: proves "the denial itself is audited" is literally
// true — a by-id probe of an uncleared item writes exactly one
// `dd-access-denied` audit row naming the actor, the deal and the area; an
// unknown-id probe writes the same event with a null subject (the audit row
// is the ONLY place "unknown id" and "uncleared area" are distinguishable —
// the HTTP response never is, per test/dd-workspace.test.js's own byte-
// identical-body proof); a create attempt into an uncleared area is refused
// AND writes zero item rows; a normal cleared list read writes NO denial
// event at all (D-03's invisibility — browsing your own workspace is not an
// access attempt); and an admin session's own DD writes still produce
// ordinary (non-denial) audit rows — no actor is exempt from the trail.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-workspace.test.js's own harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/dd-access-policy.test.js` (or `npm test`).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dd-access-policy-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/dd-workspace.test.js).
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
function freshDeal(id, overrides) {
  return {
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo', 'admin'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides,
  };
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

function deniedRows(dealId) {
  return auditHook.queryAudit({ dealId, limit: 500 }).filter((r) => r.action === 'dd-access-denied');
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('dd-access-policy (a): a by-id probe of an uncleared item writes exactly one dd-access-denied row naming the actor, the deal and the area', async () => {
  const deal = freshDeal('deal_ddapa', { memberGrants: { pmo: { ddAreas: ['financial'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Uncleared-area probe target' }),
    });
    const { item } = await createRes.json();

    const before = deniedRows(deal.id).length;
    const probeRes = await fetch(`${base}/api/dd/request-items/${item.id}`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(probeRes.status, 403);

    const rows = deniedRows(deal.id);
    assert.strictEqual(rows.length, before + 1, 'exactly one dd-access-denied row must be added for the probe');
    const row = rows[0];
    assert.strictEqual(row.actor_username, 'pmo', 'the row must name the refused actor');
    assert.strictEqual(row.deal_id, deal.id, 'the row must name the deal');
    assert.strictEqual(row.row_id, 'legal', 'the row must name the area (item.legal) via its subject/row_id column');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-access-policy (b): an unknown-id probe writes a dd-access-denied row with a null subject', async () => {
  const deal = freshDeal('deal_ddapb', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = deniedRows(deal.id).length;
    const probeRes = await fetch(`${base}/api/dd/request-items/ddreq_never_created`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(probeRes.status, 403);

    const rows = deniedRows(deal.id);
    assert.strictEqual(rows.length, before + 1, 'the denial for an unknown id must ALSO be recorded — it is still an audited refusal');
    assert.strictEqual(rows[0].row_id, null, 'an unknown item id has no area to name — the subject/row_id column must be null');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-access-policy (c): a create attempt into an uncleared area is refused, writes a dd-access-denied row, and creates no item row', async () => {
  const deal = freshDeal('deal_ddapc', { memberGrants: { pmo: { ddAreas: ['financial'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = deniedRows(deal.id).length;
    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'pmo tries to create in an uncleared area' }),
    });
    assert.strictEqual(createRes.status, 403, 'a create into an uncleared area must be refused');

    const rows = deniedRows(deal.id);
    assert.strictEqual(rows.length, before + 1, 'the refused create must be recorded');
    assert.strictEqual(rows[0].row_id, 'legal', 'the row must name the area the caller attempted to write into');

    // Prove no item row was created — an admin (cleared for everything) must
    // see zero items in this deal.
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    try {
      const listRes = await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(adminToken) } });
      const list = await listRes.json();
      assert.deepStrictEqual(list, [], 'a refused create must persist nothing — the deal must still have zero DD items');
    } finally {
      sessionsDb.deleteSession(runtimeConn, adminToken);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-access-policy (d): a cleared member listing their own areas adds zero dd-access-denied rows', async () => {
  const deal = freshDeal('deal_ddapd', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'A legal item pmo IS cleared to browse' }),
    });
    await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'financial', text: 'A financial item pmo is NOT cleared for, browsed via the list route' }),
    });

    const before = deniedRows(deal.id).length;
    const areasRes = await fetch(`${base}/api/dd/areas`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(areasRes.status, 200);
    const listRes = await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(listRes.status, 200);
    const list = await listRes.json();
    assert.strictEqual(list.length, 1, 'the financial item must be silently omitted, not surfaced as a denial');

    assert.strictEqual(deniedRows(deal.id).length, before, 'browsing a workspace — even one with uncleared areas silently omitted — must add zero dd-access-denied rows (D-03)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-access-policy (e): an admin session\'s own DD write still produces an ordinary (non-denial) audit row — no actor is exempt from the trail', async () => {
  const deal = freshDeal('deal_ddape');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Admin-authored item' }),
    });
    assert.strictEqual(createRes.status, 201);
    const { item } = await createRes.json();

    // Ordinary writeDb() writes are audited with action 'insert'/'update', not
    // 'dd-access-denied' — this is the store-layer hook (db/store.js) already
    // proven by test/audit-log.test.js; here we prove it specifically fires
    // for an admin's OWN DD write, i.e. no actor (including the highest-
    // privilege role) is exempt from the ordinary write trail.
    const writeRows = auditHook.queryAudit({ dealId: deal.id, actor: 'admin', limit: 500 })
      .filter((r) => r.collection === 'ddRequestItems' && r.row_id === item.id);
    assert.ok(writeRows.length >= 1, 'admin\'s own DD create must produce an ordinary audit row, not a silent, unattributed write');
    assert.notStrictEqual(writeRows[0].action, 'dd-access-denied', 'a successful write is an ordinary audit row, never a denial');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});
