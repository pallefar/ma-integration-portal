// CONC-01 (Phase 8, Plan 01): the gating architectural proof for the whole
// v2.2.0 milestone (D-01). Proves Option B end-to-end on one path: a write
// contended by a real second OS process serializes through SQLite's own WAL
// write lock (BEGIN IMMEDIATE + busy_timeout, db/dbFiles.js + db/store.js),
// and the losing writer gets a clean, bounded 503 Retry-After on the wire
// (server.js's central error middleware) — plus (Task 2, below) the
// zero-lost-update invariant across two real processes issuing hundreds of
// interleaved writes.
//
// CRITICAL (RESEARCH.md Pitfall 3, reproduced empirically this session): a
// "concurrent" second writer simulated with a Promise/timer WITHIN this test
// process would deadlock — better-sqlite3 is synchronous and Node is
// single-threaded, so the busy-wait blocks the only thread and a releasing
// timer callback in the SAME process could never fire. Every test below
// spawns a REAL node:child_process instance for the second writer.
//
// This is Task 1's end-to-end proof (spawns a real HTTP server + one
// contended /api/pulses write) plus Task 2's fast bounded multi-process
// zero-lost-update proof (two children calling db/store.js's writeDb()
// directly against a shared deal file, no HTTP layer) — extending
// test/concurrent-write.test.js's tempDbPath()/cleanupDbFile() helpers, but
// NOT its in-process "concurrent writer" technique (see assumption_delta_decision
// in 08-01-PLAN.md: test/concurrent-write.test.js remains valid but proves
// merge semantics only, never multi-process serialization).
//
// ISO-01 (Phase 3): boots the REAL requireable app (`require('../server.js')`)
// against an ISOLATED temp trio of control/runtime/demo files — never the
// live, committed data/control.db etc — via the MA_*_DB_PATH env overrides
// (db/dbFiles.js), set BEFORE requiring any module that resolves one of
// those path constants at require time. Mirrors test/role-enforcement.test.js's
// established harness exactly.
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.
// `node --test test/` does NOT work on this project's target Node version
// (v22.18.0) — it errors with "Cannot find module '.../test'".

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('node:child_process');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-concurrency-busy-retry-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-concurrency-busy-retry-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH); // seeds the full non-account fixture data

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR }); // fans out to TMP_DIR/{control,demo,runtime}.db — the exact paths the env overrides above point to

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const sessionsDb = require('../db/sessions.js');
const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

// Phase 3 Task 2: accounts are control.db-native, reached only through
// db/controlStore.js — seed control.db's `users` table directly from
// db.json's own `users` array (real salt/hash pairs) so login-adjacent
// session creation below has a real account to attribute the session to.
const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
fixtureUsers.forEach((user, i) => {
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(user.username, null, i, JSON.stringify(user));
});

const app = require('../server.js');

function cookieHeader(token) {
  return `ma_session=${token}`;
}

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// --- Task 1: end-to-end contended write ------------------------------------
//
// A real second OS process opens db/dbFiles.js's DEMO_DB_PATH directly,
// acquires BEGIN IMMEDIATE, and holds the write lock ~2500ms — comfortably
// longer than db/dbFiles.js's 1000ms busy_timeout budget. Meanwhile the
// parent process (this test) drives a real HTTP request through the full
// app (session -> resolver -> writeDb() -> server.js's central 503
// middleware) and asserts the contended write returns 503 + Retry-After,
// then succeeds identically once the lock releases.

const DB_FILES_ABS_PATH = path.join(__dirname, '..', 'db', 'dbFiles.js');

// Inline child script (node -e): opens the SAME demo.db file the parent's
// no-dealId session resolves to (db/resolver.js: no dealId -> DEMO_DB_PATH),
// acquires BEGIN IMMEDIATE directly (bypassing writeDb() — this process just
// needs to hold the write lock, not perform a real write), prints a
// readiness line once the lock is held, then releases after `holdMs`.
const LOCK_HOLDER_SCRIPT = `
  const dbFiles = require(${JSON.stringify(DB_FILES_ABS_PATH)});
  const dbPath = process.argv[1];
  const holdMs = parseInt(process.argv[2], 10);
  const conn = dbFiles.openDbFile(dbPath, dbFiles.DEAL_SCHEMA_PATH);
  conn.exec('BEGIN IMMEDIATE');
  console.log('READY');
  setTimeout(() => {
    conn.exec('COMMIT');
    conn.close();
  }, holdMs);
`;

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('lock holder child never reported READY within 5s'));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.removeListener('data', onData);
    }
    function onData(chunk) {
      buf += chunk.toString();
      if (buf.includes('READY')) {
        cleanup();
        resolve();
      }
    }
    child.stdout.on('data', onData);
    child.once('error', (e) => { cleanup(); reject(e); });
  });
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
  });
}

test('CONC-01 (end-to-end): a write contended by a real second OS process returns 503 + Retry-After, and succeeds identically once the lock releases', async () => {
  const HOLD_MS = 2500; // comfortably longer than db/dbFiles.js's 1000ms busy_timeout budget
  const child = spawn(process.execPath, ['-e', LOCK_HOLDER_SCRIPT, '--', dbFiles.DEMO_DB_PATH, String(HOLD_MS)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const childExited = waitForExit(child);

  try {
    await waitForReady(child);

    // A session with NO dealId — db/resolver.js's resolveDatabase() binds
    // this to DEMO_DB_PATH (dbFiles.DEMO_DB_PATH), the exact file the child
    // above is holding the write lock on.
    const token = sessionsDb.createSession(runtimeConn, { username: 'employee-demo', role: 'employee', ttlMs: 12 * 60 * 60 * 1000 });
    const server = app.listen(0);
    try {
      const { port } = server.address();
      const pulsePayload = { employeeName: 'Contention Test', rating: 4, comment: 'busy-retry proof', type: 'general' };

      const contendedRes = await fetch(`http://127.0.0.1:${port}/api/pulses`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(pulsePayload),
      });
      assert.strictEqual(contendedRes.status, 503, 'a write contended by a real second OS process must return 503, never a hang/partial row/generic 500');
      assert.ok(contendedRes.headers.get('retry-after'), 'the 503 response must carry a Retry-After header');

      const contendedBody = await contendedRes.json();
      const bodyText = JSON.stringify(contendedBody);
      // T-08-01 (Information Disclosure): never echo the SQLite error string,
      // a stack, a file path, or a deal identifier in the 503 body.
      assert.ok(!/SQLITE/i.test(bodyText), '503 body must never echo a SQLite error string');
      assert.ok(!bodyText.includes(TMP_DIR), '503 body must never echo a filesystem path');
      assert.ok(!bodyText.includes(dbFiles.DEMO_DB_PATH), '503 body must never echo the resolved db file path');
      assert.deepStrictEqual(contendedBody, { error: 'Server is busy. Please try again.' }, '503 body must be the fixed generic literal');

      // Wait for the lock holder to release its BEGIN IMMEDIATE before retrying.
      await childExited;

      const retryRes = await fetch(`http://127.0.0.1:${port}/api/pulses`, {
        method: 'POST',
        headers: { Cookie: cookieHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(pulsePayload),
      });
      assert.ok(retryRes.status >= 200 && retryRes.status < 300, 'the identical write must succeed once the lock releases');
      const retryBody = await retryRes.json();
      const newPulseId = retryBody.pulse && retryBody.pulse.id;
      assert.ok(newPulseId, 'a successful pulse write must return the created pulse id');

      // Fresh readDb() against the SAME demo.db file (the module singleton
      // path — getOrOpenConnection() returns the SAME cached connection the
      // resolver already opened for this request, so this is not a second,
      // independent connection).
      store.initDb(dbFiles.DEMO_DB_PATH);
      const after = store.readDb();
      const matches = after.pulses.filter((p) => p.id === newPulseId);
      assert.strictEqual(matches.length, 1, 'exactly one pulse row with the successfully-written id must exist — the retry landed exactly once, no duplicate, no partial row from the earlier 503');
    } finally {
      sessionsDb.deleteSession(runtimeConn, token);
      server.close();
    }
  } finally {
    if (child.exitCode === null && !child.killed) {
      try { child.kill(); } catch (e) { /* ignore */ }
    }
  }
});

// --- Task 2: zero-lost-update proof across two writing processes -----------
//
// Two real child processes require db/store.js directly and perform
// hundreds of interleaved read-modify-write cycles against ONE shared deal
// file — no HTTP/auth layer, proving the storage-layer guarantee in
// isolation (fast enough for every `npm test` run, per D-12(a)).

const STORE_ABS_PATH = path.join(__dirname, '..', 'db', 'store.js');

// Inline child script (node -e): requires db/store.js directly (a SEPARATE
// OS process — not the connection cache above), calls initDb() against the
// shared file path passed on argv, then loops readDb() -> append one row to
// `pulses` (id namespaced by this child's own label + iteration index) ->
// writeDb(). A SQLITE_BUSY* thrown after the full busy-wait is a bounded,
// EXPECTED failure (D-15 — "a bounded busy failure is the design working")
// and is NOT counted as acknowledged; any other error is unexpected and
// fails the child (and, via its exit code, the test).
const CONCURRENT_WRITER_SCRIPT = `
  const store = require(${JSON.stringify(STORE_ABS_PATH)});
  const dbPath = process.argv[1];
  const label = process.argv[2];
  const iterations = parseInt(process.argv[3], 10);
  store.initDb(dbPath);
  const acknowledged = [];
  for (let i = 0; i < iterations; i++) {
    const id = label + '_' + i;
    try {
      const current = store.readDb();
      current.pulses = current.pulses.concat([{ id, employeeName: label, rating: 3, comment: 'soak', type: 'general' }]);
      store.writeDb(current);
      acknowledged.push(id);
    } catch (e) {
      if (e && e.code && String(e.code).startsWith('SQLITE_BUSY')) {
        // Bounded busy failure — the design working (D-15). This write was
        // NOT acknowledged; do not assert it is present.
        continue;
      }
      process.stderr.write('UNEXPECTED_ERROR: ' + (e && e.stack ? e.stack : String(e)) + '\\n');
      process.exit(1);
    }
  }
  console.log('ACKNOWLEDGED:' + JSON.stringify(acknowledged));
  process.exit(0);
`;

function runWriterChild(dbPath, label, iterations) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', CONCURRENT_WRITER_SCRIPT, '--', dbPath, label, String(iterations)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== 0) {
        return reject(new Error(`writer child '${label}' exited ${code}: ${stderr || stdout}`));
      }
      const match = stdout.match(/ACKNOWLEDGED:(\[.*\])/s);
      if (!match) return reject(new Error(`writer child '${label}' produced no ACKNOWLEDGED line: stdout=${stdout} stderr=${stderr}`));
      resolve(JSON.parse(match[1]));
    });
  });
}

test('CONC-01 (zero-lost-update): two real processes issuing hundreds of interleaved writes lose zero acknowledged writes', async () => {
  const dealDbPath = tempDbPath('shared-deal');
  const ITERATIONS = 150; // 2 children x 150 = 300 interleaved writes total ("several hundred", D-12a)

  try {
    runMigration(SOURCE_PATH, dealDbPath); // seeds a real, non-empty fixture (same shape production traffic would use)

    // Baseline row count, read BEFORE either child opens the file.
    const seedConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const seededPulseIds = seedConn.prepare('SELECT id FROM pulses').all().map((r) => r.id);
    const seededCount = seededPulseIds.length;
    assert.ok(seededCount > 0, 'fixture must seed a non-empty pulses collection for this test to be meaningful');
    // Release the parent's connection before spawning — the point of this
    // test is that SEPARATE OS processes hold separate connections to one
    // file, not a connection shared via this module's cache.
    store.closeConnection(dealDbPath);

    const [ackA, ackB] = await Promise.all([
      runWriterChild(dealDbPath, 'childA', ITERATIONS),
      runWriterChild(dealDbPath, 'childB', ITERATIONS),
    ]);

    assert.ok(ackA.length > 0, 'child A must acknowledge at least one write');
    assert.ok(ackB.length > 0, 'child B must acknowledge at least one write');

    const finalConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
    const finalRows = finalConn.prepare('SELECT id FROM pulses').all().map((r) => r.id);
    const finalIds = new Set(finalRows);

    // The zero-loss assertion is over the set of ids each child REPORTED as
    // acknowledged, not over the ids it attempted — a bounded 503/BUSY
    // rejection is not a lost update (D-15).
    for (const id of ackA) {
      assert.ok(finalIds.has(id), `child A's acknowledged write '${id}' must be present in the final database`);
    }
    for (const id of ackB) {
      assert.ok(finalIds.has(id), `child B's acknowledged write '${id}' must be present in the final database`);
    }
    for (const id of seededPulseIds) {
      assert.ok(finalIds.has(id), `seeded pulse '${id}' must not have been dropped`);
    }

    assert.strictEqual(
      finalRows.length,
      seededCount + ackA.length + ackB.length,
      "total row count must equal the seeded baseline plus both children's acknowledged counts — no lost update, no phantom row"
    );

    const integrity = finalConn.prepare('PRAGMA integrity_check').get();
    assert.strictEqual(integrity.integrity_check, 'ok', 'PRAGMA integrity_check must return ok after concurrent multi-process writes');

    // Negative control: a write acknowledged by child A is still present
    // after child B's LATER writes committed — i.e. B's snapshot-diff merge
    // did not delete a row that was never in B's own __snapshot (db/store.js
    // writeDb() doc comment).
    assert.ok(finalIds.has(ackA[0]), "child A's first acknowledged write must survive every one of child B's subsequent commits");
  } finally {
    store.closeConnection(dealDbPath);
    cleanupDbFile(dealDbPath);
  }
});
