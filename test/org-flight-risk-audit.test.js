// ORG-03 (06-05) — the key-talent flight-risk register. This file is the
// FIRST read-side audit test in this codebase: the register's own
// successful-read audit half has no precedent to copy (no other GET handler
// in server.js records a security event). Proves D-02 (hr-grant read
// clearance), D-03 (both audit halves — denial AND successful read — plus
// the "scoped to this register alone" boundary), D-04 tier 2 (the write
// gate, identical to POST /api/org/decisions), D-09 (employeeId is a real
// roster link, never free text), the encoding round-trip (VAL-02), and the
// same-collection concurrency guarantee (FND-03) extended to a brand-new
// collection.
//
// Modelled on test/org-decisions.test.js's harness shape: boots the REAL
// requireable app (`require('../server.js')`) against an ISOLATED temp
// control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-flight-risk-audit.test.js` (or `npm test`). Never `node --test
// test/` (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-org-flight-risk-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-org-flight-risk-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/org-decisions.test.js).
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
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }
function postJSON(base, urlPath, token, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Cookie: cookieHeader(token) } : {}),
    body: JSON.stringify(body || {}),
  });
}
function getJSON(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function delReq(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { method: 'DELETE', headers: token ? { Cookie: cookieHeader(token) } : {} });
}

// Counts audit.db rows by action name for a given deal — every audit
// assertion in this file takes a before/after DELTA over this, never an
// absolute total, so the test never depends on what else the harness wrote.
function countByAction(dealId, action) {
  return auditHook.queryAudit({ dealId, limit: 500 }).filter((r) => r.action === action).length;
}
function countByActions(dealId, actions) {
  const set = new Set(actions);
  return auditHook.queryAudit({ dealId, limit: 500 }).filter((r) => set.has(r.action)).length;
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Standard test deal — admin + karen (hrbp, no explicit grant needed —
// reaches hr via grantedAreas()'s role short-circuit) + an hr-granted pmo +
// an ungranted pmo, matching org-decisions.test.js's own four-identity
// roster shape.
function makeFourIdentityDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin', 'karen', 'pmo_hr', 'pmo_it'],
    memberGrants: {
      pmo_hr: { ddAreas: ['hr'] },
      pmo_it: { ddAreas: ['it'] },
    },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

async function createEmployee(base, adminToken, name) {
  const res = await postJSON(base, '/api/employees', adminToken, { name, role: 'Engineer', department: 'Eng' });
  const { employee } = await res.json();
  return employee;
}

// ============================================================= Task 1 ====
// The restricted register, the tier-2 write gate, and both halves of the
// D-03 audit.
// ===========================================================================

test('org-flight-risk (a): GET from a caller without the hr grant returns 403 and appends exactly one denial audit row', async () => {
  const deal = makeFourIdentityDeal('deal_ofra');
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = countByAction(deal.id, 'org-flightrisk-access-denied');
    const res = await getJSON(base, '/api/org/flight-risk', pmoItToken);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countByAction(deal.id, 'org-flightrisk-access-denied'), before + 1, 'exactly one denial row must be added');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoItToken);
    server.close();
  }
});

test('org-flight-risk (b): the same request from an hr-cleared caller returns 200 and appends exactly one read audit row', async () => {
  const deal = makeFourIdentityDeal('deal_ofrb');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = countByAction(deal.id, 'org-flightrisk-read');
    const res = await getJSON(base, '/api/org/flight-risk', karenToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body, [], 'a deal with no entries returns an empty array, never null or an error');
    assert.strictEqual(countByAction(deal.id, 'org-flightrisk-read'), before + 1, 'exactly one read row must be added');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-flight-risk (c): GET /api/org/positions (open tier) from either caller appends zero flight-risk-action rows', async () => {
  const deal = makeFourIdentityDeal('deal_ofrc');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = countByActions(deal.id, ['org-flightrisk-access-denied', 'org-flightrisk-read']);
    await getJSON(base, '/api/org/positions', karenToken);
    await getJSON(base, '/api/org/positions', pmoItToken);
    assert.strictEqual(countByActions(deal.id, ['org-flightrisk-access-denied', 'org-flightrisk-read']), before, 'the open-tier positions read must add zero rows carrying either register action name');
  } finally {
    [karenToken, pmoItToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk (d): two consecutive successful reads append exactly two read rows — no session dedupe', async () => {
  const deal = makeFourIdentityDeal('deal_ofrd');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = countByAction(deal.id, 'org-flightrisk-read');
    await getJSON(base, '/api/org/flight-risk', karenToken);
    await getJSON(base, '/api/org/flight-risk', karenToken);
    assert.strictEqual(countByAction(deal.id, 'org-flightrisk-read'), before + 2, 'two successful reads must append two rows, by decision — no dedupe');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-flight-risk (e): POST from an hrbp session with a valid body returns 201; the stored entry carries empty link arrays and a server-stamped createdAt', async () => {
  const deal = makeFourIdentityDeal('deal_ofre');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Jane Retention-Target');

    const before = Date.now();
    const res = await postJSON(base, '/api/org/flight-risk', karenToken, {
      employeeId: employee.id, riskLevel: 'high', owner: 'karen', mitigation: 'Retention bonus in progress.',
    });
    assert.strictEqual(res.status, 201);
    const { entry } = await res.json();
    assert.strictEqual(entry.employeeId, employee.id);
    assert.strictEqual(entry.riskLevel, 'high');
    assert.deepStrictEqual(entry.linkedTaskIds, []);
    assert.deepStrictEqual(entry.linkedRaidIds, []);
    const createdAtMs = new Date(entry.createdAt).getTime();
    assert.ok(createdAtMs >= before && createdAtMs <= Date.now() + 5000, 'createdAt must be a server-stamped timestamp near now');
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk (f): the same create payload from a pmo holding the hr grant returns 403 and creates no entry', async () => {
  const deal = makeFourIdentityDeal('deal_ofrf');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'John Retention-Target');

    const res = await postJSON(base, '/api/org/flight-risk', pmoHrToken, {
      employeeId: employee.id, riskLevel: 'high', owner: 'pmo_hr', mitigation: 'Should never be created.',
    });
    assert.strictEqual(res.status, 403, 'an hr-granted-but-non-IL pmo must still be refused — D-04 tier 2');

    const listRes = await getJSON(base, '/api/org/flight-risk', adminToken);
    const list = await listRes.json();
    assert.strictEqual(list.length, 0, 'the refused create must persist nothing');
  } finally {
    [adminToken, pmoHrToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk (g): the D-04 tier-2 four-identity matrix — the SAME create payload from admin/hrbp/hr-granted-pmo/ungranted-pmo returns 201/201/403/403', async () => {
  const deal = makeFourIdentityDeal('deal_ofrg');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Four Identity Target');

    const identities = [
      { name: 'admin', token: adminToken, expect: 201 },
      { name: 'hrbp (Integration Lead)', token: karenToken, expect: 201 },
      { name: 'pmo granted hr (area-cleared, not IL)', token: pmoHrToken, expect: 403 },
      { name: 'pmo granted no area', token: pmoItToken, expect: 403 },
    ];
    for (const id of identities) {
      const res = await postJSON(base, '/api/org/flight-risk', id.token, {
        employeeId: employee.id, riskLevel: 'medium', owner: id.name,
      });
      assert.strictEqual(res.status, id.expect, `${id.name}: expected ${id.expect}`);
    }

    const listRes = await getJSON(base, '/api/org/flight-risk', adminToken);
    const list = await listRes.json();
    assert.strictEqual(list.length, 2, 'only the two successful (admin, hrbp) writes must have created an entry');
  } finally {
    [adminToken, karenToken, pmoHrToken, pmoItToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk (h): a body whose riskLevel is outside the four RAID values returns 400 from the schema', async () => {
  const deal = makeFourIdentityDeal('deal_ofrh');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Bad Level Target');

    const res = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: employee.id, riskLevel: 'catastrophic', owner: 'admin',
    });
    assert.strictEqual(res.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-flight-risk (i): a body with no employeeId returns 400; a body naming no employee in the roster returns 404', async () => {
  const deal = makeFourIdentityDeal('deal_ofri');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const noIdRes = await postJSON(base, '/api/org/flight-risk', adminToken, { riskLevel: 'high', owner: 'admin' });
    assert.strictEqual(noIdRes.status, 400);

    const unknownRes = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: 'emp_totally_unknown', riskLevel: 'high', owner: 'admin',
    });
    assert.strictEqual(unknownRes.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-flight-risk (j): a body with no owner returns 400; a body with no mitigation returns 201 and stores an empty mitigation', async () => {
  const deal = makeFourIdentityDeal('deal_ofrj');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'No Owner Target');

    const noOwnerRes = await postJSON(base, '/api/org/flight-risk', adminToken, { employeeId: employee.id, riskLevel: 'low' });
    assert.strictEqual(noOwnerRes.status, 400);

    const employee2 = await createEmployee(base, adminToken, 'No Mitigation Target');
    const noMitigationRes = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: employee2.id, riskLevel: 'low', owner: 'admin',
    });
    assert.strictEqual(noMitigationRes.status, 201);
    const { entry } = await noMitigationRes.json();
    assert.strictEqual(entry.mitigation, '', 'an absent mitigation must store as an empty string, never a placeholder or a missing key');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-flight-risk (k): POST with an id updates in place and does not create a second row', async () => {
  const deal = makeFourIdentityDeal('deal_ofrk');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Update Target');

    const createRes = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: employee.id, riskLevel: 'low', owner: 'admin', mitigation: 'Initial plan.',
    });
    const { entry: created } = await createRes.json();

    const updateRes = await postJSON(base, '/api/org/flight-risk', adminToken, {
      id: created.id, riskLevel: 'critical', mitigation: 'Escalated plan.',
    });
    assert.strictEqual(updateRes.status, 200);
    const { entry: updated } = await updateRes.json();
    assert.strictEqual(updated.id, created.id);
    assert.strictEqual(updated.riskLevel, 'critical');
    assert.strictEqual(updated.mitigation, 'Escalated plan.');
    assert.strictEqual(updated.owner, 'admin', 'a key not present in the update body must be left unchanged');

    const listRes = await getJSON(base, '/api/org/flight-risk', adminToken);
    const list = await listRes.json();
    assert.strictEqual(list.length, 1, 'an update must not create a second row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-flight-risk (l): DELETE returns 403 for a non-IL caller and 200 for an IL caller, removing exactly that row', async () => {
  const deal = makeFourIdentityDeal('deal_ofrl');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Delete Target');

    const createRes = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: employee.id, riskLevel: 'low', owner: 'admin',
    });
    const { entry } = await createRes.json();

    const refusedRes = await delReq(base, `/api/org/flight-risk/${entry.id}`, pmoHrToken);
    assert.strictEqual(refusedRes.status, 403);

    const okRes = await delReq(base, `/api/org/flight-risk/${entry.id}`, adminToken);
    assert.strictEqual(okRes.status, 200);

    const listRes = await getJSON(base, '/api/org/flight-risk', adminToken);
    const list = await listRes.json();
    assert.strictEqual(list.length, 0, 'exactly the deleted row must be gone');
  } finally {
    [adminToken, pmoHrToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk: grep-level guard — recordSecurityEvent has two new call sites inside the flight-risk GET handler and zero inside db/accessPolicy.js', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const flightRiskGetMatch = serverSrc.match(/app\.get\('\/api\/org\/flight-risk'[\s\S]*?\n\}\);/);
  assert.ok(flightRiskGetMatch, 'GET /api/org/flight-risk route must be present');
  const callsInsideRoute = (flightRiskGetMatch[0].match(/recordSecurityEvent/g) || []).length;
  assert.strictEqual(callsInsideRoute, 2, 'the GET handler must call recordSecurityEvent exactly twice — once on denial, once on successful read');

  // The module holds zero actual audit dependency: no require() of
  // db/auditHook.js, and no functional call to recordSecurityEvent — a
  // pre-existing (Phase 4) doc comment mentions the function name as
  // PROSE explaining why the call lives at the route-handler layer
  // instead, which is not itself an audit dependency. Comment-only lines
  // are stripped before counting, so this asserts the real invariant
  // (no require, no call site) rather than a raw substring match that a
  // documentation reference would trip.
  const accessPolicySrc = fs.readFileSync(path.join(__dirname, '..', 'db', 'accessPolicy.js'), 'utf8');
  assert.strictEqual((accessPolicySrc.match(/require\(['"].*auditHook['"]\)/g) || []).length, 0, 'db/accessPolicy.js must never require db/auditHook.js (AUD-02\'s isolation precedent)');
  const codeOnly = accessPolicySrc.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.strictEqual((codeOnly.match(/recordSecurityEvent/g) || []).length, 0, 'db/accessPolicy.js must hold zero FUNCTIONAL recordSecurityEvent call sites (comment-only mentions are not an audit dependency)');
});

