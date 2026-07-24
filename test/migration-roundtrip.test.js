// FND-01 / D-06: the migration is re-runnable and its result is verified by a
// full round-trip deep diff (canonical-JSON equality) plus per-collection
// row-count parity, across all 38 top-level db.json collections.
//
// node:test — Node's built-in runner, zero new dependency (this repo has no
// test framework installed before this phase). Run via `node --test` (bare —
// this repo's default test discovery), or `npm test`. `node --test test/`
// does NOT work on this project's target Node version (v22.18.0) — it
// errors with "Cannot find module '.../test'".

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { ARRAY_COLLECTIONS, SINGLETON_KEYS } = require('../db/collections');
const { runMigration, canonicalJSON } = require('../scripts/migrate-db-json-to-sqlite.js');

const SOURCE_PATH = path.join(__dirname, '..', 'db.json');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-migration-test-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

test('migration-roundtrip: reconstructs all 38 collections with exact canonical-JSON equality and row-count parity', () => {
  const outPath = tempDbPath('roundtrip');
  try {
    const { source, resolvedOut } = runMigration(SOURCE_PATH, outPath);

    // Fresh store instance against the freshly-migrated file.
    delete require.cache[require.resolve('../db/store.js')];
    const store = require('../db/store.js');
    store.initDb(resolvedOut);
    const reconstructed = store.readDb();

    assert.strictEqual(
      ARRAY_COLLECTIONS.length + SINGLETON_KEYS.length,
      38,
      'the ground-truth inventory must cover exactly 38 top-level keys'
    );

    for (const key of ARRAY_COLLECTIONS) {
      const src = source[key] || [];
      const got = reconstructed[key] || [];
      assert.strictEqual(got.length, src.length, `row-count mismatch for ${key}`);
      for (let i = 0; i < src.length; i++) {
        assert.strictEqual(canonicalJSON(got[i]), canonicalJSON(src[i]), `field-level mismatch in ${key}[${i}]`);
      }
    }
    for (const key of SINGLETON_KEYS) {
      assert.strictEqual(canonicalJSON(reconstructed[key]), canonicalJSON(source[key]), `singleton mismatch for ${key}`);
    }

    // The reconstructed object must never leak the internal __snapshot bookkeeping.
    assert.ok(!Object.keys(reconstructed).includes('__snapshot'), '__snapshot must not be an enumerable key');
  } finally {
    cleanupDbFile(outPath);
  }
});

test('migration-roundtrip: re-running the migration from the same source reconstructs identically (re-runnable)', () => {
  const outPath1 = tempDbPath('rerun1');
  const outPath2 = tempDbPath('rerun2');
  try {
    const run1 = runMigration(SOURCE_PATH, outPath1);
    const run2 = runMigration(SOURCE_PATH, outPath2);

    delete require.cache[require.resolve('../db/store.js')];
    const store = require('../db/store.js');

    store.initDb(run1.resolvedOut);
    const reconstructed1 = store.readDb();
    store.initDb(run2.resolvedOut);
    const reconstructed2 = store.readDb();

    assert.strictEqual(
      canonicalJSON(reconstructed1),
      canonicalJSON(reconstructed2),
      'two migrations from the same source snapshot must reconstruct to identical canonical JSON'
    );

    // ids must be reused verbatim (not re-minted) across independent runs.
    for (const key of ARRAY_COLLECTIONS) {
      const ids1 = (reconstructed1[key] || []).map((item) => item.id !== undefined ? item.id : item.username);
      const ids2 = (reconstructed2[key] || []).map((item) => item.id !== undefined ? item.id : item.username);
      assert.deepStrictEqual(ids1, ids2, `ids must be identical and order-preserved for ${key} across re-runs`);
    }
  } finally {
    cleanupDbFile(outPath1);
    cleanupDbFile(outPath2);
  }
});
