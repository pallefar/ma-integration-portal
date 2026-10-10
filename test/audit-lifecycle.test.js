// D-12-04 (Phase 12, plan 12-12): the audit-partition LIFECYCLE — seal (this
// task), export / purge (the next one). Proves:
//   - seal is refused for an ACTIVE deal and for a busy WAL (checkpoint-busy,
//     W-3: no seal row, no chmod, no hash, no sealed event, file still
//     writable), and succeeds for an archived deal: 0400 file, chained
//     `partition-seal` last row, one `audit-partition-sealed` control event
//     carrying the file SHA-256 / row count / head hash;
//   - repeating a seal is idempotent (no second seal row, no duplicate event)
//     and a seal row whose event was lost is repaired;
//   - the recorded SHA-256 equals the file recomputed after EVERY connection
//     (this process, a second process) has closed;
//   - scripts/audit-verify.js reports sealed-sha=match and, after one flipped
//     byte, exits 1 with the row-hash mismatch AND sealed-sha=MISMATCH.
//
// Boots the real requireable app against an ISOLATED temp set (MA_* paths); the
// committed data/*.db is never opened. Sealed files are 0400 — every test that
// edits one restores 0600 first and the cleanup tolerates either mode.
//
// node:test — run via `node --test test/audit-lifecycle.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { listenLocal } = require('./helpers/listen-local');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-audit-lifecycle-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'MA_AUDIT_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN', 'MA_AUDIT_RETENTION_DAYS']) delete process.env[key];

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const resolver = require('../db/resolver.js');
const controlStore = require('../db/controlStore.js');
const auditHook = require('../db/auditHook.js');
const auditChain = require('../db/auditChain.js');
const auditLifecycle = require('../db/auditLifecycle.js');
const app = require('../server.js');
const { createDealFixture } = require('./helpers/deal-fixture');
const { sessionAs } = require('./helpers/seed-identity');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
const POSIX = process.platform !== 'win32';

const adminToken = sessionAs(runtimeConn, controlConn, { username: 'lcadmin', role: 'admin' });
let server = null;
let base = '';

test.before(async () => {
  server = await listenLocal(app);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  if (server) server.close();
  try { app.denialAuditor.stopSweeper(); } catch (e) { /* ignore */ }
  try { auditHook.closeAuditConnection(); } catch (e) { /* ignore */ }
  try {
    const dir = dbFiles.AUDIT_DIR;
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      try { fs.chmodSync(path.join(dir, name), 0o600); } catch (e) { /* ignore */ }
    }
  } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// --- fixtures ---------------------------------------------------------------

function newDealId() {
  return 'deal_lc' + crypto.randomBytes(4).toString('hex');
}

/** A real deal (registry row + file) with `writes` audited alert inserts -> a partition. */
function makeDealWithPartition(label, writes) {
  const dealId = newDealId();
  createDealFixture({ controlConn, runtimeConn, dealId, members: [{ username: 'karen', role: 'hrbp' }] });
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'karen', role: 'hrbp', dealId, sessionId: 'sess_karen' } };
  for (let i = 0; i < (writes || 2); i += 1) {
    const resolved = resolver.resolveDatabase(fakeReq);
    const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
    const actor = { username: 'karen', role: 'hrbp', sessionId: 'sess_karen' };
    store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath, actor, request: { method: 'TEST', path: '/whatever', ip: null } }, () => {
      const db = store.readDb();
      db.alerts = db.alerts.concat([{ id: `alert_${label}_${i}`, title: `${label} marker title ${i}`, severity: 'low' }]);
      store.writeDb(db);
    });
  }
  return dealId;
}

function archive(dealId) {
  controlStore.archiveDeal(dealId);
}

async function sealRoute(dealId, body, token) {
  const res = await fetch(`${base}/api/admin/deals/${dealId}/audit/seal`, {
    method: 'POST',
    headers: { Cookie: `ma_session=${token || adminToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body === undefined ? { confirm: dealId } : body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

function partitionFile(dealId) {
  return dbFiles.auditPartitionPath(dealId);
}

function modeOf(file) {
  return fs.statSync(file).mode & 0o777;
}

function partitionRows(dealId) {
  const conn = dbFiles.openDbFileReadOnly(partitionFile(dealId));
  try { return conn.prepare('SELECT * FROM audit_log ORDER BY id').all(); } finally { conn.close(); }
}

function events(dealId, action) {
  return auditHook.findControlEvents({ dealId, action });
}

function verifyCli(args) {
  return spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'audit-verify.js'), ...args], {
    env: { ...process.env }, encoding: 'utf8',
  });
}

// better-sqlite3 resolved from this repo for the child scripts below.
const SQLITE_PATH = require.resolve('better-sqlite3');

/** Spawn a child that opens `file` read-only and HOLDS a read transaction until stdin closes. */
function startReaderHolder(file) {
  const script = `
    const Database = require(${JSON.stringify(SQLITE_PATH)});
    const db = new Database(${JSON.stringify(file)}, { readonly: true, fileMustExist: true });
    db.prepare('BEGIN').run();
    db.prepare('SELECT COUNT(*) AS n FROM audit_log').get();
    process.stdout.write('ready\\n');
    process.stdin.resume();
    process.stdin.on('end', () => { try { db.prepare('COMMIT').run(); db.close(); } catch (e) {} process.exit(0); });
  `;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['pipe', 'pipe', 'inherit'] });
  const ready = new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; if (buf.includes('ready')) resolve(); });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('reader child exited before it was ready')));
  });
  const done = new Promise((resolve) => child.once('exit', resolve));
  return { ready, release: () => { child.stdin.end(); return done; } };
}

// --- tests ------------------------------------------------------------------

test('lifecycle (a): an ACTIVE deal is refused 409 deal-active, recorded, and nothing is sealed', async () => {
  const dealId = makeDealWithPartition('a', 2);
  const before = partitionRows(dealId).length;
  const res = await sealRoute(dealId);
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.error, 'This deal must be archived before its audit trail can be sealed.');
  assert.strictEqual(res.json.reason, 'deal-active');
  assert.strictEqual(partitionRows(dealId).length, before, 'no seal row appended');
  if (POSIX) assert.strictEqual(modeOf(partitionFile(dealId)), 0o600, 'file still 0600');
  const refused = events(dealId, 'audit-partition-seal-refused');
  assert.strictEqual(refused.length, 1);
  assert.strictEqual(refused[0].after.reason, 'deal-active');
  assert.strictEqual(events(dealId, 'audit-partition-sealed').length, 0);
});

test('lifecycle (b): confirm mismatch is a 400 that changes nothing; non-admin is 403', async () => {
  const dealId = makeDealWithPartition('b', 1);
  archive(dealId);
  const bad = await sealRoute(dealId, { confirm: 'deal_wrong' });
  assert.strictEqual(bad.status, 400);
  const missing = await sealRoute(dealId, {});
  assert.strictEqual(missing.status, 400);
  const hrbp = sessionAs(runtimeConn, controlConn, { username: 'lchrbp', role: 'hrbp' });
  const denied = await sealRoute(dealId, { confirm: dealId }, hrbp);
  assert.strictEqual(denied.status, 403);
  assert.strictEqual(events(dealId, 'audit-partition-sealed').length, 0);
  assert.notStrictEqual(partitionRows(dealId).at(-1).action, 'partition-seal');
});

test('lifecycle (c): sealing an archived deal makes the file read-only and records ONE sha256 control event; re-seal is idempotent', async () => {
  const dealId = makeDealWithPartition('c', 3);
  const rowsBefore = partitionRows(dealId).length;
  archive(dealId);

  const res = await sealRoute(dealId);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.match(res.json.sha256, /^[0-9a-f]{64}$/);
  assert.strictEqual(res.json.rows, rowsBefore + 1, 'the chained seal row is counted');
  assert.strictEqual(res.json.alreadySealed, false);

  const file = partitionFile(dealId);
  if (POSIX) assert.strictEqual(modeOf(file), 0o400, 'sealed file is 0400');
  const rows = partitionRows(dealId);
  const last = rows.at(-1);
  assert.strictEqual(last.action, 'partition-seal');
  assert.strictEqual(last.row_hash, res.json.headHash);
  assert.strictEqual(last.prev_hash, rows.at(-2).row_hash, 'seal row is chained to the previous head');
  assert.strictEqual(res.json.sha256, auditLifecycle.fileSha256(file));

  const sealed = events(dealId, 'audit-partition-sealed');
  assert.strictEqual(sealed.length, 1);
  assert.deepStrictEqual(sealed[0].after, { sha256: res.json.sha256, rows: res.json.rows, headHash: res.json.headHash });
  assert.strictEqual(sealed[0].actor_username, 'lcadmin');

  // idempotent re-seal
  const again = await sealRoute(dealId);
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.json.alreadySealed, true);
  assert.strictEqual(again.json.sha256, res.json.sha256);
  assert.strictEqual(partitionRows(dealId).length, rows.length, 'no second seal row');
  assert.strictEqual(events(dealId, 'audit-partition-sealed').length, 1, 'no duplicate event');
});

test('lifecycle (d): the sealed file is readable (viewer, verify) and refuses any further append', async () => {
  const dealId = makeDealWithPartition('d', 2);
  archive(dealId);
  const res = await sealRoute(dealId);
  assert.strictEqual(res.status, 200);
  const file = partitionFile(dealId);
  const shaBefore = auditLifecycle.fileSha256(file);

  // viewer reads the 0400 file
  const viewed = auditHook.queryAudit({ dealId, limit: 50 });
  assert.ok(viewed.some((r) => r.partition === dealId && r.action === 'partition-seal'));
  const cli = verifyCli(['--deal', dealId]);
  assert.strictEqual(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /sealed=yes sealed-sha=match/);

  // A write straight through the store (the resolver itself already refuses an
  // archived deal, so this goes below it) is refused and persists nothing.
  const dealPath = dbFiles.dealDbPath(dealId);
  const dealConn = store.getOrOpenConnection(dealPath, dbFiles.DEAL_SCHEMA_PATH);
  let thrown = null;
  try {
    store.runWithDb({
      conn: dealConn, kind: 'deal', dealId, dbPath: dealPath,
      actor: { username: 'karen', role: 'hrbp', sessionId: 's' }, request: { method: 'TEST', path: '/x', ip: null },
    }, () => {
      const db = store.readDb();
      db.alerts = db.alerts.concat([{ id: 'alert_after_seal', title: 'after seal', severity: 'low' }]);
      store.writeDb(db);
    });
  } catch (e) {
    thrown = e;
  }
  assert.ok(thrown, 'a deal write after the seal must throw');
  assert.ok(
    thrown instanceof auditChain.AuditPartitionSealedError || /readonly|SQLITE_READONLY|SQLITE_CANTOPEN|sealed/i.test(`${thrown.code} ${thrown.message}`),
    `refused for the right reason, got: ${thrown.code} ${thrown.message}`
  );
  const ids = store.runWithDb({ conn: dealConn, kind: 'deal', dealId, dbPath: dealPath, actor: { username: 'karen', role: 'hrbp', sessionId: 's' }, request: { method: 'TEST', path: '/x', ip: null } },
    () => store.readDb().alerts.map((a) => a.id));
  assert.ok(!ids.includes('alert_after_seal'), 'nothing persisted in the deal file either');
  auditHook.closePartitionConnection(dealId);
  assert.strictEqual(auditLifecycle.fileSha256(file), shaBefore, 'the refused write left the sealed bytes untouched');
});

test('lifecycle (e): crash repair — a seal row whose control event was lost is completed by a repeated seal', async () => {
  const dealId = makeDealWithPartition('e', 2);
  archive(dealId);
  // Simulate the crash window: the file seal happened, the event never did.
  auditHook.closePartitionConnection(dealId);
  const direct = auditLifecycle.sealPartitionFile(dealId, { actor: { username: 'lcadmin', role: 'admin' } });
  assert.strictEqual(events(dealId, 'audit-partition-sealed').length, 0);
  assert.strictEqual(direct.alreadySealed, false);
  const seals = partitionRows(dealId).filter((r) => r.action === 'partition-seal').length;
  assert.strictEqual(seals, 1);

  const res = await sealRoute(dealId);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.alreadySealed, true, 'a seal row already existed');
  assert.strictEqual(res.json.sha256, direct.sha256);
  const sealed = events(dealId, 'audit-partition-sealed');
  assert.strictEqual(sealed.length, 1, 'the missing event was recorded');
  assert.strictEqual(sealed[0].after.sha256, direct.sha256);
  assert.strictEqual(partitionRows(dealId).filter((r) => r.action === 'partition-seal').length, 1, 'still one seal row');
});

test('lifecycle (f): a flipped byte in a sealed partition fails verify (chain AND sealed-sha), exit 1', async () => {
  const dealId = makeDealWithPartition('f', 3);
  archive(dealId);
  const res = await sealRoute(dealId);
  assert.strictEqual(res.status, 200);
  const file = partitionFile(dealId);

  const ok = verifyCli(['--deal', dealId]);
  assert.strictEqual(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /sealed=yes sealed-sha=match/);

  // flip one byte of a stored row's title (sealed files are 0400: restore, edit, re-seal the mode)
  fs.chmodSync(file, 0o600);
  const buf = fs.readFileSync(file);
  const at = buf.indexOf(Buffer.from('f marker title 1'));
  assert.ok(at > 0, 'marker found in the main file');
  buf[at] = buf[at] ^ 0x01;
  fs.writeFileSync(file, buf);
  fs.chmodSync(file, 0o400);

  const bad = verifyCli(['--deal', dealId]);
  assert.strictEqual(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /row-hash-mismatch/);
  assert.match(bad.stdout, /sealed-sha=MISMATCH/);

  // A re-seal must not launder the modified bytes into a fresh matching event.
  const relaunder = await sealRoute(dealId);
  assert.strictEqual(relaunder.status, 409);
  assert.strictEqual(relaunder.json.reason, 'modified-after-seal');
  assert.strictEqual(events(dealId, 'audit-partition-sealed').length, 1, 'still the one original seal event');
  assert.strictEqual(events(dealId, 'audit-partition-tamper-detected').length, 1);
});

test('lifecycle (g, W-3): a second process holding a read snapshot refuses the seal checkpoint-busy with NOTHING changed; the seal succeeds once it lets go', async () => {
  const dealId = makeDealWithPartition('g', 3);
  archive(dealId);
  const file = partitionFile(dealId);
  const rowsBefore = partitionRows(dealId).length;
  const modeBefore = modeOf(file);

  const holder = startReaderHolder(file);
  await holder.ready;
  let busy;
  try {
    busy = await sealRoute(dealId);
  } finally {
    // keep the holder alive for the assertions below that must hold WHILE it reads
  }
  assert.strictEqual(busy.status, 409);
  assert.strictEqual(busy.json.reason, 'checkpoint-busy');
  assert.strictEqual(busy.json.error, 'The audit trail is in use; try sealing again in a moment.');
  assert.strictEqual(modeOf(file), modeBefore, 'file mode unchanged — still writable');
  assert.strictEqual(partitionRows(dealId).length, rowsBefore, 'NO seal row was appended');
  assert.strictEqual(events(dealId, 'audit-partition-sealed').length, 0, 'no sealed event / hash recorded');
  const refused = events(dealId, 'audit-partition-seal-refused');
  assert.strictEqual(refused.length, 1);
  assert.strictEqual(refused[0].after.reason, 'checkpoint-busy');

  await holder.release();
  const ok = await sealRoute(dealId);
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
  assert.strictEqual(events(dealId, 'audit-partition-sealed').length, 1);
});

test('lifecycle (h, W-3): the recorded sha256 equals the file recomputed after EVERY connection (this process and a second one) has closed', async () => {
  const dealId = makeDealWithPartition('h', 4);
  archive(dealId);
  const res = await sealRoute(dealId);
  assert.strictEqual(res.status, 200);
  const file = partitionFile(dealId);
  const recorded = events(dealId, 'audit-partition-sealed')[0].after.sha256;

  // in-process: viewer + status open it read-only and close
  auditHook.queryAudit({ dealId, limit: 10 });
  auditLifecycle.partitionStatus(dealId, {});
  assert.strictEqual(auditLifecycle.fileSha256(file), recorded, 'unchanged after in-process readers closed');

  // second process: open read-only, read, close
  const child = spawnSync(process.execPath, ['-e', `
    const Database = require(${JSON.stringify(SQLITE_PATH)});
    const db = new Database(${JSON.stringify(file)}, { readonly: true, fileMustExist: true });
    console.log(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n);
    db.close();
  `], { encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr);
  assert.strictEqual(Number(child.stdout.trim()), res.json.rows);
  assert.strictEqual(auditLifecycle.fileSha256(file), recorded, 'unchanged after a second process closed');
});

test('lifecycle (i, W-3): a checkpoint that goes busy AFTER the seal row refuses WITHOUT chmod/hash; the committed seal row already blocks appends; a repeated seal completes it', () => {
  const dealId = makeDealWithPartition('i', 2);
  archive(dealId);
  auditHook.closePartitionConnection(dealId);
  const file = partitionFile(dealId);
  const rowsBefore = partitionRows(dealId).length;

  const started = Date.now();
  assert.throws(
    () => auditLifecycle.sealPartitionFile(dealId, {
      actor: { username: 'lcadmin', role: 'admin' },
      checkpoint: (conn, phase) => phase === 'pre',
    }),
    (e) => e instanceof auditLifecycle.AuditSealRefusedError && e.reason === 'checkpoint-busy'
  );
  assert.ok(Date.now() - started >= 3 * auditLifecycle.CHECKPOINT_RETRY_MS - 50, 'retried 3 x 250 ms before refusing');

  if (POSIX) assert.strictEqual(modeOf(file), 0o600, 'no chmod on the refusal');
  const rows = partitionRows(dealId);
  assert.strictEqual(rows.length, rowsBefore + 1, 'the seal row IS committed');
  assert.strictEqual(rows.at(-1).action, 'partition-seal');

  // the cross-process backstop: appends are refused although the file is still writable
  const conn = dbFiles.openDbFile(file, dbFiles.AUDIT_PARTITION_SCHEMA_PATH);
  try {
    assert.throws(
      () => auditChain.appendChained(conn, [{ ts: new Date().toISOString(), actor_username: 'x', actor_role: 'x', db_kind: 'deal', action: 'insert' }], { partitionId: dealId }),
      (e) => e instanceof auditChain.AuditPartitionSealedError
    );
  } finally {
    conn.close();
  }

  const done = auditLifecycle.sealPartitionFile(dealId, { actor: { username: 'lcadmin', role: 'admin' } });
  assert.strictEqual(done.alreadySealed, true);
  if (POSIX) assert.strictEqual(modeOf(file), 0o400);
  assert.strictEqual(partitionRows(dealId).length, rowsBefore + 1, 'still exactly one seal row');
  assert.strictEqual(done.sha256, auditLifecycle.fileSha256(file));
});

test('lifecycle (j): sealing a deal with no partition file is refused no-partition', async () => {
  const dealId = newDealId();
  createDealFixture({ controlConn, runtimeConn, dealId, members: [{ username: 'karen', role: 'hrbp' }] });
  archive(dealId);
  const res = await sealRoute(dealId);
  assert.strictEqual(res.status, 409);
  assert.strictEqual(res.json.reason, 'no-partition');
  assert.strictEqual(fs.existsSync(partitionFile(dealId)), false, 'a probe never creates a partition');
});
