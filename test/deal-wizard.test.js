// WIZ-01/D-24/D-05/D-07/D-09: proves the server side of the new-deal setup
// wizard end-to-end through the REAL HTTP stack — an assigned-but-unfinished
// readiness assessment that completes IN PLACE (never a duplicate row), a
// deal that exists after the mandatory core alone and remembers exactly
// which setup steps are still outstanding, one shared validation pipeline
// for every wizard step, and proof that diligence is never blocked on an
// unfinished assessment.
//
// Task 1 (this file's initial content): assign/complete-by-id on
// assessmentInstances, the status rollup's pending branch, and
// latestAssessInstanceFor()'s submitted-only filter.
//
// Task 2 extends this file with the deal create-early setup-state surface
// (POST /api/deals/wizard/basics, POST /api/deals/:id/setup,
// db/controlStore.js's updateDealSetup()).
//
// Task 3 extends this file with the full create-early/resume-later wizard
// flow proven as one ordered walk, D-09's no-hard-lock proof, the resume
// path, and the declared subject-order proof.
//
// Boots the REAL requireable app (`require('../server.js')`) against an
// ISOLATED temp control/runtime/demo/deals/audit trio, mirroring
// test/dd-vdr.test.js's own established harness shape. Unlike that harness,
// this suite's MA_DEMO_DB_PATH is a SYNTHETIC template source built in-file
// (test/deal-seed.test.js's own established buildSyntheticDemoSource()
// pattern) rather than an empty temp file — the wizard flow needs real
// assessment-template dimension/question shapes to score against, and
// pointing this at the actually-committed data/demo.db would risk a bug in
// this plan's code writing into the real showcase database.
//
// node:test — Node's built-in runner. Run via `node --test
// test/deal-wizard.test.js` (or `npm test`). Never `node --test test/` (the
// directory argument is mis-parsed on this Node version).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-deal-wizard-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db'); // never opened for a WRITE by any test below — every session is deal-bound
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = ''; // this suite never exercises the admin-token branch

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const { createDealDatabase } = require('../db/dealSeed.js');
const auditHook = require('../db/auditHook.js');
const controlStore = require('../db/controlStore.js');

const app = require('../server.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Seed real accounts directly (same rationale as test/dd-vdr.test.js).
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

// ---------------------------------------------------------------------------
// A synthetic "demo-shaped" template source database — real-shaped enough
// (subject/dimensions/questions matching the real seeded templates' own
// ids/structure) for scoreAssessmentInstance() to compute a real score, and
// real DD-request/checklist templates for Task 3's instantiate walk.
// ---------------------------------------------------------------------------
const TPL_ACQUIRER = 'atpl_company_acquirer';
const TPL_TARGET = 'atpl_company_target';
const TPL_IL = 'atpl_il_readiness';

const TEMPLATE_SOURCE_PATH = path.join(TMP_DIR, 'template-source.db');
(function buildTemplateSource() {
  const db = new Database(TEMPLATE_SOURCE_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8'));
  const insertRow = (table, id, projectId, seq, data) => {
    db.prepare(`INSERT INTO ${table} (id, project_id, seq, data) VALUES (?, ?, ?, ?)`)
      .run(id, projectId, seq, JSON.stringify(data));
  };

  const dimension = (dimId, qId) => ({
    id: dimId, mirrorId: dimId, weight: 1,
    questions: [{ id: qId, type: 'likert', weight: 1, text: 'Test question' }],
  });

  insertRow('assessmentTemplates', TPL_ACQUIRER, null, 0, {
    id: TPL_ACQUIRER, slug: 'company-readiness-acquirer', subject: 'acquirer-org',
    raterModes: ['self'], pairId: 'pair_company_readiness', required: true, gates: ['dashboard.phase1'],
    version: 1, scale: { min: 1, max: 5 },
    banding: { bands: [{ id: 'ready', min: 80 }, { id: 'support', min: 60 }, { id: 'risk', min: 0 }], redFlagBelow: 60 },
    dimensions: [dimension('dim_governance', 'q_ac_gov1')],
  });
  insertRow('assessmentTemplates', TPL_TARGET, null, 1, {
    id: TPL_TARGET, slug: 'company-readiness-target', subject: 'target-org',
    raterModes: ['self'], pairId: 'pair_company_readiness', required: true, gates: ['dashboard.phase1'],
    version: 1, scale: { min: 1, max: 5 },
    banding: { bands: [{ id: 'ready', min: 80 }, { id: 'support', min: 60 }, { id: 'risk', min: 0 }], redFlagBelow: 60 },
    dimensions: [dimension('dim_governance', 'q_tg_gov1')],
  });
  insertRow('assessmentTemplates', TPL_IL, null, 2, {
    id: TPL_IL, slug: 'integration-leader-readiness', subject: 'integration-leader',
    raterModes: ['self', 'manager'], required: true, gates: [],
    version: 1, scale: { min: 1, max: 5 },
    banding: { bands: [{ id: 'ready', min: 80 }, { id: 'support', min: 60 }, { id: 'risk', min: 0 }], redFlagBelow: 60 },
    dimensions: [dimension('dim_il_program', 'q_il_prog1')],
  });

  insertRow('checklistTemplates', 'cktpl_wiz', null, 0, {
    id: 'cktpl_wiz', name: 'Synthetic integration checklist', version: 1,
    items: [{ id: 'ck_item_1', text: 'Kickoff meeting', workstreamId: 'ws_imo', phase: 'day1', ownerHint: 'IMO' }],
  });
  insertRow('ddRequestTemplates', 'ddtpl_wiz', null, 0, {
    id: 'ddtpl_wiz', name: 'Synthetic DD checklist', version: 1,
    items: [{ id: 'dd_legal_01', area: 'legal', text: 'Synthetic legal item', ownerHint: 'Legal' }],
  });

  db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run('i18n', JSON.stringify({ strings: {} }));
  db.close();
})();

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
/** Register a control.db registry row AND provision that deal's own database
 * file, seeded from the synthetic template source above — the combination
 * every real POST /api/deals call also performs (registry row + file). */
function createTestDeal(id, overrides) {
  const deal = freshDeal(id, overrides);
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany, templateSourcePath: TEMPLATE_SOURCE_PATH });
  return deal;
}
function cookieHeader(token) { return `ma_session=${token}`; }
function newSession(username, role) {
  return sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
}
function bindDeal(token, dealId) { sessionsDb.bindSessionDeal(runtimeConn, token, dealId); }

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// Task 1: assigned-but-unfinished readiness assessments
// ---------------------------------------------------------------------------

test('deal-wizard (a): assigning an instance produces a pending row with an owner and a due date and no score fields', async () => {
  const deal = createTestDeal('deal_wa');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'karen', dueDate: '2026-09-01' }),
    });
    assert.strictEqual(res.status, 201);
    const { instance } = await res.json();
    assert.strictEqual(instance.templateId, TPL_TARGET);
    assert.strictEqual(instance.owner, 'karen');
    assert.strictEqual(instance.dueDate, '2026-09-01');
    assert.strictEqual(instance.status, 'pending');
    assert.ok(!('overallScore' in instance), 'a pending instance must carry no overall-score field at all, not a zero');
    assert.ok(!('dimensionScores' in instance), 'a pending instance must carry no dimensionScores field');
    assert.ok(!('bandId' in instance), 'a pending instance must carry no bandId field');
    assert.ok(!('responses' in instance), 'a pending instance must carry no responses key');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (b): the status rollup reports the pending instance while satisfied stays false', async () => {
  const deal = createTestDeal('deal_wb');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'karen', dueDate: '2026-09-01' }),
    });

    const statusRes = await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(karenToken) } });
    const status = await statusRes.json();
    const entry = status.bySubject['target-org'];
    assert.strictEqual(entry.satisfied, false, 'a pending-only assessment must not read as satisfied');
    assert.strictEqual(entry.pending.length, 1);
    assert.strictEqual(entry.pending[0].owner, 'karen');
    assert.strictEqual(entry.pending[0].dueDate, '2026-09-01');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (c): completing it by id promotes the same row and leaves the lane length unchanged', async () => {
  const deal = createTestDeal('deal_wc');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const assignRes = await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'karen', dueDate: '2026-09-01' }),
    });
    const { instance: pending } = await assignRes.json();

    const beforeList = await (await fetch(`${base}/api/assessment-instances?templateId=${TPL_TARGET}`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.strictEqual(beforeList.length, 1, 'exactly one row must exist for this template after assign');

    const completeRes = await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: pending.id, templateId: TPL_TARGET, responses: { q_tg_gov1: 4 } }),
    });
    assert.strictEqual(completeRes.status, 200);
    const { instance: completed } = await completeRes.json();
    assert.strictEqual(completed.id, pending.id, 'completion must promote the SAME row, not mint a new id');
    assert.strictEqual(completed.status, 'submitted');
    assert.strictEqual(typeof completed.overallScore, 'number', 'a completed instance must carry a real score');

    const afterList = await (await fetch(`${base}/api/assessment-instances?templateId=${TPL_TARGET}`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.strictEqual(afterList.length, 1, 'the lane must still hold exactly ONE row for this template — no second row was created');
    assert.strictEqual(afterList[0].id, pending.id);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});

test('deal-wizard (d): the rollup then reports satisfied true with the score present and the pending array empty', async () => {
  const deal = createTestDeal('deal_wd');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const assignRes = await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'karen', dueDate: '2026-09-01' }),
    });
    const { instance: pending } = await assignRes.json();

    await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: pending.id, templateId: TPL_TARGET, responses: { q_tg_gov1: 4 } }),
    });

    const statusRes = await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(karenToken) } });
    const status = await statusRes.json();
    const entry = status.bySubject['target-org'];
    assert.strictEqual(entry.satisfied, true, 'a completed assessment must read as satisfied');
    assert.strictEqual(typeof entry.latestInstance.overallScore, 'number');
    assert.deepStrictEqual(entry.pending, [], 'the pending array must be empty once the only pending instance is completed');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (e): completing an already-submitted instance by id is refused with a 400', async () => {
  const deal = createTestDeal('deal_we');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const assignRes = await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'karen', dueDate: '2026-09-01' }),
    });
    const { instance: pending } = await assignRes.json();

    await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: pending.id, templateId: TPL_TARGET, responses: { q_tg_gov1: 4 } }),
    });

    const secondRes = await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: pending.id, templateId: TPL_TARGET, responses: { q_tg_gov1: 2 } }),
    });
    assert.strictEqual(secondRes.status, 400, 'a submitted instance must never be silently rewritten through the instanceId completion path');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (f): completing an unknown instance id returns 404', async () => {
  const deal = createTestDeal('deal_wf');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'ainst_doesnotexist', templateId: TPL_TARGET, responses: { q_tg_gov1: 4 } }),
    });
    assert.strictEqual(res.status, 404);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (g): a submission with no instanceId still creates a new row exactly as before', async () => {
  const deal = createTestDeal('deal_wg');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const adminToken = newSession('admin', 'admin'); bindDeal(adminToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_ACQUIRER, responses: { q_ac_gov1: 4 } }),
    });
    assert.strictEqual(res.status, 201);
    const { instance } = await res.json();
    assert.strictEqual(instance.status, 'submitted');

    const list = await (await fetch(`${base}/api/assessment-instances?templateId=${TPL_ACQUIRER}`, { headers: { Cookie: cookieHeader(adminToken) } })).json();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, instance.id);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, adminToken);
    server.close();
  }
});
