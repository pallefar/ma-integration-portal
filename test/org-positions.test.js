// ORG-01: CRUD + graph-integrity coverage for the org position registry.
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-access-policy.test.js's own harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-positions.test.js` (or `npm test`).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-org-positions-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

// First assertion: requiring db/collections.js must not throw, and its
// exported array length must match the bumped count (T-06-06's acceptance
// criterion, proven inside the suite as well as via the standalone
// `node -e` check).
const collections = require('../db/collections.js');
assert.strictEqual(collections.ARRAY_COLLECTIONS.length, 38, 'db/collections.js must load with the bumped 38-entry count');

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/dd-access-policy.test.js).
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

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('org-positions (a): POST from an hr-cleared session creates a current-state position with null occupant/parent', async () => {
  const deal = freshDeal('deal_orga', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'VP Engineering', level: 'VP' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.ok(body.success);
    assert.match(body.position.id, /^pos/);
    assert.strictEqual(body.position.state, 'current');
    assert.strictEqual(body.position.employeeId, null);
    assert.strictEqual(body.position.reportsToId, null);
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (b): POST with state:"target" from an hr-cleared session stores state:"target"', async () => {
  const deal = freshDeal('deal_orgb', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Head of Design', state: 'target' }),
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.strictEqual(body.position.state, 'target');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (c): POST with an empty/whitespace title and no id returns 400 from the schema', async () => {
  const deal = freshDeal('deal_orgc', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '   ' }),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /title/i);
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (d): POST with an existing id updates in place without creating a second row', async () => {
  const deal = freshDeal('deal_orgd', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Original Title' }),
    });
    const { position } = await createRes.json();

    const updateRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: position.id, title: 'Renamed' }),
    });
    assert.strictEqual(updateRes.status, 200);
    const updated = await updateRes.json();
    assert.strictEqual(updated.position.title, 'Renamed');
    assert.strictEqual(updated.position.id, position.id);

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.filter((p) => p.id === position.id).length, 1, 'the update must not create a second row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (e): GET with no query, from a member with NO area grants, returns current-state rows only', async () => {
  const deal = freshDeal('deal_orge', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Current position' }),
    });
    await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Target position', state: 'target' }),
    });

    // A member of this deal with no explicit memberGrants entry at all —
    // 'pmo' above was granted 'hr'; use a second, uncleared pmo-role member.
    const uncleared = newSession('supporting', 'employee'); bindDeal(uncleared, deal.id);
    controlConn.prepare('UPDATE deals SET data = ? WHERE id = ?')
      .run(JSON.stringify({ ...deal, members: [...deal.members, 'supporting'] }), deal.id);
    try {
      const res = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(uncleared) } });
      assert.strictEqual(res.status, 200);
      const list = await res.json();
      assert.ok(list.every((p) => p.state === 'current'), 'no target-state row may be present');
      assert.ok(list.some((p) => p.title === 'Current position'));
      assert.ok(!list.some((p) => p.title === 'Target position'));
    } finally {
      sessionsDb.deleteSession(runtimeConn, uncleared);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-positions (f): GET ?state=target from an uncleared member returns 403 and no row data', async () => {
  const deal = freshDeal('deal_orgf', { memberGrants: { pmo: { ddAreas: ['hr'] } }, members: ['pmo', 'admin', 'supporting'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const uncleared = newSession('supporting', 'employee'); bindDeal(uncleared, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Secret target design', state: 'target' }),
    });

    const res = await fetch(`${base}/api/org/positions?state=target`, { headers: { Cookie: cookieHeader(uncleared) } });
    assert.strictEqual(res.status, 403);
    const text = await res.text();
    assert.ok(!text.includes('Secret target design'), 'the 403 body must contain no position data');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    sessionsDb.deleteSession(runtimeConn, uncleared);
    server.close();
  }
});

test('org-positions (g): GET ?state=target returns 200 with target rows for an hr-granted member and for an hrbp session with no explicit grant', async () => {
  const deal = freshDeal('deal_orgg', { memberGrants: { pmo: { ddAreas: ['hr'] } }, members: ['pmo', 'karen', 'admin'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id); // hrbp, no explicit memberGrants entry
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Target row', state: 'target' }),
    });

    const pmoRes = await fetch(`${base}/api/org/positions?state=target`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(pmoRes.status, 200);
    const pmoList = await pmoRes.json();
    assert.ok(pmoList.some((p) => p.title === 'Target row'));

    const karenRes = await fetch(`${base}/api/org/positions?state=target`, { headers: { Cookie: cookieHeader(karenToken) } });
    assert.strictEqual(karenRes.status, 200, 'hrbp reaches target state via the admin/hrbp short-circuit, with no explicit memberGrants entry');
    const karenList = await karenRes.json();
    assert.ok(karenList.some((p) => p.title === 'Target row'));
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-positions (h): POST from a deal member with no hr grant returns 403 and creates no row', async () => {
  const deal = freshDeal('deal_orgh', { memberGrants: {}, members: ['pmo', 'admin'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should never be created' }),
    });
    assert.strictEqual(res.status, 403);

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(adminToken) } });
    const list = await listRes.json();
    assert.deepStrictEqual(list, [], 'a refused create must persist nothing');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});
