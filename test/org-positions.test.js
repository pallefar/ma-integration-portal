// ORG-01: CRUD + graph-integrity coverage for the org position registry.
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-access-policy.test.js's own harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-positions.test.js` (or `npm test`).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ORG_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'org.js');

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
// D-10-04 / COLLAB-02: the gate re-reads the account per request, so a directly-created
// session needs a matching control.db account with the same role.
const { ensureUser } = require('./helpers/seed-identity.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');
// GD-3 (CONC-02 gap closure): this suite's subject is not the version contract — supply the held-version precondition a real client sends.
require('./helpers/held-version.js').installHeldVersionFetch();
const { positionGraphFailure } = app;

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
  ensureUser(controlConn, { username, role });
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
  const server = await listenLocal(app);
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
  const server = await listenLocal(app);
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
  const server = await listenLocal(app);
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
  const server = await listenLocal(app);
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
  const server = await listenLocal(app);
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
  const server = await listenLocal(app);
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
  const server = await listenLocal(app);
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
  const server = await listenLocal(app);
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

// -----------------------------------------------------------------------
// Task 2: graph integrity — self-parent, unknown parent, cross-state and
// cycle refusals.
// -----------------------------------------------------------------------

test('org-positions (i): positionGraphFailure() returns null for a null reportsToId', () => {
  assert.strictEqual(positionGraphFailure([], { id: 'pos_x', state: 'current', reportsToId: null }), null);
});

test('org-positions (j): positionGraphFailure() refuses a self-referential reportsToId', () => {
  const reason = positionGraphFailure(
    [{ id: 'pos_a', state: 'current', reportsToId: null }],
    { id: 'pos_a', state: 'current', reportsToId: 'pos_a' },
  );
  assert.ok(reason);
});

test('org-positions (k): positionGraphFailure() refuses a reportsToId absent from the lane', () => {
  const reason = positionGraphFailure(
    [{ id: 'pos_a', state: 'current', reportsToId: null }],
    { id: 'pos_b', state: 'current', reportsToId: 'pos_nonexistent' },
  );
  assert.ok(reason);
});

test('org-positions (l): positionGraphFailure() refuses a reportsToId whose state differs from the candidate\'s', () => {
  const lane = [{ id: 'pos_a', state: 'target', reportsToId: null }];
  const reason = positionGraphFailure(lane, { id: 'pos_b', state: 'current', reportsToId: 'pos_a' });
  assert.ok(reason);
});

test('org-positions (m): positionGraphFailure() returns null for a valid same-state parent that is not an ancestor', () => {
  const lane = [
    { id: 'pos_a', state: 'current', reportsToId: null },
    { id: 'pos_b', state: 'current', reportsToId: null },
  ];
  assert.strictEqual(positionGraphFailure(lane, { id: 'pos_c', state: 'current', reportsToId: 'pos_a' }), null);
});

test('org-positions (n): positionGraphFailure() terminates and returns a reason on a lane with a pre-existing parent cycle', (t, done) => {
  // A hand-built lane whose two rows already form a cycle (never
  // producible through the live API, since every write is refused before
  // it lands) — proves the ancestor walk terminates on already-cyclic
  // stored data rather than looping forever.
  const lane = [
    { id: 'pos_x', state: 'current', reportsToId: 'pos_y' },
    { id: 'pos_y', state: 'current', reportsToId: 'pos_x' },
  ];
  const reason = positionGraphFailure(lane, { id: 'pos_z', state: 'current', reportsToId: 'pos_x' });
  assert.ok(reason, 'the walk must return a reason string rather than hang on the pre-existing cycle');
  done();
});

test('org-positions (o): POST with a self-referential reportsToId returns 400 and leaves the lane unchanged', async () => {
  const deal = freshDeal('deal_orgo', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Self referrer' }),
    });
    const { position } = await createRes.json();

    const before = (await (await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } })).json()).length;

    const badRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: position.id, reportsToId: position.id }),
    });
    assert.strictEqual(badRes.status, 400);

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const list = await listRes.json();
    assert.strictEqual(list.length, before, 'the lane length must be unchanged');
    const stillStored = list.find((p) => p.id === position.id);
    assert.strictEqual(stillStored.reportsToId, null, 'the invalid reportsToId must not have been persisted');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (p): POST with a target-state reportsToId while the candidate is current-state returns 400', async () => {
  const deal = freshDeal('deal_orgp', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const targetRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Target parent', state: 'target' }),
    });
    const { position: targetParent } = await targetRes.json();

    const res = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Current child', reportsToId: targetParent.id }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (q): re-parenting a position to its own descendant returns 400; to an unrelated same-state node returns 200', async () => {
  const deal = freshDeal('deal_orgq', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    async function create(body) {
      const res = await fetch(`${base}/api/org/positions`, {
        method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()).position;
    }

    const root = await create({ title: 'Root' });
    const child = await create({ title: 'Child', reportsToId: root.id });
    const grandchild = await create({ title: 'Grandchild', reportsToId: child.id });
    const unrelated = await create({ title: 'Unrelated node' });

    // Attempt to re-parent the root under its own grandchild — a cycle.
    const cycleRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: root.id, reportsToId: grandchild.id }),
    });
    assert.strictEqual(cycleRes.status, 400);

    const afterCycleAttempt = await (await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    const rootRow = afterCycleAttempt.find((p) => p.id === root.id);
    assert.strictEqual(rootRow.reportsToId, null, 'the root\'s reportsToId must be unchanged after the refused re-parent');

    // Re-parent the root under an unrelated same-state node — valid.
    const validRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: root.id, reportsToId: unrelated.id }),
    });
    assert.strictEqual(validRes.status, 200);
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

// -----------------------------------------------------------------------
// Task 1: the collapsible indented tree — source-level assertions on
// public/js/org.js, matching this task's own acceptance criteria (no DOM
// test harness like jsdom exists in this repo, so the client-render
// contract is verified at the source level, mirroring
// test/org-access-policy.test.js's own "defence-in-depth" source check).
// -----------------------------------------------------------------------

test('org-positions (r): public/js/org.js declares the expanded-id Set exactly once and never reassigns it', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const freshSetOccurrences = (src.match(/new Set\(/g) || []).length;
  assert.strictEqual(freshSetOccurrences, 1, 'exactly one `new Set(` construction must exist — the single expandedIds declaration; any second occurrence would be a reassignment or a competing Set');
  assert.match(src, /var expandedIds\s*=\s*new Set\(\)/, 'the expanded-id Set must be declared as module-level `expandedIds`');
  assert.ok(!/expandedIds\s*=\s*new Set\(/.test(src.replace(/var expandedIds\s*=\s*new Set\(\);/, '')), 'expandedIds must never be reassigned to a fresh Set after its declaration');
});

test('org-positions (s): the children container is constructed only inside the branch guarded by isExpanded', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  assert.match(
    src,
    /if\s*\(hasChildren\s*&&\s*isExpanded\)\s*\{[\s\S]*?org-node-children[\s\S]*?\}/,
    'the org-node-children construction must sit inside an `if (hasChildren && isExpanded)` branch, so a collapsed node emits no children container at all',
  );
  // Guard against a second, unconditional construction of the same class
  // elsewhere in the file (which would defeat the structural-absence
  // discipline even if the guarded one above also exists).
  const childrenClassOccurrences = (src.match(/className:\s*'org-node-children'/g) || []).length;
  assert.strictEqual(childrenClassOccurrences, 1, 'org-node-children must be constructed from exactly one call site');
});

test('org-positions (t): the level chip is appended only when the position carries a non-empty level', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  assert.match(
    src,
    /if\s*\(node\.position\.level\)\s*\{[\s\S]*?org-node-level[\s\S]*?\}/,
    'the level chip must be constructed inside an `if (node.position.level)` guard so it renders at every depth that has one, not unconditionally',
  );
});

// -----------------------------------------------------------------------
// Task 2: search and the unassigned-employees bucket — source-level
// assertions on public/js/org.js.
// -----------------------------------------------------------------------

test('org-positions (u): the search filter operates on already-fetched data and issues no fetch call', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const searchHandlerMatch = src.match(/input\.addEventListener\('input',\s*function\s*\(\)\s*\{[\s\S]*?\n    \}\);/);
  assert.ok(searchHandlerMatch, 'a search input change handler must exist');
  assert.ok(!searchHandlerMatch[0].includes('fetch('), 'the search handler must not issue a fetch call — it filters the already-fetched tree data client-side');
});

test('org-positions (v): the unassigned-employees bucket is computed by excluding employeeIds referenced by positions, not a second server call', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const fnMatch = src.match(/function computeUnassignedEmployees\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'a dedicated computeUnassignedEmployees() function must exist');
  assert.ok(!fnMatch[0].includes('fetch('), 'computing unassigned membership must not issue a second server call');
  assert.ok(fnMatch[0].includes('employeeId'), 'membership must be computed against positions\' employeeId references');
});

test('org-positions (w): the no-match copy and the unassigned heading each appear exactly once, the heading with a count interpolation', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const noMatchOccurrences = (src.match(/No positions match your search\./g) || []).length;
  assert.strictEqual(noMatchOccurrences, 1, 'the no-match copy must appear exactly once');
  const headingOccurrences = (src.match(/Unassigned employees \(/g) || []).length;
  assert.strictEqual(headingOccurrences, 1, 'the "Unassigned employees (" heading must appear exactly once');
  assert.match(src, /'Unassigned employees \(' \+ unassigned\.length \+ '\)'/, 'the heading must interpolate a bare count in the same expression');
});

// -----------------------------------------------------------------------
// Task 3: the capability probe, copy-to-target, and the guarded delete —
// every case in this task's <behavior> block.
// -----------------------------------------------------------------------

test('org-positions (x): GET /api/org/capabilities returns a truthy restricted key for an hr-granted member and NO key at all for an other-area member', async () => {
  const deal = freshDeal('deal_orgx', { memberGrants: { pmo_hr: { ddAreas: ['hr'] }, pmo_it: { ddAreas: ['it'] } }, members: ['pmo_hr', 'pmo_it', 'admin'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const hrToken = newSession('pmo_hr', 'pmo'); bindDeal(hrToken, deal.id);
  const itToken = newSession('pmo_it', 'pmo'); bindDeal(itToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const hrRes = await fetch(`${base}/api/org/capabilities`, { headers: { Cookie: cookieHeader(hrToken) } });
    assert.strictEqual(hrRes.status, 200);
    const hrBody = await hrRes.json();
    assert.ok(hrBody.targetOrgDesign, 'the hr-granted caller must see a truthy restricted capability key');

    const itRes = await fetch(`${base}/api/org/capabilities`, { headers: { Cookie: cookieHeader(itToken) } });
    assert.strictEqual(itRes.status, 200);
    const itText = await itRes.text();
    assert.ok(!itText.includes('targetOrgDesign'), 'the it-only caller\'s response must not contain the restricted key at all, absent not false');
    const itBody = JSON.parse(itText);
    assert.strictEqual(itBody.targetOrgDesign, undefined);
  } finally {
    sessionsDb.deleteSession(runtimeConn, hrToken);
    sessionsDb.deleteSession(runtimeConn, itToken);
    server.close();
  }
});

test('org-positions (y): POST /api/org/positions/copy-to-target clones every current position with a new id, remaps reportsToId through the clone map, and never mutates a current row', async () => {
  const deal = freshDeal('deal_orgy', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    async function create(body) {
      const res = await fetch(`${base}/api/org/positions`, {
        method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()).position;
    }

    const root = await create({ title: 'VP Engineering' });
    const child = await create({ title: 'Director', reportsToId: root.id });

    const copyRes = await fetch(`${base}/api/org/positions/copy-to-target`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(copyRes.status, 200);
    const copyBody = await copyRes.json();
    assert.strictEqual(copyBody.count, 2);

    const listRes = await fetch(`${base}/api/org/positions?state=target`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const targetList = await listRes.json();
    assert.strictEqual(targetList.length, 2);

    const clonedRoot = targetList.find((p) => p.title === 'VP Engineering');
    const clonedChild = targetList.find((p) => p.title === 'Director');
    assert.notStrictEqual(clonedRoot.id, root.id, 'the clone must carry a NEW id, not the source id');
    assert.notStrictEqual(clonedChild.id, child.id, 'the clone must carry a NEW id, not the source id');
    assert.strictEqual(clonedChild.reportsToId, clonedRoot.id, 'the clone\'s reportsToId must point at the CLONE of its source\'s parent');
    assert.notStrictEqual(clonedChild.reportsToId, root.id, 'the clone\'s reportsToId must never point at the original current-state parent id');

    const currentListRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const currentList = await currentListRes.json();
    const stillCurrentRoot = currentList.find((p) => p.id === root.id);
    const stillCurrentChild = currentList.find((p) => p.id === child.id);
    assert.ok(stillCurrentRoot, 'the current-state root must be unchanged and still present');
    assert.strictEqual(stillCurrentChild.reportsToId, root.id, 'the current-state child\'s reportsToId must be untouched by the copy');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (z): a second copy-to-target call is refused with 400 while the target design is not empty, and creates no additional rows', async () => {
  const deal = freshDeal('deal_orgz', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Only current position' }),
    });

    const firstCopy = await fetch(`${base}/api/org/positions/copy-to-target`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(firstCopy.status, 200);

    const beforeSecond = await (await fetch(`${base}/api/org/positions?state=target`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();

    const secondCopy = await fetch(`${base}/api/org/positions/copy-to-target`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(secondCopy.status, 400);
    const secondBody = await secondCopy.json();
    assert.match(secondBody.error, /not empty/i);

    const afterSecond = await (await fetch(`${base}/api/org/positions?state=target`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.strictEqual(afterSecond.length, beforeSecond.length, 'the target-state row count must be unchanged after the refused second copy');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (aa): copy-to-target is refused with 403 for a member without the hr grant, and creates no target row', async () => {
  const deal = freshDeal('deal_orgaa', { memberGrants: { pmo_it: { ddAreas: ['it'] } }, members: ['pmo_it', 'admin'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const itToken = newSession('pmo_it', 'pmo'); bindDeal(itToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Seed current position' }),
    });

    const res = await fetch(`${base}/api/org/positions/copy-to-target`, {
      method: 'POST', headers: { Cookie: cookieHeader(itToken), 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.strictEqual(res.status, 403);

    const targetList = await (await fetch(`${base}/api/org/positions?state=target`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.deepStrictEqual(targetList, [], 'a refused copy must create no target row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    sessionsDb.deleteSession(runtimeConn, itToken);
    server.close();
  }
});

test('org-positions (bb): DELETE /api/org/positions/:id is refused with 400 and names the direct-report count while reports exist; the row survives', async () => {
  const deal = freshDeal('deal_orgbb', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    async function create(body) {
      const res = await fetch(`${base}/api/org/positions`, {
        method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()).position;
    }

    const manager = await create({ title: 'Manager with two reports' });
    await create({ title: 'Report one', reportsToId: manager.id });
    await create({ title: 'Report two', reportsToId: manager.id });

    const delRes = await fetch(`${base}/api/org/positions/${manager.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) },
    });
    assert.strictEqual(delRes.status, 400);
    const delBody = await delRes.json();
    assert.match(delBody.error, /2/, 'the refusal message must name the direct-report count');

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const list = await listRes.json();
    assert.ok(list.some((p) => p.id === manager.id), 'the position must survive a refused delete');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (cc): DELETE succeeds once direct reports are reassigned, removing exactly that row', async () => {
  const deal = freshDeal('deal_orgcc', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    async function create(body) {
      const res = await fetch(`${base}/api/org/positions`, {
        method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()).position;
    }
    async function update(body) {
      const res = await fetch(`${base}/api/org/positions`, {
        method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()).position;
    }

    const grandparent = await create({ title: 'Grandparent' });
    const manager = await create({ title: 'Manager', reportsToId: grandparent.id });
    const report = await create({ title: 'Report', reportsToId: manager.id });

    await update({ id: report.id, reportsToId: grandparent.id });

    const delRes = await fetch(`${base}/api/org/positions/${manager.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) },
    });
    assert.strictEqual(delRes.status, 200);

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const list = await listRes.json();
    assert.ok(!list.some((p) => p.id === manager.id), 'the deleted position must be gone');
    assert.strictEqual(list.length, 2, 'exactly the deleted row must be removed');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (dd): DELETE is refused with 403 for a member without the hr grant', async () => {
  const deal = freshDeal('deal_orgdd', { memberGrants: { pmo_it: { ddAreas: ['it'] } }, members: ['pmo_it', 'admin'] });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const itToken = newSession('pmo_it', 'pmo'); bindDeal(itToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const created = await (await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(adminToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Uncleared-delete probe' }),
    })).json();

    const delRes = await fetch(`${base}/api/org/positions/${created.position.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(itToken) },
    });
    assert.strictEqual(delRes.status, 403);

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(adminToken) } });
    const list = await listRes.json();
    assert.ok(list.some((p) => p.id === created.position.id), 'the position must survive a refused delete');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    sessionsDb.deleteSession(runtimeConn, itToken);
    server.close();
  }
});

// -----------------------------------------------------------------------
// Task 3: the employee orphan guard (D-09) — DELETE /api/employees/:id's
// first guard of any kind, for any cross-reference. Genuinely new logic:
// prior to this task the handler was a blind, unconditional filter-and-
// write with no guard whatsoever.
// -----------------------------------------------------------------------

async function createEmployeeFor(base, token, overrides) {
  const res = await fetch(`${base}/api/employees`, {
    method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ name: 'Orphan Guard Subject', role: 'Engineer', department: 'R&D' }, overrides)),
  });
  const body = await res.json();
  return body.employee;
}

async function createPositionFor(base, token, overrides) {
  const res = await fetch(`${base}/api/org/positions`, {
    method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ title: 'Orphan Guard Position' }, overrides)),
  });
  const body = await res.json();
  return body.position;
}

test('org-positions (ee): DELETE /api/employees/:id for an employee occupying one position returns 400 naming that position\'s title, and the employee survives', async () => {
  const deal = freshDeal('deal_orgee', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const employee = await createEmployeeFor(base, pmoToken, { name: 'Held Position' });
    const position = await createPositionFor(base, pmoToken, { title: 'VP Occupied', employeeId: employee.id });

    const delRes = await fetch(`${base}/api/employees/${employee.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(delRes.status, 400);
    const delBody = await delRes.json();
    assert.match(delBody.error, /VP Occupied/, 'the refusal must name the occupied position\'s title');

    const empRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const employees = await empRes.json();
    assert.ok(employees.some((e) => e.id === employee.id), 'the employee must survive the refused delete');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (ff): the SAME delete succeeds (200) once the position\'s employeeId is cleared', async () => {
  const deal = freshDeal('deal_orgff', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const employee = await createEmployeeFor(base, pmoToken, { name: 'Soon Unlinked' });
    const position = await createPositionFor(base, pmoToken, { title: 'VP Soon Vacant', employeeId: employee.id });

    const blockedRes = await fetch(`${base}/api/employees/${employee.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(blockedRes.status, 400);

    await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: position.id, employeeId: null }),
    });

    const delRes = await fetch(`${base}/api/employees/${employee.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(delRes.status, 200);

    const empRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const employees = await empRes.json();
    assert.ok(!employees.some((e) => e.id === employee.id), 'the employee must be removed once unlinked');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (gg): the SAME delete succeeds (200) once the occupied position itself is deleted', async () => {
  const deal = freshDeal('deal_orggg', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const employee = await createEmployeeFor(base, pmoToken, { name: 'Position Deleted' });
    const position = await createPositionFor(base, pmoToken, { title: 'VP To Be Deleted', employeeId: employee.id });

    const blockedRes = await fetch(`${base}/api/employees/${employee.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(blockedRes.status, 400);

    const posDelRes = await fetch(`${base}/api/org/positions/${position.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(posDelRes.status, 200);

    const delRes = await fetch(`${base}/api/employees/${employee.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(delRes.status, 200);
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (hh): an employee occupying positions in BOTH current and target state is refused, and the message reflects more than one position', async () => {
  const deal = freshDeal('deal_orghh', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const employee = await createEmployeeFor(base, pmoToken, { name: 'Dual State Occupant' });
    await createPositionFor(base, pmoToken, { title: 'VP Current Seat', employeeId: employee.id, state: 'current' });
    await createPositionFor(base, pmoToken, { title: 'VP Target Seat', employeeId: employee.id, state: 'target' });

    const delRes = await fetch(`${base}/api/employees/${employee.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(delRes.status, 400);
    const delBody = await delRes.json();
    assert.match(delBody.error, /2/, 'the refusal must reflect that more than one position is affected');

    const empRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const employees = await empRes.json();
    assert.ok(employees.some((e) => e.id === employee.id), 'the employee must survive the refused delete');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (ii): an employee occupying no position is still deletable (200) — the guard is not a blanket block', async () => {
  const deal = freshDeal('deal_orgii', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const employee = await createEmployeeFor(base, pmoToken, { name: 'Unoccupied Roster Member' });

    const delRes = await fetch(`${base}/api/employees/${employee.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(delRes.status, 200);

    const empRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const employees = await empRes.json();
    assert.ok(!employees.some((e) => e.id === employee.id), 'the employee must be removed');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (jj): the guard runs before removal — a refused delete leaves the roster length AND ids byte-identical', async () => {
  const deal = freshDeal('deal_orgjj', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const other = await createEmployeeFor(base, pmoToken, { name: 'Bystander' });
    const employee = await createEmployeeFor(base, pmoToken, { name: 'Roster Length Subject' });
    await createPositionFor(base, pmoToken, { title: 'VP Length Check', employeeId: employee.id });

    const beforeRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const before = await beforeRes.json();

    const delRes = await fetch(`${base}/api/employees/${employee.id}`, { method: 'DELETE', headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(delRes.status, 400);

    const afterRes = await fetch(`${base}/api/employees`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const after = await afterRes.json();
    assert.strictEqual(after.length, before.length, 'the roster length must be unchanged');
    assert.deepStrictEqual(after.map((e) => e.id).sort(), before.map((e) => e.id).sort(), 'the roster ids must be byte-identical');
    assert.ok(other, 'the bystander employee must exist for this comparison to be meaningful');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

// Task 3: the position link picker — source-level assertions on
// public/js/org.js.
test('org-positions (kk): the add/edit form\'s employee-link select offers an explicit unlinked option first, and reads from the already-fetched employees list', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  assert.match(src, /org-add-employee/, 'an employee-link select must exist in the add/edit form');
  assert.match(
    src,
    /state\.employees\.forEach/,
    'the employee-link select must be populated from the already-fetched state.employees list, not a new fetch',
  );
});

test('org-positions (ll): the employee orphan guard\'s early return precedes DELETE /api/employees/:id\'s array filter, so the refusal path never reaches a write', () => {
  const SERVER_JS_PATH = path.join(__dirname, '..', 'server.js');
  const src = fs.readFileSync(SERVER_JS_PATH, 'utf8');
  const handlerMatch = src.match(/app\.delete\('\/api\/employees\/:id',[\s\S]*?\n\}\);/);
  assert.ok(handlerMatch, 'DELETE /api/employees/:id handler must be found in server.js');
  const handlerSrc = handlerMatch[0];
  const guardIdx = handlerSrc.indexOf('if (occupied.length)');
  const filterIdx = handlerSrc.indexOf('.filter(e => e.id !== id)');
  assert.ok(guardIdx !== -1, 'the guard\'s occupied.length check must exist in the handler');
  assert.ok(filterIdx !== -1, 'the employee-removal filter must exist in the handler');
  assert.ok(guardIdx < filterIdx, 'the guard\'s early return must precede the array filter that removes the row');
});

// -----------------------------------------------------------------------
// Plan 08, Task 1: the demo org seed script (D-18) — a source-level proof
// that scripts/seed-org-demo.js runs a truncating WAL checkpoint before it
// closes its connection, the standing trap that has fired in every prior
// phase touching a committed database file (this plan's own objective).
// -----------------------------------------------------------------------

test('org-positions (mm): scripts/seed-org-demo.js calls a truncating wal_checkpoint before closing its connection', () => {
  const SEED_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'seed-org-demo.js');
  const src = fs.readFileSync(SEED_SCRIPT_PATH, 'utf8');
  const checkpointMatch = src.match(/wal_checkpoint\(TRUNCATE\)/);
  assert.ok(checkpointMatch, 'the seed script must call a TRUNCATE-mode wal_checkpoint');
  const closeIdx = src.indexOf('conn.close()');
  assert.ok(closeIdx !== -1, 'the seed script must close its connection');
  assert.ok(
    checkpointMatch.index < closeIdx,
    'the wal_checkpoint(TRUNCATE) call must be positioned before conn.close()',
  );
  // The checkpoint must sit inside the try block of a try/finally whose
  // finally closes the connection — never after close (which would throw
  // on an already-closed handle) and never outside the finally's own scope.
  const finallyIdx = src.indexOf('} finally {');
  assert.ok(finallyIdx !== -1, 'the seed script must use a try/finally around the connection');
  assert.ok(
    checkpointMatch.index < finallyIdx && finallyIdx < closeIdx,
    'the checkpoint must run inside the try block, before the finally block that closes the connection',
  );
});

test('org-positions (nn): scripts/seed-org-demo.js is idempotent by construction — an allowlist delete of its own prefixed ids precedes every insert', () => {
  const SEED_SCRIPT_PATH = path.join(__dirname, '..', 'scripts', 'seed-org-demo.js');
  const src = fs.readFileSync(SEED_SCRIPT_PATH, 'utf8');
  assert.match(src, /DELETE FROM orgPositions WHERE id LIKE 'orgseed_%'/);
  assert.match(src, /DELETE FROM orgDecisions WHERE id LIKE 'orgseed_%'/);
  assert.match(src, /DELETE FROM orgFlightRisks WHERE id LIKE 'orgseed_%'/);
  const firstDeleteIdx = src.indexOf("DELETE FROM orgPositions WHERE id LIKE 'orgseed_%'");
  const firstInsertIdx = src.indexOf('INSERT INTO orgPositions');
  assert.ok(firstDeleteIdx !== -1 && firstInsertIdx !== -1 && firstDeleteIdx < firstInsertIdx,
    'the allowlist delete must precede the insert for the positions table');
});

test('org-positions (oo): the committed demo database carries the seeded org lane — vacant/target/decision-vocabulary/unmitigated-critical content, and all five decision keys in all four languages', () => {
  const DEMO_DB_PATH = path.join(__dirname, '..', 'data', 'demo.db');
  const Database = require('better-sqlite3');
  const db = new Database(DEMO_DB_PATH, { readonly: true });
  try {
    const positions = db.prepare('SELECT data FROM orgPositions').all().map((r) => JSON.parse(r.data));
    const decisions = db.prepare('SELECT data FROM orgDecisions').all().map((r) => JSON.parse(r.data));
    const flightRisks = db.prepare('SELECT data FROM orgFlightRisks').all().map((r) => JSON.parse(r.data));

    assert.ok(positions.some((p) => !p.employeeId), 'at least one vacant position must exist');
    assert.ok(positions.some((p) => p.state === 'target'), 'at least one target-state position must exist');
    const decisionTypes = new Set(decisions.map((d) => d.type));
    ['retain', 'redeploy', 'in-selection', 'redundant', 'open'].forEach((type) => {
      assert.ok(decisionTypes.has(type), `at least one decision entry of type "${type}" must exist`);
    });
    assert.ok(
      flightRisks.some((r) => r.riskLevel === 'critical' && !String(r.mitigation || '').trim()),
      'at least one unmitigated critical flight-risk entry must exist',
    );

    const i18nRow = db.prepare("SELECT data FROM app_state WHERE key = 'i18n'").get();
    const i18n = JSON.parse(i18nRow.data);
    ['org.dec_retain', 'org.dec_redeploy', 'org.dec_in_selection', 'org.dec_redundant', 'org.dec_open'].forEach((key) => {
      ['en', 'de', 'zh', 'cs'].forEach((lang) => {
        assert.ok(
          i18n.strings[lang] && typeof i18n.strings[lang][key] === 'string' && i18n.strings[lang][key].length > 0,
          `${key} must carry a non-empty value for language "${lang}"`,
        );
      });
    });
  } finally {
    db.close();
  }
});

// -----------------------------------------------------------------------
// Plan 08, Task 2 (continuation) — walk-finding-driven regression tests.
// A live browser-automation pass of the Task 2 walk script surfaced five
// findings (F1-F5); this block proves each fix at the level available to
// this repo (no jsdom harness exists here, so client-render contracts are
// verified at the source level, mirroring every other org.js test above).
// -----------------------------------------------------------------------

test('org-positions (pp) [F1]: seedDefaultExpansion() seeds a position id at most ONCE, so a manual collapse at depth 0/1 survives a later re-render', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const fnMatch = src.match(/function seedDefaultExpansion\(tree\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'seedDefaultExpansion() must exist');
  const body = fnMatch[0];
  // The bug: expandedIds.add() called unconditionally for every depth-0/1
  // node on every render pass, so the toggle's own delete-then-renderTree()
  // sequence re-added the id it had just removed in the same tick. The fix
  // must guard the add behind a once-only marker that is itself set true
  // the first (and only the first) time a given id is seen.
  assert.match(
    body,
    /if\s*\(\s*!seededPositionIds\[node\.position\.id\]\s*\)\s*\{[\s\S]*?expandedIds\.add\(node\.position\.id\);[\s\S]*?seededPositionIds\[node\.position\.id\]\s*=\s*true;[\s\S]*?\}/,
    'expandedIds.add() must be guarded by a once-only seededPositionIds marker — an unconditional add on every render pass silently undoes a manual collapse at depth 0/1 (T-06-08 Plan 08 walk finding F1)',
  );
  // The guard hash itself must be declared exactly once, module-level, as a
  // plain object — never a second Set (this file holds exactly one Set
  // instance, proven by test (r) above).
  assert.match(src, /var seededPositionIds\s*=\s*\{\s*\}/, 'seededPositionIds must be declared as a plain-object hash');
});

test('org-positions (qq) [F3]: GET /api/org/decisions is fetched ONLY inside the branch guarded by the already-resolved capabilities.targetOrgDesign — never unconditionally alongside the capability probe itself', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const loadMatch = src.match(/function load\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(loadMatch, 'load() must exist');
  const body = loadMatch[0];
  // Exactly one fetch call to the decisions endpoint inside load().
  const decisionsFetchOccurrences = (body.match(/fetch\('\/api\/org\/decisions'\)/g) || []).length;
  assert.strictEqual(decisionsFetchOccurrences, 1, 'load() must issue exactly one GET /api/org/decisions fetch');
  // It must NOT sit inside the initial Promise.all alongside the
  // capabilities probe (that fan-out must resolve first) — the decisions
  // fetch must appear textually AFTER the capabilities assignment and
  // after an `if (!capabilities.targetOrgDesign)` early-return guard.
  const capsAssignIdx = body.indexOf('capabilities = ');
  const guardIdx = body.indexOf('if (!capabilities.targetOrgDesign)');
  const decisionsFetchIdx = body.indexOf("fetch('/api/org/decisions')");
  assert.ok(capsAssignIdx !== -1 && guardIdx !== -1 && decisionsFetchIdx !== -1, 'load() must resolve capabilities, then guard, then conditionally fetch decisions');
  assert.ok(
    capsAssignIdx < guardIdx && guardIdx < decisionsFetchIdx,
    'the decisions fetch must be positioned AFTER capabilities has resolved and AFTER the targetOrgDesign guard — an uncleared caller must issue zero requests to a route the server would only 403, not one console error per page load (T-06-08 Plan 08 walk finding F3)',
  );
});

test('org-positions (rr) [F3]: the decision badge and the Decisions history toggle are constructed ONLY inside the capabilities.targetOrgDesign branch in renderNode() — never unconditionally', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  const fnMatch = src.match(/function renderNode\(node, depth, searchActive, relevantIds\)\s*\{[\s\S]*?\n    return article;\n  \}/);
  assert.ok(fnMatch, 'renderNode() must exist');
  const body = fnMatch[0];
  assert.match(
    body,
    /if\s*\(capabilities\.targetOrgDesign\)\s*\{[\s\S]*?org-node-decision[\s\S]*?\}/,
    'the decision badge must be constructed only inside an `if (capabilities.targetOrgDesign)` branch — UI-SPEC Design Tension 3 states decision badges are never inserted into the DOM for an uncleared member (T-06-08 Plan 08 walk finding F3)',
  );
  assert.match(
    body,
    /if\s*\(capabilities\.targetOrgDesign\)\s*\{[\s\S]*?org-node-history-toggle[\s\S]*?\}/,
    'the Decisions history toggle must be constructed only inside an `if (capabilities.targetOrgDesign)` branch — an uncleared caller must never be shown a working toggle into a decision log the server would refuse to return',
  );
});

test('org-positions (ss) [F5]: orgSummaryFor() against the committed demo database gives karen (the seeded owner) a positive mine.unmitigatedFlightRisks count — the D-22 owner nudge must fire on seeded data', () => {
  const DEMO_DB_PATH = path.join(__dirname, '..', 'data', 'demo.db');
  const Database = require('better-sqlite3');
  const rawDb = new Database(DEMO_DB_PATH, { readonly: true });
  try {
    const db = {
      orgPositions: rawDb.prepare('SELECT data FROM orgPositions').all().map((r) => JSON.parse(r.data)),
      orgDecisions: rawDb.prepare('SELECT data FROM orgDecisions').all().map((r) => JSON.parse(r.data)),
      orgFlightRisks: rawDb.prepare('SELECT data FROM orgFlightRisks').all().map((r) => JSON.parse(r.data)),
    };
    const deal = { memberGrants: {}, members: ['karen'] };
    const karen = { username: 'karen', role: 'hrbp' }; // hrbp short-circuits accessPolicy's area grant, same as the seed's own BASELINE_ACTOR persona
    const summary = app.orgSummaryFor(db, deal, karen);
    assert.ok(summary.restricted, 'karen (hrbp) must be granted the restricted tier');
    assert.ok(
      summary.restricted.mine.unmitigatedFlightRisks > 0,
      'karen must own at least one unmitigated high/critical flight-risk entry on the seeded demo data — a display-name owner ("Karen Peterson") can never match `req.portalUser.username` ("karen"), which is why this was 0 before the fix (T-06-08 Plan 08 walk finding F5)',
    );
  } finally {
    rawDb.close();
  }
});

test('org-positions (tt) [F5]: the committed demo database\'s seeded flight-risk owners are literal usernames, never a display name', () => {
  const DEMO_DB_PATH = path.join(__dirname, '..', 'data', 'demo.db');
  const Database = require('better-sqlite3');
  const db = new Database(DEMO_DB_PATH, { readonly: true });
  try {
    const risks = db.prepare("SELECT data FROM orgFlightRisks WHERE id LIKE 'orgseed_%'").all().map((r) => JSON.parse(r.data));
    assert.ok(risks.length > 0, 'the seed must have written flight-risk rows');
    risks.forEach((r) => {
      assert.strictEqual(r.owner, 'karen', `orgFlightRisks row ${r.id} must carry the literal username 'karen' as owner, not a display name`);
    });
  } finally {
    db.close();
  }
});

// F2 (i18n re-apply on dynamic render) and F4 (decision badge no longer
// occludes card content) — cheap source-level checks extending coverage
// beyond the F1/F3/F5 tests the plan explicitly named.

test('org-positions (uu) [F2]: renderTree() and renderStateSwitch() re-apply i18n after every dynamic render, and the switch labels carry data-i18n', () => {
  const src = fs.readFileSync(ORG_JS_PATH, 'utf8');
  assert.match(src, /function applyI18n\(\)\s*\{\s*if\s*\(window\.applyPortalI18n\)\s*window\.applyPortalI18n\(\);\s*\}/, 'org.js must define a local applyI18n() re-apply helper, mirroring execution.js/assessments.js\'s established idiom');
  const treeFnMatch = src.match(/function renderTree\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(treeFnMatch, 'renderTree() must exist');
  assert.match(treeFnMatch[0], /applyI18n\(\);/, 'renderTree() must call applyI18n() so dynamically-inserted decision badges/history pills are translated even when the language dictionary loaded before this page\'s async render completed');
  const switchFnMatch = src.match(/function renderStateSwitch\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(switchFnMatch, 'renderStateSwitch() must exist');
  assert.match(switchFnMatch[0], /currentLabel\.setAttribute\('data-i18n',\s*'org\.switch_current'\)/, 'the Current switch label must carry a data-i18n attribute');
  assert.match(switchFnMatch[0], /targetLabel\.setAttribute\('data-i18n',\s*'org\.switch_target'\)/, 'the Target switch label must carry a data-i18n attribute');
  assert.match(switchFnMatch[0], /applyI18n\(\);/, 'renderStateSwitch() must call applyI18n() after inserting the labels');
});

test('org-positions (vv) [F2]: deal-home.js re-applies i18n after rendering the org panel\'s translated decision-type labels', () => {
  const DEAL_HOME_JS_PATH = path.join(__dirname, '..', 'public', 'js', 'deal-home.js');
  const src = fs.readFileSync(DEAL_HOME_JS_PATH, 'utf8');
  const renderDealHomeMatch = src.match(/function renderDealHome\(dealId\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(renderDealHomeMatch, 'renderDealHome() must exist');
  assert.match(
    renderDealHomeMatch[0],
    /if\s*\(window\.applyPortalI18n\)\s*window\.applyPortalI18n\(\);/,
    'renderDealHome() must re-apply i18n after its Promise.all render pass — the org panel\'s decision-type labels carry data-i18n but are built after transitions.js\'s own one-time apply already ran',
  );
});

test('org-positions (ww) [F4]: the decision badge no longer sits at a fixed absolute position — it participates in layout flow inside its own wrapper', () => {
  const orgHtmlSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'org.html'), 'utf8');
  const ruleMatch = orgHtmlSrc.match(/\.org-node-decision\{([^}]*)\}/);
  assert.ok(ruleMatch, '.org-node-decision rule must exist');
  assert.ok(!ruleMatch[1].includes('position:absolute'), '.org-node-decision must not be absolute-positioned — an absolute top-right pill occluded the Delete button and the occupant name at several widths (T-06-08 Plan 08 walk finding F4)');
  assert.match(orgHtmlSrc, /\.org-node-decision-wrap\{[^}]*text-align:right[^}]*\}/, 'a right-aligned wrapper rule for the decision badge must exist so it renders on its own line, never overlapping the interactive row below it');

  const orgJsSrc = fs.readFileSync(ORG_JS_PATH, 'utf8');
  assert.match(orgJsSrc, /className:\s*'org-node-decision-wrap'/, 'org.js must construct the decision badge inside the org-node-decision-wrap container');
});

// -----------------------------------------------------------------------
// WR-01 (06-REVIEW.md): POST /api/org/positions never validated that
// employeeId names a real employee — mirrors POST /api/org/flight-risk's
// pre-existing employeeId-existence check (test/org-flight-risk-audit.test.js
// (i)), extended to both the create and update branches. Vacant
// (null/omitted) stays valid per D-05.
// -----------------------------------------------------------------------

test('org-positions (xx) [WR-01]: POST create with a bogus employeeId returns 404 and creates no row', async () => {
  const deal = freshDeal('deal_orgxx', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bogus Occupant Position', employeeId: 'emp_does_not_exist' }),
    });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /could not be found/i);

    const listRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const list = await listRes.json();
    assert.ok(!list.some((p) => p.title === 'Bogus Occupant Position'), 'a refused create must persist no row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (yy) [WR-01]: POST create with a valid roster employeeId returns 201, and with employeeId omitted (vacant) returns 201', async () => {
  const deal = freshDeal('deal_orgyy', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const employee = await createEmployeeFor(base, pmoToken, { name: 'Real Roster Member' });

    const validRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Occupied Position', employeeId: employee.id }),
    });
    assert.strictEqual(validRes.status, 201);
    const validBody = await validRes.json();
    assert.strictEqual(validBody.position.employeeId, employee.id);

    const vacantRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Vacant Position' }),
    });
    assert.strictEqual(vacantRes.status, 201, 'D-05: an omitted employeeId must stay valid — vacant is a first-class state, not a validation failure');
    const vacantBody = await vacantRes.json();
    assert.strictEqual(vacantBody.position.employeeId, null);
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('org-positions (zz) [WR-01]: POST update (id present) with a bogus employeeId returns 404 and leaves the stored employeeId unchanged; a valid roster id and an explicit null both succeed', async () => {
  const deal = freshDeal('deal_orgzz', { memberGrants: { pmo: { ddAreas: ['hr'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const position = await createPositionFor(base, pmoToken, { title: 'Update-target position' });

    const badRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: position.id, employeeId: 'emp_still_does_not_exist' }),
    });
    assert.strictEqual(badRes.status, 404);
    const badBody = await badRes.json();
    assert.match(badBody.error, /could not be found/i);

    const afterBadRes = await fetch(`${base}/api/org/positions`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const afterBad = (await afterBadRes.json()).find((p) => p.id === position.id);
    assert.strictEqual(afterBad.employeeId, null, 'the refused update must not have persisted the bogus employeeId');

    const employee = await createEmployeeFor(base, pmoToken, { name: 'Update Roster Member' });
    const goodRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: position.id, employeeId: employee.id }),
    });
    assert.strictEqual(goodRes.status, 200);
    const goodBody = await goodRes.json();
    assert.strictEqual(goodBody.position.employeeId, employee.id);

    const nullRes = await fetch(`${base}/api/org/positions`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: position.id, employeeId: null }),
    });
    assert.strictEqual(nullRes.status, 200, 'clearing employeeId back to null (vacating the position) must stay valid');
    const nullBody = await nullRes.json();
    assert.strictEqual(nullBody.position.employeeId, null);
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});
