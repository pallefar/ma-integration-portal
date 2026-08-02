// DD-02 / DD-03 / D-11 / D-25 / D-26: proves the DD findings register and its
// one-click conversion end-to-end through the REAL HTTP stack.
//
// Task 1 (this file's initial content): findings are recordable with a
// severity/area/owner and readable back, guarded by the exact same
// clean-room discipline (filterByAreaGrant()/assertAreaGrant()/
// refuseDdArea()) as test/dd-workspace.test.js's request items.
//
// Task 2 extends this file with the four-level RAID_LEVELS round-trip cases.
// Task 3 extends this file with the one-click conversion cases.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-workspace.test.js's own established harness shape.
//
// node:test — Node's built-in runner. Run via `node --test
// test/dd-findings.test.js` (or `npm test`). Never `node --test test/` (the
// directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-dd-findings-'));
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
    id, name: id, targetCompany: id + ' Co', members: ['karen', 'pmo'], memberGrants: {},
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

test('dd-findings (a): a finding is creatable with each of the four severities and reads back unchanged', async () => {
  const deal = freshDeal('deal_ddfa');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    for (const severity of ['low', 'medium', 'high', 'critical']) {
      const createRes = await fetch(`${base}/api/dd/findings`, {
        method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ area: 'legal', title: `A ${severity} finding`, severity, owner: 'Karen' }),
      });
      assert.strictEqual(createRes.status, 201);
      const { finding } = await createRes.json();
      assert.strictEqual(finding.severity, severity, `a finding created with severity ${severity} must be stored as ${severity}`);

      const readRes = await fetch(`${base}/api/dd/findings/${finding.id}`, { headers: { Cookie: cookieHeader(karenToken) } });
      assert.strictEqual(readRes.status, 200);
      const read = await readRes.json();
      assert.strictEqual(read.severity, severity, `a finding created with severity ${severity} must read back as ${severity}, never downgraded`);
      assert.strictEqual(read.area, 'legal');
      assert.strictEqual(read.owner, 'Karen');
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (b): two findings with identical title, area and severity get distinct ids', async () => {
  const deal = freshDeal('deal_ddfb');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const create = () => fetch(`${base}/api/dd/findings`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'financial', title: 'Duplicate finding title', severity: 'high' }),
    }).then((r) => r.json());
    const r1 = await create();
    const r2 = await create();
    assert.notStrictEqual(r1.finding.id, r2.finding.id, 'two findings with identical content must get distinct ids');
    assert.strictEqual(r1.finding.title, r2.finding.title);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (c): a deal with zero findings returns an empty array with status 200', async () => {
  const deal = freshDeal('deal_ddfc');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/dd/findings`, { headers: { Cookie: cookieHeader(karenToken) } });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await res.json(), [], 'a deal with zero findings must return an empty array, never null/404');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (d): two equal-severity findings are returned in stable insertion order across two consecutive reads', async () => {
  const deal = freshDeal('deal_ddfd');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const create = (title) => fetch(`${base}/api/dd/findings`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'hr', title, severity: 'medium' }),
    }).then((r) => r.json());
    const first = await create('First finding');
    const second = await create('Second finding');

    const read1 = await (await fetch(`${base}/api/dd/findings`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const read2 = await (await fetch(`${base}/api/dd/findings`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const order1 = read1.map((f) => f.id);
    const order2 = read2.map((f) => f.id);
    assert.deepStrictEqual(order1, order2, 'repeated reads must return the identical order');
    assert.deepStrictEqual(order1, [first.finding.id, second.finding.id], 'insertion order must be preserved');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (e): an uncleared member\'s list omits an area\'s findings entirely', async () => {
  const deal = freshDeal('deal_ddfe'); // memberGrants: {} — no entry for pmo at all
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/dd/findings`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', title: 'Finding pmo must never see', severity: 'critical' }),
    });

    const pmoRes = await fetch(`${base}/api/dd/findings`, { headers: { Cookie: cookieHeader(pmoToken) } });
    assert.strictEqual(pmoRes.status, 200, 'an empty-grant caller must still get 200, never a server error');
    assert.deepStrictEqual(await pmoRes.json(), [], 'a member with no memberGrants entry at all must see no findings');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-findings (f): an uncleared member\'s by-id probe and an unknown-id probe return byte-identical 403 bodies, each auditing one dd-access-denied row', async () => {
  const deal = freshDeal('deal_ddff', { memberGrants: { pmo: { ddAreas: ['financial'] } } });
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/findings`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', title: 'A legal finding pmo cannot reach by id', severity: 'high' }),
    });
    const { finding } = await createRes.json();

    const before = deniedRows(deal.id).length;

    const unclearedRes = await fetch(`${base}/api/dd/findings/${finding.id}`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const unclearedBody = await unclearedRes.json();

    const unknownRes = await fetch(`${base}/api/dd/findings/ddfind_totally_unknown_id`, { headers: { Cookie: cookieHeader(pmoToken) } });
    const unknownBody = await unknownRes.json();

    assert.strictEqual(unclearedRes.status, 403, 'an uncleared-area finding must 403');
    assert.strictEqual(unknownRes.status, 403, 'an unknown finding id must ALSO 403');
    assert.deepStrictEqual(unclearedBody, unknownBody, 'an unknown id and an uncleared-area id must return byte-identical response bodies (DD-04 anti-enumeration)');

    const rows = deniedRows(deal.id);
    assert.strictEqual(rows.length, before + 2, 'each of the two refusals above must write exactly one dd-access-denied row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});
