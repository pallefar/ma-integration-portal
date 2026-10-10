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

// --- Task 2: viewer across partitions, control rows, sealed backstop, modes ----

function plantSeal(dealId) {
  const conn = auditHook.getPartitionConnection(dealId);
  auditChain.appendChained(conn, [{
    ts: new Date().toISOString(), actor_username: 'admin', actor_role: 'admin', deal_id: dealId,
    db_kind: 'deal', action: auditChain.SEAL_ACTION,
  }], { partitionId: dealId });
}

test('partitions (h): the viewer returns a deal\'s partition rows UNION its control rows, each tagged; no partition is created by a probe', () => {
  auditHook.getAuditConnection();
  const dealId = registerDeal('Part Deal H');
  const rowId = randId('alert_ph');
  insertAlert(dealId, rowId, 'viewer row');

  const ghost = 'deal_ghostprobe';
  auditHook.recordSecurityEvent({
    actor: { username: 'prober', role: 'employee' }, action: 'access-denied', dealId: ghost, subject: 'GET /api/x',
  });
  auditHook.recordSecurityEvent({
    actor: { username: 'admin', role: 'admin' }, action: 'access-denied', dealId, subject: 'GET /api/raid',
  });
  assert.ok(!fs.existsSync(dbFiles.auditPartitionPath(ghost)), 'a denial for a never-written deal creates no partition');

  const rows = auditHook.queryAudit({ dealId });
  const partitionRow = rows.find((r) => r.row_id === rowId);
  const controlRow = rows.find((r) => r.action === 'access-denied');
  assert.ok(partitionRow && controlRow);
  assert.strictEqual(partitionRow.partition, dealId);
  assert.strictEqual(controlRow.partition, 'control');
  assert.strictEqual(controlRow.deal_id, dealId);
  assert.ok(rows.every((r) => r.deal_id === dealId), 'the deal filter never leaks another deal\'s rows');

  // The ghost deal's denial is reachable through its own deal filter, from audit.db only.
  const ghostRows = auditHook.queryAudit({ dealId: ghost });
  assert.strictEqual(ghostRows.length, 1);
  assert.strictEqual(ghostRows[0].partition, 'control');

  // Ordering: ts DESC (then id DESC), limit/offset semantics unchanged.
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].ts >= rows[i].ts, 'ts DESC');
  assert.strictEqual(auditHook.queryAudit({ dealId, limit: 1 }).length, 1);
  assert.strictEqual(auditHook.queryAudit({ dealId, limit: 1, offset: 1 }).length, 1);
  assert.strictEqual(auditHook.queryAudit({ dealId, offset: 999999999 }).length, 0, 'an absurd offset is capped, not an error');
  assert.strictEqual(auditHook.queryAudit({ dealId, actor: 'karen' }).every((r) => r.actor_username === 'karen'), true);

  // Without a deal filter, every partition is consulted.
  const all = auditHook.queryAudit({ limit: 500 });
  assert.ok(all.some((r) => r.partition === dealId) && all.some((r) => r.partition === 'control'));
  assert.ok(auditHook.countAudit({}) >= auditHook.countAudit({ dealId }));
});

test('partitions (i): a SEALED partition refuses the deal write (rolled back) and the route answers 409 with the fixed body', async () => {
  const { listenLocal } = require('./helpers/listen-local');
  const { createDealFixture } = require('./helpers/deal-fixture');
  const app = require('../server.js');
  const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
  const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  const dealId = 'deal_sealedhttp';
  const fixture = createDealFixture({ controlConn, runtimeConn, dealId, members: [{ username: 'karen', role: 'hrbp' }] });
  auditHook.getAuditConnection();

  // Store level first: the write throws AuditPartitionSealedError and nothing persists.
  insertAlert(dealId, randId('alert_pre'), 'before the seal');
  plantSeal(dealId);
  const idsBefore = alertIds(dealId);
  const rowsBefore = partitionRows(dealId).length;
  const sealedId = randId('alert_sealed');
  assert.throws(
    () => insertAlert(dealId, sealedId, 'after the seal'),
    (e) => e instanceof auditChain.AuditPartitionSealedError && e instanceof auditHook.AuditPartitionSealedError
  );
  assert.deepStrictEqual(alertIds(dealId), idsBefore, 'the deal write rolled back');
  assert.strictEqual(partitionRows(dealId).length, rowsBefore, 'and the partition gained nothing');
  const conn = dbFiles.openDbFileReadOnly(dbFiles.auditPartitionPath(dealId));
  try {
    assert.strictEqual(auditChain.verifyChain(conn, dealId).sealed, true);
    assert.strictEqual(auditChain.verifyChain(conn, dealId).ok, true);
  } finally { conn.close(); }

  // HTTP level: a member's write on the sealed deal is a 409 with the fixed body.
  const server = await listenLocal(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const res = await fetch(`${base}/api/raid`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: fixture.cookie('karen') },
      body: JSON.stringify({ type: 'risk', title: 'Refused by seal', severity: 'low' }),
    });
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.deepStrictEqual(body, { error: 'This deal is closed: its audit trail is sealed.' });
    assert.ok(!('conflict' in body), 'no conflict marker — the Phase 9 dialog must never open');
    assert.strictEqual(partitionRows(dealId).length, rowsBefore, 'the refused HTTP write left no audit row');
  } finally {
    server.close();
    try { if (app.denialAuditor && app.denialAuditor.stopSweeper) app.denialAuditor.stopSweeper(); } catch (e) { /* ignore */ }
  }
});

test('partitions (j): chmodPrivateFile is tightening-only (0400 stays 0400, 0644 -> 0600)', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'modes-'));
  const sealed = path.join(dir, 'sealed.db');
  const loose = path.join(dir, 'loose.db');
  fs.writeFileSync(sealed, 'x');
  fs.writeFileSync(loose, 'x');
  fs.chmodSync(sealed, 0o400);
  fs.chmodSync(loose, 0o644);
  dbFiles.chmodPrivateFile(sealed);
  dbFiles.chmodPrivateFile(loose);
  assert.strictEqual(fs.statSync(sealed).mode & 0o777, 0o400, 'a sealed 0400 file is never re-opened writable');
  assert.strictEqual(fs.statSync(loose).mode & 0o777, 0o600);
});

test('partitions (k): WR-01 — audit.db and partitions commit with synchronous=FULL (+fullfsync); deal files keep NORMAL', () => {
  const dir = fs.mkdtempSync(path.join(TMP_DIR, 'sync-'));
  const open = (name, schema) => dbFiles.openDbFile(path.join(dir, name), schema);
  const audit = open('a-audit.db', dbFiles.AUDIT_SCHEMA_PATH);
  const part = open('a-part.db', dbFiles.AUDIT_PARTITION_SCHEMA_PATH);
  const deal = open('a-deal.db', dbFiles.DEAL_SCHEMA_PATH);
  try {
    assert.strictEqual(audit.pragma('synchronous', { simple: true }), 2, 'audit.db: FULL');
    assert.strictEqual(part.pragma('synchronous', { simple: true }), 2, 'partition: FULL');
    assert.strictEqual(audit.pragma('fullfsync', { simple: true }), 1);
    assert.strictEqual(part.pragma('fullfsync', { simple: true }), 1);
    assert.strictEqual(deal.pragma('synchronous', { simple: true }), 1, 'deal file: NORMAL (unchanged)');
    // The live partition connection the hook appends through carries it too.
    const dealId = 'deal_sync' + crypto.randomBytes(3).toString('hex');
    assert.strictEqual(auditHook.getAuditConnection().pragma('synchronous', { simple: true }), 2);
    const live = auditHook.getPartitionConnection(dealId);
    assert.strictEqual(live.pragma('synchronous', { simple: true }), 2);
    auditHook.closePartitionConnection(dealId);
  } finally {
    for (const c of [audit, part, deal]) { try { c.close(); } catch (e) { /* ignore */ } }
  }
});
