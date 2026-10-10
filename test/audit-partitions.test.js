// D-12-04 (Phase 12, plan 12-08): per-deal hash-chained audit partitions.
//
// Proves: an audited deal write appends ONE chained row to
// <audit dir>/<dealId>.db and none to audit.db; consecutive rows link; a
// partition that cannot append (busy, sealed) rolls the DEAL write back so a
// 503/409 truthfully means "nothing persisted" (Phase 8 CR-01 preserved); a
// flipped byte is detected by verifyChain and the CLI; the admin viewer spans
// audit.db + partitions; audit.db is opened before the deal transaction
// (PD-29 / checker B-1).
//
// Same temp-trio-plus-env-override pattern as test/audit-log.test.js — the
// storage layer is booted against isolated temp files, never data/*.db. The
// partition directory defaults next to MA_AUDIT_DB_PATH (PD-4).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

function randId(prefix) {
  return prefix + '_' + crypto.randomBytes(3).toString('hex');
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-audit-partitions-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
delete process.env.MA_AUDIT_DIR;

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const resolver = require('../db/resolver.js');
const controlStore = require('../db/controlStore.js');
const auditHook = require('../db/auditHook.js');
const auditChain = require('../db/auditChain.js');
const readiness = require('../db/readiness.js');
const { createDealDatabase } = require('../db/dealSeed.js');

store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);

test.after(() => {
  try { auditHook.closeAuditConnection(); } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

function registerDeal(label) {
  const deal = controlStore.createDeal({ name: label, targetCompany: label + ' Co', members: ['karen'], createdBy: 'admin' });
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal.id;
}

function runAsDeal(dealId, fn) {
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'karen', role: 'hrbp', dealId, sessionId: 'sess_karen' } };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  const actor = { username: 'karen', role: 'hrbp', sessionId: 'sess_karen' };
  const request = { method: 'TEST', path: '/whatever', ip: null };
  return store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath, actor, request }, fn);
}

function runAsDemo(fn) {
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: null };
  const resolved = resolver.resolveDatabase(fakeReq);
  const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
  const request = { method: 'TEST', path: '/whatever', ip: null };
  return store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath, actor: null, request }, fn);
}

function insertAlert(dealId, id, title) {
  runAsDeal(dealId, () => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id, title, severity: 'low' }]);
    store.writeDb(db);
  });
}

function alertIds(dealId) {
  return runAsDeal(dealId, () => store.readDb().alerts.map((a) => a.id));
}

function partitionRows(dealId) {
  const conn = dbFiles.openDbFileReadOnly(dbFiles.auditPartitionPath(dealId));
  try { return conn.prepare('SELECT * FROM audit_log ORDER BY id').all(); } finally { conn.close(); }
}

function controlCount() {
  return auditHook.getAuditConnection().prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
}

function independentHash(row) {
  const arr = auditChain.CANONICAL_COLUMNS.map((c) => (row[c] === undefined ? null : row[c]));
  return crypto.createHash('sha256').update(JSON.stringify(arr), 'utf8').digest('hex');
}

function runCli(args) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'audit-verify.js'), ...args], {
    env: { ...process.env },
    encoding: 'utf8',
  });
}

test('partitions (a): a deal write appends exactly one chained row to <auditDir>/<dealId>.db and none to audit.db', () => {
  const dealId = registerDeal('Part Deal A');
  const before = controlCount();
  const rowId = randId('alert_pa');
  insertAlert(dealId, rowId, 'Partition insert');

  const file = dbFiles.auditPartitionPath(dealId);
  assert.ok(file.startsWith(dbFiles.AUDIT_DIR + path.sep), 'partition lives under AUDIT_DIR');
  assert.strictEqual(path.dirname(file), path.join(TMP_DIR, 'audit'), 'PD-4: AUDIT_DIR defaults next to MA_AUDIT_DB_PATH');
  assert.ok(fs.existsSync(file), 'the partition file exists after an audited deal write');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600, 'partition file is 0600');
    assert.strictEqual(fs.statSync(path.dirname(file)).mode & 0o777, 0o700, 'partition dir is 0700');
  }

  const rows = partitionRows(dealId);
  assert.strictEqual(rows.length, 1);
  const row = rows[0];
  assert.strictEqual(row.row_id, rowId);
  assert.strictEqual(row.action, 'insert');
  assert.strictEqual(row.deal_id, dealId);
  assert.strictEqual(row.actor_username, 'karen');
  assert.strictEqual(row.prev_hash, auditChain.genesisHash(dealId), 'first row links to the partition-bound genesis');
  assert.strictEqual(row.row_hash, independentHash(row), 'row_hash recomputes independently from the canonical form');
  assert.strictEqual(controlCount(), before, 'audit.db gains 0 rows for a deal write');

  // The viewer and counter see it, tagged with its partition.
  const viewed = auditHook.queryAudit({ dealId }).filter((r) => r.row_id === rowId);
  assert.strictEqual(viewed.length, 1);
  assert.strictEqual(viewed[0].partition, dealId);
  assert.strictEqual(auditHook.countAudit({ dealId, rowId }), 1);
});

test('partitions (b): the second write links to the first; verifyChain and the CLI agree', () => {
  const dealId = registerDeal('Part Deal B');
  insertAlert(dealId, randId('alert_pb'), 'first');
  insertAlert(dealId, randId('alert_pb'), 'second');

  const rows = partitionRows(dealId);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1].prev_hash, rows[0].row_hash);
  assert.strictEqual(rows[1].row_hash, independentHash(rows[1]));

  const conn = dbFiles.openDbFileReadOnly(dbFiles.auditPartitionPath(dealId));
  try {
    const res = auditChain.verifyChain(conn, dealId);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.rows, 2);
    assert.strictEqual(res.headHash, rows[1].row_hash);
    assert.strictEqual(res.sealed, false);
  } finally { conn.close(); }

  const cli = runCli(['--deal', dealId]);
  assert.strictEqual(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, new RegExp(`^OK .*${dealId}\\.db rows=2 head=${rows[1].row_hash} sealed=no`));
  assert.strictEqual(runCli([]).status, 2, 'no arguments is a usage error');
});

test('partitions (c): a partition that cannot append rolls the DEAL write back (503 means nothing persisted)', () => {
  const dealId = registerDeal('Part Deal C');
  insertAlert(dealId, randId('alert_pc'), 'seed so the partition exists');
  const file = dbFiles.auditPartitionPath(dealId);
  const beforeIds = alertIds(dealId);
  const beforeRows = partitionRows(dealId).length;

  // Another connection (think: a second process mid-append) holds the
  // partition's write lock for longer than the busy budget.
  const blocker = new Database(file);
  blocker.exec('BEGIN IMMEDIATE');
  const blockedId = randId('alert_blocked');
  let err = null;
  try {
    insertAlert(dealId, blockedId, 'must not persist');
  } catch (e) {
    err = e;
  } finally {
    blocker.exec('ROLLBACK');
    blocker.close();
  }
  assert.ok(err, 'the deal write must throw when the partition append is busy');
  assert.match(String(err.code), /^SQLITE_BUSY/);

  assert.deepStrictEqual(alertIds(dealId), beforeIds, 'the deal row is ABSENT from the deal file');
  assert.ok(!alertIds(dealId).includes(blockedId));
  assert.strictEqual(partitionRows(dealId).length, beforeRows, 'the partition has no new row');

  // And an identical retry once the lock is free succeeds exactly once.
  insertAlert(dealId, blockedId, 'now persists');
  assert.ok(alertIds(dealId).includes(blockedId));
  assert.strictEqual(partitionRows(dealId).length, beforeRows + 1);
});

test('partitions (d): flipping one byte inside a stored row is reported by verifyChain and exits the CLI 1', () => {
  const dealId = registerDeal('Part Deal D');
  insertAlert(dealId, randId('alert_pd'), 'first row');
  const marker = 'FLIPMARKER' + crypto.randomBytes(4).toString('hex');
  insertAlert(dealId, randId('alert_pd'), marker);
  insertAlert(dealId, randId('alert_pd'), 'third row');
  const target = partitionRows(dealId).find((r) => r.after_json && r.after_json.includes(marker));
  assert.ok(target);

  // Fold the WAL into the main file, drop every handle, then edit the file bytes.
  auditHook.closePartitionConnection(dealId);
  const file = dbFiles.auditPartitionPath(dealId);
  const cp = new Database(file);
  cp.pragma('wal_checkpoint(TRUNCATE)');
  cp.close();
  const bytes = fs.readFileSync(file);
  const at = bytes.indexOf(Buffer.from(marker));
  assert.ok(at > 0, 'the marker is findable in the main file bytes');
  bytes[at] = bytes[at] === 0x46 ? 0x47 : 0x46; // 'F' -> 'G'
  fs.writeFileSync(file, bytes);

  const conn = dbFiles.openDbFileReadOnly(file);
  try {
    const res = auditChain.verifyChain(conn, dealId);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.badId, target.id);
    assert.strictEqual(res.reason, 'row-hash-mismatch');
    assert.strictEqual(res.problems.length, 1, 'one flipped byte is reported once, not once per later row');
  } finally { conn.close(); }

  const cli = runCli([file]);
  assert.strictEqual(cli.status, 1, cli.stdout + cli.stderr);
  assert.match(cli.stdout, new RegExp(`FAIL .*${dealId}\\.db id=${target.id} row-hash-mismatch`));
});

test('partitions (e): a swapped/renamed file fails at its genesis link; unchained rows are reported once', () => {
  const dealId = registerDeal('Part Deal E');
  insertAlert(dealId, randId('alert_pe'), 'row');
  const src = dbFiles.auditPartitionPath(dealId);
  auditHook.closePartitionConnection(dealId);
  const cp = new Database(src);
  cp.pragma('wal_checkpoint(TRUNCATE)');
  cp.close();
  const swapped = path.join(TMP_DIR, 'audit', 'deal_swappedslot.db');
  fs.copyFileSync(src, swapped);
  const conn = dbFiles.openDbFileReadOnly(swapped);
  try {
    const res = auditChain.verifyChain(conn, 'deal_swappedslot');
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'prev-link-broken');
  } finally { conn.close(); }
  assert.match(runCli([swapped]).stdout, /genesis-mismatch/);

  // PD-30 on a table with nullable hash columns: one raw insert is one problem.
  const mem = new Database(':memory:');
  mem.exec(`CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor_username TEXT, actor_role TEXT,
    session_id TEXT, deal_id TEXT, db_kind TEXT, action TEXT, collection TEXT, row_id TEXT, before_json TEXT, after_json TEXT,
    request_method TEXT, request_path TEXT, ip TEXT, legacy_id INTEGER, prev_hash TEXT, row_hash TEXT)`);
  const mk = (n) => ({ ts: `t${n}`, actor_username: 'u', actor_role: 'r', db_kind: 'deal', action: 'insert', deal_id: 'deal_x' });
  auditChain.appendChained(mem, [mk(1)], { partitionId: 'deal_x' });
  mem.prepare("INSERT INTO audit_log (ts, actor_username, actor_role, db_kind, action) VALUES ('raw','u','r','deal','insert')").run();
  auditChain.appendChained(mem, [mk(2)], { partitionId: 'deal_x' });
  const res = auditChain.verifyChain(mem, 'deal_x');
  mem.close();
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.problems, [{ id: 2, reason: 'unchained-row' }], 'the raw row is reported once and the next chained row still links');
});

test('partitions (f): bad ids throw, demo writes create no partition, control-kind rows stay in audit.db', () => {
  assert.throws(() => dbFiles.auditPartitionPath('../x'), /rejected invalid partition id/);
  assert.throws(() => dbFiles.auditPartitionPath('deal_a/../../b'), /rejected invalid partition id/);
  assert.throws(() => dbFiles.auditPartitionPath(''), /rejected invalid partition id/);
  assert.strictEqual(path.basename(dbFiles.auditPartitionPath('legacy')), 'legacy.db');

  const dirBefore = fs.existsSync(dbFiles.AUDIT_DIR) ? fs.readdirSync(dbFiles.AUDIT_DIR).sort() : [];
  runAsDemo(() => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: randId('alert_demo'), title: 'demo', severity: 'low' }]);
    store.writeDb(db);
  });
  const dirAfter = fs.existsSync(dbFiles.AUDIT_DIR) ? fs.readdirSync(dbFiles.AUDIT_DIR).sort() : [];
  assert.deepStrictEqual(dirAfter, dirBefore, 'a demo-kind write creates no partition');

  const beforeControl = controlCount();
  auditHook.appendWriteAudit({
    actor: { username: 'karen', role: 'hrbp', sessionId: 's' }, dealId: null, dbKind: 'control',
    request: null, ts: new Date().toISOString(), rows: [{ action: 'update', collection: 'users', rowId: 'u1', before: null, after: '{}' }],
  });
  assert.strictEqual(controlCount(), beforeControl + 1, 'a control-kind write still lands in audit.db');
  assert.deepStrictEqual(fs.readdirSync(dbFiles.AUDIT_DIR).sort(), dirBefore, 'and creates no partition');

  assert.throws(
    () => auditHook.appendWriteAudit({ actor: null, dealId: 'deal_x', dbKind: 'deal', request: null, ts: 't', rows: [{ action: 'insert' }] }),
    /no resolved actor/,
    'D-11 actor check is unchanged'
  );
});

test('partitions (g): PD-29 — getPartitionConnection never first-opens audit.db; writeDb pre-opens it outside the deal txn', () => {
  const dealId = registerDeal('Part Deal G');
  auditHook.closeAuditConnection();
  assert.strictEqual(auditHook.isAuditOpen(), false);

  const neverWritten = 'deal_neverwrittenslot';
  assert.throws(
    () => auditHook.getPartitionConnection(neverWritten),
    (e) => e instanceof readiness.DbNotReadyError && e.reason === 'audit-not-open',
    'refuses to be the first opener of audit.db'
  );
  assert.strictEqual(auditHook.isAuditOpen(), false, 'the refusal did not open audit.db');
  assert.ok(!fs.existsSync(dbFiles.auditPartitionPath(neverWritten)), 'and created no partition file');
  assert.strictEqual(readiness.isReady(), true, 'an invariant breach is not recorded as a file failure');

  // A demo-kind write in this state does not open audit.db.
  runAsDemo(() => {
    const db = store.readDb();
    db.alerts = db.alerts.concat([{ id: randId('alert_demog'), title: 'demo', severity: 'low' }]);
    store.writeDb(db);
  });
  assert.strictEqual(auditHook.isAuditOpen(), false, 'demo writes never touch audit.db');

  // A store-level deal write in the same state succeeds: writeDb opened audit.db first.
  const rowId = randId('alert_pg');
  insertAlert(dealId, rowId, 'store pre-opens audit.db');
  assert.strictEqual(auditHook.isAuditOpen(), true);
  const rows = partitionRows(dealId);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].row_id, rowId);
  assert.strictEqual(rows[0].prev_hash, auditChain.genesisHash(dealId));
});
