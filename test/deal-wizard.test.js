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
// real DD-request/checklist templates for Task 3's instantiate walk. Built
// directly AT dbFiles.DEMO_DB_PATH (this suite's temp demo.db) rather than a
// separate file, so that db/dealSeed.js's createDealDatabase() default
// templateSourcePath (used by the REAL POST /api/deals route, unmodified —
// Task 3 exercises that exact route, not a test-only bypass) resolves to
// this exact content. Safe because every session in this suite is
// deal-bound (isOpenMode() never true, DEMO_OPEN is unset) — this path is
// NEVER opened for a write by any request path this suite exercises, only
// read by createDealDatabase()'s own readonly template-copy pass.
// ---------------------------------------------------------------------------
const TPL_ACQUIRER = 'atpl_company_acquirer';
const TPL_TARGET = 'atpl_company_target';
const TPL_IL = 'atpl_il_readiness';

(function buildTemplateSource() {
  const db = new Database(dbFiles.DEMO_DB_PATH);
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
 * file, seeded from the synthetic demo.db above via createDealDatabase()'s
 * OWN default templateSourcePath — the combination every real POST
 * /api/deals call also performs (registry row + file), used directly by
 * Task 1/2's per-scenario setup. */
function createTestDeal(id, overrides) {
  const deal = freshDeal(id, overrides);
  registerDeal(deal);
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
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

// ---------------------------------------------------------------------------
// Task 2: create-early deal setup state on the deal record
// ---------------------------------------------------------------------------

test('deal-wizard (h): creating a deal through the basics-plus-team payload returns the basics fields and a setup skeleton with basics/team stamped and the rest null', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const res = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Project Falcon', targetCompany: 'Falcon Target', members: ['pmo'],
        dealType: 'acquisition', signingDate: '2026-09-01', expectedClose: '2026-11-01',
        day1Date: '2026-11-02', dealSizeM: 42.5, currency: 'EUR',
      }),
    });
    assert.strictEqual(res.status, 200);
    const { deal } = await res.json();
    assert.strictEqual(deal.dealType, 'acquisition');
    assert.strictEqual(deal.signingDate, '2026-09-01');
    assert.strictEqual(deal.expectedClose, '2026-11-01');
    assert.strictEqual(deal.day1Date, '2026-11-02');
    assert.strictEqual(deal.dealSizeM, 42.5);
    assert.strictEqual(deal.currency, 'EUR');
    assert.ok(deal.setup, 'the deal record must carry a setup skeleton');
    assert.ok(deal.setup.steps.basics, 'basics must already be stamped by the create route');
    assert.ok(deal.setup.steps.team, 'team must already be stamped by the create route');
    assert.strictEqual(deal.setup.steps.basics.by, 'karen');
    ['assessments', 'scope', 'timeline', 'ddKickoff'].forEach((step) => {
      assert.strictEqual(deal.setup.steps[step], null, `${step} must start null — only basics/team are done at create time`);
    });
    assert.strictEqual(deal.setup.complete, false, 'setup cannot be complete with four steps still outstanding');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (i): a create missing a required basics field is refused with a 400 and creates neither a registry row nor a deal database file', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const beforeCount = controlConn.prepare('SELECT COUNT(*) AS c FROM deals').get().c;
    const dealsDir = process.env.MA_DEALS_DIR;
    const beforeFiles = fs.existsSync(dealsDir) ? new Set(fs.readdirSync(dealsDir)) : new Set();

    const res = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetCompany: 'No Name Co' }), // name omitted
    });
    assert.strictEqual(res.status, 400);

    const afterCount = controlConn.prepare('SELECT COUNT(*) AS c FROM deals').get().c;
    assert.strictEqual(afterCount, beforeCount, 'a refused create must leave no registry row');
    const afterFiles = fs.existsSync(dealsDir) ? new Set(fs.readdirSync(dealsDir)) : new Set();
    assert.deepStrictEqual(afterFiles, beforeFiles, 'a refused create must leave no new deal database file');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (j): the basics validate-only route returns 200 for a valid payload and 400 for an invalid one, creating nothing in either case', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const beforeCount = controlConn.prepare('SELECT COUNT(*) AS c FROM deals').get().c;

    const okRes = await fetch(`${base}/api/deals/wizard/basics`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Osprey', targetCompany: 'Osprey Target', dealType: 'acquisition' }),
    });
    assert.strictEqual(okRes.status, 200);
    const okBody = await okRes.json();
    assert.strictEqual(okBody.basics.name, 'Project Osprey');

    const badRes = await fetch(`${base}/api/deals/wizard/basics`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetCompany: 'Osprey Target' }), // name omitted
    });
    assert.strictEqual(badRes.status, 400);

    const afterCount = controlConn.prepare('SELECT COUNT(*) AS c FROM deals').get().c;
    assert.strictEqual(afterCount, beforeCount, 'the validate-only route must persist nothing for either a valid or an invalid payload');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (k): posting a setup step stamps only that step and leaves the others untouched', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Kestrel', targetCompany: 'Kestrel Target' }),
    });
    const { deal } = await createRes.json();

    const setupRes = await fetch(`${base}/api/deals/${deal.id}/setup`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'scope', data: { workstreams: ['ws_hr', 'ws_it'] } }),
    });
    assert.strictEqual(setupRes.status, 200);
    const { deal: updated } = await setupRes.json();
    assert.ok(updated.setup.steps.scope, 'scope must now be stamped');
    assert.strictEqual(updated.setup.steps.scope.by, 'karen');
    ['assessments', 'timeline', 'ddKickoff'].forEach((step) => {
      assert.strictEqual(updated.setup.steps[step], null, `${step} must remain untouched by a scope-only post`);
    });
    assert.ok(updated.setup.steps.basics, 'basics (stamped at create time) must survive untouched');
    assert.strictEqual(updated.setup.complete, false, 'three steps are still outstanding');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (l): posting an unknown step name is refused with a 400', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Merlin', targetCompany: 'Merlin Target' }),
    });
    const { deal } = await createRes.json();

    const res = await fetch(`${base}/api/deals/${deal.id}/setup`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'not-a-real-step' }),
    });
    assert.strictEqual(res.status, 400);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (m): the deal becomes complete once every mandatory step is stamped', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Harrier', targetCompany: 'Harrier Target' }),
    });
    const { deal } = await createRes.json();

    let lastBody;
    for (const step of ['assessments', 'scope', 'timeline', 'ddKickoff']) {
      const res = await fetch(`${base}/api/deals/${deal.id}/setup`, {
        method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ step }),
      });
      lastBody = await res.json();
    }
    assert.strictEqual(lastBody.deal.setup.complete, true, 'the deal must report setup complete once all six steps are stamped');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (n): a pmo session is refused both new wizard routes', async () => {
  const pmoToken = newSession('pmo', 'pmo');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const basicsRes = await fetch(`${base}/api/deals/wizard/basics`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project X', targetCompany: 'X Co' }),
    });
    assert.strictEqual(basicsRes.status, 403, 'pmo must be refused the basics validate-only route');

    const deal = createTestDeal('deal_wn', { members: ['karen', 'pmo'] });
    const setupRes = await fetch(`${base}/api/deals/${deal.id}/setup`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'scope' }),
    });
    assert.strictEqual(setupRes.status, 403, 'pmo must be refused the setup route');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('deal-wizard (o): a failed database provisioning rolls back the registry row — never an orphaned entry pointing at a missing file', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  const dealsDir = process.env.MA_DEALS_DIR;
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const beforeCount = controlConn.prepare('SELECT COUNT(*) AS c FROM deals').get().c;

    fs.chmodSync(dealsDir, 0o555); // read+execute only — createDealDatabase()'s file creation must throw
    let res;
    try {
      res = await fetch(`${base}/api/deals`, {
        method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Project Rollback', targetCompany: 'Rollback Co' }),
      });
    } finally {
      fs.chmodSync(dealsDir, 0o755); // restore before any later test in this file provisions a deal
    }
    assert.strictEqual(res.status, 500, 'a provisioning failure must surface as a 500, never a silently half-created deal');

    const afterCount = controlConn.prepare('SELECT COUNT(*) AS c FROM deals').get().c;
    assert.strictEqual(afterCount, beforeCount, 'the registry row must be rolled back — no orphaned deal row survives a failed provisioning');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// Task 3: the full create-early, resume-later flow proven end to end
// ---------------------------------------------------------------------------

test('deal-wizard (p): the full ordered wizard walk ends with setup complete and three pending readiness assessments outstanding', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const headers = { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' };

    // Step 1: validate the basics payload through the validate-only route.
    const basicsRes = await fetch(`${base}/api/deals/wizard/basics`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'Project Talon', targetCompany: 'Talon Target', dealType: 'acquisition' }),
    });
    assert.strictEqual(basicsRes.status, 200);

    // Step 2: create the deal with basics + team.
    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'Project Talon', targetCompany: 'Talon Target', members: ['pmo'], dealType: 'acquisition' }),
    });
    assert.strictEqual(createRes.status, 200);
    const { deal } = await createRes.json();

    // Step 3: bind the session to the new deal.
    const selectRes = await fetch(`${base}/api/deals/select`, { method: 'POST', headers, body: JSON.stringify({ dealId: deal.id }) });
    assert.strictEqual(selectRes.status, 200);

    // Step 4: the new deal's own database already carries the seeded
    // assessment templates and the seeded DD request template.
    const templates = await (await fetch(`${base}/api/assessment-templates`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(templates.length, 3, 'the new deal must inherit all three seeded assessment templates');
    const ddTemplates = await (await fetch(`${base}/api/dd/request-templates`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.ok(ddTemplates.length >= 1, 'the new deal must inherit the seeded DD request template');

    // Step 5: assign all three readiness assessments, each with a distinct owner/due date.
    for (const [templateId, owner, dueDate] of [
      [TPL_ACQUIRER, 'karen', '2026-09-01'],
      [TPL_TARGET, 'pmo', '2026-09-05'],
      [TPL_IL, 'karen', '2026-09-10'],
    ]) {
      const res = await fetch(`${base}/api/assessment-instances/assign`, { method: 'POST', headers, body: JSON.stringify({ templateId, owner, dueDate }) });
      assert.strictEqual(res.status, 201);
    }

    // Step 6: the status rollup now reports three pending, zero satisfied.
    const statusAfterAssign = await (await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    const subjects = ['acquirer-org', 'target-org', 'integration-leader'];
    subjects.forEach((s) => {
      assert.strictEqual(statusAfterAssign.bySubject[s].satisfied, false);
      assert.strictEqual(statusAfterAssign.bySubject[s].pending.length, 1);
    });

    // Step 7: stamp the assessments setup step.
    await fetch(`${base}/api/deals/${deal.id}/setup`, { method: 'POST', headers, body: JSON.stringify({ step: 'assessments' }) });

    // Step 8: instantiate the integration checklist and the DD request checklist.
    const taskInstRes = await fetch(`${base}/api/integration-tasks/instantiate`, { method: 'POST', headers, body: JSON.stringify({ checklistTemplateId: 'cktpl_wiz' }) });
    assert.strictEqual(taskInstRes.status, 200);
    const taskInstBody = await taskInstRes.json();
    assert.strictEqual(taskInstBody.created, 1);
    const ddInstRes = await fetch(`${base}/api/dd/request-items/instantiate`, { method: 'POST', headers, body: JSON.stringify({ templateId: 'ddtpl_wiz' }) });
    assert.strictEqual(ddInstRes.status, 200);
    const ddInstBody = await ddInstRes.json();
    assert.strictEqual(ddInstBody.created, 1);

    // Step 9: stamp scope, timeline and DD-kickoff.
    let lastSetup;
    for (const step of ['scope', 'timeline', 'ddKickoff']) {
      const res = await fetch(`${base}/api/deals/${deal.id}/setup`, { method: 'POST', headers, body: JSON.stringify({ step }) });
      lastSetup = await res.json();
    }

    // The walk ends with setup complete.
    assert.strictEqual(lastSetup.deal.setup.complete, true, 'the deal must report setup complete once the whole wizard walk finishes');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (q): D-09 — with three assessments still pending, DD request/finding/convert all succeed; nothing is blocked on an unfinished assessment', async () => {
  const deal = createTestDeal('deal_wq');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const headers = { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' };

    for (const [templateId, owner, dueDate] of [
      [TPL_ACQUIRER, 'karen', '2026-09-01'], [TPL_TARGET, 'karen', '2026-09-05'], [TPL_IL, 'karen', '2026-09-10'],
    ]) {
      await fetch(`${base}/api/assessment-instances/assign`, { method: 'POST', headers, body: JSON.stringify({ templateId, owner, dueDate }) });
    }
    const status = await (await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(status.bySubject['acquirer-org'].satisfied, false);
    assert.strictEqual(status.bySubject['target-org'].satisfied, false);
    assert.strictEqual(status.bySubject['integration-leader'].satisfied, false);

    const itemRes = await fetch(`${base}/api/dd/request-items`, { method: 'POST', headers, body: JSON.stringify({ area: 'legal', text: 'Cap table review' }) });
    assert.strictEqual(itemRes.status, 201, 'creating a DD request item must not be blocked by outstanding assessments');

    const findingRes = await fetch(`${base}/api/dd/findings`, { method: 'POST', headers, body: JSON.stringify({ area: 'legal', title: 'Missing IP assignment' }) });
    assert.strictEqual(findingRes.status, 201, 'creating a DD finding must not be blocked by outstanding assessments');
    const { finding } = await findingRes.json();

    const convertRes = await fetch(`${base}/api/dd/findings/${finding.id}/convert`, { method: 'POST', headers, body: JSON.stringify({ toTask: true, toRaid: true }) });
    assert.strictEqual(convertRes.status, 200, 'converting a finding must not be blocked by outstanding assessments');
    const convertBody = await convertRes.json();
    assert.ok(convertBody.task);
    assert.ok(convertBody.raid);
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (r): a second session for the same user resumes a skipped setup step without recreating the deal', async () => {
  const firstToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(firstToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Resume', targetCompany: 'Resume Target' }), // mandatory core only
    });
    const { deal } = await createRes.json();
    const beforeDealCount = controlConn.prepare('SELECT COUNT(*) AS c FROM deals').get().c;

    // A brand-new session for the SAME user — simulating a later login,
    // not a continuation of the same browser tab.
    const secondToken = newSession('karen', 'hrbp');
    try {
      bindDeal(secondToken, deal.id);
      const res = await fetch(`${base}/api/deals/${deal.id}/setup`, {
        method: 'POST', headers: { Cookie: cookieHeader(secondToken), 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'timeline' }),
      });
      assert.strictEqual(res.status, 200, 'a fresh session for the same user must be able to resume a skipped setup step');
      const body = await res.json();
      assert.ok(body.deal.setup.steps.timeline, 'the previously-skipped step must now be stamped');
      assert.strictEqual(body.deal.id, deal.id, 'the SAME deal must be resumed, never a second one created');

      const afterDealCount = controlConn.prepare('SELECT COUNT(*) AS c FROM deals').get().c;
      assert.strictEqual(afterDealCount, beforeDealCount, 'resuming setup must never create a second deal registry row');
    } finally {
      sessionsDb.deleteSession(runtimeConn, secondToken);
    }
  } finally {
    sessionsDb.deleteSession(runtimeConn, firstToken);
    server.close();
  }
});

test('deal-wizard (s): the status rollup subject order is acquirer, target, Integration Lead regardless of assignment order', async () => {
  const deal = createTestDeal('deal_ws');

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;
    const headers = { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' };

    // Assign in REVERSE subject order: IL, then target, then acquirer.
    for (const [templateId, owner, dueDate] of [
      [TPL_IL, 'karen', '2026-09-10'], [TPL_TARGET, 'karen', '2026-09-05'], [TPL_ACQUIRER, 'karen', '2026-09-01'],
    ]) {
      await fetch(`${base}/api/assessment-instances/assign`, { method: 'POST', headers, body: JSON.stringify({ templateId, owner, dueDate }) });
    }

    const status = await (await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.deepStrictEqual(
      Object.keys(status.bySubject),
      ['acquirer-org', 'target-org', 'integration-leader'],
      'the report order must come from the declared list, never from assignment order'
    );
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// 04-REVIEW.md CR-01: ownership enforcement on the instanceId completion
// path — a deal member other than the assigned owner (or an elevated
// admin/hrbp session) may not promote a pending row to submitted.
// ---------------------------------------------------------------------------

test('deal-wizard (t): a deal member who is NOT the assigned owner cannot fabricate completion of another member\'s pending assessment (CR-01)', async () => {
  const deal = createTestDeal('deal_wt', { members: ['karen', 'pmo'] });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const assignRes = await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'karen', dueDate: '2026-09-01' }),
    });
    const { instance: pending } = await assignRes.json();

    // pmo (not the assigned owner, not admin/hrbp) attempts to complete
    // karen's assignment with a fabricated high score.
    const forgedRes = await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: pending.id, templateId: TPL_TARGET, responses: { q_tg_gov1: 5 } }),
    });
    assert.strictEqual(forgedRes.status, 403, 'a non-owner, non-elevated caller must be refused completion of someone else\'s pending row');

    // The row must still be pending — the refused attempt must not have
    // mutated anything.
    const statusRes = await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(karenToken) } });
    const status = await statusRes.json();
    assert.strictEqual(status.bySubject['target-org'].satisfied, false, 'a refused completion attempt must never flip satisfied to true');

    // The real owner (karen) can still complete it normally.
    const realRes = await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: pending.id, templateId: TPL_TARGET, responses: { q_tg_gov1: 4 } }),
    });
    assert.strictEqual(realRes.status, 200, 'the actual assigned owner must still be able to complete their own pending row');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

test('deal-wizard (u): an hrbp (Integration Lead) session may complete a pending row assigned to a different teammate (CR-01 elevated override)', async () => {
  const deal = createTestDeal('deal_wu', { members: ['karen', 'pmo'] });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const assignRes = await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'pmo', dueDate: '2026-09-01' }),
    });
    const { instance: pending } = await assignRes.json();

    // karen is hrbp, not the named owner ('pmo') — the elevated-role branch
    // must still let her complete it.
    const res = await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: pending.id, templateId: TPL_TARGET, responses: { q_tg_gov1: 4 } }),
    });
    assert.strictEqual(res.status, 200, 'an hrbp session must be able to complete a pending row assigned to a different named owner');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// 04-REVIEW.md WR-01: the pending array's `owner` field is visible only to
// admin/hrbp or the assigned owner's own session, not to every deal member.
// ---------------------------------------------------------------------------

test('deal-wizard (v): the pending array\'s owner field is visible to the assigned owner and to hrbp, but hidden from an unrelated deal member (WR-01)', async () => {
  const deal = createTestDeal('deal_wv', { members: ['karen', 'pmo', 'employee-demo'] });

  const karenToken = newSession('karen', 'hrbp'); bindDeal(karenToken, deal.id);
  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const empToken = newSession('employee-demo', 'employee'); bindDeal(empToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'pmo', dueDate: '2026-09-01' }),
    });

    const hrbpStatus = await (await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(karenToken) } })).json();
    assert.strictEqual(hrbpStatus.bySubject['target-org'].pending[0].owner, 'pmo', 'hrbp must see the real owner value');

    const ownerStatus = await (await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(pmoToken) } })).json();
    assert.strictEqual(ownerStatus.bySubject['target-org'].pending[0].owner, 'pmo', 'the assigned owner must see their own name');

    const empStatus = await (await fetch(`${base}/api/assessment-status`, { headers: { Cookie: cookieHeader(empToken) } })).json();
    assert.strictEqual(empStatus.bySubject['target-org'].pending[0].owner, '', 'an unrelated non-elevated deal member must not see the assigned owner\'s name');
    assert.ok(empStatus.bySubject['target-org'].pending[0].id, 'the pending id itself must still be present (CR-01 gates action on it, not this read)');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    sessionsDb.deleteSession(runtimeConn, empToken);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// 04-REVIEW.md IN-03: on the instanceId completion path, respondentName is
// stamped from the session, never taken from the request body.
// ---------------------------------------------------------------------------

test('deal-wizard (w): completing a pending instance by id stamps respondentName from the session, ignoring a fabricated request-body value (IN-03)', async () => {
  const deal = createTestDeal('deal_ww', { members: ['karen', 'pmo'] });

  const pmoToken = newSession('pmo', 'pmo'); bindDeal(pmoToken, deal.id);
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const assignRes = await fetch(`${base}/api/assessment-instances/assign`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: TPL_TARGET, owner: 'pmo', dueDate: '2026-09-01' }),
    });
    const { instance: pending } = await assignRes.json();

    const completeRes = await fetch(`${base}/api/assessment-instances`, {
      method: 'POST', headers: { Cookie: cookieHeader(pmoToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: pending.id, templateId: TPL_TARGET, respondentName: 'Someone Else', responses: { q_tg_gov1: 4 } }),
    });
    assert.strictEqual(completeRes.status, 200);
    const { instance: completed } = await completeRes.json();
    assert.strictEqual(completed.respondentName, 'pmo', 'respondentName must be stamped from the session identity, never the caller-supplied value');
  } finally {
    sessionsDb.deleteSession(runtimeConn, pmoToken);
    server.close();
  }
});

// ---------------------------------------------------------------------------
// G-04-10: the setup route must learn completion without stamping a step.
// ---------------------------------------------------------------------------

test('deal-wizard (x): a completion-only setup post marks the deal complete without stamping a skipped step', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Osprey', targetCompany: 'Osprey Target' }),
    });
    const { deal } = await createRes.json();

    const stampRes = await fetch(`${base}/api/deals/${deal.id}/setup`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'assessments' }),
    });
    assert.strictEqual(stampRes.status, 200);

    const finishRes = await fetch(`${base}/api/deals/${deal.id}/setup`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ complete: true }),
    });
    assert.strictEqual(finishRes.status, 200);
    const { deal: finished } = await finishRes.json();
    assert.strictEqual(finished.setup.complete, true, 'a completion-only post must mark the deal complete');
    assert.ok(finished.setup.steps.assessments, 'the assessments step stamped earlier must survive untouched');
    ['scope', 'timeline', 'ddKickoff'].forEach((skippedStep) => {
      assert.strictEqual(finished.setup.steps[skippedStep], null, `${skippedStep} was never stamped and must remain null, not fabricated by Finish`);
    });

    // Re-read from disk, not just the response body — the completion-only
    // branch must never fabricate a stamp for a step the operator skipped.
    const onDisk = controlStore.getDeal(deal.id);
    ['scope', 'timeline', 'ddKickoff'].forEach((skippedStep) => {
      assert.strictEqual(onDisk.setup.steps[skippedStep], null, `${skippedStep} must still be null on disk, not merely absent from the response body`);
    });
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (y): a setup post naming neither a step nor completion is refused and changes nothing', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Falcon', targetCompany: 'Falcon Target' }),
    });
    const { deal } = await createRes.json();

    const before = controlStore.getDeal(deal.id);
    const snapshot = JSON.parse(JSON.stringify(before.setup));

    const res = await fetch(`${base}/api/deals/${deal.id}/setup`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(typeof body.error === 'string' && body.error.includes('step'), 'the 400 error must mention the step field path');

    const after = controlStore.getDeal(deal.id);
    assert.deepStrictEqual(after.setup, snapshot, 'a refused post must change nothing on the deal record');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});

test('deal-wizard (z): a setup post carrying step data but no step name is refused', async () => {
  const karenToken = newSession('karen', 'hrbp');
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const base = `http://127.0.0.1:${port}`;

    const createRes = await fetch(`${base}/api/deals`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Project Condor', targetCompany: 'Condor Target' }),
    });
    const { deal } = await createRes.json();

    const res = await fetch(`${base}/api/deals/${deal.id}/setup`, {
      method: 'POST', headers: { Cookie: cookieHeader(karenToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ complete: true, data: { vdrRef: 'x' } }),
    });
    assert.strictEqual(res.status, 400, 'there is nowhere to store step data with no step name — accepting it would silently discard it');
  } finally {
    sessionsDb.deleteSession(runtimeConn, karenToken);
    server.close();
  }
});
