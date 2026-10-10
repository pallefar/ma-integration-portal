// Phase 12 / plan 12-04 (T-12-37): the perf harness's own safety rules.
//
// scripts/perf/lib/instrumented-server.js is reused by every Phase 12 perf
// script, so the two things that must never go wrong are enforced once, in the
// library, and locked here:
//   1. a perf run can never be pointed at the committed data/*.db files;
//   2. it refuses to start when the (shared, often nearly full) scratch disk
//      has < 1 GB free.
// Pure unit tests — no server is started.
//
// node:test — run via `node --test test/perf-harness-guards.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertScratchEnv, assertEnoughDisk, MIN_FREE_BYTES, REPO_ROOT } = require('../scripts/perf/lib/instrumented-server.js');

function okEnv(dir) {
  return {
    MA_CONTROL_DB_PATH: path.join(dir, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(dir, 'runtime.db'),
    MA_DEMO_DB_PATH: path.join(dir, 'demo.db'),
    MA_DEALS_DIR: path.join(dir, 'deals'),
    MA_AUDIT_DB_PATH: path.join(dir, 'audit.db'),
  };
}

test('perf harness: a complete scratch env outside <repo>/data is accepted', () => {
  assert.doesNotThrow(() => assertScratchEnv(okEnv(os.tmpdir())));
});

test('perf harness: a missing MA_* path is refused (never silently falls back to data/)', () => {
  const env = okEnv(os.tmpdir());
  delete env.MA_DEMO_DB_PATH;
  assert.throws(() => assertScratchEnv(env), /MA_DEMO_DB_PATH must be set/);
});

test('perf harness: any MA_* path inside <repo>/data is refused', () => {
  const env = okEnv(os.tmpdir());
  env.MA_CONTROL_DB_PATH = path.join(REPO_ROOT, 'data', 'control.db');
  assert.throws(() => assertScratchEnv(env), /inside .*data/);
  const env2 = okEnv(os.tmpdir());
  env2.MA_DEALS_DIR = path.join(REPO_ROOT, 'data', 'deals');
  assert.throws(() => assertScratchEnv(env2), /inside .*data/);
});

test('perf harness: refuses to start with < 1 GB free, naming the shortfall (code PERF_LOW_DISK)', () => {
  const original = fs.statfsSync;
  fs.statfsSync = () => ({ bavail: 100, bsize: 1024 * 1024 }); // 100 MB
  try {
    assert.throws(() => assertEnoughDisk(os.tmpdir()), (e) => e.code === 'PERF_LOW_DISK' && /only 100 MB free/.test(e.message));
    fs.statfsSync = () => ({ bavail: 2, bsize: MIN_FREE_BYTES }); // 2 GB
    assert.doesNotThrow(() => assertEnoughDisk(os.tmpdir()));
  } finally {
    fs.statfsSync = original;
  }
});

test('perf harness: pack-isolation removes its scratch dir on SIGINT/SIGTERM and in a finally path (static)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'perf', 'pack-isolation.js'), 'utf8');
  assert.ok(/process\.once\('SIGINT'/.test(src) && /process\.once\('SIGTERM'/.test(src), 'both signals must be handled');
  assert.ok(/fs\.rmSync\(TMP_DIR/.test(src), 'the scratch dir must be removed');
  assert.ok(/MA_CONTROL_DB_PATH = path\.join\(TMP_DIR/.test(src), 'the data set must live under the scratch dir');
});
