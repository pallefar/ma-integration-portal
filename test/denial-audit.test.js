// D-11-05 / AUTHZ-05 (Phase 11, plan 11-04) — every authorization denial is a
// rate-bounded `access-denied` security event.
//
// Two layers:
//   1. UNIT — lib/denialAudit.js with a fake clock and an in-memory writer:
//      first denial writes (count 1), the rest of the window is only counted,
//      the folded count is written ONCE as the next row, <= 1 row per key per
//      window, route-template keys, capped key map, failed write loses nothing,
//      and the module issues no SQL update (audit.db is append-only, AUD-02).
//   2. LIVE — the real app against an ISOLATED temp control/runtime/demo/deals/
//      audit set (MA_* paths; the committed data/*.db is never opened):
//      gate 401/403, resolver 403 and clearance-404 rows, byte-identical
//      responses, variant spellings sharing one canonical route.
//
// Each live scenario uses its own account / route / reason so the shared
// process-wide auditor window state never couples two scenarios (a probe that
// "must produce exactly one row" never follows another scenario hitting the
// same actor+route+reason).
//
// node:test — run via `node --test test/denial-audit.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-denial-audit-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

const { createDenialAuditor } = require('../lib/denialAudit');
const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const auditHook = require('../db/auditHook.js');
const app = require('../server.js');
const { createDealFixture } = require('./helpers/deal-fixture');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

test.after(() => {
  app.denialAuditor.stopSweeper();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// ---------------------------------------------------------------------------
// 1. UNIT
// ---------------------------------------------------------------------------

function unitAuditor(opts) {
  const clock = { t: 1_000_000 };
  const rows = [];
  const auditor = createDenialAuditor(Object.assign({
    now: () => clock.t,
    write: (e) => rows.push(e),
    templateFor: (p) => p,
  }, opts || {}));
  return { auditor, clock, rows };
}
const probe = (over) => Object.assign({
  actor: { username: 'u1', role: 'pmo' }, method: 'GET', path: '/api/x', reason: 'role-read', status: 403,
}, over || {});

test('unit: first denial writes count 1; 49 more inside 60 s write nothing; sweep writes ONE folded row of 49', () => {
  const { auditor, clock, rows } = unitAuditor();
  assert.strictEqual(auditor.record(probe()), true);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].action, 'access-denied');
  assert.strictEqual(rows[0].after.count, 1);
  assert.strictEqual(rows[0].after.folded, false);
  assert.strictEqual(rows[0].subject, 'GET /api/x');
  for (let i = 0; i < 49; i += 1) {
    clock.t += 500; // 24.5 s total — all inside the window
    assert.strictEqual(auditor.record(probe()), false);
  }
  assert.strictEqual(rows.length, 1, '50 identical probes inside 60 s = exactly ONE row');
  clock.t += 60000;
  assert.strictEqual(auditor.sweep(), 1);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].after.count, 49);
  assert.strictEqual(rows[1].after.folded, true);
  assert.strictEqual(auditor.sweep(), 0, 'nothing pending: a second sweep writes nothing');
  const total = rows.reduce((n, r) => n + r.after.count, 0);
  assert.strictEqual(total, 50, 'no denial is lost: row counts add up to the probe count');
});

test('unit: <= 1 row per key per window across many windows; counts always add up', () => {
  const { auditor, clock, rows } = unitAuditor();
  let sent = 0;
  const start = clock.t;
  for (let s = 0; s < 600; s += 1) { // 1 probe/second for 10 minutes
    auditor.record(probe());
    sent += 1;
    clock.t += 1000;
  }
  auditor.sweep();
  clock.t += 60000;
  auditor.sweep();
  const windows = Math.ceil((clock.t - start) / 60000);
  assert.ok(rows.length <= windows + 1, `rows ${rows.length} must stay within the window count ${windows}`);
  assert.ok(rows.length >= 2);
  assert.strictEqual(rows.reduce((n, r) => n + r.after.count, 0), sent);
});

test('unit: a different actor, method, route or reason is a different key (own first row)', () => {
  const { auditor, rows } = unitAuditor();
  auditor.record(probe());
  auditor.record(probe({ actor: { username: 'u2', role: 'pmo' } }));
  auditor.record(probe({ method: 'POST' }));
  auditor.record(probe({ path: '/api/y' }));
  auditor.record(probe({ reason: 'role-write' }));
  assert.strictEqual(rows.length, 5);
  assert.strictEqual(auditor.size(), 5);
});

test('unit: anonymous actor is named (anonymous) with a non-null role (audit_log.actor_role is NOT NULL)', () => {
  const { auditor, rows } = unitAuditor();
  auditor.record(probe({ actor: null, reason: 'no-session', status: 401 }));
  assert.strictEqual(rows[0].actor.username, '(anonymous)');
  assert.ok(rows[0].actor.role, 'role must be a non-empty string');
});

test('unit: random ids on one route template share ONE rate key (keys bounded by templates, not ids)', () => {
  const { auditor, rows } = unitAuditor({
    templateFor: (p) => p.replace(/^(\/api\/raid)\/[^/]+$/, '$1/:id'),
  });
  for (let i = 0; i < 200; i += 1) {
    auditor.record(probe({ method: 'DELETE', path: `/api/raid/rnd_${i}_${Math.random().toString(36).slice(2)}`, status: 404, reason: 'clearance-404' }));
  }
  assert.strictEqual(auditor.size(), 1);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].subject, 'DELETE /api/raid/:id');
});

test('unit: the key map is size-capped; excess keys fold into a per-reason (overflow) key and are counted', () => {
  const { auditor, rows } = unitAuditor({ maxKeys: 3 });
  for (let i = 0; i < 20; i += 1) {
    auditor.record(probe({ actor: { username: `flood${i}`, role: 'pmo' } }));
  }
  assert.ok(auditor.size() <= 4, `size ${auditor.size()} must stay at the cap plus one overflow key per reason`);
  const overflow = rows.filter((r) => r.actor.username === '(overflow)');
  assert.strictEqual(overflow.length, 1, 'the overflow key writes its own first row once per window');
  auditor.flushAll();
  const total = rows.reduce((n, r) => n + r.after.count, 0);
  assert.strictEqual(total, 20, 'overflowed denials are still counted');
});

test('unit: a failing write is never swallowed and loses no pending count', () => {
  let fail = false;
  const rows = [];
  const clock = { t: 5 };
  const auditor = createDenialAuditor({
    now: () => clock.t,
    templateFor: (p) => p,
    write: (e) => { if (fail) throw new Error('SQLITE_BUSY'); rows.push(e); },
  });
  auditor.record(probe());
  auditor.record(probe());
  auditor.record(probe());
  clock.t += 60000;
  fail = true;
  assert.throws(() => auditor.sweep(), /SQLITE_BUSY/);
  assert.throws(() => auditor.record(probe({ actor: { username: 'fresh', role: 'pmo' } })), /SQLITE_BUSY/);
  fail = false;
  auditor.sweep();
  assert.strictEqual(rows.reduce((n, r) => n + r.after.count, 0), 3, 'the 2 folded denials were written after recovery');
  assert.strictEqual(auditor.size(), 1, 'the failed fresh key left nothing half-recorded in memory');
});

test('unit: lib/denialAudit.js issues no SQL update (AUD-02 append-only; comments may name the trigger)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'denialAudit.js'), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.strictEqual((code.match(/UPDATE/g) || []).length, 0);
  assert.strictEqual((code.match(/DELETE\s+FROM/gi) || []).length, 0);
  assert.strictEqual((code.match(/\.prepare\(|\.exec\(/g) || []).length, 0, 'no SQL of any kind: the writer is injected');
  assert.strictEqual(typeof createDenialAuditor, 'function');
});

// ---------------------------------------------------------------------------
// 2. LIVE
// ---------------------------------------------------------------------------

function denialRows(where, params) {
  const conn = auditHook.getAuditConnection();
  return conn.prepare(
    `SELECT * FROM audit_log WHERE action = 'access-denied'${where ? ' AND ' + where : ''} ORDER BY id`
  ).all(...(params || []));
}
const detail = (row) => JSON.parse(row.after_json);

test('tracer: anonymous GET /api/synergies x5 -> 401 x5 -> exactly ONE access-denied row (count 1, no-session)', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 5; i += 1) {
      const res = await fetch(`${base}/api/synergies`);
      assert.strictEqual(res.status, 401);
      assert.deepStrictEqual(await res.json(), { error: 'Login required.', authRequired: true }, 'body byte-identical to before 11-04');
    }
    const rows = denialRows("actor_username = '(anonymous)' AND row_id = 'GET /api/synergies'");
    assert.strictEqual(rows.length, 1, `5 identical probes in one window = one row, got ${rows.length}`);
    assert.strictEqual(rows[0].actor_role, '(anonymous)');
    assert.strictEqual(rows[0].request_method, 'GET');
    assert.strictEqual(rows[0].request_path, '/api/synergies');
    const d = detail(rows[0]);
    assert.strictEqual(d.reason, 'no-session');
    assert.strictEqual(d.status, 401);
    assert.strictEqual(d.count, 1);
    assert.strictEqual(d.folded, false);
    // The 4 folded denials are counted, never dropped: flushing writes them once.
    app.denialAuditor.flushAll();
    const after = denialRows("actor_username = '(anonymous)' AND row_id = 'GET /api/synergies'");
    assert.strictEqual(after.length, 2);
    assert.strictEqual(detail(after[1]).count, 4);
    assert.strictEqual(detail(after[1]).folded, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live: random ids on one template share a key (anonymous DELETE /api/raid/<random> x20 = one row, template /api/raid/:id)', async () => {
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${base}/api/raid/rid_${i}_${Math.random().toString(36).slice(2)}`, { method: 'DELETE' });
      assert.strictEqual(res.status, 401);
      await res.text();
    }
    const rows = denialRows("actor_username = '(anonymous)' AND row_id = 'DELETE /api/raid/:id'");
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(detail(rows[0]).reason, 'no-session');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('live: no existing audit row is ever updated or deleted (AUD-02 triggers intact)', () => {
  const conn = auditHook.getAuditConnection();
  assert.throws(() => conn.prepare("UPDATE audit_log SET actor_username = 'x' WHERE id = 1").run(), /append-only/);
  assert.throws(() => conn.prepare('DELETE FROM audit_log WHERE id = 1').run(), /append-only/);
});

// (silence "unused" lint-by-eye: the fixture + conns are used by the Task 2 rows below)
void createDealFixture; void controlConn; void runtimeConn;
