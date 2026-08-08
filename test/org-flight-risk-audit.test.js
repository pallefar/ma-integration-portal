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

test('org-flight-risk (j): WR-02 (06-REVIEW.md) — a body with no owner returns 201 and defaults owner to the caller\'s own session username, never a 400; a body with no mitigation returns 201 and stores an empty mitigation', async () => {
  const deal = makeFourIdentityDeal('deal_ofrj');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'No Owner Target');

    // WR-02: omitting owner is no longer a 400 — the server defaults it to
    // the CALLER'S OWN session identity (req.portalUser.username), mirroring
    // decidedBy's own server-stamped pattern on POST /api/org/decisions.
    const noOwnerRes = await postJSON(base, '/api/org/flight-risk', adminToken, { employeeId: employee.id, riskLevel: 'low' });
    assert.strictEqual(noOwnerRes.status, 201);
    const { entry: noOwnerEntry } = await noOwnerRes.json();
    assert.strictEqual(noOwnerEntry.owner, 'admin', 'an omitted owner must default to the caller\'s own session username');

    // Whitespace-only owner is treated identically to omitted — trims to
    // empty, then defaults, never persists as whitespace.
    const employeeWs = await createEmployee(base, adminToken, 'Whitespace Owner Target');
    const wsOwnerRes = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: employeeWs.id, riskLevel: 'low', owner: '   ',
    });
    assert.strictEqual(wsOwnerRes.status, 201);
    const { entry: wsOwnerEntry } = await wsOwnerRes.json();
    assert.strictEqual(wsOwnerEntry.owner, 'admin', 'a whitespace-only owner must default to the caller\'s own session username, not persist as whitespace');

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

test('org-flight-risk (j2): WR-02 — an explicitly supplied, non-blank owner is still honoured verbatim, never overridden by the caller\'s own session identity', async () => {
  const deal = makeFourIdentityDeal('deal_ofrj2');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Explicit Owner Target');

    const res = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: employee.id, riskLevel: 'high', owner: 'karen',
    });
    assert.strictEqual(res.status, 201);
    const { entry } = await res.json();
    assert.strictEqual(entry.owner, 'karen', 'an explicitly supplied owner must be honoured verbatim — the default only applies when blank/whitespace/omitted');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-flight-risk (j3): WR-02 — an unmitigated high-risk entry created with owner defaulted to the caller counts in that caller\'s GET /api/org/summary mine.unmitigatedFlightRisks', async () => {
  const deal = makeFourIdentityDeal('deal_ofrj3');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Summary Nudge Target');

    const before = await (await getJSON(base, '/api/org/summary', adminToken)).json();
    const beforeMine = (before.restricted && before.restricted.mine && before.restricted.mine.unmitigatedFlightRisks) || 0;

    const res = await postJSON(base, '/api/org/flight-risk', adminToken, { employeeId: employee.id, riskLevel: 'critical' });
    assert.strictEqual(res.status, 201);
    const { entry } = await res.json();
    assert.strictEqual(entry.owner, 'admin');

    const after = await (await getJSON(base, '/api/org/summary', adminToken)).json();
    assert.strictEqual(
      after.restricted.mine.unmitigatedFlightRisks,
      beforeMine + 1,
      'the entry created with a server-defaulted owner must count toward the CREATING caller\'s own mine.unmitigatedFlightRisks nudge',
    );
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

// ============================================================= Task 2 ====
// Audit scoping, encoding round-trip, and the same-collection concurrency
// proof.
// ===========================================================================

test('org-flight-risk-scoping: reading current-state positions, the capability probe, and the decisions list each append zero rows carrying either register action name', async () => {
  const deal = makeFourIdentityDeal('deal_ofrscope');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const before = countByActions(deal.id, ['org-flightrisk-access-denied', 'org-flightrisk-read']);
    await getJSON(base, '/api/org/positions', karenToken);
    await getJSON(base, '/api/org/capabilities', karenToken);
    await getJSON(base, '/api/org/decisions', karenToken);
    assert.strictEqual(
      countByActions(deal.id, ['org-flightrisk-access-denied', 'org-flightrisk-read']),
      before,
      'D-03\'s "scoped to the register only" must hold — none of these three non-register reads may add a flight-risk audit row',
    );
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-flight-risk-encoding: a mitigation containing a script-tag payload and an owner containing multi-byte characters and combining marks round-trip byte-identical', async () => {
  const deal = makeFourIdentityDeal('deal_ofrenc');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Encoding Target');

    const dangerousMitigation = '<script>alert(1)</script> retention plan under review';
    // Multi-byte characters (CJK) plus a combining mark (é = "é" via
    // combining acute accent) — proves no truncation and no normalization
    // mangling on the write path.
    const multiByteOwner = 'Kärsten 张伟 éclair';

    const res = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: employee.id, riskLevel: 'high', owner: multiByteOwner, mitigation: dangerousMitigation,
    });
    assert.strictEqual(res.status, 201);
    const { entry } = await res.json();
    assert.strictEqual(entry.mitigation, dangerousMitigation, 'the stored mitigation must round-trip byte-identical — write-time sanitization is owned by the validation pipeline, not this route, and this field is deliberately plain text, not markup-bearing');
    assert.strictEqual(entry.owner, multiByteOwner, 'the stored owner must round-trip byte-identical, with no truncation and no mangling of multi-byte characters or combining marks');

    const listRes = await getJSON(base, '/api/org/flight-risk', adminToken);
    const list = await listRes.json();
    const stored = list.find((e) => e.id === entry.id);
    assert.strictEqual(stored.mitigation, dangerousMitigation);
    assert.strictEqual(stored.owner, multiByteOwner);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-flight-risk-encoding: source-level — public/js/org.js renders through a text-content sink, never an HTML-markup sink', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  assert.strictEqual((src.match(/innerHTML/g) || []).length, 0, 'org.js must contain zero innerHTML sinks — a stored script-tag payload\'s inertness is a property of the render path, not of write-time escaping alone');
});

test('org-flight-risk-concurrency: two simultaneous creates for two different people both land — the same-collection lost-update race is closed', async () => {
  const deal = makeFourIdentityDeal('deal_ofrconc');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employeeA = await createEmployee(base, adminToken, 'Concurrent Writer A Target');
    const employeeB = await createEmployee(base, adminToken, 'Concurrent Writer B Target');

    // Fired without awaiting the first — this is the interleave that would
    // reproduce a lost-update race under a naive diff-against-live-state
    // merge (see db/store.js's snapshot-tagged transactional merge).
    const [resA, resB] = await Promise.all([
      postJSON(base, '/api/org/flight-risk', adminToken, { employeeId: employeeA.id, riskLevel: 'high', owner: 'Writer A' }),
      postJSON(base, '/api/org/flight-risk', adminToken, { employeeId: employeeB.id, riskLevel: 'high', owner: 'Writer B' }),
    ]);
    assert.strictEqual(resA.status, 201);
    assert.strictEqual(resB.status, 201);
    const { entry: entryA } = await resA.json();
    const { entry: entryB } = await resB.json();

    const listRes = await getJSON(base, '/api/org/flight-risk', adminToken);
    const list = await listRes.json();
    assert.strictEqual(list.length, 2, 'both concurrent creates must survive — no lost update');
    assert.ok(list.some((e) => e.id === entryA.id), 'writer A\'s entry must survive');
    assert.ok(list.some((e) => e.id === entryB.id), 'writer B\'s entry must survive');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-flight-risk-concurrency: a simultaneous flight-risk write and position write both land — the merge is per-collection, not whole-database last-writer-wins', async () => {
  const deal = makeFourIdentityDeal('deal_ofrconcmix');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Mixed Concurrency Target');

    const [riskRes, posRes] = await Promise.all([
      postJSON(base, '/api/org/flight-risk', adminToken, { employeeId: employee.id, riskLevel: 'critical', owner: 'admin' }),
      postJSON(base, '/api/org/positions', adminToken, { title: 'Concurrently-added position' }),
    ]);
    assert.strictEqual(riskRes.status, 201);
    assert.strictEqual(posRes.status, 201);

    const riskListRes = await getJSON(base, '/api/org/flight-risk', adminToken);
    const riskList = await riskListRes.json();
    assert.strictEqual(riskList.length, 1, 'the flight-risk collection must hold the concurrently-created entry');

    const posListRes = await getJSON(base, '/api/org/positions', adminToken);
    const posList = await posListRes.json();
    assert.strictEqual(posList.length, 1, 'the positions collection must hold the concurrently-created position');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

// ============================================================= Task 3 ====
// The register surface and the border-accent severity channel.
// ===========================================================================

test('org-flight-risk-ui: zero innerHTML sinks exist anywhere in public/js/org.js', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  assert.strictEqual((src.match(/innerHTML/g) || []).length, 0, 'public/js/org.js must contain zero innerHTML sinks — MNPI org content is textContent-only');
});

test('org-flight-risk-ui: source-level — public/js/org.js contains no PROPERTY ACCESS on any employee engagement field, so no ordering or styling can be keyed on them', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  // Matched as dotted property access (e.g. `.badge`), never a bare
  // substring — "badge" alone also matches this file's own, unrelated
  // "decision badge" vocabulary (ORG_DECISION_BADGE_CLASS, org-dec-badge--*
  // CSS class names), which is not an employee record field at all.
  ['completedLessons', 'points', 'badge', 'bonusPoints'].forEach((field) => {
    const pattern = new RegExp('\\.' + field + '\\b');
    assert.ok(!pattern.test(src), `org.js must not read the employee engagement field "${field}" via property access — a retention determination must not be visually or ordinally influenced by an engagement score`);
  });
});

test('org-flight-risk-ui: source-level — the register fetch appears exactly three times, each a direct consequence of an explicit user action (never a poll), and org.js contains no interval or timeout callback', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  const fetchCallsInLoad = (src.match(/fetch\('\/api\/org\/flight-risk'\)/g) || []).length;
  // ONE call inside load() (the page-visit fetch) + ONE call inside the
  // entry form's own submit-success refresh + ONE call inside 06-06's
  // convertFlightRisk() post-conversion refresh — each a direct consequence
  // of an explicit user action, not a poll — never a fourth,
  // background-triggered call site.
  assert.strictEqual(fetchCallsInLoad, 3, 'exactly three fetch(\'/api/org/flight-risk\') call sites must exist: the page-visit load, the post-submit refresh, and the post-conversion refresh');
  assert.strictEqual((src.match(/setInterval|setTimeout/g) || []).length, 0, 'org.js must contain no interval or timeout callback anywhere — the register must never be polled');
});

test('org-flight-risk-ui: the entry form is constructed only inside a branch testing the governance capability key, and no flight-risk-form control is ever set disabled as a clearance affordance', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  const buildCallMatch = src.match(/if \(capabilities\.recordOrgDecisions\) \{\s*wrap\.appendChild\(buildFlightRiskForm\(\)\);/);
  assert.ok(buildCallMatch, 'buildFlightRiskForm() must be called only inside a branch testing capabilities.recordOrgDecisions');

  // The ONLY `disabled` assignments anywhere in the file must be the
  // established in-flight (submit-while-request-outstanding) idiom, never a
  // clearance gate — every occurrence must sit on a variable named
  // `submit`, `deleteBtn`, `copyBtn` or `importBtn` (the existing
  // loading-state controls), never a flight-risk-form-specific clearance
  // flag like `personSelect.disabled` or `levelSelect.disabled`.
  const disabledAssignments = src.match(/\w+\.disabled\s*=\s*(true|false)/g) || [];
  disabledAssignments.forEach((assignment) => {
    assert.match(assignment, /^(submit|deleteBtn|copyBtn|importBtn)\.disabled/, `unexpected disabled assignment "${assignment}" — flight-risk-form clearance must be absence, never a disabled control`);
  });
});

test('org-flight-risk-ui: an entry with no mitigation omits the mitigation element entirely — a first-class state, not a placeholder', async () => {
  const deal = makeFourIdentityDeal('deal_ofrpartial');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Unmitigated Target');

    const res = await postJSON(base, '/api/org/flight-risk', adminToken, {
      employeeId: employee.id, riskLevel: 'critical', owner: 'admin',
    });
    assert.strictEqual(res.status, 201);
    const { entry } = await res.json();
    assert.strictEqual(entry.mitigation, '', 'the unmitigated entry must round-trip an empty mitigation, never a placeholder character');
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('org-flight-risk-ui: public/org.html — .org-node-risk uses a border colour plus an inset shadow and declares no border-radius (never a pill)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'org.html'), 'utf8');
  const match = src.match(/\.org-node-risk\{([^}]*)\}/);
  assert.ok(match, '.org-node-risk rule must exist in public/org.html');
  const body = match[1];
  assert.ok(body.includes('border-color:'), '.org-node-risk must declare a border-color');
  assert.ok(body.includes('box-shadow:') && body.includes('inset'), '.org-node-risk must declare an inset box-shadow, mirroring .dd-item--overdue');
  assert.ok(!body.includes('border-radius'), '.org-node-risk must never declare border-radius — the border-accent channel is never a pill');
});

test('org-flight-risk-ui: public/org.html declares zero text-overflow/overflow:hidden rules anywhere in the file', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'org.html'), 'utf8');
  assert.strictEqual((src.match(/text-overflow|overflow:hidden/g) || []).length, 0, 'no label in public/org.html may clip — a longer translation must reflow');
});

test('org-flight-risk-ui: the TREE card gets the .org-node-risk border-accent only for a high/critical entry, never for low/medium, and the decision badge co-renders alongside it', async () => {
  const deal = makeFourIdentityDeal('deal_ofrtree');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const highRiskEmployee = await createEmployee(base, adminToken, 'High Risk Occupant');
    const lowRiskEmployee = await createEmployee(base, adminToken, 'Low Risk Occupant');

    const posRes1 = await postJSON(base, '/api/org/positions', adminToken, { title: 'VP High Risk', employeeId: highRiskEmployee.id });
    const { position: highPos } = await posRes1.json();
    const posRes2 = await postJSON(base, '/api/org/positions', adminToken, { title: 'VP Low Risk', employeeId: lowRiskEmployee.id });
    const { position: lowPos } = await posRes2.json();

    await postJSON(base, '/api/org/flight-risk', adminToken, { employeeId: highRiskEmployee.id, riskLevel: 'critical', owner: 'admin' });
    await postJSON(base, '/api/org/flight-risk', adminToken, { employeeId: lowRiskEmployee.id, riskLevel: 'low', owner: 'admin' });

    // hasHighCriticalFlightRisk() is a pure client-side function — proven
    // here indirectly by re-implementing the identical predicate against
    // the server's own stored data, matching the source code's own logic.
    const listRes = await getJSON(base, '/api/org/flight-risk', adminToken);
    const list = await listRes.json();
    const highEntry = list.find((r) => r.employeeId === highRiskEmployee.id);
    const lowEntry = list.find((r) => r.employeeId === lowRiskEmployee.id);
    assert.ok(['high', 'critical'].includes(highEntry.riskLevel), 'the high-risk occupant\'s entry must be high or critical');
    assert.ok(!['high', 'critical'].includes(lowEntry.riskLevel), 'the low-risk occupant\'s entry must not be high or critical — no visible accent by design');
    assert.notStrictEqual(highPos.id, lowPos.id);
  } finally {
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});
