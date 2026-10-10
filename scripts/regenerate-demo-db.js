#!/usr/bin/env node
// [security/data-integrity] Rule-5 regeneration of the committed demo database
// (db/migrate.js AUTHORING RULE 5, PD-5; Phase 13 plan 13-05).
//
// A boot never writes data/demo.db: the version runner REPORTS a committed file
// that needs a non-baseline migration as not-ready
// ('committed-file-needs-regeneration'). When a deal-family migration is
// released, run this script once and commit data/demo.db ALONE in a deliberate
// commit whose message carries this script's output.
//
// What it does, in order:
//   1. refuses MA_MODE=real (the committed files are never touched by a real host);
//   2. checkpoints data/demo.db (wal_checkpoint TRUNCATE — the WAL trap) and
//      records its sha256 and user_version;
//   3. copies it to a private temp directory — the copy is NOT a committed path,
//      so db/dbFiles.js openDbFile() runs the pending migrations on it;
//   4. PRAGMA integrity_check must be 'ok';
//   5. checkpoint TRUNCATE + close (no -wal/-shm left behind);
//   6. renames the copy over data/demo.db (same filesystem — the scratch dir is
//      created next to it) and prints before/after sha256, user_version and
//      the per-value hashes the migrations logged.
//
// It runs the same openDbFile() path a boot would, so it is idempotent: a file
// already at the latest version is left byte-identical (nothing is replaced).
//
// Usage: node scripts/regenerate-demo-db.js   (from the repository root)

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

if (process.env.MA_MODE === 'real') {
  console.error('regenerate-demo-db: refusing to run with MA_MODE=real — the committed demo database is a dev/demo artifact.');
  process.exit(2);
}

const REPO_ROOT = path.resolve(__dirname, '..');
const DEMO_DB = process.env.MA_REGEN_DEMO_DB || path.join(REPO_ROOT, 'data', 'demo.db');
const SCHEMA = path.join(REPO_ROOT, 'db', 'schema.sql');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function checkpoint(file) {
  const conn = new Database(file);
  try {
    conn.pragma('wal_checkpoint(TRUNCATE)');
    return conn.pragma('user_version', { simple: true });
  } finally {
    conn.close();
  }
}

function main() {
  if (!fs.existsSync(DEMO_DB)) {
    console.error(`regenerate-demo-db: ${DEMO_DB} does not exist`);
    process.exit(2);
  }
  const { loadMigrations } = require('../db/migrate');
  const latest = loadMigrations('deal').length;

  const versionBefore = checkpoint(DEMO_DB);
  const shaBefore = sha256File(DEMO_DB);
  const modeBefore = fs.statSync(DEMO_DB).mode & 0o777;
  console.log(`regenerate-demo-db: ${path.relative(REPO_ROOT, DEMO_DB)} user_version ${versionBefore} (latest ${latest}) sha256 ${shaBefore}`);

  if (versionBefore >= latest) {
    console.log('regenerate-demo-db: already at the latest deal-family version — nothing to do.');
    return;
  }

  // Scratch dir beside the target so the final rename never crosses a filesystem.
  const scratch = fs.mkdtempSync(path.join(path.dirname(DEMO_DB), '.regen-demo-'));
  const copy = path.join(scratch, 'demo.db');
  try {
    fs.copyFileSync(DEMO_DB, copy);
    const { openDbFile } = require('../db/dbFiles');
    const conn = openDbFile(copy, SCHEMA); // non-committed path -> the runner applies pending migrations
    let versionAfter;
    try {
      const integrity = conn.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`integrity_check failed: ${integrity}`);
      conn.pragma('wal_checkpoint(TRUNCATE)');
      versionAfter = conn.pragma('user_version', { simple: true });
    } finally {
      conn.close();
    }
    if (versionAfter !== latest) throw new Error(`regenerated file is at user_version ${versionAfter}, expected ${latest}`);
    for (const sidecar of ['-wal', '-shm']) {
      let size = 0;
      try { size = fs.statSync(copy + sidecar).size; } catch (e) { /* absent */ }
      if (sidecar === '-wal' && size > 0) throw new Error('regenerated copy still has a non-empty -wal');
      try { fs.unlinkSync(copy + sidecar); } catch (e) { /* absent */ }
    }
    // Stale (empty, gitignored) sidecars of the OLD file must not pair with the new main file.
    for (const sidecar of ['-wal', '-shm']) {
      let size = 0;
      try { size = fs.statSync(DEMO_DB + sidecar).size; } catch (e) { continue; }
      if (sidecar === '-wal' && size > 0) throw new Error(`${DEMO_DB}-wal is not empty after checkpoint — refusing to replace`);
      fs.unlinkSync(DEMO_DB + sidecar);
    }
    fs.chmodSync(copy, modeBefore);
    fs.renameSync(copy, DEMO_DB);
    console.log(`regenerate-demo-db: ${path.relative(REPO_ROOT, DEMO_DB)} user_version ${versionAfter} sha256 ${sha256File(DEMO_DB)}`);
    console.log(`regenerate-demo-db: before sha256 ${shaBefore}`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main();
