'use strict';
// D-12-03 / D-12-06 (plan 12-06): GET /healthz reports the process-level
// readiness object (db/readiness.js) — per-family schema versions, and any
// failed migration / integrity check as a 503 `not-ready`. The probe is
// unauthenticated, so the snapshot must carry no absolute path and no deal id.
//
// Whole-app cases boot server.js in child processes (test/helpers/boot-probe.js);
// the first probe is issued after listen with NO prior request, so everything
// observed was done at boot.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const { bootProbe, isolatedPaths, REPO, seedV0File, makeCorruptDealFile } = require('./helpers/boot-probe');
const dbFiles = require('../db/dbFiles');
const migrate = require('../db/migrate');
const sessions = require('../db/sessions');

const dirs = [];
function tmp(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `gsd-12-06-hz-${label}-`));
  dirs.push(d);
  return d;
}
process.on('exit', () => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* best effort */ } }
});

function userVersion(file) {
  const c = new Database(file, { readonly: true });
  try { return c.pragma('user_version', { simple: true }); } finally { c.close(); }
}

test('/healthz: a clean boot answers 200 with the readiness object (every opened family at its latest version)', async () => {
  const dir = tmp('clean');
  const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
  assert.strictEqual(r.exitCode, 0, r.stderr);
  const { status, body } = r.results[0];
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'ok');
  assert.strictEqual(typeof body.ts, 'number');
  assert.strictEqual(body.readiness.ready, true);
  assert.deepStrictEqual(body.readiness.failures, []);
  for (const family of ['control', 'runtime', 'deal']) {
    assert.strictEqual(body.readiness.versions[family].version, migrate.latestVersion(family), `${family} version`);
  }
  // No absolute path anywhere in the (unauthenticated) payload.
  assert.ok(!JSON.stringify(body).includes(dir), 'no temp path in /healthz');
});

test('/healthz: the handler no longer parses the demo database per probe (source assertion)', () => {
  const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  const start = src.indexOf("app.get('/healthz'");
  assert.ok(start > 0, '/healthz handler found');
  const end = src.indexOf('\n});', start);
  const body = src.slice(start, end);
  assert.ok(!/readDb\s*\(/.test(body), 'no readDb() in the /healthz handler');
  assert.ok(body.includes('readiness.snapshot()'), 'reports the readiness snapshot');
  assert.ok(body.includes('SELECT 1'), 'liveness is a cheap SELECT 1');
});

test('/healthz: stays a cheap GET — no schema migration or DDL during the request (source assertion)', () => {
  const src = fs.readFileSync(path.join(REPO, 'server.js'), 'utf8');
  const start = src.indexOf("app.get('/healthz'");
  const end = src.indexOf('\n});', start);
  const body = src.slice(start, end);
  assert.ok(!/openDbFile|runMigrations|getOrOpenConnection|initDb\s*\(/.test(body), 'no open/migrate in the handler');
});

// --- audit.db is opened at boot (checker B-1) ------------------------------

test('/healthz: audit.db is opened and versioned at boot with NO request made (checker B-1)', async () => {
  const dir = tmp('audit');
  const paths = isolatedPaths(dir);
  assert.strictEqual(fs.existsSync(paths.MA_AUDIT_DB_PATH), false, 'precondition: no audit file yet');
  const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] }); // the ONLY request
  assert.strictEqual(r.exitCode, 0, r.stderr);
  assert.ok(fs.existsSync(paths.MA_AUDIT_DB_PATH), 'audit.db was created by the boot, not by a request');
  const { body } = r.results[0];
  // Asserted against latestVersion(), never a literal: 0 until the audit family
  // gets its first migration (12-13), 1 after — this test passes unchanged then.
  assert.strictEqual(body.readiness.versions.audit.version, migrate.latestVersion('audit'));
  assert.strictEqual(userVersion(paths.MA_AUDIT_DB_PATH), migrate.latestVersion('audit'));
});

// --- registered deal files are opened by the boot sweep (checker W-5) ------

function registerDeal(c, id, status) {
  c.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, ?, ?, ?, ?)')
    .run(id, null, 1, status, JSON.stringify({ id, name: `Deal ${id}`, status, members: ['admin'] }));
}

test('boot sweep: a registered version-0 deal file is at the latest deal version after boot with no request; absent files are skipped, archived ones migrated', async () => {
  const dir = tmp('sweep');
  const paths = isolatedPaths(dir);
  const active = 'deal_sweepactive1';
  const archived = 'deal_sweeparchived1';
  const absent = 'deal_sweepabsent1';
  seedV0File(paths.MA_CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH, (c) => {
    registerDeal(c, active, 'active');
    registerDeal(c, archived, 'archived');
    registerDeal(c, absent, 'active');
  });
  for (const id of [active, archived]) {
    seedV0File(path.join(paths.MA_DEALS_DIR, `${id}.db`), dbFiles.DEAL_SCHEMA_PATH, (c) => {
      c.prepare("INSERT INTO alerts (id, project_id, seq, data) VALUES ('a1', NULL, 1, '{}')").run();
    });
  }

  const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] }); // no request touches a deal
  assert.strictEqual(r.exitCode, 0, r.stderr);
  assert.strictEqual(r.results[0].status, 200);
  for (const id of [active, archived]) {
    const file = path.join(paths.MA_DEALS_DIR, `${id}.db`);
    assert.strictEqual(userVersion(file), migrate.latestVersion('deal'), `${id} migrated at boot`); // 13-05: deal latest is 2 (resanitize-html)
    const c = new Database(file, { readonly: true });
    assert.strictEqual(c.prepare('SELECT COUNT(*) AS n FROM alerts').get().n, 1, 'deal data intact');
    c.close();
  }
  assert.strictEqual(fs.existsSync(path.join(paths.MA_DEALS_DIR, `${absent}.db`)), false, 'boot never creates a deal file');
  assert.match(r.stdout, /\[readiness\] deal sweep: 2 opened, 0 not ready, \d+ ms/);
  assert.ok(!r.stdout.includes('deal_sweep') && !r.stderr.includes('deal_sweep'), 'the sweep log names no deal id');
  assert.strictEqual(r.results[0].body.readiness.versions.deal.version, migrate.latestVersion('deal')); // 13-05: was literal 1
});

test('boot sweep: a corrupt registered deal file is not-ready immediately after boot; a request bound to it is a non-retryable 503', async () => {
  const dir = tmp('corrupt-boot');
  const paths = isolatedPaths(dir);
  const dealId = 'deal_corruptboot1';
  // Real accounts (demo admin) from a TEMP copy of the committed control.db.
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), paths.MA_CONTROL_DB_PATH);
  const control = new Database(paths.MA_CONTROL_DB_PATH);
  registerDeal(control, dealId, 'active');
  control.pragma('wal_checkpoint(TRUNCATE)');
  control.close();
  makeCorruptDealFile(path.join(paths.MA_DEALS_DIR, `${dealId}.db`), dbFiles.DEAL_SCHEMA_PATH);

  const rt = dbFiles.openDbFile(paths.MA_RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  const token = sessions.createSession(rt, { username: 'admin', role: 'admin', ttlMs: 3600e3 });
  assert.ok(sessions.bindSessionDeal(rt, token, dealId));
  rt.close();

  const cookie = { cookie: `ma_session=${token}` };
  const r = await bootProbe({
    dir,
    probes: [{ path: '/healthz' }, { path: '/api/alerts', headers: cookie }, { path: '/api/alerts', headers: cookie }],
  });
  assert.strictEqual(r.exitCode, 0, r.stderr);
  const [health, first, second] = r.results;
  assert.strictEqual(health.status, 503);
  assert.strictEqual(health.body.status, 'not-ready');
  assert.deepStrictEqual(health.body.readiness.failures, [{ family: 'deal', file: 'deal', reason: 'integrity-check-failed' }]);
  const wire = JSON.stringify(health.body);
  assert.ok(!wire.includes(dealId) && !wire.includes(dir), 'no deal id / path in the unauthenticated payload');
  assert.match(r.stdout, /\[readiness\] deal sweep: 0 opened, 1 not ready/);

  for (const res of [first, second]) {
    assert.strictEqual(res.status, 503, JSON.stringify(res.body));
    assert.strictEqual(res.body.retryable, false);
    assert.strictEqual(res.headers['retry-after'], undefined);
    assert.ok(!JSON.stringify(res.body).includes(dealId));
  }
});
