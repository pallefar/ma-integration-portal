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

module.exports = { bootProbe, isolatedPaths, cleanEnv, REPO };
