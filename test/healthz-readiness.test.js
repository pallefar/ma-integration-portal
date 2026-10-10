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

const { bootProbe, isolatedPaths, REPO } = require('./helpers/boot-probe');
const dbFiles = require('../db/dbFiles');
const migrate = require('../db/migrate');

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

// keep helpers referenced for the Task-2 cases appended below
void isolatedPaths; void dbFiles; void userVersion;
