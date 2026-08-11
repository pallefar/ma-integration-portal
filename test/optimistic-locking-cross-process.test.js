// CONC-02 (Phase 9, Plan 01 — Task 3): proves ROADMAP success criterion 3
// against REAL concurrency — two real OS processes writing the same SQLite
// deal file, never an in-process simulation. 09-RESEARCH.md's own Validation
// Architecture section carries forward Phase 8's documented pitfall: an
// in-process contention simulation DEADLOCKS (better-sqlite3 is synchronous,
// Node is single-threaded — a busy-wait blocks the only thread and a
// releasing callback in the SAME process could never fire). Reuses
// test/concurrency-busy-retry.test.js's spawned-child-process mechanic
// verbatim, requiring db/store.js directly against a shared deal file (no
// HTTP/auth layer — this proves the storage-layer guarantee in isolation,
// the same shape as that file's own Task 2).
//
// Three cases:
//   (a) Same record, two writers — exactly one commits, the other is
//       rejected by the version predicate.
//   (b) Different records, two writers — both commit, proving the lock is
//       per-record, not per-collection.
//   (c) Update racing a delete on the SAME record — the surviving outcome
//       is a clean delete or a clean update, never a resurrected row, and
//       the losing writer sees a typed conflict, never a false success.
//
// Two-phase handshake: each child readDb()s, reports READY, then BLOCKS on
// its own stdin until the parent has confirmed BOTH children are holding a
// stale-from-then-on read — this is what makes the race genuinely
// deterministic (both children provably hold the SAME pre-conflict version)
// rather than hoping two independently-scheduled processes happen to
// overlap.
//
// node:test — Node's built-in runner. Run via `node --test
// test/optimistic-locking-cross-process.test.js` (or `npm test`). Never
// `node --test test/` (the directory argument is mis-parsed on this Node
// version).

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('node:child_process');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-optimistic-locking-cross-process-split-'));

// Plan 07 hardening: every temp deal-db file this test creates lives INSIDE
// this file's own TMP_DIR, never directly under the shared system os.tmpdir()
// root — a real intermittent flake ("SqliteError: unable to open database
// file") was observed twice this session under concurrent temp-dir load
// (multiple sibling worktree agents' test suites hammering the SAME shared
// system tmp directory at once). Scoping every file this test opens to a
// directory this process alone owns removes that shared-contention surface
// entirely, rather than merely retrying through it.
function tempDbPath(label) {
  return path.join(TMP_DIR, `gsd-optimistic-locking-cross-process-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

/**
 * Retries a synchronous SQLite-opening operation on the specific transient
 * "unable to open database file" (SQLITE_CANTOPEN) failure shape — never on
 * any other error, which surfaces immediately. Belt-and-braces alongside the
 * TMP_DIR-scoping above: even a directory this process alone owns can still
 * see a rare transient stat/open failure on a heavily-loaded shared host.
 */
function openWithRetry(fn, attempts = 3, delayMs = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (i === attempts - 1 || !/unable to open database file/i.test(msg)) throw e;
      const until = Date.now() + delayMs * (i + 1);
      while (Date.now() < until) { /* deliberate synchronous busy-wait — this path is a rare fallback, not the common case */ }
    }
  }
}
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');

test.after(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

const STORE_ABS_PATH = path.join(__dirname, '..', 'db', 'store.js');

// Inline child script (node -e): requires db/store.js directly (a SEPARATE
// OS process), reads the target record once, reports READY, then blocks on
// stdin. Once released, performs its action (update the title, or delete
// the row) and calls writeDb() against ITS OWN stale readDb() snapshot. A
// caught typed conflict (e.isConflict) is a SUCCESSFUL proof outcome, not a
// script failure — it exits 0 either way, reporting a JSON RESULT line the
// parent parses.
//
// Plan 07: generalized from a RAID-only script (`db.raidEntries` hardcoded)
// to take the target COLLECTION as its own argv entry — argv[1] — so the
// SAME script proves the identical per-record guarantee on integration
// tasks and synergy initiatives, not just RAID. `store.initDb(dbPath)` is
// wrapped in the SAME open-retry the parent process uses (see
// openWithRetry() above) for the identical "unable to open database file"
// hardening, since this open happens in a freshly-spawned child process
// that has no visibility into the parent's own retry.
const CHILD_SCRIPT = `
  const store = require(${JSON.stringify(STORE_ABS_PATH)});
  const dbPath = process.argv[1];
  const collection = process.argv[2];
  const recordId = process.argv[3];
  const action = process.argv[4]; // 'update' or 'delete'
  const newTitle = process.argv[5] || '';
  function openWithRetryChild(fn, attempts, delayMs) {
    for (let i = 0; i < attempts; i++) {
      try { return fn(); } catch (e) {
        const msg = String((e && e.message) || '');
        if (i === attempts - 1 || !/unable to open database file/i.test(msg)) throw e;
        const until = Date.now() + delayMs * (i + 1);
        while (Date.now() < until) { /* deliberate synchronous busy-wait */ }
      }
    }
  }
  openWithRetryChild(() => store.initDb(dbPath), 3, 40);
  const db = store.readDb();
  const item = db[collection].find((r) => r.id === recordId);
  process.stdout.write('READY\\n');
  process.stdin.once('data', () => {
    try {
      if (action === 'delete') {
        db[collection] = db[collection].filter((r) => r.id !== recordId);
      } else {
        item.title = newTitle;
      }
      store.writeDb(db);
      console.log('RESULT:' + JSON.stringify({ outcome: 'committed', action: action, title: newTitle }));
      process.exit(0);
    } catch (e) {
      if (e && e.isConflict) {
        console.log('RESULT:' + JSON.stringify({ outcome: 'conflict', action: action, conflictKind: e.conflictDetail.conflictKind }));
        process.exit(0);
      }
      process.stderr.write('UNEXPECTED_ERROR: ' + (e && e.stack ? e.stack : String(e)) + '\\n');
      process.exit(1);
    }
  });
`;

/**
 * Spawns a race-participant child, waits for it to report READY (holding a
 * stale read), and returns `{ ready, release, done }` — `release()` unblocks
 * the child's stdin gate; `done` resolves with the parsed RESULT JSON once
 * the child exits (rejecting on a non-zero exit or a missing RESULT line).
 * Every promise is bounded so a hung child fails the test loudly rather than
 * stalling the suite. `collection` names the target ARRAY_COLLECTIONS table
 * (e.g. 'raidEntries', 'integrationTasks', 'synergyInitiatives').
 */
function spawnRaceChild(dbPath, collection, recordId, action, newTitle) {
  const child = spawn(process.execPath, ['-e', CHILD_SCRIPT, '--', dbPath, collection, recordId, action, newTitle || ''], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c.toString(); });
  child.stderr.on('data', (c) => { stderr += c.toString(); });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child never reported READY within 5s (stdout=${stdout} stderr=${stderr})`)), 5000);
    function onData() {
      if (stdout.includes('READY')) {
        clearTimeout(timer);
        child.stdout.removeListener('data', onData);
        resolve();
      }
    }
    child.stdout.on('data', onData);
  });

  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`child never exited within 8s (stdout=${stdout} stderr=${stderr})`)), 8000);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`child exited ${code}: stdout=${stdout} stderr=${stderr}`));
      const match = stdout.match(/RESULT:(\{.*\})/);
      if (!match) return reject(new Error(`child produced no RESULT line: stdout=${stdout} stderr=${stderr}`));
      resolve(JSON.parse(match[1]));
    });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
  });

  return {
    ready,
    release() { child.stdin.write('go\n'); },
    done,
  };
}

test('optimistic-locking-cross-process (same record): two real processes racing an edit on the SAME record — exactly one commits, the other is rejected as a version conflict, and the survivor holds one writer\'s FULL submission, never a blend', async () => {
  const dealDbPath = tempDbPath('same-record');
  try {
    openWithRetry(() => runMigration(SOURCE_PATH, dealDbPath));
    const seedConn = openWithRetry(() => store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH));
    const raidRow = seedConn.prepare('SELECT id FROM raidEntries LIMIT 1').get();
    assert.ok(raidRow, 'fixture must seed at least one raidEntries row for this test to be meaningful');
    const recordId = raidRow.id;
    store.closeConnection(dealDbPath);

    const childA = spawnRaceChild(dealDbPath, 'raidEntries', recordId, 'update', 'Child A submission');
    const childB = spawnRaceChild(dealDbPath, 'raidEntries', recordId, 'update', 'Child B submission');
    await Promise.all([childA.ready, childB.ready]);
    childA.release();
    childB.release();
    const [resultA, resultB] = await Promise.all([childA.done, childB.done]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    assert.deepStrictEqual(outcomes, ['committed', 'conflict'], `expected exactly one commit and one conflict, got A=${resultA.outcome} B=${resultB.outcome}`);

    const winner = resultA.outcome === 'committed' ? resultA : resultB;
    const loser = resultA.outcome === 'committed' ? resultB : resultA;
    assert.strictEqual(loser.conflictKind, 'version', 'the losing writer must see a version conflict, not a deleted conflict');

    const finalConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const finalRow = finalConn.prepare('SELECT data FROM raidEntries WHERE id = ?').get(recordId);
    const finalData = JSON.parse(finalRow.data);
    assert.strictEqual(finalData.title, winner.title, "the stored record must equal the winning child's ENTIRE submission, never a blend of both");
    assert.strictEqual(finalData.version, 1, 'the version must have advanced by exactly one, from an unstamped legacy fixture record (D-09)');
  } finally {
    store.closeConnection(dealDbPath);
    cleanupDbFile(dealDbPath);
  }
});

test('optimistic-locking-cross-process (different records): two real processes racing edits on TWO DIFFERENT records in the same collection — both commit and both versions advance; the lock bites per record, never per collection', async () => {
  const dealDbPath = tempDbPath('different-records');
  try {
    openWithRetry(() => runMigration(SOURCE_PATH, dealDbPath));
    const seedConn = openWithRetry(() => store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH));
    const rows = seedConn.prepare('SELECT id FROM raidEntries LIMIT 2').all();
    assert.strictEqual(rows.length, 2, 'fixture must seed at least two raidEntries rows for this test to be meaningful');
    const [idA, idB] = rows.map((r) => r.id);
    store.closeConnection(dealDbPath);

    const childA = spawnRaceChild(dealDbPath, 'raidEntries', idA, 'update', 'Child A own record');
    const childB = spawnRaceChild(dealDbPath, 'raidEntries', idB, 'update', 'Child B own record');
    await Promise.all([childA.ready, childB.ready]);
    childA.release();
    childB.release();
    const [resultA, resultB] = await Promise.all([childA.done, childB.done]);

    assert.strictEqual(resultA.outcome, 'committed', 'a write to record A must never see a conflict caused by an unrelated concurrent write to record B');
    assert.strictEqual(resultB.outcome, 'committed', 'a write to record B must never see a conflict caused by an unrelated concurrent write to record A');

    const finalConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const finalA = JSON.parse(finalConn.prepare('SELECT data FROM raidEntries WHERE id = ?').get(idA).data);
    const finalB = JSON.parse(finalConn.prepare('SELECT data FROM raidEntries WHERE id = ?').get(idB).data);
    assert.strictEqual(finalA.version, 1, "record A's version must have advanced");
    assert.strictEqual(finalB.version, 1, "record B's version must have advanced");
    assert.strictEqual(finalA.title, 'Child A own record');
    assert.strictEqual(finalB.title, 'Child B own record');
  } finally {
    store.closeConnection(dealDbPath);
    cleanupDbFile(dealDbPath);
  }
});

test('optimistic-locking-cross-process (update vs delete): one process updates while another deletes the SAME record — the surviving outcome is a clean delete or a clean update, never a resurrected row, and the losing writer sees a typed conflict, never a false success', async () => {
  const dealDbPath = tempDbPath('update-vs-delete');
  try {
    openWithRetry(() => runMigration(SOURCE_PATH, dealDbPath));
    const seedConn = openWithRetry(() => store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH));
    const row = seedConn.prepare('SELECT id FROM raidEntries LIMIT 1 OFFSET 2').get();
    assert.ok(row, 'fixture must seed at least three raidEntries rows for this test to be meaningful');
    const recordId = row.id;
    store.closeConnection(dealDbPath);

    const updater = spawnRaceChild(dealDbPath, 'raidEntries', recordId, 'update', 'Racing update');
    const deleter = spawnRaceChild(dealDbPath, 'raidEntries', recordId, 'delete');
    await Promise.all([updater.ready, deleter.ready]);
    updater.release();
    deleter.release();
    const [updateResult, deleteResult] = await Promise.all([updater.done, deleter.done]);

    assert.ok(
      (updateResult.outcome === 'committed' && deleteResult.outcome === 'conflict')
        || (updateResult.outcome === 'conflict' && deleteResult.outcome === 'committed'),
      `expected exactly one of update/delete to commit and the other to be a typed conflict, got update=${updateResult.outcome} delete=${deleteResult.outcome}`
    );

    const finalConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const finalRow = finalConn.prepare('SELECT data FROM raidEntries WHERE id = ?').get(recordId);

    if (deleteResult.outcome === 'committed') {
      assert.strictEqual(finalRow, undefined, 'a committed delete must leave the row genuinely gone, never resurrected by the losing update');
      assert.strictEqual(updateResult.conflictKind, 'deleted', "the losing update must see conflictKind 'deleted' (PD-4), never a false { success: true } for a write that persisted nothing");
    } else {
      assert.ok(finalRow, 'a committed update must leave the row present');
      assert.strictEqual(JSON.parse(finalRow.data).title, updateResult.title, 'the surviving record must hold the committed update\'s value');
      assert.strictEqual(deleteResult.conflictKind, 'version', "the losing delete must see conflictKind 'version' (D-08), never a false { success: true } for a delete that persisted nothing");
    }
  } finally {
    store.closeConnection(dealDbPath);
    cleanupDbFile(dealDbPath);
  }
});

// ---------------------------------------------------------------------------
// Plan 07 (Task 2): the per-record granularity claim must be proven on MORE
// than one collection, not only on a shape (RAID entries) that happens to be
// unique to RAID. Same mechanism as the three RAID cases above, generalized
// via CHILD_SCRIPT's own `collection` argv entry — no new storage-layer or
// harness code, only new target collections.
// ---------------------------------------------------------------------------

test('optimistic-locking-cross-process (integration tasks, same record): two real processes racing an edit on the SAME integration task — exactly one commits, the other is rejected as a version conflict', async () => {
  const dealDbPath = tempDbPath('task-same-record');
  try {
    openWithRetry(() => runMigration(SOURCE_PATH, dealDbPath));
    const seedConn = openWithRetry(() => store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH));
    const taskRow = seedConn.prepare('SELECT id FROM integrationTasks LIMIT 1').get();
    assert.ok(taskRow, 'fixture must seed at least one integrationTasks row for this test to be meaningful');
    const recordId = taskRow.id;
    store.closeConnection(dealDbPath);

    const childA = spawnRaceChild(dealDbPath, 'integrationTasks', recordId, 'update', 'Child A task submission');
    const childB = spawnRaceChild(dealDbPath, 'integrationTasks', recordId, 'update', 'Child B task submission');
    await Promise.all([childA.ready, childB.ready]);
    childA.release();
    childB.release();
    const [resultA, resultB] = await Promise.all([childA.done, childB.done]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    assert.deepStrictEqual(outcomes, ['committed', 'conflict'], `expected exactly one commit and one conflict, got A=${resultA.outcome} B=${resultB.outcome}`);
    const winner = resultA.outcome === 'committed' ? resultA : resultB;
    const loser = resultA.outcome === 'committed' ? resultB : resultA;
    assert.strictEqual(loser.conflictKind, 'version', 'the losing writer must see a version conflict, not a deleted conflict');

    const finalConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const finalRow = finalConn.prepare('SELECT data FROM integrationTasks WHERE id = ?').get(recordId);
    const finalData = JSON.parse(finalRow.data);
    assert.strictEqual(finalData.title, winner.title, "the stored task must equal the winning child's ENTIRE submission, never a blend of both");
    assert.strictEqual(finalData.version, 1, 'the version must have advanced by exactly one, from an unstamped legacy fixture record (D-09)');
  } finally {
    store.closeConnection(dealDbPath);
    cleanupDbFile(dealDbPath);
  }
});

test('optimistic-locking-cross-process (integration tasks, different records): two real processes racing edits on TWO DIFFERENT tasks — both commit and both versions advance; per-record, never per-collection', async () => {
  const dealDbPath = tempDbPath('task-different-records');
  try {
    openWithRetry(() => runMigration(SOURCE_PATH, dealDbPath));
    const seedConn = openWithRetry(() => store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH));
    const rows = seedConn.prepare('SELECT id FROM integrationTasks LIMIT 2').all();
    assert.strictEqual(rows.length, 2, 'fixture must seed at least two integrationTasks rows for this test to be meaningful');
    const [idA, idB] = rows.map((r) => r.id);
    store.closeConnection(dealDbPath);

    const childA = spawnRaceChild(dealDbPath, 'integrationTasks', idA, 'update', 'Child A own task');
    const childB = spawnRaceChild(dealDbPath, 'integrationTasks', idB, 'update', 'Child B own task');
    await Promise.all([childA.ready, childB.ready]);
    childA.release();
    childB.release();
    const [resultA, resultB] = await Promise.all([childA.done, childB.done]);

    assert.strictEqual(resultA.outcome, 'committed', 'a write to task A must never see a conflict caused by an unrelated concurrent write to task B');
    assert.strictEqual(resultB.outcome, 'committed', 'a write to task B must never see a conflict caused by an unrelated concurrent write to task A');

    const finalConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const finalA = JSON.parse(finalConn.prepare('SELECT data FROM integrationTasks WHERE id = ?').get(idA).data);
    const finalB = JSON.parse(finalConn.prepare('SELECT data FROM integrationTasks WHERE id = ?').get(idB).data);
    assert.strictEqual(finalA.version, 1, "task A's version must have advanced");
    assert.strictEqual(finalB.version, 1, "task B's version must have advanced");
    assert.strictEqual(finalA.title, 'Child A own task');
    assert.strictEqual(finalB.title, 'Child B own task');
  } finally {
    store.closeConnection(dealDbPath);
    cleanupDbFile(dealDbPath);
  }
});

test('optimistic-locking-cross-process (synergy initiatives, same record): two real processes racing an edit on the SAME synergy initiative — exactly one commits, the other is rejected as a version conflict', async () => {
  const dealDbPath = tempDbPath('synergy-same-record');
  try {
    openWithRetry(() => runMigration(SOURCE_PATH, dealDbPath));
    const seedConn = openWithRetry(() => store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH));
    const synRow = seedConn.prepare('SELECT id FROM synergyInitiatives LIMIT 1').get();
    assert.ok(synRow, 'fixture must seed at least one synergyInitiatives row for this test to be meaningful');
    const recordId = synRow.id;
    store.closeConnection(dealDbPath);

    const childA = spawnRaceChild(dealDbPath, 'synergyInitiatives', recordId, 'update', 'Child A synergy submission');
    const childB = spawnRaceChild(dealDbPath, 'synergyInitiatives', recordId, 'update', 'Child B synergy submission');
    await Promise.all([childA.ready, childB.ready]);
    childA.release();
    childB.release();
    const [resultA, resultB] = await Promise.all([childA.done, childB.done]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    assert.deepStrictEqual(outcomes, ['committed', 'conflict'], `expected exactly one commit and one conflict, got A=${resultA.outcome} B=${resultB.outcome}`);
    const winner = resultA.outcome === 'committed' ? resultA : resultB;
    const loser = resultA.outcome === 'committed' ? resultB : resultA;
    assert.strictEqual(loser.conflictKind, 'version', 'the losing writer must see a version conflict, not a deleted conflict');

    const finalConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const finalRow = finalConn.prepare('SELECT data FROM synergyInitiatives WHERE id = ?').get(recordId);
    const finalData = JSON.parse(finalRow.data);
    assert.strictEqual(finalData.title, winner.title, "the stored initiative must equal the winning child's ENTIRE submission, never a blend of both");
    assert.strictEqual(finalData.version, 1, 'the version must have advanced by exactly one, from an unstamped legacy fixture record (D-09)');
  } finally {
    store.closeConnection(dealDbPath);
    cleanupDbFile(dealDbPath);
  }
});

test('optimistic-locking-cross-process (cross-collection): two real processes writing DIFFERENT collections concurrently both commit — the version predicate does not serialize unrelated work beyond Phase 8\'s own per-file write lock', async () => {
  const dealDbPath = tempDbPath('cross-collection');
  try {
    openWithRetry(() => runMigration(SOURCE_PATH, dealDbPath));
    const seedConn = openWithRetry(() => store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH));
    const raidRow = seedConn.prepare('SELECT id FROM raidEntries LIMIT 1').get();
    const taskRow = seedConn.prepare('SELECT id FROM integrationTasks LIMIT 1').get();
    assert.ok(raidRow, 'fixture must seed at least one raidEntries row for this test to be meaningful');
    assert.ok(taskRow, 'fixture must seed at least one integrationTasks row for this test to be meaningful');
    const raidId = raidRow.id;
    const taskId = taskRow.id;
    store.closeConnection(dealDbPath);

    const raidChild = spawnRaceChild(dealDbPath, 'raidEntries', raidId, 'update', 'Cross-collection RAID write');
    const taskChild = spawnRaceChild(dealDbPath, 'integrationTasks', taskId, 'update', 'Cross-collection task write');
    await Promise.all([raidChild.ready, taskChild.ready]);
    raidChild.release();
    taskChild.release();
    const [raidResult, taskResult] = await Promise.all([raidChild.done, taskChild.done]);

    // Both must commit — a version conflict here would mean the version
    // predicate is somehow entangling two UNRELATED collections' writes,
    // which it must never do. Phase 8's per-file BEGIN IMMEDIATE lock still
    // serializes the two commits at the SQLite level (this is a single deal
    // file), but that serialization must never manifest as a version
    // conflict for either write — each child holds its own record's OWN
    // fresh-read version, entirely independent of the other's collection.
    assert.strictEqual(raidResult.outcome, 'committed', 'a write to raidEntries must never see a conflict caused by a concurrent write to an unrelated collection (integrationTasks)');
    assert.strictEqual(taskResult.outcome, 'committed', 'a write to integrationTasks must never see a conflict caused by a concurrent write to an unrelated collection (raidEntries)');

    const finalConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const finalRaid = JSON.parse(finalConn.prepare('SELECT data FROM raidEntries WHERE id = ?').get(raidId).data);
    const finalTask = JSON.parse(finalConn.prepare('SELECT data FROM integrationTasks WHERE id = ?').get(taskId).data);
    assert.strictEqual(finalRaid.version, 1, "the RAID record's version must have advanced");
    assert.strictEqual(finalTask.version, 1, "the task's version must have advanced");
    assert.strictEqual(finalRaid.title, 'Cross-collection RAID write');
    assert.strictEqual(finalTask.title, 'Cross-collection task write');
  } finally {
    store.closeConnection(dealDbPath);
    cleanupDbFile(dealDbPath);
  }
});
