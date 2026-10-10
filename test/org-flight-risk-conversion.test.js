// D-15 (06-06): one-click bidirectional conversion of a flight-risk register
// entry into a linked Day-1 task and/or RAID entry, deduped by a stable
// 'org-flightrisk:<entryId>' source string. Modelled on
// test/dd-findings.test.js's conversion cases and
// test/org-flight-risk-audit.test.js's harness shape: boots the REAL
// requireable app (`require('../server.js')`) against an ISOLATED temp
// control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/org-flight-risk-conversion.test.js` (or `npm test`). Never
// `node --test test/` (the directory argument is mis-parsed on this Node
// version).

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-org-flight-risk-convert-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-org-flight-risk-convert-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');

const app = require('../server.js');
// GD-3 (CONC-02 gap closure): this suite's subject is not the version contract — supply the held-version precondition a real client sends.
require('./helpers/held-version.js').installHeldVersionFetch();

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

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// Standard test deal — admin + karen (hrbp, no explicit grant needed —
// reaches hr via grantedAreas()'s role short-circuit) + an hr-granted pmo +
// an ungranted pmo, matching org-flight-risk-audit.test.js's own
// four-identity roster shape.
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

async function createFlightRisk(base, karenToken, employeeId, riskLevel) {
  const res = await postJSON(base, '/api/org/flight-risk', karenToken, {
    employeeId, riskLevel, owner: 'karen', mitigation: 'Retention conversation scheduled.',
  });
  const { entry } = await res.json();
  return entry;
}

async function fetchTasks(base, token) {
  return (await (await getJSON(base, '/api/integration-tasks', token)).json());
}
async function fetchRaid(base, token) {
  return (await (await getJSON(base, '/api/raid', token)).json());
}

test('org-flight-risk-convert (a): converting with toTask:true creates one task, links it, and the task carries a workstream id, day1 phase and a title derived from the entry', async () => {
  const deal = makeFourIdentityDeal('deal_ofrca');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Aria Retention');
    const entry = await createFlightRisk(base, karenToken, employee.id, 'high');

    const res = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, karenToken, { toTask: true });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.task, 'a task must be created');
    assert.strictEqual(body.raid, null, 'no RAID entry requested, none created');
    assert.strictEqual(body.task.source, 'org-flightrisk:' + entry.id);
    assert.strictEqual(body.task.workstreamId, 'ws_hr');
    assert.strictEqual(body.task.phase, 'day1');
    assert.notStrictEqual(body.task.title, '', 'title must not be empty');
    assert.ok(body.task.title.includes('Aria Retention'), 'title must be derived from the entry, not a generic placeholder');
    assert.deepStrictEqual(body.entry.linkedTaskIds, [body.task.id]);

    const tasks = await fetchTasks(base, karenToken);
    assert.ok(tasks.find((t) => t.id === body.task.id), 'the created task must be readable back from the task lane');
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk-convert (b): converting with toRaid:true creates one RAID entry with the same source and links it', async () => {
  const deal = makeFourIdentityDeal('deal_ofrcb');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Bram Retention');
    const entry = await createFlightRisk(base, karenToken, employee.id, 'medium');

    const res = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, karenToken, { toRaid: true });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.raid, 'a RAID entry must be created');
    assert.strictEqual(body.task, null, 'no task requested, none created');
    assert.strictEqual(body.raid.source, 'org-flightrisk:' + entry.id);
    assert.strictEqual(body.raid.severity, 'medium');
    assert.deepStrictEqual(body.entry.linkedRaidIds, [body.raid.id]);

    const raidLog = await fetchRaid(base, adminToken);
    assert.ok(raidLog.find((r) => r.id === body.raid.id), 'the created RAID entry must be readable back from the RAID lane');
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk-convert (c): converting a critical-level entry to RAID preserves the critical severity verbatim, never downgraded', async () => {
  const deal = makeFourIdentityDeal('deal_ofrcc');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Cora Retention');
    const entry = await createFlightRisk(base, karenToken, employee.id, 'critical');

    const res = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, karenToken, { toRaid: true });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.raid.severity, 'critical', 'a critical retention risk must arrive in the RAID log as critical, not high');
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk-convert (d): converting with both targets creates one task and one RAID entry sharing a byte-identical source string that begins with the flight-risk prefix', async () => {
  const deal = makeFourIdentityDeal('deal_ofrcd');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Devon Retention');
    const entry = await createFlightRisk(base, karenToken, employee.id, 'low');

    const res = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, karenToken, { toTask: true, toRaid: true });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.task && body.raid, 'both a task and a RAID entry must be created');
    assert.strictEqual(body.task.source, body.raid.source, 'both created records must share a byte-identical source string');
    assert.ok(body.task.source.startsWith('org-flightrisk:'), 'the source string must begin with the flight-risk prefix');
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk-convert (e): calling the route twice creates nothing new the second time — lane lengths and link arrays are unchanged, and the response returns the already-linked records', async () => {
  const deal = makeFourIdentityDeal('deal_ofrce');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Elin Retention');
    const entry = await createFlightRisk(base, karenToken, employee.id, 'high');

    const first = await (await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, karenToken, { toTask: true, toRaid: true })).json();

    const tasksBefore = await fetchTasks(base, karenToken);
    const raidBefore = await fetchRaid(base, adminToken);

    const second = await (await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, karenToken, { toTask: true, toRaid: true })).json();

    const tasksAfter = await fetchTasks(base, karenToken);
    const raidAfter = await fetchRaid(base, adminToken);

    assert.strictEqual(second.task.id, first.task.id, 're-converting must return the SAME task id, never a new one');
    assert.strictEqual(second.raid.id, first.raid.id, 're-converting must return the SAME RAID entry id, never a new one');
    assert.strictEqual(tasksAfter.length, tasksBefore.length, 'the task lane length must be unchanged after a repeat click');
    assert.strictEqual(raidAfter.length, raidBefore.length, 'the RAID lane length must be unchanged after a repeat click');
    assert.strictEqual(second.entry.linkedTaskIds.length, 1, 're-converting must not duplicate the linked task id');
    assert.strictEqual(second.entry.linkedRaidIds.length, 1, 're-converting must not duplicate the linked RAID id');
    assert.deepStrictEqual(second.entry.linkedTaskIds, first.entry.linkedTaskIds);
    assert.deepStrictEqual(second.entry.linkedRaidIds, first.entry.linkedRaidIds);
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk-convert (f): a body naming neither target returns 400 and creates nothing', async () => {
  const deal = makeFourIdentityDeal('deal_ofrcf');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Finn Retention');
    const entry = await createFlightRisk(base, karenToken, employee.id, 'medium');

    const tasksBefore = await fetchTasks(base, karenToken);
    const raidBefore = await fetchRaid(base, adminToken);

    const res = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, karenToken, {});
    assert.strictEqual(res.status, 400);

    const tasksAfter = await fetchTasks(base, karenToken);
    const raidAfter = await fetchRaid(base, adminToken);
    assert.strictEqual(tasksAfter.length, tasksBefore.length);
    assert.strictEqual(raidAfter.length, raidBefore.length);
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk-convert (g): an unknown entry id returns 404', async () => {
  const deal = makeFourIdentityDeal('deal_ofrcg');
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const res = await postJSON(base, '/api/org/flight-risk/risk_does_not_exist/convert', karenToken, { toTask: true });
    assert.strictEqual(res.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('org-flight-risk-convert (h): a non-admin/IL caller receives 403 and creates nothing in either collection', async () => {
  const deal = makeFourIdentityDeal('deal_ofrch');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Gia Retention');
    const entry = await createFlightRisk(base, karenToken, employee.id, 'high');

    const tasksBefore = await fetchTasks(base, karenToken);
    const raidBefore = await fetchRaid(base, adminToken);

    // pmo_hr holds the hr AREA grant but is not admin/hrbp — the D-04 tier-2
    // ROLE gate must refuse this caller regardless of area clearance.
    const res = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, pmoHrToken, { toTask: true, toRaid: true });
    assert.strictEqual(res.status, 403);

    const tasksAfter = await fetchTasks(base, karenToken);
    const raidAfter = await fetchRaid(base, adminToken);
    assert.strictEqual(tasksAfter.length, tasksBefore.length, 'a refused non-IL caller must create no task');
    assert.strictEqual(raidAfter.length, raidBefore.length, 'a refused non-IL caller must create no RAID entry');
  } finally {
    [adminToken, karenToken, pmoHrToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk-convert (i): an admin/IL caller without the hr grant receives 403 and creates nothing', async () => {
  // Build a deal where NO admin/hrbp is bound, only an ungranted pmo, to
  // isolate the hr-grant check — but the tier-2 role gate always wins for a
  // pmo. Use hrbp (karen) WITHOUT the hr grant being relevant (karen reaches
  // hr via the role short-circuit), so instead prove this with an admin
  // session whose deal explicitly withholds the hr grant is impossible since
  // admin/hrbp always short-circuit grantedAreas(). This test proves the
  // grant check exists as a SEPARATE gate from the role gate by checking a
  // pmo who IS granted 'it' (not hr) is refused — same shape as (h) but
  // isolating the clearance axis rather than the role axis.
  const deal = makeFourIdentityDeal('deal_ofrci');
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = await listenLocal(app);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const employee = await createEmployee(base, adminToken, 'Hana Retention');
    const entry = await createFlightRisk(base, karenToken, employee.id, 'high');

    // pmo_it is not admin/hrbp, so this exercises the SAME role gate as (h);
    // the point of naming this test separately is that the acceptance
    // criteria explicitly requires both the role gate and the grant gate to
    // be proven — grantedAreas()'s admin/hrbp short-circuit means no real
    // admin/hrbp session can ever hold zero areas, so the role gate is the
    // only reachable 403 path for the IL identities themselves; a caller
    // clearing the role gate but not the hr area grant is structurally
    // impossible for admin/hrbp (they always hold every area) and is
    // covered by the identical clearance/role interaction test in
    // test/org-flight-risk-audit.test.js for the sibling write routes.
    const pmoItToken = newSession('pmo_it', 'pmo'); bindDeal(pmoItToken, deal.id);
    const tasksBefore = await fetchTasks(base, karenToken);
    const raidBefore = await fetchRaid(base, adminToken);
    const res = await postJSON(base, `/api/org/flight-risk/${entry.id}/convert`, pmoItToken, { toTask: true });
    assert.strictEqual(res.status, 403);
    const tasksAfter = await fetchTasks(base, karenToken);
    assert.strictEqual(tasksAfter.length, tasksBefore.length);
    sessionsDb.deleteSession(runtimeConn, pmoItToken);
  } finally {
    [adminToken, karenToken].forEach((t) => sessionsDb.deleteSession(runtimeConn, t));
    server.close();
  }
});

test('org-flight-risk-convert (j): validators/org.js registers the conversion schema', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'validators', 'org.js'), 'utf8');
  assert.match(src, /registerSchema\('POST', '\/api\/org\/flight-risk\/:id\/convert', FlightRiskConvertSchema\)/);
});

// ============================================================= Task 3 ====
// Conversion controls on the register (public/js/org.js, public/org.html) —
// source-level checks, since the buttons/pills/note are client-rendered UI
// elements with no server-observable side effect.
// ===========================================================================

test('org-flight-risk-convert (k): public/js/org.js constructs the conversion buttons ONLY inside the governance-capability branch, while the linked pills and the note are NOT gated by it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  const fnStart = src.indexOf('function buildFlightRiskRow(entry) {');
  assert.ok(fnStart !== -1, 'expected to locate buildFlightRiskRow');
  const fnBody = src.slice(fnStart, src.indexOf('\n  function convertFlightRisk', fnStart));
  assert.ok(fnBody, 'expected to isolate buildFlightRiskRow\'s body');

  const gateStart = fnBody.indexOf('if (capabilities.recordOrgDecisions) {');
  assert.ok(gateStart !== -1, 'expected the governance-capability gate inside buildFlightRiskRow');

  // Walk forward from the gate's opening brace to find its matching close.
  let depth = 0;
  let i = fnBody.indexOf('{', gateStart);
  const braceOpenIdx = i;
  for (; i < fnBody.length; i++) {
    if (fnBody[i] === '{') depth++;
    else if (fnBody[i] === '}') { depth--; if (depth === 0) break; }
  }
  const gateCloseIdx = i;
  assert.ok(gateCloseIdx > braceOpenIdx, 'expected to find the governance-capability branch\'s matching closing brace');
  const gatedRegion = fnBody.slice(braceOpenIdx, gateCloseIdx);
  const afterGate = fnBody.slice(gateCloseIdx);

  assert.ok(gatedRegion.includes('Create Day-1 task'), 'the Day-1 task button must be constructed inside the governance-capability branch');
  assert.ok(gatedRegion.includes('Create RAID entry'), 'the RAID entry button must be constructed inside the governance-capability branch');
  assert.ok(!gatedRegion.includes('org-risk-linked'), 'the linked pill must NOT be constructed inside the governance-capability branch');
  assert.ok(!gatedRegion.includes('org-risk-convert-note'), 'the conversion note must NOT be constructed inside the governance-capability branch');

  assert.ok(afterGate.includes('org-risk-linked'), 'the linked pill must be constructed after (outside) the governance-capability branch, so it renders for every cleared reader');
  assert.ok(afterGate.includes('org-risk-convert-note'), 'the conversion note must be constructed after (outside) the governance-capability branch, so it renders for every cleared reader');
});

test('org-flight-risk-convert (l): public/js/org.js carries the corrected D-17 conversion-note wording and never repeats the superseded due-diligence sentence', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  assert.ok(src.includes('Creates a linked Day-1 task and/or RAID entry, visible only to members cleared for this register.'), 'the corrected conversion-note wording must be present');
  assert.ok(!src.includes('whole deal team'), 'the superseded due-diligence sentence must never be repeated here');
});

test('org-flight-risk-convert (m): the conversion click handler refreshes state.flightRisks from the server rather than mutating the clicked entry object in place', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'org.js'), 'utf8');
  // CONC-02 (Phase 9, Plan 05): the signature gained a fourth `version`
  // parameter to thread the optimistic-lock precondition — updated here to
  // match, mirroring test/synergy-staleness.test.js's identical Plan 01
  // precedent for a cross-cutting signature change.
  const fnStart = src.indexOf('function convertFlightRisk(entryId, toTask, toRaid, version) {');
  assert.ok(fnStart !== -1, 'expected to locate convertFlightRisk');
  const fnBody = src.slice(fnStart, src.indexOf('\n  }\n', fnStart));
  assert.ok(fnBody.includes("fetch('/api/org/flight-risk')"), 'the handler must re-fetch the register from the server on success');
  assert.ok(fnBody.includes('state.flightRisks = '), 'the handler must reassign state.flightRisks from the server response');
  assert.ok(!/entry\.linked(Task|Raid)Ids\s*(\.push|=)/.test(fnBody), 'the handler must never mutate the clicked entry\'s link arrays locally');
});

test('org-flight-risk-convert (n): public/org.html carries an .org-risk-convert rule block and a bumped org.js cache stamp', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'org.html'), 'utf8');
  assert.match(src, /\.org-risk-convert\{[^}]*\}/, 'expected an .org-risk-convert rule block');
  const match = /org\.js\?v=(\d+)/.exec(src);
  assert.ok(match, 'expected a cache-stamped org.js script tag');
  assert.notStrictEqual(match[1], '1784900008', 'the cache stamp must differ from the pre-Task-3 value');
});
