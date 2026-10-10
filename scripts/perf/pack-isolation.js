#!/usr/bin/env node
'use strict';
// Phase 12 / plan 12-04 / D-12-05 (DATA-05, PRD acceptance 5): measures that the
// steering committee pack render no longer stalls the server's event loop, and
// that a second concurrent pack request is refused (429), not queued.
//
// Evidence-first: the review (R2-03) measured the pack blocking the whole
// portal for 2,397 ms per call. This script boots the REAL app in an isolated,
// event-loop-instrumented child process (scripts/perf/lib/instrumented-server.js),
// builds a deal with R2-like data, and for 3 rounds:
//   reset the child's event-loop-delay histogram
//   -> start a pinger (GET /api/auth/me every 25 ms, latencies recorded)
//   -> fire pack A -> 50 ms later fire pack B (expect 429 + Retry-After)
//   -> await A (expect 200, %PDF-) -> snapshot the histogram.
// Per round it prints the render time, the server's event-loop delay
// p50/p95/p99/max (5 ms resolution — an idle loop already reads ~5 ms; the
// figure is NOT adjusted down, so the 50 ms budget is the strict one) and the
// pinger's own p99 round trip. Two independent server-side measures are taken
// (Node's monitorEventLoopDelay histogram and a 5 ms heartbeat — the histogram
// was seen to miss a stall the client observed) and the LARGER p99 is the one
// asserted. `--assert` exits 1 if any round has event-loop
// p99 > 50 ms or B is not 429 or A is not 200.
//
//   node scripts/perf/pack-isolation.js [--assert] [--rounds N] [--baseline]
//   --baseline        informational "before" run: no pack B, no assertions.
//                     Pair with PERF_SERVER_ROOT=<dir with an earlier server.js
//                     whose pack route renders in-process> to reproduce the
//                     review's blocked-loop number.
//
// Exit codes: 0 pass, 1 assertion failed, 2 harness refused/failed (e.g. < 1 GB
// free), 130/143 interrupted. The scratch directory is removed on every path.

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const ASSERT = args.includes('--assert');
const BASELINE = args.includes('--baseline');
const roundsIdx = args.indexOf('--rounds');
const ROUNDS = roundsIdx >= 0 ? Math.max(1, parseInt(args[roundsIdx + 1], 10) || 3) : 3;

const EVENT_LOOP_P99_BUDGET_MS = 50;
const PRD_BASELINE_MS = 2397;
const PING_INTERVAL_MS = 25;
const SECOND_REQUEST_DELAY_MS = 50;

const { startInstrumentedServer, killAllInstrumentedServers, assertEnoughDisk } = require('./lib/instrumented-server.js');

let TMP_DIR = null;
let server = null;
let cleanupPromise = null;

// One shared promise: a SIGINT that lands while the normal exit path is already
// cleaning up must WAIT for that cleanup, not return early and exit over it.
function cleanup() {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      try { if (server) await server.stop(); } catch (e) { /* best effort */ }
      // A server still booting is not in `server` yet — and it is writing into
      // TMP_DIR, so it must be dead BEFORE the directory is removed.
      killAllInstrumentedServers();
      await new Promise((resolve) => setTimeout(resolve, 150));
      try { if (TMP_DIR) fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch (e) { /* best effort */ }
    })();
  }
  return cleanupPromise;
}
process.once('SIGINT', () => { cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { cleanup().finally(() => process.exit(143)); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);

async function main() {
  assertEnoughDisk();
  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-pack-isolation-'));

  // --- isolated data set: the same migrate-then-split pipeline soak.js uses ---
  process.env.MA_CONTROL_DB_PATH = path.join(TMP_DIR, 'control.db');
  process.env.MA_RUNTIME_DB_PATH = path.join(TMP_DIR, 'runtime.db');
  process.env.MA_DEMO_DB_PATH = path.join(TMP_DIR, 'demo.db');
  process.env.MA_DEALS_DIR = path.join(TMP_DIR, 'deals');
  process.env.MA_AUDIT_DB_PATH = path.join(TMP_DIR, 'audit.db');
  process.env.ADMIN_TOKEN = 'gsd-pack-isolation-token';
  const childEnv = {};
  for (const k of ['MA_CONTROL_DB_PATH', 'MA_RUNTIME_DB_PATH', 'MA_DEMO_DB_PATH', 'MA_DEALS_DIR', 'MA_AUDIT_DB_PATH', 'ADMIN_TOKEN']) {
    childEnv[k] = process.env[k];
  }

  const REPO_ROOT = path.resolve(__dirname, '..', '..');
  const { runMigration } = require('../migrate-db-json-to-sqlite.js');
  const { runSplit } = require('../split-db-into-control-demo-deals.js');
  const sourcePath = path.join(REPO_ROOT, 'db.json');
  const legacy = path.join(TMP_DIR, '.legacy-source.db');
  runMigration(sourcePath, legacy);
  runSplit({ sourcePath: legacy, outDir: TMP_DIR });
  for (const ext of ['', '-wal', '-shm']) { try { fs.unlinkSync(legacy + ext); } catch (e) { /* ignore */ } }

  const store = require('../../db/store.js');
  const dbFiles = require('../../db/dbFiles.js');
  const controlStore = require('../../db/controlStore.js');
  const sessionsDb = require('../../db/sessions.js');
  const { createDealDatabase } = require('../../db/dealSeed.js');

  const deal = controlStore.createDeal({
    name: 'Pack Isolation Deal', targetCompany: 'Pack Isolation Target Co', members: [], createdBy: 'pack-isolation',
  });
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });
  controlStore.createAccount({
    username: 'pack-iso-admin', name: 'Pack Isolation Admin', role: 'admin', disabled: false,
    mustChangePassword: false, createdAt: new Date().toISOString(), createdBy: 'pack-isolation',
  });
  const runtimeConn = store.getOrOpenConnection(dbFiles.RUNTIME_DB_PATH, dbFiles.RUNTIME_SCHEMA_PATH);
  const token = sessionsDb.createSession(runtimeConn, { username: 'pack-iso-admin', role: 'admin', ttlMs: 2 * 60 * 60 * 1000 });
  sessionsDb.bindSessionDeal(runtimeConn, token, deal.id);
  const cookie = `ma_session=${token}`;

  server = await startInstrumentedServer({
    env: childEnv, label: 'pack-server', quiet: true,
    serverRoot: process.env.PERF_SERVER_ROOT || undefined,
  });
  const base = server.base;
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };

  // --- R2-like data, through the real write routes (so audit etc. is real) ---
  const note = 'x'.repeat(400);
  for (let i = 0; i < 40; i++) {
    const r = await fetch(`${base}/api/raid`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: `Perf risk ${i}`, type: ['risk', 'issue', 'decision', 'dependency'][i % 4], severity: 'medium', notes: note }),
    });
    if (r.status !== 200 && r.status !== 201) throw new Error(`seed RAID ${i} -> ${r.status} ${await r.text()}`);
  }
  for (let i = 0; i < 30; i++) {
    const r = await fetch(`${base}/api/integration-tasks`, {
      method: 'POST', headers,
      body: JSON.stringify({ title: `Perf task ${i}`, status: ['todo', 'doing', 'done'][i % 3], phase: 'day1' }),
    });
    if (r.status !== 200 && r.status !== 201) throw new Error(`seed task ${i} -> ${r.status} ${await r.text()}`);
  }

  // --- warm-up: cold worker start + canvas/font load is not the steady state ---
  const warm = await fetch(`${base}/api/reports/pack?lang=en`, { headers: { Cookie: cookie } });
  const warmBytes = Buffer.from(await warm.arrayBuffer());
  if (warm.status !== 200 || warmBytes.toString('binary', 0, 5) !== '%PDF-') {
    throw new Error(`warm-up pack -> ${warm.status} (${warmBytes.length} bytes) — cannot measure`);
  }
  console.log(`warm-up pack: 200, ${warmBytes.length} bytes`);
  const load1 = os.loadavg()[0];
  if (load1 > os.cpus().length) {
    console.log(`WARNING: host is oversubscribed (1-min load ${load1.toFixed(1)} on ${os.cpus().length} CPUs) — the figures below include OS scheduling noise; compare against the idle floor and re-run on a quiet host before trusting a failure.`);
  }
  console.log(`PRD baseline (R2-03, in-process render): event loop blocked ${PRD_BASELINE_MS} ms per pack\n`);

  function startPinger() {
    const latencies = [];
    const inFlight = new Set();
    const timer = setInterval(() => {
      const t0 = now();
      const p = fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })
        .then((r) => r.arrayBuffer())
        .then(() => { latencies.push(now() - t0); })
        .catch(() => { latencies.push(Infinity); })
        .finally(() => inFlight.delete(p));
      inFlight.add(p);
    }, PING_INTERVAL_MS);
    return {
      async stop() {
        clearInterval(timer);
        await Promise.all([...inFlight]);
        return latencies.slice().sort((a, b) => a - b);
      },
    };
  }

  // Idle noise floor for context (what an unloaded 5 ms-resolution loop reads).
  await server.reset();
  const idlePinger = startPinger();
  await sleep(1000);
  const idlePings = await idlePinger.stop();
  const idle = await server.snapshot();
  console.log(`idle (1 s, pinger only): eld p50 ${fmt(idle.p50)} p99 ${fmt(idle.p99)} max ${fmt(idle.max)} ms (heartbeat p99 ${fmt(idle.hbP99)} max ${fmt(idle.hbMax)}) | ping p99 ${fmt(percentile(idlePings, 99))} ms\n`);

  const rows = [];
  for (let round = 1; round <= ROUNDS; round++) {
    await server.reset();
    const pinger = startPinger();
    const t0 = now();
    const packA = fetch(`${base}/api/reports/pack?lang=en`, { headers: { Cookie: cookie } })
      .then(async (r) => ({ status: r.status, buf: Buffer.from(await r.arrayBuffer()), at: now() }));
    let packB = null;
    if (!BASELINE) {
      await sleep(SECOND_REQUEST_DELAY_MS);
      packB = fetch(`${base}/api/reports/pack?lang=en`, { headers: { Cookie: cookie } })
        .then(async (r) => ({ status: r.status, retryAfter: r.headers.get('retry-after'), text: await r.text() }));
    }
    const a = await packA;
    const b = packB ? await packB : null;
    const pings = await pinger.stop();
    const eld = await server.snapshot();
    const row = {
      round,
      renderMs: a.at - t0,
      aStatus: a.status,
      aPdf: a.buf.toString('binary', 0, 5) === '%PDF-',
      bStatus: b ? b.status : null,
      bRetryAfter: b ? b.retryAfter : null,
      eldP50: eld.p50, eldP95: eld.p95, eldP99: Math.max(eld.p99, eld.hbP99), eldMax: Math.max(eld.max, eld.hbMax),
      histP99: eld.p99, histMax: eld.max, hbP99: eld.hbP99, hbMax: eld.hbMax,
      pingP99: percentile(pings, 99), pingMax: pings.length ? pings[pings.length - 1] : 0, pings: pings.length,
      rssMb: eld.rssMb,
    };
    rows.push(row);
    console.log(
      `round ${round}: render ${fmt(row.renderMs)} ms (A=${row.aStatus}${row.aPdf ? ' %PDF-' : ''}` +
      `${b ? `, B=${row.bStatus} Retry-After=${row.bRetryAfter}` : ''}) | ` +
      `event loop p50 ${fmt(row.eldP50)} p95 ${fmt(row.eldP95)} p99 ${fmt(row.eldP99)} max ${fmt(row.eldMax)} ms ` +
      `[histogram p99 ${fmt(row.histP99)} max ${fmt(row.histMax)}; heartbeat p99 ${fmt(row.hbP99)} max ${fmt(row.hbMax)}] | ` +
      `ping p99 ${fmt(row.pingP99)} max ${fmt(row.pingMax)} ms (${row.pings} pings) | rss ${row.rssMb} MB`
    );
  }

  const worstP99 = Math.max(...rows.map((r) => r.eldP99));
  const worstMax = Math.max(...rows.map((r) => r.eldMax));
  console.log(`\nworst round: event loop p99 ${fmt(worstP99)} ms, max ${fmt(worstMax)} ms (budget p99 <= ${EVENT_LOOP_P99_BUDGET_MS} ms; baseline blocked ${PRD_BASELINE_MS} ms)`);

  if (BASELINE) { console.log('baseline run: informational only, no assertions.'); return 0; }

  const failures = [];
  for (const r of rows) {
    if (r.aStatus !== 200 || !r.aPdf) failures.push(`round ${r.round}: pack A was ${r.aStatus}${r.aPdf ? '' : ' (no %PDF- header)'}, expected 200 PDF`);
    if (r.bStatus !== 429) failures.push(`round ${r.round}: concurrent pack B was ${r.bStatus}, expected 429`);
    else if (r.bRetryAfter !== '5') failures.push(`round ${r.round}: pack B Retry-After was ${r.bRetryAfter}, expected 5`);
    if (r.eldP99 > EVENT_LOOP_P99_BUDGET_MS) failures.push(`round ${r.round}: event-loop p99 ${fmt(r.eldP99)} ms > ${EVENT_LOOP_P99_BUDGET_MS} ms`);
  }
  if (failures.length) {
    console.log('\nFAIL:\n  ' + failures.join('\n  '));
    return ASSERT ? 1 : 0;
  }
  console.log(`\nPASS: every round event-loop p99 <= ${EVENT_LOOP_P99_BUDGET_MS} ms, second concurrent request refused 429 + Retry-After.`);
  return 0;
}

main().then(
  async (code) => { await cleanup(); process.exit(code); },
  async (err) => {
    await cleanup();
    if (err && err.code === 'PERF_LOW_DISK') { console.error(err.message); process.exit(2); }
    console.error('pack-isolation failed:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
);
