#!/usr/bin/env node
'use strict';
// Phase 12 / plan 12-05 / D-12-02 (DATA-02, PRD budget "event-loop p99 <= 100 ms
// under the 40-client profile"): reproduces the review's R2 `load-probe.js`
// Phase A with `runner.js`'s 5 ms event-loop resolution.
//
//   admin session on a fresh deal; 40 RAID entries created through POST with
//   400-char notes; 40 closed-loop clients for 45 s; request mix
//   45 % GET /api/raid, 15 % GET /api/integration-tasks, 10 % GET /api/employees,
//   25 % POST /api/raid, 5 % GET /healthz; the server's event-loop histogram is
//   reset immediately before the run.
//   R2 baseline: event-loop p99 1,921 ms. Budget: p99 <= 100 ms.
//
// Byte copies of the committed demo/control databases in a mkdtemp scratch
// directory; the REAL server in an event-loop-instrumented child.
//
//   node scripts/perf/load-40.js [--seconds N] [--clients N] [--runs N] [--assert]
//   --assert   exit 1 if ANY run misses the budget (not a median of runs)
//
// EVERY run is a FRESH scratch deal on a FRESH server (12-14 evidence refresh,
// orchestrator decision 1): the R2 review profile is one 45 s run on a fresh
// deal, and POST /api/raid is 25 % of the mix, so reusing one deal made runs
// 2-3 measure a RAID list ~15x larger than the profile (40 -> ~6,500 rows).
// With --runs N > 1 this script re-invokes itself once per run (`--run-index`,
// internal) so each run gets its own mkdtemp scratch, deal, seed and server.
// Mix, duration, clients and the budget are unchanged.
//
// Exit: 0 pass/informational, 1 assertion failed, 2 harness refused or failed,
// 130/143 interrupted. Scratch is removed on every path.

const { startInstrumentedServer } = require('./lib/instrumented-server.js');
const { createScratch, percentile, fmt } = require('./lib/scratch-deal.js');

const args = process.argv.slice(2);
const ASSERT = args.includes('--assert');
const num = (flag, dflt) => { const i = args.indexOf(flag); return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || dflt) : dflt; };
const SECONDS = num('--seconds', 45);
const CLIENTS = num('--clients', 40);
const RUNS = num('--runs', 1);
// Internal: set by the parent when it re-invokes itself, one run per child.
const RUN_INDEX = (() => { const i = args.indexOf('--run-index'); return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 1) : 0; })();
const os = require('os');
const loadAvg = () => os.loadavg().map((n) => n.toFixed(1)).join('/');

const BASELINE_ELD_P99_MS = 1921;
const BUDGET_ELD_P99_MS = 100;
const MIX = [
  [0.45, 'GET /api/raid'],
  [0.60, 'GET /api/integration-tasks'],
  [0.70, 'GET /api/employees'],
  [0.95, 'POST /api/raid'],
  [1.00, 'GET /healthz'],
];

const scratch = createScratch({ prefix: 'gsd-load-40-' });
process.once('SIGINT', () => { scratch.cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { scratch.cleanup().finally(() => process.exit(143)); });

const now = () => Number(process.hrtime.bigint()) / 1e6;
const note = 'x'.repeat(400);

async function oneRun(server, headers, run) {
  await server.reset();
  const stats = {};
  const record = (key, ms, status) => {
    const s = stats[key] || (stats[key] = { ms: [], codes: {} });
    s.ms.push(ms);
    s.codes[status] = (s.codes[status] || 0) + 1;
  };
  const loadStart = loadAvg();
  const deadline = now() + SECONDS * 1000;
  let seq = 0;

  async function client(id) {
    while (now() < deadline) {
      const r = Math.random();
      const key = MIX.find(([cut]) => r < cut)[1];
      const [method, route] = key.split(' ');
      const init = { method, headers };
      if (method === 'POST') {
        init.body = JSON.stringify({ title: `load ${run}-${id}-${seq++}`, type: 'risk', severity: 'medium', notes: note });
      }
      const t0 = now();
      let status = 0;
      try {
        const res = await fetch(server.base + route, init);
        await res.arrayBuffer();
        status = res.status;
      } catch (e) { status = 'ERR'; }
      record(key, now() - t0, status);
    }
  }

  const t0 = now();
  await Promise.all(Array.from({ length: CLIENTS }, (_, i) => client(i)));
  const elapsed = (now() - t0) / 1000;
  const eld = await server.snapshot();
  const total = Object.values(stats).reduce((n, s) => n + s.ms.length, 0);
  console.log(`run ${run}: ${total} requests in ${fmt(elapsed)} s = ${fmt(total / elapsed)} rps with ${CLIENTS} clients ` +
    `(fresh deal; host load 1/5/15 min ${loadStart} -> ${loadAvg()} at ${new Date().toISOString()})`);
  for (const [key, s] of Object.entries(stats).sort()) {
    const sorted = s.ms.slice().sort((a, b) => a - b);
    console.log(`  ${key.padEnd(28)} n=${String(sorted.length).padStart(5)} p50 ${fmt(percentile(sorted, 50)).padStart(7)} ` +
      `p95 ${fmt(percentile(sorted, 95)).padStart(7)} p99 ${fmt(percentile(sorted, 99)).padStart(7)} ms  codes ${JSON.stringify(s.codes)}`);
  }
  // Assert on the larger of the two independent server-side measures
  // (Node's histogram has been seen to miss a stall a heartbeat caught).
  const p99 = Math.max(eld.p99, eld.hbP99);
  console.log(`  event loop (5 ms resolution, idle reads ~5): p50 ${fmt(eld.p50)} p95 ${fmt(eld.p95)} p99 ${fmt(eld.p99)} max ${fmt(eld.max)} ms ` +
    `| heartbeat p99 ${fmt(eld.hbP99)} max ${fmt(eld.hbMax)} | rss ${eld.rssMb} MB`);
  console.log(`  R2 baseline event-loop p99 ${BASELINE_ELD_P99_MS} ms | budget p99 <= ${BUDGET_ELD_P99_MS} ms | measured p99 ${fmt(p99)} ms -> ` +
    `${p99 <= BUDGET_ELD_P99_MS ? 'WITHIN' : 'OVER'} budget`);
  return p99 <= BUDGET_ELD_P99_MS;
}

// One fresh scratch deal + server, `run` measured once. Returns 0/1 failures.
async function singleRun(run) {
  const setup = await scratch.setup({ username: 'perf-admin', role: 'admin' });
  const server = await startInstrumentedServer({ env: setup.childEnv, label: 'load-40', quiet: true, serverRoot: process.env.PERF_SERVER_ROOT || undefined });
  scratch.onStop(() => server.stop());
  const headers = { Cookie: setup.cookie, 'Content-Type': 'application/json' };

  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${server.base}/api/raid`, {
      method: 'POST', headers, body: JSON.stringify({ title: `Seed risk ${i}`, type: 'risk', severity: 'medium', notes: note }),
    });
    if (res.status !== 201) throw new Error(`seeding RAID entry ${i} answered ${res.status}`);
  }
  console.log(`load-40 run ${run}: deal ${setup.dealId}, 40 RAID seeded, ${CLIENTS} closed-loop clients x ${SECONDS} s`);
  return (await oneRun(server, headers, run)) ? 0 : 1;
}

// Parent of a multi-run invocation: one child process per run (fresh scratch,
// deal and server each), output relayed, failures summed.
async function main() {
  if (RUN_INDEX) return singleRun(RUN_INDEX);
  const { spawn } = require('child_process');
  let failures = 0;
  console.log(`load-40: ${RUNS} runs, each on a FRESH scratch deal + server (the R2 profile shape: 40 RAID seeded, ${CLIENTS} clients x ${SECONDS} s)\n`);
  for (let run = 1; run <= RUNS; run++) {
    const argv = [__filename, '--assert', '--runs', '1', '--run-index', String(run), '--seconds', String(SECONDS), '--clients', String(CLIENTS)];
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, argv, { stdio: 'inherit' });
      const fwd = (sig) => () => { try { child.kill(sig); } catch (e) { /* gone */ } };
      process.once('SIGINT', fwd('SIGINT'));
      process.once('SIGTERM', fwd('SIGTERM'));
      child.on('exit', (c, sig) => resolve(sig ? 130 : c));
    });
    if (code === 2 || code > 2) throw new Error(`run ${run} child failed (exit ${code})`);
    if (code !== 0) failures++;
    console.log('');
  }
  console.log(`${failures ? 'OVER BUDGET' : 'WITHIN BUDGET'}: ${RUNS - failures}/${RUNS} runs had event-loop p99 <= ${BUDGET_ELD_P99_MS} ms ` +
    `(each on a fresh deal)`);
  return failures;
}

(async () => {
  let failures = 0;
  try {
    failures = await main();
  } catch (err) {
    console.error(`load-40: FAILED: ${err && err.message}`);
    await scratch.cleanup();
    process.exit(2);
  } finally {
    await scratch.cleanup();
  }
  process.exit(ASSERT && failures ? 1 : 0);
})();
