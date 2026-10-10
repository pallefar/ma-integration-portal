// D-12-06 / DATA-06 (Phase 12, plan 15): the CI workflow and the test gate.
//
// Two things are proven here, both WITHOUT running the suite from inside the
// suite (that would recurse):
//   1. scripts/test-gate.js — only its `--help` text, its argument validation
//      and its recursion guard are exercised. A real gate run (suite N× + soak)
//      is `npm run test:gate`, run outside `node --test`.
//   2. .github/workflows/test.yml — checked as TEXT (no YAML parser is a
//      dependency, and the file is simple enough that line-level assertions
//      are exact). The workflow's first real execution is on the first push.
//
// node:test — Node's built-in runner, zero new dependency.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const GATE = path.join(REPO_ROOT, 'scripts', 'test-gate.js');
const WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'test.yml');

function runGate(args, extraEnv) {
  return spawnSync(process.execPath, [GATE, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ...(extraEnv || {}) },
  });
}

test('test-gate --help prints the flags and exits 0 without running anything', () => {
  const r = runGate(['--help']);
  assert.strictEqual(r.status, 0, r.stderr);
  for (const flag of ['--runs', '--no-soak', '--help']) {
    assert.ok(r.stdout.includes(flag), 'help text names ' + flag);
  }
  // --help must never reach a verdict line: nothing was run.
  assert.ok(!/^GATE (PASS|FAIL|SKIP)/m.test(r.stdout), 'help is not a gate verdict');
  assert.ok(!/^run \d+\//m.test(r.stdout), 'no suite run was started');
});

test('test-gate rejects bad arguments with a machine-checkable last line', () => {
  for (const bad of [['--runs', '0'], ['--runs', 'abc'], ['--runs'], ['--bogus']]) {
    const r = runGate(bad);
    assert.strictEqual(r.status, 2, JSON.stringify(bad) + ' exits 2');
    const lines = r.stdout.trim().split('\n');
    assert.strictEqual(lines[lines.length - 1], 'GATE FAIL bad arguments');
  }
});

test('test-gate is a no-op when the node test runner launches it (no self-recursion)', () => {
  // `node --test` auto-discovers scripts/test-gate.js (basename `test-*`) and
  // runs it with NODE_TEST_CONTEXT set; it must skip, not start another suite.
  const r = runGate([], { NODE_TEST_CONTEXT: 'child-v8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.ok(/^GATE SKIP /.test(lines[lines.length - 1]), 'last line is GATE SKIP');
  assert.ok(!/^run \d+\//m.test(r.stdout), 'no suite run was started');
});

test('package.json exposes the gate as `test:gate`', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['test:gate'], 'node scripts/test-gate.js');
});

// --- .github/workflows/test.yml, checked as text ----------------------------

function workflowText() {
  assert.ok(fs.existsSync(WORKFLOW), '.github/workflows/test.yml exists');
  return fs.readFileSync(WORKFLOW, 'utf8');
}

// Strip full-line and trailing YAML comments so assertions judge only the
// executable definition, never the explanatory prose.
function workflowCode() {
  return workflowText()
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

test('workflow triggers on push and pull_request', () => {
  const y = workflowCode();
  assert.ok(/^on:\s*$/m.test(y), 'has an `on:` block');
  assert.ok(/^\s+push:/m.test(y), 'push trigger');
  assert.ok(/^\s+pull_request:/m.test(y), 'pull_request trigger');
});

test('workflow token is read-only', () => {
  const y = workflowCode();
  assert.ok(/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(y), 'top-level permissions: contents: read');
  assert.ok(!/:\s*write\s*$/m.test(y), 'no write permission is granted anywhere');
  assert.ok(!/\bsecrets\./.test(y), 'no secrets are referenced');
});

test('workflow matrix covers ubuntu-24.04 and windows on Node 22', () => {
  const y = workflowCode();
  assert.ok(/ubuntu-24\.04/.test(y), 'ubuntu-24.04 pinned (glibc >= 2.38 for the committed better-sqlite3 prebuild)');
  assert.ok(!/ubuntu-latest/.test(y), 'ubuntu is pinned, not -latest');
  assert.ok(/windows-/.test(y), 'a windows- runner');
  assert.ok(/node-version:\s*['"]?22['"]?\s*$/m.test(y), 'node-version 22');
  assert.ok(/fail-fast:\s*false/.test(y), 'one OS failing does not hide the other');
});

test('workflow runs `node --test` and pins its actions by major tag', () => {
  const y = workflowCode();
  assert.ok(/^\s*-?\s*run:\s*node --test\s*$/m.test(y), 'a step running `node --test`');
  const uses = y.match(/^\s*-?\s*uses:\s*\S+/gm) || [];
  assert.ok(uses.length >= 2, 'checkout + setup-node');
  for (const u of uses) {
    assert.ok(/@v\d+\s*$/.test(u), 'action pinned by major tag: ' + u.trim());
  }
  assert.ok(/actions\/checkout@v4/.test(y) && /actions\/setup-node@v4/.test(y), 'checkout@v4 and setup-node@v4');
});

test('workflow has no dependency-install step (zero-install: node_modules is committed)', () => {
  const y = workflowCode();
  assert.ok(
    !/\b(npm|pnpm|yarn)\s+(ci|install|i|add)\b/.test(y),
    'no npm/pnpm/yarn install step'
  );
  assert.ok(!/\bcache:\s*['"]?(npm|pnpm|yarn)/.test(y), 'no package-manager cache (nothing is installed)');
});
