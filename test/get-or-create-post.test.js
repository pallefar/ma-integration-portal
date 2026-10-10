// D-11-04 / AUTHZ-04 (Phase 11, plan 11-06; R3 F-2): GET /api/employees/get-or-create
// created roster rows from a GET — it bypassed ROLE_WRITE_POLICY and
// validationMiddleware (both keyed on write methods) and was fireable by a
// cross-site link. It is now a validated, policy-gated POST. This suite proves:
//   * the demo store keeps working end to end (201 then 200, same profile);
//   * the GET no longer exists and creates nothing, for every lane;
//   * the body is zod-validated (over-long field -> 400 naming it; unknown
//     keys such as points/badge/completedLessons are stripped);
//   * amendment 5: in a real deal a role the read policy refuses /api/employees
//     resolves ONLY its own account-derived record — never a colleague's, by
//     supplied empId or by name — while admin/hrbp/pmo keep name matching.
//
// Isolated MA_* temp trio (committed data/*.db is never opened). The demo store
// is seeded from the repo's db.json snapshot via the same migration + split the
// other gate suites use, so the handler has a real `settings` block to read.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-get-or-create-post-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_DB_PATH = path.join(TMP, 'legacy-source.db');
runMigration(path.join(__dirname, '..', 'db.json'), SOURCE_DB_PATH);
const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP });

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const app = require('../server.js');
const { createDealFixture, demoSession } = require('./helpers/deal-fixture');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const GOC = '/api/employees/get-or-create';

async function withServer(fn) {
  const server = await listenLocal(app);
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function postGoc(base, cookie, body) {
  const res = await fetch(base + GOC, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, json, text };
}

function rosterCount(conn, id) {
  return conn.prepare('SELECT COUNT(*) AS n FROM employees WHERE id = ?').get(id).n;
}

function realDeal(dealId, tag) {
  return createDealFixture({
    controlConn, runtimeConn, dealId,
    members: [
      { username: `${tag}-admin`, role: 'admin' },
      { username: `${tag}-hrbp`, role: 'hrbp' },
      { username: `${tag}-pmo`, role: 'pmo' },
      { username: `${tag}-employee`, role: 'employee' },
      { username: `${tag}-employee2`, role: 'employee' },
    ],
  });
}

test('tracer: demo store — an employee POSTs get-or-create: 201 with a new profile, then 200 with the same one', async () => {
  const cookie = demoSession({ controlConn, runtimeConn, username: 'goc-demo-employee', role: 'employee' });
  const demoConn = store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);
  await withServer(async (base) => {
    const first = await postGoc(base, cookie, {
      empId: 'emp_goc_demo_1', name: 'Goc Demo Newhire', role: 'Analyst', department: 'Finance', company: 'Goc Co',
    });
    assert.strictEqual(first.status, 201, first.text);
    assert.strictEqual(first.json.success, true);
    assert.strictEqual(first.json.employee.id, 'emp_goc_demo_1');
    assert.strictEqual(first.json.employee.name, 'Goc Demo Newhire');
    assert.strictEqual(first.json.employee.department, 'Finance');
    assert.strictEqual(rosterCount(demoConn, 'emp_goc_demo_1'), 1);

    const again = await postGoc(base, cookie, { empId: 'emp_goc_demo_1', name: 'Goc Demo Newhire' });
    assert.strictEqual(again.status, 200, again.text);
    assert.deepStrictEqual(again.json.employee, first.json.employee, 'the same profile comes back');
    assert.strictEqual(rosterCount(demoConn, 'emp_goc_demo_1'), 1, 'repeat creates no second row');
  });
});

test('GET /api/employees/get-or-create no longer exists: never 2xx and creates nothing, in every lane', async () => {
  const demoCookie = demoSession({ controlConn, runtimeConn, username: 'goc-get-demo', role: 'employee' });
  const fx = realDeal('deal_gocget', 'gg');
  const demoConn = store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);
  const dealConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_gocget'), dbFiles.DEAL_SCHEMA_PATH);
  const before = {
    demo: demoConn.prepare('SELECT COUNT(*) AS n FROM employees').get().n,
    deal: dealConn.prepare('SELECT COUNT(*) AS n FROM employees').get().n,
  };
  await withServer(async (base) => {
    const q = `${GOC}?empId=emp_goc_getter&name=Get%20Writer&role=x&department=y`;
    const demo = await fetch(base + q, { headers: { cookie: demoCookie } });
    await demo.text();
    assert.strictEqual(demo.status, 404, 'demo caller: no such route');
    for (const [u, expected] of [['gg-employee', 403], ['gg-pmo', 404], ['gg-admin', 404]]) {
      const res = await fetch(base + q, { headers: { cookie: fx.cookie(u) } });
      await res.text();
      assert.strictEqual(res.status, expected, `${u} GET get-or-create`);
    }
  });
  assert.strictEqual(demoConn.prepare('SELECT COUNT(*) AS n FROM employees').get().n, before.demo, 'demo roster unchanged');
  assert.strictEqual(dealConn.prepare('SELECT COUNT(*) AS n FROM employees').get().n, before.deal, 'deal roster unchanged');
  assert.strictEqual(rosterCount(demoConn, 'emp_goc_getter'), 0);
  assert.strictEqual(rosterCount(dealConn, 'emp_goc_getter'), 0);
});

test('body validation: an over-long field is 400 naming the field; unknown keys are stripped', async () => {
  const cookie = demoSession({ controlConn, runtimeConn, username: 'goc-val-employee', role: 'employee' });
  await withServer(async (base) => {
    const tooLong = await postGoc(base, cookie, { empId: 'emp_goc_long', name: 'x'.repeat(201) });
    assert.strictEqual(tooLong.status, 400, tooLong.text);
    assert.match(String(tooLong.json && tooLong.json.error), /name/i, '400 names the offending field');
    const longId = await postGoc(base, cookie, { empId: 'e'.repeat(121), name: 'ok' });
    assert.strictEqual(longId.status, 400);
    assert.match(String(longId.json && longId.json.error), /empId/);

    const stripped = await postGoc(base, cookie, {
      empId: 'emp_goc_strip', name: 'Strip Test', points: 9999, badge: 'Ultimate Integrator',
      completedLessons: ['l1_1', 'l1_2'], bonusPoints: 500, id: 'emp_goc_other',
    });
    assert.strictEqual(stripped.status, 201, stripped.text);
    const e = stripped.json.employee;
    assert.strictEqual(e.id, 'emp_goc_strip', 'a body `id` key is not the lookup key');
    assert.strictEqual(e.points, 0, 'a supplied points value is stripped');
    assert.strictEqual(e.badge, 'New Recruit');
    assert.deepStrictEqual(e.completedLessons, []);
    assert.strictEqual(e.bonusPoints, 0);
  });
});

test('write policy: every role may POST (no widening), an unauthenticated caller is refused', async () => {
  const fx = realDeal('deal_gocroles', 'gr');
  await withServer(async (base) => {
    for (const role of ['admin', 'hrbp', 'pmo', 'employee']) {
      const r = await postGoc(base, fx.cookie(`gr-${role}`), { empId: `emp_goc_role_${role}`, name: `Role ${role}` });
      assert.ok(r.status === 200 || r.status === 201, `${role} POST get-or-create -> ${r.status} ${r.text}`);
    }
    const anon = await postGoc(base, '', { empId: 'emp_goc_anon', name: 'Anon' });
    assert.strictEqual(anon.status, 401, 'no session -> login required');
  });
});

test('real deal, employee: get-or-create resolves ONLY the caller\'s own record (amendment 5), never a colleague\'s', async () => {
  const fx = realDeal('deal_gocscope', 'gs');
  const dealConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_gocscope'), dbFiles.DEAL_SCHEMA_PATH);
  await withServer(async (base) => {
    // A colleague's roster record with distinctive, recognisable fields.
    const seeded = await postGoc(base, fx.cookie('gs-admin'), {
      empId: 'emp_gs_colleague', name: 'Colleague Quillfeather', role: 'VP Secret Programme',
      department: 'Project Nightjar', company: 'Target Co', buddyName: 'Hidden Buddy', buddyEmail: 'hidden.buddy@example.test',
    });
    assert.strictEqual(seeded.status, 201, seeded.text);
    const secrets = ['Colleague Quillfeather', 'Project Nightjar', 'VP Secret Programme', 'Hidden Buddy', 'hidden.buddy@example.test', 'emp_gs_colleague'];
    const leaks = (text) => secrets.filter((s) => text.includes(s));

    // (1) by supplied empId
    const byId = await postGoc(base, fx.cookie('gs-employee'), { empId: 'emp_gs_colleague', name: 'whoever' });
    assert.ok(byId.status === 200 || byId.status === 201, byId.text);
    assert.deepStrictEqual(leaks(byId.text), [], 'a supplied colleague empId must not return the colleague\'s record');
    const ownId = byId.json.employee.id;
    assert.notStrictEqual(ownId, 'emp_gs_colleague');
    assert.match(ownId, /^emp_acct_[0-9a-f]{20}$/, 'the id is derived from the session identity');
    assert.strictEqual(byId.json.employee.name, 'gs-employee', 'name comes from the account, not the request');

    // (2) by name only (the original roster-lookup shape), case-insensitively
    const byName = await postGoc(base, fx.cookie('gs-employee'), { name: 'colleague QUILLFEATHER' });
    assert.strictEqual(byName.status, 200, 'the own record already exists now');
    assert.deepStrictEqual(leaks(byName.text), [], 'name-only lookup must not match a colleague');
    assert.strictEqual(byName.json.employee.id, ownId, 'stable id per account');

    // (3) one row per account, whatever empId is supplied
    for (const supplied of ['emp_a', 'emp_b', 'emp_c']) {
      const r = await postGoc(base, fx.cookie('gs-employee'), { empId: supplied, name: supplied });
      assert.strictEqual(r.json.employee.id, ownId);
    }
    assert.strictEqual(rosterCount(dealConn, ownId), 1, 'exactly one own row');
    assert.strictEqual(rosterCount(dealConn, 'emp_a') + rosterCount(dealConn, 'emp_b') + rosterCount(dealConn, 'emp_c'), 0,
      'supplied ids never become roster rows for a restricted caller');

    // (4) a second employee gets a DIFFERENT own record, not the first one's
    const other = await postGoc(base, fx.cookie('gs-employee2'), { empId: ownId, name: 'gs-employee' });
    assert.notStrictEqual(other.json.employee.id, ownId, 'a colleague\'s derived id supplied as empId is ignored');
    assert.strictEqual(other.json.employee.name, 'gs-employee2');

    // (5) self-declared leader / buddy attributes are not honoured
    const lead = await postGoc(base, fx.cookie('gs-employee2'), {
      isLeader: true, leaderRole: 'Executive Sponsor', buddyName: 'B', buddyEmail: 'b@example.test',
    });
    assert.strictEqual(lead.json.employee.isLeader, false);
    assert.strictEqual(lead.json.employee.leaderRole, 'None');
    assert.strictEqual(lead.json.employee.buddyEmail, '');

    // roles the read policy allows the roster keep name matching + supplied empId
    for (const u of ['gs-admin', 'gs-hrbp', 'gs-pmo']) {
      const m = await postGoc(base, fx.cookie(u), { name: 'COLLEAGUE quillfeather' });
      assert.strictEqual(m.status, 200, `${u}: ${m.text}`);
      assert.strictEqual(m.json.employee.id, 'emp_gs_colleague', `${u} keeps name matching`);
      const i = await postGoc(base, fx.cookie(u), { empId: 'emp_gs_colleague' });
      assert.strictEqual(i.json.employee.id, 'emp_gs_colleague', `${u} keeps empId lookup`);
    }
  });
});

test('WR-03 (Phase 11 review): the restricted lane never takes role / department / company from the body — server-minted defaults only; staff never see the self-assigned values', async () => {
  const fx = realDeal('deal_gocwr03', 'gw');
  const dealConn = store.getOrOpenConnection(dbFiles.dealDbPath('deal_gocwr03'), dbFiles.DEAL_SCHEMA_PATH);
  await withServer(async (base) => {
    const forged = ['<img src=x onerror=alert(1)>', 'Executive Board', 'TE Connectivity Forged'];
    const r = await postGoc(base, fx.cookie('gw-employee'), {
      role: forged[0], department: forged[1], company: forged[2], isLeader: true,
    });
    assert.strictEqual(r.status, 201, r.text);
    const e = r.json.employee;
    assert.match(e.id, /^emp_acct_[0-9a-f]{20}$/);
    assert.strictEqual(e.role, 'Specialist', 'role is the server default');
    assert.strictEqual(e.department, 'Operations', 'department is the server default');
    assert.ok(!forged.includes(e.company), 'company is the deal\'s own, never the supplied one');
    assert.strictEqual(e.isLeader, false);
    const stored = JSON.parse(dealConn.prepare('SELECT data FROM employees WHERE id = ?').get(e.id).data);
    assert.deepStrictEqual([stored.role, stored.department, stored.company], [e.role, e.department, e.company], 'the stored row matches');

    const staff = await fetch(base + '/api/employees', { headers: { cookie: fx.cookie('gw-hrbp') } });
    const text = await staff.text();
    assert.strictEqual(staff.status, 200);
    for (const s of forged) assert.ok(!text.includes(s), `the IL's roster carries none of the self-assigned value ${s}`);

    // Roles allowed the roster keep supplying their own fields (unchanged behaviour).
    const lead = await postGoc(base, fx.cookie('gw-hrbp'), { empId: 'emp_gw_staffmade', name: 'Staff Made', role: 'Analyst', department: 'Finance', company: 'Goc Co' });
    assert.strictEqual(lead.status, 201, lead.text);
    assert.deepStrictEqual([lead.json.employee.role, lead.json.employee.department, lead.json.employee.company], ['Analyst', 'Finance', 'Goc Co']);
  });
});
