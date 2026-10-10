'use strict';
// Phase 12 / plan 12-05 (PD-13): the setup both review load profiles share —
// an ISOLATED data set built from byte copies of the committed demo/control
// databases, a fresh real deal, a member account and a bound session — plus the
// cleanup rules every perf script must follow:
//
//   - the committed data/*.db files are opened READ-ONLY and copied with
//     better-sqlite3's backup(); they are never opened writable (T-12-45);
//   - refuses to start (exit 2) when os.tmpdir() has < 1 GB free (T-12-46);
//   - cleanup() stops the server, kills any still-booting child and removes the
//     scratch directory; each script calls it in a `finally` AND from its own
//     SIGINT/SIGTERM handlers (exit 130/143).
//
//   const scratch = createScratch({ prefix: 'gsd-list-reads-' });
//   await scratch.setup({ username: 'perf-hrbp', role: 'hrbp' });   // -> { dealId, cookie, dealDbPath, childEnv }
//   ... startInstrumentedServer({ env: scratch.childEnv }) ...
//   await scratch.cleanup();                                         // idempotent

const fs = require('fs');
const os = require('os');
const path = require('path');
const { killAllInstrumentedServers, assertEnoughDisk } = require('./instrumented-server.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const COMMITTED = { demo: path.join(REPO_ROOT, 'data', 'demo.db'), control: path.join(REPO_ROOT, 'data', 'control.db') };

async function backupReadOnly(src, dest) {
  // [security] IN-B04 (12-REVIEW-B): the committed file is read through the one
  // guard-aware helper (db/dbFiles.js openReadOnlySnapshot): SQLite read-only,
  // never created, and any -shm/-wal sidecar the read-only WAL open created
  // next to the committed file is removed on close. Required lazily: the
  // calling script points every MA_* path at its scratch dir first.
  const { openReadOnlySnapshot } = require('../../../db/dbFiles.js');
  const db = openReadOnlySnapshot(src);
  try { await db.backup(dest); } finally { db.close(); }
}

function createScratch({ prefix, adminToken = 'gsd-perf-scratch-token' } = {}) {
  let tmpDir = null;
  let cleanupPromise = null;
  let stopServer = null;

  function cleanup() {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        try { if (stopServer) await stopServer(); } catch (e) { /* best effort */ }
        killAllInstrumentedServers();
        await new Promise((resolve) => setTimeout(resolve, 150));
        try { if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
      })();
    }
    return cleanupPromise;
  }
  // The SIGINT/SIGTERM handlers live in each script (visible at the top level,
  // and what the 12-05 verify greps for): they call scratch.cleanup().

  return {
    cleanup,
    /** Register the function that stops the measured server (called first on cleanup). */
    onStop(fn) { stopServer = fn; },
    get tmpDir() { return tmpDir; },

    async setup({ username, role, volume }) {
      assertEnoughDisk();
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'gsd-perf-'));
      fs.mkdirSync(path.join(tmpDir, 'deals'), { recursive: true });
      const paths = {
        MA_CONTROL_DB_PATH: path.join(tmpDir, 'control.db'),
        MA_RUNTIME_DB_PATH: path.join(tmpDir, 'runtime.db'),
        MA_DEMO_DB_PATH: path.join(tmpDir, 'demo.db'),
        MA_DEALS_DIR: path.join(tmpDir, 'deals'),
        MA_AUDIT_DB_PATH: path.join(tmpDir, 'audit.db'),
      };
      Object.assign(process.env, paths, { ADMIN_TOKEN: adminToken });
      for (const k of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN']) delete process.env[k];

      await backupReadOnly(COMMITTED.demo, paths.MA_DEMO_DB_PATH);
      await backupReadOnly(COMMITTED.control, paths.MA_CONTROL_DB_PATH);

      // The parent opens ONLY the scratch copies (MA_* is set before first require).
      const store = require('../../../db/store.js');
      const dbFiles = require('../../../db/dbFiles.js');
      const controlStore = require('../../../db/controlStore.js');
      const sessionsDb = require('../../../db/sessions.js');
      const { createDealDatabase } = require('../../../db/dealSeed.js');
      for (const p of Object.values(paths)) {
        if (p !== paths.MA_DEALS_DIR && path.resolve(p).startsWith(path.join(REPO_ROOT, 'data') + path.sep)) {
          throw new Error(`scratch-deal: ${p} resolves inside the committed data/ directory`);
        }
      }

      const deal = controlStore.createDeal({
        name: 'Perf Deal', targetCompany: 'Perf Target Co', members: [username], createdBy: 'perf-script',
      });
      createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
      controlStore.createAccount({
        username, name: username, role, disabled: false, mustChangePassword: false,
        createdAt: new Date().toISOString(), createdBy: 'perf-script',
      });
      const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
      const token = sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 2 * 60 * 60 * 1000 });
      sessionsDb.bindSessionDeal(runtimeConn, token, deal.id);

      const dealDbPath = dbFiles.dealDbPath(deal.id);
      let seeded = null;
      if (volume) {
        const { seedVolumeDeal } = require('./volume-deal.js');
        seeded = seedVolumeDeal(Object.assign({ dealDbPath }, volume));
      }
      const childEnv = Object.assign({ ADMIN_TOKEN: adminToken }, paths);
      return { dealId: deal.id, cookie: `ma_session=${token}`, dealDbPath, childEnv, seeded };
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

module.exports = { createScratch, sleep, percentile, fmt, REPO_ROOT };
