#!/usr/bin/env node
// D-12(b)/D-13/D-14/D-15 (Phase 8, Plan 05): the standalone soak harness —
// boots real, SEPARATE `node server.js` OS processes on separate ports over
// ONE shared scratch data directory and drives authenticated API writes
// through the whole stack (auth, validation, deal resolver, audit append,
// busy-wait, the 503 contract). This is the "whole path" proof the fast
// suite tests (test/concurrency-busy-retry.test.js,
// test/control-plane-serialization.test.js, test/busy-503-contract.test.js)
// deliberately do not attempt — they prove the storage layer and the error
// contract in isolation, fast; this proves the composed system under
// sustained real load. It doubles as the release gate (D-14): process
// count / duration / write interval are configurable via env vars so a
// harder release-gate run is the SAME script, never a second one.
//
// [security] T-08-06 (Tampering): this harness NEVER touches the committed
// data/ tree. Every run seeds a fresh fs.mkdtempSync() scratch directory via
// the SAME re-runnable scripts/migrate-db-json-to-sqlite.js +
// scripts/split-db-into-control-demo-deals.js production/tests already use
// (env-override pattern from test/audit-log.test.js /
// test/role-enforcement.test.js), and removes the scratch directory on both
// the pass and fail path. `git status --porcelain data/` must be empty
// after every run — asserted structurally by this plan's own <verify>
// scripts, not just by convention here.
//
// Usage:
//   npm run soak                          # defaults: 3 processes, ~2 min
//   SOAK_PROCESSES=4 npm run soak         # harder release-gate run (D-14)
//   SOAK_DURATION_MS=15000 npm run soak   # a quick smoke run
//   SOAK_WRITE_INTERVAL_MS=50 npm run soak

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(REPO_ROOT, 'server.js');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Configuration (D-14) --------------------------------------------------
// Reads overrides from SOAK_PROCESSES / SOAK_DURATION_MS /
// SOAK_WRITE_INTERVAL_MS, falling back to the defaults below when unset or
// unparseable, so a release gate can run this SAME script harder without
// editing it.
function resolveIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PROCESSES = resolveIntEnv('SOAK_PROCESSES', 3);
const DURATION_MS = resolveIntEnv('SOAK_DURATION_MS', 120000);
const WRITE_INTERVAL_MS = resolveIntEnv('SOAK_WRITE_INTERVAL_MS', 100);

console.log(
  `soak: resolved config — processes=${PROCESSES} durationMs=${DURATION_MS} writeIntervalMs=${WRITE_INTERVAL_MS}`
);

// --- Scratch data directory + env override (D-13) --------------------------
// Set BEFORE requiring any local module that resolves one of these path
// constants at require time (db/dbFiles.js and everything that transitively
// requires it) — this is what lets every spawned child AND this parent
// process point at ONE shared scratch copy of the data files, never the
// live, committed data/demo.db or data/control.db. Every spawned child
// receives this SAME env object plus its own PORT — that is what "one
// shared data directory" means here (T-08-06).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-soak-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');

// Captured AFTER the MA_* overrides above are set, so every spawned child
// inherits them (plus its own PORT, added per-child below).
const CHILD_ENV_BASE = { ...process.env };

const { runMigration } = require('./migrate-db-json-to-sqlite.js');
const { runSplit } = require('./split-db-into-control-demo-deals.js');
const store = require('../db/store.js');
const dbFiles = require('../db/dbFiles.js');
const controlStore = require('../db/controlStore.js');
const sessionsDb = require('../db/sessions.js');
const auditHook = require('../db/auditHook.js');
const { createDealDatabase } = require('../db/dealSeed.js');

function cleanupDbFile(dbPath) {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + ext); } catch (e) { /* ignore */ }
  }
}

// --- Setup: seed the scratch trio the SAME way the established test suite
// does (test/role-enforcement.test.js / test/concurrency-busy-retry.test.js)
// — the re-runnable migrate-then-split pipeline production itself uses, not
// a third hand-rolled seeding path.
function seedScratchDataDir() {
  const sourcePath = path.join(REPO_ROOT, 'db.json');
  const legacySourceDbPath = path.join(TMP_DIR, '.legacy-source.db');
  runMigration(sourcePath, legacySourceDbPath);
  runSplit({ sourcePath: legacySourceDbPath, outDir: TMP_DIR }); // fans out to TMP_DIR/{control,demo,runtime}.db — the exact paths the env overrides above point to
  cleanupDbFile(legacySourceDbPath);

  // Phase 3 Task 2: accounts are control.db-native, reached only through
  // db/controlStore.js — `users` is not part of ARRAY_COLLECTIONS, so
  // neither runMigration() nor runSplit() above touches it. Seed it
  // directly from db.json's own `users` array (real salt/hash pairs) so
  // real logins are possible against this scratch trio, mirroring
  // test/role-enforcement.test.js exactly.
  const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
  const fixtureUsers = JSON.parse(fs.readFileSync(sourcePath, 'utf8')).users || [];
  fixtureUsers.forEach((user, i) => {
    controlConn.prepare('INSERT INTO users (id, project_id, seq, data) VALUES (?, ?, ?, ?)')
      .run(user.username, null, i, JSON.stringify(user));
  });
}

/**
 * Create one real deal (registry row + provisioned database file), exactly
 * the same two-call sequence server.js's own POST /api/deals route uses
 * (controlStore.createDeal() then dealSeed.createDealDatabase()) — this is
 * what makes writes against it audited (db/auditHook.js's AUDITED_DB_KINDS
 * includes 'deal', but deliberately excludes 'demo') and exercises the real
 * deal-provisioning path the soak's whole-stack claim (D-13) depends on.
 */
function createSoakDeal() {
  const deal = controlStore.createDeal({
    name: 'Soak Harness Deal',
    targetCompany: 'Soak Target Co',
    members: [],
    createdBy: 'soak-harness',
  });
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  return deal;
}

/**
 * One session per worker, bound to the soak deal. role: 'admin' —
 * db/controlStore.js's isDealMember() short-circuits true for an admin
 * regardless of the deal's own `members` array, so the load generator does
 * not need to separately manage deal membership; ROLE_WRITE_POLICY already
 * allows admin on every write route this harness drives.
 */
function createWorkerSessions(count, dealId) {
  const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  const sessions = [];
  for (let i = 0; i < count; i++) {
    const username = `soak-worker-${i}`;
    // Phase 10 (D-10-04, COLLAB-02): a session's identity is re-read from
    // control.db on EVERY request, so a session whose account does not exist
    // is a 401. The worker therefore needs a real (credential-less, so it can
    // never sign in) admin account row behind its session.
    if (!controlStore.getAccount(username)) {
      controlStore.createAccount({
        username, name: `Soak worker ${i}`, role: 'admin', disabled: false,
        mustChangePassword: false, createdAt: new Date().toISOString(), createdBy: 'soak-harness',
      });
    }
    const token = sessionsDb.createSession(runtimeConn, {
      username, role: 'admin', ttlMs: 6 * 60 * 60 * 1000,
    });
    sessionsDb.bindSessionDeal(runtimeConn, token, dealId);
    sessions.push({ username, token, cookie: `ma_session=${token}` });
  }
  return sessions;
}

/**
 * CONC-02 (Phase 9, Plan 07): a shared, real RAID entry every worker's
 * conflict lane (below) races against. The pulses load above only ever
 * CREATES new rows — a load generator that never mutates an EXISTING record
 * can never produce a version conflict, so D-06's contract would have
 * nothing to prove itself against in this harness without a dedicated
 * conflict-inducing write target. Stamped to version:1 immediately by an
 * explicit `version: 0` baseline write (D-09: version-less IS version 0; a
 * precondition-less write is refused in a deal) so every worker's
 * conflict lane starts from a KNOWN baseline rather than the ambiguous
 * "no version field yet" state.
 */
async function createSharedConflictRecord(port, cookie) {
  const createRes = await fetch(`http://127.0.0.1:${port}/api/raid`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Soak conflict-probe RAID entry', type: 'risk', severity: 'medium' }),
  });
  if (createRes.status !== 201) throw new Error(`soak: failed to create the shared conflict-probe RAID entry (status ${createRes.status})`);
  const { entry } = await createRes.json();
  const stampRes = await fetch(`http://127.0.0.1:${port}/api/raid`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    // version: 0 — the precondition a client holding a never-edited record
    // sends (D-09). A write with NO precondition is refused 400 in a real
    // deal (CONC-02 gap closure, plan 09-08), so the baseline must be explicit.
    body: JSON.stringify({ id: entry.id, notes: 'soak baseline stamp', version: 0 }),
  });
  if (stampRes.status !== 200) throw new Error(`soak: failed to stamp the shared conflict-probe RAID entry's baseline version (status ${stampRes.status})`);
  const stamped = (await stampRes.json()).entry;
  return { id: entry.id, initialVersion: stamped.version };
}

// --- Spawning real server.js processes --------------------------------------

// Namespaced away from common dev ports (3000) and offset by this process's
// own pid so two soak runs on the same host (a local run alongside a
// sibling worktree's own soak, or a rapid re-run) are unlikely to collide.
const BASE_PORT = 4100 + (process.pid % 400);

function spawnServerChild(index, port) {
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...CHILD_ENV_BASE, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[server ${index}:${port}]`;
  child.stdout.on('data', (chunk) => process.stdout.write(`${tag} ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`${tag} ${chunk}`));
  return child;
}

// Poll a cheap, always-public endpoint until it answers — never a fixed
// sleep-and-hope. GET /api/auth/me stays on PUBLIC_API_PATHS by design (it
// never invokes the deal resolver), so it is reachable the instant the
// listener is bound, before any session/deal setup below.
async function waitUntilReady(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/me`);
      if (res.status < 500) return true;
    } catch (e) { /* not listening yet — keep polling */ }
    await sleep(150);
  }
  return false;
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) return resolve();
    const forceTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { /* ignore */ }
    }, 5000);
    child.once('exit', () => { clearTimeout(forceTimer); resolve(); });
    try { child.kill('SIGTERM'); } catch (e) { clearTimeout(forceTimer); resolve(); }
  });
}

// --- Load generation ---------------------------------------------------------
//
// Each worker drives its OWN server process (its own port) but every worker
// writes into the SAME deal database file — the whole point of this harness
// (D-13's "same data directory" = same physical files). Writes contend on
// the same `pulses` collection rather than politely partitioning into
// per-worker rows, mirroring how an IL and workstream leads genuinely
// co-edit the same collections in production.
//
// Every write carries a unique id derived from the worker index and a
// monotonic per-worker counter (embedded in the required `employeeName`
// field, since POST /api/pulses mints its own row id server-side — the
// harness cannot pass one in). Each attempt is recorded into exactly one
// outcome bucket: acknowledged (2xx), cleanly refused (503 carrying
// Retry-After), or unexpected (anything else — a 500, a network failure, a
// non-JSON body, a 503 with no Retry-After). [security] T-08-01
// (Information Disclosure): the harness logs only ids, counts, and
// verdicts — never a raw SQLite error string or database file content.
// LANES: each worker process runs this many parallel dispatch lanes rather
// than one strictly-sequential request-then-wait loop. A single in-flight
// request per process makes cross-PROCESS overlap on one SQLite write lock
// vanishingly rare at any interval a real deal team would produce load at
// (each write itself completes in low single-digit milliseconds) — several
// lanes per process keep multiple requests genuinely in flight at once,
// which is what makes two DIFFERENT processes' BEGIN IMMEDIATE calls land
// close enough in wall-clock time to contend, the condition D-15 exists to
// exercise. Internal to the harness (not one of the three named D-14 env
// knobs) — Claude's Discretion per 08-RESEARCH.md.
const LANES = 4;

// CONC-02 (Phase 9, Plan 07): a SECOND, deliberately conflict-inducing load
// pattern, run alongside the pulses-only lanes above — every worker races
// every OTHER worker's conflict lane against the SAME shared RAID entry
// (`sharedRaid.id`), each holding its OWN cached version rather than
// re-fetching immediately before every attempt, so genuine multi-process
// 409s occur under real load rather than never firing at all (the pulses
// lane above only ever CREATES new rows — a load generator that never
// mutates an existing record can NEVER produce a version conflict). Each
// lane refreshes its cached version only after its OWN acknowledged write; a
// 409 leaves the cache stale on purpose, mirroring a real user who has not
// reloaded yet.
async function runConflictLane(workerIndex, port, cookie, durationMs, writeIntervalMs, sharedRaid) {
  const acknowledged = [];
  const conflicted = [];
  const refused = [];
  const unexpected = [];
  let cachedVersion = sharedRaid.initialVersion;
  const start = Date.now();
  let i = 0;
  while (Date.now() - start < durationMs) {
    const marker = `soak-conflict-w${workerIndex}-${i}`;
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${port}/api/raid`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sharedRaid.id, notes: marker, version: cachedVersion }),
      });
    } catch (e) {
      unexpected.push({ correlator: marker, note: `network error: ${e && e.message}` });
      i++;
      await sleep(Math.max(5, writeIntervalMs));
      continue;
    }
    if (res.status === 200) {
      let body;
      try { body = await res.json(); } catch (e) { body = null; }
      const version = body && body.entry && body.entry.version;
      if (typeof version !== 'number') {
        unexpected.push({ correlator: marker, note: '200 response with no entry.version' });
      } else {
        acknowledged.push({ correlator: marker, marker, version });
        cachedVersion = version; // refresh — matches a real client's post-success version refresh
      }
    } else if (res.status === 409) {
      let body;
      try { body = await res.json(); } catch (e) { body = null; }
      if (body && body.conflict === true) {
        conflicted.push({ correlator: marker, marker });
        // cachedVersion deliberately NOT refreshed here — a real user has
        // not reloaded yet either; this is what keeps the lane genuinely
        // racing rather than converging to a conflict-free steady state.
      } else {
        unexpected.push({ correlator: marker, note: `409 with no conflict:true marker` });
      }
    } else if (res.status === 503) {
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) {
        refused.push({ correlator: marker });
      } else {
        unexpected.push({ correlator: marker, note: '503 with no Retry-After header' });
      }
    } else {
      unexpected.push({ correlator: marker, note: `unexpected status ${res.status}` });
    }
    i++;
    const jitter = Math.floor(Math.random() * 40) - 20;
    await sleep(Math.max(5, writeIntervalMs + jitter));
  }
  return { workerIndex, acknowledged, conflicted, refused, unexpected };
}

async function runWorkerLoad(workerIndex, port, cookie, durationMs, writeIntervalMs, sharedRaid) {
  const acknowledged = [];
  const refused = [];
  const unexpected = [];
  const start = Date.now();

  async function doWrite(correlator) {
    const seed = Math.abs(hashCode(correlator));
    const payload = {
      employeeName: correlator,
      rating: 1 + (seed % 5),
      comment: 'soak-load',
      type: 'general',
    };
    let res;
    try {
      res = await fetch(`http://127.0.0.1:${port}/api/pulses`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      unexpected.push({ correlator, note: `network error: ${e && e.message}` });
      return;
    }
    if (res.status >= 200 && res.status < 300) {
      let body;
      try { body = await res.json(); } catch (e) { body = null; }
      const pulseId = body && body.pulse && body.pulse.id;
      if (!pulseId) {
        unexpected.push({ correlator, note: `2xx response with no pulse.id (status=${res.status})` });
        return;
      }
      acknowledged.push({ correlator, pulseId, payload });
      return;
    }
    if (res.status === 503) {
      const retryAfter = res.headers.get('retry-after');
      if (retryAfter) {
        refused.push({ correlator, status: res.status });
        return;
      }
      unexpected.push({ correlator, note: '503 with no Retry-After header' });
      return;
    }
    unexpected.push({ correlator, note: `unexpected status ${res.status}` });
  }

  async function doRead(tag) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/pulses`, { headers: { Cookie: cookie } });
      if (res.status < 200 || res.status >= 300) {
        unexpected.push({ correlator: tag, note: `unexpected read status ${res.status}` });
      }
    } catch (e) {
      unexpected.push({ correlator: tag, note: `read network error: ${e && e.message}` });
    }
  }

  async function lane(laneIndex) {
    let i = 0;
    while (Date.now() - start < durationMs) {
      const correlator = `soak-w${workerIndex}-l${laneIndex}-${i}`;
      await doWrite(correlator);
      // Mix reads and writes across the same co-edited collection (per plan
      // action text) — every third iteration also issues a read.
      if (i % 3 === 0) await doRead(`${correlator}-read`);
      i++;
      const jitter = Math.floor(Math.random() * 40) - 20; // +/-20ms, desynchronizes lanes/workers
      await sleep(Math.max(5, writeIntervalMs + jitter));
    }
  }

  // The conflict lane runs CONCURRENTLY with the pulses lanes above (not
  // sequentially after) — real multi-process contention on the shared RAID
  // record only occurs if every worker's conflict lane is in flight at the
  // same wall-clock time as every sibling worker's.
  const conflictLanePromise = runConflictLane(workerIndex, port, cookie, durationMs, writeIntervalMs, sharedRaid);

  await Promise.all(Array.from({ length: LANES }, (_, laneIndex) => lane(laneIndex)));
  const conflict = await conflictLanePromise;

  return { workerIndex, acknowledged, refused, unexpected, conflict };
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h;
}

// --- Verification pass (D-15) ------------------------------------------------
//
// Checkpoint the WAL first (a write can land only in the gitignored `-wal`
// sidecar), then open the finished files through db/dbFiles.js and assert
// each of D-15's five checks, printing a clear per-check verdict. Bounded
// 503s are reported, never treated as a failure.
function verify({ dealId, acknowledged, refused, unexpected, conflictAcknowledged, conflictConflicted, conflictRefused, sharedRaidId, initialRaidVersion }) {
  const checks = [];
  let allTouchedFilesOk = true;

  const dealDbPath = dbFiles.dealDbPath(dealId);
  const dealConn = store.getOrOpenConnection(dealDbPath, dbFiles.DEAL_SCHEMA_PATH);
  const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
  const auditConn = auditHook.getAuditConnection();

  const touchedFiles = [
    { name: 'deal', conn: dealConn },
    { name: 'control', conn: controlConn },
    { name: 'audit', conn: auditConn },
  ];
  for (const f of touchedFiles) {
    f.conn.pragma('wal_checkpoint(TRUNCATE)');
  }

  // Check 0 (not one of the named five, but required by the plan's own
  // action text): no unexpected outcome occurred during the load phase.
  checks.push({
    name: 'no unexpected outcomes (not a 2xx, not a clean 503)',
    ok: unexpected.length === 0,
    detail: unexpected.length === 0
      ? 'none'
      : `${unexpected.length} unexpected outcome(s), first: ${JSON.stringify(unexpected[0])}`,
  });

  // Check 1: every acknowledged write present and exact.
  const pulseRows = dealConn.prepare('SELECT id, data FROM pulses').all();
  const pulsesById = new Map();
  const pulseIdByEmployeeName = new Map();
  for (const r of pulseRows) {
    const parsed = JSON.parse(r.data);
    pulsesById.set(r.id, parsed);
    pulseIdByEmployeeName.set(parsed.employeeName, r.id);
  }
  const missingAck = [];
  const mismatchedAck = [];
  for (const w of acknowledged) {
    const row = pulsesById.get(w.pulseId);
    if (!row) { missingAck.push(w.pulseId); continue; }
    const exact = row.employeeName === w.payload.employeeName
      && Number(row.rating) === Number(w.payload.rating)
      && row.comment === w.payload.comment
      && row.type === w.payload.type;
    if (!exact) mismatchedAck.push(w.pulseId);
  }
  checks.push({
    name: 'every acknowledged write present in the final database and exact',
    ok: missingAck.length === 0 && mismatchedAck.length === 0,
    detail: `acknowledged=${acknowledged.length} missing=${missingAck.length} mismatched=${mismatchedAck.length}`,
  });

  // Audit rows, loaded once and reused by checks 2 and 4.
  const auditRows = auditConn.prepare(
    "SELECT row_id FROM audit_log WHERE deal_id = ? AND collection = 'pulses' AND action = 'insert'"
  ).all(dealId);
  const auditRowIdCounts = new Map();
  for (const r of auditRows) {
    auditRowIdCounts.set(r.row_id, (auditRowIdCounts.get(r.row_id) || 0) + 1);
  }

  // Check 2: no refused write left ANY trace committed — neither the
  // deal-level row NOR its audit row.
  //
  // [security] CR-01 (Phase 8 review fix): db/store.js's writeDb() used to
  // commit the deal-level write in its OWN transaction FIRST, then dispatch
  // the audit append as a SEPARATE, LATER transaction against audit.db — so
  // a busy audit append after an already-committed deal write produced a
  // "clean" 503 for a write that had, in fact, partially landed
  // (committed-but-unaudited). That was a deliberate, then-accepted
  // trade-off (D-10, "the client's 503-retry costs nothing because
  // writeDb()'s re-application is idempotent") — but the phase 8 code review
  // (finding CR-01) proved that argument false across an HTTP-level retry:
  // the retried request re-executes application logic and mints a BRAND NEW
  // id, so a committed-but-unaudited row does not get "re-applied
  // idempotently" — it becomes an invisible, permanent, un-audited MNPI
  // duplicate once the retry's own write lands under its own fresh id.
  //
  // The audit append now runs INSIDE the SAME transaction as the deal-level
  // write (db/store.js writeDb(), as its final step) — a busy audit append
  // rolls back the deal-level write too, so nothing may commit without its
  // audit row. `committedButUnaudited` is therefore no longer an accepted
  // trade-off: it is now a GENUINE violation, exactly like
  // `committedAndAudited` (the pre-existing "503 lied about the full
  // rollback" case). Both buckets fail this check.
  const committedButUnaudited = [];
  const committedAndAudited = [];
  for (const w of refused) {
    const pulseId = pulseIdByEmployeeName.get(w.correlator);
    if (!pulseId) continue; // the common, expected case: truly absent
    if (auditRowIdCounts.has(pulseId)) {
      committedAndAudited.push(w.correlator);
    } else {
      committedButUnaudited.push(w.correlator);
    }
  }
  checks.push({
    name: 'no cleanly-refused write left anything committed (CR-01 fix: committed-but-unaudited is now a genuine violation, not an accepted trade-off)',
    ok: committedAndAudited.length === 0 && committedButUnaudited.length === 0,
    detail: `refused=${refused.length} committedButUnaudited(genuine violation post-CR-01)=${committedButUnaudited.length} committedAndAudited(genuine violation)=${committedAndAudited.length}`,
  });

  // Check 3: PRAGMA integrity_check ok on every file the run touched.
  const integrityResults = touchedFiles.map((f) => ({
    name: f.name,
    ok: f.conn.prepare('PRAGMA integrity_check').get().integrity_check === 'ok',
  }));
  allTouchedFilesOk = integrityResults.every((r) => r.ok);
  checks.push({
    name: 'PRAGMA integrity_check ok on every touched file',
    ok: allTouchedFilesOk,
    detail: integrityResults.map((r) => `${r.name}=${r.ok ? 'ok' : 'FAILED'}`).join(', '),
  });

  // Check 4: audit trail matches acknowledged writes one-to-one, in both
  // directions — a missing row AND a duplicate row each fail. A
  // committed-but-unaudited row (now a genuine violation caught by check 2
  // above, post-CR-01) is, BY DEFINITION, absent from auditRowIdCounts and
  // absent from `acknowledged` (it was bucketed as refused, not
  // acknowledged) — so it does not appear on either side of this comparison
  // and cannot masquerade as a pass here.
  const ackIds = new Set(acknowledged.map((w) => w.pulseId));
  const missingFromAudit = [...ackIds].filter((id) => !auditRowIdCounts.has(id));
  const duplicateInAudit = [...auditRowIdCounts.entries()].filter(([, count]) => count > 1);
  const extraInAudit = [...auditRowIdCounts.keys()].filter((id) => !ackIds.has(id));
  checks.push({
    name: 'audit trail matches acknowledged writes one-to-one (both directions)',
    ok: missingFromAudit.length === 0 && duplicateInAudit.length === 0 && extraInAudit.length === 0,
    detail: `acknowledged=${acknowledged.length} auditRows=${auditRows.length} missingFromAudit=${missingFromAudit.length} duplicateInAudit=${duplicateInAudit.length} extraInAudit=${extraInAudit.length}`,
  });

  // Check 5 (informational, per D-15: "allowed to be non-zero... fail only
  // if a refusal was not clean" — the "not clean" case is already covered
  // by check 0/2 above; this line always passes and just reports the rate).
  const totalAttempts = acknowledged.length + refused.length + unexpected.length;
  const refusalRate = totalAttempts > 0 ? (refused.length / totalAttempts) : 0;
  checks.push({
    name: 'cleanly-refused count reported (bounded 503s are a pass, not a failure)',
    ok: true,
    detail: `refused=${refused.length}/${totalAttempts} (${(refusalRate * 100).toFixed(1)}%)`,
  });

  // ---------------------------------------------------------------------
  // Checks 6-9 (Plan 07 / CONC-02): the conflict-lane reconciliation. A 409
  // is a THIRD outcome class, distinct from both "acknowledged" and
  // "lost" — these checks prove it is counted as its own class rather than
  // silently folded into either, per T-09-34.
  // ---------------------------------------------------------------------

  const raidRow = dealConn.prepare('SELECT data FROM raidEntries WHERE id = ?').get(sharedRaidId);
  const raidData = raidRow ? JSON.parse(raidRow.data) : null;

  // Check 6: the shared conflict-probe record's version advanced by EXACTLY
  // one per acknowledged conflict-lane write — no gap, no double-count —
  // proving a 409 never partially landed even under sustained real
  // multi-process contention.
  const expectedFinalVersion = initialRaidVersion + conflictAcknowledged.length;
  checks.push({
    name: 'conflict-probe RAID record version reconciles exactly with the number of acknowledged conflict-lane writes (no lost/duplicated commit)',
    ok: !!raidData && raidData.version === expectedFinalVersion,
    detail: `initialVersion=${initialRaidVersion} conflictAcknowledged=${conflictAcknowledged.length} expectedFinalVersion=${expectedFinalVersion} actualFinalVersion=${raidData ? raidData.version : 'MISSING ROW'}`,
  });

  // Check 7: the record's final content belongs to whichever acknowledged
  // write reported the HIGHEST resulting version — the last writer to
  // commit, by construction of the version's strict +1 monotonic property
  // (Phase 8's per-file write lock serializes every commit; nothing can
  // land out of order).
  const lastWinner = conflictAcknowledged.reduce((best, w) => (!best || w.version > best.version ? w : best), null);
  checks.push({
    name: "conflict-probe RAID record's final content matches the acknowledged write that reported the highest resulting version",
    ok: !!lastWinner && !!raidData && raidData.notes === lastWinner.marker,
    detail: lastWinner
      ? `expectedNotes=${lastWinner.marker} actualNotes=${raidData ? raidData.notes : 'MISSING ROW'}`
      : 'no acknowledged conflict-lane write recorded',
  });

  // Check 8: a 409 (this run's conflict outcome class) is neither an
  // acknowledged write nor a lost one. Verified by SET MEMBERSHIP, not a row
  // COUNT comparison — this record is also re-touched, content-unchanged,
  // by every OTHER concurrent writeDb() call in this run: the pulses lane's
  // writes visit EVERY row of EVERY versioned collection on EVERY call
  // (db/store.js's whole-object snapshot-diff design, and Plan 01's
  // "untouched row" fast-path fix, which rewrites seq/data — and therefore
  // still produces an audit 'update' delta — even when a versioned row's
  // OWN content did not change). Each such re-touch mints its own audit row
  // carrying the SAME `notes` value as the last GENUINE commit, so a raw
  // row-count would over-count relative to conflictAcknowledged.length even
  // with zero violations. Membership is immune to that: every acknowledged
  // conflict-lane write's marker must appear at least once in the audit
  // trail (nothing acknowledged is missing), and no CONFLICTED (409-
  // rejected) write's marker may EVER appear there (nothing conflicted
  // secretly committed) — exactly the guarantee T-09-34 exists to prove.
  const raidUpdateAuditRows = auditConn.prepare(
    "SELECT after_json FROM audit_log WHERE deal_id = ? AND collection = 'raidEntries' AND row_id = ? AND action = 'update'"
  ).all(dealId, sharedRaidId);
  const auditedNotes = new Set();
  for (const r of raidUpdateAuditRows) {
    try { auditedNotes.add(JSON.parse(r.after_json).notes); } catch (e) { /* malformed row — never silently skip, let it fail the count below */ }
  }
  const missingFromAuditTrail = conflictAcknowledged.filter((w) => !auditedNotes.has(w.marker));
  const leakedConflictedIntoAudit = conflictConflicted.filter((w) => auditedNotes.has(w.marker));
  checks.push({
    name: '409 (conflict) outcome reconciles with the audit trail by membership — nothing acknowledged is missing, nothing conflicted ever committed (T-09-34)',
    ok: missingFromAuditTrail.length === 0 && leakedConflictedIntoAudit.length === 0,
    detail: `conflictAcknowledged=${conflictAcknowledged.length} conflict409=${conflictConflicted.length} conflictRefused503=${conflictRefused.length} auditUpdateRows=${raidUpdateAuditRows.length} missingFromAuditTrail=${missingFromAuditTrail.length} leakedConflictedIntoAudit=${leakedConflictedIntoAudit.length}`,
  });

  // Check 9 (informational, mirrors check 5's own pattern): the 409 count
  // reported explicitly, alongside the bounded-503 count, so an operator
  // can see the conflict rate rather than inferring it.
  checks.push({
    name: 'conflict (409) outcome count reported alongside the bounded-503 count',
    ok: true,
    detail: `conflict409=${conflictConflicted.length} conflictRefused503=${conflictRefused.length} conflictAcknowledged=${conflictAcknowledged.length}`,
  });

  return checks;
}

// --- Main --------------------------------------------------------------------

async function main() {
  seedScratchDataDir();
  const deal = createSoakDeal();
  console.log(`soak: created deal ${deal.id} in scratch dir ${TMP_DIR}`);

  const children = [];
  const workerLoads = [];
  let checks = null;
  let allOk = false;
  let sharedRaid = null;

  try {
    for (let i = 0; i < PROCESSES; i++) {
      const port = BASE_PORT + i;
      children.push(spawnServerChild(i, port));
    }

    const readiness = await Promise.all(
      children.map((child, i) => waitUntilReady(BASE_PORT + i, 15000))
    );
    if (!readiness.every(Boolean)) {
      throw new Error(`soak: ${readiness.filter((r) => !r).length} of ${PROCESSES} server processes never became ready within 15s`);
    }
    console.log(`soak: all ${PROCESSES} server processes ready`);

    const sessions = createWorkerSessions(PROCESSES, deal.id);

    sharedRaid = await createSharedConflictRecord(BASE_PORT, sessions[0].cookie);
    console.log(`soak: created shared conflict-probe RAID entry ${sharedRaid.id} at baseline version ${sharedRaid.initialVersion}`);

    console.log(`soak: driving load for ~${Math.round(DURATION_MS / 1000)}s across ${PROCESSES} processes...`);
    const results = await Promise.all(
      sessions.map((session, i) => runWorkerLoad(i, BASE_PORT + i, session.cookie, DURATION_MS, WRITE_INTERVAL_MS, sharedRaid))
    );
    workerLoads.push(...results);
  } finally {
    // Every spawned child is torn down here regardless of outcome — an
    // aborted run must not leave a listener holding a port or a lock on the
    // scratch files (T-08-15).
    await Promise.all(children.map(stopChild));
  }

  const acknowledged = workerLoads.flatMap((w) => w.acknowledged);
  const refused = workerLoads.flatMap((w) => w.refused);
  const conflictAcknowledged = workerLoads.flatMap((w) => w.conflict.acknowledged);
  const conflictConflicted = workerLoads.flatMap((w) => w.conflict.conflicted);
  const conflictRefused = workerLoads.flatMap((w) => w.conflict.refused);
  const unexpected = workerLoads.flatMap((w) => w.unexpected).concat(workerLoads.flatMap((w) => w.conflict.unexpected));
  console.log(
    `soak: load phase complete — acknowledged=${acknowledged.length} refused=${refused.length} unexpected=${unexpected.length} | conflict-lane: acknowledged=${conflictAcknowledged.length} conflict409=${conflictConflicted.length} refused503=${conflictRefused.length}`
  );

  checks = verify({
    dealId: deal.id, acknowledged, refused, unexpected,
    conflictAcknowledged, conflictConflicted, conflictRefused,
    sharedRaidId: sharedRaid.id, initialRaidVersion: sharedRaid.initialVersion,
  });
  allOk = checks.every((c) => c.ok);

  console.log('soak: D-15 verdict —');
  for (const c of checks) {
    console.log(`  [${c.ok ? 'PASS' : 'FAIL'}] ${c.name}: ${c.detail}`);
  }

  return { allOk, checks };
}

main()
  .then(({ allOk, checks }) => {
    try {
      store.closeAllConnections();
      auditHook.closeAuditConnection();
    } catch (e) { /* ignore — process is exiting either way */ }
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (e) { /* ignore */ }

    if (allOk) {
      console.log('soak: PASS — acknowledged-write invariant held under sustained real load.');
      process.exit(0);
    } else {
      const firstFailing = checks.find((c) => !c.ok);
      console.error(`soak: FAIL — first failing check: ${firstFailing.name} (${firstFailing.detail})`);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error('soak: FAIL — harness error:', err && err.stack ? err.stack : err);
    try {
      fs.rmSync(TMP_DIR, { recursive: true, force: true });
    } catch (e) { /* ignore */ }
    process.exit(1);
  });
