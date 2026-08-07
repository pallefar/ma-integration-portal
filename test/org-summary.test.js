// ORG-01/ORG-02/ORG-03 (06-07) — D-19/D-20/D-21/D-22: GET /api/org/summary,
// the clearance-scoped organisation rollup that feeds the deal-home panel
// and the flight-risk owner nudge. Proves: the open tier (current headcount,
// open positions) is visible to any deal member with no clearance gate; the
// restricted tier (target headcount, the current->target delta, five-value
// decision counts, unmitigated high/critical flight-risk count, and a
// caller-scoped owner count) is present only for an `hr`-granted caller and
// STRUCTURALLY ABSENT — not null, not zeroed — for an uncleared one; a
// decision entry whose position has been deleted contributes to no count;
// and the route writes ZERO audit rows for any identity.
//
// Modelled on test/dd-summary.test.js's harness shape (the route this one
// mirrors) and test/org-flight-risk-audit.test.js's four-identity roster and
// before/after audit-delta convention: boots the REAL requireable app
// (`require('../server.js')`) against an ISOLATED temp
// control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-summary.test.js` (or `npm test`). Never `node --test test/` (the
// directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-org-summary-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-org-summary-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/org-flight-risk-audit.test.js).
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

// Counts ALL audit.db rows for a deal — every audit assertion in this file
// takes a before/after DELTA over this, mirroring
// test/org-flight-risk-audit.test.js's own countByAction() convention, never
// an absolute total, so the test never depends on what else the harness
// wrote.
function auditRowCount(dealId) {
  return auditHook.queryAudit({ dealId, limit: 500 }).length;
}

async function createEmployee(base, adminToken, name) {
  const res = await postJSON(base, '/api/employees', adminToken, { name, role: 'Engineer', department: 'Eng' });
  const { employee } = await res.json();
  return employee;
}
async function createPosition(base, token, body) {
  const res = await postJSON(base, '/api/org/positions', token, body);
  const json = await res.json();
  return json.position;
}
async function createDecision(base, token, body) {
  const res = await postJSON(base, '/api/org/decisions', token, body);
  return res.json();
}
async function createFlightRisk(base, token, body) {
  const res = await postJSON(base, '/api/org/flight-risk', token, body);
  const json = await res.json();
  return json.entry;
}
async function getSummary(base, token) {
  const res = await getJSON(base, '/api/org/summary', token);
  return { status: res.status, body: await res.json() };
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Standard four-identity roster, mirroring
// test/org-flight-risk-audit.test.js's makeFourIdentityDeal(): admin + karen
// (hrbp, reaches hr via grantedAreas()'s role short-circuit) + an
// hr-granted pmo + an ungranted pmo.
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

test('org-summary (a): an uncleared caller gets 200 with an open tier, and the restricted key is entirely absent from the serialised response', async () => {
  const deal = makeFourIdentityDeal('deal_osa');
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const { status, body } = await getSummary(base, pmoItToken);
    assert.strictEqual(status, 200);
    assert.ok(body.open, 'the open tier must always be present');
    assert.strictEqual(body.open.currentHeadcount, 0);
    assert.strictEqual(body.open.openPositions, 0);
    // The proof itself: stringify the WHOLE response and search for the key
    // name, never a property-undefined check (which would also pass for an
    // explicit null — the exact ambiguity D-20 forbids).
    assert.ok(!JSON.stringify(body).includes('restricted'), 'the serialised uncleared response must never contain the string "restricted"');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoItToken);
    server.close();
  }
});

test('org-summary (b): the same request from an hr-granted caller returns 200 with the restricted key present', async () => {
  const deal = makeFourIdentityDeal('deal_osb');
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const { status, body } = await getSummary(base, pmoHrToken);
    assert.strictEqual(status, 200);
    assert.ok(body.restricted, 'an hr-granted caller must receive the restricted key');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoHrToken);
    server.close();
  }
});

test('org-summary (c): current headcount counts current-state occupied positions, open positions counts current-state vacant ones, and a target-state position contributes to neither', async () => {
  const deal = makeFourIdentityDeal('deal_osc');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const emp1 = await createEmployee(base, karenToken, 'Ada Occupant');
    await createPosition(base, karenToken, { title: 'Occupied current role', state: 'current', employeeId: emp1.id });
    await createPosition(base, karenToken, { title: 'Vacant current role', state: 'current' });
    const emp2 = await createEmployee(base, karenToken, 'Bea Target');
    await createPosition(base, karenToken, { title: 'Occupied target role', state: 'target', employeeId: emp2.id });

    const { body } = await getSummary(base, karenToken);
    assert.strictEqual(body.open.currentHeadcount, 1, 'exactly the one occupied current-state position counts');
    assert.strictEqual(body.open.openPositions, 1, 'exactly the one vacant current-state position counts');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-summary (d): the restricted delta is target headcount minus current headcount, negative when current exceeds target, with the expected magnitude', async () => {
  const deal = makeFourIdentityDeal('deal_osd');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const currentOccupants = await Promise.all([
      createEmployee(base, karenToken, 'Cal One'),
      createEmployee(base, karenToken, 'Cal Two'),
      createEmployee(base, karenToken, 'Cal Three'),
    ]);
    for (const emp of currentOccupants) {
      await createPosition(base, karenToken, { title: `Current role for ${emp.name}`, state: 'current', employeeId: emp.id });
    }
    const targetOccupant = await createEmployee(base, karenToken, 'Cal Target');
    await createPosition(base, karenToken, { title: 'Sole target role', state: 'target', employeeId: targetOccupant.id });

    const { body } = await getSummary(base, karenToken);
    assert.strictEqual(body.open.currentHeadcount, 3);
    assert.strictEqual(body.restricted.targetHeadcount, 1);
    assert.strictEqual(body.restricted.delta, -2, 'delta must be target (1) minus current (3)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-summary (e): decision-type counts total across the five vocabulary values, and a position with no entry counts under the open value', async () => {
  const deal = makeFourIdentityDeal('deal_ose');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const posRetain = await createPosition(base, karenToken, { title: 'Retained role', state: 'current' });
    const posRedundant = await createPosition(base, karenToken, { title: 'Redundant role', state: 'current' });
    await createPosition(base, karenToken, { title: 'Undecided role', state: 'current' });

    await createDecision(base, karenToken, { positionId: posRetain.id, type: 'retain', rationale: 'Critical skill set.' });
    await createDecision(base, karenToken, { positionId: posRedundant.id, type: 'redundant', rationale: 'Role duplicated post-merger.' });

    const { body } = await getSummary(base, karenToken);
    assert.strictEqual(body.restricted.decisions.retain, 1);
    assert.strictEqual(body.restricted.decisions.redundant, 1);
    assert.strictEqual(body.restricted.decisions.open, 1, 'the undecided position counts under the open value');
    assert.strictEqual(body.restricted.decisions.redeploy, 0);
    assert.strictEqual(body.restricted.decisions['in-selection'], 0);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-summary (f): a decision entry whose position was deleted contributes to no decision-type count', async () => {
  const deal = makeFourIdentityDeal('deal_osf');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const pos = await createPosition(base, karenToken, { title: 'Soon-to-be-deleted role', state: 'current' });
    await createDecision(base, karenToken, { positionId: pos.id, type: 'retain', rationale: 'Keeping for now.' });

    const before = await getSummary(base, karenToken);
    assert.strictEqual(before.body.restricted.decisions.retain, 1, 'the decision counts before deletion');

    const delRes = await delReq(base, `/api/org/positions/${pos.id}`, karenToken);
    assert.strictEqual(delRes.status, 200, 'the position has no direct reports, so the delete must succeed');

    const after = await getSummary(base, karenToken);
    assert.strictEqual(after.body.restricted.decisions.retain, 0, 'the deleted position\'s decision must contribute to no count');
    assert.strictEqual(after.body.restricted.decisions.open, 0, 'the deleted position must not fall back into the open bucket either — it is gone entirely');
    const total = Object.values(after.body.restricted.decisions).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, 0, 'with zero current-state positions remaining, every decision-type count is zero');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-summary (g): the unmitigated count includes only high/critical entries with an empty mitigation, excluding low/medium and mitigated ones', async () => {
  const deal = makeFourIdentityDeal('deal_osg');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const emp = await createEmployee(base, karenToken, 'Risky Retainee');
    await createFlightRisk(base, karenToken, { employeeId: emp.id, riskLevel: 'high', owner: 'karen' }); // unmitigated, counts
    await createFlightRisk(base, karenToken, { employeeId: emp.id, riskLevel: 'critical', owner: 'karen' }); // unmitigated, counts
    await createFlightRisk(base, karenToken, { employeeId: emp.id, riskLevel: 'high', owner: 'karen', mitigation: 'Retention bonus offered.' }); // mitigated, excluded
    await createFlightRisk(base, karenToken, { employeeId: emp.id, riskLevel: 'low', owner: 'karen' }); // low severity, excluded
    await createFlightRisk(base, karenToken, { employeeId: emp.id, riskLevel: 'medium', owner: 'karen' }); // medium severity, excluded

    const { body } = await getSummary(base, karenToken);
    assert.strictEqual(body.restricted.unmitigatedFlightRisks, 2, 'exactly the high and critical unmitigated entries count');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-summary (h): the caller-scoped mine count reports how many unmitigated high/critical entries the CALLER owns, zero and still present for a cleared caller who owns none', async () => {
  const deal = makeFourIdentityDeal('deal_osh');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const emp = await createEmployee(base, karenToken, 'Owned Retainee');
    await createFlightRisk(base, karenToken, { employeeId: emp.id, riskLevel: 'high', owner: 'karen' });
    await createFlightRisk(base, karenToken, { employeeId: emp.id, riskLevel: 'critical', owner: 'karen' });

    const karenSummary = await getSummary(base, karenToken);
    assert.strictEqual(karenSummary.body.restricted.mine.unmitigatedFlightRisks, 2, 'karen owns both unmitigated entries');

    const adminSummary = await getSummary(base, adminToken);
    assert.ok(adminSummary.body.restricted, 'admin is cleared — the restricted key must still be present');
    assert.strictEqual(adminSummary.body.restricted.mine.unmitigatedFlightRisks, 0, 'admin owns none of the unmitigated entries, so the count is zero — not absent');
  } finally {
    [karenToken, adminToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-summary (i): a deal with no positions at all returns a zeroed open tier rather than an error, and the restricted tier still appears for a cleared caller', async () => {
  const deal = makeFourIdentityDeal('deal_osi');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const { status, body } = await getSummary(base, karenToken);
    assert.strictEqual(status, 200);
    assert.deepStrictEqual(body.open, { currentHeadcount: 0, openPositions: 0, currentPositions: 0 });
    assert.ok(body.restricted, 'restricted must still appear for a cleared caller even on an empty deal');
    assert.strictEqual(body.restricted.targetHeadcount, 0);
    assert.strictEqual(body.restricted.delta, 0);
    assert.strictEqual(body.restricted.unmitigatedFlightRisks, 0);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-summary (j): a summary read from both a cleared and an uncleared identity appends zero audit rows of any action', async () => {
  const deal = makeFourIdentityDeal('deal_osj');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = auditRowCount(deal.id);
    await getSummary(base, karenToken); // cleared
    await getSummary(base, pmoItToken); // uncleared
    assert.strictEqual(auditRowCount(deal.id), before, 'neither a cleared nor an uncleared summary read may write any audit row');
  } finally {
    [karenToken, pmoItToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-summary: grep-level guard — the route handler calls recordSecurityEvent zero times', () => {
  const serverSrc = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeMatch = serverSrc.match(/app\.get\('\/api\/org\/summary'[\s\S]*?\n\}\);/);
  assert.ok(routeMatch, 'GET /api/org/summary route must be present');
  const callsInsideRoute = (routeMatch[0].match(/recordSecurityEvent/g) || []).length;
  assert.strictEqual(callsInsideRoute, 0, 'the summary route must never write a security event');
});
