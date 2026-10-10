'use strict';
// D-12-03 (plan 12-06): boot the REAL app (`require('./server.js')`) in a child
// process against isolated temp database files, send an ordered list of HTTP
// probes to it on an ephemeral loopback port, print the results as one JSON
// line and exit. Used by test/schema-migrations.test.js and
// test/healthz-readiness.test.js to prove behaviour AT BOOT (the first probe is
// issued after listen, so anything the probes observe was done before traffic).
//
//   const r = await bootProbe({ dir, probes: [{ path: '/healthz' }] });
//   r.exitCode, r.results[0].status / .body / .headers, r.stdout, r.stderr
//
// The caller owns `dir` (a fresh temp directory) and passes its own MA_* env
// overrides through `env` — the isolation guard (D-12-06) stays active because
// NODE_TEST_CONTEXT is inherited.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

const CHILD_SCRIPT = `
  const app = require('./server.js');
  const probes = JSON.parse(process.env.GSD_PROBES || '[]');
  const server = app.listen(0, '127.0.0.1', async () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    const results = [];
    for (const p of probes) {
      const init = { method: p.method || 'GET', redirect: 'manual', headers: Object.assign({}, p.headers || {}) };
      if (p.body !== undefined) {
        init.body = JSON.stringify(p.body);
        init.headers['content-type'] = 'application/json';
      }
      try {
        const res = await fetch(base + p.path, init);
        const text = await res.text();
        let body = text;
        try { body = JSON.parse(text); } catch (e) { /* keep text */ }
        results.push({ status: res.status, headers: Object.fromEntries(res.headers.entries()), body });
      } catch (e) {
        results.push({ error: String(e && e.message) });
      }
    }
    process.stdout.write('\\nPROBE_RESULT ' + JSON.stringify(results) + '\\n');
    server.close();
    process.exit(0);
  });
`;

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('MA_') || key === 'DEMO_OPEN' || key === 'ADMIN_TOKEN') delete env[key];
  }
  return { ...env, ...extra };
}

/** The five MA_* temp paths for `dir` (caller creates the files it wants seeded). */
function isolatedPaths(dir) {
  return {
    MA_CONTROL_DB_PATH: path.join(dir, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
    MA_DEMO_DB_PATH: path.join(dir, 'demo.db'),
    MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
    MA_DEALS_DIR: path.join(dir, 'deals'),
  };
}

function bootProbe({ dir, env, probes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD_SCRIPT], {
      cwd: REPO,
      env: cleanEnv({ ...isolatedPaths(dir), ...(env || {}), GSD_PROBES: JSON.stringify(probes || []) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`boot probe timed out\n${stdout}\n${stderr}`)); }, timeoutMs || 90000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      const m = /PROBE_RESULT (.*)\n/.exec(stdout);
      resolve({ exitCode, stdout, stderr, results: m ? JSON.parse(m[1]) : null });
    });
  });
}

/**
 * Fixture builder: create a plain version-0 SQLite file from `schemaPath` (no
 * user_version stamp — exactly what a pre-Phase-12 release left on disk),
 * optionally seeded by `seedFn(conn)`.
 */
function seedV0File(file, schemaPath, seedFn) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const Database = require('better-sqlite3');
  const c = new Database(file);
  c.pragma('journal_mode = WAL');
  c.exec(fs.readFileSync(schemaPath, 'utf8'));
  if (seedFn) seedFn(c);
  c.pragma('wal_checkpoint(TRUNCATE)');
  c.close();
}

/**
 * Fixture builder: a deal database whose `alerts` b-tree is damaged inside a
 * page (the file header stays valid, so the file still OPENS — exactly the
 * case PRAGMA quick_check exists for). Asserts the damage is detectable.
 */
function makeCorruptDealFile(file, schemaPath) {
  const Database = require('better-sqlite3');
  seedV0File(file, schemaPath, (c) => {
    const insert = c.prepare('INSERT INTO alerts (id, project_id, seq, data) VALUES (?, ?, ?, ?)');
    const filler = 'x'.repeat(300);
    c.transaction(() => { for (let i = 0; i < 600; i += 1) insert.run(`a${i}`, null, i, JSON.stringify({ i, filler })); })();
  });
  const probe = new Database(file, { readonly: true });
  const root = probe.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'alerts'").get().rootpage;
  const pageSize = probe.pragma('page_size', { simple: true });
  probe.close();
  const fd = fs.openSync(file, 'r+');
  try {
    // Keep the 12-byte b-tree page header, destroy the cell-pointer array.
    fs.writeSync(fd, Buffer.alloc(240, 0xff), 0, 240, (root - 1) * pageSize + 12);
  } finally {
    fs.closeSync(fd);
  }
  const check = new Database(file, { readonly: true });
  let ok;
  try { ok = check.pragma('quick_check', { simple: true }); } catch (e) { ok = `threw ${e.code}`; }
  check.close();
  if (ok === 'ok') throw new Error('fixture: corruption was not detectable by quick_check');
}

module.exports = { bootProbe, isolatedPaths, cleanEnv, REPO, seedV0File, makeCorruptDealFile };
