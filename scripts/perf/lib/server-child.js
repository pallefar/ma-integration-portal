'use strict';
// Phase 12 perf harness (plan 12-04, D-12-05): the fork target behind
// scripts/perf/lib/instrumented-server.js. It boots the REAL requireable app
// (server.js — never a reimplementation) on an ephemeral 127.0.0.1 port, with
// event-loop-delay monitoring switched on for the whole process lifetime, and
// answers two IPC commands so a measuring script can scope a window exactly:
//
//   { cmd: 'reset',    id } -> h.reset(); replies { type: 'ack', id }
//   { cmd: 'snapshot', id } -> replies { type: 'snapshot', id, stats }
//
// `stats` is in milliseconds. The histogram is Node's monitorEventLoopDelay at
// 5 ms resolution (the R2 runner.js profile); because each sample is the time
// between two consecutive timer ticks, an idle loop reads ~5 ms, not 0 — the
// resolution is reported alongside so a reader can subtract it. The values
// here are NOT adjusted: a budget asserted against them is the stricter one.
//
// The parent supplies the isolated environment (MA_* temp paths, ADMIN_TOKEN);
// this file never chooses a data location itself. PERF_SERVER_ROOT (optional)
// names a directory holding a server.js to measure instead of this repo's —
// used to take a "before" number from an earlier commit's tree.

const path = require('path');
const { monitorEventLoopDelay } = require('perf_hooks');

const RESOLUTION_MS = 5;
const h = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
h.enable();

const root = process.env.PERF_SERVER_ROOT
  ? path.resolve(process.env.PERF_SERVER_ROOT)
  : path.resolve(__dirname, '..', '..', '..');
const app = require(path.join(root, 'server.js'));

// Cross-check (added after the first measurement runs): the Node histogram was
// observed to MISS a block that the client plainly saw (a 480 ms ping stall
// with a histogram max of 7 ms, in a minority of windows). A plain 5 ms
// setInterval heartbeat records every gap between its own ticks, so a stall
// always shows up as one large gap. Both are reported; scripts assert on the
// larger of the two p99 values.
const hbGaps = [];
let hbLast = process.hrtime.bigint();
const hb = setInterval(() => {
  const t = process.hrtime.bigint();
  hbGaps.push(Number(t - hbLast) / 1e6);
  hbLast = t;
}, RESOLUTION_MS);
function hbPercentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

const ms = (ns) => Math.round((ns / 1e6) * 100) / 100;
const r2 = (v) => Math.round(v * 100) / 100;
function stats() {
  const sorted = hbGaps.slice().sort((a, b) => a - b);
  return {
    min: ms(h.min), mean: ms(h.mean), p50: ms(h.percentile(50)), p95: ms(h.percentile(95)),
    p99: ms(h.percentile(99)), max: ms(h.max), resolutionMs: RESOLUTION_MS,
    hbCount: sorted.length, hbP50: r2(hbPercentile(sorted, 50)), hbP95: r2(hbPercentile(sorted, 95)),
    hbP99: r2(hbPercentile(sorted, 99)), hbMax: r2(sorted.length ? sorted[sorted.length - 1] : 0),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  };
}

const server = app.listen(0, '127.0.0.1', () => {
  process.send({ type: 'listening', port: server.address().port });
});

process.on('message', (m) => {
  if (!m || typeof m !== 'object') return;
  if (m.cmd === 'reset') { h.reset(); hbGaps.length = 0; hbLast = process.hrtime.bigint(); process.send({ type: 'ack', id: m.id }); }
  else if (m.cmd === 'snapshot') process.send({ type: 'snapshot', id: m.id, stats: stats() });
});

// The parent is the only owner of this process: when its channel closes (the
// parent exited or crashed) there is nobody left to measure for.
process.on('disconnect', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
