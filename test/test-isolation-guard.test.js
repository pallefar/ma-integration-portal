// DATA-06 / D-12-06 / R5-04: the test runner must never be able to write the
// developer's real data files. db/dbFiles.js assertTestIsolation() — called by
// openDbFile(), the single choke point every database open passes through —
// throws `[test-isolation]` when NODE_TEST_CONTEXT is set (Node's test runner
// sets it for every file and every child it spawns) and the path lies inside
// <repo>/data. This suite proves:
//   - the pure function: refuses data/ spellings under the runner, is inert
//     without NODE_TEST_CONTEXT (production / soak / UAT / CLIs), leaves temp
//     paths and look-alike sibling directories alone;
//   - the integration: a child that requires server.js (or opens a default
//     path) with every MA_* override removed dies loudly with the named fix and
//     creates NO file in data/; a child with every MA_* pointing at a temp dir
//     opens fine; the Phase-10 real-mode `[security]` refusal still wins.
//
// Every open/require case runs in a spawnSync child — this process never opens
// a default data path itself (if the guard regressed, an in-process attempt
// would create the very file the suite exists to protect).
//
// node:test — run via `node --test test/test-isolation-guard.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const dbFiles = require('../db/dbFiles.js');

const DATA_DIR = path.join(REPO_ROOT, 'data');
const WATCHED = [
  'audit.db', 'audit.db-wal', 'audit.db-shm',
  'runtime.db', 'runtime.db-wal', 'runtime.db-shm',
].map((f) => path.join(DATA_DIR, f));

function snapshot() {
  return WATCHED.map((f) => {
    try {
      const st = fs.statSync(f);
      return `${f}:${st.size}:${st.mtimeMs}`;
    } catch (e) {
      return `${f}:ABSENT`;
    }
  });
}

/** Child env: a copy of this process's env with every MA_* key removed and
 * NODE_TEST_CONTEXT set to a non-empty value, plus `extra`. */
function childEnv(extra) {
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) {
    if (k.startsWith('MA_')) delete env[k];
  }
  delete env.DEMO_OPEN;
  env.NODE_TEST_CONTEXT = 'child';
  return Object.assign(env, extra || {});
}

function runProbe(probe, env) {
  return spawnSync(process.execPath, ['-e', probe], { cwd: REPO_ROOT, encoding: 'utf8', env, timeout: 60000 });
}

test('test-isolation guard: the pure function refuses data/ spellings under the runner', () => {
  const env = { NODE_TEST_CONTEXT: 'child' };
  for (const rel of [
    'runtime.db', 'audit.db', 'control.db', 'demo.db',
    path.join('deals', 'deal_abc.db'),
    path.join('real', 'control.db'),
    path.join('..', 'data', 'runtime.db'), // lexical `..` spelling
  ]) {
    const p = path.join(DATA_DIR, rel);
    assert.throws(() => dbFiles.assertTestIsolation(p, env), /^Error: \[test-isolation\]/, `must refuse ${p}`);
  }
  // The error names the fix.
  try {
    dbFiles.assertTestIsolation(path.join(DATA_DIR, 'audit.db'), env);
    assert.fail('expected a throw');
  } catch (e) {
    assert.match(e.message, /MA_AUDIT_DB_PATH/);
    assert.match(e.message, /MA_RUNTIME_DB_PATH/);
    assert.match(e.message, /MA_DATA_DIR/);
    assert.ok(e.message.includes(path.join('data', 'audit.db')), 'names the path relative to the repo');
  }
});

test('test-isolation guard: a symlinked spelling of data/ is refused too', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-isolation-link-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const link = path.join(tmp, 'data-link');
  try {
    fs.symlinkSync(DATA_DIR, link, 'dir');
  } catch (e) {
    t.skip('cannot create a symlink on this platform: ' + e.code);
    return;
  }
  assert.throws(
    () => dbFiles.assertTestIsolation(path.join(link, 'runtime.db'), { NODE_TEST_CONTEXT: 'child' }),
    /^Error: \[test-isolation\]/,
  );
});

test('test-isolation guard: the Phase-10 opt-in exempts exactly data/control.db and nothing else', () => {
  const optIn = { NODE_TEST_CONTEXT: 'child', MA_TEST_ALLOW_COMMITTED_CONTROL_DB: '1' };
  assert.doesNotThrow(() => dbFiles.assertTestIsolation(path.join(DATA_DIR, 'control.db'), optIn));
  assert.doesNotThrow(() => dbFiles.assertTestIsolation(path.join(DATA_DIR, '..', 'data', 'control.db'), optIn));
  // The files the R5-04 leak actually wrote — and every other data/ path — stay refused with the opt-in set.
  for (const rel of ['runtime.db', 'audit.db', 'demo.db', 'control.db-wal', path.join('deals', 'deal_abc.db'), path.join('real', 'control.db')]) {
    assert.throws(
      () => dbFiles.assertTestIsolation(path.join(DATA_DIR, rel), optIn),
      /^Error: \[test-isolation\]/,
      `the opt-in must not exempt data/${rel}`,
    );
  }
  // Anything but the exact value '1' is not an opt-in.
  for (const v of ['', '0', 'true']) {
    assert.throws(
      () => dbFiles.assertTestIsolation(path.join(DATA_DIR, 'control.db'), { NODE_TEST_CONTEXT: 'child', MA_TEST_ALLOW_COMMITTED_CONTROL_DB: v }),
      /^Error: \[test-isolation\]/,
    );
  }
});

test('test-isolation guard: inert without NODE_TEST_CONTEXT (production / soak / UAT / CLIs unaffected)', () => {
  const p = path.join(DATA_DIR, 'runtime.db');
  assert.doesNotThrow(() => dbFiles.assertTestIsolation(p, {}));
  assert.doesNotThrow(() => dbFiles.assertTestIsolation(p, { NODE_TEST_CONTEXT: '' }));
  assert.doesNotThrow(() => dbFiles.assertTestIsolation(path.join(DATA_DIR, 'audit.db'), { MA_MODE: 'real' }));
});

test('test-isolation guard: temp paths and look-alike sibling directories are allowed', () => {
  const env = { NODE_TEST_CONTEXT: 'child' };
  const tmp = path.join(os.tmpdir(), 'gsd-isolation-never-created', 'runtime.db');
  assert.doesNotThrow(() => dbFiles.assertTestIsolation(tmp, env));
  // `<repo>/data-other` shares the string prefix `<repo>/data` but is not inside it.
  assert.doesNotThrow(() => dbFiles.assertTestIsolation(path.join(REPO_ROOT, 'data-other', 'x.db'), env));
  assert.doesNotThrow(() => dbFiles.assertTestIsolation('', env));
});

test('test-isolation guard: a default-path open under the runner fails loudly and creates nothing', () => {
  const before = snapshot();
  const probe = [
    "const f = require('./db/dbFiles.js');",
    'for (const [p, s] of [',
    '  [f.RUNTIME_DB_PATH, f.RUNTIME_SCHEMA_PATH],',
    '  [f.AUDIT_DB_PATH, f.AUDIT_SCHEMA_PATH],',
    ']) {',
    "  try { f.openDbFile(p, s); console.log('OPENED ' + p); }",
    "  catch (e) { console.log('ERR ' + e.message); }",
    '}',
  ].join('\n');
  const r = runProbe(probe, childEnv());
  assert.strictEqual(r.status, 0, `probe crashed: ${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.strictEqual(lines.length, 2, r.stdout);
  for (const l of lines) assert.match(l, /^ERR \[test-isolation\] /, l);
  assert.deepStrictEqual(snapshot(), before, 'a refused open must create/modify no file under data/');
});

test('test-isolation guard: a child that requires server.js with no MA_* overrides dies with the named fix', () => {
  const before = snapshot();
  const r = runProbe("require('./server.js');", childEnv());
  assert.notStrictEqual(r.status, 0, 'requiring the app against default data paths under the runner must fail');
  assert.match(r.stderr, /\[test-isolation\]/);
  assert.match(r.stderr, /MA_AUDIT_DB_PATH/);
  assert.deepStrictEqual(snapshot(), before, 'the refused boot must create/modify no file under data/');
});

test('test-isolation guard: with every MA_* pointing at a temp dir the same opens succeed', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-isolation-ok-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const env = childEnv({
    MA_CONTROL_DB_PATH: path.join(tmp, 'control.db'),
    MA_RUNTIME_DB_PATH: path.join(tmp, 'runtime.db'),
    MA_DEMO_DB_PATH: path.join(tmp, 'demo.db'),
    MA_DEALS_DIR: path.join(tmp, 'deals'),
    MA_AUDIT_DB_PATH: path.join(tmp, 'audit.db'),
  });
  const probe = [
    "const f = require('./db/dbFiles.js');",
    'for (const [p, s] of [',
    '  [f.CONTROL_DB_PATH, f.CONTROL_SCHEMA_PATH],',
    '  [f.RUNTIME_DB_PATH, f.RUNTIME_SCHEMA_PATH],',
    '  [f.AUDIT_DB_PATH, f.AUDIT_SCHEMA_PATH],',
    '  [f.DEMO_DB_PATH, f.DEAL_SCHEMA_PATH],',
    ']) { f.openDbFile(p, s).close(); }',
    "console.log('OK');",
  ].join('\n');
  const before = snapshot();
  const r = runProbe(probe, env);
  assert.strictEqual(r.status, 0, `isolated open failed: ${r.stderr}`);
  assert.match(r.stdout, /OK/);
  assert.ok(fs.existsSync(path.join(tmp, 'audit.db')), 'the isolated audit file landed in the temp dir');
  assert.deepStrictEqual(snapshot(), before);
});

test('test-isolation guard: the real-mode committed-path `[security]` refusal still wins (ordering)', () => {
  const before = snapshot();
  const probe = [
    "const f = require('./db/dbFiles.js');",
    'for (const p of [f.COMMITTED_CONTROL_DB_PATH, f.COMMITTED_DEMO_DB_PATH]) {',
    "  try { f.openDbFile(p, f.CONTROL_SCHEMA_PATH); console.log('OPENED ' + p); }",
    "  catch (e) { console.log('ERR ' + e.message); }",
    '}',
  ].join('\n');
  // MA_MODE=real with MA_DATA_DIR unset; the committed files are the targets.
  const r = runProbe(probe, childEnv({ MA_MODE: 'real' }));
  assert.strictEqual(r.status, 0, `probe crashed: ${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  assert.strictEqual(lines.length, 2, r.stdout);
  for (const l of lines) {
    assert.match(l, /^ERR \[security\] real-deal mode refuses to open the committed database file /, l);
  }
  assert.deepStrictEqual(snapshot(), before);
});
