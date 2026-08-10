// CONC-01 / D-09 (Phase 8, Plan 02): closes 08-RESEARCH.md Pitfall 4 / Open
// Question 1 — db/controlStore.js's read-modify-write pairs (updateUser,
// updateDealSetup, updateDealMembers, setDealMemberGrants, archiveDeal) are
// direct-SQL writers that bypass writeDb() entirely, so they need their own
// `.immediate` lock acquisition to be covered by D-09's serialization
// contract. Before this plan, two concurrent edits to the SAME deal row
// could silently clobber each other — a torn read between an unguarded
// SELECT and its later UPDATE, never throwing SQLITE_BUSY, just quietly
// losing one writer's change. Deal membership and DD-clearance grants are
// MNPI access-control data (T-08-04); a silently dropped grant change is an
// integrity failure, not just a correctness bug.
//
// CRITICAL (RESEARCH.md Pitfall 3, same discipline as
// test/concurrency-busy-retry.test.js): every "concurrent writer" below is a
// REAL spawned node:child_process instance, never a Promise/timer
// simulation within this test process (which would deadlock — better-sqlite3
// is synchronous, Node is single-threaded).
//
// Why two children retry over several rounds rather than one call each:
// db/controlStore.js's updateDealMembers() replaces `members` WHOLESALE with
// whatever array the caller passes — it does not merge with the freshly-read
// deal.members itself (that merge, if any, is the caller's job). So a naive
// single call from each child (computed from a read taken BEFORE the call)
// can still race: child B's call may commit using a members array computed
// before it ever saw child A's commit. Running several rounds, each of which
// re-reads the CURRENT committed state and re-asserts "my own member is
// present," converges: because updateDealMembers()'s own internal read+write
// pair is now atomic (`.immediate` acquires control.db's write lock BEFORE
// running its own internal getDeal() read), two concurrent calls are always
// TOTALLY ORDERED with respect to each other — the second call's internal
// read is guaranteed to see the first call's committed result. Given enough
// rounds — and a short synchronous yield between rounds so the OS scheduler
// actually alternates the two processes instead of letting one run its
// whole loop as one uninterrupted burst — this repeated-convergence
// mechanism reliably lands on a final state where both members are present,
// without relying on luck alone. setDealMemberGrants() is structurally
// different: it merges the WHOLE memberGrants MAP (`{ ...(deal.memberGrants
// || {}) }`) before
// setting just its own username key, so two concurrent calls for two
// DIFFERENT usernames converge deterministically in one round each, purely
// from the atomic total-ordering the `.immediate` lock now provides — the
// several-rounds shape is kept here anyway to match the members test and
// exercise the interleave rather than hope for it, per this plan's own
// instruction.
//
// ISO-01 (Phase 3): boots against an ISOLATED temp trio of control/runtime/
// demo files — never the live, committed data/control.db — via the
// MA_*_DB_PATH env overrides (db/dbFiles.js), set BEFORE requiring any
// module that resolves one of those path constants. Mirrors
// test/role-enforcement.test.js's / test/deal-registry.test.js's established
// harness. T-08-08: this test writes ONLY into the fs.mkdtempSync directory
// below — the committed data/control.db is never a target (verified
// separately by an empty `git status --porcelain data/` after a
// `wal_checkpoint(TRUNCATE)`, per this plan's own <verification> section).
//
// node:test — Node's built-in runner, zero new dependency. Run via
// `node --test` (bare — this repo's default test discovery), or `npm test`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('node:child_process');

function tempDbPath(label) {
  return path.join(os.tmpdir(), `gsd-control-plane-serialization-${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
}
function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-control-plane-serialization-split-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');

const { runMigration } = require('../scripts/migrate-db-json-to-sqlite.js');
const SOURCE_PATH = path.join(__dirname, '..', 'db.json');
const SOURCE_DB_PATH = tempDbPath('legacy-source');
runMigration(SOURCE_PATH, SOURCE_DB_PATH); // seeds the full non-account fixture data

const { runSplit } = require('../scripts/split-db-into-control-demo-deals.js');
runSplit({ sourcePath: SOURCE_DB_PATH, outDir: TMP_DIR }); // fans out to TMP_DIR/{control,demo,runtime}.db

const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const controlStore = require('../db/controlStore.js');

const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);

// Seed a real account directly (Phase 3 Task 2: accounts are control.db-
// native, reached only through db/controlStore.js — see
// test/role-enforcement.test.js's identical rationale). Not exercised by the
// races below, but seeded to keep this harness a faithful "deal row + user
// row inserted directly" trio, per this plan's own instruction.
const fixtureUsers = JSON.parse(fs.readFileSync(SOURCE_PATH, 'utf8')).users || [];
if (fixtureUsers.length) {
  const seedUser = fixtureUsers[0];
  controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
    .run(seedUser.username, null, 0, JSON.stringify(seedUser));
}

let dealSeq = 0;
function registerDeal(deal) {
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, deal.status || 'active', JSON.stringify(deal));
}

test.after(() => {
  cleanupDbFile(SOURCE_DB_PATH);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ }
});

// --- shared child-process helpers -------------------------------------------

const CONTROLSTORE_ABS_PATH = path.join(__dirname, '..', 'db', 'controlStore.js');

function runChild(script, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script, '--', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

// --- Test (a): updateDealMembers() — two DIFFERENT member additions --------
//
// Each child requires db/controlStore.js directly (a SEPARATE OS process)
// and, for every one of ROUNDS iterations (no early exit once its own member
// looks present — see below), re-reads the deal fresh and re-asserts
// (current committed members UNION its own member) via updateDealMembers().
// Deliberately NOT stopping the instant the child's own member is observed:
// updateDealMembers() replaces `members` WHOLESALE with whatever the caller
// passes, so a child that stops early can still be clobbered by the OTHER
// child's later round if that round's read predates this child's own last
// commit. Continuing to reassert the union every round for the full budget
// means each child's LAST round — whichever runs chronologically last across
// both processes — reads the other's already-committed contribution (a
// `.immediate` transaction's own internal read always sees every prior
// committed write, since the lock totally orders all updateDealMembers()
// calls) and re-writes the union, self-healing any earlier transient loss.
// Two children are started via Promise.all so both processes launch close
// enough together to interleave throughout the whole round budget.

const MEMBER_CHILD_SCRIPT = `
  const controlStore = require(${JSON.stringify(CONTROLSTORE_ABS_PATH)});
  const dealId = process.argv[1];
  const member = process.argv[2];
  const rounds = parseInt(process.argv[3], 10);
  // Synchronous yield between rounds (Atomics.wait on a throwaway
  // SharedArrayBuffer — no new dependency): without this, one child's ENTIRE
  // round loop can run as a single uninterrupted OS-scheduler burst,
  // finishing before the other process is ever scheduled a first time. A
  // short yield after every round gives the OS scheduler real opportunities
  // to interleave the two processes throughout the whole round budget, which
  // is what makes the self-healing convergence in the comment above actually
  // happen in practice rather than only in the mathematical limit.
  const sab = new Int32Array(new SharedArrayBuffer(4));
  function yieldMs(ms) { Atomics.wait(sab, 0, 0, ms); }
  for (let i = 0; i < rounds; i++) {
    const deal = controlStore.getDeal(dealId);
    const currentMembers = (deal && Array.isArray(deal.members)) ? deal.members : [];
    const newMembers = Array.from(new Set(currentMembers.concat([member])));
    controlStore.updateDealMembers(dealId, newMembers);
    yieldMs(2);
  }
  const deal = controlStore.getDeal(dealId);
  const converged = !!(deal && Array.isArray(deal.members) && deal.members.includes(member));
  console.log('CONVERGED:' + converged);
  process.exit(converged ? 0 : 1);
`;

test('control-plane-serialization (a): two processes concurrently adding a DIFFERENT member to the same deal — both survive', async () => {
  const dealId = 'deal_membertest1';
  registerDeal({ id: dealId, name: 'Member Race Deal', targetCompany: 'Race Co', members: [], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });

  const ROUNDS = 60;
  const [resA, resB] = await Promise.all([
    runChild(MEMBER_CHILD_SCRIPT, [dealId, 'memberA', String(ROUNDS)]),
    runChild(MEMBER_CHILD_SCRIPT, [dealId, 'memberB', String(ROUNDS)]),
  ]);
  assert.strictEqual(resA.code, 0, `child A must converge within ${ROUNDS} rounds — stdout=${resA.stdout} stderr=${resA.stderr}`);
  assert.strictEqual(resB.code, 0, `child B must converge within ${ROUNDS} rounds — stdout=${resB.stdout} stderr=${resB.stderr}`);

  const finalDeal = controlStore.getDeal(dealId);
  assert.ok(finalDeal.members.includes('memberA'), 'memberA must be present on the deal — today one is silently lost');
  assert.ok(finalDeal.members.includes('memberB'), 'memberB must be present on the deal — today one is silently lost');
});

// --- Test (b): setDealMemberGrants() — two DIFFERENT DD-area grants --------
//
// setDealMemberGrants() merges the WHOLE memberGrants map internally
// (`{ ...(deal.memberGrants || {}) }`) before setting just its own username
// key, so two concurrent calls for two DIFFERENT usernames converge
// deterministically from the `.immediate` lock's total ordering alone — the
// same several-rounds shape is used here to match test (a) and to exercise
// the interleave rather than hope for it.

const GRANT_CHILD_SCRIPT = `
  const controlStore = require(${JSON.stringify(CONTROLSTORE_ABS_PATH)});
  const dealId = process.argv[1];
  const username = process.argv[2];
  const area = process.argv[3];
  const rounds = parseInt(process.argv[4], 10);
  let converged = false;
  for (let i = 0; i < rounds; i++) {
    const grants = controlStore.getDealMemberGrants(dealId);
    const current = (grants[username] && grants[username].ddAreas) || [];
    if (current.includes(area)) { converged = true; break; }
    controlStore.setDealMemberGrants(dealId, username, Array.from(new Set(current.concat([area]))));
  }
  if (!converged) {
    const grants = controlStore.getDealMemberGrants(dealId);
    const current = (grants[username] && grants[username].ddAreas) || [];
    converged = current.includes(area);
  }
  console.log('CONVERGED:' + converged);
  process.exit(converged ? 0 : 1);
`;

test('control-plane-serialization (b): two processes concurrently granting a DIFFERENT DD area to different users on the same deal — both survive', async () => {
  const dealId = 'deal_granttest1';
  registerDeal({ id: dealId, name: 'Grant Race Deal', targetCompany: 'Grant Co', members: ['userX', 'userY'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });

  const ROUNDS = 30;
  const [resX, resY] = await Promise.all([
    runChild(GRANT_CHILD_SCRIPT, [dealId, 'userX', 'legal', String(ROUNDS)]),
    runChild(GRANT_CHILD_SCRIPT, [dealId, 'userY', 'financial', String(ROUNDS)]),
  ]);
  assert.strictEqual(resX.code, 0, `child X must converge within ${ROUNDS} rounds — stdout=${resX.stdout} stderr=${resX.stderr}`);
  assert.strictEqual(resY.code, 0, `child Y must converge within ${ROUNDS} rounds — stdout=${resY.stdout} stderr=${resY.stderr}`);

  const finalGrants = controlStore.getDealMemberGrants(dealId);
  assert.ok(finalGrants.userX && finalGrants.userX.ddAreas.includes('legal'), "userX's legal grant must be present — today a concurrent grant can silently clobber it");
  assert.ok(finalGrants.userY && finalGrants.userY.ddAreas.includes('financial'), "userY's financial grant must be present — today a concurrent grant can silently clobber it");
});

// --- Test (c): a caller that cannot acquire the lock gets a thrown error ---
//
// Not a multi-process test — proves the local, in-process contract: a write
// that cannot acquire the .immediate lock throws a SqliteError (which
// propagates to server.js's central 503 middleware in the real app), never a
// silent partial update. Uses a real second connection holding BEGIN
// IMMEDIATE on control.db directly (the same lock-holder technique as
// test/concurrency-busy-retry.test.js), a real second OS process so the
// holder's lock is genuinely external to this process's own connection cache.

const DB_FILES_ABS_PATH = path.join(__dirname, '..', 'db', 'dbFiles.js');

const LOCK_HOLDER_SCRIPT = `
  const dbFiles = require(${JSON.stringify(DB_FILES_ABS_PATH)});
  const dbPath = process.argv[1];
  const holdMs = parseInt(process.argv[2], 10);
  const conn = dbFiles.openDbFile(dbPath, dbFiles.CONTROL_SCHEMA_PATH);
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

test('control-plane-serialization (c): a caller that cannot acquire the lock within the busy-wait throws, not a partial update', async () => {
  const dealId = 'deal_busytest1';
  registerDeal({ id: dealId, name: 'Busy Test Deal', targetCompany: 'Busy Co', members: ['seedmember'], status: 'active', createdBy: 'admin', createdAt: new Date().toISOString() });

  const HOLD_MS = 2500; // comfortably longer than db/dbFiles.js's 1000ms busy_timeout budget
  const child = spawn(process.execPath, ['-e', LOCK_HOLDER_SCRIPT, '--', dbFiles.CONTROL_DB_PATH, String(HOLD_MS)], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const childExited = new Promise((resolve) => child.once('exit', () => resolve()));

  try {
    await waitForReady(child);
    assert.throws(
      () => controlStore.updateDealMembers(dealId, ['seedmember', 'shouldnotpersist']),
      (err) => err && typeof err.code === 'string' && err.code.startsWith('SQLITE_BUSY'),
      'a caller contended by a real second OS process holding the lock must throw a SqliteError with a SQLITE_BUSY* code, not silently apply a partial update'
    );
  } finally {
    await childExited;
    if (child.exitCode === null && !child.killed) {
      try { child.kill(); } catch (e) { /* ignore */ }
    }
  }

  const dealAfter = controlStore.getDeal(dealId);
  assert.deepStrictEqual(dealAfter.members, ['seedmember'], 'the deal must be left completely unchanged by the throwing call — no partial update');
});
