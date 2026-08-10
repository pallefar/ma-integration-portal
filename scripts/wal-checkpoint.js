#!/usr/bin/env node
// [security/data-integrity] WAL checkpoint helper.
//
// The committed data/*.db files use SQLite WAL mode. A write can land only in
// the gitignored `<db>-wal` sidecar and NOT in the main .db file — so `git
// status` shows the .db as clean while real, uncommitted data sits in the
// sidecar. This script forces a TRUNCATE checkpoint on every git-tracked .db,
// flushing the WAL back into the main file so what git sees is what the DB
// holds. Run it before committing after any seed/migration, or let the
// .githooks/pre-commit hook run the equivalent check for you.
//
// Usage: node scripts/wal-checkpoint.js   (exits 0; prints each file's result)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const tracked = execSync('git ls-files "*.db"', { cwd: repoRoot, encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

if (!tracked.length) {
  console.log('wal-checkpoint: no git-tracked .db files found.');
  process.exit(0);
}

let anyFlushed = false;
for (const rel of tracked) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) continue;
  const walPath = abs + '-wal';
  const walBytes = fs.existsSync(walPath) ? fs.statSync(walPath).size : 0;
  // A read-only file (e.g. the Phase-1 archived data/ma-portal.db, chmod 444)
  // cannot accept writes, so it cannot carry a live WAL trap — skip it rather
  // than crash with SQLITE_READONLY on the checkpoint pragma.
  try {
    fs.accessSync(abs, fs.constants.W_OK);
  } catch (_) {
    console.log(`wal-checkpoint: ${rel} — read-only, skipped (cannot accumulate WAL writes).`);
    continue;
  }
  const db = new Database(abs);
  try {
    // TRUNCATE: checkpoint the full WAL into the main file AND shrink the WAL to zero.
    const res = db.pragma('wal_checkpoint(TRUNCATE)');
    const row = Array.isArray(res) ? res[0] : res;
    const flushed = walBytes > 0;
    if (flushed) anyFlushed = true;
    console.log(
      `wal-checkpoint: ${rel} — wal ${walBytes}B before, checkpoint ${JSON.stringify(row)}`
    );
  } finally {
    db.close();
  }
}

console.log(
  anyFlushed
    ? 'wal-checkpoint: flushed WAL data into committed .db file(s) — re-stage them if changed.'
    : 'wal-checkpoint: all tracked .db files were already fully checkpointed.'
);
process.exit(0);
