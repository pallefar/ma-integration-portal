// Diagnostic only (never committed): the unmodified load-40 request mix against a deal PRE-GROWN to N RAID rows
// (what runs 2 and 3 of `--runs 3` inherit), with --cpu-prof on the instrumented server child.
//   node profile-load40.js <worktree-root> <prefillRaidRows> <seconds> <profDir> [cpuBusyToggle]
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = process.argv[2];
const PREFILL = Number(process.argv[3] || 5300);
const SECONDS = Number(process.argv[4] || 20);
const PROF = process.argv[5];
process.chdir(ROOT);
fs.mkdirSync(PROF, { recursive: true });
const { startInstrumentedServer } = require(path.join(ROOT, 'scripts/perf/lib/instrumented-server.js'));
const { createScratch, percentile, fmt } = require(path.join(ROOT, 'scripts/perf/lib/scratch-deal.js'));

const scratch = createScratch({ prefix: 'gsd-prof-load40-' });
const MIX = [[0.45, 'GET /api/raid'], [0.60, 'GET /api/integration-tasks'], [0.70, 'GET /api/employees'], [0.95, 'POST /api/raid'], [1.0, 'GET /healthz']];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const note = 'x'.repeat(400);

(async () => {
  let rc = 0;
  try {
    const setup = await scratch.setup({ username: 'perf-admin', role: 'admin', volume: { tasks: 0, raid: PREFILL, positions: 0 } });
    process.env.NODE_OPTIONS = `--cpu-prof --cpu-prof-dir=${PROF} --cpu-prof-name=server.cpuprofile`;
    const server = await startInstrumentedServer({ env: setup.childEnv, label: 'prof', quiet: true });
    scratch.onStop(() => server.stop());
    const headers = { Cookie: setup.cookie, 'Content-Type': 'application/json' };
    const probe = await fetch(server.base + '/api/raid', { headers });
    const body = await probe.arrayBuffer();
    console.log(`prefilled RAID rows seeded=${PREFILL}; GET /api/raid status ${probe.status}, decoded bytes ${body.byteLength}`);
    await server.reset();
    const stats = {};
    const deadline = now() + SECONDS * 1000;
    let seq = 0;
    async function client(id) {
      while (now() < deadline) {
        const r = Math.random();
        const key = MIX.find(([cut]) => r < cut)[1];
        const [method, route] = key.split(' ');
        const init = { method, headers };
        if (method === 'POST') init.body = JSON.stringify({ title: `load p-${id}-${seq++}`, type: 'risk', severity: 'medium', notes: note });
        const t0 = now();
        let status = 0;
        try { const res = await fetch(server.base + route, init); await res.arrayBuffer(); status = res.status; } catch (e) { status = 'ERR'; }
        const s = stats[key] || (stats[key] = { ms: [] });
        s.ms.push(now() - t0);
      }
    }
    const t0 = now();
    await Promise.all(Array.from({ length: 40 }, (_, i) => client(i)));
    const el = (now() - t0) / 1000;
    const eld = await server.snapshot();
    const total = Object.values(stats).reduce((n, s) => n + s.ms.length, 0);
    console.log(`profile run: ${total} requests in ${fmt(el)} s = ${fmt(total / el)} rps`);
    for (const [k, s] of Object.entries(stats).sort()) {
      const so = s.ms.slice().sort((a, b) => a - b);
      console.log(`  ${k.padEnd(28)} n=${String(so.length).padStart(5)} p50 ${fmt(percentile(so, 50)).padStart(7)} p95 ${fmt(percentile(so, 95)).padStart(7)} p99 ${fmt(percentile(so, 99)).padStart(7)} ms`);
    }
    console.log(`  event loop: p50 ${fmt(eld.p50)} p95 ${fmt(eld.p95)} p99 ${fmt(eld.p99)} max ${fmt(eld.max)} | heartbeat p99 ${fmt(eld.hbP99)} max ${fmt(eld.hbMax)} | rss ${eld.rssMb} MB`);
    await server.stop();
  } catch (e) {
    console.error('profile-load40 FAILED: ' + (e && e.stack || e));
    rc = 2;
  } finally {
    await scratch.cleanup();
  }
  process.exit(rc);
})();
