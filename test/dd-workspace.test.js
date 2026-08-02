// DD-01 / DD-04 / D-10 / D-16 / D-23: proves the due-diligence request-item
// tracer slice end-to-end through the REAL HTTP stack — an Integration Lead
// creates a `legal` request item and reads it back, a member granted only
// `legal` sees it, a member with no area grant at all sees nothing (even
// though the item exists in that same deal's own database file), duplicate
// text never collides on an id, an empty deal returns `[]` with status 200,
// repeat reads preserve stable insertion order, and two concurrent creates
// both persist.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/deal-lifecycle.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/dd-workspace.test.js` (or `npm test`). Never `node --test test/` (the
// directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dd-workspace-'));
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

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/deal-lifecycle.test.js).
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
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
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

test('dd-workspace (a): an IL creates a legal item and reads it back; a member granted only legal also sees it', async () => {
  const deal = freshDeal('deal_ddwka', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Confirm cap table' }),
    });
    assert.strictEqual(createRes.status, 201, 'the IL must be able to create a legal item');
    const { item } = await createRes.json();
    assert.strictEqual(item.area, 'legal');
    assert.strictEqual(item.text, 'Confirm cap table');

    const ilList = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.ok(ilList.some((i) => i.id === item.id), 'the IL must be able to read the item back');

    const pmoList = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.ok(pmoList.some((i) => i.id === item.id), 'a member granted only legal must see a legal item');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-workspace (b): a member with no area grant at all receives an empty array even though a legal item exists in the same deal', async () => {
  const deal = freshDeal('deal_ddwkb'); // memberGrants: {} — no entry for pmo at all
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Legal item pmo must never see' }),
    });

    const pmoRes = await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(pmoRes.status, 200, 'an empty-grant caller must still get 200, never a server error');
    const pmoList = await pmoRes.json();
    assert.deepStrictEqual(pmoList, [], 'a member with no memberGrants entry at all must see no items');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-workspace (c): duplicate text produces distinct ids; an empty deal returns [] with status 200', async () => {
  const deal = freshDeal('deal_ddwkc');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const emptyRes = await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } });
    assert.strictEqual(emptyRes.status, 200);
    assert.deepStrictEqual(await emptyRes.json(), [], 'a deal with zero DD request items must return an empty array, never null/404');

    const create = () => fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Duplicate text item' }),
    }).then((r) => r.json());
    const r1 = await create();
    const r2 = await create();
    assert.notStrictEqual(r1.item.id, r2.item.id, 'two items with identical text must get distinct ids');
    assert.strictEqual(r1.item.text, r2.item.text);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-workspace (d): two items sharing a due date and status are returned in stable insertion order across repeated reads', async () => {
  const deal = freshDeal('deal_ddwkd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const create = (text) => fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text, dueDate: '2099-01-01' }),
    }).then((r) => r.json());
    const first = await create('First item');
    const second = await create('Second item');

    const read1 = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const read2 = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const order1 = read1.map((i) => i.id);
    const order2 = read2.map((i) => i.id);
    assert.deepStrictEqual(order1, order2, 'repeated reads must return the identical order');
    assert.deepStrictEqual(order1, [first.item.id, second.item.id], 'insertion order must be preserved');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-workspace (e): two concurrent creates against the same deal both persist', async () => {
  const deal = freshDeal('deal_ddwke');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const create = (text) => fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text }),
    }).then((r) => r.json());

    const [a, b] = await Promise.all([create('Concurrent A'), create('Concurrent B')]);
    assert.strictEqual(a.success, true);
    assert.strictEqual(b.success, true);
    assert.notStrictEqual(a.item.id, b.item.id);

    const list = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.ok(list.some((i) => i.id === a.item.id), 'the first concurrent create must have persisted');
    assert.ok(list.some((i) => i.id === b.item.id), 'the second concurrent create must have persisted');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-workspace (f): overdue is computed on read — past-due & not-closed is true, the same item closed is false, no due date is false', async () => {
  const deal = freshDeal('deal_ddwkf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'Overdue candidate', dueDate: '2000-01-01', status: 'requested' }),
    });
    const { item } = await createRes.json();
    assert.strictEqual(item.overdue, true, 'a past-due, non-closed item must report overdue: true');

    const closeRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, status: 'closed' }),
    });
    const closed = await closeRes.json();
    assert.strictEqual(closed.item.overdue, false, 'a closed item must never report overdue: true regardless of due date');

    const noDueRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'No due date item' }),
    });
    const noDue = await noDueRes.json();
    assert.strictEqual(noDue.item.overdue, false, 'an item with no due date must never report overdue: true');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-workspace (g): a member cleared for financial gets a byte-identical uniform 403 for an unknown item id and for a legal item they are not cleared for', async () => {
  const deal = freshDeal('deal_ddwkg', { memberGrants: { pmo: { ddAreas: ['financial'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'A legal item pmo cannot reach by id' }),
    });
    const { item } = await createRes.json();

    const unclearedRes = await fetch(`${base}/api/dd/request-items/${item.id}`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const unclearedBody = await unclearedRes.json();

    const unknownRes = await fetch(`${base}/api/dd/request-items/ddreq_totally_unknown_id`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const unknownBody = await unknownRes.json();

    assert.strictEqual(unclearedRes.status, 403, 'an uncleared-area item must 403');
    assert.strictEqual(unknownRes.status, 403, 'an unknown item id must ALSO 403 (no 404 branch on DD by-id routes)');
    assert.deepStrictEqual(unclearedBody, unknownBody, 'an unknown id and an uncleared-area id must return byte-identical response bodies (DD-04 anti-enumeration)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-workspace (h): a member cleared for legal is refused moving their own item into tax without clearance for tax; the item stays in legal', async () => {
  const deal = freshDeal('deal_ddwkh', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', text: 'pmo-owned legal item' }),
    });
    const { item } = await createRes.json();

    const moveRes = await fetch(`${base}/api/dd/request-items`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, area: 'tax' }),
    });
    assert.strictEqual(moveRes.status, 403, 'moving an item into an uncleared area must be refused');

    const stillRes = await fetch(`${base}/api/dd/request-items/${item.id}`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(stillRes.status, 200);
    const still = await stillRes.json();
    assert.strictEqual(still.area, 'legal', 'a refused move must leave the item in its original area, unmutated');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});
