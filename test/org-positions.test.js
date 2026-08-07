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
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');
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
  const server = app.listen(0);
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
  const server = app.listen(0);
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
  const server = app.listen(0);
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
