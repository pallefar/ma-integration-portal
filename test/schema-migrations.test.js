'use strict';
// D-12-03 / DATA-03 (plan 12-06): PRAGMA user_version per database file with
// ordered forward-only migrations applied under BEGIN IMMEDIATE.
//
// In-process cases drive db/dbFiles.js openDbFile() / db/migrate.js directly on
// temp files (the test-only MA_MIGRATIONS_DIR points at test/fixtures/
// migrations-*); whole-app cases boot server.js in child processes through
// test/helpers/boot-probe.js and observe behaviour AT BOOT.

const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { bootProbe, isolatedPaths, cleanEnv, REPO, makeCorruptDealFile } = require('./helpers/boot-probe');
const dbFiles = require('../db/dbFiles');
const migrate = require('../db/migrate');
const readiness = require('../db/readiness');
const sessions = require('../db/sessions');

const FIXTURES = path.join(__dirname, 'fixtures');
const PROBE_DIR = path.join(FIXTURES, 'migrations-probe');
const BROKEN_DIR = path.join(FIXTURES, 'migrations-broken');
const BACKUP_DIR = path.join(FIXTURES, 'migrations-backup');

const dirs = [];
function tmp(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `gsd-12-06-${label}-`));
  dirs.push(d);
  return d;
}

const savedMigrationsDir = process.env.MA_MIGRATIONS_DIR;
function useMigrationsDir(dir) {
  if (dir) process.env.MA_MIGRATIONS_DIR = dir; else delete process.env.MA_MIGRATIONS_DIR;
}

afterEach(() => {
  if (savedMigrationsDir === undefined) delete process.env.MA_MIGRATIONS_DIR; else process.env.MA_MIGRATIONS_DIR = savedMigrationsDir;
  readiness._resetForTests();
  dbFiles._clearNotReadyForTests();
});

process.on('exit', () => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});

function userVersion(file) {
  const c = new Database(file, { readonly: true });
  try { return c.pragma('user_version', { simple: true }); } finally { c.close(); }
}

function tableExists(file, name) {
  const c = new Database(file, { readonly: true });
  try { return !!c.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name); } finally { c.close(); }
}

// A version-0 file of `schemaPath` exactly as a pre-Phase-12 release left it.
function seedV0(file, schemaPath, seedFn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const c = new Database(file);
  c.pragma('journal_mode = WAL');
  c.exec(fs.readFileSync(schemaPath, 'utf8'));
  if (seedFn) seedFn(c);
  c.pragma('wal_checkpoint(TRUNCATE)');
  assert.strictEqual(c.pragma('user_version', { simple: true }), 0, 'seeded file is version 0');
  c.close();
}

function seedAccount(c) {
  c.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run('probe-user', null, 1, JSON.stringify({ username: 'probe-user', role: 'admin' }));
}

// --- fresh files -----------------------------------------------------------

test('fresh files of every family are stamped at the family latest version and no up() runs', () => {
  useMigrationsDir(PROBE_DIR); // control 001's up() would leave a _migration_probe table
  const dir = tmp('fresh');
  const cases = [
    ['control', path.join(dir, 'control.db'), dbFiles.CONTROL_SCHEMA_PATH],
    ['runtime', path.join(dir, 'runtime.db'), dbFiles.RUNTIME_SCHEMA_PATH],
    ['deal', path.join(dir, 'deal.db'), dbFiles.DEAL_SCHEMA_PATH],
    ['audit', path.join(dir, 'audit.db'), dbFiles.AUDIT_SCHEMA_PATH],
  ];
  for (const [family, file, schema] of cases) {
    dbFiles.openDbFile(file, schema).close();
    assert.strictEqual(userVersion(file), migrate.latestVersion(family), `${family} is stamped at its latest version`);
  }
  assert.strictEqual(migrate.latestVersion('control'), 1);
  assert.strictEqual(tableExists(cases[0][1], '_migration_probe'), false, 'a fresh file never runs a migration');
  const snap = readiness.snapshot();
  assert.strictEqual(snap.ready, true);
  assert.deepStrictEqual(Object.keys(snap.versions).sort(), ['audit', 'control', 'deal', 'runtime']);
  assert.strictEqual(snap.versions.audit.version, migrate.latestVersion('audit'));
});

test('a schema outside the four families gets no version (backward compatible)', () => {
  const dir = tmp('custom');
  const schema = path.join(dir, 'custom.sql');
  fs.writeFileSync(schema, 'CREATE TABLE IF NOT EXISTS t (x INTEGER);');
  const file = path.join(dir, 'custom.db');
  dbFiles.openDbFile(file, schema).close();
  assert.strictEqual(userVersion(file), 0);
});

// --- existing version-0 files ---------------------------------------------

test('an existing version-0 file is migrated once, data intact, and stays at 1 on reopen', () => {
  useMigrationsDir(PROBE_DIR);
  const dir = tmp('v0');
  const file = path.join(dir, 'control.db');
  seedV0(file, dbFiles.CONTROL_SCHEMA_PATH, seedAccount);

  dbFiles.openDbFile(file, dbFiles.CONTROL_SCHEMA_PATH).close();
  assert.strictEqual(userVersion(file), 1);
  const c = new Database(file, { readonly: true });
  assert.strictEqual(c.prepare('SELECT COUNT(*) AS n FROM _migration_probe').get().n, 1, 'up() ran exactly once');
  assert.strictEqual(c.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'existing account row intact');
  c.close();

  dbFiles.openDbFile(file, dbFiles.CONTROL_SCHEMA_PATH).close();
  const c2 = new Database(file, { readonly: true });
  assert.strictEqual(c2.prepare('SELECT COUNT(*) AS n FROM _migration_probe').get().n, 1, 'a reopen does not re-run the migration');
  c2.close();
});

test('whole app: a version-0 control.db migrates at boot, before any request, and /healthz reports it', async () => {
  const dir = tmp('boot-v0');
  const paths = isolatedPaths(dir);
  seedV0(paths.MA_CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH, seedAccount);
  const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
  assert.strictEqual(r.exitCode, 0, r.stderr);
  const health = r.results[0];
  assert.strictEqual(health.status, 200);
  assert.strictEqual(health.body.status, 'ok');
  assert.strictEqual(health.body.readiness.ready, true);
  assert.strictEqual(health.body.readiness.versions.control.version, 1);
  assert.strictEqual(userVersion(paths.MA_CONTROL_DB_PATH), 1);
  const c = new Database(paths.MA_CONTROL_DB_PATH, { readonly: true });
  assert.strictEqual(c.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'the account row survived the migration');
  c.close();
});

test('whole app: two processes opening the same version-0 file at once run the migration exactly once', async () => {
  const dir = tmp('concurrent');
  const paths = isolatedPaths(dir);
  seedV0(paths.MA_CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH, seedAccount);
  const env = { MA_MIGRATIONS_DIR: PROBE_DIR };
  // Each child needs its own runtime/demo/audit files — only control.db is shared.
  const mk = (label) => {
    const d = tmp(`concurrent-${label}`);
    const p = isolatedPaths(d);
    return { dir, env: { ...env, MA_RUNTIME_DB_PATH: p.MA_RUNTIME_DB_PATH, MA_DEMO_DB_PATH: p.MA_DEMO_DB_PATH, MA_AUDIT_DB_PATH: p.MA_AUDIT_DB_PATH, MA_DEALS_DIR: p.MA_DEALS_DIR }, probes: [{ path: '/healthz' }] };
  };
  const [a, b] = await Promise.all([bootProbe(mk('a')), bootProbe(mk('b'))]);
  for (const r of [a, b]) {
    assert.strictEqual(r.exitCode, 0, r.stderr);
    assert.strictEqual(r.results[0].status, 200);
  }
  const c = new Database(paths.MA_CONTROL_DB_PATH, { readonly: true });
  assert.strictEqual(c.prepare('SELECT COUNT(*) AS n FROM _migration_probe').get().n, 1, 'the migration side effect exists exactly once');
  assert.strictEqual(c.pragma('user_version', { simple: true }), 1);
  c.close();
});

// --- layout ---------------------------------------------------------------

test('migration layout: every family directory has contiguous ids from 1 matching the file prefixes', () => {
  useMigrationsDir(null);
  const root = path.join(REPO, 'db', 'migrations');
  for (const family of migrate.FAMILIES) {
    const dir = path.join(root, family);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort() : [];
    files.forEach((f, i) => assert.strictEqual(Number(f.slice(0, 3)), i + 1, `${family}/${f} is id ${i + 1}`));
    assert.strictEqual(migrate.loadMigrations(family).length, files.length);
  }
  for (const family of ['control', 'runtime', 'deal']) {
    assert.ok(fs.existsSync(path.join(root, family, '001-baseline.js')), `${family} has a baseline`);
  }
});

// --- runtime + deal baselines at boot --------------------------------------

test('whole app: version-0 runtime.db and demo.db migrate at boot (data intact)', async () => {
  const dir = tmp('boot-runtime-demo');
  const paths = isolatedPaths(dir);
  seedV0(paths.MA_RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH, (c) => {
    c.prepare("INSERT INTO sessions (token_hash, username, role, created_at, expires_at) VALUES ('h', 'u', 'admin', ?, ?)")
      .run(new Date().toISOString(), new Date(Date.now() + 3600e3).toISOString());
  });
  seedV0(paths.MA_DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH, (c) => {
    c.prepare("INSERT INTO alerts (id, project_id, seq, data) VALUES ('a1', NULL, 1, '{}')").run();
  });
  const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
  assert.strictEqual(r.exitCode, 0, r.stderr);
  assert.strictEqual(r.results[0].status, 200);
  assert.strictEqual(userVersion(paths.MA_RUNTIME_DB_PATH), 1);
  assert.strictEqual(userVersion(paths.MA_DEMO_DB_PATH), migrate.latestVersion('deal')); // 13-05: deal latest is 2 (resanitize-html)
  const demo = new Database(paths.MA_DEMO_DB_PATH, { readonly: true });
  assert.strictEqual(demo.prepare('SELECT COUNT(*) AS n FROM alerts').get().n, 1);
  demo.close();
  const rt = new Database(paths.MA_RUNTIME_DB_PATH, { readonly: true });
  assert.strictEqual(rt.prepare('SELECT COUNT(*) AS n FROM sessions').get().n >= 1, true, 'runtime rows intact');
  rt.close();
});

// --- failed migration: rolled back, sticky, fails closed -------------------

test('a broken migration rolls back, leaves the file at its previous version and is sticky until restart', () => {
  useMigrationsDir(BROKEN_DIR);
  const dir = tmp('broken-unit');
  const file = path.join(dir, 'control.db');
  seedV0(file, dbFiles.CONTROL_SCHEMA_PATH, seedAccount);

  let first;
  assert.throws(() => dbFiles.openDbFile(file, dbFiles.CONTROL_SCHEMA_PATH), (e) => { first = e; return e instanceof readiness.DbNotReadyError; });
  assert.strictEqual(first.reason, 'migration-failed');
  assert.strictEqual(first.migration, '002-broken');
  assert.ok(!first.message.includes(dir), 'the error message carries no path');
  assert.strictEqual(userVersion(file), 1, '001 committed, 002 rolled back');
  assert.strictEqual(tableExists(file, '_broken_partial'), false, 'the failed migration left no partial table');

  assert.throws(() => dbFiles.openDbFile(file, dbFiles.CONTROL_SCHEMA_PATH), (e) => e === first, 'sticky: the cached failure is rethrown, no retry');
  const snap = readiness.snapshot();
  assert.strictEqual(snap.ready, false);
  assert.deepStrictEqual(snap.failures, [{ family: 'control', file: 'control.db', migration: '002-broken', reason: 'migration-failed' }]);
});

test('a corrupt deal file fails quick_check once and stays refused (sticky, no re-check)', () => {
  const dir = tmp('corrupt-unit');
  const file = path.join(dir, 'deals', 'deal_corruptunit.db');
  makeCorruptDealFile(file, dbFiles.DEAL_SCHEMA_PATH);
  let first;
  assert.throws(() => dbFiles.openDbFile(file, dbFiles.DEAL_SCHEMA_PATH), (e) => { first = e; return e instanceof readiness.DbNotReadyError; });
  assert.strictEqual(first.reason, 'integrity-check-failed');
  assert.throws(() => dbFiles.openDbFile(file, dbFiles.DEAL_SCHEMA_PATH), (e) => e === first);
  // The family `deal` is exposed as file `deal` — never the deal id.
  assert.deepStrictEqual(readiness.snapshot().failures, [{ family: 'deal', file: 'deal', reason: 'integrity-check-failed' }]);
});

test('whole app: a broken control migration keeps the instance listening but not-ready, and fails closed', async () => {
  const dir = tmp('broken-boot');
  const paths = isolatedPaths(dir);
  // A copy of the committed control.db (demo accounts) — the TEMP copy is migrated, never the committed file.
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), paths.MA_CONTROL_DB_PATH);
  // A pre-existing session for admin in runtime.db so an authenticated request reaches control.db.
  const rt = dbFiles.openDbFile(paths.MA_RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  const token = sessions.createSession(rt, { username: 'admin', role: 'admin', ttlMs: 3600e3 });
  const sessionsBefore = rt.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  rt.close();

  const r = await bootProbe({
    dir,
    env: { MA_MIGRATIONS_DIR: BROKEN_DIR },
    probes: [
      { path: '/healthz' },
      { path: '/api/auth/me', headers: { cookie: `ma_session=${token}` } },
      { method: 'POST', path: '/api/auth/login', body: { username: 'admin', password: 'TEdemo!2026' } },
    ],
  });
  assert.strictEqual(r.exitCode, 0, `the process must keep listening: ${r.stderr}`);
  assert.match(r.stderr, /\[readiness\] control not ready|\[readiness\].*not ready/);
  const [health, me, login] = r.results;
  assert.strictEqual(health.status, 503);
  assert.strictEqual(health.body.status, 'not-ready');
  assert.strictEqual(health.body.readiness.ready, false);
  assert.deepStrictEqual(health.body.readiness.failures[0], { family: 'control', file: 'control.db', migration: '002-broken', reason: 'migration-failed' });
  assert.ok(!JSON.stringify(health.body).includes(dir), 'no absolute path in the unauthenticated payload');

  assert.strictEqual(userVersion(paths.MA_CONTROL_DB_PATH), 1, 'the file stays at its previous version');
  assert.strictEqual(tableExists(paths.MA_CONTROL_DB_PATH, '_broken_partial'), false);

  for (const res of [me, login]) {
    assert.strictEqual(res.status, 503, JSON.stringify(res.body));
    assert.strictEqual(res.body.retryable, false);
    assert.strictEqual(res.headers['retry-after'], undefined, 'a not-ready database is never retried');
    assert.ok(!JSON.stringify(res.body).includes(dir));
  }
  const after = new Database(paths.MA_RUNTIME_DB_PATH, { readonly: true });
  assert.strictEqual(after.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, sessionsBefore, 'no session was created by the refused login');
  after.close();
});

// --- disk precondition for backup migrations (PD-28) -----------------------

function seedAtVersion1(dir) {
  const file = path.join(dir, 'control.db');
  seedV0(file, dbFiles.CONTROL_SCHEMA_PATH, seedAccount);
  const c = new Database(file);
  c.pragma('user_version = 1');
  c.close();
  return file;
}

test('backup migration: refused with insufficient-disk-for-migration when free space is below 3 x size + 64 MB; nothing written', () => {
  useMigrationsDir(BACKUP_DIR);
  const dir = tmp('disk');
  const file = seedAtVersion1(dir);
  const conn = new Database(file);
  try {
    assert.throws(
      () => migrate.runMigrations(conn, { family: 'control', file, freeBytes: 0 }),
      (e) => e instanceof readiness.DbNotReadyError && e.reason === 'insufficient-disk-for-migration'
    );
    // exactly at the line: 3 x size + 64 MB - 1 byte is still refused
    const size = fs.statSync(file).size;
    assert.throws(
      () => migrate.runMigrations(conn, { family: 'control', file, freeBytes: 3 * size + 64 * 1024 * 1024 - 1 }),
      (e) => e instanceof readiness.DbNotReadyError
    );
  } finally { conn.close(); }
  assert.strictEqual(fs.existsSync(`${file}.pre-v2.bak`), false, 'no backup was started');
  assert.strictEqual(userVersion(file), 1);
  assert.deepStrictEqual(
    readiness.snapshot().failures.map((f) => f.reason),
    ['insufficient-disk-for-migration']
  );
});

test('backup migration: with ample space a 0600 .pre-v2.bak is taken and the file reaches version 2', () => {
  useMigrationsDir(BACKUP_DIR);
  const dir = tmp('backup');
  const file = seedAtVersion1(dir);
  const conn = new Database(file);
  try {
    migrate.runMigrations(conn, { family: 'control', file, freeBytes: 1e12 });
  } finally { conn.close(); }
  const bak = `${file}.pre-v2.bak`;
  assert.ok(fs.existsSync(bak), 'backup exists');
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(bak).mode & 0o777, 0o600);
  assert.strictEqual(userVersion(file), 2);
  assert.strictEqual(userVersion(bak), 1, 'the backup is the pre-migration state');
});

test('backup migration: a stale .pre-v2.bak from an interrupted attempt is replaced, not an error', () => {
  useMigrationsDir(BACKUP_DIR);
  const dir = tmp('stale');
  const file = seedAtVersion1(dir);
  fs.writeFileSync(`${file}.pre-v2.bak`, 'stale partial backup from an interrupted attempt');
  const conn = new Database(file);
  try {
    migrate.runMigrations(conn, { family: 'control', file, freeBytes: 1e12 });
  } finally { conn.close(); }
  assert.strictEqual(userVersion(file), 2);
  assert.strictEqual(userVersion(`${file}.pre-v2.bak`), 1, 'the stale file was replaced by a real backup');
});

// --- committed files are never written (PD-5) ------------------------------

test('committed-implied: a version-0 baseline file is REPORTED as version 1 without a write; pending beyond baseline is not-ready', () => {
  const dir = tmp('committed');
  const file = path.join(dir, 'control.db');
  seedV0(file, dbFiles.CONTROL_SCHEMA_PATH, seedAccount);
  const sha = () => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = sha();

  useMigrationsDir(null);
  let conn = new Database(file);
  try {
    const out = migrate.runMigrations(conn, { family: 'control', file, committed: true });
    assert.deepStrictEqual({ version: out.version, implied: out.implied }, { version: 1, implied: true });
    assert.strictEqual(conn.pragma('user_version', { simple: true }), 0, 'user_version was not written');
  } finally { conn.close(); }
  assert.strictEqual(sha(), before, 'the file is byte-identical');
  assert.deepStrictEqual(readiness.snapshot().versions.control, { version: 1, implied: true }); // 12-REVIEW IN-01: no file count on the wire

  readiness._resetForTests();
  useMigrationsDir(BACKUP_DIR); // latest = 2
  conn = new Database(file);
  try {
    assert.throws(
      () => migrate.runMigrations(conn, { family: 'control', file, committed: true }),
      (e) => e instanceof readiness.DbNotReadyError && e.reason === 'committed-file-needs-regeneration' && e.migration === '002-backup-probe'
    );
  } finally { conn.close(); }
  assert.strictEqual(sha(), before, 'still byte-identical after the refusal');
});

test('whole app: booting against the committed data/control.db reports it implied-v1 and never writes it', async () => {
  const committed = path.join(REPO, 'data', 'control.db');
  const sha = () => require('crypto').createHash('sha256').update(fs.readFileSync(committed)).digest('hex');
  const before = sha();
  const dir = tmp('committed-boot');
  const r = await bootProbe({
    dir,
    env: { MA_CONTROL_DB_PATH: committed, MA_TEST_ALLOW_COMMITTED_CONTROL_DB: '1' },
    probes: [{ path: '/healthz' }],
  });
  assert.strictEqual(r.exitCode, 0, r.stderr);
  assert.strictEqual(r.results[0].status, 200, JSON.stringify(r.results[0].body));
  assert.deepStrictEqual(r.results[0].body.readiness.versions.control, { version: 1, implied: true }); // 12-REVIEW IN-01: no file count on the wire
  assert.strictEqual(sha(), before, 'data/control.db is byte-identical after a boot');
  const c = new Database(committed, { readonly: true });
  assert.strictEqual(c.pragma('user_version', { simple: true }), 0);
  c.close();
});

// --- MA_MIGRATIONS_DIR is refused in real mode (T-12-53) -------------------

test('MA_MODE=real with MA_MIGRATIONS_DIR set exits non-zero with a [security] message', () => {
  const dir = tmp('real-migrations');
  const res = require('child_process').spawnSync(process.execPath, ['-e', "require('./server.js')"], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60000,
    input: '',
    env: cleanEnv({ MA_MODE: 'real', MA_DATA_DIR: path.join(dir, 'real'), MA_MIGRATIONS_DIR: PROBE_DIR }),
  });
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /\[security\] MA_MIGRATIONS_DIR/);
  assert.ok(!fs.existsSync(path.join(dir, 'real', 'control.db')), 'refused before any database was created');
});
