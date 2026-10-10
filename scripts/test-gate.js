#!/usr/bin/env node
'use strict';
// D-12-06 / DATA-06 (Phase 12, plan 15, planner decision PD-26): the test gate.
//
// One command that answers "is the suite green N times in a row, and does the
// whole stack still hold under a short multi-process soak?":
//
//   npm run test:gate                      # suite 2x, then a light soak smoke
//   npm run test:gate -- --runs 20         # the 20-consecutive-green evidence run
//   npm run test:gate -- --runs 1 --no-soak
//   npm run test:gate -- --help
//
// Verdict contract (so a backgrounded log can be asserted on): EVERY
// invocation ends with exactly one machine-checkable last line,
//   GATE PASS runs=<N>
//   GATE FAIL at run <i>
//   GATE FAIL at soak
//   GATE FAIL bad arguments
// A run counts as green only when BOTH the child's exit code is 0 AND a TAP
// `# fail 0` summary line was parsed (and `# cancelled 0` when present). A
// crashed or truncated run that printed no summary is a failure, never a pass
// (threat T-12-05, repudiation: a green verdict must not be reachable from a
// partial run).
//
// [security] This script is deliberately NEVER executed by the suite beyond
// `--help` (test/ci-workflow.test.js) — a full gate run from inside
// `node --test` would recurse into itself. Because its basename starts with
// `test-`, `node --test` auto-discovers and launches it; the NODE_TEST_CONTEXT
// guard in main() turns that into a no-op (`GATE SKIP`, exit 0). The soak smoke seeds its own
// os.tmpdir() scratch directory and removes it (scripts/soak.js); it never
// touches the committed data/ tree.
//
// Light soak defaults: SOAK_PROCESSES=2 SOAK_DURATION_MS=6000
// SOAK_WRITE_INTERVAL_MS=400 — small enough for a disk-constrained dev host.
// Any of the three may be overridden from the caller's environment
// (e.g. SOAK_DURATION_MS=20000 npm run test:gate) because the soak script
// reads the same variables.

const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_RUNS = 2;
const SUITE_TIMEOUT_MS = 20 * 60 * 1000; // a hung suite is a failure, not a hang
const TAIL_BYTES = 64 * 1024; // the TAP summary is the last few lines of output

const HELP = [
  'Usage: node scripts/test-gate.js [--runs N] [--no-soak] [--help]',
  '',
  'Runs `node --test` N times sequentially (default ' + DEFAULT_RUNS + '), then a short soak smoke',
  '(scripts/soak.js, 2 processes). Exits 0 only when every run reports `# fail 0`',
  'and the soak exits 0. The last output line is `GATE PASS runs=<N>` or',
  '`GATE FAIL at run <i>` / `GATE FAIL at soak`.',
  '',
  'Flags:',
  '  --runs N     number of full-suite runs, integer >= 1 (default ' + DEFAULT_RUNS + ')',
  '  --no-soak    skip the soak smoke (suite runs only)',
  '  --help       print this text and exit 0 without running anything',
  '',
  'Soak smoke env (defaults shown, all overridable): SOAK_PROCESSES=2',
  'SOAK_DURATION_MS=6000 SOAK_WRITE_INTERVAL_MS=400',
].join('\n');

function parseArgs(argv) {
  const opts = { runs: DEFAULT_RUNS, soak: true, help: false, error: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      opts.help = true;
    } else if (a === '--no-soak') {
      opts.soak = false;
    } else if (a === '--runs' || a.startsWith('--runs=')) {
      const raw = a === '--runs' ? argv[++i] : a.slice('--runs='.length);
      if (typeof raw !== 'string' || !/^\d+$/.test(raw) || parseInt(raw, 10) < 1) {
        opts.error = '--runs requires an integer >= 1 (got ' + JSON.stringify(raw) + ')';
      } else {
        opts.runs = parseInt(raw, 10);
      }
    } else {
      opts.error = 'unknown argument ' + JSON.stringify(a);
    }
  }
  return opts;
}

// Pull the last `# <label> <n>` (TAP) or `ℹ <label> <n>` (spec) summary count.
function lastCount(text, label) {
  const re = new RegExp('^(?:# |\\u2139 )' + label + ' (\\d+)\\s*$', 'gm');
  let m;
  let value = null;
  while ((m = re.exec(text)) !== null) value = parseInt(m[1], 10);
  return value;
}

// Spawn a child, stream its output through, keep only a bounded tail for
// parsing. Resolves { code, signal, tail, timedOut } and never rejects.
function runChild(args, env, timeoutMs) {
  return new Promise((resolve) => {
    let tail = '';
    let timedOut = false;
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      tail = (tail + chunk.toString('utf8')).slice(-TAIL_BYTES);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      tail = (tail + chunk.toString('utf8')).slice(-TAIL_BYTES);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, tail: tail + '\nspawn error: ' + err.message, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, tail, timedOut });
    });
  });
}

function finish(line, code) {
  // One write, newline-terminated, so it is reliably the log's last line.
  process.stdout.write(line + '\n', () => process.exit(code));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(HELP + '\n');
    process.exit(0);
  }
  if (opts.error) {
    process.stderr.write('test-gate: ' + opts.error + '\n' + HELP + '\n');
    return finish('GATE FAIL bad arguments', 2);
  }
  // Recursion guard. `node --test` with no arguments auto-discovers any file
  // whose basename starts with `test-` — which includes THIS script — and runs
  // it as a test file with NODE_TEST_CONTEXT set. Without this guard the suite
  // would launch the gate, which launches the suite, without end. So when the
  // runner is the caller, do nothing and exit 0 (a skipped file, not a verdict).
  if (process.env.NODE_TEST_CONTEXT) {
    return finish(
      'GATE SKIP (launched by the node test runner as a discovered file; the gate never runs inside the suite)',
      0
    );
  }

  const baseEnv = { ...process.env };
  // If this gate were ever launched from inside a node:test process the
  // child would otherwise inherit the parent runner's context.
  delete baseEnv.NODE_TEST_CONTEXT;

  for (let i = 1; i <= opts.runs; i++) {
    const started = Date.now();
    const res = await runChild(['--test', '--test-reporter=tap'], baseEnv, SUITE_TIMEOUT_MS);
    const ms = Date.now() - started;
    const pass = lastCount(res.tail, 'pass');
    const fail = lastCount(res.tail, 'fail');
    const cancelled = lastCount(res.tail, 'cancelled');
    process.stdout.write(
      'run ' + i + '/' + opts.runs + ': pass=' + (pass === null ? '?' : pass) +
      ' fail=' + (fail === null ? '?' : fail) + ' (' + ms + ' ms)\n'
    );
    const green =
      res.code === 0 && !res.timedOut && fail === 0 && (cancelled === null || cancelled === 0);
    if (!green) {
      let why = [];
      if (res.timedOut) why.push('timed out after ' + SUITE_TIMEOUT_MS + ' ms');
      if (res.code !== 0) why.push('exit code ' + res.code + (res.signal ? ' (' + res.signal + ')' : ''));
      if (fail === null) why.push('no `# fail` summary line parsed');
      else if (fail !== 0) why.push('fail=' + fail);
      if (cancelled) why.push('cancelled=' + cancelled);
      process.stdout.write('test-gate: run ' + i + ' not green: ' + why.join(', ') + '\n');
      return finish('GATE FAIL at run ' + i, 1);
    }
  }

  if (opts.soak) {
    const soakEnv = { ...baseEnv };
    if (!soakEnv.SOAK_PROCESSES) soakEnv.SOAK_PROCESSES = '2';
    if (!soakEnv.SOAK_DURATION_MS) soakEnv.SOAK_DURATION_MS = '6000';
    if (!soakEnv.SOAK_WRITE_INTERVAL_MS) soakEnv.SOAK_WRITE_INTERVAL_MS = '400';
    process.stdout.write(
      'soak smoke: processes=' + soakEnv.SOAK_PROCESSES + ' durationMs=' + soakEnv.SOAK_DURATION_MS +
      ' writeIntervalMs=' + soakEnv.SOAK_WRITE_INTERVAL_MS + '\n'
    );
    const soakTimeout = parseInt(soakEnv.SOAK_DURATION_MS, 10) + 5 * 60 * 1000;
    const res = await runChild([path.join('scripts', 'soak.js')], soakEnv, soakTimeout);
    if (res.code !== 0 || res.timedOut) {
      process.stdout.write(
        'test-gate: soak not green: ' + (res.timedOut ? 'timed out' : 'exit code ' + res.code) + '\n'
      );
      return finish('GATE FAIL at soak', 1);
    }
    process.stdout.write('soak smoke: exit 0\n');
  } else {
    process.stdout.write('soak smoke: skipped (--no-soak)\n');
  }

  return finish('GATE PASS runs=' + opts.runs, 0);
}

main().catch((err) => {
  process.stderr.write('test-gate: unexpected error: ' + (err && err.stack || err) + '\n');
  finish('GATE FAIL at run 0', 1);
});
