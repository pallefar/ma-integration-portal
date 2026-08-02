// DD-01 / DD-02 / D-03 / D-15 / D-16: proves GET /api/dd/summary — the
// clearance-scoped diligence rollup — end to end through the REAL HTTP
// stack. An IL sees all eight areas with correct per-status counts; a member
// cleared for two areas sees exactly those two entries, the other six
// entirely absent; `totals` sums only what was actually returned, never the
// deal's true totals; overdue is computed once and agrees with the item
// routes; findings tally by all four severities; `mine` counts only rows
// owned by the calling username; and an empty deal returns zeroed
// structures rather than a missing key or an error.
//
// Task 2 extends this file with source-level assertions on the new
// deal-home.js/dashboard.js/due-diligence.js wiring.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-workspace.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/dd-summary.test.js` (or `npm test`). Never `node --test test/` (the
// directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dd-summary-'));
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

function createItem(base, token, body) {
  return fetch(`${base}/api/dd/request-items`, {
    method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}
function createFinding(base, token, body) {
  return fetch(`${base}/api/dd/findings`, {
    method: 'POST', headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());
}
function getSummary(base, token) {
  return fetch(`${base}/api/dd/summary`, { headers: { Cookie: cookieHeader(token) } })
    .then((r) => r.json().then((body) => ({ status: r.status, body })));
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('dd-summary (a): an IL sees all eight areas with correct per-status counts', async () => {
  const deal = freshDeal('deal_dsa');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await createItem(base, karenToken, { area: 'legal', text: 'Legal item one' });
    const r2 = await createItem(base, karenToken, { area: 'legal', text: 'Legal item two' });
    await createItem(base, karenToken, { id: r2.item.id, status: 'closed' });
    // POST /api/dd/request-items ignores a `status` field on CREATE (always
    // 'open' — server.js's own create branch never reads b.status); the
    // status must be set via a follow-up update, mirroring the closed item
    // above.
    const r4 = await createItem(base, karenToken, { area: 'financial', text: 'Financial item' });
    await createItem(base, karenToken, { id: r4.item.id, status: 'requested' });

    const { status, body } = await getSummary(base, karenToken);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.areas.length, 8, 'admin/hrbp is cleared for every one of the eight DD_AREAS');

    const legal = body.areas.find((a) => a.area === 'legal');
    assert.strictEqual(legal.items.total, 2);
    assert.strictEqual(legal.items.open, 1);
    assert.strictEqual(legal.items.closed, 1);

    const financial = body.areas.find((a) => a.area === 'financial');
    assert.strictEqual(financial.items.total, 1);
    assert.strictEqual(financial.items.requested, 1);

    const hr = body.areas.find((a) => a.area === 'hr');
    assert.strictEqual(hr.items.total, 0, 'an area with no items must still be returned, zeroed');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-summary (b): a member cleared for exactly two areas sees exactly two entries; the other six are entirely absent', async () => {
  const deal = freshDeal('deal_dsb', { memberGrants: { pmo: { ddAreas: ['legal', 'financial'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await createItem(base, karenToken, { area: 'legal', text: 'Legal item pmo can see' });
    await createItem(base, karenToken, { area: 'financial', text: 'Financial item pmo can see' });
    await createItem(base, karenToken, { area: 'hr', text: 'HR item pmo must never see' });

    const { status, body } = await getSummary(base, pmoToken);
    assert.strictEqual(status, 200);
    assert.strictEqual(body.areas.length, 2, 'exactly two areas must be returned');
    const ids = body.areas.map((a) => a.area).sort();
    assert.deepStrictEqual(ids, ['financial', 'legal'], 'the returned area ids must be exactly the granted ones');
    assert.ok(!body.areas.some((a) => a.area === 'hr'), 'an uncleared area must be entirely absent, never present with zeroes');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-summary (c): totals equal the sum of the returned areas, not the deal\'s true totals', async () => {
  const deal = freshDeal('deal_dsc', { memberGrants: { pmo: { ddAreas: ['legal'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await createItem(base, karenToken, { area: 'legal', text: 'Legal item A' });
    await createItem(base, karenToken, { area: 'legal', text: 'Legal item B' });
    await createItem(base, karenToken, { area: 'financial', text: 'Financial item pmo cannot see' });
    await createItem(base, karenToken, { area: 'hr', text: 'HR item pmo cannot see' });

    const karenSummary = await getSummary(base, karenToken);
    assert.strictEqual(karenSummary.body.totals.items, 4, 'the IL sees the deal\'s true total');

    const pmoSummary = await getSummary(base, pmoToken);
    assert.strictEqual(pmoSummary.body.totals.items, 2, 'pmo\'s totals must equal only their own two legal items, not the deal\'s full four');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-summary (d): a past-due, non-closed item is counted as overdue in exactly one area', async () => {
  const deal = freshDeal('deal_dsd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await createItem(base, karenToken, { area: 'legal', text: 'Overdue legal item', dueDate: '2000-01-01', status: 'requested' });
    await createItem(base, karenToken, { area: 'legal', text: 'Not overdue', dueDate: '2099-01-01' });

    const { body } = await getSummary(base, karenToken);
    const legal = body.areas.find((a) => a.area === 'legal');
    assert.strictEqual(legal.items.overdue, 1, 'exactly one item in legal is overdue');
    assert.strictEqual(body.totals.overdue, 1);
    const financial = body.areas.find((a) => a.area === 'financial');
    assert.strictEqual(financial.items.overdue, 0, 'an untouched area must report zero overdue');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-summary (e): a closed past-due item is never counted as overdue', async () => {
  const deal = freshDeal('deal_dse');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const created = await createItem(base, karenToken, { area: 'legal', text: 'Was overdue, now closed', dueDate: '2000-01-01', status: 'requested' });
    await createItem(base, karenToken, { id: created.item.id, status: 'closed' });

    const { body } = await getSummary(base, karenToken);
    const legal = body.areas.find((a) => a.area === 'legal');
    assert.strictEqual(legal.items.overdue, 0, 'a closed item must never count as overdue regardless of its due date');
    assert.strictEqual(body.totals.overdue, 0);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-summary (f): findings are tallied by each of the four severities, including critical', async () => {
  const deal = freshDeal('deal_dsf');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    for (const severity of ['low', 'medium', 'high', 'critical']) {
      await createFinding(base, karenToken, { area: 'legal', title: `A ${severity} finding`, severity });
    }

    const { body } = await getSummary(base, karenToken);
    const legal = body.areas.find((a) => a.area === 'legal');
    assert.strictEqual(legal.findings.total, 4);
    assert.strictEqual(legal.findings.low, 1);
    assert.strictEqual(legal.findings.medium, 1);
    assert.strictEqual(legal.findings.high, 1);
    assert.strictEqual(legal.findings.critical, 1);
    assert.strictEqual(body.totals.findings, 4);
    assert.strictEqual(body.totals.criticalFindings, 1);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-summary (g): `mine` counts only rows owned by the calling username, within the caller\'s own cleared areas', async () => {
  const deal = freshDeal('deal_dsg', { memberGrants: { pmo: { ddAreas: ['legal', 'financial'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await createItem(base, karenToken, { area: 'legal', text: 'Owned by pmo, open', owner: 'pmo' });
    await createItem(base, karenToken, { area: 'legal', text: 'Owned by pmo, overdue', owner: 'pmo', dueDate: '2000-01-01', status: 'requested' });
    await createItem(base, karenToken, { area: 'financial', text: 'Owned by karen, not pmo', owner: 'karen' });
    await createFinding(base, karenToken, { area: 'legal', title: 'Owned by pmo finding', owner: 'pmo' });

    const pmoSummary = await getSummary(base, pmoToken);
    assert.strictEqual(pmoSummary.body.mine.openItems, 2, 'both pmo-owned items are open');
    assert.strictEqual(pmoSummary.body.mine.overdueItems, 1, 'exactly one pmo-owned item is overdue');
    assert.strictEqual(pmoSummary.body.mine.openFindings, 1);

    const karenSummary = await getSummary(base, karenToken);
    assert.strictEqual(karenSummary.body.mine.openItems, 1, 'karen only owns her own single item, not pmo\'s two');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-summary (h): a deal with no items and no findings returns zeroed structures, never a missing key or an error', async () => {
  const deal = freshDeal('deal_dsh');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const { status, body } = await getSummary(base, karenToken);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.areas), 'areas must be an array even on an empty deal');
    assert.strictEqual(body.areas.length, 8, 'the IL is still cleared for all eight areas even with zero content');
    body.areas.forEach((a) => {
      assert.strictEqual(a.items.total, 0);
      assert.strictEqual(a.findings.total, 0);
    });
    assert.deepStrictEqual(body.totals, { items: 0, overdue: 0, findings: 0, criticalFindings: 0 });
    assert.deepStrictEqual(body.mine, { openItems: 0, overdueItems: 0, openFindings: 0 });
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});
