// D-11-01 / AUTHZ-01 — the real-deal role x route READ matrix (PRD acceptance 1)
// plus the lenient demo-store control. Boots the real app against an isolated
// temp control/runtime/demo/deals/audit set; the committed data/*.db is never
// opened.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-read-policy-matrix-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const app = require('../server.js');
const { pathForms } = require('../lib/requestPath');
const { readAllowsForms, roleAllowedForRead } = require('../lib/readPolicy');
const { createDealFixture, demoSession } = require('./helpers/deal-fixture');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const DENIED = { error: 'Your role cannot view this information.' };

function realDeal(id) {
  return createDealFixture({
    controlConn, runtimeConn, dealId: id,
    members: [
      { username: 'rm-admin', role: 'admin' },
      { username: 'rm-hrbp', role: 'hrbp' },
      { username: 'rm-pmo', role: 'pmo' },
      { username: 'rm-employee', role: 'employee' },
    ],
  });
}

test('tracer: employee is refused /api/synergies and /api/synergies/rollup in a real deal; staff keep 200', async () => {
  const fx = realDeal('deal_rmtracer');
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const p of ['/api/synergies', '/api/synergies/rollup']) {
      const emp = await fetch(base + p, { headers: { cookie: fx.cookie('rm-employee') } });
      assert.strictEqual(emp.status, 403, `employee GET ${p}`);
      assert.deepStrictEqual(await emp.json(), DENIED, `${p} 403 body is the fixed error and carries no data`);
      for (const u of ['rm-admin', 'rm-hrbp', 'rm-pmo']) {
        const r = await fetch(base + p, { headers: { cookie: fx.cookie(u) } });
        await r.text();
        assert.strictEqual(r.status, 200, `${u} GET ${p}`);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('demo store stays lenient: an employee session bound to no deal still reads /api/synergies', async () => {
  const cookie = demoSession({ controlConn, runtimeConn, username: 'rm-demo-employee', role: 'employee' });
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const p of ['/api/synergies', '/api/synergies/rollup']) {
      const r = await fetch(base + p, { headers: { cookie } });
      await r.text();
      assert.strictEqual(r.status, 200, `demo-store employee GET ${p}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('readAllowsForms is canonical-anchored: no-rule spellings inherit the canonical verdict', () => {
  assert.strictEqual(readAllowsForms('admin', pathForms('/api/Admin/users').forms, '/api/admin/users'), true);
  assert.strictEqual(readAllowsForms('employee', pathForms('/api/Synergies').forms, '/api/synergies'), false);
  // an unlisted canonical path has no rule: nobody is allowed (fail-closed)
  assert.strictEqual(readAllowsForms('admin', pathForms('/api/zz-unlisted').forms, '/api/zz-unlisted'), false);
  assert.strictEqual(roleAllowedForRead('employee', '/api/synergies'), false);
});

// --- the PRD matrix (acceptance 1), table-driven --------------------------------
//
// `deny`: the roles the real-deal gate refuses with the fixed 403 body.
// `ok200`: the path answers 200 (not merely "not gate-refused") for allowed roles
// with no query string; rows needing a query keep ok200 false and assert only
// that the READ GATE did not refuse (the handler may 400/404 on its own terms).
const ALL = ['admin', 'hrbp', 'pmo', 'employee'];
const NON_ADMIN = ['hrbp', 'pmo', 'employee'];
const MATRIX = [
  // deal data: staff only
  { p: '/api/synergies', deny: ['employee'], ok200: true },
  { p: '/api/synergies/rollup', deny: ['employee'], ok200: true },
  { p: '/api/raid', deny: ['employee'], ok200: true },
  { p: '/api/integration-tasks', deny: ['employee'], ok200: true },
  { p: '/api/checklist-templates', deny: ['employee'], ok200: true },
  { p: '/api/employees', deny: ['employee'], ok200: true },
  { p: '/api/communications', deny: ['employee'], ok200: true },
  { p: '/api/org/positions', deny: ['employee'], ok200: true },
  { p: '/api/org/summary', deny: ['employee'], ok200: true },
  { p: '/api/dd/areas', deny: ['employee'], ok200: true },
  { p: '/api/dd/summary', deny: ['employee'], ok200: true },
  { p: '/api/reports/export?dataset=raid&format=json', deny: ['employee'], ok200: true },
  { p: '/api/projects', deny: ['employee'], ok200: true },
  { p: '/api/processes', deny: ['employee'], ok200: true },
  { p: '/api/assessments', deny: ['employee'], ok200: true },
  { p: '/api/ai/insight', deny: ['employee'], ok200: false },
  { p: '/api/rag/search?q=integration', deny: ['employee'], ok200: false },
  // admin / lead only
  { p: '/api/assessment-instances', deny: NON_ADMIN, ok200: true },
  { p: '/api/hrbps', deny: ['pmo', 'employee'], ok200: true },
  { p: '/api/deals/x/grants', deny: ['pmo', 'employee'], ok200: false },
  { p: '/api/admin/users', deny: NON_ADMIN, ok200: true },
  // every role
  { p: '/api/courses', deny: [], ok200: true },
  { p: '/api/lessons', deny: [], ok200: true },
  { p: '/api/notifications', deny: [], ok200: true },
  { p: '/api/settings', deny: [], ok200: true },
  { p: '/api/menus', deny: [], ok200: true },
  { p: '/api/pages', deny: [], ok200: true },
  { p: '/api/i18n', deny: [], ok200: true },
  { p: '/api/slides', deny: [], ok200: true },
  { p: '/api/departments', deny: [], ok200: true },
  { p: '/api/questions', deny: [], ok200: true },
  { p: '/api/assessment-templates', deny: [], ok200: true },
  { p: '/api/assessment/latest', deny: [], ok200: true },
  { p: '/api/alerts', deny: [], ok200: true },
  { p: '/api/pulses', deny: [], ok200: true },
  { p: '/api/deals', deny: [], ok200: true },
  { p: '/api/auth/sessions', deny: [], ok200: true },
  // plan 11-06: get-or-create is a POST now; the GET path no longer exists, so a real-deal
  // employee meets the roster rule's 403 and staff reach the router's 404 (never a 2xx)
  { p: '/api/employees/get-or-create?empId=x', deny: ['employee'], ok200: false },
];
const READ_GATE_ERROR = 'Your role cannot view this information.';

async function readBody(res) {
  const text = await res.text();
  try { return { text, json: JSON.parse(text) }; } catch (e) { return { text, json: null }; }
}

test('matrix: real deal — role x route (PRD acceptance 1); a refusal is the fixed body with no data', async () => {
  const fx = realDeal('deal_rmmatrix');
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    let checked = 0;
    for (const row of MATRIX) {
      for (const role of ALL) {
        const res = await fetch(base + row.p, { headers: { cookie: fx.cookie('rm-' + role) } });
        const { json } = await readBody(res);
        checked++;
        if (row.deny.includes(role)) {
          assert.strictEqual(res.status, 403, `${role} GET ${row.p}`);
          if (!row.p.startsWith('/api/admin') && !row.p.startsWith('/api/deals/')) {
            assert.deepStrictEqual(json, DENIED, `${role} GET ${row.p} refusal body`);
          }
        } else if (row.ok200) {
          assert.strictEqual(res.status, 200, `${role} GET ${row.p}`);
        } else {
          assert.ok(!(res.status === 403 && json && json.error === READ_GATE_ERROR), `${role} GET ${row.p} must pass the read gate`);
        }
      }
    }
    assert.ok(checked >= MATRIX.length * 4);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// PRD acceptance 1, pulse rows (plan 11-05 / D-11-06): the route stays readable by
// every role (the matrix row above), but the BODY is personal-data-projected —
// an employee gets 200 with its own pulse and nothing of a colleague's.
test('matrix: /api/pulses — employee reads its own pulse (200) and none of a colleague\'s named data', async () => {
  const fx = createDealFixture({
    controlConn, runtimeConn, dealId: 'deal_rmpulses',
    members: [
      { username: 'rp-hrbp', role: 'hrbp' },
      { username: 'rp-emp1', role: 'employee' },
      { username: 'rp-emp2', role: 'employee' },
    ],
  });
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (u, body) => fetch(base + '/api/pulses', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie: fx.cookie(u) }, body: JSON.stringify(body),
    });
    assert.strictEqual((await post('rp-emp1', { employeeName: 'Emma One', rating: 5, comment: 'emma-note' })).status, 201);
    assert.strictEqual((await post('rp-emp2', { employeeName: 'Eli Two', rating: 1, comment: 'eli-note' })).status, 201);

    const own = await fetch(base + '/api/pulses', { headers: { cookie: fx.cookie('rp-emp1') } });
    const ownText = await own.text();
    assert.strictEqual(own.status, 200, 'own pulse: 200');
    assert.ok(ownText.includes('emma-note'), 'own pulse present');
    assert.ok(!ownText.includes('eli-note') && !ownText.includes('Eli Two'), 'a colleague\'s pulse is absent');

    const lead = await fetch(base + '/api/pulses', { headers: { cookie: fx.cookie('rp-hrbp') } });
    const leadText = await lead.text();
    assert.ok(leadText.includes('emma-note') && leadText.includes('eli-note'), 'hrbp still reads every named pulse');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// --- Phase 11 review WR-04 (a): per-role BODY allowlists for the ALL-roles routes ---
//
// The matrix above proves every role gets 200 on these routes; it never looked at
// WHAT came back (that is how CR-01 — the unprojected deal record — passed green).
// Each row below states, per role, the only shape the body may have, against a deal
// seeded with MNPI-bearing values on every one of these surfaces.
const PUBLIC_SETTINGS_KEYS = require('../validators/settings').PUBLIC_SETTINGS_KEYS;
const DEAL_KEYS_FOR = { pmo: ['id', 'name', 'status', 'targetCompany'], employee: ['id', 'name', 'status'] };
const LANE_NUDGES = ['tasks_overdue', 'tasks_blocked', 'raid_high'];
const BODY_ALLOWLIST = [
  {
    p: '/api/deals',
    check(role, body) {
      assert.ok(Array.isArray(body) && body.length >= 1, `${role}: the caller's deal is listed`);
      for (const d of body) {
        if (role === 'admin' || role === 'hrbp') continue; // full record: they run the deal
        const extra = Object.keys(d).filter((k) => !DEAL_KEYS_FOR[role].includes(k));
        assert.deepStrictEqual(extra, [], `${role} GET /api/deals: keys outside the allowlist`);
      }
      const text = JSON.stringify(body);
      if (role === 'pmo' || role === 'employee') {
        for (const k of ['dealSizeM', 'synergyTargetM', 'memberGrants', 'members', 'setup', 'createdBy', 'dealSettings', 'currency', 'day1Date']) {
          assert.ok(!text.includes(`"${k}"`), `${role} GET /api/deals must not carry ${k}`);
        }
      } else {
        assert.ok(text.includes('"synergyTargetM":77'), `${role} still reads the deal-level values`);
      }
    },
  },
  {
    p: '/api/settings',
    check(role, body) {
      const keys = Object.keys(body || {});
      for (const secret of ['geminiApiKey', 'databaseConfig', 'connectionDetails']) {
        assert.ok(!keys.includes(secret), `${role} GET /api/settings must never carry ${secret}`);
      }
      if (role !== 'admin') {
        const extra = keys.filter((k) => !PUBLIC_SETTINGS_KEYS.includes(k));
        assert.deepStrictEqual(extra, [], `${role} GET /api/settings: keys outside PUBLIC_SETTINGS_KEYS`);
      }
    },
  },
  {
    p: '/api/pulses',
    check(role, body, self) {
      assert.ok(Array.isArray(body), `${role}: pulses is a list`);
      const text = JSON.stringify(body);
      if (role === 'employee') {
        assert.ok(body.length >= 1 && body.every((x) => x.authorUsername === self), 'employee: own pulses only');
        assert.ok(!text.includes('PMO-PULSE-NOTE'), 'employee: no colleague comment');
      } else if (role === 'pmo') {
        for (const x of body) {
          const own = x.authorUsername === self;
          if (!own) assert.deepStrictEqual(Object.keys(x).sort(), ['day', 'rating', 'type'], 'pmo: others only as aggregates');
        }
        assert.ok(!text.includes('EMP-PULSE-NOTE'), 'pmo: no colleague comment');
      } else {
        assert.ok(text.includes('EMP-PULSE-NOTE') && text.includes('PMO-PULSE-NOTE'), `${role}: every named pulse`);
      }
    },
  },
  {
    p: '/api/notifications',
    check(role, body) {
      const types = ((body && body.items) || []).map((i) => i.type);
      if (role === 'employee') {
        assert.deepStrictEqual(types.filter((t) => LANE_NUDGES.includes(t)), [], 'employee: no task/RAID nudge');
      } else {
        assert.ok(types.includes('tasks_overdue') && types.includes('raid_high'), `${role}: keeps the lane nudges`);
      }
      for (const i of (body && body.items) || []) {
        assert.ok(!/MATRIX-SECRET/.test(JSON.stringify(i)), `${role}: a nudge carries no record content`);
      }
    },
  },
];

test('matrix (WR-04 a): ALL-roles routes — every role\'s 200 body stays inside its per-role allowlist', async () => {
  const fx = createDealFixture({
    controlConn, runtimeConn, dealId: 'deal_rmbody',
    members: [
      { username: 'rb-admin', role: 'admin' },
      { username: 'rb-hrbp', role: 'hrbp' },
      { username: 'rb-pmo', role: 'pmo' },
      { username: 'rb-employee', role: 'employee' },
    ],
  });
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = async (u, p, body) => {
      const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: fx.cookie(u) }, body: JSON.stringify(body) });
      const text = await r.text();
      assert.ok(r.status === 200 || r.status === 201, `fixture ${u} POST ${p} -> ${r.status} ${text}`);
    };
    await post('rb-hrbp', '/api/deals/deal_rmbody/setup', { step: 'basics', data: { dealSizeM: 850 } });
    await post('rb-hrbp', '/api/deals/deal_rmbody/setup', { dealSettings: { synergyTargetM: 77, currency: 'EUR', day1Date: '2026-12-01' } });
    await post('rb-employee', '/api/pulses', { employeeName: 'x', rating: 2, comment: 'EMP-PULSE-NOTE', type: '30-day' });
    await post('rb-pmo', '/api/pulses', { employeeName: 'x', rating: 4, comment: 'PMO-PULSE-NOTE', type: '30-day' });
    await post('rb-admin', '/api/integration-tasks', { title: 'MATRIX-SECRET overdue task', due: '2000-01-01', status: 'todo' });
    await post('rb-admin', '/api/raid', { title: 'MATRIX-SECRET high risk', type: 'risk', severity: 'high' });

    for (const row of BODY_ALLOWLIST) {
      for (const role of ALL) {
        const res = await fetch(base + row.p, { headers: { cookie: fx.cookie('rb-' + role) } });
        const { json, text } = await readBody(res);
        assert.strictEqual(res.status, 200, `${role} GET ${row.p} (${text.slice(0, 120)})`);
        row.check(role, json, 'rb-' + role);
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('matrix: demo store stays lenient — no role is ever refused by the read gate', async () => {
  const cookies = {};
  for (const role of ALL) {
    cookies[role] = demoSession({ controlConn, runtimeConn, username: 'rm-demo-' + role, role });
  }
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    // Control-plane paths (/api/deals*, /api/admin*, /api/auth/sessions) resolve
    // to the control store even for an unbound session (db/resolver.js), so they
    // are strict by design (fail-closed) and keep TODAY's refusals for the same
    // roles (the handler's own inline guard / the CR-02 admin carve-out).
    const isControlPlane = (p) => /^\/api\/(deals|admin|auth\/sessions)(\/|$|\?)/.test(p);
    for (const row of MATRIX) {
      for (const role of ALL) {
        const res = await fetch(base + row.p, { headers: { cookie: cookies[role] } });
        const { json } = await readBody(res);
        const refusedByReadGate = res.status === 403 && json && json.error === READ_GATE_ERROR;
        if (isControlPlane(row.p)) {
          if (row.deny.includes(role)) assert.strictEqual(res.status, 403, `demo ${role} GET ${row.p} keeps today's 403`);
          else assert.ok(!refusedByReadGate, `demo ${role} GET ${row.p} must pass the read gate`);
        } else {
          // The temp demo.db is empty, so a handler may 500 on its own terms;
          // what is asserted is that the READ GATE never refuses the demo store.
          assert.ok(!refusedByReadGate, `demo store ${role} GET ${row.p} must not be refused by the read gate`);
        }
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('matrix: the final table denies exactly the PRD rows (unit)', () => {
  const p = require('../lib/readPolicy');
  assert.strictEqual(p.roleAllowedForRead('employee', '/api/raid'), false);
  assert.strictEqual(p.roleAllowedForRead('pmo', '/api/hrbps'), false);
  assert.strictEqual(p.roleAllowedForRead('hrbp', '/api/hrbps'), true);
  assert.strictEqual(p.roleAllowedForRead('employee', '/api/courses'), true);
  // plan 11-06: the temporary all-roles get-or-create read rule (amendment 1) is removed
  assert.strictEqual(p.roleAllowedForRead('employee', '/api/employees/get-or-create'), false);
  assert.deepStrictEqual(p.accessSummaryFor('employee', false).roster, true, 'demo store: everything true');
  assert.deepStrictEqual(p.accessSummaryFor('employee', true).roster, false);
  assert.deepStrictEqual(p.accessSummaryFor('pmo', true).roster, true);
});
