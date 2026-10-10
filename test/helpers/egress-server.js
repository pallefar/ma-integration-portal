'use strict';
// SAFE-06 (plan 13-02): boot the REAL app (`require('./server.js')`) in a child
// process against isolated temp database files and keep it running, so a test
// can talk to it over HTTP - several children can share one data directory
// (the cross-process egress case) or run MA_MODE=real (the real-mode default).
//
//   const s = await startServer({ dir, mode: 'dev' | 'real' });
//   s.base, s.tokens.admin / s.tokens.hrbp, await s.request('/login.html'), s.stop()
//
// The child seeds two accounts + session cookies itself (db/sessions.js,
// test/helpers/seed-identity.js) and prints ONE ready line to stdout. The
// caller owns `dir` (a fresh temp directory). The isolation guard (D-12-06)
// stays active because NODE_TEST_CONTEXT is inherited.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');

const CHILD_SCRIPT = `
  const app = require('./server.js');
  const store = require('./db/store.js');
  const dbFiles = require('./db/dbFiles.js');
  const sessionsDb = require('./db/sessions.js');
  const { ensureUser } = require('./test/helpers/seed-identity.js');
  const rt = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  const ctl = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
  ensureUser(ctl, { username: 'egress-admin', role: 'admin' });
  ensureUser(ctl, { username: 'egress-hrbp', role: 'hrbp' });
  const tokens = {
    admin: sessionsDb.createSession(rt, { username: 'egress-admin', role: 'admin', ttlMs: 3600000 }),
    hrbp: sessionsDb.createSession(rt, { username: 'egress-hrbp', role: 'hrbp', ttlMs: 3600000 }),
  };
  const server = app.listen(0, '127.0.0.1', () => {
    process.stdout.write('\\nEGRESS_READY ' + JSON.stringify({ port: server.address().port, tokens }) + '\\n');
  });
`;

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('MA_') || key === 'DEMO_OPEN' || key === 'ADMIN_TOKEN') delete env[key];
  }
  return { ...env, ...extra };
}

/** Copy the committed control.db + demo.db into `dir` (dev-mode fixture). */
function seedDevDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REPO, 'data', 'control.db'), path.join(dir, 'control.db'));
  fs.copyFileSync(path.join(REPO, 'data', 'demo.db'), path.join(dir, 'demo.db'));
}

function startServer({ dir, mode, timeoutMs } = {}) {
  const real = mode === 'real';
  let env;
  if (real) {
    env = { MA_MODE: 'real', MA_DATA_DIR: path.join(dir, 'real-data') };
  } else {
    if (!fs.existsSync(path.join(dir, 'demo.db'))) seedDevDir(dir);
    env = {
      MA_CONTROL_DB_PATH: path.join(dir, 'control.db'),
      MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
      MA_DEMO_DB_PATH: path.join(dir, 'demo.db'),
      MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
      MA_DEALS_DIR: path.join(dir, 'deals'),
    };
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CHILD_SCRIPT], {
      cwd: REPO, env: cleanEnv(env), stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`egress server did not start\n${stdout}\n${stderr}`));
    }, timeoutMs || 90000);
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      if (!/EGRESS_READY/.test(stdout)) { clearTimeout(timer); reject(new Error(`egress server exited ${code} before ready\n${stdout}\n${stderr}`)); }
    });
    child.stdout.on('data', (d) => {
      stdout += d;
      const m = /EGRESS_READY (.*)\n/.exec(stdout);
      if (!m) return;
      clearTimeout(timer);
      const { port, tokens } = JSON.parse(m[1]);
      const base = `http://127.0.0.1:${port}`;
      resolve({
        base, port, tokens, child,
        /** fetch wrapper: opts.token = 'admin' | 'hrbp' | undefined; opts.body is JSON-encoded. */
        async request(p, opts = {}) {
          const headers = { ...(opts.headers || {}) };
          if (opts.token) headers.Cookie = `ma_session=${tokens[opts.token]}`;
          const init = { method: opts.method || 'GET', headers, redirect: 'manual' };
          if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); headers['content-type'] = 'application/json'; }
          const res = await fetch(base + p, init);
          const text = await res.text();
          let body = text;
          try { body = JSON.parse(text); } catch (e) { /* keep text */ }
          return { status: res.status, headers: res.headers, body };
        },
        stop() {
          return new Promise((r) => {
            if (child.exitCode !== null) return r();
            child.once('exit', () => r());
            child.kill('SIGTERM');
            setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 5000).unref();
          });
        },
      });
    });
  });
}

/** Parse a CSP header into { directive: [sources] }. */
function parseCsp(value) {
  const out = {};
  for (const part of String(value || '').split(';')) {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    if (toks.length) out[toks[0]] = toks.slice(1);
  }
  return out;
}

module.exports = { startServer, parseCsp, seedDevDir };
