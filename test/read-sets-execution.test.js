// D-12-02 / DATA-02 (Phase 12, plan 12-09 Task 2): the execution-family reads
// that were moved from readDb() to a proportional read.
//
//   GET /api/synergies, /api/synergies/rollup, /api/checklist-templates,
//   /api/employees, /api/assessment-status
//       -> the HTTP body (readCollections data path) is BYTE-identical to
//          JSON.stringify(<route's own pure builder>(readDb(), ctx)) — the
//          full-read data path — for every role the read policy admits. A
//          collection a handler still needs but the read set omits would throw
//          CollectionNotLoadedError (a 500), so a green run also proves the
//          sets are complete for this fixture (T-12-82).
//   GET /api/notifications
//       -> explicit expected items per role (11-05 role gating and the
//          deliberate unfiltered-count semantics kept — T-12-83) and ZERO
//          task/RAID row JSON.parse calls during the request.

const test = require('node:test');
const { listenLocal } = require('./helpers/listen-local');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-read-sets-exec-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
process.env.ADMIN_TOKEN = 'gsd-read-sets-execution-test-token';

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const readPolicy = require('../lib/readPolicy.js');
const { createDealFixture } = require('./helpers/deal-fixture.js');

const app = require('../server.js');
require('./helpers/held-version.js').installHeldVersionFetch();

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const MEMBERS = [
  { username: 'admin', role: 'admin' },
  { username: 'karen', role: 'hrbp' },
  { username: 'pmo_none', role: 'pmo' },
  { username: 'pmo_hr', role: 'pmo', ddAreas: ['hr'] },
  { username: 'emp1', role: 'employee' },
];
const ROLE_OF = Object.fromEntries(MEMBERS.map((m) => [m.username, m.role]));

function get(base, urlPath, token) {
  return fetch(`${base}${urlPath}`, { headers: { Cookie: `ma_session=${token}` } });
}

const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

// ---------------------------------------------------------------- fixture ---

let fxCounter = 0;
function seedDeal() {
  fxCounter += 1;
  const dealId = `deal_rse${fxCounter}`;
  const fx = createDealFixture({ controlConn, runtimeConn, dealId, members: MEMBERS });
  const dbPath = dbFiles.dealDbPath(dealId);
  const conn = store.getOrOpenConnection(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  const settingsRow = conn.prepare("SELECT data FROM app_state WHERE key = 'settings'").get();
  const custom = !!settingsRow && JSON.parse(settingsRow.data).demoMode === false;
  const lanes = {
    tasks: custom ? 'customIntegrationTasks' : 'integrationTasks',
    raid: custom ? 'customRaidEntries' : 'raidEntries',
    synergies: custom ? 'customSynergyInitiatives' : 'synergyInitiatives',
    employees: custom ? 'customEmployees' : 'employees',
    instances: custom ? 'customAssessmentInstances' : 'assessmentInstances',
  };
  const insertInto = (collection, rows) => {
    const stmt = conn.prepare(`INSERT INTO ${collection} (id, project_id, seq, data) VALUES (?, NULL, ?, ?)`);
    conn.transaction(() => rows.forEach((r, i) => stmt.run(r.id, i, JSON.stringify(r))))();
  };
  const now = Date.now();
  const MK = 'PARSE_PROBE';

  // Tasks: 7 overdue (5 plain + 1 blocked&overdue + 1 hr-stamped restricted),
  // 4 blocked (3 plain + the blocked&overdue one), plus neither-rows.
  const tasks = [];
  for (let i = 0; i < 5; i++) tasks.push({ id: `t_over${i}`, title: `Overdue ${i}`, status: 'todo', due: '2020-01-01', mk: MK });
  for (let i = 0; i < 3; i++) tasks.push({ id: `t_blk${i}`, title: `Blocked ${i}`, status: 'blocked', due: '2099-01-01', mk: MK });
  tasks.push({ id: 't_blkover', title: 'Blocked and overdue', status: 'blocked', due: '2020-01-01', mk: MK });
  for (let i = 0; i < 2; i++) tasks.push({ id: `t_done${i}`, title: `Done ${i}`, status: 'done', due: '2020-01-01', mk: MK });
  tasks.push({ id: 't_doing', title: 'Doing no due', status: 'doing', mk: MK });
  tasks.push({ id: 't_bare', title: 'No status no due', mk: MK });
  tasks.push({ id: 't_restricted', title: 'Restricted hr', status: 'todo', due: '2020-01-01', clearanceArea: 'hr', source: '', mk: MK });
  tasks.push({ id: 't_ddlegal', title: 'Finding-sourced', status: 'todo', due: '2099-01-01', source: 'dd-finding:f_legal', mk: MK });
  for (let i = 0; i < 150; i++) tasks.push({ id: `t_fill${i}`, title: `Filler ${i}`, status: 'todo', due: '2099-01-01', mk: MK });
  insertInto(lanes.tasks, tasks);
  insertInto('ddFindings', [{ id: 'f_legal', area: 'legal', title: 'Legal finding', severity: 'high', status: 'open' }]);

  // RAID: raid_high counts open high/critical = 4 (the restricted one is
  // counted too — the documented unfiltered-by-design aggregate).
  insertInto(lanes.raid, [
    { id: 'r_h1', title: 'High one', type: 'risk', status: 'open', severity: 'high', mk: MK },
    { id: 'r_h2', title: 'High two', type: 'risk', status: 'mitigating', severity: 'high', mk: MK },
    { id: 'r_c1', title: 'Critical', type: 'risk', status: 'open', severity: 'critical', mk: MK },
    { id: 'r_cr', title: 'Restricted critical', type: 'risk', status: 'open', severity: 'critical', clearanceArea: 'hr', mk: MK },
    { id: 'r_closed', title: 'Closed high', type: 'risk', status: 'closed', severity: 'high', mk: MK },
    { id: 'r_low', title: 'Low', type: 'risk', status: 'open', severity: 'low', mk: MK },
    { id: 'r_med', title: 'Medium', type: 'risk', status: 'open', severity: 'medium', mk: MK },
  ]);

  // Assessment templates + instances.
  insertInto('assessmentTemplates', [
    { id: 'tpl_a', slug: 'a', title: 'Acquirer readiness', subject: 'acquirer-org', required: true, published: true, gates: ['g1'], pairId: 'p1', dimensions: [{ id: 'd1', label: 'D1', weight: 1 }] },
    { id: 'tpl_t', slug: 't', title: 'Target readiness', subject: 'target-org', required: true, published: true, gates: ['g1'], pairId: 'p1', dimensions: [{ id: 'd1', label: 'D1', weight: 1 }] },
    { id: 'tpl_il', slug: 'il', title: 'IL readiness', subject: 'integration-leader', required: true, published: true, gates: [], dimensions: [{ id: 'd1', label: 'D1', weight: 1 }] },
    { id: 'tpl_opt', slug: 'opt', title: 'Optional pulse', subject: 'other', required: false, published: true, gates: [], dimensions: [] },
    { id: 'tpl_draft', slug: 'dr', title: 'Draft', subject: 'other', required: true, published: false, gates: [], dimensions: [] },
  ]);
  insertInto(lanes.instances, [
    { id: 'ai_a', templateId: 'tpl_a', rater: 'self', status: 'submitted', timestamp: iso(now - 2 * DAY), overallScore: 72, bandId: 'support', dimensionScores: { d1: 72 }, respondentName: 'Alice Respondent', responses: { q1: 4 } },
    { id: 'ai_il', templateId: 'tpl_il', rater: 'self', status: 'submitted', timestamp: iso(now - 120 * DAY), overallScore: 85, bandId: 'ready', dimensionScores: { d1: 85 }, respondentName: 'Ilse Leader', responses: { q1: 5 } },
    { id: 'ai_pending', templateId: 'tpl_t', rater: 'self', status: 'pending', owner: 'pmo_hr', dueDate: '2099-02-01' },
  ]);

  // Synergies: phased + unphased, cost entries (two same-date), stale + fresh,
  // task links to a restricted task, a finding-sourced task and a ghost id.
  insertInto(lanes.synergies, [
    {
      id: 'syn_1', title: 'Procurement savings', owner: 'karen', stage: 'validated', targetM: 5, realizedM: 0,
      phasing: [{ month: '2026-01', targetM: 2, realizedM: 1.5 }, { month: '2026-02', targetM: 3, realizedM: 0.5 }],
      costEntries: [{ id: 'c1', date: '2026-02-01', amountM: 0.3 }, { id: 'c2', date: '2026-03-01', amountM: 0.2 }, { id: 'c3', date: '2026-02-01', amountM: 0.1 }],
      taskIds: ['t_over0', 't_restricted', 't_ddlegal', 't_ghost'], createdAt: iso(now - 3.5 * DAY), lastConfirmedAt: iso(now - 3.5 * DAY),
    },
    { id: 'syn_2', title: 'Unphased revenue', owner: 'pmo_none', stage: 'idea', targetM: 4, realizedM: 1.2, costEntries: [], taskIds: [], createdAt: '2020-01-01T00:00:00.000Z' },
    { id: 'syn_3', title: 'Stale phased', owner: 'karen', stage: 'committed', targetM: 2, realizedM: 0, phasing: [{ month: '2026-04', targetM: 2, realizedM: 0.7 }], taskIds: ['t_restricted'], createdAt: '2020-01-01T00:00:00.000Z' },
  ]);

  insertInto(lanes.employees, [
    { id: 'emp_1', name: 'Ann Roster', role: 'Analyst', department: 'Finance', company: 'Target Co', lang: 'en', progress: 40 },
    { id: 'emp_2', name: 'Bo Roster', role: 'Engineer', department: 'IT', company: 'Target Co', lang: 'de', progress: 10 },
    { id: 'emp_3', name: 'Cy Roster', role: 'Lead', department: 'HR', company: 'Target Co', lang: 'zh', isLeader: true },
  ]);
  insertInto('checklistTemplates', [
    { id: 'cl_day1', title: 'Day 1', phase: 'day1', workstreams: [{ id: 'ws_hr', name: 'HR' }], items: [{ id: 'i1', title: 'Welcome' }] },
  ]);

  return { fx, dealId, dbPath, conn, lanes };
}

async function withServer(fn) {
  const server = await listenLocal(app);
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

/** Run `fn` inside the same db context a request bound to this deal gets. */
function inDeal(seed, fn) {
  const conn = store.getOrOpenConnection(seed.dbPath, dbFiles.DEAL_SCHEMA_PATH);
  return store.runWithDb({ conn, kind: 'deal', dealId: seed.dealId, dbPath: seed.dbPath }, fn);
}

function fakeReq(seed, username) {
  return {
    isDemo: false,
    dealContext: { dealId: seed.dealId },
    portalUser: { username, role: ROLE_OF[username], dealId: seed.dealId },
  };
}

// ------------------------------------------------------------------ tests ---

test('read-sets-execution (a): synergies, rollup, checklist-templates, employees, assessment-status bodies equal the full-read builders for every admitted role', async () => {
  const seed = seedDeal();
  const NOW = Date.now();
  let compared = 0;
  await withServer(async (base) => {
    for (const username of Object.keys(ROLE_OF)) {
      const token = seed.fx.tokens[username];
      const req = fakeReq(seed, username);
      const routes = [
        ['/api/synergies', () => app.synergiesBody(store.readDb(), req, NOW)],
        ['/api/synergies/rollup', () => app.synergyRollupBody(store.readDb(), req, NOW)],
        ['/api/checklist-templates', () => app.checklistTemplatesBody(store.readDb())],
        ['/api/employees', () => app.employeesBody(store.readDb(), req)],
        ['/api/assessment-status', () => app.assessmentStatusBody(store.readDb(), { stripNames: ROLE_OF[username] !== 'admin', portalUser: req.portalUser })],
      ];
      for (const [route, build] of routes) {
        const res = await get(base, route, token);
        if (res.status !== 200) {
          // A role the read matrix refuses stays refused — never a 500.
          assert.strictEqual(res.status, 403, `${username} ${route}: refused with 403, got ${res.status}`);
          assert.ok(!readPolicy.roleAllowedForRead(ROLE_OF[username], route), `${username} ${route}: 403 only where the policy refuses`);
          continue;
        }
        const text = await res.text();
        const expected = JSON.stringify(inDeal(seed, build));
        assert.strictEqual(text, expected, `${username} ${route}: readCollections body === full-read builder body`);
        compared += 1;
      }
    }
  });
  assert.ok(compared >= 15, `compared ${compared} route/role pairs (admin, hrbp and pmo all read every route)`);
});

test('read-sets-execution (b): the converted bodies carry the fixture content (the sets are complete, not vacuous)', async () => {
  const seed = seedDeal();
  await withServer(async (base) => {
    const syn = await (await get(base, '/api/synergies', seed.fx.tokens.admin)).json();
    assert.deepStrictEqual(syn.map((s) => s.id), ['syn_1', 'syn_2', 'syn_3']);
    assert.deepStrictEqual(syn[0].costEntries.map((c) => c.id), ['c2', 'c1', 'c3'], 'costEntries newest-first, stable');
    assert.deepStrictEqual(syn[0].taskIds, ['t_over0', 't_restricted', 't_ddlegal', 't_ghost'], 'admin sees every link');
    // IN-01 over the read set: links to tasks the caller may not see are dropped.
    const synNone = await (await get(base, '/api/synergies', seed.fx.tokens.pmo_none)).json();
    assert.deepStrictEqual(synNone[0].taskIds, ['t_over0', 't_ghost']);
    assert.deepStrictEqual(synNone[2].taskIds, []);
    const synHr = await (await get(base, '/api/synergies', seed.fx.tokens.pmo_hr)).json();
    assert.deepStrictEqual(synHr[0].taskIds, ['t_over0', 't_restricted', 't_ghost'], 'hr grant sees the hr task, not the legal finding task');

    const roll = await (await get(base, '/api/synergies/rollup', seed.fx.tokens.karen)).json();
    assert.strictEqual(roll.grossRealizedM, 2.7, 'phased partition: 1.5+0.5+0.7');
    assert.strictEqual(roll.unphasedRealizedM, 1.2);
    assert.strictEqual(roll.costIncurredM, 0.6);
    assert.strictEqual(roll.dealTargetM, 11, 'sum of per-item targets: 5 + 4 + 2');
    assert.strictEqual(roll.staleCount, 2);
    assert.strictEqual(roll.mine.staleCount, 1, 'karen owns one stale initiative');

    const cl = await (await get(base, '/api/checklist-templates', seed.fx.tokens.karen)).json();
    assert.deepStrictEqual(cl.map((c) => c.id), ['cl_day1']);
    const emp = await (await get(base, '/api/employees', seed.fx.tokens.karen)).json();
    assert.deepStrictEqual(emp.map((e) => e.id), ['emp_1', 'emp_2', 'emp_3']);
    assert.strictEqual(emp[0].progress, 40, 'a deal-bound roster is returned unscaled');

    const st = await (await get(base, '/api/assessment-status', seed.fx.tokens.karen)).json();
    assert.deepStrictEqual(st.required.map((r) => r.templateId), ['tpl_a', 'tpl_t', 'tpl_il']);
    assert.strictEqual(st.bySubject['acquirer-org'].satisfied, true);
    assert.strictEqual(st.bySubject['target-org'].satisfied, false);
    assert.deepStrictEqual(st.bySubject['target-org'].pending, [{ id: 'ai_pending', owner: 'pmo_hr', dueDate: '2099-02-01' }]);
    assert.strictEqual(st.gatesSummary.g1.satisfied, false);
    // Respondent names are stripped for a non-admin in a locked-down deal.
    assert.strictEqual(st.bySubject['acquirer-org'].latestInstance.respondentName, undefined);
    const stAdmin = await (await get(base, '/api/assessment-status', seed.fx.tokens.admin)).json();
    assert.strictEqual(stAdmin.bySubject['acquirer-org'].latestInstance.respondentName, 'Alice Respondent');
  });
});

test('read-sets-execution (c): notifications — explicit per-role counts and items, unfiltered-by-design aggregates, role gate', async () => {
  const seed = seedDeal();
  await withServer(async (base) => {
    for (const username of Object.keys(ROLE_OF)) {
      const role = ROLE_OF[username];
      const res = await get(base, '/api/notifications', seed.fx.tokens[username]);
      assert.strictEqual(res.status, 200, `${username}: notifications readable`);
      const body = await res.json();
      const expected = [
        { id: 'assess_tpl_t', type: 'assessment_pending', titleKey: '', title: 'Target readiness', href: '/assessments.html', severity: 'high' },
        { id: 'reassess_il', type: 'reassess_il', href: '/assessments.html', severity: 'medium' },
      ];
      if (readPolicy.roleAllowedForRead(role, '/api/integration-tasks')) {
        expected.push({ id: 'tasks_overdue', type: 'tasks_overdue', count: 7, href: '/execution.html', severity: 'high' });
        expected.push({ id: 'tasks_blocked', type: 'tasks_blocked', count: 4, href: '/execution.html', severity: 'medium' });
      }
      if (readPolicy.roleAllowedForRead(role, '/api/raid')) {
        expected.push({ id: 'raid_high', type: 'raid_high', count: 4, href: '/execution.html', severity: 'high' });
      }
      assert.deepStrictEqual(body, { success: true, items: expected }, `${username} (${role})`);
    }
    // The privileged and PMO roles do read both lanes — the counts above were asserted.
    for (const role of ['admin', 'hrbp', 'pmo']) {
      assert.ok(readPolicy.roleAllowedForRead(role, '/api/integration-tasks'));
      assert.ok(readPolicy.roleAllowedForRead(role, '/api/raid'));
    }
  });
});

test('read-sets-execution (d): notifications parse no task or RAID row (counts come from the light projection)', async () => {
  const seed = seedDeal();
  const realParse = JSON.parse;
  let probeParses = 0;
  const hook = function (text, ...rest) {
    if (typeof text === 'string' && text.includes('PARSE_PROBE')) probeParses += 1;
    return realParse.call(this, text, ...rest);
  };
  await withServer(async (base) => {
    JSON.parse = hook;
    try {
      const res = await get(base, '/api/notifications', seed.fx.tokens.karen);
      assert.strictEqual(res.status, 200);
      await res.json();
      assert.strictEqual(probeParses, 0, 'no task/RAID row was JSON.parse()d to answer notifications');

      // The hook itself works: the full-read path over the same deal trips it.
      probeParses = 0;
      inDeal(seed, () => store.readDb());
      assert.ok(probeParses > 100, `control: readDb() parsed ${probeParses} probe rows`);
    } finally {
      JSON.parse = realParse;
    }
  });
});

test('read-sets-execution (e): lane names and builders — a handler cannot touch a collection outside its set', () => {
  const seed = seedDeal();
  inDeal(seed, () => {
    // Each builder run against ONLY its read set succeeds and a collection
    // outside it throws instead of returning an empty (fail-open) lane.
    const syn = store.readCollections(['settings', 'synergyInitiatives', 'customSynergyInitiatives']);
    assert.ok(app.synergyRollupBody(syn, fakeReq(seed, 'karen'), Date.now()).mine, 'the rollup runs on its narrow set');
    assert.throws(() => app.synergiesBody(syn, fakeReq(seed, 'karen'), Date.now()), (e) => e.code === 'COLLECTION_NOT_LOADED',
      'the list builder needs the task lanes — the rollup set is deliberately narrower');
    const emp = store.readCollections(['settings', 'employees', 'customEmployees']);
    assert.strictEqual(app.employeesBody(emp, { isDemo: false }).length, 3, 'a deal-bound roster never touches courses');
    if (seed.lanes.employees === 'employees') {
      assert.throws(() => app.employeesBody(emp, { isDemo: true }), (e) => e.code === 'COLLECTION_NOT_LOADED',
        'the demo scaling path needs courses');
    }
  });
});
