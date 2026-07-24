// CR-01 / CR-02 / WR-03: proves writeDb()'s snapshot-tagged merge correctly
// persists position changes (reorders, non-tail inserts) and never
// resurrects a row deleted by a concurrent writer.
//
// Run via `node --test` (bare — NOT `node --test test/`, see WR-02).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');

const SOURCE_PATH = path.join(__dirname, '..', 'db.json');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-writedb-merge-test-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

function freshStore(dbPath) {
  runMigration(SOURCE_PATH, dbPath);
  delete require.cache[require.resolve('../db/store.js')];
  const store = require('../db/store.js');
  store.initDb(dbPath);
  return store;
}

test('writeDb: pure reorder (no content change) persists the new order (CR-01)', () => {
  const dbPath = tempDbPath('reorder');
  try {
    const store = freshStore(dbPath);

    const seeded = store.readDb();
    // Seed a known 3-item questions array so this test isn't at the mercy of
    // whatever db.json happens to contain.
    seeded.questions = [
      { id: 'q1', text: 'Q1' },
      { id: 'q2', text: 'Q2' },
      { id: 'q3', text: 'Q3' },
    ];
    store.writeDb(seeded);

    const before = store.readDb();
    assert.deepStrictEqual(before.questions.map((q) => q.id), ['q1', 'q2', 'q3'], 'sanity: seed order as expected');

    // Reorder only — same 3 objects, no content change, new array order.
    before.questions = [before.questions[2], before.questions[1], before.questions[0]];
    store.writeDb(before);

    const after = store.readDb();
    assert.deepStrictEqual(
      after.questions.map((q) => q.id),
      ['q3', 'q2', 'q1'],
      'reorder-only write must persist the new order'
    );
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('writeDb: non-tail insert preserves exact order of untouched trailing items (CR-01)', () => {
  const dbPath = tempDbPath('nontail-insert');
  try {
    const store = freshStore(dbPath);

    const seeded = store.readDb();
    seeded.questions = [
      { id: 'q1', text: 'Q1' },
      { id: 'q2', text: 'Q2' },
      { id: 'q3', text: 'Q3' },
    ];
    store.writeDb(seeded);

    const before = store.readDb();
    // Insert a brand-new item at index 1 (not the tail).
    before.questions = [
      before.questions[0],
      { id: 'qNew', text: 'Inserted' },
      before.questions[1],
      before.questions[2],
    ];
    store.writeDb(before);

    const after = store.readDb();
    assert.deepStrictEqual(
      after.questions.map((q) => q.id),
      ['q1', 'qNew', 'q2', 'q3'],
      'non-tail insert must not desync seq for untouched trailing items'
    );
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('writeDb: a row deleted by one writer is not resurrected by a concurrent stale-edit writer (CR-02)', () => {
  const dbPath = tempDbPath('delete-vs-edit');
  try {
    const store = freshStore(dbPath);

    const seeded = store.readDb();
    seeded.pulses = [
      { id: 'p1', employeeName: 'A', rating: 5, comment: 'seed', type: 'general' },
      { id: 'p2', employeeName: 'B', rating: 3, comment: 'seed', type: 'general' },
    ];
    store.writeDb(seeded);

    // Two independent readers, both capture their own baseline BEFORE either
    // writes — this is the interleave that reproduces the resurrection bug.
    const reqA = store.readDb(); // will delete p2
    const reqB = store.readDb(); // will edit p2 on a now-stale snapshot

    reqA.pulses = reqA.pulses.filter((p) => p.id !== 'p2');
    reqB.pulses = reqB.pulses.map((p) => (p.id === 'p2' ? { ...p, rating: 1 } : p));

    store.writeDb(reqA); // A's delete commits first
    store.writeDb(reqB); // B's stale edit commits second

    const after = store.readDb();
    assert.ok(!after.pulses.some((p) => p.id === 'p2'), 'p2 must stay deleted — must not be resurrected by B\'s stale edit');
    assert.ok(after.pulses.some((p) => p.id === 'p1'), 'p1 must be untouched');
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('writeDb: two concurrent adds to the same collection both survive (no regression of FND-03 guarantee)', () => {
  const dbPath = tempDbPath('concurrent-add-regression');
  try {
    const store = freshStore(dbPath);

    const seeded = store.readDb();
    seeded.pulses = [{ id: 'p1', employeeName: 'A', rating: 5, comment: 'seed', type: 'general' }];
    store.writeDb(seeded);

    const reqA = store.readDb();
    const reqB = store.readDb();

    reqA.pulses = reqA.pulses.concat([{ id: 'concurrent_a', employeeName: 'Writer A', rating: 5, comment: 'a', type: 'general' }]);
    reqB.pulses = reqB.pulses.concat([{ id: 'concurrent_b', employeeName: 'Writer B', rating: 4, comment: 'b', type: 'general' }]);

    store.writeDb(reqA);
    store.writeDb(reqB);

    const after = store.readDb();
    assert.strictEqual(after.pulses.length, 3, 'both concurrent additions plus the original seed must survive');
    assert.ok(after.pulses.some((p) => p.id === 'concurrent_a'));
    assert.ok(after.pulses.some((p) => p.id === 'concurrent_b'));
    assert.ok(after.pulses.some((p) => p.id === 'p1'));
  } finally {
    cleanupDbFile(dbPath);
  }
});

test('writeDb: throws if called with data that was not produced by readDb() (missing __snapshot) (WR-03)', () => {
  const dbPath = tempDbPath('missing-snapshot');
  try {
    const store = freshStore(dbPath);
    assert.throws(
      () => store.writeDb({ questions: [] }),
      /missing __snapshot/,
      'writeDb() must throw loudly rather than silently defaulting to an empty snapshot'
    );
  } finally {
    cleanupDbFile(dbPath);
  }
});
