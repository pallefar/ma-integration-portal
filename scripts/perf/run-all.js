#!/usr/bin/env node
'use strict';
// Phase 12 / plan 12-09 / D-12-02 evidence rule: ONE command that runs every
// Phase 12 performance script against its PRD budget.
//
//   node scripts/perf/run-all.js [--assert] [--runs N] [--seconds N]
//   npm run perf          (= run-all.js --assert — WR-B02, 12-REVIEW-B)
//
// Independently of --assert, a script FAILS here when its output reports a
// contract failure (a `FAIL:` line, `non-200: N` > 0, or a second concurrent
// pack answered anything but 429) — outputFailures() below — so a run whose
// 429 guard or list routes regressed can never end with `PERF PASS`.
//
//   --assert    forwarded to every script (each exits 1 when its budget is missed)
//   --runs N    measured rounds for list-reads and load-40 (default 3)
//   --seconds N load-40 duration per run (default: the script's own 45)
//
// Scripts run sequentially (they share the host — concurrent runs would measure
// each other), each in its own scratch directory under os.tmpdir() which the
// script cleans up itself. A script that refuses to start (exit 2: low disk
// space, spawn failure) is a FAIL here, never a skip.
//
// Output: each script's own log, then one summary table (budget, PRD baseline,
// measured per run, verdict), then the last line `PERF PASS` or
// `PERF FAIL <script>[, <script>...]` — 12-14 asserts on a backgrounded log.
//
// Exit code: 1 when any script exits non-zero OR a parsed measurement is over
// its budget; 0 otherwise.

const { spawnSync } = require('child_process');
const path = require('path');

const ARGV = process.argv.slice(2);
const ASSERT = ARGV.includes('--assert');
function numArg(name, dflt) {
  const i = ARGV.indexOf(name);
  if (i === -1) return dflt;
  const n = Number(ARGV[i + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`run-all: ${name} needs a positive number`);
    process.exit(2);
  }
  return n;
}
const RUNS = numArg('--runs', 3);
const SECONDS = numArg('--seconds', null);

const HERE = __dirname;

// Each entry: the script, its CLI args, the PRD budget/baseline text, and a
// parser turning the script's stdout into [{ label, value, over }] where
// `value` is the measured number the budget is judged on.
const SCRIPTS = [
  {
    name: 'write-latency',
    args: [],
    budget: 'median <= 40 ms, 1 audit row per create',
    baseline: 'raid 85.7 ms / task 96.6 ms (R5-01)',
    budgetMs: 40,
    parse(out) {
      const rows = [];
      for (const line of out.split('\n')) {
        const m = /^(POST [^:]+): median ([\d.]+) ms/.exec(line.trim());
        if (m) rows.push({ label: `${m[1]} median`, value: Number(m[2]) });
      }
      return rows;
    },
  },
  {
    name: 'list-reads',
    args: ['--runs', String(RUNS)],
    budget: '10 users x 3 list reads: p95 <= 300 ms',
    baseline: 'p50 322 ms, p95 483 ms (R5 perf2)',
    budgetMs: 300,
    parse(out) {
      const rows = [];
      for (const line of out.split('\n')) {
        const run = /^\s*run (\d+)\b/.exec(line);
        const p95 = /p95\s+([\d.]+)/.exec(line);
        if (run && p95) rows.push({ label: `run ${run[1]} p95`, value: Number(p95[1]) });
      }
      return rows;
    },
  },
  {
    name: 'load-40',
    args: ['--runs', String(RUNS)].concat(SECONDS ? ['--seconds', String(SECONDS)] : []),
    budget: '40 clients: event-loop p99 <= 100 ms',
    baseline: 'event-loop p99 1921 ms (R2)',
    budgetMs: 100,
    parse(out) {
      const rows = [];
      let n = 0;
      for (const line of out.split('\n')) {
        const m = /measured p99 ([\d.]+) ms/.exec(line);
        if (m) { n += 1; rows.push({ label: `run ${n} event-loop p99`, value: Number(m[1]) }); }
      }
      return rows;
    },
  },
  {
    name: 'pack-isolation',
    args: [],
    budget: 'pack export: event-loop p99 <= 50 ms, 2nd pack 429',
    baseline: 'event loop blocked 2397 ms per pack (R2-03)',
    budgetMs: 50,
    parse(out) {
      const rows = [];
      const m = /worst round: event loop p99 ([\d.]+) ms/.exec(out);
      if (m) rows.push({ label: 'worst round p99', value: Number(m[1]) });
      return rows;
    },
  },
];

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

/**
 * WR-B02 (12-REVIEW-B): contract failures a child REPORTED in its output, even
 * when it exited 0 (a script run without --assert prints `FAIL:` and exits 0)
 * or its latency numbers are inside budget. Returns a list of reasons:
 *   - any line beginning `FAIL:` (or `FAIL ` / `OVER BUDGET`),
 *   - a `non-200: N` count above zero (a list route answering errors),
 *   - pack-isolation: a second concurrent pack request that was not 429.
 */
function outputFailures(name, out) {
  const reasons = [];
  const text = String(out || '');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (/^FAIL[:\s]/.test(t) || /^OVER BUDGET/.test(t)) reasons.push(`reported ${t.slice(0, 120)}`);
    const n = /non-200:\s*(\d+)/.exec(t);
    if (n && Number(n[1]) > 0) reasons.push(`non-200 responses: ${n[1]}`);
  }
  if (name === 'pack-isolation') {
    const re = /concurrent pack B was (\S+), expected 429/g;
    let m;
    while ((m = re.exec(text)) !== null) reasons.push(`second concurrent pack answered ${m[1]}, not 429`);
  }
  return reasons;
}

if (require.main === module) main();

function main() {
const results = [];
for (const spec of SCRIPTS) {
  const args = [path.join(HERE, spec.name + '.js')].concat(spec.args, ASSERT ? ['--assert'] : []);
  console.log(`\n===== ${spec.name} ${spec.args.concat(ASSERT ? ['--assert'] : []).join(' ')} =====`);
  const started = Date.now();
  const child = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = (child.stdout || '') + (child.stderr || '');
  process.stdout.write(out.endsWith('\n') ? out : out + '\n');
  const exit = child.status === null ? (child.signal ? 128 : 1) : child.status;
  const measured = spec.parse(out).map((r) => Object.assign(r, { over: r.value > spec.budgetMs }));
  results.push({ spec, exit, measured, reported: outputFailures(spec.name, out), seconds: (Date.now() - started) / 1000 });
}

console.log('\n===== PERF SUMMARY =====');
console.log(pad('script', 16) + pad('budget', 50) + pad('PRD baseline', 46) + 'measured / verdict');
const failing = [];
for (const r of results) {
  const over = r.measured.some((m) => m.over);
  const noData = r.measured.length === 0;
  const ok = r.exit === 0 && !over && !noData && r.reported.length === 0;
  if (!ok) failing.push(r.spec.name);
  const measured = noData
    ? '(no measurement parsed)'
    : r.measured.map((m) => `${m.label} ${m.value.toFixed(1)} ms${m.over ? ' OVER' : ''}`).join('; ');
  console.log(pad(r.spec.name, 16) + pad(r.spec.budget, 50) + pad(r.spec.baseline, 46) +
    `${measured} | exit ${r.exit} | ${ok ? 'PASS' : 'FAIL'} (${r.seconds.toFixed(0)} s)`);
  for (const reason of r.reported) console.log(`  ${r.spec.name}: ${reason}`);
}
console.log('');
if (failing.length) {
  console.log(`PERF FAIL ${failing.join(', ')}`);
  process.exit(1);
}
console.log('PERF PASS');
}

module.exports = { outputFailures };
