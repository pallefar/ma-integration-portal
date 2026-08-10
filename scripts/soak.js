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
    const token = sessionsDb.createSession(runtimeConn, {
      username, role: 'admin', ttlMs: 6 * 60 * 60 * 1000,
    });
    sessionsDb.bindSessionDeal(runtimeConn, token, dealId);
    sessions.push({ username, token, cookie: `ma_session=${token}` });
  }
  return sessions;
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

async function runWorkerLoad(workerIndex, port, cookie, durationMs, writeIntervalMs) {
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

  await Promise.all(Array.from({ length: LANES }, (_, laneIndex) => lane(laneIndex)));

  return { workerIndex, acknowledged, refused, unexpected };
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
function verify({ dealId, acknowledged, refused, unexpected }) {
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

  // Check 2: no refused write both committed AND was audited.
  //
  // [security] D-10: db/store.js's writeDb() commits the deal-level write in
  // its OWN transaction FIRST, then dispatches the audit append as a
  // SEPARATE, LATER transaction against audit.db. If THAT second write hits
  // contention after the deal write already committed, the no-swallow
  // contract fails the WHOLE request 503 — but the deal-level row has
  // already landed. This is a deliberate, user-approved trade-off ("Client
  // retry re-applies the write; acceptable because writeDb() re-application
  // of identical content is idempotent" — 08-RESEARCH.md D-10), not a
  // rollback failure. It is distinguishable from a genuine violation: a
  // refused write whose row committed AND has a matching audit row would
  // mean the whole request fully succeeded server-side while still lying to
  // the client about it — THAT is the real "503 lied about the rollback"
  // case D-15 exists to catch. A committed-but-unaudited row is the accepted
  // D-10 trade-off and is reported separately, not counted as a failure.
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
    name: 'no cleanly-refused write both committed AND was audited (D-10 audit-stage-busy trade-off excepted)',
    ok: committedAndAudited.length === 0,
    detail: `refused=${refused.length} committedButUnaudited(D-10 accepted trade-off)=${committedButUnaudited.length} committedAndAudited(genuine violation)=${committedAndAudited.length}`,
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
  // committed-but-unaudited row from check 2's D-10 trade-off is, BY
  // DEFINITION, absent from auditRowIdCounts and absent from `acknowledged`
  // (it was bucketed as refused, not acknowledged) — so it does not appear
  // on either side of this comparison and cannot masquerade as a pass here.
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

    console.log(`soak: driving load for ~${Math.round(DURATION_MS / 1000)}s across ${PROCESSES} processes...`);
    const results = await Promise.all(
      sessions.map((session, i) => runWorkerLoad(i, BASE_PORT + i, session.cookie, DURATION_MS, WRITE_INTERVAL_MS))
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
  const unexpected = workerLoads.flatMap((w) => w.unexpected);
  console.log(
    `soak: load phase complete — acknowledged=${acknowledged.length} refused=${refused.length} unexpected=${unexpected.length}`
  );

  checks = verify({ dealId: deal.id, acknowledged, refused, unexpected });
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
