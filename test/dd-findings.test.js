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

// ---------------------------------------------------------------------------
// Task 2: the RAID severity scale extends to four levels in BOTH server.js
// and validators/workstream.js — D-26.
// ---------------------------------------------------------------------------

test('dd-findings (g): POST /api/raid carrying the new "critical" severity succeeds and reads back with that severity', async () => {
  const deal = freshDeal('deal_ddfg');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/raid`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A critical RAID entry', type: 'risk', severity: 'critical' }),
    });
    assert.strictEqual(createRes.status, 201);
    const { entry } = await createRes.json();
    assert.strictEqual(entry.severity, 'critical');

    const list = await (await fetch(`${base}/api/raid`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const readBack = list.find((e) => e.id === entry.id);
    assert.ok(readBack, 'the critical entry must be present in the RAID list');
    assert.strictEqual(readBack.severity, 'critical', 'a RAID entry created with severity critical must read back as critical');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (h): POST /api/raid carrying a value outside the four levels is rejected by the schema with a 400 naming the field', async () => {
  const deal = freshDeal('deal_ddfh');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/raid`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Bad severity entry', type: 'risk', severity: 'catastrophic' }),
    });
    assert.strictEqual(res.status, 400, 'an out-of-enum severity must be rejected by the schema, not silently defaulted');
    const body = await res.json();
    assert.ok(body && typeof body.error === 'string' && body.error.length > 0, 'the 400 must carry a non-empty error message naming the problem');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (i): both files\' RAID severity lists contain the exact same four values', () => {
  // Source-level assertion, not an HTTP round-trip — a future edit to only
  // ONE of the two independent copies must fail this suite immediately.
  const app2 = require('../server.js');
  const workstreamValidators = require('../validators/workstream.js');
  assert.deepStrictEqual(
    app2.RAID_LEVELS,
    workstreamValidators.RAID_LEVELS,
    "server.js's RAID_LEVELS and validators/workstream.js's RAID_LEVELS are independent copies that must be kept in sync by hand — they have drifted apart",
  );
  assert.deepStrictEqual(app2.RAID_LEVELS, ['low', 'medium', 'high', 'critical']);
});

test('dd-findings (j): an existing RAID entry created before this change still reads and updates normally with its original three-level severity', async () => {
  const deal = freshDeal('deal_ddfj');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/raid`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'A pre-existing medium entry', type: 'issue', severity: 'medium' }),
    });
    const { entry } = await createRes.json();
    assert.strictEqual(entry.severity, 'medium');

    const updateRes = await fetch(`${base}/api/raid`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      // version 0: the version a client holding a never-edited entry sends
      // (D-09; CONC-02 gap closure — a precondition-less RAID write is refused).
      body: JSON.stringify({ id: entry.id, status: 'mitigating', version: 0 }),
    });
    assert.strictEqual(updateRes.status, 200);
    const { entry: updated } = await updateRes.json();
    assert.strictEqual(updated.severity, 'medium', 'an untouched severity field must be left exactly as it was');
    assert.strictEqual(updated.status, 'mitigating');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Task 3: one-click conversion — bidirectional references and source dedup.
// ---------------------------------------------------------------------------

const DD_AREA_WORKSTREAM = {
  legal: 'ws_legal', financial: 'ws_finance', tax: 'ws_finance', hr: 'ws_hr',
  it: 'ws_it', commercial: 'ws_sales', operations: 'ws_ops', complianceEsg: 'ws_legal',
};

test('dd-findings (k): converting a critical finding to both a task and a RAID entry preserves severity, sets the workstream from the mapping, and links both directions', async () => {
  const deal = freshDeal('deal_ddfk');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/findings`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'legal', title: 'A critical legal finding', severity: 'critical', owner: 'Karen' }),
    });
    const { finding } = await createRes.json();

    const convertRes = await fetch(`${base}/api/dd/findings/${finding.id}/convert`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ toTask: true, toRaid: true }),
    });
    assert.strictEqual(convertRes.status, 200);
    const result = await convertRes.json();
    assert.strictEqual(result.success, true);
    assert.ok(result.task, 'a task must be created');
    assert.ok(result.raid, 'a RAID entry must be created');
    assert.strictEqual(result.raid.severity, 'critical', 'the RAID entry\'s severity must still be critical — no downgrade anywhere on the path');
    assert.strictEqual(result.task.workstreamId, DD_AREA_WORKSTREAM.legal);
    assert.strictEqual(result.raid.workstreamId, DD_AREA_WORKSTREAM.legal);
    assert.strictEqual(result.task.source, 'dd-finding:' + finding.id);
    assert.strictEqual(result.raid.source, 'dd-finding:' + finding.id);
    assert.strictEqual(result.finding.linkedTaskIds.length, 1);
    assert.strictEqual(result.finding.linkedTaskIds[0], result.task.id);
    assert.strictEqual(result.finding.linkedRaidIds.length, 1);
    assert.strictEqual(result.finding.linkedRaidIds[0], result.raid.id);

    // Read the RAID entry back through GET /api/raid to prove the severity
    // survived a real round trip, not just the convert response.
    const raidList = await (await fetch(`${base}/api/raid`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const raidReadBack = raidList.find((r) => r.id === result.raid.id);
    assert.ok(raidReadBack);
    assert.strictEqual(raidReadBack.severity, 'critical');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (l): the created task\'s and entry\'s workstream ids match DD_AREA_WORKSTREAM for each of the eight areas', async () => {
  const deal = freshDeal('deal_ddfl', { memberGrants: {} });
  // hrbp/admin see every area; use karen (hrbp) to convert across all 8.
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    for (const area of Object.keys(DD_AREA_WORKSTREAM)) {
      const createRes = await fetch(`${base}/api/dd/findings`, {
        method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ area, title: `Finding for ${area}`, severity: 'medium' }),
      });
      const { finding } = await createRes.json();

      const convertRes = await fetch(`${base}/api/dd/findings/${finding.id}/convert`, {
        method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ toTask: true, toRaid: true }),
      });
      const result = await convertRes.json();
      assert.strictEqual(result.task.workstreamId, DD_AREA_WORKSTREAM[area], `area ${area} must map to ${DD_AREA_WORKSTREAM[area]} on the task`);
      assert.strictEqual(result.raid.workstreamId, DD_AREA_WORKSTREAM[area], `area ${area} must map to ${DD_AREA_WORKSTREAM[area]} on the RAID entry`);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (m): converting the same finding a second time creates nothing new and returns the same ids; lane lengths stay unchanged', async () => {
  const deal = freshDeal('deal_ddfm');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/findings`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'it', title: 'A finding converted twice', severity: 'high' }),
    });
    const { finding } = await createRes.json();

    const first = await (await fetch(`${base}/api/dd/findings/${finding.id}/convert`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ toTask: true, toRaid: true }),
    })).json();

    const tasksAfterFirst = await (await fetch(`${base}/api/integration-tasks`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const raidAfterFirst = await (await fetch(`${base}/api/raid`, { headers: { Cookie: cookieHeader(karenToken) } })).json();

    const second = await (await fetch(`${base}/api/dd/findings/${finding.id}/convert`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ toTask: true, toRaid: true }),
    })).json();

    assert.strictEqual(second.task.id, first.task.id, 're-converting must return the SAME task id, never a new one');
    assert.strictEqual(second.raid.id, first.raid.id, 're-converting must return the SAME RAID entry id, never a new one');
    assert.strictEqual(second.finding.linkedTaskIds.length, 1, 're-converting must not duplicate the linked task id');
    assert.strictEqual(second.finding.linkedRaidIds.length, 1, 're-converting must not duplicate the linked RAID id');

    const tasksAfterSecond = await (await fetch(`${base}/api/integration-tasks`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const raidAfterSecond = await (await fetch(`${base}/api/raid`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(tasksAfterSecond.length, tasksAfterFirst.length, 'the task lane length must be unchanged by a repeat conversion');
    assert.strictEqual(raidAfterSecond.length, raidAfterFirst.length, 'the RAID lane length must be unchanged by a repeat conversion');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (n): a conversion requested with both flags false is rejected with a 400', async () => {
  const deal = freshDeal('deal_ddfn');
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/dd/findings`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ area: 'operations', title: 'Neither-flag finding', severity: 'low' }),
    });
    const { finding } = await createRes.json();

    const res = await fetch(`${base}/api/dd/findings/${finding.id}/convert`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ toTask: false, toRaid: false }),
    });
    assert.strictEqual(res.status, 400, 'a conversion requesting neither target must be rejected');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('dd-findings (o): a member uncleared for the finding\'s area gets the uniform 403 and one dd-access-denied row; no task and no RAID entry are created', async () => {
  const deal = freshDeal('deal_ddfo', { memberGrants: { pmo: { ddAreas: ['financial'] } } });
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
      body: JSON.stringify({ area: 'legal', title: 'A legal finding pmo cannot convert', severity: 'high' }),
    });
    const { finding } = await createRes.json();

    const before = deniedRows(deal.id).length;
    const res = await fetch(`${base}/api/dd/findings/${finding.id}/convert`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ toTask: true, toRaid: true }),
    });
    assert.strictEqual(res.status, 403, 'an uncleared conversion attempt must be refused with the uniform 403');

    const rows = deniedRows(deal.id);
    assert.strictEqual(rows.length, before + 1, 'the refused conversion attempt must be audited');

    const tasks = await (await fetch(`${base}/api/integration-tasks`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const raidEntries = await (await fetch(`${base}/api/raid`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(tasks.length, 0, 'a refused conversion must create no task');
    assert.strictEqual(raidEntries.length, 0, 'a refused conversion must create no RAID entry');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('dd-findings (p): the convert control discloses the TRUE, now-restricted audience via textContent, not markup — the stale whole-deal-team claim is gone', () => {
  // T-04-21, CLOSED by D-17 (06-06 Task 2): this threat was originally
  // accepted as "the convert control states that the created task or entry
  // is visible to the whole deal team" — but GET /api/raid is no longer
  // unfiltered (server.js's resolveRaidEntryClearanceArea() now gates a
  // converted entry on its originating finding's own functional area), so
  // that disclosure became FACTUALLY WRONG the instant the filter shipped.
  // This is a source-level assertion, not an HTTP round-trip, because the
  // disclosure is a client-rendered UI element with no server-observable
  // side effect — a regression here would not be caught by any API test.
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'due-diligence.js'), 'utf8');
  assert.ok(
    !src.includes('whole deal team'),
    'the superseded "whole deal team" disclosure must no longer appear anywhere in the client — D-17 makes it false',
  );
  assert.ok(
    src.includes('visible only to members cleared for this area'),
    'the finding-row convert control must disclose the TRUE, now-restricted audience',
  );
  const noteLine = src.split('\n').find((line) => line.includes('visible only to members cleared for this area'));
  assert.ok(noteLine, 'expected to locate the exact line carrying the corrected disclosure text');
  assert.ok(
    /text\s*:/.test(noteLine),
    "the corrected disclosure must be assigned via the el() helper's `text:` property (textContent), never via innerHTML or another markup sink",
  );
});
