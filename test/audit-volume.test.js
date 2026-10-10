// D-12-01 / DATA-01 (Phase 12, plan 12-02): the HTTP-level proof of the audit
// write amplification fix, at the volume the v3.0 review measured at.
//
// The R5-01 / R2-01 / R1-07 finding: on a real deal holding 1,000 tasks / 5,000
// RAID entries / 200 org positions ONE create appended 6,220 audit rows (99.96 %
// byte-identical before/after). Here the same profile is seeded into a real
// deal's own database file (scripts/perf/lib/volume-deal.js — straight into the
// lanes the deal's settings select), then the real app is driven over HTTP as an
// hrbp member bound to that deal:
//
//   - POST /api/raid (create)            -> exactly 1 audit row (insert, row_id = new id)
//   - POST /api/integration-tasks (create) -> exactly 1 audit row
//   - POST /api/raid (id + version)       -> exactly 1 `update` row
//
// Audit rows are counted ONLY through auditHook.countAudit / queryAudit — never
// raw SQL on audit.db — so plan 12-08 (per-deal audit partitions) can re-
// implement counting across partitions without this suite being edited.
//
// Runs against an ISOLATED temp control/runtime/demo/deals/audit set (MA_*
// paths); the committed data/*.db is never opened.
//
// node:test — run via `node --test test/audit-volume.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-audit-volume-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const Database = require('better-sqlite3');
const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const auditHook = require('../db/auditHook.js');
const app = require('../server.js');
const { createDealFixture } = require('./helpers/deal-fixture');
const { seedVolumeDeal } = require('../scripts/perf/lib/volume-deal.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

const DEAL_ID = 'deal_auditvolume';
const VOLUME = { tasks: 1000, raid: 5000, positions: 200 };

test.after(() => {
  try { if (app.denialAuditor && app.denialAuditor.stopSweeper) app.denialAuditor.stopSweeper(); } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const fixture = createDealFixture({
  controlConn, runtimeConn, dealId: DEAL_ID,
  members: [{ username: 'karen', role: 'hrbp' }],
});
const seeded = seedVolumeDeal({ dealDbPath: dbFiles.dealDbPath(DEAL_ID), ...VOLUME });

function postJSON(base, urlPath, body) {
  return fetch(`${base}${urlPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: fixture.cookie('karen') },
    body: JSON.stringify(body),
  });
}

function dealRowCount(table) {
  const conn = new Database(dbFiles.dealDbPath(DEAL_ID), { readonly: true });
  try { return conn.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n; } finally { conn.close(); }
}

test('audit-volume (seed): the deal holds 1,000 tasks / 5,000 RAID / 200 positions in the lanes its own settings select', () => {
  assert.deepStrictEqual(seeded.counts, VOLUME);
  assert.strictEqual(seeded.taskLane, 'integrationTasks', 'a deal without demoMode === false uses the standard lanes (server.js taskLane())');
  assert.strictEqual(seeded.raidLane, 'raidEntries');
  assert.strictEqual(dealRowCount(seeded.taskLane), 1000);
  assert.strictEqual(dealRowCount(seeded.raidLane), 5000);
  assert.strictEqual(dealRowCount(seeded.positionLane), 200);
  assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID }), 0, 'seeding bypasses the audit hook — the trail starts empty');
});

test('audit-volume (create RAID): one POST /api/raid on the volume deal appends exactly ONE audit row — insert, row_id = the new id', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = auditHook.countAudit({ dealId: DEAL_ID });
    const res = await postJSON(base, '/api/raid', { type: 'risk', title: 'Volume create', severity: 'low' });
    assert.strictEqual(res.status, 201);
    const { entry } = await res.json();

    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID }) - before, 1, 'one create must append exactly one audit row (was 6,220)');
    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID, rowId: entry.id, action: 'insert' }), 1);
    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID, rowId: entry.id, collection: seeded.raidLane }), 1);
    assert.strictEqual(dealRowCount(seeded.raidLane), 5001);
  } finally {
    server.close();
  }
});

test('audit-volume (create task): one POST /api/integration-tasks on the volume deal appends exactly ONE audit row', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const before = auditHook.countAudit({ dealId: DEAL_ID });
    const res = await postJSON(base, '/api/integration-tasks', { title: 'Volume task create', workstreamId: 'ws_imo', phase: 'd30' });
    assert.strictEqual(res.status, 201);
    const { task } = await res.json();

    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID }) - before, 1, 'one create must append exactly one audit row (was 6,223)');
    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID, rowId: task.id, action: 'insert' }), 1);
    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID, rowId: task.id, collection: seeded.taskLane }), 1);
    assert.strictEqual(dealRowCount(seeded.taskLane), 1001);
  } finally {
    server.close();
  }
});

test('audit-volume (update): a status update of one existing RAID entry (id + held version) appends exactly ONE update row, version 0 -> 1', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const targetId = 'vol_raid_00042';

    const before = auditHook.countAudit({ dealId: DEAL_ID });
    const first = await postJSON(base, '/api/raid', { id: targetId, status: 'mitigating', version: 0 });
    assert.strictEqual(first.status, 200);
    const { entry } = await first.json();
    assert.strictEqual(entry.version, 1);
    assert.strictEqual(entry.status, 'mitigating');

    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID }) - before, 1, 'one status update must append exactly one audit row');
    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID, rowId: targetId, action: 'update' }), 1);

    // And a second edit from the version the first returned: still one row.
    const mid = auditHook.countAudit({ dealId: DEAL_ID });
    const second = await postJSON(base, '/api/raid', { id: targetId, status: 'closed', version: entry.version });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID }) - mid, 1);
    assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID, rowId: targetId, action: 'update' }), 2);
  } finally {
    server.close();
  }
});

test('audit-volume (reorder): an unmodified read -> write at volume appends 0 rows and a reorder persists with 0 rows', () => {
  const resolver = require('../db/resolver.js');
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'karen', role: 'hrbp', dealId: DEAL_ID, sessionId: 'sess_karen' } };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  const context = {
    conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath,
    actor: { username: 'karen', role: 'hrbp', sessionId: 'sess_karen' },
    request: { method: 'TEST', path: '/whatever', ip: null },
  };

  const before = auditHook.countAudit({ dealId: DEAL_ID });
  store.runWithDb(context, () => {
    const noop = store.readDb();
    store.writeDb(noop);
  });
  assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID }) - before, 0, 'an unmodified readDb() -> writeDb() appends 0 rows');

  let firstIds;
  store.runWithDb(context, () => {
    const db = store.readDb();
    firstIds = db[seeded.raidLane].slice(0, 10).map((r) => r.id);
    db[seeded.raidLane] = [...db[seeded.raidLane].slice(0, 10).reverse(), ...db[seeded.raidLane].slice(10)];
    store.writeDb(db);
  });
  assert.strictEqual(auditHook.countAudit({ dealId: DEAL_ID }) - before, 0, 'a reorder appends 0 rows');
  const after = store.runWithDb(context, () => store.readDb());
  assert.deepStrictEqual(after[seeded.raidLane].slice(0, 10).map((r) => r.id), [...firstIds].reverse(), 'the reorder persisted');
});
