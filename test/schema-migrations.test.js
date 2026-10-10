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

const { bootProbe, isolatedPaths, cleanEnv, REPO } = require('./helpers/boot-probe');
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

// keep helpers referenced for the Task-2 cases appended below
void BROKEN_DIR; void BACKUP_DIR; void cleanEnv; void sessions;
