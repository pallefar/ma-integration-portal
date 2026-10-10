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
