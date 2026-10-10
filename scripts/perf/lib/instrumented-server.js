'use strict';
// Phase 12 perf harness (plan 12-04, D-12-05): fork an ISOLATED copy of the
// real portal with event-loop-delay instrumentation, so a perf script can state
// "the server's event loop never stalled more than N ms while X ran" as a
// measurement instead of a belief. Reused by every Phase 12 perf script.
//
//   const { startInstrumentedServer, assertEnoughDisk } = require('./lib/instrumented-server');
//   const srv = await startInstrumentedServer({ env });      // { port, base, reset, snapshot, stop }
//   await srv.reset(); ...drive load...; const stats = await srv.snapshot();
//   await srv.stop();
//
// Safety rules enforced HERE (not left to each script):
//   - the env MUST carry every MA_* data path and none may point inside
//     <repo>/data — a perf run must never open the committed demo.db /
//     control.db (project rule: never run a server against committed data);
//   - it refuses to start with < 1 GB free in os.tmpdir() (this host's disk is
//     shared and often >= 95% full; a perf script that fills it takes the
//     whole machine down). Scripts built on it also own their scratch-dir
//     cleanup on exit AND on SIGINT/SIGTERM (see scripts/perf/pack-isolation.js).

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_DIR = path.join(REPO_ROOT, 'data');
const SERVER_CHILD = path.join(__dirname, 'server-child.js');
const MIN_FREE_BYTES = 1024 * 1024 * 1024;
// Every child forked and not yet exited — so a script's SIGINT/SIGTERM handler
// can stop a server that is still BOOTING (not yet returned from
// startInstrumentedServer) before it removes the scratch directory the child
// is writing into.
const liveChildren = new Set();
const REQUIRED_MA_VARS = ['MA_CONTROL_DB_PATH', 'MA_RUNTIME_DB_PATH', 'MA_DEMO_DB_PATH', 'MA_DEALS_DIR', 'MA_AUDIT_DB_PATH'];

function freeBytes(dir) {
  const s = fs.statfsSync(dir || os.tmpdir());
  return Number(s.bavail) * Number(s.bsize);
}

/** Throws (code PERF_LOW_DISK) naming the shortfall when < 1 GB is available. */
function assertEnoughDisk(dir) {
  const target = dir || os.tmpdir();
  const free = freeBytes(target);
  if (free < MIN_FREE_BYTES) {
    const err = new Error(
      `perf harness: only ${(free / 1048576).toFixed(0)} MB free under ${target} — need at least ${MIN_FREE_BYTES / 1048576} MB; free some disk space and re-run`
    );
    err.code = 'PERF_LOW_DISK';
    throw err;
  }
  return free;
}

/** Throws unless every MA_* path is set and lies outside <repo>/data. */
function assertScratchEnv(env) {
  for (const name of REQUIRED_MA_VARS) {
    if (!env[name]) throw new Error(`perf harness: ${name} must be set — refusing to fall back to the committed data/ files`);
  }
  for (const [name, value] of Object.entries(env)) {
    if (!/^MA_.*(PATH|DIR)$/.test(name) || typeof value !== 'string' || !value) continue;
    const resolved = path.resolve(value);
    if (resolved === DATA_DIR || resolved.startsWith(DATA_DIR + path.sep)) {
      throw new Error(`perf harness: ${name}=${value} lies inside ${DATA_DIR} — a perf run must never touch the committed data files`);
    }
  }
}

/**
 * @param {object} o
 * @param {Object<string,string>} o.env     full child env (MA_* paths + ADMIN_TOKEN ...)
 * @param {string} [o.serverRoot]           directory holding the server.js to measure (default: this repo)
 * @param {string} [o.label]                output prefix
 * @param {boolean} [o.quiet]               drop child output
 */
async function startInstrumentedServer({ env, serverRoot, label = 'server', quiet = false } = {}) {
  if (!env) throw new Error('startInstrumentedServer: env is required');
  assertEnoughDisk();
  assertScratchEnv(env);

  const childEnv = Object.assign({}, process.env, env);
  if (serverRoot) childEnv.PERF_SERVER_ROOT = path.resolve(serverRoot);
  const child = childProcess.fork(SERVER_CHILD, [], { env: childEnv, silent: true, execArgv: [] });

  const pipe = (stream, sink) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        if (!quiet) sink.write(`[${label}] ${buf.slice(0, i)}\n`);
        buf = buf.slice(i + 1);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);

  let exited = false;
  const exitWaiters = [];
  liveChildren.add(child);
  child.once('exit', (code, signal) => {
    exited = true;
    liveChildren.delete(child);
    exitWaiters.splice(0).forEach((fn) => fn({ code, signal }));
  });

  let nextId = 1;
  const waiters = new Map();
  let onListening = null;
  child.on('message', (m) => {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'listening' && onListening) { onListening(m.port); return; }
    if (m.id && waiters.has(m.id)) { const fn = waiters.get(m.id); waiters.delete(m.id); fn(m); }
  });

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('perf harness: server did not report listening within 60 s')), 60000);
    onListening = (p) => { clearTimeout(timer); resolve(p); };
    exitWaiters.push(({ code, signal }) => {
      clearTimeout(timer);
      reject(new Error(`perf harness: server child exited before listening (code ${code}, signal ${signal})`));
    });
  }).catch(async (err) => {
    try { child.kill('SIGKILL'); } catch (e) { /* gone */ }
    throw err;
  });

  function request(cmd) {
    return new Promise((resolve, reject) => {
      if (exited) { reject(new Error('perf harness: server child is not running')); return; }
      const id = nextId++;
      const timer = setTimeout(() => { waiters.delete(id); reject(new Error(`perf harness: no reply to '${cmd}' within 15 s`)); }, 15000);
      waiters.set(id, (m) => { clearTimeout(timer); resolve(m); });
      child.send({ cmd, id });
    });
  }

  return {
    port,
    base: `http://127.0.0.1:${port}`,
    pid: child.pid,
    /** Start a fresh measurement window. */
    async reset() { await request('reset'); },
    /** Event-loop delay (ms) + rss for the window since the last reset(). */
    async snapshot() { return (await request('snapshot')).stats; },
    /** SIGTERM, 5 s grace, then SIGKILL. Safe to call twice. */
    async stop() {
      if (exited) return;
      const done = new Promise((resolve) => exitWaiters.push(resolve));
      try { child.kill('SIGTERM'); } catch (e) { /* gone */ }
      const killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } }, 5000);
      await done;
      clearTimeout(killTimer);
    },
  };
}

/** SIGKILL every still-live server child (signal-handler path: no grace). */
function killAllInstrumentedServers() {
  for (const c of liveChildren) { try { c.kill('SIGKILL'); } catch (e) { /* gone */ } }
}

module.exports = { startInstrumentedServer, killAllInstrumentedServers, assertEnoughDisk, assertScratchEnv, freeBytes, MIN_FREE_BYTES, REPO_ROOT };
