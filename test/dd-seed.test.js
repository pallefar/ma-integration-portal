// DD-01 / D-13: proves the standard DD request checklist seeding + instantiate
// slice end to end through the REAL HTTP stack — a freshly created deal holds
// exactly one 80-item template row, an IL cleared for every area instantiates
// all 80 with zero skipped, a second instantiate call is a no-op (dedup by
// the 'ddtemplate:<templateId>:<itemId>' source string), adding one template
// item and re-instantiating creates exactly that one new item, a member
// cleared for only ONE area materialises only that area's items (never
// leaking an uncleared area's content into a bulk write — T-04-16), deleting
// an instantiated item never mutates the shared template row, and an unknown
// templateId 404s with nothing created.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-workspace.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/dd-seed.test.js` (or `npm test`). Never `node --test test/` (the
// directory argument is mis-parsed on this Node version).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dd-seed-'));
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
const { seedDdRequestTemplates } = require('../scripts/seed-dd-request-templates.js');

// Seed the standard template into the harness's OWN temp demo database
// BEFORE any deal is created — this harness's demo.db is a bare-schema file
// with no rows at all (it is never derived from the committed data/demo.db,
// unlike the live app), so without this call the allowlist copy would have
// nothing to copy.
seedDdRequestTemplates(process.env.MA_DEMO_DB_PATH);

const app = require('../server.js');
// GD-3 (CONC-02 gap closure): this suite's subject is not the version contract — supply the held-version precondition a real client sends.
require('./helpers/held-version.js').installHeldVersionFetch();

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
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(), ...overrides,
  };
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

/** Direct-SQL read of a deal's own `ddRequestTemplates` row — uses the SAME
 * cached connection db/resolver.js would hand a request bound to this deal
 * (db/store.js#getOrOpenConnection), so a write here is visible to the very
 * next readDb() call inside an HTTP request without any extra invalidation. */
function readTemplateRow(dealId, templateId) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  return conn.prepare('SELECT data FROM ddRequestTemplates WHERE id = ?').get(templateId);
}

/** Appends one item to a deal's own ddtpl_standard row (direct SQL, bypassing
 * any HTTP route — there is no write route for template content itself). */
function addTemplateItem(dealId, item) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  const row = conn.prepare('SELECT data FROM ddRequestTemplates WHERE id = ?').get('ddtpl_standard');
  const tpl = JSON.parse(row.data);
  tpl.items.push(item);
  conn.prepare('UPDATE ddRequestTemplates SET data = ? WHERE id = ?').run(JSON.stringify(tpl), 'ddtpl_standard');
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('dd-seed (a): a freshly created deal database holds exactly one template row with 80 items', async () => {
  const deal = freshDeal('deal_ddseeda');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const row = readTemplateRow(deal.id, 'ddtpl_standard');
  assert.ok(row, 'the deal database must carry the ddtpl_standard row');
  const tpl = JSON.parse(row.data);
  assert.strictEqual(tpl.items.length, 80);

  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(deal.id), dbFiles.DEAL_SCHEMA_PATH);
  const rowCount = conn.prepare('SELECT COUNT(*) c FROM ddRequestTemplates').get().c;
  assert.strictEqual(rowCount, 1, 'exactly one template row, never a second');
});

test('dd-seed (b): an IL cleared for every area instantiates 80/0, a repeat call is a no-op, and adding one template item creates exactly one more', async () => {
  const deal = freshDeal('deal_ddseedb');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const first = await (await fetch(`${base}/api/dd/request-items/instantiate`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'ddtpl_standard' }),
    })).json();
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.created, 80, 'an IL cleared for every area must materialise all 80 items');
    assert.strictEqual(first.skipped, 0, 'a fully-cleared caller skips nothing');

    const afterFirst = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(afterFirst.length, 80);

    // (c) a second instantiate call on the same deal is a dedup no-op.
    const second = await (await fetch(`${base}/api/dd/request-items/instantiate`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'ddtpl_standard' }),
    })).json();
    assert.strictEqual(second.created, 0, 're-running after nothing changed must create zero new items');

    const afterSecond = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(afterSecond.length, 80, 'the deal item count must stay at 80, never double to 160');

    // (d) adding one extra template item and re-instantiating creates exactly
    // that one new item.
    addTemplateItem(deal.id, { id: 'dd_legal_11', area: 'legal', text: 'A newly added standard item', ownerHint: 'Legal' });
    const third = await (await fetch(`${base}/api/dd/request-items/instantiate`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'ddtpl_standard' }),
    })).json();
    assert.strictEqual(third.created, 1, 'only the newly added template item should be created');

    const afterThird = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(afterThird.length, 81);
    assert.ok(afterThird.some((i) => i.text === 'A newly added standard item'));
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-seed (e): a member cleared only for legal instantiates 10/70 and reads back exactly 10 items, never 80', async () => {
  const deal = freshDeal('deal_ddseede', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const result = await (await fetch(`${base}/api/dd/request-items/instantiate`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'ddtpl_standard' }),
    })).json();
    assert.strictEqual(result.created, 10, 'only the legal area\'s 10 items may be materialised');
    assert.strictEqual(result.skipped, 70, 'every item outside legal must be counted as skipped, never created');

    const items = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.strictEqual(items.length, 10, 'the caller must read back exactly the 10 legal items, never all 80');
    assert.ok(items.every((i) => i.area === 'legal'));
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-seed (f): deleting an instantiated item leaves the template row byte-identical', async () => {
  const deal = freshDeal('deal_ddseedf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const beforeRow = readTemplateRow(deal.id, 'ddtpl_standard');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/dd/request-items/instantiate`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'ddtpl_standard' }),
    });
    const items = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const target = items[0];

    const deleteRes = await fetch(`${base}/api/dd/request-items/${target.id}`, {
      method: 'DELETE', headers: { Cookie: cookieHeader(karenToken) },
    });
    assert.strictEqual(deleteRes.status, 200);

    const afterRow = readTemplateRow(deal.id, 'ddtpl_standard');
    assert.strictEqual(afterRow.data, beforeRow.data, 'deleting a live item must never mutate the shared template row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-seed (g): an unknown templateId 404s and creates no items', async () => {
  const deal = freshDeal('deal_ddseedg');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/dd/request-items/instantiate`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'ddtpl_totally_unknown' }),
    });
    assert.strictEqual(res.status, 404);

    const items = await (await fetch(`${base}/api/dd/request-items`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(items.length, 0, 'an unknown templateId must create nothing');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});
