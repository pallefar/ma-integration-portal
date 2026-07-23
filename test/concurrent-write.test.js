// FND-03: two interleaved read-modify-write operations that each add a
// DIFFERENT item to the SAME collection must both survive — no lost update.
//
// This is the load-bearing proof that db/store.js's writeDb() diffs against
// the REQUEST's OWN __snapshot (captured at readDb() time), not live DB
// state. A naive "diff the incoming array against current DB state, delete
// what's missing" implementation would have the second writer's write delete
// the first writer's concurrently-added row, since the second writer's own
// array never contained it. See 01-RESEARCH.md Pitfall 2.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test test/`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');

const SOURCE_PATH = path.join(__dirname, '..', 'db.json');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-concurrent-write-test-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

test('concurrent-write: two same-collection concurrent adds both survive (no lost update)', () => {
  const dbPath = tempDbPath('same-collection');
  try {
    // Seed a real, non-empty collection via the migration so this test exercises
    // the same data shape production traffic would.
    runMigration(SOURCE_PATH, dbPath);

    delete require.cache[require.resolve('../db/store.js')];
    const store = require('../db/store.js');
    store.initDb(dbPath);

    const before = store.readDb();
    const originalCount = before.pulses.length;
    assert.ok(originalCount > 0, 'fixture must seed a non-empty pulses collection for this test to be meaningful');

    // Two independent "requests" each read the collection BEFORE either writes —
    // this is the interleave that reproduces the lost-update race: both baselines
    // are captured before any write happens.
    const requestA = store.readDb();
    const requestB = store.readDb();

    requestA.pulses = requestA.pulses.concat([{ id: 'concurrent_a', employeeName: 'Writer A', rating: 5, comment: 'writer A add', type: 'general' }]);
    requestB.pulses = requestB.pulses.concat([{ id: 'concurrent_b', employeeName: 'Writer B', rating: 4, comment: 'writer B add', type: 'general' }]);

    // Deterministic interleave: A commits first, then B — B's write must NOT
    // delete A's concurrently-added row, because A's id was never in B's own
    // __snapshot to begin with.
    store.writeDb(requestA);
    store.writeDb(requestB);

    const after = store.readDb();
    assert.strictEqual(after.pulses.length, originalCount + 2, 'both concurrent additions must survive — no lost update');
    assert.ok(after.pulses.some((p) => p.id === 'concurrent_a'), 'writer A\'s addition must survive');
    assert.ok(after.pulses.some((p) => p.id === 'concurrent_b'), 'writer B\'s addition must survive');

    // No pre-existing item was lost either.
    for (const item of before.pulses) {
      assert.ok(after.pulses.some((p) => p.id === item.id), `pre-existing pulse ${item.id} must not have been dropped`);
    }
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('concurrent-write: two concurrent adds to DIFFERENT collections both survive', () => {
  const dbPath = tempDbPath('cross-collection');
  try {
    runMigration(SOURCE_PATH, dbPath);

    delete require.cache[require.resolve('../db/store.js')];
    const store = require('../db/store.js');
    store.initDb(dbPath);

    const before = store.readDb();
    const pulsesBefore = before.pulses.length;
    const alertsBefore = before.alerts.length;

    const requestA = store.readDb();
    const requestB = store.readDb();

    requestA.pulses = requestA.pulses.concat([{ id: 'cross_pulse', employeeName: 'Writer A', rating: 3, comment: 'cross-collection A', type: 'general' }]);
    requestB.alerts = requestB.alerts.concat([{ id: 'cross_alert', title: 'Writer B alert', severity: 'low' }]);

    store.writeDb(requestA);
    store.writeDb(requestB);

    const after = store.readDb();
    assert.strictEqual(after.pulses.length, pulsesBefore + 1, 'cross-collection write must not lose the pulses addition');
    assert.strictEqual(after.alerts.length, alertsBefore + 1, 'cross-collection write must not lose the alerts addition');
  } finally {
    cleanupDbFile(dbPath);
  }
});
