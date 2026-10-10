#!/usr/bin/env node
'use strict';
// Phase 12 / plan 12-05 / D-12-02 (DATA-02, PRD budget "10 users x 3 list reads
// p95 <= 300 ms"): reproduces the review's R5 `perf2.js` profile verbatim.
//
//   deal seeded 1,000 tasks / 5,000 RAID / 200 positions in the active lanes,
//   hrbp member session, 30 CONCURRENT GETs = 10 x { /api/raid,
//   /api/integration-tasks, /api/org/positions } (unparameterized), sent with
//   Accept-Encoding: gzip like a browser; p95 = sorted[28].
//   R5 baseline: p50 322 ms, p95 483 ms. Budget: p95 <= 300 ms.
//
// Run on byte copies of the committed demo/control databases in a mkdtemp
// scratch directory (never the committed files), against the REAL server in an
// event-loop-instrumented child (scripts/perf/lib/instrumented-server.js).
//
//   node scripts/perf/list-reads.js [--runs N] [--assert]
//   --runs N    measured rounds (default 1; 3 warm-up rounds always run first)
//   --assert    exit 1 if ANY run misses the budget (not a median of runs)
//
// Exit: 0 pass/informational, 1 assertion failed, 2 harness refused or failed
// (e.g. < 1 GB free), 130/143 interrupted. Scratch is removed on every path.

const { startInstrumentedServer } = require('./lib/instrumented-server.js');
const { createScratch, percentile, fmt } = require('./lib/scratch-deal.js');

const args = process.argv.slice(2);
const ASSERT = args.includes('--assert');
const runsIdx = args.indexOf('--runs');
const RUNS = runsIdx >= 0 ? Math.max(1, parseInt(args[runsIdx + 1], 10) || 1) : 1;

const BASELINE = { p50: 322, p95: 483 };
const BUDGET_P95_MS = 300;
const WARMUPS = 3;
const ROUTES = ['/api/raid', '/api/integration-tasks', '/api/org/positions'];

const scratch = createScratch({ prefix: 'gsd-list-reads-' });
process.once('SIGINT', () => { scratch.cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { scratch.cleanup().finally(() => process.exit(143)); });

const now = () => Number(process.hrtime.bigint()) / 1e6;

/** 30 concurrent GETs (10 per route); returns sorted latencies and per-route bytes. */
async function round(base, headers, suffixes) {
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    for (const route of ROUTES) {
      const url = base + route + ((suffixes && suffixes[route]) || '');
      jobs.push((async () => {
        const t0 = now();
        const res = await fetch(url, { headers });
        const body = await res.arrayBuffer();
        return { ms: now() - t0, status: res.status, route, bytes: body.byteLength };
      })());
    }
  }
  const results = await Promise.all(jobs);
  return { results, sorted: results.map((r) => r.ms).sort((a, b) => a - b) };
}

function summarize(label, r) {
  const bad = r.results.filter((x) => x.status !== 200);
  const bytes = {};
  r.results.forEach((x) => { bytes[x.route] = x.bytes; });
  return `${label}: p50 ${fmt(percentile(r.sorted, 50))} ms, p95 ${fmt(r.sorted[28])} ms, max ${fmt(r.sorted[29])} ms` +
    ` | non-200: ${bad.length} | bytes ${ROUTES.map((x) => `${x.split('/').pop()}=${bytes[x]}`).join(' ')}`;
}

async function main() {
  const setup = await scratch.setup({
    username: 'perf-hrbp', role: 'hrbp', volume: { tasks: 1000, raid: 5000, positions: 200 },
  });
  const server = await startInstrumentedServer({ env: setup.childEnv, label: 'list-reads', quiet: true, serverRoot: process.env.PERF_SERVER_ROOT || undefined });
  scratch.onStop(() => server.stop());
  const headers = { Cookie: setup.cookie, 'Accept-Encoding': 'gzip' };

  console.log(`list-reads: deal ${setup.dealId} seeded ${JSON.stringify(setup.seeded.counts)} in lanes ` +
    `${setup.seeded.taskLane}/${setup.seeded.raidLane}/${setup.seeded.positionLane}`);
  console.log(`R5 baseline (perf2.js, 10 users x 3 list reads): p50 ${BASELINE.p50} ms, p95 ${BASELINE.p95} ms | budget p95 <= ${BUDGET_P95_MS} ms\n`);

  for (let i = 0; i < WARMUPS; i++) await round(server.base, headers);

  let failures = 0;
  for (let run = 1; run <= RUNS; run++) {
    await server.reset();
    const r = await round(server.base, headers);
    const eld = await server.snapshot();
    const p95 = r.sorted[28];
    const ok = p95 <= BUDGET_P95_MS && r.results.every((x) => x.status === 200);
    if (!ok) failures++;
    console.log(summarize(`run ${run}`, r));
    console.log(`        event loop during the round: p50 ${fmt(eld.p50)} p99 ${fmt(eld.p99)} max ${fmt(eld.max)} ms ` +
      `(heartbeat p99 ${fmt(eld.hbP99)} max ${fmt(eld.hbMax)}) | rss ${eld.rssMb} MB | ${ok ? 'within' : 'OVER'} budget`);
  }

  // Informational: per-route latency inside one 30-request round, and the
  // single-request (sequential, unloaded) median per route.
  const perRoute = await round(server.base, headers);
  for (const route of ROUTES) {
    const ms = perRoute.results.filter((x) => x.route === route).map((x) => x.ms).sort((a, b) => a - b);
    console.log(`\ninformational ${route.padEnd(24)} in-round p50 ${fmt(percentile(ms, 50))} p95 ${fmt(percentile(ms, 95))} ms`);
  }
  for (const route of [...ROUTES, '/api/raid?limit=50']) {
    const ms = [];
    let bytes = 0;
    for (let i = 0; i < 9; i++) {
      const t0 = now();
      const res = await fetch(server.base + route, { headers });
      bytes = (await res.arrayBuffer()).byteLength;
      ms.push(now() - t0);
    }
    ms.sort((a, b) => a - b);
    console.log(`informational ${route.padEnd(24)} single sequential median ${fmt(ms[4])} ms (min ${fmt(ms[0])}) payload ${bytes} B`);
  }

  // Informational: the same round with the paged form on the two big lists.
  const paged = await round(server.base, headers, { '/api/raid': '?limit=50', '/api/integration-tasks': '?limit=50' });
  console.log(`\ninformational, ?limit=50 on raid + integration-tasks (tasks route not converted until 12-09/12-10): ` +
    summarize('paged', paged));
  console.log(`\n${failures ? 'OVER BUDGET' : 'WITHIN BUDGET'}: ${RUNS - failures}/${RUNS} runs had p95 <= ${BUDGET_P95_MS} ms ` +
    `(tasks/org/employees are converted in later waves; 12-14 asserts the budget)`);
  return failures;
}

(async () => {
  let failures = 0;
  try {
    failures = await main();
  } catch (err) {
    console.error(`list-reads: FAILED: ${err && err.message}`);
    await scratch.cleanup();
    process.exit(2);
  } finally {
    await scratch.cleanup();
  }
  process.exit(ASSERT && failures ? 1 : 0);
})();
