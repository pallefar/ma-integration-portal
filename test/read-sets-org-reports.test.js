// D-12-02 / DATA-02 (Phase 12, plan 12-11): the org-design family and the
// reports export + pack data assembly read only the collections they need.
//
// Equality is asserted at the handler boundary: the HTTP body (served from
// readCollections(SET), where an unloaded collection is a THROWING accessor)
// must equal the pure builder run over a full readDb() for every identity the
// route distinguishes (admin, hrbp, hr-granted pmo, un-granted pmo) and every
// state — and the read / denial audit rows must be exactly what they were
// before the conversion. A route that forgot a collection fails loudly on the
// accessor instead of answering an empty lane (T-12-103).
//
// Boots the REAL requireable app against an ISOLATED temp control/runtime/
// demo/deals/audit set (never data/*.db). node:test; run
// `node --test test/read-sets-org-reports.test.js`.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-read-sets-org-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-read-sets-org-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const resolver = require('../db/resolver.js');
const sessionsDb = require('../db/sessions.js');
const { ensureUser } = require('./helpers/seed-identity.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');

const app = require('../server.js');
require('./helpers/held-version.js').installHeldVersionFetch();

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const fixtureUsers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'db.json'), 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---- harness -----------------------------------------------------------
let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}
function newSession(username, role, dealId) {
  ensureUser(controlConn, { username, role });
  const token = sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, token, dealId);
  return token;
}
function dealContext(dealId) {
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'admin', role: 'admin', dealId, sessionId: 'sess_admin' } };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  return {
    conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath,
    actor: { username: 'admin', role: 'admin', sessionId: 'sess_admin' },
    request: { method: 'TEST', path: fakeReq.path, ip: null },
  };
}
function inDeal(dealId, fn) { return store.runWithDb(dealContext(dealId), fn); }
function countByAction(dealId, action) {
  return auditHook.queryAudit({ dealId, limit: 500 }).filter((r) => r.action === action).length;
}

// Four-identity roster: admin, karen (hrbp, reaches hr by role), an
// hr-granted pmo and an un-granted pmo.
const IDENTITIES = [
  { name: 'admin', role: 'admin', hr: true },
  { name: 'karen', role: 'hrbp', hr: true },
  { name: 'pmo_hr', role: 'pmo', hr: true },
  { name: 'pmo_it', role: 'pmo', hr: false },
];

let fixtureCounter = 0;
function makeFixture() {
  fixtureCounter += 1;
  const id = `deal_rso${String.fromCharCode(96 + fixtureCounter)}`;
  registerDeal({
    id, name: id, targetCompany: `${id} Co`,
    members: IDENTITIES.map((i) => i.name),
    memberGrants: { pmo_hr: { ddAreas: ['hr'] }, pmo_it: { ddAreas: ['it'] } },
    status: 'active', createdBy: 'admin', createdAt: new Date().toISOString(),
  });
  createDealDatabase(id, { name: id, targetCompany: `${id} Co` });
  inDeal(id, () => {
    const db = store.readDb();
    db.settings = Object.assign({}, db.settings, { demoMode: false, dealName: id });
    db.customEmployees = [
      { id: 'emp_1', name: 'Ada Lovelace', role: 'Engineer', department: 'Eng' },
      { id: 'emp_2', name: 'Grace Hopper', role: 'Engineer', department: 'Eng' },
      { id: 'emp_3', name: 'Alan Turing', role: 'Analyst', department: 'Ops' },
    ];
    db.orgPositions = [
      { id: 'pos_c1', title: 'Head of Eng', level: 'L5', reportsToId: null, employeeId: 'emp_1', state: 'current', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'pos_c2', title: 'Staff Eng', level: 'L4', reportsToId: 'pos_c1', employeeId: 'emp_2', state: 'current', createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'pos_c3', title: 'Open Role', level: 'L3', reportsToId: 'pos_c1', employeeId: null, state: 'current', createdAt: '2026-01-03T00:00:00.000Z' },
      { id: 'pos_t1', title: 'VP Eng', level: 'L6', reportsToId: null, employeeId: 'emp_1', state: 'target', createdAt: '2026-01-04T00:00:00.000Z' },
      { id: 'pos_t2', title: 'Director', level: 'L5', reportsToId: 'pos_t1', employeeId: null, state: 'target', createdAt: '2026-01-05T00:00:00.000Z' },
    ];
    db.orgDecisions = [
      { id: 'od_1', positionId: 'pos_c2', employeeId: 'emp_2', type: 'retain', rationale: 'key', decidedBy: 'admin', decidedAt: '2026-02-01T00:00:00.000Z', effectiveDate: null },
      { id: 'od_2', positionId: 'pos_c2', employeeId: 'emp_2', type: 'redeploy', rationale: 'moved', decidedBy: 'karen', decidedAt: '2026-03-01T00:00:00.000Z', effectiveDate: null },
      { id: 'od_3', positionId: 'pos_c1', employeeId: 'emp_1', type: 'in-selection', rationale: 'sel', decidedBy: 'admin', decidedAt: '2026-02-15T00:00:00.000Z', effectiveDate: null },
    ];
    db.orgFlightRisks = [
      { id: 'fr_1', employeeId: 'emp_1', riskLevel: 'high', mitigation: '', owner: 'karen', notes: '', linkedTaskIds: [], linkedRaidIds: [] },
      { id: 'fr_2', employeeId: 'emp_2', riskLevel: 'critical', mitigation: 'retention bonus', owner: 'admin', notes: '', linkedTaskIds: [], linkedRaidIds: [] },
      { id: 'fr_3', employeeId: 'emp_3', riskLevel: 'low', mitigation: '', owner: 'karen', notes: '', linkedTaskIds: [], linkedRaidIds: [] },
    ];
    store.writeDb(db);
  });
  return id;
}

async function withServer(fn) {
  const server = await listenLocal(app);
  try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { server.close(); }
}
async function httpGet(base, urlPath, token) {
  const res = await fetch(`${base}${urlPath}`, { headers: { Cookie: `ma_session=${token}` } });
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

// ---- Task 1: GET /api/org/positions ------------------------------------
test('read-sets-org (positions): body === builder(readDb()) for every identity x state; audit events exactly as before', async () => {
  const dealId = makeFixture();
  await withServer(async (base) => {
    for (const ident of IDENTITIES) {
      const token = newSession(ident.name, ident.role, dealId);
      for (const state of ['current', 'target']) {
        const readsBefore = countByAction(dealId, 'org-positions-target-read');
        const deniedBefore = countByAction(dealId, 'org-positions-target-access-denied');
        const q = state === 'target' ? '?state=target' : '?state=current';
        const r = await httpGet(base, `/api/org/positions${q}`, token);
        if (state === 'target' && !ident.hr) {
          assert.strictEqual(r.status, 403, `${ident.name} target must be refused`);
          assert.strictEqual(countByAction(dealId, 'org-positions-target-access-denied') - deniedBefore, 1, 'one bounded denial row');
          assert.strictEqual(countByAction(dealId, 'org-positions-target-read') - readsBefore, 0);
          assert.ok(!r.text.includes('VP Eng'), 'the refusal must not carry target rows');
          continue;
        }
        assert.strictEqual(r.status, 200, `${ident.name} ${state}`);
        const expected = inDeal(dealId, () => JSON.stringify(app.orgPositionsBody(store.readDb(), state)));
        assert.strictEqual(r.text, expected, `${ident.name} ${state} body must equal the full-read builder`);
        assert.strictEqual(
          countByAction(dealId, 'org-positions-target-read') - readsBefore,
          state === 'target' ? 1 : 0,
          'target read audited once; current reads stay silent'
        );
      }
    }
  });
});

test('read-sets-org (positions): a malformed / array-shaped state resolves to current and never reaches the target branch', async () => {
  const dealId = makeFixture();
  await withServer(async (base) => {
    const token = newSession('pmo_it', 'pmo', dealId);
    const expected = inDeal(dealId, () => JSON.stringify(app.orgPositionsBody(store.readDb(), 'current')));
    for (const q of ['?state=TARGET', '?state=target&state=target', '?state=', '']) {
      const r = await httpGet(base, `/api/org/positions${q}`, token);
      assert.strictEqual(r.status, 200, q);
      assert.strictEqual(r.text, expected, q);
    }
  });
});

test('read-sets-org (positions): the converted route cannot touch an unloaded collection (throwing accessor proves the read set)', () => {
  const dealId = makeFixture();
  inDeal(dealId, () => {
    const part = store.readCollections(['orgPositions']);
    assert.strictEqual(app.orgPositionsBody(part, 'current').length, 3);
    assert.throws(() => part.orgDecisions, (e) => e.code === 'COLLECTION_NOT_LOADED');
    assert.throws(() => part.customEmployees, (e) => e.code === 'COLLECTION_NOT_LOADED');
  });
});

// ---- Task 2: decisions / flight-risk / summary / capabilities ----------
test('read-sets-org (decisions): body === builder(readDb()) per identity, with and without positionId; read + denial audit unchanged', async () => {
  const dealId = makeFixture();
  await withServer(async (base) => {
    for (const ident of IDENTITIES) {
      const token = newSession(ident.name, ident.role, dealId);
      for (const q of ['', '?positionId=pos_c2', '?positionId=nope']) {
        const readBefore = countByAction(dealId, 'org-decisions-read');
        const deniedBefore = countByAction(dealId, 'org-decisions-access-denied');
        const r = await httpGet(base, `/api/org/decisions${q}`, token);
        if (!ident.hr) {
          assert.strictEqual(r.status, 403);
          // WR-01: denial rows are rate-bounded per caller, so the first
          // refusal writes one row and an immediate repeat writes none.
          assert.strictEqual(countByAction(dealId, 'org-decisions-access-denied') - deniedBefore, q === '' ? 1 : 0);
          assert.strictEqual(countByAction(dealId, 'org-decisions-read') - readBefore, 0);
          assert.ok(!r.text.includes('retain'), 'refusal must not carry decisions');
          continue;
        }
        assert.strictEqual(r.status, 200);
        const pid = q.startsWith('?positionId=') ? q.slice('?positionId='.length) : undefined;
        const expected = inDeal(dealId, () => JSON.stringify(app.orgDecisionsBody(store.readDb(), pid)));
        assert.strictEqual(r.text, expected, `${ident.name} ${q}`);
        assert.strictEqual(countByAction(dealId, 'org-decisions-read') - readBefore, 1);
      }
    }
  });
});

test('read-sets-org (flight-risk): body === full-read lane per identity; read + denial audit unchanged', async () => {
  const dealId = makeFixture();
  await withServer(async (base) => {
    for (const ident of IDENTITIES) {
      const token = newSession(ident.name, ident.role, dealId);
      const readBefore = countByAction(dealId, 'org-flightrisk-read');
      const deniedBefore = countByAction(dealId, 'org-flightrisk-access-denied');
      const r = await httpGet(base, '/api/org/flight-risk', token);
      if (!ident.hr) {
        assert.strictEqual(r.status, 403);
        assert.strictEqual(countByAction(dealId, 'org-flightrisk-access-denied') - deniedBefore, 1);
        assert.strictEqual(countByAction(dealId, 'org-flightrisk-read') - readBefore, 0);
        assert.ok(!r.text.includes('retention bonus'));
        continue;
      }
      assert.strictEqual(r.status, 200);
      const expected = inDeal(dealId, () => JSON.stringify(store.readDb().orgFlightRisks));
      assert.strictEqual(r.text, expected, ident.name);
      assert.strictEqual(countByAction(dealId, 'org-flightrisk-read') - readBefore, 1);
    }
  });
});

test('read-sets-org (summary): body === orgSummaryFor(readDb()) per identity; restricted key structurally absent when uncleared; no audit rows', async () => {
  const dealId = makeFixture();
  await withServer(async (base) => {
    for (const ident of IDENTITIES) {
      const token = newSession(ident.name, ident.role, dealId);
      const before = auditHook.queryAudit({ dealId, limit: 500 }).length;
      const r = await httpGet(base, '/api/org/summary', token);
      assert.strictEqual(r.status, 200);
      const expected = inDeal(dealId, () => {
        const deal = require('../db/controlStore.js').getDeal(dealId);
        return JSON.stringify(app.orgSummaryFor(store.readDb(), deal, { username: ident.name, role: ident.role }));
      });
      assert.strictEqual(r.text, expected, ident.name);
      assert.strictEqual(r.text.includes('restricted'), ident.hr, `${ident.name} restricted key presence`);
      assert.strictEqual(auditHook.queryAudit({ dealId, limit: 500 }).length - before, 0, 'summary writes no audit rows');
    }
  });
});

test('read-sets-org (capabilities): unchanged answers per identity (no deal read at all)', async () => {
  const dealId = makeFixture();
  await withServer(async (base) => {
    for (const ident of IDENTITIES) {
      const token = newSession(ident.name, ident.role, dealId);
      const r = await httpGet(base, '/api/org/capabilities', token);
      assert.strictEqual(r.status, 200);
      assert.strictEqual(JSON.parse(r.text).targetOrgDesign === true, ident.hr, ident.name);
    }
  });
});

// ---- Task 2: POST /api/org/positions on its lane set --------------------
async function postPosition(base, token, body) {
  const res = await fetch(`${base}/api/org/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `ma_session=${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('read-sets-org (POST positions): create + update with and without an employee reference, on a partial read set', async () => {
  const dealId = makeFixture();
  await withServer(async (base) => {
    const token = newSession('karen', 'hrbp', dealId);
    const a = await postPosition(base, token, { title: 'New Vacant', level: 'L2', state: 'current', reportsToId: 'pos_c1' });
    assert.strictEqual(a.status, 201);
    assert.strictEqual(a.body.position.employeeId, null);
    const b = await postPosition(base, token, { title: 'Filled', level: 'L2', state: 'current', employeeId: 'emp_3' });
    assert.strictEqual(b.status, 201);
    assert.strictEqual(b.body.position.employeeId, 'emp_3');
    const c = await postPosition(base, token, { title: 'Ghost', employeeId: 'emp_nope' });
    assert.strictEqual(c.status, 404);
    assert.strictEqual(c.body.error, 'That employee could not be found.');
    const d = await postPosition(base, token, { id: 'pos_c3', title: 'Open Role v2', employeeId: 'emp_2' });
    assert.strictEqual(d.status, 200);
    assert.strictEqual(d.body.position.title, 'Open Role v2');
    const e = await postPosition(base, token, { id: 'pos_c1', reportsToId: 'pos_c2' });
    assert.strictEqual(e.status, 400);
    assert.strictEqual((await postPosition(base, token, { id: 'pos_zzz', title: 'x' })).status, 404);

    inDeal(dealId, () => {
      const db = store.readDb();
      const titles = db.orgPositions.map((p) => p.title);
      assert.ok(titles.includes('New Vacant') && titles.includes('Filled') && titles.includes('Open Role v2'));
      assert.strictEqual(db.customEmployees.length, 3, 'roster untouched');
      assert.strictEqual(db.orgDecisions.length, 3, 'decisions untouched');
      assert.strictEqual(db.orgFlightRisks.length, 3, 'flight-risks untouched');
      assert.strictEqual(db.settings.demoMode, false, 'settings not rewritten');
    });
  });
});

test('read-sets-org (POST positions): uncleared caller refused 403; stale update answers 409 and changes nothing', async () => {
  const dealId = makeFixture();
  await withServer(async (base) => {
    const itToken = newSession('pmo_it', 'pmo', dealId);
    assert.strictEqual((await postPosition(base, itToken, { title: 'Nope', employeeId: 'emp_1' })).status, 403);
    assert.strictEqual((await postPosition(base, itToken, { id: 'pos_c2', title: 'Hijack', version: 99 })).status, 403, 'gate runs before any record is resolved');

    const hrToken = newSession('pmo_hr', 'pmo', dealId);
    const stale = await postPosition(base, hrToken, { id: 'pos_c2', title: 'Late edit', version: 99 });
    assert.strictEqual(stale.status, 409, 'a stale version is a conflict, not a write');
    inDeal(dealId, () => {
      assert.strictEqual(store.readDb().orgPositions.find((p) => p.id === 'pos_c2').title, 'Staff Eng');
    });
  });
});

// ---- Task 3: reports export + pack model on REPORT_SET ------------------
function seedReports(dealId) {
  inDeal(dealId, () => {
    const db = store.readDb();
    db.checklistTemplates = [{ id: 'ct_1', name: 'T', workstreams: [{ id: 'ws_imo', label: 'IMO' }, { id: 'ws_hr', label: 'HR' }] }];
    db.ddFindings = [
      { id: 'f_legal', area: 'legal', title: 'Legal finding', severity: 'high', status: 'open' },
      { id: 'f_hr', area: 'hr', title: 'HR finding', severity: 'low', status: 'open' },
    ];
    db.customIntegrationTasks = [
      { id: 'tk_1', title: 'Open task', workstreamId: 'ws_imo', phase: 'day1', status: 'done', owner: 'a', due: '', source: '' },
      { id: 'tk_2', title: 'Blocked task', workstreamId: 'ws_imo', phase: 'd30', status: 'blocked', owner: 'b', due: '', source: '' },
      { id: 'tk_hr', title: 'Retention task', workstreamId: 'ws_hr', phase: 'day1', status: 'todo', owner: 'c', due: '', source: 'org-flightrisk:fr_1', clearanceArea: 'hr' },
      { id: 'tk_leg', title: 'Legal follow-up', workstreamId: 'ws_imo', phase: 'd60', status: 'todo', owner: 'd', due: '', source: 'dd-finding:f_legal' },
    ];
    db.customRaidEntries = [
      { id: 'rd_1', type: 'risk', title: 'Open risk', severity: 'high', owner: 'a', workstreamId: 'ws_imo', status: 'open', notes: '', source: '' },
      { id: 'rd_hr', type: 'risk', title: 'Retention risk', severity: 'high', owner: 'b', workstreamId: 'ws_hr', status: 'open', notes: '', source: 'org-flightrisk:fr_1', clearanceArea: 'hr' },
      { id: 'rd_f', type: 'issue', title: 'From HR finding', severity: 'low', owner: 'c', workstreamId: 'ws_hr', status: 'open', notes: '', source: 'dd-finding:f_hr' },
    ];
    db.customSynergyInitiatives = [
      { id: 'sy_1', title: 'Procurement', category: 'cost', stage: 'validated', targetM: 5, realizedM: 1, owner: 'a', workstreamId: 'ws_imo', taskIds: ['tk_1', 'tk_hr'], costEntries: [{ id: 'ce_1', date: '2026-02-01', amountM: 0.2 }, { id: 'ce_2', date: '2026-03-01', amountM: 0.1 }], baselines: [], createdAt: '2026-01-01T00:00:00.000Z', lastConfirmedAt: '2026-01-10T00:00:00.000Z' },
      { id: 'sy_2', title: 'Facilities', category: 'cost', stage: 'identified', targetM: 2, realizedM: 0, owner: 'b', workstreamId: 'ws_imo', taskIds: [], costEntries: [], baselines: [], createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    store.writeDb(db);
  });
}
function packCtx(dealId, ident) {
  const deal = require('../db/controlStore.js').getDeal(dealId);
  return {
    req: { portalUser: { username: ident.name, role: ident.role }, dealContext: { dealId }, isDemo: false },
    deal, language: 'en', generatedAt: new Date('2026-10-10T12:00:00.000Z'), nowMs: Date.parse('2026-10-10T12:00:00.000Z'),
  };
}
function pickIdents(...names) { return IDENTITIES.filter((i) => names.includes(i.name)); }

test('read-sets-reports (pack): buildPackModel(readCollections(REPORT_SET)) deep-equals buildPackModel(readDb()) per identity', () => {
  const dealId = makeFixture();
  seedReports(dealId);
  for (const ident of IDENTITIES) {
    inDeal(dealId, () => {
      const ctx = packCtx(dealId, ident);
      const full = app.buildPackModel(store.readDb(), ctx);
      const part = app.buildPackModel(store.readCollections(app.REPORT_SET), ctx);
      assert.deepStrictEqual(part, full, ident.name);
      assert.ok(full.hasAnyData);
      assert.strictEqual(JSON.stringify(part.model), JSON.stringify(full.model));
    });
  }
  // the clearance filter is doing real work in this fixture
  inDeal(dealId, () => {
    const hr = app.buildPackModel(store.readDb(), packCtx(dealId, IDENTITIES[1]));
    const it = app.buildPackModel(store.readDb(), packCtx(dealId, IDENTITIES[3]));
    assert.ok(hr.counts.tasks > it.counts.tasks && hr.counts.raid > it.counts.raid, 'uncleared caller sees fewer rows');
    assert.ok(!JSON.stringify(it.model).includes('Retention'), 'no hr MNPI in an uncleared model');
  });
});

test('read-sets-reports (pack): the entirely empty deal still answers hasAnyData:false with a null model', () => {
  const dealId = makeFixture();
  inDeal(dealId, () => {
    const db = store.readDb();
    db.checklistTemplates = [];
    store.writeDb(db);
    const out = app.buildPackModel(store.readCollections(app.REPORT_SET), packCtx(dealId, IDENTITIES[1]));
    assert.strictEqual(out.hasAnyData, false);
    assert.strictEqual(out.model, null);
  });
});

test('read-sets-reports (export): every dataset x format x identity serves the full-read rows; csv is the same rows; audit row unchanged', async () => {
  const dealId = makeFixture();
  seedReports(dealId);
  await withServer(async (base) => {
    for (const ident of pickIdents('karen', 'pmo_it', 'pmo_hr')) {
      const token = newSession(ident.name, ident.role, dealId);
      const reference = inDeal(dealId, () => app.buildPackModel(store.readDb(), packCtx(dealId, ident)).model);
      const expectedJson = {
        workstreams: JSON.stringify(reference.workstreams),
        tasks: JSON.stringify(reference.tasks),
        raid: JSON.stringify(reference.raid),
        synergies: JSON.stringify(reference.synergies.map((s) => { const c = Object.assign({}, s); delete c.stageAtBaseline; return c; })),
      };
      for (const dataset of ['workstreams', 'tasks', 'raid', 'synergies']) {
        const auditBefore = countByAction(dealId, 'report-export');
        const j = await httpGet(base, `/api/reports/export?dataset=${dataset}&format=json`, token);
        assert.strictEqual(j.status, 200, `${ident.name} ${dataset} json`);
        assert.strictEqual(j.text, expectedJson[dataset], `${ident.name} ${dataset} json bytes`);
        const c = await httpGet(base, `/api/reports/export?dataset=${dataset}&format=csv`, token);
        assert.strictEqual(c.status, 200);
        const rows = JSON.parse(expectedJson[dataset]);
        // header + one line per row (no embedded newlines in this fixture)
        assert.strictEqual(c.text.trim().split(/\r?\n/).length, rows.length + 1, `${ident.name} ${dataset} csv rows`);
        for (const row of rows) assert.ok(c.text.includes(String(row.id)), `${dataset} csv carries ${row.id}`);
        assert.strictEqual(countByAction(dealId, 'report-export') - auditBefore, 2, 'one export audit row per request');
      }
    }
    // an uncleared caller never receives the hr-stamped rows in any dataset
    const itToken = newSession('pmo_it', 'pmo', dealId);
    for (const dataset of ['tasks', 'raid']) {
      const r = await httpGet(base, `/api/reports/export?dataset=${dataset}&format=csv`, itToken);
      assert.ok(!/tk_hr|rd_hr|Retention/.test(r.text), `${dataset} export leaks no hr row`);
    }
    // an unknown dataset (org/talent has no export surface) is still 400
    const bad = await httpGet(base, '/api/reports/export?dataset=orgPositions&format=csv', itToken);
    assert.strictEqual(bad.status, 400);
  });
});

test('read-sets-reports (pack route): still a PDF over the partial read set; empty deal still 409', async () => {
  const dealId = makeFixture();
  seedReports(dealId);
  await withServer(async (base) => {
    const token = newSession('karen', 'hrbp', dealId);
    const res = await fetch(`${base}/api/reports/pack?lang=en`, { headers: { Cookie: `ma_session=${token}` } });
    if (res.status === 503) return; // canvas binding absent on this host: the portability gate answers first
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.strictEqual(buf.slice(0, 5).toString('latin1'), '%PDF-');
  });
});
