#!/usr/bin/env node
'use strict';
// D-12-01 / DATA-01 (Phase 12): write-latency + audit-amplification measurement
// at the volume the v3.0 review measured (R5-01: 1,000 tasks / 5,000 RAID / 200
// positions). Prints, for POST /api/raid and POST /api/integration-tasks:
//
//   - median / p95 / max latency of N sequential creates (PRD baseline at
//     volume: 85.7 ms RAID / 96.6 ms task; budget: median <= 40 ms),
//   - audit rows appended per create (must be exactly 1.0 — baseline 6,220),
//   - a store-level reorder probe (reverse the first 10 RAID rows through
//     writeDb(): audit rows must be 0 and the new order must persist).
//
// Usage:
//   node scripts/perf/write-latency.js            # measure and print
//   node scripts/perf/write-latency.js --assert   # exit 1 when a budget is missed
//   node scripts/perf/write-latency.js --n=41     # more samples (default 21)
//
// [security] T-12-15 / T-12-16: never touches the committed data/ tree. Every
// MA_* path is pointed at a fresh fs.mkdtempSync() directory BEFORE any repo
// module is required, and every resolved path is asserted to sit under that
// directory before a database is opened. The scratch directory is removed in a
// `finally` and from the SIGINT/SIGTERM handlers, so an interrupted run never
// leaves its scratch behind; the run refuses to start (exit 2) when the temp
// volume has less than 1 GB free (this host's disk is routinely near full).

const fs = require('fs');
const os = require('os');
const path = require('path');

const ARGV = process.argv.slice(2);
const ASSERT = ARGV.includes('--assert');
const nArg = ARGV.find((a) => a.startsWith('--n='));
const SAMPLES = nArg ? Math.max(3, parseInt(nArg.slice(4), 10) || 21) : 21;
const WARMUP = 3;
const BUDGET_MS = 40;
const BASELINE = { raid: 85.7, task: 96.6 };
const MIN_FREE_BYTES = 1024 * 1024 * 1024;

// --- Scratch hygiene: disk precondition first, then the temp dir -----------
function freeBytes(dir) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}
{
  const free = freeBytes(os.tmpdir());
  if (free < MIN_FREE_BYTES) {
    const mb = (n) => Math.round(n / (1024 * 1024));
    console.error(
      `write-latency: refusing to start — ${os.tmpdir()} has ${mb(free)} MB free, needs at least ${mb(MIN_FREE_BYTES)} MB ` +
      `(short by ${mb(MIN_FREE_BYTES - free)} MB). Free some disk and re-run.`
    );
    process.exit(2);
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-write-latency-'));
process.env.MA_CONTROL_DB_PATH = path.join(TMP, 'control.db');
process.env.MA_RUNTIME_DB_PATH = path.join(TMP, 'runtime.db');
process.env.MA_DEMO_DB_PATH = path.join(TMP, 'demo.db');
process.env.MA_DEALS_DIR = path.join(TMP, 'deals');
process.env.MA_AUDIT_DB_PATH = path.join(TMP, 'audit.db');
for (const key of ['MA_MODE', 'MA_DATA_DIR', 'DEMO_OPEN', 'ADMIN_TOKEN']) delete process.env[key];

let httpServer = null;
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { if (httpServer) httpServer.close(); } catch (e) { /* ignore */ }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}
const fmt = (n) => n.toFixed(1);

async function main() {
  const dbFiles = require('../../db/dbFiles.js');
  // T-12-15: the self-check — every resolved path must sit under the scratch dir.
  const resolved = {
    control: dbFiles.CONTROL_DB_PATH, runtime: dbFiles.RUNTIME_DB_PATH, demo: dbFiles.DEMO_DB_PATH,
    audit: dbFiles.AUDIT_DB_PATH, deals: dbFiles.DEALS_DIR,
  };
  const root = path.resolve(TMP) + path.sep;
  for (const [name, p] of Object.entries(resolved)) {
    if (!path.resolve(p).startsWith(root)) {
      throw new Error(`write-latency: resolved ${name} path ${p} is outside the scratch dir ${TMP} — refusing to open it`);
    }
  }

  const store = require('../../db/store.js');
  const auditHook = require('../../db/auditHook.js');
  const resolver = require('../../db/resolver.js');
  const { createDealFixture } = require('../../test/helpers/deal-fixture.js');
  const { seedVolumeDeal } = require('./lib/volume-deal.js');

  // demo.db must exist before createDealDatabase() reads its template rows.
  store.getOrOpenConnection(dbFiles.DEMO_DB_PATH, dbFiles.DEAL_SCHEMA_PATH);
  const controlConn = store.getOrOpenConnection(dbFiles.CONTROL_DB_PATH, dbFiles.CONTROL_SCHEMA_PATH);
  const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);

  const DEAL_ID = 'deal_writelatency';
  const fixture = createDealFixture({
    controlConn, runtimeConn, dealId: DEAL_ID,
    members: [{ username: 'karen', role: 'hrbp' }],
  });
  const seeded = seedVolumeDeal({ dealDbPath: dbFiles.dealDbPath(DEAL_ID), tasks: 1000, raid: 5000, positions: 200 });
  console.log(
    `write-latency: seeded ${seeded.counts.tasks} tasks (${seeded.taskLane}), ${seeded.counts.raid} RAID (${seeded.raidLane}), ` +
    `${seeded.counts.positions} positions (${seeded.positionLane}); samples=${SAMPLES} warmup=${WARMUP}`
  );

  const app = require('../../server.js');
  httpServer = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1');
    s.once('listening', () => resolve(s));
    s.once('error', reject);
  });
  const base = `http://127.0.0.1:${httpServer.address().port}`;

  async function post(urlPath, body) {
    const res = await fetch(`${base}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: fixture.cookie('karen') },
      body: JSON.stringify(body),
    });
    await res.text();
    if (res.status !== 201) throw new Error(`POST ${urlPath} -> ${res.status} (expected 201)`);
  }

  async function measure(label, urlPath, mkBody) {
    for (let i = 0; i < WARMUP; i++) await post(urlPath, mkBody(`warm-${i}`));
    const auditBefore = auditHook.countAudit({ dealId: DEAL_ID });
    const times = [];
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      await post(urlPath, mkBody(`sample-${i}`));
      times.push(performance.now() - t0);
    }
    const rowsPerCreate = (auditHook.countAudit({ dealId: DEAL_ID }) - auditBefore) / SAMPLES;
    return { label, times, median: median(times), p95: percentile(times, 95), max: Math.max(...times), rowsPerCreate };
  }

  const raid = await measure('POST /api/raid', '/api/raid', (n) => ({ type: 'risk', title: `Latency ${n}`, severity: 'low' }));
  const task = await measure('POST /api/integration-tasks', '/api/integration-tasks', (n) => ({ title: `Latency ${n}`, workstreamId: 'ws_imo', phase: 'd30' }));

  // Store-level reorder probe: same actor/request context an HTTP request carries.
  const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'karen', role: 'hrbp', dealId: DEAL_ID, sessionId: 'sess_karen' } };
  const r = resolver.resolveDatabase(fakeReq);
  const ctx = {
    conn: store.getOrOpenConnection(r.dbPath, r.schemaPath), kind: r.kind, dealId: r.dealId, dbPath: r.dbPath,
    actor: { username: 'karen', role: 'hrbp', sessionId: 'sess_karen' }, request: { method: 'PERF', path: '/whatever', ip: null },
  };
  const reorderBefore = auditHook.countAudit({ dealId: DEAL_ID });
  let expectedOrder;
  const t0 = performance.now();
  store.runWithDb(ctx, () => {
    const db = store.readDb();
    const lane = db[seeded.raidLane];
    expectedOrder = lane.slice(0, 10).map((x) => x.id).reverse();
    db[seeded.raidLane] = [...lane.slice(0, 10).reverse(), ...lane.slice(10)];
    store.writeDb(db);
  });
  const reorderMs = performance.now() - t0;
  const reorderRows = auditHook.countAudit({ dealId: DEAL_ID }) - reorderBefore;
  const persisted = store.runWithDb(ctx, () => store.readDb())[seeded.raidLane].slice(0, 10).map((x) => x.id);
  const reorderPersisted = JSON.stringify(persisted) === JSON.stringify(expectedOrder);

  // --- Report ---------------------------------------------------------------
  const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (e) { return 0; } };
  const auditBytes = sizeOf(dbFiles.AUDIT_DB_PATH) + sizeOf(dbFiles.AUDIT_DB_PATH + '-wal');
  console.log('');
  console.log(`baseline (PRD / R5-01 at volume): POST /api/raid ${BASELINE.raid} ms, POST /api/integration-tasks ${BASELINE.task} ms, ~6,220 audit rows per create`);
  console.log(`budget: median <= ${BUDGET_MS} ms, exactly 1 audit row per create, 0 per reorder`);
  console.log('');
  for (const m of [raid, task]) {
    console.log(`${m.label}: median ${fmt(m.median)} ms  p95 ${fmt(m.p95)} ms  max ${fmt(m.max)} ms  (n=${SAMPLES})  audit rows per create ${m.rowsPerCreate.toFixed(1)}`);
  }
  console.log(`reorder probe (reverse first 10 RAID rows via writeDb): ${fmt(reorderMs)} ms, audit rows ${reorderRows}, order persisted ${reorderPersisted}`);
  console.log(`audit.db after ${2 * (SAMPLES + WARMUP)} creates + 1 reorder: ${(auditBytes / 1024).toFixed(0)} KB`);

  const failures = [];
  for (const m of [raid, task]) {
    if (m.median > BUDGET_MS) failures.push(`${m.label} median ${fmt(m.median)} ms > ${BUDGET_MS} ms`);
    if (m.rowsPerCreate !== 1) failures.push(`${m.label} audit rows per create ${m.rowsPerCreate} != 1`);
  }
  if (reorderRows !== 0) failures.push(`reorder appended ${reorderRows} audit rows (expected 0)`);
  if (!reorderPersisted) failures.push('reorder did not persist');

  if (failures.length) {
    console.log(`\nwrite-latency: ${ASSERT ? 'FAIL' : 'budget NOT met (informational — run with --assert to gate)'}`);
    for (const f of failures) console.log(`  - ${f}`);
  } else {
    console.log('\nwrite-latency: PASS — budgets met');
  }
  return ASSERT && failures.length ? 1 : 0;
}

(async () => {
  let code = 1;
  try {
    code = await main();
  } catch (err) {
    console.error((err && err.stack) || err);
  } finally {
    cleanup(); // also covered by the SIGINT/SIGTERM handlers above
  }
  process.exit(code);
})();
