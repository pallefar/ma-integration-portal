// T-ERM-01/T-ERM-02/T-ERM-03 (260810-erm, milestone-close Fable 5 review):
// closes the task-lane twin of the Phase-4/06-06 RAID gap (T-04-21) —
// converting a DD finding or a flight-risk entry into a TASK republished the
// identical MNPI title through what was, until this fix, an UNfiltered task
// lane. Proves BOTH directions, exactly like test/raid-access-filter.test.js:
// every identity's expected result is asserted as a SORTED ARRAY OF IDS,
// never a length, so an over-filter (fail-closed-to-useless) and an
// under-filter (a leak) are both caught by the same assertion.
//
// Modelled on test/raid-access-filter.test.js's harness shape exactly: boots
// the REAL requireable app (`require('../server.js')`) against an ISOLATED
// temp control/runtime/demo/deals/audit trio.
//
// node:test — Node's built-in runner. Run via `node --test
// test/task-access-filter.test.js` (or bare `node --test`). Never `node
// --test test/` (the directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-task-access-filter-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-task-access-filter-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');
// GD-3 (CONC-02 gap closure): this suite's subject is not the version contract — supply the held-version precondition a real client sends.
require('./helpers/held-version.js').installHeldVersionFetch();

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/raid-access-filter.test.js).
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
function getRaw(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function delReq(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { method: 'DELETE', headers: token ? { Cookie: cookieHeader(token) } : {} });
}
function sortedIds(arr) { return arr.map((e) => e.id).slice().sort(); }
function latestAuditRow() {
  const conn = auditHook.getAuditConnection();
  return conn.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 1').get();
}
function sortedIdsFromTasksCsv(csvText) {
  const body = csvText.replace(/^﻿/, '');
  const lines = body.split('\r\n').filter((l) => l.length > 0);
  const dataLines = lines.slice(1); // drop the header row
  return dataLines.map((line) => line.slice(0, line.indexOf(','))).sort();
}

// admin + karen (hrbp/IL, reaches every area via grantedAreas()'s role
// short-circuit) + a member granted ONLY 'legal' + a member granted ONLY
// 'hr' — deliberately two SEPARATE single-area members (not one member
// granted both) so the under-filter case and the include case are proven by
// two independent identities, never the same one accidentally covering both
// directions. Mirrors test/raid-access-filter.test.js's makeDeal exactly.
function makeDeal(id) {
  const deal = {
    id, name: id, targetCompany: `${id} Co`,
    members: ['admin', 'karen', 'pmo_legal', 'pmo_hr'],
    memberGrants: {
      pmo_legal: { ddAreas: ['legal'] },
      pmo_hr: { ddAreas: ['hr'] },
    },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  };
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

async function createFinding(base, adminToken, area, title) {
  const res = await postJSON(base, '/api/dd/findings', adminToken, { area, title, severity: 'high' });
  const { finding } = await res.json();
  return finding;
}
async function convertFindingToTask(base, adminToken, findingId) {
  const res = await postJSON(base, `/api/dd/findings/${findingId}/convert`, adminToken, { toTask: true });
  const body = await res.json();
  return body.task;
}
async function createEmployee(base, adminToken, name) {
  const res = await postJSON(base, '/api/employees', adminToken, { name, role: 'Engineer', department: 'Eng' });
  const { employee } = await res.json();
  return employee;
}
async function createFlightRisk(base, adminToken, employeeId, riskLevel) {
  const res = await postJSON(base, '/api/org/flight-risk', adminToken, {
    employeeId, riskLevel, owner: 'admin', mitigation: 'Retention conversation scheduled.',
  });
  const { entry } = await res.json();
  return entry;
}
async function convertFlightRiskToTask(base, adminToken, entryId) {
  const res = await postJSON(base, `/api/org/flight-risk/${entryId}/convert`, adminToken, { toTask: true });
  const body = await res.json();
  return body.task;
}
async function createManualTask(base, adminToken, title) {
  const res = await postJSON(base, '/api/integration-tasks', adminToken, { title, workstreamId: 'ws_imo' });
  const { task } = await res.json();
  return task;
}
// 07-02 Task 1's established pattern for directly seeding a checklist
// template row — there is no API surface to create one, and
// computeWorkstreamRollup(db) reads db.checklistTemplates[0].
function seedChecklistTemplate(dealId, workstreams) {
  const conn = store.getOrOpenConnection(dbFiles.dealDbPath(dealId), dbFiles.DEAL_SCHEMA_PATH);
  conn.prepare('INSERT INTO checklistTemplates (id, project_id, seq, data) VALUES (?, NULL, 0, ?)')
    .run('ck_test', JSON.stringify({ id: 'ck_test', workstreams }));
}

// Builds the standard four-task fixture: a manually created source-less
// task, a task converted from a 'legal' finding, a task converted from a
// 'financial' finding, and a task converted from a flight-risk record
// (fixed 'hr' area). Returns { deal, tokens, tasks, findings }.
async function seedFixture(base, id) {
  const deal = makeDeal(id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoLegalToken = newSession('pmo_legal', 'pmo'); bindDeal(pmoLegalToken, deal.id);
  const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);

  const manual = await createManualTask(base, adminToken, 'A manually created task with no source');
  const legalFinding = await createFinding(base, adminToken, 'legal', 'A legal finding');
  const legalTask = await convertFindingToTask(base, adminToken, legalFinding.id);
  const financialFinding = await createFinding(base, adminToken, 'financial', 'A financial finding');
  const financialTask = await convertFindingToTask(base, adminToken, financialFinding.id);
  const employee = await createEmployee(base, adminToken, 'Retention Target');
  const flightRisk = await createFlightRisk(base, adminToken, employee.id, 'high');
  const hrTask = await convertFlightRiskToTask(base, adminToken, flightRisk.id);

  return {
    deal,
    tokens: { adminToken, karenToken, pmoLegalToken, pmoHrToken },
    tasks: { manual, legalTask, financialTask, hrTask },
    findings: { legalFinding, financialFinding },
  };
}

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

test('task-access-filter (a): admin receives every task, including the manually created source-less one — the over-filtering regression a field-name-compatible-looking filter reuse would cause', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_tafa');
    const expected = sortedIds([fx.tasks.manual, fx.tasks.legalTask, fx.tasks.financialTask, fx.tasks.hrTask]);

    const res = await getJSON(base, '/api/integration-tasks', fx.tokens.adminToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(sortedIds(body), expected, 'an admin session must receive EVERY task, including the manually created one');
  } finally {
    server.close();
  }
});

test('task-access-filter (b): the IL (hrbp) identity receives every task, exactly like admin', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_tafb');
    const expected = sortedIds([fx.tasks.manual, fx.tasks.legalTask, fx.tasks.financialTask, fx.tasks.hrTask]);

    const res = await getJSON(base, '/api/integration-tasks', fx.tokens.karenToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(sortedIds(body), expected);
  } finally {
    server.close();
  }
});

test('task-access-filter (c): a member cleared only for legal receives the manual task and the legal-provenance task, and EXCLUDES the financial- and hr-provenance tasks', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_tafc');
    const expected = sortedIds([fx.tasks.manual, fx.tasks.legalTask]);

    const res = await getJSON(base, '/api/integration-tasks', fx.tokens.pmoLegalToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(sortedIds(body), expected, 'a legal-only member must see the manual task and the legal-provenance task, and NOTHING else');
  } finally {
    server.close();
  }
});

test('task-access-filter (d): a member cleared only for hr receives the manual task and the flight-risk-provenance task, and EXCLUDES the legal- and financial-provenance tasks', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_tafd');
    const expected = sortedIds([fx.tasks.manual, fx.tasks.hrTask]);

    const res = await getJSON(base, '/api/integration-tasks', fx.tokens.pmoHrToken);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(sortedIds(body), expected, 'an hr-only member must see the manual task and the flight-risk-provenance task, and NOTHING else');
  } finally {
    server.close();
  }
});

test('task-access-filter (e): the SAME exclusion holds for GET /api/reports/export?dataset=tasks — the CSV id set equals the caller\'s own /api/integration-tasks id set', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_tafe');

    for (const [name, token] of Object.entries(fx.tokens)) {
      const liveIds = sortedIds(await (await getJSON(base, '/api/integration-tasks', token)).json());
      const csvText = await (await getRaw(base, '/api/reports/export?dataset=tasks&format=csv', token)).text();
      const csvIds = sortedIdsFromTasksCsv(csvText);
      assert.deepStrictEqual(csvIds, liveIds, `${name}: dataset=tasks CSV id set must equal this identity's own live /api/integration-tasks id set`);

      const jsonBody = await (await getRaw(base, '/api/reports/export?dataset=tasks&format=json', token)).text();
      const jsonIds = JSON.parse(jsonBody).map((t) => t.id).sort();
      assert.deepStrictEqual(jsonIds, liveIds, `${name}: dataset=tasks JSON id set must equal this identity's own live /api/integration-tasks id set`);
    }
  } finally {
    server.close();
  }
});

test('task-access-filter (f): LOAD-BEARING (D-08 parity) — the pack\'s own tasks row count equals the caller\'s live /api/integration-tasks length, for a legal-only member', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_taff');

    const liveTasks = await (await getJSON(base, '/api/integration-tasks', fx.tokens.pmoLegalToken)).json();

    const packRes = await getRaw(base, '/api/reports/pack', fx.tokens.pmoLegalToken);
    assert.strictEqual(packRes.status, 200);
    const packBuf = Buffer.from(await packRes.arrayBuffer());
    assert.match(packBuf.toString('binary', 0, 8), /^%PDF-1\.4$/);

    const auditRow = latestAuditRow();
    assert.strictEqual(auditRow.action, 'report-pack-generated');
    assert.strictEqual(auditRow.actor_username, 'pmo_legal');
    const after = JSON.parse(auditRow.after_json);
    assert.strictEqual(after.rowCounts.tasks, liveTasks.length, 'the pack\'s own task row count must equal the caller\'s live /api/integration-tasks length, in the same run');
  } finally {
    server.close();
  }
});

test('task-access-filter (g): WR-03 parity — an entry whose originating finding has been DELETED still returns the converted task to admin, and STAYS INVISIBLE to a member who was never cleared for the finding\'s area — deletion must never retroactively declassify a converted task', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const fx = await seedFixture(base, 'deal_tafg');

    // Before deletion: the legal-only member must NOT see the financial-provenance task.
    const beforeLegalBody = await (await getJSON(base, '/api/integration-tasks', fx.tokens.pmoLegalToken)).json();
    assert.ok(!beforeLegalBody.some((t) => t.id === fx.tasks.financialTask.id), 'before deletion, a legal-only member must not see the financial-provenance task');

    const delRes = await delReq(base, `/api/dd/findings/${fx.findings.financialFinding.id}`, fx.tokens.adminToken);
    assert.strictEqual(delRes.status, 200);

    const adminAfter = await (await getJSON(base, '/api/integration-tasks', fx.tokens.adminToken)).json();
    assert.ok(adminAfter.some((t) => t.id === fx.tasks.financialTask.id), 'admin must still receive the task after its originating finding is deleted — an orphaned link must not become invisible to everyone');

    const legalAfter = await (await getJSON(base, '/api/integration-tasks', fx.tokens.pmoLegalToken)).json();
    assert.ok(!legalAfter.some((t) => t.id === fx.tasks.financialTask.id), 'after the originating finding is deleted, the task must REMAIN invisible to a member never cleared for the original financial area — fail-closed: deletion must never declassify');

    const hrAfter = await (await getJSON(base, '/api/integration-tasks', fx.tokens.pmoHrToken)).json();
    assert.ok(!hrAfter.some((t) => t.id === fx.tasks.financialTask.id), 'an hr-only member must also remain excluded from the orphaned-but-still-stamped financial task');
  } finally {
    server.close();
  }
});

test('task-access-filter (h): rollup count parity — a hidden hr-retention task is counted in ws_hr for pmo_hr/admin but NOT for pmo_legal', async () => {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const deal = makeDeal('deal_tafh');
    const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
    const pmoLegalToken = newSession('pmo_legal', 'pmo'); bindDeal(pmoLegalToken, deal.id);
    const pmoHrToken = newSession('pmo_hr', 'pmo'); bindDeal(pmoHrToken, deal.id);

    seedChecklistTemplate(deal.id, [{ id: 'ws_hr', label: 'HR & People', icon: '' }]);

    const employee = await createEmployee(base, adminToken, 'Rollup Retention Target');
    const flightRisk = await createFlightRisk(base, adminToken, employee.id, 'high');
    await convertFlightRiskToTask(base, adminToken, flightRisk.id);

    const rowFor = async (token) => {
      const rows = JSON.parse(await (await getRaw(base, '/api/reports/export?dataset=workstreams&format=json', token)).text());
      return rows.find((r) => r.id === 'ws_hr');
    };

    const adminRow = await rowFor(adminToken);
    assert.ok(adminRow, 'admin must see the ws_hr row');
    assert.strictEqual(adminRow.tasksTotal, 1, 'admin must count the hr-retention task in ws_hr');

    const hrRow = await rowFor(pmoHrToken);
    assert.ok(hrRow, 'pmo_hr must see the ws_hr row');
    assert.strictEqual(hrRow.tasksTotal, 1, 'pmo_hr must count the hr-retention task in ws_hr');

    const legalRow = await rowFor(pmoLegalToken);
    assert.ok(!legalRow || legalRow.tasksTotal === 0, 'pmo_legal must NOT count the hidden hr-retention task in ws_hr — either the row is absent (zero-task workstreams are dropped) or its count is zero, never 1');
  } finally {
    server.close();
  }
});

// ============================================================= Unit-level ===
// resolveTaskClearanceArea(task, db) proven directly against hand-built
// inputs, per this task's own behavior block — no HTTP round trip needed.
// ===========================================================================

test('task-access-filter (i): resolveTaskClearanceArea unit cases — empty source, absent source, dd-finding (live and orphaned), flight-risk prefix, unrecognised prefix, stamp precedence', () => {
  const resolve = app.resolveTaskClearanceArea;
  assert.strictEqual(typeof resolve, 'function', 'server.js must export resolveTaskClearanceArea for direct unit testing');

  assert.strictEqual(resolve({ source: '' }, { ddFindings: [] }), null, 'an empty source resolves to null');
  assert.strictEqual(resolve({}, { ddFindings: [] }), null, 'an absent source resolves to null');

  const db = { ddFindings: [{ id: 'find_1', area: 'legal' }] };
  assert.strictEqual(resolve({ source: 'dd-finding:find_1' }, db), 'legal', 'a live dd-finding source resolves to the finding\'s own area');
  assert.strictEqual(resolve({ source: 'dd-finding:find_missing' }, db), null, 'an orphaned dd-finding source (finding deleted) resolves to null, not to a withheld state');

  assert.strictEqual(resolve({ source: 'org-flightrisk:risk_1' }, { ddFindings: [] }), 'hr', 'a flight-risk source resolves to the fixed hr area');
  assert.strictEqual(resolve({ source: 'something-unrecognised:1' }, { ddFindings: [] }), null, 'an unrecognised source prefix resolves to null');

  // Stamp-first precedence — the fix's entire point: deletion of the origin
  // record must never widen an already-stamped task's audience back to null.
  assert.strictEqual(
    resolve({ source: 'dd-finding:find_missing', clearanceArea: 'legal' }, db),
    'legal',
    'a stamped clearanceArea must be preferred over source-parsing, even for an orphaned source',
  );
  assert.strictEqual(
    resolve({ source: 'dd-finding:find_1', clearanceArea: 'financial' }, db),
    'financial',
    'a stamped clearanceArea must win even when the source is still LIVE and would resolve to a different area',
  );
});

// ================================================================ Source-level ===
// The task list handler must reference reportTaskRows() (not a re-implemented
// filter), the STALE comment on the export tasks branch must be gone, and
// resolveTaskClearanceArea must exist immediately after
// resolveRaidEntryClearanceArea, structurally mirroring the RAID twin.
// ===================================================================================

test('task-access-filter (j): the GET /api/integration-tasks handler delegates to the single shared reportTaskRows() filter, proving the outbound filter is not a separately re-implemented predicate', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const routeMatch = /app\.get\('\/api\/integration-tasks',\s*\(req, res\) => \{([\s\S]*?)\n\}\);/.exec(src);
  assert.ok(routeMatch, 'expected to locate the GET /api/integration-tasks route handler body');
  assert.ok(routeMatch[1].includes('reportTaskRows('), 'the GET /api/integration-tasks handler must delegate to the shared reportTaskRows() filter, not re-implement it');
  const helperMatch = /function reportTaskRows\(db, deal, portalUser\) \{([\s\S]*?)\n\}/.exec(src);
  assert.ok(helperMatch, 'expected to locate the reportTaskRows() helper');
  assert.ok(helperMatch[1].includes('resolveTaskClearanceArea'), 'reportTaskRows() must call resolveTaskClearanceArea inside its own body');
});

test('task-access-filter (k): the export dataset=tasks branch and the pack tasks assignment both delegate to reportTaskRows(), and the stale "no per-item clearance concept" comment is gone', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(!src.includes('No per-item clearance concept exists on tasks today'), 'the stale false-disclosure comment on the export tasks branch must no longer be present — tasks are now clearance-filtered');

  const exportMatch = /\}\s*else if \(dataset === 'tasks'\) \{([\s\S]*?)\n\s*\} else \{/.exec(src);
  assert.ok(exportMatch, 'expected to locate the export dataset=tasks branch');
  assert.ok(exportMatch[1].includes('reportTaskRows('), 'the export dataset=tasks branch must delegate to reportTaskRows()');

  const packMatch = /const raid = reportRaidRows\(db, deal, req\.portalUser\);\s*\n\s*const workstreams = computeWorkstreamRollup\(db, deal, req\.portalUser\);\s*\n\s*const tasks = reportTaskRows\(db, deal, req\.portalUser\);/.exec(src);
  assert.ok(packMatch, 'the pack route must assemble raid/workstreams/tasks from the three caller-aware, clearance-filtered functions in sequence');
});

test('task-access-filter (l): both convert routes stamp clearanceArea on the created TASK object, mirroring their existing RAID-entry stamps', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const flightRiskConvertMatch = /app\.post\('\/api\/org\/flight-risk\/:id\/convert'[\s\S]*?\n\}\);/.exec(src);
  assert.ok(flightRiskConvertMatch, 'expected to locate the flight-risk convert route');
  assert.match(flightRiskConvertMatch[0], /title: `\$\{employeeName\} — retention risk mitigation`,[\s\S]*?clearanceArea: 'hr',/, 'the flight-risk convert route must stamp clearanceArea: \'hr\' on the created task object');

  const ddConvertMatch = /app\.post\('\/api\/dd\/findings\/:id\/convert'[\s\S]*?\n\}\);/.exec(src);
  assert.ok(ddConvertMatch, 'expected to locate the dd-finding convert route');
  assert.match(ddConvertMatch[0], /title: finding\.title,\s*\n\s*workstreamId,[\s\S]*?clearanceArea: finding\.area,/, 'the dd-finding convert route must stamp clearanceArea: finding.area on the created task object');
});
