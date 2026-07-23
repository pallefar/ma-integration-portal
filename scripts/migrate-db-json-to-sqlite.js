#!/usr/bin/env node
// Re-runnable, verified db.json -> SQLite migration (FND-01 / D-06).
//
// Usage:
//   node scripts/migrate-db-json-to-sqlite.js [--source db.json] [--out data/ma-portal.db] [--verify]
//
// - Reads --source with readFileSync ONLY; never writes to the source path
//   (T-01-03 — self-inflicted data loss is a Tampering threat this script must
//   never be capable of, even on a partial/failed run).
// - DROPs + re-CREATEs every table (schema.sql) then, in ONE transaction,
//   inserts every item of every collection, preserving each item's own
//   existing id verbatim (never re-minted) and recording its source array
//   index as `seq` for exact reconstruction order.
// - Builds the output at a temporary path and finalizes (renames) it only on
//   full success — a failed run never leaves a half-written database at --out.
// - --verify: opens the freshly-written --out via db/store, reconstructs the
//   full object, and asserts canonicalJSON equality per collection item PLUS
//   per-collection row-count parity against the source — exiting non-zero on
//   any mismatch. This is the gate that closes FND-01/D-06.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { ARRAY_COLLECTIONS, SINGLETON_KEYS } = require('../db/collections');
const store = require('../db/store');

const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

function parseArgs(argv) {
  const args = { source: 'db.json', out: path.join('data', 'ma-portal.db'), verify: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') args.source = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--verify') args.verify = true;
    else if (a.startsWith('--source=')) args.source = a.slice('--source='.length);
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length);
  }
  return args;
}

// Key-order-agnostic structural equality — JSON.stringify's key order depends
// on object insertion order, which would produce false diff failures if
// compared as plain strings without canonicalizing first.
function canonicalize(v) {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => { acc[k] = canonicalize(v[k]); return acc; }, {});
  }
  return v;
}
function canonicalJSON(v) { return JSON.stringify(canonicalize(v)); }

function runMigration(sourcePath, outPath) {
  const resolvedSource = path.resolve(sourcePath);
  // Read-only access to the source — this is the ONLY touch of sourcePath in
  // this entire script.
  const raw = fs.readFileSync(resolvedSource, 'utf8');
  const source = JSON.parse(raw);

  const resolvedOut = path.resolve(outPath);
  const outDir = path.dirname(resolvedOut);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Build at a temp path; only rename over --out on full success, so a
  // crash/error mid-migration never leaves a half-written database at the
  // real output path.
  const tmpPath = path.join(outDir, `.${path.basename(resolvedOut)}.migrating-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.tmp`);
  // Clean up any stale sidecar files that might exist from a prior aborted run.
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpPath + ext); } catch (e) { /* ignore */ }
  }

  const db = new Database(tmpPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    // DROP + CREATE: this script always produces a fresh table set from the
    // source snapshot, never incrementally merges into an existing file.
    for (const key of ARRAY_COLLECTIONS) {
      db.exec(`DROP TABLE IF EXISTS ${key}`);
    }
    db.exec('DROP TABLE IF EXISTS app_state');
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

    const insertAll = db.transaction(() => {
      for (const key of ARRAY_COLLECTIONS) {
        const items = source[key] || [];
        const insert = db.prepare(`INSERT INTO ${key} (id, project_id, seq, data) VALUES (?, ?, ?, ?)`);
        items.forEach((item, i) => {
          const id = store.idOf(item);
          const projectId = store.projectIdOf(item);
          insert.run(id, projectId, i, JSON.stringify(item));
        });
      }
      for (const key of SINGLETON_KEYS) {
        if (source[key] !== undefined) {
          db.prepare('INSERT INTO app_state (key, data) VALUES (?, ?)').run(key, JSON.stringify(source[key]));
        }
      }
    });
    insertAll();
  } finally {
    db.close();
  }

  // Finalize: rename the temp file (+ WAL/SHM sidecars, if present) over the
  // real --out path. rename() is atomic on the same filesystem.
  for (const ext of ['', '-wal', '-shm']) {
    try {
      if (fs.existsSync(tmpPath + ext)) fs.renameSync(tmpPath + ext, resolvedOut + ext);
    } catch (e) {
      if (ext === '') throw e; // the main .db file must land; sidecar rename failures are non-fatal
    }
  }

  return { source, resolvedOut };
}

function verifyMigration(source, outPath) {
  // Fresh store instance against the freshly-written file — never reuses a
  // cached connection from elsewhere in the process.
  store.initDb(outPath);
  const reconstructed = store.readDb();

  const failures = [];
  for (const key of ARRAY_COLLECTIONS) {
    const src = source[key] || [];
    const got = reconstructed[key] || [];
    if (got.length !== src.length) {
      failures.push(`row-count mismatch for ${key}: source=${src.length} reconstructed=${got.length}`);
      continue;
    }
    for (let i = 0; i < src.length; i++) {
      if (canonicalJSON(got[i]) !== canonicalJSON(src[i])) {
        failures.push(`field-level mismatch in ${key}[${i}]`);
      }
    }
  }
  for (const key of SINGLETON_KEYS) {
    if (canonicalJSON(reconstructed[key]) !== canonicalJSON(source[key])) {
      failures.push(`singleton mismatch for ${key}`);
    }
  }

  if (failures.length) {
    console.error('MIGRATION VERIFY FAILED:');
    for (const f of failures) console.error(' - ' + f);
    return false;
  }
  console.log(`Migration verify OK: ${ARRAY_COLLECTIONS.length} collections + ${SINGLETON_KEYS.length} singletons match source exactly (row-count parity + canonical-JSON field equality).`);
  return true;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Migrating ${args.source} -> ${args.out}${args.verify ? ' (--verify)' : ''}`);
  const { source, resolvedOut } = runMigration(args.source, args.out);
  console.log(`Migration complete: ${resolvedOut}`);

  if (args.verify) {
    const ok = verifyMigration(source, resolvedOut);
    if (!ok) process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runMigration, verifyMigration, canonicalize, canonicalJSON };
