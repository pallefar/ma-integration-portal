'use strict';
// D-12-03 / D-12-04 (Phase 12, plan 12-13): migration #1 of the audit family.
//
// A seeded version-0, unchained audit.db (the verbatim pre-Phase-12 schema,
// test/fixtures/legacy-audit-v0.sql) is migrated AT BOOT — the first probe is
// issued after listen(), so everything observed was done before any request:
//   - deal data rows of a deal that still exists move into data/audit/<id>.db,
//     rows of a deleted deal into a SEALED (0400, SHA-256 event) `legacy.db`;
//   - audit.db keeps only control-plane rows (original ids), hash-chained,
//     append-only triggers intact, user_version 1, backup `.pre-v1.bak` (0600);
//   - a crash after the partition imports and before the audit.db commit is
//     not-ready on /healthz, and the rerun neither duplicates a row nor ever
//     opens the sealed legacy partition writable (checker W-4);
//   - a hashless raw-inserted row is reported `unchained-row` and the next
//     chained append links to the last hashed row (checker I-2).

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');

const { bootProbe, isolatedPaths, REPO, seedV0File, cleanEnv } = require('./helpers/boot-probe');
const dbFiles = require('../db/dbFiles');
const migrate = require('../db/migrate');
const sessions = require('../db/sessions');
const auditChain = require('../db/auditChain');

const FIXTURE_SCHEMA = path.join(__dirname, 'fixtures', 'legacy-audit-v0.sql');
const DEAL_A = 'deal_mgrate0a1';
const DEAL_B = 'deal_mgrate0b2'; // deleted before the upgrade: not in control.db

const dirs = [];
function tmp(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `gsd-12-13-${label}-`));
  dirs.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of dirs) {
    try {
      for (const f of fs.readdirSync(path.join(d, 'audit'))) { try { fs.chmodSync(path.join(d, 'audit', f), 0o600); } catch (e) { /* ignore */ } }
    } catch (e) { /* no audit dir */ }
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
});

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function ro(file) { return new Database(file, { readonly: true }); }
function userVersion(file) {
  const c = ro(file);
  try { return c.pragma('user_version', { simple: true }); } finally { c.close(); }
}
function mode(file) { return fs.statSync(file).mode & 0o777; }

// 12 rows, ids interleaved: 5 for A, 3 for B (deleted deal), 4 control rows.
const LEGACY_ROWS = [
  ['2026-01-01T10:00:00.000Z', 'admin', 'admin', 's1', DEAL_A, 'control', 'deal-create', null, DEAL_A, null, '{"name":"Alpha"}', 'POST', '/api/admin/deals', '10.0.0.1'],
  ['2026-01-01T10:01:00.000Z', 'karen', 'hrbp', 's2', DEAL_A, 'deal', 'insert', 'raid', 'r1', null, '{"id":"r1","title":"A1"}', 'POST', '/api/raid', '10.0.0.2'],
  ['2026-01-01T10:02:00.000Z', 'karen', 'hrbp', 's2', DEAL_A, 'deal', 'update', 'raid', 'r1', '{"id":"r1","title":"A1"}', '{"id":"r1","title":"A1b"}', 'PUT', '/api/raid/r1', '10.0.0.2'],
  ['2026-01-01T10:03:00.000Z', 'bob', 'hrbp', 's3', DEAL_B, 'deal', 'insert', 'tasks', 't1', null, '{"id":"t1","title":"B1"}', 'POST', '/api/tasks', '10.0.0.3'],
  ['2026-01-01T10:04:00.000Z', 'mallory', 'employee', 's4', DEAL_A, 'control', 'access-denied', null, DEAL_A, null, '{"path":"/api/dd"}', 'GET', '/api/dd', '10.0.0.4'],
  ['2026-01-01T10:05:00.000Z', 'karen', 'hrbp', 's2', DEAL_A, 'deal', 'insert', 'raid', 'r2', null, '{"id":"r2","title":"A3"}', 'POST', '/api/raid', '10.0.0.2'],
  ['2026-01-01T10:06:00.000Z', 'bob', 'hrbp', 's3', DEAL_B, 'deal', 'update', 'tasks', 't1', '{"id":"t1"}', '{"id":"t1","done":true}', 'PUT', '/api/tasks/t1', '10.0.0.3'],
  ['2026-01-01T10:07:00.000Z', 'admin', 'admin', 's1', null, 'control', 'password-change', null, 'karen', null, null, 'POST', '/api/admin/users/karen/password', '10.0.0.1'],
  ['2026-01-01T10:08:00.000Z', 'karen', 'hrbp', 's2', DEAL_A, 'deal', 'delete', 'raid', 'r2', '{"id":"r2","title":"A3"}', null, 'DELETE', '/api/raid/r2', '10.0.0.2'],
  ['2026-01-01T10:09:00.000Z', 'bob', 'hrbp', 's3', DEAL_B, 'deal', 'delete', 'tasks', 't1', '{"id":"t1","done":true}', null, 'DELETE', '/api/tasks/t1', '10.0.0.3'],
  ['2026-01-01T10:10:00.000Z', 'karen', 'hrbp', 's2', DEAL_A, 'deal', 'insert', 'decisions', 'd1', null, '{"id":"d1"}', 'POST', '/api/decisions', '10.0.0.2'],
  ['2026-01-01T10:11:00.000Z', 'admin', 'admin', null, null, 'control', 'admin-token-use', null, null, null, '{"route":"/api/x"}', 'GET', '/api/x', '10.0.0.1'],
];

/** Build a legacy tree in `dir`: v0 audit.db + a control.db copy that registers deal A only. */
function buildLegacyTree(dir) {
  const paths = isolatedPaths(dir);
  fs.mkdirSync(dir, { recursive: true });
  // A copy of the committed control.db (accounts incl. `admin`) — the TEMP copy
  // is written, never the committed file.
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), paths.MA_CONTROL_DB_PATH);
  const c = new Database(paths.MA_CONTROL_DB_PATH);
  c.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, ?, ?, ?, ?)')
    .run(DEAL_A, null, 1, 'active', JSON.stringify({ id: DEAL_A, name: 'Alpha', status: 'active', members: ['admin'] }));
  c.pragma('wal_checkpoint(TRUNCATE)');
  c.close();
  seedV0File(paths.MA_AUDIT_DB_PATH, FIXTURE_SCHEMA, (a) => {
    const ins = a.prepare(`INSERT INTO audit_log
      (ts, actor_username, actor_role, session_id, deal_id, db_kind, action, collection, row_id, before_json, after_json, request_method, request_path, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of LEGACY_ROWS) ins.run(...r);
  });
  return paths;
}

function adminCookie(paths) {
  const rt = dbFiles.openDbFile(paths.MA_RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  const token = sessions.createSession(rt, { username: 'admin', role: 'admin', ttlMs: 3600e3 });
  rt.close();
  return `ma_session=${token}`;
}

function auditRows(file) {
  const c = ro(file);
  try { return c.prepare('SELECT * FROM audit_log ORDER BY id').all(); } finally { c.close(); }
}

// --- tracer: the whole migration at boot --------------------------------------

test('a legacy audit.db migrates at boot: partitions, sealed legacy, chained control log, backup, viewer join', async () => {
  const dir = tmp('main');
  const paths = buildLegacyTree(dir);
  const cookie = adminCookie(paths);
  assert.strictEqual(userVersion(paths.MA_AUDIT_DB_PATH), 0, 'precondition: a version-0 file');
  const auditDir = path.join(dir, 'audit');
  assert.strictEqual(fs.existsSync(auditDir), false, 'precondition: no partitions yet');

  const r = await bootProbe({
    dir,
    probes: [
      { path: '/healthz' }, // first and with no request before it
      { path: `/api/admin/audit?deal=${DEAL_A}&limit=100`, headers: { cookie } },
      { path: `/api/admin/audit?deal=${DEAL_B}&limit=100`, headers: { cookie } },
    ],
  });
  assert.strictEqual(r.exitCode, 0, r.stderr);
  const [health, viewA, viewB] = r.results;
  assert.strictEqual(health.status, 200, JSON.stringify(health.body));
  assert.strictEqual(health.body.readiness.versions.audit.version, 1);

  // --- audit.db: control rows only, same ids + content, chained -------------
  const file = paths.MA_AUDIT_DB_PATH;
  assert.strictEqual(userVersion(file), 1);
  assert.strictEqual(userVersion(`${file}.pre-v1.bak`), 0);
  const control = auditRows(file);
  const expectedControl = LEGACY_ROWS
    .map((row, i) => ({ id: i + 1, row }))
    .filter(({ row }) => !(row[5] === 'deal' && row[4] !== null));
  assert.deepStrictEqual(expectedControl.map((e) => e.id), [1, 5, 8, 12]);
  for (const { id, row } of expectedControl) {
    const got = control.find((c) => c.id === id);
    assert.ok(got, `control row ${id} kept with its original id`);
    assert.deepStrictEqual(
      [got.ts, got.actor_username, got.actor_role, got.session_id, got.deal_id, got.db_kind, got.action, got.collection,
        got.row_id, got.before_json, got.after_json, got.request_method, got.request_path, got.ip],
      row, `control row ${id} content preserved`
    );
  }
  assert.strictEqual(control.length, 4 + 2, '4 control rows + audit-migrated + the legacy seal event');
  const migrated = control.find((c) => c.action === 'audit-migrated');
  assert.ok(migrated && migrated.id > 12, 'the migration event continues the id sequence');
  assert.strictEqual(migrated.actor_username, 'system:migration');
  const migratedAfter = JSON.parse(migrated.after_json);
  assert.strictEqual(migratedAfter.sourceRows, 12);
  assert.strictEqual(migratedAfter.controlRows, 4);
  assert.strictEqual(migratedAfter.movedRows, 8);
  assert.strictEqual(migratedAfter.legacyRows, 3);
  assert.deepStrictEqual(migratedAfter.perPartition, { [DEAL_A]: 5 });
  const sealedEvent = control.find((c) => c.action === 'audit-partition-sealed');
  assert.ok(sealedEvent, 'legacy seal event recorded in audit.db');
  assert.strictEqual(sealedEvent.deal_id, 'legacy');
  assert.strictEqual(sealedEvent.actor_username, 'system:migration');

  const conn = ro(file);
  const verdict = auditChain.verifyChain(conn, 'control');
  conn.close();
  assert.strictEqual(verdict.ok, true, JSON.stringify(verdict.problems));
  assert.strictEqual(verdict.rows, 6);

  // append-only triggers survived the table swap.
  const rw = new Database(file);
  try {
    assert.throws(() => rw.prepare("UPDATE audit_log SET action = 'x' WHERE id = 1").run(), /append-only/);
    assert.throws(() => rw.prepare('DELETE FROM audit_log WHERE id = 1').run(), /append-only/);
    rw.pragma('wal_checkpoint(TRUNCATE)');
  } finally { rw.close(); }

  // --- partition A -------------------------------------------------------------
  const aRows = auditRows(path.join(auditDir, `${DEAL_A}.db`));
  const aSource = LEGACY_ROWS.map((row, i) => ({ id: i + 1, row })).filter(({ row }) => row[5] === 'deal' && row[4] === DEAL_A);
  assert.deepStrictEqual(aRows.map((x) => x.legacy_id), aSource.map((s) => s.id));
  assert.strictEqual(aRows.length, 5);
  aRows.forEach((got, i) => {
    assert.deepStrictEqual(
      [got.ts, got.actor_username, got.actor_role, got.session_id, got.deal_id, got.db_kind, got.action, got.collection,
        got.row_id, got.before_json, got.after_json, got.request_method, got.request_path, got.ip],
      aSource[i].row
    );
  });
  const aConn = ro(path.join(auditDir, `${DEAL_A}.db`));
  assert.strictEqual(auditChain.verifyChain(aConn, DEAL_A).ok, true);
  aConn.close();
  assert.strictEqual(mode(path.join(auditDir, `${DEAL_A}.db`)), 0o600, 'a live partition stays writable');

  // --- legacy.db: B's 3 rows + a seal row, 0400, hash == the event ------------
  const legacyFile = path.join(auditDir, 'legacy.db');
  const legacyRows = auditRows(legacyFile);
  assert.strictEqual(legacyRows.length, 4);
  assert.deepStrictEqual(legacyRows.slice(0, 3).map((x) => x.legacy_id), [4, 7, 10]);
  assert.ok(legacyRows.slice(0, 3).every((x) => x.deal_id === DEAL_B));
  assert.strictEqual(legacyRows[3].action, 'partition-seal');
  assert.strictEqual(mode(legacyFile), 0o400, 'legacy partition is sealed read-only');
  assert.strictEqual(sha256(legacyFile), JSON.parse(sealedEvent.after_json).sha256);
  const lConn = ro(legacyFile);
  assert.strictEqual(auditChain.verifyChain(lConn, 'legacy').ok, true);
  lConn.close();

  // --- backup -------------------------------------------------------------------
  assert.strictEqual(mode(`${file}.pre-v1.bak`), 0o600);
  assert.strictEqual(auditRows(`${file}.pre-v1.bak`).length, 12);

  // --- viewer join ----------------------------------------------------------------
  assert.strictEqual(viewA.status, 200, JSON.stringify(viewA.body));
  const aView = viewA.body;
  assert.strictEqual(aView.filter((x) => x.partition === DEAL_A).length, 5, 'A: its 5 partition rows');
  assert.strictEqual(aView.filter((x) => x.partition === 'control').length, 2, 'A: deal-create + access-denied');
  assert.strictEqual(aView.length, 7);
  assert.strictEqual(viewB.status, 200, JSON.stringify(viewB.body));
  assert.strictEqual(viewB.body.length, 3, 'B: its 3 legacy rows');
  assert.ok(viewB.body.every((x) => x.partition === 'legacy' && x.deal_id === DEAL_B));
});

test('B-1: a booted child that receives NO request already has audit.db at version 1 and the backup present', async () => {
  const dir = tmp('b1');
  const paths = buildLegacyTree(dir);
  const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] }); // /healthz only
  assert.strictEqual(r.exitCode, 0, r.stderr);
  assert.strictEqual(r.results[0].status, 200);
  assert.strictEqual(userVersion(paths.MA_AUDIT_DB_PATH), migrate.latestVersion('audit'));
  assert.strictEqual(migrate.latestVersion('audit'), 1);
  assert.ok(fs.existsSync(`${paths.MA_AUDIT_DB_PATH}.pre-v1.bak`), 'backup taken at boot');
});

test('with no control.db at all every deal row goes to the sealed legacy partition', async () => {
  const dir = tmp('nocontrol');
  const paths = buildLegacyTree(dir);
  fs.rmSync(paths.MA_CONTROL_DB_PATH);
  const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
  assert.strictEqual(r.exitCode, 0, r.stderr);
  // The boot creates a fresh control.db from its schema (no deals): both deals are "deleted".
  const listing = fs.readdirSync(path.join(dir, 'audit')).sort();
  assert.deepStrictEqual(listing.filter((n) => n.endsWith('.db')), ['legacy.db']);
  assert.strictEqual(auditRows(path.join(dir, 'audit', 'legacy.db')).length, 8 + 1, '8 deal rows + the seal row');
});

// --- crash + rerun (T-12-120, T-12-128) -----------------------------------------

test('crash before the audit.db rebuild: not-ready, nothing changed; rerun completes idempotently and never writes the sealed legacy file (W-4)', async () => {
  const dir = tmp('crash');
  const paths = buildLegacyTree(dir);
  const file = paths.MA_AUDIT_DB_PATH;
  const auditDir = path.join(dir, 'audit');

  const first = await bootProbe({ dir, env: { MA_TEST_AUDIT_MIGRATION_FAIL_AT: 'rebuild' }, probes: [{ path: '/healthz' }] });
  assert.strictEqual(first.exitCode, 0, `the process keeps listening: ${first.stderr}`);
  assert.strictEqual(first.results[0].status, 503);
  assert.strictEqual(first.results[0].body.status, 'not-ready');
  assert.deepStrictEqual(first.results[0].body.readiness.failures[0], {
    family: 'audit', file: 'audit.db', migration: '001-partition-legacy', reason: 'migration-failed',
  });
  assert.ok(!JSON.stringify(first.results[0].body).includes(dir), 'no path in the unauthenticated payload');
  assert.strictEqual(userVersion(file), 0, 'audit.db untouched (still version 0)');
  assert.strictEqual(auditRows(file).length, 12, 'audit.db still holds its 12 original rows');
  assert.strictEqual(auditRows(path.join(auditDir, `${DEAL_A}.db`)).length, 5, 'partition A already imported');
  const legacyFile = path.join(auditDir, 'legacy.db');
  assert.strictEqual(auditRows(legacyFile).length, 4, 'legacy imported + sealed');
  assert.strictEqual(mode(legacyFile), 0o400);
  const legacyShaBefore = sha256(legacyFile);
  const legacyMtimeBefore = fs.statSync(legacyFile).mtimeMs;
  assert.ok(fs.existsSync(`${file}.pre-v1.bak`));

  const second = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
  assert.strictEqual(second.exitCode, 0, second.stderr);
  assert.strictEqual(second.results[0].status, 200, JSON.stringify(second.results[0].body));
  assert.strictEqual(userVersion(file), 1);
  assert.strictEqual(mode(`${file}.pre-v1.bak`), 0o600, 'the stale backup was replaced, still 0600');
  assert.strictEqual(userVersion(`${file}.pre-v1.bak`), 0);

  // no duplicates, nothing lost
  const aRows = auditRows(path.join(auditDir, `${DEAL_A}.db`));
  assert.strictEqual(aRows.length, 5, 'partition A still exactly 5 rows');
  assert.deepStrictEqual(aRows.map((x) => x.legacy_id), [2, 3, 6, 9, 11], 'A deal rows (legacy ids)');
  const lRows = auditRows(legacyFile);
  assert.strictEqual(lRows.length, 4, 'legacy still 3 rows + 1 seal row');
  assert.strictEqual(lRows.filter((x) => x.action === 'partition-seal').length, 1);
  const control = auditRows(file);
  assert.strictEqual(control.filter((x) => x.action === 'audit-partition-sealed').length, 1, 'exactly one sealed event');
  assert.strictEqual(control.filter((x) => x.action === 'audit-migrated').length, 1);

  // W-4: the rerun only read the sealed file.
  assert.strictEqual(mode(legacyFile), 0o400);
  assert.strictEqual(sha256(legacyFile), legacyShaBefore, 'legacy.db byte-identical across the rerun');
  assert.strictEqual(fs.statSync(legacyFile).mtimeMs, legacyMtimeBefore, 'legacy.db never written');
  const sealed = JSON.parse(control.find((x) => x.action === 'audit-partition-sealed').after_json);
  assert.strictEqual(sealed.sha256, legacyShaBefore, 'the event records the file the first attempt sealed');

  const c = ro(file);
  assert.strictEqual(auditChain.verifyChain(c, 'control').ok, true);
  c.close();
});

test('a sealed partition that still has rows to import is not-ready, never written (W-4)', async () => {
  const dir = tmp('sealedinc');
  const paths = buildLegacyTree(dir);
  // Run the migration once against a COPY of the rows minus the last B row, seal legacy by
  // hand, then add the missing row back to a v0 audit.db and boot: legacy is sealed yet incomplete.
  const first = await bootProbe({ dir, env: { MA_TEST_AUDIT_MIGRATION_FAIL_AT: 'rebuild' }, probes: [{ path: '/healthz' }] });
  assert.strictEqual(first.results[0].status, 503);
  const legacyFile = path.join(dir, 'audit', 'legacy.db');
  const shaBefore = sha256(legacyFile);
  // A new, higher-id deal-B row appears in the still-v0 audit.db (e.g. an older release wrote it).
  const a = new Database(paths.MA_AUDIT_DB_PATH);
  a.prepare(`INSERT INTO audit_log (ts, actor_username, actor_role, deal_id, db_kind, action, collection, row_id, after_json)
    VALUES ('2026-01-02T00:00:00.000Z', 'bob', 'hrbp', ?, 'deal', 'insert', 'tasks', 't9', '{}')`).run(DEAL_B);
  a.pragma('wal_checkpoint(TRUNCATE)');
  a.close();

  const second = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
  assert.strictEqual(second.results[0].status, 503);
  assert.strictEqual(second.results[0].body.readiness.failures[0].reason, 'migration-failed');
  assert.strictEqual(userVersion(paths.MA_AUDIT_DB_PATH), 0);
  assert.strictEqual(sha256(legacyFile), shaBefore, 'the sealed file was not touched');
  assert.strictEqual(mode(legacyFile), 0o400);
});

// --- I-2: a hashless row in audit.db ---------------------------------------------

test('I-2: a raw hashless row is reported unchained-row; the next chained append links to the last hashed row', async () => {
  const dir = tmp('i2');
  const paths = buildLegacyTree(dir);
  const boot = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
  assert.strictEqual(boot.results[0].status, 200, boot.stderr);

  // The db-file-layout pattern: a raw INSERT with no hash columns (nullable by PD-25).
  const raw = new Database(paths.MA_AUDIT_DB_PATH);
  raw.prepare(`INSERT INTO audit_log (ts, actor_username, actor_role, db_kind, action)
    VALUES ('2026-02-01T00:00:00.000Z', 'rollback-release', 'admin', 'control', 'raw-insert')`).run();
  const rawId = raw.prepare('SELECT MAX(id) AS id FROM audit_log').get().id;
  const lastHashed = raw.prepare('SELECT row_hash FROM audit_log WHERE row_hash IS NOT NULL ORDER BY id DESC LIMIT 1').get().row_hash;
  raw.pragma('wal_checkpoint(TRUNCATE)');
  raw.close();

  // The next chained append, in a child with the same isolated env.
  const env = cleanEnv({ ...paths, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT || 'child' });
  const child = spawnSync(process.execPath, ['-e', `
    const hook = require('./db/auditHook');
    hook.recordSecurityEvent({ actor: { username: 'admin', role: 'admin' }, action: 'after-raw', subject: 'x' });
    hook.closeAuditConnection();
  `], { cwd: REPO, env, encoding: 'utf8' });
  assert.strictEqual(child.status, 0, child.stderr);

  const c = ro(paths.MA_AUDIT_DB_PATH);
  const next = c.prepare("SELECT * FROM audit_log WHERE action = 'after-raw'").get();
  const verdict = auditChain.verifyChain(c, 'control');
  c.close();
  assert.ok(next.id > rawId);
  assert.strictEqual(next.prev_hash, lastHashed, 'chains from the last row that HAS a hash, never undefined');
  assert.deepStrictEqual(verdict.problems, [{ id: rawId, reason: 'unchained-row' }], 'exactly that one row is unchained');

  const verify = spawnSync(process.execPath, ['scripts/audit-verify.js', '--all'], { cwd: REPO, env, encoding: 'utf8' });
  assert.strictEqual(verify.status, 1, verify.stdout + verify.stderr);
  assert.match(verify.stdout, new RegExp(`FAIL .*audit\\.db id=${rawId} unchained-row`));
  assert.ok(/OK .*legacy\.db/.test(verify.stdout) && /OK .*deal_mgrate0a1\.db/.test(verify.stdout), 'partitions still verify');
});

// --- fresh install ------------------------------------------------------------------

test('a fresh install creates audit.db at version 1 directly (no backup, no migration event)', async () => {
  const dir = tmp('fresh');
  const paths = isolatedPaths(dir);
  const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
  assert.strictEqual(r.exitCode, 0, r.stderr);
  assert.strictEqual(userVersion(paths.MA_AUDIT_DB_PATH), 1);
  assert.strictEqual(fs.existsSync(`${paths.MA_AUDIT_DB_PATH}.pre-v1.bak`), false);
  assert.strictEqual(auditRows(paths.MA_AUDIT_DB_PATH).filter((x) => x.action === 'audit-migrated').length, 0);
  const c = ro(paths.MA_AUDIT_DB_PATH);
  const cols = c.prepare("PRAGMA table_info('audit_log')").all().map((x) => x.name);
  c.close();
  for (const col of ['legacy_id', 'prev_hash', 'row_hash']) assert.ok(cols.includes(col), col);
});
