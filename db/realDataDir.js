// D-10-01 / D-10-08a (Phase 10): first-boot preparation of the REAL-DEAL data
// directory. server.js calls ensureRealDataDir() before it opens ANY database,
// so by the time the first connection is made the directory exists as 0700 and
// holds an account-less control.db plus a demo.db copy.
//
// [security] What this module guarantees in real-deal mode (MA_MODE=real):
//   1. No resolved database path (control/demo/runtime/audit) is a committed
//      data/*.db file — otherwise it throws before touching anything (T-10-01).
//   2. The data directory is created 0700 and re-chmodded 0700 even when it
//      pre-existed (it is ours, unlike an arbitrary MA_*_PATH parent).
//   3. control.db is seeded from the COMMITTED control.db, which is only ever
//      READ — the copy is made to a `.seeding-<random>` temp name, stripped of
//      every demo account and stale registry row (T-10-02), integrity-checked,
//      checkpointed and then published atomically. A crashed seed therefore
//      never leaves a half-built control.db that a later boot would trust.
//   4. demo.db is seeded as a plain copy so the demonstration lane still works
//      on a real host without ever sharing a file with the committed repo.
//
// The audit event for the seed is deliberately NOT written here: audit.db is
// opened lazily later and this module must stay free of db/auditHook so it can
// never open audit.db before the directory exists.
//
// Outside real mode this is a no-op — dev/demo behaviour is unchanged.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const dbFiles = require('./dbFiles');

function refuseCommitted(label, p) {
  if (dbFiles.isCommittedDbPath(p)) {
    throw new Error(
      `[security] real-deal mode refuses to use the committed database file for ${label}: ${path.resolve(p)} — ` +
      'real acquisition data must never be written into a git-tracked file. Unset the MA_*_PATH override or point it at a gitignored directory.'
    );
  }
}

// Atomic create-if-absent: link(2) fails with EEXIST when another booting
// process already published the target, so two simultaneous first boots can
// never replace a database the first one is already serving. Falls back to
// rename where hard links are unavailable (and the target is still absent).
function publish(tempPath, targetPath) {
  try {
    fs.linkSync(tempPath, targetPath);
    fs.unlinkSync(tempPath);
    return true;
  } catch (e) {
    if (e.code === 'EEXIST') {
      fs.unlinkSync(tempPath);
      return false;
    }
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(tempPath);
      return false;
    }
    fs.renameSync(tempPath, targetPath);
    return true;
  }
}

function removeSidecars(file) {
  for (const ext of ['-wal', '-shm']) {
    try { fs.unlinkSync(file + ext); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}

// Copy `source` (read-only) to `targetPath`, optionally emptying tables on the
// copy first. Returns true when this call published the file.
function seedFrom(source, targetPath, { emptyTables = [] } = {}) {
  dbFiles.ensurePrivateDir(path.dirname(targetPath));
  const temp = path.join(path.dirname(targetPath), `.seeding-${crypto.randomBytes(6).toString('hex')}`);
  try {
    fs.copyFileSync(source, temp, fs.constants.COPYFILE_EXCL);
    const conn = new Database(temp);
    try {
      for (const table of emptyTables) conn.prepare(`DELETE FROM ${table}`).run();
      const integrity = conn.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        throw new Error(`[security] seeded copy of ${path.basename(source)} failed integrity_check: ${integrity}`);
      }
      conn.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      conn.close();
    }
    removeSidecars(temp);
    dbFiles.chmodPrivateFile(temp);
    return publish(temp, targetPath);
  } finally {
    try { fs.unlinkSync(temp); } catch (e) { /* already published or never created */ }
    removeSidecars(temp);
  }
}

function ensureRealDataDir() {
  if (!dbFiles.IS_REAL_MODE) return { mode: dbFiles.MODE };

  refuseCommitted('control.db', dbFiles.CONTROL_DB_PATH);
  refuseCommitted('demo.db', dbFiles.DEMO_DB_PATH);
  refuseCommitted('runtime.db', dbFiles.RUNTIME_DB_PATH);
  refuseCommitted('audit.db', dbFiles.AUDIT_DB_PATH);

  dbFiles.ensurePrivateDir(dbFiles.DATA_DIR);
  try { fs.chmodSync(dbFiles.DATA_DIR, 0o700); } catch (e) {
    if (!(process.platform === 'win32' && (e.code === 'EPERM' || e.code === 'ENOSYS'))) throw e;
  }

  let seededControl = false;
  let seededDemo = false;
  if (!fs.existsSync(dbFiles.CONTROL_DB_PATH)) {
    // D-10-08a: users + deals emptied; schema and the controlSettings
    // app_state row survive. Foreign keys are off on this bare connection, so
    // the DELETE order is irrelevant.
    seededControl = seedFrom(dbFiles.COMMITTED_CONTROL_DB_PATH, dbFiles.CONTROL_DB_PATH, { emptyTables: ['users', 'deals'] });
  }
  if (!fs.existsSync(dbFiles.DEMO_DB_PATH)) {
    seededDemo = seedFrom(dbFiles.COMMITTED_DEMO_DB_PATH, dbFiles.DEMO_DB_PATH);
  }

  console.log(`[security] real-deal mode: data directory ${dbFiles.DATA_DIR}`);
  if (seededControl) {
    console.log('[security] real-deal mode: seeded a new control database with 0 accounts — create the first admin with `node scripts/bootstrap-admin.js`.');
  }
  return { mode: dbFiles.MODE, dataDir: dbFiles.DATA_DIR, seededControl, seededDemo };
}

module.exports = { ensureRealDataDir };
